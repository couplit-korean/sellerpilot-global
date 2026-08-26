-- Do not keep enqueueing Shopee order reads for a legacy OAuth credential that
-- has never been attested to a provider account. The worker deliberately
-- rejects those jobs; the safe recovery is a fresh OAuth authorization, never
-- a guessed identity backfill.

begin;

-- Close only unclaimed internal polling jobs that are guaranteed to fail on
-- the legacy credential. Running/claimed work, manual reads, and every
-- inquiry operation remain untouched. Keep one safe audit row per job.
with cancelled_jobs as (
  update sellerpilot_private.channel_gateway_jobs j
     set status = 'cancelled',
         error_message = 'SHOPEE_OAUTH_RECONNECT_REQUIRED',
         completed_at = now(),
         updated_at = now()
    from sellerpilot_private.channel_credentials c
   where j.credential_id = c.id
     and j.channel = 'shopee'
     and j.operation = 'orders.list'
     and j.status = 'queued'
     and j.attempt_count = 0
     and j.attempt_id is null
     and nullif(trim(j.request_payload->>'periodicKey'), '') is not null
     and c.seller_account_key is null
     and c.seller_account_key_source = 'legacy_unattested'
     and c.seller_account_verified_at is null
  returning j.id, j.created_by
)
insert into sellerpilot_private.operation_audit (
  owner_id, action, entity_type, entity_id, safe_detail
)
select cancelled.created_by,
       'shopee_periodic_order_sync_suppressed',
       'channel_gateway_job',
       cancelled.id::text,
       jsonb_build_object(
         'channel', 'shopee',
         'operation', 'orders.list',
         'reason', 'oauth_reconnect_required',
         'periodic', true
       )
  from cancelled_jobs cancelled;

alter function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) rename to sellerpilot_enqueue_periodic_sync_without_identity_gate;

revoke all on function public.sellerpilot_enqueue_periodic_sync_without_identity_gate(
  text, text, jsonb, integer
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_periodic_sync(
  p_channel text,
  p_operation text,
  p_request_payload jsonb,
  p_min_interval_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_credential record;
begin
  if p_channel not in (
       'qoo10', 'shopee', 'lazada', 'coupang',
       'smartstore', 'ebay', 'temu', 'elevenst'
     )
     or p_operation not in ('orders.list', 'inquiries.list')
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000
     or p_min_interval_minutes not between 1 and 60 then
    raise exception 'invalid periodic channel sync';
  end if;

  if p_channel = 'shopee' and p_operation = 'orders.list' then
    select c.id, c.created_by, c.seller_account_key,
           c.seller_account_key_source, c.seller_account_verified_at
      into v_credential
      from sellerpilot_private.channel_credentials c
     where c.channel = 'shopee'
       and c.environment = 'production'
       and c.status = 'active'
       and (c.expires_at is null or c.expires_at > now())
     order by c.version desc
     limit 1;

    if v_credential.id is not null
       and (
         v_credential.seller_account_key is null
         or v_credential.seller_account_key_source is distinct from 'provider_certified_v1'
         or v_credential.seller_account_verified_at is null
       ) then
      with cancelled_jobs as (
        update sellerpilot_private.channel_gateway_jobs j
           set status = 'cancelled',
               error_message = 'SHOPEE_OAUTH_RECONNECT_REQUIRED',
               completed_at = now(),
               updated_at = now()
         where j.credential_id = v_credential.id
           and j.channel = 'shopee'
           and j.operation = 'orders.list'
           and j.status = 'queued'
           and j.attempt_count = 0
           and j.attempt_id is null
           and nullif(trim(j.request_payload->>'periodicKey'), '') is not null
        returning j.id, j.created_by
      )
      insert into sellerpilot_private.operation_audit (
        owner_id, action, entity_type, entity_id, safe_detail
      )
      select cancelled.created_by,
             'shopee_periodic_order_sync_suppressed',
             'channel_gateway_job',
             cancelled.id::text,
             jsonb_build_object(
               'channel', 'shopee',
               'operation', 'orders.list',
               'reason', 'oauth_reconnect_required',
               'periodic', true
             )
        from cancelled_jobs cancelled;

      insert into sellerpilot_private.channel_sync_state (
        owner_id, channel_key, data_type, status, imported_count,
        last_started_at, last_error, updated_at
      ) values (
        v_credential.created_by, 'shopee', 'orders', 'failed', 0,
        null,
        'Shopee OAuth 재연동이 필요합니다. 판매자 계정 확인 전까지 주문 자동 동기화를 중지했습니다.',
        now()
      )
      on conflict (owner_id, channel_key, data_type) do update set
        status = 'failed',
        last_error = excluded.last_error,
        updated_at = now();

      return jsonb_build_object(
        'channel', p_channel,
        'operation', p_operation,
        'status', 'reconnect_required'
      );
    end if;
  end if;

  return public.sellerpilot_enqueue_periodic_sync_without_identity_gate(
    p_channel,
    p_operation,
    p_request_payload,
    p_min_interval_minutes
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) to service_role;

create function public.sellerpilot_list_shopee_connection_status()
returns table (
  credential_id uuid,
  connection_status text
)
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select c.id,
         case
           when c.seller_account_key is not null
            and c.seller_account_key_source = 'provider_certified_v1'
            and c.seller_account_verified_at is not null
             then 'provider_verified'
           else 'oauth_reconnect_required'
         end
    from sellerpilot_private.channel_credentials c
   where public.sellerpilot_is_admin()
     and c.channel = 'shopee'
$$;

revoke all on function public.sellerpilot_list_shopee_connection_status()
  from public, anon;
grant execute on function public.sellerpilot_list_shopee_connection_status()
  to authenticated;

commit;
