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
    ('transactions','transactions'),
    ('snapshots','account_snapshots'),
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
