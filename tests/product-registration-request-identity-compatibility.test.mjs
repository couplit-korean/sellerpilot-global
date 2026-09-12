import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  productRegistrationCredentialBinding,
  productRegistrationCredentialRequestIdentity,
  productRegistrationRequestIdentityContract,
} from "../lib/product-registration/credential-execution-binding.ts";

const ownerId = "10000000-0000-4000-8000-000000000001";
const credentialA = "20000000-0000-4000-8000-000000000001";
const credentialB = "20000000-0000-4000-8000-000000000002";
const productA = "30000000-0000-4000-8000-000000000001";
const productB = "30000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-13T00:00:00.000Z");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestFingerprint(request, metadata) {
  const binding = productRegistrationCredentialBinding({
    metadata,
    credentialId: request.credentialId,
    channel: request.channel,
    requestedVersion: request.credentialVersion,
    now,
  });
  if (!binding.ok) return binding;
  const legacyIdentity = {
    channel: request.channel,
    operation: request.operation,
    environment: binding.binding.environment,
    productId: request.productId ?? null,
    resourceListingId: request.resourceListingId ?? null,
    inventoryItemId: null,
    orderId: null,
    shipmentCarrier: null,
    shipmentTracking: null,
    currency: request.currency ?? null,
    price: request.price ?? null,
    market: request.market ?? "",
    targetId: request.targetId ?? "",
    arguments: request.arguments,
  };
  const identity = request.requestIdentityContract === productRegistrationRequestIdentityContract
    ? {
      ...legacyIdentity,
      credential: productRegistrationCredentialRequestIdentity(binding.binding),
    }
    : legacyIdentity;
  return {
    ok: true,
    fingerprint: createHash("sha256").update(canonicalJson(identity)).digest("hex"),
  };
}

async function claimFunctionSql() {
  const source = await readFile(new URL(
    "../supabase/migrations/20260825104900_resource_bound_gateway_writes.sql",
    import.meta.url,
  ), "utf8");
  const marker = "create or replace function public.sellerpilot_claim_channel_operation(";
  const start = source.indexOf(marker);
  const end = source.indexOf("\n$$;", start);
  assert.ok(start >= 0 && end > start, "claim function must remain extractable from the canonical migration");
  return source.slice(start, end + 4);
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable as
      'select ''${ownerId}''::uuid';
    create function public.sellerpilot_is_admin() returns boolean language sql stable as
      'select true';
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      version integer not null,
      fingerprint text not null,
      status text not null,
      expires_at timestamptz
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      idempotency_key text not null,
      request_fingerprint text not null,
      gateway_write_required boolean not null default false,
      status text not null default 'running',
      remote_id text,
      safe_message text,
      http_status integer,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      unique (channel, operation, idempotency_key)
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      attempt_id uuid not null,
      status text not null default 'queued',
      provider_mutation_started_at timestamptz
    );
  `);
  await db.exec(await claimFunctionSql());
  await db.query(`insert into sellerpilot_private.channel_credentials
    (id,channel,environment,version,fingerprint,status,expires_at)
    values ($1,'ebay','production',7,'A1B2C3D4E5F6','active','2030-01-01T00:00:00Z')`, [credentialA]);

  const metadata = new Map([[credentialA, {
    id: credentialA,
    channel: "ebay",
    environment: "production",
    version: 7,
    fingerprint: "A1B2C3D4E5F6",
    status: "active",
    expires_at: "2030-01-01T00:00:00.000Z",
  }]]);
  let providerWriteCount = 0;
  let jobCreateCount = 0;

  async function api(request) {
    const credential = metadata.get(request.credentialId);
    const calculated = requestFingerprint(request, credential);
    if (!calculated.ok) {
      return {
        status: 409,
        body: {
          mode: "credential_execution_binding_mismatch",
          providerWritePerformed: false,
          jobCreated: false,
        },
      };
    }
    let claim;
    try {
      const result = await db.query(`select public.sellerpilot_claim_channel_operation(
        $1,$2,$3,$4,$5
      ) as value`, [
        request.credentialId,
        request.channel,
        request.operation,
        request.idempotencyKey,
        calculated.fingerprint,
      ]);
      claim = result.rows[0].value;
    } catch {
      return {
        status: 409,
        body: {
          mode: "channel_operation_claim_rejected",
          providerWritePerformed: false,
          jobCreated: false,
        },
      };
    }

    if (claim.duplicate) {
      if (claim.status === "running") {
        return { status: 202, body: { inProgress: true, attemptId: claim.attempt_id } };
      }
      if (claim.status === "succeeded") {
        return { status: 200, body: { ok: true, duplicate: true, attemptId: claim.attempt_id } };
      }
      return {
        status: 409,
        body: {
          attemptId: claim.attempt_id,
          status: claim.status,
          reconciliationRequired: claim.status === "reconciliation_required",
        },
      };
    }

    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(attempt_id,status)
      values ($1,'queued')`, [claim.attempt_id]);
    jobCreateCount += 1;
    providerWriteCount += 1;
    return {
      status: 202,
      body: { accepted: true, attemptId: claim.attempt_id },
    };
  }

  return {
    db,
    metadata,
    api,
    counts: () => ({ providerWriteCount, jobCreateCount }),
  };
}

function request(overrides = {}) {
  return {
    credentialId: credentialA,
    credentialVersion: 7,
    requestIdentityContract: productRegistrationRequestIdentityContract,
    channel: "ebay",
    operation: "listing.create",
    idempotencyKey: "listing-identity-contract-0001",
    productId: productA,
    currency: "USD",
    price: 18.75,
    market: "US",
    targetId: "EBAY_US",
    arguments: { sku: "SKU-001", title: "Exact listing" },
    ...overrides,
  };
}

test("pre-contract and v2 retries use one fingerprint each; expiry extension stays identical", async () => {
  const f = await fixture();
  try {
    const legacy = request({
      requestIdentityContract: undefined,
      credentialVersion: undefined,
      idempotencyKey: "legacy-listing-identity-0001",
    });
    const acceptedBeforeDeploy = await f.api(legacy);
    const retriedAfterDeploy = await f.api(legacy);
    assert.equal(acceptedBeforeDeploy.status, 202);
    assert.equal(retriedAfterDeploy.status, 202);
    assert.equal(retriedAfterDeploy.body.inProgress, true);
    assert.equal(retriedAfterDeploy.body.attemptId, acceptedBeforeDeploy.body.attemptId);
    assert.deepEqual(f.counts(), { providerWriteCount: 1, jobCreateCount: 1 });

    const current = request({ idempotencyKey: "current-listing-identity-0001" });
    const acceptedCurrent = await f.api(current);
    const repeatedCurrent = await f.api(current);
    assert.equal(repeatedCurrent.status, 202);
    assert.equal(repeatedCurrent.body.attemptId, acceptedCurrent.body.attemptId);

    const row = f.metadata.get(credentialA);
    row.expires_at = "2031-01-01T00:00:00.000Z";
    await f.db.query("update sellerpilot_private.channel_credentials set expires_at='2031-01-01T00:00:00Z' where id=$1", [credentialA]);
    const afterScheduleExtension = await f.api(current);
    assert.equal(afterScheduleExtension.status, 202);
    assert.equal(afterScheduleExtension.body.attemptId, acceptedCurrent.body.attemptId);
    assert.deepEqual(f.counts(), { providerWriteCount: 2, jobCreateCount: 2 });
  } finally {
    await f.db.close();
  }
});

test("credential, payload, product and target drift reject the old key; another channel never attaches to it", async () => {
  const f = await fixture();
  try {
    const base = request({ idempotencyKey: "drift-listing-identity-0001" });
    const accepted = await f.api(base);
    assert.equal(accepted.status, 202);

    for (const changed of [
      request({ idempotencyKey: base.idempotencyKey, arguments: { sku: "SKU-001", title: "Changed" } }),
      request({ idempotencyKey: base.idempotencyKey, productId: productB }),
      request({ idempotencyKey: base.idempotencyKey, targetId: "EBAY_CA" }),
    ]) {
      const response = await f.api(changed);
      assert.equal(response.status, 409);
      assert.equal(response.body.mode, "channel_operation_claim_rejected");
      assert.equal(response.body.providerWritePerformed, false);
      assert.equal(response.body.jobCreated, false);
    }

    await f.db.query("update sellerpilot_private.channel_credentials set status='revoked' where id=$1", [credentialA]);
    f.metadata.get(credentialA).status = "revoked";
    await f.db.query(`insert into sellerpilot_private.channel_credentials
      (id,channel,environment,version,fingerprint,status,expires_at)
      values ($1,'ebay','production',8,'FEDCBA654321','active','2031-01-01T00:00:00Z')`, [credentialB]);
    f.metadata.set(credentialB, {
      id: credentialB,
      channel: "ebay",
      environment: "production",
      version: 8,
      fingerprint: "FEDCBA654321",
      status: "active",
      expires_at: "2031-01-01T00:00:00.000Z",
    });
    const rotated = await f.api(request({
      credentialId: credentialB,
      credentialVersion: 8,
      idempotencyKey: base.idempotencyKey,
    }));
    assert.equal(rotated.status, 409);
    assert.equal(rotated.body.mode, "channel_operation_claim_rejected");

    await f.db.query(`insert into sellerpilot_private.channel_credentials
      (id,channel,environment,version,fingerprint,status,expires_at)
      values ('20000000-0000-4000-8000-000000000003','qoo10','production',4,
      'QOO10ABC1234','active','2031-01-01T00:00:00Z')`);
    f.metadata.set("20000000-0000-4000-8000-000000000003", {
      id: "20000000-0000-4000-8000-000000000003",
      channel: "qoo10",
      environment: "production",
      version: 4,
      fingerprint: "QOO10ABC1234",
      status: "active",
      expires_at: "2031-01-01T00:00:00.000Z",
    });
    const otherChannel = await f.api(request({
      credentialId: "20000000-0000-4000-8000-000000000003",
      credentialVersion: 4,
      channel: "qoo10",
      idempotencyKey: base.idempotencyKey,
    }));
    assert.equal(otherChannel.status, 202);
    assert.notEqual(otherChannel.body.attemptId, accepted.body.attemptId);
    assert.deepEqual(f.counts(), { providerWriteCount: 2, jobCreateCount: 2 });
  } finally {
    await f.db.close();
  }
});

test("queued, running, succeeded, reconciliation and unaccepted retries never repeat a provider write", async () => {
  const f = await fixture();
  try {
    const base = request({ idempotencyKey: "state-listing-identity-0001" });
    const accepted = await f.api(base);
    assert.equal(accepted.status, 202);
    assert.deepEqual(f.counts(), { providerWriteCount: 1, jobCreateCount: 1 });

    const queued = await f.api(base);
    assert.equal(queued.status, 202);
    assert.equal(queued.body.inProgress, true);
    await f.db.query("update sellerpilot_private.channel_gateway_jobs set status='running' where attempt_id=$1", [accepted.body.attemptId]);
    const running = await f.api(base);
    assert.equal(running.status, 202);
    assert.equal(running.body.attemptId, accepted.body.attemptId);

    await f.db.query(`update sellerpilot_private.channel_operation_attempts
      set status='succeeded',remote_id='EBAY-REMOTE-001' where id=$1`, [accepted.body.attemptId]);
    const succeeded = await f.api(base);
    assert.equal(succeeded.status, 200);
    assert.equal(succeeded.body.duplicate, true);

    await f.db.query("update sellerpilot_private.channel_operation_attempts set status='reconciliation_required' where id=$1", [accepted.body.attemptId]);
    await f.db.query("update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=now() where attempt_id=$1", [accepted.body.attemptId]);
    const uncertain = await f.api(base);
    assert.equal(uncertain.status, 409);
    assert.equal(uncertain.body.reconciliationRequired, true);
    assert.deepEqual(f.counts(), { providerWriteCount: 1, jobCreateCount: 1 });

    const unaccepted = await f.api(request({
      idempotencyKey: "unaccepted-listing-identity-0001",
      credentialVersion: 999,
    }));
    assert.equal(unaccepted.status, 409);
    assert.equal(unaccepted.body.mode, "credential_execution_binding_mismatch");
    assert.deepEqual(f.counts(), { providerWriteCount: 1, jobCreateCount: 1 });
    const attemptCount = await f.db.query("select count(*)::int as count from sellerpilot_private.channel_operation_attempts");
    assert.equal(attemptCount.rows[0].count, 1);
  } finally {
    await f.db.close();
  }
});

test("route contains one contract-selected claim and never probes a second fingerprint", async () => {
  const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const claimCalls = route.match(/userClient\.rpc\("sellerpilot_claim_channel_operation"/gu) ?? [];
  assert.equal(claimCalls.length, 1);
  assert.match(route, /parsed\.data\.requestIdentityContract === productRegistrationRequestIdentityContract/u);
  assert.match(route, /credential: productRegistrationCredentialRequestIdentity\(credentialExecutionBinding\)/u);
  assert.match(route, /mode: "channel_operation_claim_rejected",\s*providerWritePerformed: false,\s*jobCreated: false/u);
});
