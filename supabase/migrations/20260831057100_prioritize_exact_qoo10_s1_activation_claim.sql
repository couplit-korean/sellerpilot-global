-- The exact Qoo10 S1 activation permit expires two minutes after its verified
-- readback.  Periodic Qoo10 reads previously retained the generic queue order
-- and could consume every bounded serverless drain before the one-shot write
-- was claimed.  Add only one leading sort key to the two deployed underlying
-- claimants; every existing eligibility, concurrency, OAuth, static-egress,
-- credential and SKIP LOCKED fence remains authoritative.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

do $qoo10_exact_s1_priority_history$
declare
  v_history_table regclass;
  v_history_exact boolean := false;
  v_schema_preimage_exact boolean := false;
  v_local_sha text;
  v_serverless_sha text;
begin
  v_history_table := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
  if v_history_table is not null then
    select (
      select pg_catalog.count(*)
        from supabase_migrations.schema_migrations migration
       where migration.version = '20260831057000'
         and migration.name = 'retire_stale_qoo10_s1_verifier'
         and pg_catalog.cardinality(migration.statements) = 0
    ) = 1 and not exists (
      select 1
        from supabase_migrations.schema_migrations migration
       where migration.version = '20260831057100'
    ) into v_history_exact;
  else
    -- Isolated migration replays do not own Supabase CLI history. Admit only
    -- the exact clean post-570 schema with none of the production recovery
    -- rows. A real target with present-but-drifted history never reaches this
    -- branch and therefore cannot fall back to schema inference.
    select encode(extensions.digest(pg_catalog.pg_get_functiondef(
      'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
    ), 'sha256'), 'hex') into v_local_sha;
    select encode(extensions.digest(pg_catalog.pg_get_functiondef(
      'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
    ), 'sha256'), 'hex') into v_serverless_sha;
    select coalesce(
      (
        (
          v_local_sha =
            'c6c51378ef8d1542ed3611d434e4c6986fa2310d3b924c6be1d78d7f393b3f96'
          and v_serverless_sha =
            'a4533e53a0f310e43d01530130884054acf8497597720eecdb705cb3727c91ee'
        ) or (
          v_local_sha =
            '01f86b17fb6a84e4fd02c62ccabeb83dc599cb00604c3da093f742878df5bce7'
          and v_serverless_sha =
            '2de41863d8e2f495c5c96562eaf7014a726aebf876427722ea3a06443a2b7c24'
        )
      )
      and pg_catalog.to_regclass(
            'sellerpilot_private.qoo10_exact_s1_activation_permits'
          ) is not null
      and pg_catalog.to_regclass(
            'sellerpilot_private.qoo10_exact_s1_verifier_runs'
          ) is not null
      and pg_catalog.to_regclass(
            'sellerpilot_private.qoo10_exact_s1_observations'
          ) is not null
      and not exists (
        select 1
          from sellerpilot_private.channel_gateway_jobs job
         where job.id in (
           'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid,
           'ea191079-3016-4851-9f0c-4ce4281c1364'::uuid
         )
      )
      and not exists (
        select 1
          from sellerpilot_private.qoo10_exact_s1_verifier_runs
      )
      and not exists (
        select 1
          from sellerpilot_private.qoo10_exact_s1_activation_permits
      ),
      false
    ) into v_schema_preimage_exact;
  end if;

  if not coalesce(v_history_exact, false)
     and not (
       v_history_table is null
       and coalesce(v_schema_preimage_exact, false)
     )
  then
    raise exception 'exact Qoo10 activation priority migration history drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_exact_s1_priority_history$;

create function sellerpilot_private.qoo10_exact_s1_activation_claim_priority(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.qoo10_exact_s1_activation_permits permit
        on permit.activation_job_id = job.id
      join sellerpilot_private.qoo10_exact_s1_verifier_runs run
        on run.verifier_job_id = permit.verifier_job_id
      join sellerpilot_private.qoo10_exact_s1_observations observation
        on observation.verifier_job_id = permit.verifier_job_id
     where job.id = p_job_id
       and job.status = 'queued'
       and job.channel = 'qoo10'
       and job.operation = 'listing.activate'
       and job.environment = 'production'
       and job.attempt_count = 0
       and job.worker_token_id is null
       and job.claim_token is null
       and job.lease_expires_at is null
       and job.started_at is null
       and job.provider_mutation_started_at is null
       and job.response_payload is null
       and job.completed_at is null
       and job.credential_id = permit.credential_id
       and job.attempt_id = permit.activation_attempt_id
       and job.listing_id = permit.listing_id
       and job.seller_account_key = permit.seller_account_key
       and job.write_resource_kind = 'listing_mutation'
       and job.write_resource_key = permit.write_resource_key
       and job.request_fingerprint = permit.activation_request_sha256
       and octet_length(job.request_payload::text) =
             permit.activation_request_bytes
       and encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex') =
             permit.activation_request_sha256
       and job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}' =
             'qoo10_s1_activation_v1'
       and job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,verifierJobId}' =
             permit.verifier_job_id::text
       and job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,sourceJobId}' =
             permit.source_job_id::text
       and job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}' =
             permit.listing_id::text
       and job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}' =
             permit.remote_id
       and permit.contract = 'qoo10_exact_s1_activation_permit_v1'
       and permit.bound_at is null
       and permit.bound_worker_token_id is null
       and permit.bound_claim_token is null
       and permit.consumed_at is null
       and permit.invalidated_at is null
       and permit.invalidation_reason is null
       and permit.armed_at <= statement_timestamp()
       and permit.expires_at > statement_timestamp()
       and permit.expires_at =
             observation.verifier_completed_at + interval '2 minutes'
       and permit.source_job_id = run.source_job_id
       and permit.listing_id = run.listing_id
       and permit.credential_id = run.credential_id
       and permit.owner_id = run.owner_id
       and permit.remote_id = run.remote_id
       and permit.seller_account_key = run.seller_account_key
       and permit.release_sha = run.release_sha
       and observation.source_job_id = permit.source_job_id
       and observation.listing_id = permit.listing_id
       and observation.remote_id = permit.remote_id
       and observation.release_sha = permit.release_sha
       and observation.provider_status = 'S1'
       and observation.remote_visibility = 'non_public'
       and observation.contract = 'qoo10_exact_s1_observation_v1'
       and run.contract = 'qoo10_exact_s1_verifier_v1'
       and sellerpilot_private.qoo10_exact_s1_release_is_current(
             permit.release_sha
           )
       and sellerpilot_private.qoo10_exact_s1_source_is_current()
  ), false)
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_s1_activation_claim_priority(uuid)
  from public, anon, authenticated, service_role;

-- Patch the innermost persistent claimant.  The outer gateway-scope wrapper,
-- serialized-ledger wrappers and their exact delegation chain are checked but
-- not replaced.
do $qoo10_exact_s1_local_claim_priority$
declare
  v_outer text;
  v_scope_delegate text;
  v_serial_delegate text;
  v_definition text;
  v_rewritten text;
  v_pre_sha text;
  v_post_sha text;
  v_old_count integer;
  v_new_count integer;
  v_old constant text := $old$   order by
     case when j.prepared_credential_id is null then 1 else 0 end,$old$;
  v_new constant text := $new$   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)
         then 0
       else 1
     end,
     case when j.prepared_credential_id is null then 1 else 0 end,$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_channel_gateway_job(text,text)'::regprocedure
  ) into v_outer;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_260826_claim_gateway_unscoped(text,text)'::regprocedure
  ) into v_scope_delegate;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11840_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_serial_delegate;
  if v_outer is null
     or pg_catalog.strpos(
          v_outer,
          'perform sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim();'
        ) = 0
     or pg_catalog.strpos(
          v_outer,
          'public.sellerpilot_260826_claim_gateway_unscoped('
        ) = 0
     or pg_catalog.strpos(
          v_scope_delegate,
          'public.sellerpilot_11840_claim_gateway_unsafe('
        ) = 0
     or pg_catalog.strpos(
          v_serial_delegate,
          'public.sellerpilot_11820_claim_gateway_unsafe('
        ) = 0
  then
    raise exception 'local gateway claim wrapper chain drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  v_pre_sha := encode(
    extensions.digest(v_definition, 'sha256'),
    'hex'
  );
  v_old_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_old, '')))
      / length(v_old)
  end;
  v_new_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_new, '')))
      / length(v_new)
  end;
  if v_pre_sha not in (
       -- Observed production post-570 shape, including the Shopee handoff.
       'c6c51378ef8d1542ed3611d434e4c6986fa2310d3b924c6be1d78d7f393b3f96',
       -- Clean replay shape before the test-only delayed Shopee migration.
       '01f86b17fb6a84e4fd02c62ccabeb83dc599cb00604c3da093f742878df5bce7'
     )
     or v_old_count <> 1 or v_new_count <> 0
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.serverless_gateway_job_allowed('
        ) = 0
     or pg_catalog.strpos(v_definition, 'for update of j, c skip locked') = 0
  then
    raise exception 'local gateway claim priority preimage drifted'
      using errcode = '55000';
  end if;
  v_rewritten := replace(v_definition, v_old, v_new);
  v_post_sha := encode(
    extensions.digest(v_rewritten, 'sha256'),
    'hex'
  );
  if v_rewritten = v_definition
     or pg_catalog.strpos(v_rewritten, v_old) > 0
     or (
       length(v_rewritten) - length(replace(v_rewritten, v_new, ''))
     ) / length(v_new) <> 1
     or not (
       (
         v_pre_sha =
           'c6c51378ef8d1542ed3611d434e4c6986fa2310d3b924c6be1d78d7f393b3f96'
         and v_post_sha =
           'e607d71cbb12ac1f987b721781ac1520fba1720447e7511aac744ff8d48f3f1f'
       ) or (
         v_pre_sha =
           '01f86b17fb6a84e4fd02c62ccabeb83dc599cb00604c3da093f742878df5bce7'
         and v_post_sha =
           'e66c646d6af44e4c3429c85c151b8a04083c4d61f61dc9b38fdd0538659b3b45'
       )
     )
  then
    raise exception 'local gateway claim priority rewrite failed'
      using errcode = '55000';
  end if;
  execute v_rewritten;
end;
$qoo10_exact_s1_local_claim_priority$;

-- Patch only the innermost bounded serverless claimant.  The current Lazada
-- OAuth wrappers retain their broader pre-delegation ordering and locks.
do $qoo10_exact_s1_serverless_claim_priority$
declare
  v_outer text;
  v_lazada_delegate text;
  v_definition text;
  v_rewritten text;
  v_pre_sha text;
  v_post_sha text;
  v_old_count integer;
  v_new_count integer;
  v_old constant text := $old$   order by
     case when job.prepared_credential_id is null then 1 else 0 end,$old$;
  v_new constant text := $new$   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)
         then 0
       else 1
     end,
     case when job.prepared_credential_id is null then 1 else 0 end,$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure
  ) into v_outer;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_204000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into v_lazada_delegate;
  if v_outer is null
     or pg_catalog.strpos(
          v_outer,
          'perform sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim();'
        ) = 0
     or pg_catalog.strpos(
          v_outer,
          'public.sellerpilot_204000_claim_serverless_gateway_unsafe('
        ) = 0
     or pg_catalog.strpos(
          v_lazada_delegate,
          'public.sellerpilot_183000_claim_serverless_gateway_unsafe('
        ) = 0
  then
    raise exception 'serverless gateway claim wrapper chain drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  v_pre_sha := encode(
    extensions.digest(v_definition, 'sha256'),
    'hex'
  );
  v_old_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_old, '')))
      / length(v_old)
  end;
  v_new_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_new, '')))
      / length(v_new)
  end;
  if v_pre_sha not in (
       -- Observed production post-570 shape, including Shopee fixed egress.
       'a4533e53a0f310e43d01530130884054acf8497597720eecdb705cb3727c91ee',
       -- Clean replay shape before the test-only delayed Shopee migration.
       '2de41863d8e2f495c5c96562eaf7014a726aebf876427722ea3a06443a2b7c24'
     )
     or v_old_count <> 1 or v_new_count <> 0
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.serverless_static_egress_allowed(job.channel)'
        ) = 0
     or pg_catalog.strpos(v_definition, 'for update of job skip locked') = 0
     or pg_catalog.strpos(v_definition, 'for share of credential') = 0
  then
    raise exception 'serverless gateway claim priority preimage drifted'
      using errcode = '55000';
  end if;
  v_rewritten := replace(v_definition, v_old, v_new);
  v_post_sha := encode(
    extensions.digest(v_rewritten, 'sha256'),
    'hex'
  );
  if v_rewritten = v_definition
     or pg_catalog.strpos(v_rewritten, v_old) > 0
     or (
       length(v_rewritten) - length(replace(v_rewritten, v_new, ''))
     ) / length(v_new) <> 1
     or not (
       (
         v_pre_sha =
           'a4533e53a0f310e43d01530130884054acf8497597720eecdb705cb3727c91ee'
         and v_post_sha =
           'ffbb9fa90c827171641f17a0ab5dde49ff6251c509a29b56d99da713433229e3'
       ) or (
         v_pre_sha =
           '2de41863d8e2f495c5c96562eaf7014a726aebf876427722ea3a06443a2b7c24'
         and v_post_sha =
           '03eaf14f7368f92f36c45c1f2b6b910df55e1ab8bb62b9f28d278e74f9d59677'
       )
     )
  then
    raise exception 'serverless gateway claim priority rewrite failed'
      using errcode = '55000';
  end if;
  execute v_rewritten;
end;
$qoo10_exact_s1_serverless_claim_priority$;

do $qoo10_exact_s1_claim_priority_postimage$
declare
  v_local text;
  v_serverless text;
  v_local_sha text;
  v_serverless_sha text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_local;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into v_serverless;
  v_local_sha := encode(extensions.digest(v_local, 'sha256'), 'hex');
  v_serverless_sha := encode(
    extensions.digest(v_serverless, 'sha256'),
    'hex'
  );
  if not (
       (
         v_local_sha =
           'e607d71cbb12ac1f987b721781ac1520fba1720447e7511aac744ff8d48f3f1f'
         and v_serverless_sha =
           'ffbb9fa90c827171641f17a0ab5dde49ff6251c509a29b56d99da713433229e3'
       ) or (
         v_local_sha =
           'e66c646d6af44e4c3429c85c151b8a04083c4d61f61dc9b38fdd0538659b3b45'
         and v_serverless_sha =
           '03eaf14f7368f92f36c45c1f2b6b910df55e1ab8bb62b9f28d278e74f9d59677'
       )
     )
     or (
       length(v_local) - length(replace(
         v_local,
         'sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)',
         ''
       ))
     ) / length(
       'sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)'
     ) <> 1
     or (
       length(v_serverless) - length(replace(
         v_serverless,
         'sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)',
         ''
       ))
     ) / length(
       'sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)'
     ) <> 1
  then
    raise exception 'exact Qoo10 activation claim priority postimage drifted'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'sellerpilot_private'
       and procedure.proname = 'qoo10_exact_s1_activation_claim_priority'
       and (
         not procedure.prosecdef
         or procedure.provolatile <> 's'
         or procedure.proconfig is distinct from array['search_path=""']::text[]
       )
  ) or exists (
    select 1
      from (values
        ('public'::name),('anon'::name),('authenticated'::name),
        ('service_role'::name)
      ) role(role_name)
     where has_function_privilege(
       role.role_name,
       'sellerpilot_private.qoo10_exact_s1_activation_claim_priority(uuid)',
       'EXECUTE'
     )
  )
  then
    raise exception 'exact Qoo10 activation claim priority ACL drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_exact_s1_claim_priority_postimage$;

revoke all on function
  public.sellerpilot_11820_claim_gateway_unsafe(text, text),
  public.sellerpilot_183000_claim_serverless_gateway_unsafe(text, text)
  from public, anon, authenticated, service_role;

comment on function
  sellerpilot_private.qoo10_exact_s1_activation_claim_priority(uuid) is
  'Returns true only for the unclaimed, unexpired exact Qoo10 S1 activation permit whose release gate, source and immutable request lineage remain current.';

commit;
