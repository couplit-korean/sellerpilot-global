-- Finalize the release against both a clean repository replay and the live
-- production function shapes. The production project already has later
-- marketplace recovery migrations, so this forward migration deliberately
-- matches semantic SQL tokens with whitespace-tolerant regular expressions.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900801000);

do $restore_qoo10_observed_shipping_identity$
declare
  v_definition text;
  v_projection_pattern constant text :=
    $pattern$confirmation[.]shipping_no,[[:space:]]+confirmation[.]bi_contents_no$pattern$;
  v_join_pattern constant text :=
    $pattern$from[[:space:]]+sellerpilot_private[.]qoo10_listing_create_rollback_confirmations[[:space:]]+confirmation[[:space:]]+join[[:space:]]+sellerpilot_private[.]product_listings[[:space:]]+listing$pattern$;
  v_projection_replacement constant text := $replacement$coalesce(
           shipping_observation.observed_shipping_no,
           confirmation.shipping_no
         ) as shipping_no,
         confirmation.bi_contents_no$replacement$;
  v_join_replacement constant text := $replacement$from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    left join lateral (
      select observation.observed_shipping_no
        from sellerpilot_private.qoo10_listing_update_rejection_observations
          observation
       where observation.source_job_id = confirmation.source_job_id
         and observation.source_attempt_id = confirmation.source_attempt_id
         and observation.listing_id = confirmation.listing_id
         and observation.credential_id = confirmation.credential_id
         and observation.remote_id = confirmation.remote_id
         and observation.source_shipping_no = confirmation.shipping_no
         and observation.provider_status = 'S1'
         and not observation.provider_mutation_accepted
       order by observation.observed_at desc, observation.update_job_id desc
       limit 1
    ) shipping_observation on true
    join sellerpilot_private.product_listings listing$replacement$;
  v_projection_before integer;
  v_join_before integer;
  v_projection_after integer;
  v_join_after integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_definition;

  select count(*) into v_projection_before
    from pg_catalog.regexp_matches(v_definition, v_projection_pattern, 'g');
  select count(*) into v_join_before
    from pg_catalog.regexp_matches(v_definition, v_join_pattern, 'g');
  select count(*) into v_projection_after
    from pg_catalog.regexp_matches(
      v_definition,
      $pattern$shipping_observation[.]observed_shipping_no$pattern$,
      'g'
    );
  select count(*) into v_join_after
    from pg_catalog.regexp_matches(
      v_definition,
      $pattern$sellerpilot_private[.]qoo10_listing_update_rejection_observations$pattern$,
      'g'
    );

  if v_projection_after = 1 and v_join_after = 1 then
    if v_projection_before <> 1 or v_join_before <> 0 then
      raise exception 'Qoo10 observed shipping identity partial postimage'
        using errcode = '55000';
    end if;
  elsif v_projection_after = 0 and v_join_after = 0
        and v_projection_before = 1 and v_join_before = 1 then
    v_definition := pg_catalog.regexp_replace(
      v_definition,
      v_projection_pattern,
      v_projection_replacement,
      'g'
    );
    v_definition := pg_catalog.regexp_replace(
      v_definition,
      v_join_pattern,
      v_join_replacement,
      'g'
    );
    execute v_definition;
  else
    raise exception
      'Qoo10 observed shipping identity preimage drifted projection_before=% join_before=% projection_after=% join_after=%',
      v_projection_before, v_join_before, v_projection_after, v_join_after
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_definition;
  select count(*) into v_projection_after
    from pg_catalog.regexp_matches(
      v_definition,
      $pattern$shipping_observation[.]observed_shipping_no$pattern$,
      'g'
    );
  select count(*) into v_join_after
    from pg_catalog.regexp_matches(
      v_definition,
      $pattern$sellerpilot_private[.]qoo10_listing_update_rejection_observations$pattern$,
      'g'
    );
  if v_projection_after <> 1
     or v_join_after <> 1
     or pg_catalog.strpos(
          v_definition,
          'coalesce'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'observation.source_shipping_no = confirmation.shipping_no'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'not observation.provider_mutation_accepted'
        ) = 0
  then
    raise exception 'Qoo10 observed shipping identity postimage drifted'
      using errcode = '55000';
  end if;
end;
$restore_qoo10_observed_shipping_identity$;

revoke all on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

comment on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) is
  'Service-only Qoo10 rollback update identity; uses the latest exact immutable provider observation for the delivery group.';

do $keep_shopee_restricted_operations_local$
declare
  v_definition text;
  v_anchor_pattern constant text :=
    $pattern$and[[:space:]]+sellerpilot_private[.]serverless_gateway_job_allowed[(][[:space:]]+job[.]channel,[[:space:]]+job[.]operation[[:space:]]+[)]$pattern$;
  v_exclusion_pattern constant text :=
    $pattern$and[[:space:]]+not[[:space:]]+[(][[:space:]]*job[.]channel[[:space:]]*=[[:space:]]*'shopee'[[:space:]]+and[[:space:]]+job[.]operation[[:space:]]+in[[:space:]]*[(][[:space:]]*'categories[.]list',[[:space:]]*'categories[.]suggest',[[:space:]]*'categories[.]attributes',[[:space:]]*'categories[.]validate',[[:space:]]*'diagnostic[.]test'[[:space:]]*[)][[:space:]]*[)]$pattern$;
  v_exclusion constant text := $replacement$and not (
       job.channel = 'shopee'
       and job.operation in (
         'categories.list', 'categories.suggest',
         'categories.attributes', 'categories.validate',
         'diagnostic.test'
       )
     )$replacement$;
  v_anchor_count integer;
  v_exclusion_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into strict v_definition;
  select count(*) into v_anchor_count
    from pg_catalog.regexp_matches(v_definition, v_anchor_pattern, 'g');
  select count(*) into v_exclusion_count
    from pg_catalog.regexp_matches(v_definition, v_exclusion_pattern, 'g');

  if v_anchor_count <> 2 then
    raise exception 'Shopee local-only claimant anchor drifted count=%',
      v_anchor_count using errcode = '55000';
  end if;
  if v_exclusion_count = 0 then
    v_definition := pg_catalog.regexp_replace(
      v_definition,
      v_anchor_pattern,
      v_exclusion || E'\n     \\&',
      'g'
    );
    execute v_definition;
  elsif v_exclusion_count <> 2 then
    raise exception 'Shopee local-only claimant partial postimage count=%',
      v_exclusion_count using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into strict v_definition;
  select count(*) into v_anchor_count
    from pg_catalog.regexp_matches(v_definition, v_anchor_pattern, 'g');
  select count(*) into v_exclusion_count
    from pg_catalog.regexp_matches(v_definition, v_exclusion_pattern, 'g');
  if v_anchor_count <> 2
     or v_exclusion_count <> 2
     or pg_catalog.strpos(v_definition, 'for update of job skip locked') = 0
     or pg_catalog.strpos(
          v_definition,
          $$job.channel is distinct from 'smartstore'$$
        ) = 0
  then
    raise exception
      'Shopee local-only claimant postimage drifted anchor=% exclusion=%',
      v_anchor_count, v_exclusion_count
      using errcode = '55000';
  end if;
end;
$keep_shopee_restricted_operations_local$;

revoke all on function
  public.sellerpilot_183000_claim_serverless_gateway_unsafe(text, text)
  from public, anon, authenticated, service_role;

comment on function
  public.sellerpilot_183000_claim_serverless_gateway_unsafe(text, text) is
  'Innermost serverless claimant; Smartstore and Shopee category/diagnostic jobs remain on the registered local gateway.';

commit;
