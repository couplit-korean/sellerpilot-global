-- PostgreSQL truncated the original overlong RPC name. PostgREST callers need
-- this short public name; keep the installed implementation and its checks.
begin;
set local lock_timeout='2s';
do $guard$ begin
if to_regprocedure('public.sellerpilot_service_enqueue_due_publication_rechecks(integer)') is not null then raise exception 'PUBLICATION_RECHECK_ALIAS_ALREADY_EXISTS';end if;
if (select md5(prosrc) from pg_proc where oid='public.sellerpilot_service_enqueue_due_listing_publication_verificatio(integer)'::regprocedure) is distinct from '249555597c54e1830e6a50ae5f0441a5' then raise exception 'PUBLICATION_RECHECK_PREIMAGE_DRIFT';end if;
end $guard$;
create function public.sellerpilot_service_enqueue_due_publication_rechecks(p_limit integer default 14)
returns jsonb language sql security definer set search_path='' as $$
  select public.sellerpilot_service_enqueue_due_listing_publication_verificatio(p_limit)
$$;
revoke all on function public.sellerpilot_service_enqueue_due_publication_rechecks(integer) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_enqueue_due_publication_rechecks(integer) to service_role;
commit;
