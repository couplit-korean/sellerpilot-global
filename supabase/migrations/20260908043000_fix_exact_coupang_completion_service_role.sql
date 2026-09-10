-- The exact Coupang resolver runs behind a service-role-only PostgREST RPC.
-- Supabase secret keys set the active database role to service_role without
-- promising the legacy request.jwt.claim.role setting. The old JWT-only guard
-- therefore rolled back a valid GET-only completion with SQLSTATE 42501.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare
  resolver_oid oid;
  definition text;
  definition_sha256 text;
  source_sha256 text;
  function_owner text;
  security_definer boolean;
  function_config text[];
  execute_acl text[];
begin
  resolver_oid :=
    'public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)'::regprocedure;

  select
    pg_catalog.pg_get_functiondef(p.oid),
    encode(
      extensions.digest(pg_catalog.pg_get_functiondef(p.oid)::bytea, 'sha256'),
      'hex'
    ),
    encode(extensions.digest(p.prosrc::bytea, 'sha256'), 'hex'),
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    array(
      select pg_catalog.format(
        '%s:%s:%s',
        pg_catalog.pg_get_userbyid(permission.grantee),
        permission.privilege_type,
        permission.is_grantable
      )
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) permission
      order by 1
    )
  into strict
    definition,
    definition_sha256,
    source_sha256,
    function_owner,
    security_definer,
    function_config,
    execute_acl
  from pg_catalog.pg_proc p
  where p.oid = resolver_oid;

  if definition_sha256 <> 'f00cf967f04081ad22a5f0b259d314d712f5acc7c438b34410f6ebf1ba079349'
     and source_sha256 not in (
       'cd812a3ab7a039384f7446072878d23c26dfaec3442a7c4a03eb7efe71bce3ec',
       'af8340dcac984a197adf6dd7a9f3d54b61c32cdfeb5e5d6b040827266c1c8193'
     ) then
    raise exception 'COUPANG_EXACT_LIVE_RESOLVER_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  if function_owner <> 'postgres'
     or not security_definer
     or function_config is distinct from array['search_path=""']::text[]
     or execute_acl is distinct from
       array['postgres:EXECUTE:f', 'service_role:EXECUTE:f']::text[] then
    raise exception 'COUPANG_EXACT_LIVE_RESOLVER_SECURITY_DRIFT'
      using errcode = '55000';
  end if;
end
$preflight$;

create or replace function
public.sellerpilot_service_resolve_exact_coupang_live_verifier(p_job uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  j sellerpilot_private.channel_gateway_jobs%rowtype;
  s sellerpilot_private.channel_gateway_jobs%rowtype;
  a sellerpilot_private.channel_operation_attempts%rowtype;
  l sellerpilot_private.product_listings%rowtype;
  r sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
  receipt sellerpilot_private.coupang_exact_live_verify_receipts%rowtype;
  response_sha text;
  resources jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1637578093, 8072039);

  select * into r
    from sellerpilot_private.coupang_exact_live_verify_runs
   where verifier_job_id = p_job
   for update;
  if r.verifier_job_id is null then
    raise exception 'exact Coupang verifier run missing' using errcode = '55000';
  end if;

  select * into s
    from sellerpilot_private.channel_gateway_jobs
   where id = r.source_job_id
   for update;
  select * into a
    from sellerpilot_private.channel_operation_attempts
   where id = r.source_attempt_id
   for update;
  select * into j
    from sellerpilot_private.channel_gateway_jobs
   where id = r.verifier_job_id
   for update;
  select * into l
    from sellerpilot_private.product_listings
   where id = r.listing_id
   for update;
  select * into receipt
    from sellerpilot_private.coupang_exact_live_verify_receipts
   where verifier_job_id = p_job
   for share;

  response_sha := encode(
    extensions.digest(j.response_payload::text, 'sha256'),
    'hex'
  );
  resources := sellerpilot_private.coupang_exact_live_remote_resources(j.id);

  if receipt.verifier_job_id is not null then
    if receipt.response_sha256 = response_sha
       and receipt.source_job_id = s.id
       and receipt.source_attempt_id = a.id
       and receipt.listing_id = l.id
       and receipt.remote_id = '16375780938'
       and not receipt.provider_mutation_performed
       and receipt.provider_live_verified
       and not receipt.buyer_visible_verified
       and encode(
         extensions.digest(to_jsonb(s)::text, 'sha256'),
         'hex'
       ) = r.source_job_sha256
       and encode(
         extensions.digest(to_jsonb(a)::text, 'sha256'),
         'hex'
       ) = r.source_attempt_sha256
       and l.remote_id = '16375780938'
       and l.status = 'published'
       and l.remote_visibility = 'live'
       and l.remote_resources = resources then
      return true;
    end if;
    raise exception 'exact Coupang reconciliation replay drifted'
      using errcode = '55000';
  end if;

  if sellerpilot_private.coupang_exact_live_completion_valid(p_job) is not true then
    raise exception 'exact Coupang GET verification incomplete'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.coupang_exact_live_verify_receipts (
    verifier_job_id,
    source_job_id,
    source_attempt_id,
    listing_id,
    remote_id,
    response_sha256,
    seller_product_verified,
    all_vendor_items_on_sale,
    exact_content_verified,
    exact_eight_images_verified,
    vendor_item_ids,
    provider_live_verified,
    buyer_visible_verified,
    provider_mutation_performed,
    recorded_at
  ) values (
    j.id,
    s.id,
    a.id,
    l.id,
    '16375780938',
    response_sha,
    true,
    true,
    true,
    true,
    j.response_payload#>'{remoteState,resources,vendorItemIds}',
    true,
    false,
    false,
    clock_timestamp()
  );

  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_live_reconcile',
    j.id::text,
    true
  );
  update sellerpilot_private.product_listings
     set remote_id = '16375780938',
         status = 'published',
         failure_class = null,
         remote_visibility = 'live',
         provider_status = j.response_payload#>>'{remoteState,providerStatus}',
         remote_resources = resources,
         published_at = coalesce(
           published_at,
           (j.response_payload#>>'{remoteState,verifiedAt}')::timestamptz
         ),
         last_verified_at =
           (j.response_payload#>>'{remoteState,verifiedAt}')::timestamptz,
         last_error = null,
         updated_at = clock_timestamp()
   where id = l.id;

  insert into sellerpilot_private.operation_audit (
    owner_id,
    action,
    entity_type,
    entity_id,
    safe_detail
  ) values (
    l.owner_id,
    'coupang_exact_live_get_reconciled',
    'product_listing',
    l.id::text,
    jsonb_build_object(
      'sourceJobId', s.id,
      'sourceAttemptId', a.id,
      'verifierJobId', j.id,
      'remoteId', '16375780938',
      'verificationScope', 'provider_live_only',
      'providerLiveVerified', true,
      'buyerVisibleVerified', false,
      'providerMutationPerformed', false,
      'responseSha256', response_sha
    )
  );
  return true;
end
$$;

revoke all on function
public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)
from public, anon, authenticated;
grant execute on function
public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)
to service_role;

do $verify$
declare
  resolver_oid oid;
  definition text;
  source_sha256 text;
  function_owner text;
  security_definer boolean;
  function_config text[];
  execute_acl text[];
begin
  resolver_oid :=
    'public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)'::regprocedure;

  select
    pg_catalog.pg_get_functiondef(p.oid),
    encode(extensions.digest(p.prosrc::bytea, 'sha256'), 'hex'),
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    array(
      select pg_catalog.format(
        '%s:%s:%s',
        pg_catalog.pg_get_userbyid(permission.grantee),
        permission.privilege_type,
        permission.is_grantable
      )
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) permission
      order by 1
    )
  into strict
    definition,
    source_sha256,
    function_owner,
    security_definer,
    function_config,
    execute_acl
  from pg_catalog.pg_proc p
  where p.oid = resolver_oid;

  if source_sha256 <> 'af8340dcac984a197adf6dd7a9f3d54b61c32cdfeb5e5d6b040827266c1c8193'
     or pg_catalog.strpos(pg_catalog.lower(definition), 'request.jwt.claim.role') > 0
     or pg_catalog.strpos(
       pg_catalog.lower(definition),
       'current_setting(''role'', true) is distinct from ''service_role'''
     ) = 0
     or function_owner <> 'postgres'
     or not security_definer
     or function_config is distinct from array['search_path=""']::text[]
     or execute_acl is distinct from
       array['postgres:EXECUTE:f', 'service_role:EXECUTE:f']::text[] then
    raise exception 'COUPANG_EXACT_LIVE_RESOLVER_ROLE_GUARD_NOT_FIXED'
      using errcode = '55000';
  end if;
end
$verify$;

comment on function
public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)
is 'Resolves the exact GET-only Coupang provider-live verifier after authenticating the PostgREST service_role used by Supabase secret keys.';

commit;
