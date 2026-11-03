-- Additive only: no legacy rows are rewritten. Existing owner RLS/audit/locks apply.
alter table public.loans add column ledger_managed boolean not null default false,
  add column due_date date, add column interest_terms text;
alter table public.transactions add column loan_id uuid, add column loan_event text,
  add column reverses_transaction_id uuid, add column loan_command text, add column refund_reason text,
  add foreign key(user_id,loan_id) references public.loans(user_id,id),
  add foreign key(user_id,reverses_transaction_id) references public.transactions(user_id,id),
  add check ((loan_id is null) = (loan_event is null)),
  add check (loan_event in ('disbursement','repayment','interest','reversal')),
  add check (refund_reason in ('merchant_refund','shared_reimbursement','other'));
create index transactions_loan_history on public.transactions(user_id,loan_id,occurred_on);
create unique index one_loan_disbursement on public.transactions(user_id,loan_id) where loan_event='disbursement';
create unique index one_loan_reversal on public.transactions(user_id,reverses_transaction_id) where loan_id is not null and reverses_transaction_id is not null;
create or replace view public.api_transactions with (security_invoker=true) as
select id,user_id,amount::text as amount,currency,kind,status,occurred_on,
  description,from_account_id,to_account_id,category,category_id,subcategory,
  merchant,external_payer,external_reference,source_system,source_object_id,
  receipt_document_id,refund_of_transaction_id,import_batch_id,notes,created_at,
  updated_at,platform,from_balance_snapshot_id,to_balance_snapshot_id,
  loan_id,loan_event,reverses_transaction_id,loan_command,refund_reason
from public.transactions;
-- Preserve existing column order and exact numeric serialization for loans.
do $$ declare cols text; begin
  select string_agg(case when data_type='numeric' then format('%I::text as %I',column_name,column_name) else format('%I',column_name) end,',' order by ordinal_position)
    into cols from information_schema.columns where table_schema='public' and table_name='loans';
  execute 'create or replace view public.api_loans with (security_invoker=true) as select '||cols||' from public.loans';
end $$;
revoke all on public.api_transactions,public.api_loans from anon,authenticated;
grant select on public.api_transactions,public.api_loans to authenticated;

create function private.guard_personal_loan() returns trigger
language plpgsql security invoker set search_path='' as $$
declare l public.loans; original public.transactions; a public.accounts; outstanding numeric;
  outgoing boolean;
begin
  if tg_table_name='loans' then
    if tg_op<>'INSERT' and old.ledger_managed then raise exception 'Loan history is immutable. Use repayment or reversal.'; end if;
    if tg_op='DELETE' then return old; end if;
    if new.ledger_managed and (new.kind='institutional' or new.contractual_principal is null or new.contractual_principal<=0 or new.disbursed_on is null or new.repayment_account_id is null or new.due_date<new.disbursed_on) then raise exception 'Invalid personal loan agreement'; end if;
    return new;
  end if;
  if tg_op<>'INSERT' and old.loan_id is not null then raise exception 'Loan history is immutable. Use a reversal.'; end if;
  if tg_op='DELETE' then return old; end if;
  if new.loan_id is null then return new; end if;
  select * into l from public.loans where user_id=auth.uid() and id=new.loan_id for update;
  if not found or new.user_id<>auth.uid() or not l.ledger_managed or new.status<>'posted' or new.currency<>'INR' or new.occurred_on<l.disbursed_on or (new.from_account_id is null)=(new.to_account_id is null) then raise exception 'Invalid linked loan event'; end if;
  select * into a from public.accounts where id=coalesce(new.from_account_id,new.to_account_id) and user_id=new.user_id;
  if not found or not a.active or a.kind not in ('bank','wallet') then raise exception 'Loan events require an active bank or wallet'; end if;
  outgoing:=case when new.loan_event='disbursement' then l.kind='lent' else l.kind='borrowed' end;
  if new.loan_event='disbursement' and (new.amount<>l.contractual_principal or new.occurred_on<>l.disbursed_on or a.id<>l.repayment_account_id) then raise exception 'Disbursement must match the agreement'; end if;
  if new.loan_event='reversal' then
    select * into original from public.transactions where user_id=new.user_id and id=new.reverses_transaction_id and loan_id=l.id and loan_event in ('repayment','interest');
    if not found or new.amount<>original.amount or new.occurred_on<original.occurred_on or new.from_account_id is distinct from original.to_account_id or new.to_account_id is distinct from original.from_account_id then raise exception 'Invalid repayment reversal'; end if;
    outgoing:=original.to_account_id is not null;
    if new.kind<>(case when original.loan_event='repayment' then 'transfer' when original.kind='expense' then 'refund' else 'adjustment' end) then raise exception 'Invalid reversal classification'; end if;
  elsif new.reverses_transaction_id is not null then raise exception 'Only reversals may reverse an event';
  elsif new.loan_event='interest' then
    if new.kind<>(case when outgoing then 'expense' else 'income' end) then raise exception 'Invalid interest classification'; end if;
  elsif new.kind<>'transfer' then raise exception 'Principal must be a cash movement, not income or expense'; end if;
  if outgoing<>(new.from_account_id is not null) then raise exception 'Wrong loan cash direction'; end if;
  select coalesce(sum(case when loan_event='disbursement' then amount when loan_event='repayment' then -amount when loan_event='reversal' and kind='transfer' then amount else 0 end),0) into outstanding from public.transactions where user_id=new.user_id and loan_id=l.id;
  if new.loan_event='repayment' and new.amount>outstanding then raise exception 'Principal repayment exceeds outstanding'; end if;
  return new;
end $$;
create trigger guard_personal_loan before insert or update or delete on public.loans for each row execute function private.guard_personal_loan();
create trigger guard_personal_loan before insert or update or delete on public.transactions for each row execute function private.guard_personal_loan();
create function private.check_personal_disbursement() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if new.ledger_managed and not exists(select 1 from public.transactions where user_id=new.user_id and loan_id=new.id and loan_event='disbursement') then raise exception 'A personal agreement and its disbursement must commit together'; end if;
 return new;
end $$;
create constraint trigger check_personal_disbursement after insert or update on public.loans deferrable initially deferred for each row execute function private.check_personal_disbursement();

create function public.commit_personal_loan(p_expected_revision bigint,p_loan jsonb,p_transactions jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); version bigint; l public.loans; t public.transactions; item jsonb;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,719260));
 select revision into version from public.workspace_revisions where user_id=owner_id;
 if p_expected_revision is null or coalesce(version,0)<>p_expected_revision then raise exception 'Workspace changed' using errcode='40001'; end if;
 if jsonb_typeof(p_transactions)<>'array' or jsonb_array_length(p_transactions) not between 1 and 2 then raise exception 'Invalid event batch'; end if;
 if p_loan is not null and p_loan<>'null'::jsonb then
  l:=jsonb_populate_record(null::public.loans,p_loan);
  if l.user_id<>owner_id or l.user_id is null or l.ledger_managed is distinct from true then raise exception 'Invalid owner' using errcode='42501'; end if;
  insert into public.loans(id,user_id,name,lender,kind,contractual_principal,net_disbursed,repayment_account_id,disbursed_on,notes,ledger_managed,due_date,interest_terms)
    values(l.id,owner_id,l.name,l.lender,l.kind,l.contractual_principal,l.net_disbursed,l.repayment_account_id,l.disbursed_on,l.notes,true,l.due_date,l.interest_terms);
 end if;
 for item in select * from jsonb_array_elements(p_transactions) loop
  t:=jsonb_populate_record(null::public.transactions,item);
  if t.user_id is distinct from owner_id or t.loan_id is null then raise exception 'Invalid event owner' using errcode='42501'; end if;
  insert into public.transactions(id,user_id,amount,currency,kind,status,occurred_on,description,from_account_id,to_account_id,from_balance_snapshot_id,to_balance_snapshot_id,category,source_system,source_object_id,notes,refund_of_transaction_id,loan_id,loan_event,reverses_transaction_id,loan_command)
    values(t.id,owner_id,t.amount,t.currency,t.kind,t.status,t.occurred_on,t.description,t.from_account_id,t.to_account_id,t.from_balance_snapshot_id,t.to_balance_snapshot_id,t.category,t.source_system,t.source_object_id,t.notes,t.refund_of_transaction_id,t.loan_id,t.loan_event,t.reverses_transaction_id,t.loan_command);
 end loop;
end $$;
revoke all on function public.commit_personal_loan(bigint,jsonb,jsonb) from public,anon;
grant execute on function public.commit_personal_loan(bigint,jsonb,jsonb) to authenticated;

-- Optional account scheduling metadata never rewrites historical transactions.
alter table public.accounts add column billing_day integer check(billing_day between 1 and 31);
alter table public.accounts add column due_day integer check(due_day between 1 and 31);
create or replace view public.api_accounts with (security_invoker=true) as
select id,user_id,name,institution,kind,masked_suffix,credit_limit::text as credit_limit,
 opening_balance::text as opening_balance,opening_balance_date,active,notes,accent,created_at,updated_at,billing_day,due_day
from public.accounts;
revoke all on public.api_accounts from anon,authenticated;
grant select on public.api_accounts to authenticated;

-- The original payment links a reimbursement directly to its receivable. The
-- existing workspace statement lock serializes competing participant payments.
create function private.guard_linked_reimbursement() returns trigger
language plpgsql security invoker set search_path='' as $$
declare g public.expense_groups; share_amount numeric; already_paid numeric; total_shares numeric;
begin
 if new.refund_reason is distinct from 'shared_reimbursement' or new.refund_of_transaction_id is null then return new; end if;
 if new.kind<>'refund' or new.to_account_id is null then raise exception 'Reimbursements require an incoming refund'; end if;
 select * into g from public.expense_groups where user_id=new.user_id and transaction_id=new.refund_of_transaction_id and paid_by='You' and coalesce(kind,'expense')='expense';
 if not found then raise exception 'Link a shared purchase agreement'; end if;
 select amount into share_amount from public.expense_shares where user_id=new.user_id and group_id=g.id and not is_owner and participant=new.external_payer;
 if share_amount is null then raise exception 'Choose the participant repaying their share'; end if;
 select coalesce(sum(amount),0) into total_shares from public.expense_shares where user_id=new.user_id and group_id=g.id;
 if total_shares<>g.total_cost then raise exception 'Complete the shared purchase allocation first'; end if;
 select coalesce(sum(s.amount),0) into already_paid from public.settlements s join public.transactions t on t.id=s.transaction_id and t.user_id=s.user_id
 where s.user_id=new.user_id and s.group_id=g.id and s.counterparty=new.external_payer and s.direction='incoming' and t.status='posted' and t.id<>new.id;
 select already_paid+coalesce(sum(t.amount),0) into already_paid from public.transactions t where t.user_id=new.user_id and t.id<>new.id and t.status='posted' and t.refund_reason='shared_reimbursement' and t.refund_of_transaction_id=g.transaction_id and t.external_payer=new.external_payer and not exists(select 1 from public.settlements s where s.user_id=t.user_id and s.transaction_id=t.id);
 if new.status='posted' and already_paid+new.amount>share_amount then raise exception 'Reimbursement exceeds remaining participant share'; end if;
 return new;
end $$;
create trigger guard_linked_reimbursement before insert or update on public.transactions for each row execute function private.guard_linked_reimbursement();
