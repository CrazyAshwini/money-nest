-- Optional, explicit confirmation that a same-day asset movement happened
-- after this exact balance report. Existing rows remain unclassified.
alter table public.transactions
  add column from_balance_snapshot_id uuid references public.account_snapshots(id) on delete set null,
  add column to_balance_snapshot_id uuid references public.account_snapshots(id) on delete set null;

create index transactions_from_balance_snapshot on public.transactions(from_balance_snapshot_id)
  where from_balance_snapshot_id is not null;
create index transactions_to_balance_snapshot on public.transactions(to_balance_snapshot_id)
  where to_balance_snapshot_id is not null;

create function private.validate_transaction_balance_snapshot() returns trigger
language plpgsql security invoker set search_path='' as $$
declare anchor_side text; anchor_snapshot_id uuid; anchor_account_id uuid;
begin
  for anchor_side,anchor_snapshot_id,anchor_account_id in select * from (values
    ('from',new.from_balance_snapshot_id,new.from_account_id),
    ('to',new.to_balance_snapshot_id,new.to_account_id)
  ) anchors(side,snapshot_id,account_id) loop
    -- FK deletion can clear the two sides in separate internal updates. An
    -- unchanged side remains valid through the report update guard and FK.
    if tg_op='UPDATE' and (new.user_id,new.occurred_on) is not distinct from (old.user_id,old.occurred_on) then
      if anchor_side='from' and (new.from_balance_snapshot_id,new.from_account_id) is not distinct from (old.from_balance_snapshot_id,old.from_account_id)
        then continue; end if;
      if anchor_side='to' and (new.to_balance_snapshot_id,new.to_account_id) is not distinct from (old.to_balance_snapshot_id,old.to_account_id)
        then continue; end if;
    end if;
    if anchor_snapshot_id is not null and not exists (
      select 1 from public.account_snapshots s
      join public.accounts a on (a.user_id,a.id)=(s.user_id,s.account_id)
      where s.id=anchor_snapshot_id and s.user_id=new.user_id and s.account_id=anchor_account_id
        and a.kind in ('bank','wallet') and s.reported_balance is not null
        and new.occurred_on=(s.as_of at time zone 'Asia/Kolkata')::date
    ) then
      raise exception 'Balance confirmation requires an owned asset balance report for the same account and date'
        using errcode='23514';
    end if;
  end loop;
  return new;
end $$;
create trigger validate_transaction_balance_snapshot before insert or update on public.transactions
for each row execute function private.validate_transaction_balance_snapshot();

-- A referenced report can be corrected without changing its identity, but must
-- continue to describe the same account and calendar date while it is linked.
create function private.protect_transaction_balance_snapshot() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists (
    select 1 from public.transactions t
    where (t.from_balance_snapshot_id=old.id and (
      t.user_id is distinct from new.user_id or t.from_account_id is distinct from new.account_id
      or new.reported_balance is null or t.occurred_on is distinct from (new.as_of at time zone 'Asia/Kolkata')::date
    )) or (t.to_balance_snapshot_id=old.id and (
      t.user_id is distinct from new.user_id or t.to_account_id is distinct from new.account_id
      or new.reported_balance is null or t.occurred_on is distinct from (new.as_of at time zone 'Asia/Kolkata')::date
    ))
  ) then
    raise exception 'Remove transaction balance confirmations before changing this report account or date'
      using errcode='23514';
  end if;
  return new;
end $$;
create trigger protect_transaction_balance_snapshot before update on public.account_snapshots
for each row execute function private.protect_transaction_balance_snapshot();

-- Keep every existing column in place, append the references, and retain the
-- caller's ownership policies and exact decimal strings.
create or replace view public.api_transactions with (security_invoker=true) as
select id,user_id,amount::text as amount,currency,kind,status,occurred_on,
  description,from_account_id,to_account_id,category,category_id,subcategory,
  merchant,external_payer,external_reference,source_system,source_object_id,
  receipt_document_id,refund_of_transaction_id,import_batch_id,notes,created_at,
  updated_at,platform,from_balance_snapshot_id,to_balance_snapshot_id
from public.transactions;
revoke all on public.api_transactions from anon, authenticated;
grant select on public.api_transactions to authenticated;

-- Reviewed imports persist explicit confirmations with the imported movement.
create or replace function public.commit_reviewed_import(p_input_hash text,p_file_name text,p_transactions jsonb)
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
    insert into public.transactions(id,user_id,amount,currency,kind,status,occurred_on,description,from_account_id,to_account_id,category,subcategory,merchant,external_payer,external_reference,source_system,source_object_id,receipt_document_id,refund_of_transaction_id,import_batch_id,notes,platform,from_balance_snapshot_id,to_balance_snapshot_id)
    values(txn_id,auth.uid(),(item->>'amount')::numeric,coalesce(item->>'currency','INR'),item->>'kind',item->>'status',(item->>'occurredOn')::date,item->>'description',(item->>'fromAccountId')::uuid,(item->>'toAccountId')::uuid,item->>'category',item->>'subcategory',item->>'merchant',item->>'externalPayer',item->>'externalReference','csv',item->>'sourceObjectId',(item->>'receiptDocumentId')::uuid,(item->>'refundOfTransactionId')::uuid,batch.id,item->>'notes',item->>'platform',(item->>'fromBalanceSnapshotId')::uuid,(item->>'toBalanceSnapshotId')::uuid)
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

-- Commerce updates preserve omitted confirmations; an explicit null removes one.
create or replace function public.commit_finance_commerce(p_expected_revision bigint,p_transactions jsonb,p_commerce jsonb) returns jsonb
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
    insert into public.transactions(id,user_id,amount,currency,kind,status,occurred_on,description,from_account_id,to_account_id,category,subcategory,platform,merchant,external_payer,external_reference,source_system,source_object_id,receipt_document_id,refund_of_transaction_id,notes,from_balance_snapshot_id,to_balance_snapshot_id)
    values((item->>'id')::uuid,owner_id,(item->>'amount')::numeric,item->>'currency',item->>'kind',item->>'status',(item->>'occurred_on')::date,item->>'description',(item->>'from_account_id')::uuid,(item->>'to_account_id')::uuid,item->>'category',item->>'subcategory',item->>'platform',item->>'merchant',item->>'external_payer',item->>'external_reference',item->>'source_system',item->>'source_object_id',(item->>'receipt_document_id')::uuid,(item->>'refund_of_transaction_id')::uuid,item->>'notes',(item->>'from_balance_snapshot_id')::uuid,(item->>'to_balance_snapshot_id')::uuid)
    on conflict(id) do update set amount=excluded.amount,currency=excluded.currency,kind=excluded.kind,status=excluded.status,occurred_on=excluded.occurred_on,
      description=excluded.description,from_account_id=excluded.from_account_id,to_account_id=excluded.to_account_id,category=excluded.category,subcategory=excluded.subcategory,
      platform=excluded.platform,merchant=excluded.merchant,external_payer=excluded.external_payer,external_reference=excluded.external_reference,
      source_system=excluded.source_system,source_object_id=excluded.source_object_id,receipt_document_id=excluded.receipt_document_id,
      refund_of_transaction_id=excluded.refund_of_transaction_id,notes=excluded.notes,
      from_balance_snapshot_id=case when item ? 'from_balance_snapshot_id' then excluded.from_balance_snapshot_id else public.transactions.from_balance_snapshot_id end,
      to_balance_snapshot_id=case when item ? 'to_balance_snapshot_id' then excluded.to_balance_snapshot_id else public.transactions.to_balance_snapshot_id end;
  end loop;
  insert into public.commerce_state(user_id,data) values(owner_id,p_commerce)
    on conflict(user_id) do update set data=excluded.data;
  return jsonb_build_object('saved',true);
end $$;
revoke all on function public.commit_finance_commerce(bigint,jsonb,jsonb) from public,anon;
grant execute on function public.commit_finance_commerce(bigint,jsonb,jsonb) to authenticated;


-- Profile transfers must create referenced snapshots before transactions. The
-- generic bootstrap and handoff RPCs already use this dependency order and
-- include the new fields through their existing column validation.
-- Additive profile transfer for a signed-in owner. Rows already in cloud are
-- never updated; this function inserts the validated missing delta atomically.
create or replace function public.merge_private_profile_cloud(
  p_workspace jsonb,
  p_commerce jsonb,
  p_expected_revision bigint
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  current_revision bigint;
  collection text;
  tbl text;
  item jsonb;
  db_item jsonb;
  columns_sql text;
  values_sql text;
  existing_owner uuid;
  inserted_count integer;
  affected_count integer;
  total_added integer := 0;
  counts jsonb := '{}'::jsonb;
  current_commerce jsonb;
  audit_count integer := 0;
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_revision is null
    or jsonb_typeof(p_workspace) is distinct from 'object'
    or jsonb_typeof(p_commerce) is distinct from 'object'
    or jsonb_typeof(p_commerce->'orders') is distinct from 'array'
    or jsonb_typeof(p_commerce->'refunds') is distinct from 'array'
    or jsonb_typeof(p_commerce->'operations') is distinct from 'array'
    or jsonb_typeof(p_workspace->'auditEvents') is distinct from 'array'
  then
    raise exception 'Invalid private profile merge';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 719260));
  select revision into current_revision
    from public.workspace_revisions where user_id = owner_id for update;
  if coalesce(current_revision, 0) <> p_expected_revision then
    raise exception 'Workspace changed. Review again.' using errcode = '40001';
  end if;

  for collection, tbl in select * from (values
    ('accounts','accounts'),
    ('fixedDeposits','fixed_deposits'),
    ('loans','loans'),
    ('emis','emis'),
    ('snapshots','account_snapshots'),
    ('transactions','transactions'),
    ('bills','bills'),
    ('allocations','bill_payment_allocations'),
    ('emiAllocations','emi_payment_allocations'),
    ('groups','expense_groups'),
    ('shares','expense_shares'),
    ('settlements','settlements'),
    ('reminders','reminders')
  ) m(c,t) loop
    if jsonb_typeof(p_workspace->collection) is distinct from 'array'
      or jsonb_array_length(p_workspace->collection) > 10000 then
      raise exception 'Invalid workspace collection';
    end if;
    inserted_count := 0;
    for item in
      select value from jsonb_array_elements(p_workspace->collection)
      order by (value->>'refundOfTransactionId' is not null)
    loop
      if item->>'userId' is distinct from owner_id::text
        or (item->>'id')::uuid is null then
        raise exception 'Import ownership does not match your session' using errcode = '42501';
      end if;
      execute format('select user_id from public.%I where id = $1', tbl)
        into existing_owner using (item->>'id')::uuid;
      if existing_owner is not null and existing_owner <> owner_id then
        raise exception 'Record belongs to another owner' using errcode = '42501';
      end if;
      select jsonb_object_agg(
        lower(regexp_replace(k, '([A-Z])', '_\1', 'g')), v
      ) into db_item from jsonb_each(item) e(k,v);
      if exists (
        select 1 from jsonb_object_keys(db_item) k where not exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = tbl and column_name = k
        )
      ) then
        raise exception 'Unsupported workspace import field';
      end if;
      select string_agg(format('%I', k), ',' order by k),
        string_agg(format('r.%I', k), ',' order by k)
        into columns_sql, values_sql from jsonb_object_keys(db_item) k;
      execute format(
        'insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) r on conflict do nothing',
        tbl, columns_sql, values_sql, tbl
      ) using db_item;
      get diagnostics affected_count = row_count;
      inserted_count := inserted_count + affected_count;
    end loop;
    counts := counts || jsonb_build_object(collection, inserted_count);
    total_added := total_added + inserted_count;
  end loop;

  if jsonb_array_length(p_workspace->'auditEvents') > 10000 then
    raise exception 'Invalid historical audit collection';
  end if;
  for item in select value from jsonb_array_elements(p_workspace->'auditEvents') loop
    if item->>'userId' is distinct from owner_id::text then
      raise exception 'Import ownership does not match your session' using errcode = '42501';
    end if;
  end loop;
  if not exists (select 1 from public.legacy_finance_audit_state where user_id = owner_id)
    and jsonb_array_length(p_workspace->'auditEvents') > 0 then
    insert into public.legacy_finance_audit_state(user_id, data)
      values(owner_id, p_workspace->'auditEvents');
    audit_count := jsonb_array_length(p_workspace->'auditEvents');
  end if;
  counts := counts || jsonb_build_object('auditEvents', audit_count);
  total_added := total_added + audit_count;

  select data into current_commerce from public.commerce_state where user_id = owner_id;
  if current_commerce is null then
    if p_commerce <> '{"orders":[],"refunds":[],"operations":[]}'::jsonb then
      insert into public.commerce_state(user_id, data) values(owner_id, p_commerce);
    end if;
  elsif current_commerce is distinct from p_commerce then
    update public.commerce_state set data = p_commerce where user_id = owner_id;
  end if;

  return jsonb_build_object('ok', true, 'counts', counts, 'totalAdded', total_added);
end $$;
revoke all on function public.merge_private_profile_cloud(jsonb,jsonb,bigint) from public, anon;
grant execute on function public.merge_private_profile_cloud(jsonb,jsonb,bigint) to authenticated;
