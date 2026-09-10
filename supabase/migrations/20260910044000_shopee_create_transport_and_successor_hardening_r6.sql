-- Shopee r6: exact transport-byte CAS, exact-one full draft, OAuth successor
-- receipt rebind or retirement, Vault incarnation, warehouse body allowlist,
-- and atomic mapping+internal completion. Does not apply to production.

begin;

do $preimage$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.shopee_sg_create_stage_receipts'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.shopee_sg_global_create_receipts'
     ) is null then
    raise exception 'SHOPEE_SG_R6_PREIMAGE_REQUIRED';
  end if;
end
$preimage$;

alter table sellerpilot_private.shopee_sg_create_stage_receipts
  add column if not exists vault_secret_id uuid,
  add column if not exists vault_updated_at timestamptz,
  add column if not exists transport_bytes_sha256 text;

alter table sellerpilot_private.shopee_sg_global_create_receipts
  add column if not exists vault_secret_id uuid,
  add column if not exists vault_updated_at timestamptz,
  add column if not exists transport_bytes_sha256 text;

alter table sellerpilot_private.shopee_sg_create_stage_receipts
  drop constraint if exists shopee_sg_stage_transport_sha_r6;
alter table sellerpilot_private.shopee_sg_create_stage_receipts
  add constraint shopee_sg_stage_transport_sha_r6 check (
    transport_bytes_sha256 is null
    or transport_bytes_sha256 ~ '^[a-f0-9]{64}$'
  );

alter table sellerpilot_private.shopee_sg_global_create_receipts
  drop constraint if exists shopee_sg_global_transport_sha_r6;
alter table sellerpilot_private.shopee_sg_global_create_receipts
  add constraint shopee_sg_global_transport_sha_r6 check (
    transport_bytes_sha256 is null
    or transport_bytes_sha256 ~ '^[a-f0-9]{64}$'
  );

create table if not exists sellerpilot_private.shopee_sg_create_completion_map (
  listing_id uuid primary key,
  source_job_id uuid not null unique,
  credential_id uuid not null,
  credential_version integer not null check (credential_version > 0),
  vault_secret_id uuid not null,
  vault_updated_at timestamptz not null,
  global_item_id text not null check (global_item_id ~ '^[1-9][0-9]{0,31}$'),
  local_item_id text not null check (local_item_id ~ '^[1-9][0-9]{0,31}$'),
  transport_bytes_sha256 text not null check (
    transport_bytes_sha256 ~ '^[a-f0-9]{64}$'
  ),
  completed_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table sellerpilot_private.shopee_sg_create_completion_map
  enable row level security;
revoke all on sellerpilot_private.shopee_sg_create_completion_map
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.assert_shopee_sg_transport_bytes_v1(
  p_bytes text,
  p_sha256 text
) returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_bytes, '') = ''
     or coalesce(p_sha256, '') !~ '^[a-f0-9]{64}$'
     or pg_catalog.encode(
          extensions.digest(p_bytes, 'sha256'),
          'hex'
        ) is distinct from p_sha256 then
    raise exception 'SHOPEE_SG_TRANSPORT_BYTES_MISMATCH';
  end if;
  return p_sha256;
end
$$;

create or replace function sellerpilot_private.assert_shopee_sg_wh_list_body_v1(
  p_body jsonb
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_body) is distinct from 'object'
     or p_body - 'cursor' <> '{}'::jsonb
     or pg_catalog.jsonb_typeof(p_body -> 'cursor') is distinct from 'object'
     or (p_body -> 'cursor') - array['next_id', 'page_size'] <> '{}'::jsonb then
    raise exception 'SHOPEE_SG_WAREHOUSE_LIST_BODY_FORBIDDEN';
  end if;
  return p_body;
end
$$;

create or replace function sellerpilot_private.assert_shopee_sg_wh_elig_body_v1(
  p_body jsonb
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_body) is distinct from 'object'
     or p_body - array['warehouse_id', 'warehouse_type', 'cursor'] <> '{}'::jsonb
     or pg_catalog.jsonb_typeof(p_body -> 'cursor') is distinct from 'object'
     or (p_body -> 'cursor') - array['next_id', 'page_size'] <> '{}'::jsonb then
    raise exception 'SHOPEE_SG_WAREHOUSE_ELIGIBILITY_BODY_FORBIDDEN';
  end if;
  return p_body;
end
$$;

create or replace function sellerpilot_private.assert_shopee_sg_one_full_draft_v1(
  p_owner_id uuid,
  p_product_id uuid
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_current integer;
  v_full integer;
  v_draft jsonb;
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.product_registration_drafts'
     ) is null then
    raise exception 'SHOPEE_SG_FULL_DRAFT_PREIMAGE_REQUIRED';
  end if;
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (
           where pg_catalog.btrim(coalesce(draft.data #>> '{common,fields,productName}', '')) <> ''
             and pg_catalog.jsonb_typeof(draft.data #> '{common,quantity}') = 'number'
             and pg_catalog.jsonb_typeof(draft.data #> '{common,globalBaseUsdPrice}') = 'number'
             and pg_catalog.btrim(coalesce(draft.data #>> '{channels,sg,categoryId}', '')) <> ''
         )::integer
    into v_current, v_full
    from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id = p_owner_id
     and draft.product_id = p_product_id
     and draft.kind = 'publish';
  if v_current is distinct from 1 or v_full is distinct from 1 then
    raise exception 'SHOPEE_SG_FULL_DRAFT_CARDINALITY';
  end if;
  select draft.data into v_draft
    from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id = p_owner_id
     and draft.product_id = p_product_id
     and draft.kind = 'publish';
  return v_draft;
end
$$;

create or replace function sellerpilot_private.shopee_sg_current_vault_inc_v1(
  p_credential_id uuid,
  out vault_secret_id uuid,
  out updated_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
begin
  select credential.vault_secret_id, secret.updated_at
    into vault_secret_id, updated_at
    from sellerpilot_private.channel_credentials credential
    join vault.secrets secret
      on secret.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.channel = 'shopee'
     and credential.status = 'active';
  if vault_secret_id is null or updated_at is null then
    raise exception 'SHOPEE_SG_VAULT_INCARNATION_UNBOUND';
  end if;
end
$$;

create or replace function sellerpilot_private.rebind_shopee_sg_successor_v1(
  p_job_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_vault record;
  v_old uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-successor:' || p_job_id::text)
  );
  select job.id, job.created_by, job.credential_id, job.listing_id,
         job.claim_token, job.status, credential.version credential_version
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
   for update of job, credential;
  if not found then
    raise exception 'SHOPEE_SG_SUCCESSOR_JOB_INVALID';
  end if;
  v_old := v_job.credential_id;
  select * into v_vault
    from sellerpilot_private.shopee_sg_current_vault_inc_v1(v_job.credential_id);

  update sellerpilot_private.channel_market_targets target
     set credential_id = v_job.credential_id,
         credential_version = v_job.credential_version,
         updated_at = pg_catalog.clock_timestamp()
   where target.owner_id = v_job.created_by
     and target.channel = 'shopee'
     and target.market_code = 'SG'
     and target.environment = 'production';

  update sellerpilot_private.shopee_sg_create_stage_receipts stage
     set credential_id = v_job.credential_id,
         credential_version = v_job.credential_version,
         vault_secret_id = v_vault.vault_secret_id,
         vault_updated_at = v_vault.updated_at
   where stage.listing_id = v_job.listing_id
     and stage.owner_id = v_job.created_by
     and (stage.credential_id is distinct from v_job.credential_id
       or stage.credential_version is distinct from v_job.credential_version
       or stage.vault_secret_id is distinct from v_vault.vault_secret_id);

  update sellerpilot_private.shopee_sg_global_create_receipts receipt
     set credential_id = v_job.credential_id,
         credential_version = v_job.credential_version,
         vault_secret_id = v_vault.vault_secret_id,
         vault_updated_at = v_vault.updated_at
   where receipt.listing_id = v_job.listing_id
     and receipt.owner_id = v_job.created_by
     and (receipt.credential_id is distinct from v_job.credential_id
       or receipt.credential_version is distinct from v_job.credential_version
       or receipt.vault_secret_id is distinct from v_vault.vault_secret_id);

  if exists (
    select 1
      from sellerpilot_private.shopee_sg_create_stage_receipts stage
     where stage.listing_id = v_job.listing_id
       and stage.owner_id = v_job.created_by
       and (stage.credential_id is distinct from v_job.credential_id
         or stage.vault_secret_id is distinct from v_vault.vault_secret_id)
  ) or exists (
    select 1
      from sellerpilot_private.shopee_sg_global_create_receipts receipt
     where receipt.listing_id = v_job.listing_id
       and receipt.owner_id = v_job.created_by
       and (receipt.credential_id is distinct from v_job.credential_id
         or receipt.vault_secret_id is distinct from v_vault.vault_secret_id)
  ) then
    raise exception 'SHOPEE_SG_SUCCESSOR_RECEIPT_RESIDUAL';
  end if;

  update sellerpilot_private.shopee_sg_create_completion_map map
     set credential_id = v_job.credential_id,
         credential_version = v_job.credential_version,
         vault_secret_id = v_vault.vault_secret_id,
         vault_updated_at = v_vault.updated_at
   where map.listing_id = v_job.listing_id
     and map.source_job_id = v_job.id;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-credential-incarnation/1',
    'credentialId', v_job.credential_id,
    'credentialVersion', v_job.credential_version,
    'vaultSecretId', v_vault.vault_secret_id,
    'retiredCredentialId', v_old
  );
end
$$;

create or replace function sellerpilot_private.complete_shopee_sg_atomic_map_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault record;
  v_product uuid;
  v_transport text;
begin
  if tg_op <> 'UPDATE'
     or new.status is distinct from 'completed'
     or old.status is distinct from 'started'
     or new.stage_name is distinct from 'local-publish' then
    return new;
  end if;
  select * into v_vault
    from sellerpilot_private.shopee_sg_current_vault_inc_v1(new.credential_id);
  if new.vault_secret_id is distinct from v_vault.vault_secret_id
     or new.vault_updated_at is distinct from v_vault.updated_at then
    raise exception 'SHOPEE_SG_VAULT_INCARNATION_DRIFT';
  end if;
  select listing.product_id into v_product
    from sellerpilot_private.product_listings listing
   where listing.id = new.listing_id
     and listing.owner_id = new.owner_id
   for update;
  if not found then
    raise exception 'SHOPEE_SG_ATOMIC_COMPLETION_LISTING_INVALID';
  end if;
  perform sellerpilot_private.assert_shopee_sg_one_full_draft_v1(
    new.owner_id, v_product
  );
  v_transport := coalesce(new.transport_bytes_sha256, new.prepared_payload_sha256);
  insert into sellerpilot_private.shopee_sg_create_completion_map (
    listing_id, source_job_id, credential_id, credential_version,
    vault_secret_id, vault_updated_at, global_item_id, local_item_id,
    transport_bytes_sha256
  ) values (
    new.listing_id, new.source_job_id, new.credential_id, new.credential_version,
    v_vault.vault_secret_id, v_vault.updated_at, new.global_item_id, new.output_id,
    v_transport
  );
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'succeeded',
         updated_at = pg_catalog.clock_timestamp()
   where job.id = new.source_job_id
     and job.listing_id = new.listing_id
     and job.status in ('running', 'succeeded');
  if not found then
    raise exception 'SHOPEE_SG_ATOMIC_COMPLETION_JOB_INVALID';
  end if;
  return new;
end
$$;

create or replace function sellerpilot_private.shopee_sg_r6_stage_begin_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault record;
  v_product uuid;
begin
  select * into v_vault
    from sellerpilot_private.shopee_sg_current_vault_inc_v1(new.credential_id);
  new.vault_secret_id := v_vault.vault_secret_id;
  new.vault_updated_at := v_vault.updated_at;
  new.transport_bytes_sha256 := coalesce(
    new.transport_bytes_sha256, new.prepared_payload_sha256
  );
  select listing.product_id into v_product
    from sellerpilot_private.product_listings listing
   where listing.id = new.listing_id
     and listing.owner_id = new.owner_id;
  if v_product is not null then
    perform sellerpilot_private.assert_shopee_sg_one_full_draft_v1(
      new.owner_id, v_product
    );
  end if;
  return new;
end
$$;

create or replace function sellerpilot_private.shopee_sg_r6_allow_receipt_rebind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_IMMUTABLE';
  end if;
  if new.source_job_id is distinct from old.source_job_id
     or new.source_attempt_id is distinct from old.source_attempt_id
     or new.listing_id is distinct from old.listing_id
     or new.owner_id is distinct from old.owner_id
     or new.merchant_id is distinct from old.merchant_id
     or new.shop_id is distinct from old.shop_id
     or new.seller_sku is distinct from old.seller_sku
     or new.global_item_name is distinct from old.global_item_name
     or new.local_item_name is distinct from old.local_item_name
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.prepared_payload_sha256 is distinct from old.prepared_payload_sha256
     or new.global_item_id is distinct from old.global_item_id
     or new.prepared_arguments is distinct from old.prepared_arguments
     or new.create_response is distinct from old.create_response
     or new.readback_response is distinct from old.readback_response
     or new.create_response_sha256 is distinct from old.create_response_sha256
     or new.readback_response_sha256 is distinct from old.readback_response_sha256
     or new.created_at is distinct from old.created_at then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_IMMUTABLE';
  end if;
  return new;
end
$$;

drop trigger if exists shopee_sg_r6_stage_begin
  on sellerpilot_private.shopee_sg_create_stage_receipts;
create trigger shopee_sg_r6_stage_begin
before insert on sellerpilot_private.shopee_sg_create_stage_receipts
for each row execute function sellerpilot_private.shopee_sg_r6_stage_begin_trg();

drop trigger if exists shopee_sg_r6_stage_complete
  on sellerpilot_private.shopee_sg_create_stage_receipts;
create trigger shopee_sg_r6_stage_complete
after update on sellerpilot_private.shopee_sg_create_stage_receipts
for each row execute function sellerpilot_private.complete_shopee_sg_atomic_map_v1();

drop trigger if exists shopee_sg_global_create_receipts_immutable
  on sellerpilot_private.shopee_sg_global_create_receipts;
create trigger shopee_sg_global_create_receipts_immutable
before update or delete on sellerpilot_private.shopee_sg_global_create_receipts
for each row execute function sellerpilot_private.shopee_sg_r6_allow_receipt_rebind();

create or replace function public.sellerpilot_service_rebind_shopee_sg_successor_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'SHOPEE_SG_SUCCESSOR_TOKEN_INVALID';
  end if;
  return sellerpilot_private.rebind_shopee_sg_successor_v1(p_job_id, p_claim_token);
end
$$;

revoke all on function sellerpilot_private.assert_shopee_sg_transport_bytes_v1(text, text)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.assert_shopee_sg_wh_list_body_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.assert_shopee_sg_wh_elig_body_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.assert_shopee_sg_one_full_draft_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.rebind_shopee_sg_successor_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_rebind_shopee_sg_successor_v1(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_rebind_shopee_sg_successor_v1(text, uuid, uuid)
  to service_role;

commit;
