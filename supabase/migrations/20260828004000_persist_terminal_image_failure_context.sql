-- Preserve only compact, schema-validated setting-shot failure signatures
-- across an explicit same-ID retry. No image bytes, signed URLs, worker claim
-- tokens or marketplace credentials are stored in this context.

begin;

create or replace function sellerpilot_private.is_valid_terminal_image_failure_key_array(
  p_value jsonb,
  p_minimum integer,
  p_maximum integer,
  p_allow_colon boolean default false
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_item jsonb;
  v_text text;
  v_count integer;
  v_distinct_count integer;
begin
  if jsonb_typeof(p_value) <> 'array'
     or p_minimum < 0
     or p_maximum < p_minimum
     or jsonb_array_length(p_value) not between p_minimum and p_maximum then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(v_item) <> 'string' then return false; end if;
    v_text := v_item #>> '{}';
    if (not p_allow_colon and v_text !~ '^[a-z][a-z0-9-]{0,63}$')
       or (p_allow_colon and v_text !~ '^[a-z][a-z0-9:-]{0,63}$') then
      return false;
    end if;
  end loop;
  select count(*), count(distinct value #>> '{}')
    into v_count, v_distinct_count
    from jsonb_array_elements(p_value);
  return v_count = v_distinct_count;
end;
$$;

create or replace function sellerpilot_private.is_valid_terminal_image_failure_context(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_semantic jsonb;
  v_lineage jsonb;
  v_width text;
  v_height text;
  v_generation text;
begin
  if jsonb_typeof(p_value) <> 'object'
     or not (p_value ?& array['version', 'generation', 'entries'])
     or p_value - array['version', 'generation', 'entries'] <> '{}'::jsonb
     or p_value->'version' <> '1'::jsonb
     or jsonb_typeof(p_value->'generation') <> 'number'
     or jsonb_typeof(p_value->'entries') <> 'array'
     or jsonb_array_length(p_value->'entries') not between 1 and 12
     -- Every stored string is restricted to the no-whitespace token regexes
     -- below. Removing jsonb's formatting spaces therefore yields the same
     -- compact UTF-8 representation measured by JSON.stringify in the worker.
     or pg_catalog.octet_length(pg_catalog.replace(p_value::text, ' ', '')) > 16384 then
    return false;
  end if;
  v_generation := p_value->>'generation';
  if v_generation !~ '^[1-9][0-9]{0,5}$'
     or v_generation::integer > 100000 then
    return false;
  end if;

  for v_entry in select value from jsonb_array_elements(p_value->'entries')
  loop
    if jsonb_typeof(v_entry) <> 'object'
       or not (v_entry ?& array[
         'role', 'width', 'height', 'failureDimensions',
         'semanticSignature', 'rejectedAssetLineage'
       ])
       or v_entry - array[
         'role', 'width', 'height', 'failureDimensions',
         'semanticSignature', 'rejectedAssetLineage'
       ] <> '{}'::jsonb
       or v_entry->>'role' not in (
         'portrait', 'wide', 'detail-overview', 'detail-use',
         'detail-routine', 'detail-scale', 'detail-storage', 'detail-context'
       )
       or jsonb_typeof(v_entry->'width') <> 'number'
       or jsonb_typeof(v_entry->'height') <> 'number'
       or not sellerpilot_private.is_valid_terminal_image_failure_key_array(
         v_entry->'failureDimensions', 1, 24, false
       ) then
      return false;
    end if;
    v_width := v_entry->>'width';
    v_height := v_entry->>'height';
    if v_width !~ '^[1-9][0-9]{0,3}$'
       or v_height !~ '^[1-9][0-9]{0,3}$'
       or v_width::integer > 8192
       or v_height::integer > 8192 then
      return false;
    end if;

    v_semantic := v_entry->'semanticSignature';
    if jsonb_typeof(v_semantic) <> 'object'
       or not (v_semantic ?& array[
         'locationKeys', 'momentKeys', 'surfaceKeys', 'cameraKeys',
         'paletteKeys', 'spatialDepthKeys', 'cueKeys'
       ])
       or v_semantic - array[
         'locationKeys', 'momentKeys', 'surfaceKeys', 'cameraKeys',
         'paletteKeys', 'spatialDepthKeys', 'cueKeys'
       ] <> '{}'::jsonb
       or not sellerpilot_private.is_valid_terminal_image_failure_key_array(v_semantic->'locationKeys', 0, 24, false)
       or not sellerpilot_private.is_valid_terminal_image_failure_key_array(v_semantic->'momentKeys', 0, 24, false)
       or not sellerpilot_private.is_valid_terminal_image_failure_key_array(v_semantic->'surfaceKeys', 0, 24, false)
       or not sellerpilot_private.is_valid_terminal_image_failure_key_array(v_semantic->'cameraKeys', 0, 24, false)
       or not sellerpilot_private.is_valid_terminal_image_failure_key_array(v_semantic->'paletteKeys', 0, 24, false)
       or not sellerpilot_private.is_valid_terminal_image_failure_key_array(v_semantic->'spatialDepthKeys', 0, 24, false)
       or not sellerpilot_private.is_valid_terminal_image_failure_key_array(v_semantic->'cueKeys', 0, 24, false) then
      return false;
    end if;

    v_lineage := v_entry->'rejectedAssetLineage';
    if jsonb_typeof(v_lineage) <> 'object'
       or not (v_lineage ?& array[
         'attempt', 'digest', 'topologySignature', 'conflictingAssetIds'
       ])
       or v_lineage - array[
         'attempt', 'digest', 'topologySignature', 'conflictingAssetIds'
       ] <> '{}'::jsonb
       or jsonb_typeof(v_lineage->'attempt') <> 'number'
       or (v_lineage->>'attempt') !~ '^[1-4]$'
       or (v_lineage->>'digest') !~ '^[a-f0-9]{64}$'
       or (v_lineage->>'topologySignature') !~ '^[a-f0-9]{64}$'
       or not sellerpilot_private.is_valid_terminal_image_failure_key_array(
         v_lineage->'conflictingAssetIds', 0, 8, true
       ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function sellerpilot_private.is_valid_terminal_image_failure_key_array(jsonb, integer, integer, boolean)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.is_valid_terminal_image_failure_context(jsonb)
  from public, anon, authenticated, service_role;

alter table sellerpilot_private.ai_cli_jobs
  add column if not exists terminal_image_failure_context jsonb;

alter table sellerpilot_private.ai_cli_jobs
  drop constraint if exists ai_cli_jobs_terminal_image_failure_context_check;
alter table sellerpilot_private.ai_cli_jobs
  add constraint ai_cli_jobs_terminal_image_failure_context_check
  check (
    terminal_image_failure_context is null
    or sellerpilot_private.is_valid_terminal_image_failure_context(
      terminal_image_failure_context
    )
  );

-- The delegated claimant keeps queue locking and lease behavior unchanged.
-- The extra JSON key is read back only from the exact row and claim nonce that
-- the authenticated AI-scoped token just acquired. Older workers ignore it.
create or replace function public.sellerpilot_claim_ai_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_context jsonb;
begin
  if not sellerpilot_private.worker_token_has_scope(p_token_hash, 'ai', true) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_260826_claim_ai_job_unscoped(
    p_token_hash,
    p_worker_version
  );
  if v_result is null then return null; end if;

  select job.terminal_image_failure_context
    into v_context
    from sellerpilot_private.ai_cli_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
   where job.id = (v_result->>'id')::uuid
     and job.status = 'running'
     and job.claim_token = (v_result->>'claim_token')::uuid
     and token.token_hash = p_token_hash;
  if not found then
    raise exception 'claimed AI job ownership mismatch';
  end if;
  if v_context is not null then
    v_result := v_result || jsonb_build_object(
      'terminal_image_failure_context', v_context
    );
  end if;
  return v_result;
end;
$$;

create or replace function sellerpilot_private.ai_completion_fingerprint_with_image_context(
  p_status text,
  p_result_payload jsonb,
  p_error_message text,
  p_terminal_image_failure_context jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_terminal_image_failure_context is null then
      sellerpilot_private.ai_completion_fingerprint(
        p_status,
        p_result_payload,
        p_error_message
      )
    else encode(
      extensions.digest(
        jsonb_build_object(
          'status', p_status,
          'result', case when p_status = 'succeeded' then p_result_payload else null end,
          'error', case
            when p_status = 'failed'
              then left(coalesce(p_error_message, 'CLI worker failed.'), 500)
            else null
          end,
          'terminal_image_failure_context', p_terminal_image_failure_context
        )::text,
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function sellerpilot_private.ai_completion_fingerprint_with_image_context(text, jsonb, text, jsonb)
  from public, anon, authenticated, service_role;

-- Use a distinct RPC name rather than a seven-argument overload of the
-- existing function. This avoids PostgREST overload ambiguity and keeps a
-- rolling older completion route compatible during deployment.
create or replace function public.sellerpilot_complete_ai_job_with_image_context(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_result_payload jsonb default null,
  p_error_message text default null,
  p_terminal_image_failure_context jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_fingerprint text;
  v_receipt record;
  v_completed boolean;
  v_kind text;
  v_updated integer;
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid completion status';
  end if;
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null then
    return false;
  end if;
  if p_terminal_image_failure_context is not null
     and (
       p_status <> 'failed'
       or not sellerpilot_private.is_valid_terminal_image_failure_context(
         p_terminal_image_failure_context
       )
     ) then
    raise exception 'invalid terminal image failure context';
  end if;

  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope in ('ai', 'legacy_combined')
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  v_fingerprint := sellerpilot_private.ai_completion_fingerprint_with_image_context(
    p_status,
    p_result_payload,
    p_error_message,
    p_terminal_image_failure_context
  );
  select receipt.status, receipt.completion_fingerprint
    into v_receipt
    from sellerpilot_private.ai_job_completion_receipts receipt
   where receipt.job_id = p_job_id
     and receipt.worker_token_id = v_token_id
     and receipt.claim_token = p_claim_token;
  if found then
    return v_receipt.status = p_status
       and v_receipt.completion_fingerprint = v_fingerprint;
  end if;

  if p_terminal_image_failure_context is not null then
    select job.kind into v_kind
      from sellerpilot_private.ai_cli_jobs job
     where job.id = p_job_id
       and job.status = 'running'
       and job.worker_token_id = v_token_id
       and job.claim_token = p_claim_token
       and job.lease_expires_at > clock_timestamp();
    if not found then return false; end if;
    if v_kind not in ('product_studio', 'product_asset_regeneration') then
      raise exception 'terminal image failure context is not allowed for this job kind';
    end if;
  end if;

  v_completed := public.sellerpilot_260826_complete_ai_job_once(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_status,
    p_result_payload,
    p_error_message
  );
  if v_completed then
    update sellerpilot_private.ai_cli_jobs job
       set terminal_image_failure_context = case
         when p_status = 'succeeded' then null
         when p_terminal_image_failure_context is not null
           then p_terminal_image_failure_context
         else job.terminal_image_failure_context
       end
     where job.id = p_job_id;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'terminal image failure context update failed';
    end if;

    insert into sellerpilot_private.ai_job_completion_receipts (
      job_id, worker_token_id, claim_token, status, completion_fingerprint
    ) values (
      p_job_id, v_token_id, p_claim_token, p_status, v_fingerprint
    );
    return true;
  end if;

  select receipt.status, receipt.completion_fingerprint
    into v_receipt
    from sellerpilot_private.ai_job_completion_receipts receipt
   where receipt.job_id = p_job_id
     and receipt.worker_token_id = v_token_id
     and receipt.claim_token = p_claim_token;
  return found
     and v_receipt.status = p_status
     and v_receipt.completion_fingerprint = v_fingerprint;
end;
$$;

revoke all on function public.sellerpilot_claim_ai_job(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_ai_job(text, text)
  to service_role;

revoke all on function public.sellerpilot_complete_ai_job_with_image_context(text, uuid, uuid, text, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_complete_ai_job_with_image_context(text, uuid, uuid, text, jsonb, text, jsonb)
  to service_role;

commit;
