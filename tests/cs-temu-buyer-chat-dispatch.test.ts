import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { gatewayClaimSchema } from "../lib/channels/gateway-contract";
import type { TemuBuyerChatRuntimeEvidence } from "../lib/channels/cs/temu/runtime-readiness";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { executeCsProviderJob } = await import("../lib/cs/operations/provider");
const { executeCsOperation } = await import("../lib/cs/operations/execute");

const credentialId = "00000000-0000-4000-8000-00000000b701";
const sellerAccountKey = "b".repeat(64);
const now = Date.now();

function evidence(overrides: Partial<TemuBuyerChatRuntimeEvidence> = {}): TemuBuyerChatRuntimeEvidence {
  return {
    contract: "sellerpilot-temu-buyer-chat-runtime-evidence/1",
    source: "sellerpilot_private.temu_buyer_chat_readiness_evidence",
    sourceKind: "partner_center_authenticated_readback",
    sourceRevision: 1,
    sourceRevisionSha256: "a".repeat(64),
    credentialId,
    sellerAccountKey,
    environment: "production",
    region: "GLOBAL",
    observedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 5 * 60_000).toISOString(),
    appStatus: "Active",
    complianceStatus: "Approved",
    securityQuestionnaireStatus: "Approved",
    sellerAuthorizationStatus: "Approved",
    contractKey: null,
    contractRevisionSha256: null,
    permissionPackage: null,
    grantedPermissionPackages: [],
    ...overrides,
  };
}

function providerInput(runtimeEvidence: unknown) {
  return {
    job: {
      id: "00000000-0000-4000-8000-00000000b702",
      claim_token: "00000000-0000-4000-8000-00000000b703",
      credential_id: credentialId,
      channel: "temu" as const,
      operation: "inquiries.list",
      environment: "production" as const,
      request: { arguments: { kind: "buyer_chat" } },
      credential: { app_key: "must-not-use", app_secret: "must-not-use", access_token: "must-not-use" },
      attempt_count: 1,
      credential_binding_context: {
        contract: "sellerpilot-cs-credential-context/1" as const,
        status: "verified" as const,
        credentialId,
        sellerAccountKey,
        sellerAccountKeySource: "provider_certified_v1" as const,
        sellerAccountVerifiedAt: new Date(now - 60_000).toISOString(),
        ownerBinding: "job_credential_same_owner" as const,
        workerIdentityCompared: false as const,
      },
      temu_buyer_chat_readiness_context: runtimeEvidence,
    },
    signal: new AbortController().signal,
    hooks: {
      beginCredentialMutation: async () => {},
      stageCredentialRefresh: async () => {},
      beginProviderMutation: async () => {},
      assertLeaseHealthy: async () => {},
    },
  };
}

test("provider dispatcher denies unverified Buyer Chat before executor or provider fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let executorCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("provider fetch must not run");
  };
  try {
    const result = await executeCsProviderJob(providerInput(evidence()), async () => {
      executorCount += 1;
      throw new Error("operation executor must not run");
    });
    assert.equal(result.ok, false);
    assert.equal(fetchCount, 0);
    assert.equal(executorCount, 0);
    assert.deepEqual(result.steps[0]?.data, {
      code: "TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED",
      blockers: ["TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED"],
      state: "permission_pending",
      providerFetchPerformed: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider dispatcher rejects malformed, cross-region and expired server evidence with zero fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let executorCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("provider fetch must not run");
  };
  try {
    const cases: Array<[unknown, string]> = [
      [{ ...evidence(), unexpected: true }, "TEMU_BUYER_CHAT_EVIDENCE_INVALID"],
      [evidence({ region: "US" }), "TEMU_APP_REGION_MISMATCH"],
      [evidence({ observedAt: new Date(now - 10 * 60_000).toISOString(),
        expiresAt: new Date(now - 60_000).toISOString() }), "TEMU_BUYER_CHAT_EVIDENCE_EXPIRED"],
    ];
    for (const [runtimeEvidence, blocker] of cases) {
      const result = await executeCsProviderJob(providerInput(runtimeEvidence), async () => {
        executorCount += 1;
        throw new Error("operation executor must not run");
      });
      assert.equal(result.ok, false);
      assert.equal((result.steps[0]?.data.blockers as string[]).includes(blocker), true);
    }
    assert.equal(fetchCount, 0);
    assert.equal(executorCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forged request evidence is stripped and unknown server evidence cannot open dispatch", async () => {
  const rawClaim = {
    ...providerInput(null).job,
    request: {
      arguments: {
        kind: "buyer_chat",
        buyerChatContract: {
          listApi: "fake", messageHistoryApi: "fake", webhookEvent: "fake",
          replyApi: "fake", permissionPackage: "fake",
        },
      },
    },
    temu_buyer_chat_readiness_context: evidence({
      contractKey: "TEMU.BUYER_CHAT.PLACEHOLDER",
      contractRevisionSha256: "c".repeat(64),
      permissionPackage: "Placeholder",
      grantedPermissionPackages: ["Placeholder"],
    }),
  };
  const publicClaim = gatewayClaimSchema.parse(rawClaim);
  assert.equal(Object.hasOwn(publicClaim, "temu_buyer_chat_readiness_context"), false);

  const result = await executeCsProviderJob(providerInput(rawClaim.temu_buyer_chat_readiness_context));
  assert.equal(result.ok, false);
  assert.deepEqual(result.steps[0]?.data.blockers, ["TEMU_BUYER_CHAT_CONTRACT_UNKNOWN"]);
});

test("direct adapter boundary denies missing runtime context without provider fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("provider fetch must not run");
  };
  try {
    const result = await executeCsOperation({
      channel: "temu",
      operation: "inquiries.list",
      payload: { app_key: "untrusted", app_secret: "untrusted", access_token: "untrusted" },
      arguments: { kind: "buyer_chat" },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(fetchCount, 0);
    assert.deepEqual(result.steps[0]?.data.blockers,
      ["TEMU_BUYER_CHAT_RUNTIME_CONTEXT_UNVERIFIED"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("existing Temu after-sales adapter remains a separate read-only provider path", async () => {
  const originalFetch = globalThis.fetch;
  const requestTypes: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestTypes.push(String(body.type));
    return Response.json({ success: true, result: { data: [], total: 0, pageNumber: 1 } });
  };
  try {
    const result = await executeCsOperation({
      channel: "temu",
      operation: "inquiries.list",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: {
        kind: "after_sales", includeDetails: true, pageNo: 1, pageSize: 200,
        updateAtStart: 1_787_000_000, updateAtEnd: 1_788_000_000,
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(requestTypes, ["bg.aftersales.parentaftersales.list.get"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
