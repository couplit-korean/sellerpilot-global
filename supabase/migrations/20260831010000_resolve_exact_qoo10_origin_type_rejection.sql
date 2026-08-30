-- Resolve one exact Qoo10 listing.update reconciliation after the provider
-- explicitly rejected UpdateGoods because ProductionPlaceType was absent.
--
-- This is deliberately not a generic reconciliation escape hatch. The raw
-- request/response digests, complete row lineage, provider message, S1
-- readback, and absence of a later listing job are all fixed below. No
-- provider call is issued and the immutable raw evidence/receipt is retained.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

-- Keep the create-time delivery contract (ShippingNo=0) immutable while
-- separately binding the provider-assigned delivery group returned by the
-- unchanged S1 item. Later rollback-update preflight must use the observed
-- value (806971); it must never rewrite the original request/confirmation.
create table if not exists
  sellerpilot_private.qoo10_listing_update_rejection_observations (
    update_job_id uuid not null,
    update_attempt_id uuid not null,
    source_job_id uuid not null,
    source_attempt_id uuid not null,
    listing_id uuid not null,
    credential_id uuid not null,
    remote_id text not null,
    response_sha256 text not null,
    provider_rejection_code text not null,
    provider_rejection_reason text not null,
    provider_status text not null,
    observed_origin_type text not null,
    observed_origin text not null,
    observed_retail_price_jpy bigint not null,
    observed_sell_price_jpy bigint not null,
    observed_quantity integer not null,
    source_shipping_no text not null,
    observed_shipping_no text not null,
    observed_detail_image_count integer not null,
    provider_mutation_accepted boolean not null,
    observed_at timestamptz not null,
    constraint qoo10_update_rejection_observations_pkey
      primary key (update_job_id),
    constraint qoo10_update_rejection_observations_attempt_key
      unique (update_attempt_id),
    constraint qoo10_update_rejection_observations_source_key
      unique (source_job_id),
    constraint qoo10_update_rejection_observations_listing_key
      unique (listing_id),
    constraint qoo10_update_rejection_observations_update_job_fkey
      foreign key (update_job_id)
      references sellerpilot_private.channel_gateway_jobs(id)
      on delete restrict,
    constraint qoo10_update_rejection_observations_update_attempt_fkey
      foreign key (update_attempt_id)
      references sellerpilot_private.channel_operation_attempts(id)
      on delete restrict,
    constraint qoo10_update_rejection_observations_source_job_fkey
      foreign key (source_job_id)
      references sellerpilot_private.qoo10_listing_create_rollback_confirmations(
        source_job_id
      ) on delete restrict,
    constraint qoo10_update_rejection_observations_source_attempt_fkey
      foreign key (source_attempt_id)
      references sellerpilot_private.channel_operation_attempts(id)
      on delete restrict,
    constraint qoo10_update_rejection_observations_listing_fkey
      foreign key (listing_id)
      references sellerpilot_private.product_listings(id)
      on delete restrict,
    constraint qoo10_update_rejection_observations_credential_fkey
      foreign key (credential_id)
      references sellerpilot_private.channel_credentials(id)
      on delete restrict,
    constraint qoo10_update_rejection_observations_remote_check
      check (remote_id ~ '^[0-9]{1,40}$'),
    constraint qoo10_update_rejection_observations_response_sha_check
      check (response_sha256 ~ '^[a-f0-9]{64}$'),
    constraint qoo10_update_rejection_observations_rejection_code_check
      check (provider_rejection_code = '-99'),
    constraint qoo10_update_rejection_observations_rejection_reason_check
      check (provider_rejection_reason = 'ProductionPlaceType_required'),
    constraint qoo10_update_rejection_observations_provider_status_check
      check (provider_status = 'S1'),
    constraint qoo10_update_rejection_observations_origin_type_check
      check (observed_origin_type ~ '^[0-9]{1,4}$'),
    constraint qoo10_update_rejection_observations_origin_check
      check (
        length(observed_origin) between 1 and 160
        and observed_origin !~ '[[:cntrl:]]'
      ),
    constraint qoo10_update_rejection_observations_retail_price_check
      check (observed_retail_price_jpy between 1 and 999999999),
    constraint qoo10_update_rejection_observations_sell_price_check
      check (
        observed_sell_price_jpy between 1 and observed_retail_price_jpy
      ),
    constraint qoo10_update_rejection_observations_quantity_check
      check (observed_quantity between 1 and 99999999),
    constraint qoo10_update_rejection_observations_source_shipping_check
      check (source_shipping_no ~ '^[0-9]{1,20}$'),
    constraint qoo10_update_rejection_observations_observed_shipping_check
      check (
        observed_shipping_no ~ '^[0-9]{1,20}$'
        and observed_shipping_no <> source_shipping_no
      ),
    constraint qoo10_update_rejection_observations_image_count_check
      check (observed_detail_image_count = 8),
    constraint qoo10_update_rejection_observations_mutation_check
      check (not provider_mutation_accepted)
  );

alter table
  sellerpilot_private.qoo10_listing_update_rejection_observations
  enable row level security;
revoke all on table
  sellerpilot_private.qoo10_listing_update_rejection_observations
  from public, anon, authenticated, service_role;

do $qoo10_observation_schema_postimage$
declare
  v_columns text[];
  v_constraints text[];
  v_table_oid oid :=
    'sellerpilot_private.qoo10_listing_update_rejection_observations'::regclass;
begin
  select array_agg(
           attribute.attname || ':'
             || pg_catalog.format_type(
                  attribute.atttypid,
                  attribute.atttypmod
                ) || ':'
             || attribute.attnotnull::text || ':'
             || attribute.atthasdef::text
           order by attribute.attnum
         )
    into v_columns
    from pg_catalog.pg_attribute attribute
   where attribute.attrelid = v_table_oid
     and attribute.attnum > 0
     and not attribute.attisdropped;
  if v_columns is distinct from array[
    'update_job_id:uuid:true:false',
    'update_attempt_id:uuid:true:false',
    'source_job_id:uuid:true:false',
    'source_attempt_id:uuid:true:false',
    'listing_id:uuid:true:false',
    'credential_id:uuid:true:false',
    'remote_id:text:true:false',
    'response_sha256:text:true:false',
    'provider_rejection_code:text:true:false',
    'provider_rejection_reason:text:true:false',
    'provider_status:text:true:false',
    'observed_origin_type:text:true:false',
    'observed_origin:text:true:false',
    'observed_retail_price_jpy:bigint:true:false',
    'observed_sell_price_jpy:bigint:true:false',
    'observed_quantity:integer:true:false',
    'source_shipping_no:text:true:false',
    'observed_shipping_no:text:true:false',
    'observed_detail_image_count:integer:true:false',
    'provider_mutation_accepted:boolean:true:false',
    'observed_at:timestamp with time zone:true:false'
  ]::text[] then
    raise exception 'Qoo10 observation column post-image mismatch'
      using errcode = '55000';
  end if;

  select array_agg(constraint_row.conname order by constraint_row.conname)
    into v_constraints
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid = v_table_oid
     and constraint_row.convalidated;
  if v_constraints is distinct from array[
    'qoo10_update_rejection_observations_attempt_key',
    'qoo10_update_rejection_observations_credential_fkey',
    'qoo10_update_rejection_observations_image_count_check',
    'qoo10_update_rejection_observations_listing_fkey',
    'qoo10_update_rejection_observations_listing_key',
    'qoo10_update_rejection_observations_mutation_check',
    'qoo10_update_rejection_observations_observed_shipping_check',
    'qoo10_update_rejection_observations_origin_check',
    'qoo10_update_rejection_observations_origin_type_check',
    'qoo10_update_rejection_observations_pkey',
    'qoo10_update_rejection_observations_provider_status_check',
    'qoo10_update_rejection_observations_quantity_check',
    'qoo10_update_rejection_observations_rejection_code_check',
    'qoo10_update_rejection_observations_rejection_reason_check',
    'qoo10_update_rejection_observations_remote_check',
    'qoo10_update_rejection_observations_response_sha_check',
    'qoo10_update_rejection_observations_retail_price_check',
    'qoo10_update_rejection_observations_sell_price_check',
    'qoo10_update_rejection_observations_source_attempt_fkey',
    'qoo10_update_rejection_observations_source_job_fkey',
    'qoo10_update_rejection_observations_source_key',
    'qoo10_update_rejection_observations_source_shipping_check',
    'qoo10_update_rejection_observations_update_attempt_fkey',
    'qoo10_update_rejection_observations_update_job_fkey'
  ]::text[] then
    raise exception 'Qoo10 observation constraint-name post-image mismatch'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from (
        values
          ('qoo10_update_rejection_observations_pkey', 'p'::"char",
             array[1]::smallint[], null::regclass, null::smallint[]),
          ('qoo10_update_rejection_observations_attempt_key', 'u'::"char",
             array[2]::smallint[], null::regclass, null::smallint[]),
          ('qoo10_update_rejection_observations_source_key', 'u'::"char",
             array[3]::smallint[], null::regclass, null::smallint[]),
          ('qoo10_update_rejection_observations_listing_key', 'u'::"char",
             array[5]::smallint[], null::regclass, null::smallint[]),
          ('qoo10_update_rejection_observations_update_job_fkey', 'f'::"char",
             array[1]::smallint[],
             'sellerpilot_private.channel_gateway_jobs'::regclass,
             array[1]::smallint[]),
          ('qoo10_update_rejection_observations_update_attempt_fkey', 'f'::"char",
             array[2]::smallint[],
             'sellerpilot_private.channel_operation_attempts'::regclass,
             array[1]::smallint[]),
          ('qoo10_update_rejection_observations_source_job_fkey', 'f'::"char",
             array[3]::smallint[],
             'sellerpilot_private.qoo10_listing_create_rollback_confirmations'::regclass,
             array[1]::smallint[]),
          ('qoo10_update_rejection_observations_source_attempt_fkey', 'f'::"char",
             array[4]::smallint[],
             'sellerpilot_private.channel_operation_attempts'::regclass,
             array[1]::smallint[]),
          ('qoo10_update_rejection_observations_listing_fkey', 'f'::"char",
             array[5]::smallint[],
             'sellerpilot_private.product_listings'::regclass,
             array[1]::smallint[]),
          ('qoo10_update_rejection_observations_credential_fkey', 'f'::"char",
             array[6]::smallint[],
             'sellerpilot_private.channel_credentials'::regclass,
             array[1]::smallint[])
      ) expected(name, kind, local_keys, foreign_table, foreign_keys)
      left join pg_catalog.pg_constraint constraint_row
        on constraint_row.conrelid = v_table_oid
       and constraint_row.conname = expected.name
       and constraint_row.contype = expected.kind
       and constraint_row.conkey = expected.local_keys
       and (
         expected.kind <> 'f'::"char"
         or (
           constraint_row.confrelid = expected.foreign_table
           and constraint_row.confkey = expected.foreign_keys
           and constraint_row.confdeltype = 'r'::"char"
         )
       )
     where constraint_row.oid is null
  ) or exists (
    select 1
      from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid = v_table_oid
       and constraint_row.conname like
             'qoo10_update_rejection_observations_%_check'
       and constraint_row.contype <> 'c'::"char"
  ) then
    raise exception 'Qoo10 observation key/FK/check post-image mismatch'
      using errcode = '55000';
  end if;

  -- Constraint names and types are insufficient: a pre-existing table could
  -- keep the same catalog outline while weakening one of the evidence checks.
  -- Bind every normalized expression, including its operators, while avoiding
  -- a formatter-specific whole pg_get_constraintdef fingerprint.
  if exists (
    select 1
      from (
        values
          ('qoo10_update_rejection_observations_remote_check',
             'remote_id~''^[0-9]{1,40}$'''),
          ('qoo10_update_rejection_observations_response_sha_check',
             'response_sha256~''^[a-f0-9]{64}$'''),
          ('qoo10_update_rejection_observations_rejection_code_check',
             'provider_rejection_code=''-99'''),
          ('qoo10_update_rejection_observations_rejection_reason_check',
             'provider_rejection_reason=''productionplacetype_required'''),
          ('qoo10_update_rejection_observations_provider_status_check',
             'provider_status=''s1'''),
          ('qoo10_update_rejection_observations_origin_type_check',
             'observed_origin_type~''^[0-9]{1,4}$'''),
          ('qoo10_update_rejection_observations_origin_check',
             'lengthobserved_origin>=1andlengthobserved_origin<=160andobserved_origin!~''[[:cntrl:]]'''),
          ('qoo10_update_rejection_observations_retail_price_check',
             'observed_retail_price_jpy>=1andobserved_retail_price_jpy<=999999999'),
          ('qoo10_update_rejection_observations_sell_price_check',
             'observed_sell_price_jpy>=1andobserved_sell_price_jpy<=observed_retail_price_jpy'),
          ('qoo10_update_rejection_observations_quantity_check',
             'observed_quantity>=1andobserved_quantity<=99999999'),
          ('qoo10_update_rejection_observations_source_shipping_check',
             'source_shipping_no~''^[0-9]{1,20}$'''),
          ('qoo10_update_rejection_observations_observed_shipping_check',
             'observed_shipping_no~''^[0-9]{1,20}$''andobserved_shipping_no<>source_shipping_no'),
          ('qoo10_update_rejection_observations_image_count_check',
             'observed_detail_image_count=8'),
          ('qoo10_update_rejection_observations_mutation_check',
             'notprovider_mutation_accepted')
      ) expected(name, normalized_expression)
      left join pg_catalog.pg_constraint constraint_row
        on constraint_row.conrelid = v_table_oid
       and constraint_row.conname = expected.name
       and constraint_row.contype = 'c'::"char"
     where constraint_row.oid is null
        or pg_catalog.regexp_replace(
             pg_catalog.replace(
               pg_catalog.lower(pg_catalog.pg_get_expr(
                 constraint_row.conbin,
                 constraint_row.conrelid
               )),
               '::text',
               ''
             ),
             '[[:space:]()]',
             '',
             'g'
           ) is distinct from expected.normalized_expression
  ) then
    raise exception 'Qoo10 observation check-body post-image mismatch'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_class table_class
        where table_class.oid = v_table_oid
          and table_class.relkind = 'r'
          and table_class.relrowsecurity
          and not table_class.relforcerowsecurity
     )
     or exists (
       select 1
         from pg_catalog.pg_policy policy
        where policy.polrelid = v_table_oid
     )
     or exists (
       select 1
         from pg_catalog.pg_class table_class,
              lateral aclexplode(
                coalesce(
                  table_class.relacl,
                  acldefault('r', table_class.relowner)
                )
              ) acl
        where table_class.oid = v_table_oid
          and acl.grantee <> table_class.relowner
     )
     or not exists (
       select 1
         from pg_catalog.pg_class table_class
         join pg_catalog.pg_roles owner_role
           on owner_role.oid = table_class.relowner
        where table_class.oid = v_table_oid
          and owner_role.rolname = 'postgres'
          and owner_role.rolcanlogin
          and owner_role.rolbypassrls
          and (
            select count(distinct acl.privilege_type)
              from aclexplode(
                coalesce(
                  table_class.relacl,
                  acldefault('r', table_class.relowner)
                )
              ) acl
             where acl.grantee = table_class.relowner
          ) = 8
     ) then
    raise exception 'Qoo10 observation RLS or ACL post-image mismatch'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_class observation_table
         join pg_catalog.pg_class confirmation_table
           on confirmation_table.oid =
                'sellerpilot_private.qoo10_listing_create_rollback_confirmations'::regclass
          and confirmation_table.relowner = observation_table.relowner
          and confirmation_table.relrowsecurity
          and not confirmation_table.relforcerowsecurity
        where observation_table.oid = v_table_oid
          and not exists (
            select 1
              from pg_catalog.pg_policy policy
             where policy.polrelid = confirmation_table.oid
          )
          and not exists (
            select 1
              from aclexplode(coalesce(
                confirmation_table.relacl,
                acldefault('r', confirmation_table.relowner)
              )) acl
             where acl.grantee <> confirmation_table.relowner
          )
          and (
            select count(distinct acl.privilege_type)
              from aclexplode(coalesce(
                confirmation_table.relacl,
                acldefault('r', confirmation_table.relowner)
              )) acl
             where acl.grantee = confirmation_table.relowner
          ) = 8
     ) then
    raise exception 'Qoo10 confirmation/observation owner contract mismatch'
      using errcode = '55000';
  end if;
end;
$qoo10_observation_schema_postimage$;

-- Thread the separately attested delivery-group number through the four
-- existing rollback-update boundaries. Every patch is anchored to the exact
-- current function text and aborts if that contract has drifted. Confirmations
-- without an exact observation continue to use their original ShippingNo.
create or replace function
  sellerpilot_private.qoo10_definition_occurrences(
    p_definition text,
    p_fragment text
  )
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when p_fragment = '' then 0
    else (
      length(p_definition)
        - length(pg_catalog.replace(p_definition, p_fragment, ''))
    ) / length(p_fragment)
  end
$$;

revoke all on function
  sellerpilot_private.qoo10_definition_occurrences(text, text)
  from public, anon, authenticated, service_role;

do $qoo10_observed_shipping_contract_patch$
declare
  v_definition text;
  v_patched text;
  v_from text;
  v_to text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'qoo10_listing_update_rejection_observations') = 0 then
    if encode(extensions.digest(v_definition, 'sha256'), 'hex') not in (
      '1aadd3dcfb8d5afb1f7845ad7f06c80e3e977c803a1cc4ca178e2ea384c0be95',
      '008297d64da9fcbab6f3047a2a2d9c52bb0a0ac221c0ad47714b2da6ca894514'
    ) then
      raise exception 'Qoo10 rollback identity full pre-image drifted'
        using errcode = '55000';
    end if;
    v_from := '         confirmation.shipping_no,
         confirmation.bi_contents_no';
    v_to := '         coalesce(
           shipping_observation.observed_shipping_no,
           confirmation.shipping_no
         ) as shipping_no,
         confirmation.bi_contents_no';
    if pg_catalog.strpos(v_definition, v_from) = 0 then
      raise exception 'Qoo10 rollback identity shipping projection drifted'
        using errcode = '55000';
    end if;
    v_patched := pg_catalog.replace(v_definition, v_from, v_to);
    v_from := '    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.product_listings listing';
    v_to := '    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    left join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.provider_status = ''S1''
     and not shipping_observation.provider_mutation_accepted
    join sellerpilot_private.product_listings listing';
    if pg_catalog.strpos(v_patched, v_from) = 0 then
      raise exception 'Qoo10 rollback identity confirmation join drifted'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_patched, v_from, v_to);
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(jsonb,jsonb,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'qoo10_listing_update_rejection_observations') = 0 then
    if encode(extensions.digest(v_definition, 'sha256'), 'hex') not in (
      'ce32110f56f5486e8bb60f60b443b7c5cb575c51fcef9207a529a560901ec89a',
      'c6a1c6c040c9b7185182c4d4d01ccd15cc4f3614f31bf46c2475eda7e8d3e7de'
    ) then
      raise exception 'Qoo10 retry helper full pre-image drifted'
        using errcode = '55000';
    end if;
    v_from := '    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.channel_gateway_jobs update_job';
    v_to := '    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    left join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.provider_status = ''S1''
     and not shipping_observation.provider_mutation_accepted
    join sellerpilot_private.channel_gateway_jobs update_job';
    if pg_catalog.strpos(v_definition, v_from) = 0 then
      raise exception 'Qoo10 retry helper confirmation join drifted'
        using errcode = '55000';
    end if;
    v_patched := pg_catalog.replace(v_definition, v_from, v_to);
    v_from := '''shippingNo'', confirmation.shipping_no';
    v_to := '''shippingNo'', coalesce(
                   shipping_observation.observed_shipping_no,
                   confirmation.shipping_no
                 )';
    if pg_catalog.strpos(v_patched, v_from) = 0 then
      raise exception 'Qoo10 retry helper expected shipping drifted'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_patched, v_from, v_to);
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'qoo10_listing_update_rejection_observations') = 0 then
    if encode(extensions.digest(v_definition, 'sha256'), 'hex') not in (
      '24b5110399e01e134f999adbbd70dc2be9a1ec4043521f981de5e0aca750832c',
      'a979b0a5556e8a166e56d9e6a5b304f8deca0112be9bd33bb39b17b5d37fa77e'
    ) then
      raise exception 'Qoo10 enqueue full pre-image drifted'
        using errcode = '55000';
    end if;
    v_from := '        from sellerpilot_private.qoo10_listing_create_rollback_confirmations
          confirmation
        join sellerpilot_private.product_listings listing';
    v_to := '        from sellerpilot_private.qoo10_listing_create_rollback_confirmations
          confirmation
        left join sellerpilot_private.qoo10_listing_update_rejection_observations
          shipping_observation
          on shipping_observation.source_job_id = confirmation.source_job_id
         and shipping_observation.source_attempt_id = confirmation.source_attempt_id
         and shipping_observation.listing_id = confirmation.listing_id
         and shipping_observation.credential_id = confirmation.credential_id
         and shipping_observation.remote_id = confirmation.remote_id
         and shipping_observation.source_shipping_no = confirmation.shipping_no
         and shipping_observation.provider_status = ''S1''
         and not shipping_observation.provider_mutation_accepted
        join sellerpilot_private.product_listings listing';
    if pg_catalog.strpos(v_definition, v_from) = 0 then
      raise exception 'Qoo10 enqueue confirmation join drifted'
        using errcode = '55000';
    end if;
    v_patched := pg_catalog.replace(v_definition, v_from, v_to);
    v_from := '         and confirmation.shipping_no = v_expected_state->>''shippingNo''';
    v_to := '         and coalesce(
               shipping_observation.observed_shipping_no,
               confirmation.shipping_no
             ) = v_expected_state->>''shippingNo''';
    if pg_catalog.strpos(v_patched, v_from) = 0 then
      raise exception 'Qoo10 enqueue expected shipping drifted'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_patched, v_from, v_to);
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'qoo10_listing_update_rejection_observations') = 0 then
    if encode(extensions.digest(v_definition, 'sha256'), 'hex') not in (
      'fef7c389fff3e55dece5cf82d19399cb7062223e963a08a79eb3907faaf185d8',
      'ee1fb1a1a756eb8f168e7a56ee22d32df81911ccdff722d4e9c97b55dcc156d7'
    ) then
      raise exception 'Qoo10 completion full pre-image drifted'
        using errcode = '55000';
    end if;
    v_from := '    join sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
      on confirmation.listing_id = listing.id
     and confirmation.credential_id = job.credential_id
   where job.id = p_job_id';
    v_to := '    join sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
      on confirmation.listing_id = listing.id
     and confirmation.credential_id = job.credential_id
    left join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.provider_status = ''S1''
     and not shipping_observation.provider_mutation_accepted
   where job.id = p_job_id';
    if pg_catalog.strpos(v_definition, v_from) = 0 then
      raise exception 'Qoo10 completion confirmation join drifted'
        using errcode = '55000';
    end if;
    v_patched := pg_catalog.replace(v_definition, v_from, v_to);
    v_from := '''shippingNo'', confirmation.shipping_no';
    v_to := '''shippingNo'', coalesce(
                   shipping_observation.observed_shipping_no,
                   confirmation.shipping_no
                 )';
    if pg_catalog.strpos(v_patched, v_from) = 0 then
      raise exception 'Qoo10 completion expected shipping drifted'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_patched, v_from, v_to);
  end if;
end;
$qoo10_observed_shipping_contract_patch$;

-- A marker substring is not a sufficient idempotency signal. Re-read the
-- complete post-image so a partially hand-applied patch cannot silently pass.
do $qoo10_observed_shipping_contract_postimage$
declare
  v_definition text;
  v_reconstructed text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_definition;
  if sellerpilot_private.qoo10_definition_occurrences(
       v_definition,
       'sellerpilot_private.qoo10_listing_update_rejection_observations'
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'left join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.provider_status = ''S1''
     and not shipping_observation.provider_mutation_accepted
    join sellerpilot_private.product_listings listing'
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'coalesce(
           shipping_observation.observed_shipping_no,
           confirmation.shipping_no
         ) as shipping_no'
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          '         confirmation.shipping_no,
         confirmation.bi_contents_no'
        ) <> 0 then
    raise exception 'Qoo10 rollback identity partial post-image'
      using errcode = '55000';
  end if;
  v_reconstructed := pg_catalog.replace(
    v_definition,
    '         coalesce(
           shipping_observation.observed_shipping_no,
           confirmation.shipping_no
         ) as shipping_no,
         confirmation.bi_contents_no',
    '         confirmation.shipping_no,
         confirmation.bi_contents_no'
  );
  v_reconstructed := pg_catalog.replace(
    v_reconstructed,
    '    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    left join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.provider_status = ''S1''
     and not shipping_observation.provider_mutation_accepted
    join sellerpilot_private.product_listings listing',
    '    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.product_listings listing'
  );
  if encode(extensions.digest(v_reconstructed, 'sha256'), 'hex') not in (
    '1aadd3dcfb8d5afb1f7845ad7f06c80e3e977c803a1cc4ca178e2ea384c0be95',
    '008297d64da9fcbab6f3047a2a2d9c52bb0a0ac221c0ad47714b2da6ca894514'
  ) then
    raise exception 'Qoo10 rollback identity full post-image drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(jsonb,jsonb,text)'::regprocedure
  ) into v_definition;
  if sellerpilot_private.qoo10_definition_occurrences(
       v_definition,
       'sellerpilot_private.qoo10_listing_update_rejection_observations'
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'left join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.provider_status = ''S1''
     and not shipping_observation.provider_mutation_accepted
    join sellerpilot_private.channel_gateway_jobs update_job'
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          '''shippingNo'', coalesce(
                   shipping_observation.observed_shipping_no,
                   confirmation.shipping_no
                 )'
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          '''shippingNo'', confirmation.shipping_no'
        ) <> 0 then
    raise exception 'Qoo10 retry helper partial post-image'
      using errcode = '55000';
  end if;
  v_reconstructed := pg_catalog.replace(
    v_definition,
    '''shippingNo'', coalesce(
                   shipping_observation.observed_shipping_no,
                   confirmation.shipping_no
                 )',
    '''shippingNo'', confirmation.shipping_no'
  );
  v_reconstructed := pg_catalog.replace(
    v_reconstructed,
    '    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    left join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.provider_status = ''S1''
     and not shipping_observation.provider_mutation_accepted
    join sellerpilot_private.channel_gateway_jobs update_job',
    '    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.channel_gateway_jobs update_job'
  );
  if encode(extensions.digest(v_reconstructed, 'sha256'), 'hex') not in (
    'ce32110f56f5486e8bb60f60b443b7c5cb575c51fcef9207a529a560901ec89a',
    'c6a1c6c040c9b7185182c4d4d01ccd15cc4f3614f31bf46c2475eda7e8d3e7de'
  ) then
    raise exception 'Qoo10 retry helper full post-image drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if sellerpilot_private.qoo10_definition_occurrences(
       v_definition,
       'sellerpilot_private.qoo10_listing_update_rejection_observations'
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'left join sellerpilot_private.qoo10_listing_update_rejection_observations
          shipping_observation
          on shipping_observation.source_job_id = confirmation.source_job_id
         and shipping_observation.source_attempt_id = confirmation.source_attempt_id
         and shipping_observation.listing_id = confirmation.listing_id
         and shipping_observation.credential_id = confirmation.credential_id
         and shipping_observation.remote_id = confirmation.remote_id
         and shipping_observation.source_shipping_no = confirmation.shipping_no
         and shipping_observation.provider_status = ''S1''
         and not shipping_observation.provider_mutation_accepted
        join sellerpilot_private.product_listings listing'
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'coalesce(
               shipping_observation.observed_shipping_no,
               confirmation.shipping_no
             ) = v_expected_state->>''shippingNo'''
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'confirmation.shipping_no = v_expected_state->>''shippingNo'''
        ) <> 0 then
    raise exception 'Qoo10 enqueue partial post-image'
      using errcode = '55000';
  end if;
  v_reconstructed := pg_catalog.replace(
    v_definition,
    '         and coalesce(
               shipping_observation.observed_shipping_no,
               confirmation.shipping_no
             ) = v_expected_state->>''shippingNo''',
    '         and confirmation.shipping_no = v_expected_state->>''shippingNo'''
  );
  v_reconstructed := pg_catalog.replace(
    v_reconstructed,
    '        from sellerpilot_private.qoo10_listing_create_rollback_confirmations
          confirmation
        left join sellerpilot_private.qoo10_listing_update_rejection_observations
          shipping_observation
          on shipping_observation.source_job_id = confirmation.source_job_id
         and shipping_observation.source_attempt_id = confirmation.source_attempt_id
         and shipping_observation.listing_id = confirmation.listing_id
         and shipping_observation.credential_id = confirmation.credential_id
         and shipping_observation.remote_id = confirmation.remote_id
         and shipping_observation.source_shipping_no = confirmation.shipping_no
         and shipping_observation.provider_status = ''S1''
         and not shipping_observation.provider_mutation_accepted
        join sellerpilot_private.product_listings listing',
    '        from sellerpilot_private.qoo10_listing_create_rollback_confirmations
          confirmation
        join sellerpilot_private.product_listings listing'
  );
  if encode(extensions.digest(v_reconstructed, 'sha256'), 'hex') not in (
    '24b5110399e01e134f999adbbd70dc2be9a1ec4043521f981de5e0aca750832c',
    'a979b0a5556e8a166e56d9e6a5b304f8deca0112be9bd33bb39b17b5d37fa77e'
  ) then
    raise exception 'Qoo10 enqueue full post-image drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)'::regprocedure
  ) into v_definition;
  if sellerpilot_private.qoo10_definition_occurrences(
       v_definition,
       'sellerpilot_private.qoo10_listing_update_rejection_observations'
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'left join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.provider_status = ''S1''
     and not shipping_observation.provider_mutation_accepted
   where job.id = p_job_id'
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          '''shippingNo'', coalesce(
                   shipping_observation.observed_shipping_no,
                   confirmation.shipping_no
                 )'
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          '''shippingNo'', confirmation.shipping_no'
        ) <> 0 then
    raise exception 'Qoo10 completion partial post-image'
      using errcode = '55000';
  end if;
  v_reconstructed := pg_catalog.replace(
    v_definition,
    '''shippingNo'', coalesce(
                   shipping_observation.observed_shipping_no,
                   confirmation.shipping_no
                 )',
    '''shippingNo'', confirmation.shipping_no'
  );
  v_reconstructed := pg_catalog.replace(
    v_reconstructed,
    '    join sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
      on confirmation.listing_id = listing.id
     and confirmation.credential_id = job.credential_id
    left join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.provider_status = ''S1''
     and not shipping_observation.provider_mutation_accepted
   where job.id = p_job_id',
    '    join sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
      on confirmation.listing_id = listing.id
     and confirmation.credential_id = job.credential_id
   where job.id = p_job_id'
  );
  if encode(extensions.digest(v_reconstructed, 'sha256'), 'hex') not in (
    'fef7c389fff3e55dece5cf82d19399cb7062223e963a08a79eb3907faaf185d8',
    'ee1fb1a1a756eb8f168e7a56ee22d32df81911ccdff722d4e9c97b55dcc156d7'
  ) then
    raise exception 'Qoo10 completion full post-image drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_observed_shipping_contract_postimage$;

create or replace function
  sellerpilot_private.qoo10_exact_origin_rejection_audit_detail()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'qoo10_exact_origin_type_rejection_restore_v1',
    'update_job_id',
      '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'::uuid,
    'update_attempt_id',
      'dc9a6e45-e333-4a15-b432-c14a03734f9c'::uuid,
    'listing_id', '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid,
    'product_id', 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    'credential_id', '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid,
    'credential_fingerprint', '910B8E8633C1',
    'credential_source', 'credential_incarnation_v1',
    'credential_expires_at', '2027-08-20T14:59:59Z',
    'seller_account_verified_at', '2026-08-25T11:40:32.606508Z',
    'source_job_id', '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid,
    'source_attempt_id',
      '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid,
    'remote_id', '1217336970',
    'request_sha256',
      '49e5e2d5b528597324489de0fdea689170b8e19e12dba577a9935c7a9205a010',
    'response_sha256',
      '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f',
    'provider_rejection_code', '-99',
    'provider_rejection_reason', 'ProductionPlaceType_required',
    'previous_job_status', 'reconciliation_required',
    'new_job_status', 'succeeded',
    'previous_job_error',
      'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。',
    'previous_attempt_status', 'manual_required',
    'new_attempt_status', 'failed',
    'previous_attempt_http_status', 409,
    'new_attempt_http_status', 200,
    'previous_attempt_safe_message',
      'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。',
    'new_attempt_safe_message',
      'Qoo10 UpdateGoods 명시 거부 · provider acceptance 증거 없음 · S1 핵심 관측 유지 · 전체 mutable 비교 미확정',
    'previous_listing_status', 'failed',
    'new_listing_status', 'paused',
    'previous_failure_class', 'external_action',
    'new_failure_class', 'retryable',
    'previous_remote_visibility', 'unknown',
    'new_remote_visibility', 'non_public',
    'previous_provider_status', null,
    'new_provider_status', 'S1',
    'requested_origin_type', null,
    'observed_origin_type', '2',
    'observed_origin', 'CN',
    'provider_status', 'S1',
    'detail_image_count', 8,
    'source_shipping_no', '0',
    'observed_shipping_no', '806971',
    'shipping_contract_match', false,
    'provider_mutation_accepted', false,
    'provider_call_replayed', false,
    'raw_request_preserved', true,
    'raw_response_preserved', true,
    'completion_receipt_preserved', true,
    'retry_operation', 'listing.update'
  )
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_origin_rejection_audit_detail()
  from public, anon, authenticated, service_role;

create or replace function
  sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(
    p_old jsonb,
    p_new jsonb,
    p_update_job_id text
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fixed_error constant text :=
    'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요';
begin
  if p_update_job_id is distinct from
       '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'
     or jsonb_typeof(p_old) <> 'object'
     or jsonb_typeof(p_new) <> 'object' then
    return false;
  end if;

  perform 1
    from sellerpilot_private.channel_gateway_jobs update_job
    join sellerpilot_private.channel_operation_attempts update_attempt
      on update_attempt.id = update_job.attempt_id
    join sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
      on confirmation.source_job_id =
           '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid
    join sellerpilot_private.qoo10_listing_update_rejection_observations
      shipping_observation
      on shipping_observation.update_job_id = update_job.id
     and shipping_observation.update_attempt_id = update_attempt.id
     and shipping_observation.source_job_id = confirmation.source_job_id
     and shipping_observation.source_attempt_id = confirmation.source_attempt_id
     and shipping_observation.listing_id = confirmation.listing_id
     and shipping_observation.credential_id = confirmation.credential_id
     and shipping_observation.remote_id = confirmation.remote_id
     and shipping_observation.response_sha256 =
           '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f'
     and shipping_observation.provider_rejection_code = '-99'
     and shipping_observation.provider_rejection_reason =
           'ProductionPlaceType_required'
     and shipping_observation.source_shipping_no = confirmation.shipping_no
     and shipping_observation.observed_shipping_no = '806971'
     and shipping_observation.provider_status = 'S1'
     and shipping_observation.observed_origin_type = '2'
     and shipping_observation.observed_origin = 'CN'
     and shipping_observation.observed_retail_price_jpy = 1871
     and shipping_observation.observed_sell_price_jpy = 1871
     and shipping_observation.observed_quantity = 1
     and shipping_observation.observed_detail_image_count = 8
     and shipping_observation.observed_at =
           '2026-08-30 15:06:13.213314+00'::timestamptz
     and not shipping_observation.provider_mutation_accepted
    join sellerpilot_private.channel_gateway_jobs source_job
      on source_job.id = confirmation.source_job_id
    join sellerpilot_private.channel_operation_attempts source_attempt
      on source_attempt.id = confirmation.source_attempt_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = confirmation.credential_id
    join sellerpilot_private.operation_audit audit
      on audit.action = 'qoo10_exact_origin_rejection_reconciliation_resolved'
     and audit.entity_type = 'channel_gateway_job'
     and audit.entity_id = update_job.id::text
   where update_job.id =
           '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'::uuid
     and update_job.status = 'succeeded'
     and update_job.attempt_id =
           'dc9a6e45-e333-4a15-b432-c14a03734f9c'::uuid
     and update_job.listing_id =
           '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and update_job.credential_id =
           '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     and update_job.channel = 'qoo10'
     and update_job.operation = 'listing.update'
     and update_job.environment = 'production'
     and update_job.request_fingerprint =
           'a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff'
     and update_job.seller_account_key =
           '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     and encode(
           extensions.digest(update_job.request_payload::text, 'sha256'),
           'hex'
         ) = '49e5e2d5b528597324489de0fdea689170b8e19e12dba577a9935c7a9205a010'
     and encode(
           extensions.digest(update_job.response_payload::text, 'sha256'),
           'hex'
         ) = '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f'
     and update_job.error_message is null
     and update_attempt.id = update_job.attempt_id
     and update_attempt.owner_id = (p_old->>'owner_id')::uuid
     and update_attempt.credential_id = update_job.credential_id
     and update_attempt.channel = 'qoo10'
     and update_attempt.operation = 'listing.update'
     and update_attempt.status = 'failed'
     and update_attempt.http_status = 200
     and update_attempt.remote_id = '1217336970'
     and update_attempt.safe_message =
           'Qoo10 UpdateGoods 명시 거부 · provider acceptance 증거 없음 · S1 핵심 관측 유지 · 전체 mutable 비교 미확정'
     and update_attempt.gateway_write_required
     and not update_attempt.pre_gateway_retryable
     and update_attempt.request_fingerprint = update_job.request_fingerprint
     and update_attempt.seller_account_key = update_job.seller_account_key
     and confirmation.source_attempt_id =
           '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid
     and confirmation.listing_id = update_job.listing_id
     and confirmation.credential_id = update_job.credential_id
     and confirmation.remote_id = '1217336970'
     and confirmation.confirmed_at =
           '2026-08-30 14:51:26.505498+00'::timestamptz
     and source_job.id = confirmation.source_job_id
     and source_job.attempt_id = confirmation.source_attempt_id
     and source_job.listing_id = confirmation.listing_id
     and source_job.credential_id = confirmation.credential_id
     and source_job.channel = 'qoo10'
     and source_job.operation = 'listing.create'
     and source_job.environment = 'production'
     and source_job.status = 'failed'
     and source_job.request_fingerprint =
           '66759b5ea49910ae5b97d5f8311fce73f4f36f9ed37148692407e037563f1527'
     and source_job.seller_account_key = update_job.seller_account_key
     and source_attempt.id = source_job.attempt_id
     and source_attempt.credential_id = source_job.credential_id
     and source_attempt.channel = 'qoo10'
     and source_attempt.operation = 'listing.create'
     and source_attempt.status = 'failed'
     and source_attempt.remote_id = '1217336970'
     and credential.id = update_job.credential_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.expires_at =
           '2027-08-20 14:59:59+00'::timestamptz
     and credential.fingerprint = '910B8E8633C1'
     and credential.seller_account_key = update_job.seller_account_key
     and credential.seller_account_key_source =
           'credential_incarnation_v1'
     and credential.seller_account_verified_at =
           '2026-08-25 11:40:32.606508+00'::timestamptz
     and credential.created_at =
           '2026-08-20 08:35:56.238133+00'::timestamptz
     and audit.owner_id = (p_old->>'owner_id')::uuid
     and audit.safe_detail is not distinct from
           sellerpilot_private.qoo10_exact_origin_rejection_audit_detail()
     and (
       select count(*)
         from sellerpilot_private.operation_audit exact_audit
        where exact_audit.action =
                'qoo10_exact_origin_rejection_reconciliation_resolved'
          and exact_audit.entity_type = 'channel_gateway_job'
          and exact_audit.entity_id = update_job.id::text
          and exact_audit.owner_id = audit.owner_id
          and exact_audit.safe_detail is not distinct from
                sellerpilot_private.qoo10_exact_origin_rejection_audit_detail()
     ) = 1
     and (
       select count(*)
         from sellerpilot_private.operation_audit exact_audit
        where exact_audit.action =
                'qoo10_exact_origin_rejection_reconciliation_resolved'
          and exact_audit.entity_type = 'channel_gateway_job'
          and exact_audit.entity_id = update_job.id::text
     ) = 1
     and p_old->>'id' = update_job.listing_id::text
     and p_old->>'product_id' =
           'ddccde35-9c58-4856-b673-d7aa27ce4220'
     and p_old->>'channel_key' = 'qoo10'
     and p_old->>'operation_attempt_id' = update_attempt.id::text
     and p_old->>'status' = 'failed'
     and p_old->>'failure_class' = 'external_action'
     and p_old->>'requested_publication_intent' = 'live'
     and p_old->>'remote_visibility' = 'unknown'
     and p_old->'provider_status' = 'null'::jsonb
     and p_old->>'remote_id' = '1217336970'
     and p_old->>'seller_account_key' = update_job.seller_account_key
     and p_old->'published_at' = 'null'::jsonb
     and p_old->'last_verified_at' = 'null'::jsonb
     and p_old->>'last_error' =
           'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。'
     and (p_old->>'updated_at')::timestamptz =
           '2026-08-30 15:06:14.060943+00'::timestamptz
     and p_new->>'id' = p_old->>'id'
     and p_new->>'product_id' = p_old->>'product_id'
     and p_new->>'owner_id' = p_old->>'owner_id'
     and p_new->>'channel_key' = 'qoo10'
     and p_new->>'operation_attempt_id' = source_attempt.id::text
     and p_new->>'status' = 'paused'
     and p_new->>'failure_class' = 'retryable'
     and p_new->>'requested_publication_intent' = 'live'
     and p_new->>'remote_visibility' = 'non_public'
     and p_new->>'provider_status' = 'S1'
     and p_new->>'remote_id' = '1217336970'
     and p_new->>'seller_account_key' = update_job.seller_account_key
     and p_new->'published_at' = 'null'::jsonb
     and (p_new->>'last_verified_at')::timestamptz =
           confirmation.confirmed_at
     and p_new->>'last_error' = v_fixed_error
     and p_new - 'operation_attempt_id' - 'status' - 'failure_class'
           - 'remote_visibility' - 'provider_status' - 'published_at'
           - 'last_verified_at' - 'last_error' - 'updated_at'
       = p_old - 'operation_attempt_id' - 'status' - 'failure_class'
           - 'remote_visibility' - 'provider_status' - 'published_at'
           - 'last_verified_at' - 'last_error' - 'updated_at';

  return found;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(
    jsonb, jsonb, text
  ) from public, anon, authenticated, service_role;

-- Add an exact transaction-local branch ahead of the existing generic Qoo10
-- rollback branch. Merely setting the GUC cannot bypass the evidence helper.
do $qoo10_exact_origin_guard_patch$
declare
  v_definition text;
  v_before constant text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_rollback_retry_job'', true), '''') is not null then';
  v_after constant text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_origin_rejection_job'', true), '''') is not null then
    if not sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.qoo10_exact_origin_rejection_job'', true)
    ) then
      raise exception ''invalid exact Qoo10 origin-type rejection restore'';
    end if;
    return new;
  end if;

  if nullif(current_setting(''sellerpilot.qoo10_rollback_retry_job'', true), '''') is not null then';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.qoo10_exact_origin_rejection_job'
     ) = 0 then
    if encode(extensions.digest(v_definition, 'sha256'), 'hex') not in (
      '048567122d26ded29366169aeb7f6c06befba09186ac7f0ea67b124e2612a3ec',
      'bef08c5920cff7d787efb45057e1130d3fa382b6c7449146804012270aa5797a',
      '9ae7e66e5d616197e0d7e08d701ab97ff6138f9021f787e9e1f34b5fe6e5b9f4'
    ) then
      raise exception 'exact Qoo10 origin rejection guard full pre-image drifted'
        using errcode = '55000';
    end if;
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception
        'exact Qoo10 origin rejection guard entry not found'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if sellerpilot_private.qoo10_definition_occurrences(
       v_definition,
       v_after
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'sellerpilot.qoo10_exact_origin_rejection_job'
        ) <> 2
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed('
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'invalid exact Qoo10 origin-type rejection restore'
        ) <> 1 then
    raise exception 'exact Qoo10 origin rejection guard partial post-image'
      using errcode = '55000';
  end if;
  if encode(
       extensions.digest(
         pg_catalog.replace(v_definition, v_after, v_before),
         'sha256'
       ),
       'hex'
     ) not in (
       '048567122d26ded29366169aeb7f6c06befba09186ac7f0ea67b124e2612a3ec',
       'bef08c5920cff7d787efb45057e1130d3fa382b6c7449146804012270aa5797a',
       '9ae7e66e5d616197e0d7e08d701ab97ff6138f9021f787e9e1f34b5fe6e5b9f4'
     ) then
    raise exception 'exact Qoo10 origin rejection guard full post-image drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_exact_origin_guard_patch$;

-- The observation row is private to definer-owned recovery functions. Bind
-- table/function ownership, definer mode, locked search paths and grants so a
-- hosted owner/ACL drift cannot turn the 806971 lookup into permission-denied
-- behavior or expose the one-off evidence surface.
do $qoo10_origin_rejection_catalog_postimage$
declare
  v_table_owner oid;
  v_service_role oid;
  v_function_oid oid;
  v_signature text;
begin
  select table_class.relowner
    into strict v_table_owner
    from pg_catalog.pg_class table_class
   where table_class.oid =
     'sellerpilot_private.qoo10_listing_update_rejection_observations'::regclass;
  select role.oid
    into strict v_service_role
    from pg_catalog.pg_roles role
   where role.rolname = 'service_role';

  foreach v_signature in array array[
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)',
    'sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(jsonb,jsonb,text)',
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)',
    'public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)',
    'sellerpilot_private.guard_product_listing_seller_lineage()',
    'sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(jsonb,jsonb,text)'
  ] loop
    v_function_oid := v_signature::regprocedure::oid;
    if not exists (
         select 1
           from pg_catalog.pg_proc procedure
          where procedure.oid = v_function_oid
            and procedure.proowner = v_table_owner
            and procedure.prosecdef
            and cardinality(procedure.proconfig) = 1
            and procedure.proconfig[1] in (
              'search_path=', 'search_path=""'
            )
       ) then
      raise exception 'Qoo10 recovery function owner/definer post-image mismatch: %',
        v_signature using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'sellerpilot_private.qoo10_definition_occurrences(text,text)',
    'sellerpilot_private.qoo10_exact_origin_rejection_audit_detail()'
  ] loop
    v_function_oid := v_signature::regprocedure::oid;
    if not exists (
         select 1
           from pg_catalog.pg_proc procedure
          where procedure.oid = v_function_oid
            and procedure.proowner = v_table_owner
            and not procedure.prosecdef
            and cardinality(procedure.proconfig) = 1
            and procedure.proconfig[1] in (
              'search_path=', 'search_path=""'
            )
       ) then
      raise exception 'Qoo10 private pure helper post-image mismatch: %',
        v_signature using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)',
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)',
    'public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)'
  ] loop
    v_function_oid := v_signature::regprocedure::oid;
    if not pg_catalog.has_function_privilege(
             'service_role', v_function_oid, 'EXECUTE'
           )
       or exists (
         select 1
           from aclexplode(coalesce(
             (select procedure.proacl
                from pg_catalog.pg_proc procedure
               where procedure.oid = v_function_oid),
             acldefault('f', v_table_owner)
           )) acl
          where acl.grantee not in (v_table_owner, v_service_role)
       ) then
      raise exception 'Qoo10 public recovery RPC ACL post-image mismatch: %',
        v_signature using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(jsonb,jsonb,text)',
    'sellerpilot_private.guard_product_listing_seller_lineage()',
    'sellerpilot_private.qoo10_definition_occurrences(text,text)',
    'sellerpilot_private.qoo10_exact_origin_rejection_audit_detail()',
    'sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(jsonb,jsonb,text)'
  ] loop
    v_function_oid := v_signature::regprocedure::oid;
    if exists (
         select 1
           from aclexplode(coalesce(
             (select procedure.proacl
                from pg_catalog.pg_proc procedure
               where procedure.oid = v_function_oid),
             acldefault('f', v_table_owner)
           )) acl
          where acl.grantee <> v_table_owner
       ) then
      raise exception 'Qoo10 private recovery function ACL post-image mismatch: %',
        v_signature using errcode = '55000';
    end if;
  end loop;

  if (
       select count(*)
         from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid =
                'sellerpilot_private.product_listings'::regclass
          and trigger_row.tgname =
                'guard_product_listing_seller_lineage'
          and not trigger_row.tgisinternal
     ) <> 1
     or not exists (
       select 1
         from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid =
                'sellerpilot_private.product_listings'::regclass
          and trigger_row.tgname =
                'guard_product_listing_seller_lineage'
          and not trigger_row.tgisinternal
          and trigger_row.tgenabled = 'O'::"char"
          and trigger_row.tgtype = 19
          and trigger_row.tgnargs = 0
          and trigger_row.tgqual is null
          and trigger_row.tgfoid =
                'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
     ) then
    raise exception 'Qoo10 product listing lineage trigger post-image mismatch'
      using errcode = '55000';
  end if;
end;
$qoo10_origin_rejection_catalog_postimage$;

do $qoo10_exact_origin_reconcile$
declare
  v_update_job_id constant uuid :=
    '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'::uuid;
  v_update_attempt_id constant uuid :=
    'dc9a6e45-e333-4a15-b432-c14a03734f9c'::uuid;
  v_listing_id constant uuid :=
    '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_credential_id constant uuid :=
    '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid;
  v_source_job_id constant uuid :=
    '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid;
  v_source_attempt_id constant uuid :=
    '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid;
  v_remote_id constant text := '1217336970';
  v_seller_account_key constant text :=
    '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46';
  v_update_fingerprint constant text :=
    'a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff';
  v_source_fingerprint constant text :=
    '66759b5ea49910ae5b97d5f8311fce73f4f36f9ed37148692407e037563f1527';
  v_request_sha256 constant text :=
    '49e5e2d5b528597324489de0fdea689170b8e19e12dba577a9935c7a9205a010';
  v_response_sha256 constant text :=
    '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f';
  v_confirmed_at constant timestamptz :=
    '2026-08-30 14:51:26.505498+00'::timestamptz;
  v_fixed_error constant text :=
    'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요';
  v_fixed_attempt_message constant text :=
    'Qoo10 UpdateGoods 명시 거부 · provider acceptance 증거 없음 · S1 핵심 관측 유지 · 전체 mutable 비교 미확정';
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_confirmation
    sellerpilot_private.qoo10_listing_create_rollback_confirmations%rowtype;
  v_source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_product_before jsonb;
  v_receipts_before jsonb;
  v_receipts_after jsonb;
  v_receipt_count_before bigint;
  v_receipt_count_after bigint;
  v_audit_count bigint;
  v_item jsonb;
  v_checks jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  -- The target is absent in fresh/local databases. Install the private guard
  -- but do no data work there. Any present target must match every assertion.
  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = v_update_job_id
  ) then
    return;
  end if;

  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;
  lock table sellerpilot_private.channel_operation_attempts
    in share row exclusive mode;
  lock table sellerpilot_private.product_listings
    in share row exclusive mode;
  lock table sellerpilot_private.operation_audit
    in share row exclusive mode;
  lock table sellerpilot_private.gateway_completion_receipts
    in share row exclusive mode;
  lock table
    sellerpilot_private.qoo10_listing_update_rejection_observations
    in share row exclusive mode;

  select job.* into strict v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_update_job_id
   for update;
  select attempt.* into strict v_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_update_attempt_id
   for update;
  select listing.* into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_listing_id
   for update;
  select confirmation.* into strict v_confirmation
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
   where confirmation.source_job_id = v_source_job_id
   for update;
  select job.* into strict v_source_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_source_job_id
   for update;
  select attempt.* into strict v_source_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_source_attempt_id
   for update;
  select credential.* into strict v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_credential_id
   for update;
  select to_jsonb(product) into strict v_product_before
    from sellerpilot_private.products product
   where product.id = v_product_id
   for update;

  select count(*), coalesce(
           jsonb_agg(to_jsonb(receipt) order by receipt.job_id),
           '[]'::jsonb
         )
    into v_receipt_count_before, v_receipts_before
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = v_update_job_id;

  select count(*) into v_audit_count
    from sellerpilot_private.operation_audit audit
   where audit.action =
           'qoo10_exact_origin_rejection_reconciliation_resolved'
     and audit.entity_type = 'channel_gateway_job'
     and audit.entity_id = v_update_job_id::text;

  if v_receipt_count_before <> 1
     or not exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = v_update_job_id
          and receipt.claim_token =
                'a6a1fc7a-4b4b-460e-aba6-65599ed122e0'::uuid
          and receipt.worker_token_id =
                '97b5f43a-b526-4b2c-8cd3-4b30b51c2d6d'::uuid
          and receipt.completion_fingerprint =
                'f8a24ebcb159bbd27a1a08b7a38bd187e4ead47bc8f5e4f5f4d4f31d7aff1a89'
          and receipt.continuation_job_id is null
          and receipt.created_at =
                '2026-08-30 15:06:14.16154+00'::timestamptz
     ) then
    raise exception 'exact Qoo10 completion receipt mismatch'
      using errcode = '55000';
  end if;

  if v_job.id is distinct from v_update_job_id
     or v_job.attempt_id is distinct from v_update_attempt_id
     or v_job.listing_id is distinct from v_listing_id
     or v_job.credential_id is distinct from v_credential_id
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.update'
     or v_job.environment is distinct from 'production'
     or v_job.request_fingerprint is distinct from v_update_fingerprint
     or v_job.seller_account_key is distinct from v_seller_account_key
     or v_job.created_at is distinct from
          '2026-08-30 14:59:56.436937+00'::timestamptz
     or v_job.started_at is distinct from
          '2026-08-30 15:06:05.22258+00'::timestamptz
     or v_job.provider_mutation_started_at is distinct from
          '2026-08-30 15:06:06.574809+00'::timestamptz
     or v_job.completed_at is distinct from
          '2026-08-30 15:06:13.213314+00'::timestamptz
     or v_job.attempt_count is distinct from 1
     or v_job.worker_token_id is not null
     or v_job.claim_token is not null
     or v_job.lease_expires_at is not null
     or v_job.credential_refresh_in_flight
     or v_job.credential_refresh_fingerprint is not null
     or v_job.prepared_credential_id is not null
     or v_job.credential_refresh_prepared_at is not null
     or v_job.credential_refresh_recovery_vault_id is not null
     or v_job.credential_refresh_recovery_fingerprint is not null
     or v_job.credential_refresh_recovery_staged_at is not null
     or v_job.credential_refresh_started_at is not null
     or v_job.oauth_request_vault_id is not null
     or v_job.oauth_request_fingerprint is not null
     or v_job.oauth_source_credential_id is not null
     or v_job.oauth_exchange_completed
     or v_job.oauth_provider_call_started_at is not null
     or encode(extensions.digest(v_job.request_payload::text, 'sha256'), 'hex')
          is distinct from v_request_sha256
     or encode(extensions.digest(v_job.response_payload::text, 'sha256'), 'hex')
          is distinct from v_response_sha256 then
    raise exception 'exact Qoo10 update job evidence mismatch'
      using errcode = '55000';
  end if;

  if v_confirmation.source_attempt_id is distinct from v_source_attempt_id
     or v_confirmation.listing_id is distinct from v_listing_id
     or v_confirmation.credential_id is distinct from v_credential_id
     or v_confirmation.request_fingerprint is distinct from v_source_fingerprint
     or v_confirmation.credential_fingerprint is distinct from '910B8E8633C1'
     or v_confirmation.seller_account_key is distinct from v_seller_account_key
     or v_confirmation.remote_id is distinct from v_remote_id
     or v_confirmation.bi_contents_no is distinct from 8461402963
     or v_confirmation.category_code is distinct from '320000542'
     or v_confirmation.retail_price_jpy is distinct from 1871
     or v_confirmation.sell_price_jpy is distinct from 1871
     or v_confirmation.quantity is distinct from 1
     or v_confirmation.shipping_no is distinct from '0'
     or v_confirmation.observed_provider_status is distinct from 'S1'
     or v_confirmation.previous_job_status is distinct from 'reconciliation_required'
     or v_confirmation.new_job_status is distinct from 'failed'
     or v_confirmation.previous_attempt_status is distinct from 'manual_required'
     or v_confirmation.new_attempt_status is distinct from 'failed'
     or v_confirmation.previous_listing_status is distinct from 'failed'
     or v_confirmation.new_listing_status is distinct from 'paused'
     or v_confirmation.previous_failure_class is distinct from 'external_action'
     or v_confirmation.new_failure_class is distinct from 'retryable'
     or v_confirmation.previous_remote_visibility is distinct from 'unknown'
     or v_confirmation.new_remote_visibility is distinct from 'non_public'
     or v_confirmation.previous_provider_status is not null
     or v_confirmation.new_provider_status is distinct from 'S1'
     or v_confirmation.requested_publication_intent is distinct from 'live'
     or v_confirmation.confirmed_at is distinct from v_confirmed_at
     or v_source_job.attempt_id is distinct from v_source_attempt_id
     or v_source_job.listing_id is distinct from v_listing_id
     or v_source_job.credential_id is distinct from v_credential_id
     or v_source_job.channel is distinct from 'qoo10'
     or v_source_job.operation is distinct from 'listing.create'
     or v_source_job.environment is distinct from 'production'
     or v_source_job.status is distinct from 'failed'
     or v_source_job.error_message is distinct from
          'QOO10_LISTING_CREATE_ROLLBACK_CONFIRMED: provider status S1; continue only with listing.update.'
     or v_source_job.request_fingerprint is distinct from v_source_fingerprint
     or v_source_job.seller_account_key is distinct from v_seller_account_key
     or v_source_attempt.credential_id is distinct from v_credential_id
     or v_source_attempt.channel is distinct from 'qoo10'
     or v_source_attempt.operation is distinct from 'listing.create'
     or v_source_attempt.status is distinct from 'failed'
     or v_source_attempt.http_status is distinct from 409
     or v_source_attempt.remote_id is distinct from v_remote_id
     or v_source_attempt.safe_message is distinct from
          'Qoo10 신규 등록 롤백(S1)이 확인되어 기존 원격 상품으로 수정 재시도가 가능합니다.'
     or not v_source_attempt.gateway_write_required
     or v_source_attempt.pre_gateway_retryable
     or v_source_attempt.request_fingerprint is distinct from v_source_fingerprint
     or v_source_attempt.seller_account_key is distinct from
          v_seller_account_key
     or v_source_attempt.completed_at is distinct from v_confirmed_at
     or v_credential.channel is distinct from 'qoo10'
     or v_credential.environment is distinct from 'production'
     or v_credential.status is distinct from 'active'
     or v_credential.expires_at is distinct from
          '2027-08-20 14:59:59+00'::timestamptz
     or v_credential.fingerprint is distinct from '910B8E8633C1'
     or v_credential.seller_account_key is distinct from v_seller_account_key
     or v_credential.seller_account_key_source is distinct from
          'credential_incarnation_v1'
     or v_credential.seller_account_verified_at is distinct from
          '2026-08-25 11:40:32.606508+00'::timestamptz
     or v_credential.created_at is distinct from
          '2026-08-20 08:35:56.238133+00'::timestamptz then
    raise exception 'exact Qoo10 source confirmation lineage mismatch'
      using errcode = '55000';
  end if;

  if v_job.request_payload#>>'{arguments,params,ItemCode}'
       is distinct from v_remote_id
     or v_job.request_payload#>>'{arguments,params,SecondSubCat}'
          is distinct from
          '320000542'
     or v_job.request_payload#>>'{arguments,params,ProductionPlace}'
          is distinct from 'CN'
     or not (
       v_job.request_payload#>'{arguments,params,ProductionPlaceType}' is null
       or v_job.request_payload#>'{arguments,params,ProductionPlaceType}' =
            'null'::jsonb
     )
     or v_job.request_payload#>>'{arguments,params,ShippingNo}'
          is distinct from '0'
     or v_job.request_payload#>>'{arguments,publicationIntent}'
          is distinct from 'live'
     or v_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
          is distinct from
          v_update_fingerprint
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,sourceJobId}'
          is distinct from
          v_source_job_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,listingId}'
          is distinct from
          v_listing_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,remoteId}'
          is distinct from
          v_remote_id
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,categoryCode}'
          is distinct from
          '320000542'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,retailPriceJpy}'
          is distinct from
          '1871'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,sellPriceJpy}'
          is distinct from
          '1871'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,quantity}'
          is distinct from
          '1'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,shippingNo}'
          is distinct from
          '0'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,biContentsNo}'
          is distinct from
          '8461402963' then
    raise exception 'exact Qoo10 missing-origin-type request mismatch'
      using errcode = '55000';
  end if;

  if v_job.response_payload->'ok' is distinct from 'false'::jsonb
     or v_job.response_payload->>'channel' is distinct from 'qoo10'
     or v_job.response_payload->>'operation' is distinct from 'listing.update'
     or v_job.response_payload->>'remoteId' is distinct from v_remote_id
     or jsonb_typeof(v_job.response_payload->'steps') is distinct from 'array'
     or jsonb_array_length(v_job.response_payload->'steps') is distinct from 2
     or jsonb_typeof(v_job.response_payload#>'{steps,0}') is distinct from
          'object'
     or (
       select array_agg(step_key order by step_key)
         from jsonb_object_keys(
           v_job.response_payload#>'{steps,0}'
         ) step_key
     ) is distinct from array['data', 'name', 'ok', 'status']::text[]
     or lower(v_job.response_payload#>>'{steps,0,name}')
          is distinct from 'updategoods'
     or v_job.response_payload#>'{steps,0,ok}'
          is distinct from 'false'::jsonb
     or v_job.response_payload#>>'{steps,0,status}' is distinct from '200'
     or v_job.response_payload#>>'{steps,0,data,ResultCode}'
          is distinct from '-99'
     or v_job.response_payload#>>'{steps,0,data,ResultMsg}'
          is distinct from
          'ProductionPlaceTypeは必須です。'
     or (v_job.response_payload#>'{steps,0,data}') ? 'sellerpilotMutation'
     or (v_job.response_payload#>'{steps,0,data}')
          ? 'sellerpilotReconciliationRequired'
     or lower(v_job.response_payload#>>'{steps,1,name}') is distinct from
          'qoo10-rollback-update-rejection-s1-readback'
     or v_job.response_payload#>'{steps,1,ok}'
          is distinct from 'false'::jsonb
     or v_job.response_payload#>>'{steps,1,data,sellerpilotVerification}'
          is distinct from
          'QOO10_ROLLBACK_UPDATE_REJECTION_S1_UNVERIFIED'
     or v_job.response_payload#>>'{steps,1,data,sellerpilotMutableVerification}'
          is distinct from 'LISTING_MUTABLE_FIELDS_MISMATCH'
     or v_job.response_payload#>'{steps,1,data,sellerpilotMismatchPaths}'
          is distinct from '["Keyword"]'::jsonb
     or v_job.response_payload#>>'{steps,1,data,providerStatus}'
          is distinct from 'S1'
     or v_job.response_payload#>>'{steps,1,data,sellerpilotExpectedProviderStatus}'
          is distinct from
          'S1'
     or v_job.response_payload#>>'{steps,1,data,sellerpilotExactDetailImageCount}'
          is distinct from
          '8'
     or v_job.response_payload#>>'{steps,1,data,actualImageCount}'
          is distinct from '8'
     or v_job.response_payload#>'{steps,1,data,sellerpilotReconciliationRequired}'
          is distinct from
          'true'::jsonb then
    raise exception 'exact Qoo10 explicit rejection response mismatch'
      using errcode = '55000';
  end if;

  v_checks :=
    v_job.response_payload#>'{steps,1,data,sellerpilotPublicationChecks}';
  if jsonb_typeof(v_checks) is distinct from 'object'
     or not (v_checks @> jsonb_build_object(
       'titleVerified', true,
       'localeVerified', true,
       'statusVerified', true,
       'categoryVerified', true,
       'identityVerified', true,
       'quantityVerified', true,
       'imageCountVerified', true,
       'sellerCodeVerified', true,
       'fingerprintVerified', true,
       'detailImageUrlsVerified', true,
       'detailImageDigestVerified', true,
       'confirmedBiCdnImageVerified', true,
       'recoveryExpectationVerified', true,
       'representativeImageVerified', true,
       'sellerAccountIdentityVerified', true,
       'shippingVerified', false,
       'sellPriceVerified', false,
       'retailPriceVerified', false,
       'priceQuantityVerified', false
     )) then
    raise exception 'exact Qoo10 S1 readback check set mismatch'
      using errcode = '55000';
  end if;

  v_item := v_job.response_payload#>'{steps,1,data,ResultObject}';
  if jsonb_typeof(v_item) is distinct from 'array'
     or jsonb_array_length(v_item) is distinct from 1
     or jsonb_typeof(v_item->0) is distinct from 'object' then
    raise exception 'exact Qoo10 S1 ResultObject shape mismatch'
      using errcode = '55000';
  end if;
  v_item := v_item->0;
  if coalesce(
          v_item->>'ItemNo', v_item->>'ItemCode', v_item->>'GdNo'
        ) is distinct from v_remote_id
     or coalesce(v_item->>'ItemStatus', v_item->>'Status')
          is distinct from 'S1'
     or v_item->>'ProductionPlaceType' is distinct from '2'
     or v_item->>'ProductionPlace' is distinct from 'CN'
     or coalesce(v_item->>'ItemPrice', v_item->>'SellPrice')::numeric
          is distinct from 1871::numeric
     or (v_item->>'RetailPrice')::numeric is distinct from 1871::numeric
     or (v_item->>'ItemQty')::numeric is distinct from 1::numeric
     or v_item->>'ShippingNo' is distinct from '806971' then
    raise exception 'exact Qoo10 unchanged S1 item readback mismatch'
      using errcode = '55000';
  end if;

  -- A second application is allowed only after every exact final state and
  -- audit fact already exists. Partial terminal state fails closed.
  if v_job.status = 'succeeded' then
    if v_job.error_message is not null
       or v_attempt.status is distinct from 'failed'
       or v_attempt.http_status is distinct from 200
       or v_attempt.remote_id is distinct from v_remote_id
       or v_attempt.safe_message is distinct from v_fixed_attempt_message
       or v_listing.product_id is distinct from v_product_id
       or v_listing.channel_key is distinct from 'qoo10'
       or v_listing.remote_id is distinct from v_remote_id
       or v_listing.seller_account_key is distinct from v_seller_account_key
       or not (
         (
           v_listing.operation_attempt_id is not distinct from
             v_source_attempt_id
           and v_listing.status is not distinct from 'paused'
           and v_listing.failure_class is not distinct from 'retryable'
           and v_listing.requested_publication_intent is not distinct from
             'live'
           and v_listing.remote_visibility is not distinct from 'non_public'
           and v_listing.provider_status is not distinct from 'S1'
           and v_listing.published_at is null
           and v_listing.last_verified_at is not distinct from v_confirmed_at
           and v_listing.last_error is not distinct from v_fixed_error
         )
         or exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs later_retry
            where later_retry.id <> v_update_job_id
              and later_retry.listing_id = v_listing_id
              and later_retry.credential_id = v_credential_id
              and later_retry.attempt_id = v_listing.operation_attempt_id
              and later_retry.channel = 'qoo10'
              and later_retry.operation = 'listing.update'
              and later_retry.environment = 'production'
              and later_retry.seller_account_key = v_seller_account_key
              and later_retry.created_at > v_job.created_at
         )
       )
       or v_audit_count <> 1
       or not exists (
         select 1
           from sellerpilot_private.operation_audit audit
          where audit.action =
                  'qoo10_exact_origin_rejection_reconciliation_resolved'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_update_job_id::text
            and audit.owner_id = v_listing.owner_id
            and audit.safe_detail is not distinct from
                  sellerpilot_private.qoo10_exact_origin_rejection_audit_detail()
       )
       or not exists (
         select 1
           from sellerpilot_private.qoo10_listing_update_rejection_observations
             observation
          where observation.update_job_id = v_update_job_id
            and observation.update_attempt_id = v_update_attempt_id
            and observation.source_job_id = v_source_job_id
            and observation.source_attempt_id = v_source_attempt_id
            and observation.listing_id = v_listing_id
            and observation.credential_id = v_credential_id
            and observation.remote_id = v_remote_id
            and observation.response_sha256 = v_response_sha256
            and observation.provider_rejection_code = '-99'
            and observation.provider_rejection_reason =
                  'ProductionPlaceType_required'
            and observation.provider_status = 'S1'
            and observation.observed_origin_type = '2'
            and observation.observed_origin = 'CN'
            and observation.observed_retail_price_jpy = 1871
            and observation.observed_sell_price_jpy = 1871
            and observation.observed_quantity = 1
            and observation.source_shipping_no = '0'
            and observation.observed_shipping_no = '806971'
            and observation.observed_detail_image_count = 8
            and not observation.provider_mutation_accepted
            and observation.observed_at = v_job.completed_at
       ) then
      raise exception 'partial exact Qoo10 reconciliation state detected'
        using errcode = '55000';
    end if;
    return;
  end if;

  if not exists (
    select 1
      from sellerpilot_private.listing_mutation_release_gate gate
     where gate.singleton
       and not gate.is_open
       and gate.opened_at is null
  ) then
    raise exception 'exact Qoo10 reconciliation requires a closed listing gate'
      using errcode = '55000';
  end if;

  -- This exact listing had exactly these three mutation ledger rows before
  -- reconciliation. Older terminal history for other listings/channels is
  -- unrelated, while fixing this listing's complete ID set (not merely
  -- created_at > the target) closes same-timestamp and backdated duplicates.
  if (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs listing_job
        where listing_job.operation in (
          'listing.create', 'listing.update', 'listing.stop'
        )
          and listing_job.listing_id = v_listing_id
     ) <> 3
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs listing_job
        where listing_job.operation in (
          'listing.create', 'listing.update', 'listing.stop'
        )
          and listing_job.listing_id = v_listing_id
          and listing_job.id not in (
            '2b6258c8-f1fd-4dc2-baed-b0019dd66112'::uuid,
            v_source_job_id,
            v_update_job_id
          )
     )
     or not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs legacy_create
        where legacy_create.id =
                '2b6258c8-f1fd-4dc2-baed-b0019dd66112'::uuid
          and legacy_create.operation = 'listing.create'
          and legacy_create.status = 'failed'
          and legacy_create.created_at is not distinct from
                '2026-08-30 11:23:25.017463+00'::timestamptz
     )
     or not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs source_create
        where source_create.id = v_source_job_id
          and source_create.operation = 'listing.create'
          and source_create.status = 'failed'
          and source_create.created_at is not distinct from
                '2026-08-30 12:56:53.380373+00'::timestamptz
     )
     or not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs exact_update
        where exact_update.id = v_update_job_id
          and exact_update.operation = 'listing.update'
          and exact_update.created_at is not distinct from
                '2026-08-30 14:59:56.436937+00'::timestamptz
     ) then
    raise exception 'exact production listing mutation ledger mismatch'
      using errcode = '55000';
  end if;

  if (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.operation in (
          'listing.create', 'listing.update', 'listing.stop'
        )
          and active_job.status in (
            'queued', 'running', 'reconciliation_required'
          )
     ) <> 1
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.operation in (
          'listing.create', 'listing.update', 'listing.stop'
        )
          and active_job.status in (
            'queued', 'running', 'reconciliation_required'
          )
          and active_job.id <> v_update_job_id
     ) then
    raise exception 'exact active listing mutation set mismatch'
      using errcode = '55000';
  end if;

  if v_job.status is distinct from 'reconciliation_required'
     or v_job.error_message is distinct from
          'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。'
     or v_job.updated_at is distinct from
          '2026-08-30 15:06:13.213314+00'::timestamptz
     or v_attempt.id is distinct from v_update_attempt_id
     or v_attempt.owner_id is distinct from v_listing.owner_id
     or v_attempt.credential_id is distinct from v_credential_id
     or v_attempt.channel is distinct from 'qoo10'
     or v_attempt.operation is distinct from 'listing.update'
     or v_attempt.status is distinct from 'manual_required'
     or v_attempt.http_status is distinct from 409
     or v_attempt.remote_id is distinct from v_remote_id
     or v_attempt.safe_message is distinct from
          'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。'
     or v_attempt.started_at is distinct from
          '2026-08-30 14:59:48.089764+00'::timestamptz
     or v_attempt.completed_at is distinct from
          '2026-08-30 15:06:13.213314+00'::timestamptz
     or not v_attempt.gateway_write_required
     or v_attempt.pre_gateway_retryable
     or v_attempt.request_fingerprint is distinct from v_update_fingerprint
     or v_attempt.seller_account_key is distinct from v_seller_account_key
     or v_listing.product_id is distinct from v_product_id
     or v_listing.operation_attempt_id is distinct from v_update_attempt_id
     or v_listing.channel_key is distinct from 'qoo10'
     or v_listing.status is distinct from 'failed'
     or v_listing.failure_class is distinct from 'external_action'
     or v_listing.requested_publication_intent is distinct from 'live'
     or v_listing.remote_visibility is distinct from 'unknown'
     or v_listing.provider_status is not null
     or v_listing.remote_id is distinct from v_remote_id
     or v_listing.seller_account_key is distinct from v_seller_account_key
     or v_listing.published_at is not null
     or v_listing.last_verified_at is not null
     or v_listing.last_error is distinct from
          'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。'
     or v_listing.updated_at is distinct from
          '2026-08-30 15:06:14.060943+00'::timestamptz
     or v_audit_count <> 0
     or exists (
       select 1
         from sellerpilot_private.qoo10_listing_update_rejection_observations
           observation
        where observation.update_job_id = v_update_job_id
           or observation.update_attempt_id = v_update_attempt_id
           or observation.listing_id = v_listing_id
     ) then
    raise exception 'exact Qoo10 unresolved state mismatch'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'succeeded',
         error_message = null,
         updated_at = clock_timestamp()
   where job.id = v_update_job_id
     and job.status = 'reconciliation_required'
     and job.attempt_id = v_update_attempt_id
     and job.listing_id = v_listing_id
     and job.error_message =
           'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。'
     and job.updated_at =
           '2026-08-30 15:06:13.213314+00'::timestamptz
     and job.attempt_count = 1
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and not job.credential_refresh_in_flight
     and job.credential_refresh_fingerprint is null
     and job.prepared_credential_id is null
     and job.credential_refresh_prepared_at is null
     and job.credential_refresh_recovery_vault_id is null
     and job.credential_refresh_recovery_fingerprint is null
     and job.credential_refresh_recovery_staged_at is null
     and job.credential_refresh_started_at is null
     and job.oauth_request_vault_id is null
     and job.oauth_request_fingerprint is null
     and job.oauth_source_credential_id is null
     and not job.oauth_exchange_completed
     and job.oauth_provider_call_started_at is null
     and job.response_payload = v_job.response_payload
     and job.request_payload = v_job.request_payload
     and job.provider_mutation_started_at = v_job.provider_mutation_started_at
     and job.completed_at = v_job.completed_at;
  if not found then
    raise exception 'exact Qoo10 job compare-and-set lost its fence'
      using errcode = '40001';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'failed',
         http_status = 200,
         remote_id = v_remote_id,
         safe_message = v_fixed_attempt_message
   where attempt.id = v_update_attempt_id
     and attempt.status = 'manual_required'
     and attempt.credential_id = v_credential_id
     and attempt.http_status = 409
     and attempt.remote_id = v_remote_id
     and attempt.safe_message =
           'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。'
     and attempt.started_at =
           '2026-08-30 14:59:48.089764+00'::timestamptz
     and attempt.completed_at =
           '2026-08-30 15:06:13.213314+00'::timestamptz
     and attempt.gateway_write_required
     and not attempt.pre_gateway_retryable
     and attempt.request_fingerprint = v_update_fingerprint
     and attempt.seller_account_key = v_seller_account_key;
  if not found then
    raise exception 'exact Qoo10 attempt compare-and-set lost its fence'
      using errcode = '40001';
  end if;

  insert into
    sellerpilot_private.qoo10_listing_update_rejection_observations (
      update_job_id,
      update_attempt_id,
      source_job_id,
      source_attempt_id,
      listing_id,
      credential_id,
      remote_id,
      response_sha256,
      provider_rejection_code,
      provider_rejection_reason,
      provider_status,
      observed_origin_type,
      observed_origin,
      observed_retail_price_jpy,
      observed_sell_price_jpy,
      observed_quantity,
      source_shipping_no,
      observed_shipping_no,
      observed_detail_image_count,
      provider_mutation_accepted,
      observed_at
    ) values (
      v_update_job_id,
      v_update_attempt_id,
      v_source_job_id,
      v_source_attempt_id,
      v_listing_id,
      v_credential_id,
      v_remote_id,
      v_response_sha256,
      '-99',
      'ProductionPlaceType_required',
      'S1',
      '2',
      'CN',
      1871,
      1871,
      1,
      '0',
      '806971',
      8,
      false,
      v_job.completed_at
    );

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id,
    'qoo10_exact_origin_rejection_reconciliation_resolved',
    'channel_gateway_job',
    v_update_job_id::text,
    sellerpilot_private.qoo10_exact_origin_rejection_audit_detail()
  );

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_exact_origin_rejection_job',
    v_update_job_id::text,
    true
  );
  update sellerpilot_private.product_listings listing
     set operation_attempt_id = v_source_attempt_id,
         status = 'paused',
         failure_class = 'retryable',
         remote_visibility = 'non_public',
         provider_status = 'S1',
         published_at = null,
         last_verified_at = v_confirmed_at,
         last_error = v_fixed_error,
         updated_at = clock_timestamp()
   where listing.id = v_listing_id
     and listing.product_id = v_product_id
     and listing.operation_attempt_id = v_update_attempt_id
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.remote_id = v_remote_id
     and listing.seller_account_key = v_seller_account_key
     and listing.published_at is null
     and listing.last_verified_at is null
     and listing.last_error =
           'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。'
     and listing.updated_at =
           '2026-08-30 15:06:14.060943+00'::timestamptz;
  if not found then
    raise exception 'exact Qoo10 listing compare-and-set lost its fence'
      using errcode = '40001';
  end if;

  select count(*), coalesce(
           jsonb_agg(to_jsonb(receipt) order by receipt.job_id),
           '[]'::jsonb
         )
    into v_receipt_count_after, v_receipts_after
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = v_update_job_id;

  if v_receipt_count_after <> v_receipt_count_before
     or v_receipts_after is distinct from v_receipts_before
     or not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = v_update_job_id
          and job.status = 'succeeded'
          and job.error_message is null
          and job.request_payload = v_job.request_payload
          and job.response_payload = v_job.response_payload
          and job.provider_mutation_started_at = v_job.provider_mutation_started_at
          and job.completed_at = v_job.completed_at
          and job.worker_token_id is not distinct from v_job.worker_token_id
          and job.claim_token is not distinct from v_job.claim_token
          and job.lease_expires_at is not distinct from v_job.lease_expires_at
          and job.credential_refresh_in_flight is not distinct from
                v_job.credential_refresh_in_flight
          and job.credential_refresh_fingerprint is not distinct from
                v_job.credential_refresh_fingerprint
          and job.prepared_credential_id is not distinct from
                v_job.prepared_credential_id
          and job.credential_refresh_prepared_at is not distinct from
                v_job.credential_refresh_prepared_at
          and job.credential_refresh_recovery_vault_id is not distinct from
                v_job.credential_refresh_recovery_vault_id
          and job.credential_refresh_recovery_fingerprint is not distinct from
                v_job.credential_refresh_recovery_fingerprint
          and job.credential_refresh_recovery_staged_at is not distinct from
                v_job.credential_refresh_recovery_staged_at
          and job.credential_refresh_started_at is not distinct from
                v_job.credential_refresh_started_at
          and job.oauth_request_vault_id is not distinct from
                v_job.oauth_request_vault_id
          and job.oauth_request_fingerprint is not distinct from
                v_job.oauth_request_fingerprint
          and job.oauth_source_credential_id is not distinct from
                v_job.oauth_source_credential_id
          and job.oauth_exchange_completed is not distinct from
                v_job.oauth_exchange_completed
          and job.oauth_provider_call_started_at is not distinct from
                v_job.oauth_provider_call_started_at
          and job.attempt_count = v_job.attempt_count
     )
     or (select to_jsonb(product)
           from sellerpilot_private.products product
          where product.id = v_product_id) is distinct from v_product_before
     or (select count(*)
           from sellerpilot_private.operation_audit audit
          where audit.action =
                  'qoo10_exact_origin_rejection_reconciliation_resolved'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_update_job_id::text
            and audit.owner_id = v_listing.owner_id
            and audit.safe_detail is not distinct from
                  sellerpilot_private.qoo10_exact_origin_rejection_audit_detail()) <> 1
     or (select count(*)
           from sellerpilot_private.operation_audit audit
          where audit.action =
                  'qoo10_exact_origin_rejection_reconciliation_resolved'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_update_job_id::text) <> 1
     or (select count(*)
           from sellerpilot_private.qoo10_listing_update_rejection_observations
             observation
          where observation.update_job_id = v_update_job_id
            and observation.update_attempt_id = v_update_attempt_id
            and observation.source_job_id = v_source_job_id
            and observation.source_attempt_id = v_source_attempt_id
            and observation.listing_id = v_listing_id
            and observation.credential_id = v_credential_id
            and observation.remote_id = v_remote_id
            and observation.response_sha256 = v_response_sha256
            and observation.provider_rejection_code = '-99'
            and observation.provider_rejection_reason =
                  'ProductionPlaceType_required'
            and observation.provider_status = 'S1'
            and observation.observed_origin_type = '2'
            and observation.observed_origin = 'CN'
            and observation.observed_retail_price_jpy = 1871
            and observation.observed_sell_price_jpy = 1871
            and observation.observed_quantity = 1
            and observation.source_shipping_no = '0'
            and observation.observed_shipping_no = '806971'
            and observation.observed_detail_image_count = 8
            and not observation.provider_mutation_accepted
            and observation.observed_at = v_job.completed_at) <> 1 then
    raise exception 'exact Qoo10 evidence preservation postcondition failed'
      using errcode = '55000';
  end if;
end;
$qoo10_exact_origin_reconcile$;

commit;
