import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = await readFile(new URL("../app/api/admin/cs/sync/route.ts", import.meta.url), "utf8");
const authorizeSource = await readFile(new URL(
  "../app/api/admin/channel-credentials/lazada/authorize/route.ts",
  import.meta.url,
), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const ownerOne = "00000000-0000-4000-8000-000000002001";
const ownerTwo = "00000000-0000-4000-8000-000000002002";
const credentialOne = "00000000-0000-4000-8000-000000002011";
const credentialTwo = "00000000-0000-4000-8000-000000002012";

async function invoke() {
  const calls: Array<{ client: "user" | "service"; name: string; args?: Record<string, unknown> }> = [];
  const active = (id: string, owner_id: string, seller_account_key: string) => ({
    id, owner_id, environment: "production", status: "active",
    seller_account_key, seller_account_key_source: "provider_certified_v1",
    seller_account_verified_at: "2026-09-09T00:00:00.000Z",
    created_at: "2026-09-09T00:00:00.000Z",
  });
  const sandbox = vm.createContext({ exports: {}, Request, Response, URL, Date, Set, console, require(name: string) {
    if (name === "zod") return { z };
    if (name === "next/server") return { NextResponse: Response };
    if (name.endsWith("/admin-api")) return {
      authenticateAdminRequest: async () => ({
        userClient: { rpc: async (rpcName: string, args?: Record<string, unknown>) => {
          calls.push({ client: "user", name: rpcName, args });
          if (rpcName === "sellerpilot_list_credentials") return { data: [
            { id: "legacy-first-only", channel: "lazada", environment: "production", status: "active" },
          ], error: null };
          if (rpcName === "sellerpilot_list_active_lazada_credentials") return { data: [
            active(credentialOne, ownerOne, "a".repeat(64)),
            active(credentialTwo, ownerTwo, "b".repeat(64)),
            { ...active("00000000-0000-4000-8000-000000002013", ownerOne, "c".repeat(64)), seller_account_verified_at: null },
          ], error: null };
          throw new Error(`unexpected user RPC ${rpcName}`);
        } },
        serviceClient: { rpc: async (rpcName: string, args?: Record<string, unknown>) => {
          calls.push({ client: "service", name: rpcName, args });
          if (rpcName === "sellerpilot_service_serverless_static_egress_status") return { data: {}, error: null };
          if (rpcName === "sellerpilot_service_consume_lazada_im_bootstrap") return { data: true, error: null };
          if (rpcName === "sellerpilot_service_enqueue_lazada_periodic_sync") return { data: { status: "queued" }, error: null };
          throw new Error(`unexpected service RPC ${rpcName}`);
        } },
      }),
      isAdminApiError: (value: unknown) => value instanceof Response,
    };
    if (name.endsWith("/catalog")) return { isActiveChannelKey: (channel: string) => channel === "lazada" };
    if (name.endsWith("/lazada-im-bootstrap")) return { shouldBootstrapLazadaIm: ({ requested }: { requested: boolean }) => requested };
    if (name.endsWith("/inquiry-sync")) return { inquirySyncRequests: () => [] };
    if (name.endsWith("/promise-pool")) return { createPromiseGate: () => (operation: () => unknown) => operation() };
    if (name.endsWith("/serverless-static-egress")) return {
      configuredServerlessStaticEgressChannels: () => [], hasServerlessStaticEgressFor: () => false,
      SERVERLESS_STATIC_EGRESS_REQUIRED: "STATIC_EGRESS_REQUIRED",
    };
    if (name.endsWith("/cs/coupang/history-recovery")) return {};
    throw new Error(`unexpected import ${name}`);
  } });
  vm.runInContext(compiled, sandbox);
  const response = await sandbox.exports.POST(new Request("https://fixture.test/api/admin/cs/sync", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ channels: ["lazada"], includeImBootstrap: true }),
  }));
  return { response, calls };
}

test("manual Lazada bootstrap enqueues every verified account by exact credential", async () => {
  const { response, calls } = await invoke();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.connectedChannels, ["lazada"]);
  assert.equal(body.inquiryResults.length, 2);
  const enqueue = calls.filter((call) => call.name === "sellerpilot_service_enqueue_lazada_periodic_sync");
  assert.deepEqual(enqueue.map((call) => call.args?.p_credential_id), [credentialOne, credentialTwo]);
  assert.ok(enqueue.every((call) => call.args?.p_operation === "inquiries.list"));
  assert.equal(calls.some((call) => call.name === "sellerpilot_service_enqueue_periodic_sync"), false);
  assert.equal(calls.filter((call) => call.name === "sellerpilot_service_consume_lazada_im_bootstrap").length, 2);
});

test("Lazada authorization rotates one exact predecessor instead of a channel-global credential", () => {
  assert.match(authorizeSource, /rpc\("sellerpilot_rotate_lazada_credential"/);
  assert.match(authorizeSource, /p_previous_credential_id: credentialId \?\? null/);
  assert.doesNotMatch(authorizeSource, /rpc\("sellerpilot_rotate_credential"/);
});
