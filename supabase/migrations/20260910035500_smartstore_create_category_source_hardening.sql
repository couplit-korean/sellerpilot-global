-- SmartStore 012-r3: official category projection, stored-selection
-- equivalence, exact-one assignment CAS, expiring source refresh, and a single
-- product/credential/assignment/source lock order at both provider boundaries.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910035500);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_append_smartstore_create_category_source(uuid,uuid,timestamptz,uuid,integer,text,bigint,text,uuid,timestamptz,jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_create_category_attribute_sources'
     ) is null then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_HARDENING_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

alter table sellerpilot_private.smartstore_create_category_attribute_sources
  add column expires_at timestamptz;

update sellerpilot_private.smartstore_create_category_attribute_sources
   set expires_at = created_at + interval '15 minutes';

alter table sellerpilot_private.smartstore_create_category_attribute_sources
  alter column expires_at set not null,
  alter column expires_at set default
    (pg_catalog.clock_timestamp() + interval '15 minutes'),
  add constraint smartstore_create_category_source_expiry_valid
    check (expires_at > created_at);

create unique index
  smartstore_one_confirmed_production_kr_leaf_assignment_idx
on sellerpilot_private.product_category_assignments(
  owner_id, product_id, channel, environment, market
)
where product_id is not null
  and channel = 'smartstore'
  and environment = 'production'
  and market = 'KR'
  and status = 'confirmed'
  and is_leaf;

alter function
  sellerpilot_private.smartstore_category_source_payload_is_valid(
    text,jsonb,jsonb
  ) rename to sp_60910035500_category_payload_before_documented_fields;

revoke all on function
  sellerpilot_private.sp_60910035500_category_payload_before_documented_fields(
    text,jsonb,jsonb
  ) from public, anon, authenticated, service_role;

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
  category_value jsonb := p_official_readback->'category';
  certification jsonb;
  base_readback jsonb;
begin
  if pg_catalog.jsonb_typeof(category_value) is distinct from 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(category_value) field_name
       where field_name not in (
         'id', 'name', 'wholeCategoryName', 'last',
         'exceptionalCategories', 'certificationInfos'
       )
     )
     or (category_value ? 'exceptionalCategories'
       and (pg_catalog.jsonb_typeof(
         category_value->'exceptionalCategories'
       ) <> 'array'
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           category_value->'exceptionalCategories'
         ) item
         where pg_catalog.jsonb_typeof(item) <> 'string'
           or nullif(pg_catalog.btrim(item#>>'{}'), '') is null
       )))
     or (category_value ? 'certificationInfos'
       and pg_catalog.jsonb_typeof(
         category_value->'certificationInfos'
       ) <> 'array') then
    return false;
  end if;

  for certification in
    select item from pg_catalog.jsonb_array_elements(
      coalesce(category_value->'certificationInfos', '[]'::jsonb)
    ) item
  loop
    if pg_catalog.jsonb_typeof(certification) <> 'object'
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(certification) field_name
         where field_name not in ('id', 'name', 'kindTypes')
       )
       or coalesce(certification->>'id', '') !~ '^[1-9]\d*$'
       or (certification->>'id')::numeric > 9007199254740991
       or pg_catalog.jsonb_typeof(certification->'name') <> 'string'
       or nullif(pg_catalog.btrim(certification->>'name'), '') is null
       or pg_catalog.jsonb_typeof(certification->'kindTypes') <> 'array'
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(certification->'kindTypes') item
         where pg_catalog.jsonb_typeof(item) <> 'string'
           or nullif(pg_catalog.btrim(item#>>'{}'), '') is null
       ) then
      return false;
    end if;
  end loop;

  base_readback := pg_catalog.jsonb_set(
    p_official_readback,
    '{category}',
    category_value - 'exceptionalCategories' - 'certificationInfos'
  );
  return sellerpilot_private
    .sp_60910035500_category_payload_before_documented_fields(
      p_category_id, p_provider_attributes, base_readback
    );
exception when others then
  return false;
end;
$$;

create function
  sellerpilot_private.smartstore_category_source_compile_stored_selection(
    p_stored_selection jsonb,
    p_official_readback jsonb
  )
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  attribute_key text;
  stored_value jsonb;
  selected_value jsonb;
  attribute_row jsonb;
  classification text;
  attribute_seq numeric;
  attribute_value_seq numeric;
  real_value text;
  unit_code text;
  compiled jsonb := '[]'::jsonb;
begin
  if pg_catalog.jsonb_typeof(p_stored_selection) <> 'object' then
    return null;
  end if;
  for attribute_key, stored_value in
    select key, value from pg_catalog.jsonb_each(p_stored_selection)
  loop
    if attribute_key !~ '^[1-9]\d*$'
       or attribute_key::numeric > 9007199254740991 then
      return null;
    end if;
    attribute_seq := attribute_key::numeric;
    select item into attribute_row
      from pg_catalog.jsonb_array_elements(
        p_official_readback->'attributes'
      ) item
     where item->>'attributeSeq' = attribute_key
     limit 1;
    if attribute_row is null then
      return null;
    end if;
    classification := attribute_row->>'attributeClassificationType';

    if classification in ('SINGLE_SELECT', 'MULTI_SELECT') then
      if pg_catalog.jsonb_typeof(stored_value) = 'array' then
        if pg_catalog.jsonb_array_length(stored_value) = 0 then
          return null;
        end if;
        for selected_value in
          select item from pg_catalog.jsonb_array_elements(stored_value) item
        loop
          if coalesce(selected_value#>>'{}', '') !~ '^[1-9]\d*$'
             or (selected_value#>>'{}')::numeric > 9007199254740991 then
            return null;
          end if;
          attribute_value_seq := (selected_value#>>'{}')::numeric;
          compiled := compiled || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'attributeSeq', attribute_seq,
              'attributeValueSeq', attribute_value_seq
            )
          );
        end loop;
      else
        if coalesce(stored_value#>>'{}', '') !~ '^[1-9]\d*$'
           or (stored_value#>>'{}')::numeric > 9007199254740991 then
          return null;
        end if;
        attribute_value_seq := (stored_value#>>'{}')::numeric;
        compiled := compiled || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'attributeSeq', attribute_seq,
            'attributeValueSeq', attribute_value_seq
          )
        );
      end if;
    elsif classification = 'RANGE' then
      if pg_catalog.jsonb_typeof(stored_value) <> 'object'
         or exists (
           select 1 from pg_catalog.jsonb_object_keys(stored_value) field_name
           where field_name not in (
             'attributeValueSeq', 'attributeRealValue',
             'attributeRealValueUnitCode'
           )
         )
         or coalesce(stored_value->>'attributeValueSeq', '') !~ '^[1-9]\d*$'
         or (stored_value->>'attributeValueSeq')::numeric > 9007199254740991
         or nullif(pg_catalog.btrim(
           stored_value->>'attributeRealValue'
         ), '') is null then
        return null;
      end if;
      attribute_value_seq := (stored_value->>'attributeValueSeq')::numeric;
      real_value := pg_catalog.btrim(stored_value->>'attributeRealValue');
      unit_code := nullif(pg_catalog.btrim(
        stored_value->>'attributeRealValueUnitCode'
      ), '');
      compiled := compiled || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'attributeSeq', attribute_seq,
          'attributeValueSeq', attribute_value_seq,
          'attributeRealValue', real_value
        ) || case when unit_code is null then '{}'::jsonb
          else pg_catalog.jsonb_build_object(
            'attributeRealValueUnitCode', unit_code
          ) end
      );
    else
      return null;
    end if;
  end loop;
  return sellerpilot_private.smartstore_category_source_sorted_records(
    compiled
  );
exception when others then
  return null;
end;
$$;

create or replace function public.sellerpilot_service_append_smartstore_create_category_source(
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
  compiled_provider_attributes jsonb;
  current_official_payload jsonb;
  normalized_official_payload jsonb;
  assignment_count integer;
  matching_retired sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910035500);
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

  select pg_catalog.count(*)::integer into assignment_count
    from sellerpilot_private.product_category_assignments candidate
   where candidate.owner_id = p_owner_id
     and candidate.product_id = p_product_id
     and candidate.channel = 'smartstore'
     and candidate.environment = 'production'
     and candidate.market = 'KR'
     and candidate.status = 'confirmed'
     and candidate.is_leaf
     and length(pg_catalog.btrim(candidate.category_id)) between 1 and 120
     and candidate.updated_at is not null
     and candidate.official_verified_at is not null
     and candidate.confirmed_at is not null
     and pg_catalog.jsonb_typeof(candidate.required_attributes) = 'array'
     and pg_catalog.jsonb_typeof(candidate.provided_attributes) = 'object'
     and pg_catalog.jsonb_typeof(candidate.missing_required_attributes) = 'array'
     and pg_catalog.jsonb_array_length(
       candidate.missing_required_attributes
     ) = 0;
  if assignment_count <> 1 then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_ASSIGNMENT_AMBIGUOUS'
      using errcode = '55000';
  end if;

  compiled_provider_attributes :=
    sellerpilot_private.smartstore_category_source_compile_stored_selection(
      assignment.provided_attributes, p_official_readback
    );
  if compiled_provider_attributes is null
     or compiled_provider_attributes is distinct from
       sellerpilot_private.smartstore_category_source_sorted_records(
         p_provider_attributes
       ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_STORED_SELECTION_MISMATCH'
      using errcode = '22023';
  end if;

  normalized_official_payload := pg_catalog.jsonb_build_object(
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

  if current_source.id is not null then
    current_official_payload := current_source.official_readback
      - 'contract' - 'categoryId' - 'assignmentRevision'
      - 'assignmentDigest' - 'digest';
  end if;

  if current_source.id is not null
     and current_source.expires_at > pg_catalog.clock_timestamp()
     and current_source.assignment_source_digest = assignment_source_digest
     and current_official_payload = normalized_official_payload then
    assignment_revision := current_source.assignment_revision;
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
     and current_source.expires_at > pg_catalog.clock_timestamp()
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

  if current_source.id is null then
    select * into matching_retired
      from sellerpilot_private.smartstore_create_category_attribute_sources source
     where source.owner_id = p_owner_id
       and source.product_id = p_product_id
       and source.assignment_source_digest = assignment_source_digest
       and (source.official_readback
         - 'contract' - 'categoryId' - 'assignmentRevision'
         - 'assignmentDigest' - 'digest') = normalized_official_payload
     order by source.created_at desc
     limit 1;
    if matching_retired.id is not null
       and matching_retired.retired_reason in (
         'operator_retired', 'source_invalidated'
       ) then
      raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_RETIRED_REPLAY'
        using errcode = '55000';
    end if;
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

create or replace function sellerpilot_private.smartstore_category_source_current_json(
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
           'collectedAt', source.created_at,
           'expiresAt', source.expires_at,
           'assignment', source.assignment,
           'officialReadback', source.official_readback
         )
    into result
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.credential_id = p_credential_id
     and source.retired_at is null
     and source.expires_at > pg_catalog.clock_timestamp()
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
     and 1 = (
       select pg_catalog.count(*)
       from sellerpilot_private.product_category_assignments exact_assignment
       where exact_assignment.owner_id = source.owner_id
         and exact_assignment.product_id = source.product_id
         and exact_assignment.channel = 'smartstore'
         and exact_assignment.environment = 'production'
         and exact_assignment.market = 'KR'
         and exact_assignment.status = 'confirmed'
         and exact_assignment.is_leaf
         and length(pg_catalog.btrim(
           exact_assignment.category_id
         )) between 1 and 120
         and exact_assignment.updated_at is not null
         and exact_assignment.official_verified_at is not null
         and exact_assignment.confirmed_at is not null
         and pg_catalog.jsonb_typeof(
           exact_assignment.required_attributes
         ) = 'array'
         and pg_catalog.jsonb_typeof(
           exact_assignment.provided_attributes
         ) = 'object'
         and pg_catalog.jsonb_typeof(
           exact_assignment.missing_required_attributes
         ) = 'array'
         and pg_catalog.jsonb_array_length(
           exact_assignment.missing_required_attributes
         ) = 0
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


create or replace function sellerpilot_private.smartstore_create_source_is_current(
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
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910035500);

  -- Discover identifiers without locking, then acquire the shared rows in the
  -- same order as append. The second SELECT is the authoritative locked CAS.
  select source.* into source_row
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = job.created_by
     and source.product_id::text =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,productId}'
     and source.credential_id = job.credential_id
     and source.retired_at is null
     and source.expires_at > pg_catalog.clock_timestamp()
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'smartstore'
     and job.operation = 'listing.create'
     and job.environment = 'production'
     and job.status = 'running'
     and job.provider_mutation_started_at is null;

  if source_row.id is null then
    return false;
  end if;

  perform 1 from sellerpilot_private.products product
   where product.id = source_row.product_id for update;
  perform 1 from sellerpilot_private.channel_credentials credential
   where credential.id = source_row.credential_id for update;
  perform 1 from sellerpilot_private.product_category_assignments assignment
   where assignment.id = source_row.assignment_id for update;

  select source.* into source_row
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = job.created_by
     and source.product_id::text =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,productId}'
     and source.credential_id = job.credential_id
     and source.retired_at is null
     and source.expires_at > pg_catalog.clock_timestamp()
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
  sellerpilot_private.smartstore_category_source_payload_is_valid(
    text,jsonb,jsonb
  ),
  sellerpilot_private.smartstore_category_source_compile_stored_selection(
    jsonb,jsonb
  ),
  sellerpilot_private.smartstore_category_source_current_json(uuid,uuid,uuid),
  sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ) to service_role;

comment on function
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ) is
  'Appends an expiring SmartStore official category source only when provider attributes exactly compile from the one current DB assignment; official drift advances revision and supersedes the old source.';

commit;
