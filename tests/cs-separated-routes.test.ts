import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { createPromiseGate } from "../lib/promise-pool";
import { executeCsOperation } from "../lib/cs/operations/execute";
import { executeChannelOperation as executeCommerceOperation } from "../lib/channels/commerce-operations";

const require = createRequire(import.meta.url);
type RpcCall = { name: string; args: Record<string, unknown> };
function loadRoute(kind: "sync" | "ticket-status", rpc: (name: string, args: Record<string, unknown>) => unknown, denied = false) {
  const source = readFileSync(new URL(`../app/api/admin/cs/${kind}/route.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  const dependencies = {
    "next/server": { NextResponse: { json: Response.json } },
    zod: { z },
    "lib/admin-api": {
      authenticateAdminRequest: async () => denied ? Response.json({}, { status: 403 }) : { userClient: { rpc }, serviceClient: { rpc } },
      isAdminApiError: (value: unknown) => value instanceof Response,
    },
    "lib/channels/catalog": { isActiveChannelKey: (value: string) => ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"].includes(value) },
    "lib/channels/inquiry-sync": { inquirySyncRequests: (channel: string) => [{ periodicKey: `inquiries:${channel}`, arguments: {} }] },
    "lib/channels/lazada-im-bootstrap": { shouldBootstrapLazadaIm: () => false },
    "lib/channels/cs/coupang/history-recovery": {},
    "lib/channels/serverless-static-egress": { configuredServerlessStaticEgressChannels: () => [], hasServerlessStaticEgressFor: () => false, SERVERLESS_STATIC_EGRESS_REQUIRED: "STATIC_EGRESS_REQUIRED" },
    "lib/promise-pool": { createPromiseGate },
  };
  vm.runInNewContext(output, {
    exports, require: (name: string) => {
      const key = name.replace(/^(?:\.\.\/)+/u, "");
      if (key in dependencies) return dependencies[key as keyof typeof dependencies];
      if (name === "node:crypto") return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    }, Request, Response, URL, Date, Intl, setTimeout, clearTimeout,
  });
  return exports;
}
const request = (body: object) => new Request("http://localhost/api/admin/cs/sync", { method: "POST", body: JSON.stringify(body) });

test("CS sync queues only inquiries and never reads, normalizes, or enqueues orders", async () => {
  const calls: RpcCall[] = [];
  const route = loadRoute("sync", async (name, args) => {
    calls.push({ name, args });
    if (name === "sellerpilot_list_credentials") return { data: [{ id: "fixture", channel: "qoo10", status: "active", environment: "production" }], error: null };
    assert.equal(name, "sellerpilot_service_enqueue_periodic_sync");
    assert.equal(args.p_operation, "inquiries.list");
    return { data: { status: "queued" }, error: null };
  });
  const response = await route.POST(request({ channels: ["qoo10"], includeImBootstrap: true }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.results, undefined);
  assert.equal(body.inquiryResults[0].queuedJobs, 1);
  assert.equal(calls.length, 2);
});

test("CS sync denial performs no DB work", async () => {
  const route = loadRoute("sync", () => { throw new Error("must not call DB"); }, true);
  assert.equal((await route.POST(request({ includeImBootstrap: true }))).status, 403);
});

test("CS ticket status calls only its ticket RPC with the exact inbound generation", async () => {
  const calls: RpcCall[] = [];
  const route = loadRoute("ticket-status", async (name, args) => { calls.push({ name, args }); return { data: true, error: null }; });
  const response = await route.POST(request({ id: "00000000-0000-4000-8000-000000000001", status: "in_progress", expectedInboundKey: "generation-2" }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "sellerpilot_update_ticket");
  assert.equal(calls[0].args.p_expected_inbound_key, "generation-2");
});

for (const code of ["INQUIRY_CONTEXT_STALE", "CS_DELIVERY_LOCKED", "REMOTE_REPLY_SUCCESS_REQUIRED", "LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE"]) {
  test(`CS ticket status preserves ${code} as conflict`, async () => {
    const route = loadRoute("ticket-status", async () => ({ data: null, error: { message: code } }));
    assert.equal((await route.POST(request({ id: "00000000-0000-4000-8000-000000000001", status: "resolved", expectedInboundKey: "generation-1" }))).status, 409);
  });
}

test("CS ticket endpoint rejects commerce-shaped payloads before DB access", async () => {
  const route = loadRoute("ticket-status", () => { throw new Error("must not call DB"); });
  assert.equal((await route.POST(request({ id: "00000000-0000-4000-8000-000000000001", status: "in_progress", expectedInboundKey: null, productId: "other-domain" }))).status, 400);
});

test("both executors reject a wrong-domain operation before reaching a provider", async () => {
  const input = { channel: "elevenst", operation: "listing.create", payload: {}, arguments: {}, environment: "production" };
  await assert.rejects(executeCsOperation(input as Parameters<typeof executeCsOperation>[0]), /CS_OPERATION_UNSUPPORTED/);
  await assert.rejects(executeCommerceOperation({ ...input, operation: "inquiries.list" } as unknown as Parameters<typeof executeCommerceOperation>[0]), /COMMERCE_OPERATION_UNSUPPORTED/);
});
