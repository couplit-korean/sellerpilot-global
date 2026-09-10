-- Permission-gated Lazada Product Review reply ledger.
-- This is distinct from Lazada IM replies and from reverse-order commerce mutations.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.cs_credential_capability_bindings') is null
     or to_regclass('sellerpilot_private.lazada_supplemental_cs_events') is null
     or to_regprocedure('public.sellerpilot_is_admin()') is null
     or to_regprocedure('public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)') is null
     or to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is null
     or to_regprocedure('public.sellerpilot_09100000_begin_gateway_mutation_unsafe(text,uuid,uuid)') is null
     or to_regprocedure('public.sellerpilot_09100000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)') is null then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_PREIMAGE_MISSING';
  end if;
  if to_regclass('sellerpilot_private.lazada_product_review_reply_grants') is not null
     or to_regclass('sellerpilot_private.lazada_product_review_reply_deliveries') is not null then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_ALREADY_INSTALLED';
  end if;
end
$$;

create table sellerpilot_private.lazada_product_review_reply_grants(
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  binding_id uuid not null references sellerpilot_private.cs_credential_capability_bindings(id) on delete restrict,
  seller_account_key text not null check(seller_account_key ~ '^[a-f0-9]{64}$'),
  country text not null check(country in('SG','MY','TH','VN','ID','PH')),
  reply_path text not null check(reply_path='/review/seller/reply/add'),
  readback_path text not null check(readback_path='/review/seller/list/v2'),
  verification_source text not null check(verification_source='lazada_app_permission_readback'),
  reply_provider_request_id text not null check(length(reply_provider_request_id) between 1 and 240),
  readback_provider_request_id text not null check(length(readback_provider_request_id) between 1 and 240),
  evidence_digest text not null check(evidence_digest ~ '^[a-f0-9]{64}$'),
  status text not null check(status in('active','revoked','expired','superseded')),
  verified_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(credential_id,country)
);
alter table sellerpilot_private.lazada_product_review_reply_grants enable row level security;
revoke all on sellerpilot_private.lazada_product_review_reply_grants from public,anon,authenticated,service_role;

create table sellerpilot_private.lazada_product_review_reply_deliveries(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  grant_id uuid not null references sellerpilot_private.lazada_product_review_reply_grants(id) on delete restrict,
  seller_account_key text not null check(seller_account_key ~ '^[a-f0-9]{64}$'),
  country text not null check(country in('SG','MY','TH','VN','ID','PH')),
  review_id text not null check(review_id ~ '^[1-9][0-9]{0,31}$'),
  review_generation bigint not null check(review_generation>=1),
  review_event_key text not null check(review_event_key ~ '^[a-f0-9]{64}$'),
  reply_text text not null check(length(reply_text) between 1 and 500),
  reply_fingerprint text not null check(reply_fingerprint ~ '^[a-f0-9]{64}$'),
  identity_fingerprint text not null check(identity_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check(status in('prepared','queued','running','readback_required','verified','failed')),
  gateway_job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  readback_job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  provider_request_id text,
  last_error text,
  reply_observed_at timestamptz,
  revision bigint not null default 0 check(revision>=0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(credential_id,country,review_id),
  unique(identity_fingerprint)
);
create index lazada_product_review_reply_attention_idx
  on sellerpilot_private.lazada_product_review_reply_deliveries(updated_at desc,id desc)
  where status in('queued','running','readback_required');
alter table sellerpilot_private.lazada_product_review_reply_deliveries enable row level security;
revoke all on sellerpilot_private.lazada_product_review_reply_deliveries from public,anon,authenticated,service_role;

create function public.sellerpilot_service_record_lazada_product_review_reply_grant_v1(
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
  v_country text:=upper(trim(coalesce(p_evidence->>'country','')));
  v_id uuid;
  v_now timestamptz:=clock_timestamp();
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if p_binding_id is null or jsonb_typeof(p_evidence) is distinct from 'object'
     or p_evidence->>'contract' is distinct from 'sellerpilot-lazada-product-review-reply-permission/1'
     or p_evidence->>'verificationSource' is distinct from 'lazada_app_permission_readback'
     or p_evidence->>'replyPath' is distinct from '/review/seller/reply/add'
     or p_evidence->>'readbackPath' is distinct from '/review/seller/list/v2'
     or coalesce(p_evidence->>'sellerAccountKey','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_evidence->>'evidenceDigest','') !~ '^[a-f0-9]{64}$'
     or length(coalesce(p_evidence->>'replyProviderRequestId','')) not between 1 and 240
     or length(coalesce(p_evidence->>'readbackProviderRequestId','')) not between 1 and 240
     or v_country not in('SG','MY','TH','VN','ID','PH') then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_GRANT_INVALID' using errcode='22023';
  end if;
  select binding.id,binding.credential_id,binding.country,binding.expires_at,
         credential.seller_account_key,credential.expires_at credential_expires_at
    into v_binding
    from sellerpilot_private.cs_credential_capability_bindings binding
    join sellerpilot_private.channel_credentials credential on credential.id=binding.credential_id
   where binding.id=p_binding_id and binding.channel='lazada'
     and binding.operation='inquiries.reply' and binding.status='active'
     and (binding.expires_at is null or binding.expires_at>v_now)
     and credential.channel='lazada' and credential.environment='production'
     and credential.status='active' and (credential.expires_at is null or credential.expires_at>v_now)
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found or upper(v_binding.country) is distinct from v_country
     or v_binding.credential_id::text is distinct from p_evidence->>'credentialId'
     or v_binding.seller_account_key is distinct from p_evidence->>'sellerAccountKey' then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_GRANT_BINDING_MISMATCH' using errcode='42501';
  end if;
  insert into sellerpilot_private.lazada_product_review_reply_grants(
    credential_id,binding_id,seller_account_key,country,reply_path,readback_path,
    verification_source,reply_provider_request_id,readback_provider_request_id,
    evidence_digest,status,verified_at,expires_at,updated_at
  ) values(
    v_binding.credential_id,v_binding.id,v_binding.seller_account_key,v_country,
    '/review/seller/reply/add','/review/seller/list/v2','lazada_app_permission_readback',
    p_evidence->>'replyProviderRequestId',p_evidence->>'readbackProviderRequestId',
    p_evidence->>'evidenceDigest','active',v_now,
    least(v_binding.expires_at,v_binding.credential_expires_at),v_now
  ) on conflict(credential_id,country) do update set
    binding_id=excluded.binding_id,seller_account_key=excluded.seller_account_key,
    reply_provider_request_id=excluded.reply_provider_request_id,
    readback_provider_request_id=excluded.readback_provider_request_id,
    evidence_digest=excluded.evidence_digest,status='active',verified_at=v_now,
    expires_at=excluded.expires_at,updated_at=v_now
  returning id into v_id;
  return jsonb_build_object('contract','sellerpilot-lazada-product-review-reply-grant/1',
    'grantId',v_id,'credentialId',v_binding.credential_id,'country',v_country,
    'status','active','providerMutationPerformed',false);
end
$$;

create function public.sellerpilot_prepare_lazada_product_review_reply_v1(
  p_credential_id uuid,
  p_country text,
  p_review_id text,
  p_generation bigint,
  p_reply_text text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_country text:=upper(trim(coalesce(p_country,'')));
  v_review text:=trim(coalesce(p_review_id,''));
  v_reply text:=trim(coalesce(p_reply_text,''));
  v_now timestamptz:=clock_timestamp();
  v_credential record;
  v_grant record;
  v_event record;
  v_delivery record;
  v_reply_fingerprint text;
  v_identity text;
  v_inserted boolean:=false;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_credential_id is null or v_country not in('SG','MY','TH','VN','ID','PH')
     or v_review !~ '^[1-9][0-9]{0,31}$' or p_generation is null or p_generation<1
     or length(v_reply) not between 1 and 500 then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_PREPARE_INVALID' using errcode='22023';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='lazada'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>v_now)
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_CREDENTIAL_UNBOUND' using errcode='42501'; end if;
  select capability.* into v_grant
    from sellerpilot_private.lazada_product_review_reply_grants capability
    join sellerpilot_private.cs_credential_capability_bindings binding on binding.id=capability.binding_id
   where capability.credential_id=v_credential.id and capability.country=v_country
     and capability.seller_account_key=v_credential.seller_account_key
     and capability.reply_path='/review/seller/reply/add'
     and capability.readback_path='/review/seller/list/v2'
     and capability.verification_source='lazada_app_permission_readback'
     and capability.status='active' and (capability.expires_at is null or capability.expires_at>v_now)
     and binding.credential_id=v_credential.id and binding.channel='lazada'
     and binding.operation='inquiries.reply' and upper(binding.country)=v_country
     and binding.status='active' and (binding.expires_at is null or binding.expires_at>v_now)
   order by capability.verified_at desc limit 1;
  if not found then raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_PERMISSION_REQUIRED' using errcode='42501'; end if;
  select event.*,
         greatest(1,floor(extract(epoch from event.observed_at)*1000)::bigint) provider_generation
    into v_event
    from sellerpilot_private.lazada_supplemental_cs_events event
   where event.credential_id=v_credential.id and event.seller_account_key=v_credential.seller_account_key
     and event.country=v_country and event.surface='product_review'
     and event.provider_context->>'reviewId'=v_review
   order by event.observed_at desc,event.event_key desc limit 1;
  if not found then raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_REVIEW_ACCOUNT_MISMATCH' using errcode='42501'; end if;
  if v_event.provider_generation<>p_generation then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_GENERATION_STALE' using errcode='40001';
  end if;
  if coalesce(v_event.provider_context->>'reviewType','PRODUCT_REVIEW')<>'PRODUCT_REVIEW'
     or coalesce(v_event.provider_context->>'sellerReply','')<>'' then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_ALREADY_REPLIED' using errcode='23505';
  end if;
  v_reply_fingerprint:=encode(extensions.digest(v_reply,'sha256'),'hex');
  v_identity:=encode(extensions.digest(concat_ws(E'\x1f',v_credential.seller_account_key,
    v_country,v_review,p_generation::text,v_reply_fingerprint),'sha256'),'hex');
  insert into sellerpilot_private.lazada_product_review_reply_deliveries(
    owner_id,credential_id,grant_id,seller_account_key,country,review_id,review_generation,
    review_event_key,reply_text,reply_fingerprint,identity_fingerprint,status
  ) values(
    v_credential.created_by,v_credential.id,v_grant.id,v_credential.seller_account_key,
    v_country,v_review,p_generation,v_event.event_key,v_reply,v_reply_fingerprint,v_identity,'prepared'
  ) on conflict(credential_id,country,review_id) do nothing
  returning true into v_inserted;
  select delivery.* into v_delivery
    from sellerpilot_private.lazada_product_review_reply_deliveries delivery
   where delivery.credential_id=v_credential.id and delivery.country=v_country
     and delivery.review_id=v_review for update;
  if v_delivery.identity_fingerprint<>v_identity
     or v_delivery.review_generation<>p_generation
     or v_delivery.reply_fingerprint<>v_reply_fingerprint then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_CONFLICT' using errcode='23505';
  end if;
  return jsonb_build_object('contract','sellerpilot-lazada-product-review-reply-prepare/1',
    'deliveryId',v_delivery.id,'credentialId',v_delivery.credential_id,'country',v_delivery.country,
    'sellerAccountKey',v_delivery.seller_account_key,'reviewId',v_delivery.review_id,
    'generation',v_delivery.review_generation,'identityFingerprint',v_delivery.identity_fingerprint,
    'status',v_delivery.status,'replayed',not coalesce(v_inserted,false),
    'providerMutationPerformed',false);
end
$$;

create function sellerpilot_private.assert_lazada_product_review_reply_delivery_v1(
  p_delivery_id uuid,
  p_expected_identity_fingerprint text,
  p_require_current_generation boolean
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_delivery record;
  v_event record;
  v_now timestamptz:=clock_timestamp();
  v_reply_fingerprint text;
  v_identity text;
begin
  select delivery.* into v_delivery
    from sellerpilot_private.lazada_product_review_reply_deliveries delivery
    join sellerpilot_private.channel_credentials credential
      on credential.id=delivery.credential_id
    join sellerpilot_private.lazada_product_review_reply_grants capability
      on capability.id=delivery.grant_id
    join sellerpilot_private.cs_credential_capability_bindings binding
      on binding.id=capability.binding_id
   where delivery.id=p_delivery_id
     and delivery.identity_fingerprint=p_expected_identity_fingerprint
     and credential.channel='lazada' and credential.environment='production'
     and credential.status='active' and (credential.expires_at is null or credential.expires_at>v_now)
     and credential.seller_account_key=delivery.seller_account_key
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and capability.credential_id=delivery.credential_id
     and capability.country=delivery.country
     and capability.seller_account_key=delivery.seller_account_key
     and capability.reply_path='/review/seller/reply/add'
     and capability.readback_path='/review/seller/list/v2'
     and capability.verification_source='lazada_app_permission_readback'
     and capability.status='active'
     and (capability.expires_at is null or capability.expires_at>v_now)
     and binding.credential_id=delivery.credential_id
     and binding.channel='lazada' and binding.operation='inquiries.reply'
     and upper(binding.country)=delivery.country and binding.status='active'
     and (binding.expires_at is null or binding.expires_at>v_now);
  if not found then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_PERMISSION_REVOKED' using errcode='42501';
  end if;
  if p_require_current_generation then
    select event.*,
           greatest(1,floor(extract(epoch from event.observed_at)*1000)::bigint) provider_generation
      into v_event
      from sellerpilot_private.lazada_supplemental_cs_events event
     where event.credential_id=v_delivery.credential_id
       and event.seller_account_key=v_delivery.seller_account_key
       and event.country=v_delivery.country and event.surface='product_review'
       and event.provider_context->>'reviewId'=v_delivery.review_id
     order by event.observed_at desc,event.event_key desc limit 1;
    if not found or v_event.provider_generation<>v_delivery.review_generation
       or v_event.event_key<>v_delivery.review_event_key then
      raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_GENERATION_STALE' using errcode='40001';
    end if;
    if coalesce(v_event.provider_context->>'reviewType','PRODUCT_REVIEW')<>'PRODUCT_REVIEW'
       or coalesce(v_event.provider_context->>'sellerReply','')<>'' then
      raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_REVIEW_CONFLICT' using errcode='40001';
    end if;
  end if;
  v_reply_fingerprint:=encode(extensions.digest(v_delivery.reply_text,'sha256'),'hex');
  v_identity:=encode(extensions.digest(concat_ws(E'\x1f',v_delivery.seller_account_key,
    v_delivery.country,v_delivery.review_id,v_delivery.review_generation::text,v_reply_fingerprint),'sha256'),'hex');
  if v_reply_fingerprint<>v_delivery.reply_fingerprint or v_identity<>v_delivery.identity_fingerprint then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_IDENTITY_STALE' using errcode='40001';
  end if;
  return true;
end
$$;

create function sellerpilot_private.assert_lazada_product_review_reply_job_v1(
  p_job_id uuid,
  p_readback_only boolean
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare v_job record; v_delivery record; v_meta jsonb; v_arguments jsonb;
begin
  select job.* into v_job from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
  if not found then raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_JOB_MISSING' using errcode='42501'; end if;
  v_meta:=v_job.request_payload#>'{sellerpilotLazadaProductReviewReply}';
  v_arguments:=v_job.request_payload->'arguments';
  begin
    select delivery.* into strict v_delivery
      from sellerpilot_private.lazada_product_review_reply_deliveries delivery
     where delivery.id=(v_meta->>'deliveryId')::uuid;
  exception when others then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_JOB_BINDING_INVALID' using errcode='42501';
  end;
  if v_job.channel<>'lazada' or v_job.operation<>'inquiries.reply' or v_job.environment<>'production'
     or v_job.credential_id<>v_delivery.credential_id
     or v_job.seller_account_key is distinct from v_delivery.seller_account_key
     or v_meta->>'contract'<>'sellerpilot-lazada-product-review-reply-job/1'
     or v_meta->>'identityFingerprint' is distinct from v_delivery.identity_fingerprint
     or coalesce((v_meta->>'readbackOnly')::boolean,false) is distinct from p_readback_only
     or v_arguments->>'kind' is distinct from
       (case when p_readback_only then 'product_review_readback' else 'product_review' end)
     or v_arguments->>'deliveryId' is distinct from v_delivery.id::text
     or v_arguments->>'country' is distinct from v_delivery.country
     or v_arguments->>'sellerAccountKey' is distinct from v_delivery.seller_account_key
     or v_arguments->>'reviewId' is distinct from v_delivery.review_id
     or v_arguments->>'generation' is distinct from v_delivery.review_generation::text
     or v_arguments->>'identityFingerprint' is distinct from v_delivery.identity_fingerprint
     or v_arguments->>'reply' is distinct from v_delivery.reply_text
     or encode(extensions.digest(v_arguments->>'reply','sha256'),'hex')<>v_delivery.reply_fingerprint
     or (p_readback_only and v_delivery.readback_job_id is distinct from p_job_id)
     or (not p_readback_only and v_delivery.gateway_job_id is distinct from p_job_id) then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_JOB_BINDING_INVALID' using errcode='42501';
  end if;
  perform sellerpilot_private.assert_lazada_product_review_reply_delivery_v1(
    v_delivery.id,v_delivery.identity_fingerprint,not p_readback_only
  );
  return true;
end
$$;

create function public.sellerpilot_enqueue_lazada_product_review_reply_v1(
  p_delivery_id uuid,
  p_expected_identity_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_delivery record;
  v_job uuid;
  v_replayed boolean:=false;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select delivery.* into v_delivery
    from sellerpilot_private.lazada_product_review_reply_deliveries delivery
   where delivery.id=p_delivery_id for update;
  if not found or v_delivery.identity_fingerprint is distinct from p_expected_identity_fingerprint then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_ENQUEUE_BINDING_MISMATCH' using errcode='42501';
  end if;
  if v_delivery.status in('verified','readback_required') then
    perform sellerpilot_private.assert_lazada_product_review_reply_delivery_v1(
      v_delivery.id,p_expected_identity_fingerprint,false
    );
    return jsonb_build_object('contract','sellerpilot-lazada-product-review-reply-enqueue/1',
      'deliveryId',v_delivery.id,'jobId',v_delivery.gateway_job_id,'status',v_delivery.status,
      'replayed',true,'providerMutationPerformed',false,'automaticResendAllowed',false);
  end if;
  perform sellerpilot_private.assert_lazada_product_review_reply_delivery_v1(
    v_delivery.id,p_expected_identity_fingerprint,true
  );
  if v_delivery.gateway_job_id is not null then
    v_job:=v_delivery.gateway_job_id; v_replayed:=true;
  else
    insert into sellerpilot_private.channel_gateway_jobs(
      credential_id,channel,operation,environment,request_payload,created_by,seller_account_key
    ) values(
      v_delivery.credential_id,'lazada','inquiries.reply','production',jsonb_build_object(
        'arguments',jsonb_build_object('kind','product_review','deliveryId',v_delivery.id,
          'country',v_delivery.country,'sellerAccountKey',v_delivery.seller_account_key,
          'reviewId',v_delivery.review_id,'generation',v_delivery.review_generation,
          'identityFingerprint',v_delivery.identity_fingerprint,'reply',v_delivery.reply_text),
        'sellerpilotLazadaProductReviewReply',jsonb_build_object(
          'contract','sellerpilot-lazada-product-review-reply-job/1','deliveryId',v_delivery.id,
          'identityFingerprint',v_delivery.identity_fingerprint)
      ),v_delivery.owner_id,v_delivery.seller_account_key
    ) returning id into v_job;
    update sellerpilot_private.lazada_product_review_reply_deliveries
       set gateway_job_id=v_job,status='queued',revision=revision+1,updated_at=clock_timestamp()
     where id=v_delivery.id;
  end if;
  select delivery.* into v_delivery
    from sellerpilot_private.lazada_product_review_reply_deliveries delivery
   where delivery.id=p_delivery_id;
  perform sellerpilot_private.assert_lazada_product_review_reply_job_v1(v_job,false);
  return jsonb_build_object('contract','sellerpilot-lazada-product-review-reply-enqueue/1',
    'deliveryId',v_delivery.id,'jobId',v_job,'status',v_delivery.status,'replayed',v_replayed,
    'providerMutationPerformed',false,'automaticResendAllowed',false);
end
$$;

create function public.sellerpilot_enqueue_lazada_product_review_readback_v1(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_delivery record; v_job uuid;
begin
  if not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode='42501'; end if;
  select delivery.* into v_delivery from sellerpilot_private.lazada_product_review_reply_deliveries delivery
   where delivery.id=p_delivery_id for update;
  if not found or v_delivery.status<>'readback_required' then
    raise exception 'LAZADA_PRODUCT_REVIEW_READBACK_NOT_REQUIRED' using errcode='22023';
  end if;
  perform sellerpilot_private.assert_lazada_product_review_reply_delivery_v1(
    v_delivery.id,v_delivery.identity_fingerprint,false
  );
  if v_delivery.readback_job_id is not null then v_job:=v_delivery.readback_job_id;
  else
    insert into sellerpilot_private.channel_gateway_jobs(
      credential_id,channel,operation,environment,request_payload,created_by,seller_account_key
    ) values(v_delivery.credential_id,'lazada','inquiries.reply','production',jsonb_build_object(
      'arguments',jsonb_build_object('kind','product_review_readback','deliveryId',v_delivery.id,
        'country',v_delivery.country,'sellerAccountKey',v_delivery.seller_account_key,
        'reviewId',v_delivery.review_id,'generation',v_delivery.review_generation,
        'identityFingerprint',v_delivery.identity_fingerprint,'reply',v_delivery.reply_text),
      'sellerpilotLazadaProductReviewReply',jsonb_build_object(
        'contract','sellerpilot-lazada-product-review-reply-job/1','deliveryId',v_delivery.id,
        'identityFingerprint',v_delivery.identity_fingerprint,'readbackOnly',true)
    ),v_delivery.owner_id,v_delivery.seller_account_key) returning id into v_job;
    update sellerpilot_private.lazada_product_review_reply_deliveries
       set readback_job_id=v_job,revision=revision+1,updated_at=clock_timestamp() where id=v_delivery.id;
  end if;
  perform sellerpilot_private.assert_lazada_product_review_reply_job_v1(v_job,true);
  return jsonb_build_object('contract','sellerpilot-lazada-product-review-readback-enqueue/1',
    'deliveryId',v_delivery.id,'jobId',v_job,'status','queued','readbackOnly',true,
    'providerMutationPerformed',false,'automaticResendAllowed',false);
end $$;

create function sellerpilot_private.guard_lazada_product_review_reply_job_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_meta jsonb; v_readback_only boolean;
begin
  v_meta:=new.request_payload#>'{sellerpilotLazadaProductReviewReply}';
  if v_meta->>'contract' is distinct from 'sellerpilot-lazada-product-review-reply-job/1' then
    return new;
  end if;
  if tg_op='UPDATE' and new.request_payload is distinct from old.request_payload then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_JOB_IMMUTABLE' using errcode='42501';
  end if;
  v_readback_only:=coalesce((v_meta->>'readbackOnly')::boolean,false);
  if tg_op='UPDATE' and new.status='running' and old.status is distinct from 'running' then
    perform sellerpilot_private.assert_lazada_product_review_reply_job_v1(new.id,v_readback_only);
  end if;
  return new;
end $$;

create trigger guard_lazada_product_review_reply_job
before update of request_payload,status
on sellerpilot_private.channel_gateway_jobs for each row
execute function sellerpilot_private.guard_lazada_product_review_reply_job_v1();

create function sellerpilot_private.sync_lazada_product_review_reply_delivery()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_delivery_id uuid; v_delivery record; v_readback jsonb;
begin
  if new.channel<>'lazada' or new.operation<>'inquiries.reply'
     or new.request_payload#>>'{sellerpilotLazadaProductReviewReply,contract}'
        is distinct from 'sellerpilot-lazada-product-review-reply-job/1' then return new; end if;
  begin v_delivery_id:=(new.request_payload#>>'{sellerpilotLazadaProductReviewReply,deliveryId}')::uuid;
  exception when others then return new; end;
  select delivery.* into v_delivery from sellerpilot_private.lazada_product_review_reply_deliveries delivery
   where delivery.id=v_delivery_id for update;
  if not found or v_delivery.credential_id<>new.credential_id
     or v_delivery.identity_fingerprint is distinct from
        new.request_payload#>>'{sellerpilotLazadaProductReviewReply,identityFingerprint}' then return new; end if;
  if not (
    new.credential_id=v_delivery.credential_id
    and new.seller_account_key is not distinct from v_delivery.seller_account_key
    and new.environment='production'
    and new.request_payload#>>'{arguments,deliveryId}'=v_delivery.id::text
    and new.request_payload#>>'{arguments,country}'=v_delivery.country
    and new.request_payload#>>'{arguments,sellerAccountKey}'=v_delivery.seller_account_key
    and new.request_payload#>>'{arguments,reviewId}'=v_delivery.review_id
    and new.request_payload#>>'{arguments,generation}'=v_delivery.review_generation::text
    and new.request_payload#>>'{arguments,identityFingerprint}'=v_delivery.identity_fingerprint
    and new.request_payload#>>'{arguments,reply}'=v_delivery.reply_text
    and encode(extensions.digest(new.request_payload#>>'{arguments,reply}','sha256'),'hex')=v_delivery.reply_fingerprint
    and (
      (new.id=v_delivery.gateway_job_id
        and new.request_payload#>>'{arguments,kind}'='product_review'
        and coalesce((new.request_payload#>>'{sellerpilotLazadaProductReviewReply,readbackOnly}')::boolean,false)=false)
      or
      (new.id=v_delivery.readback_job_id
        and new.request_payload#>>'{arguments,kind}'='product_review_readback'
        and new.request_payload#>>'{sellerpilotLazadaProductReviewReply,readbackOnly}'='true')
    )
  ) then return new; end if;
  v_readback:=new.response_payload#>'{steps,0,data,sellerpilotLazadaProductReviewReadback}';
  if new.status='succeeded' and new.response_payload @> '{"ok":true}'::jsonb
     and v_readback->>'contract'='sellerpilot-lazada-product-review-reply-readback/1'
     and v_readback->>'deliveryId'=v_delivery.id::text
     and v_readback->>'country'=v_delivery.country
     and v_readback->>'reviewId'=v_delivery.review_id
     and v_readback->>'generation'=v_delivery.review_generation::text
     and v_readback->>'identityFingerprint'=v_delivery.identity_fingerprint
     and v_readback->>'state'='verified' and v_readback->>'exactReplyObserved'='true' then
    update sellerpilot_private.lazada_product_review_reply_deliveries set status='verified',
      provider_request_id=nullif(new.response_payload#>>'{steps,0,requestId}',''),
      reply_observed_at=clock_timestamp(),last_error=null,revision=revision+1,updated_at=clock_timestamp()
     where id=v_delivery.id;
  elsif new.status='running' then
    update sellerpilot_private.lazada_product_review_reply_deliveries set status='running',
      revision=revision+1,updated_at=clock_timestamp() where id=v_delivery.id and status='queued';
  elsif new.status in('failed','reconciliation_required','succeeded') and
        (new.provider_mutation_started_at is not null
         or new.request_payload#>>'{sellerpilotLazadaProductReviewReply,readbackOnly}'='true') then
    update sellerpilot_private.lazada_product_review_reply_deliveries set status='readback_required',
      last_error=left(coalesce(new.error_message,v_readback->>'state','READBACK_REQUIRED'),500),
      revision=revision+1,updated_at=clock_timestamp() where id=v_delivery.id and status<>'verified';
  elsif new.status in('failed','cancelled') then
    update sellerpilot_private.lazada_product_review_reply_deliveries set status='failed',
      last_error=left(coalesce(new.error_message,'PRE_PROVIDER_FAILURE'),500),
      revision=revision+1,updated_at=clock_timestamp() where id=v_delivery.id and status<>'verified';
  end if;
  return new;
end $$;

create trigger sync_lazada_product_review_reply_delivery
after update of status,response_payload,error_message,provider_mutation_started_at
on sellerpilot_private.channel_gateway_jobs for each row
execute function sellerpilot_private.sync_lazada_product_review_reply_delivery();

-- The canonical inquiry-reply completion layer may conservatively demote a
-- product-review readback to reconciliation_required because this dedicated
-- lineage intentionally has no support-ticket metadata. Project verified only
-- after that canonical layer has inserted its exact claim-bound receipt.
create function sellerpilot_private.sync_lazada_product_review_reply_receipt_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_job record; v_delivery record; v_readback jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=new.job_id
     and job.channel='lazada' and job.operation='inquiries.reply'
     and job.status in('succeeded','reconciliation_required')
     and job.request_payload#>>'{sellerpilotLazadaProductReviewReply,contract}'=
       'sellerpilot-lazada-product-review-reply-job/1'
     and job.request_payload#>>'{sellerpilotLazadaProductReviewReply,readbackOnly}'='true'
     and job.request_payload#>>'{arguments,kind}'='product_review_readback';
  if not found then return new; end if;
  begin
    select delivery.* into strict v_delivery
      from sellerpilot_private.lazada_product_review_reply_deliveries delivery
     where delivery.id=(v_job.request_payload#>>'{sellerpilotLazadaProductReviewReply,deliveryId}')::uuid
       and delivery.readback_job_id=v_job.id
       and delivery.credential_id=v_job.credential_id
       and delivery.seller_account_key is not distinct from v_job.seller_account_key
       and delivery.identity_fingerprint=
         v_job.request_payload#>>'{sellerpilotLazadaProductReviewReply,identityFingerprint}';
  exception when others then return new; end;
  if new.claim_token is null or new.worker_token_id is null then return new; end if;
  v_readback:=v_job.response_payload#>'{steps,0,data,sellerpilotLazadaProductReviewReadback}';
  if v_job.response_payload @> '{"ok":true}'::jsonb
     and v_job.request_payload#>>'{arguments,deliveryId}'=v_delivery.id::text
     and v_job.request_payload#>>'{arguments,country}'=v_delivery.country
     and v_job.request_payload#>>'{arguments,sellerAccountKey}'=v_delivery.seller_account_key
     and v_job.request_payload#>>'{arguments,reviewId}'=v_delivery.review_id
     and v_job.request_payload#>>'{arguments,generation}'=v_delivery.review_generation::text
     and v_job.request_payload#>>'{arguments,identityFingerprint}'=v_delivery.identity_fingerprint
     and v_job.request_payload#>>'{arguments,reply}'=v_delivery.reply_text
     and encode(extensions.digest(v_job.request_payload#>>'{arguments,reply}','sha256'),'hex')=
       v_delivery.reply_fingerprint
     and v_readback->>'contract'='sellerpilot-lazada-product-review-reply-readback/1'
     and v_readback->>'deliveryId'=v_delivery.id::text
     and v_readback->>'country'=v_delivery.country
     and v_readback->>'reviewId'=v_delivery.review_id
     and v_readback->>'generation'=v_delivery.review_generation::text
     and v_readback->>'identityFingerprint'=v_delivery.identity_fingerprint
     and v_readback->>'state'='verified'
     and v_readback->>'exactReplyObserved'='true' then
    update sellerpilot_private.lazada_product_review_reply_deliveries set
      status='verified',
      provider_request_id=nullif(v_job.response_payload#>>'{steps,0,requestId}',''),
      reply_observed_at=clock_timestamp(),last_error=null,
      revision=revision+1,updated_at=clock_timestamp()
     where id=v_delivery.id and status<>'verified';
  end if;
  return new;
end $$;
revoke all on function sellerpilot_private.sync_lazada_product_review_reply_receipt_v1()
  from public,anon,authenticated,service_role;
do $$
begin
  if to_regclass('sellerpilot_private.gateway_completion_receipts') is not null then
    execute 'create trigger sync_lazada_product_review_reply_receipt
      after insert on sellerpilot_private.gateway_completion_receipts for each row
      execute function sellerpilot_private.sync_lazada_product_review_reply_receipt_v1()';
  end if;
end $$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_061000_begin_gateway_provider_mutation_before_product_review;
create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_kind text; v_contract text;
begin
  select job.request_payload#>>'{arguments,kind}',
         job.request_payload#>>'{sellerpilotLazadaProductReviewReply,contract}'
    into v_kind,v_contract
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id and job.channel='lazada' and job.operation='inquiries.reply';
  if v_contract is distinct from 'sellerpilot-lazada-product-review-reply-job/1' then
    return public.sellerpilot_061000_begin_gateway_provider_mutation_before_product_review(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  if v_kind='product_review_readback' then
    perform sellerpilot_private.assert_lazada_product_review_reply_job_v1(p_job_id,true);
    return false;
  end if;
  if v_kind is distinct from 'product_review' then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_JOB_BINDING_INVALID' using errcode='42501';
  end if;
  perform sellerpilot_private.assert_lazada_product_review_reply_job_v1(p_job_id,false);
  return public.sellerpilot_09100000_begin_gateway_mutation_unsafe(
    p_token_hash,p_job_id,p_claim_token
  );
end $$;

alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_061000_begin_serverless_gateway_provider_mutation_before_product_review;
create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_kind text; v_contract text;
begin
  select job.request_payload#>>'{arguments,kind}',
         job.request_payload#>>'{sellerpilotLazadaProductReviewReply,contract}'
    into v_kind,v_contract
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id and job.channel='lazada' and job.operation='inquiries.reply';
  if v_contract is distinct from 'sellerpilot-lazada-product-review-reply-job/1' then
    return public.sellerpilot_061000_begin_serverless_gateway_provider_mutation_before_product_review(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  if v_kind='product_review_readback' then
    perform sellerpilot_private.assert_lazada_product_review_reply_job_v1(p_job_id,true);
    return false;
  end if;
  if v_kind is distinct from 'product_review' then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_JOB_BINDING_INVALID' using errcode='42501';
  end if;
  perform sellerpilot_private.assert_lazada_product_review_reply_job_v1(p_job_id,false);
  return public.sellerpilot_09100000_begin_serverless_gateway_mutation_unsafe(
    p_token_hash,p_job_id,p_claim_token
  );
end $$;

create function public.sellerpilot_get_lazada_product_review_reply_v1(p_delivery_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_delivery record;
begin
  if not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode='42501'; end if;
  select delivery.* into v_delivery from sellerpilot_private.lazada_product_review_reply_deliveries delivery
   where delivery.id=p_delivery_id;
  if not found then return null; end if;
  return jsonb_build_object('contract','sellerpilot-lazada-product-review-reply-status/1',
    'deliveryId',v_delivery.id,'credentialId',v_delivery.credential_id,'country',v_delivery.country,
    'reviewId',v_delivery.review_id,'generation',v_delivery.review_generation,
    'status',v_delivery.status,'gatewayJobId',v_delivery.gateway_job_id,
    'readbackJobId',v_delivery.readback_job_id,'revision',v_delivery.revision,
    'providerReadbackVerified',v_delivery.status='verified','automaticResendAllowed',false);
end $$;

revoke all on function public.sellerpilot_service_record_lazada_product_review_reply_grant_v1(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_lazada_product_review_reply_grant_v1(uuid,jsonb)
  to service_role;
revoke all on function public.sellerpilot_prepare_lazada_product_review_reply_v1(uuid,text,text,bigint,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_prepare_lazada_product_review_reply_v1(uuid,text,text,bigint,text)
  to authenticated;
revoke all on function public.sellerpilot_enqueue_lazada_product_review_reply_v1(uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_enqueue_lazada_product_review_reply_v1(uuid,text)
  to authenticated;
revoke all on function public.sellerpilot_enqueue_lazada_product_review_readback_v1(uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_enqueue_lazada_product_review_readback_v1(uuid)
  to authenticated;
revoke all on function public.sellerpilot_get_lazada_product_review_reply_v1(uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_lazada_product_review_reply_v1(uuid)
  to authenticated;
revoke all on function sellerpilot_private.assert_lazada_product_review_reply_delivery_v1(uuid,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.assert_lazada_product_review_reply_job_v1(uuid,boolean)
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.guard_lazada_product_review_reply_job_v1()
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.sync_lazada_product_review_reply_delivery()
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_061000_begin_gateway_provider_mutation_before_product_review(text,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  to service_role;
revoke all on function public.sellerpilot_061000_begin_serverless_gateway_provider_mutation_before_product_review(text,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
  to service_role;

comment on table sellerpilot_private.lazada_product_review_reply_deliveries is
  'One-reply-only Lazada Product Review ledger; separate from IM and reverse-order commerce.';
notify pgrst,'reload schema';
commit;
