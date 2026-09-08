-- Durable, private receipt for every authenticated Lazada IM event that is not
-- the provider's signed Verify probe. The application stores this exact body
-- before attempting the narrower text-message projection.
begin;

create table sellerpilot_private.lazada_im_raw_inbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  source_kind text not null check (source_kind in ('webhook', 'history_page')),
  delivery_digest text not null check (delivery_digest ~ '^[a-f0-9]{64}$'),
  raw_body text not null check (octet_length(raw_body) between 2 and 256000),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'normalized', 'unsupported')),
  first_observed_at timestamptz not null default now(),
  processed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (owner_id, credential_id, source_kind, delivery_digest),
  check (expires_at = first_observed_at + interval '30 days'),
  check ((processing_status = 'pending' and processed_at is null)
    or (processing_status in ('normalized', 'unsupported') and processed_at is not null))
);

comment on table sellerpilot_private.lazada_im_raw_inbox is
  'Exact signed webhook bodies or bounded provider history-page JSON after seller binding. Private 30-day retry/reprocessing receipt; never a support reply or buyer-visible message by itself.';

alter table sellerpilot_private.lazada_im_raw_inbox enable row level security;
revoke all on sellerpilot_private.lazada_im_raw_inbox from public, anon, authenticated, service_role;

create index lazada_im_raw_inbox_pending_idx
  on sellerpilot_private.lazada_im_raw_inbox (first_observed_at, id)
  where processing_status = 'pending';
create index lazada_im_raw_inbox_expiry_idx
  on sellerpilot_private.lazada_im_raw_inbox (expires_at);

create function public.sellerpilot_service_store_lazada_im_raw_event_v1(
  p_credential_id uuid,
  p_raw_body text,
  p_source_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_payload jsonb;
  v_digest text;
  v_existing sellerpilot_private.lazada_im_raw_inbox%rowtype;
  v_id uuid;
  v_retained integer;
begin
  if p_raw_body is null or octet_length(p_raw_body) not between 2 and 256000 then
    raise exception 'LAZADA_IM_RAW_BODY_INVALID';
  end if;
  if p_source_kind not in ('webhook', 'history_page') then
    raise exception 'LAZADA_IM_RAW_SOURCE_INVALID';
  end if;
  begin
    v_payload := p_raw_body::jsonb;
  exception when invalid_text_representation then
    raise exception 'LAZADA_IM_RAW_BODY_INVALID';
  end;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'LAZADA_IM_RAW_BODY_INVALID';
  end if;

  select c.created_by into v_owner
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = 'lazada'
     and c.status in ('active', 'grace');
  if v_owner is null then raise exception 'active channel credential required'; end if;

  v_digest := encode(extensions.digest(convert_to(p_raw_body, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('lazada-im-raw:' || v_owner::text, 0));
  delete from sellerpilot_private.lazada_im_raw_inbox
   where owner_id = v_owner and expires_at <= now();

  select * into v_existing
    from sellerpilot_private.lazada_im_raw_inbox r
   where r.owner_id = v_owner
     and r.credential_id = p_credential_id
     and r.source_kind = p_source_kind
     and r.delivery_digest = v_digest;
  if found then
    return jsonb_build_object(
      'contract', 'lazada_im_raw_inbox_v1',
      'status', 'duplicate',
      'id', v_existing.id,
      'processingStatus', v_existing.processing_status,
      'retentionDays', 30
    );
  end if;

  select count(*) into v_retained
    from sellerpilot_private.lazada_im_raw_inbox r
   where r.owner_id = v_owner;
  if v_retained >= 5000 then
    return jsonb_build_object(
      'contract', 'lazada_im_raw_inbox_v1',
      'status', 'capacity',
      'retryAfterSeconds', 300,
      'retentionDays', 30
    );
  end if;

  insert into sellerpilot_private.lazada_im_raw_inbox (
    owner_id, credential_id, source_kind, delivery_digest, raw_body
  ) values (v_owner, p_credential_id, p_source_kind, v_digest, p_raw_body)
  returning id into v_id;
  return jsonb_build_object(
    'contract', 'lazada_im_raw_inbox_v1',
    'status', 'stored',
    'id', v_id,
    'processingStatus', 'pending',
    'retentionDays', 30
  );
end
$$;
revoke all on function public.sellerpilot_service_store_lazada_im_raw_event_v1(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_store_lazada_im_raw_event_v1(uuid,text,text)
  to service_role;

create function public.sellerpilot_service_mark_lazada_im_raw_event_v1(
  p_credential_id uuid,
  p_id uuid,
  p_processing_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_changed integer;
begin
  if p_processing_status not in ('normalized', 'unsupported') then
    raise exception 'LAZADA_IM_RAW_STATUS_INVALID';
  end if;
  select c.created_by into v_owner
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = 'lazada'
     and c.status in ('active', 'grace');
  if v_owner is null then raise exception 'active channel credential required'; end if;

  update sellerpilot_private.lazada_im_raw_inbox r
     set processing_status = p_processing_status,
         processed_at = coalesce(r.processed_at, now())
   where r.id = p_id
     and r.owner_id = v_owner
     and r.credential_id = p_credential_id
     and r.processing_status in ('pending', p_processing_status);
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then raise exception 'LAZADA_IM_RAW_RECEIPT_REQUIRED'; end if;
  return jsonb_build_object(
    'contract', 'lazada_im_raw_mark_v1',
    'status', p_processing_status,
    'id', p_id
  );
end
$$;
revoke all on function public.sellerpilot_service_mark_lazada_im_raw_event_v1(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_mark_lazada_im_raw_event_v1(uuid,uuid,text)
  to service_role;

create function public.sellerpilot_service_prune_lazada_im_raw_inbox_v1()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  delete from sellerpilot_private.lazada_im_raw_inbox where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;
revoke all on function public.sellerpilot_service_prune_lazada_im_raw_inbox_v1()
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_prune_lazada_im_raw_inbox_v1()
  to service_role;

create function public.sellerpilot_read_lazada_im_raw_inbox_v1(
  p_before_time timestamptz default null,
  p_before_id uuid default null,
  p_as_of timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, statement_timestamp());
  v_rows jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  if (p_before_time is null) <> (p_before_id is null)
     or (p_before_id is not null and p_as_of is null)
     or not isfinite(v_as_of) or v_as_of > statement_timestamp()
     or (p_before_time is not null and (not isfinite(p_before_time) or p_before_time > v_as_of)) then
    raise exception 'invalid raw inbox cursor' using errcode = '22023';
  end if;

  with bounded as (
    select r.id, r.source_kind, r.raw_body, r.processing_status, r.first_observed_at,
           r.processed_at, r.expires_at
      from sellerpilot_private.lazada_im_raw_inbox r
     where r.first_observed_at <= v_as_of
       and r.expires_at > statement_timestamp()
       and (p_before_time is null or (r.first_observed_at, r.id) < (p_before_time, p_before_id))
     order by r.first_observed_at desc, r.id desc
     limit 26
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'sourceKind', source_kind,
    'rawBody', raw_body,
    'processingStatus', processing_status,
    'observedAt', first_observed_at,
    'processedAt', processed_at,
    'expiresAt', expires_at
  ) order by first_observed_at desc, id desc), '[]'::jsonb)
  into v_rows from bounded;

  return jsonb_build_object(
    'contract', 'lazada_im_raw_read_v1',
    'asOf', v_as_of,
    'events', case when jsonb_array_length(v_rows) > 25 then v_rows - 25 else v_rows end,
    'nextCursor', case when jsonb_array_length(v_rows) > 25 then jsonb_build_object(
      'beforeTime', v_rows->24->>'observedAt',
      'beforeId', v_rows->24->>'id',
      'asOf', v_as_of
    ) else null end
  );
end
$$;
revoke all on function public.sellerpilot_read_lazada_im_raw_inbox_v1(timestamptz,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_lazada_im_raw_inbox_v1(timestamptz,uuid,timestamptz)
  to authenticated;

commit;
