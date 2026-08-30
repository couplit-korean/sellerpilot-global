-- Reconcile one exact Qoo10 listing.update that was fenced before the first
-- provider mutation. A later, read-only QSM observation proves that the
-- already-existing item remains S1/non-public with the previously confirmed
-- content. This migration never calls Qoo10 and never rewrites the immutable
-- gateway request, NULL response, or completion-receipt ledger.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

create table if not exists
  sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations (
    job_id uuid not null,
    attempt_id uuid not null,
    listing_id uuid not null,
    product_id uuid not null,
    credential_id uuid not null,
    source_job_id uuid not null,
    source_attempt_id uuid not null,
    remote_id text not null,
    request_fingerprint text not null,
    request_sha256 text not null,
    qsm_observed_at timestamptz not null,
    item_title text not null,
    seller_sku text not null,
    provider_status text not null,
    remote_visibility text not null,
    currency text not null,
    retail_price_jpy bigint not null,
    sell_price_jpy bigint not null,
    quantity integer not null,
    category_code text not null,
    origin_type text not null,
    origin_code text not null,
    shipping_no text not null,
    bi_contents_no bigint not null,
    ordered_image_urls text[] not null,
    ordered_image_digest_sha256 text not null,
    provider_mutation_started boolean not null,
    provider_call_replayed boolean not null,
    reconciled_at timestamptz not null,
    constraint qoo10_preprovider_reconcile_pkey
      primary key (job_id),
    constraint qoo10_preprovider_reconcile_attempt_key
      unique (attempt_id),
    constraint qoo10_preprovider_reconcile_listing_key
      unique (listing_id),
    constraint qoo10_preprovider_reconcile_job_fkey
      foreign key (job_id)
      references sellerpilot_private.channel_gateway_jobs(id)
      on delete restrict,
    constraint qoo10_preprovider_reconcile_attempt_fkey
      foreign key (attempt_id)
      references sellerpilot_private.channel_operation_attempts(id)
      on delete restrict,
    constraint qoo10_preprovider_reconcile_listing_fkey
      foreign key (listing_id)
      references sellerpilot_private.product_listings(id)
      on delete restrict,
    constraint qoo10_preprovider_reconcile_product_fkey
      foreign key (product_id)
      references sellerpilot_private.products(id)
      on delete restrict,
    constraint qoo10_preprovider_reconcile_credential_fkey
      foreign key (credential_id)
      references sellerpilot_private.channel_credentials(id)
      on delete restrict,
    constraint qoo10_preprovider_reconcile_source_job_fkey
      foreign key (source_job_id)
      references sellerpilot_private.channel_gateway_jobs(id)
      on delete restrict,
    constraint qoo10_preprovider_reconcile_source_attempt_fkey
      foreign key (source_attempt_id)
      references sellerpilot_private.channel_operation_attempts(id)
      on delete restrict,
    constraint qoo10_preprovider_reconcile_exact_target_check
      check (
        job_id = '6795cc6c-57e9-4239-9241-e2942de6a1a1'::uuid
        and attempt_id = '95ce0ac4-ed20-4d2d-993b-0ef88e111604'::uuid
        and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
        and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
        and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
        and source_job_id = '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid
        and source_attempt_id = '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid
        and remote_id = '1217336970'
      ),
    constraint qoo10_preprovider_reconcile_request_check
      check (
        request_fingerprint =
          'a98ca816896acd825f29fc90f4d94881a4655617175170f79dc23e2a666390f3'
        and request_sha256 =
          '634c0ead954b340d8eb3b16cef70715dd9036a0f61085275a3209670a063ef29'
      ),
    constraint qoo10_preprovider_reconcile_qsm_check
      check (
        qsm_observed_at = '2026-08-30 20:50:31.105+00'::timestamptz
        and item_title = '貼り付け式ケーブル整理クリップ6個セット'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_status = 'S1'
        and remote_visibility = 'non_public'
        and currency = 'JPY'
        and retail_price_jpy = 1871
        and sell_price_jpy = 1871
        and quantity = 1
        and category_code = '320000542'
        and origin_type = '2'
        and origin_code = 'CN'
        and shipping_no = '806971'
        and bi_contents_no = 8461402963
      ),
    constraint qoo10_preprovider_reconcile_images_check
      check (
        ordered_image_digest_sha256 =
          'd30953d938a8c966709cd8739c4170462167bb88a2a92bddb0f71e7902035467'
        and ordered_image_urls = array[
          'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/e6/e6972e812b95d38ccb08026cc16573660d532012951c54bcbd9aa57807c907c3.jpg',
          'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/64/641856cd5eff810194e0b5c14309e099c0c716f3643b8f68377bfe6baca521b8.jpg',
          'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/04/04f2523967867f7f0c218c635beb34571aec4f97b80cb24adae9d8e5edf994db.jpg',
          'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/7f/7fe0ed3832f3bff882b576c6709e7a201a8b2c18b4905dd8b5bbdc3ce5bbcf5e.jpg',
          'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/00/002c35dfc480660d5eab429ef9491357b06f7e317539365fadffeb8a186cc3e0.jpg',
          'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/38/3800dcf97c2814ebe961bd8bd30d53dda7ff0d6b1a9f73a7fed929dea1fe92ac.jpg',
          'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/fa/fae4e55b17604528d3f1b14a471b2a72c0856b1bb0e1dc7a324388a9066684a2.jpg',
          'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/cc/cc9af9f4c99383fd159395b5a13289b4b268f548d8f5ccb391c6672af2914410.jpg'
        ]::text[]
      ),
    constraint qoo10_preprovider_reconcile_no_write_check
      check (not provider_mutation_started and not provider_call_replayed)
  );

alter table
  sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations
  enable row level security;
revoke all on table
  sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations
  from public, anon, authenticated, service_role;

do $qoo10_preprovider_evidence_schema$
declare
  v_columns text[];
  v_constraints text[];
  v_table_oid oid :=
    'sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations'::regclass;
begin
  select array_agg(attribute.attname order by attribute.attnum)
    into v_columns
    from pg_catalog.pg_attribute attribute
   where attribute.attrelid = v_table_oid
     and attribute.attnum > 0
     and not attribute.attisdropped;
  if v_columns is distinct from array[
    'job_id','attempt_id','listing_id','product_id','credential_id',
    'source_job_id','source_attempt_id','remote_id','request_fingerprint',
    'request_sha256','qsm_observed_at','item_title','seller_sku',
    'provider_status','remote_visibility','currency','retail_price_jpy',
    'sell_price_jpy','quantity','category_code','origin_type','origin_code',
    'shipping_no','bi_contents_no','ordered_image_urls',
    'ordered_image_digest_sha256','provider_mutation_started',
    'provider_call_replayed','reconciled_at'
  ]::text[] then
    raise exception 'Qoo10 pre-provider evidence column post-image mismatch'
      using errcode = '55000';
  end if;

  select array_agg(constraint_row.conname order by constraint_row.conname)
    into v_constraints
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid = v_table_oid
     and constraint_row.convalidated;
  if v_constraints is distinct from array[
    'qoo10_preprovider_reconcile_attempt_fkey',
    'qoo10_preprovider_reconcile_attempt_key',
    'qoo10_preprovider_reconcile_credential_fkey',
    'qoo10_preprovider_reconcile_exact_target_check',
    'qoo10_preprovider_reconcile_images_check',
    'qoo10_preprovider_reconcile_job_fkey',
    'qoo10_preprovider_reconcile_listing_fkey',
    'qoo10_preprovider_reconcile_listing_key',
    'qoo10_preprovider_reconcile_no_write_check',
    'qoo10_preprovider_reconcile_pkey',
    'qoo10_preprovider_reconcile_product_fkey',
    'qoo10_preprovider_reconcile_qsm_check',
    'qoo10_preprovider_reconcile_request_check',
    'qoo10_preprovider_reconcile_source_attempt_fkey',
    'qoo10_preprovider_reconcile_source_job_fkey'
  ]::text[] then
    raise exception 'Qoo10 pre-provider evidence constraint post-image mismatch'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_class table_class
        where table_class.oid = v_table_oid
          and table_class.relrowsecurity
     )
     or exists (
       select 1
         from aclexplode(coalesce(
           (select table_class.relacl
              from pg_catalog.pg_class table_class
             where table_class.oid = v_table_oid),
           acldefault(
             'r',
             (select table_class.relowner
                from pg_catalog.pg_class table_class
               where table_class.oid = v_table_oid)
           )
         )) acl
        where acl.grantee <>
          (select table_class.relowner
             from pg_catalog.pg_class table_class
            where table_class.oid = v_table_oid)
     ) then
    raise exception 'Qoo10 pre-provider evidence ACL post-image mismatch'
      using errcode = '55000';
  end if;
end;
$qoo10_preprovider_evidence_schema$;

create or replace function
  sellerpilot_private.qoo10_exact_preprovider_gate_audit_detail()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'qoo10_exact_preprovider_gate_denial_reconciliation_v1',
    'job_id', '6795cc6c-57e9-4239-9241-e2942de6a1a1'::uuid,
    'attempt_id', '95ce0ac4-ed20-4d2d-993b-0ef88e111604'::uuid,
    'listing_id', '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid,
    'product_id', 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    'credential_id', '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid,
    'source_job_id', '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid,
    'source_attempt_id', '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid,
    'remote_id', '1217336970',
    'request_sha256',
      '634c0ead954b340d8eb3b16cef70715dd9036a0f61085275a3209670a063ef29',
    'qsm_observed_at', '2026-08-30T20:50:31.105Z',
    'item_title', '貼り付け式ケーブル整理クリップ6個セット',
    'seller_sku', 'QA-20260823-CC-001',
    'locale', 'ja-JP',
    'currency', 'JPY',
    'provider_status', 'S1',
    'remote_visibility', 'non_public',
    'retail_price_jpy', 1871,
    'sell_price_jpy', 1871,
    'quantity', 1,
    'category_code', '320000542',
    'origin_type', '2',
    'origin_code', 'CN',
    'shipping_no', '806971',
    'bi_contents_no', 8461402963,
    'ordered_image_count', 8,
    'ordered_image_digest_sha256',
      'd30953d938a8c966709cd8739c4170462167bb88a2a92bddb0f71e7902035467',
    'previous_job_status', 'reconciliation_required',
    'new_job_status', 'cancelled',
    'previous_attempt_status', 'manual_required',
    'new_attempt_status', 'failed',
    'previous_listing_status', 'failed',
    'new_listing_status', 'paused',
    'previous_failure_class', 'external_action',
    'new_failure_class', 'retryable',
    'provider_mutation_started', false,
    'provider_call_replayed', false,
    'raw_request_preserved', true,
    'raw_response_preserved', true,
    'completion_receipts_preserved', true,
    'evidence_table',
      'sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations'
  )
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_preprovider_gate_audit_detail()
  from public, anon, authenticated, service_role;

create or replace function
  sellerpilot_private.qoo10_exact_preprovider_gate_restore_allowed(
    p_old jsonb,
    p_new jsonb,
    p_job_id text
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fixed_listing_error constant text :=
    'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요';
begin
  if p_job_id is distinct from '6795cc6c-57e9-4239-9241-e2942de6a1a1'
     or jsonb_typeof(p_old) is distinct from 'object'
     or jsonb_typeof(p_new) is distinct from 'object' then
    return false;
  end if;

  perform 1
    from sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations
      evidence
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = evidence.job_id
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = evidence.attempt_id
    join sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
      on confirmation.source_job_id = evidence.source_job_id
     and confirmation.source_attempt_id = evidence.source_attempt_id
     and confirmation.listing_id = evidence.listing_id
     and confirmation.credential_id = evidence.credential_id
     and confirmation.remote_id = evidence.remote_id
    join sellerpilot_private.operation_audit audit
      on audit.action = 'qoo10_exact_preprovider_gate_denial_reconciled'
     and audit.entity_type = 'channel_gateway_job'
     and audit.entity_id = evidence.job_id::text
     and audit.owner_id = (p_old->>'owner_id')::uuid
     and audit.safe_detail is not distinct from
       sellerpilot_private.qoo10_exact_preprovider_gate_audit_detail()
   where evidence.job_id = '6795cc6c-57e9-4239-9241-e2942de6a1a1'::uuid
     and evidence.attempt_id = '95ce0ac4-ed20-4d2d-993b-0ef88e111604'::uuid
     and evidence.listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and evidence.source_attempt_id =
       '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid
     and evidence.remote_id = '1217336970'
     and evidence.request_sha256 =
       '634c0ead954b340d8eb3b16cef70715dd9036a0f61085275a3209670a063ef29'
     and evidence.ordered_image_digest_sha256 =
       'd30953d938a8c966709cd8739c4170462167bb88a2a92bddb0f71e7902035467'
     and not evidence.provider_mutation_started
     and not evidence.provider_call_replayed
     and job.status = 'cancelled'
     and job.response_payload is null
     and job.provider_mutation_started_at is null
     and job.updated_at = evidence.reconciled_at
     and attempt.status = 'failed'
     and attempt.http_status = 409
     and attempt.remote_id is null
     and confirmation.confirmed_at =
       '2026-08-30 14:51:26.505498+00'::timestamptz
     and (
       select count(*)
         from sellerpilot_private.operation_audit exact_audit
        where exact_audit.action =
          'qoo10_exact_preprovider_gate_denial_reconciled'
          and exact_audit.entity_type = 'channel_gateway_job'
          and exact_audit.entity_id = evidence.job_id::text
     ) = 1
     and p_old->>'id' = evidence.listing_id::text
     and p_old->>'product_id' = evidence.product_id::text
     and p_old->>'channel_key' = 'qoo10'
     and p_old->>'operation_attempt_id' = evidence.attempt_id::text
     and p_old->>'status' = 'failed'
     and p_old->>'failure_class' = 'external_action'
     and p_old->>'requested_publication_intent' = 'live'
     and p_old->>'remote_visibility' = 'non_public'
     and p_old->>'provider_status' = 'S1'
     and p_old->>'remote_id' = evidence.remote_id
     and p_old->'published_at' = 'null'::jsonb
     and (p_old->>'last_verified_at')::timestamptz = confirmation.confirmed_at
     and p_old->>'last_error' =
       'Gateway write lease expired; provider outcome requires reconciliation.'
     and (p_old->>'updated_at')::timestamptz =
       '2026-08-30 20:41:03.259905+00'::timestamptz
     and p_new->>'id' = p_old->>'id'
     and p_new->>'product_id' = p_old->>'product_id'
     and p_new->>'owner_id' = p_old->>'owner_id'
     and p_new->>'channel_key' = 'qoo10'
     and p_new->>'operation_attempt_id' = evidence.source_attempt_id::text
     and p_new->>'status' = 'paused'
     and p_new->>'failure_class' = 'retryable'
     and p_new->>'requested_publication_intent' = 'live'
     and p_new->>'remote_visibility' = 'non_public'
     and p_new->>'provider_status' = 'S1'
     and p_new->>'remote_id' = evidence.remote_id
     and p_new->'published_at' = 'null'::jsonb
     and (p_new->>'last_verified_at')::timestamptz = confirmation.confirmed_at
     and p_new->>'last_error' = v_fixed_listing_error
     and (p_new->>'updated_at')::timestamptz = evidence.reconciled_at
     and p_new - 'operation_attempt_id' - 'status' - 'failure_class'
           - 'last_error' - 'updated_at'
       = p_old - 'operation_attempt_id' - 'status' - 'failure_class'
           - 'last_error' - 'updated_at';

  return found;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_preprovider_gate_restore_allowed(
    jsonb, jsonb, text
  ) from public, anon, authenticated, service_role;

-- Insert an exact transaction-local branch before the older exact Qoo10
-- rejection branch. Removing the inserted block must reproduce the byte-exact
-- predecessor definition, which prevents a partial replacement from passing.
do $qoo10_preprovider_guard_patch$
declare
  v_definition text;
  v_predecessor text;
  v_anchor constant text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_origin_rejection_job'', true), '''') is not null then';
  v_patched constant text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_preprovider_gate_job'', true), '''') is not null then
    if not sellerpilot_private.qoo10_exact_preprovider_gate_restore_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.qoo10_exact_preprovider_gate_job'', true)
    ) then
      raise exception ''invalid exact Qoo10 pre-provider gate restore'';
    end if;
    return new;
  end if;

  if nullif(current_setting(''sellerpilot.qoo10_exact_origin_rejection_job'', true), '''') is not null then';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict v_definition;

  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.qoo10_exact_preprovider_gate_job'
     ) = 0 then
    if sellerpilot_private.qoo10_definition_occurrences(
         v_definition, v_anchor
       ) <> 1 then
      raise exception 'Qoo10 pre-provider guard predecessor mismatch'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_anchor, v_patched);
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict v_definition;
  if sellerpilot_private.qoo10_definition_occurrences(
       v_definition, v_patched
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
       v_definition, 'sellerpilot.qoo10_exact_preprovider_gate_job'
     ) <> 2
     or sellerpilot_private.qoo10_definition_occurrences(
       v_definition,
       'sellerpilot_private.qoo10_exact_preprovider_gate_restore_allowed('
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
       v_definition, 'invalid exact Qoo10 pre-provider gate restore'
     ) <> 1 then
    raise exception 'Qoo10 pre-provider guard partial post-image'
      using errcode = '55000';
  end if;
  v_predecessor := pg_catalog.replace(v_definition, v_patched, v_anchor);
  if sellerpilot_private.qoo10_definition_occurrences(
       v_predecessor, v_anchor
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
       v_predecessor, 'sellerpilot.qoo10_exact_preprovider_gate_job'
     ) <> 0 then
    raise exception 'Qoo10 pre-provider guard reconstruction mismatch'
      using errcode = '55000';
  end if;
end;
$qoo10_preprovider_guard_patch$;

do $qoo10_preprovider_catalog_postimage$
declare
  v_table_owner oid;
  v_function_oid oid;
  v_signature text;
begin
  select table_class.relowner
    into strict v_table_owner
    from pg_catalog.pg_class table_class
   where table_class.oid =
    'sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations'::regclass;

  foreach v_signature in array array[
    'sellerpilot_private.qoo10_exact_preprovider_gate_audit_detail()',
    'sellerpilot_private.qoo10_exact_preprovider_gate_restore_allowed(jsonb,jsonb,text)'
  ] loop
    v_function_oid := v_signature::regprocedure::oid;
    if not exists (
         select 1
           from pg_catalog.pg_proc procedure
          where procedure.oid = v_function_oid
            and procedure.proowner = v_table_owner
            and cardinality(procedure.proconfig) = 1
            and procedure.proconfig[1] in ('search_path=', 'search_path=""')
       )
       or exists (
         select 1
           from aclexplode(coalesce(
             (select procedure.proacl
                from pg_catalog.pg_proc procedure
               where procedure.oid = v_function_oid),
             acldefault('f', v_table_owner)
           )) acl
          where acl.grantee <> v_table_owner
       ) then
      raise exception 'Qoo10 pre-provider helper ACL mismatch: %', v_signature
        using errcode = '55000';
    end if;
  end loop;

  if not exists (
       select 1
         from pg_catalog.pg_proc procedure
        where procedure.oid =
          'sellerpilot_private.qoo10_exact_preprovider_gate_audit_detail()'::regprocedure
          and not procedure.prosecdef
     )
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
        where procedure.oid =
          'sellerpilot_private.qoo10_exact_preprovider_gate_restore_allowed(jsonb,jsonb,text)'::regprocedure
          and procedure.prosecdef
     )
     or not exists (
       select 1
         from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid =
          'sellerpilot_private.product_listings'::regclass
          and trigger_row.tgname = 'guard_product_listing_seller_lineage'
          and not trigger_row.tgisinternal
          and trigger_row.tgenabled = 'O'::"char"
          and trigger_row.tgtype = 19
          and trigger_row.tgfoid =
            'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
     ) then
    raise exception 'Qoo10 pre-provider function/trigger post-image mismatch'
      using errcode = '55000';
  end if;
end;
$qoo10_preprovider_catalog_postimage$;

do $qoo10_exact_preprovider_reconcile$
declare
  v_job_id constant uuid :=
    '6795cc6c-57e9-4239-9241-e2942de6a1a1'::uuid;
  v_attempt_id constant uuid :=
    '95ce0ac4-ed20-4d2d-993b-0ef88e111604'::uuid;
  v_listing_id constant uuid :=
    '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_credential_id constant uuid :=
    '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid;
  v_source_job_id constant uuid :=
    '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid;
  v_source_attempt_id constant uuid :=
    '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid;
  v_previous_update_job_id constant uuid :=
    '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'::uuid;
  v_legacy_job_id constant uuid :=
    '2b6258c8-f1fd-4dc2-baed-b0019dd66112'::uuid;
  v_remote_id constant text := '1217336970';
  v_seller_account_key constant text :=
    '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46';
  v_request_fingerprint constant text :=
    'a98ca816896acd825f29fc90f4d94881a4655617175170f79dc23e2a666390f3';
  v_request_sha256 constant text :=
    '634c0ead954b340d8eb3b16cef70715dd9036a0f61085275a3209670a063ef29';
  v_description_sha256 constant text :=
    'ae7be17cfa4a0b6d6233b52e3281e06b6566cdef14612bbc0f27293adb931eec';
  v_image_digest constant text :=
    'd30953d938a8c966709cd8739c4170462167bb88a2a92bddb0f71e7902035467';
  v_source_confirmed_at constant timestamptz :=
    '2026-08-30 14:51:26.505498+00'::timestamptz;
  v_qsm_observed_at constant timestamptz :=
    '2026-08-30 20:50:31.105+00'::timestamptz;
  v_original_error constant text :=
    'Gateway write lease expired; provider outcome requires reconciliation.';
  v_terminal_error constant text :=
    'Qoo10 provider write 시작 전 release-gate 거부를 QSM readback으로 확인하여 작업을 취소했습니다.';
  v_attempt_message constant text :=
    'Qoo10 provider write 시작 전 거부 · QSM S1 비공개 상태 확인 · listing.update 재시도 가능';
  v_listing_error constant text :=
    'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요';
  v_image_urls constant text[] := array[
    'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/e6/e6972e812b95d38ccb08026cc16573660d532012951c54bcbd9aa57807c907c3.jpg',
    'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/64/641856cd5eff810194e0b5c14309e099c0c716f3643b8f68377bfe6baca521b8.jpg',
    'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/04/04f2523967867f7f0c218c635beb34571aec4f97b80cb24adae9d8e5edf994db.jpg',
    'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/7f/7fe0ed3832f3bff882b576c6709e7a201a8b2c18b4905dd8b5bbdc3ce5bbcf5e.jpg',
    'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/00/002c35dfc480660d5eab429ef9491357b06f7e317539365fadffeb8a186cc3e0.jpg',
    'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/38/3800dcf97c2814ebe961bd8bd30d53dda7ff0d6b1a9f73a7fed929dea1fe92ac.jpg',
    'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/fa/fae4e55b17604528d3f1b14a471b2a72c0856b1bb0e1dc7a324388a9066684a2.jpg',
    'https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/cc/cc9af9f4c99383fd159395b5a13289b4b268f548d8f5ccb391c6672af2914410.jpg'
  ]::text[];
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_confirmation
    sellerpilot_private.qoo10_listing_create_rollback_confirmations%rowtype;
  v_source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_product_before jsonb;
  v_receipts_before jsonb;
  v_receipts_after jsonb;
  v_job_after jsonb;
  v_attempt_after jsonb;
  v_listing_after jsonb;
  v_reconciled_at timestamptz;
  v_audit_count bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  -- Fresh/local databases install the private evidence contract but have no
  -- production row to reconcile.
  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = v_job_id
  ) then
    return;
  end if;

  lock table sellerpilot_private.listing_mutation_release_gate
    in share row exclusive mode;
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;
  lock table sellerpilot_private.channel_operation_attempts
    in share row exclusive mode;
  lock table sellerpilot_private.product_listings
    in share row exclusive mode;
  lock table sellerpilot_private.operation_audit
    in share row exclusive mode;
  lock table sellerpilot_private.gateway_completion_receipts
    in share row exclusive mode;
  lock table
    sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations
    in share row exclusive mode;

  select job.* into strict v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_job_id for update;
  select attempt.* into strict v_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_attempt_id for update;
  select listing.* into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_listing_id for update;
  select confirmation.* into strict v_confirmation
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
   where confirmation.source_job_id = v_source_job_id for update;
  select job.* into strict v_source_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_source_job_id for update;
  select attempt.* into strict v_source_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_source_attempt_id for update;
  select credential.* into strict v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_credential_id for update;
  select to_jsonb(product) into strict v_product_before
    from sellerpilot_private.products product
   where product.id = v_product_id for update;

  select coalesce(
           jsonb_agg(to_jsonb(receipt) order by receipt.job_id),
           '[]'::jsonb
         ) into v_receipts_before
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = v_job_id;
  select count(*) into v_audit_count
    from sellerpilot_private.operation_audit audit
   where audit.action = 'qoo10_exact_preprovider_gate_denial_reconciled'
     and audit.entity_type = 'channel_gateway_job'
     and audit.entity_id = v_job_id::text;

  -- A successful replay is a no-op. A later legitimate listing attempt is not
  -- rewound; every other mixed/partial terminal state fails closed.
  if v_job.status = 'cancelled'
     or v_attempt.status = 'failed'
     or exists (
       select 1
         from sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations
           evidence
        where evidence.job_id = v_job_id
     )
     or v_audit_count > 0 then
    if v_job.status is distinct from 'cancelled'
       or v_job.error_message is distinct from v_terminal_error
       or v_job.attempt_id is distinct from v_attempt_id
       or v_job.listing_id is distinct from v_listing_id
       or v_job.credential_id is distinct from v_credential_id
       or v_job.channel is distinct from 'qoo10'
       or v_job.operation is distinct from 'listing.update'
       or v_job.environment is distinct from 'production'
       or v_job.request_fingerprint is distinct from v_request_fingerprint
       or v_job.seller_account_key is distinct from v_seller_account_key
       or encode(
         extensions.digest(v_job.request_payload::text, 'sha256'), 'hex'
       ) is distinct from v_request_sha256
       or v_job.response_payload is not null
       or v_job.provider_mutation_started_at is not null
       or v_job.completed_at is distinct from
         '2026-08-30 20:41:03.259905+00'::timestamptz
       or v_job.worker_token_id is not null
       or v_job.claim_token is not null
       or v_job.lease_expires_at is not null
       or v_receipts_before is distinct from '[]'::jsonb
       or v_attempt.status is distinct from 'failed'
       or v_attempt.http_status is distinct from 409
       or v_attempt.remote_id is not null
       or v_attempt.safe_message is distinct from v_attempt_message
       or v_attempt.request_fingerprint is distinct from v_request_fingerprint
       or v_attempt.seller_account_key is distinct from v_seller_account_key
       or v_audit_count <> 1
       or not exists (
         select 1
           from sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations
             evidence
          where evidence.job_id = v_job_id
            and evidence.attempt_id = v_attempt_id
            and evidence.listing_id = v_listing_id
            and evidence.source_attempt_id = v_source_attempt_id
            and evidence.ordered_image_urls = v_image_urls
            and evidence.ordered_image_digest_sha256 = v_image_digest
            and not evidence.provider_mutation_started
            and not evidence.provider_call_replayed
       )
       or not exists (
         select 1
           from sellerpilot_private.operation_audit audit
          where audit.action =
            'qoo10_exact_preprovider_gate_denial_reconciled'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_job_id::text
            and audit.owner_id = v_listing.owner_id
            and audit.safe_detail is not distinct from
              sellerpilot_private.qoo10_exact_preprovider_gate_audit_detail()
       )
       or not (
         (
           v_listing.operation_attempt_id = v_source_attempt_id
           and v_listing.status = 'paused'
           and v_listing.failure_class = 'retryable'
           and v_listing.remote_visibility = 'non_public'
           and v_listing.provider_status = 'S1'
           and v_listing.last_verified_at = v_source_confirmed_at
           and v_listing.last_error = v_listing_error
         )
         or exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs later_job
            where later_job.id <> v_job_id
              and later_job.listing_id = v_listing_id
              and later_job.attempt_id = v_listing.operation_attempt_id
              and later_job.operation in (
                'listing.create','listing.update','listing.stop'
              )
              and later_job.created_at > v_job.created_at
         )
       ) then
      raise exception 'partial exact Qoo10 pre-provider reconciliation state'
        using errcode = '55000';
    end if;
    return;
  end if;

  if not exists (
       select 1
         from sellerpilot_private.listing_mutation_release_gate gate
        where gate.singleton
          and not gate.is_open
          and gate.opened_at is null
          and gate.opened_release_sha is null
          and gate.opened_channel is null
     ) then
    raise exception 'exact Qoo10 pre-provider reconciliation requires closed gate'
      using errcode = '55000';
  end if;

  if encode(
       extensions.digest(array_to_string(v_image_urls, E'\n'), 'sha256'),
       'hex'
     ) is distinct from v_image_digest then
    raise exception 'exact QSM ordered-image digest mismatch'
      using errcode = '55000';
  end if;

  if v_receipts_before is distinct from '[]'::jsonb
     or v_job.attempt_id is distinct from v_attempt_id
     or v_job.listing_id is distinct from v_listing_id
     or v_job.credential_id is distinct from v_credential_id
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.update'
     or v_job.environment is distinct from 'production'
     or v_job.request_fingerprint is distinct from v_request_fingerprint
     or v_job.seller_account_key is distinct from v_seller_account_key
     or v_job.status is distinct from 'reconciliation_required'
     or v_job.error_message is distinct from v_original_error
     or v_job.response_payload is not null
     or v_job.provider_mutation_started_at is not null
     or v_job.created_at is distinct from
       '2026-08-30 20:23:21.41397+00'::timestamptz
     or v_job.started_at is distinct from
       '2026-08-30 20:25:05.865099+00'::timestamptz
     or v_job.completed_at is distinct from
       '2026-08-30 20:41:03.259905+00'::timestamptz
     or v_job.updated_at is distinct from
       '2026-08-30 20:41:03.259905+00'::timestamptz
     or v_job.attempt_count is distinct from 1
     or v_job.worker_token_id is not null
     or v_job.claim_token is not null
     or v_job.lease_expires_at is not null
     or v_job.credential_refresh_in_flight
     or v_job.credential_refresh_fingerprint is not null
     or v_job.prepared_credential_id is not null
     or v_job.credential_refresh_prepared_at is not null
     or v_job.credential_refresh_recovery_vault_id is not null
     or v_job.credential_refresh_recovery_fingerprint is not null
     or v_job.credential_refresh_recovery_staged_at is not null
     or v_job.credential_refresh_started_at is not null
     or v_job.oauth_request_vault_id is not null
     or v_job.oauth_request_fingerprint is not null
     or v_job.oauth_source_credential_id is not null
     or v_job.oauth_exchange_completed
     or v_job.oauth_provider_call_started_at is not null
     or encode(
       extensions.digest(v_job.request_payload::text, 'sha256'), 'hex'
     ) is distinct from v_request_sha256 then
    raise exception 'exact Qoo10 pre-provider job evidence mismatch'
      using errcode = '55000';
  end if;

  if v_job.request_payload#>>'{arguments,params,ItemCode}' is distinct from v_remote_id
     or v_job.request_payload#>>'{arguments,params,ItemTitle}' is distinct from
       '貼り付け式ケーブル整理クリップ6個セット'
     or (
       select array_agg(param_key order by param_key)
         from jsonb_object_keys(
           v_job.request_payload#>'{arguments,params}'
         ) as param_key
     ) is distinct from array[
       'AvailableDateType', 'AvailableDateValue', 'ItemCode',
       'ItemDescription', 'ItemTitle', 'Keyword', 'ProductionPlace',
       'ProductionPlaceType', 'PromotionName', 'RetailPrice',
       'SecondSubCat', 'ShippingNo'
     ]::text[]
     or v_job.request_payload#>>'{arguments,params,SecondSubCat}' is distinct from
       '320000542'
     or v_job.request_payload#>>'{arguments,params,RetailPrice}' is distinct from '1871'
     or v_job.request_payload#>>'{arguments,params,ShippingNo}' is distinct from '806971'
     or v_job.request_payload#>>'{arguments,params,ProductionPlaceType}' is distinct from '2'
     or v_job.request_payload#>>'{arguments,params,ProductionPlace}' is distinct from 'CN'
     or v_job.request_payload#>>'{arguments,params,PromotionName}' is distinct from
       '販売者が確認した入力だけに基づく商品案内'
     or v_job.request_payload#>>'{arguments,params,Keyword}' is distinct from
       'buchakhyeong keibeul jeongri keulrip 6gae seteu,No Brand,購入前確認'
     or v_job.request_payload#>>'{arguments,params,AvailableDateType}' is distinct from '0'
     or v_job.request_payload#>>'{arguments,params,AvailableDateValue}' is distinct from '3'
     or octet_length(
       v_job.request_payload#>>'{arguments,params,ItemDescription}'
     ) is distinct from 13413
     or encode(
       extensions.digest(
         v_job.request_payload#>>'{arguments,params,ItemDescription}',
         'sha256'
       ),
       'hex'
     ) is distinct from v_description_sha256
     or v_job.request_payload#>>'{arguments,publicationExpectedLocale}' is distinct from
       'ja-JP'
     or v_job.request_payload#>>'{arguments,publicationExpectedImageCount}' is distinct from
       '8'
     or v_job.request_payload#>>'{arguments,publicationExpectedFingerprint}' is distinct from
       v_request_fingerprint
     or v_job.request_payload#>>'{arguments,publicationIntent}' is distinct from 'live'
     or v_job.request_payload#>>'{arguments,publicationStateContract}' is distinct from
       'verified_remote_state_v1'
     or v_job.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,contract}' is distinct from
       'sellerpilot_publication_asset_binding_v1'
     or v_job.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}' is distinct from
       '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62'
     or v_job.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailPageVersion}' is distinct from
       '1'
     or jsonb_typeof(
       v_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailImages}'
     ) is distinct from 'array'
     or jsonb_array_length(
       coalesce(
         v_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailImages}',
         '[]'::jsonb
       )
     ) is distinct from 8
     or (
       select array_agg(image.value->>'publicUrl' order by image.ordinality)
         from jsonb_array_elements(
           coalesce(
             v_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailImages}',
             '[]'::jsonb
           )
         ) with ordinality as image(value, ordinality)
     ) is distinct from v_image_urls
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,sourceJobId}' is distinct from
       v_source_job_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,listingId}' is distinct from
       v_listing_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,remoteId}' is distinct from
       v_remote_id
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,status}' is distinct from
       'allowed'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,contract}' is distinct from
       'qoo10_create_rollback_confirmation_v1'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,providerStatus}' is distinct from
       'S1'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,categoryCode}' is distinct from
       '320000542'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,retailPriceJpy}' is distinct from
       '1871'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,sellPriceJpy}' is distinct from
       '1871'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,quantity}' is distinct from
       '1'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,shippingNo}' is distinct from
       '806971'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,biContentsNo}' is distinct from
       '8461402963' then
    raise exception 'exact Qoo10 pre-provider request semantic mismatch'
      using errcode = '55000';
  end if;

  if v_attempt.owner_id is distinct from v_listing.owner_id
     or v_attempt.credential_id is distinct from v_credential_id
     or v_attempt.channel is distinct from 'qoo10'
     or v_attempt.operation is distinct from 'listing.update'
     or v_attempt.status is distinct from 'manual_required'
     or v_attempt.http_status is distinct from 409
     or v_attempt.remote_id is not null
     or v_attempt.safe_message is distinct from v_original_error
     or not v_attempt.gateway_write_required
     or v_attempt.pre_gateway_retryable
     or v_attempt.request_fingerprint is distinct from v_request_fingerprint
     or v_attempt.seller_account_key is distinct from v_seller_account_key
     or v_attempt.started_at is distinct from
       '2026-08-30 20:23:03.667881+00'::timestamptz
     or v_attempt.completed_at is distinct from
       '2026-08-30 20:41:03.259905+00'::timestamptz
     or v_listing.owner_id is distinct from v_attempt.owner_id
     or v_listing.product_id is distinct from v_product_id
     or v_listing.channel_key is distinct from 'qoo10'
     or v_listing.market is distinct from 'JP'
     or v_listing.target_id is distinct from ''
     or v_listing.currency is distinct from 'JPY'
     or v_listing.marketplace_sku is not null
     or v_listing.remote_id is distinct from v_remote_id
     or v_listing.operation_attempt_id is distinct from v_attempt_id
     or v_listing.status is distinct from 'failed'
     or v_listing.failure_class is distinct from 'external_action'
     or v_listing.requested_publication_intent is distinct from 'live'
     or v_listing.remote_visibility is distinct from 'non_public'
     or v_listing.provider_status is distinct from 'S1'
     or v_listing.seller_account_key is distinct from v_seller_account_key
     or v_listing.published_at is not null
     or v_listing.last_verified_at is distinct from v_source_confirmed_at
     or v_listing.last_error is distinct from v_original_error
     or v_listing.price is distinct from 1871
     or v_listing.updated_at is distinct from
       '2026-08-30 20:41:03.259905+00'::timestamptz
     or v_audit_count <> 0
     or exists (
       select 1
         from sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations
           evidence
        where evidence.job_id = v_job_id
           or evidence.attempt_id = v_attempt_id
           or evidence.listing_id = v_listing_id
     ) then
    raise exception 'exact Qoo10 pre-provider unresolved state mismatch'
      using errcode = '55000';
  end if;

  if v_confirmation.source_attempt_id is distinct from v_source_attempt_id
     or v_confirmation.listing_id is distinct from v_listing_id
     or v_confirmation.credential_id is distinct from v_credential_id
     or v_confirmation.request_fingerprint is distinct from
       '66759b5ea49910ae5b97d5f8311fce73f4f36f9ed37148692407e037563f1527'
     or v_confirmation.credential_fingerprint is distinct from '910B8E8633C1'
     or v_confirmation.seller_account_key is distinct from v_seller_account_key
     or v_confirmation.remote_id is distinct from v_remote_id
     or v_confirmation.bi_contents_no is distinct from 8461402963
     or v_confirmation.category_code is distinct from '320000542'
     or v_confirmation.retail_price_jpy is distinct from 1871
     or v_confirmation.sell_price_jpy is distinct from 1871
     or v_confirmation.quantity is distinct from 1
     or v_confirmation.shipping_no is distinct from '0'
     or v_confirmation.observed_provider_status is distinct from 'S1'
     or v_confirmation.new_listing_status is distinct from 'paused'
     or v_confirmation.new_failure_class is distinct from 'retryable'
     or v_confirmation.new_remote_visibility is distinct from 'non_public'
     or v_confirmation.new_provider_status is distinct from 'S1'
     or v_confirmation.requested_publication_intent is distinct from 'live'
     or v_confirmation.confirmed_at is distinct from v_source_confirmed_at
     or v_source_job.attempt_id is distinct from v_source_attempt_id
     or v_source_job.listing_id is distinct from v_listing_id
     or v_source_job.credential_id is distinct from v_credential_id
     or v_source_job.channel is distinct from 'qoo10'
     or v_source_job.operation is distinct from 'listing.create'
     or v_source_job.environment is distinct from 'production'
     or v_source_job.status is distinct from 'failed'
     or v_source_job.request_fingerprint is distinct from
       '66759b5ea49910ae5b97d5f8311fce73f4f36f9ed37148692407e037563f1527'
     or v_source_job.seller_account_key is distinct from v_seller_account_key
     or v_source_attempt.credential_id is distinct from v_credential_id
     or v_source_attempt.channel is distinct from 'qoo10'
     or v_source_attempt.operation is distinct from 'listing.create'
     or v_source_attempt.status is distinct from 'failed'
     or v_source_attempt.http_status is distinct from 409
     or v_source_attempt.remote_id is distinct from v_remote_id
     or not v_source_attempt.gateway_write_required
     or v_source_attempt.pre_gateway_retryable
     or v_source_attempt.request_fingerprint is distinct from
       '66759b5ea49910ae5b97d5f8311fce73f4f36f9ed37148692407e037563f1527'
     or v_source_attempt.seller_account_key is distinct from v_seller_account_key
     or v_source_attempt.completed_at is distinct from v_source_confirmed_at
     or v_credential.channel is distinct from 'qoo10'
     or v_credential.environment is distinct from 'production'
     or v_credential.status is distinct from 'active'
     or v_credential.expires_at is distinct from
       '2027-08-20 14:59:59+00'::timestamptz
     or v_credential.seller_account_key is distinct from v_seller_account_key
     or v_credential.fingerprint is distinct from '910B8E8633C1'
     or v_credential.seller_account_key_source is distinct from
       'credential_incarnation_v1'
     or v_credential.seller_account_verified_at is distinct from
       '2026-08-25 11:40:32.606508+00'::timestamptz then
    raise exception 'exact Qoo10 pre-provider source lineage mismatch'
      using errcode = '55000';
  end if;

  if (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs listing_job
        where listing_job.listing_id = v_listing_id
          and listing_job.operation in (
            'listing.create','listing.update','listing.stop'
          )
     ) <> 4
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs listing_job
        where listing_job.listing_id = v_listing_id
          and listing_job.operation in (
            'listing.create','listing.update','listing.stop'
          )
          and listing_job.id not in (
            v_legacy_job_id, v_source_job_id,
            v_previous_update_job_id, v_job_id
          )
     )
     or not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs old_job
        where old_job.id = v_legacy_job_id
          and old_job.operation = 'listing.create'
          and old_job.status = 'failed'
          and old_job.created_at =
            '2026-08-30 11:23:25.017463+00'::timestamptz
     )
     or not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs old_job
        where old_job.id = v_source_job_id
          and old_job.operation = 'listing.create'
          and old_job.status = 'failed'
          and old_job.created_at =
            '2026-08-30 12:56:53.380373+00'::timestamptz
     )
     or not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs old_job
        where old_job.id = v_previous_update_job_id
          and old_job.attempt_id =
            'dc9a6e45-e333-4a15-b432-c14a03734f9c'::uuid
          and old_job.listing_id = v_listing_id
          and old_job.credential_id = v_credential_id
          and old_job.channel = 'qoo10'
          and old_job.operation = 'listing.update'
          and old_job.environment = 'production'
          and old_job.status = 'succeeded'
          and old_job.request_fingerprint =
            'a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff'
          and old_job.seller_account_key = v_seller_account_key
          and old_job.created_at =
            '2026-08-30 14:59:56.436937+00'::timestamptz
     )
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs later_job
        where later_job.listing_id = v_listing_id
          and later_job.operation in (
            'listing.create','listing.update','listing.stop'
          )
          and later_job.created_at > v_job.created_at
     ) then
    raise exception 'exact Qoo10 listing mutation ledger mismatch'
      using errcode = '55000';
  end if;

  if (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.operation in (
          'listing.create','listing.update','listing.stop'
        )
          and active_job.status in (
            'queued','running','reconciliation_required'
          )
     ) <> 1
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.operation in (
          'listing.create','listing.update','listing.stop'
        )
          and active_job.status in (
            'queued','running','reconciliation_required'
          )
          and active_job.id <> v_job_id
     ) then
    raise exception 'exact Qoo10 active listing mutation set mismatch'
      using errcode = '55000';
  end if;

  v_reconciled_at := clock_timestamp();

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         error_message = v_terminal_error,
         updated_at = v_reconciled_at
   where job.id = v_job_id
     and to_jsonb(job) is not distinct from to_jsonb(v_job);
  if not found then
    raise exception 'exact Qoo10 job compare-and-set lost its fence'
      using errcode = '40001';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'failed',
         safe_message = v_attempt_message
   where attempt.id = v_attempt_id
     and to_jsonb(attempt) is not distinct from to_jsonb(v_attempt);
  if not found then
    raise exception 'exact Qoo10 attempt compare-and-set lost its fence'
      using errcode = '40001';
  end if;

  insert into
    sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations (
      job_id, attempt_id, listing_id, product_id, credential_id,
      source_job_id, source_attempt_id, remote_id, request_fingerprint,
      request_sha256, qsm_observed_at, item_title, seller_sku,
      provider_status, remote_visibility, currency, retail_price_jpy,
      sell_price_jpy, quantity, category_code, origin_type, origin_code,
      shipping_no, bi_contents_no, ordered_image_urls,
      ordered_image_digest_sha256, provider_mutation_started,
      provider_call_replayed, reconciled_at
    ) values (
      v_job_id, v_attempt_id, v_listing_id, v_product_id, v_credential_id,
      v_source_job_id, v_source_attempt_id, v_remote_id,
      v_request_fingerprint, v_request_sha256, v_qsm_observed_at,
      '貼り付け式ケーブル整理クリップ6個セット', 'QA-20260823-CC-001',
      'S1', 'non_public', 'JPY', 1871, 1871, 1, '320000542',
      '2', 'CN', '806971', 8461402963, v_image_urls, v_image_digest,
      false, false, v_reconciled_at
    );

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id,
    'qoo10_exact_preprovider_gate_denial_reconciled',
    'channel_gateway_job',
    v_job_id::text,
    sellerpilot_private.qoo10_exact_preprovider_gate_audit_detail()
  );

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_exact_preprovider_gate_job',
    v_job_id::text,
    true
  );
  update sellerpilot_private.product_listings listing
     set operation_attempt_id = v_source_attempt_id,
         status = 'paused',
         failure_class = 'retryable',
         last_error = v_listing_error,
         updated_at = v_reconciled_at
   where listing.id = v_listing_id
     and to_jsonb(listing) is not distinct from to_jsonb(v_listing);
  if not found then
    raise exception 'exact Qoo10 listing compare-and-set lost its fence'
      using errcode = '40001';
  end if;

  select to_jsonb(job) into strict v_job_after
    from sellerpilot_private.channel_gateway_jobs job where job.id = v_job_id;
  select to_jsonb(attempt) into strict v_attempt_after
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_attempt_id;
  select to_jsonb(listing) into strict v_listing_after
    from sellerpilot_private.product_listings listing
   where listing.id = v_listing_id;
  select coalesce(
           jsonb_agg(to_jsonb(receipt) order by receipt.job_id),
           '[]'::jsonb
         ) into v_receipts_after
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = v_job_id;

  if v_receipts_after is distinct from v_receipts_before
     or v_job_after - 'status' - 'error_message' - 'updated_at'
          is distinct from
        to_jsonb(v_job) - 'status' - 'error_message' - 'updated_at'
     or v_job_after->>'status' is distinct from 'cancelled'
     or v_job_after->>'error_message' is distinct from v_terminal_error
     or (v_job_after->>'updated_at')::timestamptz is distinct from v_reconciled_at
     or v_attempt_after - 'status' - 'safe_message'
          is distinct from to_jsonb(v_attempt) - 'status' - 'safe_message'
     or v_attempt_after->>'status' is distinct from 'failed'
     or v_attempt_after->>'safe_message' is distinct from v_attempt_message
     or v_listing_after - 'operation_attempt_id' - 'status'
          - 'failure_class' - 'last_error' - 'updated_at'
          is distinct from
        to_jsonb(v_listing) - 'operation_attempt_id' - 'status'
          - 'failure_class' - 'last_error' - 'updated_at'
     or v_listing_after->>'operation_attempt_id' is distinct from v_source_attempt_id::text
     or v_listing_after->>'status' is distinct from 'paused'
     or v_listing_after->>'failure_class' is distinct from 'retryable'
     or v_listing_after->>'last_error' is distinct from v_listing_error
     or (v_listing_after->>'updated_at')::timestamptz is distinct from v_reconciled_at
     or (select to_jsonb(product)
           from sellerpilot_private.products product
          where product.id = v_product_id) is distinct from v_product_before
     or (select count(*)
           from sellerpilot_private.operation_audit audit
          where audit.action =
            'qoo10_exact_preprovider_gate_denial_reconciled'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_job_id::text
            and audit.owner_id = v_listing.owner_id
            and audit.safe_detail is not distinct from
              sellerpilot_private.qoo10_exact_preprovider_gate_audit_detail()
        ) <> 1
     or (select count(*)
           from sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations
             evidence
          where evidence.job_id = v_job_id
            and evidence.attempt_id = v_attempt_id
            and evidence.listing_id = v_listing_id
            and evidence.ordered_image_urls = v_image_urls
            and evidence.ordered_image_digest_sha256 = v_image_digest
            and evidence.reconciled_at = v_reconciled_at
            and not evidence.provider_mutation_started
            and not evidence.provider_call_replayed
        ) <> 1 then
    raise exception 'exact Qoo10 pre-provider preservation postcondition failed'
      using errcode = '55000';
  end if;
end;
$qoo10_exact_preprovider_reconcile$;

commit;
