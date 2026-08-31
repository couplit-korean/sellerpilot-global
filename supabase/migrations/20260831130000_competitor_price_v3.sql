-- Persist conservative same-product v3 decisions without rewriting the v2
-- audit trail. Automatic v3 snapshots keep component/FX/source provenance,
-- while manual and strict-2026-08-28-v2 observations remain untouched.

begin;

alter table sellerpilot_private.competitor_price_observations
  add column match_score numeric(5,2),
  add column match_tier text,
  add column match_evidence jsonb,
  add column mismatch_evidence jsonb,
  add column price_components jsonb,
  add column total_purchase_price jsonb,
  add column exchange_rate jsonb,
  add column unit_price jsonb,
  add column canonical_url text,
  add column provenance jsonb,
  add column observed_at timestamptz,
  add column inventory_status text,
  add column observation_fingerprint text;

comment on column sellerpilot_private.competitor_price_observations.match_tier is
  'v3 same-product decision: exact, probable, or rejected. NULL is legacy/manual.';
comment on column sellerpilot_private.competitor_price_observations.price_components is
  'Separated item, required-option, shipping, tax/duty, and confirmed-discount values; unknown is never coerced to zero.';
comment on column sellerpilot_private.competitor_price_observations.provenance is
  'Bounded source history for this provider-owned raw observation.';
comment on column sellerpilot_private.competitor_price_observations.observation_fingerprint is
  'SHA-256 of matcher-versioned observation values excluding collection timestamps/provenance.';

create or replace function sellerpilot_private.valid_competitor_match_evidence(
  p_evidence jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_evidence is null
      or jsonb_typeof(p_evidence) <> 'array'
      or jsonb_array_length(p_evidence) > 64
      or octet_length(p_evidence::text) > 64000
    then false
    else coalesce((not exists (
      select 1
        from jsonb_array_elements(p_evidence) evidence(value)
       where jsonb_typeof(evidence.value) <> 'object'
          or jsonb_typeof(evidence.value->'code') <> 'string'
          or length(evidence.value->>'code') not between 1 and 80
          or jsonb_typeof(evidence.value->'attribute') <> 'string'
          or length(evidence.value->>'attribute') not between 1 and 80
          or (
            evidence.value ? 'expected'
            and (
              jsonb_typeof(evidence.value->'expected') <> 'string'
              or length(evidence.value->>'expected') > 1000
            )
          )
          or (
            evidence.value ? 'actual'
            and (
              jsonb_typeof(evidence.value->'actual') <> 'string'
              or length(evidence.value->>'actual') > 1000
            )
          )
          or (
            evidence.value ? 'source'
            and (
              jsonb_typeof(evidence.value->'source') <> 'string'
              or length(evidence.value->>'source') not between 1 and 80
            )
          )
          or exists (
            select 1
              from jsonb_object_keys(evidence.value) key
             where key not in ('code', 'attribute', 'expected', 'actual', 'source')
          )
    )), false)
  end
$$;

create or replace function sellerpilot_private.valid_competitor_money_component(
  p_component jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_component is null or jsonb_typeof(p_component) <> 'object' then false
    else coalesce((
      not exists (
        select 1 from jsonb_object_keys(p_component) key
         where key not in ('status', 'amount', 'currency', 'krwAmount')
      )
      and jsonb_typeof(p_component->'status') = 'string'
      and p_component->>'status' in ('known', 'unknown')
      and jsonb_typeof(p_component->'currency') = 'string'
      and p_component->>'currency' ~ '^[A-Z]{3}$'
      and case p_component->>'status'
            when 'known' then
              jsonb_typeof(p_component->'amount') = 'number'
              and (p_component->>'amount')::numeric between 0 and 99999999999999.99
              and (
                jsonb_typeof(p_component->'krwAmount') = 'null'
                or (
                  jsonb_typeof(p_component->'krwAmount') = 'number'
                  and (p_component->>'krwAmount')::numeric between 0 and 99999999999999.99
                )
              )
            else
              jsonb_typeof(p_component->'amount') = 'null'
              and jsonb_typeof(p_component->'krwAmount') = 'null'
          end
    ), false)
  end
$$;

create or replace function sellerpilot_private.valid_competitor_total_money(
  p_total jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_total is null or jsonb_typeof(p_total) <> 'object' then false
    else coalesce((
      not exists (
        select 1 from jsonb_object_keys(p_total) key
         where key not in ('amount', 'currency', 'krwAmount')
      )
      and jsonb_typeof(p_total->'amount') = 'number'
      and (p_total->>'amount')::numeric between 0 and 99999999999999.99
      and jsonb_typeof(p_total->'currency') = 'string'
      and p_total->>'currency' ~ '^[A-Z]{3}$'
      and (
        jsonb_typeof(p_total->'krwAmount') = 'null'
        or (
          jsonb_typeof(p_total->'krwAmount') = 'number'
          and (p_total->>'krwAmount')::numeric between 0 and 99999999999999.99
        )
      )
    ), false)
  end
$$;

create or replace function sellerpilot_private.valid_competitor_exchange_rate(
  p_exchange jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_exchange is null or jsonb_typeof(p_exchange) <> 'object' then false
    else coalesce((
      not exists (
        select 1 from jsonb_object_keys(p_exchange) key
         where key not in ('provider', 'quotedAt', 'rate', 'fromCurrency', 'toCurrency')
      )
      and jsonb_typeof(p_exchange->'provider') = 'string'
      and length(p_exchange->>'provider') between 1 and 120
      and jsonb_typeof(p_exchange->'quotedAt') = 'string'
      and p_exchange->>'quotedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:'
      and length(p_exchange->>'quotedAt') <= 80
      and jsonb_typeof(p_exchange->'rate') = 'number'
      and (p_exchange->>'rate')::numeric > 0
      and (p_exchange->>'rate')::numeric <= 999999999999.999999
      and jsonb_typeof(p_exchange->'fromCurrency') = 'string'
      and p_exchange->>'fromCurrency' ~ '^[A-Z]{3}$'
      and jsonb_typeof(p_exchange->'toCurrency') = 'string'
      and p_exchange->>'toCurrency' = 'KRW'
    ), false)
  end
$$;

create or replace function sellerpilot_private.valid_competitor_unit_price(
  p_unit_price jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_unit_price is null or jsonb_typeof(p_unit_price) <> 'object' then false
    else coalesce((
      not exists (
        select 1 from jsonb_object_keys(p_unit_price) key
         where key not in ('amount', 'currency', 'krwAmount', 'quantity')
      )
      and jsonb_typeof(p_unit_price->'amount') = 'number'
      and (p_unit_price->>'amount')::numeric between 0 and 99999999999999.99
      and jsonb_typeof(p_unit_price->'currency') = 'string'
      and p_unit_price->>'currency' ~ '^[A-Z]{3}$'
      and (
        jsonb_typeof(p_unit_price->'krwAmount') = 'null'
        or (
          jsonb_typeof(p_unit_price->'krwAmount') = 'number'
          and (p_unit_price->>'krwAmount')::numeric between 0 and 99999999999999.99
        )
      )
      and jsonb_typeof(p_unit_price->'quantity') = 'object'
      and jsonb_typeof(p_unit_price->'quantity'->'value') = 'number'
      and (p_unit_price->'quantity'->>'value')::numeric > 0
      and (p_unit_price->'quantity'->>'value')::numeric <= 1000000000
      and jsonb_typeof(p_unit_price->'quantity'->'unit') = 'string'
      and length(p_unit_price->'quantity'->>'unit') between 1 and 40
      and not exists (
        select 1 from jsonb_object_keys(p_unit_price->'quantity') key
         where key not in ('value', 'unit')
      )
    ), false)
  end
$$;

create or replace function sellerpilot_private.valid_competitor_provenance(
  p_provenance jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_provenance is null
      or jsonb_typeof(p_provenance) <> 'array'
      or jsonb_array_length(p_provenance) not between 1 and 32
      or octet_length(p_provenance::text) > 128000
    then false
    else coalesce((
      not exists (
        select 1
          from jsonb_array_elements(p_provenance) source(value)
         where jsonb_typeof(source.value) <> 'object'
            or exists (
              select 1 from jsonb_object_keys(source.value) key
               where key not in ('provider', 'marketplace', 'externalId', 'url', 'collectedAt')
            )
            or source.value->>'provider' not in (
              'naver_shopping', 'elevenst_product_search', 'ebay_browse', 'brave_marketplace_web'
            )
            or source.value->>'marketplace' not in (
              'smartstore', 'coupang', 'elevenst', 'qoo10', 'shopee',
              'lazada', 'ebay', 'temu', 'other'
            )
            or jsonb_typeof(source.value->'externalId') <> 'string'
            or length(source.value->>'externalId') not between 1 and 500
            or jsonb_typeof(source.value->'url') <> 'string'
            or length(source.value->>'url') not between 8 and 4000
            or source.value->>'url' !~ '^https?://'
            or jsonb_typeof(source.value->'collectedAt') <> 'string'
            or source.value->>'collectedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:'
            or length(source.value->>'collectedAt') > 80
      )
      and (
        select count(*) = count(distinct source.value)
          from jsonb_array_elements(p_provenance) source(value)
      )
    ), false)
  end
$$;

create or replace function sellerpilot_private.valid_competitor_v3_item(
  p_item jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_item is null or jsonb_typeof(p_item) <> 'object' then false
    else coalesce((
      p_item->>'matcherVersion' = 'strict-2026-08-31-v3'
      and p_item->>'provider' in (
        'naver_shopping', 'elevenst_product_search', 'ebay_browse', 'brave_marketplace_web'
      )
      and p_item->>'marketplace' in (
        'smartstore', 'coupang', 'elevenst', 'qoo10', 'shopee',
        'lazada', 'ebay', 'temu', 'other'
      )
      and jsonb_typeof(p_item->'externalId') = 'string'
      and length(p_item->>'externalId') between 1 and 500
      and jsonb_typeof(p_item->'url') = 'string'
      and length(p_item->>'url') between 8 and 4000
      and p_item->>'url' ~ '^https?://'
      and jsonb_typeof(p_item->'price') = 'number'
      and (p_item->>'price')::numeric > 0
      and jsonb_typeof(p_item->'currency') = 'string'
      and p_item->>'currency' ~ '^[A-Z]{3}$'
      and jsonb_typeof(p_item->'matchScore') = 'number'
      and (p_item->>'matchScore')::numeric between 0 and 100
      and p_item->>'matchTier' in ('exact', 'probable', 'rejected')
      and sellerpilot_private.valid_competitor_match_evidence(p_item->'matchEvidence')
      and sellerpilot_private.valid_competitor_match_evidence(p_item->'mismatchEvidence')
      and case p_item->>'matchTier'
            when 'exact' then
              jsonb_array_length(p_item->'matchEvidence') > 0
              and jsonb_array_length(p_item->'mismatchEvidence') = 0
            when 'rejected' then jsonb_array_length(p_item->'mismatchEvidence') > 0
            else true
          end
      and jsonb_typeof(p_item->'priceComponents') = 'object'
      and not exists (
        select 1 from jsonb_object_keys(p_item->'priceComponents') key
         where key not in (
           'itemPrice', 'requiredOptionSurcharge', 'shipping', 'taxAndDuty', 'discount'
         )
      )
      and (
        select count(*) = 5 from jsonb_object_keys(p_item->'priceComponents')
      )
      and sellerpilot_private.valid_competitor_money_component(p_item->'priceComponents'->'itemPrice')
      and sellerpilot_private.valid_competitor_money_component(p_item->'priceComponents'->'requiredOptionSurcharge')
      and sellerpilot_private.valid_competitor_money_component(p_item->'priceComponents'->'shipping')
      and sellerpilot_private.valid_competitor_money_component(p_item->'priceComponents'->'taxAndDuty')
      and sellerpilot_private.valid_competitor_money_component(p_item->'priceComponents'->'discount')
      and not exists (
        select 1
          from jsonb_array_elements(jsonb_build_array(
            p_item->'priceComponents'->'itemPrice',
            p_item->'priceComponents'->'requiredOptionSurcharge',
            p_item->'priceComponents'->'shipping',
            p_item->'priceComponents'->'taxAndDuty',
            p_item->'priceComponents'->'discount'
          )) component(value)
         where component.value->>'currency' <> p_item->>'currency'
      )
      and case
            when exists (
              select 1
                from jsonb_array_elements(jsonb_build_array(
                  p_item->'priceComponents'->'itemPrice',
                  p_item->'priceComponents'->'requiredOptionSurcharge',
                  p_item->'priceComponents'->'shipping',
                  p_item->'priceComponents'->'taxAndDuty',
                  p_item->'priceComponents'->'discount'
                )) component(value)
               where component.value->>'status' = 'unknown'
            ) then jsonb_typeof(p_item->'totalPurchasePrice') = 'null'
            else
              sellerpilot_private.valid_competitor_total_money(p_item->'totalPurchasePrice')
              and p_item->'totalPurchasePrice'->>'currency' = p_item->>'currency'
              and abs(
                (p_item->'totalPurchasePrice'->>'amount')::numeric
                - (
                  (p_item->'priceComponents'->'itemPrice'->>'amount')::numeric
                  + (p_item->'priceComponents'->'requiredOptionSurcharge'->>'amount')::numeric
                  + (p_item->'priceComponents'->'shipping'->>'amount')::numeric
                  + (p_item->'priceComponents'->'taxAndDuty'->>'amount')::numeric
                  - (p_item->'priceComponents'->'discount'->>'amount')::numeric
                )
              ) <= 0.02
          end
      and case
            when p_item->>'currency' = 'KRW' then
              jsonb_typeof(p_item->'exchangeRate') = 'null'
              and (
                jsonb_typeof(p_item->'totalPurchasePrice') = 'null'
                or (
                  jsonb_typeof(p_item->'totalPurchasePrice'->'krwAmount') = 'number'
                  and abs(
                    (p_item->'totalPurchasePrice'->>'krwAmount')::numeric
                    - (p_item->'totalPurchasePrice'->>'amount')::numeric
                  ) <= 0.02
                )
              )
            when jsonb_typeof(p_item->'totalPurchasePrice') = 'null' then
              jsonb_typeof(p_item->'exchangeRate') = 'null'
              or (
                sellerpilot_private.valid_competitor_exchange_rate(p_item->'exchangeRate')
                and p_item->'exchangeRate'->>'fromCurrency' = p_item->>'currency'
              )
            else
              (
                jsonb_typeof(p_item->'exchangeRate') = 'null'
                and jsonb_typeof(p_item->'totalPurchasePrice'->'krwAmount') = 'null'
              )
              or (
                sellerpilot_private.valid_competitor_exchange_rate(p_item->'exchangeRate')
                and p_item->'exchangeRate'->>'fromCurrency' = p_item->'totalPurchasePrice'->>'currency'
                and jsonb_typeof(p_item->'totalPurchasePrice'->'krwAmount') = 'number'
                and abs(
                  (p_item->'totalPurchasePrice'->>'krwAmount')::numeric
                  - round(
                      (p_item->'totalPurchasePrice'->>'amount')::numeric
                      * (p_item->'exchangeRate'->>'rate')::numeric,
                      2
                    )
                ) <= 0.02
              )
          end
      and not exists (
        select 1
          from jsonb_array_elements(jsonb_build_array(
            p_item->'priceComponents'->'itemPrice',
            p_item->'priceComponents'->'requiredOptionSurcharge',
            p_item->'priceComponents'->'shipping',
            p_item->'priceComponents'->'taxAndDuty',
            p_item->'priceComponents'->'discount'
          )) component(value)
         where component.value->>'status' = 'known'
           and not coalesce((
             case
               when p_item->>'currency' = 'KRW' then
                 jsonb_typeof(component.value->'krwAmount') = 'number'
                 and abs(
                   (component.value->>'krwAmount')::numeric
                   - (component.value->>'amount')::numeric
                 ) <= 0.02
               when jsonb_typeof(p_item->'exchangeRate') = 'null' then
                 jsonb_typeof(component.value->'krwAmount') = 'null'
               else
                 sellerpilot_private.valid_competitor_exchange_rate(p_item->'exchangeRate')
                 and p_item->'exchangeRate'->>'fromCurrency' = p_item->>'currency'
                 and jsonb_typeof(component.value->'krwAmount') = 'number'
                 and abs(
                   (component.value->>'krwAmount')::numeric
                   - round(
                       (component.value->>'amount')::numeric
                       * (p_item->'exchangeRate'->>'rate')::numeric,
                       2
                     )
                 ) <= 0.02
             end
           ), false)
      )
      and case
            when jsonb_typeof(p_item->'totalPurchasePrice') = 'null' then
              jsonb_typeof(p_item->'unitPrice') = 'null'
            when jsonb_typeof(p_item->'unitPrice') = 'null' then true
            else
              sellerpilot_private.valid_competitor_unit_price(p_item->'unitPrice')
              and p_item->'unitPrice'->>'currency' = p_item->>'currency'
              and case
                    when p_item->>'currency' = 'KRW' then
                      jsonb_typeof(p_item->'unitPrice'->'krwAmount') = 'number'
                      and abs(
                        (p_item->'unitPrice'->>'krwAmount')::numeric
                        - (p_item->'unitPrice'->>'amount')::numeric
                      ) <= 0.02
                    when jsonb_typeof(p_item->'exchangeRate') = 'null' then
                      jsonb_typeof(p_item->'unitPrice'->'krwAmount') = 'null'
                    else
                      sellerpilot_private.valid_competitor_exchange_rate(p_item->'exchangeRate')
                      and p_item->'exchangeRate'->>'fromCurrency' = p_item->>'currency'
                      and jsonb_typeof(p_item->'unitPrice'->'krwAmount') = 'number'
                      and abs(
                        (p_item->'unitPrice'->>'krwAmount')::numeric
                        - round(
                            (p_item->'unitPrice'->>'amount')::numeric
                            * (p_item->'exchangeRate'->>'rate')::numeric,
                            2
                          )
                      ) <= 0.02
                  end
          end
      and jsonb_typeof(p_item->'canonicalUrl') = 'string'
      and length(p_item->>'canonicalUrl') between 8 and 4000
      and p_item->>'canonicalUrl' ~ '^https?://'
      and sellerpilot_private.valid_competitor_provenance(p_item->'provenance')
      and exists (
        select 1
          from jsonb_array_elements(p_item->'provenance') source(value)
         where source.value->>'provider' = p_item->>'provider'
           and source.value->>'marketplace' = p_item->>'marketplace'
      )
      and not exists (
        select 1
          from jsonb_array_elements(p_item->'provenance') source(value)
         where source.value->>'provider' <> p_item->>'provider'
      )
      and jsonb_typeof(p_item->'observedAt') = 'string'
      and p_item->>'observedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:'
      and length(p_item->>'observedAt') <= 80
      and p_item->>'inventoryStatus' in ('in_stock', 'out_of_stock', 'unknown')
    ), false)
  end
$$;

revoke all on function sellerpilot_private.valid_competitor_match_evidence(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.valid_competitor_money_component(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.valid_competitor_total_money(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.valid_competitor_exchange_rate(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.valid_competitor_unit_price(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.valid_competitor_provenance(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.valid_competitor_v3_item(jsonb)
  from public, anon, authenticated, service_role;

alter table sellerpilot_private.competitor_price_observations
  add constraint competitor_price_observations_v3_payload_check
  check (
    matcher_version is distinct from 'strict-2026-08-31-v3'
    or coalesce(sellerpilot_private.valid_competitor_v3_item(jsonb_build_object(
      'provider', provider,
      'externalId', external_id,
      'url', product_url,
      'marketplace', marketplace,
      'price', price,
      'currency', currency,
      'matcherVersion', matcher_version,
      'matchScore', match_score,
      'matchTier', match_tier,
      'matchEvidence', match_evidence,
      'mismatchEvidence', mismatch_evidence,
      'priceComponents', price_components,
      'totalPurchasePrice', total_purchase_price,
      'exchangeRate', exchange_rate,
      'unitPrice', unit_price,
      'canonicalUrl', canonical_url,
      'provenance', provenance,
      'observedAt', observed_at,
      'inventoryStatus', inventory_status
    )), false)
  ) not valid,
  add constraint competitor_price_observations_v3_fingerprint_check
  check (
    matcher_version is distinct from 'strict-2026-08-31-v3'
    or observation_fingerprint ~ '^[0-9a-f]{64}$'
  ) not valid;

alter table sellerpilot_private.competitor_price_observations
  validate constraint competitor_price_observations_v3_payload_check;
alter table sellerpilot_private.competitor_price_observations
  validate constraint competitor_price_observations_v3_fingerprint_check;

-- The original source key did not include matcher_version, so a v3 observation
-- would overwrite its v2 audit row. Replace that constraint without deleting or
-- rewriting any existing observation.
do $drop_legacy_competitor_source_key$
declare
  v_constraint text;
begin
  select constraint_row.conname
    into v_constraint
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid = 'sellerpilot_private.competitor_price_observations'::regclass
     and constraint_row.contype = 'u'
     and pg_catalog.pg_get_constraintdef(constraint_row.oid)
       = 'UNIQUE (product_id, provider, external_id)'
   limit 1;
  if v_constraint is not null then
    execute format(
      'alter table sellerpilot_private.competitor_price_observations drop constraint %I',
      v_constraint
    );
  end if;
end;
$drop_legacy_competitor_source_key$;

create unique index competitor_price_observations_versioned_source_key
  on sellerpilot_private.competitor_price_observations (
    product_id,
    provider,
    external_id,
    (coalesce(matcher_version, ''))
  )
  where matcher_version is distinct from 'strict-2026-08-31-v3';

create unique index competitor_price_observations_v3_marketplace_external_key
  on sellerpilot_private.competitor_price_observations (
    product_id, matcher_version, provider, marketplace, external_id
  )
  where matcher_version = 'strict-2026-08-31-v3'
    and provider <> 'manual';

create unique index competitor_price_observations_v3_canonical_url_key
  on sellerpilot_private.competitor_price_observations (
    product_id, matcher_version, provider, canonical_url
  )
  where matcher_version = 'strict-2026-08-31-v3'
    and provider <> 'manual'
    and canonical_url is not null;

create unique index competitor_price_observations_v3_fingerprint_key
  on sellerpilot_private.competitor_price_observations (
    product_id, matcher_version, provider, observation_fingerprint
  )
  where matcher_version = 'strict-2026-08-31-v3'
    and provider <> 'manual'
    and observation_fingerprint is not null;

drop index if exists sellerpilot_private.competitor_prices_current_matcher_idx;
create index competitor_prices_current_matcher_idx
  on sellerpilot_private.competitor_price_observations (
    product_id, match_tier, marketplace, checked_at desc, price, id
  )
  where provider = 'manual'
     or matcher_version in ('strict-2026-08-28-v2', 'strict-2026-08-31-v3');

alter table sellerpilot_private.competitor_price_observations enable row level security;
revoke all on sellerpilot_private.competitor_price_observations
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.competitor_identity_from_product(
  p_name text,
  p_facts jsonb
)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'productName', coalesce(
      nullif(trim(coalesce(p_facts->>'productName', '')), ''),
      nullif(trim(coalesce(p_name, '')), '')
    ),
    'brand', nullif(trim(coalesce(p_facts->>'brandName', '')), ''),
    'manufacturer', nullif(trim(coalesce(p_facts->>'manufacturer', '')), ''),
    'packageContents', case
      when jsonb_typeof(p_facts->'packageContents') = 'string'
       and length(trim(p_facts->>'packageContents')) between 1 and 500
        then trim(p_facts->>'packageContents')
      else null
    end,
    'gtins', case
      when p_facts->>'gtinStatus' = 'HAS_GTIN'
       and p_facts->>'gtin' ~ '^\d{8,14}$'
        then jsonb_build_array(p_facts->>'gtin')
      else null
    end,
    'manufacturerPartNumber', case
      when length(trim(coalesce(p_facts->>'manufacturerPartNumber', ''))) between 1 and 160
        then trim(p_facts->>'manufacturerPartNumber')
      else null
    end,
    'modelNumber', case
      when length(trim(coalesce(p_facts->>'modelNumber', ''))) between 1 and 160
        then trim(p_facts->>'modelNumber')
      else null
    end,
    'specification', case
      when jsonb_typeof(p_facts->'specification') = 'object'
       and jsonb_typeof(p_facts->'specification'->'value') = 'number'
       and (p_facts->'specification'->>'value')::numeric > 0
       and jsonb_typeof(p_facts->'specification'->'unit') = 'string'
       and length(p_facts->'specification'->>'unit') between 1 and 40
        then jsonb_build_object(
          'value', p_facts->'specification'->'value',
          'unit', p_facts->'specification'->>'unit'
        )
      else null
    end,
    'itemCount', case
      when jsonb_typeof(p_facts->'itemCount') = 'number'
       and (p_facts->>'itemCount')::numeric > 0
       and (p_facts->>'itemCount')::numeric = trunc((p_facts->>'itemCount')::numeric)
        then p_facts->'itemCount'
      else null
    end,
    'totalQuantity', case
      when jsonb_typeof(p_facts->'totalQuantity') = 'object'
       and jsonb_typeof(p_facts->'totalQuantity'->'value') = 'number'
       and (p_facts->'totalQuantity'->>'value')::numeric > 0
       and jsonb_typeof(p_facts->'totalQuantity'->'unit') = 'string'
       and length(p_facts->'totalQuantity'->>'unit') between 1 and 40
        then jsonb_build_object(
          'value', p_facts->'totalQuantity'->'value',
          'unit', p_facts->'totalQuantity'->>'unit'
        )
      else null
    end,
    'packageType', case
      when p_facts->>'packageType' in ('single', 'bundle') then p_facts->>'packageType'
      else null
    end,
    'contentType', case
      when p_facts->>'contentType' in ('main', 'refill', 'sample') then p_facts->>'contentType'
      else null
    end,
    'condition', case p_facts->>'condition'
      when 'NEW' then 'new'
      when 'USED' then 'used'
      when 'REFURBISHED' then 'refurbished'
      else null
    end,
    'purchaseType', case
      when p_facts->>'purchaseType' in ('one_time', 'subscription', 'rental')
        then p_facts->>'purchaseType'
      else null
    end,
    'options', case
      when jsonb_typeof(p_facts->'options') = 'object' then jsonb_strip_nulls(jsonb_build_object(
        'flavor', case when jsonb_typeof(p_facts->'options'->'flavor') = 'string' then nullif(trim(p_facts->'options'->>'flavor'), '') else null end,
        'color', case when jsonb_typeof(p_facts->'options'->'color') = 'string' then nullif(trim(p_facts->'options'->>'color'), '') else null end,
        'size', case when jsonb_typeof(p_facts->'options'->'size') = 'string' then nullif(trim(p_facts->'options'->>'size'), '') else null end,
        'generation', case when jsonb_typeof(p_facts->'options'->'generation') = 'string' then nullif(trim(p_facts->'options'->>'generation'), '') else null end,
        'compatibleModel', case when jsonb_typeof(p_facts->'options'->'compatibleModel') = 'string' then nullif(trim(p_facts->'options'->>'compatibleModel'), '') else null end,
        'option', case when jsonb_typeof(p_facts->'options'->'option') = 'string' then nullif(trim(p_facts->'options'->>'option'), '') else null end
      ))
      else null
    end
  ))
$$;

revoke all on function sellerpilot_private.competitor_identity_from_product(text, jsonb)
  from public, anon, authenticated, service_role;

-- Change only the returned row shape; callers using SELECT * / supabase-js RPC
-- remain source-compatible and receive one additional confirmed identity object.
revoke all on function public.sellerpilot_service_claim_due_competitor_products(integer, integer)
  from public, anon, authenticated, service_role;
drop function public.sellerpilot_service_claim_due_competitor_products(integer, integer);

create function public.sellerpilot_service_claim_due_competitor_products(
  p_limit integer default 1,
  p_lease_seconds integer default 90
)
returns table(product_id uuid, query text, aliases jsonb, claim_token uuid, identity jsonb)
language sql
security definer
set search_path = ''
as $$
  with candidates as materialized (
    select p.id as product_id,
           coalesce(nullif(p.competitor_query, ''), p.name) as query,
           coalesce(a.aliases, '[]'::jsonb) as aliases,
           sellerpilot_private.competitor_identity_from_product(p.name, p.product_facts) as identity
      from sellerpilot_private.products p
      left join sellerpilot_private.ai_cli_jobs j on j.id = p.ai_job_id
      left join sellerpilot_private.competitor_price_refresh_claims refresh_state
        on refresh_state.product_id = p.id
      left join sellerpilot_private.channel_gateway_jobs resume_job
        on resume_job.id = refresh_state.gateway_job_id
      left join lateral (
        select jsonb_agg(v.title order by v.first_position) as aliases
          from (
            select left(trim(item.value->>'title'), 160) as title,
                   min(item.ordinality) as first_position
              from jsonb_array_elements(coalesce(j.result_payload->'localizedListings', '[]'::jsonb))
                with ordinality as item(value, ordinality)
             where length(trim(coalesce(item.value->>'title', ''))) between 2 and 160
             group by left(trim(item.value->>'title'), 160)
             order by min(item.ordinality)
             limit 12
          ) v
      ) a on true
     where not p.demo
       and p.status <> 'archived'
       and p.competitor_monitor_enabled
       and (p.competitor_checked_at is null or p.competitor_checked_at <= clock_timestamp() - interval '30 minutes')
       and (refresh_state.claim_token is null or refresh_state.lease_expires_at <= clock_timestamp())
     order by case
                when resume_job.status = 'succeeded'
                 and resume_job.completed_at >= clock_timestamp() - interval '30 minutes'
                 and resume_job.response_payload->>'ok' = 'true'
                 and resume_job.response_payload->>'channel' = 'elevenst'
                 and resume_job.response_payload->>'operation' = 'competitor.search'
                 and jsonb_typeof(resume_job.response_payload->'items') = 'array'
                then 0 else 1
              end,
              refresh_state.last_attempted_at nulls first,
              p.competitor_checked_at nulls first,
              p.updated_at desc,
              p.id
     for update of p skip locked
     limit greatest(1, least(coalesce(p_limit, 1), 3))
  ), claimed as (
    insert into sellerpilot_private.competitor_price_refresh_claims (
      product_id, claim_token, claimed_at, lease_expires_at, last_attempted_at
    )
    select c.product_id,
           gen_random_uuid(),
           clock_timestamp(),
           clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 90), 300))),
           clock_timestamp()
      from candidates c
    on conflict (product_id) do update
      set claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at,
          lease_expires_at = excluded.lease_expires_at,
          last_attempted_at = excluded.last_attempted_at
      where sellerpilot_private.competitor_price_refresh_claims.claim_token is null
         or sellerpilot_private.competitor_price_refresh_claims.lease_expires_at <= clock_timestamp()
    returning sellerpilot_private.competitor_price_refresh_claims.product_id,
              sellerpilot_private.competitor_price_refresh_claims.claim_token
  )
  select c.product_id, c.query, c.aliases, claimed.claim_token, c.identity
    from candidates c
    join claimed using (product_id)
   order by c.product_id
$$;

revoke all on function public.sellerpilot_service_claim_due_competitor_products(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_claim_due_competitor_products(integer, integer)
  to service_role;

create or replace function sellerpilot_private.record_competitor_prices(
  p_product_id uuid,
  p_items jsonb,
  p_allow_v3 boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_count integer := 0;
  v_external text;
  v_marketplace text;
  v_provider text;
  v_currency text;
  v_matcher_version text;
  v_canonical_url text;
  v_provenance jsonb;
  v_existing_id uuid;
  v_existing_provenance jsonb;
  v_merged_provenance jsonb;
  v_fingerprint text;
begin
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid competitor prices';
  end if;

  perform 1
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.status <> 'archived'
     and product.competitor_monitor_enabled
   for update;
  if not found then return 0; end if;

  for v in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v) <> 'object' then
      raise exception 'invalid competitor prices';
    end if;

    v_external := left(coalesce(nullif(trim(v->>'externalId'), ''), md5(coalesce(v->>'url', ''))), 500);
    v_marketplace := coalesce(nullif(v->>'marketplace', ''), 'other');
    v_provider := coalesce(nullif(v->>'provider', ''), 'naver_shopping');
    v_currency := upper(coalesce(nullif(v->>'currency', ''), 'KRW'));
    v_matcher_version := case
      when v_provider = 'manual' then null
      else nullif(trim(v->>'matcherVersion'), '')
    end;

    if v_provider not in (
      'naver_shopping', 'elevenst_product_search', 'ebay_browse',
      'brave_marketplace_web', 'manual'
    ) then
      raise exception 'invalid competitor provider';
    end if;
    if v_provider <> 'manual'
       and (
         v_matcher_version is null
         or v_matcher_version not in ('strict-2026-08-28-v2', 'strict-2026-08-31-v3')
       ) then
      raise exception 'invalid competitor matcher version';
    end if;
    if v_matcher_version = 'strict-2026-08-31-v3'
       and not coalesce(sellerpilot_private.valid_competitor_v3_item(v), false) then
      raise exception 'invalid competitor v3 observation';
    end if;
    if v_matcher_version = 'strict-2026-08-31-v3' and not p_allow_v3 then
      raise exception 'competitor v3 observations require refresh completion';
    end if;
    if v_marketplace not in (
      'smartstore', 'coupang', 'elevenst', 'qoo10', 'shopee',
      'lazada', 'ebay', 'temu', 'other'
    ) then
      v_marketplace := 'other';
    end if;
    if v_currency !~ '^[A-Z]{3}$' then
      raise exception 'invalid competitor currency';
    end if;
    if jsonb_typeof(v->'price') <> 'number' or (v->>'price')::numeric < 0 then
      continue;
    end if;

    if v_matcher_version = 'strict-2026-08-31-v3' then
      v_canonical_url := left(v->>'canonicalUrl', 4000);
      v_provenance := v->'provenance';
      v_fingerprint := encode(
        extensions.digest((v - 'provenance' - 'observedAt')::text, 'sha256'),
        'hex'
      );
      v_existing_id := null;
      v_existing_provenance := null;
      select observation.id, observation.provenance
        into v_existing_id, v_existing_provenance
        from sellerpilot_private.competitor_price_observations observation
       where observation.product_id = p_product_id
         and observation.matcher_version = 'strict-2026-08-31-v3'
         and observation.provider = v_provider
         and (
           (observation.marketplace = v_marketplace and observation.external_id = v_external)
           or observation.canonical_url = v_canonical_url
           or observation.observation_fingerprint = v_fingerprint
         )
       order by observation.checked_at desc, observation.id
       for update
       limit 1;

      if v_existing_id is not null then
        select coalesce(
                 jsonb_agg(source.value order by source.value->>'collectedAt', source.value::text),
                 '[]'::jsonb
               )
          into v_merged_provenance
          from (
            select latest_source.value
              from (
                select distinct on (
                         provenance_item.value->>'provider',
                         provenance_item.value->>'marketplace',
                         provenance_item.value->>'externalId'
                       ) provenance_item.value
                  from jsonb_array_elements(
                    coalesce(v_existing_provenance, '[]'::jsonb) || v_provenance
                  ) provenance_item(value)
                 order by provenance_item.value->>'provider',
                          provenance_item.value->>'marketplace',
                          provenance_item.value->>'externalId',
                          (provenance_item.value->>'collectedAt')::timestamptz desc,
                          provenance_item.value::text desc
              ) latest_source
             order by (latest_source.value->>'collectedAt')::timestamptz desc,
                      latest_source.value::text
             limit 32
          ) source;

        update sellerpilot_private.competitor_price_observations observation
           set title = left(coalesce(v->>'title', '상품'), 1000),
               product_url = left(v->>'url', 4000),
               image_url = nullif(left(coalesce(v->>'imageUrl', ''), 4000), ''),
               mall_name = left(coalesce(v->>'mallName', ''), 240),
               price = (v->>'price')::numeric,
               currency = v_currency,
               checked_at = clock_timestamp(),
               match_score = (v->>'matchScore')::numeric,
               match_tier = v->>'matchTier',
               match_evidence = v->'matchEvidence',
               mismatch_evidence = v->'mismatchEvidence',
               price_components = v->'priceComponents',
               total_purchase_price = v->'totalPurchasePrice',
               exchange_rate = v->'exchangeRate',
               unit_price = v->'unitPrice',
               provenance = v_merged_provenance,
               observed_at = (v->>'observedAt')::timestamptz,
               inventory_status = v->>'inventoryStatus',
               observation_fingerprint = v_fingerprint
         where observation.id = v_existing_id;
      else
        insert into sellerpilot_private.competitor_price_observations(
          product_id, provider, external_id, title, product_url, image_url,
          mall_name, marketplace, price, currency, checked_at, matcher_version,
          match_score, match_tier, match_evidence, mismatch_evidence,
          price_components, total_purchase_price, exchange_rate, unit_price,
          canonical_url, provenance, observed_at, inventory_status,
          observation_fingerprint
        ) values (
          p_product_id, v_provider, v_external,
          left(coalesce(v->>'title', '상품'), 1000), left(v->>'url', 4000),
          nullif(left(coalesce(v->>'imageUrl', ''), 4000), ''),
          left(coalesce(v->>'mallName', ''), 240), v_marketplace,
          (v->>'price')::numeric, v_currency, clock_timestamp(), v_matcher_version,
          (v->>'matchScore')::numeric, v->>'matchTier', v->'matchEvidence',
          v->'mismatchEvidence', v->'priceComponents', v->'totalPurchasePrice',
          v->'exchangeRate', v->'unitPrice', v_canonical_url, v_provenance,
          (v->>'observedAt')::timestamptz, v->>'inventoryStatus', v_fingerprint
        );
      end if;
    else
      insert into sellerpilot_private.competitor_price_observations(
        product_id, provider, external_id, title, product_url, image_url,
        mall_name, marketplace, price, currency, checked_at, matcher_version
      ) values (
        p_product_id, v_provider, v_external,
        left(coalesce(v->>'title', '상품'), 1000), left(coalesce(v->>'url', ''), 4000),
        nullif(left(coalesce(v->>'imageUrl', ''), 4000), ''),
        left(coalesce(v->>'mallName', ''), 240), v_marketplace,
        (v->>'price')::numeric, v_currency, clock_timestamp(), v_matcher_version
      )
      on conflict (
        product_id, provider, external_id, (coalesce(matcher_version, ''))
      ) where matcher_version is distinct from 'strict-2026-08-31-v3'
      do update
        set title = excluded.title,
            product_url = excluded.product_url,
            image_url = excluded.image_url,
            mall_name = excluded.mall_name,
            marketplace = excluded.marketplace,
            price = excluded.price,
            currency = excluded.currency,
            checked_at = clock_timestamp();
    end if;
    v_count := v_count + 1;
  end loop;

  update sellerpilot_private.products product
     set competitor_checked_at = clock_timestamp()
   where product.id = p_product_id;
  return v_count;
end;
$$;

revoke all on function sellerpilot_private.record_competitor_prices(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

-- Legacy/manual ingestion remains source-compatible. Structured v3 writes are
-- deliberately unavailable here: only the token- and lease-fenced completion
-- function may opt into them.
create or replace function public.sellerpilot_service_record_competitor_prices(
  p_product_id uuid,
  p_items jsonb
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select sellerpilot_private.record_competitor_prices(p_product_id, p_items, false)
$$;

revoke all on function public.sellerpilot_service_record_competitor_prices(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_competitor_prices(uuid, jsonb)
  to service_role;

create or replace function public.sellerpilot_service_complete_competitor_price_refresh(
  p_product_id uuid,
  p_claim_token uuid,
  p_items jsonb,
  p_providers jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_provider text;
begin
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 30
     or not coalesce(sellerpilot_private.valid_competitor_provider_snapshot(p_providers), false)
     or exists (
       select 1
         from jsonb_array_elements(p_items) item(value)
        where jsonb_typeof(item.value) <> 'object'
           or item.value->>'matcherVersion' not in (
             'strict-2026-08-28-v2', 'strict-2026-08-31-v3'
           )
           or (
             item.value->>'matcherVersion' = 'strict-2026-08-31-v3'
             and not coalesce(sellerpilot_private.valid_competitor_v3_item(item.value), false)
           )
           or not exists (
             select 1
               from jsonb_array_elements(p_providers) provider(value)
              where provider.value->>'provider' = item.value->>'provider'
                and provider.value->>'status' = 'searched'
                and provider.value->>'count' <> '0'
           )
           or (
             item.value->>'matcherVersion' = 'strict-2026-08-31-v3'
             and exists (
             select 1
               from jsonb_array_elements(item.value->'provenance') source(value)
              where not exists (
                select 1
                  from jsonb_array_elements(p_providers) provider(value)
                 where provider.value->>'provider' = source.value->>'provider'
                   and provider.value->>'status' = 'searched'
                   and provider.value->>'count' <> '0'
              )
             )
           )
     )
     or (
       jsonb_array_length(p_items) = 0
       and exists (
         select 1
           from jsonb_array_elements(p_providers) provider(value)
          where provider.value->>'status' = 'searched'
            and provider.value->>'count' <> '0'
       )
     ) then
    raise exception 'invalid competitor refresh snapshot';
  end if;

  -- Product -> refresh claim is the global lock order. The lease is validated
  -- together with product/token so an expired, not-yet-reclaimed worker cannot
  -- complete over a newer logical snapshot.
  perform 1
    from sellerpilot_private.products product
   where product.id = p_product_id
   for update;
  if not found then return -1; end if;

  perform 1
    from sellerpilot_private.competitor_price_refresh_claims refresh_state
   where refresh_state.product_id = p_product_id
     and refresh_state.claim_token = p_claim_token
     and refresh_state.lease_expires_at > clock_timestamp()
   for update;
  if not found then return -1; end if;

  -- Raw v3 observations are owned by exactly one provider. Replace only rows
  -- for providers that reached a searched terminal state. Failed/unavailable
  -- provider rows, v2 observations, and manual references remain untouched.
  for v_provider in
    select provider.value->>'provider'
      from jsonb_array_elements(p_providers) provider(value)
     where provider.value->>'status' = 'searched'
  loop
    delete from sellerpilot_private.competitor_price_observations observation
     where observation.product_id = p_product_id
       and observation.matcher_version = 'strict-2026-08-31-v3'
       and observation.provider = v_provider;
  end loop;

  delete from sellerpilot_private.competitor_price_observations observation
   where observation.product_id = p_product_id
     and observation.matcher_version = 'strict-2026-08-31-v3'
     and observation.provider <> 'manual'
     and observation.checked_at < clock_timestamp() - interval '7 days';

  select sellerpilot_private.record_competitor_prices(p_product_id, p_items, true)
    into v_count;

  update sellerpilot_private.competitor_price_refresh_claims refresh_state
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         gateway_job_id = null,
         gateway_periodic_key = null,
         latest_providers = p_providers,
         providers_fetched_at = clock_timestamp()
   where refresh_state.product_id = p_product_id
     and refresh_state.claim_token = p_claim_token;
  if not found then return -1; end if;
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  to service_role;

alter function public.sellerpilot_get_product_operations_v2(uuid)
  rename to sellerpilot_get_product_operations_v2_pre_competitor_price_v3;

revoke all on function public.sellerpilot_get_product_operations_v2_pre_competitor_price_v3(uuid)
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
  v_providers jsonb;
begin
  v_result := public.sellerpilot_get_product_operations_v2_pre_competitor_price_v3(p_product_id);
  if v_result is null then return null; end if;
  v_providers := coalesce(v_result->'competitorProviders', '[]'::jsonb);

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'id', ranked.id,
             'externalId', ranked.external_id,
             'title', ranked.title,
             'url', ranked.product_url,
             'imageUrl', ranked.image_url,
             'mallName', ranked.mall_name,
             'marketplace', ranked.marketplace,
             'price', ranked.price,
             'currency', ranked.currency,
             'checkedAt', ranked.checked_at,
             'provider', case
               when ranked.matcher_version = 'strict-2026-08-31-v3'
                 then coalesce(ranked.provenance->0->>'provider', ranked.provider)
               else ranked.provider
             end,
             'preserved', case
               when ranked.provider = 'manual' then false
               when ranked.matcher_version = 'strict-2026-08-31-v3' then not exists (
                 select 1
                   from jsonb_array_elements(ranked.provenance) source(value)
                  where exists (
                    select 1
                      from jsonb_array_elements(v_providers) provider(value)
                     where provider.value->>'provider' = source.value->>'provider'
                       and provider.value->>'status' = 'searched'
                  )
               )
               else not exists (
                 select 1
                   from jsonb_array_elements(v_providers) provider(value)
                  where provider.value->>'provider' = ranked.provider
                    and provider.value->>'status' = 'searched'
               )
             end,
             'fresh', ranked.provider = 'manual'
               or ranked.checked_at >= clock_timestamp() - interval '7 days',
             'matcherVersion', ranked.matcher_version,
             'matchScore', ranked.match_score,
             'matchTier', ranked.match_tier,
             'matchEvidence', ranked.match_evidence,
             'mismatchEvidence', ranked.mismatch_evidence,
             'priceComponents', ranked.price_components,
             'totalPurchasePrice', ranked.total_purchase_price,
             'exchangeRate', ranked.exchange_rate,
             'unitPrice', ranked.unit_price,
             'canonicalUrl', ranked.canonical_url,
             'provenance', ranked.provenance,
             'observedAt', ranked.observed_at,
             'inventoryStatus', ranked.inventory_status
           ) order by ranked.marketplace, ranked.market_rank, ranked.checked_at desc),
           '[]'::jsonb
         )
    into v_prices
    from (
      select observation.*,
             row_number() over (
               partition by observation.marketplace
               order by
                 case observation.match_tier
                   when 'exact' then 0
                   when 'probable' then 1
                   when 'rejected' then 2
                   else 3
                 end,
                 case
                   when observation.match_tier = 'exact'
                    and jsonb_typeof(observation.total_purchase_price) = 'object'
                    and jsonb_typeof(observation.total_purchase_price->'krwAmount') = 'number'
                     then (observation.total_purchase_price->>'krwAmount')::numeric
                   else null
                 end nulls last,
                 observation.match_score desc nulls last,
                 (observation.provider = 'manual') desc,
                 observation.checked_at desc,
                 observation.price,
                 observation.id
             ) as market_rank
        from sellerpilot_private.competitor_price_observations observation
       where observation.product_id = p_product_id
         and (
           observation.provider = 'manual'
           or observation.matcher_version in (
             'strict-2026-08-28-v2', 'strict-2026-08-31-v3'
           )
         )
         and (
           observation.provider = 'manual'
           or observation.checked_at >= clock_timestamp() - interval '7 days'
         )
         and not (
           observation.matcher_version = 'strict-2026-08-28-v2'
           and exists (
             select 1
               from sellerpilot_private.competitor_price_observations current_v3
              where current_v3.product_id = observation.product_id
                and current_v3.matcher_version = 'strict-2026-08-31-v3'
                and (
                  (
                    current_v3.marketplace = observation.marketplace
                    and current_v3.external_id = observation.external_id
                  )
                  or (
                    current_v3.canonical_url is not null
                    and current_v3.canonical_url = observation.product_url
                  )
                )
           )
         )
    ) ranked
   where ranked.market_rank <= 12;

  return jsonb_set(v_result, '{competitorPrices}', v_prices, true);
end;
$$;

revoke all on function public.sellerpilot_get_product_operations_v2(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_get_product_operations_v2(uuid)
  to authenticated;

commit;
