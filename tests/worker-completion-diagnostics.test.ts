import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { gatewayWorkerCompletionSchema } from "../lib/channels/gateway-contract";
import { completionSchemaDiagnostic, gatewayCompletionFailureLog, gatewayCompletionSchemaErrorCode, readCompletionSchemaDiagnostic, safeCompletionSchemaIssues } from "../lib/worker-completion-diagnostics";
import { requestWithTransientRetry } from "../scripts/worker-lifecycle-retry.mjs";

const jobId = "4458c940-676f-4fe5-b23f-9de8e20879c5";
const diagnostic = { code: gatewayCompletionSchemaErrorCode, issues: [{ code: "too_big", path: ["error"] }] };

test("real completion validation reports the rejected field without its value or Zod message", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({ jobId, claimToken: jobId, status: "failed", error: "PRIVATE_CUSTOMER_VALUE".repeat(100) });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.deepEqual(safeCompletionSchemaIssues(parsed.error.issues), diagnostic.issues);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({ jobId, claimToken: jobId, status: "failed", error: "안전한 오류" }).success, true);
});

test("diagnostics allowlist paths and issue types, bound size, and discard provider-controlled values", () => {
  const unsafe = { code: "invalid_type", path: ["result", "data", "customer@example.test", 4], message: "SECRET", input: "SECRET", received: "SECRET", keys: ["SECRET"] };
  assert.deepEqual(safeCompletionSchemaIssues([unsafe]), [{ code: "invalid_type", path: ["result", "data", "[field]", 4] }]);
  assert.deepEqual(safeCompletionSchemaIssues([{ ...unsafe, code: "SECRET" }]), []);
  const bounded = safeCompletionSchemaIssues(Array.from({ length: 50 }, () => ({ ...unsafe, path: Array(50).fill("SECRET") })));
  assert.equal(bounded.length, 12);
  assert.ok(bounded.every(issue => issue.path.length === 12));
  assert.doesNotMatch(JSON.stringify(bounded), /SECRET|message|input|received|keys/);
  assert.equal(completionSchemaDiagnostic({ code: "provider_secret", issues: [] }), null);
});

test("only a bounded fixed HTTP 400 diagnostic is read; original response remains available", async () => {
  const response = Response.json({ ...diagnostic, message: "SECRET", credential: "SECRET" }, { status: 400 });
  assert.deepEqual(await readCompletionSchemaDiagnostic(response), diagnostic);
  assert.equal((await response.json()).credential, "SECRET");
  for (const candidate of [Response.json(diagnostic), Response.json({ error: "SECRET" }, { status: 400 }), new Response("not-json-SECRET", { status: 400 }), Response.json({ ...diagnostic, extra: "s".repeat(20_000) }, { status: 400 })]) {
    assert.equal(await readCompletionSchemaDiagnostic(candidate), null);
  }
});

test("completion 400 keeps its one-attempt behavior while job and UTC log carry only safe diagnostics", async () => {
  let attempts = 0;
  let captured: unknown;
  await assert.rejects(requestWithTransientRetry({ request: async () => {
    attempts += 1;
    const response = Response.json(diagnostic, { status: 400 });
    captured = await readCompletionSchemaDiagnostic(response);
    return response;
  }, label: "completion", graceMs: 1000, terminalStatuses: [401, 409], delay: async () => { assert.fail("400 must not retry"); } }), /HTTP 400/);
  assert.equal(attempts, 1);
  assert.deepEqual(gatewayCompletionFailureLog({ jobId, channel: "shopee", operation: "inquiries.list", status: 400, diagnostic: captured, now: new Date("2026-09-14T04:45:00Z") }), {
    jobId, channel: "shopee", operation: "inquiries.list", status: 400, recordedAt: "2026-09-14T04:45:00.000Z", diagnostic,
  });
  assert.doesNotMatch(JSON.stringify(gatewayCompletionFailureLog({ jobId: "SECRET", channel: "SECRET", operation: "SECRET", status: 999, diagnostic: { code: "SECRET", issues: [] } })), /SECRET/);
});

test("worker completion response reaches the detached job error log through the safe helper", async () => {
  const worker = await readFile(new URL("../scripts/channel-gateway-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /path === "\/api\/channel-gateway\/worker\/complete" && response\.status === 400/);
  assert.match(worker, /completionSchemaDiagnostic = await readCompletionSchemaDiagnostic\(response\)/);
  assert.match(worker, /error\.completionSchemaDiagnostic = completionSchemaDiagnostic/);
  assert.match(worker, /gatewayCompletionFailureLog\(\{\s*jobId: gatewayJob\.id/);
  assert.match(worker, /diagnostic: error\?\.completionSchemaDiagnostic/);
});
