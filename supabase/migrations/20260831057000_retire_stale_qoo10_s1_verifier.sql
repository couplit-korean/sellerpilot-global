-- Retire the one immutable, read-only Qoo10 S1 verifier whose provider GET
-- completed but whose terminal classification predated the exact heading
-- normalization contract.  This migration never retries that job and never
-- calls a provider.  It preserves the completed response and receipt, marks
-- only the stale queue row failed, and enqueues one fresh read-only verifier
-- under the currently attested serverless release.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

lock table sellerpilot_private.channel_gateway_jobs,
  sellerpilot_private.channel_operation_attempts,
  sellerpilot_private.gateway_completion_receipts,
  sellerpilot_private.qoo10_exact_s1_verifier_runs,
  sellerpilot_private.qoo10_exact_s1_observations,
  sellerpilot_private.qoo10_exact_s1_activation_permits,
  sellerpilot_private.qoo10_exact_s1_activation_outcomes,
  sellerpilot_private.listing_publication_reviews,
  sellerpilot_private.product_listings,
  sellerpilot_private.products,
  sellerpilot_private.channel_credentials,
  sellerpilot_private.operation_audit
in share row exclusive mode;

do $retire_stale_qoo10_s1_verifier$
declare
  c_source_job_id constant uuid :=
    'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid;
  c_old_verifier_job_id constant uuid :=
    'ea191079-3016-4851-9f0c-4ce4281c1364'::uuid;
  c_source_attempt_id constant uuid :=
    '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid;
  c_listing_id constant uuid :=
    '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid;
  c_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  c_credential_id constant uuid :=
    '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid;
  c_owner_id constant uuid :=
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid;
  c_old_release_sha constant text :=
    'eaee02055c8a65db7b5cd20481fe87946fd3fd5c';
  c_seller_account_key constant text :=
    '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46';
  c_request_fingerprint constant text :=
    '76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799';
  c_old_request_sha constant text :=
    '2cc89af533c1620ed011ef0627d460bac55187d2647d3542602e0ef488b1ba43';
  c_old_response_sha constant text :=
    'c3891de7dfafed37bc3c027d25468ea1e778b69173db56e8a7a4ed10264f4624';

  v_history_table regclass;
  v_source_count bigint;
  v_old_job_count bigint;
  v_source_attempt_count bigint;
  v_receipt_count bigint;
  v_run_count bigint;
  v_evidence_count bigint;
  v_review_count bigint;
  v_listing_count bigint;
  v_product_count bigint;
  v_credential_count bigint;
  v_prior_audit_count bigint;
  v_schema_column_count bigint;
  v_function_count bigint;
  v_heading_function_count bigint;
  v_release_sha text;
  v_attested_release_sha text;
  v_runtime_release_sha text;
  v_old_job_before jsonb;
  v_old_job_after jsonb;
  v_source_before jsonb;
  v_source_after jsonb;
  v_receipt_before jsonb;
  v_receipt_after jsonb;
  v_run_before jsonb;
  v_run_after jsonb;
  v_listing_before jsonb;
  v_listing_after jsonb;
  v_product_before jsonb;
  v_product_after jsonb;
  v_credential_before jsonb;
  v_credential_after jsonb;
  v_gateway_unrelated_count bigint;
  v_gateway_unrelated_count_after bigint;
  v_gateway_unrelated_fingerprint text;
  v_gateway_unrelated_fingerprint_after text;
  v_run_unrelated_count bigint;
  v_run_unrelated_count_after bigint;
  v_run_unrelated_fingerprint text;
  v_run_unrelated_fingerprint_after text;
  v_gateway_total_before bigint;
  v_run_total_before bigint;
  v_enqueue_result jsonb;
  v_new_verifier_job_id uuid;
  v_started_at timestamptz := clock_timestamp();
begin
  -- A hosted target must expose the exact predecessor history.  A schema-only
  -- deterministic replay may omit the Supabase history schema, but only while
  -- every production data anchor below is absent.
  v_history_table := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
  if v_history_table is not null then
    execute 'lock table supabase_migrations.schema_migrations in share mode';
    if (
      select pg_catalog.count(*)
        from supabase_migrations.schema_migrations migration
       where (
         migration.version = '20260831056700'
         and migration.name = 'recover_exact_qoo10_s1_activation'
         and pg_catalog.cardinality(migration.statements) = 0
       ) or (
         migration.version = '20260831056800'
         and migration.name = 'allow_exact_qoo10_s1_verifier_overlap'
         and pg_catalog.cardinality(migration.statements) = 0
       ) or (
         migration.version = '20260831056900'
         and migration.name = 'accept_exact_qoo10_heading_normalization'
         and pg_catalog.cardinality(migration.statements) = 0
       )
    ) <> 3
       or exists (
         select 1
           from supabase_migrations.schema_migrations migration
          where migration.version in (
            '20260831056700','20260831056800','20260831056900'
          )
            and not (
              (migration.version = '20260831056700'
               and migration.name = 'recover_exact_qoo10_s1_activation'
               and pg_catalog.cardinality(migration.statements) = 0)
              or (migration.version = '20260831056800'
               and migration.name = 'allow_exact_qoo10_s1_verifier_overlap'
               and pg_catalog.cardinality(migration.statements) = 0)
              or (migration.version = '20260831056900'
               and migration.name = 'accept_exact_qoo10_heading_normalization'
               and pg_catalog.cardinality(migration.statements) = 0)
            )
       )
       or exists (
         select 1
           from supabase_migrations.schema_migrations migration
          where migration.version = '20260831057000'
       )
    then
      raise exception 'exact Qoo10 verifier retirement migration history drifted'
        using errcode = '55000';
    end if;
  end if;

  -- Pin the exact table columns used by the retirement.  Extra unrelated
  -- columns are harmless; every safety-relevant column must retain its type
  -- and nullability.
  select pg_catalog.count(*)
    into v_schema_column_count
    from (
      values
        ('channel_gateway_jobs','id','uuid',true),
        ('channel_gateway_jobs','credential_id','uuid',true),
        ('channel_gateway_jobs','attempt_id','uuid',false),
        ('channel_gateway_jobs','listing_id','uuid',false),
        ('channel_gateway_jobs','channel','text',true),
        ('channel_gateway_jobs','operation','text',true),
        ('channel_gateway_jobs','environment','text',true),
        ('channel_gateway_jobs','request_payload','jsonb',true),
        ('channel_gateway_jobs','response_payload','jsonb',false),
        ('channel_gateway_jobs','status','text',true),
        ('channel_gateway_jobs','error_message','text',false),
        ('channel_gateway_jobs','worker_token_id','uuid',false),
        ('channel_gateway_jobs','attempt_count','integer',true),
        ('channel_gateway_jobs','lease_expires_at','timestamp with time zone',false),
        ('channel_gateway_jobs','claim_token','uuid',false),
        ('channel_gateway_jobs','provider_mutation_started_at','timestamp with time zone',false),
        ('channel_gateway_jobs','oauth_provider_call_started_at','timestamp with time zone',false),
        ('channel_gateway_jobs','write_resource_kind','text',false),
        ('channel_gateway_jobs','write_resource_key','text',false),
        ('channel_gateway_jobs','request_fingerprint','text',false),
        ('channel_gateway_jobs','inventory_item_id','uuid',false),
        ('channel_gateway_jobs','order_id','uuid',false),
        ('channel_gateway_jobs','shipment_carrier','text',false),
        ('channel_gateway_jobs','shipment_tracking','text',false),
        ('channel_gateway_jobs','seller_account_key','text',false),
        ('channel_gateway_jobs','credential_refresh_fingerprint','text',false),
        ('channel_gateway_jobs','prepared_credential_id','uuid',false),
        ('channel_gateway_jobs','credential_refresh_prepared_at','timestamp with time zone',false),
        ('channel_gateway_jobs','credential_refresh_recovery_vault_id','uuid',false),
        ('channel_gateway_jobs','credential_refresh_recovery_fingerprint','text',false),
        ('channel_gateway_jobs','credential_refresh_recovery_staged_at','timestamp with time zone',false),
        ('channel_gateway_jobs','credential_refresh_in_flight','boolean',true),
        ('channel_gateway_jobs','credential_refresh_started_at','timestamp with time zone',false),
        ('channel_gateway_jobs','oauth_request_vault_id','uuid',false),
        ('channel_gateway_jobs','oauth_request_fingerprint','text',false),
        ('channel_gateway_jobs','oauth_source_credential_id','uuid',false),
        ('channel_gateway_jobs','oauth_exchange_completed','boolean',true),
        ('channel_gateway_jobs','created_at','timestamp with time zone',true),
        ('channel_gateway_jobs','started_at','timestamp with time zone',false),
        ('channel_gateway_jobs','completed_at','timestamp with time zone',false),
        ('channel_gateway_jobs','updated_at','timestamp with time zone',true),
        ('gateway_completion_receipts','job_id','uuid',true),
        ('gateway_completion_receipts','claim_token','uuid',true),
        ('gateway_completion_receipts','worker_token_id','uuid',true),
        ('gateway_completion_receipts','completion_fingerprint','text',true),
        ('gateway_completion_receipts','continuation_job_id','uuid',false),
        ('gateway_completion_receipts','created_at','timestamp with time zone',true),
        ('qoo10_exact_s1_verifier_runs','verifier_job_id','uuid',true),
        ('qoo10_exact_s1_verifier_runs','source_job_id','uuid',true),
        ('qoo10_exact_s1_verifier_runs','source_attempt_id','uuid',true),
        ('qoo10_exact_s1_verifier_runs','listing_id','uuid',true),
        ('qoo10_exact_s1_verifier_runs','product_id','uuid',true),
        ('qoo10_exact_s1_verifier_runs','credential_id','uuid',true),
        ('qoo10_exact_s1_verifier_runs','owner_id','uuid',true),
        ('qoo10_exact_s1_verifier_runs','remote_id','text',true),
        ('qoo10_exact_s1_verifier_runs','seller_account_key','text',true),
        ('qoo10_exact_s1_verifier_runs','source_request_sha256','text',true),
        ('qoo10_exact_s1_verifier_runs','source_request_bytes','integer',true),
        ('qoo10_exact_s1_verifier_runs','source_response_sha256','text',true),
        ('qoo10_exact_s1_verifier_runs','source_response_bytes','integer',true),
        ('qoo10_exact_s1_verifier_runs','release_sha','text',true),
        ('qoo10_exact_s1_verifier_runs','contract','text',true),
        ('qoo10_exact_s1_verifier_runs','queued_at','timestamp with time zone',true)
    ) expected(table_name,column_name,type_name,not_null)
    join pg_catalog.pg_namespace namespace
      on namespace.nspname = 'sellerpilot_private'
    join pg_catalog.pg_class relation
      on relation.relnamespace = namespace.oid
     and relation.relname = expected.table_name
     and relation.relkind = 'r'
     and relation.relrowsecurity
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = relation.oid
     and attribute.attname = expected.column_name
     and attribute.attnum > 0
     and not attribute.attisdropped
   where pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) =
           expected.type_name
     and attribute.attnotnull = expected.not_null;
  if v_schema_column_count <> 63 then
    raise exception 'exact Qoo10 verifier retirement table schema drifted'
      using errcode = '55000';
  end if;

  -- Pin the RPCs that own the release gate, exact source, and enqueue, plus
  -- the overlap discriminator installed by 568.
  select pg_catalog.count(*)
    into v_function_count
    from (
      values
        ('public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(uuid,text)',
         '5f72b59b4ac2dfb4601472f218d4d428',true,'v','plpgsql',false,
         '{postgres=X/postgres,service_role=X/postgres}'),
        ('sellerpilot_private.qoo10_exact_s1_source_is_current()',
         'e40ea1650b293ac91f032518d2c450a4',true,'s','sql',false,
         '{postgres=X/postgres}'),
        ('sellerpilot_private.qoo10_exact_s1_release_is_current(text)',
         '12ba250d3fff1c780c50bfbd450a4f90',true,'s','sql',false,
         '{postgres=X/postgres}'),
        ('sellerpilot_private.qoo10_exact_s1_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)',
         'b8c5fcf13d0ad928e5f316c5821b6834',false,'i','sql',true,
         '{postgres=X/postgres}'),
        ('sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()',
         '81d0b342d24a6cadad217c0224933e64',true,'v','plpgsql',false,
         '{postgres=X/postgres}')
    ) expected(
      signature,definition_md5,security_definer,volatility,language,is_strict,acl
    )
    join pg_catalog.pg_proc procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    join pg_catalog.pg_roles owner on owner.oid = procedure.proowner
    join pg_catalog.pg_language language on language.oid = procedure.prolang
   where owner.rolname = 'postgres'
     and language.lanname = expected.language
     and pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid)) =
           expected.definition_md5
     and procedure.prosecdef = expected.security_definer
     and procedure.provolatile::text = expected.volatility
     and procedure.proisstrict = expected.is_strict
     and procedure.proconfig = array['search_path=""']::text[]
     and procedure.proacl::text = expected.acl;
  if v_function_count <> 5 then
    raise exception 'exact Qoo10 verifier retirement RPC preimage drifted'
      using errcode = '55000';
  end if;

  -- Pin every 569 heading-normalization function used by the fresh verifier.
  select pg_catalog.count(*)
    into v_heading_function_count
    from (
      values
        ('sellerpilot_private.qoo10_canonical_provider_detail_html(text)','2358f7ae5587ddd59704765cbac80781',false,'i','sql',true),
        ('sellerpilot_private.qoo10_exact_item_matches_source_056700(jsonb,jsonb,text)','a65d39b1f056f34332657260f15893df',false,'i','plpgsql',true),
        ('sellerpilot_private.qoo10_exact_item_matches_source(jsonb,jsonb,text)','9690d249290d6f051f29e7e0d71b88ed',false,'i','sql',true),
        ('sellerpilot_private.qoo10_exact_activation_expectation_valid_056700(jsonb,jsonb)','e95a6199eeaf4c221f8e6becb002ddd7',false,'i','plpgsql',true),
        ('sellerpilot_private.qoo10_exact_activation_expectation_valid(jsonb,jsonb)','1b0d96703b785506cf4b3259643ed229',false,'i','sql',true),
        ('sellerpilot_private.record_exact_qoo10_s1_observation_056700(uuid)','599d15b0056323c4f1d240b2e9e9cb0e',true,'v','plpgsql',false),
        ('sellerpilot_private.record_exact_qoo10_s1_observation(uuid)','5fd11c7e55ce6f3044195ca66451f707',true,'v','plpgsql',false),
        ('sellerpilot_private.record_exact_qoo10_s1_activation_outcome_056700(uuid)','ce1ac826ef39b81d72586851a688acc1',true,'v','plpgsql',false),
        ('sellerpilot_private.record_exact_qoo10_s1_activation_outcome(uuid)','11c0a9842f2526613a86b85b04f86e93',true,'v','plpgsql',false)
    ) expected(
      signature,definition_md5,security_definer,volatility,language,is_strict
    )
    join pg_catalog.pg_proc procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    join pg_catalog.pg_roles owner on owner.oid = procedure.proowner
    join pg_catalog.pg_language language on language.oid = procedure.prolang
   where owner.rolname = 'postgres'
     and language.lanname = expected.language
     and pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid)) =
           expected.definition_md5
     and procedure.prosecdef = expected.security_definer
     and procedure.provolatile::text = expected.volatility
     and procedure.proisstrict = expected.is_strict
     and procedure.proconfig = array['search_path=""']::text[]
     and procedure.proacl::text = '{postgres=X/postgres}';
  if v_heading_function_count <> 9 then
    raise exception 'exact Qoo10 heading-normalization postimage drifted'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_index index_state
        where index_state.indexrelid = pg_catalog.to_regclass(
          'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'
        )
          and index_state.indisunique
          and index_state.indisvalid
          and pg_catalog.md5(pg_catalog.pg_get_indexdef(index_state.indexrelid)) =
                '442bcf841792a9276b53aa01dd67ce46'
     )
     or not exists (
       select 1
         from pg_catalog.pg_trigger trigger_state
        where trigger_state.tgrelid =
                'sellerpilot_private.channel_gateway_jobs'::regclass
          and trigger_state.tgname = 'guard_qoo10_exact_s1_verifier_overlap'
          and not trigger_state.tgisinternal
          and trigger_state.tgenabled = 'O'
          and trigger_state.tgfoid =
                'sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()'::regprocedure
          and pg_catalog.md5(pg_catalog.pg_get_triggerdef(trigger_state.oid)) =
                'c60e130c9706292d9123850b371d46bb'
     )
  then
    raise exception 'exact Qoo10 verifier overlap index or trigger drifted'
      using errcode = '55000';
  end if;

  select count(*) into v_source_count
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = c_source_job_id;
  select count(*) into v_old_job_count
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = c_old_verifier_job_id;
  select count(*) into v_source_attempt_count
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = c_source_attempt_id;
  select count(*) into v_receipt_count
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = c_old_verifier_job_id;
  select count(*) into v_run_count
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
   where run.verifier_job_id = c_old_verifier_job_id;
  select (
    (select count(*) from sellerpilot_private.qoo10_exact_s1_observations observation
      where observation.verifier_job_id = c_old_verifier_job_id
         or observation.source_job_id = c_source_job_id
         or observation.listing_id = c_listing_id)
    + (select count(*) from sellerpilot_private.qoo10_exact_s1_activation_permits permit
      where permit.verifier_job_id = c_old_verifier_job_id
         or permit.source_job_id = c_source_job_id
         or permit.listing_id = c_listing_id)
    + (select count(*) from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
      where outcome.verifier_job_id = c_old_verifier_job_id
         or outcome.source_job_id = c_source_job_id
         or outcome.listing_id = c_listing_id)
  ) into v_evidence_count;
  select count(*) into v_review_count
    from sellerpilot_private.listing_publication_reviews review
   where review.listing_id = c_listing_id
      or review.source_job_id = c_source_job_id
      or review.last_job_id = c_old_verifier_job_id;
  select count(*) into v_listing_count
    from sellerpilot_private.product_listings listing
   where listing.id = c_listing_id;
  select count(*) into v_product_count
    from sellerpilot_private.products product
   where product.id = c_product_id;
  select count(*) into v_credential_count
    from sellerpilot_private.channel_credentials credential
   where credential.id = c_credential_id;
  select count(*) into v_prior_audit_count
    from sellerpilot_private.operation_audit audit
   where audit.action = 'qoo10_s1_verifier_retired_for_recheck'
     and audit.entity_id = c_old_verifier_job_id::text;

  if v_source_count = 0
     and v_old_job_count = 0
     and v_source_attempt_count = 0
     and v_receipt_count = 0
     and v_run_count = 0
     and v_evidence_count = 0
     and v_review_count = 0
     and v_listing_count = 0
     and v_product_count = 0
     and v_credential_count = 0
     and v_prior_audit_count = 0
  then
    if v_history_table is null then
      return;
    end if;
    -- The ordinary clean-install migration replay has the exact predecessor
    -- history but no production anchors.  Recording 570 is its only effect.
    return;
  end if;

  if v_history_table is null
     or v_source_count <> 1
     or v_old_job_count <> 1
     or v_source_attempt_count <> 1
     or v_receipt_count <> 1
     or v_run_count <> 1
     or v_evidence_count <> 0
     or v_review_count <> 0
     or v_listing_count <> 1
     or v_product_count <> 1
     or v_credential_count <> 1
     or v_prior_audit_count <> 0
  then
    raise exception 'exact Qoo10 verifier retirement anchors are partial or drifted'
      using errcode = '55000';
  end if;

  select to_jsonb(job) into strict v_source_before
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = c_source_job_id
   for update;
  select to_jsonb(job) into strict v_old_job_before
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = c_old_verifier_job_id
   for update;
  select to_jsonb(receipt) into strict v_receipt_before
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = c_old_verifier_job_id;
  select to_jsonb(run) into strict v_run_before
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
   where run.verifier_job_id = c_old_verifier_job_id;
  select to_jsonb(listing) into strict v_listing_before
    from sellerpilot_private.product_listings listing
   where listing.id = c_listing_id
   for share;
  select to_jsonb(product) into strict v_product_before
    from sellerpilot_private.products product
   where product.id = c_product_id
   for share;
  select to_jsonb(credential) into strict v_credential_before
    from sellerpilot_private.channel_credentials credential
   where credential.id = c_credential_id
   for share;

  if pg_catalog.octet_length(v_old_job_before::text) <> 35120
     or encode(extensions.digest(v_old_job_before::text,'sha256'),'hex') <>
          'e7704614d8de834910f0ef69e49a9d2952c53b6ce66574552eb4d79c81146657'
     or v_old_job_before->>'status' <> 'reconciliation_required'
     or v_old_job_before->>'channel' <> 'qoo10'
     or v_old_job_before->>'operation' <> 'listing.publication.verify'
     or v_old_job_before->>'environment' <> 'production'
     or (v_old_job_before->>'listing_id')::uuid <> c_listing_id
     or (v_old_job_before->>'credential_id')::uuid <> c_credential_id
     or v_old_job_before->>'seller_account_key' <> c_seller_account_key
     or v_old_job_before->>'request_fingerprint' <> c_request_fingerprint
     or (v_old_job_before->>'attempt_count')::integer <> 1
     or v_old_job_before->>'created_at' <>
          '2026-08-31T01:43:55.583208+00:00'
     or v_old_job_before->>'started_at' <>
          '2026-08-31T01:43:58.593393+00:00'
     or v_old_job_before->>'completed_at' <>
          '2026-08-31T01:44:00.498366+00:00'
     or v_old_job_before->>'updated_at' <>
          '2026-08-31T01:44:00.498366+00:00'
     or pg_catalog.octet_length((v_old_job_before->'request_payload')::text) <> 662
     or encode(extensions.digest((v_old_job_before->'request_payload')::text,'sha256'),'hex') <>
          c_old_request_sha
     or pg_catalog.octet_length((v_old_job_before->'response_payload')::text) <> 32714
     or encode(extensions.digest((v_old_job_before->'response_payload')::text,'sha256'),'hex') <>
          c_old_response_sha
     or pg_catalog.octet_length(v_old_job_before->>'error_message') <> 142
     or encode(extensions.digest(v_old_job_before->>'error_message','sha256'),'hex') <>
          '0f946a9e9235b5a76543b4b8b37777799e4ffa023c509db23ff848a97bbdfef3'
     or v_old_job_before->'attempt_id' <> 'null'::jsonb
     or v_old_job_before->'worker_token_id' <> 'null'::jsonb
     or v_old_job_before->'claim_token' <> 'null'::jsonb
     or v_old_job_before->'lease_expires_at' <> 'null'::jsonb
     or v_old_job_before->'provider_mutation_started_at' <> 'null'::jsonb
     or v_old_job_before->'oauth_provider_call_started_at' <> 'null'::jsonb
     or v_old_job_before->'write_resource_kind' <> 'null'::jsonb
     or v_old_job_before->'write_resource_key' <> 'null'::jsonb
     or v_old_job_before->'inventory_item_id' <> 'null'::jsonb
     or v_old_job_before->'order_id' <> 'null'::jsonb
     or v_old_job_before->'shipment_carrier' <> 'null'::jsonb
     or v_old_job_before->'shipment_tracking' <> 'null'::jsonb
     or v_old_job_before->'credential_refresh_fingerprint' <> 'null'::jsonb
     or v_old_job_before->'prepared_credential_id' <> 'null'::jsonb
     or v_old_job_before->'credential_refresh_prepared_at' <> 'null'::jsonb
     or v_old_job_before->'credential_refresh_recovery_vault_id' <> 'null'::jsonb
     or v_old_job_before->'credential_refresh_recovery_fingerprint' <> 'null'::jsonb
     or v_old_job_before->'credential_refresh_recovery_staged_at' <> 'null'::jsonb
     or v_old_job_before->'credential_refresh_in_flight' <> 'false'::jsonb
     or v_old_job_before->'credential_refresh_started_at' <> 'null'::jsonb
     or v_old_job_before->'oauth_request_vault_id' <> 'null'::jsonb
     or v_old_job_before->'oauth_request_fingerprint' <> 'null'::jsonb
     or v_old_job_before->'oauth_source_credential_id' <> 'null'::jsonb
     or v_old_job_before->'oauth_exchange_completed' <> 'false'::jsonb
  then
    raise exception 'stale Qoo10 verifier queue row preimage drifted'
      using errcode = '55000';
  end if;

  if pg_catalog.jsonb_array_length(
       coalesce(v_old_job_before#>'{response_payload,steps}','[]'::jsonb)
     ) <> 2
     or not exists (
       select 1
         from pg_catalog.jsonb_array_elements(
           v_old_job_before#>'{response_payload,steps}'
         ) with ordinality step(value,ordinality)
        where step.ordinality = 1
          and step.value->>'name' = 'GetItemDetailInfo-publication-reverification'
          and step.value->'ok' = 'false'::jsonb
          and step.value->>'status' = '200'
          and step.value#>>'{data,ResultCode}' = '0'
          and encode(extensions.digest(step.value::text,'sha256'),'hex') =
                '678c2204866dce8abeb5f92d67195dbfb915b8c94d4fc4a4dba9b1bf64a84729'
     )
     or not exists (
       select 1
         from pg_catalog.jsonb_array_elements(
           v_old_job_before#>'{response_payload,steps}'
         ) with ordinality step(value,ordinality)
        where step.ordinality = 2
          and step.value->>'name' = 'qoo10-exact-s1-recovery-verification'
          and step.value->'ok' = 'false'::jsonb
          and step.value->>'status' = '422'
          and step.value#>>'{data,ResultCode}' = '0'
          and encode(extensions.digest(step.value::text,'sha256'),'hex') =
                '13bc3048532a4489bfae0cd96ff5e8487b2ac83660b0178a728ecabeb4511805'
     )
     or exists (
       select 1
         from pg_catalog.jsonb_array_elements(
           v_old_job_before#>'{response_payload,steps}'
         ) step(value)
        where pg_catalog.lower(coalesce(step.value->>'name','')) in (
          'updategoods','editgoodscontents','editgoodsstatus'
        )
     )
  then
    raise exception 'stale Qoo10 verifier response evidence drifted'
      using errcode = '55000';
  end if;

  if pg_catalog.octet_length(v_receipt_before::text) <> 337
     or encode(extensions.digest(v_receipt_before::text,'sha256'),'hex') <>
          '98d556a6de7b1adc8be91b87fc133eece7698fe9897991fb6dc57fbe0e4ee993'
     or v_receipt_before->>'completion_fingerprint' <>
          '8c9072a7901e6aef3f113354d2ab5eb85176e3fc69da28805384be5f06e278ce'
     or v_receipt_before->'continuation_job_id' <> 'null'::jsonb
     or v_receipt_before->>'created_at' <>
          '2026-08-31T01:44:00.579327+00:00'
     or sellerpilot_private.gateway_completion_fingerprint(
          'reconciliation_required',
          v_old_job_before->'response_payload',
          v_old_job_before->>'error_message',
          null,null,null,null
        ) <> v_receipt_before->>'completion_fingerprint'
  then
    raise exception 'stale Qoo10 verifier completion receipt drifted'
      using errcode = '55000';
  end if;

  if pg_catalog.octet_length(v_run_before::text) <> 911
     or encode(extensions.digest(v_run_before::text,'sha256'),'hex') <>
          '24f77db892cc3e115fe8ee042ca3f7d10c1fa01916824d5fdbffa523505e1001'
     or (v_run_before->>'source_job_id')::uuid <> c_source_job_id
     or (v_run_before->>'listing_id')::uuid <> c_listing_id
     or (v_run_before->>'product_id')::uuid <> c_product_id
     or (v_run_before->>'credential_id')::uuid <> c_credential_id
     or (v_run_before->>'owner_id')::uuid <> c_owner_id
     or v_run_before->>'release_sha' <> c_old_release_sha
     or v_run_before->>'contract' <> 'qoo10_exact_s1_verifier_v1'
     or v_run_before->>'queued_at' <>
          '2026-08-31T01:43:55.624114+00:00'
  then
    raise exception 'stale Qoo10 verifier run ledger drifted'
      using errcode = '55000';
  end if;

  if not sellerpilot_private.qoo10_exact_s1_source_is_current()
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.listing_id = c_listing_id
          and job.status in ('queued','running')
     )
     or (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs job
        where job.listing_id = c_listing_id
          and job.status = 'reconciliation_required'
     ) <> 2
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.listing_id = c_listing_id
          and job.status = 'reconciliation_required'
          and job.id not in (c_source_job_id,c_old_verifier_job_id)
     )
  then
    raise exception 'exact Qoo10 source or active-work boundary drifted'
      using errcode = '55000';
  end if;

  select sellerpilot_private.attested_listing_publication_release_sha('qoo10'),
         sellerpilot_private.active_serverless_runtime_release_sha()
    into v_attested_release_sha, v_runtime_release_sha;
  if v_attested_release_sha is distinct from v_runtime_release_sha
     or coalesce(v_runtime_release_sha,'') !~ '^[a-f0-9]{40}$'
     or v_runtime_release_sha = c_old_release_sha
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(
       v_runtime_release_sha
     )
  then
    raise exception 'fresh Qoo10 verifier release is not current and closed'
      using errcode = '55000';
  end if;
  v_release_sha := v_runtime_release_sha;

  select count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(
           job.id::text || ':' || job.status || ':' || job.operation || ':' ||
           coalesce(job.listing_id::text,'') || ':' ||
           coalesce(job.updated_at::text,''), ',' order by job.id
         ),''))
    into v_gateway_unrelated_count, v_gateway_unrelated_fingerprint
    from sellerpilot_private.channel_gateway_jobs job
   where job.id <> c_old_verifier_job_id;
  select count(*) into v_gateway_total_before
    from sellerpilot_private.channel_gateway_jobs;
  select count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(
           run.verifier_job_id::text || ':' || run.source_job_id::text || ':' ||
           run.release_sha || ':' || run.queued_at::text,
           ',' order by run.verifier_job_id
         ),''))
    into v_run_unrelated_count, v_run_unrelated_fingerprint
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
   where run.verifier_job_id <> c_old_verifier_job_id;
  select count(*) into v_run_total_before
    from sellerpilot_private.qoo10_exact_s1_verifier_runs;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'failed',
         updated_at = clock_timestamp()
   where job.id = c_old_verifier_job_id
     and job.status = 'reconciliation_required';
  if not found then
    raise exception 'stale Qoo10 verifier retirement lost row ownership'
      using errcode = '40001';
  end if;

  v_enqueue_result :=
    public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(
      c_source_job_id,
      v_release_sha
    );
  if v_enqueue_result->>'contract' is distinct from
       'qoo10_exact_s1_verifier_v1'
     or v_enqueue_result->>'sourceJobId' is distinct from
          c_source_job_id::text
     or v_enqueue_result->'reused' is distinct from 'false'::jsonb
     or nullif(v_enqueue_result->>'verifierJobId','') is null
  then
    raise exception 'fresh Qoo10 verifier enqueue result drifted'
      using errcode = '55000';
  end if;
  v_new_verifier_job_id := (v_enqueue_result->>'verifierJobId')::uuid;
  if v_new_verifier_job_id in (c_source_job_id,c_old_verifier_job_id) then
    raise exception 'fresh Qoo10 verifier reused an immutable job id'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail, occurred_at
  ) values (
    c_owner_id,
    'qoo10_s1_verifier_retired_for_recheck',
    'channel_gateway_job',
    c_old_verifier_job_id::text,
    jsonb_build_object(
      'contract','qoo10_exact_s1_verifier_retirement_v1',
      'sourceJobId',c_source_job_id,
      'retiredVerifierJobId',c_old_verifier_job_id,
      'freshVerifierJobId',v_new_verifier_job_id,
      'releaseSha',v_release_sha,
      'previousStatus','reconciliation_required',
      'terminalStatus','failed',
      'requestSha256',c_old_request_sha,
      'responseSha256',c_old_response_sha,
      'receiptPreserved',true,
      'providerCallReplayed',false,
      'providerMutationStarted',false
    ),
    clock_timestamp()
  );

  select to_jsonb(job) into strict v_old_job_after
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = c_old_verifier_job_id;
  select to_jsonb(job) into strict v_source_after
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = c_source_job_id;
  select to_jsonb(receipt) into strict v_receipt_after
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = c_old_verifier_job_id;
  select to_jsonb(run) into strict v_run_after
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
   where run.verifier_job_id = c_old_verifier_job_id;
  select to_jsonb(listing) into strict v_listing_after
    from sellerpilot_private.product_listings listing
   where listing.id = c_listing_id;
  select to_jsonb(product) into strict v_product_after
    from sellerpilot_private.products product
   where product.id = c_product_id;
  select to_jsonb(credential) into strict v_credential_after
    from sellerpilot_private.channel_credentials credential
   where credential.id = c_credential_id;

  if v_old_job_after->>'status' <> 'failed'
     or (v_old_job_after - 'status' - 'updated_at') is distinct from
          (v_old_job_before - 'status' - 'updated_at')
     or (v_old_job_after->>'updated_at')::timestamptz <=
          (v_old_job_before->>'updated_at')::timestamptz
     or (v_old_job_after->>'updated_at')::timestamptz < v_started_at
     or v_source_after is distinct from v_source_before
     or v_receipt_after is distinct from v_receipt_before
     or v_run_after is distinct from v_run_before
     or v_listing_after is distinct from v_listing_before
     or v_product_after is distinct from v_product_before
     or v_credential_after is distinct from v_credential_before
  then
    raise exception 'exact Qoo10 verifier retirement changed immutable evidence'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = v_new_verifier_job_id
          and sellerpilot_private.qoo10_exact_s1_verifier_job_matches(job)
          and job.status = 'queued'
          and job.attempt_id is null
          and job.attempt_count = 0
          and job.response_payload is null
          and job.error_message is null
          and job.worker_token_id is null
          and job.claim_token is null
          and job.lease_expires_at is null
          and job.started_at is null
          and job.completed_at is null
          and job.provider_mutation_started_at is null
          and job.oauth_provider_call_started_at is null
          and job.write_resource_kind is null
          and job.write_resource_key is null
          and job.inventory_item_id is null
          and job.order_id is null
          and job.shipment_carrier is null
          and job.shipment_tracking is null
          and job.credential_refresh_fingerprint is null
          and job.prepared_credential_id is null
          and job.credential_refresh_prepared_at is null
          and job.credential_refresh_recovery_vault_id is null
          and job.credential_refresh_recovery_fingerprint is null
          and job.credential_refresh_recovery_staged_at is null
          and not job.credential_refresh_in_flight
          and job.credential_refresh_started_at is null
          and job.oauth_request_vault_id is null
          and job.oauth_request_fingerprint is null
          and job.oauth_source_credential_id is null
          and not job.oauth_exchange_completed
          and pg_catalog.octet_length(job.request_payload::text) = 662
          and encode(extensions.digest(job.request_payload::text,'sha256'),'hex') =
                c_old_request_sha
          and job.created_at >= v_started_at
          and job.updated_at >= v_started_at
          and job.created_at <= clock_timestamp()
          and job.updated_at <= clock_timestamp()
     )
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_s1_verifier_runs run
        where run.verifier_job_id = v_new_verifier_job_id
          and run.source_job_id = c_source_job_id
          and run.source_attempt_id =
                '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
          and run.listing_id = c_listing_id
          and run.product_id = c_product_id
          and run.credential_id = c_credential_id
          and run.owner_id = c_owner_id
          and run.remote_id = '1217336970'
          and run.seller_account_key = c_seller_account_key
          and run.source_request_sha256 =
                'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
          and run.source_request_bytes = 23555
          and run.source_response_sha256 =
                'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
          and run.source_response_bytes = 16669
          and run.release_sha = v_release_sha
          and run.contract = 'qoo10_exact_s1_verifier_v1'
          and run.queued_at >= v_started_at
          and run.queued_at <= clock_timestamp()
     )
  then
    raise exception 'fresh Qoo10 verifier postcondition drifted'
      using errcode = '55000';
  end if;

  select count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(
           job.id::text || ':' || job.status || ':' || job.operation || ':' ||
           coalesce(job.listing_id::text,'') || ':' ||
           coalesce(job.updated_at::text,''), ',' order by job.id
         ),''))
    into v_gateway_unrelated_count_after,
         v_gateway_unrelated_fingerprint_after
    from sellerpilot_private.channel_gateway_jobs job
   where job.id not in (c_old_verifier_job_id,v_new_verifier_job_id);
  select count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(
           run.verifier_job_id::text || ':' || run.source_job_id::text || ':' ||
           run.release_sha || ':' || run.queued_at::text,
           ',' order by run.verifier_job_id
         ),''))
    into v_run_unrelated_count_after, v_run_unrelated_fingerprint_after
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
   where run.verifier_job_id not in (
     c_old_verifier_job_id,v_new_verifier_job_id
   );

  if v_gateway_unrelated_count_after <> v_gateway_unrelated_count
     or v_gateway_unrelated_fingerprint_after is distinct from
          v_gateway_unrelated_fingerprint
     or (select count(*) from sellerpilot_private.channel_gateway_jobs) <>
          v_gateway_total_before + 1
     or v_run_unrelated_count_after <> v_run_unrelated_count
     or v_run_unrelated_fingerprint_after is distinct from
          v_run_unrelated_fingerprint
     or (select count(*) from sellerpilot_private.qoo10_exact_s1_verifier_runs) <>
          v_run_total_before + 1
     or (select count(*) from sellerpilot_private.gateway_completion_receipts
          where job_id = c_old_verifier_job_id) <> 1
     or (select count(*) from sellerpilot_private.gateway_completion_receipts
          where job_id = v_new_verifier_job_id) <> 0
     or (select count(*) from sellerpilot_private.qoo10_exact_s1_observations
          where verifier_job_id in (c_old_verifier_job_id,v_new_verifier_job_id)
             or source_job_id = c_source_job_id
             or listing_id = c_listing_id) <> 0
     or (select count(*) from sellerpilot_private.qoo10_exact_s1_activation_permits
          where verifier_job_id in (c_old_verifier_job_id,v_new_verifier_job_id)
             or source_job_id = c_source_job_id
             or listing_id = c_listing_id) <> 0
     or (select count(*) from sellerpilot_private.qoo10_exact_s1_activation_outcomes
          where verifier_job_id in (c_old_verifier_job_id,v_new_verifier_job_id)
             or source_job_id = c_source_job_id
             or listing_id = c_listing_id) <> 0
     or (select count(*) from sellerpilot_private.listing_publication_reviews
          where listing_id = c_listing_id
             or source_job_id = c_source_job_id
             or last_job_id in (c_old_verifier_job_id,v_new_verifier_job_id)) <> 0
     or (select count(*) from sellerpilot_private.operation_audit audit
          where audit.action = 'qoo10_s1_verifier_retired_for_recheck'
            and audit.entity_id = c_old_verifier_job_id::text
            and audit.owner_id = c_owner_id
            and audit.entity_type = 'channel_gateway_job'
            and audit.safe_detail->>'contract' =
                  'qoo10_exact_s1_verifier_retirement_v1'
            and (audit.safe_detail->>'sourceJobId')::uuid = c_source_job_id
            and (audit.safe_detail->>'freshVerifierJobId')::uuid =
                  v_new_verifier_job_id
            and audit.safe_detail->>'releaseSha' = v_release_sha
            and audit.safe_detail->'receiptPreserved' = 'true'::jsonb
            and audit.safe_detail->'providerCallReplayed' = 'false'::jsonb
            and audit.safe_detail->'providerMutationStarted' = 'false'::jsonb
        ) <> 1
  then
    raise exception 'exact Qoo10 verifier retirement postconditions failed'
      using errcode = '55000';
  end if;
end;
$retire_stale_qoo10_s1_verifier$;

commit;
