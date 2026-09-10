import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import {
  temuBuyerChatSourceStatusSchema,
} from "../lib/channels/cs/temu/buyer-chat-source-contract";
import { temuBuyerChatRuntimeReadSchema } from "../lib/channels/cs/temu/runtime-readiness";
import { temuHistoryAccountsSchema } from "../lib/cs/channels/temu/history-resume";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { temuBuyerChatSourceStatus } = await import(
  "../lib/channels/cs/temu/buyer-chat-source-adapter"
);

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/temu/buyer-chat-source-status/route.ts",
  import.meta.url,
), "utf8");
const uiSource = await readFile(new URL(
  "../app/cs/channels/temu/buyer-chat-source-status.tsx",
  import.meta.url,
), "utf8");
const workspaceSource = await readFile(new URL("../app/cs/workspace.tsx", import.meta.url), "utf8");
const transpiled = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiled.diagnostics?.filter(
  item => item.category === ts.DiagnosticCategory.Error,
).length ?? 0, 0);

const credentialId = "00000000-0000-4000-8000-00000000d501";
const sellerAccountKey = "5".repeat(64);
const checkedAt = new Date().toISOString();
const account = {
  credentialId,
  label: "Temu 운영 계정 · 키 source05 · v1",
  environment: "production" as const,
  credentialFingerprint: "source051234",
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

function loadRoute() {
  const calls: string[] = [];
  const exportsObject: Record<string, unknown> = {};
  const context = vm.createContext({
    exports: exportsObject,
    Request,
    Response,
    URL,
    Object,
    z,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return { z };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({
          userClient: {
            rpc: async (rpcName: string) => {
              calls.push(rpcName);
              if (rpcName === "sellerpilot_list_temu_cs_accounts_v1") {
                return { data: accounts, error: null };
              }
              if (rpcName === "sellerpilot_read_temu_buyer_chat_readiness_v1") {
                return { data: read, error: null };
              }
              throw new Error(`unexpected RPC ${rpcName}`);
            },
          },
        }),
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      if (name.endsWith("/channels/cs/temu/runtime-readiness")) {
        return { temuBuyerChatRuntimeReadSchema };
      }
      if (name.endsWith("/channels/cs/temu/buyer-chat-source-adapter")) {
        return { temuBuyerChatSourceStatus };
      }
      if (name.endsWith("/cs/channels/temu/history-resume")) {
        return { temuHistoryAccountsSchema };
      }
      throw new Error(`unexpected route import ${name}`);
    },
  });
  vm.runInContext(transpiled.outputText, context);
  return { GET: exportsObject.GET as (request: Request) => Promise<Response>, calls };
}

test("authenticated source status route returns implemented unsupported state without provider fetch", async () => {
  const originalFetch = globalThis.fetch;
  let providerFetchCount = 0;
  globalThis.fetch = async () => {
    providerFetchCount += 1;
    throw new Error("source status route must not fetch provider");
  };
  try {
    const route = loadRoute();
    const response = await route.GET(new Request(
      `https://sellerpilot.invalid/api/admin/cs/channels/temu/buyer-chat-source-status?credentialId=${credentialId}`,
    ));
    assert.equal(response.status, 200);
    const status = temuBuyerChatSourceStatusSchema.parse(await response.json());
    assert.equal(status.sourceAdapterImplemented, true);
    assert.equal(status.currentAssignmentLocalImplementationComplete, true);
    assert.equal(status.providerState, "unsupported");
    assert.equal(status.providerFetchPerformed, false);
    assert.equal(status.canonicalPromotionPerformed, false);
    assert.deepEqual(route.calls, [
      "sellerpilot_list_temu_cs_accounts_v1",
      "sellerpilot_read_temu_buyer_chat_readiness_v1",
    ]);
    assert.equal(providerFetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("source status route denies malformed or unbound account selection before readiness read", async () => {
  const malformed = loadRoute();
  const malformedResponse = await malformed.GET(new Request(
    "https://sellerpilot.invalid/api/admin/cs/channels/temu/buyer-chat-source-status?credentialId=bad",
  ));
  assert.equal(malformedResponse.status, 400);
  assert.deepEqual(malformed.calls, []);
  assert.equal((await malformedResponse.json()).canonicalPromotionPerformed, false);

  const unbound = loadRoute();
  const response = await unbound.GET(new Request(
    "https://sellerpilot.invalid/api/admin/cs/channels/temu/buyer-chat-source-status?credentialId=00000000-0000-4000-8000-00000000d599",
  ));
  assert.equal(response.status, 409);
  assert.deepEqual(unbound.calls, ["sellerpilot_list_temu_cs_accounts_v1"]);
  assert.equal((await response.json()).providerFetchPerformed, false);
});

test("workspace renders source status UI with no raw upload or provider action", () => {
  assert.match(workspaceSource, /TemuBuyerChatSourceStatusPanel/u);
  assert.match(uiSource, /buyer-chat-source-status\?\$\{query\}/u);
  assert.match(uiSource, /로컬 fail-closed adapter 구현 완료/u);
  assert.match(uiSource, /canonical 문의 승격: 차단/u);
  assert.doesNotMatch(uiSource, /method:\s*"POST"/u);
  assert.doesNotMatch(uiSource, /type=["']file["']/u);
  for (const source of [uiSource, workspaceSource]) {
    const result = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.Preserve,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    });
    assert.equal(result.diagnostics?.filter(
      item => item.category === ts.DiagnosticCategory.Error,
    ).length ?? 0, 0);
  }
});
