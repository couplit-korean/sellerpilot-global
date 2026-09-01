import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901171500_adopt_exact_shopee_sg_existing_item.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const ownerId = "92000000-0000-4000-8000-000000000001";
const actorId = "92000000-0000-4000-8000-000000000002";
const credentialId = "92000000-0000-4000-8000-000000000003";
const vaultId = "92000000-0000-4000-8000-000000000004";
const claimToken = "92000000-0000-4000-8000-000000000005";
const sellerKey = "a".repeat(64);
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function database() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
    create schema auth;
    create table auth.users (id uuid primary key);
    create schema vault;
    create table vault.secrets (id uuid primary key, secret text not null);
    create view vault.decrypted_secrets as
      select id, secret as decrypted_secret from vault.secrets;
    create schema extensions;
    create function extensions.digest(value text, algorithm text) returns bytea
      language sql immutable as $$
        select case when lower(algorithm) = 'sha256'
          then sha256(convert_to(value, 'UTF8'))
          else convert_to(md5(value || algorithm), 'UTF8') end
      $$;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users (
      user_id uuid primary key references auth.users(id)
    );
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null references auth.users(id),
      sku text not null,
      demo boolean not null default false,
      status text not null
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      created_by uuid not null references auth.users(id),
      vault_secret_id uuid not null,
      status text not null,
      expires_at timestamptz,
      seller_account_key text,
      seller_account_key_source text,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.channel_market_targets (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      environment text not null,
      market_code text not null,
      target_id text not null,
      locale text not null,
      currency text not null
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null references auth.users(id),
      product_id uuid not null references sellerpilot_private.products(id),
      channel_key text not null,
      remote_id text,
      marketplace_sku text,
      market text not null default '',
      target_id text not null default '',
      status text not null default 'draft',
      currency text not null default 'KRW',
      price numeric(14,2) not null default 0,
      requested_publication_intent text not null default 'safe_test',
      remote_visibility text not null default 'unknown',
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      seller_account_key text,
      published_at timestamptz,
      last_verified_at timestamptz,
      last_error text,
      failure_class text,
      updated_at timestamptz not null default now(),
      unique(owner_id,product_id,channel_key,market,target_id)
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      attempt_id uuid,
      listing_id uuid references sellerpilot_private.product_listings(id),
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb,
      status text not null default 'queued',
      seller_account_key text,
      created_by uuid not null references auth.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
      on sellerpilot_private.channel_gateway_jobs(listing_id)
      where listing_id is not null
        and operation in ('listing.create','listing.update','listing.stop','price.update','inventory.update','listing.lineage.verify')
        and status in ('queued','running','reconciliation_required');
    create table sellerpilot_private.provider_listing_lineage_attestations (
      id uuid primary key default gen_random_uuid(),
      listing_id uuid not null unique references sellerpilot_private.product_listings(id),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      gateway_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id),
      seller_account_key text not null,
      channel text not null,
      environment text not null,
      expected_remote_id text not null,
      verified_remote_id text not null,
      market text not null,
      target_id text not null
    );
    create table sellerpilot_private.operation_audit (
      id bigint generated always as identity primary key,
      owner_id uuid,
      action text not null,
      entity_type text not null,
      entity_id text,
      safe_detail jsonb not null default '{}'::jsonb
    );
    create function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger language plpgsql as $$
begin
  if old.seller_account_key is null
     and new.seller_account_key is not null
     and (to_jsonb(new)-'seller_account_key') = (to_jsonb(old)-'seller_account_key') then
    return new;
  end if;
  if to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'listing mutation blocked';
  end if;
  return new;
end;
$$;
    create trigger guard_product_listing_seller_lineage
      before update on sellerpilot_private.product_listings
      for each row execute function sellerpilot_private.guard_product_listing_seller_lineage();
    create function public.sellerpilot_complete_listing_lineage_verification(
      p_token_hash text,
      p_job_id uuid,
      p_claim_token uuid,
      p_status text,
      p_response_payload jsonb default null,
      p_error_message text default null
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare v_job record;
    begin
      select * into v_job from sellerpilot_private.channel_gateway_jobs
       where id=p_job_id for update;
      if not found or v_job.status<>'running' or p_status<>'succeeded' then
        return jsonb_build_object('status','lease_lost','job_id',p_job_id,'reused',true);
      end if;
      insert into sellerpilot_private.provider_listing_lineage_attestations(
        listing_id,credential_id,gateway_job_id,seller_account_key,channel,
        environment,expected_remote_id,verified_remote_id,market,target_id
      ) values(
        v_job.listing_id,v_job.credential_id,v_job.id,v_job.seller_account_key,
        v_job.channel,v_job.environment,
        v_job.request_payload#>>'{arguments,expectedRemoteId}',
        v_job.request_payload#>>'{arguments,expectedRemoteId}',
        v_job.request_payload#>>'{arguments,market}',
        v_job.request_payload#>>'{arguments,targetId}'
      );
      update sellerpilot_private.product_listings
         set seller_account_key=v_job.seller_account_key
       where id=v_job.listing_id;
      update sellerpilot_private.channel_gateway_jobs
         set status='succeeded',response_payload=p_response_payload,updated_at=now()
       where id=v_job.id;
      return jsonb_build_object(
        'status','bound','job_id',v_job.id,'listing_id',v_job.listing_id,
        'reused',false
      );
    end;
    $$;
  `);
  await db.exec(migration);
  await db.query("insert into auth.users(id) values($1),($2)", [ownerId, actorId]);
  await db.query("insert into sellerpilot_private.admin_users(user_id) values($1)", [actorId]);
  await db.query(
    `insert into sellerpilot_private.products(id,owner_id,sku,demo,status)
     values($1,$2,'QA-20260823-CC-001',false,'active')`,
    [productId, ownerId],
  );
  return db;
}

async function installCredential(db, payloadOverrides = {}) {
  const secret = {
    partner_id: "2031489",
    partner_key: "private-partner-key",
    shop_id: "1719148844",
    shop_ids: ["1719148844"],
    merchant_id: "5511564",
    merchant_ids: ["5511564"],
    shopee_targets: [
      { type: "shop", id: "1719148844" },
      { type: "merchant", id: "5511564" },
    ],
    provider_account_identity_version: "v1",
    provider_account_subject: "shopee:main:4940266",
    ...payloadOverrides,
  };
  await db.query("insert into vault.secrets(id,secret) values($1,$2)", [vaultId, JSON.stringify(secret)]);
  await db.query(
    `insert into sellerpilot_private.channel_credentials(
       id,channel,environment,created_by,vault_secret_id,status,expires_at,
       seller_account_key,seller_account_key_source,seller_account_verified_at
     ) values($1,'shopee','production',$2,$3,'active',now()+interval '1 day',
       $4,'provider_certified_v1',now())`,
    [credentialId, ownerId, vaultId, sellerKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_market_targets(
       owner_id,credential_id,channel,environment,market_code,target_id,locale,currency
     ) values($1,$2,'shopee','production','SG','1719148844','en-SG','SGD')`,
    [ownerId, credentialId],
  );
}

function completionPayload(overrides = {}) {
  return {
    ok: true,
    channel: "shopee",
    operation: "listing.lineage.verify",
    evidenceVersion: "provider_listing_readback_v1",
    expectedRemoteId: "53717126190",
    verifiedRemoteId: "53717126190",
    market: "SG",
    targetId: "1719148844",
    verification: "exact_provider_readback",
    shopeeAdoption: {
      contract: "sellerpilot_shopee_sg_existing_adoption_readback_v1",
      itemId: "53717126190",
      sku: "QA-20260823-CC-001",
      merchantId: "5511564",
      shopId: "1719148844",
      market: "SG",
      locale: "en-SG",
      currency: "SGD",
      price: 16.77,
      providerStatus: "UNLIST",
      galleryImageCount: 9,
      detailImageCount: 8,
      representativeImageVerified: true,
      titleLanguageVerified: true,
      descriptionLanguageVerified: true,
      titleDigest: "b".repeat(64),
      descriptionDigest: "c".repeat(64),
      ...overrides,
    },
  };
}

test("Shopee SG exact adoption migration is ordered and exposes no direct browser execution", () => {
  assert.match(migration, /never calls listing\.create/u);
  assert.match(migration, /sellerpilot_service_enqueue_shopee_sg_existing_adoption/u);
  assert.match(migration, /sellerpilot_09011715_complete_lineage_before_shopee_adoption/u);
  assert.match(migration, /from public, anon, authenticated;/u);
  assert.doesNotMatch(migration, /grant execute[\s\S]*?to authenticated/u);
});

test("PGlite adopts one exact existing item without a duplicate create and projects verified UNLIST state", async () => {
  const db = await database();
  try {
    const unavailable = await scalar(db,
      "select public.sellerpilot_service_enqueue_shopee_sg_existing_adoption($1,$2,$3) value",
      [actorId, productId, credentialId],
    );
    assert.equal(unavailable.status, "manual_required");
    assert.equal(unavailable.reason, "credential_target_mismatch");
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.product_listings"), 0);

    await installCredential(db);
    const queued = await scalar(db,
      "select public.sellerpilot_service_enqueue_shopee_sg_existing_adoption($1,$2,$3) value",
      [actorId, productId, credentialId],
    );
    assert.equal(queued.status, "queued");
    assert.equal(queued.reused, false);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='listing.create'"), 0);
    assert.equal(await scalar(db,
      "select request_payload#>>'{arguments,sellerpilotShopeeSgExistingAdoption,itemId}' from sellerpilot_private.channel_gateway_jobs where id=$1",
      [queued.job_id]), "53717126190");

    const reused = await scalar(db,
      "select public.sellerpilot_service_enqueue_shopee_sg_existing_adoption($1,$2,$3) value",
      [actorId, productId, credentialId],
    );
    assert.equal(reused.job_id, queued.job_id);
    assert.equal(reused.reused, true);

    await db.query("update sellerpilot_private.channel_gateway_jobs set status='running' where id=$1", [queued.job_id]);
    await assert.rejects(db.query(
      `select public.sellerpilot_complete_listing_lineage_verification(
         $1,$2,$3,'succeeded',$4::jsonb,null
       )`,
      ["d".repeat(64), queued.job_id, claimToken, JSON.stringify(completionPayload({ currency: "MYR" }))],
    ), /Shopee adoption provider evidence mismatch/u);
    assert.equal(await scalar(db,
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [queued.job_id]), "running");
    assert.equal(await scalar(db,
      "select seller_account_key is null from sellerpilot_private.product_listings where id=$1", [queued.listing_id]), true);

    const completed = await scalar(db,
      `select public.sellerpilot_complete_listing_lineage_verification(
         $1,$2,$3,'succeeded',$4::jsonb,null
       ) value`,
      ["d".repeat(64), queued.job_id, claimToken, JSON.stringify(completionPayload())],
    );
    assert.equal(completed.status, "bound");
    const listing = (await db.query(
      `select remote_id,marketplace_sku,status,currency,price::text,
              requested_publication_intent,remote_visibility,provider_status,
              seller_account_key,last_verified_at is not null as verified,
              remote_resources#>>'{resources,localItemId}' as local_item_id,
              remote_resources#>>'{verification,detailImageCount}' as detail_count
         from sellerpilot_private.product_listings where id=$1`,
      [queued.listing_id],
    )).rows[0];
    assert.deepEqual(listing, {
      remote_id: "53717126190",
      marketplace_sku: "QA-20260823-CC-001",
      status: "paused",
      currency: "SGD",
      price: "16.77",
      requested_publication_intent: "safe_test",
      remote_visibility: "non_public",
      provider_status: "UNLIST",
      seller_account_key: sellerKey,
      verified: true,
      local_item_id: "53717126190",
      detail_count: "8",
    });
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.provider_listing_lineage_attestations"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.shopee_existing_adoption_attestations"), 1);
    const status = await scalar(db,
      "select public.sellerpilot_service_get_shopee_sg_existing_adoption_status($1,$2) value",
      [actorId, productId],
    );
    assert.equal(status.status, "already_bound");

    await assert.rejects(db.query(
      "update sellerpilot_private.shopee_existing_adoption_attestations set price=17 where listing_id=$1",
      [queued.listing_id],
    ), /immutable/u);
    await assert.rejects(db.query(
      "update sellerpilot_private.product_listings set price=17 where id=$1",
      [queued.listing_id],
    ), /listing mutation blocked/u);
  } finally {
    await db.close();
  }
});

test("PGlite rejects a credential that cannot prove both the exact merchant and shop", async () => {
  const db = await database();
  try {
    await installCredential(db, {
      merchant_id: "5511565",
      merchant_ids: ["5511565"],
      shopee_targets: [{ type: "shop", id: "1719148844" }],
    });
    assert.equal(await scalar(db,
      "select sellerpilot_private.shopee_sg_existing_adoption_credential_allowed($1)",
      [credentialId]), false);
    const result = await scalar(db,
      "select public.sellerpilot_service_enqueue_shopee_sg_existing_adoption($1,$2,$3) value",
      [actorId, productId, credentialId],
    );
    assert.equal(result.status, "manual_required");
    assert.equal(result.reason, "credential_target_mismatch");
  } finally {
    await db.close();
  }
});
