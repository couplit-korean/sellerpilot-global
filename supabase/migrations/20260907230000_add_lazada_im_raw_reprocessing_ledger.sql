begin;

alter table sellerpilot_private.lazada_im_raw_inbox
  drop constraint lazada_im_raw_inbox_processing_status_check,
  drop constraint lazada_im_raw_inbox_check1;

alter table sellerpilot_private.lazada_im_raw_inbox
  add column parser_version text not null default 'lazada-im-parser/1'
    check (parser_version ~ '^lazada-im-parser/[1-9][0-9]{0,5}$'),
  add column attempt_count integer not null default 0
    check (attempt_count between 0 and 5),
  add column next_attempt_at timestamptz not null default now(),
  add column claim_token uuid,
  add column claimed_at timestamptz,
  add column lease_expires_at timestamptz,
  add column last_attempt_at timestamptz,
  add column last_error_code text
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  add constraint lazada_im_raw_inbox_processing_status_check
    check (processing_status in ('pending', 'normalized', 'unsupported', 'failed')),
  add constraint lazada_im_raw_inbox_processing_check check (
    (processing_status = 'pending' and processed_at is null)
    or (processing_status in ('normalized', 'unsupported', 'failed') and processed_at is not null)
  ),
  add constraint lazada_im_raw_inbox_claim_check check (
    (claim_token is null and claimed_at is null and lease_expires_at is null)
    or (
      processing_status = 'pending'
      and claim_token is not null
      and claimed_at is not null
      and lease_expires_at is not null
      and lease_expires_at > claimed_at
    )
  );

drop index sellerpilot_private.lazada_im_raw_inbox_pending_idx;
create index lazada_im_raw_inbox_pending_idx
  on sellerpilot_private.lazada_im_raw_inbox (next_attempt_at, first_observed_at, id)
  where processing_status = 'pending' and attempt_count < 5;

create table sellerpilot_private.lazada_im_raw_outcomes (
  receipt_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  source_kind text not null check (source_kind in ('webhook', 'history_page')),
  delivery_digest text not null check (delivery_digest ~ '^[a-f0-9]{64}$'),
  final_status text not null check (final_status in ('normalized', 'unsupported', 'failed', 'expired_unprocessed')),
  parser_version text not null check (parser_version ~ '^lazada-im-parser/[1-9][0-9]{0,5}$'),
  attempt_count integer not null check (attempt_count between 0 and 5),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  raw_body_bytes integer not null check (raw_body_bytes between 2 and 256000),
  first_observed_at timestamptz not null,
  finalized_at timestamptz not null,
  expires_at timestamptz not null default (now() + interval '90 days'),
  unique (owner_id, credential_id, source_kind, delivery_digest),
  check (expires_at > finalized_at)
);

comment on table sellerpilot_private.lazada_im_raw_outcomes is
  'Body-free 90-day processing and expiry evidence for authenticated Lazada IM raw receipts.';

alter table sellerpilot_private.lazada_im_raw_outcomes enable row level security;
revoke all on sellerpilot_private.lazada_im_raw_outcomes from public, anon, authenticated, service_role;

create index lazada_im_raw_outcomes_expiry_idx
  on sellerpilot_private.lazada_im_raw_outcomes (expires_at);

create function public.sellerpilot_service_claim_lazada_im_raw_v1(
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_claim_token uuid := gen_random_uuid();
  v_rows jsonb;
begin
  if p_limit is null or p_limit not between 1 and 25
     or p_lease_seconds is null or p_lease_seconds not between 30 and 300 then
    raise exception 'LAZADA_IM_RAW_CLAIM_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  with candidates as (
    select r.id
      from sellerpilot_private.lazada_im_raw_inbox r
     where r.processing_status = 'pending'
       and r.attempt_count < 5
       and r.next_attempt_at <= v_now
       and r.expires_at > v_now + make_interval(secs => p_lease_seconds)
       and (r.claim_token is null or r.lease_expires_at <= v_now)
     order by r.next_attempt_at, r.first_observed_at, r.id
     for update skip locked
     limit p_limit
  ), claimed as (
    update sellerpilot_private.lazada_im_raw_inbox r
       set claim_token = v_claim_token,
           claimed_at = v_now,
           lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
           last_attempt_at = v_now,
           attempt_count = r.attempt_count + 1,
           last_error_code = null
      from candidates c
     where r.id = c.id
    returning r.id, r.credential_id, r.source_kind, r.raw_body,
              r.parser_version, r.attempt_count, r.expires_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'credentialId', credential_id,
    'sourceKind', source_kind,
    'rawBody', raw_body,
    'parserVersion', parser_version,
    'attemptCount', attempt_count,
    'expiresAt', expires_at,
    'claimToken', v_claim_token
  ) order by id), '[]'::jsonb)
    into v_rows
    from claimed;

  return jsonb_build_object(
    'contract', 'lazada_im_raw_claim_v1',
    'claimToken', v_claim_token,
    'receipts', v_rows
  );
end
$$;

create function public.sellerpilot_service_complete_lazada_im_raw_v1(
  p_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_parser_version text,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row sellerpilot_private.lazada_im_raw_inbox%rowtype;
  v_final_status text;
begin
  if p_id is null or p_claim_token is null
     or p_outcome not in ('normalized', 'unsupported', 'retry')
     or p_parser_version is null
     or p_parser_version !~ '^lazada-im-parser/[1-9][0-9]{0,5}$'
     or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{0,79}$') then
    raise exception 'LAZADA_IM_RAW_COMPLETION_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select * into v_row
    from sellerpilot_private.lazada_im_raw_inbox r
   where r.id = p_id
   for update;
  if not found or v_row.processing_status <> 'pending'
     or v_row.claim_token is distinct from p_claim_token
     or v_row.lease_expires_at is null or v_row.lease_expires_at <= v_now then
    raise exception 'LAZADA_IM_RAW_LIVE_CLAIM_REQUIRED';
  end if;

  v_final_status := case
    when p_outcome = 'retry' and v_row.attempt_count >= 5 then 'failed'
    when p_outcome = 'retry' then 'pending'
    else p_outcome
  end;

  update sellerpilot_private.lazada_im_raw_inbox r
     set processing_status = v_final_status,
         parser_version = p_parser_version,
         processed_at = case when v_final_status = 'pending' then null else v_now end,
         next_attempt_at = case when v_final_status = 'pending'
           then v_now + make_interval(secs => least(3600, 30 * power(2, greatest(0, v_row.attempt_count - 1))::integer))
           else r.next_attempt_at end,
         claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         last_error_code = case when p_outcome = 'normalized' then null else p_error_code end
   where r.id = p_id;

  if v_final_status <> 'pending' then
    insert into sellerpilot_private.lazada_im_raw_outcomes (
      receipt_id, owner_id, credential_id, source_kind, delivery_digest,
      final_status, parser_version, attempt_count, error_code, raw_body_bytes,
      first_observed_at, finalized_at, expires_at
    ) values (
      v_row.id, v_row.owner_id, v_row.credential_id, v_row.source_kind, v_row.delivery_digest,
      v_final_status, p_parser_version, v_row.attempt_count,
      case when v_final_status = 'normalized' then null else p_error_code end,
      octet_length(v_row.raw_body), v_row.first_observed_at, v_now, v_now + interval '90 days'
    ) on conflict (receipt_id) do update set
      final_status = excluded.final_status,
      parser_version = excluded.parser_version,
      attempt_count = excluded.attempt_count,
      error_code = excluded.error_code,
      finalized_at = excluded.finalized_at,
      expires_at = excluded.expires_at;
  end if;

  return jsonb_build_object(
    'contract', 'lazada_im_raw_complete_v1',
    'id', p_id,
    'status', v_final_status,
    'attemptCount', v_row.attempt_count
  );
end
$$;

create or replace function public.sellerpilot_service_mark_lazada_im_raw_event_v1(
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
         processed_at = coalesce(r.processed_at, now()),
         last_error_code = null
   where r.id = p_id
     and r.owner_id = v_owner
     and r.credential_id = p_credential_id
     and r.claim_token is null
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

drop function public.sellerpilot_service_prune_lazada_im_raw_inbox_v1();
create function public.sellerpilot_service_prune_lazada_im_raw_inbox_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_raw_deleted integer;
  v_outcomes_deleted integer;
  v_expired_unprocessed integer;
begin
  insert into sellerpilot_private.lazada_im_raw_outcomes (
    receipt_id, owner_id, credential_id, source_kind, delivery_digest,
    final_status, parser_version, attempt_count, error_code, raw_body_bytes,
    first_observed_at, finalized_at, expires_at
  )
  select r.id, r.owner_id, r.credential_id, r.source_kind, r.delivery_digest,
         case when r.processing_status = 'pending' then 'expired_unprocessed' else r.processing_status end,
         r.parser_version, r.attempt_count,
         case when r.processing_status = 'pending' then 'RAW_RETENTION_EXPIRED' else r.last_error_code end,
         octet_length(r.raw_body), r.first_observed_at, v_now, v_now + interval '90 days'
    from sellerpilot_private.lazada_im_raw_inbox r
   where r.expires_at <= v_now
  on conflict (receipt_id) do update set
    final_status = excluded.final_status,
    parser_version = excluded.parser_version,
    attempt_count = excluded.attempt_count,
    error_code = excluded.error_code,
    finalized_at = excluded.finalized_at,
    expires_at = excluded.expires_at;
  get diagnostics v_expired_unprocessed = row_count;

  delete from sellerpilot_private.lazada_im_raw_inbox where expires_at <= v_now;
  get diagnostics v_raw_deleted = row_count;
  delete from sellerpilot_private.lazada_im_raw_outcomes where expires_at <= v_now;
  get diagnostics v_outcomes_deleted = row_count;

  return jsonb_build_object(
    'contract', 'lazada_im_raw_prune_v2',
    'rawDeleted', v_raw_deleted,
    'outcomesRecorded', v_expired_unprocessed,
    'outcomesDeleted', v_outcomes_deleted
  );
end
$$;

revoke all on function public.sellerpilot_service_claim_lazada_im_raw_v1(integer,integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_complete_lazada_im_raw_v1(uuid,uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_prune_lazada_im_raw_inbox_v1()
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_claim_lazada_im_raw_v1(integer,integer)
  to service_role;
grant execute on function public.sellerpilot_service_complete_lazada_im_raw_v1(uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.sellerpilot_service_prune_lazada_im_raw_inbox_v1()
  to service_role;
revoke all on function public.sellerpilot_service_mark_lazada_im_raw_event_v1(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_mark_lazada_im_raw_event_v1(uuid,uuid,text)
  to service_role;

create function public.sellerpilot_read_lazada_im_raw_health_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  with per_owner as (
    select owner_id,
           count(*)::integer retained,
           coalesce(sum(octet_length(raw_body)), 0)::bigint retained_bytes
      from sellerpilot_private.lazada_im_raw_inbox
     group by owner_id
  ), totals as (
    select count(*)::integer retained,
           coalesce(sum(octet_length(raw_body)), 0)::bigint retained_bytes,
           count(*) filter (where processing_status = 'pending')::integer pending,
           count(*) filter (where processing_status = 'failed')::integer failed,
           count(*) filter (
             where expires_at <= statement_timestamp() + interval '24 hours'
           )::integer expiring,
           min(first_observed_at) filter (where processing_status = 'pending') oldest_pending
      from sellerpilot_private.lazada_im_raw_inbox
  )
  select jsonb_build_object(
    'contract', 'lazada_im_raw_health_v1',
    'capacity', 5000,
    'capacityScope', 'owner',
    'maximumRawBodyBytes', 256000,
    'retained', totals.retained,
    'retainedBytes', totals.retained_bytes,
    'ownerCount', (select count(*)::integer from per_owner),
    'maximumOwnerRetained', coalesce((select max(retained) from per_owner), 0),
    'maximumOwnerRetainedBytes', coalesce((select max(retained_bytes) from per_owner), 0),
    'pending', totals.pending,
    'failed', totals.failed,
    'expiringWithin24Hours', totals.expiring,
    'oldestPendingAt', totals.oldest_pending,
    'checkedAt', statement_timestamp()
  ) into v_result
  from totals;
  return v_result;
end
$$;

revoke all on function public.sellerpilot_read_lazada_im_raw_health_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_lazada_im_raw_health_v1()
  to authenticated;

commit;
