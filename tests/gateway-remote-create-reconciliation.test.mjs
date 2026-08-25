import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260825104500_prepare_gateway_credential_refresh.sql",
  import.meta.url,
);
const adminRouteUrl = new URL("../app/api/admin/channel-operations/route.ts", import.meta.url);

function functionDefinition(sql, name) {
  let start = sql.indexOf(`create or replace function ${name}`);
  if (start === -1) start = sql.indexOf(`create function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} must have a complete SQL body`);
  return sql.slice(start, end + 4);
}

function operationResult(channel, stepName, overrides = {}) {
  return {
    ok: false,
    channel,
    operation: "listing.create",
    remoteId: `${channel}-remote-123`,
    publicUrl: `https://example.com/${channel}-remote-123`,
    safeMessage: "Create returned an identity but readback still needs verification.",
    steps: [
      { name: stepName, ok: true, status: 200, data: {} },
      { name: "listing-readback", ok: false, status: 404, data: {} },
    ],
    ...overrides,
  };
}

async function observed(db, payload, operation = "listing.create") {
  const result = await db.query(
    "select sellerpilot_private.gateway_remote_create_observed($1, $2::jsonb) as observed",
    [operation, JSON.stringify(payload)],
  );
  return result.rows[0]?.observed;
}

async function externalWriteObserved(db, operation, payload) {
  const result = await db.query(
    "select sellerpilot_private.gateway_external_write_observed($1, $2::jsonb) as observed",
    [operation, JSON.stringify(payload)],
  );
  return result.rows[0]?.observed;
}

test("all gateway create implementations fence a returned remote identity after failed verification", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec("create schema sellerpilot_private");
    await db.exec(functionDefinition(
      migration,
      "sellerpilot_private.gateway_external_write_observed",
    ));
    await db.exec(functionDefinition(
      migration,
      "sellerpilot_private.gateway_remote_create_observed",
    ));

    const providerCases = [
      ["qoo10", "SetNewGoods"],
      ["elevenst", "product-create"],
      ["elevenst-no-id", "product-create-accepted"],
      ["lazada", "/product/create"],
      ["coupang", "listing.create"],
      ["smartstore", "product-reconcile"],
      ["temu", "goods-v3-add"],
      ["shopee", "global-item-create"],
      ["ebay", "offer-reconcile"],
      ["ebay-publish", "publish"],
    ];
    for (const [channel, stepName] of providerCases) {
      assert.equal(await observed(db, operationResult(channel, stepName)), true, channel);
      assert.equal(await observed(db, operationResult(channel, stepName, { remoteId: undefined })), true, `${channel}-missing-id`);
    }

    assert.equal(await observed(db, operationResult("shopee", "published-item-readback-25")), true);
    assert.equal(await observed(db, operationResult("temu", "unrelated-preflight")), false);
    assert.equal(await observed(db, operationResult("lazada", "/product/create"), "listing.update"), false);
    assert.equal(await observed(db, operationResult("coupang", "listing.create", { remoteId: undefined })), true);
    assert.equal(await observed(db, operationResult("elevenst", "product-create", { ok: true })), false);

    const mutationCases = [
      ["listing.update", "listing.update"],
      ["listing.stop", "goods-off-shelf"],
      ["price.update", "bulk-price"],
      ["inventory.update", "bulk-inventory"],
      ["shipment.acknowledge", "pack"],
      ["shipment.confirm", "shipment-confirm"],
    ];
    for (const [operation, stepName] of mutationCases) {
      assert.equal(await externalWriteObserved(db, operation, operationResult("ebay", stepName, {
        operation,
        remoteId: "resource-123",
      })), true, operation);
    }
    assert.equal(await externalWriteObserved(db, "inventory.update", operationResult("ebay", "inventory-readback", {
      operation: "inventory.update",
      steps: [
        { name: "inventory-readback", ok: true, status: 200, data: {} },
        { name: "bulk-inventory", ok: false, status: 409, data: {} },
      ],
    })), false, "readback success and explicit mutation rejection are not accepted writes");
    assert.equal(await externalWriteObserved(db, "shipment.confirm", operationResult("ebay", "shipping-fulfillment", {
      operation: "shipment.confirm",
      steps: [{ name: "shipping-fulfillment", ok: false, status: 503, data: {} }],
    })), true, "an exact mutation 5xx has an ambiguous provider outcome");
    assert.equal(await externalWriteObserved(db, "listing.update", operationResult("shopee", "listing.update", {
      operation: "listing.update",
      steps: [{ name: "listing.update", ok: false, status: 408, data: {} }],
    })), true, "an exact mutation timeout has an ambiguous provider outcome");
    assert.equal(await externalWriteObserved(db, "inventory.update", operationResult("ebay", "inventory-readback", {
      operation: "inventory.update",
      steps: [
        { name: "bulk-inventory", ok: false, status: 409, data: {} },
        { name: "inventory-readback", ok: false, status: 503, data: {} },
      ],
    })), false, "a readback 5xx is not a mutation and an explicit mutation rejection stays retryable");
  } finally {
    await db.close();
  }
});

test("gateway completion atomically preserves unverified remote create identity as manual reconciliation", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const tokenId = "10000000-0000-4000-8000-000000000001";
  const ownerId = "20000000-0000-4000-8000-000000000001";
  const productId = "30000000-0000-4000-8000-000000000001";
  const listingId = "40000000-0000-4000-8000-000000000001";
  const attemptId = "50000000-0000-4000-8000-000000000001";
  const jobId = "60000000-0000-4000-8000-000000000001";
  const claimToken = "70000000-0000-4000-8000-000000000001";
  const inventoryAttemptId = "50000000-0000-4000-8000-000000000002";
  const inventoryJobId = "60000000-0000-4000-8000-000000000002";
  const inventoryClaimToken = "70000000-0000-4000-8000-000000000002";
  const failedAttemptId = "50000000-0000-4000-8000-000000000003";
  const failedJobId = "60000000-0000-4000-8000-000000000003";
  const failedClaimToken = "70000000-0000-4000-8000-000000000003";
  const uncertainAttemptId = "50000000-0000-4000-8000-000000000005";
  const uncertainJobId = "60000000-0000-4000-8000-000000000005";
  const uncertainClaimToken = "70000000-0000-4000-8000-000000000005";
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.ai_cli_worker_tokens (
        id uuid primary key, token_hash text not null, status text not null,
        expires_at timestamptz not null
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key, attempt_id uuid, operation text not null, channel text not null,
        status text not null, worker_token_id uuid, claim_token uuid, lease_expires_at timestamptz,
        credential_refresh_in_flight boolean not null default false,
        oauth_request_vault_id uuid,
        oauth_exchange_completed boolean not null default false,
        response_payload jsonb, error_message text, completed_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key, status text not null, http_status integer, remote_id text,
        safe_message text, completed_at timestamptz
      );
      create table sellerpilot_private.products (
        id uuid primary key, status text not null, updated_at timestamptz not null default now()
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, product_id uuid not null, owner_id uuid not null,
        operation_attempt_id uuid, status text not null, remote_id text, public_url text,
        last_error text, failure_class text, published_at timestamptz,
        last_verified_at timestamptz, updated_at timestamptz not null default now()
      );
      create table sellerpilot_private.operation_audit (
        owner_id uuid, action text, entity_type text, entity_id text, safe_detail jsonb
      );
    `);
    await db.exec(functionDefinition(
      migration,
      "sellerpilot_private.gateway_external_write_observed",
    ));
    await db.exec(functionDefinition(
      migration,
      "sellerpilot_private.gateway_remote_create_observed",
    ));
    await db.exec(functionDefinition(
      migration,
      "public.sellerpilot_complete_channel_gateway_job",
    ));
    await db.query(
      "insert into sellerpilot_private.ai_cli_worker_tokens values ($1, 'token-hash', 'active', now() + interval '1 hour')",
      [tokenId],
    );
    await db.query("insert into sellerpilot_private.products(id,status) values ($1,'draft')", [productId]);
    await db.query(
      "insert into sellerpilot_private.channel_operation_attempts(id,status) values ($1,'running')",
      [attemptId],
    );
    await db.query(
      "insert into sellerpilot_private.product_listings(id,product_id,owner_id,operation_attempt_id,status) values ($1,$2,$3,$4,'queued')",
      [listingId, productId, ownerId, attemptId],
    );
    await db.query(
      "insert into sellerpilot_private.channel_gateway_jobs(id,attempt_id,operation,channel,status,worker_token_id,claim_token,lease_expires_at) values ($1,$2,'listing.create','lazada','running',$3,$4,now() + interval '1 hour')",
      [jobId, attemptId, tokenId, claimToken],
    );

    const payload = operationResult("lazada", "/product/create");
    const completed = await db.query(
      "select public.sellerpilot_complete_channel_gateway_job('token-hash',$1,$2,'succeeded',$3::jsonb,null) as completed",
      [jobId, claimToken, JSON.stringify(payload)],
    );
    assert.equal(completed.rows[0]?.completed, true);
    assert.deepEqual((await db.query(
      "select status, response_payload->>'remoteId' as response_remote_id, error_message from sellerpilot_private.channel_gateway_jobs where id=$1",
      [jobId],
    )).rows[0], {
      status: "reconciliation_required",
      response_remote_id: "lazada-remote-123",
      error_message: "원격 판매채널 변경이 적용됐을 가능성이 있으나 식별값 또는 후속 조회를 확정하지 못했습니다. 판매자센터에서 수동 확인하기 전에는 같은 작업을 다시 실행할 수 없습니다.",
    });
    assert.deepEqual((await db.query(
      "select status,http_status,remote_id from sellerpilot_private.channel_operation_attempts where id=$1",
      [attemptId],
    )).rows[0], {
      status: "manual_required",
      http_status: 409,
      remote_id: "lazada-remote-123",
    });
    const listing = (await db.query(
      "select status,remote_id,public_url,failure_class,published_at is not null as has_published_at,last_verified_at from sellerpilot_private.product_listings where id=$1",
      [listingId],
    )).rows[0];
    assert.deepEqual(listing, {
      status: "failed",
      remote_id: "lazada-remote-123",
      public_url: "https://example.com/lazada-remote-123",
      failure_class: "external_action",
      has_published_at: true,
      last_verified_at: null,
    });
    assert.equal((await db.query("select status from sellerpilot_private.products where id=$1", [productId])).rows[0]?.status, "draft");
    assert.equal((await db.query("select action from sellerpilot_private.operation_audit")).rows[0]?.action, "gateway_listing_reconciliation_required");

    const missingIdAttemptId = "50000000-0000-4000-8000-000000000004";
    const missingIdJobId = "60000000-0000-4000-8000-000000000004";
    const missingIdClaimToken = "70000000-0000-4000-8000-000000000004";
    const missingIdListingId = "40000000-0000-4000-8000-000000000004";
    await db.query(
      "insert into sellerpilot_private.channel_operation_attempts(id,status) values ($1,'running')",
      [missingIdAttemptId],
    );
    await db.query(
      "insert into sellerpilot_private.product_listings(id,product_id,owner_id,operation_attempt_id,status) values ($1,$2,$3,$4,'queued')",
      [missingIdListingId, productId, ownerId, missingIdAttemptId],
    );
    await db.query(
      "insert into sellerpilot_private.channel_gateway_jobs(id,attempt_id,operation,channel,status,worker_token_id,claim_token,lease_expires_at) values ($1,$2,'listing.create','qoo10','running',$3,$4,now() + interval '1 hour')",
      [missingIdJobId, missingIdAttemptId, tokenId, missingIdClaimToken],
    );
    const missingIdPayload = operationResult("qoo10", "SetNewGoods", {
      remoteId: undefined,
      publicUrl: undefined,
      safeMessage: "Provider acknowledged create but returned no identity.",
      steps: [{ name: "SetNewGoods", ok: true, status: 200, data: {} }],
    });
    assert.equal((await db.query(
      "select public.sellerpilot_complete_channel_gateway_job('token-hash',$1,$2,'succeeded',$3::jsonb,null) as completed",
      [missingIdJobId, missingIdClaimToken, JSON.stringify(missingIdPayload)],
    )).rows[0]?.completed, true);
    assert.deepEqual((await db.query(
      "select status,error_message from sellerpilot_private.channel_gateway_jobs where id=$1",
      [missingIdJobId],
    )).rows[0], {
      status: "reconciliation_required",
      error_message: "원격 판매채널 변경이 적용됐을 가능성이 있으나 식별값 또는 후속 조회를 확정하지 못했습니다. 판매자센터에서 수동 확인하기 전에는 같은 작업을 다시 실행할 수 없습니다.",
    });
    assert.deepEqual((await db.query(
      "select status,http_status,remote_id from sellerpilot_private.channel_operation_attempts where id=$1",
      [missingIdAttemptId],
    )).rows[0], { status: "manual_required", http_status: 409, remote_id: null });
    assert.deepEqual((await db.query(
      "select status,remote_id,failure_class,published_at from sellerpilot_private.product_listings where id=$1",
      [missingIdListingId],
    )).rows[0], {
      status: "failed",
      remote_id: null,
      failure_class: "external_action",
      published_at: null,
    });

    await db.query(
      "insert into sellerpilot_private.channel_operation_attempts(id,status) values ($1,'running'),($2,'running')",
      [inventoryAttemptId, failedAttemptId],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,operation,channel,status,worker_token_id,claim_token,lease_expires_at
      ) values
        ($1,$2,'inventory.update','lazada','running',$3,$4,now() + interval '1 hour'),
        ($5,$6,'price.update','lazada','running',$3,$7,now() + interval '1 hour')`,
      [inventoryJobId, inventoryAttemptId, tokenId, inventoryClaimToken, failedJobId, failedAttemptId, failedClaimToken],
    );
    const inventoryPayload = {
      ok: false,
      channel: "lazada",
      operation: "inventory.update",
      remoteId: "sku-123",
      safeMessage: "Inventory mutation succeeded but readback failed.",
      steps: [
        { name: "inventory.update", ok: true, status: 200, data: {} },
        { name: "inventory-readback", ok: false, status: 503, data: {} },
      ],
    };
    assert.equal((await db.query(
      "select public.sellerpilot_complete_channel_gateway_job('token-hash',$1,$2,'succeeded',$3::jsonb,null) as completed",
      [inventoryJobId, inventoryClaimToken, JSON.stringify(inventoryPayload)],
    )).rows[0]?.completed, true);
    assert.equal((await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [inventoryJobId],
    )).rows[0]?.status, "reconciliation_required");
    assert.deepEqual((await db.query(
      "select status,http_status,remote_id,safe_message from sellerpilot_private.channel_operation_attempts where id=$1",
      [inventoryAttemptId],
    )).rows[0], {
      status: "manual_required",
      http_status: 409,
      remote_id: "sku-123",
      safe_message: "원격 판매채널 변경이 적용됐을 가능성이 있으나 식별값 또는 후속 조회를 확정하지 못했습니다. 판매자센터에서 수동 확인하기 전에는 같은 작업을 다시 실행할 수 없습니다.",
    });

    await db.query(
      "insert into sellerpilot_private.channel_operation_attempts(id,status) values ($1,'running')",
      [uncertainAttemptId],
    );
    await db.query(
      "insert into sellerpilot_private.channel_gateway_jobs(id,attempt_id,operation,channel,status,worker_token_id,claim_token,lease_expires_at) values ($1,$2,'shipment.confirm','ebay','running',$3,$4,now() + interval '1 hour')",
      [uncertainJobId, uncertainAttemptId, tokenId, uncertainClaimToken],
    );
    const uncertainPayload = {
      ok: false,
      channel: "ebay",
      operation: "shipment.confirm",
      remoteId: "order-123",
      safeMessage: "Provider returned a transient server error to the mutation request.",
      steps: [{ name: "shipping-fulfillment", ok: false, status: 503, data: {} }],
    };
    assert.equal((await db.query(
      "select public.sellerpilot_complete_channel_gateway_job('token-hash',$1,$2,'succeeded',$3::jsonb,null) as completed",
      [uncertainJobId, uncertainClaimToken, JSON.stringify(uncertainPayload)],
    )).rows[0]?.completed, true);
    assert.deepEqual((await db.query(
      "select j.status,a.status as attempt_status,a.http_status from sellerpilot_private.channel_gateway_jobs j join sellerpilot_private.channel_operation_attempts a on a.id=j.attempt_id where j.id=$1",
      [uncertainJobId],
    )).rows[0], { status: "reconciliation_required", attempt_status: "manual_required", http_status: 409 });

    assert.equal((await db.query(
      "select public.sellerpilot_complete_channel_gateway_job('token-hash',$1,$2,'failed',null,'credential preflight failed') as completed",
      [failedJobId, failedClaimToken],
    )).rows[0]?.completed, true);
    assert.deepEqual((await db.query(
      "select status,http_status,safe_message from sellerpilot_private.channel_operation_attempts where id=$1",
      [failedAttemptId],
    )).rows[0], {
      status: "failed",
      http_status: 422,
      safe_message: "credential preflight failed",
    });
  } finally {
    await db.close();
  }
});

test("gateway credential staging is claim-bound, crash-durable, and supports progressive Shopee OAuth snapshots", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const tokenId = "10000000-0000-4000-8000-000000000011";
  const credentialId = "20000000-0000-4000-8000-000000000011";
  const jobId = "30000000-0000-4000-8000-000000000011";
  const queuedJobId = "30000000-0000-4000-8000-000000000012";
  const claimToken = "40000000-0000-4000-8000-000000000011";
  const tokenHash = "a".repeat(64);
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create schema extensions;
      create function extensions.digest(p_data text, p_algorithm text)
      returns bytea language sql immutable as $$ select decode(md5(p_data) || md5(p_data), 'hex') $$;
      create schema vault;
      create table vault.secrets(id uuid primary key, secret text not null, name text not null, description text);
      create function vault.create_secret(p_secret text, p_name text, p_description text)
      returns uuid language plpgsql as $$
      declare v_id uuid := gen_random_uuid();
      begin
        insert into vault.secrets values (v_id, p_secret, p_name, p_description);
        return v_id;
      end $$;
      create function vault.delete_secret(p_id uuid)
      returns void language plpgsql as $$ begin delete from vault.secrets where id = p_id; end $$;
      create table sellerpilot_private.ai_cli_worker_tokens (
        id uuid primary key, token_hash text not null, status text not null, expires_at timestamptz not null
      );
      create table sellerpilot_private.channel_credentials (
        id uuid primary key, channel text not null, status text not null
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key, channel text not null, operation text not null,
        credential_id uuid not null, status text not null, worker_token_id uuid,
        claim_token uuid, lease_expires_at timestamptz,
        prepared_credential_id uuid, credential_refresh_fingerprint text,
        credential_refresh_prepared_at timestamptz,
        credential_refresh_recovery_vault_id uuid,
        credential_refresh_recovery_fingerprint text,
        credential_refresh_recovery_staged_at timestamptz,
        credential_refresh_in_flight boolean not null default false,
        credential_refresh_started_at timestamptz,
        oauth_exchange_completed boolean not null default false,
        updated_at timestamptz not null default now()
      );
      create function public.sellerpilot_service_refresh_shopee(
        p_credential_id uuid, p_secret_payload jsonb, p_expires_at timestamptz
      ) returns uuid language plpgsql as $$
      declare v_id uuid := gen_random_uuid();
      begin
        update sellerpilot_private.channel_credentials set status='revoked' where id=p_credential_id;
        insert into sellerpilot_private.channel_credentials values(v_id,'shopee','active');
        return v_id;
      end $$;
      create function public.sellerpilot_service_refresh_lazada(uuid,jsonb,timestamptz)
      returns uuid language sql as $$ select gen_random_uuid() $$;
      create function public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz)
      returns uuid language sql as $$ select gen_random_uuid() $$;
    `);
    await db.exec(functionDefinition(
      migration,
      "public.sellerpilot_service_begin_gateway_credential_refresh",
    ));
    await db.exec(functionDefinition(
      migration,
      "public.sellerpilot_service_prepare_gateway_credential_refresh",
    ));
    await db.query(
      "insert into sellerpilot_private.ai_cli_worker_tokens values($1,$2,'active',now()+interval '1 hour')",
      [tokenId, tokenHash],
    );
    await db.query("insert into sellerpilot_private.channel_credentials values($1,'shopee','active')", [credentialId]);
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
        id,channel,operation,credential_id,status,worker_token_id,claim_token,lease_expires_at
      ) values
        ($1,'shopee','oauth.exchange',$2,'running',$3,$4,now()+interval '1 hour'),
        ($5,'shopee','diagnostic.test',$2,'queued',null,null,null)`,
      [jobId, credentialId, tokenId, claimToken, queuedJobId],
    );

    const recovery = {
      partner_id: "2031489",
      partner_key: "partner-secret-value",
      main_account_id: "3001",
      main_account_access_token: "main-access-token",
      main_account_refresh_token: "main-refresh-token",
    };
    assert.equal((await db.query(
      "select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3) as begun",
      [tokenHash, jobId, claimToken],
    )).rows[0]?.begun, true);
    const recoveryResult = await db.query(
      "select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4::jsonb,$5,true) as result",
      [tokenHash, jobId, claimToken, JSON.stringify(recovery), "2027-08-25T00:00:00.000Z"],
    );
    assert.equal(recoveryResult.rows[0]?.result.status, "recovery_preserved");
    assert.equal((await db.query("select count(*)::int as count from vault.secrets")).rows[0]?.count, 1);
    const recoveryRetry = await db.query(
      "select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4::jsonb,$5,true) as result",
      [tokenHash, jobId, claimToken, JSON.stringify(recovery), "2027-08-25T00:00:00.000Z"],
    );
    assert.equal(recoveryRetry.rows[0]?.result.reused, true);
    assert.equal((await db.query("select count(*)::int as count from vault.secrets")).rows[0]?.count, 1);

    const full = {
      ...recovery,
      shop_id: "1001",
      access_token: "shop-access-one",
      refresh_token: "shop-refresh-one",
    };
    assert.equal((await db.query(
      "select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3) as begun",
      [tokenHash, jobId, claimToken],
    )).rows[0]?.begun, true);
    const fullResult = await db.query(
      "select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4::jsonb,$5,false) as result",
      [tokenHash, jobId, claimToken, JSON.stringify(full), "2027-08-25T00:00:00.000Z"],
    );
    assert.equal(fullResult.rows[0]?.result.status, "prepared");
    const firstPreparedId = fullResult.rows[0]?.result.credential_id;
    assert.equal((await db.query("select count(*)::int as count from vault.secrets")).rows[0]?.count, 0);
    assert.equal((await db.query(
      "select credential_id from sellerpilot_private.channel_gateway_jobs where id=$1",
      [queuedJobId],
    )).rows[0]?.credential_id, firstPreparedId);

    const progressive = { ...full, access_token: "shop-access-two", refresh_token: "shop-refresh-two" };
    assert.equal((await db.query(
      "select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3) as begun",
      [tokenHash, jobId, claimToken],
    )).rows[0]?.begun, true);
    const progressiveResult = await db.query(
      "select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4::jsonb,$5,false) as result",
      [tokenHash, jobId, claimToken, JSON.stringify(progressive), "2027-08-25T00:00:00.000Z"],
    );
    assert.equal(progressiveResult.rows[0]?.result.status, "prepared");
    assert.notEqual(progressiveResult.rows[0]?.result.credential_id, firstPreparedId);
    assert.equal((await db.query(
      "select credential_id from sellerpilot_private.channel_gateway_jobs where id=$1",
      [queuedJobId],
    )).rows[0]?.credential_id, progressiveResult.rows[0]?.result.credential_id);

    const wrongClaim = await db.query(
      "select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4::jsonb,$5,false) as result",
      [tokenHash, jobId, "40000000-0000-4000-8000-000000000099", JSON.stringify(progressive), "2027-08-25T00:00:00.000Z"],
    );
    assert.equal(wrongClaim.rows[0]?.result, null);
  } finally {
    await db.close();
  }
});

test("gateway listing success path does not replay legacy attempt or listing completion RPCs", async () => {
  const route = await readFile(adminRouteUrl, "utf8");
  const successStart = route.indexOf("const gatewayExecution = await executeViaChannelGateway");
  const catchStart = route.indexOf("} catch (error) {", successStart);
  assert.notEqual(successStart, -1);
  assert.notEqual(catchStart, -1);
  const gatewaySuccessPath = route.slice(successStart, catchStart);
  assert.doesNotMatch(gatewaySuccessPath, /sellerpilot_service_complete_channel_operation/);
  assert.doesNotMatch(gatewaySuccessPath, /completeListing\(/);
});
