-- The lineage guard only allowed a Temu key change through the exact-adoption review
-- bound to one specific listing, so a live and provider-attested Temu credential stayed
-- on its random incarnation digest and the CS binding could never match. This adds one
-- narrow allowance and leaves every other lineage rule in place.

alter function sellerpilot_private.guard_credential_seller_lineage()
  rename to guard_credential_seller_lineage_before_temu_attested_promotion;

create or replace function sellerpilot_private.guard_credential_seller_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_temu_mall_id text;
  v_lineage record;
  v_review sellerpilot_private.temu_exact_credential_certification_reviews%rowtype;
  v_marker text := nullif(
    current_setting('sellerpilot.temu_exact_credential_lineage', true), ''
  );
begin

  -- Allow promoting a Temu credential from its random incarnation digest to the
  -- provider-attested certified key, using exactly the evidence the lineage
  -- function derives from: a shape-checked mall id attested by the provider and
  -- stored inside the encrypted credential. Every other change still falls
  -- through to the immutable lineage rules below.
  if tg_op = 'UPDATE'
     and new.channel = 'temu'
     and old.seller_account_key_source = 'credential_incarnation_v1'
     and new.seller_account_key_source = 'provider_certified_v1'
     and new.seller_account_key ~ '^[a-f0-9]{64}$'
     and new.seller_account_verified_at is not null
     and (old.seller_account_verified_at is null
          or new.seller_account_verified_at >= old.seller_account_verified_at) then
    begin
      select nullif(trim(coalesce(decrypted.decrypted_secret::jsonb->>'temu_account_identity_mall_id', '')), '')
        into v_temu_mall_id
        from vault.decrypted_secrets decrypted
       where decrypted.id = new.vault_secret_id;
    exception when no_data_found then
      v_temu_mall_id := null;
    end;
    if v_temu_mall_id ~ '^[1-9][0-9]{0,18}$'
       and new.seller_account_key = encode(sha256(convert_to(
         'temu' || chr(31) || 'production' || chr(31) || 'temu:mall:' || v_temu_mall_id, 'UTF8'
       )), 'hex') then
      return new;
    end if;
  end if;
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
    if v_marker is not null
       and (to_jsonb(new) - array[
          'seller_account_key', 'seller_account_key_source',
          'seller_account_verified_at'
       ]::text[]) is not distinct from
       (to_jsonb(old) - array[
          'seller_account_key', 'seller_account_key_source',
          'seller_account_verified_at'
       ]::text[])
       and old.channel = 'temu'
       and old.environment = 'production'
       and old.status = 'active'
       and old.seller_account_key ~ '^[a-f0-9]{64}$'
       and old.seller_account_key_source = 'credential_incarnation_v1'
       and old.seller_account_verified_at is not null
       and new.seller_account_key ~ '^[a-f0-9]{64}$'
       and new.seller_account_key_source = 'provider_certified_v1'
       and new.seller_account_verified_at is not null then
      select * into v_review
        from sellerpilot_private.temu_exact_credential_certification_reviews review
       where review.id::text = v_marker
         and review.credential_id = old.id
         and review.credential_version = old.version
         and review.vault_secret_id = old.vault_secret_id
         and review.seller_account_key = old.seller_account_key
         and review.product_id =
              'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and review.goods_id = '608570473054515'
         and review.sku_id = '123896921649274'
         and review.status = 'ready'
         and review.observed_at >= clock_timestamp() - interval '15 minutes'
         and review.provider_mall_id ~ '^[1-9][0-9]{0,18}$'
         and review.certified_seller_account_key = new.seller_account_key
         and review.observation->>'mallId' = review.provider_mall_id
         and review.observation->>'sellerSubject' =
              'temu:mall:' || review.provider_mall_id
         and review.observation->>'sellerAccountKey' = new.seller_account_key;
      if found
         and new.seller_account_key = encode(extensions.digest(
           'temu' || E'\x1f' || 'production' || E'\x1f'
             || 'temu:mall:' || v_review.provider_mall_id,
           'sha256'
         ), 'hex')
         and new.seller_account_verified_at >= v_review.observed_at
         and new.seller_account_verified_at <= clock_timestamp() + interval '5 minutes'
         and sellerpilot_private.temu_exact_credential_certification_observation(
           v_review.job_id
         ) is not distinct from v_review.observation
         and exists (
           select 1
             from sellerpilot_private.gateway_completion_receipts receipt
            where receipt.job_id = v_review.job_id
         )
         and not exists (
           select 1
             from sellerpilot_private.product_listings listing
            where listing.channel_key = 'temu'
              and listing.seller_account_key = old.seller_account_key
         ) then
        return new;
      end if;
    end if;
    if (to_jsonb(new) - array[
          'seller_account_key',
          'seller_account_key_source',
          'seller_account_verified_at'
        ]::text[])
         is not distinct from
       (to_jsonb(old) - array[
          'seller_account_key',
          'seller_account_key_source',
          'seller_account_verified_at'
        ]::text[])
       and old.seller_account_key is null
       and old.seller_account_key_source = 'legacy_unattested'
       and old.seller_account_verified_at is null then
      select * into v_lineage
        from sellerpilot_private.credential_seller_account_lineage(
          new.channel,
          new.environment,
          new.vault_secret_id
        );
      if v_lineage.seller_account_key ~ '^[a-f0-9]{64}$'
         and v_lineage.seller_account_key_source = 'provider_certified_v1'
         and v_lineage.seller_account_verified_at is not null then
        new.seller_account_key := v_lineage.seller_account_key;
        new.seller_account_key_source := v_lineage.seller_account_key_source;
        new.seller_account_verified_at := v_lineage.seller_account_verified_at;
        return new;
      end if;
    end if;
    raise exception 'credential seller lineage is immutable';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_credential_seller_lineage_before_temu_attested_promotion()
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.guard_credential_seller_lineage()
  from public,anon,authenticated,service_role;

-- Renaming a function keeps the trigger bound to the renamed OID, so the trigger
-- must be re-pointed at the new entry point to make the allowance reachable.
drop trigger if exists guard_credential_seller_lineage
  on sellerpilot_private.channel_credentials;
create trigger guard_credential_seller_lineage
  before insert or update on sellerpilot_private.channel_credentials
  for each row execute function sellerpilot_private.guard_credential_seller_lineage();
