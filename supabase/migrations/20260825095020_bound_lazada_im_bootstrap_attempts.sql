-- Lazada IM history is a one-time bootstrap per credential version. Keep its
-- attempt ledger separate from ordinary inquiry sync timestamps so a failed
-- bootstrap cannot be retried every few minutes.

begin;

alter table sellerpilot_private.channel_sync_state
  add column if not exists lazada_im_bootstrap_attempted_at timestamptz,
  add column if not exists lazada_im_bootstrap_succeeded_at timestamptz,
  add column if not exists lazada_im_bootstrap_credential_id uuid
    references sellerpilot_private.channel_credentials(id) on delete set null;

-- Preserve attempts made before this ledger existed. Success is deliberately
-- not inferred from the gateway status because ingestion and provider success
-- are separate facts.
with latest_attempt as (
  select distinct on (j.created_by)
         j.created_by as owner_id,
         j.credential_id,
         j.created_at as attempted_at
    from sellerpilot_private.channel_gateway_jobs j
   where j.channel = 'lazada'
     and j.operation = 'inquiries.list'
     and j.request_payload->'arguments'->>'bootstrap' = 'true'
   order by j.created_by, j.created_at desc
)
insert into sellerpilot_private.channel_sync_state (
  owner_id, channel_key, data_type, status,
  lazada_im_bootstrap_attempted_at,
  lazada_im_bootstrap_credential_id,
  updated_at
)
select a.owner_id, 'lazada', 'inquiries', 'never',
       a.attempted_at, a.credential_id, a.attempted_at
  from latest_attempt a
on conflict (owner_id, channel_key, data_type) do update set
  lazada_im_bootstrap_credential_id = case
    when sellerpilot_private.channel_sync_state.lazada_im_bootstrap_attempted_at is null
      or excluded.lazada_im_bootstrap_attempted_at > sellerpilot_private.channel_sync_state.lazada_im_bootstrap_attempted_at
    then excluded.lazada_im_bootstrap_credential_id
    else sellerpilot_private.channel_sync_state.lazada_im_bootstrap_credential_id
  end,
  lazada_im_bootstrap_attempted_at = case
    when sellerpilot_private.channel_sync_state.lazada_im_bootstrap_attempted_at is null
      or excluded.lazada_im_bootstrap_attempted_at > sellerpilot_private.channel_sync_state.lazada_im_bootstrap_attempted_at
    then excluded.lazada_im_bootstrap_attempted_at
    else sellerpilot_private.channel_sync_state.lazada_im_bootstrap_attempted_at
  end;

create or replace function public.sellerpilot_service_consume_lazada_im_bootstrap(
  p_credential_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner_id uuid;
  v_changed_at timestamptz;
  v_attempted_at timestamptz;
  v_attempted_credential_id uuid;
begin
  select c.created_by, greatest(c.last_rotated_at, c.created_at)
    into v_owner_id, v_changed_at
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = 'lazada'
     and c.environment = 'production'
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   for update;
  if not found then raise exception 'active Lazada credential required'; end if;

  -- History may only be pulled shortly after explicit credential creation or
  -- rotation. An old credential cannot be used to start a new history crawl.
  if v_changed_at > now() or now() > v_changed_at + interval '24 hours' then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:lazada-im-bootstrap:' || v_owner_id::text));

  insert into sellerpilot_private.channel_sync_state (
    owner_id, channel_key, data_type, status,
    lazada_im_bootstrap_attempted_at,
    lazada_im_bootstrap_succeeded_at,
    lazada_im_bootstrap_credential_id,
    updated_at
  ) values (
    v_owner_id, 'lazada', 'inquiries', 'never',
    now(), null, p_credential_id, now()
  )
  on conflict (owner_id, channel_key, data_type) do nothing;
  if found then return true; end if;

  select s.lazada_im_bootstrap_attempted_at,
         s.lazada_im_bootstrap_credential_id
    into v_attempted_at, v_attempted_credential_id
    from sellerpilot_private.channel_sync_state s
   where s.owner_id = v_owner_id
     and s.channel_key = 'lazada'
     and s.data_type = 'inquiries'
   for update;

  if v_attempted_credential_id = p_credential_id
     or (v_attempted_credential_id is null and v_attempted_at >= v_changed_at) then
    return false;
  end if;

  update sellerpilot_private.channel_sync_state
     set lazada_im_bootstrap_attempted_at = now(),
         lazada_im_bootstrap_succeeded_at = null,
         lazada_im_bootstrap_credential_id = p_credential_id,
         updated_at = now()
   where owner_id = v_owner_id
     and channel_key = 'lazada'
     and data_type = 'inquiries';
  return true;
end;
$$;

create or replace function public.sellerpilot_service_record_lazada_im_bootstrap_result(
  p_job_id uuid,
  p_effective_credential_id uuid,
  p_succeeded boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner_id uuid;
  v_job_credential_id uuid;
  v_effective_owner_id uuid;
  v_updated integer;
begin
  select j.created_by, j.credential_id
    into v_owner_id, v_job_credential_id
    from sellerpilot_private.channel_gateway_jobs j
   where j.id = p_job_id
     and j.channel = 'lazada'
     and j.operation = 'inquiries.list'
     and j.status = 'running'
     and j.request_payload->'arguments'->>'bootstrap' = 'true'
   for update;
  if not found then return false; end if;

  select c.created_by into v_effective_owner_id
    from sellerpilot_private.channel_credentials c
   where c.id = p_effective_credential_id
     and c.channel = 'lazada'
     and c.environment = 'production';
  if v_effective_owner_id is distinct from v_owner_id then
    raise exception 'Lazada bootstrap credential mismatch';
  end if;

  update sellerpilot_private.channel_sync_state
     set lazada_im_bootstrap_succeeded_at = case
           when p_succeeded then coalesce(lazada_im_bootstrap_succeeded_at, now())
           else lazada_im_bootstrap_succeeded_at
         end,
         lazada_im_bootstrap_credential_id = p_effective_credential_id,
         updated_at = now()
   where owner_id = v_owner_id
     and channel_key = 'lazada'
     and data_type = 'inquiries'
     and lazada_im_bootstrap_attempted_at is not null
     and lazada_im_bootstrap_credential_id in (v_job_credential_id, p_effective_credential_id);
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.sellerpilot_service_consume_lazada_im_bootstrap(uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_record_lazada_im_bootstrap_result(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_consume_lazada_im_bootstrap(uuid)
  to service_role;
grant execute on function public.sellerpilot_service_record_lazada_im_bootstrap_result(uuid, uuid, boolean)
  to service_role;

commit;
