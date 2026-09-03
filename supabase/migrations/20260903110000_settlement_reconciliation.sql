-- Settlement expectation vs actual deposit reconciliation (정산 대조).
--
-- Channel settlement expectations (sales - fees - shipping -> expected
-- deposit) are ingested from channel settlement APIs (polling; see the
-- `settlements` capability in lib/channels/catalog.ts) or entered manually for
-- channels without a confirmed settlement API (11번가). Actual deposits
-- normally come from bank statements. Re-running reconciliation for the same
-- (owner, channel, settlementNo, currency) upserts a single result row, so
-- repeated runs never duplicate outcomes. Decision rules mirror
-- lib/settlements/reconciliation.ts.

begin;

create table if not exists sellerpilot_private.settlement_expectations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_key text not null references sellerpilot_private.channels(key),
  settlement_no text not null check (length(settlement_no) between 1 and 240),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  sales_amount numeric(16,2) not null check (sales_amount >= 0),
  fee_amount numeric(16,2) not null default 0 check (fee_amount >= 0),
  shipping_amount numeric(16,2) not null default 0 check (shipping_amount >= 0),
  adjustment_amount numeric(16,2) not null default 0 check (adjustment_amount >= 0),
  expected_deposit_amount numeric(16,2) not null check (expected_deposit_amount >= 0),
  expected_date date not null,
  source text not null check (source in ('api', 'manual')),
  reference_no text,
  provider_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_payload) = 'object' and octet_length(provider_payload::text) <= 64000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, channel_key, settlement_no, currency)
);

create index if not exists settlement_expectations_owner_channel_idx
  on sellerpilot_private.settlement_expectations (owner_id, channel_key, expected_date);

create table if not exists sellerpilot_private.settlement_deposits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_key text references sellerpilot_private.channels(key),
  settlement_no text,
  reference_no text not null check (length(reference_no) between 1 and 240),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(16,2) not null check (amount > 0),
  deposited_at date not null,
  source text not null check (source in ('bank', 'manual', 'api')),
  matched_expectation_id uuid references sellerpilot_private.settlement_expectations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source, reference_no, currency, deposited_at)
);

create index if not exists settlement_deposits_match_candidates_idx
  on sellerpilot_private.settlement_deposits (owner_id, currency, deposited_at)
  where matched_expectation_id is null;

create index if not exists settlement_deposits_owner_channel_idx
  on sellerpilot_private.settlement_deposits (owner_id, channel_key)
  where channel_key is not null;

create index if not exists settlement_deposits_matched_idx
  on sellerpilot_private.settlement_deposits (matched_expectation_id)
  where matched_expectation_id is not null;

create table if not exists sellerpilot_private.settlement_reconciliation_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  expectation_id uuid not null unique references sellerpilot_private.settlement_expectations(id) on delete cascade,
  channel_key text not null references sellerpilot_private.channels(key),
  settlement_no text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in (
    'unreconciled', 'matched', 'partial', 'mismatch', 'missing_deposit', 'over_deposit'
  )),
  discrepancy_type text check (discrepancy_type in ('no_deposit', 'underpaid', 'overpaid', 'amount_mismatch')),
  expected_amount numeric(16,2) not null check (expected_amount >= 0),
  matched_amount numeric(16,2) not null default 0 check (matched_amount >= 0),
  difference_amount numeric(16,2) not null default 0,
  tolerance_amount numeric(16,2) not null default 0 check (tolerance_amount >= 0),
  matched_deposit_ids uuid[] not null default '{}',
  matched_deposit_refs text[] not null default '{}',
  earliest_deposited_at date,
  latest_deposited_at date,
  last_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists settlement_reconciliation_results_owner_status_idx
  on sellerpilot_private.settlement_reconciliation_results (owner_id, status, last_run_at desc);

alter table sellerpilot_private.settlement_expectations enable row level security;
alter table sellerpilot_private.settlement_deposits enable row level security;
alter table sellerpilot_private.settlement_reconciliation_results enable row level security;
revoke all on sellerpilot_private.settlement_expectations from public, anon, authenticated;
revoke all on sellerpilot_private.settlement_deposits from public, anon, authenticated;
revoke all on sellerpilot_private.settlement_reconciliation_results from public, anon, authenticated;

-- Strict decimal parser: rejects empty values, exponents and more than two
-- decimals so the upsert RPCs can tell a missing value from an invalid one.
create or replace function sellerpilot_private.settlement_text_to_amount(p_text text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_text is null or btrim(p_text) = '' then null
    when btrim(p_text) ~ '^[0-9]+(\.[0-9]{1,2})?$' then btrim(p_text)::numeric
    else null
  end;
$$;

-- Resolve the acting owner for the settlement RPCs. Service role calls pass an
-- explicit owner id; authenticated admins always act on their own rows.
create or replace function sellerpilot_private.settlement_owner_for_call(p_owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if p_owner_id is null or not exists (select 1 from auth.users u where u.id = p_owner_id) then
      raise exception 'owner id required for service role' using errcode = '42501';
    end if;
    return p_owner_id;
  end if;
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create or replace function public.sellerpilot_settlement_upsert_expectation(
  p_owner_id uuid,
  p_expectation jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_channel text;
  v_settlement_no text;
  v_currency text;
  v_sales numeric(16,2);
  v_fee numeric(16,2);
  v_shipping numeric(16,2);
  v_adjustment numeric(16,2);
  v_expected numeric(16,2);
  v_expected_date date;
  v_source text;
  v_reference_no text;
  v_provider_payload jsonb;
  v_id uuid;
begin
  v_owner := sellerpilot_private.settlement_owner_for_call(p_owner_id);

  if jsonb_typeof(p_expectation) <> 'object' then
    raise exception 'invalid settlement expectation payload';
  end if;

  v_channel := lower(btrim(coalesce(p_expectation->>'channel', '')));
  v_settlement_no := btrim(coalesce(p_expectation->>'settlementNo', ''));
  v_currency := upper(btrim(coalesce(p_expectation->>'currency', '')));
  v_source := coalesce(nullif(btrim(p_expectation->>'source'), ''), 'manual');
  v_reference_no := nullif(btrim(coalesce(p_expectation->>'referenceNo', '')), '');

  if not exists (select 1 from sellerpilot_private.channels c where c.key = v_channel) then
    raise exception 'unknown channel';
  end if;
  if v_settlement_no = '' or length(v_settlement_no) > 240 then
    raise exception 'invalid settlementNo';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid currency';
  end if;
  if v_source not in ('api', 'manual') then
    raise exception 'invalid settlement source';
  end if;
  if coalesce(p_expectation->>'expectedDate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid expectedDate';
  end if;
  v_expected_date := (p_expectation->>'expectedDate')::date;

  v_sales := sellerpilot_private.settlement_text_to_amount(p_expectation->>'salesAmount');
  if v_sales is null or v_sales < 0 then
    raise exception 'invalid salesAmount';
  end if;
  v_fee := coalesce(sellerpilot_private.settlement_text_to_amount(p_expectation->>'feeAmount'), 0);
  v_shipping := coalesce(sellerpilot_private.settlement_text_to_amount(p_expectation->>'shippingAmount'), 0);
  v_adjustment := coalesce(sellerpilot_private.settlement_text_to_amount(p_expectation->>'adjustmentAmount'), 0);

  if p_expectation ? 'expectedDepositAmount' then
    v_expected := sellerpilot_private.settlement_text_to_amount(p_expectation->>'expectedDepositAmount');
    if v_expected is null then
      raise exception 'invalid expectedDepositAmount';
    end if;
  else
    v_expected := v_sales - v_fee - v_shipping - v_adjustment;
  end if;
  if v_expected < 0 then
    raise exception 'negative expected deposit amount';
  end if;

  v_provider_payload := case
    when jsonb_typeof(p_expectation->'providerPayload') = 'object' then p_expectation->'providerPayload'
    else '{}'::jsonb
  end;
  if octet_length(v_provider_payload::text) > 64000 then
    raise exception 'provider payload too large';
  end if;

  insert into sellerpilot_private.settlement_expectations (
    owner_id, channel_key, settlement_no, currency, sales_amount, fee_amount,
    shipping_amount, adjustment_amount, expected_deposit_amount, expected_date,
    source, reference_no, provider_payload, updated_at
  ) values (
    v_owner, v_channel, v_settlement_no, v_currency, v_sales, v_fee,
    v_shipping, v_adjustment, v_expected, v_expected_date,
    v_source, v_reference_no, v_provider_payload, now()
  )
  on conflict (owner_id, channel_key, settlement_no, currency) do update set
    sales_amount = excluded.sales_amount,
    fee_amount = excluded.fee_amount,
    shipping_amount = excluded.shipping_amount,
    adjustment_amount = excluded.adjustment_amount,
    expected_deposit_amount = excluded.expected_deposit_amount,
    expected_date = excluded.expected_date,
    source = excluded.source,
    reference_no = excluded.reference_no,
    provider_payload = sellerpilot_private.settlement_expectations.provider_payload || excluded.provider_payload,
    updated_at = now()
  returning id into v_id;

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (v_owner, 'settlement_expectation_upserted', 'settlement', v_id::text, jsonb_build_object(
    'channel', v_channel,
    'settlementNo', v_settlement_no,
    'currency', v_currency,
    'expectedDepositAmount', v_expected,
    'expectedDate', v_expected_date,
    'source', v_source
  ));
  return v_id;
end;
$$;

create or replace function public.sellerpilot_settlement_upsert_deposit(
  p_owner_id uuid,
  p_deposit jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_channel text;
  v_settlement_no text;
  v_reference_no text;
  v_currency text;
  v_amount numeric(16,2);
  v_deposited_at date;
  v_source text;
  v_id uuid;
begin
  v_owner := sellerpilot_private.settlement_owner_for_call(p_owner_id);

  if jsonb_typeof(p_deposit) <> 'object' then
    raise exception 'invalid settlement deposit payload';
  end if;

  v_channel := nullif(btrim(coalesce(p_deposit->>'channel', '')), '');
  v_settlement_no := nullif(btrim(coalesce(p_deposit->>'settlementNo', '')), '');
  v_reference_no := btrim(coalesce(p_deposit->>'referenceNo', ''));
  v_currency := upper(btrim(coalesce(p_deposit->>'currency', '')));
  v_source := coalesce(nullif(btrim(p_deposit->>'source'), ''), 'bank');

  if v_channel is not null
     and not exists (select 1 from sellerpilot_private.channels c where c.key = v_channel) then
    raise exception 'unknown channel';
  end if;
  if v_reference_no = '' or length(v_reference_no) > 240 then
    raise exception 'invalid referenceNo';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid currency';
  end if;
  if v_source not in ('bank', 'manual', 'api') then
    raise exception 'invalid deposit source';
  end if;
  if coalesce(p_deposit->>'depositedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid depositedAt';
  end if;
  v_deposited_at := (p_deposit->>'depositedAt')::date;

  v_amount := sellerpilot_private.settlement_text_to_amount(p_deposit->>'amount');
  if v_amount is null or v_amount <= 0 then
    raise exception 'invalid deposit amount';
  end if;

  insert into sellerpilot_private.settlement_deposits (
    owner_id, channel_key, settlement_no, reference_no, currency, amount,
    deposited_at, source, updated_at
  ) values (
    v_owner, v_channel, v_settlement_no, v_reference_no, v_currency, v_amount,
    v_deposited_at, v_source, now()
  )
  on conflict (owner_id, source, reference_no, currency, deposited_at) do update set
    channel_key = coalesce(excluded.channel_key, sellerpilot_private.settlement_deposits.channel_key),
    settlement_no = coalesce(excluded.settlement_no, sellerpilot_private.settlement_deposits.settlement_no),
    amount = excluded.amount,
    updated_at = now()
  returning id into v_id;

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (v_owner, 'settlement_deposit_upserted', 'settlement', v_id::text, jsonb_build_object(
    'channel', v_channel,
    'settlementNo', v_settlement_no,
    'referenceNo', v_reference_no,
    'currency', v_currency,
    'amount', v_amount,
    'depositedAt', v_deposited_at,
    'source', v_source
  ));
  return v_id;
end;
$$;

-- Runs reconciliation for one owner (optionally one channel) and upserts one
-- result row per expectation. The matching rules mirror
-- lib/settlements/reconciliation.ts: strong pairs first (settlementNo or
-- referenceNo), then amount-proximity accumulation up to expected + tolerance.
create or replace function public.sellerpilot_settlement_run_reconciliation(
  p_owner_id uuid,
  p_channel text default null,
  p_as_of date default current_date,
  p_tolerance jsonb default '{}'::jsonb,
  p_tolerance_ratio numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_exp record;
  v_dep record;
  v_accum numeric(16,2);
  v_strong_count integer;
  v_status text;
  v_type text;
  v_tol numeric(16,2);
  v_dep_ids uuid[];
  v_dep_refs text[];
  v_earliest date;
  v_latest date;
  v_best_id uuid;
  v_best_distance numeric;
  v_amt numeric(16,2);
  v_ref text;
  v_dep_date date;
  v_results jsonb := '[]'::jsonb;
  v_unmatched jsonb := '[]'::jsonb;
  v_report jsonb;
  v_total_dep integer := 0;
  v_n_matched integer := 0;
  v_n_partial integer := 0;
  v_n_mismatch integer := 0;
  v_n_missing integer := 0;
  v_n_over integer := 0;
  v_n_unreconciled integer := 0;
begin
  v_owner := sellerpilot_private.settlement_owner_for_call(p_owner_id);

  if p_channel is not null
     and not exists (select 1 from sellerpilot_private.channels c where c.key = p_channel) then
    raise exception 'unknown channel';
  end if;
  if jsonb_typeof(p_tolerance) <> 'object' then
    raise exception 'invalid tolerance map';
  end if;
  if coalesce(p_tolerance_ratio, 0) < 0 then
    raise exception 'invalid tolerance ratio';
  end if;

  -- Idempotent re-run: drop match marks scoped to this owner/channel so each
  -- deposit can only be re-attributed by the current run.
  update sellerpilot_private.settlement_deposits d
     set matched_expectation_id = null,
         updated_at = now()
   where d.owner_id = v_owner
     and d.matched_expectation_id is not null
     and exists (
       select 1
         from sellerpilot_private.settlement_expectations e
        where e.id = d.matched_expectation_id
          and (p_channel is null or e.channel_key = p_channel)
     );

  select count(*) into v_total_dep
    from sellerpilot_private.settlement_deposits d
   where d.owner_id = v_owner
     and (p_channel is null or d.channel_key = p_channel);

  for v_exp in
    select e.*
      from sellerpilot_private.settlement_expectations e
     where e.owner_id = v_owner
       and (p_channel is null or e.channel_key = p_channel)
     order by e.channel_key, e.settlement_no, e.currency
  loop
    v_accum := 0;
    v_strong_count := 0;
    v_dep_ids := '{}'::uuid[];
    v_dep_refs := '{}'::text[];
    v_earliest := null;
    v_latest := null;
    v_tol := coalesce(sellerpilot_private.settlement_text_to_amount(p_tolerance->>v_exp.currency), 0.01);
    v_tol := greatest(v_tol, coalesce(p_tolerance_ratio, 0) * v_exp.expected_deposit_amount);

    -- Strong pairs: same settlement number or reference number.
    for v_dep in
      select d.id, d.amount, d.reference_no, d.deposited_at
        from sellerpilot_private.settlement_deposits d
       where d.owner_id = v_owner
         and d.currency = v_exp.currency
         and d.matched_expectation_id is null
         and (d.channel_key is null or d.channel_key = v_exp.channel_key)
         and (
           d.settlement_no = v_exp.settlement_no
           or (v_exp.reference_no is not null and d.reference_no = v_exp.reference_no)
         )
       order by d.deposited_at, d.id
    loop
      update sellerpilot_private.settlement_deposits
         set matched_expectation_id = v_exp.id,
             updated_at = now()
       where id = v_dep.id;
      v_accum := v_accum + v_dep.amount;
      v_strong_count := v_strong_count + 1;
      v_dep_ids := v_dep_ids || v_dep.id;
      v_dep_refs := v_dep_refs || v_dep.reference_no;
      if v_earliest is null or v_dep.deposited_at < v_earliest then v_earliest := v_dep.deposited_at; end if;
      if v_latest is null or v_dep.deposited_at > v_latest then v_latest := v_dep.deposited_at; end if;
    end loop;

    -- Weak pairs: accumulate amount-proximity deposits without overshooting
    -- expected + tolerance. Overshooting anonymous deposits are left
    -- unmatched because they may aggregate several settlements.
    if v_exp.expected_date <= p_as_of or v_strong_count > 0 then
      loop
        v_best_id := null;
        v_best_distance := null;
        for v_dep in
          select d.id, d.amount, d.reference_no, d.deposited_at
            from sellerpilot_private.settlement_deposits d
           where d.owner_id = v_owner
             and d.currency = v_exp.currency
             and d.matched_expectation_id is null
             and (d.channel_key is null or d.channel_key = v_exp.channel_key)
             and v_accum + d.amount <= v_exp.expected_deposit_amount + v_tol
           order by d.deposited_at, d.id
        loop
          if v_best_id is null
             or abs(v_exp.expected_deposit_amount - (v_accum + v_dep.amount)) < v_best_distance then
            v_best_id := v_dep.id;
            v_best_distance := abs(v_exp.expected_deposit_amount - (v_accum + v_dep.amount));
          end if;
        end loop;
        exit when v_best_id is null;

        select d.amount, d.reference_no, d.deposited_at
          into v_amt, v_ref, v_dep_date
          from sellerpilot_private.settlement_deposits d
         where d.id = v_best_id;
        update sellerpilot_private.settlement_deposits
           set matched_expectation_id = v_exp.id,
               updated_at = now()
         where id = v_best_id;
        v_accum := v_accum + v_amt;
        v_dep_ids := v_dep_ids || v_best_id;
        v_dep_refs := v_dep_refs || v_ref;
        if v_earliest is null or v_dep_date < v_earliest then v_earliest := v_dep_date; end if;
        if v_latest is null or v_dep_date > v_latest then v_latest := v_dep_date; end if;
      end loop;
    end if;

    -- Status resolution (mirrors the pure TS module).
    if v_exp.expected_date > p_as_of and v_strong_count = 0 then
      v_status := 'unreconciled';
      v_type := null;
    elsif abs(v_accum - v_exp.expected_deposit_amount) <= v_tol then
      v_status := 'matched';
      v_type := null;
    elsif v_accum = 0 then
      v_status := 'missing_deposit';
      v_type := 'no_deposit';
    elsif v_accum > v_exp.expected_deposit_amount then
      v_status := 'over_deposit';
      v_type := 'overpaid';
    elsif v_strong_count > 0 then
      v_status := 'mismatch';
      v_type := 'amount_mismatch';
    else
      v_status := 'partial';
      v_type := 'underpaid';
    end if;

    if v_status = 'matched' then v_n_matched := v_n_matched + 1;
    elsif v_status = 'partial' then v_n_partial := v_n_partial + 1;
    elsif v_status = 'mismatch' then v_n_mismatch := v_n_mismatch + 1;
    elsif v_status = 'missing_deposit' then v_n_missing := v_n_missing + 1;
    elsif v_status = 'over_deposit' then v_n_over := v_n_over + 1;
    else v_n_unreconciled := v_n_unreconciled + 1;
    end if;

    insert into sellerpilot_private.settlement_reconciliation_results (
      owner_id, expectation_id, channel_key, settlement_no, currency, status,
      discrepancy_type, expected_amount, matched_amount, difference_amount,
      tolerance_amount, matched_deposit_ids, matched_deposit_refs,
      earliest_deposited_at, latest_deposited_at, last_run_at, updated_at
    ) values (
      v_owner, v_exp.id, v_exp.channel_key, v_exp.settlement_no, v_exp.currency,
      v_status, v_type, v_exp.expected_deposit_amount, v_accum,
      case when v_status = 'unreconciled' then 0 else v_accum - v_exp.expected_deposit_amount end,
      v_tol, v_dep_ids, v_dep_refs, v_earliest, v_latest, now(), now()
    )
    on conflict (expectation_id) do update set
      status = excluded.status,
      discrepancy_type = excluded.discrepancy_type,
      expected_amount = excluded.expected_amount,
      matched_amount = excluded.matched_amount,
      difference_amount = excluded.difference_amount,
      tolerance_amount = excluded.tolerance_amount,
      matched_deposit_ids = excluded.matched_deposit_ids,
      matched_deposit_refs = excluded.matched_deposit_refs,
      earliest_deposited_at = excluded.earliest_deposited_at,
      latest_deposited_at = excluded.latest_deposited_at,
      last_run_at = now(),
      updated_at = now();

    v_results := v_results || jsonb_build_object(
      'expectationKey', concat_ws('|', v_exp.channel_key, v_exp.settlement_no, v_exp.currency),
      'channel', v_exp.channel_key,
      'settlementNo', v_exp.settlement_no,
      'currency', v_exp.currency,
      'expectedDepositAmount', v_exp.expected_deposit_amount,
      'matchedDepositAmount', v_accum,
      'difference', case when v_status = 'unreconciled' then 0 else v_accum - v_exp.expected_deposit_amount end,
      'status', v_status,
      'discrepancyType', v_type,
      'tolerance', v_tol,
      'matchedDepositIds', to_jsonb(v_dep_ids),
      'matchedDepositRefs', to_jsonb(v_dep_refs),
      'earliestDepositedAt', v_earliest,
      'latestDepositedAt', v_latest
    );
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'depositId', d.id,
    'channel', d.channel_key,
    'settlementNo', d.settlement_no,
    'referenceNo', d.reference_no,
    'currency', d.currency,
    'amount', d.amount,
    'depositedAt', d.deposited_at
  ) order by d.deposited_at, d.id), '[]'::jsonb)
    into v_unmatched
    from sellerpilot_private.settlement_deposits d
   where d.owner_id = v_owner
     and d.matched_expectation_id is null
     and (p_channel is null or d.channel_key = p_channel);

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, safe_detail)
  values (v_owner, 'settlement_reconciliation_ran', 'settlement', jsonb_build_object(
    'channel', p_channel,
    'asOf', p_as_of,
    'deposits', v_total_dep,
    'matched', v_n_matched,
    'partial', v_n_partial,
    'mismatch', v_n_mismatch,
    'missingDeposit', v_n_missing,
    'overDeposit', v_n_over,
    'unreconciled', v_n_unreconciled
  ));

  v_report := jsonb_build_object(
    'channel', p_channel,
    'asOf', p_as_of,
    'results', v_results,
    'unmatchedDeposits', v_unmatched,
    'summary', jsonb_build_object(
      'totalExpectations', jsonb_array_length(v_results),
      'totalDeposits', v_total_dep,
      'unmatchedDeposits', jsonb_array_length(v_unmatched),
      'byStatus', jsonb_build_object(
        'unreconciled', v_n_unreconciled,
        'matched', v_n_matched,
        'partial', v_n_partial,
        'mismatch', v_n_mismatch,
        'missingDeposit', v_n_missing,
        'overDeposit', v_n_over
      )
    )
  );
  return v_report;
end;
$$;

create or replace function public.sellerpilot_get_settlement_reconciliation(
  p_owner_id uuid,
  p_channel text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_report jsonb;
begin
  v_owner := sellerpilot_private.settlement_owner_for_call(p_owner_id);

  if p_channel is not null
     and not exists (select 1 from sellerpilot_private.channels c where c.key = p_channel) then
    raise exception 'unknown channel';
  end if;

  select jsonb_build_object(
    'expectations', coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'channel', e.channel_key,
      'settlementNo', e.settlement_no,
      'currency', e.currency,
      'salesAmount', e.sales_amount,
      'feeAmount', e.fee_amount,
      'shippingAmount', e.shipping_amount,
      'adjustmentAmount', e.adjustment_amount,
      'expectedDepositAmount', e.expected_deposit_amount,
      'expectedDate', e.expected_date,
      'source', e.source,
      'referenceNo', e.reference_no,
      'result', case when r.id is null then null else jsonb_build_object(
        'status', r.status,
        'discrepancyType', r.discrepancy_type,
        'expectedAmount', r.expected_amount,
        'matchedAmount', r.matched_amount,
        'difference', r.difference_amount,
        'tolerance', r.tolerance_amount,
        'matchedDepositRefs', r.matched_deposit_refs,
        'earliestDepositedAt', r.earliest_deposited_at,
        'latestDepositedAt', r.latest_deposited_at,
        'lastRunAt', r.last_run_at
      ) end
    ) order by e.channel_key, e.settlement_no, e.currency), '[]'::jsonb),
    'unmatchedDeposits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'channel', d.channel_key,
        'settlementNo', d.settlement_no,
        'referenceNo', d.reference_no,
        'currency', d.currency,
        'amount', d.amount,
        'depositedAt', d.deposited_at,
        'source', d.source
      ) order by d.deposited_at, d.id)
        from sellerpilot_private.settlement_deposits d
       where d.owner_id = v_owner
         and d.matched_expectation_id is null
         and (p_channel is null or d.channel_key = p_channel)
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'matched', count(*) filter (where r.status = 'matched'),
      'partial', count(*) filter (where r.status = 'partial'),
      'mismatch', count(*) filter (where r.status = 'mismatch'),
      'missingDeposit', count(*) filter (where r.status = 'missing_deposit'),
      'overDeposit', count(*) filter (where r.status = 'over_deposit'),
      'unreconciled', count(*) filter (where r.status = 'unreconciled')
    )
  ) into v_report
  from sellerpilot_private.settlement_expectations e
  left join sellerpilot_private.settlement_reconciliation_results r on r.expectation_id = e.id
  where e.owner_id = v_owner
    and (p_channel is null or e.channel_key = p_channel);

  return coalesce(v_report, jsonb_build_object(
    'expectations', '[]'::jsonb,
    'unmatchedDeposits', '[]'::jsonb,
    'summary', jsonb_build_object(
      'matched', 0, 'partial', 0, 'mismatch', 0, 'missingDeposit', 0, 'overDeposit', 0, 'unreconciled', 0
    )
  ));
end;
$$;

revoke all on function sellerpilot_private.settlement_text_to_amount(text)
  from public, anon, authenticated;
revoke all on function sellerpilot_private.settlement_owner_for_call(uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_settlement_upsert_expectation(uuid, jsonb)
  from public, anon;
revoke all on function public.sellerpilot_settlement_upsert_deposit(uuid, jsonb)
  from public, anon;
revoke all on function public.sellerpilot_settlement_run_reconciliation(uuid, text, date, jsonb, numeric)
  from public, anon;
revoke all on function public.sellerpilot_get_settlement_reconciliation(uuid, text)
  from public, anon;

grant execute on function public.sellerpilot_settlement_upsert_expectation(uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.sellerpilot_settlement_upsert_deposit(uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.sellerpilot_settlement_run_reconciliation(uuid, text, date, jsonb, numeric)
  to authenticated, service_role;
grant execute on function public.sellerpilot_get_settlement_reconciliation(uuid, text)
  to authenticated, service_role;

commit;
