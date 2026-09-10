-- Safe service-only projection for the current Elevenst 1346631 approval.
-- Provider Product and credential secrets are consumed for binding/digest only
-- and are never projected by this RPC.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900702650);

do $migration$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.elevenst_new_product_source_approvals'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_elevenst_new_product_approval_context(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_elevenst_new_product_source(text,uuid,uuid,text,uuid,integer)'
     ) is null then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_READBACK_DEPENDENCY_MISSING';
  end if;
end;
$migration$;

create function public.sellerpilot_service_elevenst_new_product_source_readback(
  p_actor_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context_value jsonb;
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  approval_row sellerpilot_private.elevenst_new_product_source_approvals%rowtype;
  source_values jsonb;
  source_digest text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_actor_id is null
     or p_product_id is null
     or p_credential_id is null
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = p_actor_id
     ) then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_READBACK_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  context_value := public.sellerpilot_service_elevenst_new_product_approval_context(
    p_actor_id, p_product_id, p_credential_id, p_market, p_target_id
  );
  if context_value is null then return null; end if;

  select source.*
    into source_row
    from sellerpilot_private.elevenst_new_product_server_sources source
   where source.owner_id = (context_value->>'ownerId')::uuid
     and source.product_id = p_product_id
     and source.category_id = '1346631'
     and source.credential_id = p_credential_id
     and source.credential_version = (context_value->>'credentialVersion')::integer
     and source.product_updated_at = (context_value->>'productUpdatedAt')::timestamptz
     and source.product_revision = (context_value->>'productRevision')::bigint
     and source.product_approval_revision = (context_value->>'productApprovalRevision')::bigint
     and source.status = 'approved'
     and exists (
       select 1
         from sellerpilot_private.elevenst_new_product_source_approvals approval
        where approval.source_id = source.id
          and approval.draft_version = (context_value->>'draftVersion')::bigint
          and approval.detail_manifest_digest = context_value->>'detailManifestDigest'
     );
  if not found then return null; end if;

  select approval.* into strict approval_row
    from sellerpilot_private.elevenst_new_product_source_approvals approval
   where approval.source_id = source_row.id;

  source_values := pg_catalog.jsonb_build_object(
    'product', public.sellerpilot_service_elevenst_new_product_source(
      'product', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'credential', public.sellerpilot_service_elevenst_new_product_source(
      'credential', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'notices', public.sellerpilot_service_elevenst_new_product_source(
      'notices', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'seller', public.sellerpilot_service_elevenst_new_product_source(
      'seller', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'availability', public.sellerpilot_service_elevenst_new_product_source(
      'availability', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'policy', public.sellerpilot_service_elevenst_new_product_source(
      'policy', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    )
  );
  if exists (
    select 1
      from pg_catalog.jsonb_each(source_values) item
     where item.value = 'null'::jsonb
        or item.value->>'current' is distinct from 'true'
  ) then
    return null;
  end if;

  source_digest := pg_catalog.encode(
    extensions.digest(source_values::text, 'sha256'), 'hex'
  );
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_source_readback_v1',
    'current', true,
    'sourceId', source_row.id,
    'ownerId', source_row.owner_id,
    'productId', source_row.product_id,
    'credentialId', source_row.credential_id,
    'credentialVersion', source_row.credential_version,
    'productRevision', source_row.product_revision,
    'productApprovalRevision', source_row.product_approval_revision,
    'draftVersion', approval_row.draft_version,
    'approvalPayloadSha256', approval_row.approval_payload_sha256,
    'approvedAt', approval_row.approved_at,
    'sixKindDigest', source_digest
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_elevenst_new_product_source_readback(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_elevenst_new_product_source_readback(
    uuid, uuid, uuid, text, text
  ) to service_role;

commit;
