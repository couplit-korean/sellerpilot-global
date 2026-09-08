-- Stage normalized historical CS exports separately from the live collector.
-- Provider-specific formats remain disabled until an exact provider sample is
-- mapped into sellerpilot-normalized-cs-export/1 by reviewed application code.
begin;
create table sellerpilot_private.cs_import_batches(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id)on delete cascade,
 credential_id uuid not null references sellerpilot_private.channel_credentials(id)on delete restrict,channel text not null,
 source_format text not null check(source_format='normalized_json_v1'),source_digest text not null check(source_digest~'^[a-f0-9]{64}$'),
 source_account_key text not null check(source_account_key~'^[a-f0-9]{64}$'),source_name text not null check(length(source_name)between 1 and 240),
 declared_row_count integer not null check(declared_row_count between 1 and 100000),staged_row_count integer not null default 0,
 imported_row_count integer not null default 0,duplicate_row_count integer not null default 0,
 status text not null default'staging'check(status in('staging','preview_ready','committing','committed','cancelled')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),committed_at timestamptz,
 unique(owner_id,credential_id,channel,source_format,source_digest)
);
create table sellerpilot_private.cs_import_rows(
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references sellerpilot_private.cs_import_batches(id)on delete cascade,
 row_number integer not null check(row_number>0),row_digest text not null check(row_digest~'^[a-f0-9]{64}$'),provider_record_id text,
 normalized_inquiry jsonb not null check(jsonb_typeof(normalized_inquiry)='object'and octet_length(normalized_inquiry::text)<=64000),
 status text not null default'preview_ready'check(status in('preview_ready','imported','duplicate')),
 ticket_id uuid references sellerpilot_private.support_tickets(id)on delete set null,created_at timestamptz not null default clock_timestamp(),
 unique(batch_id,row_number),unique(batch_id,row_digest)
);
create index cs_import_batches_owner_idx on sellerpilot_private.cs_import_batches(owner_id,created_at desc);
alter table sellerpilot_private.cs_import_batches enable row level security;alter table sellerpilot_private.cs_import_rows enable row level security;
revoke all on sellerpilot_private.cs_import_batches,sellerpilot_private.cs_import_rows from public,anon,authenticated,service_role;

create function public.sellerpilot_begin_cs_import_v1(p_credential_id uuid,p_channel text,p_source_format text,p_source_digest text,p_source_account_key text,p_source_name text,p_declared_row_count integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_credential sellerpilot_private.channel_credentials%rowtype;v_batch sellerpilot_private.cs_import_batches%rowtype;
begin
 if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then raise exception'administrator access required'using errcode='42501';end if;
 if p_source_format<>'normalized_json_v1'or p_source_digest!~'^[a-f0-9]{64}$'or p_source_account_key!~'^[a-f0-9]{64}$'
  or length(trim(p_source_name))not between 1 and 240 or p_declared_row_count not between 1 and 100000 then raise exception'CS_IMPORT_SOURCE_INVALID'using errcode='22023';end if;
 select*into v_credential from sellerpilot_private.channel_credentials where id=p_credential_id and channel=p_channel
  and status in('active','grace')for update;
 if not found or v_credential.seller_account_key is distinct from p_source_account_key
  or v_credential.seller_account_key_source not in('provider_certified_v1','credential_incarnation_v1')
  or(p_channel='lazada'and v_credential.seller_account_key_source<>'provider_certified_v1')then raise exception'CS_IMPORT_ACCOUNT_MISMATCH'using errcode='42501';end if;
 insert into sellerpilot_private.cs_import_batches(owner_id,credential_id,channel,source_format,source_digest,source_account_key,source_name,declared_row_count)
 values(v_credential.created_by,p_credential_id,p_channel,p_source_format,p_source_digest,p_source_account_key,trim(p_source_name),p_declared_row_count)
 on conflict(owner_id,credential_id,channel,source_format,source_digest)do nothing;
 select*into v_batch from sellerpilot_private.cs_import_batches where owner_id=v_credential.created_by and credential_id=p_credential_id and channel=p_channel and source_format=p_source_format and source_digest=p_source_digest;
 if v_batch.declared_row_count<>p_declared_row_count or v_batch.source_account_key<>p_source_account_key then raise exception'CS_IMPORT_SOURCE_REUSE_MISMATCH'using errcode='23514';end if;
 return jsonb_build_object('contract','sellerpilot-cs-import/1','batchId',v_batch.id,'status',v_batch.status,
  'stagedRowCount',v_batch.staged_row_count,'declaredRowCount',v_batch.declared_row_count,
  'nextRowNumber',case when v_batch.staged_row_count=v_batch.declared_row_count then null else coalesce((select min(series.row_number)from generate_series(1,v_batch.declared_row_count)series(row_number)left join sellerpilot_private.cs_import_rows existing on existing.batch_id=v_batch.id and existing.row_number=series.row_number where existing.id is null),1)end,
  'remainingRowCount',case when v_batch.status='committed'then 0 when v_batch.status='committing'then(select count(*)::integer from sellerpilot_private.cs_import_rows where batch_id=v_batch.id and status='preview_ready')else null end,
  'reused',v_batch.created_at<v_batch.updated_at or v_batch.staged_row_count>0);
end $$;
revoke all on function public.sellerpilot_begin_cs_import_v1(uuid,text,text,text,text,text,integer)from public,anon,service_role;grant execute on function public.sellerpilot_begin_cs_import_v1(uuid,text,text,text,text,text,integer)to authenticated;

create function public.sellerpilot_stage_cs_import_rows_v1(p_batch_id uuid,p_expected_source_digest text,p_rows jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_batch sellerpilot_private.cs_import_batches%rowtype;v_row jsonb;v_staged integer;
begin
 if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then raise exception'administrator access required'using errcode='42501';end if;
 select*into v_batch from sellerpilot_private.cs_import_batches where id=p_batch_id for update;
 if not found or v_batch.status not in('staging','preview_ready')then raise exception'CS_IMPORT_BATCH_NOT_STAGING';end if;
 if p_expected_source_digest!~'^[a-f0-9]{64}$'or v_batch.source_digest is distinct from p_expected_source_digest then raise exception'CS_IMPORT_SOURCE_REUSE_MISMATCH'using errcode='23514';end if;
 if jsonb_typeof(p_rows)<>'array'or jsonb_array_length(p_rows)not between 1 and 500 or octet_length(p_rows::text)>1000000 then raise exception'CS_IMPORT_ROWS_INVALID'using errcode='22023';end if;
 for v_row in select value from jsonb_array_elements(p_rows)loop
  if jsonb_typeof(v_row)<>'object'or coalesce((v_row->>'rowNumber')::integer,0)not between 1 and v_batch.declared_row_count
   or coalesce(v_row->>'rowDigest','')!~'^[a-f0-9]{64}$'or jsonb_typeof(v_row->'providerContext')<>'object'
   or length(coalesce(v_row->>'customerName',''))not between 1 and 240 or length(coalesce(v_row->>'subject',''))not between 1 and 500
   or length(coalesce(v_row->>'message',''))not between 1 and 20000 or coalesce(v_row->>'status','')not in('waiting','resolved')
   or coalesce(v_row->>'senderRole','')not in('customer','seller','system')or coalesce(v_row->>'ticketKind','')not in('conversation','after_sales')then raise exception'CS_IMPORT_ROW_INVALID'using errcode='22023';end if;
  insert into sellerpilot_private.cs_import_rows(batch_id,row_number,row_digest,provider_record_id,normalized_inquiry)
  values(v_batch.id,(v_row->>'rowNumber')::integer,v_row->>'rowDigest',nullif(trim(v_row->>'sourceRecordId'),''),v_row-'rowNumber'-'rowDigest')
  on conflict(batch_id,row_number)do update set normalized_inquiry=case when sellerpilot_private.cs_import_rows.row_digest=excluded.row_digest then excluded.normalized_inquiry else sellerpilot_private.cs_import_rows.normalized_inquiry end;
  if(select row_digest from sellerpilot_private.cs_import_rows where batch_id=v_batch.id and row_number=(v_row->>'rowNumber')::integer)<>v_row->>'rowDigest'then raise exception'CS_IMPORT_ROW_REUSE_MISMATCH'using errcode='23514';end if;
 end loop;
 select count(*)::integer into v_staged from sellerpilot_private.cs_import_rows where batch_id=v_batch.id;
 update sellerpilot_private.cs_import_batches set staged_row_count=v_staged,status=case when v_staged=declared_row_count then'preview_ready'else'staging'end,updated_at=clock_timestamp()where id=v_batch.id;
 return jsonb_build_object('contract','sellerpilot-cs-import/1','batchId',v_batch.id,'status',case when v_staged=v_batch.declared_row_count then'preview_ready'else'staging'end,
  'stagedRowCount',v_staged,'declaredRowCount',v_batch.declared_row_count,
  'nextRowNumber',case when v_staged=v_batch.declared_row_count then null else(select min(series.row_number)from generate_series(1,v_batch.declared_row_count)series(row_number)left join sellerpilot_private.cs_import_rows existing on existing.batch_id=v_batch.id and existing.row_number=series.row_number where existing.id is null)end);
end $$;
revoke all on function public.sellerpilot_stage_cs_import_rows_v1(uuid,text,jsonb)from public,anon,service_role;grant execute on function public.sellerpilot_stage_cs_import_rows_v1(uuid,text,jsonb)to authenticated;

create function public.sellerpilot_get_cs_import_preview_v1(p_batch_id uuid,p_after_row_number integer default 0,p_limit integer default 25)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare v_batch sellerpilot_private.cs_import_batches%rowtype;v_rows jsonb;v_last integer;v_has_more boolean;
begin
 if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then raise exception'administrator access required'using errcode='42501';end if;
 if p_after_row_number<0 or p_limit not between 1 and 100 then raise exception'CS_IMPORT_PREVIEW_PAGE_INVALID'using errcode='22023';end if;
 select*into v_batch from sellerpilot_private.cs_import_batches where id=p_batch_id;
 if not found then raise exception'CS_IMPORT_BATCH_NOT_FOUND'using errcode='P0002';end if;
 with page as(
  select source.*,case when source.provider_record_id is not null then
   'import:'||v_batch.channel||':'||encode(extensions.digest(v_batch.source_account_key||E'\x1f'||source.row_digest,'sha256'),'hex')
   else'import:'||v_batch.channel||':'||encode(extensions.digest(v_batch.source_account_key||E'\x1f'||v_batch.id::text||E'\x1f'||source.row_number::text||E'\x1f'||source.row_digest,'sha256'),'hex')end inbound_key,
   case when source.provider_record_id is not null then'import:'||v_batch.channel||':'||encode(extensions.digest(v_batch.source_account_key||E'\x1f'||coalesce(source.normalized_inquiry->>'externalTicketId',source.provider_record_id),'sha256'),'hex')
   else'import:'||v_batch.id::text||':'||source.row_number::text end external_ticket_id
  from sellerpilot_private.cs_import_rows source where source.batch_id=v_batch.id and source.row_number>p_after_row_number order by source.row_number limit p_limit
 ),projected as(
  select page.*,case
   when exists(select 1 from sellerpilot_private.support_inbound_messages message where message.owner_id=v_batch.owner_id and message.channel_key=v_batch.channel and message.inbound_key=page.inbound_key)then'duplicate_message'
   when exists(select 1 from sellerpilot_private.support_tickets ticket where ticket.owner_id=v_batch.owner_id and ticket.channel_key=v_batch.channel and ticket.external_ticket_id=page.external_ticket_id)then'new_message'
   else'new_ticket'end preview_outcome from page
 )
 select coalesce(jsonb_agg(jsonb_build_object('rowNumber',row_number,'validation','valid','outcome',preview_outcome,'customerName',normalized_inquiry->>'customerName','subject',normalized_inquiry->>'subject','messagePreview',left(normalized_inquiry->>'message',500),'status',normalized_inquiry->>'status','receivedAt',normalized_inquiry->>'receivedAt','externalOrderReference',normalized_inquiry->>'externalOrderReference','providerRecordId',provider_record_id)order by row_number),'[]'::jsonb),max(row_number)into v_rows,v_last from projected;
 v_has_more:=v_last is not null and exists(select 1 from sellerpilot_private.cs_import_rows where batch_id=v_batch.id and row_number>v_last);
 return jsonb_build_object('contract','sellerpilot-cs-import-preview/1','batchId',v_batch.id,'status',v_batch.status,'stagedRowCount',v_batch.staged_row_count,'declaredRowCount',v_batch.declared_row_count,'rows',v_rows,'nextAfterRowNumber',case when v_has_more then v_last else null end);
end $$;
revoke all on function public.sellerpilot_get_cs_import_preview_v1(uuid,integer,integer)from public,anon,service_role;grant execute on function public.sellerpilot_get_cs_import_preview_v1(uuid,integer,integer)to authenticated;

create function public.sellerpilot_cancel_cs_import_v1(p_batch_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_batch sellerpilot_private.cs_import_batches%rowtype;begin
 if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then raise exception'administrator access required'using errcode='42501';end if;
 select*into v_batch from sellerpilot_private.cs_import_batches where id=p_batch_id for update;
 if not found or v_batch.status in('committing','committed')then raise exception'CS_IMPORT_CANCEL_NOT_ALLOWED';end if;
 if v_batch.status<>'cancelled'then update sellerpilot_private.cs_import_batches set status='cancelled',updated_at=clock_timestamp()where id=p_batch_id returning*into v_batch;end if;
 return jsonb_build_object('contract','sellerpilot-cs-import/1','batchId',v_batch.id,'status','cancelled','existingDataChanged',false);
end $$;
revoke all on function public.sellerpilot_cancel_cs_import_v1(uuid)from public,anon,service_role;grant execute on function public.sellerpilot_cancel_cs_import_v1(uuid)to authenticated;

create function public.sellerpilot_commit_cs_import_v1(p_batch_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_batch sellerpilot_private.cs_import_batches%rowtype;v_credential sellerpilot_private.channel_credentials%rowtype;v_row record;v_ticket_id uuid;v_external_id text;v_inbound_key text;v_inserted integer;v_imported integer:=0;v_duplicates integer:=0;v_remaining integer;v_status text;
begin
 if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then raise exception'administrator access required'using errcode='42501';end if;
 select*into v_batch from sellerpilot_private.cs_import_batches where id=p_batch_id for update;
 if found and v_batch.status='committed'then return jsonb_build_object('contract','sellerpilot-cs-import/1','batchId',v_batch.id,'status','committed','importedRowCount',v_batch.imported_row_count,'duplicateRowCount',v_batch.duplicate_row_count,'remainingRowCount',0,'processedThisCall',0);end if;
 if not found or v_batch.status not in('preview_ready','committing')or v_batch.staged_row_count<>v_batch.declared_row_count then raise exception'CS_IMPORT_PREVIEW_REQUIRED';end if;
 select*into v_credential from sellerpilot_private.channel_credentials where id=v_batch.credential_id and created_by=v_batch.owner_id and channel=v_batch.channel and seller_account_key=v_batch.source_account_key and status in('active','grace')for update;
 if not found then raise exception'CS_IMPORT_ACCOUNT_CHANGED'using errcode='42501';end if;
 update sellerpilot_private.cs_import_batches set status='committing',updated_at=clock_timestamp()where id=v_batch.id;
 for v_row in select*from sellerpilot_private.cs_import_rows where batch_id=v_batch.id and status='preview_ready'order by row_number limit 500 loop
  v_external_id:=case when v_row.provider_record_id is not null then'import:'||v_batch.channel||':'||encode(extensions.digest(v_batch.source_account_key||E'\x1f'||coalesce(v_row.normalized_inquiry->>'externalTicketId',v_row.provider_record_id),'sha256'),'hex')else'import:'||v_batch.id::text||':'||v_row.row_number::text end;
  v_inbound_key:='import:'||v_batch.channel||':'||case when v_row.provider_record_id is not null then encode(extensions.digest(v_batch.source_account_key||E'\x1f'||v_row.row_digest,'sha256'),'hex')else encode(extensions.digest(v_batch.source_account_key||E'\x1f'||v_batch.id::text||E'\x1f'||v_row.row_number::text||E'\x1f'||v_row.row_digest,'sha256'),'hex')end;
  insert into sellerpilot_private.support_tickets(owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,priority,received_at,resolved_at,demo,updated_at,source_credential_id,seller_account_key,reply_context,provider_context,provider_status,latest_inbound_key,external_order_reference,ticket_kind)
  values(v_batch.owner_id,v_external_id,v_batch.channel,left(v_row.normalized_inquiry->>'customerName',240),left(v_row.normalized_inquiry->>'subject',500),left(v_row.normalized_inquiry->>'message',20000),
   v_row.normalized_inquiry->>'status',greatest(1,least(5,coalesce((v_row.normalized_inquiry->>'priority')::integer,3))),(v_row.normalized_inquiry->>'receivedAt')::timestamptz,
   case when v_row.normalized_inquiry->>'status'='resolved'then(v_row.normalized_inquiry->>'receivedAt')::timestamptz else null end,false,clock_timestamp(),v_batch.credential_id,v_batch.source_account_key,'{}'::jsonb,
   jsonb_build_object('importBatchId',v_batch.id,'sourceFormat',v_batch.source_format,'providerRecordId',v_row.provider_record_id,'replyUnsupported',true),case when v_row.normalized_inquiry->>'status'='resolved'then'answered'else'waiting'end,v_inbound_key,
   nullif(trim(v_row.normalized_inquiry->>'externalOrderReference'),''),v_row.normalized_inquiry->>'ticketKind')
  on conflict(owner_id,channel_key,external_ticket_id)do update set updated_at=excluded.updated_at returning id into v_ticket_id;
  insert into sellerpilot_private.support_inbound_messages(ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,provider_context,received_at)
  values(v_ticket_id,v_batch.owner_id,v_batch.channel,v_inbound_key,nullif(trim(v_row.normalized_inquiry->>'remoteMessageId'),''),v_row.normalized_inquiry->>'senderRole',v_row.normalized_inquiry->>'message',
   jsonb_build_object('importBatchId',v_batch.id,'sourceFormat',v_batch.source_format,'providerRecordId',v_row.provider_record_id,'sourceContext',v_row.normalized_inquiry->'providerContext'),(v_row.normalized_inquiry->>'receivedAt')::timestamptz)
  on conflict(owner_id,channel_key,inbound_key)do nothing;
  get diagnostics v_inserted=row_count;if v_inserted=1 then v_imported:=v_imported+1;update sellerpilot_private.cs_import_rows set status='imported',ticket_id=v_ticket_id where id=v_row.id;
  else v_duplicates:=v_duplicates+1;update sellerpilot_private.cs_import_rows set status='duplicate',ticket_id=v_ticket_id where id=v_row.id;end if;
 end loop;
 select count(*)::integer into v_remaining from sellerpilot_private.cs_import_rows where batch_id=v_batch.id and status='preview_ready';
 if v_remaining=0 and v_batch.imported_row_count+v_batch.duplicate_row_count+v_imported+v_duplicates<>v_batch.declared_row_count then raise exception'CS_IMPORT_COMMIT_COUNT_MISMATCH'using errcode='23514';end if;
 v_status:=case when v_remaining=0 then'committed'else'committing'end;
 update sellerpilot_private.cs_import_batches set status=v_status,imported_row_count=imported_row_count+v_imported,duplicate_row_count=duplicate_row_count+v_duplicates,
  committed_at=case when v_remaining=0 then clock_timestamp()else null end,updated_at=clock_timestamp()where id=v_batch.id returning*into v_batch;
 return jsonb_build_object('contract','sellerpilot-cs-import/1','batchId',v_batch.id,'status',v_status,'importedRowCount',v_batch.imported_row_count,'duplicateRowCount',v_batch.duplicate_row_count,'remainingRowCount',v_remaining,'processedThisCall',v_imported+v_duplicates);
end $$;
revoke all on function public.sellerpilot_commit_cs_import_v1(uuid)from public,anon,service_role;grant execute on function public.sellerpilot_commit_cs_import_v1(uuid)to authenticated;
notify pgrst,'reload schema';commit;
