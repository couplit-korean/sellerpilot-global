-- Bind every marketplace listing mutation to the credential lineage that
-- created the remote listing. Existing rows remain intentionally unbound:
-- secrets, user-entered seller IDs, and public catalog responses are never
-- guessed into an account identity.

begin;

alter table sellerpilot_private.channel_credentials
  add column if not exists seller_account_key text,
  add column if not exists seller_account_key_source text,
  add column if not exists seller_account_verified_at timestamptz;
alter table sellerpilot_private.channel_operation_attempts
  add column if not exists seller_account_key text;
alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists seller_account_key text;
alter table sellerpilot_private.product_listings
  add column if not exists seller_account_key text;

alter table sellerpilot_private.channel_credentials
  drop constraint if exists channel_credentials_seller_account_key_check;
alter table sellerpilot_private.channel_credentials
  add constraint channel_credentials_seller_account_key_check
  check (
    (
      seller_account_key is null
      and seller_account_key_source = 'legacy_unattested'
      and seller_account_verified_at is null
    )
    or (
      seller_account_key ~ '^[a-f0-9]{64}$'
      and seller_account_key_source in ('provider_certified_v1', 'credential_incarnation_v1')
      and seller_account_verified_at is not null
    )
  );

alter table sellerpilot_private.channel_operation_attempts
  drop constraint if exists channel_operation_attempts_seller_account_key_check;
alter table sellerpilot_private.channel_operation_attempts
  add constraint channel_operation_attempts_seller_account_key_check
  check (seller_account_key is null or seller_account_key ~ '^[a-f0-9]{64}$');

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_seller_account_key_check;
alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_seller_account_key_check
  check (seller_account_key is null or seller_account_key ~ '^[a-f0-9]{64}$');

alter table sellerpilot_private.product_listings
  drop constraint if exists product_listings_seller_account_key_check;
alter table sellerpilot_private.product_listings
  add constraint product_listings_seller_account_key_check
  check (seller_account_key is null or seller_account_key ~ '^[a-f0-9]{64}$');

create unique index if not exists product_listings_one_operation_attempt_idx
  on sellerpilot_private.product_listings (operation_attempt_id)
  where operation_attempt_id is not null;

create or replace function sellerpilot_private.new_seller_account_key()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(
    extensions.digest(
      gen_random_uuid()::text || ':' || clock_timestamp()::text || ':' || gen_random_uuid()::text,
      'sha256'
    ),
    'hex'
  )
$$;

-- The raw provider subject never leaves Vault. Only a deterministic digest,
-- provenance label, and database attestation time are stored relationally.
-- OAuth credentials without a worker-produced provider subject remain
-- fail-closed as legacy_unattested. Static API credentials receive a random
-- incarnation key: rotation is intentionally a new lineage until a provider
-- readback explicitly rebinds an existing remote listing.
create or replace function sellerpilot_private.credential_seller_account_lineage(
  p_channel text,
  p_environment text,
  p_vault_secret_id uuid
)
returns table (
  seller_account_key text,
  seller_account_key_source text,
  seller_account_verified_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_secret_text text;
  v_secret jsonb;
  v_subject text;
  v_identity_version text;
  v_service_attested boolean := coalesce(
    current_setting('request.jwt.claim.role', true) = 'service_role',
    false
  );
begin
  select d.decrypted_secret
    into v_secret_text
    from vault.decrypted_secrets d
   where d.id = p_vault_secret_id;

  if v_secret_text is null then
    return query select null::text, 'legacy_unattested'::text, null::timestamptz;
    return;
  end if;

  begin
    v_secret := v_secret_text::jsonb;
  exception when invalid_text_representation then
    return query select null::text, 'legacy_unattested'::text, null::timestamptz;
    return;
  end;

  if p_channel in ('shopee', 'lazada', 'ebay') then
    v_subject := nullif(trim(v_secret->>'provider_account_subject'), '');
    v_identity_version := nullif(trim(v_secret->>'provider_account_identity_version'), '');
    if not v_service_attested
       or v_identity_version <> 'v1'
       or v_subject is null
       or length(v_subject) > 2048
       or (p_channel = 'shopee' and v_subject !~ '^shopee:(main|shop):[0-9]+$')
       or (p_channel = 'lazada' and (
         length(v_subject) not between 51 and 522
         or v_subject !~ '^lazada:v1:[A-Za-z0-9_-]+$'
       ))
       or (p_channel = 'ebay' and (
         length(v_subject) not between 11 and 522
         or v_subject !~ '^ebay:eias:[^[:cntrl:]]+$'
       )) then
      return query select null::text, 'legacy_unattested'::text, null::timestamptz;
      return;
    end if;

    return query
      select encode(
        extensions.digest(
          lower(trim(p_channel)) || E'\x1f' || lower(trim(p_environment)) || E'\x1f' || v_subject,
          'sha256'
        ),
        'hex'
      ), 'provider_certified_v1'::text, now();
    return;
  end if;

  return query
    select sellerpilot_private.new_seller_account_key(),
           'credential_incarnation_v1'::text,
           now();
end;
$$;

-- Existing OAuth rows predate provider-certified subjects and must not be
-- guessed from a public seller ID or cached target. Existing static API
-- credentials can safely start a new credential-incarnation lineage.
do $$
declare
  v_credential record;
  v_lineage record;
begin
  for v_credential in
    select c.id, c.channel, c.environment, c.vault_secret_id
      from sellerpilot_private.channel_credentials c
  loop
    select * into v_lineage
      from sellerpilot_private.credential_seller_account_lineage(
        v_credential.channel,
        v_credential.environment,
        v_credential.vault_secret_id
      );
    update sellerpilot_private.channel_credentials c
       set seller_account_key = v_lineage.seller_account_key,
           seller_account_key_source = v_lineage.seller_account_key_source,
           seller_account_verified_at = v_lineage.seller_account_verified_at
     where c.id = v_credential.id;
  end loop;
end
$$;

alter table sellerpilot_private.channel_credentials
  alter column seller_account_key_source set not null;

do $$
begin
  if exists (
    select 1
      from sellerpilot_private.product_listings l
     where l.operation_attempt_id is not null
     group by l.operation_attempt_id
    having count(*) > 1
  ) then
    raise exception 'duplicate product listing operation attempts require manual reconciliation';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.operation in (
       'listing.create', 'listing.update', 'listing.stop',
       'price.update', 'inventory.update'
     )
       and j.status in ('queued', 'running', 'reconciliation_required')
       and j.listing_id is null
  ) then
    raise exception 'active legacy listing jobs must drain before seller lineage rollout';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
      join sellerpilot_private.channel_credentials c on c.id = j.credential_id
      left join sellerpilot_private.channel_operation_attempts a on a.id = j.attempt_id
     where j.operation in (
       'listing.create', 'listing.update', 'listing.stop',
       'price.update', 'inventory.update', 'inquiries.reply',
       'shipment.acknowledge', 'shipment.confirm'
     )
       and j.status in ('queued', 'running', 'reconciliation_required')
       and (
         j.seller_account_key is null
         or (j.attempt_id is not null and a.seller_account_key is null)
         or c.seller_account_key is null
         or c.seller_account_key_source not in ('provider_certified_v1', 'credential_incarnation_v1')
         or (
           j.channel in ('shopee', 'lazada', 'ebay')
           and c.seller_account_key_source <> 'provider_certified_v1'
         )
       )
  ) then
    raise exception 'active write jobs require manual reconciliation before seller lineage rollout';
  end if;
end
$$;

create or replace function sellerpilot_private.gateway_listing_create_readback_verified(
  p_channel text,
  p_response_payload jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p_response_payload->>'ok')::boolean, false)
    and nullif(trim(p_response_payload->>'remoteId'), '') is not null
    and jsonb_typeof(p_response_payload->'steps') = 'array'
    and not exists (
      select 1
        from jsonb_array_elements(p_response_payload->'steps') step
       where coalesce((step->>'ok')::boolean, false) = false
    )
    and exists (
      select 1
        from jsonb_array_elements(p_response_payload->'steps') step
       where case p_channel
         when 'qoo10' then lower(coalesce(step->>'name', '')) = 'detail-image-readback'
         when 'elevenst' then lower(coalesce(step->>'name', '')) = 'product-readback'
         when 'shopee' then lower(coalesce(step->>'name', '')) = 'listing-readback'
           or lower(coalesce(step->>'name', '')) = 'published-item-readback'
           or lower(coalesce(step->>'name', '')) like 'published-item-readback-%'
         when 'lazada' then lower(coalesce(step->>'name', '')) = 'listing-readback'
         when 'coupang' then lower(coalesce(step->>'name', '')) in ('listing-readback', 'listing-approval-readback')
         when 'smartstore' then lower(coalesce(step->>'name', '')) = 'product-readback'
         when 'temu' then lower(coalesce(step->>'name', '')) = 'goods-readback'
         when 'ebay' then lower(coalesce(step->>'name', '')) in ('offer-readback', 'offer-detail-image-readback')
         else false
       end
    )
$$;

create or replace function sellerpilot_private.guard_credential_seller_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineage record;
begin
  if tg_op = 'INSERT' then
    select * into v_lineage
      from sellerpilot_private.credential_seller_account_lineage(
        new.channel,
        new.environment,
        new.vault_secret_id
      );
    new.seller_account_key := v_lineage.seller_account_key;
    new.seller_account_key_source := v_lineage.seller_account_key_source;
    new.seller_account_verified_at := v_lineage.seller_account_verified_at;
    return new;
  end if;

  if new.vault_secret_id is distinct from old.vault_secret_id
     or new.channel is distinct from old.channel
     or new.environment is distinct from old.environment
     or new.seller_account_key is distinct from old.seller_account_key
     or new.seller_account_key_source is distinct from old.seller_account_key_source
     or new.seller_account_verified_at is distinct from old.seller_account_verified_at then
    raise exception 'credential seller lineage is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_credential_seller_lineage
  on sellerpilot_private.channel_credentials;
create trigger guard_credential_seller_lineage
before insert or update on sellerpilot_private.channel_credentials
for each row execute function sellerpilot_private.guard_credential_seller_lineage();

create or replace function sellerpilot_private.guard_attempt_seller_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_credential_key text;
begin
  select c.seller_account_key
    into v_credential_key
    from sellerpilot_private.channel_credentials c
   where c.id = new.credential_id
     and c.channel = new.channel;
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
      'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
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
    new.seller_account_key := coalesce(old.seller_account_key, v_credential_key);
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

drop trigger if exists guard_attempt_seller_lineage
  on sellerpilot_private.channel_operation_attempts;
create trigger guard_attempt_seller_lineage
before insert or update on sellerpilot_private.channel_operation_attempts
for each row execute function sellerpilot_private.guard_attempt_seller_lineage();

create or replace function sellerpilot_private.guard_gateway_job_seller_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential_key text;
  v_credential_key_source text;
  v_old_credential_key text;
  v_attempt record;
  v_listing record;
  v_requested_remote_id text;
  v_expected_remote_id text;
begin
  if tg_op = 'INSERT' then
    if new.operation in ('price.update', 'inventory.update')
       and new.listing_id is null then
      raise exception 'listing-bound resource write requires listing lineage';
    end if;
    select c.seller_account_key, c.seller_account_key_source
      into v_credential_key, v_credential_key_source
      from sellerpilot_private.channel_credentials c
     where c.id = new.credential_id
       and c.channel = new.channel
     for update;
    if not found then raise exception 'gateway credential lineage unavailable'; end if;

    if new.operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update', 'inquiries.reply',
      'shipment.acknowledge', 'shipment.confirm'
    ) and (
      v_credential_key is null
      or v_credential_key_source not in ('provider_certified_v1', 'credential_incarnation_v1')
      or (
        new.channel in ('shopee', 'lazada', 'ebay')
        and v_credential_key_source <> 'provider_certified_v1'
      )
    ) then
      raise exception 'provider-certified seller identity required';
    end if;
    new.seller_account_key := v_credential_key;

    if new.attempt_id is not null then
      select a.id, a.credential_id, a.channel, a.operation, a.status, a.seller_account_key
        into v_attempt
        from sellerpilot_private.channel_operation_attempts a
       where a.id = new.attempt_id
       for update;
      if not found
         or v_attempt.credential_id <> new.credential_id
         or v_attempt.channel <> new.channel
         or v_attempt.operation <> new.operation then
        raise exception 'gateway attempt lineage mismatch';
      end if;
      if v_attempt.seller_account_key is null and v_attempt.status = 'running' then
        update sellerpilot_private.channel_operation_attempts a
           set seller_account_key = v_credential_key
         where a.id = new.attempt_id;
        v_attempt.seller_account_key := v_credential_key;
      end if;
      if v_attempt.seller_account_key is distinct from v_credential_key then
        raise exception 'gateway attempt seller account mismatch';
      end if;
    end if;

    if new.listing_id is not null then
      select l.id, l.product_id, l.channel_key, l.remote_id, l.marketplace_sku,
             l.market, l.target_id, l.operation_attempt_id, l.seller_account_key
        into v_listing
        from sellerpilot_private.product_listings l
       where l.id = new.listing_id
       for update;
      if not found or v_listing.channel_key <> new.channel then
        raise exception 'gateway listing lineage mismatch';
      end if;

      if new.operation in ('listing.update', 'listing.stop') and (
        v_listing.operation_attempt_id is distinct from new.attempt_id
        or v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) then
        raise exception 'gateway listing seller account mismatch';
      end if;
      if new.operation in ('price.update', 'inventory.update') and (
        v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) then
        raise exception 'gateway listing seller account mismatch';
      end if;
      if new.operation in ('price.update', 'inventory.update') then
        v_requested_remote_id := case new.channel
          when 'qoo10' then coalesce(
            new.request_payload#>>'{arguments,params,ItemCode}',
            new.request_payload#>>'{arguments,remoteId}'
          )
          when 'shopee' then coalesce(
            new.request_payload#>>'{arguments,body,item_id}',
            new.request_payload#>>'{arguments,itemId}',
            new.request_payload#>>'{arguments,item_id}'
          )
          when 'lazada' then coalesce(
            new.request_payload#>>'{arguments,itemId}',
            new.request_payload#>>'{arguments,request,Product,Skus,Sku,0,ItemId}'
          )
          when 'coupang' then coalesce(
            new.request_payload#>>'{arguments,vendorItemId}',
            new.request_payload#>>'{arguments,sellerProductId}'
          )
          when 'smartstore' then coalesce(
            new.request_payload#>>'{arguments,originProductNo}',
            new.request_payload#>>'{arguments,body,originProductNo}'
          )
          when 'temu' then coalesce(
            new.request_payload#>>'{arguments,goodsId}',
            new.request_payload#>>'{arguments,skuId}'
          )
          when 'ebay' then case
            when new.operation = 'inventory.update'
              then new.request_payload#>>'{arguments,sku}'
            else new.request_payload#>>'{arguments,offerId}'
          end
          else new.request_payload#>>'{arguments,remoteId}'
        end;
        v_expected_remote_id := case
          when new.channel = 'ebay' and new.operation = 'inventory.update'
            then v_listing.marketplace_sku
          else v_listing.remote_id
        end;
        if nullif(trim(coalesce(v_requested_remote_id, '')), '') is null
           or trim(v_requested_remote_id) <> coalesce(v_expected_remote_id, '') then
          raise exception 'gateway listing remote identity mismatch';
        end if;
      end if;
      if new.operation = 'listing.create' and (
        v_listing.operation_attempt_id is distinct from new.attempt_id
        or (v_listing.seller_account_key is not null
          and v_listing.seller_account_key is distinct from v_credential_key)
      ) then
        raise exception 'gateway listing seller account mismatch';
      end if;

      if new.channel = 'shopee' and (
        nullif(trim(new.request_payload#>>'{arguments,shopId}'), '') is null
        or trim(new.request_payload#>>'{arguments,shopId}') <> coalesce(v_listing.target_id, '')
      ) then
        raise exception 'gateway listing target mismatch';
      end if;
      if new.channel = 'lazada' and (
        nullif(trim(new.request_payload#>>'{arguments,country}'), '') is null
        or lower(trim(new.request_payload#>>'{arguments,country}')) <> lower(coalesce(v_listing.market, ''))
      ) then
        raise exception 'gateway listing target mismatch';
      end if;
      if new.channel in ('shopee', 'lazada') and not exists (
        select 1
          from sellerpilot_private.channel_market_targets t
         where t.credential_id = new.credential_id
           and t.channel = new.channel
           and t.market_code = upper(coalesce(v_listing.market, ''))
           and t.target_id = coalesce(v_listing.target_id, '')
      ) then
        raise exception 'gateway credential target mismatch';
      end if;
    end if;

    return new;
  end if;

  if new.attempt_id is distinct from old.attempt_id
     or new.listing_id is distinct from old.listing_id
     or new.channel is distinct from old.channel
     or new.operation is distinct from old.operation
     or new.seller_account_key is distinct from old.seller_account_key then
    raise exception 'gateway job lineage is immutable';
  end if;

  if new.credential_id is distinct from old.credential_id then
    select c.seller_account_key into v_old_credential_key
      from sellerpilot_private.channel_credentials c where c.id = old.credential_id;
    select c.seller_account_key, c.seller_account_key_source
      into v_credential_key, v_credential_key_source
      from sellerpilot_private.channel_credentials c where c.id = new.credential_id for update;
    if not found then raise exception 'gateway credential lineage unavailable'; end if;

    -- A new OAuth authorization may deliberately select a different seller
    -- account. Never inherit the previous account lineage merely because the
    -- exchange runs through the same application credential.
    if old.operation = 'oauth.exchange' then
      return new;
    end if;

    if old.operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
    ) and (
      old.seller_account_key is null
      or v_old_credential_key is distinct from old.seller_account_key
      or v_credential_key is distinct from old.seller_account_key
      or (
        old.channel in ('shopee', 'lazada', 'ebay')
        and v_credential_key_source <> 'provider_certified_v1'
      )
    ) then
      if old.status = 'queued' then
        new.credential_id := old.credential_id;
        return new;
      end if;
      raise exception 'gateway seller account reassignment blocked';
    end if;
    if old.seller_account_key is not null
       and v_credential_key is distinct from old.seller_account_key then
      if old.status = 'queued' then
        new.credential_id := old.credential_id;
        return new;
      end if;
      raise exception 'gateway seller account reassignment blocked';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_gateway_job_seller_lineage
  on sellerpilot_private.channel_gateway_jobs;
create trigger guard_gateway_job_seller_lineage
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.guard_gateway_job_seller_lineage();

create or replace function sellerpilot_private.guard_product_listing_seller_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt record;
  v_credential_key text;
  v_job record;
  v_sensitive_completion boolean := false;
  v_binding_verified boolean := false;
begin
  if old.marketplace_sku is not null
     and new.marketplace_sku is distinct from old.marketplace_sku then
    raise exception 'product listing marketplace sku is immutable';
  end if;
  if old.operation_attempt_id is not null and new.operation_attempt_id is null then
    raise exception 'product listing operation lineage cannot be cleared';
  end if;
  if new.seller_account_key is not null
     and old.seller_account_key is not null
     and new.seller_account_key is distinct from old.seller_account_key then
    raise exception 'product listing seller lineage is immutable';
  end if;

  if new.operation_attempt_id is not null then
    select a.id, a.credential_id, a.channel, a.operation, a.status, a.seller_account_key
      into v_attempt
      from sellerpilot_private.channel_operation_attempts a
     where a.id = new.operation_attempt_id;
    if found then
      select c.seller_account_key into v_credential_key
        from sellerpilot_private.channel_credentials c
       where c.id = v_attempt.credential_id
         and c.channel = v_attempt.channel;
      if v_attempt.channel <> new.channel_key then
        raise exception 'product listing attempt channel mismatch';
      end if;
      if v_attempt.operation in ('listing.update', 'listing.stop', 'price.update', 'inventory.update') and (
        old.seller_account_key is null
        or v_attempt.seller_account_key is null
        or v_credential_key is null
        or old.seller_account_key is distinct from v_attempt.seller_account_key
        or old.seller_account_key is distinct from v_credential_key
      ) then
        raise exception 'product listing seller account mismatch';
      end if;
      if v_attempt.operation = 'listing.create'
         and old.seller_account_key is not null
         and (
           v_attempt.seller_account_key is null
           or old.seller_account_key is distinct from v_attempt.seller_account_key
           or old.seller_account_key is distinct from v_credential_key
         ) then
        raise exception 'product listing seller account mismatch';
      end if;
    end if;
  end if;

  v_sensitive_completion := new.operation_attempt_id is not null
    and (
      new.remote_id is distinct from old.remote_id
      or (new.status is distinct from old.status and new.status in ('published', 'paused', 'failed'))
      or new.seller_account_key is distinct from old.seller_account_key
    );

  if old.seller_account_key is not null
     and (
       new.remote_id is distinct from old.remote_id
       or (new.status is distinct from old.status and new.status in ('published', 'paused', 'failed'))
     )
     and (new.operation_attempt_id is null or not found) then
    raise exception 'exact listing operation lineage required';
  end if;

  if v_sensitive_completion and found and v_attempt.operation in ('listing.create', 'listing.update', 'listing.stop') then
    select j.id, j.credential_id, j.attempt_id, j.listing_id, j.channel,
           j.operation, j.status, j.request_payload, j.response_payload,
           j.seller_account_key
      into v_job
      from sellerpilot_private.channel_gateway_jobs j
     where j.listing_id = new.id
       and j.attempt_id = new.operation_attempt_id
       and j.channel = new.channel_key
       and j.operation = v_attempt.operation
       and j.status in ('succeeded', 'failed', 'reconciliation_required')
     order by j.completed_at desc nulls last, j.created_at desc, j.id desc
     limit 1;

    if not found then
      -- A local pre-provider validation failure may safely mark the listing as
      -- failed, but it may not attach or replace a remote identity.
      if new.status = 'failed'
         and new.remote_id is not distinct from old.remote_id
         and new.seller_account_key is not distinct from old.seller_account_key then
        return new;
      end if;
      raise exception 'exact terminal listing gateway job required';
    end if;

    if v_job.credential_id <> v_attempt.credential_id
       or v_job.seller_account_key is null
       or v_attempt.seller_account_key is null
       or v_credential_key is null
       or v_job.seller_account_key is distinct from v_attempt.seller_account_key
       or v_job.seller_account_key is distinct from v_credential_key then
      raise exception 'terminal listing seller account mismatch';
    end if;

    if new.status in ('published', 'paused') and (
      v_job.status <> 'succeeded'
      or not coalesce((v_job.response_payload->>'ok')::boolean, false)
      or (new.status = 'paused' and v_attempt.operation <> 'listing.stop')
      or (new.status = 'published' and v_attempt.operation not in ('listing.create', 'listing.update'))
    ) then
      raise exception 'successful terminal listing job required';
    end if;

    if v_attempt.operation in ('listing.update', 'listing.stop') and (
      old.seller_account_key is null
      or old.seller_account_key is distinct from v_job.seller_account_key
    ) then
      raise exception 'terminal listing seller account mismatch';
    end if;

    if v_attempt.operation = 'listing.create'
       and v_job.status = 'succeeded'
       and coalesce((v_job.response_payload->>'ok')::boolean, false) then
      if not sellerpilot_private.gateway_listing_create_readback_verified(
        new.channel_key,
        v_job.response_payload
      ) then
        raise exception 'listing create readback required for seller lineage';
      end if;
      if old.seller_account_key is null then
        new.seller_account_key := v_job.seller_account_key;
        v_binding_verified := true;
      elsif old.seller_account_key is distinct from v_job.seller_account_key then
        raise exception 'terminal listing seller account mismatch';
      end if;
      if new.channel_key = 'ebay' and old.marketplace_sku is null then
        new.marketplace_sku := nullif(trim(v_job.request_payload#>>'{arguments,sku}'), '');
        if new.marketplace_sku is null then
          raise exception 'verified ebay marketplace sku required';
        end if;
      end if;
    end if;
  end if;

  if new.seller_account_key is distinct from old.seller_account_key
     and old.seller_account_key is not null then
    raise exception 'product listing seller lineage is immutable';
  end if;
  if new.seller_account_key is distinct from old.seller_account_key
     and new.seller_account_key is null then
    raise exception 'product listing seller lineage cannot be cleared';
  end if;
  if new.seller_account_key is distinct from old.seller_account_key
     and old.seller_account_key is null
     and not v_binding_verified then
    raise exception 'verified listing create completion required for seller lineage';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_product_listing_seller_lineage
  on sellerpilot_private.product_listings;
create trigger guard_product_listing_seller_lineage
before update on sellerpilot_private.product_listings
for each row execute function sellerpilot_private.guard_product_listing_seller_lineage();

create or replace function public.sellerpilot_service_validate_listing_write_lineage(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_channel text,
  p_operation text,
  p_market text,
  p_target_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing record;
  v_credential record;
begin
  if p_operation not in ('listing.update', 'listing.stop', 'price.update', 'inventory.update') then
    return 'listing_identity_mismatch';
  end if;

  select l.id, l.product_id, l.channel_key, l.market, l.target_id,
         l.remote_id, l.seller_account_key
    into v_listing
    from sellerpilot_private.product_listings l
   where l.id = p_listing_id;
  if not found
     or v_listing.product_id <> p_product_id
     or v_listing.channel_key <> p_channel
     or coalesce(v_listing.market, '') <> trim(coalesce(p_market, ''))
     or coalesce(v_listing.target_id, '') <> trim(coalesce(p_target_id, ''))
     or nullif(trim(coalesce(v_listing.remote_id, '')), '') is null then
    return 'listing_identity_mismatch';
  end if;

  select c.id, c.channel, c.environment, c.status, c.expires_at,
         c.seller_account_key, c.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id;
  if not found
     or v_credential.channel <> p_channel
     or v_credential.status <> 'active'
     or (v_credential.expires_at is not null and v_credential.expires_at <= now()) then
    return 'credential_unverified';
  end if;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source not in ('provider_certified_v1', 'credential_incarnation_v1')
     or (
       p_channel in ('shopee', 'lazada', 'ebay')
       and v_credential.seller_account_key_source <> 'provider_certified_v1'
     ) then
    return 'credential_unverified';
  end if;
  if v_listing.seller_account_key is null then return 'legacy_listing_unbound'; end if;
  if v_listing.seller_account_key is distinct from v_credential.seller_account_key then
    return 'seller_account_mismatch';
  end if;

  if p_channel in ('shopee', 'lazada') and not exists (
    select 1
      from sellerpilot_private.channel_market_targets t
     where t.credential_id = p_credential_id
       and t.channel = p_channel
       and t.environment = v_credential.environment
       and t.market_code = upper(trim(coalesce(p_market, '')))
       and t.target_id = trim(coalesce(p_target_id, ''))
  ) then
    return 'listing_identity_mismatch';
  end if;

  return 'allowed';
end;
$$;

-- The workbench and the integrated inventory route need the provider-owned SKU
-- for eBay. Expose the stored ledger value without exposing credential lineage
-- keys or deriving a SKU from mutable central product fields.
alter function public.sellerpilot_get_product_publish_context(uuid)
  rename to sellerpilot_get_product_publish_context_pre_seller_lineage;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_listings jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_get_product_publish_context_pre_seller_lineage(p_product_id);
  if v_result is null then return null; end if;

  select coalesce(
    jsonb_agg(
      entry.value || jsonb_build_object('marketplaceSku', listing.marketplace_sku)
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
    into v_listings
    from jsonb_array_elements(coalesce(v_result->'listings', '[]'::jsonb))
      with ordinality as entry(value, ordinality)
    left join sellerpilot_private.product_listings listing
      on listing.id::text = entry.value->>'id';

  return jsonb_set(v_result, '{listings}', v_listings, true);
end;
$$;

revoke all on function sellerpilot_private.new_seller_account_key()
  from public, anon, authenticated;
revoke all on function sellerpilot_private.credential_seller_account_lineage(text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.gateway_listing_create_readback_verified(text, jsonb)
  from public, anon, authenticated;
revoke all on function sellerpilot_private.guard_credential_seller_lineage()
  from public, anon, authenticated;
revoke all on function sellerpilot_private.guard_attempt_seller_lineage()
  from public, anon, authenticated;
revoke all on function sellerpilot_private.guard_gateway_job_seller_lineage()
  from public, anon, authenticated;
revoke all on function sellerpilot_private.guard_product_listing_seller_lineage()
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_validate_listing_write_lineage(uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_validate_listing_write_lineage(uuid, uuid, uuid, text, text, text, text)
  to service_role;
revoke all on function public.sellerpilot_get_product_publish_context_pre_seller_lineage(uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_get_product_publish_context(uuid)
  from public, anon;
grant execute on function public.sellerpilot_get_product_publish_context(uuid)
  to authenticated;

commit;
