-- Preserve installed 63-byte implementations and expose exact PostgREST names.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
select pg_catalog.pg_advisory_xact_lock(193674993,907172000);
do $dependencies$
begin
  if to_regprocedure('public.sellerpilot_service_enqueue_due_listing_publication_verificatio(integer)') is null
     or to_regprocedure('public.sellerpilot_service_complete_marketplace_normalized_asset_clean(uuid,text[],text)') is null
     or to_regprocedure('sellerpilot_private.request_has_unambiguous_service_role_claim()') is null then
    raise exception 'BACKGROUND_RPC_IMPLEMENTATION_MISSING';
  end if;
end;
$dependencies$;

create function public.sellerpilot_service_enqueue_due_publication_reviews(p_limit integer default 14)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  previous_role text := current_setting('request.jwt.claim.role',true);
  result jsonb;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode='42501';
  end if;
  -- Older nested implementations read only the legacy GUC. Normalize it only
  -- after validating both claim formats and restore the caller on every exit.
  perform set_config('request.jwt.claim.role','service_role',true);
  begin
    result := public.sellerpilot_service_enqueue_due_listing_publication_verificatio(p_limit);
  exception when others then
    perform set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
    raise;
  end;
  perform set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
  return result;
end;
$$;
create function public.sellerpilot_service_complete_normalized_asset_cleanup(
  p_claim_token uuid,p_removed_paths text[],p_error text default null
)
returns jsonb language sql security definer set search_path = '' as $$
  select public.sellerpilot_service_complete_marketplace_normalized_asset_clean(
    p_claim_token,p_removed_paths,p_error
  )
$$;

revoke all on function public.sellerpilot_service_enqueue_due_publication_reviews(integer),
  public.sellerpilot_service_complete_normalized_asset_cleanup(uuid,text[],text)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_enqueue_due_publication_reviews(integer),
  public.sellerpilot_service_complete_normalized_asset_cleanup(uuid,text[],text)
  to service_role;
notify pgrst, 'reload schema';
commit;
