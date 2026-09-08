-- Integration-owned forward migration draft. Do not apply from the Lazada
-- worktree. This migration depends on the canonical Lazada 008 projection
-- helper and keeps all existing shared-CS behavior behind renamed wrappers.
begin;

do $migration$
begin
  if to_regprocedure('sellerpilot_private.lazada_im_projection_state_v1(uuid,uuid,text,text,text,text,timestamptz)') is null
     or to_regprocedure('public.sellerpilot_get_cs_workspace_snapshot()') is null
     or to_regprocedure('public.sellerpilot_get_ticket_reply_context_v2(uuid)') is null
     or to_regprocedure('public.sellerpilot_update_ticket(uuid,text,text,text)') is null
     or to_regprocedure('public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)') is null
     or to_regprocedure('public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)') is null
     or to_regclass('sellerpilot_private.support_tickets') is null
     or to_regclass('sellerpilot_private.support_inbound_messages') is null then
    raise exception 'LAZADA_IM_ORDINARY_WORKSPACE_GUARD_PREREQUISITE_REQUIRED';
  end if;
  if to_regprocedure('sellerpilot_private.lazada_im_ticket_projection_state_v1(uuid,timestamptz)') is not null
     or to_regprocedure('sellerpilot_private.lazada_im_workspace_ticket_projection_v1(uuid,timestamptz)') is not null
     or to_regprocedure('public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()') is not null then
    raise exception 'LAZADA_IM_ORDINARY_WORKSPACE_GUARD_ALREADY_EXISTS';
  end if;
end
$migration$;

-- Resolve the latest actionable state from the exact ticket owner,
-- credential, certified seller lineage, external session, native message id,
-- and native content fingerprint. No body or attachment is accepted as input.
create function sellerpilot_private.lazada_im_ticket_projection_state_v1(
  p_ticket_id uuid,
  p_as_of timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when ticket.channel_key <> 'lazada' then 'normal'
      else coalesce((
        select sellerpilot_private.lazada_im_projection_state_v1(
          message.owner_id,
          ticket.source_credential_id,
          ticket.seller_account_key,
          ticket.external_ticket_id,
          message.remote_message_id,
          message.provider_context->>'nativeContentFingerprint',
          p_as_of
        )
          from sellerpilot_private.support_inbound_messages message
         where message.ticket_id = ticket.id
           and message.owner_id = ticket.owner_id
           and message.channel_key = ticket.channel_key
           and message.inbound_key = ticket.latest_inbound_key
           and message.created_at <= p_as_of
         order by message.created_at desc, message.id desc
         limit 1
      ), 'normal')
    end
      from sellerpilot_private.support_tickets ticket
     where ticket.id = p_ticket_id
       and not ticket.demo
     limit 1
  ), 'normal')
$$;
revoke all on function sellerpilot_private.lazada_im_ticket_projection_state_v1(uuid,timestamptz)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_im_workspace_ticket_projection_v1(
  p_ticket_id uuid,
  p_as_of timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when ticket.channel_key <> 'lazada' then '{}'::jsonb
      else jsonb_build_object(
        'message', case when projection.message_state = 'recalled'
          then 'Lazada 메시지가 회수되었습니다.' else ticket.message end,
        'translatedMessage', case when projection.message_state = 'normal'
          then ticket.translated_message else null end,
        'replyDraft', case when projection.message_state = 'normal'
          then ticket.reply_draft else null end,
        'latestMessageState', projection.message_state,
        'replyAllowed', projection.message_state = 'normal'
      )
    end
      from sellerpilot_private.support_tickets ticket
      cross join lateral (
        select sellerpilot_private.lazada_im_ticket_projection_state_v1(
          ticket.id, p_as_of
        ) as message_state
      ) projection
     where ticket.id = p_ticket_id
       and not ticket.demo
     limit 1
  ), '{}'::jsonb)
$$;
revoke all on function sellerpilot_private.lazada_im_workspace_ticket_projection_v1(uuid,timestamptz)
  from public,anon,authenticated,service_role;

-- Preserve every field added by previous shared migrations. The wrapper only
-- overlays the four body/draft fields and two state fields on Lazada tickets.
alter function public.sellerpilot_get_cs_workspace_snapshot()
  rename to sellerpilot_09090000_get_cs_workspace_snapshot_unsafe;

create function public.sellerpilot_get_cs_workspace_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_tickets jsonb;
  v_as_of timestamptz := statement_timestamp();
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe();
  select coalesce(jsonb_agg(
    ticket.value || sellerpilot_private.lazada_im_workspace_ticket_projection_v1(
      support_ticket.id, v_as_of
    ) order by ticket.ordinality
  ), '[]'::jsonb)
    into v_tickets
    from jsonb_array_elements(case
      when jsonb_typeof(v_result->'tickets') = 'array' then v_result->'tickets'
      else '[]'::jsonb
    end) with ordinality ticket(value, ordinality)
    left join sellerpilot_private.support_tickets support_ticket
      on support_ticket.id::text = ticket.value->>'ticketId'
     and not support_ticket.demo;
  return jsonb_set(coalesce(v_result, '{}'::jsonb), '{tickets}', v_tickets, true);
end
$$;
revoke all on function public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_get_cs_workspace_snapshot()
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_cs_workspace_snapshot()
  to authenticated;

-- Make the ordinary reply preflight expose the same state. The enqueue RPC
-- below is still the atomic enforcement point; this field improves API/UI
-- feedback without becoming the authorization decision.
alter function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  rename to sellerpilot_09090000_get_ticket_reply_context_v2_unsafe;

create function public.sellerpilot_get_ticket_reply_context_v2(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_state text;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_09090000_get_ticket_reply_context_v2_unsafe(p_id);
  if v_result is null then return null; end if;
  v_state := sellerpilot_private.lazada_im_ticket_projection_state_v1(
    p_id, statement_timestamp()
  );
  return v_result || jsonb_build_object(
    'latest_message_state', v_state,
    'reply_allowed', v_state = 'normal'
  );
end
$$;
revoke all on function public.sellerpilot_09090000_get_ticket_reply_context_v2_unsafe(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  to authenticated;

-- Direct authenticated mutations may clear a stale draft or keep an item in a
-- review state, but cannot save a new draft or resolve an evidence-backed
-- recall/conflict generation.
alter function public.sellerpilot_update_ticket(uuid,text,text,text)
  rename to sellerpilot_09090000_update_ticket_unsafe;

create function public.sellerpilot_update_ticket(
  p_id uuid,
  p_status text,
  p_reply_draft text,
  p_expected_inbound_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_state text;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_id and not ticket.demo
   for update;
  if not found then
    return public.sellerpilot_09090000_update_ticket_unsafe(
      p_id, p_status, p_reply_draft, p_expected_inbound_key
    );
  end if;
  v_state := sellerpilot_private.lazada_im_ticket_projection_state_v1(
    v_ticket.id, statement_timestamp()
  );
  if v_ticket.channel_key = 'lazada'
     and v_state <> 'normal'
     and (nullif(trim(coalesce(p_reply_draft, '')), '') is not null
       or p_status = 'resolved') then
    raise exception 'LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE' using errcode = '55000';
  end if;
  return public.sellerpilot_09090000_update_ticket_unsafe(
    p_id, p_status, p_reply_draft, p_expected_inbound_key
  );
end
$$;
revoke all on function public.sellerpilot_09090000_update_ticket_unsafe(uuid,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_update_ticket(uuid,text,text,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_update_ticket(uuid,text,text,text)
  to authenticated;

-- The local AI worker must never receive the retained body of a confirmed
-- recall or a revision conflict. The current key check remains inside the
-- renamed shared wrapper and executes while this ticket lock is held.
alter function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  rename to sellerpilot_09090000_create_support_reply_job_unsafe;

create function public.sellerpilot_create_support_reply_job(
  p_id uuid,
  p_ticket_id uuid,
  p_expected_inbound_key text,
  p_target_locale text,
  p_tone text default 'polite'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_state text;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_ticket_id
     and ticket.owner_id = auth.uid()
     and not ticket.demo
   for update;
  if not found then raise exception 'support ticket not found'; end if;
  v_state := sellerpilot_private.lazada_im_ticket_projection_state_v1(
    v_ticket.id, statement_timestamp()
  );
  if v_ticket.channel_key = 'lazada' and v_state <> 'normal' then
    raise exception 'LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE' using errcode = '55000';
  end if;
  return public.sellerpilot_09090000_create_support_reply_job_unsafe(
    p_id, p_ticket_id, p_expected_inbound_key, p_target_locale, p_tone
  );
end
$$;
revoke all on function public.sellerpilot_09090000_create_support_reply_job_unsafe(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  to authenticated;

-- The gateway enqueue is the atomic send fence. It locks the ticket and checks
-- the exact V3 projection before calling the complete pre-existing shared
-- implementation, so a recall arriving after UI preflight cannot race a send.
alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  rename to sellerpilot_09090000_enqueue_inquiry_reply_gateway_job_unsafe;

create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  p_ticket_id uuid,
  p_channel text,
  p_reply_text text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_state text;
begin
  if p_channel = 'lazada' then
    select ticket.* into v_ticket
      from sellerpilot_private.support_tickets ticket
     where ticket.id = p_ticket_id
       and ticket.channel_key = 'lazada'
       and not ticket.demo
     for update;
    if not found then raise exception 'inquiry reply ticket not found'; end if;
    v_state := sellerpilot_private.lazada_im_ticket_projection_state_v1(
      v_ticket.id, statement_timestamp()
    );
    if v_state <> 'normal' then
      raise exception 'LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE' using errcode = '55000';
    end if;
  end if;
  return public.sellerpilot_09090000_enqueue_inquiry_reply_gateway_job_unsafe(
    p_ticket_id, p_channel, p_reply_text, p_request_payload
  );
end
$$;
revoke all on function public.sellerpilot_09090000_enqueue_inquiry_reply_gateway_job_unsafe(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  to service_role;

notify pgrst,'reload schema';
commit;
