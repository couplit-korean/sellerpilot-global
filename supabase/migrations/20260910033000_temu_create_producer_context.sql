-- Service-only, read-only snapshot used by the Temu listing.create producer.
-- It exposes no credential secret and is rechecked by the append CAS in 025000.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

create or replace function public.sellerpilot_service_read_temu_create_app_gate_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_app sellerpilot_private.temu_create_app_gate_observations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select * into v_app from sellerpilot_private.temu_create_app_gate_observations
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id
   order by observed_at desc,recorded_at desc,id desc limit 1;
  if not found or v_app.observed_at<clock_timestamp()-interval '5 minutes' then
    return jsonb_build_object('contract','temu_create_app_gate_v1','status','missing'); end if;
  return jsonb_build_object('contract','temu_create_app_gate_v1','status',case
    when v_app.app_state='active' and v_app.compliance_state='approved'
      then 'allowed' else 'blocked' end,
    'appId',v_app.app_id,'appState',v_app.app_state,
    'complianceState',v_app.compliance_state,
    'rejectionReason',v_app.rejection_reason,
    'partnerAccountSubject',v_app.partner_account_subject,
    'evidenceSha256',v_app.evidence_sha256,
    'observedAt',v_app.observed_at,'expiresAt',v_app.observed_at+interval '5 minutes');
end;
$$;

create function public.sellerpilot_service_temu_create_source_context_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_current sellerpilot_private.temu_create_authoritative_current%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select * into v_product from sellerpilot_private.products
   where id=p_product_id and owner_id=p_owner_id;
  select * into v_credential from sellerpilot_private.channel_credentials
   where id=p_credential_id and created_by=p_owner_id and channel='temu'
     and environment='production' and status='active';
  if v_product.id is null or v_credential.id is null
     or (v_credential.expires_at is not null and v_credential.expires_at<=clock_timestamp())
     or v_credential.seller_account_key is null then
    return jsonb_build_object('contract','temu_create_source_context_v1','status','missing');
  end if;
  select * into v_current from sellerpilot_private.temu_create_authoritative_current
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id;
  return jsonb_build_object(
    'contract','temu_create_source_context_v1','status','ready',
    'productUpdatedAt',v_product.updated_at,
    'productRevision',greatest(coalesce(v_product.detail_page_version,0),1)::text,
    'credentialVersion',v_credential.version,
    'credentialFingerprint',v_credential.fingerprint,
    'credentialEnvironment',v_credential.environment,
    'currentSourceId',v_current.source_id,
    'currentSourceRevision',coalesce(v_current.source_revision,0),
    'readAt',clock_timestamp());
end;
$$;

revoke all on function public.sellerpilot_service_temu_create_source_context_v1(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_temu_create_source_context_v1(uuid,uuid,uuid)
  to service_role;

commit;
