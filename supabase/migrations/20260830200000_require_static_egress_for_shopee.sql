-- Shopee rejected the production serverless OAuth token exchange before any
-- product mutation. Treat every Shopee provider call as fixed-egress work so
-- neither OAuth nor commerce operations can run until the exact Vercel source
-- address is registered with Shopee and attested in both runtime and database.

begin;

alter table sellerpilot_private.serverless_static_egress_policy
  drop constraint if exists serverless_static_egress_policy_channel_check;
alter table sellerpilot_private.serverless_static_egress_policy
  add constraint serverless_static_egress_policy_channel_check
  check (channel in (
    'coupang', 'smartstore', 'elevenst', 'temu', 'shopee'
  ));

-- Preserve every existing operator decision. The new channel is deliberately
-- false until the paid/static address and Shopee allowlist are both verified.
insert into sellerpilot_private.serverless_static_egress_policy (
  channel,
  enabled
) values ('shopee', false)
on conflict (channel) do nothing;

create or replace function sellerpilot_private.serverless_static_egress_allowed(
  p_channel text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  with request_header as (
    select lower(trim(coalesce(
      nullif(
        coalesce(
          nullif(current_setting('request.headers', true), ''),
          '{}'
        )::jsonb ->> 'x-sellerpilot-static-egress-channels',
        ''
      ),
      ''
    ))) as value
  ), entries as (
    select trim(entry) as channel
      from request_header,
           lateral unnest(regexp_split_to_array(request_header.value, '\s*,\s*')) entry
     where request_header.value <> ''
  )
  select coalesce(
    p_channel in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')
    and exists (
      select 1
        from sellerpilot_private.serverless_static_egress_policy policy
       where policy.channel = p_channel
         and policy.enabled
    )
    and exists (select 1 from entries where entries.channel = p_channel)
    and not exists (
      select 1
        from entries
       where entries.channel not in (
         'coupang', 'smartstore', 'elevenst', 'temu', 'shopee'
       )
          or entries.channel = ''
    ),
    false
  );
$$;

revoke all on function sellerpilot_private.serverless_static_egress_allowed(text)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_serverless_static_egress_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'coupang', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'coupang'
    ), false),
    'smartstore', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'smartstore'
    ), false),
    'elevenst', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'elevenst'
    ), false),
    'temu', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'temu'
    ), false),
    'shopee', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'shopee'
    ), false)
  )
  from sellerpilot_private.serverless_static_egress_policy policy;
$$;

revoke all on function public.sellerpilot_service_serverless_static_egress_status()
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_serverless_static_egress_status()
  to service_role;

-- The Lazada recovery wrapper delegates ordinary work to this exact claimant.
-- Rewrite only its existing fixed-egress predicate; abort the migration if the
-- released body is not the single expected version.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old_count integer;
  v_new_count integer;
  v_old constant text :=
    $old$job.channel not in ('coupang', 'smartstore', 'elevenst', 'temu')$old$;
  v_new constant text :=
    $new$job.channel not in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  v_old_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_old, '')))
      / length(v_old)
  end;
  v_new_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_new, '')))
      / length(v_new)
  end;
  if v_old_count = 0 and v_new_count = 1 then
    null;
  elsif v_old_count = 1 and v_new_count = 0 then
    v_rewritten := replace(v_definition, v_old, v_new);
    if v_rewritten = v_definition or position(v_old in v_rewritten) > 0 then
      raise exception 'Shopee serverless static-egress claim rewrite failed';
    end if;
    execute v_rewritten;
  else
    raise exception 'expected one serverless static-egress claim predicate';
  end if;
end;
$migration$;

-- Fixed-egress work must never fall through to the persistent/default gateway
-- when the bounded serverless claimant has no attested address.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old_count integer;
  v_new_count integer;
  v_old constant text :=
    $old$(
         j.channel in ('coupang', 'smartstore', 'elevenst', 'temu')
         and sellerpilot_private.serverless_gateway_job_allowed(
           j.channel,
           j.operation
         )
       )$old$;
  v_new constant text :=
    $new$(
         j.channel = 'shopee'
         or (
           sellerpilot_private.serverless_gateway_job_allowed(
             j.channel,
             j.operation
           )
           and j.channel in ('coupang', 'smartstore', 'elevenst', 'temu')
         )
       )$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  v_old_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_old, '')))
      / length(v_old)
  end;
  v_new_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_new, '')))
      / length(v_new)
  end;
  if v_old_count = 0 and v_new_count = 1 then
    null;
  elsif v_old_count = 1 and v_new_count = 0 then
    v_rewritten := replace(v_definition, v_old, v_new);
    if v_rewritten = v_definition or position(v_old in v_rewritten) > 0 then
      raise exception 'Shopee local static-egress handoff rewrite failed';
    end if;
    execute v_rewritten;
  else
    raise exception 'expected one local static-egress handoff predicate';
  end if;
end;
$migration$;

revoke all on function
  public.sellerpilot_183000_claim_serverless_gateway_unsafe(text, text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_11820_claim_gateway_unsafe(text, text)
  from public, anon, authenticated, service_role;

comment on table sellerpilot_private.serverless_static_egress_policy is
  'Fail-closed channel egress attestations; Shopee includes OAuth and all provider operations.';
comment on function public.sellerpilot_service_serverless_static_egress_status() is
  'Returns only boolean fixed-egress readiness, including Shopee; no provider secrets or payloads.';

commit;
