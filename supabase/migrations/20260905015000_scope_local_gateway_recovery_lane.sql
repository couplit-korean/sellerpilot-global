-- Scoped local recovery claim lane. 11820 SELECT WHERE gains a transaction-local
-- GUC filter so a Mac worker can claim only (Shopee oauth.exchange) or
-- (Smartstore supported reads). Existing 11820 gateway/auth/routing/identity
-- binding fences stay in the original claimant. Generic 11820 housekeeping is
-- not bypassed. Do not rewrite recon/queued source rows. Do not patch 183000.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500150);

do $local_gateway_recovery_lane$
declare
  v_11820 text;
  v_queued text := $queued$where j.status = 'queued'$queued$;
  v_guc_marker text := $guc$sellerpilot.local_gateway_recovery_lane$guc$;
  v_lane text := $lane$where j.status = 'queued'
     and (
       coalesce(current_setting('sellerpilot.local_gateway_recovery_lane', true), '')
         is distinct from 'enabled'
       or (
         (j.channel = 'shopee' and j.operation = 'oauth.exchange')
         or (
           j.channel = 'smartstore'
           and j.operation in (
             'diagnostic.test',
             'categories.list',
             'categories.suggest',
             'categories.attributes',
             'categories.validate',
             'inquiries.list',
             'listing.publication.verify'
           )
         )
       )
     )$lane$;
  v_11820_where integer;
  v_11820_order_rel integer;
  v_queued_hits integer;
  v_guc_at integer;
  v_skip boolean;
begin
  if pg_catalog.length('sellerpilot_claim_local_gateway_recovery_job') >= 63 then
    raise exception 'local gateway recovery rpc identifier exceeds 63 bytes'
      using errcode = '55000';
  end if;
  if to_regprocedure(
       'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'
     ) is null
     or to_regprocedure(
       'public.sellerpilot_claim_channel_gateway_job(text,text)'
     ) is null
  then
    raise exception 'local gateway recovery claim function missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_11820;

  v_11820_where := pg_catalog.strpos(v_11820, v_queued);
  if v_11820_where = 0 then
    raise exception 'local gateway recovery 11820 claim WHERE missing'
      using errcode = '55000';
  end if;
  v_11820_order_rel := pg_catalog.strpos(
    pg_catalog.substr(v_11820, v_11820_where),
    'order by'
  );
  if v_11820_order_rel = 0 then
    raise exception 'local gateway recovery 11820 claim ORDER BY missing after WHERE'
      using errcode = '55000';
  end if;

  v_guc_at := pg_catalog.strpos(v_11820, v_guc_marker);
  v_skip := v_guc_at > v_11820_where
    and v_guc_at < v_11820_where + v_11820_order_rel
    and pg_catalog.strpos(v_11820, v_lane) > 0;

  if v_guc_at > 0 and not v_skip then
    raise exception 'local gateway recovery 11820 GUC marker is not in claim WHERE'
      using errcode = '55000';
  end if;

  if not v_skip then
    v_queued_hits := (
      pg_catalog.length(v_11820)
      - pg_catalog.length(pg_catalog.replace(v_11820, v_queued, ''))
    ) / pg_catalog.length(v_queued);
    if v_queued_hits <> 1 then
      raise exception
        'local gateway recovery 11820 SELECT WHERE preimage drifted hits=%',
        v_queued_hits
        using errcode = '55000';
    end if;
    if v_11820_where + v_11820_order_rel
         <= v_11820_where + pg_catalog.length(v_queued)
    then
      raise exception 'local gateway recovery 11820 ORDER BY overlaps WHERE needle'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_11820, v_queued, v_lane);
    select pg_catalog.pg_get_functiondef(
      'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
    ) into v_11820;
    v_11820_where := pg_catalog.strpos(v_11820, v_queued);
    v_11820_order_rel := pg_catalog.strpos(
      pg_catalog.substr(v_11820, v_11820_where),
      'order by'
    );
    v_guc_at := pg_catalog.strpos(v_11820, v_guc_marker);
  end if;

  if v_11820_where = 0
     or v_11820_order_rel = 0
     or v_guc_at <= v_11820_where
     or v_guc_at >= v_11820_where + v_11820_order_rel
     or pg_catalog.strpos(v_11820, v_lane) < v_11820_where
     or pg_catalog.strpos(v_11820, v_lane)
          > v_11820_where + v_11820_order_rel
     or (
       pg_catalog.length(v_11820)
       - pg_catalog.length(pg_catalog.replace(v_11820, v_guc_marker, ''))
     ) / pg_catalog.length(v_guc_marker) <> 1
     or pg_catalog.strpos(v_11820, $keep$j.channel in ('coupang', 'temu')$keep$) = 0
     or pg_catalog.strpos(
          v_11820,
          $$false and serverless_token.scope = 'serverless_cs'$$
        ) = 0
     or pg_catalog.strpos(
          v_11820,
          $$false and j.channel = 'shopee'$$
        ) = 0
     or pg_catalog.strpos(v_11820, 'qoo10_shipping_s1_verifier_job_matches') = 0
     or pg_catalog.strpos(
          v_11820,
          'qoo10_shipping_s1_activation_job_matches'
        ) = 0
     or pg_catalog.strpos(
          v_11820,
          'qoo10_shipping_s1_verifier_job_matches'
        ) > v_11820_where + v_11820_order_rel
     or pg_catalog.strpos(
          v_11820,
          'qoo10_shipping_s1_activation_job_matches'
        ) > v_11820_where + v_11820_order_rel
     or pg_catalog.strpos(
          pg_catalog.substr(v_11820, v_11820_where + v_11820_order_rel),
          v_guc_marker
        ) > 0
  then
    raise exception 'local gateway recovery 11820 postimage drifted'
      using errcode = '55000';
  end if;
end;
$local_gateway_recovery_lane$;

create or replace function public.sellerpilot_claim_local_gateway_recovery_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $recovery_lane$
declare
  v_prior text;
  v_result jsonb;
begin
  v_prior := coalesce(
    current_setting('sellerpilot.local_gateway_recovery_lane', true),
    ''
  );
  perform pg_catalog.set_config(
    'sellerpilot.local_gateway_recovery_lane',
    'enabled',
    true
  );
  begin
    v_result := public.sellerpilot_claim_channel_gateway_job(
      p_token_hash,
      p_worker_version
    );
  exception
    when others then
      perform pg_catalog.set_config(
        'sellerpilot.local_gateway_recovery_lane',
        v_prior,
        true
      );
      raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.local_gateway_recovery_lane',
    v_prior,
    true
  );
  return v_result;
end;
$recovery_lane$;

revoke all on function public.sellerpilot_claim_local_gateway_recovery_job(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_local_gateway_recovery_job(text, text)
  to service_role;

comment on function
  public.sellerpilot_claim_local_gateway_recovery_job(text, text) is
  'Transaction-local recovery wrapper; sets sellerpilot.local_gateway_recovery_lane=enabled then reuses public.sellerpilot_claim_channel_gateway_job without loosening gateway/auth/routing/identity/binding fences.';

comment on function
  public.sellerpilot_11820_claim_gateway_unsafe(text, text) is
  'Innermost local gateway claimant; Smartstore supported reads are eligible, Smartstore writes stay excluded, Qoo10 shipping S1 verifier/activation AND NOT stays in WHERE before ORDER BY, and sellerpilot.local_gateway_recovery_lane=enabled further restricts SELECT to Shopee oauth.exchange or Smartstore supported reads.';

commit;
