import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as recovery from "../lib/channels/cs/coupang/history-recovery.ts";

const source = await readFile(new URL("../app/api/admin/cs/sync/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
const runId = "00000000-0000-4000-8000-000000000201";
const state = {
  runId, status: "failed", historyDays: 30, fromDate: "2024-01-31", toDate: "2024-02-29",
  channels: ["coupang"], expectedInitialJobs: 40, totalJobs: 40, queuedJobs: 0, runningJobs: 0,
  succeededJobs: 39, failedJobs: 1, progressPercent: 100,
  startedAt: "2024-03-01T00:00:00Z", updatedAt: "2024-03-01T00:01:00Z", completedAt: "2024-03-01T00:01:00Z",
};
function route(data: unknown, denied = false) {
  const calls: string[] = [];
  const sandbox = vm.createContext({ exports: {}, Request, Response, URL, Date,
    require(name: string) {
      if (name === "zod") return { z };
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/cs/coupang/history-recovery")) return recovery;
      if (name.endsWith("/promise-pool")) return { createPromiseGate: () => (fn: () => unknown) => fn() };
      if (name.endsWith("/catalog")) return { isActiveChannelKey: () => true };
      if (name.endsWith("/serverless-static-egress")) return {
        configuredServerlessStaticEgressChannels: () => ["coupang"], hasServerlessStaticEgressFor: () => true,
        SERVERLESS_STATIC_EGRESS_REQUIRED: "SERVERLESS_STATIC_EGRESS_REQUIRED",
      };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => denied ? Response.json({}, { status: 401 }) : {
          userClient: { rpc: async (rpcName: string) => {
            calls.push(rpcName);
            return { data: rpcName === "sellerpilot_list_credentials" ? [{ id: runId, channel: "coupang", environment: "production", status: "active" }] : data, error: null };
          } },
          serviceClient: { rpc: async () => ({ data: { coupang: true }, error: null }) },
        },
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      if (["/operations", "/inquiry-sync", "/lazada-im-bootstrap", "/order-sync", "/push-notifications"].some(path => name.endsWith(path))) return {};
      throw new Error(`unexpected module ${name}`);
    },
  });
  vm.runInContext(compiled.outputText, sandbox);
  return { handlers: sandbox.exports as { GET(r: Request): Promise<Response>; POST(r: Request): Promise<Response> }, calls };
}
function request(method = "GET") {
  return new Request(`https://sellerpilot.test/api/operations/sync?runId=${runId}`, method === "GET" ? {} : {
    method, headers: { "content-type": "application/json" },
    body: JSON.stringify({ channels: ["coupang"], historyDays: 30, historyEndDate: "2024-02-29" }),
  });
}
test("actual sync GET keeps failed history on the same window and advances only all-success jobs", async () => {
  let result = await route(state).handlers.GET(request());
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).checkpoint, { canAdvance: false, replayEndDate: "2024-02-29", nextEndDate: null });
  result = await route({ ...state, status: "succeeded", totalJobs: 42, succeededJobs: 42, failedJobs: 0 }).handlers.GET(request());
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).checkpoint, { canAdvance: true, replayEndDate: "2024-02-29", nextEndDate: "2024-01-30" });
});
test("actual sync GET rejects cross-run responses and inconsistent job counts before display", async () => {
  for (const data of [{ ...state, runId: "00000000-0000-4000-8000-000000000202" }, { ...state, totalJobs: 41 }]) {
    assert.equal((await route(data).handlers.GET(request())).status, 502);
  }
  const denied = route(state, true);
  assert.equal((await denied.handlers.GET(request())).status, 401);
  assert.deepEqual(denied.calls, []);
});
test("actual sync POST verifies the requested channel, dates and initial scopes in the returned receipt", async () => {
  for (const data of [{ ...state, channels: ["elevenst"] }, { ...state, toDate: "2024-02-28" }, { ...state, expectedInitialJobs: 39 }]) {
    assert.equal((await route(data).handlers.POST(request("POST"))).status, 502);
  }
  const result = await route({ ...state, status: "queued", queuedJobs: 40, succeededJobs: 0, failedJobs: 0, completedAt: null }).handlers.POST(request("POST"));
  assert.equal(result.status, 202);
  assert.equal((await result.json()).checkpoint.canAdvance, false);
});
