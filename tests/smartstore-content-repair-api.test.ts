import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";
import { z as zod } from "zod";

import * as repairContract from "../lib/server-smartstore-content-repair";
import {
  smartstoreContentRepairCompletionSchema,
  smartstoreContentRepairRequestSchema,
  smartstoreContentRepairStateSchema,
} from "../lib/server-smartstore-content-repair";

const productId = "11111111-1111-4111-8111-111111111111";
const listingId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const baselineId = "44444444-4444-4444-8444-444444444444";
const verificationJobId = "55555555-5555-4555-8555-555555555555";
const digest = "a".repeat(64);

const stateBase = {
  contract: "smartstore_existing_content_repair_enqueue_v1",
  productId,
  listingId,
  baselineId,
  jobId,
  verificationJobId: null,
  reused: true,
  contentVerified: false,
  providerMutationPerformed: false,
  normalUpdateEligible: false,
} as const;

function queuedState(overrides: Record<string, unknown> = {}) {
  return { ...stateBase, status: "queued", reason: "CONTENT_REPAIR_QUEUED", ...overrides };
}

const routeSource = await readFile(
  new URL("../app/api/admin/products/[id]/smartstore-content-repair/route.ts", import.meta.url),
  "utf8",
);
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function callRoute(input: {
  method?: "GET" | "POST";
  rpcData?: unknown;
  rpcError?: { message?: string; code?: string } | null;
  body?: unknown;
  query?: string;
}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const logs: Array<Record<string, unknown>> = [];
  const context = vm.createContext({
    exports: {},
    Request,
    Response,
    URL,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return { z: zod };
      if (name.endsWith("/admin-api")) {
        return {
          authenticateAdminRequest: async () => ({
            user: { id: "88888888-8888-4888-8888-888888888888" },
            serviceClient: {
              rpc: async (rpcName: string, args: Record<string, unknown>) => {
                calls.push({ name: rpcName, args });
                return { data: input.rpcData ?? queuedState(), error: input.rpcError ?? null };
              },
            },
          }),
          isAdminApiError: (value: unknown) => value instanceof Response,
        };
      }
      if (name.endsWith("/server-smartstore-content-repair")) return repairContract;
      throw new Error(`unexpected module ${name}`);
    },
    console: {
      error(_message: string, details: Record<string, unknown>) {
        logs.push(details);
      },
    },
  });
  vm.runInContext(compiledRoute, context, { timeout: 1_000 });
  const method = input.method ?? "POST";
  const request = new Request(
    `https://fixture.invalid/api/admin/products/${productId}/smartstore-content-repair${input.query ?? ""}`,
    method === "POST"
      ? {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body ?? { confirmApprovedContentRepair: true }),
        }
      : { method },
  );
  const routeResponse = await context.exports[method](request, {
    params: Promise.resolve({ id: productId }),
  });
  return { calls, logs, routeResponse };
}

test("browser repair request accepts only an explicit approved-content confirmation", () => {
  assert.deepEqual(
    smartstoreContentRepairRequestSchema.parse({ confirmApprovedContentRepair: true }),
    { confirmApprovedContentRepair: true },
  );
  for (const value of [
    {},
    { confirmApprovedContentRepair: false },
    { confirmApprovedContentRepair: true, body: { forged: true } },
    { confirmApprovedContentRepair: true, baselineId },
  ]) assert.equal(smartstoreContentRepairRequestSchema.safeParse(value).success, false);
});

test("repair state contract keeps repair, mutation, and strict verification phases distinct", () => {
  const values = [
    { ...stateBase, status: "repair_required", reason: "APPROVED_CONTENT_REPAIR_REQUIRED", jobId: null },
    queuedState({ reused: false }),
    { ...stateBase, status: "running", reason: "CONTENT_REPAIR_RUNNING", providerMutationPerformed: true },
    { ...stateBase, status: "reconciliation_required", reason: "CONTENT_REPAIR_RECONCILIATION_REQUIRED", providerMutationPerformed: true },
    { ...stateBase, status: "verification_queued", reason: "STRICT_READBACK_QUEUED", verificationJobId, providerMutationPerformed: true },
    { ...stateBase, status: "verification_running", reason: "STRICT_READBACK_RUNNING", verificationJobId, providerMutationPerformed: true },
    { ...stateBase, status: "verification_reconciliation_required", reason: "STRICT_READBACK_RECONCILIATION_REQUIRED", verificationJobId, providerMutationPerformed: true },
    { ...stateBase, status: "verified", reason: "ADOPTION_ALREADY_VERIFIED", verificationJobId, contentVerified: true, providerMutationPerformed: true, normalUpdateEligible: true },
    { ...stateBase, status: "blocked", reason: "STRICT_READBACK_FAILED", verificationJobId, providerMutationPerformed: true },
  ];
  for (const value of values) assert.equal(smartstoreContentRepairStateSchema.safeParse(value).success, true);
  for (const value of [
    { ...queuedState(), contentVerified: true },
    { ...stateBase, status: "verification_queued", reason: "STRICT_READBACK_QUEUED", verificationJobId: null, providerMutationPerformed: true },
    { ...stateBase, status: "verified", reason: "ADOPTION_ALREADY_VERIFIED", verificationJobId, contentVerified: false, providerMutationPerformed: true, normalUpdateEligible: true },
    { ...queuedState(), providerRaw: { hidden: true } },
  ]) assert.equal(smartstoreContentRepairStateSchema.safeParse(value).success, false);
});

test("repair completion contract cannot call a successful provider write verified", () => {
  assert.equal(smartstoreContentRepairCompletionSchema.safeParse({
    contract: "smartstore_existing_content_repair_completion_v1",
    status: "verification_queued",
    reason: "STRICT_READBACK_QUEUED",
    jobId,
    baselineId,
    verificationJobId,
    readbackSha256: digest,
    reused: false,
  }).success, true);
  assert.equal(smartstoreContentRepairCompletionSchema.safeParse({
    contract: "smartstore_existing_content_repair_completion_v1",
    status: "verified",
    reason: "STRICT_READBACK_QUEUED",
    jobId,
    baselineId,
    verificationJobId,
    readbackSha256: digest,
    reused: false,
  }).success, false);
});

test("POST enqueues one server-derived repair and GET uses the short RPC name", async () => {
  const posted = await callRoute({ rpcData: queuedState({ reused: false }) });
  assert.equal(posted.routeResponse.status, 202);
  assert.deepEqual(structuredClone(posted.calls), [{
    name: "sellerpilot_service_enqueue_smartstore_content_repair",
    args: { p_actor: "88888888-8888-4888-8888-888888888888", p_product_id: productId },
  }]);
  const got = await callRoute({ method: "GET", rpcData: queuedState() });
  assert.equal(got.routeResponse.status, 202);
  assert.equal(got.calls[0]?.name, "sellerpilot_service_get_smartstore_content_repair_status");
  for (const call of [...posted.calls, ...got.calls]) assert.ok(Buffer.byteLength(call.name) <= 63);
  assert.ok(Buffer.byteLength("sellerpilot_complete_smartstore_content_repair") <= 63);
});

test("API returns 200 only for repair-required identity proof or final strict verification", async () => {
  const required = await callRoute({ rpcData: {
    ...stateBase,
    status: "repair_required",
    reason: "APPROVED_CONTENT_REPAIR_REQUIRED",
    jobId: null,
  } });
  assert.equal(required.routeResponse.status, 200);
  assert.deepEqual(await required.routeResponse.json(), {
    ok: true,
    status: "repair_required",
    productId,
    listingId,
    jobId: null,
    baselineId,
    verificationJobId: null,
    reused: true,
    apiCreateSucceeded: false,
    contentVerified: false,
    providerMutationPerformed: false,
    normalUpdateEligible: false,
    message: "기존 상품 신원은 확인됐지만 현재 상세 내용이 승인본과 달라 복구 확인이 필요합니다.",
  });
  const verified = await callRoute({ rpcData: {
    ...stateBase,
    status: "verified",
    reason: "ADOPTION_ALREADY_VERIFIED",
    verificationJobId,
    contentVerified: true,
    providerMutationPerformed: true,
    normalUpdateEligible: true,
  } });
  assert.equal(verified.routeResponse.status, 200);
  const body = await verified.routeResponse.json();
  assert.equal(body.status, "verified");
  assert.equal(body.contentVerified, true);
  assert.equal(body.providerMutationPerformed, true);
  assert.equal(body.normalUpdateEligible, true);
});

test("uncertain mutation and strict readback never become automatic retry or verified", async () => {
  for (const rpcData of [
    { ...stateBase, status: "reconciliation_required", reason: "CONTENT_REPAIR_RECONCILIATION_REQUIRED", providerMutationPerformed: true },
    { ...stateBase, status: "verification_reconciliation_required", reason: "STRICT_READBACK_RECONCILIATION_REQUIRED", verificationJobId, providerMutationPerformed: true },
    { ...stateBase, status: "blocked", reason: "STRICT_READBACK_FAILED", verificationJobId, providerMutationPerformed: true },
  ]) {
    const result = await callRoute({ rpcData });
    assert.equal(result.routeResponse.status, 409);
    const body = await result.routeResponse.json();
    assert.equal(body.ok, false);
    assert.notEqual(body.status, "verified");
    assert.doesNotMatch(JSON.stringify(body), /SMARTSTORE_|readback|credential|providerRaw/u);
  }
});

test("invalid browser input and backend failures are bounded and no-store", async () => {
  const invalid = await callRoute({ body: { confirmApprovedContentRepair: true, baselineId } });
  assert.equal(invalid.routeResponse.status, 400);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.routeResponse.headers.get("cache-control"), "no-store, max-age=0");

  const drift = await callRoute({
    rpcData: null,
    rpcError: { message: "SMARTSTORE_CONTENT_REPAIR_BASELINE_STALE private-value", code: "P0001" },
  });
  assert.equal(drift.routeResponse.status, 409);
  assert.doesNotMatch(JSON.stringify(await drift.routeResponse.json()), /private-value|P0001/u);

  const unavailable = await callRoute({ rpcData: null, rpcError: { message: "connection failed", code: "08006" } });
  assert.equal(unavailable.routeResponse.status, 503);
  assert.deepEqual(structuredClone(unavailable.logs[0]), {
    failureCode: "SMARTSTORE_CONTENT_REPAIR_BACKEND_UNAVAILABLE",
    rpcCode: "08006",
  });
});

test("generic update endpoints reject browser repair markers and transmission evidence", async () => {
  const [channelRoute, remoteEditRoute] = await Promise.all([
    readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/products/[id]/remote-edit/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [channelRoute, remoteEditRoute]) {
    assert.match(source, /smartstoreContentRepairArgument/u);
    assert.match(source, /smartstoreContentRepairTransmissionArgument/u);
    assert.match(source, /smartstore_content_repair_marker_server_owned/u);
  }
});

test("worker completion routes exact repair evidence to the dedicated atomic RPC before generic completion", async () => {
  const route = await readFile(
    new URL("../app/api/channel-gateway/worker/complete/route.ts", import.meta.url),
    "utf8",
  );
  const discriminator = route.indexOf(
    'job.smartstoreContentRepairContract === "smartstore_existing_content_repair_job_v1"',
  );
  const validation = route.indexOf(
    "smartstoreContentRepairWorkerResultSchema.safeParse(parsed.data.result)",
    discriminator,
  );
  const dedicated = route.indexOf('"sellerpilot_complete_smartstore_content_repair"', validation);
  const evidence = route.indexOf("repairResult.data.evidence", dedicated);
  const generic = route.indexOf('serviceClient.rpc("sellerpilot_service_complete_gateway_transaction"', dedicated);
  assert.ok(discriminator > 0 && validation > discriminator && dedicated > validation);
  assert.ok(evidence > dedicated && generic > evidence);
  assert.match(route.slice(dedicated, generic), /p_status: repairStatus/u);
  assert.match(route.slice(dedicated, generic), /status === "lease_lost"/u);
  assert.doesNotMatch(route.slice(discriminator, generic), /status:\s*"verified"/u);
});
