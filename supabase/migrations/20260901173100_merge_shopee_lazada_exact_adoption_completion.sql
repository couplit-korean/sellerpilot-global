begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

-- Production applied the exact Lazada gate before the pending exact Shopee
-- wrapper. A clean replay applies them by filename in the opposite order.
-- Converge both histories without replacing either exact contract or opening
-- the generic failed-listing lineage path.
do $merge_exact_shopee_lazada_adoption_completion$
declare
  v_public_definition text;
  v_predecessor_definition text;
  v_lazada_predicate_definition text;
  v_before text := $before$
         and sellerpilot_private.failed_ebay_lineage_discovery_allowed(
           v_listing.id
         )
       )
     )
     or v_listing.seller_account_key is not null
$before$;
  v_after text := $after$
         and sellerpilot_private.failed_ebay_lineage_discovery_allowed(
           v_listing.id
         )
       )
       and not sellerpilot_private.exact_lazada_live_adoption_allowed(
         v_listing.id,
         v_job.channel,
         v_job.request_payload
       )
     )
     or v_listing.seller_account_key is not null
$after$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_listing_lineage_verification(text,uuid,uuid,text,jsonb,text)'::regprocedure
  ) into v_public_definition;

  if pg_catalog.strpos(
       v_public_definition,
       'sellerpilot_09011715_complete_lineage_before_shopee_adoption'
     ) = 0
     or pg_catalog.strpos(
       v_public_definition,
       'sellerpilot_shopee_sg_existing_adoption_v1'
     ) = 0
     or pg_catalog.strpos(
       v_public_definition,
       'sellerpilotShopeeSgExistingAdoption'
     ) = 0
     or pg_catalog.strpos(v_public_definition, 'shopeeAdoption') = 0
     or pg_catalog.strpos(
       v_public_definition,
       'shopee_existing_adoption_attestations'
     ) = 0
     or pg_catalog.strpos(v_public_definition, '53717126190') = 0
     or pg_catalog.strpos(
       v_public_definition,
       'QA-20260823-CC-001'
     ) = 0
     or pg_catalog.strpos(v_public_definition, '1719148844') = 0 then
    raise exception 'exact Shopee adoption completion wrapper not found';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_09011715_complete_lineage_before_shopee_adoption(text,uuid,uuid,text,jsonb,text)'::regprocedure
  ) into v_predecessor_definition;

  if pg_catalog.strpos(v_predecessor_definition, v_after) = 0 then
    if pg_catalog.strpos(v_predecessor_definition, v_before) = 0 then
      raise exception 'exact Lazada adoption predecessor gate not found';
    end if;
    execute pg_catalog.replace(
      v_predecessor_definition,
      v_before,
      v_after
    );
    select pg_catalog.pg_get_functiondef(
      'public.sellerpilot_09011715_complete_lineage_before_shopee_adoption(text,uuid,uuid,text,jsonb,text)'::regprocedure
    ) into v_predecessor_definition;
  end if;

  if pg_catalog.strpos(v_predecessor_definition, v_after) = 0
     or (
       pg_catalog.length(v_predecessor_definition)
       - pg_catalog.length(pg_catalog.replace(
         v_predecessor_definition,
         'exact_lazada_live_adoption_allowed',
         ''
       ))
     ) / pg_catalog.length('exact_lazada_live_adoption_allowed') <> 1 then
    raise exception 'exact Lazada adoption completion gate not merged';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_lazada_live_adoption_allowed(uuid,text,jsonb)'::regprocedure
  ) into v_lazada_predicate_definition;
  if pg_catalog.strpos(
       v_lazada_predicate_definition,
       'exact_lazada_live_adoption_v1'
     ) = 0
     or pg_catalog.strpos(v_lazada_predicate_definition, '14976038919') = 0
     or pg_catalog.strpos(
       v_lazada_predicate_definition,
       '42021335-9793-4834-8cd5-b73169fd1f48'
     ) = 0 then
    raise exception 'exact Lazada adoption predicate identity mismatch';
  end if;
end;
$merge_exact_shopee_lazada_adoption_completion$;

comment on function public.sellerpilot_complete_listing_lineage_verification(
  text,uuid,uuid,text,jsonb,text
) is
  'Completes provider lineage with only the exact Shopee SG and exact Lazada MY adoption wrappers layered over the existing fail-closed ledger.';

commit;
