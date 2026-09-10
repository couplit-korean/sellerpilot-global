import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import {
  temuBuyerChatReadinessViewSchema,
  temuBuyerChatRuntimeReadSchema,
  temuCsReadiness,
} from "../lib/channels/cs/temu/runtime-readiness";
import { temuHistoryAccountsSchema } from "../lib/cs/channels/temu/history-resume";

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/temu/buyer-chat-readiness/route.ts", import.meta.url,
), "utf8");
const uiSource = await readFile(new URL(
  "../app/cs/channels/temu/buyer-chat-readiness.tsx", import.meta.url,
), "utf8");
const workspaceSource = await readFile(new URL("../app/cs/workspace.tsx", import.meta.url), "utf8");
const transpiled = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);

const credentialId = "00000000-0000-4000-8000-00000000b801";
const sellerAccountKey = "b".repeat(64);
const checkedAt = new Date().toISOString();
const account = {
  credentialId,
  label: "Temu 운영 계정 · 키 abcdef12 · v1",
  environment: "production" as const,
  credentialFingerprint: "abcdef123456",
  sellerAccountKeyHash: sellerAccountKey,
};
const accounts = {
  contract: "sellerpilot-temu-cs-accounts/1" as const,
  checkedAt,
  accounts: [account],
};
const read = {
  contract: "sellerpilot-temu-buyer-chat-runtime-read/1" as const,
  checkedAt,
  credentialId,
  sellerAccountKey,
  environment: "production" as const,
  evidence: null,
};

function observedRead() {
  const now = Date.now();
  return {
    ...read,
    evidence: {
      contract: "sellerpilot-temu-buyer-chat-runtime-evidence/1",
      source: "sellerpilot_private.temu_buyer_chat_readiness_evidence",
      sourceKind: "partner_center_authenticated_readback",
      sourceRevision: 3,
      sourceRevisionSha256: "c".repeat(64),
      credentialId,
      sellerAccountKey,
      environment: "production",
      region: "GLOBAL",
      observedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
      appStatus: "Inactive",
      complianceStatus: "Reviewing",
      securityQuestionnaireStatus: "Reviewing",
      sellerAuthorizationStatus: "Reviewing",
      contractKey: null,
      contractRevisionSha256: null,
      permissionPackage: null,
      grantedPermissionPackages: [],
    },
  };
}

function loadRoute({ auth = "admin", readData = read, readError = null }: {
  auth?: "admin" | "anonymous" | "nonadmin";
  readData?: unknown;
  readError?: unknown;
} = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({ exports: exportsObject, Request, Response, URL, Object,
    require(name: string) {
      if (name === "zod") return { z };
      if (name === "node:crypto") return { createHash, randomUUID };
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => {
          if (auth === "anonymous") return Response.json({}, { status: 401 });
          if (auth === "nonadmin") return Response.json({}, { status: 403 });
          return { userClient: { rpc: async (rpcName: string, args?: Record<string, unknown>) => {
            calls.push({ name: rpcName, args });
            if (rpcName === "sellerpilot_list_temu_cs_accounts_v1") return { data: accounts, error: null };
            if (rpcName === "sellerpilot_read_temu_buyer_chat_readiness_v1") {
              return { data: readData, error: readError };
            }
            throw new Error(`unexpected rpc ${rpcName}`);
          } } };
        },
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      if (name.endsWith("/channels/cs/temu/runtime-readiness")) return {
        temuBuyerChatReadinessViewSchema, temuBuyerChatRuntimeReadSchema, temuCsReadiness,
      };
      if (name.endsWith("/cs/channels/temu/history-resume")) return { temuHistoryAccountsSchema };
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(transpiled.outputText, sandbox);
  return { GET: exportsObject.GET as (request: Request) => Promise<Response>, calls };
}

test("authenticated readiness endpoint returns exact blocker without provider fetch", async () => {
  const loaded = loadRoute();
  const response = await loaded.GET(new Request(
    `https://sellerpilot.invalid/api/admin/cs/channels/temu/buyer-chat-readiness?credentialId=${credentialId}`,
  ));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  const body = await response.json();
  assert.equal(body.ready, false);
  assert.deepEqual(body.blockers, ["TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE"]);
  assert.equal(body.providerFetchPerformed, false);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls)), [
    { name: "sellerpilot_list_temu_cs_accounts_v1" },
    { name: "sellerpilot_read_temu_buyer_chat_readiness_v1", args: { p_credential_id: credentialId } },
  ]);
});

test("endpoint keeps current inactive and Reviewing evidence as exact external blockers", async () => {
  const loaded = loadRoute({ readData: observedRead() });
  const response = await loaded.GET(new Request(
    `https://sellerpilot.invalid/readiness?credentialId=${credentialId}`,
  ));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ready, false);
  assert.equal(body.providerFetchPerformed, false);
  assert.deepEqual(body.blockers, [
    "TEMU_APP_INACTIVE",
    "TEMU_COMPLIANCE_NOT_APPROVED",
    "TEMU_SECURITY_QUESTIONNAIRE_NOT_APPROVED",
    "TEMU_SELLER_AUTHORIZATION_NOT_APPROVED",
    "TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED",
  ]);
  assert.deepEqual(body.evidenceSource.sourceRevision, 3);
});

test("route rejects unauthenticated, widened, cross-account and malformed evidence", async () => {
  for (const auth of ["anonymous", "nonadmin"] as const) {
    const loaded = loadRoute({ auth });
    const response = await loaded.GET(new Request(
      `https://sellerpilot.invalid/readiness?credentialId=${credentialId}`,
    ));
    assert.equal(response.status, auth === "anonymous" ? 401 : 403);
    assert.equal(loaded.calls.length, 0);
  }
  const widened = loadRoute();
  assert.equal((await widened.GET(new Request(
    `https://sellerpilot.invalid/readiness?credentialId=${credentialId}&reply=true`,
  ))).status, 400);
  assert.equal(widened.calls.length, 0);

  const crossAccount = loadRoute({ readData: { ...read, credentialId: "00000000-0000-4000-8000-00000000b899" } });
  assert.equal((await crossAccount.GET(new Request(
    `https://sellerpilot.invalid/readiness?credentialId=${credentialId}`,
  ))).status, 502);
  const malformed = loadRoute({ readData: { ...read, extra: true } });
  assert.equal((await malformed.GET(new Request(
    `https://sellerpilot.invalid/readiness?credentialId=${credentialId}`,
  ))).status, 502);
});

test("admin CS UI mounts a GET-only blocker view with no reply control", () => {
  assert.match(workspaceSource, /<TemuBuyerChatReadiness authenticatedFetch=\{authenticatedFetch\}/u);
  assert.match(uiSource, /buyer-chat-readiness\?\$\{query\}/u);
  assert.match(uiSource, /method: "GET"/u);
  assert.doesNotMatch(uiSource, /method: "POST"/u);
  assert.match(uiSource, /provider fetch: 실행 안 함/u);
  assert.match(uiSource, /임의 계약 문자열로 권한을 추정하지 않습니다/u);
  assert.doesNotMatch(uiSource, /답변 전송<\/button>/u);
  assert.match(uiSource, /new AbortController\(\)/u);
  assert.match(uiSource, /signal: controller\.signal/u);
  assert.match(uiSource, /requestGeneration\.current/u);
  for (const source of [uiSource, workspaceSource]) {
    const result = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
    });
    assert.equal(result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
  }
});
