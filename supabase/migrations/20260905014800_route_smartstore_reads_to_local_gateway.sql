-- Route Smartstore supported reads to the already-registered Mac gateway
-- (scope=gateway). 11820 currently excludes every Smartstore job via the
-- coupang,smartstore,temu in-list. 183000 then steals those jobs when
-- serverless_static_egress_allowed is true from the enabled policy, and
-- Vercel fails NAVER_IP_NOT_ALLOWED. Dual exclusive contract:
--   local 11820 claims only the read tuple
--   serverless 183000 claims no Smartstore at all
-- Writes stay in the local exclusion and out of serverless, so neither
-- claimant occupies a running slot. Live 11820 currently has the Qoo10 S1
-- verifier/activation AND NOT after ORDER BY j.id (uuid AND boolean 42804).
-- Relocate that exact block into WHERE; never drop or invert it. Do not buy
-- Static IP. Do not splice AND NOT after 183000 ORDER BY. Do not
-- whitespace-normalize the live padded 183000 body. Do not rewrite recon
-- rows, policy data, or past migrations.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500148);

do $smartstore_local_read_routing$
declare
  v_11820 text;
  v_183000 text;
  v_11820_inlist_old text := $inlist_old$j.channel in ('coupang', 'smartstore', 'temu')$inlist_old$;
  v_11820_inlist_new text := $inlist_new$j.channel in ('coupang', 'temu')$inlist_new$;
  v_11820_write_before text := $write_before$     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running$write_before$;
  v_11820_write_after text := $write_after$     and not (
       j.channel = 'smartstore'
       and j.operation not in (
         'diagnostic.test',
         'categories.list',
         'categories.suggest',
         'categories.attributes',
         'categories.validate',
         'inquiries.list',
         'listing.publication.verify'
       )
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running$write_after$;
  v_183000_where text := $claim_where$where job.status = 'queued'$claim_where$;
  v_183000_exclude text := $claim_exclude$and job.channel is distinct from 'smartstore'$claim_exclude$;
  v_183000_follow text := $claim_follow$and sellerpilot_private.serverless_gateway_job_allowed$claim_follow$;
  v_s1_orderby text := $s1_orderby$     j.id
     and not sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(j)
     and not (
       sellerpilot_private.qoo10_shipping_s1_activation_job_matches(j)
       and not sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(j.id)
     )
   for update of j, c skip locked$s1_orderby$;
  v_s1_lock text := $s1_lock$     j.id
   for update of j, c skip locked$s1_lock$;
  v_s1_where text := $s1_where$     and not sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(j)
     and not (
       sellerpilot_private.qoo10_shipping_s1_activation_job_matches(j)
       and not sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(j.id)
     )
$s1_where$;
  v_s1_order_case text := $s1_order_case$   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)$s1_order_case$;
  v_s1_order_case_with_where text := $s1_order_case_where$     and not sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(j)
     and not (
       sellerpilot_private.qoo10_shipping_s1_activation_job_matches(j)
       and not sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(j.id)
     )
   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)$s1_order_case_where$;
  v_11820_inlist_hits integer;
  v_11820_write_hits integer;
  v_183000_where_hits integer;
  v_11820_where integer;
  v_11820_order_rel integer;
  v_183000_select integer;
  v_183000_into integer;
  v_183000_where_at integer;
  v_183000_order_rel integer;
  v_183000_lock_rel integer;
  v_183000_exclude_at integer;
  v_after integer;
  v_suffix text;
  v_ws text;
  v_i integer;
  v_11820_skip boolean;
  v_183000_skip boolean;
  v_s1_orderby_hits integer;
  v_s1_order_case_hits integer;
  v_s1_at integer;
  v_s1_skip boolean;
begin
  if to_regprocedure(
       'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'
     ) is null
     or to_regprocedure(
       'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'
     ) is null
  then
    raise exception 'smartstore local-read claim function missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_11820;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into v_183000;

  v_11820_where := pg_catalog.strpos(v_11820, 'where j.status = ''queued''');
  if v_11820_where = 0 then
    raise exception 'smartstore local-read 11820 claim WHERE missing'
      using errcode = '55000';
  end if;
  v_11820_order_rel := pg_catalog.strpos(
    pg_catalog.substr(v_11820, v_11820_where),
    'order by'
  );
  if v_11820_order_rel = 0 then
    raise exception 'smartstore local-read 11820 claim ORDER BY missing after WHERE'
      using errcode = '55000';
  end if;

  v_11820_skip := pg_catalog.strpos(v_11820, v_11820_inlist_new) > 0
    and pg_catalog.strpos(v_11820, v_11820_write_after) > 0
    and pg_catalog.strpos(v_11820, v_11820_write_after) > v_11820_where
    and pg_catalog.strpos(v_11820, v_11820_write_after)
          < v_11820_where + v_11820_order_rel;

  if not v_11820_skip then
    v_11820_inlist_hits := (
      pg_catalog.length(v_11820)
      - pg_catalog.length(pg_catalog.replace(v_11820, v_11820_inlist_old, ''))
    ) / pg_catalog.length(v_11820_inlist_old);
    v_11820_write_hits := (
      pg_catalog.length(v_11820)
      - pg_catalog.length(pg_catalog.replace(v_11820, v_11820_write_before, ''))
    ) / pg_catalog.length(v_11820_write_before);
    if v_11820_inlist_hits <> 1 or v_11820_write_hits <> 1 then
      raise exception
        'smartstore local-read 11820 preimage drifted inlist=% write=%',
        v_11820_inlist_hits, v_11820_write_hits
        using errcode = '55000';
    end if;
    if pg_catalog.strpos(v_11820, v_11820_inlist_old) < v_11820_where
       or pg_catalog.strpos(v_11820, v_11820_inlist_old)
            > v_11820_where + v_11820_order_rel
       or pg_catalog.strpos(v_11820, v_11820_write_before) < v_11820_where
       or pg_catalog.strpos(v_11820, v_11820_write_before)
            > v_11820_where + v_11820_order_rel
    then
      raise exception 'smartstore local-read 11820 needle is not before ORDER BY'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(
      pg_catalog.replace(v_11820, v_11820_inlist_old, v_11820_inlist_new),
      v_11820_write_before,
      v_11820_write_after
    );
    select pg_catalog.pg_get_functiondef(
      'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
    ) into v_11820;
    v_11820_where := pg_catalog.strpos(v_11820, 'where j.status = ''queued''');
    v_11820_order_rel := pg_catalog.strpos(
      pg_catalog.substr(v_11820, v_11820_where),
      'order by'
    );
  end if;

  if pg_catalog.strpos(v_11820, 'qoo10_shipping_s1_verifier_job_matches') = 0
     or pg_catalog.strpos(
          v_11820,
          'qoo10_shipping_s1_activation_job_matches'
        ) = 0
  then
    raise exception 'smartstore local-read 11820 S1 fences missing'
      using errcode = '55000';
  end if;
  v_s1_at := pg_catalog.strpos(v_11820, v_s1_where);
  v_s1_skip := v_s1_at > v_11820_where
    and v_s1_at < v_11820_where + v_11820_order_rel
    and pg_catalog.strpos(v_11820, v_s1_orderby) = 0;
  if not v_s1_skip then
    v_s1_orderby_hits := (
      pg_catalog.length(v_11820)
      - pg_catalog.length(pg_catalog.replace(v_11820, v_s1_orderby, ''))
    ) / pg_catalog.length(v_s1_orderby);
    v_s1_order_case_hits := (
      pg_catalog.length(v_11820)
      - pg_catalog.length(pg_catalog.replace(v_11820, v_s1_order_case, ''))
    ) / pg_catalog.length(v_s1_order_case);
    if v_s1_orderby_hits <> 1 or v_s1_order_case_hits <> 1 then
      raise exception
        'smartstore local-read 11820 S1 ORDER BY 42804 preimage drifted orderby=% case=%',
        v_s1_orderby_hits, v_s1_order_case_hits
        using errcode = '55000';
    end if;
    if pg_catalog.strpos(v_11820, v_s1_orderby)
         <= v_11820_where + v_11820_order_rel
       or pg_catalog.strpos(v_11820, v_s1_order_case) < v_11820_where
    then
      raise exception 'smartstore local-read 11820 S1 42804 block is not after ORDER BY'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(
      pg_catalog.replace(v_11820, v_s1_orderby, v_s1_lock),
      v_s1_order_case,
      v_s1_order_case_with_where
    );
    select pg_catalog.pg_get_functiondef(
      'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
    ) into v_11820;
    v_11820_where := pg_catalog.strpos(v_11820, 'where j.status = ''queued''');
    v_11820_order_rel := pg_catalog.strpos(
      pg_catalog.substr(v_11820, v_11820_where),
      'order by'
    );
  end if;

  v_183000_where_hits := (
    pg_catalog.length(v_183000)
    - pg_catalog.length(pg_catalog.replace(v_183000, v_183000_where, ''))
  ) / pg_catalog.length(v_183000_where);
  v_183000_select := pg_catalog.strpos(v_183000, 'select job.id');
  v_183000_into := pg_catalog.strpos(v_183000, 'into v_job_id');
  v_183000_where_at := pg_catalog.strpos(v_183000, v_183000_where);
  if v_183000_where_hits <> 1
     or v_183000_select = 0
     or v_183000_into = 0
     or v_183000_where_at < v_183000_into
     or v_183000_into < v_183000_select
  then
    raise exception
      'smartstore local-read 183000 SELECT WHERE preimage drifted hits=%',
      v_183000_where_hits
      using errcode = '55000';
  end if;
  v_183000_order_rel := pg_catalog.strpos(
    pg_catalog.substr(v_183000, v_183000_where_at),
    'order by'
  );
  v_183000_lock_rel := pg_catalog.strpos(
    pg_catalog.substr(v_183000, v_183000_where_at),
    'for update of job skip locked'
  );
  if v_183000_order_rel = 0
     or v_183000_lock_rel = 0
     or v_183000_lock_rel < v_183000_order_rel
  then
    raise exception 'smartstore local-read 183000 claim ORDER BY/lock missing after WHERE'
      using errcode = '55000';
  end if;

  v_183000_exclude_at := pg_catalog.strpos(v_183000, v_183000_exclude);
  v_183000_skip := v_183000_exclude_at > v_183000_where_at
    and v_183000_exclude_at < v_183000_where_at + v_183000_order_rel;

  if v_183000_exclude_at > 0 and not v_183000_skip then
    raise exception 'smartstore local-read 183000 exclude is not in claim WHERE'
      using errcode = '55000';
  end if;

  if not v_183000_skip then
    v_after := v_183000_where_at + pg_catalog.length(v_183000_where);
    v_suffix := pg_catalog.substr(v_183000, v_after);
    if pg_catalog.substr(v_suffix, 1, 1) is distinct from E'\n' then
      raise exception 'smartstore local-read 183000 WHERE follower is not a newline'
        using errcode = '55000';
    end if;
    v_i := 2;
    while v_i <= pg_catalog.length(v_suffix)
      and pg_catalog.substr(v_suffix, v_i, 1) in (' ', E'\t')
    loop
      v_i := v_i + 1;
    end loop;
    if v_i < 3 then
      raise exception 'smartstore local-read 183000 WHERE follower has no indent'
        using errcode = '55000';
    end if;
    v_ws := pg_catalog.substr(v_suffix, 1, v_i - 1);
    if pg_catalog.strpos(v_suffix, v_ws || v_183000_follow) <> 1 then
      raise exception 'smartstore local-read 183000 WHERE follower drifted'
        using errcode = '55000';
    end if;
    v_183000 := pg_catalog.substr(v_183000, 1, v_after - 1)
      || v_ws
      || v_183000_exclude
      || pg_catalog.substr(v_183000, v_after);
    execute v_183000;
    select pg_catalog.pg_get_functiondef(
      'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
    ) into v_183000;
    v_183000_where_at := pg_catalog.strpos(v_183000, v_183000_where);
    v_183000_order_rel := pg_catalog.strpos(
      pg_catalog.substr(v_183000, v_183000_where_at),
      'order by'
    );
    v_183000_lock_rel := pg_catalog.strpos(
      pg_catalog.substr(v_183000, v_183000_where_at),
      'for update of job skip locked'
    );
    v_183000_exclude_at := pg_catalog.strpos(v_183000, v_183000_exclude);
  end if;

  if pg_catalog.strpos(v_11820, $keep$where j.status = 'queued'$keep$) = 0
     or pg_catalog.strpos(v_11820, $keep$and not ($keep$) = 0
     or pg_catalog.strpos(
          v_11820,
          $$false and serverless_token.scope = 'serverless_cs'$$
        ) = 0
     or pg_catalog.strpos(
          v_11820,
          $$false and j.channel = 'shopee'$$
        ) = 0
     or pg_catalog.strpos(
          v_11820,
          $$j.channel = 'elevenst' and j.operation is distinct from 'listing.create'$$
        ) = 0
     or pg_catalog.strpos(v_11820, v_11820_inlist_new) = 0
     or pg_catalog.strpos(v_11820, v_11820_inlist_old) > 0
     or pg_catalog.strpos(v_11820, v_11820_write_after) = 0
     or pg_catalog.strpos(v_11820, v_11820_write_after) < v_11820_where
     or pg_catalog.strpos(v_11820, v_11820_write_after)
          > v_11820_where + v_11820_order_rel
     or pg_catalog.strpos(v_11820, v_s1_orderby) > 0
     or pg_catalog.strpos(v_11820, v_s1_where) < v_11820_where
     or pg_catalog.strpos(v_11820, v_s1_where)
          > v_11820_where + v_11820_order_rel
     or pg_catalog.strpos(
          v_11820,
          'qoo10_shipping_s1_verifier_job_matches'
        ) = 0
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
  then
    raise exception 'smartstore local-read 11820 postimage drifted'
      using errcode = '55000';
  end if;

  if v_183000_where_at = 0
     or v_183000_exclude_at <= v_183000_where_at
     or v_183000_order_rel = 0
     or v_183000_exclude_at >= v_183000_where_at + v_183000_order_rel
     or v_183000_lock_rel = 0
     or v_183000_lock_rel < v_183000_order_rel
     or (
       pg_catalog.length(v_183000)
       - pg_catalog.length(pg_catalog.replace(v_183000, v_183000_exclude, ''))
     ) / pg_catalog.length(v_183000_exclude) <> 1
     or pg_catalog.strpos(
          v_183000,
          $$job.channel not in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')$$
        ) = 0
     or pg_catalog.strpos(
          v_183000,
          $$job.channel = 'shopee'$$
        ) = 0
     or pg_catalog.strpos(
          v_183000,
          'qoo10_shipping_s1_activation_claim_priority'
        ) = 0
     or pg_catalog.strpos(v_183000, 'for update of job skip locked') = 0
     or pg_catalog.strpos(v_183000, 'order by queued_read') = 0
  then
    raise exception 'smartstore local-read 183000 postimage drifted'
      using errcode = '55000';
  end if;
end;
$smartstore_local_read_routing$;

comment on function
  public.sellerpilot_11820_claim_gateway_unsafe(text, text) is
  'Innermost local gateway claimant; Smartstore supported reads are eligible, Smartstore writes stay excluded, and Qoo10 shipping S1 verifier/activation AND NOT stays in WHERE before ORDER BY to avoid uuid AND boolean 42804.';

comment on function
  public.sellerpilot_183000_claim_serverless_gateway_unsafe(text, text) is
  'Innermost serverless_cs claimant; Smartstore is excluded entirely so enabled egress policy cannot steal Mac reads; shipping S1 activation exclusion must stay out of ORDER BY to avoid uuid AND boolean 42804.';

commit;
