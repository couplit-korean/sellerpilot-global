-- First erroneous pin: 20260902091500 (dual proof/trigger), carried into
-- 20260902100000 (three proof/trigger). Live prosrc normalized-MD5 matched
-- exactly on 2026-09-06; do not apply to any other preimage.
-- No OAuth/provider call, token rewrite, job creation or historical rebinding.
-- Only a NEW normal OAuth and claim-bound seller readback can later cause the
-- existing guarded supersession transition. Conflicting historical seller
-- evidence is denied, not rewritten. Parent controls application/execution.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='lazada_same_account_oauth_evidence_v1')
    or to_regclass('sellerpilot_private.lazada_same_account_oauth_boundary') is not null then raise exception 'LAZADA_SAME_ACCOUNT_PROOF_ALREADY_DEFINED'; end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('sellerpilot_private.exact_lazada_three_readback_proof(uuid)') and prosecdef and proconfig=array['search_path=""']::text[] and md5(regexp_replace(prosrc,'[[:space:]]+',' ','g'))='ef9a6807aaafa106287a31621630f55d')
 or not exists(select 1 from pg_proc where oid=to_regprocedure('sellerpilot_private.supersede_exact_lazada_three_blockers_after_readback()') and prosecdef and proconfig=array['search_path=""']::text[] and md5(regexp_replace(prosrc,'[[:space:]]+',' ','g'))='9b8ff30a1dd2c4df56f68d34c91f238c') then raise exception 'LAZADA_SAME_ACCOUNT_PROOF_PREIMAGE_MISMATCH'; end if;
end;
$guard$;
create table sellerpilot_private.lazada_same_account_oauth_boundary (
 singleton boolean primary key default true check(singleton), installed_at timestamptz not null default clock_timestamp()
);
insert into sellerpilot_private.lazada_same_account_oauth_boundary(singleton) values(true);
alter table sellerpilot_private.lazada_same_account_oauth_boundary enable row level security;
revoke all on sellerpilot_private.lazada_same_account_oauth_boundary from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_same_account_oauth_evidence_v1(p_source jsonb,p_active jsonb,p_history jsonb)
returns boolean language plpgsql immutable security definer set search_path='' as $$
declare v_old_im jsonb; v_new_im jsonb; v_witness jsonb;
begin
 if jsonb_typeof(p_source) is distinct from 'object' or jsonb_typeof(p_active) is distinct from 'object'
 or p_source->>'app_key' is distinct from '137451' or p_active->>'app_key' is distinct from '137451'
 or nullif(p_source->>'app_secret','') is null or p_active->>'app_secret' is distinct from p_source->>'app_secret'
 or p_source->>'country' is distinct from 'my' or p_active->>'country' is distinct from 'my'
 or p_source->>'im_app_key' is distinct from '137571' or p_active->>'im_app_key' is distinct from '137571'
 or nullif(p_source->>'im_app_secret','') is null or nullif(p_source->>'im_access_token','') is null
 or p_source ? 'provider_account_subject' or p_source ? 'provider_account_identity_version'
 or jsonb_typeof(p_history) is distinct from 'array' or jsonb_array_length(p_history)<>3 then return false; end if;
 select jsonb_object_agg(key,value) into v_old_im from jsonb_each(p_source) where left(key,3)='im_';
 select jsonb_object_agg(key,value) into v_new_im from jsonb_each(p_active) where left(key,3)='im_';
 if v_old_im is distinct from v_new_im then return false; end if;
 -- Inspect only seller-identity keys, never arbitrary order/customer IDs.
 -- Null/non-scalar witnesses fail closed too. No witness is manufactured.
 for v_witness in
   select value from jsonb_path_query(p_history,'$.**.seller_id') as witness(value)
   union all select value from jsonb_path_query(p_history,'$.**.sellerId') as witness(value)
   union all select value from jsonb_path_query(p_history,'$.**.target_id') as witness(value)
   union all select value from jsonb_path_query(p_history,'$.**.targetId') as witness(value)
 loop
   if jsonb_typeof(v_witness) not in ('string','number') or (v_witness#>>'{}') is distinct from '300872000183' then return false; end if;
 end loop;
 for v_witness in
   select value from jsonb_path_query(p_history,'$.**.short_code') as witness(value)
   union all select value from jsonb_path_query(p_history,'$.**.seller_short_code') as witness(value)
 loop
   if jsonb_typeof(v_witness) is distinct from 'string' or upper(v_witness#>>'{}') is distinct from 'MY4NNISR2D' then return false; end if;
 end loop;
 return true;
end;
$$;
revoke all on function sellerpilot_private.lazada_same_account_oauth_evidence_v1(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function sellerpilot_private.exact_lazada_three_readback_proof(
  p_target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target sellerpilot_private.channel_market_targets%rowtype;
  v_boundary timestamptz;
  v_source_secret jsonb;
  v_history jsonb;
  v_source sellerpilot_private.channel_credentials%rowtype;
  v_active sellerpilot_private.channel_credentials%rowtype;
  v_failed sellerpilot_private.channel_gateway_jobs%rowtype;
  v_oauth sellerpilot_private.channel_gateway_jobs%rowtype;
  v_seller_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_secret jsonb;
  v_subject text;
  v_expected_subject text;
  v_canonical_stores text;
  v_expected_key text;
  v_store_count integer;
  v_country_count integer;
  v_my_count integer;
  v_my_seller_id text;
  v_my_user_id text;
  v_step jsonb;
  v_seller jsonb;
  v_readback_seller_id text;
  v_readback_status text;
begin
  select installed_at into v_boundary from sellerpilot_private.lazada_same_account_oauth_boundary where singleton;
  if v_boundary is null then return null; end if;
  select target.* into v_target
    from sellerpilot_private.channel_market_targets target
   where target.id = p_target_id
     and target.owner_id =
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and target.channel = 'lazada'
     and target.environment = 'production'
     and target.market_code = 'MY'
     and target.target_id = '300872000183'
     and target.locale = 'ms-MY'
     and target.currency = 'MYR'
     and (
       nullif(trim(target.remote_status), '') is null
       or lower(trim(target.remote_status)) in ('active', 'live', 'enabled')
     )
     and target.verified_at is not null
     and target.verified_at <= clock_timestamp() + interval '1 minute';
  if not found then return null; end if;

  if not sellerpilot_private.lazada_exact_three_blockers_intact(
    'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid,
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    'production'
  ) then return null; end if;

  select failed.* into v_failed
    from sellerpilot_private.channel_gateway_jobs failed
   where failed.id =
         'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid;
  if not found then return null; end if;

  select credential.* into v_source
    from sellerpilot_private.channel_credentials credential
   where credential.id =
           'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid
     and credential.created_by =
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.version = 5
     and credential.status = 'revoked'
     and credential.seller_account_key is null
     and credential.seller_account_key_source = 'legacy_unattested'
     and credential.seller_account_verified_at is null;
  if not found then return null; end if;

  select credential.* into v_active
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_target.credential_id
     and credential.created_by = v_target.owner_id
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.version > 5
     and credential.status = 'active'
     and (
       credential.expires_at is null
       or credential.expires_at > clock_timestamp()
     )
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found or (
    select count(*)
      from sellerpilot_private.channel_credentials active_credential
     where active_credential.created_by = v_target.owner_id
       and active_credential.channel = 'lazada'
       and active_credential.environment = 'production'
       and active_credential.status = 'active'
  ) <> 1 then return null; end if;

  select decrypted.decrypted_secret::jsonb into v_secret
    from vault.decrypted_secrets decrypted
   where decrypted.id = v_active.vault_secret_id;
  if v_secret is null
     or coalesce(lower(trim(v_secret->>'country')), '') <> 'my'
     or coalesce(lower(trim(v_secret->>'account_platform')), '') <>
          'seller_center'
     or coalesce(v_secret->>'provider_account_identity_version', '') <> 'v1'
     or length(coalesce(v_secret->>'provider_account_subject', ''))
          not between 50 and 522
     or coalesce(v_secret->>'provider_account_subject', '') !~
          '^lazada:v1:[A-Za-z0-9_-]+$'
     or jsonb_typeof(v_secret->'country_user_info') <> 'array'
     or jsonb_array_length(v_secret->'country_user_info') = 0
     or length(coalesce(v_secret->>'access_token', '')) < 8
     or length(coalesce(v_secret->>'refresh_token', '')) < 8 then
    return null;
  end if;
  v_subject := v_secret->>'provider_account_subject';
  v_expected_key := encode(extensions.digest(
    'lazada' || E'\x1f' || 'production' || E'\x1f' || v_subject,
    'sha256'
  ), 'hex');
  if v_expected_key is distinct from v_active.seller_account_key then
    return null;
  end if;

  select count(*)::integer,
         count(distinct lower(trim(store->>'country')))::integer,
         count(*) filter (
           where lower(trim(store->>'country')) = 'my'
         )::integer,
         min(store->>'seller_id') filter (
           where lower(trim(store->>'country')) = 'my'
         ),
         min(store->>'user_id') filter (
           where lower(trim(store->>'country')) = 'my'
         )
    into v_store_count, v_country_count, v_my_count,
         v_my_seller_id, v_my_user_id
    from jsonb_array_elements(v_secret->'country_user_info') store
   where jsonb_typeof(store) = 'object'
     and lower(trim(store->>'country')) in ('id','my','ph','sg','th','vn')
     and store->>'seller_id' ~ '^[1-9][0-9]{0,31}$'
     and store->>'user_id' ~ '^[1-9][0-9]{0,31}$'
     and (
       nullif(trim(store->>'short_code'), '') is null
       or upper(trim(store->>'short_code')) ~ '^[A-Z0-9_-]{1,64}$'
     );
  if v_store_count <> jsonb_array_length(v_secret->'country_user_info')
     or v_country_count <> v_store_count
     or v_my_count <> 1
     or v_my_seller_id <> v_target.target_id
     or v_my_seller_id <> '300872000183'
     or v_my_user_id !~ '^[1-9][0-9]{0,31}$' then
    return null;
  end if;

  select string_agg(
           pg_catalog.format(
             '["%s","%s","%s"]',
             lower(trim(store->>'country')),
             store->>'seller_id',
             store->>'user_id'
           ),
           ',' order by lower(trim(store->>'country')),
                        store->>'seller_id', store->>'user_id'
         )
    into v_canonical_stores
    from jsonb_array_elements(v_secret->'country_user_info') store;
  v_expected_subject := 'lazada:v1:' || pg_catalog.translate(
    pg_catalog.rtrim(
      pg_catalog.replace(
        pg_catalog.encode(
          pg_catalog.convert_to(
            '["seller_center",[' || v_canonical_stores || ']]',
            'UTF8'
          ),
          'base64'
        ),
        E'\n',
        ''
      ),
      '='
    ),
    '+/',
    '-_'
  );
  if v_subject is distinct from v_expected_subject then return null; end if;

  select decrypted.decrypted_secret::jsonb into v_source_secret
    from vault.decrypted_secrets decrypted where decrypted.id=v_source.vault_secret_id;
  select jsonb_agg(jsonb_build_array(job.request_payload,job.response_payload)) into v_history
    from sellerpilot_private.channel_gateway_jobs job where job.id in (
      'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid,
      'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid,
      'faee01e1-2d68-4f99-951c-15684822fc43'::uuid);
  if not sellerpilot_private.lazada_same_account_oauth_evidence_v1(v_source_secret,v_secret,v_history) then return null; end if;

  with candidates as materialized (
    select job.*
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.gateway_completion_receipts receipt
        on receipt.job_id = job.id
       and receipt.claim_token = job.claim_token
       and receipt.worker_token_id = job.worker_token_id
     where job.oauth_source_credential_id = v_source.id
       and job.credential_id = v_active.id
       and job.prepared_credential_id = v_active.id
       and job.created_by = v_target.owner_id
       and job.channel = 'lazada'
       and job.environment = 'production'
       and job.operation = 'oauth.exchange'
       and job.status = 'succeeded'
       and job.error_message is null
       and job.attempt_count = 1
       and job.attempt_id is null
       and job.listing_id is null
       and job.worker_token_id is not null
       and job.claim_token is not null
       and job.lease_expires_at is null
       and job.created_at >= v_boundary
       and job.created_at > v_failed.completed_at
       and job.created_at > clock_timestamp() - interval '25 minutes'
       and job.created_at <= clock_timestamp() + interval '1 minute'
       and job.started_at is not null
       and job.oauth_provider_call_started_at is not null
       and job.credential_refresh_prepared_at is not null
       and job.completed_at is not null
       and job.updated_at >= job.completed_at
       and job.completed_at <= clock_timestamp() + interval '1 minute'
       and job.started_at <= job.oauth_provider_call_started_at
       and job.oauth_provider_call_started_at <=
             job.credential_refresh_prepared_at
       and job.credential_refresh_prepared_at <= job.completed_at
       and job.oauth_exchange_completed
       and not job.credential_refresh_in_flight
       and job.credential_refresh_started_at is null
       and job.credential_refresh_fingerprint ~ '^[a-f0-9]{64}$'
       and job.credential_refresh_recovery_vault_id is null
       and job.credential_refresh_recovery_fingerprint is null
       and job.credential_refresh_recovery_staged_at is null
       and job.oauth_request_vault_id is null
       and job.oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
       and job.oauth_request_fingerprint is distinct from
             v_failed.oauth_request_fingerprint
       and job.request_payload = jsonb_build_object('vaultBacked', true)
       and job.provider_mutation_started_at is null
       and job.seller_account_key is null
       and coalesce((job.response_payload->>'ok')::boolean, false)
       and job.response_payload->>'channel' = 'lazada'
       and job.response_payload->>'operation' = 'oauth.exchange'
       and receipt.completion_fingerprint ~ '^[a-f0-9]{64}$'
       and receipt.created_at >= job.completed_at
       and receipt.created_at <= clock_timestamp() + interval '1 minute'
  )
  select candidate.* into v_oauth
    from candidates candidate
   where (select count(*) from candidates) = 1;
  if not found
     or v_active.seller_account_verified_at <
          v_oauth.credential_refresh_prepared_at
     or v_active.seller_account_verified_at > v_oauth.completed_at
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_oauth
        where other_oauth.channel = 'lazada'
          and other_oauth.environment = 'production'
          and other_oauth.operation = 'oauth.exchange'
          and other_oauth.status in (
            'queued', 'running', 'reconciliation_required'
          )
          and other_oauth.id not in (
            'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
            'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
          )
     ) then return null; end if;

  with candidates as materialized (
    select job.*
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.gateway_completion_receipts receipt
        on receipt.job_id = job.id
       and receipt.claim_token = job.claim_token
       and receipt.worker_token_id = job.worker_token_id
     where job.credential_id = v_active.id
       and job.created_by = v_target.owner_id
       and job.channel = 'lazada'
       and job.environment = 'production'
       and job.operation = 'shops.get'
       and job.status = 'succeeded'
       and job.error_message is null
       and job.attempt_count = 1
       and job.attempt_id is null
       and job.listing_id is null
       and job.worker_token_id is not null
       and job.claim_token is not null
       and job.lease_expires_at is null
       and job.started_at is not null
       and job.seller_account_key = v_active.seller_account_key
       and job.request_payload = jsonb_build_object('country', 'my')
       and job.created_at >= v_oauth.completed_at
       and job.started_at >= job.created_at
       and job.completed_at is not null
       and job.completed_at >= job.started_at
       and job.updated_at >= job.completed_at
       and job.completed_at <= clock_timestamp() + interval '1 minute'
       and not job.credential_refresh_in_flight
       and job.credential_refresh_started_at is null
       and job.prepared_credential_id is null
       and job.credential_refresh_fingerprint is null
       and job.credential_refresh_prepared_at is null
       and job.credential_refresh_recovery_vault_id is null
       and job.credential_refresh_recovery_fingerprint is null
       and job.credential_refresh_recovery_staged_at is null
       and job.oauth_request_vault_id is null
       and job.oauth_request_fingerprint is null
       and job.oauth_source_credential_id is null
       and not job.oauth_exchange_completed
       and job.oauth_provider_call_started_at is null
       and job.provider_mutation_started_at is null
       and job.response_payload->>'ok' = 'true'
       and job.response_payload->>'channel' = 'lazada'
       and job.response_payload->>'operation' = 'shops.get'
       and jsonb_typeof(job.response_payload->'steps') = 'array'
       and jsonb_array_length(job.response_payload->'steps') = 1
       and receipt.completion_fingerprint =
             sellerpilot_private.gateway_completion_fingerprint(
               'succeeded', job.response_payload, null,
               null, null, null, null
             )
       and receipt.created_at >= job.completed_at
       and receipt.created_at <= clock_timestamp() + interval '1 minute'
  )
  select candidate.* into v_seller_job
    from candidates candidate
   where (select count(*) from candidates) = 1;
  if not found or v_target.verified_at < v_seller_job.completed_at then
    return null;
  end if;

  v_step := v_seller_job.response_payload#>'{steps,0}';
  if coalesce(v_step->>'name', '') <> 'seller-info'
     or coalesce(v_step->>'ok', '') <> 'true'
     or coalesce((v_step->>'status')::integer, 0) not between 200 and 299 then
    return null;
  end if;
  v_seller := case
    when jsonb_typeof(v_step#>'{data,data}') = 'object'
      then v_step#>'{data,data}'
    when jsonb_typeof(v_step#>'{data,result,data}') = 'object'
      then v_step#>'{data,result,data}'
    when jsonb_typeof(v_step->'data') = 'object'
      then v_step->'data'
    else '{}'::jsonb
  end;
  v_readback_seller_id := trim(coalesce(
    v_seller->>'seller_id', v_seller->>'sellerId', v_seller->>'id', ''
  ));
  v_readback_status := lower(trim(coalesce(
    v_seller->>'is_active', v_seller->>'isActive',
    v_seller->>'status', v_seller->>'seller_status', ''
  )));
  if upper(trim(coalesce(v_seller->>'short_code',''))) <> 'MY4NNISR2D' then return null; end if;
  if v_readback_seller_id <> v_my_seller_id
     or v_readback_seller_id <> v_target.target_id
     or v_readback_status not in (
       'true', '1', 'yes', 'active', 'enabled'
     ) then return null; end if;

  return jsonb_build_object(
    'sourceCredentialId', v_source.id,
    'activeCredentialId', v_active.id,
    'oauthJobId', v_oauth.id,
    'sellerReadbackJobId', v_seller_job.id,
    'targetRowId', v_target.id,
    'sellerId', v_target.target_id
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end;
$$;

create or replace function
  sellerpilot_private.supersede_exact_lazada_three_blockers_after_readback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proof jsonb;
  v_superseded_at timestamptz;
  v_updated integer;
begin
  if new.owner_id <>
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or new.channel <> 'lazada'
     or new.environment <> 'production'
     or new.market_code <> 'MY'
     or new.target_id <> '300872000183' then
    return new;
  end if;

  begin
    perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('sellerpilot:lazada:production')
    );
    perform 1
      from sellerpilot_private.channel_gateway_jobs blocker
     where blocker.id in (
       'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
       'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid,
       'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
     )
     order by blocker.id
     for update;
    perform 1
      from sellerpilot_private.channel_credentials credential
     where credential.id in (
       'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid,
       new.credential_id
     )
     order by credential.id
     for update;

    v_proof := sellerpilot_private.exact_lazada_three_readback_proof(new.id);
    if v_proof is null then return new; end if;
    perform set_config(
      'sellerpilot.exact_lazada_dual_blocker_supersession',
      'v1:' || (v_proof->>'activeCredentialId'),
      true
    );
    perform set_config(
      'sellerpilot.exact_lazada_three_blocker_supersession',
      'v1:' || (v_proof->>'activeCredentialId'),
      true
    );
    v_superseded_at := clock_timestamp();
    update sellerpilot_private.channel_gateway_jobs blocker
       set status = 'cancelled',
           error_message = case blocker.id
             when 'faee01e1-2d68-4f99-951c-15684822fc43'::uuid then
               'LAZADA_OAUTH_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH_AND_SELLER_READBACK'
             when 'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid then
               'LAZADA_REFRESH_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH_AND_SELLER_READBACK'
             else
               'LAZADA_PROVIDER_FAILURE_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH_AND_SELLER_READBACK'
           end,
           credential_refresh_in_flight = false,
           credential_refresh_started_at = null,
           updated_at = v_superseded_at
     where blocker.id in (
       'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
       'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid,
       'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
     )
       and blocker.status = 'reconciliation_required'
       and blocker.credential_id =
             'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid
       and blocker.credential_refresh_in_flight;
    get diagnostics v_updated = row_count;
    if v_updated <> 3 then
      raise exception 'exact Lazada three-blocker supersession lost'
        using errcode = '55000';
    end if;

    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail, occurred_at
    )
    select
      '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
      case blocker.id
        when 'faee01e1-2d68-4f99-951c-15684822fc43'::uuid then
          'lazada_oauth_reconciliation_superseded_after_seller_readback'
        when 'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid then
          'lazada_refresh_reconciliation_superseded_after_seller_readback'
        else
          'lazada_provider_failure_reconciliation_superseded_after_seller_readback'
      end,
      'channel_gateway_job', blocker.id::text,
      jsonb_build_object(
        'channel', 'lazada',
        'environment', 'production',
        'source_credential_id',
          'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid,
        'active_credential_id', v_proof->>'activeCredentialId',
        'oauth_job_id', v_proof->>'oauthJobId',
        'seller_readback_job_id', v_proof->>'sellerReadbackJobId',
        'target_row_id', new.id,
        'market', 'MY',
        'seller_id', v_proof->>'sellerId',
        'failed_oauth_job_id',
          'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid,
        'failed_oauth_code_replayed', false,
        'provider_call_replayed', false,
        'listing_permit_created', false,
        'superseded_after_provider_certified_oauth', true,
        'superseded_after_active_seller_readback', true
      ),
      v_superseded_at
      from sellerpilot_private.channel_gateway_jobs blocker
     where blocker.id in (
       'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
       'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid,
       'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
     )
     order by blocker.id;
  exception when others then
    return new;
  end;
  return new;
end;
$$;
revoke all on function sellerpilot_private.exact_lazada_three_readback_proof(uuid) from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.supersede_exact_lazada_three_blockers_after_readback() from public,anon,authenticated,service_role;
commit;
