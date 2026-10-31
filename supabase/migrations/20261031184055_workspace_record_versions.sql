-- Every record editable through /api/workspace carries a server-owned version.
-- Backfill metadata only; financial values, ownership and existing links remain unchanged.
alter table public.account_snapshots add column updated_at timestamptz not null default now();
alter table public.bill_payment_allocations add column updated_at timestamptz not null default now();
alter table public.emi_payment_allocations add column updated_at timestamptz not null default now();
alter table public.expense_shares add column updated_at timestamptz not null default now();
alter table public.settlements add column updated_at timestamptz not null default now();
alter table public.reminders add column updated_at timestamptz not null default now();

create function private.stamp_finance_record_version() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.updated_at := pg_catalog.clock_timestamp();
  else
    -- now() is transaction-stable; two writes in one transaction still need different tokens.
    -- A clock correction must not make a row's version move backwards either.
    new.updated_at := greatest(pg_catalog.clock_timestamp(),old.updated_at+interval '1 microsecond');
  end if;
  return new;
end $$;
revoke all on function private.stamp_finance_record_version() from public,anon,authenticated;

do $$ declare tbl text; cols text; begin
  foreach tbl in array array[
    'accounts','account_snapshots','transactions','bills','bill_payment_allocations',
    'fixed_deposits','loans','emis','emi_payment_allocations','expense_groups',
    'expense_shares','settlements','reminders'
  ] loop
    -- PostgreSQL runs same-kind triggers alphabetically. Stamp after existing
    -- validation/protection triggers, including their legacy transaction timestamp assignment.
    execute format('create trigger zzz_finance_record_version before insert or update on public.%I for each row execute function private.stamp_finance_record_version()',tbl);
  end loop;
  foreach tbl in array array[
    'account_snapshots','bill_payment_allocations','emi_payment_allocations',
    'expense_shares','settlements','reminders'
  ] loop
    -- Add the new token last, preserving all existing view columns and exact money serialization.
    select string_agg(case when data_type='numeric' then format('%I::text as %I',column_name,column_name) else format('%I',column_name) end,',' order by ordinal_position)
      into cols from information_schema.columns where table_schema='public' and table_name=tbl;
    execute format('create or replace view public.api_%I with (security_invoker=true) as select %s from public.%I',tbl,cols,tbl);
    execute format('revoke all on public.api_%I from public,anon',tbl);
    execute format('grant select on public.api_%I to authenticated',tbl);
  end loop;
end $$;

-- Remove the old unconditional upsert endpoints. Their argument counts remain
-- supported through defaults for creation, but cannot overwrite an existing ID.
drop function public.allocate_bill_payment(uuid,uuid,uuid,numeric,boolean);
drop function public.allocate_emi_payment(uuid,uuid,uuid,numeric);

create function public.allocate_bill_payment(
  p_id uuid,p_bill_id uuid,p_transaction_id uuid,p_amount numeric,
  p_verified boolean default false,p_expected_updated_at timestamptz default null
) returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_expected_updated_at is null then
    insert into public.bill_payment_allocations(id,user_id,bill_id,transaction_id,amount,verified)
      values(p_id,auth.uid(),p_bill_id,p_transaction_id,p_amount,p_verified);
  else
    update public.bill_payment_allocations set amount=p_amount,verified=p_verified
      where id=p_id and user_id=auth.uid() and bill_id=p_bill_id
        and transaction_id=p_transaction_id and updated_at=p_expected_updated_at;
    if not found then
      raise exception 'This allocation changed. Refresh and retry.' using errcode='40001';
    end if;
  end if;
  return p_id;
end $$;

create function public.allocate_emi_payment(
  p_id uuid,p_emi_id uuid,p_transaction_id uuid,p_amount numeric,
  p_expected_updated_at timestamptz default null
) returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_expected_updated_at is null then
    insert into public.emi_payment_allocations(id,user_id,emi_id,transaction_id,amount)
      values(p_id,auth.uid(),p_emi_id,p_transaction_id,p_amount);
  else
    update public.emi_payment_allocations set amount=p_amount
      where id=p_id and user_id=auth.uid() and emi_id=p_emi_id
        and transaction_id=p_transaction_id and updated_at=p_expected_updated_at;
    if not found then
      raise exception 'This allocation changed. Refresh and retry.' using errcode='40001';
    end if;
  end if;
  return p_id;
end $$;
revoke all on function public.allocate_bill_payment(uuid,uuid,uuid,numeric,boolean,timestamptz) from public,anon;
revoke all on function public.allocate_emi_payment(uuid,uuid,uuid,numeric,timestamptz) from public,anon;
grant execute on function public.allocate_bill_payment(uuid,uuid,uuid,numeric,boolean,timestamptz) to authenticated;
grant execute on function public.allocate_emi_payment(uuid,uuid,uuid,numeric,timestamptz) to authenticated;
