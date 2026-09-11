-- Temu seller-account lineage used to fall through to a random credential incarnation
-- digest, so a live and provider-attested Temu credential could never satisfy the CS
-- binding (which compares against the digest of the attested mall id). This wrapper
-- certifies the Temu key from the attested mall id and keeps the previous behaviour
-- for every other channel.

alter function sellerpilot_private.credential_seller_account_lineage(text,text,uuid)
  rename to credential_seller_account_lineage_before_temu_provider_key;

create function sellerpilot_private.credential_seller_account_lineage(
  p_channel text,
  p_environment text,
  p_vault_secret_id uuid
)
returns table(
  seller_account_key text,
  seller_account_key_source text,
  seller_account_verified_at timestamptz
)
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_secret jsonb;
  v_mall_id text;
begin
  if lower(trim(p_channel)) <> 'temu' then
    return query select * from
      sellerpilot_private.credential_seller_account_lineage_before_temu_provider_key(
        p_channel,p_environment,p_vault_secret_id
      );
    return;
  end if;
  begin
    select decrypted.decrypted_secret::jsonb into v_secret
      from vault.decrypted_secrets decrypted
     where decrypted.id = p_vault_secret_id;
    v_mall_id := nullif(trim(coalesce(v_secret->>'temu_account_identity_mall_id', '')), '');
    if v_mall_id is null or v_mall_id !~ '^[1-9][0-9]{0,18}$' then
      return query select * from
        sellerpilot_private.credential_seller_account_lineage_before_temu_provider_key(
          p_channel,p_environment,p_vault_secret_id
        );
      return;
    end if;
    return query select
      encode(sha256(convert_to(
        'temu' || chr(31) || 'production' || chr(31) || 'temu:mall:' || v_mall_id,
        'UTF8'
      )), 'hex')::text,
      'provider_certified_v1'::text,
      statement_timestamp();
  exception when no_data_found or invalid_text_representation then
    return query select
      sellerpilot_private.credential_seller_account_lineage_before_temu_provider_key(
        p_channel,p_environment,p_vault_secret_id
      );
  end;
end
$$;

revoke all on function sellerpilot_private.credential_seller_account_lineage_before_temu_provider_key(text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.credential_seller_account_lineage(text,text,uuid) from public,anon,authenticated,service_role;
