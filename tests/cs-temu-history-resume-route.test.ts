import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { executeChannelOperation } from "../lib/channels/operations";
import { executeTemuInquiry } from "../lib/channels/temu-inquiries";
import { runWithProviderReadOnlyTransport } from "../lib/channels/protocols";
import {
  temuDetailRetryReadSchema,
  temuHistoryAccountStateSchema,
  temuHistoryAccountsSchema,
  temuHistoryCheckpointMatchesRequest,
  temuHistoryCheckpointSchema,
  temuHistoryCoverageReadSchema,
  temuHistoryProviderArguments,
  temuHistoryResumeRequestSchema,
} from "../lib/cs/channels/temu/history-resume";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});
const { completeCsClaim } = await import("../lib/cs/operations/complete");

const source = await readFile(new URL(
  "../app/api/admin/cs/channels/temu/history-resume/route.ts",
  import.meta.url,
), "utf8");
const uiSource = await readFile(new URL(
  "../app/cs/channels/temu/history-resume.tsx",
  import.meta.url,
), "utf8");
const workspaceSource = await readFile(new URL("../app/cs/workspace.tsx", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
const credentialId = "00000000-0000-4000-8000-00000000e301";
const runId = "00000000-0000-4000-8000-00000000e302";
const requestKey = "00000000-0000-4000-8000-00000000e303";
const cursor = { date: "2026-09-08", statusGroup: 1, pageNo: 1 };
const sellerAccountKeyHash = "b".repeat(64);
const account = {
  credentialId,
  label: "Temu 운영 계정 · 키 abcdef12 · v1",
  environment: "production" as const,
  credentialFingerprint: "abcdef123456",
  sellerAccountKeyHash,
};
const accountsResponse = {
  contract: "sellerpilot-temu-cs-accounts/1" as const,
  checkedAt: "2026-09-09T11:15:00Z",
  accounts: [account],
};

function checkpoint(status: "idle" | "running" | "failed" | "complete" | "retry_exhausted", retryCount = 0) {
  const complete = status === "complete";
  return {
    contract: "sellerpilot-temu-history-checkpoint/1",
    checkedAt: "2026-09-09T11:15:00Z",
    runId: status === "idle" ? null : runId,
    status,
    credentialId,
    sellerAccountKeyHash,
    fromDate: "2026-09-08",
    toDate: "2026-09-09",
    activeCursor: complete ? null : cursor,
    providerArguments: complete ? null : temuHistoryProviderArguments(cursor),
    completedPageCount: status === "idle" ? 0 : 4,
    pendingJobCount: status === "running" ? 1 : 0,
    retryCount,
    retryCap: 3,
    canResume: status === "idle" || status === "failed",
    completedPagesPreserved: true,
    providerRetention: { status: "unverified", earliestSupportedDate: null },
  };
}

type AuthState = "allowed" | "anonymous" | "nonadmin";
async function loadRoute({
  auth = "allowed",
  accounts = accountsResponse,
  readCheckpoint = checkpoint("running"),
  writeCheckpoint = checkpoint("running"),
  coverage = {
    contract: "cs_history_coverage_read_v2", checkedAt: "2026-09-09T11:15:00Z",
    credentialId, sellerAccountKeyHash,
    coverage: { contract: "cs_history_coverage_read_v1", checkedAt: "2026-09-09T11:15:00Z", scans: [], gaps: [] },
    bindingSummary: { exactSellerRows: 1, legacyCredentialRows: 1 },
  },
  retry = {
    contract: "sellerpilot-temu-detail-retry-read/1", checkedAt: "2026-09-09T11:15:00Z",
    credentialId, sellerAccountKeyHash, retries: [],
  },
  writeError = null,
}: {
  auth?: AuthState;
  accounts?: unknown;
  readCheckpoint?: unknown;
  writeCheckpoint?: unknown;
  coverage?: unknown;
  retry?: unknown;
  writeError?: { message: string } | null;
} = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({
    exports: exportsObject,
    Request,
    Response,
    URL,
    URLSearchParams,
    Date,
    require(name: string) {
      if (name === "zod") return { z };
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => {
          if (auth === "anonymous") return Response.json({ message: "login required" }, { status: 401 });
          if (auth === "nonadmin") return Response.json({ message: "admin required" }, { status: 403 });
          return { userClient: { rpc: async (rpcName: string, args?: Record<string, unknown>) => {
            calls.push({ name: rpcName, args });
            if (rpcName === "sellerpilot_list_temu_cs_accounts_v1") return { data: accounts, error: null };
            if (rpcName === "sellerpilot_get_temu_history_checkpoint_v1") {
              return { data: readCheckpoint, error: null };
            }
            if (rpcName === "sellerpilot_read_cs_history_coverage_v2") return { data: coverage, error: null };
            if (rpcName === "sellerpilot_admin_temu_after_sales_detail_retry_status_v3") {
              return { data: retry, error: null };
            }
            if (rpcName === "sellerpilot_start_or_resume_temu_history_v1") {
              return { data: writeCheckpoint, error: writeError };
            }
            throw new Error(`unexpected rpc ${rpcName}`);
          } } };
        },
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      if (name.endsWith("/cs/channels/temu/history-resume")) return {
        temuHistoryCheckpointMatchesRequest,
        temuHistoryCheckpointSchema,
        temuHistoryAccountsSchema,
        temuHistoryCoverageReadSchema,
        temuDetailRetryReadSchema,
        temuHistoryAccountStateSchema,
        temuHistoryResumeRequestSchema,
      };
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(transpiled.outputText, sandbox);
  return {
    route: exportsObject as {
      GET: (request: Request) => Promise<Response>;
      POST: (request: Request) => Promise<Response>;
    },
    calls,
  };
}

function post(body: unknown) {
  return new Request("https://sellerpilot.test/api/admin/cs/channels/temu/history-resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credentialId, request: body }),
  });
}

test("authenticated GET keeps exact credential, account, range and running cursor", async () => {
  const loaded = await loadRoute();
  const response = await loaded.route.GET(new Request(
    `https://sellerpilot.test/api/admin/cs/channels/temu/history-resume?view=checkpoint&credentialId=${credentialId}&runId=${runId}&fromDate=2026-09-08&toDate=2026-09-09`,
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(loaded.calls.map(call => call.name), [
    "sellerpilot_list_temu_cs_accounts_v1",
    "sellerpilot_get_temu_history_checkpoint_v1",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls[1]?.args)), {
    p_credential_id: credentialId,
    p_run_id: runId,
    p_from_date: "2026-09-08",
    p_to_date: "2026-09-09",
  });
  assert.equal((await response.json()).providerRetention.status, "unverified");
});

test("anonymous, non-admin, inactive selected credential and invalid range stop before checkpoint mutation", async () => {
  for (const auth of ["anonymous", "nonadmin"] as const) {
    const loaded = await loadRoute({ auth });
    assert.equal((await loaded.route.POST(post({ action: "start", requestKey,
      fromDate: "2026-09-08", toDate: "2026-09-09" }))).status, auth === "anonymous" ? 401 : 403);
    assert.equal(loaded.calls.length, 0);
  }
  const inactive = await loadRoute({ accounts: { ...accountsResponse, accounts: [] } });
  assert.equal((await inactive.route.POST(post({ action: "start", requestKey,
    fromDate: "2026-09-08", toDate: "2026-09-09" }))).status, 409);
  assert.deepEqual(inactive.calls.map(call => call.name), ["sellerpilot_list_temu_cs_accounts_v1"]);
  const invalid = await loadRoute();
  assert.equal((await invalid.route.POST(post({ action: "start", requestKey,
    fromDate: "2026-09-10", toDate: "2026-09-09" }))).status, 400);
  assert.deepEqual(invalid.calls.map(call => call.name), []);
});

test("start route reaches the exact RPC and its bounded arguments execute only Temu read APIs", async () => {
  const loaded = await loadRoute({ writeCheckpoint: checkpoint("running") });
  const response = await loaded.route.POST(post({
    action: "start", requestKey, fromDate: "2026-09-08", toDate: "2026-09-09",
  }));
  assert.equal(response.status, 202);
  const call = loaded.calls.find(item => item.name === "sellerpilot_start_or_resume_temu_history_v1");
  assert.deepEqual(JSON.parse(JSON.stringify(call?.args)), {
    p_credential_id: credentialId,
    p_request: { action: "start", requestKey, fromDate: "2026-09-08", toDate: "2026-09-09" },
  });
  const body = await response.json();
  assert.equal(body.acceptedNotCompleted, true);
  const requests: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ success: true, result: { data: [], total: 0, pageNumber: 1 } });
  };
  try {
    const result = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "temu",
      operation: "inquiries.list",
      environment: "production",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: body.checkpoint.providerArguments,
    }));
    assert.equal(result.ok, true);
    assert.deepEqual(requests.map(item => item.type), ["bg.aftersales.parentaftersales.list.get"]);
    assert.equal(requests.some(item => /reply|refund\.create|refund\.approve/iu.test(String(item.type))), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("two-account selector binds coverage and retry metadata to the explicitly selected account", async () => {
  const secondCredential = "00000000-0000-4000-8000-00000000e399";
  const loaded = await loadRoute({ accounts: { ...accountsResponse, accounts: [account, {
    ...account, credentialId: secondCredential, label: "Temu 운영 계정 · 키 99887766 · v1",
    credentialFingerprint: "998877665544", sellerAccountKeyHash: "c".repeat(64),
  }] } });
  const accountResponse = await loaded.route.GET(new Request(
    "https://sellerpilot.test/api/admin/cs/channels/temu/history-resume?view=accounts",
  ));
  assert.equal(accountResponse.status, 200);
  assert.equal((await accountResponse.json()).accounts.length, 2);
  const metadata = await loaded.route.GET(new Request(
    `https://sellerpilot.test/api/admin/cs/channels/temu/history-resume?view=metadata&credentialId=${credentialId}`,
  ));
  assert.equal(metadata.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.slice(-2).map(call => [call.name, call.args]))), [
    ["sellerpilot_read_cs_history_coverage_v2", { p_credential_id: credentialId }],
    ["sellerpilot_admin_temu_after_sales_detail_retry_status_v3", {
      p_credential_id: credentialId, p_job_id: null,
    }],
  ]);
  const body = await metadata.json();
  assert.equal(body.account.credentialId, credentialId);
  assert.equal(body.coverage.bindingSummary.legacyCredentialRows, 1);
});

test("cross-bound metadata evidence is rejected instead of being relabeled as the selected account", async () => {
  const loaded = await loadRoute({ coverage: {
    contract: "cs_history_coverage_read_v2", checkedAt: "2026-09-09T11:15:00Z",
    credentialId: runId, sellerAccountKeyHash,
    coverage: { contract: "cs_history_coverage_read_v1", checkedAt: "2026-09-09T11:15:00Z", scans: [], gaps: [] },
    bindingSummary: { exactSellerRows: 0, legacyCredentialRows: 0 },
  } });
  const response = await loaded.route.GET(new Request(
    `https://sellerpilot.test/api/admin/cs/channels/temu/history-resume?view=metadata&credentialId=${credentialId}`,
  ));
  assert.equal(response.status, 502);
});

test("resume is CAS-bound to the failed cursor and increments one bounded retry without clearing page count", async () => {
  const resumed = checkpoint("running", 2);
  const loaded = await loadRoute({ writeCheckpoint: resumed });
  const response = await loaded.route.POST(post({
    action: "resume", runId, expectedCursor: cursor, expectedRetryCount: 1,
  }));
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.checkpoint.retryCount, 2);
  assert.equal(body.checkpoint.completedPageCount, 4);
  assert.equal(body.checkpoint.completedPagesPreserved, true);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.at(-1)?.args)), {
    p_credential_id: credentialId,
    p_request: { action: "resume", runId, expectedCursor: cursor, expectedRetryCount: 1 },
  });

  const mismatch = await loadRoute({ writeCheckpoint: { ...resumed,
    activeCursor: { ...cursor, pageNo: 2 },
    providerArguments: temuHistoryProviderArguments({ ...cursor, pageNo: 2 }),
  } });
  assert.equal((await mismatch.route.POST(post({
    action: "resume", runId, expectedCursor: cursor, expectedRetryCount: 1,
  }))).status, 502);
});

test("Temu adapter keeps history lineage local while detail batches advance one bounded cursor", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Record<string, unknown>[] = [];
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    call += 1;
    if (call === 1) return Response.json({ success: true, result: {
      total: 201, pageNumber: 1,
      data: Array.from({ length: 11 }, (_, index) => ({
        parentAfterSalesSn: `AFTER-${index + 1}`,
        parentOrderSn: `ORDER-${index + 1}`,
        afterSalesStatusGroup: 1,
      })),
    } });
    const index = call - 1;
    return Response.json({ success: true, result: {
      parentAfterSalesSn: `AFTER-${index}`,
      parentOrderSn: `ORDER-${index}`,
      afterSalesList: [{ afterSalesSn: `CHILD-${index}`, orderSn: `ORDER-${index}` }],
    } });
  };
  const baseArguments = {
    ...temuHistoryProviderArguments(cursor),
    sellerpilotTemuHistoryRunId: runId,
    sellerpilotTemuHistoryCursor: cursor,
  };
  try {
    const first = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: baseArguments,
    }));
    assert.equal(first.continuationArguments?.sellerpilotTemuHistoryRunId, runId);
    assert.deepEqual(first.continuationArguments?.sellerpilotTemuHistoryCursor, cursor);
    assert.equal((first.continuationArguments?.detailQueue as unknown[]).length, 1);
    assert.equal(first.continuationArguments?.nextPageNo, 2);
    assert.equal(requestBodies.some(body => "sellerpilotTemuHistoryRunId" in body
      || "sellerpilotTemuHistoryCursor" in body), false);

    const second = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: first.continuationArguments!,
    }));
    assert.deepEqual(second.continuationArguments?.sellerpilotTemuHistoryCursor, {
      ...cursor,
      pageNo: 2,
    });
    assert.equal(second.continuationArguments?.detailQueue, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("common completion records the authenticated history checkpoint only after durable completion", async () => {
  const names: string[] = [];
  const result = await completeCsClaim({
    rpc: async (name, arguments_) => {
      names.push(name);
      if (name === "sellerpilot_service_serverless_cs_completion_context") return { data: {
        status: "running", channel: "temu", operation: "inquiries.list",
        normalization_timestamp: "2026-09-09T11:20:00.000Z",
      }, error: null };
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        assert.equal(arguments_?.p_status, "succeeded");
        return { data: { status: "completed" }, error: null };
      }
      if (name === "sellerpilot_service_record_temu_history_checkpoint_v1") {
        assert.deepEqual(arguments_, {
          p_token_hash: "worker-hash",
          p_job_id: "00000000-0000-4000-8000-00000000e304",
          p_claim_token: "00000000-0000-4000-8000-00000000e305",
        });
        return { data: checkpoint("running"), error: null };
      }
      if (name === "sellerpilot_service_record_cs_credential_binding_v1") return { data: {
        contract: "sellerpilot-cs-credential-binding/1", status: "recorded",
      }, error: null };
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  }, "worker-hash", {
    id: "00000000-0000-4000-8000-00000000e304",
    claim_token: "00000000-0000-4000-8000-00000000e305",
    credential_id: credentialId,
    channel: "temu",
    operation: "inquiries.list",
    environment: "production",
    request: { arguments: {
      ...temuHistoryProviderArguments(cursor),
      sellerpilotTemuHistoryRunId: runId,
      sellerpilotTemuHistoryCursor: cursor,
    } },
    credential: { app_key: "app", app_secret: "secret", access_token: "token" },
    attempt_count: 1,
  }, { status: "succeeded", credentialBinding: {
    contract: "sellerpilot-cs-credential-binding/1",
    channel: "temu",
    operation: "inquiries.list",
    appFingerprint: "a".repeat(64),
    tokenFingerprint: "b".repeat(64),
    targetFingerprints: ["c".repeat(64)],
    country: "UNSCOPED",
    sellerAccountKey: "c".repeat(64),
  }, result: {
    ok: true,
    channel: "temu",
    operation: "inquiries.list",
    steps: [{ name: "inquiries", ok: true, status: 200, data: {
      success: true, result: { data: [], total: 0, pageNumber: 1 },
    } }],
    safeMessage: "read complete",
  } });
  assert.equal(result, "completed");
  assert.ok(names.indexOf("sellerpilot_service_record_temu_history_checkpoint_v1")
    > names.indexOf("sellerpilot_service_complete_serverless_cs_transaction"));
});

test("UI exposes running, failure, resume, retry exhaustion and unknown retention without mutation controls", () => {
  assert.match(uiSource, /Temu 계정 불러오기/);
  assert.match(uiSource, /<select value=\{credentialId\}/);
  assert.match(uiSource, /view: "metadata", credentialId/);
  assert.match(uiSource, /legacy credential\/owner 결속/);
  assert.doesNotMatch(uiSource, /자격증명 UUID|type="text"[^>]*credential/);
  assert.match(uiSource, /실패 cursor 재개/);
  assert.match(uiSource, /접수됐지만 완료되지 않았습니다/);
  assert.match(uiSource, /재시도 상한 도달/);
  assert.match(uiSource, /공급자 보존기간 하한: 미확인/);
  assert.match(uiSource, /completedPageCount/);
  assert.match(uiSource, /expectedCursor: checkpoint\.activeCursor/);
  assert.match(workspaceSource, /<TemuHistoryResume authenticatedFetch=\{authenticatedFetch\}/);
  assert.doesNotMatch(source, /inquiries\.reply|refund\.create|refund\.approve/);
  const compiledUi = ts.transpileModule(uiSource, {
    compilerOptions: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(compiledUi.diagnostics?.length ?? 0, 0);
});
