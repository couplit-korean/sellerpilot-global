import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = await readFile(new URL("../app/api/operations/sync/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const run = {
  runId: "00000000-0000-4000-8000-000000000004", status: "queued", historyDays: 30,
  fromDate: "2024-01-31", toDate: "2024-02-29", channels: ["smartstore"],
  expectedInitialJobs: 2, totalJobs: 2, queuedJobs: 2, runningJobs: 0, succeededJobs: 0, failedJobs: 0,
  progressPercent: 0, startedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", completedAt: null,
};
async function call(body: unknown, { denied = false, egress = true } = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const sandbox = vm.createContext({ exports: {}, Request, Response, URL, Date, require(name: string) {
    if (name === "zod") return { z };
    if (name === "next/server") return { NextResponse: Response };
    if (name.endsWith("/admin-api")) return {
      authenticateAdminRequest: async () => denied ? Response.json({}, { status: 401 }) : {
        userClient: { rpc: async (name: string, args?: Record<string, unknown>) => {
          calls.push({ name, args });
          return { data: name === "sellerpilot_list_credentials" ? [{ id: "credential", channel: "smartstore", status: "active", environment: "production" }] : run, error: null };
        } },
        serviceClient: { rpc: async (name: string) => { calls.push({ name }); return { data: { smartstore: egress }, error: null }; } },
      },
      isAdminApiError: (value: unknown) => value instanceof Response,
    };
    if (name.endsWith("/catalog")) return { isActiveChannelKey: (channel: string) => channel === "smartstore" };
    if (name.endsWith("/serverless-static-egress")) return {
      configuredServerlessStaticEgressChannels: () => egress ? ["smartstore"] : [],
      hasServerlessStaticEgressFor: (available: string[], requested: string[]) => requested.every(channel => available.includes(channel)),
      SERVERLESS_STATIC_EGRESS_REQUIRED: "STATIC_EGRESS_REQUIRED",
    };
    if (name.endsWith("/promise-pool")) return { createPromiseGate: () => () => { throw new Error("unexpected enqueue"); } };
    if (/\/(operations|inquiry-sync|lazada-im-bootstrap|order-sync|push-notifications)$/.test(name)) return {};
    throw new Error(`unexpected import ${name}`);
  } });
  vm.runInContext(compiled, sandbox);
  return { response: await sandbox.exports.POST(new Request("https://example.test/api/operations/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })), calls };
}
test("past history route authenticates and rejects invalid or detached dates before any database call", async () => {
  assert.equal((await call({}, { denied: true })).response.status, 401);
  for (const historyEndDate of ["2024-02-30", "9999-01-01", "1999-12-31", "2024-2-29", ""]) {
    const result = await call({ channels: ["smartstore"], historyDays: 30, historyEndDate });
    assert.equal(result.response.status, 400); assert.equal(result.calls.length, 0);
  }
  const detached = await call({ channels: ["smartstore"], historyEndDate: "2024-02-29" });
  assert.equal(detached.response.status, 400); assert.equal(detached.calls.length, 0);
});
test("past date uses the authenticated v3 RPC and preserves the selected period in its response", async () => {
  const result = await call({ channels: ["smartstore"], historyDays: 30, historyEndDate: "2024-02-29" });
  assert.equal(result.response.status, 202);
  const rpc = result.calls.find(call => call.name === "sellerpilot_start_inquiry_history_backfill_v3");
  assert.deepEqual(JSON.parse(JSON.stringify(rpc?.args)), { p_channels: ["smartstore"], p_history_days: 30, p_end_date: "2024-02-29" });
  assert.match((await result.response.json()).message, /2024-01-31~2024-02-29/);
});
test("past window egress failures show the requested dates and never enqueue", async () => {
  const result = await call({ channels: ["smartstore"], historyDays: 30, historyEndDate: "2024-02-29" }, { egress: false });
  assert.equal(result.response.status, 409); assert.equal(result.calls.length, 0);
  const body = await result.response.json();
  assert.equal(body.historyBackfill.fromDate, "2024-01-31"); assert.equal(body.historyBackfill.toDate, "2024-02-29");
});
test("legacy current-window clients retain the v2 RPC contract", async () => {
  const result = await call({ channels: ["smartstore"], historyDays: 30 });
  assert.equal(result.response.status, 202);
  assert.ok(result.calls.some(call => call.name === "sellerpilot_start_inquiry_history_backfill_v2"));
  assert.ok(!result.calls.some(call => call.name.endsWith("_v3")));
});
