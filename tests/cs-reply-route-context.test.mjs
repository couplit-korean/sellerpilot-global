import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

const source = await readFile(new URL("../app/api/admin/cs/reply/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ticketId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const secret = "PRIVATE_RPC_ERROR_MUST_NOT_ESCAPE";
const context = { channel_key: "qoo10", environment: "production", external_ticket_id: "fixture-ticket", status: "waiting", provider_status: "waiting", latest_inbound_key: "inbound-1", provider_context: {} };

async function run({ current = { data: context, error: null }, dispatch = { data: context, error: null }, rejectCurrent = false, rejectDispatch = false, expectedInboundKey = "inbound-1" } = {}) {
  const calls = [];
  const userClient = { async rpc(name) {
    calls.push(name);
    if (name === "sellerpilot_get_ticket_reply_context_v2") {
      if (rejectCurrent) throw new Error(secret);
      return current;
    }
    if (name === "sellerpilot_get_ticket_reply_dispatch_context") {
      if (rejectDispatch) throw new Error(secret);
      return dispatch;
    }
    throw new Error(`Unexpected RPC: ${name}`);
  } };
  const sandbox = vm.createContext({ exports: {}, Request, Response, URL, Date, Error, require(name) {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "zod") return { z };
    if (name.endsWith("/admin-api")) return { authenticateAdminRequest: async () => ({ userClient, serviceClient: {} }), isAdminApiError: () => false };
    if (name.endsWith("/channels/gateway")) return { enqueueInquiryReplyViaChannelGateway: async () => { calls.push("enqueue"); return { jobId }; } };
    if (name.endsWith("/channels/inquiry-reply")) return { supportsInquiryReply: () => true, buildInquiryReplyArguments: () => ({}) };
    if (name.endsWith("/channels/ebay-asq")) return { ebayAsqMarketplaceId: () => null };
    if (name.endsWith("/channels/serverless-static-egress")) return {};
    throw new Error(`Unexpected import: ${name}`);
  } });
  vm.runInContext(compiled, sandbox);
  const response = await sandbox.exports.POST(new Request("https://example.invalid/api/admin/cs/reply", { method: "POST", body: JSON.stringify({ ticketId, expectedInboundKey, reply: "Fixture only" }) }));
  const body = await response.json();
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.ok(!JSON.stringify(body).includes(secret));
  return { response, body, enqueued: calls.filter(name => name === "enqueue").length };
}

for (const [label, options] of [
  ["current RPC error", { current: { data: null, error: { message: secret } } }],
  ["dispatch RPC error", { dispatch: { data: null, error: { message: secret } } }],
  ["current RPC rejection", { rejectCurrent: true }],
  ["dispatch RPC rejection", { rejectDispatch: true }],
]) test(`CS reply fails closed with sanitized 503 on ${label}`, async () => {
  const result = await run(options);
  assert.equal(result.response.status, 503);
  assert.equal(result.enqueued, 0);
});

for (const data of [null, []]) test(`CS reply cannot use dispatch-only context when current context is ${JSON.stringify(data)}`, async () => {
  const result = await run({ current: { data, error: null } });
  assert.equal(result.response.status, 409);
  assert.equal(result.enqueued, 0);
});

test("CS reply still accepts a valid current context exactly once", async () => {
  const result = await run();
  assert.equal(result.response.status, 202);
  assert.equal(result.enqueued, 1);
  assert.equal(result.body.jobId, jobId);
});

test("CS reply still rejects a stale reviewed inbound key", async () => {
  const result = await run({ expectedInboundKey: "older-inbound" });
  assert.equal(result.response.status, 409);
  assert.equal(result.enqueued, 0);
});

for (const [label, override] of [
  ["resolved", { status: "resolved" }],
  ["provider answered", { provider_status: "answered" }],
  ["new inbound", { latest_inbound_key: "inbound-2" }],
]) test(`CS reply uses current ${label} state over stale waiting dispatch data`, async () => {
  const result = await run({ current: { data: { ...context, ...override }, error: null } });
  assert.equal(result.response.status, 409);
  assert.equal(result.enqueued, 0);
});

test("CS reply accepts the supported row-array current context shape", async () => {
  const result = await run({ current: { data: [context], error: null } });
  assert.equal(result.response.status, 202);
  assert.equal(result.enqueued, 1);
});
