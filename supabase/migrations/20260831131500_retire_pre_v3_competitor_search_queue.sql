-- Retire the exact pre-v3 11st competitor-search queue before installing the
-- identity-lineage fence.  These reads were enqueued before a claim-time
-- product fingerprint existed.  The v3 completion fence prevents those reads
-- from populating a changed product identity, but leaving them active would
-- still cause orphan provider calls, extra latency, and avoidable 429 backlog.
-- No provider call has begun.
--
-- The production preimage was observed with schedules disabled and is pinned
-- by both count and a canonical digest.  A clean database has no such rows and
-- is an intentional no-op; every other non-empty preimage fails closed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext(
    'sellerpilot:retire-pre-v3-competitor-search-queue:v1'
  )
);

lock table supabase_migrations.schema_migrations in share mode;
lock table
  sellerpilot_private.channel_gateway_jobs,
  sellerpilot_private.competitor_price_refresh_claims,
  sellerpilot_private.operation_audit
in share row exclusive mode;

do $retire_pre_v3_competitor_search_queue$
declare
  c_expected_count constant integer := 19;
  c_expected_digest constant text :=
    'cf636a14eb69f3260e1eb24077da87bd8f7d479d1e467303e51535955b3c3ed4';
  c_expected_full_rows_digest constant text :=
    'a02c9210ce1be866bf721835b948ca09649505772f5c2783856d9c56001a8c82';
  c_expected_request_payloads_digest constant text :=
    '06a78b54eaa1a1782a5a1fa7b11b78eb781bedc7e34c570621ce0aa135734d9e';
  c_expected_linkages_digest constant text :=
    '6a3e43d2c15c6f72f9919a10785170aa004e156ede2060c311ab1fb5e0309565';
  c_retirement_error constant text :=
    'COMPETITOR_SEARCH_RETIRED_BEFORE_IDENTITY_V3';
  c_audit_action constant text :=
    'competitor_search_queue_retired_before_identity_v3';
  c_contract constant text :=
    'competitor_search_pre_v3_queue_retirement_v1';
  c_valid_v3_postimage_sha constant text :=
    '00e53e6b85ade85504c1096d10c39e07facb872870bb654a72a44ff04ae0a784';
  c_record_v3_postimage_sha constant text :=
    'c68a53700e658c8c630aeeda624f848140fd879d5f0aeb2f6e6a94e5775d80b5';
  c_review_postimage_sha constant text :=
    'dfe1cfa9e4a4222efbc8cca749393b224d1b9397c08dc570d7fe545052d01222';
  c_append_only_postimage_sha constant text :=
    '8b6072ac2402977ae7425e3f73e96a95c4147fca4894a8ce596ca80129ffce27';
  v_active_count bigint;
  v_active_digest text;
  v_full_rows_digest text;
  v_request_payloads_digest text;
  v_linkages_digest text;
  v_safe_count bigint;
  v_safe_digest text;
  v_job_count_before bigint;
  v_claim_count_before bigint;
  v_audit_count_before bigint;
  v_updated_count bigint;
  v_inserted_audit_count bigint;
  v_retired_at timestamptz := clock_timestamp();
begin
  if (
    select count(*)
      from supabase_migrations.schema_migrations migration
     where (
       migration.version = '20260831130000'
       and migration.name = 'competitor_price_v3'
       and pg_catalog.cardinality(migration.statements) = 0
     ) or (
       migration.version = '20260831131000'
       and migration.name = 'competitor_match_review_ledger'
       and pg_catalog.cardinality(migration.statements) = 0
     )
  ) <> 2
     or exists (
       select 1
         from supabase_migrations.schema_migrations migration
        where migration.version in (
          '20260831130000',
          '20260831131000',
          '20260831131500',
          '20260831132000'
        )
          and not (
            migration.version = '20260831130000'
            and migration.name = 'competitor_price_v3'
            and pg_catalog.cardinality(migration.statements) = 0
          )
          and not (
            migration.version = '20260831131000'
            and migration.name = 'competitor_match_review_ledger'
            and pg_catalog.cardinality(migration.statements) = 0
          )
     ) then
    raise exception 'competitor queue retirement migration history drifted';
  end if;

  if pg_catalog.to_regclass(
       'sellerpilot_private.competitor_match_review_events'
     ) is null then
    raise exception
      'competitor queue retirement must run after the v3 review ledger';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_attribute attribute
     where attribute.attrelid =
             'sellerpilot_private.competitor_price_refresh_claims'::regclass
       and attribute.attname = 'identity_fingerprint'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ) then
    raise exception
      'competitor queue retirement must run before the identity lineage fence';
  end if;

  select count(*)
    into v_job_count_before
    from sellerpilot_private.channel_gateway_jobs;
  select count(*)
    into v_claim_count_before
    from sellerpilot_private.competitor_price_refresh_claims;
  select count(*)
    into v_audit_count_before
    from sellerpilot_private.operation_audit;

  -- A running or claimed read can have an in-flight provider result even when
  -- the row still looks resumable.  Refuse the whole migration rather than
  -- guessing whether that result exists.  A response on an active row is the
  -- same uncertainty boundary for this read-only operation.
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'elevenst'
       and job.operation = 'competitor.search'
       and job.status in ('queued', 'running')
       and (
         job.status = 'running'
         or job.worker_token_id is not null
         or job.claim_token is not null
         or (
           job.lease_expires_at is not null
           and job.lease_expires_at > clock_timestamp()
         )
         or job.provider_mutation_started_at is not null
         or job.response_payload is not null
       )
  ) then
    raise exception
      'active or provider-touched competitor search prevents queue retirement';
  end if;

  -- This is the exact canonical production preflight digest.  Keep its shape
  -- intentionally small and stable: job id, active status, and periodic key.
  select count(*),
         encode(
           extensions.digest(
             coalesce(
               string_agg(
                 job.id::text || ':' || job.status || ':' ||
                   coalesce(job.request_payload->>'periodicKey', ''),
                 ',' order by job.id
               ),
               ''
             ),
             'sha256'
           ),
           'hex'
         )
    into v_active_count, v_active_digest
    from sellerpilot_private.channel_gateway_jobs job
   where job.channel = 'elevenst'
     and job.operation = 'competitor.search'
     and job.status in ('queued', 'running');

  select
    encode(
      extensions.digest(
        coalesce(string_agg(
          target.id::text || ':' || target.row_sha,
          ',' order by target.id
        ), ''),
        'sha256'
      ),
      'hex'
    ),
    encode(
      extensions.digest(
        coalesce(string_agg(
          target.id::text || ':' || target.request_sha,
          ',' order by target.id
        ), ''),
        'sha256'
      ),
      'hex'
    ),
    encode(
      extensions.digest(
        coalesce(string_agg(
          target.id::text || ':' || target.link_count::text || ':' ||
            target.linkage_sha,
          ',' order by target.id
        ), ''),
        'sha256'
      ),
      'hex'
    )
    into v_full_rows_digest, v_request_payloads_digest, v_linkages_digest
    from (
      select
        job.id,
        encode(
          extensions.digest(to_jsonb(job)::text, 'sha256'),
          'hex'
        ) as row_sha,
        encode(
          extensions.digest(job.request_payload::text, 'sha256'),
          'hex'
        ) as request_sha,
        coalesce(linkage.link_count, 0) as link_count,
        coalesce(
          linkage.linkage_sha,
          encode(extensions.digest('', 'sha256'), 'hex')
        ) as linkage_sha
      from sellerpilot_private.channel_gateway_jobs job
      cross join lateral (
        select
          count(*) as link_count,
          encode(
            extensions.digest(
              coalesce(string_agg(
                claim.product_id::text || ':' ||
                  coalesce(claim.gateway_periodic_key, ''),
                ',' order by claim.product_id
              ), ''),
              'sha256'
            ),
            'hex'
          ) as linkage_sha
        from sellerpilot_private.competitor_price_refresh_claims claim
        where claim.gateway_job_id = job.id
      ) linkage
      where job.channel = 'elevenst'
        and job.operation = 'competitor.search'
        and job.status in ('queued', 'running')
    ) target;

  if v_active_count = 0 then
    -- A chronological replay starts with empty operational ledgers.  On an
    -- already-used database, however, a missing certified target means the
    -- observed production preimage disappeared and must not be recorded as a
    -- successful no-op migration.
    if v_job_count_before <> 0
       or v_claim_count_before <> 0
       or v_audit_count_before <> 0 then
      raise exception
        'competitor search retirement target absent on non-empty database';
    end if;
    return;
  end if;

  if v_active_count is distinct from c_expected_count
     or v_active_digest is distinct from c_expected_digest
     or v_full_rows_digest is distinct from c_expected_full_rows_digest
     or v_request_payloads_digest is distinct from
          c_expected_request_payloads_digest
     or v_linkages_digest is distinct from c_expected_linkages_digest then
    raise exception
      'competitor search retirement target drifted (count %, digest %; full evidence mismatch)',
      v_active_count,
      v_active_digest;
  end if;

  -- Migration history alone is not sufficient evidence: pin representative
  -- executable postimages from both v3 predecessors, plus the review ledger's
  -- append-only/RLS boundary, before changing operational rows.
  if (select encode(extensions.digest(pg_get_functiondef(
         'sellerpilot_private.valid_competitor_v3_item(jsonb)'::regprocedure
       ), 'sha256'), 'hex')) is distinct from c_valid_v3_postimage_sha
     or (select encode(extensions.digest(pg_get_functiondef(
          'sellerpilot_private.record_competitor_prices(uuid,jsonb,boolean)'::regprocedure
        ), 'sha256'), 'hex')) is distinct from c_record_v3_postimage_sha
     or (select encode(extensions.digest(pg_get_functiondef(
          'public.sellerpilot_review_competitor_match(uuid,text,timestamptz,uuid,text,jsonb,text,uuid)'::regprocedure
        ), 'sha256'), 'hex')) is distinct from c_review_postimage_sha
     or (select encode(extensions.digest(pg_get_functiondef(
          'sellerpilot_private.reject_competitor_match_review_mutation()'::regprocedure
        ), 'sha256'), 'hex')) is distinct from c_append_only_postimage_sha
     or not exists (
       select 1
         from pg_catalog.pg_class relation
        where relation.oid =
                'sellerpilot_private.competitor_match_review_events'::regclass
          and relation.relrowsecurity
     )
     or not exists (
       select 1
         from pg_catalog.pg_trigger trigger
        where trigger.tgrelid =
                'sellerpilot_private.competitor_match_review_events'::regclass
          and trigger.tgname = 'competitor_match_review_events_append_only'
          and not trigger.tgisinternal
          and trigger.tgenabled <> 'D'
     ) then
    raise exception 'competitor v3 predecessor postimage drifted';
  end if;

  -- Only never-claimed, provider-untouched queued reads are eligible.  The
  -- observed zero-valued start/attempt history is pinned here and is retained,
  -- along with every other immutable source field, by the postimage digest.
  select count(*),
         encode(
           extensions.digest(
             coalesce(
               string_agg(
                 job.id::text || ':' || job.status || ':' ||
                   coalesce(job.request_payload->>'periodicKey', ''),
                 ',' order by job.id
               ),
               ''
             ),
             'sha256'
           ),
           'hex'
         )
    into v_safe_count, v_safe_digest
    from sellerpilot_private.channel_gateway_jobs job
   where job.channel = 'elevenst'
     and job.operation = 'competitor.search'
     and job.status = 'queued'
     and job.attempt_id is null
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.provider_mutation_started_at is null
     and job.response_payload is null
     and job.error_message is null
     and job.attempt_count = 0
     and job.started_at is null
     and job.completed_at is null;

  if v_safe_count is distinct from v_active_count
     or v_safe_digest is distinct from v_active_digest then
    raise exception
      'competitor search retirement contains a non-retirable active row';
  end if;

  if exists (
    select 1
      from sellerpilot_private.operation_audit audit
     where audit.action = c_audit_action
       and audit.entity_type = 'channel_gateway_job'
       and audit.entity_id in (
         select job.id::text
           from sellerpilot_private.channel_gateway_jobs job
          where job.channel = 'elevenst'
            and job.operation = 'competitor.search'
            and job.status = 'queued'
            and job.error_message is null
       )
  ) then
    raise exception 'competitor search retirement audit already exists';
  end if;

  create temporary table
    sellerpilot_pre_v3_competitor_search_retirement_targets
  on commit drop
  as
  select
    job.id,
    job.created_by,
    job.credential_id,
    job.environment,
    job.request_payload->>'periodicKey' as periodic_key,
    encode(
      extensions.digest(to_jsonb(job)::text, 'sha256'),
      'hex'
    ) as job_preimage_sha256,
    encode(
      extensions.digest(
        (
          to_jsonb(job)
            - 'status'
            - 'error_message'
            - 'completed_at'
            - 'updated_at'
        )::text,
        'sha256'
      ),
      'hex'
    ) as immutable_fields_sha256,
    encode(
      extensions.digest(job.request_payload::text, 'sha256'),
      'hex'
    ) as request_payload_sha256,
    linkage.product_ids as linked_product_ids,
    linkage.link_count,
    linkage.linkage_sha256
  from sellerpilot_private.channel_gateway_jobs job
  cross join lateral (
    select
      coalesce(
        jsonb_agg(
          to_jsonb(refresh_state.product_id::text)
          order by refresh_state.product_id
        ),
        '[]'::jsonb
      ) as product_ids,
      count(*) as link_count,
      encode(
        extensions.digest(
          coalesce(
            string_agg(
              refresh_state.product_id::text || ':' ||
                coalesce(refresh_state.gateway_periodic_key, ''),
              ',' order by refresh_state.product_id
            ),
            ''
          ),
          'sha256'
        ),
        'hex'
      ) as linkage_sha256
    from sellerpilot_private.competitor_price_refresh_claims refresh_state
    where refresh_state.gateway_job_id = job.id
  ) linkage
  where job.channel = 'elevenst'
    and job.operation = 'competitor.search'
    and job.status = 'queued'
    and job.attempt_id is null
    and job.worker_token_id is null
    and job.claim_token is null
    and job.lease_expires_at is null
    and job.provider_mutation_started_at is null
    and job.response_payload is null
    and job.error_message is null
    and job.attempt_count = 0
    and job.started_at is null
    and job.completed_at is null;

  if (select count(*)
        from sellerpilot_pre_v3_competitor_search_retirement_targets)
       is distinct from c_expected_count then
    raise exception 'competitor search retirement snapshot drifted';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         error_message = c_retirement_error,
         completed_at = v_retired_at,
         updated_at = v_retired_at
    from sellerpilot_pre_v3_competitor_search_retirement_targets target
   where job.id = target.id
     and job.channel = 'elevenst'
     and job.operation = 'competitor.search'
     and job.status = 'queued'
     and job.attempt_id is null
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.provider_mutation_started_at is null
     and job.response_payload is null
     and job.error_message is null
     and job.attempt_count = 0
     and job.started_at is null
     and job.completed_at is null;
  get diagnostics v_updated_count = row_count;

  if v_updated_count is distinct from c_expected_count then
    raise exception
      'competitor search retirement update count drifted (%)',
      v_updated_count;
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id,
    action,
    entity_type,
    entity_id,
    safe_detail,
    occurred_at
  )
  select
    target.created_by,
    c_audit_action,
    'channel_gateway_job',
    target.id::text,
    jsonb_build_object(
      'contract', c_contract,
      'reason', 'pre_v3_identity_lineage_unattested',
      'queueDigest', c_expected_digest,
      'queueFullRowsDigest', c_expected_full_rows_digest,
      'queueRequestPayloadsDigest', c_expected_request_payloads_digest,
      'queueLinkagesDigest', c_expected_linkages_digest,
      'queueTargetCount', c_expected_count,
      'jobPreimageSha256', target.job_preimage_sha256,
      'immutableJobFieldsSha256', target.immutable_fields_sha256,
      'requestPayloadSha256', target.request_payload_sha256,
      'credentialId', target.credential_id,
      'environment', target.environment,
      'periodicKey', target.periodic_key,
      'linkedProductIds', target.linked_product_ids,
      'linkCount', target.link_count,
      'linkageSha256', target.linkage_sha256,
      'retiredAt', v_retired_at
    ),
    v_retired_at
  from sellerpilot_pre_v3_competitor_search_retirement_targets target
  order by target.id;
  get diagnostics v_inserted_audit_count = row_count;

  if v_inserted_audit_count is distinct from c_expected_count then
    raise exception
      'competitor search retirement audit count drifted (%)',
      v_inserted_audit_count;
  end if;

  if (select count(*)
        from sellerpilot_private.channel_gateway_jobs job)
       is distinct from v_job_count_before
     or (select count(*)
           from sellerpilot_private.competitor_price_refresh_claims)
          is distinct from v_claim_count_before
     or (select count(*)
           from sellerpilot_private.operation_audit)
          is distinct from v_audit_count_before + c_expected_count then
    raise exception 'competitor search retirement changed ledger cardinality';
  end if;

  if exists (
    select 1
      from sellerpilot_pre_v3_competitor_search_retirement_targets target
      join sellerpilot_private.channel_gateway_jobs job on job.id = target.id
      cross join lateral (
        select encode(
          extensions.digest(
            coalesce(
              string_agg(
                refresh_state.product_id::text || ':' ||
                  coalesce(refresh_state.gateway_periodic_key, ''),
                ',' order by refresh_state.product_id
              ),
              ''
            ),
            'sha256'
          ),
          'hex'
        ) as linkage_sha256
        from sellerpilot_private.competitor_price_refresh_claims refresh_state
        where refresh_state.gateway_job_id = job.id
      ) linkage
     where job.status is distinct from 'cancelled'
        or job.error_message is distinct from c_retirement_error
        or job.completed_at is distinct from v_retired_at
        or job.updated_at is distinct from v_retired_at
        or encode(
             extensions.digest(
               (
                 to_jsonb(job)
                   - 'status'
                   - 'error_message'
                   - 'completed_at'
                   - 'updated_at'
               )::text,
               'sha256'
             ),
             'hex'
           ) is distinct from target.immutable_fields_sha256
        or linkage.linkage_sha256 is distinct from target.linkage_sha256
  ) then
    raise exception
      'competitor search retirement changed immutable evidence';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'elevenst'
       and job.operation = 'competitor.search'
       and job.status in ('queued', 'running')
  ) then
    raise exception 'competitor search retirement left active target rows';
  end if;

  if (select count(*)
        from sellerpilot_private.operation_audit audit
       where audit.action = c_audit_action
         and audit.entity_type = 'channel_gateway_job'
         and audit.safe_detail->>'contract' = c_contract
         and audit.safe_detail->>'queueDigest' = c_expected_digest
         and audit.safe_detail->>'queueFullRowsDigest' =
               c_expected_full_rows_digest
         and audit.safe_detail->>'queueRequestPayloadsDigest' =
               c_expected_request_payloads_digest
         and audit.safe_detail->>'queueLinkagesDigest' =
               c_expected_linkages_digest)
       is distinct from c_expected_count then
    raise exception 'competitor search retirement audit postimage drifted';
  end if;
end;
$retire_pre_v3_competitor_search_queue$;

commit;
