begin;
create table sellerpilot_private.external_detail_imports (
 id uuid primary key, product_id uuid not null references sellerpilot_private.products(id),
 owner_id uuid not null references auth.users(id), request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 payload jsonb not null, status text not null default 'reserved' check(status in ('reserved','verified','approved','cancelled')),
 receipts jsonb, approved_product_updated_at timestamptz, approved_detail_version bigint,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default (clock_timestamp()+interval '24 hours'),
 approved_at timestamptz
);
create table sellerpilot_private.external_detail_import_audit (
 id bigint generated always as identity primary key, import_id uuid not null references sellerpilot_private.external_detail_imports(id),
 actor_id uuid not null, event text not null, evidence jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.external_detail_imports enable row level security;
alter table sellerpilot_private.external_detail_import_audit enable row level security;
revoke all on sellerpilot_private.external_detail_imports,sellerpilot_private.external_detail_import_audit from public,anon,authenticated,service_role;
alter table sellerpilot_private.products add column external_detail_import_id uuid references sellerpilot_private.external_detail_imports(id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('sellerpilot-detail-imports','sellerpilot-detail-imports',false,10485760,array['image/png']) on conflict(id) do nothing;
-- No browser Storage policies. Only the guarded service route uploads with upsert=false.
create function public.sellerpilot_service_external_detail_import(p_action text,p_actor uuid,p_product uuid,p_import uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p sellerpilot_private.products%rowtype; r sellerpilot_private.external_detail_imports%rowtype; a jsonb; refs jsonb; n integer;
begin
 if p_product is distinct from '1ed4acfc-7603-48ec-a638-241131e59358'::uuid then raise exception 'EXTERNAL_DETAIL_TARGET_FORBIDDEN';end if;
 if not exists(select 1 from sellerpilot_private.admin_users where user_id=p_actor) then raise exception 'EXTERNAL_DETAIL_OWNER_REQUIRED';end if;
 select * into p from sellerpilot_private.products where id=p_product and owner_id=p_actor and not demo and status<>'archived' for update;
 if not found then raise exception 'EXTERNAL_DETAIL_OWNER_REQUIRED';end if;
 if p_action='publish_read' then
   select * into r from sellerpilot_private.external_detail_imports where id=p.external_detail_import_id and product_id=p.id and owner_id=p.owner_id;
   if r.id is null or r.status<>'approved' or r.approved_product_updated_at is distinct from p.updated_at or r.approved_detail_version is distinct from p.detail_page_version or p.ai_job_id is distinct from (r.payload->>'expectedAiJobId')::uuid then raise exception 'EXTERNAL_DETAIL_APPROVAL_MISMATCH';end if;
   -- No predecessor Studio DTO/lineage function is called. Only the exact owned
   -- product and its owned original job are read; failed job status stays failed.
   select jsonb_build_object('id',j.id,'createdBy',j.created_by,'status',j.status,'kind',j.kind,'requestPayload',j.request_payload,'resultPayload',j.result_payload) into a from sellerpilot_private.ai_cli_jobs j where j.id=p.ai_job_id and j.created_by=p.owner_id;
   if a is null then raise exception 'EXTERNAL_DETAIL_SOURCE_JOB_OWNER_MISMATCH';end if;
   return jsonb_build_object('contract','sellerpilot_external_detail_publish_read_v1','productRow',to_jsonb(p),'sourceJob',a,'externalDetailImport',to_jsonb(r)||jsonb_build_object('current',true),
     'assignments',coalesce((select jsonb_agg(to_jsonb(c)order by c.channel,c.market)from sellerpilot_private.product_category_assignments c where c.product_id=p.id and c.owner_id=p.owner_id),'[]'::jsonb),
     'listings',coalesce((select jsonb_agg(to_jsonb(l)order by l.channel_key,l.market,l.target_id)from sellerpilot_private.product_listings l where l.product_id=p.id and l.owner_id=p.owner_id),'[]'::jsonb));
 end if;
 if p_action='context' then
   select request_payload->'image_paths' into refs from sellerpilot_private.ai_cli_jobs where id=p.ai_job_id;
   if p.external_detail_import_id is not null then select * into r from sellerpilot_private.external_detail_imports where id=p.external_detail_import_id;end if;
   return jsonb_build_object('productId',p.id,'ownerId',p.owner_id,'productUpdatedAt',p.updated_at,'detailVersion',p.detail_page_version,'aiJobId',p.ai_job_id,'sourceImagePaths',coalesce(refs,'[]'::jsonb),'externalDetailImport',case when r.id is not null then to_jsonb(r)||jsonb_build_object('current',r.approved_product_updated_at=p.updated_at and r.approved_detail_version=p.detail_page_version and p.ai_job_id is not distinct from (r.payload->>'expectedAiJobId')::uuid) else null end);
 end if;
 select * into r from sellerpilot_private.external_detail_imports where id=p_import for update;
 if found and (r.owner_id<>p_actor or r.product_id<>p_product) then raise exception 'EXTERNAL_DETAIL_OWNER_REQUIRED';end if;
 if p_action='get' then if r.id is null then raise exception 'EXTERNAL_DETAIL_NOT_FOUND';end if;return to_jsonb(r)||jsonb_build_object('current',r.status='approved' and r.approved_product_updated_at=p.updated_at and r.approved_detail_version=p.detail_page_version and p.ai_job_id is not distinct from (r.payload->>'expectedAiJobId')::uuid);end if;
 if p_action='reserve' then
   if r.id is not null then
     if r.request_sha256 is distinct from p_payload->>'requestSha256' or r.payload is distinct from p_payload then raise exception 'EXTERNAL_DETAIL_IDEMPOTENCY_CONFLICT';end if;
     return to_jsonb(r);
   end if;
   if p_import is distinct from (p_payload->>'importId')::uuid or p_product is distinct from (p_payload->>'productId')::uuid or p_actor is distinct from (p_payload->>'ownerId')::uuid or p_actor is distinct from (p_payload->>'actorId')::uuid then raise exception 'EXTERNAL_DETAIL_BINDING_INVALID';end if;
   if p.updated_at is distinct from (p_payload->>'expectedProductUpdatedAt')::timestamptz or p.detail_page_version is distinct from (p_payload->>'expectedDetailVersion')::bigint or p.ai_job_id is distinct from (p_payload->>'expectedAiJobId')::uuid then raise exception 'EXTERNAL_DETAIL_VERSION_CONFLICT';end if;
   if p_payload#>>'{source,kind}' is distinct from 'external_generated' or jsonb_array_length(p_payload->'assets') is distinct from 8 or coalesce(jsonb_array_length(p_payload->'originalEvidence'),0)<1 then raise exception 'EXTERNAL_DETAIL_PAYLOAD_INVALID';end if;
   select count(distinct x->>'sourceSha256') into n from jsonb_array_elements(p_payload->'assets')x;if n<>8 then raise exception 'EXTERNAL_DETAIL_ASSETS_INVALID';end if;
   foreach refs in array array[p_payload#>'{reviewedCopy,ko}',p_payload#>'{reviewedCopy,ja}',p_payload#>'{reviewedCopy,en}'] loop
     if refs is null or coalesce(refs->>'documentSha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(refs->'document') is distinct from 'object' or length(coalesce(refs->>'reviewNote',''))<1 then raise exception 'EXTERNAL_DETAIL_COPY_REQUIRED';end if;
   end loop;
   insert into sellerpilot_private.external_detail_imports(id,product_id,owner_id,request_sha256,payload)values(p_import,p_product,p_actor,p_payload->>'requestSha256',p_payload)returning * into r;
 elsif p_action in ('verify','approve','cancel') then
   if r.id is null then raise exception 'EXTERNAL_DETAIL_NOT_FOUND';end if;
   if p_action='approve' and r.status='approved' then
     if p_payload->>'requestSha256' is distinct from r.request_sha256 or r.approved_product_updated_at is distinct from p.updated_at or r.approved_detail_version is distinct from p.detail_page_version then raise exception 'EXTERNAL_DETAIL_VERSION_CONFLICT';end if;return to_jsonb(r);
   end if;
   if p_action='cancel' and r.status='cancelled' then return to_jsonb(r);end if;
   if r.status in ('approved','cancelled') or r.expires_at<=clock_timestamp() then raise exception 'EXTERNAL_DETAIL_STATE_CONFLICT';end if;
   if p_action<>'cancel' then
     if p.updated_at is distinct from (r.payload->>'expectedProductUpdatedAt')::timestamptz or p.detail_page_version is distinct from (r.payload->>'expectedDetailVersion')::bigint or p.ai_job_id is distinct from (r.payload->>'expectedAiJobId')::uuid then raise exception 'EXTERNAL_DETAIL_VERSION_CONFLICT';end if;
     if p_payload->>'requestSha256' is distinct from r.request_sha256 or jsonb_array_length(p_payload->'receipts') is distinct from 8 then raise exception 'EXTERNAL_DETAIL_VERIFICATION_REQUIRED';end if;
     select count(distinct x->>'decodedRgbaSha256') into n from jsonb_array_elements(p_payload->'receipts')x;if n<>8 then raise exception 'EXTERNAL_DETAIL_PIXELS_DUPLICATED';end if;
     for a in select value from jsonb_array_elements(r.payload->'assets') loop
       if not exists(select 1 from jsonb_array_elements(p_payload->'receipts')x where x->>'assetId'=a->>'assetId' and x->>'role'=a->>'role' and x->>'sourceSha256'=a->>'sourceSha256' and x->>'byteLength'=a->>'byteLength' and x->>'decodedRgbaSha256' ~ '^[a-f0-9]{64}$' and x->>'verification'='bytes_only_not_approved') then raise exception 'EXTERNAL_DETAIL_RECEIPT_MISMATCH';end if;
     end loop;
   end if;
   if p_action='approve' then
     if r.status<>'verified' or p_payload->>'reviewConfirmed' is distinct from 'true' or r.receipts is distinct from p_payload->'receipts' then raise exception 'EXTERNAL_DETAIL_VERIFICATION_REQUIRED';end if;
     update sellerpilot_private.products set external_detail_import_id=r.id,detail_page_data=r.payload#>'{reviewedCopy,ko,document}',detail_page_version=detail_page_version+1,detail_page_approved_version=0,detail_page_image_manifest=null,detail_page_updated_at=clock_timestamp(),updated_at=clock_timestamp() where id=p.id returning * into p;
     update sellerpilot_private.external_detail_imports set status='approved',approved_at=clock_timestamp(),approved_product_updated_at=p.updated_at,approved_detail_version=p.detail_page_version where id=r.id returning * into r;
   elsif p_action='verify' then
     update sellerpilot_private.external_detail_imports set status='verified',receipts=p_payload->'receipts' where id=r.id returning * into r;
   else update sellerpilot_private.external_detail_imports set status='cancelled' where id=r.id returning * into r;end if;
 else raise exception 'EXTERNAL_DETAIL_ACTION_INVALID';end if;
 insert into sellerpilot_private.external_detail_import_audit(import_id,actor_id,event,evidence)values(r.id,p_actor,p_action,jsonb_build_object('requestSha256',r.request_sha256,'receipts',r.receipts,'reviewConfirmed',p_payload->'reviewConfirmed'));
 return to_jsonb(r);
end$$;
revoke all on function public.sellerpilot_service_external_detail_import(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_external_detail_import(text,uuid,uuid,uuid,jsonb) to service_role;
commit;
