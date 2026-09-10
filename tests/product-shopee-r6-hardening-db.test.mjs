import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260910044000_shopee_create_transport_and_successor_hardening_r6.sql",
  import.meta.url,
), "utf8");

async function compatibilityLayer() {
  const fixture = await readFile(
    new URL("./provider-listing-lineage-rebind.test.mjs", import.meta.url),
    "utf8",
  );
  const match = fixture.match(
    /const supabaseCompatibilityLayer = String\.raw`([\s\S]*?)`;\n/u,
  );
  assert.ok(match, "shared PGlite compatibility layer is required");
  return match[1];
}

const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  oldCredential: "20000000-0000-4000-8000-000000000001",
  newCredential: "20000000-0000-4000-8000-000000000002",
  vaultOld: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  vaultNew: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  attempt: "30000000-0000-4000-8000-000000000001",
  listing: "40000000-0000-4000-8000-000000000001",
  product: "50000000-0000-4000-8000-000000000001",
  job: "60000000-0000-4000-8000-000000000001",
  claim: "70000000-0000-4000-8000-000000000001",
  target: "90000000-0000-4000-8000-000000000001",
};
const title = "Lotte Sand Milk Cream Biscuits 315g Pack of 6";
const sku = "AUTO-780720401E2D4E4EA45F";
const fullDraft = {
  common: { fields: { productName: title }, price: 25000, globalBaseUsdPrice: 20, quantity: 3 },
  channels: { sg: { categoryId: "100787", patches: [{ path: ["publish", "item", "original_price"], value: 25 }] } },
};

async function fixture() {
  const db = new PGlite();
  await db.exec(await compatibilityLayer());
  await db.exec(`
    alter table vault.secrets add column if not exists updated_at timestamptz;
    update vault.secrets set updated_at = now() where updated_at is null;
    create schema if not exists sellerpilot_private;
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      created_by uuid not null,
      channel text not null,
      environment text not null,
      status text not null,
      version integer not null,
      vault_secret_id uuid
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      claim_token uuid,
      status text not null,
      channel text not null,
      operation text not null,
      environment text not null,
      created_by uuid not null,
      credential_id uuid not null,
      listing_id uuid not null,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_market_targets (
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      credential_version integer,
      channel text not null,
      environment text not null,
      target_id text not null,
      market_code text not null,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      product_id uuid not null,
      owner_id uuid not null,
      channel_key text not null,
      status text not null
    );
    create table sellerpilot_private.product_registration_drafts (
      id bigint primary key,
      owner_id uuid not null,
      product_id uuid,
      kind text not null,
      data jsonb not null
    );
    create table sellerpilot_private.shopee_sg_create_stage_receipts (
      id uuid primary key default gen_random_uuid(),
      listing_id uuid not null,
      source_job_id uuid not null,
      source_attempt_id uuid not null,
      owner_id uuid not null,
      credential_id uuid not null,
      credential_version integer not null,
      merchant_id text not null,
      shop_id text not null,
      seller_sku text not null,
      request_fingerprint text not null,
      approved_detail_page_version integer not null default 1,
      approved_manifest_digest text not null default repeat('b', 64),
      prepared_payload_sha256 text not null,
      stage_sequence smallint not null,
      stage_name text not null,
      global_item_id text,
      status text not null,
      output_id text,
      result jsonb,
      started_at timestamptz not null default clock_timestamp(),
      completed_at timestamptz
    );
    create table sellerpilot_private.shopee_sg_global_create_receipts (
      id uuid primary key default gen_random_uuid(),
      source_job_id uuid not null,
      source_attempt_id uuid not null,
      listing_id uuid not null,
      owner_id uuid not null,
      credential_id uuid not null,
      credential_version integer not null,
      merchant_id text not null,
      shop_id text not null,
      seller_sku text not null,
      global_item_name text not null,
      local_item_name text not null,
      request_fingerprint text not null,
      prepared_payload_sha256 text not null,
      global_item_id text not null,
      prepared_arguments jsonb not null default '{}'::jsonb,
      create_response jsonb not null default '{}'::jsonb,
      readback_response jsonb not null default '{}'::jsonb,
      create_response_sha256 text not null default repeat('c', 64),
      readback_response_sha256 text not null default repeat('d', 64),
      created_at timestamptz not null default clock_timestamp()
    );
  `);
  await db.exec(migration);
  await db.query(
    "insert into vault.secrets (id, secret, updated_at) values ($1,'old',timestamptz '2026-09-10T04:00:00Z'), ($2,'new',timestamptz '2026-09-10T04:10:00Z')",
    [ids.vaultOld, ids.vaultNew],
  );
  await db.query(
    "insert into sellerpilot_private.channel_credentials values ($1,$2,'shopee','production','active',81,$3),($4,$2,'shopee','production','active',82,$5)",
    [ids.oldCredential, ids.owner, ids.vaultOld, ids.newCredential, ids.vaultNew],
  );
  await db.query(
    "insert into sellerpilot_private.product_listings values ($1,$2,$3,'shopee','queued')",
    [ids.listing, ids.product, ids.owner],
  );
  await db.query(
    "insert into sellerpilot_private.product_registration_drafts values (1,$1,$2,'publish',$3::jsonb)",
    [ids.owner, ids.product, JSON.stringify(fullDraft)],
  );
  await db.query(
    "insert into sellerpilot_private.channel_gateway_jobs values ($1,$2,'running','shopee','listing.create','production',$3,$4,$5,clock_timestamp())",
    [ids.job, ids.claim, ids.owner, ids.oldCredential, ids.listing],
  );
  await db.query(
    "insert into sellerpilot_private.channel_market_targets values ($1,$2,$3,81,'shopee','production','1719148844','SG',clock_timestamp())",
    [ids.target, ids.owner, ids.oldCredential],
  );
  return db;
}

test("r6 warehouse list body rejects warehouse_type bypass and hashes exact bytes", async () => {
  const db = await fixture();
  try {
    const allowed = await db.query(
      "select sellerpilot_private.assert_shopee_sg_wh_list_body_v1($1::jsonb) value",
      [JSON.stringify({ cursor: { next_id: 0, page_size: 30 } })],
    );
    assert.deepEqual(allowed.rows[0].value, { cursor: { next_id: 0, page_size: 30 } });
    await assert.rejects(
      db.query(
        "select sellerpilot_private.assert_shopee_sg_wh_list_body_v1($1::jsonb)",
        [JSON.stringify({ warehouse_type: 1, cursor: { next_id: 0, page_size: 30 } })],
      ),
      /SHOPEE_SG_WAREHOUSE_LIST_BODY_FORBIDDEN/u,
    );
    const bytes = '{"global_item_name":"Lotte"}';
    const sha = await db.query(
      "select encode(extensions.digest($1, 'sha256'), 'hex') value",
      [bytes],
    );
    const ok = await db.query(
      "select sellerpilot_private.assert_shopee_sg_transport_bytes_v1($1,$2) value",
      [bytes, sha.rows[0].value],
    );
    assert.equal(ok.rows[0].value, sha.rows[0].value);
    await assert.rejects(
      db.query(
        "select sellerpilot_private.assert_shopee_sg_transport_bytes_v1($1,$2)",
        [bytes, "a".repeat(64)],
      ),
      /SHOPEE_SG_TRANSPORT_BYTES_MISMATCH/u,
    );
  } finally {
    await db.close();
  }
});

test("r6 exact-one full-draft cardinality rejects a matching draft plus a stale current draft", async () => {
  const db = await fixture();
  try {
    const one = await db.query(
      "select sellerpilot_private.assert_shopee_sg_one_full_draft_v1($1,$2) value",
      [ids.owner, ids.product],
    );
    assert.equal(one.rows[0].value.channels.sg.categoryId, "100787");
    await db.query(
      "insert into sellerpilot_private.product_registration_drafts values (2,$1,$2,'publish',$3::jsonb)",
      [ids.owner, ids.product, JSON.stringify({ common: { fields: { productName: "stale" } }, channels: { sg: {} } })],
    );
    await assert.rejects(
      db.query(
        "select sellerpilot_private.assert_shopee_sg_one_full_draft_v1($1,$2)",
        [ids.owner, ids.product],
      ),
      /SHOPEE_SG_FULL_DRAFT_CARDINALITY/u,
    );
  } finally {
    await db.close();
  }
});

test("r6 successor rebind moves completed receipts and binds the current Vault incarnation", async () => {
  const db = await fixture();
  try {
    await db.query(`
      insert into sellerpilot_private.shopee_sg_create_stage_receipts (
        listing_id, source_job_id, source_attempt_id, owner_id, credential_id,
        credential_version, merchant_id, shop_id, seller_sku, request_fingerprint,
        prepared_payload_sha256, stage_sequence, stage_name, global_item_id,
        status, output_id, result, completed_at
      ) values (
        $1,$2,$3,$4,$5,81,'5511564','1719148844',$6,repeat('a',64),repeat('e',64),
        10,'local-publish','9001','completed','8001','{}'::jsonb, clock_timestamp()
      )
    `, [ids.listing, ids.job, ids.attempt, ids.owner, ids.oldCredential, sku]);
    await db.query(`
      insert into sellerpilot_private.shopee_sg_global_create_receipts (
        source_job_id, source_attempt_id, listing_id, owner_id, credential_id,
        credential_version, merchant_id, shop_id, seller_sku, global_item_name,
        local_item_name, request_fingerprint, prepared_payload_sha256, global_item_id
      ) values (
        $1,$2,$3,$4,$5,81,'5511564','1719148844',$6,$7,$7,repeat('a',64),repeat('e',64),'9001'
      )
    `, [ids.job, ids.attempt, ids.listing, ids.owner, ids.oldCredential, sku, title]);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set credential_id=$2 where id=$1",
      [ids.job, ids.newCredential],
    );
    const receipt = (await db.query(
      "select sellerpilot_private.rebind_shopee_sg_successor_v1($1,$2) value",
      [ids.job, ids.claim],
    )).rows[0].value;
    assert.equal(receipt.credentialId, ids.newCredential);
    assert.equal(receipt.credentialVersion, 82);
    assert.equal(receipt.vaultSecretId, ids.vaultNew);
    const stage = (await db.query(
      "select credential_id, credential_version, vault_secret_id from sellerpilot_private.shopee_sg_create_stage_receipts where listing_id=$1",
      [ids.listing],
    )).rows[0];
    assert.equal(stage.credential_id, ids.newCredential);
    assert.equal(stage.credential_version, 82);
    assert.equal(stage.vault_secret_id, ids.vaultNew);
    const global = (await db.query(
      "select credential_id, vault_secret_id from sellerpilot_private.shopee_sg_global_create_receipts where listing_id=$1",
      [ids.listing],
    )).rows[0];
    assert.equal(global.credential_id, ids.newCredential);
    assert.equal(global.vault_secret_id, ids.vaultNew);
    const leftover = (await db.query(
      "select count(*)::int count from sellerpilot_private.shopee_sg_create_stage_receipts where credential_id=$1",
      [ids.oldCredential],
    )).rows[0].count;
    assert.equal(leftover, 0);
  } finally {
    await db.close();
  }
});

test("r6 local-publish completion writes mapping and internal job success atomically", async () => {
  const db = await fixture();
  try {
    await db.query(`
      insert into sellerpilot_private.shopee_sg_create_stage_receipts (
        listing_id, source_job_id, source_attempt_id, owner_id, credential_id,
        credential_version, merchant_id, shop_id, seller_sku, request_fingerprint,
        prepared_payload_sha256, stage_sequence, stage_name, global_item_id, status
      ) values (
        $1,$2,$3,$4,$5,81,'5511564','1719148844',$6,repeat('a',64),repeat('e',64),
        10,'local-publish','9001','started'
      )
    `, [ids.listing, ids.job, ids.attempt, ids.owner, ids.oldCredential, sku]);
    await db.query(`
      update sellerpilot_private.shopee_sg_create_stage_receipts
         set status='completed', output_id='8001', result='{}'::jsonb,
             completed_at=clock_timestamp()
       where listing_id=$1 and stage_sequence=10
    `, [ids.listing]);
    const map = (await db.query(
      "select global_item_id, local_item_id, credential_id, vault_secret_id from sellerpilot_private.shopee_sg_create_completion_map where listing_id=$1",
      [ids.listing],
    )).rows[0];
    assert.equal(map.global_item_id, "9001");
    assert.equal(map.local_item_id, "8001");
    assert.equal(map.credential_id, ids.oldCredential);
    assert.equal(map.vault_secret_id, ids.vaultOld);
    const job = (await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [ids.job],
    )).rows[0];
    assert.equal(job.status, "succeeded");
    await db.query("delete from sellerpilot_private.product_registration_drafts");
    await assert.rejects(
      db.query(`
        insert into sellerpilot_private.shopee_sg_create_stage_receipts (
          listing_id, source_job_id, source_attempt_id, owner_id, credential_id,
          credential_version, merchant_id, shop_id, seller_sku, request_fingerprint,
          prepared_payload_sha256, stage_sequence, stage_name, status
        ) values (
          $1,$2,$3,$4,$5,81,'5511564','1719148844',$6,repeat('a',64),repeat('f',64),
          9,'global-item-create','started'
        )
      `, [ids.listing, ids.job, ids.attempt, ids.owner, ids.oldCredential, sku]),
      /SHOPEE_SG_FULL_DRAFT_CARDINALITY/u,
    );
  } finally {
    await db.close();
  }
});
