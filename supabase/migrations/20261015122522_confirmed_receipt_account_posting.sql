-- Extend exact same-day report confirmations to card and Pay Later usage.
-- Existing finance records are left unchanged; zero is a known reported value.
create or replace function private.validate_transaction_balance_snapshot() returns trigger
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
        and ((a.kind in ('bank','wallet') and s.reported_balance is not null)
          or (a.kind in ('credit_card','pay_later') and coalesce(s.reported_utilized,s.reported_outstanding,s.reported_available) is not null))
        and new.occurred_on=(s.as_of at time zone 'Asia/Kolkata')::date
    ) then
      raise exception 'Balance confirmation requires an owned asset balance report or credit usage report for the same account and date'
        using errcode='23514';
    end if;
  end loop;
  return new;
end $$;

create or replace function private.protect_transaction_balance_snapshot() returns trigger
language plpgsql security invoker set search_path='' as $$
declare account_kind text; supported_report boolean;
begin
  select kind into account_kind from public.accounts where user_id=new.user_id and id=new.account_id;
  supported_report := case when account_kind in ('bank','wallet') then new.reported_balance is not null
    when account_kind in ('credit_card','pay_later') then coalesce(new.reported_utilized,new.reported_outstanding,new.reported_available) is not null
    else false end;
  if exists (
    select 1 from public.transactions t
    where (t.from_balance_snapshot_id=old.id and (
      t.user_id is distinct from new.user_id or t.from_account_id is distinct from new.account_id
      or not supported_report or t.occurred_on is distinct from (new.as_of at time zone 'Asia/Kolkata')::date
    )) or (t.to_balance_snapshot_id=old.id and (
      t.user_id is distinct from new.user_id or t.to_account_id is distinct from new.account_id
      or not supported_report or t.occurred_on is distinct from (new.as_of at time zone 'Asia/Kolkata')::date
    ))
  ) then
    raise exception 'Remove transaction balance confirmations before changing this report account, date, or reported amount type'
      using errcode='23514';
  end if;
  return new;
end $$;

-- Existing exact source identity and provider-reference indexes remain in place.
-- This additional check rejects normalized receipt references without creating
-- an index that would fail on pre-existing legacy duplicates. Owner writes are
-- serialized by the existing lock_cloud_workspace statement trigger.
create function private.validate_receipt_payment_reference() returns trigger
language plpgsql security invoker set search_path='' as $$
declare reference_key text; previous_key text; reference_account uuid;
begin
  if new.source_system is distinct from 'receipt_ai' then return new; end if;
  reference_key := nullif(pg_catalog.regexp_replace(pg_catalog.lower(new.external_reference),'[[:space:]]+','','g'),'');
  reference_account := coalesce(new.from_account_id,new.to_account_id);
  if reference_key is null or reference_account is null or reference_key !~ '[a-z0-9]'
    or reference_key in ('unknown','unconfirmed','notavailable','notshown','pending','none','n/a','na') then return new; end if;
  if tg_op='UPDATE' then
    previous_key := nullif(pg_catalog.regexp_replace(pg_catalog.lower(old.external_reference),'[[:space:]]+','','g'),'');
    if (new.user_id,new.source_system,reference_account,reference_key) is not distinct from
      (old.user_id,old.source_system,coalesce(old.from_account_id,old.to_account_id),previous_key) then return new; end if;
  elsif exists (
    -- Generic saves retry an existing ID with INSERT ... ON CONFLICT UPDATE.
    -- Leave unchanged legacy identities editable before that UPDATE fires.
    select 1 from public.transactions t where t.id=new.id and t.user_id=new.user_id and t.source_system='receipt_ai'
      and coalesce(t.from_account_id,t.to_account_id)=reference_account
      and pg_catalog.regexp_replace(pg_catalog.lower(t.external_reference),'[[:space:]]+','','g')=reference_key
  ) then
    return new;
  end if;
  if exists (
    select 1 from public.transactions t where t.id<>new.id and t.user_id=new.user_id and t.source_system='receipt_ai'
      and coalesce(t.from_account_id,t.to_account_id)=reference_account
      and pg_catalog.regexp_replace(pg_catalog.lower(t.external_reference),'[[:space:]]+','','g')=reference_key
  ) then
    raise exception 'This payment reference already exists for the selected account. Review the existing transaction and its payment links.'
      using errcode='23505';
  end if;
  return new;
end $$;
create trigger validate_receipt_payment_reference before insert or update on public.transactions
for each row execute function private.validate_receipt_payment_reference();
