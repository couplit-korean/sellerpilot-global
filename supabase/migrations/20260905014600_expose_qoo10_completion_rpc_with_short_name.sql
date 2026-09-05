-- Follow-up to 20260905014400+14500. Do not rewrite applied history.
-- PostgreSQL truncates identifiers to 63 bytes. The 66-byte source spelling
-- was stored as `...activation_from_`, while PostgREST received the untruncated
-- URL and returned 404 before entering the function. Rename only that exact RPC
-- to a stable 57-byte name; preserve its body, grants, and GET-only semantics.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500146);

do $guard$
declare
  v_old regprocedure :=
    to_regprocedure('public.sellerpilot_service_complete_qoo10_shipping_s1_activation_from_(uuid,text,jsonb)');
  v_definition text;
begin
  if v_old is null
     or to_regprocedure(
          'public.sellerpilot_service_complete_qoo10_s1_activation_from_get(uuid,text,jsonb)'
        ) is not null
  then
    raise exception 'exact Qoo10 GET completion RPC rename preimage drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(v_old) into v_definition;
  if strpos(
       v_definition,
       'or not (sellerpilot_private.qoo10_shipping_s1_release_is_current(p_release_sha) or sellerpilot_private.qoo10_shipping_s1_completion_release_is_current(p_release_sha))'
     ) = 0
     or strpos(v_definition, 'e09ab646-19ef-4865-a79e-08baef769086') = 0
     or strpos(v_definition, 'providerMutationExecuted'',false') = 0
  then
    raise exception 'exact Qoo10 GET completion RPC body preimage drifted'
      using errcode = '55000';
  end if;
end
$guard$;

alter function
  public.sellerpilot_service_complete_qoo10_shipping_s1_activation_from_(
    uuid,text,jsonb
  )
  rename to sellerpilot_service_complete_qoo10_s1_activation_from_get;

revoke all on function
  public.sellerpilot_service_complete_qoo10_s1_activation_from_get(
    uuid,text,jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_complete_qoo10_s1_activation_from_get(
    uuid,text,jsonb
  ) to service_role;

comment on function
  public.sellerpilot_service_complete_qoo10_s1_activation_from_get(
    uuid,text,jsonb
  ) is
  'PostgREST-safe 57-byte name for the exact e09ab646 GET-only completion and immutable replay RPC; never executes or enqueues a provider mutation.';

commit;
