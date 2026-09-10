-- Forward-only alias for the installed PostgreSQL-truncated escalation RPC.
-- Historical migration remains unchanged; no production application performed.
begin;
do $$ begin
  if to_regprocedure('public.sellerpilot_service_escalate_stale_smartstore_reply_acceptance_(integer)') is null then
    raise exception 'SMARTSTORE_STALE_REPLY_RPC_PREIMAGE_MISSING';
  end if;
end $$;
create function public.sellerpilot_service_escalate_smartstore_reply_v1(p_limit integer default 100)
returns jsonb language sql security invoker set search_path='' as $$
  select public.sellerpilot_service_escalate_stale_smartstore_reply_acceptance_(p_limit);
$$;
revoke all on function public.sellerpilot_service_escalate_smartstore_reply_v1(integer) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_escalate_smartstore_reply_v1(integer) to service_role;
notify pgrst,'reload schema';
commit;
