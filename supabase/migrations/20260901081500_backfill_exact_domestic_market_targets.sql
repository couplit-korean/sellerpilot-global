-- Canonicalize the market identity for the two already-existing domestic QA
-- listings. This is deliberately a one-off tuple repair: it does not create a
-- listing, change the release gate, arm a permit, or infer seller lineage.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 908150001);

-- The two legacy listing.create attempts predate seller-account lineage. Their
-- listings were subsequently bound from exact successful provider readbacks,
-- but the terminal attempts themselves remained NULL. Keep the normal trigger
-- enabled and allow only a fully re-proved, seller_account_key-only repair for
-- these two immutable ledgers. The transaction marker alone is not a bypass.
create or replace function sellerpilot_private.guard_attempt_seller_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_credential_key text;
  v_verified_legacy_key text;
begin
  if tg_op = 'UPDATE' then
    if old.seller_account_key is null
       and new.seller_account_key is not null
       and new.seller_account_key is distinct from old.seller_account_key
       and current_setting(
         'sellerpilot.exact_domestic_attempt_lineage_backfill', true
       ) = 'verified-v1' then
    if (to_jsonb(new) - 'seller_account_key')
       is distinct from (to_jsonb(old) - 'seller_account_key') then
      raise exception 'exact domestic attempt lineage backfill may only bind seller account key';
    end if;

    select credential.seller_account_key
      into v_verified_legacy_key
      from sellerpilot_private.channel_operation_attempts attempt
      join sellerpilot_private.product_listings listing
        on listing.operation_attempt_id = attempt.id
       and listing.owner_id = attempt.owner_id
       and listing.channel_key = attempt.channel
      join sellerpilot_private.products product
        on product.id = listing.product_id
       and product.owner_id = listing.owner_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = attempt.credential_id
       and credential.channel = attempt.channel
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = case attempt.id
          when '8f285511-3a86-401e-8f91-1ab9715d311e'::uuid
            then '5ad52ae1-abfc-4133-a8ed-3c9c8e528559'::uuid
          when '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
            then 'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid
          else null
        end
       and job.attempt_id = attempt.id
       and job.credential_id = attempt.credential_id
       and job.channel = attempt.channel
       and job.environment = credential.environment
     where attempt.id = old.id
       and attempt.seller_account_key is null
       and attempt.owner_id =
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and attempt.operation = 'listing.create'
       and attempt.status = 'succeeded'
       and attempt.request_fingerprint ~ '^[a-f0-9]{64}$'
       and nullif(trim(attempt.remote_id), '') = trim(listing.remote_id)
       and product.id =
           'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and product.sku = 'QA-20260823-CC-001'
       and product.on_hand = 1
       and not product.demo
       and product.status = 'draft'
       and listing.seller_account_key is not null
       and listing.seller_account_key = credential.seller_account_key
       and listing.currency = 'KRW'
       and listing.price = 5000
       and listing.status = 'failed'
       and listing.failure_class = 'external_action'
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'unknown'
       and listing.provider_status is null
       and listing.published_at is null
       and (
         (listing.market = '' and listing.target_id = '')
         or
         (listing.market = 'KR' and listing.target_id = 'KR')
       )
       and credential.environment = 'production'
       and credential.status = 'active'
       and credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and credential.seller_account_key_source =
           'credential_incarnation_v1'
       and credential.seller_account_verified_at is not null
       and credential.last_check_status = 'passed'
       and credential.last_checked_at is not null
       and (
         credential.expires_at is null
         or credential.expires_at > statement_timestamp()
       )
       and job.listing_id is null
       and job.operation = 'listing.create'
       and job.status = 'succeeded'
       and job.seller_account_key is null
       and (
         job.request_fingerprint is null
         or job.request_fingerprint = attempt.request_fingerprint
       )
       and nullif(trim(job.response_payload->>'remoteId'), '') =
           trim(listing.remote_id)
       and sellerpilot_private.gateway_listing_create_readback_verified(
         listing.channel_key,
         job.response_payload
       )
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs other_job
          where other_job.id <> job.id
            and other_job.operation = 'listing.create'
            and other_job.status = 'succeeded'
            and (
              other_job.attempt_id = attempt.id
              or other_job.listing_id = listing.id
            )
       )
       and (
         (
           attempt.id = '8f285511-3a86-401e-8f91-1ab9715d311e'::uuid
           and attempt.credential_id =
               '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
           and attempt.channel = 'coupang'
           and listing.id =
               '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
           and listing.remote_id = '16356981734'
           and listing.marketplace_sku is null
           and credential.version > 0
           and credential.fingerprint ~ '^[A-F0-9]{12}$'
         )
         or
         (
           attempt.id = '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
           and attempt.credential_id =
               'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
           and attempt.channel = 'elevenst'
           and listing.id =
               '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
           and listing.remote_id = '9573255804'
           and listing.marketplace_sku is null
           and credential.created_by = listing.owner_id
           and credential.version = 2
           and credential.fingerprint ~ '^[A-F0-9]{12}$'
         )
       );

    if not found
       or v_verified_legacy_key is null
       or new.seller_account_key is distinct from v_verified_legacy_key then
      raise exception 'verified exact domestic attempt lineage evidence required';
    end if;
      return new;
    end if;
  end if;

  select credential.seller_account_key
    into v_credential_key
    from sellerpilot_private.channel_credentials credential
   where credential.id = new.credential_id
     and credential.channel = new.channel;
  if not found then raise exception 'attempt credential lineage unavailable'; end if;

  if tg_op = 'INSERT' then
    if new.seller_account_key is not null
       and new.seller_account_key is distinct from v_credential_key then
      raise exception 'attempt seller lineage mismatch';
    end if;
    new.seller_account_key := v_credential_key;
    return new;
  end if;

  if old.seller_account_key is not null
     and new.seller_account_key is distinct from old.seller_account_key then
    raise exception 'attempt seller lineage is immutable';
  end if;

  if new.credential_id is distinct from old.credential_id then
    if old.operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update',
      'shipment.acknowledge', 'shipment.confirm'
    ) and (
      old.seller_account_key is null
      or v_credential_key is null
      or old.seller_account_key is distinct from v_credential_key
    ) then
      raise exception 'attempt seller account mismatch';
    end if;
    if old.seller_account_key is not null
       and old.seller_account_key is distinct from v_credential_key then
      raise exception 'attempt seller account mismatch';
    end if;
    new.seller_account_key := coalesce(
      old.seller_account_key,
      v_credential_key
    );
  elsif new.seller_account_key is distinct from old.seller_account_key then
    if old.seller_account_key is not null
       or old.status <> 'running'
       or new.seller_account_key is distinct from v_credential_key then
      raise exception 'attempt seller lineage is immutable';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function sellerpilot_private.guard_attempt_seller_lineage()
  from public, anon, authenticated, service_role;

do $exact_domestic_market_target_backfill$
declare
  v_owner_id constant uuid :=
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_coupang_listing_id constant uuid :=
    '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid;
  v_elevenst_listing_id constant uuid :=
    '363f3b81-f364-4f22-af4e-4920199904d0'::uuid;
  v_coupang_attempt_id constant uuid :=
    '8f285511-3a86-401e-8f91-1ab9715d311e'::uuid;
  v_elevenst_attempt_id constant uuid :=
    '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid;
  v_coupang_credential_id constant uuid :=
    '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid;
  v_elevenst_credential_id constant uuid :=
    'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid;
  v_coupang_job_id constant uuid :=
    '5ad52ae1-abfc-4133-a8ed-3c9c8e528559'::uuid;
  v_elevenst_job_id constant uuid :=
    'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid;
  v_present_listings integer;
  v_product sellerpilot_private.products%rowtype;
  v_coupang_listing sellerpilot_private.product_listings%rowtype;
  v_elevenst_listing sellerpilot_private.product_listings%rowtype;
  v_coupang_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_elevenst_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_coupang_credential sellerpilot_private.channel_credentials%rowtype;
  v_elevenst_credential sellerpilot_private.channel_credentials%rowtype;
  v_coupang_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_elevenst_job sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  -- A clean replay has neither production row and must not manufacture QA
  -- data. A partial tuple is unsafe and aborts the transaction.
  select count(*)::integer
    into v_present_listings
    from sellerpilot_private.product_listings listing
   where listing.id in (v_coupang_listing_id, v_elevenst_listing_id);

  if v_present_listings = 0 then
    if exists (
      select 1
        from sellerpilot_private.products product
       where product.id = v_product_id
    ) or exists (
      select 1
        from sellerpilot_private.channel_credentials credential
       where credential.id in (
         v_coupang_credential_id,
         v_elevenst_credential_id
       )
    ) or exists (
      select 1
        from sellerpilot_private.channel_operation_attempts attempt
       where attempt.id in (v_coupang_attempt_id, v_elevenst_attempt_id)
    ) or exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs job
       where job.id in (v_coupang_job_id, v_elevenst_job_id)
    ) then
      raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_INCOMPLETE'
        using errcode = '55000';
    end if;
    return;
  end if;
  if v_present_listings <> 2 then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_INCOMPLETE'
      using errcode = '55000';
  end if;

  select product.*
    into v_product
    from sellerpilot_private.products product
   where product.id = v_product_id
   for update;
  if not found then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH'
      using errcode = '55000';
  end if;

  select listing.*
    into v_coupang_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_coupang_listing_id
   for update;
  if not found then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_INCOMPLETE'
      using errcode = '55000';
  end if;

  select listing.*
    into v_elevenst_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_elevenst_listing_id
   for update;
  if not found then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_INCOMPLETE'
      using errcode = '55000';
  end if;

  select credential.*
    into v_coupang_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_coupang_credential_id
   for update;
  if not found then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH'
      using errcode = '55000';
  end if;

  select credential.*
    into v_elevenst_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_elevenst_credential_id
   for update;
  if not found then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH'
      using errcode = '55000';
  end if;

  select attempt.*
    into v_coupang_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_coupang_attempt_id
   for update;
  if not found then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH'
      using errcode = '55000';
  end if;

  select attempt.*
    into v_elevenst_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_elevenst_attempt_id
   for update;
  if not found then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH'
      using errcode = '55000';
  end if;

  select job.*
    into v_coupang_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_coupang_job_id
   for update;
  if not found then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH'
      using errcode = '55000';
  end if;

  select job.*
    into v_elevenst_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_elevenst_job_id
   for update;
  if not found then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH'
      using errcode = '55000';
  end if;

  if v_product.owner_id is distinct from v_owner_id
     or v_product.sku is distinct from 'QA-20260823-CC-001'
     or v_product.on_hand is distinct from 1
     or v_product.demo
     or v_product.status is distinct from 'draft'
     or v_coupang_listing.owner_id is distinct from v_owner_id
     or v_coupang_listing.product_id is distinct from v_product_id
     or v_coupang_listing.channel_key is distinct from 'coupang'
     or v_coupang_listing.remote_id is distinct from '16356981734'
     or v_coupang_listing.operation_attempt_id is distinct from
        v_coupang_attempt_id
     or v_coupang_listing.currency is distinct from 'KRW'
     or v_coupang_listing.price is distinct from 5000
     or v_coupang_listing.status is distinct from 'failed'
     or v_coupang_listing.failure_class is distinct from 'external_action'
     or v_coupang_listing.requested_publication_intent is distinct from 'live'
     or v_coupang_listing.remote_visibility is distinct from 'unknown'
     or v_coupang_listing.provider_status is not null
     or v_coupang_listing.published_at is not null
     or v_coupang_listing.seller_account_key is null
     or v_coupang_listing.seller_account_key !~ '^[a-f0-9]{64}$'
     or not (
       (v_coupang_listing.market = '' and v_coupang_listing.target_id = '')
       or
       (v_coupang_listing.market = 'KR' and v_coupang_listing.target_id = 'KR')
     )
     or v_elevenst_listing.owner_id is distinct from v_owner_id
     or v_elevenst_listing.product_id is distinct from v_product_id
     or v_elevenst_listing.channel_key is distinct from 'elevenst'
     or v_elevenst_listing.remote_id is distinct from '9573255804'
     or v_elevenst_listing.operation_attempt_id is distinct from
        v_elevenst_attempt_id
     or v_elevenst_listing.currency is distinct from 'KRW'
     or v_elevenst_listing.price is distinct from 5000
     or v_elevenst_listing.status is distinct from 'failed'
     or v_elevenst_listing.failure_class is distinct from 'external_action'
     or v_elevenst_listing.requested_publication_intent is distinct from 'live'
     or v_elevenst_listing.remote_visibility is distinct from 'unknown'
     or v_elevenst_listing.provider_status is not null
     or v_elevenst_listing.published_at is not null
     or v_elevenst_listing.marketplace_sku is not null
     or v_elevenst_listing.seller_account_key is null
     or v_elevenst_listing.seller_account_key !~ '^[a-f0-9]{64}$'
     or not (
       (v_elevenst_listing.market = '' and v_elevenst_listing.target_id = '')
       or
       (v_elevenst_listing.market = 'KR' and v_elevenst_listing.target_id = 'KR')
     )
     or v_coupang_credential.channel is distinct from 'coupang'
     or v_coupang_credential.environment is distinct from 'production'
     or v_coupang_credential.status is distinct from 'active'
     or v_coupang_credential.version <= 0
     or v_coupang_credential.fingerprint is null
     or v_coupang_credential.fingerprint !~ '^[A-F0-9]{12}$'
     or v_coupang_credential.seller_account_key is distinct from
        v_coupang_listing.seller_account_key
     or v_coupang_credential.seller_account_key_source is distinct from
        'credential_incarnation_v1'
     or v_coupang_credential.seller_account_verified_at is null
     or v_coupang_credential.last_check_status is distinct from 'passed'
     or v_coupang_credential.last_checked_at is null
     or (
       v_coupang_credential.expires_at is not null
       and v_coupang_credential.expires_at <= statement_timestamp()
     )
     or v_elevenst_credential.created_by is distinct from v_owner_id
     or v_elevenst_credential.channel is distinct from 'elevenst'
     or v_elevenst_credential.environment is distinct from 'production'
     or v_elevenst_credential.status is distinct from 'active'
     or v_elevenst_credential.version is distinct from 2
     or v_elevenst_credential.fingerprint is null
     or v_elevenst_credential.fingerprint !~ '^[A-F0-9]{12}$'
     or v_elevenst_credential.seller_account_key is distinct from
        v_elevenst_listing.seller_account_key
     or v_elevenst_credential.seller_account_key_source is distinct from
        'credential_incarnation_v1'
     or v_elevenst_credential.seller_account_verified_at is null
     or v_elevenst_credential.last_check_status is distinct from 'passed'
     or v_elevenst_credential.last_checked_at is null
     or (
       v_elevenst_credential.expires_at is not null
       and v_elevenst_credential.expires_at <= statement_timestamp()
     )
     or v_coupang_attempt.owner_id is distinct from v_owner_id
     or v_coupang_attempt.credential_id is distinct from
        v_coupang_credential_id
     or v_coupang_attempt.channel is distinct from 'coupang'
     or v_coupang_attempt.operation is distinct from 'listing.create'
     or v_coupang_attempt.status is distinct from 'succeeded'
     or v_coupang_attempt.remote_id is distinct from '16356981734'
     or v_coupang_attempt.request_fingerprint is null
     or v_coupang_attempt.request_fingerprint !~ '^[a-f0-9]{64}$'
     or v_coupang_attempt.completed_at is null
     or (
       v_coupang_attempt.seller_account_key is not null
       and v_coupang_attempt.seller_account_key is distinct from
           v_coupang_credential.seller_account_key
     )
     or v_elevenst_attempt.owner_id is distinct from v_owner_id
     or v_elevenst_attempt.credential_id is distinct from
        v_elevenst_credential_id
     or v_elevenst_attempt.channel is distinct from 'elevenst'
     or v_elevenst_attempt.operation is distinct from 'listing.create'
     or v_elevenst_attempt.status is distinct from 'succeeded'
     or v_elevenst_attempt.remote_id is distinct from '9573255804'
     or v_elevenst_attempt.request_fingerprint is null
     or v_elevenst_attempt.request_fingerprint !~ '^[a-f0-9]{64}$'
     or v_elevenst_attempt.completed_at is null
     or (
       v_elevenst_attempt.seller_account_key is not null
       and v_elevenst_attempt.seller_account_key is distinct from
           v_elevenst_credential.seller_account_key
     )
     or v_coupang_job.credential_id is distinct from
        v_coupang_credential_id
     or v_coupang_job.attempt_id is distinct from v_coupang_attempt_id
     or v_coupang_job.listing_id is not null
     or v_coupang_job.channel is distinct from 'coupang'
     or v_coupang_job.operation is distinct from 'listing.create'
     or v_coupang_job.environment is distinct from 'production'
     or v_coupang_job.status is distinct from 'succeeded'
     or v_coupang_job.seller_account_key is not null
     or (
       v_coupang_job.request_fingerprint is not null
       and v_coupang_job.request_fingerprint is distinct from
           v_coupang_attempt.request_fingerprint
     )
     or nullif(trim(v_coupang_job.response_payload->>'remoteId'), '')
        is distinct from '16356981734'
     or not sellerpilot_private.gateway_listing_create_readback_verified(
       'coupang', v_coupang_job.response_payload
     )
     or v_elevenst_job.credential_id is distinct from
        v_elevenst_credential_id
     or v_elevenst_job.attempt_id is distinct from v_elevenst_attempt_id
     or v_elevenst_job.listing_id is not null
     or v_elevenst_job.channel is distinct from 'elevenst'
     or v_elevenst_job.operation is distinct from 'listing.create'
     or v_elevenst_job.environment is distinct from 'production'
     or v_elevenst_job.status is distinct from 'succeeded'
     or v_elevenst_job.seller_account_key is not null
     or (
       v_elevenst_job.request_fingerprint is not null
       and v_elevenst_job.request_fingerprint is distinct from
           v_elevenst_attempt.request_fingerprint
     )
     or nullif(trim(v_elevenst_job.response_payload->>'remoteId'), '')
        is distinct from '9573255804'
     or not sellerpilot_private.gateway_listing_create_readback_verified(
       'elevenst', v_elevenst_job.response_payload
     )
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_job
        where other_job.id <> v_coupang_job_id
          and other_job.operation = 'listing.create'
          and other_job.status = 'succeeded'
          and (
            other_job.attempt_id = v_coupang_attempt_id
            or other_job.listing_id = v_coupang_listing_id
          )
     )
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_job
        where other_job.id <> v_elevenst_job_id
          and other_job.operation = 'listing.create'
          and other_job.status = 'succeeded'
          and (
            other_job.attempt_id = v_elevenst_attempt_id
            or other_job.listing_id = v_elevenst_listing_id
          )
     )
  then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MISMATCH'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.id <> v_coupang_listing_id
       and listing.owner_id = v_owner_id
       and listing.product_id = v_product_id
       and listing.channel_key = 'coupang'
       and listing.market = 'KR'
       and listing.target_id = 'KR'
  ) or exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.id <> v_elevenst_listing_id
       and listing.owner_id = v_owner_id
       and listing.product_id = v_product_id
       and listing.channel_key = 'elevenst'
       and listing.market = 'KR'
       and listing.target_id = 'KR'
  ) then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_CONFLICT'
      using errcode = '55000';
  end if;

  perform pg_catalog.set_config(
    'sellerpilot.exact_domestic_attempt_lineage_backfill',
    'verified-v1',
    true
  );

  update sellerpilot_private.channel_operation_attempts attempt
     set seller_account_key = v_coupang_credential.seller_account_key
   where attempt.id = v_coupang_attempt_id
     and attempt.owner_id = v_owner_id
     and attempt.credential_id = v_coupang_credential_id
     and attempt.channel = 'coupang'
     and attempt.operation = 'listing.create'
     and attempt.status = 'succeeded'
     and attempt.remote_id = '16356981734'
     and attempt.seller_account_key is null;

  update sellerpilot_private.channel_operation_attempts attempt
     set seller_account_key = v_elevenst_credential.seller_account_key
   where attempt.id = v_elevenst_attempt_id
     and attempt.owner_id = v_owner_id
     and attempt.credential_id = v_elevenst_credential_id
     and attempt.channel = 'elevenst'
     and attempt.operation = 'listing.create'
     and attempt.status = 'succeeded'
     and attempt.remote_id = '9573255804'
     and attempt.seller_account_key is null;

  if not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts attempt
     where attempt.id = v_coupang_attempt_id
       and attempt.seller_account_key =
           v_coupang_credential.seller_account_key
  ) or not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts attempt
     where attempt.id = v_elevenst_attempt_id
       and attempt.seller_account_key =
           v_elevenst_credential.seller_account_key
  ) then
    raise exception 'EXACT_DOMESTIC_ATTEMPT_LINEAGE_BACKFILL_INVALID'
      using errcode = '55000';
  end if;

  update sellerpilot_private.product_listings listing
     set market = 'KR', target_id = 'KR'
   where listing.id = v_coupang_listing_id
     and listing.owner_id = v_owner_id
     and listing.product_id = v_product_id
     and listing.channel_key = 'coupang'
     and listing.remote_id = '16356981734'
     and listing.currency = 'KRW'
     and listing.price = 5000
     and listing.seller_account_key = v_coupang_credential.seller_account_key
     and listing.market = ''
     and listing.target_id = '';

  update sellerpilot_private.product_listings listing
     set market = 'KR', target_id = 'KR'
   where listing.id = v_elevenst_listing_id
     and listing.owner_id = v_owner_id
     and listing.product_id = v_product_id
     and listing.channel_key = 'elevenst'
     and listing.remote_id = '9573255804'
     and listing.marketplace_sku is null
     and listing.currency = 'KRW'
     and listing.price = 5000
     and listing.seller_account_key = v_elevenst_credential.seller_account_key
     and listing.market = ''
     and listing.target_id = '';

  if not exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.id = v_coupang_listing_id
       and listing.market = 'KR'
       and listing.target_id = 'KR'
  ) or not exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.id = v_elevenst_listing_id
       and listing.market = 'KR'
       and listing.target_id = 'KR'
  ) then
    raise exception 'EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_POSTIMAGE_INVALID'
      using errcode = '55000';
  end if;
end;
$exact_domestic_market_target_backfill$;

commit;
