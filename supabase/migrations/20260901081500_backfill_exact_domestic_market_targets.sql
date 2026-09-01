-- Canonicalize the market identity for the two already-existing domestic QA
-- listings. This is deliberately a one-off tuple repair: it does not create a
-- listing, change the release gate, arm a permit, or infer seller lineage.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 908150001);

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
  v_coupang_credential_id constant uuid :=
    '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid;
  v_elevenst_credential_id constant uuid :=
    'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid;
  v_present_listings integer;
  v_product sellerpilot_private.products%rowtype;
  v_coupang_listing sellerpilot_private.product_listings%rowtype;
  v_elevenst_listing sellerpilot_private.product_listings%rowtype;
  v_coupang_credential sellerpilot_private.channel_credentials%rowtype;
  v_elevenst_credential sellerpilot_private.channel_credentials%rowtype;
begin
  -- A clean replay has neither production row and must not manufacture QA
  -- data. A partial tuple is unsafe and aborts the transaction.
  select count(*)::integer
    into v_present_listings
    from sellerpilot_private.product_listings listing
   where listing.id in (v_coupang_listing_id, v_elevenst_listing_id);

  if v_present_listings = 0 then
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

  if v_product.owner_id is distinct from v_owner_id
     or v_product.sku is distinct from 'QA-20260823-CC-001'
     or v_product.on_hand is distinct from 1
     or v_product.demo
     or v_product.status is distinct from 'draft'
     or v_coupang_listing.owner_id is distinct from v_owner_id
     or v_coupang_listing.product_id is distinct from v_product_id
     or v_coupang_listing.channel_key is distinct from 'coupang'
     or v_coupang_listing.remote_id is distinct from '16356981734'
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
     or v_elevenst_listing.currency is distinct from 'KRW'
     or v_elevenst_listing.price is distinct from 5000
     or v_elevenst_listing.status is distinct from 'failed'
     or v_elevenst_listing.failure_class is distinct from 'external_action'
     or v_elevenst_listing.requested_publication_intent is distinct from 'live'
     or v_elevenst_listing.remote_visibility is distinct from 'unknown'
     or v_elevenst_listing.provider_status is not null
     or v_elevenst_listing.published_at is not null
     or (
       v_elevenst_listing.marketplace_sku is not null
       and v_elevenst_listing.marketplace_sku is distinct from
           'QA-20260823-CC-001'
     )
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
