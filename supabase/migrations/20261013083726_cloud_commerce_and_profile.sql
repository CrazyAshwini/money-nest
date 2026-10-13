-- Cloud parity keeps the existing decimal-safe normalized ledger. Order/refund
-- changes commit alongside their ledger entries, under one owner revision lock.
alter table public.profiles add column display_name text check(length(display_name)<=80);
alter table public.expense_groups add column kind text not null default 'expense'
  check(kind in ('expense','contribution_pool'));
create or replace view public.api_profiles with (security_invoker=true) as
select user_id,currency,timezone,preferences,created_at,updated_at,display_name from public.profiles;
create or replace view public.api_expense_groups with (security_invoker=true) as
select id,user_id,title,occurred_on,merchant,total_cost::text as total_cost,paid_by,transaction_id,notes,created_at,updated_at,kind from public.expense_groups;
revoke all on public.api_profiles,public.api_expense_groups from anon,authenticated;
grant select on public.api_profiles,public.api_expense_groups to authenticated;

create table public.workspace_revisions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check(revision>=0)
);
create table public.commerce_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"orders":[],"refunds":[],"operations":[]}',
  updated_at timestamptz not null default now()
);
-- Historical local audits are immutable after the initial owner import. The
-- normalized audit_events table remains append-only and server-generated.
create table public.legacy_finance_audit_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check(jsonb_typeof(data)='array'),
  import_key text check(import_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
do $$ declare tbl text; begin
  foreach tbl in array array['workspace_revisions','commerce_state','legacy_finance_audit_state'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from public,anon,authenticated',tbl);
    execute format('grant select,insert on public.%I to authenticated',tbl);
    execute format('create policy owned_select on public.%I for select to authenticated using ((select auth.uid())=user_id)',tbl);
    execute format('create policy owned_insert on public.%I for insert to authenticated with check ((select auth.uid())=user_id)',tbl);
    if tbl<>'legacy_finance_audit_state' then
      execute format('grant update on public.%I to authenticated',tbl);
      execute format('create policy owned_update on public.%I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',tbl);
    end if;
  end loop;
end $$;

-- A statement trigger takes the lock before row locks. All core writes, imports,
-- and multi-row allocation RPCs serialize with commerce, including direct APIs.
create function private.lock_cloud_workspace() returns trigger
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
  if owner_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,719260));
    insert into public.workspace_revisions(user_id,revision) values(owner_id,1)
      on conflict(user_id) do update set revision=public.workspace_revisions.revision+1;
  end if;
  return null;
end $$;
do $$ declare tbl text; begin
  foreach tbl in array array['accounts','account_snapshots','transactions','bills','bill_payment_allocations','fixed_deposits','loans','emis','emi_payment_allocations','expense_groups','expense_shares','settlements','reminders','commerce_state','legacy_finance_audit_state'] loop
    execute format('create trigger lock_cloud_workspace before insert or update or delete on public.%I for each statement execute function private.lock_cloud_workspace()',tbl);
  end loop;
end $$;

create function private.protect_commerce_transaction() returns trigger
language plpgsql security invoker set search_path='' as $$
declare state jsonb; linked boolean;
begin
  select data into state from public.commerce_state where user_id=old.user_id;
  if state is null then return new; end if;
  select exists(
    select 1 from jsonb_array_elements(state->'orders') o,
      lateral jsonb_array_elements(o->'payments') p where p->>'transactionId'=old.id::text
    union all
    select 1 from jsonb_array_elements(state->'refunds') r where r->>'originalTransactionId'=old.id::text
    union all
    select 1 from jsonb_array_elements(state->'refunds') r,
      lateral jsonb_array_elements(r->'creditMatches') c where c->>'transactionId'=old.id::text
  ) into linked;
  if linked and (new.amount,new.currency,new.kind,new.status,new.occurred_on,new.from_account_id,new.to_account_id,new.refund_of_transaction_id)
    is distinct from (old.amount,old.currency,old.kind,old.status,old.occurred_on,old.from_account_id,old.to_account_id,old.refund_of_transaction_id) then
    raise exception 'This transaction is linked to an order or refund. Review its financial changes from Orders.';
  end if;
  return new;
end $$;
create trigger protect_commerce_transaction before update on public.transactions
for each row execute function private.protect_commerce_transaction();

-- Database-side ownership and financial checks also apply to direct Data API
-- callers. App-side Zod validates the complete descriptive schema before writes.
create function private.validate_commerce_state() returns trigger
language plpgsql security invoker set search_path='' as $$
declare order_row jsonb; refund_row jsonb; payment jsonb; credit jsonb; txn public.transactions%rowtype;
  original public.transactions%rowtype; total numeric; previous jsonb; next_row jsonb;
begin
  if jsonb_typeof(new.data)<>'object' or jsonb_typeof(new.data->'orders') is distinct from 'array'
    or jsonb_typeof(new.data->'refunds') is distinct from 'array' or jsonb_typeof(new.data->'operations') is distinct from 'array'
    or jsonb_array_length(new.data->'orders')>10000 or jsonb_array_length(new.data->'refunds')>10000
    or jsonb_array_length(new.data->'operations')>20000 then raise exception 'Invalid cloud order state'; end if;
  for order_row in select value from jsonb_array_elements(new.data->'orders') loop
    if order_row->>'userId' is distinct from new.user_id::text or (order_row->>'id')::uuid is null
      or jsonb_typeof(order_row->'payments') is distinct from 'array' or jsonb_array_length(order_row->'payments')>40
      or order_row->>'reviewStatus' not in ('history','pending','saved') then raise exception 'Invalid cloud order ownership'; end if;
    for payment in select value from jsonb_array_elements(order_row->'payments') loop
      select * into txn from public.transactions where user_id=new.user_id and id=(payment->>'transactionId')::uuid;
      if txn.id is null or txn.kind<>'expense' or txn.status='voided' or txn.amount<>(payment->>'amount')::numeric
        or txn.currency is distinct from order_row->>'currency' or (payment->>'amount')::numeric<=0
        or (order_row->>'reviewStatus'='saved' and txn.status<>'posted') then raise exception 'Order payment must match its owned purchase'; end if;
    end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements(new.data->'orders') o,lateral jsonb_array_elements(o->'payments') p
    group by p->>'transactionId' having count(*)>1) then raise exception 'Order payment is already linked'; end if;
  for refund_row in select value from jsonb_array_elements(new.data->'refunds') loop
    if refund_row->>'userId' is distinct from new.user_id::text or (refund_row->>'id')::uuid is null
      or jsonb_typeof(refund_row->'creditMatches') is distinct from 'array' or jsonb_array_length(refund_row->'creditMatches')>100
      or (refund_row->>'expectedAmount')::numeric<=0 then raise exception 'Invalid cloud refund ownership'; end if;
    if nullif(refund_row->>'orderId','') is not null and not exists(
      select 1 from jsonb_array_elements(new.data->'orders') o where o->>'id'=refund_row->>'orderId') then raise exception 'Refund order was not found'; end if;
    if nullif(refund_row->>'destinationAccountId','') is not null and not exists(
      select 1 from public.accounts where user_id=new.user_id and id=(refund_row->>'destinationAccountId')::uuid) then raise exception 'Refund destination is not owned'; end if;
    original:=null;
    if nullif(refund_row->>'originalTransactionId','') is not null then
      select * into original from public.transactions where user_id=new.user_id and id=(refund_row->>'originalTransactionId')::uuid;
      if original.id is null or original.kind<>'expense' or original.status<>'posted'
        or original.amount<(refund_row->>'expectedAmount')::numeric then raise exception 'Refund original purchase is invalid'; end if;
    end if;
    total:=0;
    for credit in select value from jsonb_array_elements(refund_row->'creditMatches') loop
      select * into txn from public.transactions where user_id=new.user_id and id=(credit->>'transactionId')::uuid;
      if original.id is null or txn.id is null or txn.status<>'posted' or txn.kind<>'refund'
        or txn.to_account_id is null or txn.from_account_id is not null
        or txn.refund_of_transaction_id is distinct from original.id or txn.occurred_on<original.occurred_on
        or txn.amount<>(credit->>'amount')::numeric or (credit->>'amount')::numeric<=0
        or (refund_row->>'destinationAccountId')::uuid is distinct from txn.to_account_id then raise exception 'Refund credit must match its owned ledger credit'; end if;
      total:=total+(credit->>'amount')::numeric;
    end loop;
    if total>(refund_row->>'expectedAmount')::numeric then raise exception 'Refund credits exceed its expected amount'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(new.data->'refunds') r,lateral jsonb_array_elements(r->'creditMatches') c
    group by c->>'transactionId' having count(*)>1) then raise exception 'Refund credit is already used'; end if;
  if exists(select 1 from jsonb_array_elements(new.data->'refunds') r
    join public.transactions t on t.user_id=new.user_id and t.id=(r->>'originalTransactionId')::uuid
    where r->>'status' not in ('rejected','store_credit')
    group by t.id,t.amount having sum((r->>'expectedAmount')::numeric)>t.amount) then raise exception 'Refund expectations exceed original purchase'; end if;
  if tg_op='UPDATE' then
    -- Confirmed money cannot be unlinked or rewritten via a JSON update.
    for previous in select value from jsonb_array_elements(old.data->'orders') loop
      for payment in select value from jsonb_array_elements(previous->'payments') loop
        select * into txn from public.transactions where user_id=new.user_id and id=(payment->>'transactionId')::uuid;
        if txn.status='posted' and not exists(select 1 from jsonb_array_elements(new.data->'orders') o,
          lateral jsonb_array_elements(o->'payments') p where o->>'id'=previous->>'id' and p=payment) then raise exception 'Confirmed order payment cannot be unlinked'; end if;
      end loop;
    end loop;
    for previous in select value from jsonb_array_elements(old.data->'refunds') loop
      if jsonb_array_length(previous->'creditMatches')>0 then
        select value into next_row from jsonb_array_elements(new.data->'refunds') where value->>'id'=previous->>'id';
        if next_row is null or (next_row->>'originalTransactionId',next_row->>'orderId',next_row->>'destinationAccountId',next_row->>'route')
          is distinct from (previous->>'originalTransactionId',previous->>'orderId',previous->>'destinationAccountId',previous->>'route')
          or not ((next_row->'creditMatches') @> (previous->'creditMatches')) then raise exception 'Confirmed refund links cannot be removed'; end if;
      end if;
    end loop;
    if not ((new.data->'operations') @> (old.data->'operations')) then raise exception 'Completed order operation cannot be removed'; end if;
  end if;
  new.updated_at:=now();
  return new;
end $$;
create trigger validate_commerce_state before insert or update on public.commerce_state
for each row execute function private.validate_commerce_state();
create trigger audit_mutation after insert or update on public.commerce_state
for each row execute function private.audit_change();

create function public.read_finance_cloud_state() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); workspace jsonb:='{}'; collection text; tbl text; rows jsonb;
  state jsonb; version bigint; legacy jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,719260));
  select revision into version from public.workspace_revisions where user_id=owner_id;
  for collection,tbl in select * from (values
    ('accounts','accounts'),('snapshots','account_snapshots'),('transactions','transactions'),('bills','bills'),
    ('allocations','bill_payment_allocations'),('fixedDeposits','fixed_deposits'),('loans','loans'),('emis','emis'),
    ('emiAllocations','emi_payment_allocations'),('groups','expense_groups'),('shares','expense_shares'),
    ('settlements','settlements'),('reminders','reminders'),('auditEvents','audit_events')) m(c,t) loop
    execute format('select coalesce(jsonb_agg((select jsonb_object_agg((select split_part(k,''_'',1)||coalesce(string_agg(upper(left(part,1))||substring(part from 2),'''' order by n),'''') from unnest(string_to_array(k,''_'')) with ordinality s(part,n) where n>1),v) from jsonb_each(to_jsonb(r)) e(k,v)) order by id),''[]''::jsonb) from public.api_%I r where user_id=$1',tbl)
      into rows using owner_id;
    workspace:=workspace||jsonb_build_object(collection,rows);
  end loop;
  select data into state from public.commerce_state where user_id=owner_id;
  select data into legacy from public.legacy_finance_audit_state where user_id=owner_id;
  workspace:=jsonb_set(workspace,'{auditEvents}',coalesce(legacy,'[]')||(workspace->'auditEvents'));
  return jsonb_build_object('workspace',workspace,'commerce',coalesce(state,'{"orders":[],"refunds":[],"operations":[]}'::jsonb),'revision',coalesce(version,0)::text);
end $$;

create function public.commit_finance_commerce(p_expected_revision bigint,p_transactions jsonb,p_commerce jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); version bigint; item jsonb; state jsonb; pending_ids uuid[];
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_transactions) is distinct from 'array' or jsonb_array_length(p_transactions)>120 then raise exception 'Invalid commerce transaction batch'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,719260));
  select revision into version from public.workspace_revisions where user_id=owner_id;
  if coalesce(version,0)<>p_expected_revision then raise exception 'Workspace changed on another device' using errcode='40001'; end if;
  select array_agg(id) into pending_ids from public.transactions where user_id=owner_id and status='pending_review'
    and id in(select (value->>'id')::uuid from jsonb_array_elements(p_transactions));
  -- Pending purchases can be promoted only inside this atomic operation. Their
  -- temporary unlink is invisible to other transactions and rolls back on error.
  if pending_ids is not null then
    select data into state from public.commerce_state where user_id=owner_id;
    if state is not null then
      state:=jsonb_set(state,'{orders}',(select coalesce(jsonb_agg(jsonb_set(o,'{payments}',
        (select coalesce(jsonb_agg(p),'[]') from jsonb_array_elements(o->'payments') p where not ((p->>'transactionId')::uuid=any(pending_ids))))),'[]') from jsonb_array_elements(state->'orders') o));
      update public.commerce_state set data=state where user_id=owner_id;
    end if;
  end if;
  for item in select value from jsonb_array_elements(p_transactions) loop
    if item->>'user_id' is distinct from owner_id::text then raise exception 'Transaction ownership does not match your session' using errcode='42501'; end if;
    insert into public.transactions(id,user_id,amount,currency,kind,status,occurred_on,description,from_account_id,to_account_id,category,subcategory,platform,merchant,external_payer,external_reference,source_system,source_object_id,receipt_document_id,refund_of_transaction_id,notes)
    values((item->>'id')::uuid,owner_id,(item->>'amount')::numeric,item->>'currency',item->>'kind',item->>'status',(item->>'occurred_on')::date,item->>'description',(item->>'from_account_id')::uuid,(item->>'to_account_id')::uuid,item->>'category',item->>'subcategory',item->>'platform',item->>'merchant',item->>'external_payer',item->>'external_reference',item->>'source_system',item->>'source_object_id',(item->>'receipt_document_id')::uuid,(item->>'refund_of_transaction_id')::uuid,item->>'notes')
    on conflict(id) do update set amount=excluded.amount,currency=excluded.currency,kind=excluded.kind,status=excluded.status,occurred_on=excluded.occurred_on,
      description=excluded.description,from_account_id=excluded.from_account_id,to_account_id=excluded.to_account_id,category=excluded.category,subcategory=excluded.subcategory,
      platform=excluded.platform,merchant=excluded.merchant,external_payer=excluded.external_payer,external_reference=excluded.external_reference,
      source_system=excluded.source_system,source_object_id=excluded.source_object_id,receipt_document_id=excluded.receipt_document_id,
      refund_of_transaction_id=excluded.refund_of_transaction_id,notes=excluded.notes;
  end loop;
  insert into public.commerce_state(user_id,data) values(owner_id,p_commerce)
    on conflict(user_id) do update set data=excluded.data;
  return jsonb_build_object('saved',true);
end $$;
revoke all on function public.read_finance_cloud_state(),public.commit_finance_commerce(bigint,jsonb,jsonb) from public,anon;
grant execute on function public.read_finance_cloud_state(),public.commit_finance_commerce(bigint,jsonb,jsonb) to authenticated;

create function private.validate_legacy_finance_audit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare item jsonb;
begin
  if jsonb_array_length(new.data)>100000 then raise exception 'Too many historical audit events'; end if;
  for item in select value from jsonb_array_elements(new.data) loop
    if item->>'userId' is distinct from new.user_id::text or (item->>'id')::uuid is null
      or nullif(item->>'entityType','') is null or nullif(item->>'entityId','') is null
      or nullif(item->>'action','') is null or (item->>'occurredAt')::timestamptz is null then raise exception 'Invalid historical audit ownership'; end if;
  end loop;
  return new;
end $$;
create trigger validate_legacy_finance_audit before insert on public.legacy_finance_audit_state
for each row execute function private.validate_legacy_finance_audit();

-- A reviewed local export is imported once, never merged over existing cloud
-- finances. This RPC is atomic: all identifiers, decimals and audits survive or
-- the entire import rolls back. Auth secrets and local sessions are not payloads.
create function public.bootstrap_finance_cloud(p_workspace jsonb,p_commerce jsonb,p_import_key text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); collection text; tbl text; item jsonb; db_item jsonb;
  columns_sql text; values_sql text; has_rows boolean; known_key text;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_workspace) is distinct from 'object' or jsonb_typeof(p_commerce) is distinct from 'object'
    or (p_import_key is not null and p_import_key !~ '^[a-f0-9]{64}$') then raise exception 'Invalid reviewed cloud import'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,719260));
  select import_key into known_key from public.legacy_finance_audit_state where user_id=owner_id;
  if known_key is not null and known_key=p_import_key then return jsonb_build_object('imported',true,'alreadyImported',true); end if;
  if exists(select 1 from public.legacy_finance_audit_state where user_id=owner_id)
    or exists(select 1 from public.commerce_state where user_id=owner_id and data<>'{"orders":[],"refunds":[],"operations":[]}'::jsonb) then raise exception 'Cloud workspace already contains financial data'; end if;
  for collection,tbl in select * from (values
    ('accounts','accounts'),('snapshots','account_snapshots'),('transactions','transactions'),('bills','bills'),
    ('fixedDeposits','fixed_deposits'),('loans','loans'),('emis','emis'),('allocations','bill_payment_allocations'),
    ('emiAllocations','emi_payment_allocations'),('groups','expense_groups'),('shares','expense_shares'),
    ('settlements','settlements'),('reminders','reminders')) m(c,t) loop
    execute format('select exists(select 1 from public.%I where user_id=$1)',tbl) into has_rows using owner_id;
    if has_rows then raise exception 'Cloud workspace already contains financial data'; end if;
    if jsonb_typeof(p_workspace->collection) is distinct from 'array' or jsonb_array_length(p_workspace->collection)>100000 then raise exception 'Invalid workspace collection'; end if;
  end loop;
  if jsonb_typeof(p_workspace->'auditEvents') is distinct from 'array' then raise exception 'Historical audits are required'; end if;
  for collection,tbl in select * from (values
    ('accounts','accounts'),('snapshots','account_snapshots'),('transactions','transactions'),('bills','bills'),
    ('fixedDeposits','fixed_deposits'),('loans','loans'),('emis','emis'),('allocations','bill_payment_allocations'),
    ('emiAllocations','emi_payment_allocations'),('groups','expense_groups'),('shares','expense_shares'),
    ('settlements','settlements'),('reminders','reminders')) m(c,t) loop
    for item in select value from jsonb_array_elements(p_workspace->collection)
      order by (value->>'refundOfTransactionId' is not null) loop
      if item->>'userId' is distinct from owner_id::text or (item->>'id')::uuid is null then raise exception 'Import ownership does not match your session' using errcode='42501'; end if;
      select jsonb_object_agg(lower(regexp_replace(k,'([A-Z])','_\1','g')),v) into db_item from jsonb_each(item) e(k,v);
      if exists(select 1 from jsonb_object_keys(db_item) k where not exists(
        select 1 from information_schema.columns where table_schema='public' and table_name=tbl and column_name=k)) then raise exception 'Unsupported workspace import field'; end if;
      select string_agg(format('%I',k),',' order by k),string_agg(format('r.%I',k),',' order by k)
        into columns_sql,values_sql from jsonb_object_keys(db_item) k;
      execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) r',tbl,columns_sql,values_sql,tbl) using db_item;
    end loop;
  end loop;
  insert into public.commerce_state(user_id,data) values(owner_id,p_commerce) on conflict(user_id) do update set data=excluded.data;
  insert into public.legacy_finance_audit_state(user_id,data,import_key) values(owner_id,p_workspace->'auditEvents',p_import_key);
  return jsonb_build_object('imported',true,'alreadyImported',false);
end $$;
revoke all on function public.bootstrap_finance_cloud(jsonb,jsonb,text) from public,anon;
grant execute on function public.bootstrap_finance_cloud(jsonb,jsonb,text) to authenticated;
