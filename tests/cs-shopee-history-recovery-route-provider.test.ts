import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildShopeeHistoryRecoveryRequest } from "../lib/channels/cs/shopee/history-recovery";
import { withShopeeHistoryContinuation } from "../lib/channels/cs/shopee/history-event-evidence";
import { planShopeeReviewHistory } from "../lib/channels/cs/shopee/history-plan";
import type { ShopeeHistoryCheckpoint } from "../lib/channels/cs/shopee/history-progress";
import {
  shopeeHistoryRecoveryRequestSchema,
  shopeeHistoryRecoveryResultSchema,
} from "../lib/cs/channels/shopee/history-recovery-contract";
import { executeCsProviderJob } from "../lib/cs/operations/provider";

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/shopee/history-resume/route.ts",
  import.meta.url,
), "utf8");
const uiSource = await readFile(new URL(
  "../app/cs/channels/shopee/history-progress.tsx",
  import.meta.url,
), "utf8");
const transpiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiledRoute.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);

const ownerId = "00000000-0000-4000-8000-000000029001";
const credentialId = "00000000-0000-4000-8000-000000029002";
const failedJobId = "00000000-0000-4000-8000-000000029003";
const recoveryJobId = "00000000-0000-4000-8000-000000029004";
const requestKey = "00000000-0000-4000-8000-000000029005";
const shopId = "1719148844";
const historyRunId = "shopee-history-00000000000040008000000000029006";
const cursor = "opaque-route+/provider==";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function recoveryFixture() {
  const [scope] = planShopeeReviewHistory([{ shopId, country: "SG" }]);
  const initial = { ...scope.arguments, sellerpilotShopeeScopeKey: scope.scopeKey,
    sellerpilotShopeeHistoryRunId: historyRunId, sellerpilotShopeeHistorySequence: 1,
    sellerpilotShopeeInputCheckpointDigest: null };
  const failedArguments = withShopeeHistoryContinuation(initial, { ...initial, cursor,
    sellerpilotPaginationDepth: 1, sellerpilotPaginationEpoch: 0,
    sellerpilotPaginationTrail: ["a".repeat(64)] });
  const checkpoint: ShopeeHistoryCheckpoint = { kind: "product_review",
    checkpointDigest: String(failedArguments.sellerpilotShopeeInputCheckpointDigest),
    cursorDigest: digest(cursor), paginationDepth: 1, paginationEpoch: 0 };
  return buildShopeeHistoryRecoveryRequest({ credentialId, historyRunId, scope,
    activeCheckpoint: checkpoint,
    failedJob: { id: failedJobId, credentialId, channel: "shopee", operation: "inquiries.list",
      status: "failed", request: { arguments: failedArguments } },
    interruption: { jobId: failedJobId, sequence: 2,
      checkpointDigest: checkpoint.checkpointDigest, reason: "failed" },
  });
}

function loadRoute(recovery = recoveryFixture()) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({ exports: exportsObject, Request, Response,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({ user: { id: ownerId }, serviceClient: {
          rpc: async (rpcName: string, args: Record<string, unknown>) => {
            calls.push({ name: rpcName, args });
            return { data: { contract: recovery.contract, status: "queued",
              historyRunId: recovery.historyRunId, scopeKey: recovery.scopeKey,
              recoveryJobId, recoveryAttempt: recovery.recoveryAttempt,
              inputCheckpointDigest: recovery.request.arguments.sellerpilotShopeeInputCheckpointDigest }, error: null };
          },
        } }),
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      if (name.endsWith("/history-recovery-contract")) {
        return { shopeeHistoryRecoveryRequestSchema, shopeeHistoryRecoveryResultSchema };
      }
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(transpiledRoute.outputText, sandbox);
  return { POST: exportsObject.POST as (request: Request) => Promise<Response>, calls, recovery };
}

test("authenticated resume route carries the exact scope into a read-only provider execution", async () => {
  const loaded = loadRoute();
  const response = await loaded.POST(new Request("https://sellerpilot.invalid/history-resume", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestKey, historyRunId, scopeKey: loaded.recovery.scopeKey }),
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls)), [{ name: "sellerpilot_service_resume_cs_shopee_history_v1", args: {
    p_actor_id: ownerId, p_request_key: requestKey,
    p_history_run_id: historyRunId, p_scope_key: loaded.recovery.scopeKey,
  } }]);

  let mutationCalled = false;
  const calls: Array<Record<string, unknown>> = [];
  const providerResult = await executeCsProviderJob({
    job: { id: recoveryJobId, claim_token: requestKey, credential_id: credentialId,
      channel: "shopee", operation: "inquiries.list", environment: "production",
      request: loaded.recovery.request, attempt_count: 1,
      credential: { partner_id: "2031489", partner_key: "synthetic-partner-key",
        main_account_id: "9001", provider_account_identity_version: "v1",
        provider_account_subject: "shopee:main:9001", shop_id: shopId,
        shopee_targets: [{ type: "shop", id: shopId, access_token: "access-token",
          refresh_token: "refresh-token", access_token_expires_at: "2099-01-01T00:00:00.000Z",
          refresh_token_expires_at: "2099-02-01T00:00:00.000Z" }] } },
    signal: new AbortController().signal,
    hooks: { assertLeaseHealthy: async () => {}, beginProviderMutation: async () => { mutationCalled = true; },
      beginCredentialMutation: async () => {}, stageCredentialRefresh: async () => {} },
  }, async input => {
    calls.push(input.arguments);
    return { ok: true, channel: "shopee", operation: "inquiries.list",
      steps: [{ name: "inquiries", ok: true, status: 200,
        data: { sellerpilotProviderContext: { shopId }, response: { item_comment_list: [], more: false } } }],
      safeMessage: "synthetic read" };
  });
  assert.equal(providerResult.ok, true);
  assert.equal(mutationCalled, false);
  assert.equal(calls[0]?.shopId, shopId);
  assert.equal(calls[0]?.cursor, cursor);
  assert.equal(calls[0]?.sellerpilotShopeeInputCheckpointDigest,
    loaded.recovery.request.arguments.sellerpilotShopeeInputCheckpointDigest);
});

test("route rejects malformed or widened bodies before the service RPC", async () => {
  for (const body of [
    { requestKey: "not-a-uuid", historyRunId, scopeKey: "x" },
    { requestKey, historyRunId, scopeKey: "x", reply: "must-not-send" },
  ]) {
    const loaded = loadRoute();
    const response = await loaded.POST(new Request("https://sellerpilot.invalid/history-resume", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    assert.equal(response.status, 400);
    assert.equal(loaded.calls.length, 0);
  }
});

test("Shopee UI compiles and exposes resume only for failed or authorization-required scopes", () => {
  assert.match(uiSource, /\/api\/admin\/cs\/channels\/shopee\/history-resume/u);
  assert.match(uiSource, /\["failed", "authorization_required"\]\.includes\(scope\.status\)/u);
  assert.match(uiSource, /historyRunId, scopeKey/u);
  assert.match(uiSource, /시도 \$\{recovered\.recoveryAttempt\}\/3/u);
  const transpiled = ts.transpileModule(uiSource, {
    compilerOptions: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  assert.equal(transpiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
});
