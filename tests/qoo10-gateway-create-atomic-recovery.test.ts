import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  beginQoo10GatewayCreateMutationBoundary,
  qoo10DurableCreateFulfillmentBindingArgument,
  qoo10DurableCreateFulfillmentBindingContract,
  readQoo10LocalCreateSellerCodeReconciliation,
} from "../lib/server-qoo10-listing-create-fulfillment-source";
import {
  qoo10QsmCreateFulfillmentCaptureContract,
  qoo10QsmCreateFulfillmentCollector,
  qoo10QsmCreateFulfillmentOrigin,
  qoo10QsmCreateFulfillmentTrustBoundary,
  sealQoo10QsmCreateFulfillmentCapture,
} from "../lib/channels/qoo10-listing-create-fulfillment-qsm-source";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  }
  return nextResolve(specifier, context);
} });

const ownerId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000001";
const productId = "30000000-0000-4000-8000-000000000001";
const listingId = "40000000-0000-4000-8000-000000000001";
const attemptId = "50000000-0000-4000-8000-000000000001";
const jobId = "60000000-0000-4000-8000-000000000001";
const claimToken = "70000000-0000-4000-8000-000000000001";
const vaultId = "80000000-0000-4000-8000-000000000001";
const requestFingerprint = "f".repeat(64);
const fulfillmentDigest = "e".repeat(64);
const sellerId = "seller-fixture";
const targetId = "Japan · QAPI";

function durableArguments(sourceId: string, sourceRevision: string, captureDigest: string) {
  const observedAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(observedAt) + 5 * 60_000).toISOString();
  const binding = {
    contract: qoo10DurableCreateFulfillmentBindingContract,
    sourceId, ownerId, productId, credentialId, credentialVersion: 7,
    sellerId, market: "JP" as const, targetId,
    sourceRevision, captureDigest,
    fulfillmentEvidenceDigest: fulfillmentDigest,
    observedAt, expiresAt,
  };
  return {
    binding,
    argumentsValue: {
      params: { SellerCode: "NEW-SKU-001" },
      [qoo10DurableCreateFulfillmentBindingArgument]: binding,
      sellerpilotQoo10CreateFulfillmentEvidence: { evidenceDigest: fulfillmentDigest },
      sellerpilotQoo10CreateApprovalBinding: { fulfillmentEvidenceDigest: fulfillmentDigest },
    },
  };
}

async function databaseFixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create schema vault;
    create table auth.users (id uuid primary key);
    create table sellerpilot_private.admin_users (
      user_id uuid primary key references auth.users(id)
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key, channel text not null, environment text not null,
      version integer not null, vault_secret_id uuid not null, status text not null,
      expires_at timestamptz, created_by uuid not null references auth.users(id)
    );
    create table sellerpilot_private.products (
      id uuid primary key, owner_id uuid not null references auth.users(id),
      demo boolean not null default false, status text not null default 'active'
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key, owner_id uuid not null references auth.users(id),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null, operation text not null, request_fingerprint text not null,
      status text not null, gateway_write_required boolean not null default true,
      pre_gateway_retryable boolean not null default false, http_status integer,
      remote_id text, safe_message text, completed_at timestamptz
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key, owner_id uuid not null, product_id uuid not null,
      channel_key text not null, market text not null, target_id text not null,
      operation_attempt_id uuid, status text not null, remote_id text
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key, attempt_id uuid, listing_id uuid, credential_id uuid,
      channel text not null, operation text not null, request_fingerprint text,
      request_payload jsonb not null, claim_token uuid, status text not null,
      lease_expires_at timestamptz, provider_mutation_started_at timestamptz
    );
    create table vault.decrypted_secrets (
      id uuid primary key, decrypted_secret text not null
    );
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path='' as $$
    begin
      if p_token_hash = repeat('b',64) then return false; end if;
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at=clock_timestamp()
       where id=p_job_id and claim_token=p_claim_token and status='running';
      return found;
    end $$;
    insert into auth.users values ('${ownerId}');
    insert into sellerpilot_private.admin_users values ('${ownerId}');
    insert into sellerpilot_private.products values ('${productId}','${ownerId}',false,'active');
    insert into vault.decrypted_secrets values (
      '${vaultId}','{"seller_id":"${sellerId}","api_key":"never-returned"}'
    );
    insert into sellerpilot_private.channel_credentials values (
      '${credentialId}','qoo10','production',7,'${vaultId}','active',null,'${ownerId}'
    );
    insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,request_fingerprint,status
    ) values (
      '${attemptId}','${ownerId}','${credentialId}','qoo10','listing.create',
      '${requestFingerprint}','running'
    );
    insert into sellerpilot_private.product_listings values (
      '${listingId}','${ownerId}','${productId}','qoo10','JP','${targetId}',
      '${attemptId}','queued',null
    );
  `);
  await db.exec(await readFile(new URL(
    "../supabase/migrations/20260910023500_qoo10_fulfillment_evidence.sql",
    import.meta.url,
  ), "utf8"));
  await db.exec(await readFile(new URL(
    "../supabase/migrations/20260910033500_qoo10_gateway_create_atomic_recovery.sql",
    import.meta.url,
  ), "utf8"));
  return db;
}

async function asService(db: PGlite) {
  await db.exec("set role service_role");
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.exec("select set_config('request.jwt.claim.role','',false)");
}

async function seedSourceAndJob(db: PGlite) {
  await asService(db);
  const observedAt = new Date().toISOString();
  const capture = sealQoo10QsmCreateFulfillmentCapture({
    contract: qoo10QsmCreateFulfillmentCaptureContract,
    collector: qoo10QsmCreateFulfillmentCollector,
    trustBoundary: qoo10QsmCreateFulfillmentTrustBoundary,
    browser: {
      name: "Chrome", family: "chrome", type: "extension", profileName: "CHANGHEE",
    },
    sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
    authenticatedSellerId: sellerId,
    testItemCode: "1234567890",
    testItemSellerCode: "seller-item-fixture",
    observedAt,
    dispatchPlaces: [{ id: "dispatch-1", active: true, payload: {
      label: "dispatch", countryCode: "JP", postalCode: "1000001",
      addressLine1: "Tokyo",
    } }],
    returnPolicies: [{ id: "return-1", active: true, payload: {
      label: "return", returnWindowDays: 7, returnShippingPaidBy: "buyer",
    } }],
  });
  const recorded = await db.query<{ source_id: string }>(`
    select public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
      $1::uuid,$2::uuid,$3::uuid,7,'JP',$4::text,$5::text,'1234567890',
      'dispatch-1','return-1',$6::text,$7::text,$8::jsonb
    ) source_id
  `, [ownerId, productId, credentialId, targetId, sellerId,
    capture.sourceRevision, capture.captureDigest, JSON.stringify(capture)]);
  const sourceId = recorded.rows[0].source_id;
  await db.query(`select public.sellerpilot_service_take_qoo10_create_fulfillment_capture(
    $1::uuid,$2::uuid,$3::uuid,7,'JP',$4::text
  )`, [ownerId, productId, credentialId, targetId]);
  const { argumentsValue, binding } = durableArguments(
    sourceId, capture.sourceRevision, capture.captureDigest,
  );
  binding.observedAt = observedAt;
  binding.expiresAt = new Date(Date.parse(observedAt) + 5 * 60_000).toISOString();
  await resetRole(db);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,attempt_id,listing_id,credential_id,channel,operation,request_fingerprint,
    request_payload,claim_token,status,lease_expires_at
  ) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'qoo10','listing.create',$5::text,
    $6::jsonb,$7::uuid,'running',clock_timestamp()+interval '10 minutes')`, [
    jobId, attemptId, listingId, credentialId, requestFingerprint,
    JSON.stringify({ arguments: argumentsValue }), claimToken,
  ]);
  await asService(db);
  return { sourceId, capture, argumentsValue };
}

async function callAtomic(
  db: PGlite,
  sourceId: string,
  capture: ReturnType<typeof sealQoo10QsmCreateFulfillmentCapture>,
  tokenHash = "a".repeat(64),
) {
  return db.query<{ receipt: Record<string, unknown> }>(`
    select public.sellerpilot_service_begin_qoo10_gateway_create_v1(
      $1::text,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,7,
      $8::text,'JP',$9::text,$10::text,$11::text,$12::text
    ) receipt
  `, [tokenHash, jobId, claimToken, sourceId, ownerId, productId, credentialId,
    sellerId, targetId, capture.sourceRevision, capture.captureDigest, fulfillmentDigest]);
}

test("33500 atomically binds QSM source, attempt fingerprint, listing and provider boundary", async () => {
  const db = await databaseFixture();
  const seeded = await seedSourceAndJob(db);
  const result = await callAtomic(db, seeded.sourceId, seeded.capture);
  assert.deepEqual(result.rows[0].receipt, {
    contract: "sellerpilot_qoo10_gateway_create_boundary_v1",
    status: "started",
    sourceId: seeded.sourceId,
    attemptId,
    listingId,
    requestFingerprint,
  });
  await resetRole(db);
  const state = await db.query<{ fences: number; started: boolean; attempt_status: string; listing_status: string }>(`
    select
      (select count(*)::int from sellerpilot_private.qoo10_create_fulfillment_mutation_fences) fences,
      (select provider_mutation_started_at is not null from sellerpilot_private.channel_gateway_jobs where id=$1) started,
      (select status from sellerpilot_private.channel_operation_attempts where id=$2) attempt_status,
      (select status from sellerpilot_private.product_listings where id=$3) listing_status
  `, [jobId, attemptId, listingId]);
  assert.deepEqual(state.rows[0], {
    fences: 1, started: true, attempt_status: "running", listing_status: "queued",
  });
  await db.close();
});

test("a second-stage denial rolls back the QSM fence and permits only a fresh atomic retry", async () => {
  const db = await databaseFixture();
  const seeded = await seedSourceAndJob(db);
  let providerMutations = 0;
  await assert.rejects(
    () => callAtomic(db, seeded.sourceId, seeded.capture, "b".repeat(64)),
    /QOO10_GATEWAY_CREATE_PROVIDER_BOUNDARY_REJECTED/u,
  );
  await resetRole(db);
  const rolledBack = await db.query<{ fences: number; started: boolean }>(`
    select
      (select count(*)::int from sellerpilot_private.qoo10_create_fulfillment_mutation_fences) fences,
      (select provider_mutation_started_at is not null from sellerpilot_private.channel_gateway_jobs where id=$1) started
  `, [jobId]);
  assert.deepEqual(rolledBack.rows[0], { fences: 0, started: false });
  assert.equal(providerMutations, 0);
  await asService(db);
  await callAtomic(db, seeded.sourceId, seeded.capture);
  providerMutations += 1;
  assert.equal(providerMutations, 1);
  await db.close();
});

test("runtime uses only addressable RPC identifiers", async () => {
  const [source, migration] = await Promise.all([
    readFile(new URL("../lib/server-qoo10-listing-create-fulfillment-source.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260910033500_qoo10_gateway_create_atomic_recovery.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /sellerpilot_service_assert_qoo10_create_fulfillment_capture_current/u);
  for (const match of `${source}\n${migration}`.matchAll(/sellerpilot_[a-z0-9_]+/giu)) {
    assert.ok(Buffer.byteLength(match[0], "utf8") <= 63, `${match[0]} exceeds 63 bytes`);
  }
});

test("route creates listing identity through the gateway and duplicate success reuses claim listing_id", async () => {
  const [route, reservation] = await Promise.all([
    readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825111820_serialize_gateway_ledger_transactions.sql", import.meta.url), "utf8"),
  ]);
  const gatewayBranch = route.indexOf("if (usesChannelGateway)");
  const localFallback = route.indexOf("sellerpilot_decrypt_credential", gatewayBranch);
  assert.match(route, /\|\| \(\(listingGatewayOperation \|\| writeChannelOperations\.has\(operation\)\) && channel === "qoo10"\)/u);
  assert.ok(gatewayBranch > 0 && localFallback > gatewayBranch);
  assert.doesNotMatch(route, /executeQoo10LocalCreateWithResponseLossFence/u);
  assert.match(route, /const claimListingId[\s\S]*?claim\.listing_id[\s\S]*?const duplicateListingId[\s\S]*?\?\? claimListingId/u);
  assert.ok(
    reservation.indexOf("insert into sellerpilot_private.product_listings")
      < reservation.indexOf("insert into sellerpilot_private.channel_gateway_jobs"),
  );
});

test("SellerCode reconciliation fails closed for zero, one and two exact identities", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [ids, expected] of [
      [[], ["absent", null]],
      [["1234567890"], ["unique", "1234567890"]],
      [["1234567890", "1234567891"], ["ambiguous", null]],
    ] as const) {
      globalThis.fetch = async () => Response.json({
        ResultCode: 0,
        ResultObject: ids.map((ItemNo) => ({ ItemNo, SellerCode: "NEW-SKU-001" })),
      });
      const result = await readQoo10LocalCreateSellerCodeReconciliation({
        payload: { api_key: "fixture" },
        argumentsValue: { params: { SellerCode: "NEW-SKU-001" } },
      });
      assert.equal(result.matchStatus, expected[0]);
      assert.equal(result.uniqueRemoteId, expected[1]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serverless Qoo10 CREATE uses one atomic boundary and stores ambiguous or unavailable readback without retry", async () => {
  const { runOneServerlessCsGatewayJob } = await import("../lib/channels/serverless-gateway");
  const { argumentsValue, binding } = durableArguments(
    "90000000-0000-4000-8000-000000000001", `sha256:${"a".repeat(64)}`, "b".repeat(64),
  );
  const originalFetch = globalThis.fetch;
  try {
    for (const scenario of [
      {
        expected: "ambiguous",
        fetch: async () => Response.json({
          ResultCode: 0,
          ResultObject: [
            { ItemNo: "1234567890", SellerCode: "NEW-SKU-001" },
            { ItemNo: "1234567891", SellerCode: "NEW-SKU-001" },
          ],
        }),
      },
      {
        expected: "unavailable",
        fetch: async () => { throw new Error("official readback unavailable"); },
      },
    ] as const) {
      const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
      let providerMutations = 0;
      globalThis.fetch = scenario.fetch;
      const response = await runOneServerlessCsGatewayJob({
      logError: () => {},
      now: () => new Date(binding.observedAt),
      rpc: async (name, args = {}) => {
        calls.push({ name, args });
        if (name === "sellerpilot_claim_serverless_gateway_job") return { data: {
          id: jobId, claim_token: claimToken, credential_id: credentialId,
          channel: "qoo10", operation: "listing.create", environment: "production",
          request: { arguments: argumentsValue }, credential: { api_key: "fixture" },
          attempt_count: 1,
        }, error: null };
        if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") return { data: {
          contract: "sellerpilot-provider-rate-budget/1", status: "reserved", retryAfterSeconds: 0,
        }, error: null };
        if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
        if (name === "sellerpilot_service_begin_qoo10_gateway_create_v1") return { data: {
          contract: "sellerpilot_qoo10_gateway_create_boundary_v1", status: "started",
          sourceId: binding.sourceId, attemptId, listingId, requestFingerprint,
        }, error: null };
        if (name === "sellerpilot_service_qoo10_create_get_rec_v1") return { data: {
          contract: "sellerpilot_qoo10_create_official_get_recovery_v1",
          status: "recorded", receiptKind: "official_get_recovery",
          receiptId: "a0000000-0000-4000-8000-000000000001",
          sourceId: binding.sourceId, attemptId, listingId,
          matchStatus: scenario.expected, remoteId: null,
          listingPublished: false, synthesizedPostReceipt: false,
        }, error: null };
        if (name === "sellerpilot_service_serverless_cs_completion_context") return { data: {
          status: "running", channel: "qoo10", operation: "listing.create",
          publication_verification_boundary: new Date().toISOString(),
        }, error: null };
        if (name === "sellerpilot_service_complete_serverless_cs_transaction") return {
          data: { status: "completed" }, error: null,
        };
        return { data: null, error: { code: "unexpected_rpc" } };
      },
      executeProvider: async ({ hooks }) => {
        await hooks.beginProviderMutation();
        providerMutations += 1;
        throw new Error("SetNewGoods response lost");
      },
      }, "c".repeat(64));
      assert.equal(response.status, 200);
      assert.equal(providerMutations, 1);
      assert.equal(calls.filter(({ name }) => name === "sellerpilot_service_begin_qoo10_gateway_create_v1").length, 1);
      assert.equal(calls.filter(({ name }) => name === "sellerpilot_service_begin_serverless_gateway_provider_mutation").length, 0);
      assert.equal(
        calls.filter(({ name }) => name === "sellerpilot_service_qoo10_create_get_rec_v1").length,
        scenario.expected === "ambiguous" ? 1 : 0,
      );
      const completion = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
      assert.equal(completion?.args.p_status, "reconciliation_required");
      assert.equal((completion?.args.p_response_payload as { steps: Array<{ data: { matchStatus: string } }> })
        .steps[0].data.matchStatus, scenario.expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("default local commerce worker sends Qoo10 CREATE through the atomic boundary hook", async () => {
  const { processCommerceGatewayJob } = await import("../scripts/commerce-gateway-job.mjs");
  const { argumentsValue } = durableArguments(
    "90000000-0000-4000-8000-000000000001", `sha256:${"a".repeat(64)}`, "b".repeat(64),
  );
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let providerMutations = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ResultCode: 0, ResultObject: [] });
  try {
    await processCommerceGatewayJob({
      id: jobId, claim_token: claimToken, credential_id: credentialId,
      channel: "qoo10", operation: "listing.create", environment: "production",
      request: { arguments: argumentsValue }, credential: { api_key: "fixture" },
    }, {
      createGatewayHeartbeat: () => ({
        start: async () => {}, assertHealthy: async () => {}, stop: async () => {},
      }),
      persistWorkerCompletion: async (path: string, body: Record<string, unknown>) => {
        calls.push({ path, body });
        return Response.json({ status: "recorded" });
      },
      prepareListingArguments: async (input: { arguments: Record<string, unknown> }) => ({
        arguments: input.arguments, mediaMutationObserved: false,
      }),
      executeCommerceOperation: async (input: {
        providerMutationHooks?: { begin: () => Promise<void> };
      }) => {
        await input.providerMutationHooks?.begin();
        providerMutations += 1;
        throw new Error("SetNewGoods response lost");
      },
    });
    assert.equal(providerMutations, 1);
    assert.equal(calls.filter(({ path }) => path === "/api/channel-gateway/worker/qoo10-create-boundary").length, 1);
    assert.equal(calls.filter(({ path }) => path === "/api/channel-gateway/worker/qoo10-create-boundary/recover").length, 1);
    assert.equal(calls.filter(({ path }) => path === "/api/channel-gateway/worker/begin-mutation").length, 0);
    const recovery = calls.find(({ path }) => path === "/api/channel-gateway/worker/qoo10-create-boundary/recover");
    const recoveryObservation = recovery?.body.observation as {
      matchStatus?: string; uniqueRemoteId?: string | null;
    };
    assert.equal(recoveryObservation?.matchStatus, "absent");
    assert.notEqual(recoveryObservation?.uniqueRemoteId, "1217536689");
    const completion = calls.find(({ path }) => path === "/api/channel-gateway/worker/complete");
    assert.equal(completion?.body.status, "reconciliation_required");
    assert.equal((completion?.body.result as { steps: Array<{ data: { matchStatus: string } }> })
      .steps[0].data.matchStatus, "absent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the default claim dispatcher still routes Qoo10 CREATE to the fixed commerce worker", async () => {
  const worker = await readFile(new URL("../scripts/channel-gateway-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /processGatewayJob\(job[\s\S]*?processCommerceGatewayJob\(job, dependencies\)/u);
  const commerce = await readFile(new URL("../scripts/commerce-gateway-job.mjs", import.meta.url), "utf8");
  assert.match(commerce, /strictQoo10Create[\s\S]*?providerMutationHooks:[\s\S]*?begin: markQoo10CreateStarted/u);
  assert.match(commerce, /qoo10-create-boundary\/recover/u);
});

test("atomic boundary helper sends the exact sealed gateway source and parses listing identity", async () => {
  const { argumentsValue, binding } = durableArguments(
    "90000000-0000-4000-8000-000000000001", `sha256:${"a".repeat(64)}`, "b".repeat(64),
  );
  const result = await beginQoo10GatewayCreateMutationBoundary({
    gatewayTokenHash: "c".repeat(64), jobId, claimToken, argumentsValue,
    now: new Date(binding.observedAt),
    rpc: async (name, parameters) => {
      assert.equal(name, "sellerpilot_service_begin_qoo10_gateway_create_v1");
      assert.equal(parameters.p_source_id, binding.sourceId);
      assert.equal(parameters.p_product_id, productId);
      return { data: {
        contract: "sellerpilot_qoo10_gateway_create_boundary_v1", status: "started",
        sourceId: binding.sourceId, attemptId, listingId, requestFingerprint,
      }, error: null };
    },
  });
  assert.equal(result.attemptId, attemptId);
  assert.equal(result.listingId, listingId);
  assert.equal(result.requestFingerprint, requestFingerprint);
});
