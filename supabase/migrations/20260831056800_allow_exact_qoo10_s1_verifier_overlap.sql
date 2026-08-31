-- The exact Qoo10 S1 verifier is a read-only reconciliation probe.  It must
-- coexist with the one immutable reconciliation_required source mutation, but
-- no ordinary listing read or write may overlap that source.
--
-- Use an expression discriminator instead of excluding the source row from
-- the index.  The source and all ordinary listing work keep the `default`
-- identity, while only the explicitly marked read-only verifier receives a
-- second identity.  A second exact verifier still conflicts with the first.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
lock table sellerpilot_private.channel_gateway_jobs
  in share row exclusive mode;

do $$
declare
  v_index_definition text;
  v_row_count bigint;
  v_row_fingerprint text;
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.qoo10_exact_s1_source_is_current()'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.qoo10_exact_s1_verifier_runs'
     ) is null
  then
    raise exception 'exact Qoo10 S1 verifier contract is unavailable'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_indexdef(indexrelid)
    into v_index_definition
    from pg_catalog.pg_index
   where indexrelid = pg_catalog.to_regclass(
     'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'
   );

  if pg_catalog.md5(coalesce(v_index_definition, '')) <>
       'ca85f9d4a73b70bcb72db91835bc0e1a'
  then
    raise exception 'active listing serialization index preimage drifted'
      using errcode = '55000';
  end if;

  select count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(
           job.id::text || ':' || job.status || ':' || job.operation || ':' ||
           coalesce(job.listing_id::text, ''), ',' order by job.id
         ), ''))
    into v_row_count, v_row_fingerprint
    from sellerpilot_private.channel_gateway_jobs job;

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_s1_overlap_row_count', v_row_count::text, true
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_s1_overlap_row_fingerprint', v_row_fingerprint, true
  );
end;
$$;

create function sellerpilot_private.qoo10_exact_s1_verifier_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_job.listing_id =
           '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and p_job.channel = 'qoo10'
    and p_job.operation = 'listing.publication.verify'
    and p_job.credential_id =
           '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and p_job.seller_account_key =
           '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and p_job.request_fingerprint =
           '76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799'
    and p_job.request_payload->>'periodicKey' =
           'qoo10-exact-s1:fac9c5c4-940d-4600-88f3-8f97a069dfbf'
    and p_job.request_payload->'arguments'->'sellerpilotReadOnly' =
           'true'::jsonb
    and p_job.request_payload #>>
          '{arguments,sellerpilotQoo10ExactS1Recovery}' =
          'qoo10_exact_s1_verifier_v1'
    and p_job.request_payload #>>
          '{arguments,publicationReviewSourceJobId}' =
          'fac9c5c4-940d-4600-88f3-8f97a069dfbf'
    and p_job.request_payload #>> '{arguments,publicationReviewId}' =
          '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
    and p_job.request_payload #>> '{arguments,remoteId}' = '1217336970'
    and p_job.request_payload #>>
          '{arguments,publicationExpectedLocale}' = 'ja-JP'
$$;

create function sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_new boolean;
  v_exact_new boolean;
begin
  if tg_op in ('UPDATE', 'DELETE')
     and old.id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     and exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs verifier
        where verifier.id <> old.id
          and verifier.status in ('queued','running','reconciliation_required')
          and sellerpilot_private.qoo10_exact_s1_verifier_job_matches(verifier)
     )
  then
    raise exception 'exact Qoo10 S1 source is locked by its verifier'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  v_active_new := new.listing_id is not null
    and new.operation in (
      'listing.create','listing.update','listing.stop',
      'price.update','inventory.update',
      'listing.lineage.verify','listing.publication.verify'
    )
    and new.status in ('queued','running','reconciliation_required');
  if not v_active_new then
    return new;
  end if;

  v_exact_new :=
    sellerpilot_private.qoo10_exact_s1_verifier_job_matches(new);
  if v_exact_new then
    -- Serialize verifier creation with any UPDATE/DELETE of the immutable
    -- reconciliation source.  The status predicate is deliberately part of
    -- the locking read: after waiting on a concurrent source mutation,
    -- PostgreSQL rechecks it against the latest row version and returns no
    -- row when that mutation moved the source out of reconciliation_required.
    perform 1
      from sellerpilot_private.channel_gateway_jobs source_job
     where source_job.id =
             'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
       and source_job.status = 'reconciliation_required'
     for update;

    if not found
       or not sellerpilot_private.qoo10_exact_s1_source_is_current()
       or exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs other_job
          where other_job.listing_id = new.listing_id
            and other_job.status in (
              'queued','running','reconciliation_required'
            )
            and other_job.operation in (
              'listing.create','listing.update','listing.stop',
              'price.update','inventory.update',
              'listing.lineage.verify','listing.publication.verify'
            )
            and other_job.id not in (
              new.id,
              'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
            )
       )
    then
      raise exception 'exact Qoo10 S1 verifier overlap is not current'
        using errcode = '55000';
    end if;
  elsif exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs verifier
     where verifier.listing_id = new.listing_id
       and verifier.id <> new.id
       and verifier.status in ('queued','running','reconciliation_required')
       and sellerpilot_private.qoo10_exact_s1_verifier_job_matches(verifier)
  ) then
    raise exception 'listing work overlaps the exact Qoo10 S1 verifier'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;

create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (
    listing_id,
    (
      case
        when listing_id =
               '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
         and channel = 'qoo10'
         and operation = 'listing.publication.verify'
         and credential_id =
               '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
         and seller_account_key =
               '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
         and request_fingerprint =
               '76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799'
         and request_payload->>'periodicKey' =
               'qoo10-exact-s1:fac9c5c4-940d-4600-88f3-8f97a069dfbf'
         and request_payload->'arguments'->'sellerpilotReadOnly' =
               'true'::jsonb
         and request_payload #>>
               '{arguments,sellerpilotQoo10ExactS1Recovery}' =
               'qoo10_exact_s1_verifier_v1'
         and request_payload #>>
               '{arguments,publicationReviewSourceJobId}' =
               'fac9c5c4-940d-4600-88f3-8f97a069dfbf'
         and request_payload #>> '{arguments,publicationReviewId}' =
               '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
         and request_payload #>> '{arguments,remoteId}' = '1217336970'
         and request_payload #>>
               '{arguments,publicationExpectedLocale}' = 'ja-JP'
          then 'qoo10_exact_s1_verifier_v1'
        else 'default'
      end
    )
  )
  where listing_id is not null
    and operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update',
      'listing.lineage.verify', 'listing.publication.verify'
    )
    and status in ('queued', 'running', 'reconciliation_required');

create trigger guard_qoo10_exact_s1_verifier_overlap
before insert or update or delete
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap();

comment on index
  sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx is
  'Serializes listing work while allowing one exact read-only Qoo10 S1 verifier to coexist only with its immutable reconciliation source.';

revoke all on function
  sellerpilot_private.qoo10_exact_s1_verifier_job_matches(
    sellerpilot_private.channel_gateway_jobs
  ),
  sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()
from public, anon, authenticated, service_role;

do $$
declare
  v_row_count bigint;
  v_row_fingerprint text;
begin
  select count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(
           job.id::text || ':' || job.status || ':' || job.operation || ':' ||
           coalesce(job.listing_id::text, ''), ',' order by job.id
         ), ''))
    into v_row_count, v_row_fingerprint
    from sellerpilot_private.channel_gateway_jobs job;

  if v_row_count::text is distinct from pg_catalog.current_setting(
       'sellerpilot.qoo10_s1_overlap_row_count', true
     )
     or v_row_fingerprint is distinct from pg_catalog.current_setting(
       'sellerpilot.qoo10_s1_overlap_row_fingerprint', true
     )
  then
    raise exception 'Qoo10 S1 overlap migration changed gateway rows'
      using errcode = '55000';
  end if;
end;
$$;

commit;
