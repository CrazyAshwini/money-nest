-- A handoff is staged privately before it touches the ledger. Existing rows
-- keep their IDs; source observations can attach many identities to one row.
alter table public.fixed_deposits alter column opening_date drop not null;
alter table public.fixed_deposits alter column maturity_date drop not null;
alter table public.fixed_deposits alter column pledged drop not null;
alter table public.fixed_deposits add constraint deposit_pledge_link
  check((pledged is null and backing_account_id is null) or (pledged is not null and pledged=(backing_account_id is not null)));

create table public.finance_handoff_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check(jsonb_typeof(manifest)='object'),
  decisions jsonb not null default '[]' check(jsonb_typeof(decisions)='array'),
  preview jsonb not null default '{}' check(jsonb_typeof(preview)='object'),
  expected_revision bigint not null default 0,
  state text not null default 'staged' check(state in ('staged','partial','complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,input_hash), unique(user_id,id)
);
create table public.finance_source_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection text not null,
  record_id uuid not null,
  source_system text not null check(length(source_system) between 1 and 120),
  source_object_id text not null check(length(source_object_id) between 1 and 250),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  confirmation_state text not null check(confirmation_state in ('confirmed','partially_confirmed','needs_confirmation','failed_attempt','rejected')),
  batch_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,source_system,source_object_id),
  foreign key(user_id,batch_id) references public.finance_handoff_batches(user_id,id)
);
create table public.finance_handoff_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  revision bigint not null,
  workspace jsonb not null,
  commerce jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(user_id,batch_id) references public.finance_handoff_batches(user_id,id)
);
do $$ declare tbl text; begin
  foreach tbl in array array['finance_handoff_batches','finance_source_observations','finance_handoff_backups'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from public,anon,authenticated',tbl);
    execute format('grant select,insert on public.%I to authenticated',tbl);
    execute format('create policy owned_select on public.%I for select to authenticated using ((select auth.uid())=user_id)',tbl);
    execute format('create policy owned_insert on public.%I for insert to authenticated with check ((select auth.uid())=user_id)',tbl);
    if tbl<>'finance_handoff_backups' then
      execute format('grant update on public.%I to authenticated',tbl);
      execute format('create policy owned_update on public.%I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',tbl);
      execute format('create trigger audit_mutation after insert or update on public.%I for each row execute function private.audit_change()',tbl);
    end if;
  end loop;
end $$;

create function private.validate_handoff_source() returns trigger
language plpgsql security invoker set search_path='' as $$
declare tbl text; linked boolean;
begin
  if tg_op='UPDATE' and (new.user_id,new.collection,new.record_id,new.source_system,new.source_object_id,new.batch_id)
    is distinct from (old.user_id,old.collection,old.record_id,old.source_system,old.source_object_id,old.batch_id)
    then raise exception 'Source identity and canonical record are immutable'; end if;
  select t into tbl from (values ('accounts','accounts'),('snapshots','account_snapshots'),('transactions','transactions'),
    ('bills','bills'),('fixedDeposits','fixed_deposits'),('loans','loans'),('emis','emis')) m(c,t) where c=new.collection;
  if tbl is null then raise exception 'Unsupported source collection'; end if;
  execute format('select exists(select 1 from public.%I where user_id=$1 and id=$2)',tbl)
    into linked using new.user_id,new.record_id;
  if not linked then raise exception 'Source record is not owned' using errcode='42501'; end if;
  return new;
end $$;
create trigger validate_handoff_source before insert or update on public.finance_source_observations
for each row execute function private.validate_handoff_source();

create function public.merge_finance_handoff(
  p_batch_id uuid, p_expected_revision bigint, p_changes jsonb,
  p_sources jsonb, p_preview jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); version bigint; previous jsonb;
  collection_name text; tbl text; item jsonb; db_item jsonb; existing_owner uuid;
  columns_sql text; values_sql text; updates_sql text; source_row jsonb; linked boolean;
  writes integer:=0;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or jsonb_typeof(p_sources) is distinct from 'array'
    or jsonb_array_length(p_sources)>3000 or jsonb_typeof(p_preview) is distinct from 'object'
    then raise exception 'Invalid handoff merge'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,719260));
  if not exists(select 1 from public.finance_handoff_batches where user_id=owner_id and id=p_batch_id)
    then raise exception 'Handoff not found' using errcode='42501'; end if;
  select revision into version from public.workspace_revisions where user_id=owner_id;
  if coalesce(version,0)<>p_expected_revision then raise exception 'Workspace changed. Review again.' using errcode='40001'; end if;
  if exists(select 1 from jsonb_object_keys(p_changes) key where key not in
    ('accounts','snapshots','transactions','bills','fixedDeposits','loans','emis'))
    then raise exception 'Unsupported handoff collection'; end if;
  if exists(select 1 from jsonb_each(p_changes) e where jsonb_typeof(e.value) is distinct from 'array'
    or jsonb_array_length(e.value)>3000) then raise exception 'Invalid handoff collection'; end if;
  previous:=public.read_finance_cloud_state();
  insert into public.finance_handoff_backups(user_id,batch_id,revision,workspace,commerce)
    values(owner_id,p_batch_id,coalesce(version,0),previous->'workspace',previous->'commerce');
  for collection_name,tbl in select * from (values
    ('accounts','accounts'),('snapshots','account_snapshots'),('transactions','transactions'),
    ('bills','bills'),('fixedDeposits','fixed_deposits'),('loans','loans'),('emis','emis')) m(c,t) loop
    for item in select value from jsonb_array_elements(coalesce(p_changes->collection_name,'[]'))
      order by (value->>'refundOfTransactionId' is not null) loop
      if item->>'userId' is distinct from owner_id::text or (item->>'id')::uuid is null
        then raise exception 'Handoff ownership mismatch' using errcode='42501'; end if;
      execute format('select user_id from public.%I where id=$1',tbl) into existing_owner using (item->>'id')::uuid;
      if existing_owner is not null and existing_owner<>owner_id then raise exception 'Record belongs to another owner' using errcode='42501'; end if;
      select jsonb_object_agg(lower(regexp_replace(k,'([A-Z])','_\1','g')),v)
        into db_item from jsonb_each(item) e(k,v) where k not in ('createdAt','updatedAt');
      if exists(select 1 from jsonb_object_keys(db_item) k where not exists(
        select 1 from information_schema.columns where table_schema='public' and table_name=tbl and column_name=k))
        then raise exception 'Unsupported handoff field'; end if;
      select string_agg(format('%I',k),',' order by k),string_agg(format('r.%I',k),',' order by k),
        string_agg(format('%I=excluded.%I',k,k),',' order by k) filter(where k not in ('id','user_id'))
        into columns_sql,values_sql,updates_sql from jsonb_object_keys(db_item) k;
      execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) r on conflict(id) do update set %s',
        tbl,columns_sql,values_sql,tbl,updates_sql) using db_item;
      writes:=writes+1;
    end loop;
  end loop;
  for source_row in select value from jsonb_array_elements(p_sources) loop
    collection_name:=source_row->>'collection';
    select t into tbl from (values ('accounts','accounts'),('snapshots','account_snapshots'),('transactions','transactions'),
      ('bills','bills'),('fixedDeposits','fixed_deposits'),('loans','loans'),('emis','emis')) m(c,t) where c=collection_name;
    if tbl is null then raise exception 'Unsupported source collection'; end if;
    execute format('select exists(select 1 from public.%I where user_id=$1 and id=$2)',tbl)
      into linked using owner_id,(source_row->>'recordId')::uuid;
    if not linked then raise exception 'Source record is not owned' using errcode='42501'; end if;
    if exists(select 1 from public.finance_source_observations where user_id=owner_id
      and source_system=source_row->>'sourceSystem' and source_object_id=source_row->>'sourceObjectId'
      and (record_id<>(source_row->>'recordId')::uuid or collection<>collection_name))
      then raise exception 'Source identity already belongs to another record'; end if;
    insert into public.finance_source_observations(user_id,collection,record_id,source_system,source_object_id,evidence,confirmation_state,batch_id)
      values(owner_id,collection_name,(source_row->>'recordId')::uuid,source_row->>'sourceSystem',source_row->>'sourceObjectId',
        source_row->'evidence',source_row->>'confirmationState',p_batch_id)
      on conflict(user_id,source_system,source_object_id) do update set evidence=excluded.evidence,
        confirmation_state=excluded.confirmation_state,updated_at=now()
      where (public.finance_source_observations.evidence,public.finance_source_observations.confirmation_state)
        is distinct from (excluded.evidence,excluded.confirmation_state);
  end loop;
  update public.finance_handoff_batches set preview=p_preview,updated_at=now(),
    state=case when coalesce((p_preview->'counters'->>'needsConfirmation')::int,0)>0 then 'partial' else 'complete' end
    where user_id=owner_id and id=p_batch_id;
  return jsonb_build_object('ok',true,'writes',writes,'counters',p_preview->'counters','checks',p_preview->'checks');
end $$;
revoke all on function public.merge_finance_handoff(uuid,bigint,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.merge_finance_handoff(uuid,bigint,jsonb,jsonb,jsonb) to authenticated;
