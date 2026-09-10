-- channel: elevenst
-- assignment: CS-elevenst-CONT-04
-- Proposal only. Central must allocate the final ordered migration filename.
-- Verified by applying the canonical 20260908140411 migration before this SQL.

begin;

do $preimage$
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)')) is distinct from '18ffb6b2925139d22ca7b13e03490328' then
  raise exception 'ELEVENST_OVERFLOW_PREIMAGE_DRIFTED';
 end if;
end $preimage$;


alter table sellerpilot_private.elevenst_cs_read_observations
  drop constraint elevenst_cs_read_observations_provider_rows_check;
alter table sellerpilot_private.elevenst_cs_read_observations
  add constraint elevenst_cs_read_observations_provider_rows_check
  check (provider_rows between 0 and 1000000);

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
  if p_observation->>'sellerId' <> 'couplit'
     or p_observation->>'sellerName' <> '커플릿'
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

  insert into sellerpilot_private.elevenst_cs_read_observations (
    owner_id, credential_id, seller_account_key, seller_id, seller_name,
    surface, scope_start, scope_end, status_filter, checked_at, http_status,
    accepted, result_code, provider_rows, parser_marker, parse_incomplete,
    evidence_sha256
  ) values (
    v_credential.created_by, p_credential_id, v_credential.seller_account_key,
    'couplit', '커플릿', v_surface, v_scope_start, v_scope_end,
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

commit;
