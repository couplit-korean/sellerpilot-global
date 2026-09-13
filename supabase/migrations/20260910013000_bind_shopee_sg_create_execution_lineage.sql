-- Carry the exact credential-version/shop selection from the admin prepare
-- request to the last durable boundary before a Shopee provider mutation.
-- Queued jobs may otherwise be rebound to a later active credential by the
-- generic claim lifecycle, losing the version that passed the route check.

begin;

do $preimage$
begin
  if pg_catalog.to_regclass('sellerpilot_private.channel_market_targets') is null
     or not exists (
       select 1
         from pg_catalog.pg_attribute attribute
        where attribute.attrelid =
              'sellerpilot_private.channel_market_targets'::pg_catalog.regclass
          and attribute.attname = 'credential_version'
          and not attribute.attisdropped
     )
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text)'
     ) is null then
    raise exception 'SHOPEE_SG_CREATE_EXECUTION_LINEAGE_PREIMAGE_REQUIRED';
  end if;
end
$preimage$;

create function sellerpilot_private.shopee_sg_create_job_v1(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = p_job_id
       and job.claim_token = p_claim_token
       and job.channel = 'shopee'
       and job.operation = 'listing.create'
       and job.environment = 'production'
       and (
         pg_catalog.upper(coalesce(
           job.request_payload #>>
             '{arguments,sellerpilotShopeeSgCreateContext,market}', ''
         )) = 'SG'
         or pg_catalog.upper(coalesce(
           job.request_payload #>> '{arguments,publish,shop_region}', ''
         )) = 'SG'
         or pg_catalog.lower(coalesce(
           job.request_payload #>> '{arguments,country}', ''
         )) = 'sg'
         or pg_catalog.lower(coalesce(
           job.request_payload #>> '{arguments,publicationExpectedLocale}', ''
         )) = 'en-sg'
       )
  )
$$;

create function sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_marker jsonb;
  v_marker_credential_id uuid;
  v_marker_credential_version integer;
  v_target_record_id uuid;
  v_secret_target jsonb;
  v_secret_target_count integer;
  v_access_expires_at timestamptz;
begin
  -- Use the ledger lock before row locks. Credential rotation takes its
  -- channel advisory lock and then this same credential row, so the row lock
  -- makes rotation and the provider boundary have one committed winner.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:shopee:production')
  );

  select job.credential_id,
         job.created_by,
         job.request_payload,
         credential.version credential_version,
         decrypted.decrypted_secret::jsonb secret_payload
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = 'shopee'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > pg_catalog.clock_timestamp())
     and credential.created_by = job.created_by
    join vault.decrypted_secrets decrypted
      on decrypted.id = credential.vault_secret_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
     and job.environment = 'production'
   for update of job, credential;
  if not found then return false; end if;

  v_marker := v_job.request_payload #>
    '{arguments,sellerpilotShopeeSgCreateExecutionLineage}';
  if pg_catalog.jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker - array[
       'contract', 'credentialId', 'credentialVersion', 'targetId', 'marketCode'
     ] <> '{}'::jsonb
     or v_marker ->> 'contract' is distinct from
          'shopee_sg_create_execution_lineage_v1'
     or coalesce(v_marker ->> 'credentialId', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_marker ->> 'credentialVersion', '') !~
          '^[1-9][0-9]{0,8}$'
     or coalesce(v_marker ->> 'targetId', '') !~
          '^[1-9][0-9]{0,31}$'
     or v_marker ->> 'marketCode' is distinct from 'SG' then
    return false;
  end if;

  v_marker_credential_id := (v_marker ->> 'credentialId')::uuid;
  v_marker_credential_version := (v_marker ->> 'credentialVersion')::integer;
  if v_marker_credential_id is distinct from v_job.credential_id
     or v_marker_credential_version is distinct from v_job.credential_version
     or v_job.request_payload #>>
          '{arguments,sellerpilotShopeeSgCreateContext,contract}' is distinct from
          'sellerpilot_shopee_sg_listing_create_context_v2'
     or v_job.request_payload #>>
          '{arguments,sellerpilotShopeeSgCreateContext,targetId}' is distinct from
          v_marker ->> 'targetId'
     or v_job.request_payload #>> '{arguments,shopId}' is distinct from
          v_marker ->> 'targetId'
     or v_job.request_payload #>> '{arguments,publish,shop_id}' is distinct from
          v_marker ->> 'targetId'
     or v_job.request_payload #>> '{arguments,globalProduct}' is distinct from 'true'
     or pg_catalog.lower(coalesce(
          v_job.request_payload #>> '{arguments,country}', ''
        )) <> 'sg' then
    return false;
  end if;

  select target.id
    into v_target_record_id
    from sellerpilot_private.channel_market_targets target
   where target.owner_id = v_job.created_by
     and target.credential_id = v_job.credential_id
     and target.credential_version = v_job.credential_version
     and target.channel = 'shopee'
     and target.environment = 'production'
     and target.target_id = v_marker ->> 'targetId'
     and target.market_code = 'SG'
     and target.locale = 'en-SG'
     and target.language = 'English'
     and target.currency = 'SGD'
     and target.verified_at <= pg_catalog.clock_timestamp() + interval '5 minutes'
   for update;
  if not found then return false; end if;

  if v_job.secret_payload ->> 'provider_account_identity_version'
       is distinct from 'v1'
     or coalesce(
       v_job.secret_payload ->> 'provider_account_subject', ''
     ) !~ '^shopee:(main|shop):[1-9][0-9]{0,31}$'
     or pg_catalog.jsonb_typeof(v_job.secret_payload -> 'shopee_targets')
       is distinct from 'array' then
    return false;
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.jsonb_agg(entry.value) -> 0
    into v_secret_target_count, v_secret_target
    from pg_catalog.jsonb_array_elements(
      v_job.secret_payload -> 'shopee_targets'
    ) entry(value)
   where entry.value ->> 'type' = 'shop'
     and entry.value ->> 'id' = v_marker ->> 'targetId';
  if v_secret_target_count <> 1 then return false; end if;

  if pg_catalog.jsonb_typeof(v_secret_target -> 'access_token')
       is distinct from 'string'
     or pg_catalog.btrim(coalesce(
       v_secret_target ->> 'access_token', ''
     )) = ''
     or pg_catalog.jsonb_typeof(
       v_secret_target -> 'access_token_expires_at'
     ) is distinct from 'string'
     or pg_catalog.btrim(coalesce(
       v_secret_target ->> 'access_token_expires_at', ''
     )) = '' then
    return false;
  end if;

  begin
    v_access_expires_at :=
      (v_secret_target ->> 'access_token_expires_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    return false;
  end;
  if v_access_expires_at is null
     or not pg_catalog.isfinite(v_access_expires_at) then
    return false;
  end if;
  return coalesce(
    v_access_expires_at >
      pg_catalog.clock_timestamp() + interval '10 minutes',
    false
  );
end
$$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) rename to sp_60910013000_begin_gateway_before_shopee_create;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if sellerpilot_private.shopee_sg_create_job_v1(p_job_id, p_claim_token)
     and sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    return false;
  end if;
  return public.sp_60910013000_begin_gateway_before_shopee_create(
    p_token_hash, p_job_id, p_claim_token
  );
end
$$;

alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  text, uuid, uuid
) rename to sp_60910013000_begin_serverless_before_shopee_create;

create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if sellerpilot_private.shopee_sg_create_job_v1(p_job_id, p_claim_token)
     and sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    return false;
  end if;
  return public.sp_60910013000_begin_serverless_before_shopee_create(
    p_token_hash, p_job_id, p_claim_token
  );
end
$$;

alter function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
  text, uuid, uuid, text, text
) rename to sp_60910013000_begin_shopee_refresh_before_create;

create function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_target_type text,
  p_target_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if sellerpilot_private.shopee_sg_create_job_v1(p_job_id, p_claim_token)
     and sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    return pg_catalog.jsonb_build_object(
      'contract', 'sellerpilot-shopee-target-refresh-claim/1',
      'status', 'conflict'
    );
  end if;
  return public.sp_60910013000_begin_shopee_refresh_before_create(
    p_token_hash, p_job_id, p_claim_token, p_target_type, p_target_id
  );
end
$$;

revoke all on function sellerpilot_private.shopee_sg_create_job_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sp_60910013000_begin_gateway_before_shopee_create(
  text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function
  public.sp_60910013000_begin_serverless_before_shopee_create(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sp_60910013000_begin_shopee_refresh_before_create(
  text, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) to service_role;
revoke all on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  ) to service_role;
revoke all on function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
  text, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
  text, uuid, uuid, text, text
) to service_role;

commit;
