-- Operator-verified 2026-09-04: 11st and Smartstore policy rows are enabled,
-- and PostgREST does not forward x-sellerpilot-static-egress-channels on the
-- drain RPC. Keep fail-closed for coupang/temu/shopee oauth.exchange (header
-- still required). elevenst/smartstore may claim when the policy row is on.
-- This matches the live SQL hotfix applied in the operator console.

begin;

create or replace function sellerpilot_private.serverless_static_egress_allowed(
  p_channel text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      p_channel in ('elevenst', 'smartstore')
      and exists (
        select 1
          from sellerpilot_private.serverless_static_egress_policy policy
         where policy.channel = p_channel
           and policy.enabled
      )
    )
    or (
      p_channel in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')
      and exists (
        select 1
          from sellerpilot_private.serverless_static_egress_policy policy
         where policy.channel = p_channel
           and policy.enabled
      )
      and p_channel = any (
        regexp_split_to_array(
          lower(trim(coalesce(
            nullif(
              coalesce(
                nullif(current_setting('request.headers', true), ''),
                '{}'
              )::jsonb ->> 'x-sellerpilot-static-egress-channels',
              ''
            ),
            ''
          ))),
          '\s*,\s*'
        )
      )
      and not exists (
        select 1
          from unnest(regexp_split_to_array(
            lower(trim(coalesce(
              nullif(
                coalesce(
                  nullif(current_setting('request.headers', true), ''),
                  '{}'
                )::jsonb ->> 'x-sellerpilot-static-egress-channels',
                ''
              ),
              ''
            ))),
            '\s*,\s*'
          )) entry
         where trim(entry) not in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')
            or trim(entry) = ''
      )
    ),
    false
  );
$$;

revoke all on function sellerpilot_private.serverless_static_egress_allowed(text)
  from public, anon, authenticated, service_role;

commit;
