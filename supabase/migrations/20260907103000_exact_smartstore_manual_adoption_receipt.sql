-- Record independently approved seller-center creation without rewriting the
-- failed API job, attempt, listing, product, approval, or publication gates.
-- Installing this migration records NO adoption and calls NO provider.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

create table sellerpilot_private.smartstore_manual_adoption_receipts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null unique references sellerpilot_private.product_listings(id) on delete restrict,
  source_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null unique references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version = 1),
  owner_id uuid not null references auth.users(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  seller_sku text not null check (seller_sku = 'AUTO-780720401E2D4E4EA45F'),
  origin_product_no text not null check (origin_product_no = '13688607602'),
  channel_product_no text not null check (channel_product_no = '13749310594'),
  public_url text not null check (public_url = 'https://smartstore.naver.com/coupletseoul/products/13749310594'),
  observation jsonb not null check (jsonb_typeof(observation) = 'object'),
  observation_sha256 text not null check (observation_sha256 ~ '^[a-f0-9]{64}$'),
  source_request_sha256 text not null check (source_request_sha256 = 'd4c2d09c56eceed36b63bc984b17efd2d42c1d412e4a098d15b91dcafad896d1'),
  source_response_sha256 text not null check (source_response_sha256 = 'bd22dc02ef6daa4b513565c6fe9a247cd98f1f55d1e9eabb2dcc7f9e1e98cbbf'),
  source_job_snapshot_sha256 text not null,
  source_attempt_snapshot_sha256 text not null,
  listing_snapshot_sha256 text not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  origin text not null default 'manual_seller_center' check (origin = 'manual_seller_center'),
  provider_call_replayed boolean not null default false check (not provider_call_replayed),
  content_verified boolean not null default false check (not content_verified),
  constraint smartstore_manual_adoption_exact_target check (
    product_id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
    and listing_id = '7b260562-1e41-4ddc-8509-cb78dc7292c5'::uuid
    and source_job_id = '66147e5d-0479-4c51-896e-97e782af99e1'::uuid
    and source_attempt_id = '0d2c492e-2025-4717-bb3f-0fd2b886fd4f'::uuid
    and credential_id = '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and recorded_by = owner_id
  ),
  unique (seller_account_key, origin_product_no),
  unique (seller_account_key, channel_product_no),
  unique (owner_id, product_id, seller_account_key, seller_sku)
);
alter table sellerpilot_private.smartstore_manual_adoption_receipts enable row level security;
revoke all on sellerpilot_private.smartstore_manual_adoption_receipts from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_manual_adoption_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'SMARTSTORE_MANUAL_RECEIPT_IMMUTABLE'; end if;
  if current_setting('sellerpilot.smartstore_manual_adoption_actor', true) is distinct from new.recorded_by::text
     or auth.uid() is distinct from new.recorded_by then
    raise exception 'SMARTSTORE_MANUAL_RECEIPT_AUTHENTICATED_RECORD_REQUIRED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function sellerpilot_private.guard_smartstore_manual_adoption_receipt() from public, anon, authenticated, service_role;
create trigger smartstore_manual_adoption_immutable before insert or update or delete
on sellerpilot_private.smartstore_manual_adoption_receipts for each row
execute function sellerpilot_private.guard_smartstore_manual_adoption_receipt();

create function public.sellerpilot_record_exact_smartstore_manual_adoption(p_observation jsonb)
returns jsonb language plpgsql security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  actor uuid := auth.uid();
  j sellerpilot_private.channel_gateway_jobs%rowtype;
  a sellerpilot_private.channel_operation_attempts%rowtype;
  l sellerpilot_private.product_listings%rowtype;
  p sellerpilot_private.products%rowtype;
  c sellerpilot_private.channel_credentials%rowtype;
  receipt sellerpilot_private.smartstore_manual_adoption_receipts%rowtype;
  obs_hash text; request_hash text; response_hash text;
  job_hash text; attempt_hash text; listing_hash text;
  observed timestamptz; approved timestamptz;
  keys text[];
begin
  if actor is distinct from '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or not public.sellerpilot_is_admin() then
    raise exception 'SMARTSTORE_MANUAL_AUTHENTICATED_OWNER_REQUIRED' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if jsonb_typeof(p_observation) is distinct from 'object' or octet_length(p_observation::text) > 12000 then
    raise exception 'SMARTSTORE_MANUAL_OBSERVATION_INVALID';
  end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(p_observation) key;
  if keys is distinct from array[
    'approvalEvidenceSha256','approvedAt','channelProductNo','contract','currency','observedAt',
    'originProductNo','price','profileName','publicEvidenceSha256','publicUrl','purchaseAvailable',
    'sellerAccountKey','sellerCenterEvidenceSha256','sellerSku','sellingState','stock','userApproved'
  ]::text[] then raise exception 'SMARTSTORE_MANUAL_OBSERVATION_FIELDS_INVALID'; end if;
  if p_observation->>'contract' is distinct from 'smartstore_manual_sale_observation_v1'
     or p_observation->>'profileName' is distinct from 'CHANGHEE'
     or p_observation->>'originProductNo' is distinct from '13688607602'
     or p_observation->>'channelProductNo' is distinct from '13749310594'
     or p_observation->>'sellerSku' is distinct from 'AUTO-780720401E2D4E4EA45F'
     or p_observation->>'publicUrl' is distinct from 'https://smartstore.naver.com/coupletseoul/products/13749310594'
     or p_observation->>'sellingState' is distinct from '판매중'
     or p_observation->>'currency' is distinct from 'KRW'
     or p_observation->'purchaseAvailable' is distinct from 'true'::jsonb
     or p_observation->'userApproved' is distinct from 'true'::jsonb
     or jsonb_typeof(p_observation->'price') is distinct from 'number'
     or (p_observation->>'price')::numeric <= 0
     or jsonb_typeof(p_observation->'stock') is distinct from 'number'
     or (p_observation->>'stock')::numeric < 1
     or (p_observation->>'stock')::numeric <> trunc((p_observation->>'stock')::numeric)
     or coalesce(p_observation->>'sellerAccountKey','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_observation->>'approvalEvidenceSha256','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_observation->>'sellerCenterEvidenceSha256','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_observation->>'publicEvidenceSha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'SMARTSTORE_MANUAL_OBSERVATION_INVALID';
  end if;
  observed := (p_observation->>'observedAt')::timestamptz;
  approved := (p_observation->>'approvedAt')::timestamptz;
  if observed is null or approved is null or not isfinite(observed) or not isfinite(approved)
     or approved > observed then raise exception 'SMARTSTORE_MANUAL_OBSERVATION_TIME_INVALID'; end if;
  obs_hash := encode(sha256(convert_to(p_observation::text,'UTF8')),'hex');
  select * into receipt from sellerpilot_private.smartstore_manual_adoption_receipts
   where source_job_id = '66147e5d-0479-4c51-896e-97e782af99e1'::uuid;
  if found then
    if receipt.observation_sha256 is distinct from obs_hash or receipt.observation is distinct from p_observation then
      raise exception 'SMARTSTORE_MANUAL_RECEIPT_CONFLICT';
    end if;
    if receipt.source_job_snapshot_sha256 is distinct from (select encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') from sellerpilot_private.channel_gateway_jobs x where x.id=receipt.source_job_id)
       or receipt.source_attempt_snapshot_sha256 is distinct from (select encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') from sellerpilot_private.channel_operation_attempts x where x.id=receipt.source_attempt_id)
       or receipt.listing_snapshot_sha256 is distinct from (select encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') from sellerpilot_private.product_listings x where x.id=receipt.listing_id) then
      raise exception 'SMARTSTORE_MANUAL_RECORDED_SOURCE_DRIFT';
    end if;
    return jsonb_build_object('contract','smartstore_manual_adoption_v1','receiptId',receipt.id,'reused',true,
      'apiCreateSucceeded',false,'sourcePreserved',true,'createBlocked',true,'contentVerified',false);
  end if;
  if observed > clock_timestamp() or observed < clock_timestamp() - interval '30 minutes' then
    raise exception 'SMARTSTORE_MANUAL_FRESH_READBACK_REQUIRED';
  end if;
  select * into j from sellerpilot_private.channel_gateway_jobs where id = '66147e5d-0479-4c51-896e-97e782af99e1'::uuid for update;
  select * into a from sellerpilot_private.channel_operation_attempts where id = '0d2c492e-2025-4717-bb3f-0fd2b886fd4f'::uuid for update;
  select * into l from sellerpilot_private.product_listings where id = '7b260562-1e41-4ddc-8509-cb78dc7292c5'::uuid for update;
  select * into p from sellerpilot_private.products where id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid for update;
  select * into c from sellerpilot_private.channel_credentials where id = '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid for update;
  request_hash := encode(sha256(convert_to(j.request_payload::text,'UTF8')),'hex');
  response_hash := encode(sha256(convert_to(j.response_payload::text,'UTF8')),'hex');
  if j.id is null or a.id is null or l.id is null or p.id is null or c.id is null
     or j.attempt_id is distinct from a.id or j.listing_id is distinct from l.id
     or j.credential_id is distinct from c.id or a.credential_id is distinct from c.id
     or l.product_id is distinct from p.id or l.owner_id is distinct from actor or p.owner_id is distinct from actor
     or a.owner_id is distinct from actor or j.created_by is distinct from actor
     or c.created_by is distinct from actor or c.version is distinct from 1
     or c.channel is distinct from 'smartstore' or c.environment is distinct from 'production'
     or c.status is distinct from 'active' or (c.expires_at is not null and c.expires_at <= clock_timestamp())
     or p.sku is distinct from 'AUTO-780720401E2D4E4EA45F' or p.demo is distinct from false or p.status is distinct from 'active'
     or j.channel is distinct from 'smartstore' or j.environment is distinct from 'production'
     or j.operation is distinct from 'listing.create' or j.status is distinct from 'reconciliation_required'
     or j.attempt_count is distinct from 1 or j.provider_mutation_started_at is null or j.completed_at is null
     or j.completed_at >= observed or j.provider_mutation_started_at >= approved
     or a.channel is distinct from 'smartstore' or a.operation is distinct from 'listing.create'
     or a.status is distinct from 'manual_required' or a.http_status is distinct from 409 or a.remote_id is not null
     or a.pre_gateway_retryable is distinct from false
     or l.channel_key is distinct from 'smartstore' or l.status is distinct from 'failed'
     or l.failure_class is distinct from 'external_action' or l.remote_visibility is distinct from 'unknown'
     or l.remote_id is not null or l.published_at is not null or l.provider_status is not null
     or l.operation_attempt_id is distinct from a.id or l.requested_publication_intent is distinct from 'live'
     or j.request_payload#>>'{arguments,publicationIntent}' is distinct from 'live'
     or j.request_fingerprint is distinct from '7ca96928ee67fa1285c74754ec65ca45807861836afa23c34bec17c52a8aabea'
     or a.request_fingerprint is distinct from j.request_fingerprint
     or request_hash is distinct from 'd4c2d09c56eceed36b63bc984b17efd2d42c1d412e4a098d15b91dcafad896d1'
     or response_hash is distinct from 'bd22dc02ef6daa4b513565c6fe9a247cd98f1f55d1e9eabb2dcc7f9e1e98cbbf'
     or coalesce(c.seller_account_key,'') !~ '^[a-f0-9]{64}$'
     or c.seller_account_key is distinct from j.seller_account_key
     or c.seller_account_key is distinct from a.seller_account_key
     or c.seller_account_key is distinct from l.seller_account_key
     or c.seller_account_key is distinct from p_observation->>'sellerAccountKey' then
    raise exception 'SMARTSTORE_MANUAL_SOURCE_TUPLE_DRIFT';
  end if;
  if exists (select 1 from sellerpilot_private.product_listings other
     where other.channel_key = 'smartstore' and other.id <> l.id
       and other.seller_account_key = c.seller_account_key and other.remote_id = '13688607602')
     or exists (select 1 from sellerpilot_private.channel_gateway_jobs other
       left join sellerpilot_private.product_listings other_listing on other_listing.id = other.listing_id
       where other.channel = 'smartstore' and other.id <> j.id
         and (other.listing_id = l.id or other_listing.product_id = p.id
           or other.request_payload#>>'{arguments,sellerpilotExternalDetail,productId}' = p.id::text
           or ((other.credential_id = c.id or other.seller_account_key = c.seller_account_key)
             and (other.request_payload#>>'{arguments,body,originProduct,detailAttribute,sellerCodeInfo,sellerManagementCode}' = p.sku
               or other.request_payload#>>'{arguments,originProductNo}' = '13688607602'
               or other.request_payload#>>'{arguments,smartstoreChannelProductNo}' = '13749310594')))
         and other.operation in ('listing.create','listing.update','listing.activate','listing.stop','price.update','inventory.update')
         and other.status in ('queued','running','reconciliation_required')) then
    raise exception 'SMARTSTORE_MANUAL_COMPETING_LISTING_OR_JOB';
  end if;
  job_hash := encode(sha256(convert_to(to_jsonb(j)::text,'UTF8')),'hex');
  attempt_hash := encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex');
  listing_hash := encode(sha256(convert_to(to_jsonb(l)::text,'UTF8')),'hex');
  perform set_config('sellerpilot.smartstore_manual_adoption_actor',actor::text,true);
  insert into sellerpilot_private.smartstore_manual_adoption_receipts (
    product_id,listing_id,source_job_id,source_attempt_id,credential_id,credential_version,
    owner_id,seller_account_key,seller_sku,origin_product_no,channel_product_no,public_url,
    observation,observation_sha256,source_request_sha256,source_response_sha256,
    source_job_snapshot_sha256,source_attempt_snapshot_sha256,listing_snapshot_sha256,observed_at,recorded_by
  ) values (p.id,l.id,j.id,a.id,c.id,c.version,actor,c.seller_account_key,p.sku,'13688607602','13749310594',
    'https://smartstore.naver.com/coupletseoul/products/13749310594',p_observation,obs_hash,request_hash,response_hash,
    job_hash,attempt_hash,listing_hash,observed,actor) returning * into receipt;
  perform set_config('sellerpilot.smartstore_manual_adoption_actor','',true);
  if job_hash is distinct from (select encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') from sellerpilot_private.channel_gateway_jobs x where x.id=j.id)
     or attempt_hash is distinct from (select encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') from sellerpilot_private.channel_operation_attempts x where x.id=a.id)
     or listing_hash is distinct from (select encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') from sellerpilot_private.product_listings x where x.id=l.id) then
    raise exception 'SMARTSTORE_MANUAL_SOURCE_CHANGED_DURING_RECORD';
  end if;
  return jsonb_build_object('contract','smartstore_manual_adoption_v1','receiptId',receipt.id,'reused',false,
    'apiCreateSucceeded',false,'sourcePreserved',true,'createBlocked',true,'contentVerified',false);
end $$;
revoke all on function public.sellerpilot_record_exact_smartstore_manual_adoption(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_record_exact_smartstore_manual_adoption(jsonb) to authenticated;

create function public.sellerpilot_get_exact_smartstore_manual_adoption(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'SMARTSTORE_MANUAL_AUTHENTICATED_OWNER_REQUIRED' using errcode = '42501';
  end if;
  return (select jsonb_build_object('contract','smartstore_manual_adoption_v1','receiptId',r.id,
    'productId',r.product_id,'listingId',r.listing_id,'sourceJobId',r.source_job_id,'sourceAttemptId',r.source_attempt_id,
    'origin','manual_seller_center','originProductNo',r.origin_product_no,'channelProductNo',r.channel_product_no,
    'sellerSku',r.seller_sku,'publicUrl',r.public_url,'observedAt',r.observed_at,'recordedAt',r.recorded_at,
    'sellingStateAtObservation',r.observation->>'sellingState','apiCreateSucceeded',false,'contentVerified',false,'createBlocked',true)
   from sellerpilot_private.smartstore_manual_adoption_receipts r where r.product_id=p_product_id and r.owner_id=auth.uid());
end $$;
revoke all on function public.sellerpilot_get_exact_smartstore_manual_adoption(uuid) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_get_exact_smartstore_manual_adoption(uuid) to authenticated;

create function sellerpilot_private.block_smartstore_manual_adoption_create()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.channel is distinct from 'smartstore' or new.operation is distinct from 'listing.create' then return new; end if;
  if tg_op = 'UPDATE' and new.status not in ('queued','running')
     and new.request_payload is not distinct from old.request_payload
     and new.provider_mutation_started_at is not distinct from old.provider_mutation_started_at then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if exists (select 1 from sellerpilot_private.smartstore_manual_adoption_receipts r
    left join sellerpilot_private.product_listings listing on listing.id=new.listing_id
    left join sellerpilot_private.channel_credentials credential on credential.id=new.credential_id
    where new.listing_id=r.listing_id or listing.product_id=r.product_id
      or new.request_payload#>>'{arguments,sellerpilotExternalDetail,productId}'=r.product_id::text
      or ((new.credential_id=r.credential_id or credential.seller_account_key=r.seller_account_key or new.seller_account_key=r.seller_account_key)
        and (new.request_payload#>>'{arguments,body,originProduct,detailAttribute,sellerCodeInfo,sellerManagementCode}'=r.seller_sku
          or new.request_payload#>>'{arguments,originProductNo}'=r.origin_product_no
          or new.request_payload#>>'{arguments,smartstoreChannelProductNo}'=r.channel_product_no))) then
    raise exception 'SMARTSTORE_MANUAL_REMOTE_ALREADY_EXISTS' using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function sellerpilot_private.block_smartstore_manual_adoption_create() from public, anon, authenticated, service_role;
create trigger a_smartstore_manual_adoption_create_fence
before insert or update of status, request_payload, credential_id, listing_id, provider_mutation_started_at, channel, operation, seller_account_key
on sellerpilot_private.channel_gateway_jobs for each row
execute function sellerpilot_private.block_smartstore_manual_adoption_create();
commit;
