-- Personal Finance OS: all financial tables are owner-scoped. No production seed.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Kolkata', preferences jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, parent_id uuid, active boolean not null default true,
  created_at timestamptz not null default now(), unique(user_id,id), unique(user_id,name),
  foreign key(user_id,parent_id) references public.categories(user_id,id)
);
create table public.accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 120), institution text not null default '',
  kind text not null check(kind in ('bank','wallet','credit_card','pay_later')),
  masked_suffix text not null default '' check(masked_suffix ~ '^[0-9]{0,4}$'),
  credit_limit numeric(14,2) check(credit_limit >= 0), opening_balance numeric(14,2), opening_balance_date date,
  active boolean not null default true, notes text, accent text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,id),
  check((opening_balance is null) = (opening_balance_date is null))
);
create table public.account_snapshots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null, as_of timestamptz not null, reported_balance numeric(14,2),
  reported_outstanding numeric(14,2), reported_utilized numeric(14,2), reported_available numeric(14,2), reported_unbilled numeric(14,2),
  next_statement_date date, source text not null check(source in ('bank_statement','app_screenshot','user_report','import')),
  verified_by_user boolean not null default false, created_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,account_id) references public.accounts(user_id,id),
  check(coalesce(reported_balance,reported_outstanding,reported_utilized,reported_available,reported_unbilled) is not null)
);
create table public.documents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  secure_storage_path text not null unique, file_name text not null, file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
  mime_type text not null check(mime_type in ('application/pdf','text/csv','image/png','image/jpeg','image/webp')),
  byte_size integer not null check(byte_size > 0 and byte_size <= 10485760),
  parsed_state text not null default 'unparsed' check(parsed_state in ('unparsed','review','approved','failed')),
  created_at timestamptz not null default now(), unique(user_id,id), unique(user_id,file_hash),
  check(split_part(secure_storage_path,'/',1) = user_id::text)
);
create table public.import_batches (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  source text not null, input_hash text not null, file_name text,
  document_id uuid, state text not null default 'review' check(state in ('review','committed','reverted','rejected')),
  approved_at timestamptz, created_at timestamptz not null default now(), unique(user_id,id), unique(user_id,source,input_hash),
  foreign key(user_id,document_id) references public.documents(user_id,id)
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check(amount > 0), currency text not null default 'INR' check(currency ~ '^[A-Z]{3}$'),
  kind text not null check(kind in ('expense','income','transfer','bill_payment','refund','adjustment')),
  status text not null default 'pending_review' check(status in ('posted','pending_review','voided')),
  occurred_on date, description text not null, from_account_id uuid, to_account_id uuid,
  category text, category_id uuid, subcategory text, merchant text, external_payer text, external_reference text,
  source_system text, source_object_id text, receipt_document_id uuid, refund_of_transaction_id uuid, import_batch_id uuid, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,from_account_id) references public.accounts(user_id,id),
  foreign key(user_id,to_account_id) references public.accounts(user_id,id),
  foreign key(user_id,category_id) references public.categories(user_id,id),
  foreign key(user_id,receipt_document_id) references public.documents(user_id,id),
  foreign key(user_id,refund_of_transaction_id) references public.transactions(user_id,id),
  foreign key(user_id,import_batch_id) references public.import_batches(user_id,id),
  check(from_account_id is null or to_account_id is null or from_account_id <> to_account_id),
  check(refund_of_transaction_id is null or refund_of_transaction_id <> id),
  check(status <> 'posted' or (occurred_on is not null and (from_account_id is not null or to_account_id is not null or nullif(external_payer,'') is not null))),
  check(kind <> 'income' or to_account_id is not null), check(kind <> 'bill_payment' or from_account_id is not null)
);
create unique index transactions_source_identity on public.transactions(user_id,source_system,source_object_id) where source_object_id is not null;
create unique index transactions_provider_reference on public.transactions(user_id,source_system,coalesce(from_account_id,to_account_id),external_reference)
where source_system is not null and nullif(external_reference,'') is not null and coalesce(from_account_id,to_account_id) is not null;
create table public.bills (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null, statement_amount numeric(14,2) not null check(statement_amount >= 0),
  statement_date date not null, due_date date, period_start date not null, period_end date not null,
  minimum_due numeric(14,2) check(minimum_due >= 0), statement_credits numeric(14,2) not null default 0 check(statement_credits >= 0),
  document_id uuid, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,account_id) references public.accounts(user_id,id), foreign key(user_id,document_id) references public.documents(user_id,id),
  check(period_start <= period_end), check(due_date is null or due_date >= statement_date), check(statement_credits <= statement_amount), check(minimum_due is null or minimum_due <= statement_amount)
);
create table public.bill_payment_allocations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid not null, transaction_id uuid not null, amount numeric(14,2) not null check(amount > 0), verified boolean not null default false,
  created_at timestamptz not null default now(), unique(user_id,id), unique(user_id,bill_id,transaction_id),
  foreign key(user_id,bill_id) references public.bills(user_id,id), foreign key(user_id,transaction_id) references public.transactions(user_id,id)
);
create table public.fixed_deposits (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, institution text not null, masked_suffix text not null default '' check(masked_suffix ~ '^[0-9]{0,4}$'),
  principal numeric(14,2) not null check(principal > 0), opening_date date not null, maturity_date date not null,
  maturity_amount numeric(14,2), annual_rate numeric(7,4) check(annual_rate >= 0), payout_method text not null default 'Unconfirmed',
  maturity_instruction text not null default 'unconfirmed' check(maturity_instruction in ('reinvest','withdraw','unconfirmed')),
  pledged boolean not null default false, backing_account_id uuid, payout_account_id uuid,
  stated_maturity_interest numeric(14,2), reported_encashment_value numeric(14,2), reported_as_of date, certificate_document_id uuid, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,backing_account_id) references public.accounts(user_id,id), foreign key(user_id,payout_account_id) references public.accounts(user_id,id),
  foreign key(user_id,certificate_document_id) references public.documents(user_id,id), check(maturity_date >= opening_date)
);
create table public.loans (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, lender text not null, kind text not null default 'institutional' check(kind in ('institutional','lent','borrowed')),
  contractual_principal numeric(14,2) check(contractual_principal >= 0), net_disbursed numeric(14,2) check(net_disbursed >= 0),
  reported_outstanding numeric(14,2) check(reported_outstanding >= 0), reported_as_of date, annual_rate numeric(7,4) check(annual_rate >= 0),
  scheduled_total numeric(14,2) check(scheduled_total >= 0), repayment_account_id uuid, disbursed_on date, document_id uuid, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,repayment_account_id) references public.accounts(user_id,id), foreign key(user_id,document_id) references public.documents(user_id,id)
);
create table public.emis (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  loan_id uuid not null, number integer not null check(number > 0), due_date date not null,
  amount numeric(14,2) not null check(amount > 0), principal_portion numeric(14,2) check(principal_portion >= 0), interest_portion numeric(14,2) check(interest_portion >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,id), unique(user_id,loan_id,number),
  foreign key(user_id,loan_id) references public.loans(user_id,id),
  check(principal_portion is null or interest_portion is null or principal_portion + interest_portion <= amount)
);
create table public.emi_payment_allocations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  emi_id uuid not null, transaction_id uuid not null, amount numeric(14,2) not null check(amount > 0),
  created_at timestamptz not null default now(), unique(user_id,id), unique(user_id,emi_id,transaction_id),
  foreign key(user_id,emi_id) references public.emis(user_id,id), foreign key(user_id,transaction_id) references public.transactions(user_id,id)
);
create table public.personal_loans (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  person text not null, direction text not null check(direction in ('lent','borrowed')), amount numeric(14,2) not null check(amount > 0),
  occurred_on date, due_date date, transaction_id uuid, notes text, created_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,transaction_id) references public.transactions(user_id,id)
);
create table public.personal_loan_allocations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  personal_loan_id uuid not null, transaction_id uuid not null, amount numeric(14,2) not null check(amount > 0),
  created_at timestamptz not null default now(), unique(user_id,id), unique(user_id,personal_loan_id,transaction_id),
  foreign key(user_id,personal_loan_id) references public.personal_loans(user_id,id), foreign key(user_id,transaction_id) references public.transactions(user_id,id)
);
create table public.expense_groups (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, occurred_on date not null, merchant text not null default '', total_cost numeric(14,2) not null check(total_cost > 0),
  paid_by text not null, transaction_id uuid, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,transaction_id) references public.transactions(user_id,id)
);
create table public.expense_shares (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null, participant text not null, amount numeric(14,2) not null check(amount >= 0), is_owner boolean not null default false,
  created_at timestamptz not null default now(), unique(user_id,id), unique(user_id,group_id,participant), foreign key(user_id,group_id) references public.expense_groups(user_id,id)
);
create table public.settlements (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null, transaction_id uuid not null, counterparty text not null, direction text not null check(direction in ('incoming','outgoing')),
  amount numeric(14,2) not null check(amount > 0), created_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,group_id) references public.expense_groups(user_id,id), foreign key(user_id,transaction_id) references public.transactions(user_id,id)
);
create table public.import_candidates (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  import_batch_id uuid not null, parsed_values jsonb not null, matched_transaction_id uuid, confidence numeric(5,4) check(confidence between 0 and 1),
  decision text not null default 'review' check(decision in ('review','accept','skip','duplicate')), notes text,
  created_at timestamptz not null default now(), unique(user_id,id), foreign key(user_id,import_batch_id) references public.import_batches(user_id,id),
  foreign key(user_id,matched_transaction_id) references public.transactions(user_id,id)
);
create table public.source_mappings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  source_system text not null, source_object_id text not null check(length(source_object_id) > 0), entity_type text not null,
  local_record_id uuid not null, import_batch_id uuid, created_at timestamptz not null default now(), unique(user_id,id),
  unique(user_id,source_system,source_object_id), foreign key(user_id,import_batch_id) references public.import_batches(user_id,id)
);
create table public.reminders (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, bill_id uuid, emi_id uuid, trigger_at timestamptz not null,
  channel text not null default 'in_app' check(channel in ('in_app','email','push')), enabled boolean not null default false,
  state text not null default 'scheduled' check(state in ('scheduled','sent','dismissed')), created_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,bill_id) references public.bills(user_id,id), foreign key(user_id,emi_id) references public.emis(user_id,id),
  check(bill_id is null or emi_id is null)
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null, entity_id uuid not null, action text not null, description text not null,
  before_value jsonb, after_value jsonb, occurred_at timestamptz not null default now(), unique(user_id,id)
);

-- Audits are append-only to authenticated users. This private trigger is the only
-- privileged writer; it checks the actor and fixes its search path explicitly.
create function private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare record_value jsonb; owner_id uuid; record_id uuid;
begin
  record_value := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  owner_id := (record_value->>'user_id')::uuid;
  record_id := coalesce((record_value->>'id')::uuid, owner_id);
  if auth.uid() is not null and auth.uid() <> owner_id then raise exception 'Owner mismatch' using errcode='42501'; end if;
  insert into public.audit_events(user_id,entity_type,entity_id,action,description,before_value,after_value)
  values(owner_id,tg_table_name,record_id,lower(tg_op),tg_table_name || ' ' || lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) else null end,
    case when tg_op <> 'DELETE' then to_jsonb(new) else null end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.audit_change() from public, anon, authenticated;

-- Lock the original bank debit before calculating totals. Competing allocations
-- therefore serialize even when they target different bills/EMIs.
create function private.validate_allocation() returns trigger language plpgsql security invoker set search_path = '' as $$
declare payment public.transactions%rowtype; bill public.bills%rowtype; installment public.emis%rowtype; loan public.loans%rowtype;
  reserved numeric; target_paid numeric; source_kind text; item public.personal_loans%rowtype;
begin
  if tg_op='UPDATE' and (new.user_id <> old.user_id or new.transaction_id <> old.transaction_id) then raise exception 'Allocation owner/payment cannot change'; end if;
  select * into payment from public.transactions where user_id=new.user_id and id=new.transaction_id for update;
  if not found or payment.status <> 'posted' or payment.occurred_on is null then raise exception 'A dated posted payment is required'; end if;
  select coalesce(sum(amount),0) into reserved from (
    select amount from public.bill_payment_allocations where user_id=new.user_id and transaction_id=new.transaction_id and (tg_table_name<>'bill_payment_allocations' or id<>new.id)
    union all select amount from public.emi_payment_allocations where user_id=new.user_id and transaction_id=new.transaction_id and (tg_table_name<>'emi_payment_allocations' or id<>new.id)
    union all select amount from public.personal_loan_allocations where user_id=new.user_id and transaction_id=new.transaction_id and (tg_table_name<>'personal_loan_allocations' or id<>new.id)
    union all select amount from public.settlements where user_id=new.user_id and transaction_id=new.transaction_id and (tg_table_name<>'settlements' or id<>new.id)
  ) allocated;
  if reserved+new.amount > payment.amount then raise exception 'Allocations exceed payment amount'; end if;
  if tg_table_name='bill_payment_allocations' then
    select * into bill from public.bills where user_id=new.user_id and id=new.bill_id for update;
    if not found then raise exception 'Bill not found'; end if;
    select kind into source_kind from public.accounts where user_id=new.user_id and id=payment.from_account_id;
    if payment.kind not in ('bill_payment','transfer') or source_kind not in ('bank','wallet') or source_kind is null then raise exception 'Bill allocation requires a bank/wallet bill payment or transfer'; end if;
    if payment.to_account_id is distinct from bill.account_id then raise exception 'Payment destination must match billed account'; end if;
    select coalesce(sum(amount),0) into target_paid from public.bill_payment_allocations where user_id=new.user_id and bill_id=new.bill_id and id<>new.id;
    if target_paid+new.amount+bill.statement_credits > bill.statement_amount then raise exception 'Allocation exceeds remaining bill'; end if;
  elsif tg_table_name='emi_payment_allocations' then
    select * into installment from public.emis where user_id=new.user_id and id=new.emi_id for update;
    if not found then raise exception 'EMI not found'; end if;
    select * into loan from public.loans where user_id=new.user_id and id=installment.loan_id for update;
    select kind into source_kind from public.accounts where user_id=new.user_id and id=payment.from_account_id;
    if payment.kind not in ('transfer','bill_payment') or source_kind not in ('bank','wallet') or source_kind is null or loan.repayment_account_id is null or payment.from_account_id<>loan.repayment_account_id or payment.to_account_id is not null then raise exception 'EMI requires a matched repayment account transfer to the lender'; end if;
    select coalesce(sum(amount),0) into target_paid from public.emi_payment_allocations where user_id=new.user_id and emi_id=new.emi_id and id<>new.id;
    if target_paid+new.amount > installment.amount then raise exception 'Allocation exceeds remaining EMI'; end if;
  elsif tg_table_name='personal_loan_allocations' then
    select * into item from public.personal_loans where user_id=new.user_id and id=new.personal_loan_id for update;
    if not found or payment.kind not in ('transfer','refund') then raise exception 'Personal loan settlement requires a linked transfer'; end if;
    if (item.direction='lent' and payment.to_account_id is null) or (item.direction='borrowed' and payment.from_account_id is null) then raise exception 'Personal loan settlement direction is incorrect'; end if;
    select coalesce(sum(amount),0) into target_paid from public.personal_loan_allocations where user_id=new.user_id and personal_loan_id=new.personal_loan_id and id<>new.id;
    if target_paid+new.amount > item.amount then raise exception 'Settlement exceeds personal loan'; end if;
  else
    if payment.kind not in ('transfer','refund') or (new.direction='incoming' and payment.to_account_id is null) or (new.direction='outgoing' and payment.from_account_id is null) then raise exception 'Settlement needs a matching incoming/outgoing transfer'; end if;
    select kind into source_kind from public.accounts where user_id=new.user_id and id=case when new.direction='incoming' then payment.to_account_id else payment.from_account_id end;
    if source_kind is null or source_kind not in ('bank','wallet') then raise exception 'Settlement needs a bank or wallet movement'; end if;
  end if;
  return new;
end $$;

create function private.protect_financial_links() returns trigger language plpgsql security invoker set search_path = '' as $$
declare reserved numeric; source_kind text;
begin
  if tg_table_name='transactions' and tg_op='UPDATE' then
    if (new.amount,new.status,new.kind,new.from_account_id,new.to_account_id,new.occurred_on) is distinct from (old.amount,old.status,old.kind,old.from_account_id,old.to_account_id,old.occurred_on) then
      select coalesce(sum(amount),0) into reserved from (
        select amount from public.bill_payment_allocations where user_id=old.user_id and transaction_id=old.id
        union all select amount from public.emi_payment_allocations where user_id=old.user_id and transaction_id=old.id
        union all select amount from public.personal_loan_allocations where user_id=old.user_id and transaction_id=old.id
        union all select amount from public.settlements where user_id=old.user_id and transaction_id=old.id
      ) a;
      if reserved>0 then raise exception 'Remove payment allocations before changing payment details'; end if;
    end if;
    new.updated_at := now();
  elsif tg_table_name='bills' then
    select kind into strict source_kind from public.accounts where user_id=new.user_id and id=new.account_id;
    if source_kind not in ('credit_card','pay_later') then raise exception 'Bills require a credit card or Pay Later account'; end if;
    if tg_op='UPDATE' then
      select coalesce(sum(amount),0) into reserved from public.bill_payment_allocations where user_id=old.user_id and bill_id=old.id;
      if reserved+new.statement_credits>new.statement_amount or (reserved>0 and new.account_id<>old.account_id) then raise exception 'Bill change conflicts with allocations'; end if;
    end if;
  elsif tg_table_name='emis' and tg_op='UPDATE' then
    select coalesce(sum(amount),0) into reserved from public.emi_payment_allocations where user_id=old.user_id and emi_id=old.id;
    if reserved>new.amount or (reserved>0 and new.loan_id<>old.loan_id) then raise exception 'EMI change conflicts with allocations'; end if;
  elsif tg_table_name='loans' and tg_op='UPDATE' then
    if new.repayment_account_id is distinct from old.repayment_account_id then
      if exists(select 1 from public.emi_payment_allocations a join public.emis e on (a.user_id,a.emi_id)=(e.user_id,e.id) where e.user_id=old.user_id and e.loan_id=old.id) then raise exception 'Repayment account has allocated payments'; end if;
    end if;
  elsif tg_table_name='accounts' and tg_op='UPDATE' then
    if new.kind<>old.kind then
      if exists(select 1 from public.transactions where user_id=old.user_id and (from_account_id=old.id or to_account_id=old.id)) or exists(select 1 from public.bills where user_id=old.user_id and account_id=old.id) then raise exception 'Account kind with ledger history cannot change'; end if;
    end if;
  end if;
  return new;
end $$;

create function private.validate_share() returns trigger language plpgsql security invoker set search_path = '' as $$
declare total numeric; assigned numeric;
begin
  if tg_table_name='expense_shares' then
    select total_cost into total from public.expense_groups where user_id=new.user_id and id=new.group_id for update;
    select coalesce(sum(amount),0) into assigned from public.expense_shares where user_id=new.user_id and group_id=new.group_id and id<>new.id;
    if assigned+new.amount>total then raise exception 'Shares exceed group cost'; end if;
  else
    select coalesce(sum(amount),0) into assigned from public.expense_shares where user_id=new.user_id and group_id=new.id;
    if assigned>new.total_cost then raise exception 'Group cost cannot be below assigned shares'; end if;
  end if;
  return new;
end $$;

-- All clients, including direct Data API callers, get the same invariants.
do $$ declare tbl text; cols text; begin
  foreach tbl in array array['profiles','categories','accounts','account_snapshots','documents','import_batches','transactions','bills','bill_payment_allocations','fixed_deposits','loans','emis','emi_payment_allocations','personal_loans','personal_loan_allocations','expense_groups','expense_shares','settlements','import_candidates','source_mappings','reminders','audit_events'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from anon, authenticated',tbl);
    execute format('grant select on public.%I to authenticated',tbl);
    execute format('create policy owned_select on public.%I for select to authenticated using ((select auth.uid())=user_id)',tbl);
    if tbl<>'audit_events' then
      execute format('grant insert, update on public.%I to authenticated',tbl);
      execute format('create policy owned_insert on public.%I for insert to authenticated with check ((select auth.uid())=user_id)',tbl);
      execute format('create policy owned_update on public.%I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',tbl);
      execute format('create trigger audit_mutation after insert or update or delete on public.%I for each row execute function private.audit_change()',tbl);
    end if;
    if tbl in ('bill_payment_allocations','emi_payment_allocations','personal_loan_allocations','settlements','expense_shares') then
      execute format('grant delete on public.%I to authenticated',tbl);
      execute format('create policy owned_delete on public.%I for delete to authenticated using ((select auth.uid())=user_id)',tbl);
    end if;
    -- Decimal serialization happens in Postgres before JSON. Views use caller RLS.
    select string_agg(case when data_type='numeric' then format('%I::text as %I',column_name,column_name) else format('%I',column_name) end,',' order by ordinal_position)
      into cols from information_schema.columns where table_schema='public' and table_name=tbl;
    execute format('create view public.api_%I with (security_invoker=true) as select %s from public.%I',tbl,cols,tbl);
    execute format('revoke all on public.api_%I from anon, authenticated',tbl);
    execute format('grant select on public.api_%I to authenticated',tbl);
  end loop;
  foreach tbl in array array['bill_payment_allocations','emi_payment_allocations','personal_loan_allocations','settlements'] loop
    execute format('create trigger validate_allocation before insert or update on public.%I for each row execute function private.validate_allocation()',tbl);
  end loop;
  foreach tbl in array array['accounts','transactions','bills','emis','loans'] loop
    execute format('create trigger protect_financial_links before insert or update on public.%I for each row execute function private.protect_financial_links()',tbl);
  end loop;
end $$;
create trigger validate_share before insert or update on public.expense_shares for each row execute function private.validate_share();
create trigger protect_group_cost before update on public.expense_groups for each row execute function private.validate_share();

create function private.validate_source_mapping() returns trigger language plpgsql security invoker set search_path='' as $$
declare found_id uuid;
begin
  if new.entity_type not in ('accounts','transactions','bills','loans','emis','fixed_deposits','personal_loans','expense_groups','documents') then raise exception 'Unsupported source mapping entity'; end if;
  execute format('select id from public.%I where user_id=$1 and id=$2',new.entity_type) into found_id using new.user_id,new.local_record_id;
  if found_id is null then raise exception 'Source mapping target is not owned by this user'; end if;
  return new;
end $$;
create trigger validate_source_mapping before insert or update on public.source_mappings for each row execute function private.validate_source_mapping();

create function private.validate_financial_record() returns trigger language plpgsql security invoker set search_path='' as $$
declare linked public.transactions%rowtype; account_kind text;
begin
  if tg_table_name='transactions' then
    if new.refund_of_transaction_id is not null then
      select * into linked from public.transactions where user_id=new.user_id and id=new.refund_of_transaction_id for update;
      if not found or linked.status<>'posted' or linked.kind not in ('expense','transfer') or new.kind<>'refund' then raise exception 'Refund must link to an owned posted expense or returned transfer'; end if;
    end if;
    if tg_op='UPDATE' then
      if exists(select 1 from public.transactions where user_id=old.user_id and refund_of_transaction_id=old.id) and (new.status<>'posted' or new.kind not in ('expense','transfer')) then raise exception 'Transaction has linked refunds'; end if;
      if exists(select 1 from public.expense_groups where user_id=old.user_id and transaction_id=old.id and (new.status<>'posted' or new.kind<>'expense' or new.occurred_on is null or total_cost>new.amount)) then raise exception 'Transaction change conflicts with a linked group expense'; end if;
    end if;
  elsif tg_table_name='expense_groups' then
    if new.transaction_id is not null then
      select * into linked from public.transactions where user_id=new.user_id and id=new.transaction_id for update;
      if not found or linked.kind<>'expense' or linked.status<>'posted' or linked.occurred_on is null or new.total_cost>linked.amount then raise exception 'Group must link to a posted expense covering its total cost'; end if;
    end if;
  elsif tg_table_name='loans' then
    if new.repayment_account_id is not null then
      select kind into account_kind from public.accounts where user_id=new.user_id and id=new.repayment_account_id;
      if account_kind is null or account_kind not in ('bank','wallet') then raise exception 'Loan repayment account must be a bank or wallet'; end if;
    end if;
  elsif tg_table_name='fixed_deposits' then
    if new.backing_account_id is not null then
      select kind into account_kind from public.accounts where user_id=new.user_id and id=new.backing_account_id;
      if account_kind is null or account_kind<>'credit_card' then raise exception 'Deposit backing account must be a credit card'; end if;
    end if;
    if new.payout_account_id is not null then
      select kind into account_kind from public.accounts where user_id=new.user_id and id=new.payout_account_id;
      if account_kind is null or account_kind not in ('bank','wallet') then raise exception 'Deposit payout account must be a bank or wallet'; end if;
    end if;
  elsif tg_table_name='accounts' and tg_op='UPDATE' then
    if new.kind<>old.kind and (exists(select 1 from public.loans where user_id=old.user_id and repayment_account_id=old.id) or exists(select 1 from public.fixed_deposits where user_id=old.user_id and (backing_account_id=old.id or payout_account_id=old.id))) then raise exception 'Account kind is used by a loan or deposit'; end if;
  end if;
  return new;
end $$;
do $$ declare tbl text; begin
  foreach tbl in array array['transactions','expense_groups','loans','fixed_deposits','accounts'] loop
    execute format('create trigger validate_financial_record before insert or update on public.%I for each row execute function private.validate_financial_record()',tbl);
  end loop;
end $$;

create index transactions_by_date on public.transactions(user_id,occurred_on desc);
create index transactions_by_from on public.transactions(user_id,from_account_id);
create index transactions_by_to on public.transactions(user_id,to_account_id);
create index snapshots_by_account on public.account_snapshots(user_id,account_id,as_of desc);
create index bills_by_due on public.bills(user_id,due_date);
create index emis_by_due on public.emis(user_id,due_date);
create index audit_by_time on public.audit_events(user_id,occurred_at desc);

create function public.allocate_bill_payment(p_id uuid,p_bill_id uuid,p_transaction_id uuid,p_amount numeric,p_verified boolean default false)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.bill_payment_allocations(id,user_id,bill_id,transaction_id,amount,verified)
  values(p_id,auth.uid(),p_bill_id,p_transaction_id,p_amount,p_verified)
  on conflict(id) do update set amount=excluded.amount,verified=excluded.verified
  where bill_payment_allocations.user_id=auth.uid() and bill_payment_allocations.bill_id=p_bill_id and bill_payment_allocations.transaction_id=p_transaction_id;
  if not found then raise exception 'Allocation does not belong to this payment'; end if;
  return p_id;
end $$;
create function public.allocate_emi_payment(p_id uuid,p_emi_id uuid,p_transaction_id uuid,p_amount numeric)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.emi_payment_allocations(id,user_id,emi_id,transaction_id,amount)
  values(p_id,auth.uid(),p_emi_id,p_transaction_id,p_amount)
  on conflict(id) do update set amount=excluded.amount
  where emi_payment_allocations.user_id=auth.uid() and emi_payment_allocations.emi_id=p_emi_id and emi_payment_allocations.transaction_id=p_transaction_id;
  if not found then raise exception 'Allocation does not belong to this payment'; end if;
  return p_id;
end $$;
revoke all on function public.allocate_bill_payment(uuid,uuid,uuid,numeric,boolean) from public,anon;
revoke all on function public.allocate_emi_payment(uuid,uuid,uuid,numeric) from public,anon;
grant execute on function public.allocate_bill_payment(uuid,uuid,uuid,numeric,boolean) to authenticated;
grant execute on function public.allocate_emi_payment(uuid,uuid,uuid,numeric) to authenticated;

-- Commit an entire reviewed CSV atomically. File hashes make retries idempotent.
create function public.commit_reviewed_import(p_input_hash text,p_file_name text,p_transactions jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare batch public.import_batches%rowtype; item jsonb; inserted_count integer:=0; txn_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_input_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_transactions)<>'array' or jsonb_array_length(p_transactions)>1000 then raise exception 'Invalid reviewed import'; end if;
  insert into public.import_batches(user_id,source,input_hash,file_name,state) values(auth.uid(),'csv',p_input_hash,p_file_name,'review') on conflict(user_id,source,input_hash) do nothing;
  select * into batch from public.import_batches where user_id=auth.uid() and source='csv' and input_hash=p_input_hash for update;
  if batch.state not in ('review','committed') then raise exception 'Import batch cannot be committed'; end if;
  for item in select value from jsonb_array_elements(p_transactions) loop
    txn_id := coalesce((item->>'id')::uuid,gen_random_uuid());
    insert into public.transactions(id,user_id,amount,currency,kind,status,occurred_on,description,from_account_id,to_account_id,category,subcategory,merchant,external_payer,external_reference,source_system,source_object_id,receipt_document_id,refund_of_transaction_id,import_batch_id,notes)
    values(txn_id,auth.uid(),(item->>'amount')::numeric,coalesce(item->>'currency','INR'),item->>'kind',item->>'status',(item->>'occurredOn')::date,item->>'description',(item->>'fromAccountId')::uuid,(item->>'toAccountId')::uuid,item->>'category',item->>'subcategory',item->>'merchant',item->>'externalPayer',item->>'externalReference','csv',item->>'sourceObjectId',(item->>'receiptDocumentId')::uuid,(item->>'refundOfTransactionId')::uuid,batch.id,item->>'notes')
    on conflict(user_id,source_system,source_object_id) where source_object_id is not null do nothing;
    if not found then continue; end if;
    insert into public.import_candidates(user_id,import_batch_id,parsed_values,matched_transaction_id,confidence,decision) values(auth.uid(),batch.id,item,txn_id,1,'accept');
    if nullif(item->>'sourceObjectId','') is not null then
      insert into public.source_mappings(user_id,source_system,source_object_id,entity_type,local_record_id,import_batch_id) values(auth.uid(),'csv',item->>'sourceObjectId','transactions',txn_id,batch.id);
    end if;
    inserted_count := inserted_count+1;
  end loop;
  if inserted_count>0 or batch.state='review' then
    update public.import_batches set state='committed',approved_at=coalesce(approved_at,now()) where id=batch.id and user_id=auth.uid();
  end if;
  return jsonb_build_object('batchId',batch.id,'alreadyCommitted',inserted_count=0,'count',inserted_count);
end $$;
revoke all on function public.commit_reviewed_import(text,text,jsonb) from public,anon;
grant execute on function public.commit_reviewed_import(text,text,jsonb) to authenticated;

-- Bucket remains private. Object names begin with the authenticated owner's UUID.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('finance-documents','finance-documents',false,10485760,array['application/pdf','text/csv','image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
create policy finance_documents_select on storage.objects for select to authenticated
using(bucket_id='finance-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy finance_documents_insert on storage.objects for insert to authenticated
with check(bucket_id='finance-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy finance_documents_update on storage.objects for update to authenticated
using(bucket_id='finance-documents' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check(bucket_id='finance-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy finance_documents_delete on storage.objects for delete to authenticated
using(bucket_id='finance-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
