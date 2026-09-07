-- Let the Coupang-only publication gate consume the immutable reconciliation
-- proof produced by the exact GET-only verifier. The retained source CREATE
-- remains reconciliation_required; only the scoped counter interpretation
-- changes. Global, Qoo10, and SmartStore gate behavior stays untouched.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

do $dependencies$
declare
  current_status_definition text;
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_listing_mutation_release_gate_status()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()'
     ) is null then
    raise exception 'COUPANG_SCOPED_RECONCILIATION_GATE_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
           'public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure
         )
    into current_status_definition;
  if pg_catalog.strpos(
       current_status_definition,
       'sellerpilot_071510_listing_gate_status_pre_smartstore_scope'
     ) = 0 then
    raise exception 'COUPANG_SCOPED_RECONCILIATION_STATUS_CHAIN_DRIFT'
      using errcode = '55000';
  end if;
end;
$dependencies$;

do $patch_scoped_setter$
declare
  procedure_name constant regprocedure :=
    'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'::regprocedure;
  definition text;
  before_fragment constant text := E'when ''smartstore'' then\n                 not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)\n               else true';
  after_fragment constant text := E'when ''coupang'' then\n                 not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)\n               when ''smartstore'' then\n                 not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)\n               else true';
  hit_count integer;
begin
  select pg_catalog.pg_get_functiondef(procedure_name) into definition;

  if pg_catalog.strpos(definition, after_fragment) > 0 then
    return;
  end if;

  select (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, before_fragment, ''))
  ) / pg_catalog.length(before_fragment)
    into hit_count;
  if hit_count <> 1 then
    raise exception 'COUPANG_SCOPED_RECONCILIATION_SETTER_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  execute pg_catalog.replace(definition, before_fragment, after_fragment);
end;
$patch_scoped_setter$;

do $patch_scoped_status$
declare
  procedure_name constant regprocedure :=
    'public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()'::regprocedure;
  definition text;
  before_fragment constant text := E'where job.channel = ''coupang''\n           and job.operation in (\n             ''listing.create'', ''listing.update'', ''listing.stop''\n           )\n           and job.status = ''reconciliation_required''';
  after_fragment constant text := E'where job.channel = ''coupang''\n           and job.operation in (\n             ''listing.create'', ''listing.update'', ''listing.stop''\n           )\n           and job.status = ''reconciliation_required''\n           and not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)';
  hit_count integer;
begin
  select pg_catalog.pg_get_functiondef(procedure_name) into definition;

  if pg_catalog.strpos(definition, after_fragment) > 0 then
    return;
  end if;

  select (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, before_fragment, ''))
  ) / pg_catalog.length(before_fragment)
    into hit_count;
  if hit_count <> 1 then
    raise exception 'COUPANG_SCOPED_RECONCILIATION_STATUS_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  execute pg_catalog.replace(definition, before_fragment, after_fragment);
end;
$patch_scoped_status$;

do $postflight$
declare
  setter_definition text;
  scoped_status_definition text;
  current_status_definition text;
  setter_marker constant text := E'when ''coupang'' then\n                 not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)';
  status_marker constant text := E'where job.channel = ''coupang''\n           and job.operation in (\n             ''listing.create'', ''listing.update'', ''listing.stop''\n           )\n           and job.status = ''reconciliation_required''\n           and not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)';
begin
  select pg_catalog.pg_get_functiondef(
           'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'::regprocedure
         )
    into setter_definition;
  select pg_catalog.pg_get_functiondef(
           'public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()'::regprocedure
         )
    into scoped_status_definition;
  select pg_catalog.pg_get_functiondef(
           'public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure
         )
    into current_status_definition;

  if pg_catalog.strpos(setter_definition, setter_marker) = 0
     or pg_catalog.strpos(scoped_status_definition, status_marker) = 0
     or pg_catalog.strpos(
          current_status_definition,
          'sellerpilot_071510_listing_gate_status_pre_smartstore_scope'
        ) = 0 then
    raise exception 'COUPANG_SCOPED_RECONCILIATION_GATE_POSTFLIGHT_FAILED'
      using errcode = '55000';
  end if;
end;
$postflight$;

comment on function public.sellerpilot_service_set_listing_channel_mutation_release_gate(
  text,
  boolean,
  text
) is
  'Opens one exact-release Qoo10, Coupang, or SmartStore scope after selected-channel reviews, queue and evidence-based reconciliation checks, and global running-job drain. Exact Coupang GET-only receipts satisfy reconciliation through listing_mutation_reconciliation_resolved without changing the retained source job.';

commit;
