-- Durable, service-owned SmartStore new-CREATE category/attribute evidence.
-- This migration only installs data contracts and last-moment fences. It does
-- not enqueue work, call Naver, deploy code, or touch historical listings.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910031000);

do $dependencies$
begin
  if pg_catalog.to_regclass('sellerpilot_private.products') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_credentials') is null
     or pg_catalog.to_regclass('sellerpilot_private.product_category_assignments') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.request_has_unambiguous_service_role_claim()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

create function sellerpilot_private.smartstore_category_source_canonical(
  p_value jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  result text;
begin
  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(key)::text || ':' ||
          sellerpilot_private.smartstore_category_source_canonical(value),
        ',' order by key collate "C"
      ), '') || '}'
        into result
        from pg_catalog.jsonb_each(p_value);
    when 'array' then
      select '[' || coalesce(pg_catalog.string_agg(
        sellerpilot_private.smartstore_category_source_canonical(value),
        ',' order by ordinal
      ), '') || ']'
        into result
        from pg_catalog.jsonb_array_elements(p_value)
          with ordinality item(value, ordinal);
    else
      result := p_value::text;
  end case;
  return result;
end;
$$;

create function sellerpilot_private.smartstore_category_source_hash(
  p_value jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      sellerpilot_private.smartstore_category_source_canonical(p_value),
      'UTF8'
    )),
    'hex'
  )
$$;

create function sellerpilot_private.smartstore_category_source_sorted_records(
  p_value jsonb
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(value order by
    sellerpilot_private.smartstore_category_source_canonical(value)
      collate "C"), '[]'::jsonb)
  from pg_catalog.jsonb_array_elements(p_value) item(value)
$$;

create function sellerpilot_private.smartstore_category_assignment_source_payload(
  p_assignment jsonb,
  p_provider_attributes jsonb
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_assignment->'id',
    'ownerId', p_assignment->'owner_id',
    'productId', p_assignment->'product_id',
    'channel', p_assignment->'channel',
    'environment', p_assignment->'environment',
    'market', p_assignment->'market',
    'categoryId', p_assignment->'category_id',
    'categoryPath', p_assignment->'category_path',
    'isLeaf', p_assignment->'is_leaf',
    'requiredAttributes', p_assignment->'required_attributes',
    'providedAttributes', p_assignment->'provided_attributes',
    'providerCreateAttributes',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_provider_attributes
      ),
    'missingRequiredAttributes', p_assignment->'missing_required_attributes',
    'officialMetadata', p_assignment->'official_metadata',
    'status', p_assignment->'status',
    'officialVerifiedAt', p_assignment->'official_verified_at',
    'confirmedAt', p_assignment->'confirmed_at'
  )
$$;

create function sellerpilot_private.smartstore_category_source_range_contains(
  p_real_value text,
  p_value jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  part text;
  minimum numeric;
  maximum numeric;
begin
  if p_real_value !~ '^\d+(?:\.\d+)?(?:[~x]\d+(?:\.\d+)?)?$'
     or coalesce(p_value->>'minAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$'
     or coalesce(p_value->>'maxAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$' then
    return false;
  end if;
  minimum := (p_value->>'minAttributeValue')::numeric;
  maximum := (p_value->>'maxAttributeValue')::numeric;
  if minimum > maximum then return false; end if;
  foreach part in array pg_catalog.regexp_split_to_array(p_real_value, '[~x]')
  loop
    if part::numeric < minimum or part::numeric > maximum then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.smartstore_category_source_payload_is_valid(
  p_category_id text,
  p_provider_attributes jsonb,
  p_official_readback jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  attribute_row jsonb;
  value_row jsonb;
  unit_row jsonb;
  provider_row jsonb;
  matched_attribute jsonb;
  matched_value jsonb;
  attribute_ids text[] := array[]::text[];
  value_ids text[] := array[]::text[];
  attribute_value_ids text[] := array[]::text[];
  unit_ids text[] := array[]::text[];
  attribute_seq text;
  attribute_value_seq text;
  pair_id text;
  classification text;
  unit_code text;
  real_value text;
  selection_count integer;
  maximum_count numeric;
  is_required boolean;
  unit_usable boolean;
begin
  if pg_catalog.jsonb_typeof(p_provider_attributes) is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_official_readback) is distinct from 'object'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'category'
     ) is distinct from 'object'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'attributes'
     ) is distinct from 'array'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'attributeValues'
     ) is distinct from 'array'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'attributeValueUnits'
     ) is distinct from 'array'
     or nullif(pg_catalog.btrim(
       p_official_readback#>>'{category,id}'
     ), '') is distinct from p_category_id
     or pg_catalog.jsonb_typeof(
       p_official_readback#>'{category,last}'
     ) is distinct from 'boolean'
     or p_official_readback#>>'{category,last}' is distinct from 'true'
     or pg_catalog.jsonb_typeof(
       p_official_readback#>'{category,id}'
     ) is distinct from 'string'
     or (p_official_readback#>'{category,name}' is not null
       and pg_catalog.jsonb_typeof(
         p_official_readback#>'{category,name}'
       ) is distinct from 'string')
     or (p_official_readback#>'{category,wholeCategoryName}' is not null
       and pg_catalog.jsonb_typeof(
         p_official_readback#>'{category,wholeCategoryName}'
       ) is distinct from 'string')
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(
         p_official_readback->'category'
       ) field_name
       where field_name not in ('id', 'name', 'wholeCategoryName', 'last')
     ) then
    return false;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_official_readback) field_name
    where field_name not in (
      'category', 'attributes', 'attributeValues', 'attributeValueUnits'
    )
  ) then
    return false;
  end if;

  for attribute_row in
    select item
    from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributes'
    ) candidate(item)
  loop
    attribute_seq := attribute_row->>'attributeSeq';
    classification := attribute_row->>'attributeClassificationType';
    if pg_catalog.jsonb_typeof(attribute_row) is distinct from 'object'
       or coalesce(attribute_seq, '') !~ '^[1-9]\d*$'
       or attribute_seq::numeric > 9007199254740991
       or attribute_seq = any(attribute_ids)
       or pg_catalog.jsonb_typeof(
         attribute_row->'attributeName'
       ) is distinct from 'string'
       or nullif(pg_catalog.btrim(attribute_row->>'attributeName'), '') is null
       or pg_catalog.jsonb_typeof(
         attribute_row->'attributeClassificationType'
       ) is distinct from 'string'
       or classification not in ('SINGLE_SELECT', 'MULTI_SELECT', 'RANGE')
       or pg_catalog.jsonb_typeof(
         attribute_row->'attributeType'
       ) is distinct from 'string'
       or attribute_row->>'attributeType' not in ('PRIMARY', 'OPTIONAL')
       or pg_catalog.jsonb_typeof(
         attribute_row->'unitUsable'
       ) is distinct from 'boolean'
       or coalesce(
         attribute_row->>'attributeValueMaxMatchingCount', ''
       ) !~ '^\d+$'
       or (attribute_row->>'attributeValueMaxMatchingCount')::numeric
         > 2147483647
       or (attribute_row ? 'representativeUnitCode'
         and attribute_row->'representativeUnitCode' <> 'null'::jsonb
         and (pg_catalog.jsonb_typeof(
           attribute_row->'representativeUnitCode'
         ) <> 'string'
         or attribute_row->>'representativeUnitCode' !~ '^A\d{5}$'))
       or (attribute_row ? 'required'
         and pg_catalog.jsonb_typeof(attribute_row->'required') <> 'boolean')
       or (attribute_row ? 'mandatory'
         and pg_catalog.jsonb_typeof(attribute_row->'mandatory') <> 'boolean')
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(attribute_row) field_name
         where field_name not in (
           'attributeSeq', 'attributeName', 'attributeClassificationType',
           'attributeType', 'unitUsable', 'representativeUnitCode',
           'attributeValueMaxMatchingCount', 'required', 'mandatory'
         )
       ) then
      return false;
    end if;
    attribute_ids := pg_catalog.array_append(attribute_ids, attribute_seq);
  end loop;

  for value_row in
    select item
    from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributeValues'
    ) candidate(item)
  loop
    attribute_seq := value_row->>'attributeSeq';
    attribute_value_seq := value_row->>'attributeValueSeq';
    pair_id := attribute_seq || ':' || attribute_value_seq;
    if pg_catalog.jsonb_typeof(value_row) is distinct from 'object'
       or coalesce(attribute_seq, '') !~ '^[1-9]\d*$'
       or attribute_seq::numeric > 9007199254740991
       or coalesce(attribute_value_seq, '') !~ '^[1-9]\d*$'
       or attribute_value_seq::numeric > 9007199254740991
       or not attribute_seq = any(attribute_ids)
       or pair_id = any(value_ids)
       or attribute_value_seq = any(attribute_value_ids)
       or pg_catalog.jsonb_typeof(
         value_row->'minAttributeValue'
       ) is distinct from 'string'
       or nullif(pg_catalog.btrim(value_row->>'minAttributeValue'), '') is null
       or (value_row ? 'attributeValueName'
         and pg_catalog.jsonb_typeof(
           value_row->'attributeValueName'
         ) <> 'string')
       or (value_row ? 'maxAttributeValue'
         and value_row->'maxAttributeValue' <> 'null'::jsonb
         and pg_catalog.jsonb_typeof(
           value_row->'maxAttributeValue'
         ) <> 'string')
       or (value_row ? 'minAttributeValueUnitCode'
         and value_row->'minAttributeValueUnitCode' <> 'null'::jsonb
         and (pg_catalog.jsonb_typeof(
           value_row->'minAttributeValueUnitCode'
         ) <> 'string'
         or value_row->>'minAttributeValueUnitCode' !~ '^A\d{5}$'))
       or (value_row ? 'maxAttributeValueUnitCode'
         and value_row->'maxAttributeValueUnitCode' <> 'null'::jsonb
         and (pg_catalog.jsonb_typeof(
           value_row->'maxAttributeValueUnitCode'
         ) <> 'string'
         or value_row->>'maxAttributeValueUnitCode' !~ '^A\d{5}$'))
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(value_row) field_name
         where field_name not in (
           'attributeSeq', 'attributeValueSeq', 'attributeValueName',
           'minAttributeValue', 'maxAttributeValue',
           'minAttributeValueUnitCode', 'maxAttributeValueUnitCode'
         )
       ) then
      return false;
    end if;
    value_ids := pg_catalog.array_append(value_ids, pair_id);
    attribute_value_ids := pg_catalog.array_append(
      attribute_value_ids, attribute_value_seq
    );
  end loop;

  for unit_row in
    select item
    from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributeValueUnits'
    ) candidate(item)
  loop
    unit_code := unit_row->>'id';
    if pg_catalog.jsonb_typeof(unit_row) is distinct from 'object'
       or coalesce(unit_code, '') !~ '^A\d{5}$'
       or unit_code = any(unit_ids)
       or pg_catalog.jsonb_typeof(
         unit_row->'unitCodeName'
       ) is distinct from 'string'
       or nullif(pg_catalog.btrim(unit_row->>'unitCodeName'), '') is null
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(unit_row) field_name
         where field_name not in ('id', 'unitCodeName')
       ) then
      return false;
    end if;
    unit_ids := pg_catalog.array_append(unit_ids, unit_code);
  end loop;

  -- Every unit reference and every RANGE bound must itself be official and
  -- internally coherent, even when that value was not selected by the product.
  for attribute_row in
    select item from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributes'
    ) candidate(item)
  loop
    unit_code := nullif(pg_catalog.btrim(
      attribute_row->>'representativeUnitCode'
    ), '');
    unit_usable := (attribute_row->>'unitUsable')::boolean;
    classification := attribute_row->>'attributeClassificationType';
    if (unit_code is not null and not unit_code = any(unit_ids))
       or (not unit_usable and unit_code is not null)
       or (unit_usable and classification = 'RANGE'
         and unit_code is null) then
      return false;
    end if;
  end loop;
  for value_row in
    select item from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributeValues'
    ) candidate(item)
  loop
    select item into matched_attribute
      from pg_catalog.jsonb_array_elements(
        p_official_readback->'attributes'
      ) candidate(item)
     where item->>'attributeSeq' = value_row->>'attributeSeq';
    classification := matched_attribute->>'attributeClassificationType';
    unit_usable := (matched_attribute->>'unitUsable')::boolean;
    if classification = 'RANGE' and (
         coalesce(value_row->>'minAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'
         or coalesce(value_row->>'maxAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'
         or (value_row->>'minAttributeValue')::numeric
           > (value_row->>'maxAttributeValue')::numeric
       ) then
      return false;
    end if;
    foreach unit_code in array array[
      nullif(pg_catalog.btrim(value_row->>'minAttributeValueUnitCode'), ''),
      nullif(pg_catalog.btrim(value_row->>'maxAttributeValueUnitCode'), '')
    ]
    loop
      if unit_code is not null and not unit_code = any(unit_ids) then
        return false;
      end if;
    end loop;
    if classification = 'RANGE' and unit_usable and (
         nullif(pg_catalog.btrim(
           value_row->>'minAttributeValueUnitCode'
         ), '') is null
         or nullif(pg_catalog.btrim(
           value_row->>'maxAttributeValueUnitCode'
         ), '') is null
       ) then
      return false;
    end if;
    if not unit_usable and (
         nullif(pg_catalog.btrim(
           value_row->>'minAttributeValueUnitCode'
         ), '') is not null
         or nullif(pg_catalog.btrim(
           value_row->>'maxAttributeValueUnitCode'
         ), '') is not null
       ) then
      return false;
    end if;
  end loop;

  value_ids := array[]::text[];
  for provider_row in
    select item
    from pg_catalog.jsonb_array_elements(p_provider_attributes) candidate(item)
  loop
    attribute_seq := provider_row->>'attributeSeq';
    attribute_value_seq := provider_row->>'attributeValueSeq';
    pair_id := attribute_seq || ':' || attribute_value_seq;
    if pg_catalog.jsonb_typeof(provider_row) is distinct from 'object'
       or coalesce(attribute_seq, '') !~ '^[1-9]\d*$'
       or attribute_seq::numeric > 9007199254740991
       or coalesce(attribute_value_seq, '') !~ '^[1-9]\d*$'
       or attribute_value_seq::numeric > 9007199254740991
       or pair_id = any(value_ids)
       or (provider_row ? 'attributeRealValue'
         and pg_catalog.jsonb_typeof(
           provider_row->'attributeRealValue'
         ) <> 'string')
       or (provider_row ? 'attributeRealValueUnitCode'
         and (pg_catalog.jsonb_typeof(
           provider_row->'attributeRealValueUnitCode'
         ) <> 'string'
         or provider_row->>'attributeRealValueUnitCode' !~ '^A\d{5}$'))
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(provider_row) field_name
         where field_name not in (
           'attributeSeq', 'attributeValueSeq', 'attributeRealValue',
           'attributeRealValueUnitCode'
         )
       ) then
      return false;
    end if;
    select item into matched_attribute
      from pg_catalog.jsonb_array_elements(
        p_official_readback->'attributes'
      ) candidate(item)
     where item->>'attributeSeq' = attribute_seq;
    select item into matched_value
      from pg_catalog.jsonb_array_elements(
        p_official_readback->'attributeValues'
      ) candidate(item)
     where item->>'attributeSeq' = attribute_seq
       and item->>'attributeValueSeq' = attribute_value_seq;
    if matched_attribute is null or matched_value is null then return false; end if;

    classification := matched_attribute->>'attributeClassificationType';
    if classification <> 'RANGE'
       and (provider_row ? 'attributeRealValue'
         or provider_row ? 'attributeRealValueUnitCode') then
      return false;
    end if;
    if classification = 'RANGE' then
      real_value := nullif(pg_catalog.btrim(
        provider_row->>'attributeRealValue'
      ), '');
      unit_code := nullif(pg_catalog.btrim(
        provider_row->>'attributeRealValueUnitCode'
      ), '');
      unit_usable := (matched_attribute->>'unitUsable')::boolean;
      if real_value is null
         or not sellerpilot_private.smartstore_category_source_range_contains(
           real_value, matched_value
         )
         or (unit_usable and (
           unit_code is null or not unit_code = any(unit_ids)
         ))
         or (not unit_usable
           and provider_row ? 'attributeRealValueUnitCode')
         or (unit_code is not null
           and coalesce(
             nullif(matched_value->>'minAttributeValueUnitCode', ''),
             nullif(matched_value->>'maxAttributeValueUnitCode', ''),
             nullif(matched_attribute->>'representativeUnitCode', '')
           ) is not null
           and unit_code not in (
             coalesce(matched_value->>'minAttributeValueUnitCode', ''),
             coalesce(matched_value->>'maxAttributeValueUnitCode', ''),
             coalesce(matched_attribute->>'representativeUnitCode', '')
           )) then
        return false;
      end if;
    end if;
    value_ids := pg_catalog.array_append(value_ids, pair_id);
  end loop;

  for attribute_row in
    select item
    from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributes'
    ) candidate(item)
  loop
    attribute_seq := attribute_row->>'attributeSeq';
    classification := attribute_row->>'attributeClassificationType';
    maximum_count :=
      (attribute_row->>'attributeValueMaxMatchingCount')::numeric;
    is_required := attribute_row->>'attributeType' = 'PRIMARY'
      or coalesce((attribute_row->>'required')::boolean, false)
      or coalesce((attribute_row->>'mandatory')::boolean, false);
    select pg_catalog.count(*)::integer into selection_count
      from pg_catalog.jsonb_array_elements(p_provider_attributes) item
     where item->>'attributeSeq' = attribute_seq;
    if (is_required and selection_count = 0)
       or (classification in ('SINGLE_SELECT', 'RANGE')
         and selection_count > 1)
       or (classification = 'MULTI_SELECT' and maximum_count > 0
         and selection_count > maximum_count) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create table sellerpilot_private.smartstore_create_category_attribute_sources (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null,
  product_id uuid not null
    references sellerpilot_private.products(id),
  product_updated_at timestamptz not null,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id),
  credential_version integer not null check (credential_version > 0),
  seller_account_key text not null
    check (seller_account_key ~ '^[a-f0-9]{64}$'),
  approved_detail_revision bigint not null
    check (approved_detail_revision > 0),
  approved_detail_digest text not null
    check (approved_detail_digest ~ '^[a-f0-9]{64}$'),
  assignment_id uuid not null
    references sellerpilot_private.product_category_assignments(id),
  assignment_updated_at timestamptz not null,
  assignment_revision bigint not null check (assignment_revision > 0),
  assignment_source_digest text not null
    check (assignment_source_digest ~ '^[a-f0-9]{64}$'),
  assignment_digest text not null
    check (assignment_digest ~ '^[a-f0-9]{64}$'),
  assignment jsonb not null check (
    pg_catalog.jsonb_typeof(assignment) = 'object'
    and assignment->>'contract' =
      'smartstore_category_attribute_assignment_v1'
    and assignment->>'channel' = 'smartstore'
    and assignment->>'operation' = 'listing.create'
    and assignment->>'environment' = 'production'
    and assignment->>'market' = 'KR'
    and assignment->>'status' = 'confirmed'
    and pg_catalog.jsonb_typeof(assignment->'providedAttributes') = 'array'
  ),
  official_readback_digest text not null
    check (official_readback_digest ~ '^[a-f0-9]{64}$'),
  official_readback jsonb not null check (
    pg_catalog.jsonb_typeof(official_readback) = 'object'
    and official_readback->>'contract' =
      'smartstore_category_attribute_official_readback_v1'
    and pg_catalog.jsonb_typeof(official_readback->'category') = 'object'
    and pg_catalog.jsonb_typeof(official_readback->'attributes') = 'array'
    and pg_catalog.jsonb_typeof(official_readback->'attributeValues') = 'array'
    and pg_catalog.jsonb_typeof(
      official_readback->'attributeValueUnits'
    ) = 'array'
  ),
  product_attributes_sha256 text not null
    check (product_attributes_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  retired_at timestamptz,
  retired_reason text check (
    retired_reason is null or retired_reason in (
      'superseded', 'operator_retired', 'source_invalidated'
    )
  ),
  check ((retired_at is null) = (retired_reason is null)),
  unique (
    product_id, credential_id, product_updated_at, assignment_updated_at,
    assignment_source_digest, official_readback_digest
  )
);

create unique index smartstore_create_category_source_one_current_idx
  on sellerpilot_private.smartstore_create_category_attribute_sources(
    owner_id, product_id
  ) where retired_at is null;

create index smartstore_create_category_source_revision_idx
  on sellerpilot_private.smartstore_create_category_attribute_sources(
    owner_id, product_id, assignment_revision desc
  );

alter table sellerpilot_private.smartstore_create_category_attribute_sources
  enable row level security;
revoke all on sellerpilot_private.smartstore_create_category_attribute_sources
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_category_source_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or old.retired_at is not null
     or new.retired_at is null
     or new.retired_reason is null
     or (pg_catalog.to_jsonb(new) - 'retired_at' - 'retired_reason')
       is distinct from
       (pg_catalog.to_jsonb(old) - 'retired_at' - 'retired_reason') then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_APPEND_ONLY'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger smartstore_create_category_source_append_only
before update or delete
on sellerpilot_private.smartstore_create_category_attribute_sources
for each row execute function
  sellerpilot_private.guard_smartstore_category_source_append_only();

create function sellerpilot_private.smartstore_category_source_current_json(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  select pg_catalog.jsonb_build_object(
           'contract', 'smartstore_listing_create_category_source_v1',
           'assignment', source.assignment,
           'officialReadback', source.official_readback
         )
    into result
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.credential_id = p_credential_id
     and source.retired_at is null
     and exists (
       select 1 from sellerpilot_private.products product
       where product.id = source.product_id
         and product.owner_id = source.owner_id
         and product.updated_at = source.product_updated_at
         and product.status = 'ready'
         and not product.demo
         and product.detail_page_version = source.approved_detail_revision
         and product.detail_page_approved_version =
           source.approved_detail_revision
         and product.detail_page_image_manifest->>'digest' =
           source.approved_detail_digest
     )
     and exists (
       select 1 from sellerpilot_private.channel_credentials credential
       where credential.id = source.credential_id
         and credential.channel = 'smartstore'
         and credential.environment = 'production'
         and credential.status = 'active'
         and (credential.expires_at is null
           or credential.expires_at > pg_catalog.clock_timestamp())
         and credential.last_check_status = 'passed'
         and credential.version = source.credential_version
         and credential.seller_account_key = source.seller_account_key
         and credential.seller_account_key_source in (
           'provider_certified_v1', 'credential_incarnation_v1'
         )
     )
     and exists (
       select 1
       from sellerpilot_private.product_category_assignments category_assignment
       where category_assignment.id = source.assignment_id
         and category_assignment.owner_id = source.owner_id
         and category_assignment.product_id = source.product_id
         and category_assignment.channel = 'smartstore'
         and category_assignment.environment = 'production'
         and category_assignment.market = 'KR'
         and category_assignment.status = 'confirmed'
         and category_assignment.is_leaf
         and category_assignment.category_id = source.assignment->>'categoryId'
         and category_assignment.updated_at = source.assignment_updated_at
         and category_assignment.official_verified_at is not null
         and category_assignment.confirmed_at is not null
         and pg_catalog.jsonb_typeof(
           category_assignment.missing_required_attributes
         ) = 'array'
         and pg_catalog.jsonb_array_length(
           category_assignment.missing_required_attributes
         ) = 0
         and sellerpilot_private.smartstore_category_source_hash(
           sellerpilot_private.smartstore_category_assignment_source_payload(
             pg_catalog.to_jsonb(category_assignment),
             source.assignment->'providedAttributes'
           )
         ) = source.assignment_source_digest
     )
     and source.assignment_digest = source.assignment->>'digest'
     and source.assignment_revision =
       (source.assignment->>'revision')::bigint
     and source.official_readback_digest =
       source.official_readback->>'digest'
     and source.official_readback->>'categoryId' =
       source.assignment->>'categoryId'
     and source.official_readback->>'assignmentRevision' =
       source.assignment_revision::text
     and source.official_readback->>'assignmentDigest' =
       source.assignment_digest
     and source.product_attributes_sha256 =
       sellerpilot_private.smartstore_category_source_hash(
         sellerpilot_private.smartstore_category_source_sorted_records(
           source.assignment->'providedAttributes'
         )
       );
  return result;
exception when others then
  return null;
end;
$$;

create function public.sellerpilot_service_read_smartstore_create_category_source(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return sellerpilot_private.smartstore_category_source_current_json(
    p_owner_id, p_product_id, p_credential_id
  );
end;
$$;

create function public.sellerpilot_service_append_smartstore_create_category_source(
  p_owner_id uuid,
  p_product_id uuid,
  p_product_updated_at timestamptz,
  p_credential_id uuid,
  p_credential_version integer,
  p_seller_account_key text,
  p_approved_detail_revision bigint,
  p_approved_detail_digest text,
  p_assignment_id uuid,
  p_assignment_updated_at timestamptz,
  p_provider_attributes jsonb,
  p_official_readback jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  assignment sellerpilot_private.product_category_assignments%rowtype;
  current_source sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
  matching_source sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
  prior_source sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
  assignment_source_digest text;
  assignment_revision bigint;
  assignment_value jsonb;
  assignment_digest text;
  official_value jsonb;
  official_digest text;
  product_attributes_sha256 text;
  inserted_id uuid;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910031000);

  if p_owner_id is null or p_product_id is null
     or p_product_updated_at is null or p_credential_id is null
     or p_credential_version is null or p_seller_account_key is null
     or p_approved_detail_revision is null or p_approved_detail_digest is null
     or p_assignment_id is null or p_assignment_updated_at is null
     or p_provider_attributes is null or p_official_readback is null
     or pg_catalog.jsonb_typeof(p_provider_attributes) <> 'array'
     or pg_catalog.jsonb_typeof(p_official_readback) <> 'object'
     or pg_catalog.jsonb_typeof(p_official_readback->'category') <> 'object'
     or pg_catalog.jsonb_typeof(p_official_readback->'attributes') <> 'array'
     or pg_catalog.jsonb_typeof(p_official_readback->'attributeValues') <> 'array'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'attributeValueUnits'
     ) <> 'array' then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_NULL_OR_SHAPE_INVALID'
      using errcode = '22023';
  end if;

  select * into product
    from sellerpilot_private.products candidate
   where candidate.id = p_product_id
   for update;
  if product.id is null
     or product.owner_id is distinct from p_owner_id
     or product.updated_at is distinct from p_product_updated_at
     or product.status <> 'ready' or product.demo
     or product.detail_page_version is distinct from p_approved_detail_revision
     or product.detail_page_approved_version is distinct from
       p_approved_detail_revision
     or product.detail_page_image_manifest->>'digest' is distinct from
       p_approved_detail_digest
     or p_approved_detail_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_PRODUCT_STALE'
      using errcode = '55000';
  end if;

  select * into credential
    from sellerpilot_private.channel_credentials candidate
   where candidate.id = p_credential_id
   for update;
  if credential.id is null
     or credential.channel <> 'smartstore'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or (credential.expires_at is not null
       and credential.expires_at <= pg_catalog.clock_timestamp())
     or credential.last_check_status <> 'passed'
     or credential.version is distinct from p_credential_version
     or credential.seller_account_key is distinct from p_seller_account_key
     or p_seller_account_key !~ '^[a-f0-9]{64}$'
     or credential.seller_account_key_source not in (
       'provider_certified_v1', 'credential_incarnation_v1'
     ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_CREDENTIAL_STALE'
      using errcode = '55000';
  end if;

  select * into assignment
    from sellerpilot_private.product_category_assignments candidate
   where candidate.id = p_assignment_id
   for update;
  if assignment.id is null
     or assignment.owner_id is distinct from p_owner_id
     or assignment.product_id is distinct from p_product_id
     or assignment.updated_at is distinct from p_assignment_updated_at
     or assignment.channel <> 'smartstore'
     or assignment.environment <> 'production'
     or assignment.market <> 'KR'
     or assignment.status <> 'confirmed'
     or not assignment.is_leaf
     or assignment.official_verified_at is null
     or assignment.confirmed_at is null
     or pg_catalog.jsonb_typeof(assignment.missing_required_attributes)
       <> 'array'
     or pg_catalog.jsonb_array_length(
       assignment.missing_required_attributes
     ) <> 0 then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_ASSIGNMENT_STALE'
      using errcode = '55000';
  end if;

  -- Validate every nested official/provider field before revision lookup. An
  -- invalid receipt therefore cannot reserve or poison an assignment revision.
  if p_official_readback#>>'{category,id}' is distinct from
       assignment.category_id
     or pg_catalog.jsonb_typeof(
       p_official_readback#>'{category,last}'
     ) <> 'boolean'
     or p_official_readback#>>'{category,last}' is distinct from 'true' then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_CROSS_CATEGORY'
      using errcode = '55000';
  end if;
  if not sellerpilot_private.smartstore_category_source_payload_is_valid(
    assignment.category_id, p_provider_attributes, p_official_readback
  ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_PAYLOAD_INVALID'
      using errcode = '22023';
  end if;

  assignment_source_digest :=
    sellerpilot_private.smartstore_category_source_hash(
      sellerpilot_private.smartstore_category_assignment_source_payload(
        pg_catalog.to_jsonb(assignment), p_provider_attributes
      )
    );

  select * into current_source
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.retired_at is null
   for update;

  select * into matching_source
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.assignment_source_digest = assignment_source_digest
   order by source.created_at desc
   limit 1;

  if current_source.id is not null
     and current_source.assignment_source_digest = assignment_source_digest then
    assignment_revision := current_source.assignment_revision;
  elsif current_source.id is null and matching_source.id is not null then
    assignment_revision := matching_source.assignment_revision;
  else
    select coalesce(max(source.assignment_revision), 0) + 1
      into assignment_revision
      from sellerpilot_private.smartstore_create_category_attribute_sources source
     where source.owner_id = p_owner_id
       and source.product_id = p_product_id;
  end if;

  assignment_value := pg_catalog.jsonb_build_object(
    'contract', 'smartstore_category_attribute_assignment_v1',
    'channel', 'smartstore',
    'operation', 'listing.create',
    'environment', 'production',
    'market', 'KR',
    'status', 'confirmed',
    'categoryId', assignment.category_id,
    'revision', assignment_revision,
    'providedAttributes',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_provider_attributes
      )
  );
  assignment_digest :=
    sellerpilot_private.smartstore_category_source_hash(assignment_value);
  assignment_value := assignment_value || pg_catalog.jsonb_build_object(
    'digest', assignment_digest
  );
  product_attributes_sha256 :=
    sellerpilot_private.smartstore_category_source_hash(
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_provider_attributes
      )
    );

  official_value := pg_catalog.jsonb_build_object(
    'contract', 'smartstore_category_attribute_official_readback_v1',
    'categoryId', assignment.category_id,
    'assignmentRevision', assignment_revision,
    'assignmentDigest', assignment_digest,
    'category', p_official_readback->'category',
    'attributes', sellerpilot_private.smartstore_category_source_sorted_records(
      p_official_readback->'attributes'
    ),
    'attributeValues',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_official_readback->'attributeValues'
      ),
    'attributeValueUnits',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_official_readback->'attributeValueUnits'
      )
  );
  official_digest :=
    sellerpilot_private.smartstore_category_source_hash(official_value);
  official_value := official_value || pg_catalog.jsonb_build_object(
    'digest', official_digest
  );

  select * into prior_source
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.assignment_revision = assignment_revision
   order by source.created_at desc
   limit 1;

  if prior_source.id is not null
     and (prior_source.assignment_digest is distinct from assignment_digest
       or prior_source.official_readback_digest is distinct from official_digest
       or prior_source.product_attributes_sha256 is distinct from
         product_attributes_sha256) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_REVISION_CONFLICT'
      using errcode = '23505';
  end if;

  if current_source.id is not null
     and current_source.product_updated_at = p_product_updated_at
     and current_source.credential_id = p_credential_id
     and current_source.credential_version = p_credential_version
     and current_source.seller_account_key = p_seller_account_key
     and current_source.approved_detail_revision = p_approved_detail_revision
     and current_source.approved_detail_digest = p_approved_detail_digest
     and current_source.assignment_id = p_assignment_id
     and current_source.assignment_updated_at = p_assignment_updated_at
     and current_source.assignment_source_digest = assignment_source_digest
     and current_source.assignment_digest = assignment_digest
     and current_source.official_readback_digest = official_digest
     and current_source.product_attributes_sha256 =
       product_attributes_sha256 then
    return pg_catalog.jsonb_build_object(
      'sourceId', current_source.id,
      'replayed', true,
      'assignmentRevision', current_source.assignment_revision,
      'assignmentDigest', current_source.assignment_digest,
      'officialReadbackDigest', current_source.official_readback_digest,
      'productAttributesSha256', current_source.product_attributes_sha256
    );
  end if;

  if current_source.id is null and prior_source.id is not null
     and prior_source.retired_reason in (
       'operator_retired', 'source_invalidated'
     ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_RETIRED_REPLAY'
      using errcode = '55000';
  end if;

  if current_source.id is not null then
    update sellerpilot_private.smartstore_create_category_attribute_sources
       set retired_at = pg_catalog.clock_timestamp(),
           retired_reason = 'superseded'
     where id = current_source.id;
  end if;

  insert into sellerpilot_private.smartstore_create_category_attribute_sources(
    owner_id, product_id, product_updated_at,
    credential_id, credential_version, seller_account_key,
    approved_detail_revision, approved_detail_digest,
    assignment_id, assignment_updated_at, assignment_revision,
    assignment_source_digest, assignment_digest, assignment,
    official_readback_digest, official_readback,
    product_attributes_sha256
  ) values (
    p_owner_id, p_product_id, p_product_updated_at,
    p_credential_id, p_credential_version, p_seller_account_key,
    p_approved_detail_revision, p_approved_detail_digest,
    p_assignment_id, p_assignment_updated_at, assignment_revision,
    assignment_source_digest, assignment_digest, assignment_value,
    official_digest, official_value, product_attributes_sha256
  ) returning id into inserted_id;

  return pg_catalog.jsonb_build_object(
    'sourceId', inserted_id,
    'replayed', false,
    'assignmentRevision', assignment_revision,
    'assignmentDigest', assignment_digest,
    'officialReadbackDigest', official_digest,
    'productAttributesSha256', product_attributes_sha256
  );
end;
$$;

create function public.sellerpilot_service_retire_smartstore_create_category_source(
  p_source_id uuid,
  p_assignment_digest text,
  p_official_readback_digest text,
  p_reason text default 'operator_retired'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_source_id is null or p_assignment_digest is null
     or p_official_readback_digest is null
     or p_reason not in ('operator_retired', 'source_invalidated') then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_RETIRE_INVALID'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910031000);
  update sellerpilot_private.smartstore_create_category_attribute_sources source
     set retired_at = pg_catalog.clock_timestamp(),
         retired_reason = p_reason
   where source.id = p_source_id
     and source.retired_at is null
     and source.assignment_digest = p_assignment_digest
     and source.official_readback_digest = p_official_readback_digest;
  return found;
end;
$$;

alter function public.sellerpilot_service_smartstore_create_source_snapshot(
  uuid,uuid,uuid
) rename to sp_60910031000_smartstore_snapshot_before_category_source;
revoke all on function
  public.sp_60910031000_smartstore_snapshot_before_category_source(
    uuid,uuid,uuid
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_smartstore_create_source_snapshot(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_snapshot jsonb;
  category_source jsonb;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  base_snapshot :=
    public.sp_60910031000_smartstore_snapshot_before_category_source(
      p_owner_id, p_product_id, p_credential_id
    );
  if base_snapshot is null then
    return null;
  end if;
  category_source :=
    sellerpilot_private.smartstore_category_source_current_json(
      p_owner_id, p_product_id, p_credential_id
    );
  return base_snapshot || pg_catalog.jsonb_build_object(
    'categoryAttributeSource', category_source
  );
end;
$$;

alter function sellerpilot_private.smartstore_create_source_is_current(
  uuid,uuid
) rename to sp_60910031000_smartstore_source_before_category;
revoke all on function
  sellerpilot_private.sp_60910031000_smartstore_source_before_category(
    uuid,uuid
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_create_source_is_current(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_row sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
begin
  select source.*
    into source_row
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = job.created_by
     and source.product_id::text =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,productId}'
     and source.credential_id = job.credential_id
     and source.retired_at is null
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'smartstore'
     and job.operation = 'listing.create'
     and job.environment = 'production'
     and job.status = 'running'
     and job.provider_mutation_started_at is null
     and job.seller_account_key = source.seller_account_key
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,contract}'
       = 'smartstore_category_attribute_mapping_v1'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,ok}'
       = 'true'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,categoryId}'
       = source.assignment->>'categoryId'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,assignmentRevision}'
       = source.assignment_revision::text
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,assignmentDigest}'
       = source.assignment_digest
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,officialReadbackDigest}'
       = source.official_readback_digest
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,productAttributesSha256}'
       = source.product_attributes_sha256
     and job.request_payload#>>'{arguments,body,originProduct,leafCategoryId}'
       = source.assignment->>'categoryId'
     and pg_catalog.jsonb_typeof(
       job.request_payload#>'{arguments,body,originProduct,detailAttribute,productAttributes}'
     ) = 'array'
     and sellerpilot_private.smartstore_category_source_hash(
       sellerpilot_private.smartstore_category_source_sorted_records(
         job.request_payload#>'{arguments,body,originProduct,detailAttribute,productAttributes}'
       )
     ) = source.product_attributes_sha256
   for update of job, source;

  if source_row.id is null then
    return false;
  end if;
  perform 1 from sellerpilot_private.products product
   where product.id = source_row.product_id for update;
  perform 1 from sellerpilot_private.channel_credentials credential
   where credential.id = source_row.credential_id for update;
  perform 1 from sellerpilot_private.product_category_assignments assignment
   where assignment.id = source_row.assignment_id for update;
  if sellerpilot_private.smartstore_category_source_current_json(
       source_row.owner_id,
       source_row.product_id,
       source_row.credential_id
     ) is null then
    return false;
  end if;
  return sellerpilot_private.sp_60910031000_smartstore_source_before_category(
    p_job_id, p_claim_token
  ) is true;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_category_source_canonical(jsonb),
  sellerpilot_private.smartstore_category_source_hash(jsonb),
  sellerpilot_private.smartstore_category_source_sorted_records(jsonb),
  sellerpilot_private.smartstore_category_assignment_source_payload(jsonb,jsonb),
  sellerpilot_private.guard_smartstore_category_source_append_only(),
  sellerpilot_private.smartstore_category_source_current_json(uuid,uuid,uuid),
  sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_read_smartstore_create_category_source(uuid,uuid,uuid),
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ),
  public.sellerpilot_service_retire_smartstore_create_category_source(
    uuid,text,text,text
  ),
  public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_read_smartstore_create_category_source(uuid,uuid,uuid),
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ),
  public.sellerpilot_service_retire_smartstore_create_category_source(
    uuid,text,text,text
  ),
  public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)
  to service_role;

comment on table
  sellerpilot_private.smartstore_create_category_attribute_sources is
  'Append-only, service-owned SmartStore listing.create category/attribute source. One current row binds exact owner/product revision, approval, credential account/version, confirmed assignment revision, and canonical official readback.';
comment on function
  sellerpilot_private.smartstore_create_source_is_current(uuid,uuid) is
  'Final local/serverless SmartStore listing.create fence. Locks and rechecks the durable category source and exact job mapping/body digests before either provider begin wrapper can mutate.';

notify pgrst, 'reload schema';

commit;
