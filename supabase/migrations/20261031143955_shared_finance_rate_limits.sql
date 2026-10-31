-- Counters are internal state, never financial records or a writable Data API table.
create table private.finance_rate_limit_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('receipt','bot','orders','documents')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 21),
  primary key (user_id,bucket)
);
alter table private.finance_rate_limit_windows enable row level security;
revoke all on private.finance_rate_limit_windows from public,anon,authenticated;

-- Definer access is required only to update the otherwise inaccessible counters.
-- Callers cannot choose an owner, quota, time or window, even through direct RPC.
create function private.consume_finance_rate_limit(p_bucket text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid := auth.uid();
  quota integer;
  used integer;
  started_at timestamptz;
  retry_after integer;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'false' then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  quota := case p_bucket when 'receipt' then 10 when 'bot' then 20
    when 'orders' then 10 when 'documents' then 20 else null end;
  if quota is null then raise exception 'Unknown rate limit bucket' using errcode='22023'; end if;

  -- ON CONFLICT locks this owner's bucket row. Expressions run after that lock,
  -- so competing instances cannot each consume the same remaining allowance.
  insert into private.finance_rate_limit_windows as limits(user_id,bucket,window_started_at,request_count)
    values(owner_id,p_bucket,pg_catalog.clock_timestamp(),1)
  on conflict(user_id,bucket) do update set (request_count,window_started_at) = (
    -- Sample once after locking, so expiry cannot fall between two decisions.
    with tick as materialized (select pg_catalog.clock_timestamp() as sampled_at)
    select case when limits.window_started_at + interval '60 seconds' <= tick.sampled_at
        then 1 else least(limits.request_count+1,quota+1) end,
      case when limits.window_started_at + interval '60 seconds' <= tick.sampled_at
        then tick.sampled_at else limits.window_started_at end
    from tick
  )
  returning request_count,window_started_at into used,started_at;

  if used <= quota then return jsonb_build_object('allowed',true,'retryAfter',0); end if;
  retry_after := greatest(1,least(60,ceil(extract(epoch from
    (started_at + interval '60 seconds' - pg_catalog.clock_timestamp())))::integer));
  return jsonb_build_object('allowed',false,'retryAfter',retry_after);
end $$;
revoke all on function private.consume_finance_rate_limit(text) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.consume_finance_rate_limit(text) to authenticated;

-- The exposed function keeps caller privileges; its only delegate is guarded above.
create function public.consume_finance_rate_limit(p_bucket text) returns jsonb
language sql security invoker set search_path='' as $$
  select private.consume_finance_rate_limit(p_bucket);
$$;
revoke all on function public.consume_finance_rate_limit(text) from public,anon,authenticated;
grant execute on function public.consume_finance_rate_limit(text) to authenticated;
