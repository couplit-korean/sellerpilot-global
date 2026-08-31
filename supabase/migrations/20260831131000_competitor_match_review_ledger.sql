-- Append-only human review events for probable competitor matches. Automated
-- observations remain untouched; the latest review is an effective-tier
-- overlay only while its source fingerprint still matches the current source.

begin;

create or replace function sellerpilot_private.valid_competitor_review_reason_codes(
  p_codes jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_codes is null
      or jsonb_typeof(p_codes) <> 'array'
      or jsonb_array_length(p_codes) not between 1 and 12
      or octet_length(p_codes::text) > 4000
    then false
    else coalesce((
      select count(*) = count(distinct code.value #>> '{}')
         and bool_and(
           jsonb_typeof(code.value) = 'string'
           and length(code.value #>> '{}') between 1 and 80
           and code.value #>> '{}' in (
             'source_opened',
             'brand_model_match',
             'gtin_mpn_match',
             'quantity_pack_match',
             'variant_condition_match',
             'not_accessory_refill',
             'identity_mismatch',
             'insufficient_identity',
             'review_withdrawn'
           )
         )
        from jsonb_array_elements(p_codes) code(value)
    ), false)
  end
$$;

revoke all on function sellerpilot_private.valid_competitor_review_reason_codes(jsonb)
  from public, anon, authenticated, service_role;

create table sellerpilot_private.competitor_match_review_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  -- Current observation rows are a rotating projection and can be replaced by
  -- refresh completion. Keep the historical UUID without an FK so evidence is
  -- not deleted with the projection.
  source_observation_id uuid not null,
  source_provider text not null check (
    source_provider in (
      'naver_shopping', 'elevenst_product_search', 'ebay_browse',
      'brave_marketplace_web'
    )
  ),
  source_marketplace text not null check (
    source_marketplace in (
      'smartstore', 'coupang', 'elevenst', 'qoo10', 'shopee',
      'lazada', 'ebay', 'temu', 'other'
    )
  ),
  source_external_id text not null check (length(source_external_id) between 1 and 500),
  source_matcher_version text not null check (source_matcher_version = 'strict-2026-08-31-v3'),
  source_observation_fingerprint text not null check (
    source_observation_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  source_checked_at timestamptz not null,
  source_snapshot jsonb not null check (
    jsonb_typeof(source_snapshot) = 'object'
    and octet_length(source_snapshot::text) <= 262144
  ),
  source_snapshot_sha256 text not null check (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  automated_match_tier text not null check (automated_match_tier = 'probable'),
  decision text not null check (decision in ('confirmed_exact', 'rejected', 'revoked')),
  reason_codes jsonb not null check (
    sellerpilot_private.valid_competitor_review_reason_codes(reason_codes)
  ),
  note text not null check (
    length(trim(note)) between 5 and 2000
    and octet_length(note) <= 8000
  ),
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  supersedes_event_id uuid references sellerpilot_private.competitor_match_review_events(id) on delete restrict,
  request_payload_sha256 text not null check (request_payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  check (supersedes_event_id is null or supersedes_event_id <> id)
);

comment on table sellerpilot_private.competitor_match_review_events is
  'Append-only probable-match review ledger. source_snapshot is immutable evidence; decisions never rewrite automatic observations or selling prices.';
comment on column sellerpilot_private.competitor_match_review_events.source_observation_id is
  'Historical projection UUID retained without an FK because provider refresh can replace the current observation row.';

create unique index competitor_match_review_events_supersedes_key
  on sellerpilot_private.competitor_match_review_events (supersedes_event_id)
  where supersedes_event_id is not null;
create index competitor_match_review_events_source_key
  on sellerpilot_private.competitor_match_review_events (
    product_id, source_provider, source_marketplace, source_external_id,
    created_at desc, id desc
  );
create index competitor_match_review_events_reviewer_idx
  on sellerpilot_private.competitor_match_review_events (reviewer_id, created_at desc);

alter table sellerpilot_private.competitor_match_review_events enable row level security;
revoke all on sellerpilot_private.competitor_match_review_events
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.reject_competitor_match_review_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'competitor match review events are append-only' using errcode = '55000';
end;
$$;

revoke all on function sellerpilot_private.reject_competitor_match_review_mutation()
  from public, anon, authenticated, service_role;

create trigger competitor_match_review_events_append_only
before update or delete on sellerpilot_private.competitor_match_review_events
for each row execute function sellerpilot_private.reject_competitor_match_review_mutation();

create or replace function sellerpilot_private.competitor_match_review_event_json(
  p_event sellerpilot_private.competitor_match_review_events
)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_event.id,
    'requestId', p_event.request_id,
    'productId', p_event.product_id,
    'sourceObservationId', p_event.source_observation_id,
    'sourceProvider', p_event.source_provider,
    'sourceMarketplace', p_event.source_marketplace,
    'sourceExternalId', p_event.source_external_id,
    'sourceMatcherVersion', p_event.source_matcher_version,
    'sourceObservationFingerprint', p_event.source_observation_fingerprint,
    'sourceCheckedAt', p_event.source_checked_at,
    'sourceSnapshotSha256', p_event.source_snapshot_sha256,
    'automatedMatchTier', p_event.automated_match_tier,
    'decision', p_event.decision,
    'reasonCodes', p_event.reason_codes,
    'note', p_event.note,
    'reviewerId', p_event.reviewer_id,
    'supersedesEventId', p_event.supersedes_event_id,
    'createdAt', p_event.created_at
  )
$$;

revoke all on function sellerpilot_private.competitor_match_review_event_json(
  sellerpilot_private.competitor_match_review_events
) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_review_competitor_match(
  p_observation_id uuid,
  p_expected_fingerprint text,
  p_expected_checked_at timestamptz,
  p_expected_latest_review_id uuid,
  p_decision text,
  p_reason_codes jsonb,
  p_note text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_product_id uuid;
  v_observation sellerpilot_private.competitor_price_observations%rowtype;
  v_latest sellerpilot_private.competitor_match_review_events%rowtype;
  v_existing sellerpilot_private.competitor_match_review_events%rowtype;
  v_inserted sellerpilot_private.competitor_match_review_events%rowtype;
  v_snapshot jsonb;
  v_snapshot_sha256 text;
  v_request_payload_sha256 text;
  v_note text := trim(coalesce(p_note, ''));
begin
  if v_actor_id is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_observation_id is null
     or p_request_id is null
     or p_expected_checked_at is null
     or coalesce(p_expected_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or p_decision not in ('confirmed_exact', 'rejected', 'revoked')
     or not coalesce(sellerpilot_private.valid_competitor_review_reason_codes(p_reason_codes), false)
     or length(v_note) not between 5 and 2000
     or octet_length(v_note) > 8000 then
    raise exception 'invalid competitor match review';
  end if;

  v_request_payload_sha256 := encode(extensions.digest(
    jsonb_build_object(
      'observationId', p_observation_id,
      'expectedFingerprint', p_expected_fingerprint,
      'expectedCheckedAt', p_expected_checked_at,
      'expectedLatestReviewId', p_expected_latest_review_id,
      'decision', p_decision,
      'reasonCodes', p_reason_codes,
      'note', v_note
    )::text,
    'sha256'
  ), 'hex');

  select review.*
    into v_existing
    from sellerpilot_private.competitor_match_review_events review
   where review.request_id = p_request_id;
  if found then
    if v_existing.reviewer_id is distinct from v_actor_id
       or v_existing.request_payload_sha256 is distinct from v_request_payload_sha256 then
      raise exception 'competitor review request conflict' using errcode = '40001';
    end if;
    v_product_id := v_existing.product_id;
  else
    select observation.product_id
      into v_product_id
      from sellerpilot_private.competitor_price_observations observation
     where observation.id = p_observation_id;
    if v_product_id is null then
      raise exception 'competitor observation not found' using errcode = 'P0002';
    end if;
  end if;

  -- Match the competitor refresh lock order: product first, then observation.
  -- Even an idempotent retry must take this lock before reporting whether its
  -- event is still the leaf; otherwise a concurrent revoke can make a stale
  -- exact event look current immediately after the unlocked readback.
  perform 1
    from sellerpilot_private.products product
   where product.id = v_product_id
   for update;
  if not found then
    raise exception 'competitor observation not found' using errcode = 'P0002';
  end if;

  -- A concurrent identical request may have committed while this call waited
  -- for the product lock. Recheck idempotency before validating source state.
  select review.*
    into v_existing
    from sellerpilot_private.competitor_match_review_events review
   where review.request_id = p_request_id;
  if found then
    if v_existing.reviewer_id is distinct from v_actor_id
       or v_existing.request_payload_sha256 is distinct from v_request_payload_sha256 then
      raise exception 'competitor review request conflict' using errcode = '40001';
    end if;
    return sellerpilot_private.competitor_match_review_event_json(v_existing)
      || jsonb_build_object(
        'latestForSource', not exists (
          select 1
            from sellerpilot_private.competitor_match_review_events successor
           where successor.supersedes_event_id = v_existing.id
        )
      );
  end if;

  perform 1
    from sellerpilot_private.products product
   where product.id = v_product_id
     and product.status <> 'archived'
     and product.competitor_monitor_enabled;
  if not found then
    raise exception 'competitor observation not found' using errcode = 'P0002';
  end if;

  select observation.*
    into v_observation
    from sellerpilot_private.competitor_price_observations observation
   where observation.id = p_observation_id
     and observation.product_id = v_product_id
   for update;
  if not found then
    raise exception 'competitor observation changed' using errcode = '40001';
  end if;

  select review.*
    into v_latest
    from sellerpilot_private.competitor_match_review_events review
   where review.product_id = v_observation.product_id
     and review.source_provider = v_observation.provider
     and review.source_marketplace = v_observation.marketplace
     and review.source_external_id = v_observation.external_id
     and not exists (
       select 1
         from sellerpilot_private.competitor_match_review_events successor
        where successor.supersedes_event_id = review.id
     )
   order by review.created_at desc, review.id desc
   limit 1;

  if p_expected_latest_review_id is distinct from v_latest.id then
    raise exception 'competitor review state changed' using errcode = '40001';
  end if;
  if v_observation.matcher_version is distinct from 'strict-2026-08-31-v3'
     or v_observation.provider = 'manual'
     or v_observation.match_tier is distinct from 'probable' then
    raise exception 'competitor observation not reviewable' using errcode = '55000';
  end if;
  if v_observation.observation_fingerprint is distinct from p_expected_fingerprint
     or v_observation.checked_at is distinct from p_expected_checked_at then
    raise exception 'competitor observation changed' using errcode = '40001';
  end if;

  -- A current confirm/reject must be explicitly revoked before another
  -- decision can be appended. This prevents API bypasses from silently
  -- replacing one human decision with another.
  if p_decision <> 'revoked'
     and v_latest.id is not null
     and v_latest.source_observation_fingerprint = v_observation.observation_fingerprint
     and v_latest.decision in ('confirmed_exact', 'rejected') then
    raise exception 'competitor review state changed' using errcode = '40001';
  end if;

  if p_decision = 'confirmed_exact' then
    if jsonb_array_length(coalesce(v_observation.mismatch_evidence, '[]'::jsonb)) <> 0
       or not (p_reason_codes <@ '["source_opened","brand_model_match","gtin_mpn_match","quantity_pack_match","variant_condition_match","not_accessory_refill"]'::jsonb)
       or not (p_reason_codes @> '["source_opened","quantity_pack_match","variant_condition_match","not_accessory_refill"]'::jsonb)
       or not (
         p_reason_codes ? 'brand_model_match'
         or p_reason_codes ? 'gtin_mpn_match'
       ) then
      raise exception 'competitor review evidence incomplete';
    end if;
  elsif p_decision = 'rejected' then
    if not (p_reason_codes <@ '["source_opened","identity_mismatch","insufficient_identity"]'::jsonb)
       or not (p_reason_codes ? 'source_opened')
       or not (
         p_reason_codes ? 'identity_mismatch'
         or p_reason_codes ? 'insufficient_identity'
       ) then
      raise exception 'competitor review evidence incomplete';
    end if;
  else
    if v_latest.id is null
       or v_latest.source_observation_fingerprint is distinct from v_observation.observation_fingerprint
       or v_latest.decision not in ('confirmed_exact', 'rejected')
       or p_reason_codes <> '["review_withdrawn"]'::jsonb then
      raise exception 'competitor review state changed' using errcode = '40001';
    end if;
  end if;

  v_snapshot := to_jsonb(v_observation);
  v_snapshot_sha256 := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');

  insert into sellerpilot_private.competitor_match_review_events (
    request_id,
    product_id,
    source_observation_id,
    source_provider,
    source_marketplace,
    source_external_id,
    source_matcher_version,
    source_observation_fingerprint,
    source_checked_at,
    source_snapshot,
    source_snapshot_sha256,
    automated_match_tier,
    decision,
    reason_codes,
    note,
    reviewer_id,
    supersedes_event_id,
    request_payload_sha256
  ) values (
    p_request_id,
    v_observation.product_id,
    v_observation.id,
    v_observation.provider,
    v_observation.marketplace,
    v_observation.external_id,
    v_observation.matcher_version,
    v_observation.observation_fingerprint,
    v_observation.checked_at,
    v_snapshot,
    v_snapshot_sha256,
    v_observation.match_tier,
    p_decision,
    p_reason_codes,
    v_note,
    v_actor_id,
    v_latest.id,
    v_request_payload_sha256
  )
  returning * into v_inserted;

  return sellerpilot_private.competitor_match_review_event_json(v_inserted)
    || jsonb_build_object('latestForSource', true);
end;
$$;

revoke all on function public.sellerpilot_review_competitor_match(
  uuid, text, timestamptz, uuid, text, jsonb, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_review_competitor_match(
  uuid, text, timestamptz, uuid, text, jsonb, text, uuid
) to authenticated;

create or replace function public.sellerpilot_get_competitor_match_review_history(
  p_observation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_observation sellerpilot_private.competitor_price_observations%rowtype;
  v_history jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select observation.*
    into v_observation
    from sellerpilot_private.competitor_price_observations observation
   where observation.id = p_observation_id;
  if not found then return null; end if;

  select coalesce(
           jsonb_agg(
             sellerpilot_private.competitor_match_review_event_json(review)
             || jsonb_build_object(
               'sourceCurrent',
               review.source_observation_fingerprint = v_observation.observation_fingerprint
             )
             order by review.created_at desc, review.id desc
           ),
           '[]'::jsonb
         )
    into v_history
    from (
      select review_event.*
        from sellerpilot_private.competitor_match_review_events review_event
       where review_event.product_id = v_observation.product_id
         and review_event.source_provider = v_observation.provider
         and review_event.source_marketplace = v_observation.marketplace
         and review_event.source_external_id = v_observation.external_id
       order by review_event.created_at desc, review_event.id desc
       limit 100
    ) review;

  return v_history;
end;
$$;

revoke all on function public.sellerpilot_get_competitor_match_review_history(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_get_competitor_match_review_history(uuid)
  to authenticated;

alter function public.sellerpilot_get_product_operations_v2(uuid)
  rename to sellerpilot_get_product_operations_v2_pre_competitor_review;

revoke all on function public.sellerpilot_get_product_operations_v2_pre_competitor_review(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_get_product_operations_v2(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_prices jsonb;
begin
  v_result := public.sellerpilot_get_product_operations_v2_pre_competitor_review(p_product_id);
  if v_result is null then return null; end if;

  select coalesce(
           jsonb_agg(
             price.value
             || case
               when observation.matcher_version = 'strict-2026-08-31-v3' then
                 jsonb_build_object(
                   'observationId', observation.id,
                   'observationFingerprint', observation.observation_fingerprint,
                   'sourceProvider', observation.provider,
                   'automatedMatchTier', observation.match_tier,
                   'effectiveMatchTier', case
                     when review.source_observation_fingerprint = observation.observation_fingerprint
                      and review.decision = 'confirmed_exact' then 'exact'
                     when review.source_observation_fingerprint = observation.observation_fingerprint
                      and review.decision = 'rejected' then 'rejected'
                     else observation.match_tier
                   end,
                   'latestHumanReview', case when review.id is null then null else
                     sellerpilot_private.competitor_match_review_event_json(review)
                     || jsonb_build_object(
                       'sourceCurrent',
                       review.source_observation_fingerprint = observation.observation_fingerprint
                     )
                   end
                 )
               else '{}'::jsonb
             end
             order by price.ordinality
           ),
           '[]'::jsonb
         )
    into v_prices
    from jsonb_array_elements(coalesce(v_result->'competitorPrices', '[]'::jsonb))
      with ordinality price(value, ordinality)
    left join sellerpilot_private.competitor_price_observations observation
      on observation.id = case
        when price.value->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (price.value->>'id')::uuid
        else null
      end
    left join lateral (
      select review_event.*
        from sellerpilot_private.competitor_match_review_events review_event
       where review_event.product_id = observation.product_id
         and review_event.source_provider = observation.provider
         and review_event.source_marketplace = observation.marketplace
         and review_event.source_external_id = observation.external_id
         and not exists (
           select 1
             from sellerpilot_private.competitor_match_review_events successor
            where successor.supersedes_event_id = review_event.id
         )
       order by review_event.created_at desc, review_event.id desc
       limit 1
    ) review on true;

  return jsonb_set(v_result, '{competitorPrices}', v_prices, true);
end;
$$;

revoke all on function public.sellerpilot_get_product_operations_v2(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_get_product_operations_v2(uuid)
  to authenticated;

commit;
