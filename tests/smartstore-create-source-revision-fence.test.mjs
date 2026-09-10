import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const { bindSmartstoreListingCreateSourceIdentity } = await import(
  "../lib/server-smartstore-listing-create-binding.ts"
);

const migration = await readFile(new URL(
  "../supabase/migrations/20260910010000_fence_smartstore_create_source_revision.sql",
  import.meta.url,
), "utf8");

const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  product: "10000000-0000-4000-8000-000000000002",
  aiJob: "10000000-0000-4000-8000-000000000003",
  credential: "10000000-0000-4000-8000-000000000004",
  attempt: "10000000-0000-4000-8000-000000000005",
  listing: "10000000-0000-4000-8000-000000000006",
  job: "10000000-0000-4000-8000-000000000007",
  claim: "10000000-0000-4000-8000-000000000008",
};
const digest = "a".repeat(64);
const sellerAccountKey = "b".repeat(64);

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.ai_cli_jobs(
      id uuid primary key,
      request_payload jsonb not null
    );
    create table sellerpilot_private.products(
      id uuid primary key,
      owner_id uuid not null,
      ai_job_id uuid,
      sku text not null,
      status text not null,
      demo boolean not null default false,
      updated_at timestamptz not null,
      detail_page_version bigint not null,
      detail_page_approved_version bigint not null,
      detail_page_image_manifest jsonb
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      last_check_status text,
      version integer not null,
      fingerprint text not null,
      seller_account_key text,
      seller_account_key_source text
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      remote_id text,
      seller_account_key text
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      operation_attempt_id uuid,
      seller_account_key text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      credential_id uuid not null,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb,
      status text not null,
      claim_token uuid,
      seller_account_key text,
      created_by uuid not null,
      provider_mutation_started_at timestamptz,
      completed_at timestamptz,
      response_payload jsonb
    );
    create function sellerpilot_private.request_has_unambiguous_service_role_claim()
    returns boolean language sql stable as $$ select true $$;
    create function public.sellerpilot_service_begin_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer as $$
    begin
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at = clock_timestamp()
       where id=p_job_id and claim_token=p_claim_token
         and status='running' and provider_mutation_started_at is null;
      return found;
    end $$;
    insert into sellerpilot_private.admin_users values ('${ids.owner}');
    insert into sellerpilot_private.ai_cli_jobs values (
      '${ids.aiJob}',
      '{"manual_fields":{"sellerSku":"SMART-CURRENT-001"}}'
    );
    insert into sellerpilot_private.products values (
      '${ids.product}','${ids.owner}','${ids.aiJob}','PRODUCT-FALLBACK-001',
      'ready',false,'2026-09-10T00:00:00.123456+00:00',3,3,
      '{"digest":"${digest}"}'
    );
    insert into sellerpilot_private.channel_credentials values (
      '${ids.credential}','smartstore','production','active',
      '2099-01-01T00:00:00Z','passed',7,'ABCDEF123456',
      '${sellerAccountKey}','provider_certified_v1'
    );
    insert into sellerpilot_private.channel_operation_attempts values (
      '${ids.attempt}','${ids.owner}','${ids.credential}','smartstore',
      'listing.create','running',null,'${sellerAccountKey}'
    );
    insert into sellerpilot_private.product_listings values (
      '${ids.listing}','${ids.owner}','${ids.product}','smartstore',
      '${ids.attempt}',null
    );
    insert into sellerpilot_private.channel_gateway_jobs values (
      '${ids.job}','${ids.credential}','${ids.attempt}','${ids.listing}',
      'smartstore','listing.create','production',
      jsonb_build_object('arguments',jsonb_build_object(
        'sellerpilotSmartstoreCreateSource',jsonb_build_object(
          'contract','smartstore_listing_create_source_v1',
          'productId','${ids.product}',
          'ownerId','${ids.owner}',
          'productUpdatedAt','2026-09-10T00:00:00.123456+00:00',
          'detailPageVersion',3,
          'approvedDetailPageVersion',3,
          'approvedManifestDigest','${digest}',
          'sellerManagementCode','SMART-CURRENT-001',
          'credentialId','${ids.credential}',
          'credentialVersion',7,
          'credentialFingerprint','ABCDEF123456'
        ),
        'body',jsonb_build_object('originProduct',jsonb_build_object(
          'detailAttribute',jsonb_build_object('sellerCodeInfo',jsonb_build_object(
            'sellerManagementCode','SMART-CURRENT-001'
          ))
        ))
      )),
      'running','${ids.claim}','${sellerAccountKey}','${ids.owner}',null,null,null
    );
  `);
  return db;
}

async function allowed(db) {
  const result = await db.query(
    `select sellerpilot_private.smartstore_create_source_is_current($1,$2) as allowed`,
    [ids.job, ids.claim],
  );
  return result.rows[0].allowed;
}

test("SmartStore local and serverless source fences compose with the Shopee execution wrapper", async () => {
  const db = await createDatabase();
  try {
    await db.exec(migration);
    // Install the later wrapper against the same database. The predecessor
    // transports are fixture functions; all three actual migrations are unmodified.
    await db.exec(`
      create schema vault;
      create table vault.decrypted_secrets(id uuid, decrypted_secret text);
      alter table sellerpilot_private.channel_credentials
        add column created_by uuid, add column vault_secret_id uuid;
      create table sellerpilot_private.channel_market_targets(
        id uuid, owner_id uuid, credential_id uuid, credential_version integer,
        channel text, environment text, target_id text, market_code text,
        locale text, language text, currency text, verified_at timestamptz
      );
      create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
        p_token_hash text,p_job_id uuid,p_claim_token uuid
      ) returns boolean language plpgsql as $$
      begin
        update sellerpilot_private.channel_gateway_jobs
           set provider_mutation_started_at=clock_timestamp()
         where id=p_job_id and claim_token=p_claim_token
           and status='running' and provider_mutation_started_at is null;
        return found;
      end $$;
      create function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
        text,uuid,uuid,text,text
      ) returns jsonb language sql as 'select ''{"status":"conflict"}''::jsonb';
    `);
    await db.exec(await readFile(new URL(
      "../supabase/migrations/20260910013000_bind_shopee_sg_create_execution_lineage.sql",
      import.meta.url,
    ), "utf8"));
    await db.exec(await readFile(new URL(
      "../supabase/migrations/20260910014000_fence_smartstore_serverless_create_source_revision.sql",
      import.meta.url,
    ), "utf8"));
    for (const rpc of [
      "sellerpilot_service_begin_gateway_provider_mutation",
      "sellerpilot_service_begin_serverless_gateway_provider_mutation",
    ]) {
      await db.exec(`update sellerpilot_private.channel_gateway_jobs
        set provider_mutation_started_at=null where id='${ids.job}'`);
      const begin = async () => (await db.query(
        `select public.${rpc}('token',$1,$2) as started`,
        [ids.job, ids.claim],
      )).rows[0].started;
      await db.exec(`update sellerpilot_private.products
        set updated_at = updated_at + interval '1 microsecond'`);
      assert.equal(await begin(), false, `${rpc} rejects source drift`);
      await db.exec(`update sellerpilot_private.products
        set updated_at = updated_at - interval '1 microsecond'`);
      assert.equal(await begin(), true, `${rpc} allows current source`);
      assert.equal(await begin(), false, `${rpc} rejects replay`);
    }
  } finally {
    await db.close();
  }
});

test("a legacy-shaped mutation stub accepts a queued product after its SKU changed", async () => {
  const db = await createDatabase();
  await db.exec(`update sellerpilot_private.ai_cli_jobs
    set request_payload='{"manual_fields":{"sellerSku":"SMART-CHANGED-002"}}'`);
  const result = await db.query(
    `select public.sellerpilot_service_begin_gateway_provider_mutation('token',$1,$2) as started`,
    [ids.job, ids.claim],
  );
  assert.equal(result.rows[0].started, true);
  await db.close();
});

test("the final boundary rejects product, SKU, detail, credential, owner and replay drift", async () => {
  const db = await createDatabase();
  await db.exec(migration);

  const snapshot = await db.query(
    `select public.sellerpilot_service_smartstore_create_source_snapshot($1,$2,$3) as snapshot`,
    [ids.owner, ids.product, ids.credential],
  );
  assert.deepEqual(snapshot.rows[0].snapshot, {
    contract: "smartstore_listing_create_source_snapshot_v1",
    productId: ids.product,
    ownerId: ids.owner,
    productUpdatedAt: "2026-09-10T00:00:00.123456+00:00",
    detailPageVersion: 3,
    approvedDetailPageVersion: 3,
    approvedManifestDigest: digest,
    sellerManagementCode: "SMART-CURRENT-001",
    credentialId: ids.credential,
    credentialVersion: 7,
    credentialFingerprint: "ABCDEF123456",
  });
  assert.equal(await allowed(db), true);

  const driftCases = [
    ["product revision", `update sellerpilot_private.products set updated_at=updated_at+interval '1 second'`, `update sellerpilot_private.products set updated_at='2026-09-10T00:00:00.123456+00:00'`],
    ["product status", `update sellerpilot_private.products set status='draft'`, `update sellerpilot_private.products set status='ready'`],
    ["seller SKU", `update sellerpilot_private.ai_cli_jobs set request_payload='{"manual_fields":{"sellerSku":"SMART-CHANGED-002"}}'`, `update sellerpilot_private.ai_cli_jobs set request_payload='{"manual_fields":{"sellerSku":"SMART-CURRENT-001"}}'`],
    ["detail revision", `update sellerpilot_private.products set detail_page_version=4,detail_page_approved_version=4`, `update sellerpilot_private.products set detail_page_version=3,detail_page_approved_version=3`],
    ["manifest digest", `update sellerpilot_private.products set detail_page_image_manifest=jsonb_build_object('digest','${"c".repeat(64)}')`, `update sellerpilot_private.products set detail_page_image_manifest=jsonb_build_object('digest','${digest}')`],
    ["credential version", `update sellerpilot_private.channel_credentials set version=8`, `update sellerpilot_private.channel_credentials set version=7`],
    ["credential fingerprint", `update sellerpilot_private.channel_credentials set fingerprint='FEDCBA654321'`, `update sellerpilot_private.channel_credentials set fingerprint='ABCDEF123456'`],
    ["credential state", `update sellerpilot_private.channel_credentials set status='grace'`, `update sellerpilot_private.channel_credentials set status='active'`],
    ["owner relation", `update sellerpilot_private.channel_gateway_jobs set created_by='10000000-0000-4000-8000-000000000099'`, `update sellerpilot_private.channel_gateway_jobs set created_by='${ids.owner}'`],
    ["null binding", `update sellerpilot_private.channel_gateway_jobs set request_payload=request_payload #- '{arguments,sellerpilotSmartstoreCreateSource}'`, null],
  ];
  for (const [name, mutate, restore] of driftCases) {
    await db.exec(mutate);
    assert.equal(await allowed(db), false, name);
    if (restore) await db.exec(restore);
    else {
      await db.close();
      return;
    }
    assert.equal(await allowed(db), true, `${name} restore`);
  }
});

test("snapshot to TypeScript binding preserves microseconds and one microsecond drift fails", async () => {
  const db = await createDatabase();
  await db.exec(migration);
  const snapshotResult = await db.query(
    `select public.sellerpilot_service_smartstore_create_source_snapshot($1,$2,$3) as snapshot`,
    [ids.owner, ids.product, ids.credential],
  );
  const snapshot = {
    ...snapshotResult.rows[0].snapshot,
    credentialVaultSecretId: "77777777-7777-4777-8777-777777777777",
    credentialLastRotatedAt: "2026-09-10T00:00:00.123456+00:00",
    productName: "스마트스토어 현재 소스",
    salePrice: 10_000,
    stockQuantity: 1,
    manualFieldsSha256: "e".repeat(64),
  };
  const bound = bindSmartstoreListingCreateSourceIdentity({
    argumentsValue: {
      body: {
        originProduct: {
          name: "스마트스토어 현재 소스",
          salePrice: 10_000,
          stockQuantity: 1,
          detailAttribute: {
            sellerCodeInfo: { sellerManagementCode: "SMART-CURRENT-001" },
          },
        },
        smartstoreChannelProduct: {
          channelProductName: "스마트스토어 현재 소스",
        },
      },
    },
    publishContext: {
      ownerId: ids.owner,
      product: {
        id: ids.product,
        sku: "PRODUCT-FALLBACK-001",
        status: "ready",
        name: "스마트스토어 현재 소스",
        onHand: 1,
      },
      manualFields: {
        sellerSku: "SMART-CURRENT-001",
        productName: "스마트스토어 현재 소스",
        sellingPrice: 10_000,
        stock: 1,
      },
      listings: [],
    },
    sourceSnapshot: snapshot,
    approvedDetail: { version: 3, manifest: { digest } },
    productId: ids.product,
    credentialId: ids.credential,
    market: "KR",
    targetId: "",
  });
  assert.equal(
    bound.sellerpilotSmartstoreCreateSource.productUpdatedAt,
    "2026-09-10T00:00:00.123456+00:00",
  );
  await db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set request_payload=jsonb_build_object('arguments',$1::jsonb)
      where id=$2`,
    [JSON.stringify(bound), ids.job],
  );
  assert.equal(await allowed(db), true);
  await db.exec(`update sellerpilot_private.products
    set updated_at=updated_at+interval '0.000001 second'`);
  assert.equal(await allowed(db), false);
  await db.close();
});

test("wrong claim and duplicate provider-boundary replay fail closed", async () => {
  const db = await createDatabase();
  await db.exec(migration);
  const wrongClaim = await db.query(
    `select sellerpilot_private.smartstore_create_source_is_current($1,$2) as allowed`,
    [ids.job, "10000000-0000-4000-8000-000000000099"],
  );
  assert.equal(wrongClaim.rows[0].allowed, false);

  const first = await db.query(
    `select public.sellerpilot_service_begin_gateway_provider_mutation('token',$1,$2) as started`,
    [ids.job, ids.claim],
  );
  assert.equal(first.rows[0].started, true);
  const replay = await db.query(
    `select public.sellerpilot_service_begin_gateway_provider_mutation('token',$1,$2) as started`,
    [ids.job, ids.claim],
  );
  assert.equal(replay.rows[0].started, false);

  const privileges = await db.query(`
    select
      has_function_privilege('authenticated',
        'public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)',
        'execute') as authenticated_snapshot,
      has_function_privilege('authenticated',
        'sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)',
        'execute') as authenticated_private,
      has_function_privilege('service_role',
        'public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)',
        'execute') as service_snapshot
  `);
  assert.deepEqual(privileges.rows[0], {
    authenticated_snapshot: false,
    authenticated_private: false,
    service_snapshot: true,
  });
  await db.close();
});
