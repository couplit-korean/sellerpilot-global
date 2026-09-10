-- Candidate callable boundary for permission-gated Lazada supplemental GET reads.
-- No automatic execution, reply, refund, return, cancellation or other provider mutation is enabled here.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.cs_credential_capability_bindings') is null
     or to_regclass('sellerpilot_private.lazada_supplemental_cs_events') is null
     or to_regprocedure('public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(uuid,text,text,text,jsonb)') is null then
    raise exception 'LAZADA_SUPPLEMENTAL_PROVIDER_PREIMAGE_MISSING';
  end if;
  if to_regclass('sellerpilot_private.lazada_supplemental_read_grants') is not null
     or to_regclass('sellerpilot_private.lazada_supplemental_read_progress') is not null
     or to_regprocedure('public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(uuid,jsonb)') is not null
     or to_regprocedure('public.sellerpilot_service_prepare_lazada_supplemental_read_v1(uuid,text,text,text,integer)') is not null
     or to_regprocedure('public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(uuid,bigint,uuid,text,text,text,text,integer,integer,jsonb,jsonb)') is not null then
    raise exception 'LAZADA_SUPPLEMENTAL_PROVIDER_ALREADY_INSTALLED';
  end if;
end
$$;

create table sellerpilot_private.lazada_supplemental_read_grants(
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  binding_id uuid not null references sellerpilot_private.cs_credential_capability_bindings(id) on delete restrict,
  binding_target_fingerprint text not null check(binding_target_fingerprint ~ '^[a-f0-9]{64}$'),
  seller_account_key text not null check(seller_account_key ~ '^[a-f0-9]{64}$'),
  country text not null check(country in('SG','MY','TH','VN','ID','PH')),
  surface text not null check(surface in('product_review','reverse_order_after_sales')),
  source_path text not null check(source_path in(
    '/review/seller/list',
    '/reverse/getreverseordersforseller',
    '/order/reverse/return/detail/list',
    '/order/reverse/return/history/list'
  )),
  verification_source text not null check(verification_source='lazada_app_permission_readback'),
  provider_request_id text not null check(provider_request_id ~ '^[^[:cntrl:]]{1,240}$'),
  evidence_digest text not null check(evidence_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check(status in('active','superseded','revoked','expired')),
  verified_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(credential_id,country,surface,source_path),
  check((source_path='/review/seller/list' and surface='product_review')
     or (source_path<>'/review/seller/list' and surface='reverse_order_after_sales'))
);

create index lazada_supplemental_read_grants_active_idx
on sellerpilot_private.lazada_supplemental_read_grants(
  credential_id,country,surface,source_path,status,verified_at desc
);

alter table sellerpilot_private.lazada_supplemental_read_grants enable row level security;
revoke all on table sellerpilot_private.lazada_supplemental_read_grants
  from public,anon,authenticated,service_role;

create table sellerpilot_private.lazada_supplemental_read_progress(
  continuation_id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references sellerpilot_private.lazada_supplemental_read_grants(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  seller_account_key text not null check(seller_account_key ~ '^[a-f0-9]{64}$'),
  country text not null check(country in('SG','MY','TH','VN','ID','PH')),
  surface text not null check(surface in('product_review','reverse_order_after_sales')),
  source_path text not null,
  resource_id text not null check(length(resource_id)<=240),
  page_size integer not null check(page_size between 1 and 50),
  next_page integer not null default 1 check(next_page>=1),
  revision bigint not null default 0 check(revision>=0),
  complete boolean not null default false,
  last_page_number integer,
  last_page_digest text check(last_page_digest is null or last_page_digest ~ '^[a-f0-9]{64}$'),
  last_receipt jsonb check(last_receipt is null or jsonb_typeof(last_receipt)='object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(credential_id,country,surface,source_path,resource_id),
  check((source_path='/review/seller/list' and surface='product_review' and resource_id<>'')
     or (source_path in(
       '/order/reverse/return/detail/list','/order/reverse/return/history/list'
     ) and surface='reverse_order_after_sales' and resource_id<>'')
     or (source_path='/reverse/getreverseordersforseller'
       and surface='reverse_order_after_sales'))
);

create index lazada_supplemental_read_progress_grant_idx
on sellerpilot_private.lazada_supplemental_read_progress(grant_id,complete,updated_at desc);

alter table sellerpilot_private.lazada_supplemental_read_progress enable row level security;
revoke all on table sellerpilot_private.lazada_supplemental_read_progress
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
  p_binding_id uuid,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_binding record;
  v_surface text;
  v_path text;
  v_country text;
  v_grant_id uuid;
  v_now timestamptz:=clock_timestamp();
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if p_binding_id is null or jsonb_typeof(p_evidence) is distinct from 'object'
     or p_evidence->>'contractVersion' is distinct from 'sellerpilot-lazada-supplemental-permission-readback/1'
     or p_evidence->>'verificationSource' is distinct from 'lazada_app_permission_readback'
     or coalesce(p_evidence->>'providerRequestId','') !~ '^[^[:cntrl:]]{1,240}$'
     or coalesce(p_evidence->>'providerEvidenceDigest','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_evidence->>'bindingTargetFingerprint','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_evidence->>'sellerAccountKey','') !~ '^[a-f0-9]{64}$' then
    raise exception 'LAZADA_SUPPLEMENTAL_GRANT_EVIDENCE_INVALID' using errcode='22023';
  end if;
  v_surface:=p_evidence->>'surface';
  v_path:=p_evidence->>'sourcePath';
  v_country:=upper(trim(coalesce(p_evidence->>'country','')));
  if v_country not in('SG','MY','TH','VN','ID','PH')
     or v_surface<>(case v_path when '/review/seller/list' then 'product_review'
       when '/reverse/getreverseordersforseller' then 'reverse_order_after_sales'
       when '/order/reverse/return/detail/list' then 'reverse_order_after_sales'
       when '/order/reverse/return/history/list' then 'reverse_order_after_sales' else null end) then
    raise exception 'LAZADA_SUPPLEMENTAL_GRANT_EVIDENCE_INVALID' using errcode='22023';
  end if;
  select binding.id,binding.credential_id,binding.country,binding.target_fingerprint,
         binding.expires_at,credential.seller_account_key,credential.expires_at credential_expires_at
    into v_binding
    from sellerpilot_private.cs_credential_capability_bindings binding
    join sellerpilot_private.channel_credentials credential on credential.id=binding.credential_id
   where binding.id=p_binding_id
     and binding.channel='lazada'
     and binding.operation='inquiries.list'
     and binding.status='active'
     and (binding.expires_at is null or binding.expires_at>v_now)
     and credential.channel='lazada'
     and credential.environment='production'
     and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>v_now)
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found
     or v_binding.credential_id::text is distinct from p_evidence->>'credentialId'
     or upper(v_binding.country) is distinct from v_country
     or v_binding.seller_account_key is distinct from p_evidence->>'sellerAccountKey'
     or v_binding.target_fingerprint is distinct from p_evidence->>'bindingTargetFingerprint' then
    raise exception 'LAZADA_SUPPLEMENTAL_GRANT_BINDING_MISMATCH' using errcode='42501';
  end if;
  insert into sellerpilot_private.lazada_supplemental_read_grants(
    credential_id,binding_id,binding_target_fingerprint,seller_account_key,country,surface,source_path,
    verification_source,provider_request_id,evidence_digest,status,verified_at,expires_at,updated_at
  ) values(
    v_binding.credential_id,v_binding.id,v_binding.target_fingerprint,v_binding.seller_account_key,
    v_country,v_surface,v_path,
    'lazada_app_permission_readback',p_evidence->>'providerRequestId',
    p_evidence->>'providerEvidenceDigest','active',v_now,
    least(v_binding.expires_at,v_binding.credential_expires_at),v_now
  ) on conflict(credential_id,country,surface,source_path) do update set
    binding_id=excluded.binding_id,binding_target_fingerprint=excluded.binding_target_fingerprint,
    seller_account_key=excluded.seller_account_key,
    verification_source=excluded.verification_source,provider_request_id=excluded.provider_request_id,
    evidence_digest=excluded.evidence_digest,status='active',verified_at=v_now,
    expires_at=excluded.expires_at,updated_at=v_now
  returning id into v_grant_id;
  return jsonb_build_object(
    'contractVersion','sellerpilot-lazada-supplemental-read-grant/1',
    'grantId',v_grant_id,'credentialId',v_binding.credential_id,'country',v_country,
    'surface',v_surface,'sourcePath',v_path,'status','active','readOnly',true,
    'mutationAllowed',false
  );
end
$$;

create function public.sellerpilot_service_prepare_lazada_supplemental_read_v1(
  p_credential_id uuid,
  p_country text,
  p_source_path text,
  p_resource_id text,
  p_page_size integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_country text:=upper(trim(coalesce(p_country,'')));
  v_resource text:=trim(coalesce(p_resource_id,''));
  v_surface text;
  v_credential record;
  v_grant record;
  v_progress record;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  v_surface:=case p_source_path when '/review/seller/list' then 'product_review'
    when '/reverse/getreverseordersforseller' then 'reverse_order_after_sales'
    when '/order/reverse/return/detail/list' then 'reverse_order_after_sales'
    when '/order/reverse/return/history/list' then 'reverse_order_after_sales' else null end;
  if p_credential_id is null or v_country not in('SG','MY','TH','VN','ID','PH')
     or v_surface is null or p_page_size is null or p_page_size not between 1 and 50
     or length(v_resource)>32 or (v_resource<>'' and v_resource !~ '^[1-9][0-9]{0,31}$')
     or (p_source_path<>'/reverse/getreverseordersforseller' and v_resource='') then
    raise exception 'LAZADA_SUPPLEMENTAL_PREPARE_INVALID' using errcode='22023';
  end if;
  select credential.id,credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='lazada'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>v_now)
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'LAZADA_SUPPLEMENTAL_CREDENTIAL_UNBOUND' using errcode='42501';
  end if;
  select capability_grant.id,capability_grant.binding_id
    into v_grant
    from sellerpilot_private.lazada_supplemental_read_grants capability_grant
    join sellerpilot_private.cs_credential_capability_bindings binding on binding.id=capability_grant.binding_id
   where capability_grant.credential_id=v_credential.id
     and capability_grant.seller_account_key=v_credential.seller_account_key
     and capability_grant.country=v_country and capability_grant.surface=v_surface
     and capability_grant.source_path=p_source_path
     and capability_grant.verification_source='lazada_app_permission_readback'
     and capability_grant.status='active'
     and (capability_grant.expires_at is null or capability_grant.expires_at>v_now)
     and binding.credential_id=v_credential.id and binding.channel='lazada'
     and binding.operation='inquiries.list' and upper(binding.country)=v_country
     and binding.target_fingerprint=capability_grant.binding_target_fingerprint
     and binding.status='active' and (binding.expires_at is null or binding.expires_at>v_now)
   order by capability_grant.verified_at desc limit 1;
  if not found then
    raise exception 'LAZADA_SUPPLEMENTAL_EXACT_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  insert into sellerpilot_private.lazada_supplemental_read_progress(
    grant_id,credential_id,seller_account_key,country,surface,source_path,resource_id,page_size
  ) values(
    v_grant.id,v_credential.id,v_credential.seller_account_key,v_country,v_surface,p_source_path,v_resource,p_page_size
  ) on conflict(credential_id,country,surface,source_path,resource_id) do nothing;
  select progress.* into v_progress
    from sellerpilot_private.lazada_supplemental_read_progress progress
   where progress.credential_id=v_credential.id and progress.country=v_country
     and progress.surface=v_surface and progress.source_path=p_source_path
     and progress.resource_id=v_resource
   for update;
  if v_progress.grant_id<>v_grant.id
     or v_progress.seller_account_key<>v_credential.seller_account_key
     or v_progress.page_size<>p_page_size then
    raise exception 'LAZADA_SUPPLEMENTAL_PROGRESS_BINDING_MISMATCH' using errcode='42501';
  end if;
  if v_progress.complete then
    raise exception 'LAZADA_SUPPLEMENTAL_READ_ALREADY_COMPLETE' using errcode='22023';
  end if;
  return jsonb_build_object(
    'contractVersion','sellerpilot-lazada-supplemental-read-prepare/1',
    'continuationId',v_progress.continuation_id,'revision',v_progress.revision,
    'grantId',v_grant.id,'credentialId',v_credential.id,
    'sellerAccountKey',v_credential.seller_account_key,'country',v_country,
    'surface',v_surface,'sourcePath',p_source_path,'resourceId',v_resource,
    'pageSize',v_progress.page_size,'pageNumber',v_progress.next_page,
    'readOnly',true,'mutationAllowed',false
  );
end
$$;

create function public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
  p_continuation_id uuid,
  p_expected_revision bigint,
  p_credential_id uuid,
  p_country text,
  p_surface text,
  p_source_path text,
  p_resource_id text,
  p_page_number integer,
  p_page_size integer,
  p_rows jsonb,
  p_pagination jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_progress record;
  v_country text:=upper(trim(coalesce(p_country,'')));
  v_resource text:=trim(coalesce(p_resource_id,''));
  v_now timestamptz:=clock_timestamp();
  v_has_more boolean;
  v_total integer;
  v_entry_count integer;
  v_expected_entry_count integer;
  v_next_page integer;
  v_digest text;
  v_writer jsonb;
  v_receipt jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if p_continuation_id is null or p_expected_revision is null or p_expected_revision<0
     or p_credential_id is null or p_page_number is null or p_page_number<1
     or p_page_size is null or p_page_size not between 1 and 50
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_typeof(p_pagination) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p_pagination) key
       where key not in('contractVersion','kind','pageNumber','pageSize','total','entryCount','hasMore','nextPage'))
     or not (p_pagination ?& array[
       'contractVersion','kind','pageNumber','pageSize','total','entryCount','hasMore','nextPage'
     ])
     or p_pagination->>'contractVersion' is distinct from 'sellerpilot-lazada-supplemental-provider-page/1'
     or jsonb_typeof(p_pagination->'kind') is distinct from 'string'
     or jsonb_typeof(p_pagination->'pageNumber') is distinct from 'number'
     or jsonb_typeof(p_pagination->'pageSize') is distinct from 'number'
     or jsonb_typeof(p_pagination->'total') is distinct from 'number'
     or jsonb_typeof(p_pagination->'entryCount') is distinct from 'number'
     or jsonb_typeof(p_pagination->'hasMore') is distinct from 'boolean' then
    raise exception 'LAZADA_SUPPLEMENTAL_PAGE_ACK_INVALID' using errcode='22023';
  end if;
  v_has_more:=(p_pagination->>'hasMore')::boolean;
  v_total:=(p_pagination->>'total')::integer;
  v_entry_count:=(p_pagination->>'entryCount')::integer;
  v_expected_entry_count:=case when p_source_path='/order/reverse/return/detail/list'
    then v_total else least(p_page_size,greatest(0,v_total-(p_page_number-1)*p_page_size)) end;
  v_next_page:=case when p_pagination->'nextPage'='null'::jsonb then null
    else (p_pagination->>'nextPage')::integer end;
  if (p_pagination->>'pageNumber')::integer<>p_page_number
     or (p_pagination->>'pageSize')::integer<>p_page_size
     or v_total<0 or v_entry_count<0 or v_entry_count>100 or v_entry_count<>v_expected_entry_count
     or (v_has_more and (jsonb_typeof(p_pagination->'nextPage') is distinct from 'number'
       or v_entry_count=0 or v_next_page<>p_page_number+1))
     or (not v_has_more and jsonb_typeof(p_pagination->'nextPage') is distinct from 'null')
     or (p_source_path='/order/reverse/return/detail/list' and (
       p_pagination->>'kind'<>'single_page' or p_page_number<>1 or v_has_more
       or v_total<>v_entry_count
     ))
     or (p_source_path<>'/order/reverse/return/detail/list' and (
       p_pagination->>'kind'<>'provider_page'
       or v_entry_count>p_page_size
       or v_has_more<>(p_page_number*p_page_size<v_total)
     )) then
    raise exception 'LAZADA_SUPPLEMENTAL_PAGINATION_INVALID' using errcode='22023';
  end if;
  select progress.* into v_progress
    from sellerpilot_private.lazada_supplemental_read_progress progress
   where progress.continuation_id=p_continuation_id
   for update;
  if not found
     or v_progress.credential_id<>p_credential_id or v_progress.country<>v_country
     or v_progress.surface<>p_surface or v_progress.source_path<>p_source_path
     or v_progress.resource_id<>v_resource or v_progress.page_size<>p_page_size then
    raise exception 'LAZADA_SUPPLEMENTAL_CONTINUATION_BINDING_MISMATCH' using errcode='42501';
  end if;
  if not exists(
    select 1
      from sellerpilot_private.lazada_supplemental_read_grants capability_grant
      join sellerpilot_private.cs_credential_capability_bindings binding
        on binding.id=capability_grant.binding_id
      join sellerpilot_private.channel_credentials credential on credential.id=capability_grant.credential_id
     where capability_grant.id=v_progress.grant_id
       and capability_grant.credential_id=v_progress.credential_id
       and capability_grant.seller_account_key=v_progress.seller_account_key
       and capability_grant.country=v_progress.country and capability_grant.surface=v_progress.surface
       and capability_grant.source_path=v_progress.source_path and capability_grant.status='active'
       and (capability_grant.expires_at is null or capability_grant.expires_at>v_now)
       and binding.credential_id=credential.id and binding.channel='lazada'
       and binding.operation='inquiries.list' and upper(binding.country)=v_progress.country
       and binding.target_fingerprint=capability_grant.binding_target_fingerprint
       and binding.status='active' and (binding.expires_at is null or binding.expires_at>v_now)
       and credential.channel='lazada' and credential.environment='production'
       and credential.status='active' and (credential.expires_at is null or credential.expires_at>v_now)
       and credential.seller_account_key=v_progress.seller_account_key
       and credential.seller_account_key_source='provider_certified_v1'
       and credential.seller_account_verified_at is not null
  ) then
    raise exception 'LAZADA_SUPPLEMENTAL_EXACT_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  v_digest:=encode(extensions.digest(convert_to(
    concat_ws(E'\x1f',p_credential_id::text,v_country,p_surface,p_source_path,v_resource,
      p_page_number::text,p_page_size::text,p_rows::text,p_pagination::text),'UTF8'
  ),'sha256'),'hex');
  if v_progress.last_page_number=p_page_number
     and v_progress.last_page_digest=v_digest and v_progress.last_receipt is not null then
    return v_progress.last_receipt || jsonb_build_object('replayed',true);
  end if;
  if v_progress.complete or v_progress.revision<>p_expected_revision
     or v_progress.next_page<>p_page_number then
    raise exception 'LAZADA_SUPPLEMENTAL_CONTINUATION_CONFLICT' using errcode='40001';
  end if;
  select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
    p_credential_id,v_country,p_surface,p_source_path,p_rows
  ) into v_writer;
  v_receipt:=jsonb_build_object(
    'contractVersion','sellerpilot-lazada-supplemental-page-ingest/1',
    'continuationId',v_progress.continuation_id,'revision',v_progress.revision+1,
    'credentialId',p_credential_id,'country',v_country,'surface',p_surface,
    'sourcePath',p_source_path,'pageNumber',p_page_number,
    'complete',not v_has_more,'nextPage',v_next_page,'replayed',false,
    'readOnly',true,'mutationAllowed',false,'writerReceipt',v_writer
  );
  update sellerpilot_private.lazada_supplemental_read_progress set
    next_page=coalesce(v_next_page,p_page_number),revision=revision+1,
    complete=not v_has_more,last_page_number=p_page_number,last_page_digest=v_digest,
    last_receipt=v_receipt,updated_at=v_now
   where continuation_id=v_progress.continuation_id;
  return v_receipt;
end
$$;

revoke all on function public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(uuid,jsonb)
  to service_role;
revoke all on function public.sellerpilot_service_prepare_lazada_supplemental_read_v1(uuid,text,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_prepare_lazada_supplemental_read_v1(uuid,text,text,text,integer)
  to service_role;
revoke all on function public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
  uuid,bigint,uuid,text,text,text,text,integer,integer,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
  uuid,bigint,uuid,text,text,text,text,integer,integer,jsonb,jsonb
) to service_role;

comment on table sellerpilot_private.lazada_supplemental_read_grants is
  'Separate server-verified per-account, country, surface and endpoint read grants; generic IM binding is insufficient.';
comment on table sellerpilot_private.lazada_supplemental_read_progress is
  'Durable one-page continuation state advanced only by atomic canonical ingest success.';
comment on function public.sellerpilot_service_prepare_lazada_supplemental_read_v1(uuid,text,text,text,integer) is
  'Authorizes one exact supplemental GET page before any provider network call.';
comment on function public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
  uuid,bigint,uuid,text,text,text,text,integer,integer,jsonb,jsonb
) is 'Atomically invokes the canonical ledger writer and then acknowledges one validated provider page.';

notify pgrst,'reload schema';
commit;
