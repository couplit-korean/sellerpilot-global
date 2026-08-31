-- Qoo10 stores otherwise byte-identical item detail HTML after rewriting
-- heading tag names (h1 through h6) to paragraph tags.  Accept only that
-- observed source-to-provider transformation.  Preserve exact remote HTML
-- digests in the verifier observation and the activation readback.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
lock table sellerpilot_private.channel_gateway_jobs
  in share row exclusive mode;

do $guard$
declare
  v_row_count bigint;
  v_row_fingerprint text;
  v_history_table regclass;
  v_history_exact boolean := false;
  v_schema_preimage_exact boolean := false;
begin
  v_history_table := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
  if v_history_table is not null then
    select (
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
       )
    ) = 2 and not exists (
      select 1
        from supabase_migrations.schema_migrations migration
       where migration.version = '20260831056900'
    ) into v_history_exact;
  else
    -- Isolated deterministic schema replays do not have the Supabase CLI
    -- history schema.  Admit that shape only when the entire 568 postimage is
    -- byte-for-byte identical; the six 567 function preimages are pinned
    -- independently below.  A real Supabase target always takes the stricter
    -- history branch above, and a present-but-drifted history never falls back.
    select coalesce(
      pg_catalog.md5(pg_catalog.pg_get_indexdef(index_state.indexrelid)) =
        '442bcf841792a9276b53aa01dd67ce46'
      and (
        select pg_catalog.count(*)
          from (
            values
              (
                'sellerpilot_private.qoo10_exact_s1_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)',
                'b8c5fcf13d0ad928e5f316c5821b6834',false,'i','sql',true
              ),
              (
                'sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()',
                '81d0b342d24a6cadad217c0224933e64',true,'v','plpgsql',false
              )
          ) expected(
            signature,definition_md5,security_definer,volatility,language,is_strict
          )
          join pg_catalog.pg_proc proc
            on proc.oid = pg_catalog.to_regprocedure(expected.signature)
          join pg_catalog.pg_roles owner on owner.oid = proc.proowner
          join pg_catalog.pg_language language on language.oid = proc.prolang
         where pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) =
                 expected.definition_md5
           and owner.rolname = 'postgres'
           and language.lanname = expected.language
           and proc.prosecdef = expected.security_definer
           and proc.provolatile::text = expected.volatility
           and proc.proisstrict = expected.is_strict
           and proc.proconfig = array['search_path=""']::text[]
           and proc.proacl::text = '{postgres=X/postgres}'
      ) = 2
      and (
        select pg_catalog.count(*)
          from pg_catalog.pg_trigger trg
         where trg.tgrelid =
                 'sellerpilot_private.channel_gateway_jobs'::regclass
           and trg.tgname = 'guard_qoo10_exact_s1_verifier_overlap'
           and not trg.tgisinternal
           and trg.tgenabled = 'O'
           and trg.tgfoid =
                 'sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()'::regprocedure
           and pg_catalog.md5(pg_catalog.pg_get_triggerdef(trg.oid)) =
                 'c60e130c9706292d9123850b371d46bb'
      ) = 1,
      false
    ) into v_schema_preimage_exact
      from pg_catalog.pg_index index_state
     where index_state.indexrelid = pg_catalog.to_regclass(
       'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'
     );
  end if;

  if not coalesce(v_history_exact, false)
     and not (
       v_history_table is null
       and coalesce(v_schema_preimage_exact, false)
     )
  then
    raise exception 'exact Qoo10 heading-normalization migration history drifted'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
       'sellerpilot_private.qoo10_exact_item_matches_source(jsonb,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.qoo10_exact_activation_expectation_valid(jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.record_exact_qoo10_s1_observation(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.record_exact_qoo10_s1_activation_outcome(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.qoo10_exact_item_matches_source_056700(jsonb,jsonb,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.qoo10_exact_activation_expectation_valid_056700(jsonb,jsonb)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.record_exact_qoo10_s1_observation_056700(uuid)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.record_exact_qoo10_s1_activation_outcome_056700(uuid)'
     ) is not null
  then
    raise exception 'exact Qoo10 heading-normalization preimage drifted'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.count(*)
      from (
        values
          (
            'sellerpilot_private.qoo10_exact_item_matches_source(jsonb,jsonb,text)',
            '9f994129def91cbb490056c1c132afbd',false,'i',
            '{postgres=X/postgres}'
          ),
          (
            'sellerpilot_private.qoo10_exact_activation_expectation_valid(jsonb,jsonb)',
            'c72a81665a9056b8f688e41f7f2e4ee1',false,'i',
            '{postgres=X/postgres}'
          ),
          (
            'sellerpilot_private.record_exact_qoo10_s1_observation(uuid)',
            '9a77caf22ba76b524eb5ef066be02430',true,'v',
            '{postgres=X/postgres}'
          ),
          (
            'sellerpilot_private.record_exact_qoo10_s1_activation_outcome(uuid)',
            '565361c852404add762d59ca8e3dc2ac',true,'v',
            '{postgres=X/postgres}'
          ),
          (
            'sellerpilot_private.qoo10_exact_response_state_valid(jsonb,text,text,text,text,jsonb)',
            '8d6a46e7a05d2841ec63e90ba4608fc6',false,'i',
            '{postgres=X/postgres}'
          ),
          (
            'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)',
            '5f53ed40d87f7d7b816a01a54d8f0c4c',true,'v',
            '{postgres=X/postgres,service_role=X/postgres}'
          )
      ) expected(signature,definition_md5,security_definer,volatility,acl)
      join pg_catalog.pg_proc proc
        on proc.oid = pg_catalog.to_regprocedure(expected.signature)
      join pg_catalog.pg_roles owner on owner.oid = proc.proowner
      join pg_catalog.pg_language language on language.oid = proc.prolang
     where pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) =
             expected.definition_md5
       and owner.rolname = 'postgres'
       and language.lanname = 'plpgsql'
       and proc.prosecdef = expected.security_definer
       and proc.provolatile::text = expected.volatility
       and proc.proconfig = array['search_path=""']::text[]
       and proc.proacl::text = expected.acl
  ) <> 6
  then
    raise exception 'exact Qoo10 heading-normalization function preimage drifted'
      using errcode = '55000';
  end if;

  select count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(
           job.id::text || ':' || job.status || ':' || job.operation || ':' ||
           coalesce(job.listing_id::text, ''), ',' order by job.id
         ), ''))
    into v_row_count, v_row_fingerprint
    from sellerpilot_private.channel_gateway_jobs job;

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_heading_row_count', v_row_count::text, true
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_heading_row_fingerprint', v_row_fingerprint, true
  );
end;
$guard$;

create function sellerpilot_private.qoo10_canonical_provider_detail_html(
  p_source text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    p_source,
    '<(/?)h[1-6]([[:space:]/>])',
    E'<\\1p\\2',
    'gi'
  )
$$;

alter function sellerpilot_private.qoo10_exact_item_matches_source(
  jsonb,jsonb,text
) rename to qoo10_exact_item_matches_source_056700;

create function sellerpilot_private.qoo10_exact_item_matches_source(
  p_item jsonb,
  p_source_arguments jsonb,
  p_expected_status text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    sellerpilot_private.qoo10_exact_item_matches_source_056700(
      p_item,p_source_arguments,p_expected_status
    )
    or sellerpilot_private.qoo10_exact_item_matches_source_056700(
      p_item,
      pg_catalog.jsonb_set(
        p_source_arguments,
        '{params,ItemDescription}',
        pg_catalog.to_jsonb(
          sellerpilot_private.qoo10_canonical_provider_detail_html(
            p_source_arguments#>>'{params,ItemDescription}'
          )
        ),
        false
      ),
      p_expected_status
    )
$$;

alter function sellerpilot_private.qoo10_exact_activation_expectation_valid(
  jsonb,jsonb
) rename to qoo10_exact_activation_expectation_valid_056700;

create function sellerpilot_private.qoo10_exact_activation_expectation_valid(
  p_expectation jsonb,
  p_source_arguments jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    sellerpilot_private.qoo10_exact_activation_expectation_valid_056700(
      p_expectation,p_source_arguments
    )
    or sellerpilot_private.qoo10_exact_activation_expectation_valid_056700(
      p_expectation,
      pg_catalog.jsonb_set(
        p_source_arguments,
        '{params,ItemDescription}',
        pg_catalog.to_jsonb(
          sellerpilot_private.qoo10_canonical_provider_detail_html(
            p_source_arguments#>>'{params,ItemDescription}'
          )
        ),
        false
      )
    )
$$;

alter function sellerpilot_private.record_exact_qoo10_s1_observation(
  uuid
) rename to record_exact_qoo10_s1_observation_056700;

create function sellerpilot_private.record_exact_qoo10_s1_observation(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
  v_step jsonb;
  v_item jsonb;
  v_expectation jsonb;
  v_remote_html text;
begin
  select job.response_payload
    into v_response
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found or v_response is null then return false; end if;

  select step
    into v_step
    from pg_catalog.jsonb_array_elements(
      coalesce(v_response->'steps','[]'::jsonb)
    ) step
   where step->>'name' = 'qoo10-exact-s1-recovery-verification';
  if not found or (
    select count(*)
      from pg_catalog.jsonb_array_elements(
        coalesce(v_response->'steps','[]'::jsonb)
      ) step
     where step->>'name' = 'qoo10-exact-s1-recovery-verification'
  ) <> 1 then return false; end if;

  select item
    into v_item
    from sellerpilot_private.qoo10_exact_remote_items(
      v_step#>'{data,ResultObject}','1217336970'
    ) item;
  if not found or (
    select count(*)
      from sellerpilot_private.qoo10_exact_remote_items(
        v_step#>'{data,ResultObject}','1217336970'
      )
  ) <> 1 then return false; end if;

  if not sellerpilot_private.qoo10_exact_aliases_consistent(
       v_item,array['ItemDetail','ItemDescription','Description']
     )
  then return false; end if;
  v_remote_html := coalesce(
    v_item->>'ItemDetail',v_item->>'ItemDescription',
    v_item->>'Description',''
  );
  v_expectation := v_step#>'{data,sellerpilotQoo10ActivationExpectation}';
  if v_expectation->>'expectedDetailHtmlSha256' is distinct from
       pg_catalog.encode(
         extensions.digest(v_remote_html,'sha256'),'hex'
       )
  then return false; end if;

  return sellerpilot_private.record_exact_qoo10_s1_observation_056700(
    p_job_id
  );
exception when others then
  return false;
end;
$$;

alter function sellerpilot_private.record_exact_qoo10_s1_activation_outcome(
  uuid
) rename to record_exact_qoo10_s1_activation_outcome_056700;

create function sellerpilot_private.record_exact_qoo10_s1_activation_outcome(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_request jsonb;
  v_response jsonb;
  v_step jsonb;
  v_item jsonb;
  v_remote_html text;
  v_expected_digest text;
begin
  select job.status,job.request_payload,job.response_payload
    into v_status,v_request,v_response
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found then return false; end if;

  if v_status = 'succeeded' and v_response is not null then
    select step
      into v_step
      from pg_catalog.jsonb_array_elements(
        coalesce(v_response->'steps','[]'::jsonb)
      ) step
     where step->>'name' = 'qoo10-s1-activation-post-readback';
    if not found or (
      select count(*)
        from pg_catalog.jsonb_array_elements(
          coalesce(v_response->'steps','[]'::jsonb)
        ) step
       where step->>'name' = 'qoo10-s1-activation-post-readback'
    ) <> 1 then return false; end if;

    select item
      into v_item
      from sellerpilot_private.qoo10_exact_remote_items(
        v_step#>'{data,ResultObject}','1217336970'
      ) item;
    if not found or (
      select count(*)
        from sellerpilot_private.qoo10_exact_remote_items(
          v_step#>'{data,ResultObject}','1217336970'
        )
    ) <> 1 then return false; end if;

    if not sellerpilot_private.qoo10_exact_aliases_consistent(
         v_item,array['ItemDetail','ItemDescription','Description']
       )
    then return false; end if;
    v_remote_html := coalesce(
      v_item->>'ItemDetail',v_item->>'ItemDescription',
      v_item->>'Description',''
    );
    v_expected_digest := v_request#>>
      '{arguments,sellerpilotQoo10S1Activation,expectedDetailHtmlSha256}';
    if v_expected_digest is distinct from pg_catalog.encode(
         extensions.digest(v_remote_html,'sha256'),'hex'
       )
    then return false; end if;
  end if;

  return sellerpilot_private.record_exact_qoo10_s1_activation_outcome_056700(
    p_job_id
  );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_canonical_provider_detail_html(text),
  sellerpilot_private.qoo10_exact_item_matches_source_056700(jsonb,jsonb,text),
  sellerpilot_private.qoo10_exact_item_matches_source(jsonb,jsonb,text),
  sellerpilot_private.qoo10_exact_activation_expectation_valid_056700(jsonb,jsonb),
  sellerpilot_private.qoo10_exact_activation_expectation_valid(jsonb,jsonb),
  sellerpilot_private.record_exact_qoo10_s1_observation_056700(uuid),
  sellerpilot_private.record_exact_qoo10_s1_observation(uuid),
  sellerpilot_private.record_exact_qoo10_s1_activation_outcome_056700(uuid),
  sellerpilot_private.record_exact_qoo10_s1_activation_outcome(uuid)
from public, anon, authenticated, service_role;

comment on function
  sellerpilot_private.qoo10_canonical_provider_detail_html(text) is
  'Canonicalizes only the observed Qoo10 source heading-tag to provider paragraph-tag rewrite.';
comment on function
  sellerpilot_private.record_exact_qoo10_s1_observation(uuid) is
  'Records exact S1 evidence only when the activation expectation digest matches the exact provider HTML.';
comment on function
  sellerpilot_private.record_exact_qoo10_s1_activation_outcome(uuid) is
  'Records a succeeded activation only when the post-readback provider HTML exactly matches the armed digest.';

do $postcondition$
declare
  v_row_count bigint;
  v_row_fingerprint text;
  v_definition text;
begin
  if sellerpilot_private.qoo10_canonical_provider_detail_html(
       '<h1 class="x">A</h1><H6>B</H6><h10>C</h10><h1x>D</h1x>'
     ) is distinct from
       '<p class="x">A</p><p>B</p><h10>C</h10><h1x>D</h1x>'
  then
    raise exception 'Qoo10 heading canonicalization postcondition failed'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.count(*)
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
      join pg_catalog.pg_proc proc
        on proc.oid = pg_catalog.to_regprocedure(expected.signature)
      join pg_catalog.pg_roles owner on owner.oid = proc.proowner
      join pg_catalog.pg_language language on language.oid = proc.prolang
     where owner.rolname = 'postgres'
       and language.lanname = expected.language
       and pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) =
             expected.definition_md5
       and proc.prosecdef = expected.security_definer
       and proc.provolatile::text = expected.volatility
       and proc.proisstrict = expected.is_strict
       and proc.proconfig = array['search_path=""']::text[]
       and proc.proacl::text = '{postgres=X/postgres}'
  ) <> 9
  then
    raise exception 'Qoo10 heading-normalization function postimage drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
           'sellerpilot_private.qoo10_exact_response_state_valid(jsonb,text,text,text,text,jsonb)'::regprocedure
         )
    into v_definition;
  if v_definition not like
       '%sellerpilot_private.qoo10_exact_item_matches_source(%'
  then
    raise exception 'Qoo10 response validator caller binding drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
           'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
         )
    into v_definition;
  if v_definition not like
       '%sellerpilot_private.record_exact_qoo10_s1_observation(p_job_id)%'
     or v_definition not like
       '%sellerpilot_private.record_exact_qoo10_s1_activation_outcome(p_job_id)%'
  then
    raise exception 'Qoo10 completion caller binding drifted'
      using errcode = '55000';
  end if;

  select count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(
           job.id::text || ':' || job.status || ':' || job.operation || ':' ||
           coalesce(job.listing_id::text, ''), ',' order by job.id
         ), ''))
    into v_row_count, v_row_fingerprint
    from sellerpilot_private.channel_gateway_jobs job;

  if v_row_count::text is distinct from pg_catalog.current_setting(
       'sellerpilot.qoo10_heading_row_count', true
     )
     or v_row_fingerprint is distinct from pg_catalog.current_setting(
       'sellerpilot.qoo10_heading_row_fingerprint', true
     )
  then
    raise exception 'Qoo10 heading migration changed gateway rows'
      using errcode = '55000';
  end if;
end;
$postcondition$;

commit;
