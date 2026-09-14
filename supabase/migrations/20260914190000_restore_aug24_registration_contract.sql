-- Restore the August 24 queue/result contract without replacing current RPCs or data.
-- Only explicitly tagged rollback jobs are claimed; scoped worker tokens and claim nonces remain enforced.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table sellerpilot_private.aug24_runtime_control (
 singleton boolean primary key default true check(singleton),
 release_sha text check(release_sha ~ '^[a-f0-9]{40}$'),
 active boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table sellerpilot_private.aug24_runtime_control enable row level security;
revoke all on sellerpilot_private.aug24_runtime_control from public,anon,authenticated,service_role;
insert into sellerpilot_private.aug24_runtime_control(singleton) values(true);
create function public.sellerpilot_aug24_activate_runtime(p_release_sha text,p_active boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_release_sha !~ '^[a-f0-9]{40}$' then raise exception 'invalid rollback release'; end if;
 update sellerpilot_private.aug24_runtime_control set release_sha=p_release_sha,active=p_active,updated_at=clock_timestamp() where singleton;
 return found;
end; $$;
revoke all on function public.sellerpilot_aug24_activate_runtime(text,boolean) from public,anon,authenticated;
grant execute on function public.sellerpilot_aug24_activate_runtime(text,boolean) to service_role;

create or replace function public.sellerpilot_aug24_enqueue_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
  v_listing_id uuid;
begin
  if not exists(select 1 from sellerpilot_private.aug24_runtime_control where active) then raise exception 'AUG24_RUNTIME_NOT_ACTIVE'; end if;
  if p_request_payload ? 'sellerpilotRollbackListingId' then
    v_listing_id:=(p_request_payload->>'sellerpilotRollbackListingId')::uuid;
    if not exists(select 1 from sellerpilot_private.product_listings l join sellerpilot_private.channel_operation_attempts a on a.id=p_attempt_id where l.id=v_listing_id and l.channel_key=p_channel and l.owner_id=a.owner_id and a.credential_id=p_credential_id) then raise exception 'rollback listing ownership mismatch'; end if;
  end if;
  if p_operation in ('listing.create','listing.update','listing.stop') and v_listing_id is null then raise exception 'rollback listing identity required'; end if;
  if p_channel='temu' then raise exception 'TEMU_EXCLUDED_FROM_AUG24_RESTORE'; end if;
  if p_channel not in ('shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'qoo10', 'ebay')
     or p_operation not in (
       'oauth.exchange', 'shops.get', 'diagnostic.test',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'inquiries.list', 'shipment.acknowledge', 'shipment.confirm'
     )
     or (p_channel in ('coupang', 'smartstore', 'temu') and p_operation in ('oauth.exchange', 'shops.get'))
     or (p_channel = 'elevenst' and p_operation not in (
       'diagnostic.test', 'categories.list', 'categories.suggest', 'categories.attributes',
       'categories.validate', 'listing.create', 'listing.stop', 'orders.list'
     ))
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid channel gateway job';
  end if;
  select c.environment, c.created_by into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = p_channel and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now()) for update;
  if not found then raise exception 'active channel credential required'; end if;
  if p_attempt_id is not null and not exists (
    select 1 from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id and a.credential_id = p_credential_id
       and a.channel = p_channel and a.operation = p_operation and a.status = 'running'
  ) then raise exception 'running channel operation required'; end if;
  if v_listing_id is not null then
    update sellerpilot_private.product_listings set operation_attempt_id=p_attempt_id where id=v_listing_id;
  end if;
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment,
    request_payload, created_by, listing_id
  ) values (
    v_id, p_credential_id, p_attempt_id, p_channel, p_operation, v_environment,
    p_request_payload || jsonb_build_object('sellerpilotRollbackRuntime','20260824'), v_created_by, v_listing_id
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_aug24_claim_gateway_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_result jsonb;
begin
  if not exists(select 1 from sellerpilot_private.aug24_runtime_control where active and p_worker_version='sellerpilot-cli-worker/1.16+'||release_sha) then return null; end if;
  if not sellerpilot_private.worker_token_has_scope(p_token_hash,'gateway',true) then raise exception 'gateway scoped token required' using errcode='42501'; end if;
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now()
   for update;
  if v_token_id is null then raise exception 'invalid worker token' using errcode = '42501'; end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now(), last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  update sellerpilot_private.channel_gateway_jobs
     set status = case when operation in ('listing.create','listing.update','listing.stop','price.update','inventory.update','inquiries.reply','shipment.confirm','shipment.acknowledge') then 'reconciliation_required' when attempt_count >= 4 then 'failed' else 'queued' end,
         error_message = case when attempt_count >= 4 then 'Channel worker lease expired four times.' else error_message end,
         worker_token_id = null,
         lease_expires_at = null,
         completed_at = case when attempt_count >= 4 then now() else completed_at end,
         updated_at = now()
   where status = 'running' and lease_expires_at < now() and request_payload->>'sellerpilotRollbackRuntime'='20260824';

  select j.id into v_job_id
    from sellerpilot_private.channel_gateway_jobs j
   where j.status = 'queued' and j.channel <> 'temu' and j.request_payload->>'sellerpilotRollbackRuntime'='20260824'
   order by case when j.attempt_id is null then 1 else 0 end, j.created_at
   for update skip locked
   limit 1;
  if v_job_id is null then return null; end if;

  perform set_config('sellerpilot.aug24_claim_job',v_job_id::text,true);
  perform set_config('sellerpilot.aug24_claim_release',substring(p_worker_version from '[a-f0-9]{40}$'),true);
  update sellerpilot_private.channel_gateway_jobs
     set status = 'running', claim_token = gen_random_uuid(),
         worker_token_id = v_token_id,
         attempt_count = attempt_count + 1,
         lease_expires_at = now() + interval '3 minutes',
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = v_job_id;

  select jsonb_build_object(
    'id', j.id, 'claimToken', j.claim_token,
    'credential_id', j.credential_id,
    'channel', j.channel,
    'operation', j.operation,
    'environment', j.environment,
    'request', j.request_payload,
    'attempt_count', j.attempt_count,
    'credential', d.decrypted_secret::jsonb
  ) into v_result
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c on c.id = j.credential_id
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where j.id = v_job_id
     and c.status = 'active';

  if v_result is null then
    update sellerpilot_private.channel_gateway_jobs
       set status = 'failed', error_message = 'Active credential could not be decrypted.',
           lease_expires_at = null, completed_at = now(), updated_at = now()
     where id = v_job_id;
  end if;
  return v_result;
end;
$$;

create or replace function public.sellerpilot_aug24_complete_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_token_id uuid;
  v_attempt_id uuid;
  v_operation text;
  v_updated integer;
  v_success boolean := false;
  v_remote_id text;
  v_public_url text;
  v_safe_message text;
  v_http_status integer;
  v_listing_id uuid;
  v_product_id uuid;
  v_owner_id uuid;
  v_channel text;
begin
  if not sellerpilot_private.worker_token_has_scope(p_token_hash,'gateway',true) then raise exception 'gateway scoped token required' using errcode='42501'; end if;
  if p_status not in ('succeeded', 'failed')
     or (p_response_payload is not null and (
       jsonb_typeof(p_response_payload) <> 'object' or octet_length(p_response_payload::text) > 1000000
     )) then
    raise exception 'invalid channel gateway completion';
  end if;
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash and t.status = 'active' and t.expires_at > now();
  if v_token_id is null then raise exception 'invalid worker token' using errcode = '42501'; end if;

  select j.attempt_id, j.operation, j.channel
    into v_attempt_id, v_operation, v_channel
    from sellerpilot_private.channel_gateway_jobs j
   where j.id = p_job_id and j.status = 'running' and j.worker_token_id = v_token_id and j.claim_token=p_claim_token and j.request_payload->>'sellerpilotRollbackRuntime'='20260824'
   for update;
  if not found then return false; end if;

  update sellerpilot_private.channel_gateway_jobs
     set status = p_status,
         response_payload = case when p_status = 'succeeded' then p_response_payload else null end,
         error_message = case when p_status = 'failed' then left(coalesce(p_error_message, 'Channel worker failed.'), 500) else null end,
         lease_expires_at = null,
         completed_at = now(), updated_at = now()
   where id = p_job_id and status = 'running' and worker_token_id = v_token_id and claim_token=p_claim_token and request_payload->>'sellerpilotRollbackRuntime'='20260824';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  if v_attempt_id is null
     or v_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or p_status <> 'succeeded'
     or jsonb_typeof(p_response_payload) <> 'object' then
    return true;
  end if;

  v_success := coalesce((p_response_payload->>'ok')::boolean, false);
  v_remote_id := left(nullif(trim(p_response_payload->>'remoteId'), ''), 240);
  v_public_url := left(nullif(trim(p_response_payload->>'publicUrl'), ''), 500);
  v_safe_message := left(coalesce(nullif(trim(p_response_payload->>'safeMessage'), ''), '채널 작업 결과가 저장됐습니다.'), 1000);
  select coalesce((step->>'status')::integer, 422) into v_http_status
    from jsonb_array_elements(coalesce(p_response_payload->'steps', '[]'::jsonb)) step
   where coalesce((step->>'ok')::boolean, false) = false
   limit 1;
  v_http_status := coalesce(v_http_status, case when v_success then 200 else 422 end);

  update sellerpilot_private.channel_operation_attempts a
     set status = case when v_success then 'succeeded' else 'failed' end,
         http_status = v_http_status,
         remote_id = coalesce(v_remote_id, a.remote_id),
         safe_message = v_safe_message,
         completed_at = now()
   where a.id = v_attempt_id
     and (
       a.status = 'running'
       or (a.status = 'failed' and coalesce(a.safe_message, '') like '%응답 제한시간%')
     );

  select l.id, l.product_id, l.owner_id
    into v_listing_id, v_product_id, v_owner_id
    from sellerpilot_private.product_listings l
   where l.operation_attempt_id = v_attempt_id
   limit 1;
  if v_listing_id is null then return true; end if;

  update sellerpilot_private.product_listings l
     set status = case
       when not v_success then 'failed'
       when v_operation = 'listing.stop' then 'paused'
       else 'published'
     end,
         remote_id = coalesce(v_remote_id, l.remote_id),
         public_url = case when v_success then coalesce(v_public_url, l.public_url) else l.public_url end,
         last_error = case when v_success then null else v_safe_message end,
         failure_class = case when v_success then null else 'retryable' end,
         published_at = case
           when v_success and v_operation in ('listing.create', 'listing.update') then coalesce(l.published_at, now())
           else l.published_at
         end,
         last_verified_at = case when v_success then now() else l.last_verified_at end,
         updated_at = now()
   where l.id = v_listing_id;

  if v_success and v_operation in ('listing.create', 'listing.update') then
    update sellerpilot_private.products set status = 'active', updated_at = now() where id = v_product_id;
  end if;
  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (
    v_owner_id,
    case when v_success then 'gateway_listing_reconciled' else 'gateway_listing_failed' end,
    'product_listing',
    v_listing_id::text,
    jsonb_build_object('attempt_id', v_attempt_id, 'operation', v_operation, 'channel', v_channel, 'has_remote_id', v_remote_id is not null)
  );
  return true;
end;
$$;

create or replace function public.sellerpilot_aug24_complete_product_listing(
  p_listing_id uuid,
  p_attempt_id uuid,
  p_operation text,
  p_success boolean,
  p_remote_id text,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner uuid;
  v_product uuid;
  v_channel text;
  v_updated integer := 0;
  v_failure_class text;
begin
  if p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or length(coalesce(p_remote_id, '')) > 240
     or length(coalesce(p_safe_message, '')) > 1000 then
    raise exception 'invalid listing completion request';
  end if;

  select l.owner_id, l.product_id, l.channel_key
    into v_owner, v_product, v_channel
    from sellerpilot_private.product_listings l
   where l.id = p_listing_id;
  if v_owner is null or not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id
       and a.channel = v_channel
       and a.operation = p_operation
  ) then
    raise exception 'listing attempt mismatch';
  end if;

  v_failure_class := case
    when p_success then null
    when coalesce(p_safe_message, '') ~* '(permission|authority|not authorized|not authori[sz]ed|certification|certificate|mandatory|required|필수|카테고리.*권한|판매.*권한|인증정보|인증 자료|partner does not have permission|language must be)' then 'external_action'
    else 'retryable'
  end;

  update sellerpilot_private.product_listings
     set status = case
       when not p_success then 'failed'
       when p_operation = 'listing.stop' then 'paused'
       else 'published'
     end,
         remote_id = case
           when nullif(trim(coalesce(p_remote_id, '')), '') is not null then trim(p_remote_id)
           else remote_id
         end,
         operation_attempt_id = p_attempt_id,
         last_error = case when p_success then null else nullif(trim(coalesce(p_safe_message, '')), '') end,
         failure_class = v_failure_class,
         published_at = case
           when p_success and p_operation in ('listing.create', 'listing.update') then coalesce(published_at, now())
           else published_at
         end,
         last_verified_at = case when p_success then now() else last_verified_at end,
         updated_at = now()
   where id = p_listing_id;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    update sellerpilot_private.products
       set status = case
         when p_success and p_operation in ('listing.create', 'listing.update') then 'active'
         when p_success and p_operation = 'listing.stop' and not exists (
           select 1 from sellerpilot_private.product_listings l
            where l.product_id = v_product and l.status = 'published'
         ) then 'archived'
         else status
       end,
           updated_at = now()
     where id = v_product;

    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      v_owner,
      case when p_success then 'listing_remote_succeeded' else 'listing_remote_failed' end,
      'product_listing', p_listing_id::text,
      jsonb_build_object(
        'attempt_id', p_attempt_id,
        'operation', p_operation,
        'channel', v_channel,
        'has_remote_id', nullif(trim(coalesce(p_remote_id, '')), '') is not null,
        'failure_class', v_failure_class
      )
    );
  end if;
  return v_updated = 1;
end;
$$;
revoke all on function public.sellerpilot_aug24_enqueue_gateway_job(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_aug24_enqueue_gateway_job(uuid,uuid,text,text,jsonb) to service_role;

revoke all on function public.sellerpilot_aug24_claim_gateway_job(text,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_aug24_claim_gateway_job(text,text) to service_role;

revoke all on function public.sellerpilot_aug24_complete_gateway_job(text,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_aug24_complete_gateway_job(text,uuid,uuid,text,jsonb,text) to service_role;

revoke all on function public.sellerpilot_aug24_complete_product_listing(uuid,uuid,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_aug24_complete_product_listing(uuid,uuid,text,boolean,text,text) to service_role;

create function public.sellerpilot_aug24_validate_completion(p_token_hash text,p_job_id uuid,p_claim_token uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select sellerpilot_private.worker_token_has_scope(p_token_hash,'gateway',true)
 and exists(select 1 from sellerpilot_private.channel_gateway_jobs j join sellerpilot_private.ai_cli_worker_tokens t on t.id=j.worker_token_id
 where j.id=p_job_id and j.status='running' and j.claim_token=p_claim_token
 and j.request_payload->>'sellerpilotRollbackRuntime'='20260824' and t.token_hash=p_token_hash and t.status='active' and t.expires_at>now());
$$;
revoke all on function public.sellerpilot_aug24_validate_completion(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellerpilot_aug24_validate_completion(text,uuid,uuid) to service_role;

do $$ begin if md5(pg_get_functiondef('sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure)) <> '177d3268bc7c94475ff315d813b0028f' then raise exception 'rollback claim guard preimage changed'; end if; end $$;
CREATE OR REPLACE FUNCTION sellerpilot_private.block_closed_listing_mutation_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.status='queued' and new.status='running'
     and new.channel <> 'temu'
     and old.request_payload->>'sellerpilotRollbackRuntime'='20260824'
     and old.request_payload is not distinct from new.request_payload
     and current_setting('sellerpilot.aug24_claim_job',true)=new.id::text
     and exists(select 1 from sellerpilot_private.aug24_runtime_control c
       where c.active and c.release_sha=current_setting('sellerpilot.aug24_claim_release',true))
     and exists(select 1 from sellerpilot_private.ai_cli_worker_tokens t
       where t.id=new.worker_token_id and t.status='active' and t.expires_at>now()
       and sellerpilot_private.worker_token_has_scope(t.token_hash,'gateway',true))
     and new.claim_token is not null then return new; end if;
  if old.status='queued' and new.status='running'
     and (
       old.operation in ('listing.create','listing.update','listing.stop','listing.activate')
       or new.operation in ('listing.create','listing.update','listing.stop','listing.activate')
     )
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       coalesce(new.channel,old.channel)
     )
     and not (
       sellerpilot_private.bind_exact_qoo10_preprovider_resume_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_qoo10_localization_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_smartstore_qa_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_existing_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_smartstore_existing_content_repair_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_shopee_sg_exact_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_temu_server_owned_mutation_claim(
         to_jsonb(old),to_jsonb(new)
       )
     )
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode='55000';
  end if;
  return new;
end;
$function$
;
commit;
