-- The exact Qoo10 S1 activation wrapper added in 567 correctly validates and
-- binds its two-minute permit before delegating.  The original bounded
-- serverless provider marker, however, still has a second operation allowlist
-- from 282100 which predates listing.activate.  Patch only that innermost
-- marker: all existing token, ownership, claim, lease and dispatch fences stay
-- authoritative, and listing.activate is admitted only while the exact bound
-- permit independently remains valid.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

do $qoo10_exact_s1_provider_boundary_history$
declare
  v_history_table regclass;
  v_history_exact boolean := false;
  v_schema_preimage_exact boolean := false;
  v_pre_sha text;
begin
  v_history_table := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
  select encode(extensions.digest(pg_catalog.pg_get_functiondef(
    'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'::regprocedure
  ), 'sha256'), 'hex') into v_pre_sha;

  if v_history_table is not null then
    select (
      select pg_catalog.count(*)
        from supabase_migrations.schema_migrations migration
       where migration.version = '20260831057100'
         and migration.name = 'prioritize_exact_qoo10_s1_activation_claim'
         and pg_catalog.cardinality(migration.statements) = 0
    ) = 1 and not exists (
      select 1
        from supabase_migrations.schema_migrations migration
       where migration.version = '20260831057200'
    ) into v_history_exact;
  else
    -- A schema-only replay has no CLI history.  Admit only the exact clean
    -- post-571 preimage and no exact recovery rows; a hosted target with
    -- present-but-drifted history can never fall back to schema inference.
    select coalesce(
      v_pre_sha =
        '0c5c70e952cba84608b59bc04930d3627d49412d2a8d132f4d72d7f48ca0f407'
      and pg_catalog.to_regclass(
            'sellerpilot_private.qoo10_exact_s1_activation_permits'
          ) is not null
      and pg_catalog.to_regprocedure(
            'sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(uuid,uuid)'
          ) is not null
      and not exists (
        select 1
          from sellerpilot_private.qoo10_exact_s1_activation_permits
      ),
      false
    ) into v_schema_preimage_exact;
  end if;

  if v_pre_sha <>
       '0c5c70e952cba84608b59bc04930d3627d49412d2a8d132f4d72d7f48ca0f407'
     or (
       not coalesce(v_history_exact, false)
       and not (
         v_history_table is null
         and coalesce(v_schema_preimage_exact, false)
       )
     )
  then
    raise exception 'exact Qoo10 S1 provider-boundary preimage drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_exact_s1_provider_boundary_history$;

do $qoo10_exact_s1_provider_boundary_chain$
declare
  v_public_outer text;
  v_s1_delegate text;
  v_channel_delegate text;
  v_release_delegate text;
  v_dispatch_allowlist text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
  ) into v_public_outer;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_056700_begin_serverless_before_qoo10_s1_activation(text,uuid,uuid)'::regprocedure
  ) into v_s1_delegate;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate(text,uuid,uuid)'::regprocedure
  ) into v_channel_delegate;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)'::regprocedure
  ) into v_release_delegate;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.serverless_gateway_job_allowed(text,text)'::regprocedure
  ) into v_dispatch_allowlist;

  if v_public_outer is null
     or pg_catalog.strpos(
          v_public_outer,
          'sellerpilot_private.exact_qoo10_s1_activation_provider_allowed('
        ) = 0
     or pg_catalog.strpos(
          v_public_outer,
          'public.sellerpilot_056700_begin_serverless_before_qoo10_s1_activation('
        ) = 0
     or pg_catalog.strpos(
          v_public_outer,
          'sellerpilot_private.consume_exact_qoo10_s1_activation_provider('
        ) = 0
     or v_s1_delegate is null
     or pg_catalog.strpos(
          v_s1_delegate,
          'public.sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate('
        ) = 0
     or v_channel_delegate is null
     or pg_catalog.strpos(
          v_channel_delegate,
          'public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe('
        ) = 0
     or v_release_delegate is null
     or pg_catalog.strpos(
          v_release_delegate,
          'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate('
        ) = 0
     or v_dispatch_allowlist is null
     or pg_catalog.strpos(
          v_dispatch_allowlist,
          'p_operation = ''listing.activate'''
        ) = 0
     or pg_catalog.strpos(
          v_dispatch_allowlist,
          'p_channel = ''qoo10'''
        ) = 0
  then
    raise exception 'exact Qoo10 S1 serverless provider chain drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_exact_s1_provider_boundary_chain$;

create or replace function public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started boolean;
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash, p_job_id, p_claim_token, true
  ) then
    return false;
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set provider_mutation_started_at = coalesce(
           job.provider_mutation_started_at,
           clock_timestamp()
         ),
         updated_at = clock_timestamp()
    from sellerpilot_private.ai_cli_worker_tokens token
   where job.id = p_job_id
     and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,
       job.operation
     )
     and (
       job.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'inventory.update', 'inquiries.reply',
         'shipment.acknowledge', 'shipment.confirm'
       )
       or (
         job.operation = 'listing.activate'
         and sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
           p_job_id, p_claim_token
         )
       )
     )
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and token.id = job.worker_token_id
     and token.token_hash = p_token_hash
     and token.scope = 'serverless_cs'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
  returning true into v_started;

  return coalesce(v_started, false);
end;
$$;

revoke all on function
  public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;

do $qoo10_exact_s1_provider_boundary_postimage$
declare
  v_definition text;
  v_post_sha text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'::regprocedure
  ) into v_definition;
  v_post_sha := encode(
    extensions.digest(v_definition, 'sha256'),
    'hex'
  );
  if v_post_sha <>
       '968b6336c02432bd790445b90902548f6182e3b4128d2c533151d95c90347b06'
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.serverless_cs_job_is_owned('
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.serverless_gateway_job_allowed('
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.exact_qoo10_s1_activation_provider_allowed('
        ) = 0
     or pg_catalog.strpos(v_definition, 'token.scope = ''serverless_cs''') = 0
     or pg_catalog.strpos(v_definition, 'token.status = ''active''') = 0
     or pg_catalog.strpos(
          v_definition,
          'token.expires_at > clock_timestamp()'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'job.lease_expires_at > clock_timestamp()'
        ) = 0
     or pg_catalog.strpos(v_definition, 'job.claim_token = p_claim_token') = 0
     or pg_catalog.strpos(v_definition, 'job.status = ''running''') = 0
     or exists (
       select 1
         from (values
           ('public'::name),('anon'::name),('authenticated'::name),
           ('service_role'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)',
          'EXECUTE'
        )
     )
  then
    raise exception 'exact Qoo10 S1 provider-boundary postimage drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_exact_s1_provider_boundary_postimage$;

comment on function
  public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
    text, uuid, uuid
  ) is
  'Innermost bounded serverless provider marker. Existing operations retain their fences; listing.activate is allowed only by the still-valid bound exact Qoo10 S1 activation permit.';

commit;
