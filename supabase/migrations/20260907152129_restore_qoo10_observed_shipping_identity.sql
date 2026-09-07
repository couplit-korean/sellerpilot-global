-- Restore the observed Qoo10 delivery group in the service-only rollback
-- identity. 20260904222000 broadened the accepted rollback readback shapes
-- but recreated this projection from the original confirmation row, which
-- contains the create-time ShippingNo=0. A later, immutable provider
-- rejection observation may prove the real delivery group (for example
-- 806971), and listing.update must use that observed value.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

do $restore_qoo10_observed_shipping_identity$
declare
  v_definition text;
  v_projection_before constant text :=
    $before$         confirmation.shipping_no,
         confirmation.bi_contents_no$before$;
  v_projection_after constant text :=
    $after$         coalesce(
           shipping_observation.observed_shipping_no,
           confirmation.shipping_no
         ) as shipping_no,
         confirmation.bi_contents_no$after$;
  v_join_before constant text :=
    $before$    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.product_listings listing$before$;
  v_join_after constant text :=
    $after$    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
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
    join sellerpilot_private.product_listings listing$after$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_definition;

  if pg_catalog.strpos(v_definition, v_projection_after) > 0
     and pg_catalog.strpos(v_definition, v_join_after) > 0 then
    return;
  end if;

  if sellerpilot_private.qoo10_definition_occurrences(
       v_definition, v_projection_before
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
       v_definition, v_join_before
     ) <> 1
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.qoo10_listing_update_rejection_observations'
        ) > 0 then
    raise exception 'Qoo10 observed shipping identity preimage drifted'
      using errcode = '55000';
  end if;

  v_definition := pg_catalog.replace(
    v_definition, v_projection_before, v_projection_after
  );
  v_definition := pg_catalog.replace(
    v_definition, v_join_before, v_join_after
  );
  execute v_definition;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_definition;
  if sellerpilot_private.qoo10_definition_occurrences(
       v_definition, v_projection_after
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
       v_definition, v_join_after
     ) <> 1 then
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

commit;
