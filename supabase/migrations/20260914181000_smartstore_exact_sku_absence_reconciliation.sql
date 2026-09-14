-- Preserve the interrupted SmartStore CREATE as reconciliation evidence while
-- allowing one fresh attempt only after an official, complete SELLER_CODE
-- search proved that its exact seller SKU does not exist remotely. This never
-- changes the source job, attempt, listing, product, credential, or provider.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(193674993, 918100000);

do $dependencies$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_create_final_transports'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_reconciliation_resolved_before_stale_fence_reb(uuid)'
     ) is null then
    raise exception 'SMARTSTORE_EXACT_SKU_ABSENCE_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;

  -- Keep the top-level resolver byte-for-byte stable in both exact deployment
  -- orders: a clean replay reaches 181000 before eBay 182000, while production
  -- already has 182000. The eBay predecessor function distinguishes them.
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_reconciliation_resolved_before_ebay_narangd_re(uuid)'
     ) is null then
    if (
      select pg_catalog.md5(proc.prosrc)
        from pg_catalog.pg_proc proc
       where proc.oid =
         'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::pg_catalog.regprocedure
    ) is distinct from '36929a92795ac77eac6984c76fa762de' then
      raise exception 'SMARTSTORE_EXACT_SKU_ABSENCE_TOP_RESOLVER_DRIFT'
        using errcode = '55000';
    end if;
  else
    if (
      select pg_catalog.md5(proc.prosrc)
        from pg_catalog.pg_proc proc
       where proc.oid =
         'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::pg_catalog.regprocedure
    ) is distinct from '079423399e92fc93245b4163fd5063d2'
       or (
         select pg_catalog.md5(proc.prosrc)
           from pg_catalog.pg_proc proc
          where proc.oid =
            'sellerpilot_private.listing_mutation_reconciliation_resolved_before_ebay_narangd_re(uuid)'::pg_catalog.regprocedure
       ) is distinct from '36929a92795ac77eac6984c76fa762de' then
      raise exception 'SMARTSTORE_EXACT_SKU_ABSENCE_EBAY_RESOLVER_DRIFT'
        using errcode = '55000';
    end if;
  end if;

  if (
    select pg_catalog.md5(proc.prosrc)
      from pg_catalog.pg_proc proc
     where proc.oid =
       'sellerpilot_private.listing_mutation_reconciliation_resolved_before_stale_fence_reb(uuid)'::pg_catalog.regprocedure
  ) is distinct from 'c000072cb34fae737de357cabda57b1c' then
    raise exception 'SMARTSTORE_EXACT_SKU_ABSENCE_RESOLVER_DRIFT'
      using errcode = '55000';
  end if;
end
$dependencies$;

do $source_preimage$
declare
  matches integer;
begin
  select pg_catalog.count(*)::integer into matches
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
    join sellerpilot_private.products product
      on product.id = listing.product_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
   where job.id = '50a1e9e3-8c15-4a21-b2f3-7b00490c6408'::uuid
     and job.channel = 'smartstore'
     and job.operation = 'listing.create'
     and job.environment = 'production'
     and job.status = 'reconciliation_required'
     and job.created_by = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
     and job.listing_id = '043ccf5a-ca7a-4f89-8add-15de541287b1'::uuid
     and job.attempt_id = '25aafa20-708e-4acb-8a83-372dcefcd966'::uuid
     and job.credential_id = '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
     and job.request_fingerprint =
       '29f6ac10bef3599f3cb9de20d593a600235848b97478a96edc1a1012083ed11f'
     and pg_catalog.encode(
       extensions.digest(job.request_payload::text, 'sha256'), 'hex'
     ) = '5902d55d44e23c3fb6f35e69bb3f451c8c24454aa175a3b2fbed33b24204d507'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,bodyBindingSha256}' =
       'd39ccd5c2b192a8322c6f2e749bfb347a1b0f8317db567bd6c9061870032702a'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,sellerManagementCode}' =
       'AUTO-00BF58A2E8434FF09667'
     and job.provider_mutation_started_at =
       '2026-09-14 06:41:11.085299+00'::timestamptz
     and job.completed_at = '2026-09-14 06:58:58.724917+00'::timestamptz
     and job.response_payload is null
     and job.error_message =
       'Gateway write lease expired; provider outcome requires reconciliation.'
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and not exists (
       select 1
         from sellerpilot_private.smartstore_create_final_transports transport
        where transport.job_id = job.id
     )
     and attempt.id = '25aafa20-708e-4acb-8a83-372dcefcd966'::uuid
     and attempt.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and attempt.channel = 'smartstore'
     and attempt.operation = 'listing.create'
     and attempt.status = 'manual_required'
     and attempt.http_status = 409
     and attempt.credential_id = job.credential_id
     and attempt.seller_account_key = job.seller_account_key
     and attempt.request_fingerprint = job.request_fingerprint
     and attempt.completed_at = job.completed_at
     and attempt.safe_message = job.error_message
     and listing.id = '043ccf5a-ca7a-4f89-8add-15de541287b1'::uuid
     and listing.owner_id = attempt.owner_id
     and listing.product_id = 'c0bdb493-6447-41bf-af0a-46a3da7a75a8'::uuid
     and listing.channel_key = 'smartstore'
     and listing.operation_attempt_id = attempt.id
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.remote_id is null
     and listing.seller_account_key is null
     and listing.last_error = job.error_message
     and listing.updated_at = job.completed_at
     and product.id = listing.product_id
     and product.owner_id = attempt.owner_id
     and product.sku = 'AUTO-00BF58A2E8434FF09667'
     and product.status = 'draft'
     and product.detail_page_version = 1
     and product.detail_page_approved_version = 1
     and credential.id = job.credential_id
     and credential.created_by = job.created_by
     and credential.channel = 'smartstore'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.expires_at is null
     and credential.version = 1
     and credential.fingerprint = '3F7B781CA280'
     and credential.vault_secret_id =
       'ad060001-136a-474f-a371-fb5239239f06'::uuid
     and credential.last_rotated_at =
       '2026-08-18 00:36:54.926455+00'::timestamptz
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at =
       '2026-08-25 11:40:32.606508+00'::timestamptz
     and credential.seller_account_key = job.seller_account_key
     and pg_catalog.encode(
       extensions.digest(credential.seller_account_key, 'sha256'), 'hex'
     ) = 'eea02ee8ff761aa52d68379530df56a73a0eee71b31ce9b233409c8021bd6c3b';

  if matches <> 1 then
    raise exception 'SMARTSTORE_EXACT_SKU_ABSENCE_SOURCE_DRIFT'
      using errcode = '55000';
  end if;
end
$source_preimage$;

create table sellerpilot_private.smartstore_create_absence_receipts (
  id uuid primary key,
  source_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  gateway_issuer_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version = 1),
  credential_fingerprint text not null check (credential_fingerprint = '3F7B781CA280'),
  credential_vault_secret_id uuid not null,
  credential_seller_account_key_source text not null
    check (credential_seller_account_key_source = 'credential_incarnation_v1'),
  credential_seller_account_verified_at timestamptz not null,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  seller_account_key_sha256 text not null
    check (seller_account_key_sha256 ~ '^[a-f0-9]{64}$'),
  seller_sku text not null check (seller_sku = 'AUTO-00BF58A2E8434FF09667'),
  source_request_fingerprint text not null
    check (source_request_fingerprint ~ '^[a-f0-9]{64}$'),
  source_request_sha256 text not null check (source_request_sha256 ~ '^[a-f0-9]{64}$'),
  source_body_binding_sha256 text not null
    check (source_body_binding_sha256 ~ '^[a-f0-9]{64}$'),
  provider_mutation_started_at timestamptz not null,
  source_job_before jsonb not null check (jsonb_typeof(source_job_before) = 'object'),
  source_attempt_before jsonb not null
    check (jsonb_typeof(source_attempt_before) = 'object'),
  listing_before jsonb not null check (jsonb_typeof(listing_before) = 'object'),
  product_before jsonb not null check (jsonb_typeof(product_before) = 'object'),
  search_method text not null check (search_method = 'POST'),
  search_path text not null check (search_path = '/v1/products/search'),
  search_request jsonb not null check (
    search_request = '{
      "searchKeywordType":"SELLER_CODE",
      "sellerManagementCode":"AUTO-00BF58A2E8434FF09667",
      "page":1,
      "size":50,
      "orderType":"NO"
    }'::jsonb
  ),
  search_request_canonical_sha256 text not null
    check (search_request_canonical_sha256 =
      'c63ed679e86a8c32b0c88d22d61ed1bcfd5206d7777fd32f64e5618a4b91b1db'),
  search_http_status integer not null check (search_http_status = 200),
  search_content_type text not null
    check (search_content_type = 'application/json;charset=UTF-8'),
  search_response jsonb not null check (
    search_response = '{
      "contents":[],
      "page":1,
      "size":50,
      "totalElements":0,
      "totalPages":0,
      "sort":{"sorted":true,"fields":[{"name":"productNo","direction":"DESC"}]},
      "first":true,
      "last":true
    }'::jsonb
  ),
  search_response_canonical_sha256 text not null
    check (search_response_canonical_sha256 =
      '36c268827ab59a8962ec48f9d21d2e31315c33eab7f4f4ed52aeb27770929958'),
  search_response_raw_sha256 text not null
    check (search_response_raw_sha256 =
      '011b8c67dff24a1a7a08914f9528bf244cd0223db72f3104098da5c25daf97df'),
  observed_started_at timestamptz not null,
  observed_finished_at timestamptz not null
    check (observed_finished_at >= observed_started_at),
  authentication_mode text not null
    check (authentication_mode = 'one_time_client_credentials_exchange'),
  token_exchange_http_status integer not null check (token_exchange_http_status = 200),
  credential_rotated boolean not null check (not credential_rotated),
  credential_persisted boolean not null check (not credential_persisted),
  new_login_performed boolean not null check (not new_login_performed),
  exact_absence_verified boolean not null check (exact_absence_verified),
  provider_product_create_performed boolean not null
    check (not provider_product_create_performed),
  provider_mutation_performed_by_probe boolean not null
    check (not provider_mutation_performed_by_probe),
  private_receipt_sha256 text not null
    check (private_receipt_sha256 =
      '0936984c80715e0d772ef17b72cb7e9586be6a90f43f28c3a75e0c92c1dd0a3d'),
  canonical_receipt_sha256 text not null
    check (canonical_receipt_sha256 =
      'da6c6527591fcac391f53b23b479a94eb882e7d8c1824b691ea4eb2332134f21'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (observed_started_at > provider_mutation_started_at),
  check (owner_id <> gateway_issuer_id)
);

alter table sellerpilot_private.smartstore_create_absence_receipts
  enable row level security;
revoke all on sellerpilot_private.smartstore_create_absence_receipts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_create_absence_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT'
     or current_setting(
       'sellerpilot.smartstore_create_absence_receipt_insert', true
     ) is distinct from new.id::text then
    raise exception 'SMARTSTORE_CREATE_ABSENCE_RECEIPT_IMMUTABLE'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_smartstore_create_absence_receipt()
  from public, anon, authenticated, service_role;

create trigger smartstore_create_absence_receipts_immutable
before insert or update or delete
on sellerpilot_private.smartstore_create_absence_receipts
for each row execute function
  sellerpilot_private.guard_smartstore_create_absence_receipt();

select pg_catalog.set_config(
  'sellerpilot.smartstore_create_absence_receipt_insert',
  '143d47e9-8f63-4323-83cb-39dd27ecb082',
  true
);

insert into sellerpilot_private.smartstore_create_absence_receipts (
  id,source_job_id,source_attempt_id,listing_id,product_id,owner_id,
  gateway_issuer_id,credential_id,credential_version,credential_fingerprint,
  credential_vault_secret_id,credential_seller_account_key_source,
  credential_seller_account_verified_at,seller_account_key,
  seller_account_key_sha256,seller_sku,source_request_fingerprint,
  source_request_sha256,source_body_binding_sha256,
  provider_mutation_started_at,source_job_before,source_attempt_before,
  listing_before,product_before,search_method,search_path,search_request,
  search_request_canonical_sha256,search_http_status,search_content_type,
  search_response,search_response_canonical_sha256,
  search_response_raw_sha256,observed_started_at,observed_finished_at,
  authentication_mode,token_exchange_http_status,credential_rotated,
  credential_persisted,new_login_performed,exact_absence_verified,
  provider_product_create_performed,provider_mutation_performed_by_probe,
  private_receipt_sha256,canonical_receipt_sha256
)
select
  '143d47e9-8f63-4323-83cb-39dd27ecb082'::uuid,
  job.id,attempt.id,listing.id,product.id,attempt.owner_id,job.created_by,
  credential.id,credential.version,credential.fingerprint,
  credential.vault_secret_id,credential.seller_account_key_source,
  credential.seller_account_verified_at,credential.seller_account_key,
  pg_catalog.encode(
    extensions.digest(credential.seller_account_key, 'sha256'), 'hex'
  ),
  'AUTO-00BF58A2E8434FF09667',job.request_fingerprint,
  pg_catalog.encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex'),
  job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,bodyBindingSha256}',
  job.provider_mutation_started_at,to_jsonb(job),to_jsonb(attempt),
  to_jsonb(listing),to_jsonb(product),'POST','/v1/products/search',
  '{
    "searchKeywordType":"SELLER_CODE",
    "sellerManagementCode":"AUTO-00BF58A2E8434FF09667",
    "page":1,
    "size":50,
    "orderType":"NO"
  }'::jsonb,
  'c63ed679e86a8c32b0c88d22d61ed1bcfd5206d7777fd32f64e5618a4b91b1db',
  200,'application/json;charset=UTF-8',
  '{
    "contents":[],
    "page":1,
    "size":50,
    "totalElements":0,
    "totalPages":0,
    "sort":{"sorted":true,"fields":[{"name":"productNo","direction":"DESC"}]},
    "first":true,
    "last":true
  }'::jsonb,
  '36c268827ab59a8962ec48f9d21d2e31315c33eab7f4f4ed52aeb27770929958',
  '011b8c67dff24a1a7a08914f9528bf244cd0223db72f3104098da5c25daf97df',
  '2026-09-14 07:05:35.774+00'::timestamptz,
  '2026-09-14 07:05:35.848+00'::timestamptz,
  'one_time_client_credentials_exchange',200,false,false,false,true,false,false,
  '0936984c80715e0d772ef17b72cb7e9586be6a90f43f28c3a75e0c92c1dd0a3d',
  'da6c6527591fcac391f53b23b479a94eb882e7d8c1824b691ea4eb2332134f21'
from sellerpilot_private.channel_gateway_jobs job
join sellerpilot_private.channel_operation_attempts attempt
  on attempt.id = job.attempt_id
join sellerpilot_private.product_listings listing
  on listing.id = job.listing_id
join sellerpilot_private.products product
  on product.id = listing.product_id
join sellerpilot_private.channel_credentials credential
  on credential.id = job.credential_id
where job.id = '50a1e9e3-8c15-4a21-b2f3-7b00490c6408'::uuid;

alter function
  sellerpilot_private.listing_mutation_reconciliation_resolved_before_stale_fence_reb(uuid)
  rename to listing_reconciliation_before_ss_absence_181000;

create function
  sellerpilot_private.listing_mutation_reconciliation_resolved_before_stale_fence_reb(
    p_job uuid
  )
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    sellerpilot_private.listing_reconciliation_before_ss_absence_181000(p_job)
    or (
      p_job = '50a1e9e3-8c15-4a21-b2f3-7b00490c6408'::uuid
      and exists (
        select 1
          from sellerpilot_private.smartstore_create_absence_receipts receipt
          join sellerpilot_private.channel_gateway_jobs source_job
            on source_job.id = receipt.source_job_id
          join sellerpilot_private.channel_operation_attempts source_attempt
            on source_attempt.id = receipt.source_attempt_id
          join sellerpilot_private.product_listings listing
            on listing.id = receipt.listing_id
          join sellerpilot_private.products product
            on product.id = receipt.product_id
          join sellerpilot_private.channel_credentials credential
            on credential.id = receipt.credential_id
         where receipt.id = '143d47e9-8f63-4323-83cb-39dd27ecb082'::uuid
           and receipt.source_job_id = p_job
           and receipt.source_attempt_id =
             '25aafa20-708e-4acb-8a83-372dcefcd966'::uuid
           and receipt.listing_id =
             '043ccf5a-ca7a-4f89-8add-15de541287b1'::uuid
           and receipt.product_id =
             'c0bdb493-6447-41bf-af0a-46a3da7a75a8'::uuid
           and receipt.owner_id =
             '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
           and receipt.gateway_issuer_id =
             '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
           and receipt.credential_id =
             '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
           and receipt.seller_sku = 'AUTO-00BF58A2E8434FF09667'
           and receipt.source_request_fingerprint =
             '29f6ac10bef3599f3cb9de20d593a600235848b97478a96edc1a1012083ed11f'
           and receipt.source_request_sha256 =
             '5902d55d44e23c3fb6f35e69bb3f451c8c24454aa175a3b2fbed33b24204d507'
           and receipt.source_body_binding_sha256 =
             'd39ccd5c2b192a8322c6f2e749bfb347a1b0f8317db567bd6c9061870032702a'
           and receipt.search_request = '{
             "searchKeywordType":"SELLER_CODE",
             "sellerManagementCode":"AUTO-00BF58A2E8434FF09667",
             "page":1,
             "size":50,
             "orderType":"NO"
           }'::jsonb
           and receipt.search_response = '{
             "contents":[],
             "page":1,
             "size":50,
             "totalElements":0,
             "totalPages":0,
             "sort":{"sorted":true,"fields":[{"name":"productNo","direction":"DESC"}]},
             "first":true,
             "last":true
           }'::jsonb
           and receipt.search_response_canonical_sha256 =
             '36c268827ab59a8962ec48f9d21d2e31315c33eab7f4f4ed52aeb27770929958'
           and receipt.search_response_raw_sha256 =
             '011b8c67dff24a1a7a08914f9528bf244cd0223db72f3104098da5c25daf97df'
           and receipt.private_receipt_sha256 =
             '0936984c80715e0d772ef17b72cb7e9586be6a90f43f28c3a75e0c92c1dd0a3d'
           and receipt.canonical_receipt_sha256 =
             'da6c6527591fcac391f53b23b479a94eb882e7d8c1824b691ea4eb2332134f21'
           and receipt.exact_absence_verified
           and not receipt.provider_product_create_performed
           and not receipt.provider_mutation_performed_by_probe
           and source_job.channel = 'smartstore'
           and source_job.operation = 'listing.create'
           and source_job.environment = 'production'
           and source_job.status = 'reconciliation_required'
           and source_job.provider_mutation_started_at =
             receipt.provider_mutation_started_at
           and source_job.response_payload is null
           and source_job.request_fingerprint = receipt.source_request_fingerprint
           and pg_catalog.encode(
             extensions.digest(source_job.request_payload::text, 'sha256'), 'hex'
           ) = receipt.source_request_sha256
           and source_job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,bodyBindingSha256}' =
             receipt.source_body_binding_sha256
           and to_jsonb(source_job) = receipt.source_job_before
           and not exists (
             select 1
               from sellerpilot_private.smartstore_create_final_transports transport
              where transport.job_id = source_job.id
           )
           and source_attempt.status = 'manual_required'
           and source_attempt.channel = 'smartstore'
           and source_attempt.operation = 'listing.create'
           and source_attempt.owner_id = receipt.owner_id
           and source_attempt.credential_id = receipt.credential_id
           and source_attempt.seller_account_key = receipt.seller_account_key
           and source_attempt.request_fingerprint = receipt.source_request_fingerprint
           and to_jsonb(source_attempt) = receipt.source_attempt_before
           and listing.product_id = receipt.product_id
           and listing.owner_id = receipt.owner_id
           and listing.channel_key = 'smartstore'
           and coalesce(listing.seller_account_key, receipt.seller_account_key) =
             receipt.seller_account_key
           and product.owner_id = receipt.owner_id
           and product.sku = receipt.seller_sku
           and credential.channel = 'smartstore'
           and credential.environment = 'production'
           and credential.seller_account_key_source =
             receipt.credential_seller_account_key_source
           and credential.seller_account_key = receipt.seller_account_key
           and pg_catalog.encode(
             extensions.digest(credential.seller_account_key, 'sha256'), 'hex'
           ) = receipt.seller_account_key_sha256
      )
    )
$$;

revoke all on function
  sellerpilot_private.listing_mutation_reconciliation_resolved_before_stale_fence_reb(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.listing_reconciliation_before_ss_absence_181000(uuid)
  from public, anon, authenticated, service_role;

do $postcondition$
begin
  if not sellerpilot_private.listing_mutation_reconciliation_resolved(
    '50a1e9e3-8c15-4a21-b2f3-7b00490c6408'::uuid
  ) then
    raise exception 'SMARTSTORE_EXACT_SKU_ABSENCE_NOT_RESOLVED'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_reconciliation_resolved_before_ebay_narangd_re(uuid)'
     ) is null then
    if (
      select pg_catalog.md5(proc.prosrc)
        from pg_catalog.pg_proc proc
       where proc.oid =
         'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::pg_catalog.regprocedure
    ) is distinct from '36929a92795ac77eac6984c76fa762de' then
      raise exception 'SMARTSTORE_EXACT_SKU_ABSENCE_TOP_RESOLVER_CHANGED'
        using errcode = '55000';
    end if;
  elsif (
    select pg_catalog.md5(proc.prosrc)
      from pg_catalog.pg_proc proc
     where proc.oid =
       'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::pg_catalog.regprocedure
  ) is distinct from '079423399e92fc93245b4163fd5063d2' then
    raise exception 'SMARTSTORE_EXACT_SKU_ABSENCE_EBAY_RESOLVER_CHANGED'
      using errcode = '55000';
  end if;
end
$postcondition$;

commit;
