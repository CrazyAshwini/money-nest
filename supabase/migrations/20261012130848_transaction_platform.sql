-- Platform is the app/service used; merchant remains the seller. Older records
-- stay unclassified because a seller name alone does not identify a platform.
alter table public.transactions add column platform text;

-- Append to the existing API view without changing column order or converting
-- exact decimal amounts to JSON numbers. Caller ownership policies still apply.
create or replace view public.api_transactions with (security_invoker=true) as
select id,user_id,amount::text as amount,currency,kind,status,occurred_on,
  description,from_account_id,to_account_id,category,category_id,subcategory,
  merchant,external_payer,external_reference,source_system,source_object_id,
  receipt_document_id,refund_of_transaction_id,import_batch_id,notes,created_at,
  updated_at,platform
from public.transactions;
revoke all on public.api_transactions from anon, authenticated;
grant select on public.api_transactions to authenticated;

-- The reviewed-import RPC uses an explicit insert list, so include the optional
-- platform while retaining its atomicity, ownership checks and retry identity.
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
    insert into public.transactions(id,user_id,amount,currency,kind,status,occurred_on,description,from_account_id,to_account_id,category,subcategory,merchant,external_payer,external_reference,source_system,source_object_id,receipt_document_id,refund_of_transaction_id,import_batch_id,notes,platform)
    values(txn_id,auth.uid(),(item->>'amount')::numeric,coalesce(item->>'currency','INR'),item->>'kind',item->>'status',(item->>'occurredOn')::date,item->>'description',(item->>'fromAccountId')::uuid,(item->>'toAccountId')::uuid,item->>'category',item->>'subcategory',item->>'merchant',item->>'externalPayer',item->>'externalReference','csv',item->>'sourceObjectId',(item->>'receiptDocumentId')::uuid,(item->>'refundOfTransactionId')::uuid,batch.id,item->>'notes',item->>'platform')
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
