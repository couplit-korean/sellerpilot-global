begin;

alter table sellerpilot_private.kakao_notification_deliveries
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists send_started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists reconciliation_required_at timestamptz,
  add column if not exists legacy_completion_eligible_until timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update sellerpilot_private.kakao_notification_deliveries
   set legacy_completion_eligible_until = clock_timestamp() + interval '90 seconds',
       updated_at = clock_timestamp()
 where status = 'pending'
   and legacy_completion_eligible_until is null;

alter table sellerpilot_private.kakao_notification_deliveries
  drop constraint if exists kakao_notification_deliveries_status_check;
alter table sellerpilot_private.kakao_notification_deliveries
  add constraint kakao_notification_deliveries_status_check
  check (status in (
    'pending',
    'preparing',
    'sending',
    'sent',
    'failed',
    'reconciliation_required'
  ));

alter table sellerpilot_private.kakao_notification_deliveries
  drop constraint if exists kakao_notification_deliveries_preparing_claim_check;
alter table sellerpilot_private.kakao_notification_deliveries
  add constraint kakao_notification_deliveries_preparing_claim_check
  check (
    status <> 'preparing'
    or (claim_token is not null and claimed_at is not null and lease_expires_at is not null)
  );

alter table sellerpilot_private.kakao_notification_deliveries
  drop constraint if exists kakao_notification_deliveries_sending_claim_check;
alter table sellerpilot_private.kakao_notification_deliveries
  add constraint kakao_notification_deliveries_sending_claim_check
  check (
    status <> 'sending'
    or (
      claim_token is not null
      and send_started_at is not null
      and lease_expires_at is not null
    )
  );

drop index if exists sellerpilot_private.kakao_delivery_pending_idx;
create index if not exists kakao_delivery_pending_available_idx
  on sellerpilot_private.kakao_notification_deliveries (available_at, created_at)
  where status = 'pending' and attempt_count < 3;
create index if not exists kakao_delivery_expired_preparing_idx
  on sellerpilot_private.kakao_notification_deliveries (lease_expires_at, created_at)
  where status = 'preparing' and attempt_count < 3;
create index if not exists kakao_delivery_expired_sending_idx
  on sellerpilot_private.kakao_notification_deliveries (lease_expires_at, created_at)
  where status = 'sending';

drop function if exists public.sellerpilot_service_claim_kakao_notifications(integer);
drop function if exists public.sellerpilot_service_complete_kakao_notification(uuid, boolean, text);

create function public.sellerpilot_service_sweep_stale_kakao_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  -- A process can disappear after Kakao accepts the memo but before its
  -- completion callback commits. Those rows must never become claimable
  -- again. The rollout's legacy pending window has the same ambiguity because
  -- the previous sender did not claim rows before its external call.
  update sellerpilot_private.kakao_notification_deliveries d
     set status = 'reconciliation_required',
         last_error = case
           when d.status = 'sending'
             then 'KAKAO_SEND_COMPLETION_LOST_OR_PROCESS_INTERRUPTED'
           else 'KAKAO_LEGACY_DELIVERY_OUTCOME_UNKNOWN'
         end,
         lease_expires_at = null,
         completed_at = null,
         reconciliation_required_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where (
       d.status = 'sending'
       and (
         (d.lease_expires_at is not null and d.lease_expires_at <= clock_timestamp())
         or (
           d.lease_expires_at is null
           and d.send_started_at is not null
           and d.send_started_at <= clock_timestamp() - interval '3 minutes'
         )
       )
     ) or (
       d.status = 'pending'
       and d.legacy_completion_eligible_until is not null
       and d.legacy_completion_eligible_until <= clock_timestamp()
     );
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create function public.sellerpilot_service_claim_kakao_notifications(
  p_limit integer,
  p_lease_seconds integer
)
returns table (
  id uuid,
  owner_id uuid,
  event_type text,
  title text,
  body text,
  link_path text,
  secret_payload jsonb,
  expires_at timestamptz,
  kakao_user_id text,
  nickname text,
  claim_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sellerpilot_service_sweep_stale_kakao_notifications();

  update sellerpilot_private.kakao_notification_deliveries d
     set status = 'failed',
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         last_error = coalesce(d.last_error, 'KAKAO_PREPARATION_LEASE_EXHAUSTED'),
         updated_at = clock_timestamp()
   where d.status = 'preparing'
     and d.attempt_count >= 3
     and d.lease_expires_at is not null
     and d.lease_expires_at <= clock_timestamp();

  return query
  with candidates as materialized (
    select d.id
      from sellerpilot_private.kakao_notification_deliveries d
      join sellerpilot_private.kakao_integrations k
        on k.owner_id = d.owner_id
       and k.status = 'active'
      join vault.decrypted_secrets s
        on s.id = k.vault_secret_id
     where d.attempt_count < 3
       and (
         d.legacy_completion_eligible_until is null
         or d.legacy_completion_eligible_until <= clock_timestamp()
       )
       and (
         (d.status = 'pending' and d.available_at <= clock_timestamp())
         or (
           d.status = 'preparing'
           and d.lease_expires_at is not null
           and d.lease_expires_at <= clock_timestamp()
         )
       )
     order by coalesce(d.available_at, d.created_at), d.created_at, d.id
     limit greatest(1, least(coalesce(p_limit, 50), 100))
     for update of d skip locked
  ), claimed as (
    update sellerpilot_private.kakao_notification_deliveries d
       set status = 'preparing',
           claim_token = gen_random_uuid(),
           claimed_at = clock_timestamp(),
           attempt_count = least(d.attempt_count + 1, 10),
           lease_expires_at = clock_timestamp()
             + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 900))),
           send_started_at = null,
           reconciliation_required_at = null,
           updated_at = clock_timestamp()
      from candidates c
     where d.id = c.id
    returning d.id, d.owner_id, d.event_type, d.title, d.body, d.link_path, d.claim_token
  )
  select c.id,
         c.owner_id,
         c.event_type,
         c.title,
         c.body,
         c.link_path,
         s.decrypted_secret::jsonb,
         k.expires_at,
         k.kakao_user_id,
         k.nickname,
         c.claim_token
    from claimed c
    join sellerpilot_private.kakao_integrations k
      on k.owner_id = c.owner_id
     and k.status = 'active'
    join vault.decrypted_secrets s
      on s.id = k.vault_secret_id
   order by c.id;
end;
$$;

create function public.sellerpilot_service_begin_kakao_notification_send(
  p_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_claim_token uuid;
  v_lease_expires_at timestamptz;
begin
  select d.status, d.claim_token, d.lease_expires_at
    into v_status, v_claim_token, v_lease_expires_at
    from sellerpilot_private.kakao_notification_deliveries d
   where d.id = p_id
   for update;

  if not found or v_claim_token is distinct from p_claim_token then
    return false;
  end if;
  if v_status = 'sending' then
    return true;
  end if;
  if v_status <> 'preparing'
    or v_lease_expires_at is null
    or v_lease_expires_at <= clock_timestamp() then
    return false;
  end if;

  update sellerpilot_private.kakao_notification_deliveries
     set status = 'sending',
         send_started_at = clock_timestamp(),
         lease_expires_at = greatest(
           coalesce(lease_expires_at, clock_timestamp()),
           clock_timestamp() + interval '3 minutes'
         ),
         updated_at = clock_timestamp()
   where id = p_id;
  return true;
end;
$$;

create or replace function public.sellerpilot_get_notification_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'kakao', coalesce((
      select jsonb_build_object(
        'connected', k.status = 'active',
        'nickname', k.nickname,
        'kakaoUserId', k.kakao_user_id,
        'expiresAt', k.expires_at,
        'updatedAt', k.updated_at
      )
        from sellerpilot_private.kakao_integrations k
       where k.owner_id = auth.uid()
    ), jsonb_build_object('connected', false)),
    'preferences', coalesce((
      select to_jsonb(p) - 'owner_id' - 'updated_at'
        from sellerpilot_private.notification_preferences p
       where p.owner_id = auth.uid()
    ), jsonb_build_object(
      'kakao_enabled', true,
      'order_paid', true,
      'shipping_ready', true,
      'shipping_completed', true,
      'listing_published', true,
      'listing_failed', true,
      'low_stock', true,
      'cs_waiting', true,
      'settlement_rate_risk', true
    )),
    'deliveryHealth', (
      select jsonb_build_object(
        'pending', count(*) filter (where d.status = 'pending'),
        'preparing', count(*) filter (where d.status = 'preparing'),
        'sending', count(*) filter (where d.status = 'sending'),
        'sent', count(*) filter (where d.status = 'sent'),
        'failed', count(*) filter (where d.status = 'failed'),
        'reconciliationRequired', count(*) filter (where d.status = 'reconciliation_required'),
        'oldestUnresolvedAt', min(d.created_at) filter (
          where d.status in ('pending', 'preparing', 'sending', 'reconciliation_required')
        )
      )
        from sellerpilot_private.kakao_notification_deliveries d
       where d.owner_id = auth.uid()
    )
  );
end;
$$;

create function public.sellerpilot_service_release_kakao_notification_claim(
  p_id uuid,
  p_claim_token uuid,
  p_error text,
  p_delay_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_claim_token uuid;
begin
  select d.status, d.claim_token
    into v_status, v_claim_token
    from sellerpilot_private.kakao_notification_deliveries d
   where d.id = p_id
   for update;

  if not found or v_claim_token is distinct from p_claim_token then
    return false;
  end if;
  if v_status in ('pending', 'failed') then
    return true;
  end if;
  if v_status <> 'preparing' then
    return false;
  end if;

  update sellerpilot_private.kakao_notification_deliveries
     set status = case when attempt_count >= 3 then 'failed' else 'pending' end,
         available_at = case
           when attempt_count >= 3 then available_at
           else clock_timestamp()
             + make_interval(secs => greatest(15, least(coalesce(p_delay_seconds, 60), 900)))
         end,
         lease_expires_at = null,
         last_error = left(coalesce(nullif(p_error, ''), 'KAKAO_PREPARATION_FAILED'), 500),
         completed_at = case when attempt_count >= 3 then clock_timestamp() else completed_at end,
         updated_at = clock_timestamp()
   where id = p_id;
  return true;
end;
$$;

create function public.sellerpilot_service_complete_kakao_notification(
  p_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_claim_token uuid;
  v_last_error text;
  v_target_status text;
  v_safe_error text;
begin
  if p_outcome not in ('sent', 'failed', 'reconciliation_required') then
    return false;
  end if;
  v_target_status := p_outcome;
  v_safe_error := case
    when p_outcome = 'sent' then null
    else left(coalesce(nullif(p_error, ''), 'KAKAO_DELIVERY_OUTCOME_UNKNOWN'), 500)
  end;

  select d.status, d.claim_token, d.last_error
    into v_status, v_claim_token, v_last_error
    from sellerpilot_private.kakao_notification_deliveries d
   where d.id = p_id
   for update;

  if not found or v_claim_token is distinct from p_claim_token then
    return false;
  end if;
  if v_status = v_target_status then
    return v_last_error is not distinct from v_safe_error;
  end if;
  if v_status <> 'sending'
    and not (v_status = 'reconciliation_required' and v_target_status in ('sent', 'failed')) then
    return false;
  end if;

  update sellerpilot_private.kakao_notification_deliveries
     set status = v_target_status,
         last_error = v_safe_error,
         sent_at = case when v_target_status = 'sent' then clock_timestamp() else sent_at end,
         completed_at = case
           when v_target_status in ('sent', 'failed') then clock_timestamp()
           else null
         end,
         reconciliation_required_at = case
           when v_target_status = 'reconciliation_required' then clock_timestamp()
           else null
         end,
         lease_expires_at = null,
         updated_at = clock_timestamp()
   where id = p_id;
  return true;
end;
$$;

create function public.sellerpilot_service_claim_kakao_notifications(
  p_limit integer
)
returns table (
  id uuid,
  owner_id uuid,
  event_type text,
  title text,
  body text,
  link_path text,
  secret_payload jsonb,
  expires_at timestamptz,
  kakao_user_id text,
  nickname text
)
language sql
security definer
set search_path = ''
as $$
  select null::uuid,
         null::uuid,
         null::text,
         null::text,
         null::text,
         null::text,
         null::jsonb,
         null::timestamptz,
         null::text,
         null::text
   where false
$$;

create function public.sellerpilot_service_complete_kakao_notification(
  p_id uuid,
  p_success boolean,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_last_error text;
  v_eligible_until timestamptz;
  v_target_status text;
  v_safe_error text;
begin
  if p_success is null then
    return false;
  end if;
  v_target_status := case when p_success then 'sent' else 'failed' end;
  v_safe_error := case
    when p_success then null
    else left(coalesce(nullif(p_error, ''), 'KAKAO_LEGACY_DELIVERY_FAILED'), 500)
  end;

  select d.status, d.last_error, d.legacy_completion_eligible_until
    into v_status, v_last_error, v_eligible_until
    from sellerpilot_private.kakao_notification_deliveries d
   where d.id = p_id
   for update;

  if not found or v_eligible_until is null then
    return false;
  end if;
  if v_status = v_target_status then
    return v_last_error is not distinct from v_safe_error;
  end if;
  if v_status <> 'pending' or v_eligible_until < clock_timestamp() then
    return false;
  end if;

  update sellerpilot_private.kakao_notification_deliveries
     set status = v_target_status,
         attempt_count = least(attempt_count + 1, 10),
         last_error = v_safe_error,
         sent_at = case when v_target_status = 'sent' then clock_timestamp() else sent_at end,
         completed_at = clock_timestamp(),
         lease_expires_at = null,
         reconciliation_required_at = null,
         updated_at = clock_timestamp()
   where id = p_id;
  return true;
end;
$$;

revoke all on function public.sellerpilot_service_claim_kakao_notifications(integer, integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_sweep_stale_kakao_notifications()
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_begin_kakao_notification_send(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_release_kakao_notification_claim(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_complete_kakao_notification(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_claim_kakao_notifications(integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_complete_kakao_notification(uuid, boolean, text)
  from public, anon, authenticated;

grant execute on function public.sellerpilot_service_claim_kakao_notifications(integer, integer)
  to service_role;
grant execute on function public.sellerpilot_service_sweep_stale_kakao_notifications()
  to service_role;
grant execute on function public.sellerpilot_service_begin_kakao_notification_send(uuid, uuid)
  to service_role;
grant execute on function public.sellerpilot_service_release_kakao_notification_claim(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.sellerpilot_service_complete_kakao_notification(uuid, uuid, text, text)
  to service_role;
grant execute on function public.sellerpilot_service_claim_kakao_notifications(integer)
  to service_role;
grant execute on function public.sellerpilot_service_complete_kakao_notification(uuid, boolean, text)
  to service_role;
revoke all on function public.sellerpilot_get_notification_settings()
  from public, anon;
grant execute on function public.sellerpilot_get_notification_settings()
  to authenticated;

commit;
