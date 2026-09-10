-- channel: elevenst
-- assignment: CS-elevenst-CONT-07
-- Proposal only. Apply after accepted overflow and exact-reply migrations.
-- Binds every new observation and authenticated read to one verified credential
-- lineage while retaining the existing couplit identity for its legacy rows.

begin;

alter table sellerpilot_private.elevenst_cs_read_observations
  drop constraint elevenst_cs_read_observations_seller_id_check;
alter table sellerpilot_private.elevenst_cs_read_observations
  add constraint elevenst_cs_read_observations_seller_id_check
  check (seller_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$');
alter table sellerpilot_private.elevenst_cs_read_observations
  drop constraint elevenst_cs_read_observations_seller_name_check;
alter table sellerpilot_private.elevenst_cs_read_observations
  add constraint elevenst_cs_read_observations_seller_name_check
  check (seller_name = trim(seller_name) and length(seller_name) between 1 and 160);

create function sellerpilot_private.elevenst_cs_account_identity(
  p_credential_id uuid
)
returns table (
  credential_id uuid,
  owner_id uuid,
  seller_account_key text,
  seller_id text,
  seller_name text,
  environment text,
  version integer,
  verified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_existing record;
  v_expected_id text;
  v_expected_name text;
begin
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'ELEVENST_READ_ACTIVE_LINEAGE_REQUIRED';
  end if;

  v_expected_id := 'account_' || substr(encode(extensions.digest(
    convert_to('elevenst' || E'\x1f' || v_credential.seller_account_key, 'UTF8'),
    'sha256'
  ), 'hex'), 1, 32);
  v_expected_name := '11번가 연결 계정 · v' || v_credential.version::text;

  select count(*)::integer as row_count,
         count(distinct (observation.seller_id, observation.seller_name))::integer as identity_count,
         min(observation.seller_id) as seller_id,
         min(observation.seller_name) as seller_name
    into v_existing
    from sellerpilot_private.elevenst_cs_read_observations observation
   where observation.credential_id = v_credential.id
     and observation.owner_id = v_credential.created_by
     and observation.seller_account_key = v_credential.seller_account_key;
  if v_existing.identity_count > 1 then
    raise exception 'ELEVENST_CREDENTIAL_IDENTITY_AMBIGUOUS';
  end if;
  if v_existing.row_count > 0
     and not (
       (v_existing.seller_id = 'couplit' and v_existing.seller_name = '커플릿')
       or (v_existing.seller_id = v_expected_id and v_existing.seller_name = v_expected_name)
     ) then
    raise exception 'ELEVENST_CREDENTIAL_IDENTITY_INVALID';
  end if;

  return query select
    v_credential.id,
    v_credential.created_by,
    v_credential.seller_account_key,
    case when v_existing.row_count > 0 then v_existing.seller_id else v_expected_id end,
    case when v_existing.row_count > 0 then v_existing.seller_name else v_expected_name end,
    v_credential.environment,
    v_credential.version,
    v_credential.seller_account_verified_at;
end;
$$;

revoke all on function sellerpilot_private.elevenst_cs_account_identity(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_record_elevenst_cs_read_v1(
  p_credential_id uuid,
  p_observation jsonb,
  p_inquiries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_identity record;
  v_surface text := coalesce(p_observation->>'surface','');
  v_scope_start date;
  v_scope_end date;
  v_checked_at timestamptz;
  v_http_status integer;
  v_provider_rows integer;
  v_accepted boolean;
  v_parse_incomplete boolean;
  v_status_filter text := nullif(p_observation->>'statusFilter','');
  v_observation_id uuid;
  v_duplicate boolean := false;
  v_stored integer := 0;
begin
  if jsonb_typeof(p_observation) is distinct from 'object'
     or jsonb_typeof(p_inquiries) is distinct from 'array'
     or exists (
       select 1 from jsonb_object_keys(p_observation) key
        where key <> all(array[
          'surface','sellerId','sellerName','scopeStart','scopeEnd','statusFilter',
          'checkedAt','httpStatus','accepted','resultCode','providerRows',
          'parserMarker','parseIncomplete','evidenceSha256'
        ])
     ) then
    raise exception 'ELEVENST_READ_OBSERVATION_INVALID';
  end if;
  begin
    v_scope_start := to_date(p_observation->>'scopeStart','YYYYMMDD');
    v_scope_end := to_date(p_observation->>'scopeEnd','YYYYMMDD');
    v_checked_at := (p_observation->>'checkedAt')::timestamptz;
    v_http_status := nullif(p_observation->>'httpStatus','')::integer;
    v_provider_rows := (p_observation->>'providerRows')::integer;
    v_accepted := (p_observation->>'accepted')::boolean;
    v_parse_incomplete := (p_observation->>'parseIncomplete')::boolean;
  exception when others then
    raise exception 'ELEVENST_READ_OBSERVATION_INVALID';
  end;
  if coalesce(p_observation->>'sellerId','') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
     or coalesce(p_observation->>'sellerName','') <> trim(coalesce(p_observation->>'sellerName',''))
     or length(coalesce(p_observation->>'sellerName','')) not between 1 and 160
     or v_surface not in ('product_qna','urgent_alimi')
     or p_observation->>'scopeStart' !~ '^[0-9]{8}$'
     or p_observation->>'scopeEnd' !~ '^[0-9]{8}$'
     or to_char(v_scope_start,'YYYYMMDD') <> p_observation->>'scopeStart'
     or to_char(v_scope_end,'YYYYMMDD') <> p_observation->>'scopeEnd'
     or v_scope_end < v_scope_start
     or (v_surface = 'product_qna' and (
       v_scope_end - v_scope_start > 6 or v_status_filter is null
       or v_status_filter not in ('00','01','02')
     ))
     or (v_surface = 'urgent_alimi' and (
       v_scope_end - v_scope_start > 29
       or (v_status_filter is not null and v_status_filter not in ('01','02','03','04','05','06'))
     ))
     or not isfinite(v_checked_at)
     or v_checked_at > statement_timestamp() + interval '5 minutes'
     or v_http_status not between 100 and 599
     or v_provider_rows not between 0 and 1000000
     or (v_surface = 'urgent_alimi' and v_provider_rows > 5001)
     or coalesce(p_observation->>'evidenceSha256','') !~ '^[a-f0-9]{64}$'
     or (v_accepted and (v_http_status <> 200 or v_parse_incomplete))
     or (v_surface = 'product_qna' and jsonb_array_length(p_inquiries) <> 0)
     or (v_surface = 'urgent_alimi' and v_accepted and (
       p_observation->>'resultCode' <> '0'
       or p_observation->>'parserMarker' is distinct from 'sellerpilot-elevenst-alimi-parser/1'
       or v_provider_rows <> jsonb_array_length(p_inquiries)
     ))
     or (v_surface = 'urgent_alimi' and not v_accepted
       and jsonb_array_length(p_inquiries) <> 0)
     or (v_surface = 'product_qna' and not v_parse_incomplete
       and v_provider_rows > 500)
     or (v_surface = 'product_qna' and v_accepted and (
       p_observation->>'parserMarker' is distinct from 'sellerpilot-elevenst-product-qna-parser/1'
       or v_provider_rows > 500
       or coalesce(p_observation->>'resultCode','') not in ('','0','200','210')
     ))
     or (v_parse_incomplete and (
       v_accepted
       or (v_surface = 'urgent_alimi' and (
         v_provider_rows <> 5001
         or p_observation->>'parserMarker' is distinct from 'sellerpilot-elevenst-alimi-parser/1'
       ))
       or (v_surface = 'product_qna' and (
         v_provider_rows not between 501 and 1000000
         or p_observation->>'parserMarker' is distinct from 'sellerpilot-elevenst-product-qna-parser/1'
       ))
       or v_surface not in ('product_qna','urgent_alimi')
     )) then
    raise exception 'ELEVENST_READ_OBSERVATION_INVALID';
  end if;

  select credential.created_by, credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'ELEVENST_READ_ACTIVE_LINEAGE_REQUIRED';
  end if;
  select * into v_identity
    from sellerpilot_private.elevenst_cs_account_identity(p_credential_id);
  if v_identity.seller_id is distinct from p_observation->>'sellerId'
     or v_identity.seller_name is distinct from p_observation->>'sellerName'
     or v_identity.owner_id is distinct from v_credential.created_by
     or v_identity.seller_account_key is distinct from v_credential.seller_account_key then
    raise exception 'ELEVENST_READ_CREDENTIAL_IDENTITY_MISMATCH';
  end if;

  insert into sellerpilot_private.elevenst_cs_read_observations (
    owner_id, credential_id, seller_account_key, seller_id, seller_name,
    surface, scope_start, scope_end, status_filter, checked_at, http_status,
    accepted, result_code, provider_rows, parser_marker, parse_incomplete,
    evidence_sha256
  ) values (
    v_credential.created_by, p_credential_id, v_credential.seller_account_key,
    v_identity.seller_id, v_identity.seller_name,
    v_surface, v_scope_start, v_scope_end,
    v_status_filter, v_checked_at, v_http_status, v_accepted,
    nullif(p_observation->>'resultCode',''), v_provider_rows,
    nullif(p_observation->>'parserMarker',''), v_parse_incomplete,
    p_observation->>'evidenceSha256'
  ) on conflict do nothing returning id into v_observation_id;
  if v_observation_id is null then
    v_duplicate := true;
    select observation.id into strict v_observation_id
      from sellerpilot_private.elevenst_cs_read_observations observation
     where observation.credential_id = p_credential_id
       and observation.surface = v_surface
       and observation.scope_start = v_scope_start
       and observation.scope_end = v_scope_end
       and coalesce(observation.status_filter,'') = coalesce(v_status_filter,'')
       and observation.evidence_sha256 = p_observation->>'evidenceSha256';
    update sellerpilot_private.elevenst_cs_read_observations observation set
      checked_at = greatest(observation.checked_at, v_checked_at)
    where observation.id = v_observation_id;
  end if;

  if v_surface = 'urgent_alimi' and v_accepted then
    select count(*)::integer into v_stored
      from jsonb_array_elements(p_inquiries) item(value)
     where exists (
       select 1
         from sellerpilot_private.support_inbound_messages message
         join sellerpilot_private.support_tickets ticket on ticket.id = message.ticket_id
        where message.owner_id = v_credential.created_by
          and message.channel_key = 'elevenst'
          and message.inbound_key = item.value->>'inboundKey'
          and ticket.source_credential_id = p_credential_id
          and ticket.seller_account_key = v_credential.seller_account_key
          and ticket.provider_context->>'kind' in ('urgent_inquiry','urgent_notice')
     );
    if v_stored <> jsonb_array_length(p_inquiries) then
      raise exception 'ELEVENST_ALIMI_LEDGER_LINK_INCOMPLETE';
    end if;
    update sellerpilot_private.elevenst_alimi_state_events event set
      read_observation_id = v_observation_id
    where event.owner_id = v_credential.created_by
      and event.source_credential_id = p_credential_id
      and event.read_observation_id is null
      and exists (
        select 1 from jsonb_array_elements(p_inquiries) item(value)
         where item.value#>>'{providerContext,emerNtceSeq}' = event.emer_ntce_seq
           and item.value#>>'{providerContext,emerCtntSeq}' = event.emer_ctnt_seq
           and item.value#>>'{providerContext,sourceDigest}' = event.source_digest
      );
  end if;
  return jsonb_build_object(
    'contract','sellerpilot-elevenst-cs-read-record/1',
    'observationId',v_observation_id,
    'duplicateObservation',v_duplicate,
    'accepted',v_accepted,
    'providerRows',v_provider_rows,
    'storedRows',v_stored
  );
end;
$$;

revoke all on function public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)
  to service_role;

create function public.sellerpilot_service_elevenst_cs_account_identity_v1(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity record;
begin
  select * into v_identity
    from sellerpilot_private.elevenst_cs_account_identity(p_credential_id);
  return jsonb_build_object(
    'contract','sellerpilot-elevenst-cs-account-identity/1',
    'credentialId',v_identity.credential_id,
    'sellerId',v_identity.seller_id,
    'sellerName',v_identity.seller_name,
    'environment',v_identity.environment,
    'version',v_identity.version,
    'verifiedAt',to_char(
      v_identity.verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
end;
$$;

revoke all on function public.sellerpilot_service_elevenst_cs_account_identity_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_elevenst_cs_account_identity_v1(uuid)
  to service_role;

create function public.sellerpilot_read_elevenst_cs_accounts_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_accounts jsonb;
begin
  if auth.uid() is null
     or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  with active_credentials as materialized (
    select credential.id
      from sellerpilot_private.channel_credentials credential
     where credential.channel = 'elevenst'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null or credential.expires_at > statement_timestamp())
       and credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and credential.seller_account_key_source in (
         'provider_certified_v1','credential_incarnation_v1'
       )
       and credential.seller_account_verified_at is not null
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'credentialId',identity.credential_id,
      'sellerId',identity.seller_id,
      'sellerName',identity.seller_name,
      'label',identity.seller_name || ' · 운영 · v' || identity.version::text,
      'environment',identity.environment,
      'version',identity.version,
      'verifiedAt',to_char(
        identity.verified_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ) order by identity.version desc, identity.credential_id
  ), '[]'::jsonb)
    into v_accounts
    from active_credentials credential
    cross join lateral sellerpilot_private.elevenst_cs_account_identity(credential.id) identity
  ;
  return jsonb_build_object(
    'contractVersion','sellerpilot-elevenst-authenticated-accounts/1',
    'accounts',v_accounts
  );
end;
$$;

revoke all on function public.sellerpilot_read_elevenst_cs_accounts_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_elevenst_cs_accounts_v1()
  to authenticated;

create function public.sellerpilot_read_elevenst_cs_read_state_v3(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_qna sellerpilot_private.elevenst_cs_read_observations%rowtype;
  v_alimi sellerpilot_private.elevenst_cs_read_observations%rowtype;
  v_qna_count integer;
  v_alimi_count integer;
  v_qna_latest timestamptz;
  v_alimi_latest timestamptz;
begin
  if auth.uid() is null
     or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  if p_credential_id is null then
    raise exception 'ELEVENST_READ_SELECTION_INVALID' using errcode = '22023';
  end if;
  select * into v_identity
    from sellerpilot_private.elevenst_cs_account_identity(p_credential_id);

  select observation.* into v_qna
    from sellerpilot_private.elevenst_cs_read_observations observation
   where observation.credential_id = v_identity.credential_id
     and observation.owner_id = v_identity.owner_id
     and observation.seller_account_key = v_identity.seller_account_key
     and observation.seller_id = v_identity.seller_id
     and observation.seller_name = v_identity.seller_name
     and observation.surface = 'product_qna'
     and observation.status_filter = '00'
   order by observation.checked_at desc, observation.id desc limit 1;
  select observation.* into v_alimi
    from sellerpilot_private.elevenst_cs_read_observations observation
   where observation.credential_id = v_identity.credential_id
     and observation.owner_id = v_identity.owner_id
     and observation.seller_account_key = v_identity.seller_account_key
     and observation.seller_id = v_identity.seller_id
     and observation.seller_name = v_identity.seller_name
     and observation.surface = 'urgent_alimi'
     and observation.status_filter is null
   order by observation.checked_at desc, observation.id desc limit 1;
  if v_qna.id is null or v_alimi.id is null then
    raise exception 'ELEVENST_SELECTED_READ_STATE_INCOMPLETE' using errcode = '22023';
  end if;

  select count(*)::integer, max(ticket.received_at)
    into v_qna_count, v_qna_latest
    from sellerpilot_private.support_tickets ticket
   where ticket.owner_id = v_identity.owner_id
     and ticket.channel_key = 'elevenst'
     and ticket.source_credential_id = v_identity.credential_id
     and ticket.seller_account_key = v_identity.seller_account_key
     and ticket.provider_context->>'kind' = 'product_qna'
     and not ticket.demo;
  select count(*)::integer, max(ticket.received_at)
    into v_alimi_count, v_alimi_latest
    from sellerpilot_private.support_tickets ticket
   where ticket.owner_id = v_identity.owner_id
     and ticket.channel_key = 'elevenst'
     and ticket.source_credential_id = v_identity.credential_id
     and ticket.seller_account_key = v_identity.seller_account_key
     and ticket.provider_context->>'kind' in ('urgent_inquiry','urgent_notice')
     and not ticket.demo;

  return jsonb_build_object(
    'credentialId',v_identity.credential_id,
    'sellerId',v_identity.seller_id,
    'sellerName',v_identity.seller_name,
    'productQna',jsonb_build_object(
      'checkedAt',to_char(v_qna.checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'httpStatus',v_qna.http_status,
      'accepted',v_qna.accepted,
      'resultCode',v_qna.result_code,
      'providerRows',v_qna.provider_rows,
      'storedRowCount',v_qna_count,
      'latestStoredReceivedAt',case when v_qna_latest is null then null else
        to_char(v_qna_latest at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
    ),
    'urgentAlimi',jsonb_build_object(
      'checkedAt',to_char(v_alimi.checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'httpStatus',v_alimi.http_status,
      'accepted',v_alimi.accepted,
      'resultCode',v_alimi.result_code,
      'providerRows',v_alimi.provider_rows,
      'storedRowCount',v_alimi_count,
      'latestStoredReceivedAt',case when v_alimi_latest is null then null else
        to_char(v_alimi_latest at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
    )
  );
end;
$$;

revoke all on function public.sellerpilot_read_elevenst_cs_read_state_v3(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_elevenst_cs_read_state_v3(uuid)
  to authenticated;

comment on function sellerpilot_private.elevenst_cs_account_identity(uuid)
  is 'Derives one stable 11st CS identity from verified credential metadata; an existing couplit lineage remains unchanged.';
comment on function public.sellerpilot_service_elevenst_cs_account_identity_v1(uuid)
  is 'Service-only safe identity metadata for binding an 11st completion observation to its selected credential.';
comment on function public.sellerpilot_read_elevenst_cs_accounts_v1()
  is 'Approved shared-workspace administrators can list safe active 11st account selector metadata; no secret, fingerprint, or account key.';
comment on function public.sellerpilot_read_elevenst_cs_read_state_v3(uuid)
  is 'Approved shared-workspace administrator read of one server-resolved 11st credential identity and its exact observation lineage.';

notify pgrst, 'reload schema';

commit;
