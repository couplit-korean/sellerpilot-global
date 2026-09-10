import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import type { TemuBuyerChatRuntimeEvidence } from "../lib/channels/cs/temu/runtime-readiness";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  adaptTemuBuyerChatSource,
  temuBuyerChatSourceStatus,
} = await import("../lib/channels/cs/temu/buyer-chat-source-adapter");

const now = Date.now();
const credentialId = "00000000-0000-4000-8000-00000000d401";
const sellerAccountKey = "4".repeat(64);
const expected = {
  credentialId,
  sellerAccountKey,
  environment: "production" as const,
  expectedRegion: "GLOBAL",
  now: new Date(now).toISOString(),
};
const rawBody = JSON.stringify({ message: "untrusted Buyer Chat payload" });

function evidence(
  overrides: Partial<TemuBuyerChatRuntimeEvidence> = {},
): TemuBuyerChatRuntimeEvidence {
  return {
    contract: "sellerpilot-temu-buyer-chat-runtime-evidence/1",
    source: "sellerpilot_private.temu_buyer_chat_readiness_evidence",
    sourceKind: "partner_api_authenticated_readback",
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

function receipt(readinessEvidence: TemuBuyerChatRuntimeEvidence = evidence()) {
  return {
    contract: "sellerpilot-temu-buyer-chat-source-receipt/1",
    source: "sellerpilot_private.temu_buyer_chat_readiness_evidence",
    receiptId: randomUUID(),
    credentialId,
    sellerAccountKey,
    environment: "production",
    region: "GLOBAL",
    rawSha256: createHash("sha256").update(rawBody).digest("hex"),
    observedAt: readinessEvidence.observedAt,
    expiresAt: readinessEvidence.expiresAt,
    evidence: readinessEvidence,
  };
}

test("implemented source boundary reports local completion while provider remains unsupported", () => {
  const status = temuBuyerChatSourceStatus(null, expected);
  assert.equal(status.sourceAdapterImplemented, true);
  assert.equal(status.currentAssignmentLocalImplementationComplete, true);
  assert.equal(status.localState, "implemented_fail_closed");
  assert.deepEqual(status.localBlockers, []);
  assert.equal(status.providerState, "unsupported");
  assert.equal(status.providerFetchPerformed, false);
  assert.equal(status.canonicalPromotionAllowed, false);
  assert.equal(status.canonicalInquiry, null);
  assert.deepEqual(status.providerEnablementBlockers,
    ["TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE"]);
});

test("missing or malformed source receipt cannot promote arbitrary raw payload", () => {
  for (const verifiedReceipt of [null, { receiptId: randomUUID(), rawSha256: "f".repeat(64) }]) {
    const result = adaptTemuBuyerChatSource({ rawBody, verifiedReceipt, expected });
    assert.equal(result.status.sourceAdapterImplemented, true);
    assert.equal(result.status.verifiedSourceReceiptAccepted, false);
    assert.equal(result.status.rawAccepted, false);
    assert.equal(result.status.canonicalPromotionPerformed, false);
    assert.equal(result.status.canonicalInquiry, null);
    assert.equal(result.status.providerFetchPerformed, false);
    assert.equal(result.status.sourceBlockers.includes(
      "TEMU_BUYER_CHAT_VERIFIED_SOURCE_RECEIPT_REQUIRED"), true);
  }
});

test("structurally bound receipt is still unsupported without an official allowlisted contract", () => {
  const result = adaptTemuBuyerChatSource({
    rawBody,
    verifiedReceipt: receipt(),
    expected,
  });
  assert.equal(result.receiptStructurallyValid, true);
  assert.equal(result.receiptRawBindingMatched, true);
  assert.equal(result.status.verifiedSourceReceiptAccepted, false);
  assert.equal(result.status.canonicalInquiry, null);
  assert.deepEqual(result.status.providerEnablementBlockers,
    ["TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED"]);
  assert.equal(result.status.sourceBlockers.includes(
    "TEMU_BUYER_CHAT_OFFICIAL_API_CONTRACT_UNAVAILABLE"), true);
});

test("invented contract, wrong raw hash, account drift and oversized raw all fail closed", () => {
  const inventedEvidence = evidence({
    contractKey: "TEMU.BUYER_CHAT.INVENTED",
    contractRevisionSha256: "c".repeat(64),
    permissionPackage: "Invented Buyer Chat",
    grantedPermissionPackages: ["Invented Buyer Chat"],
  });
  const cases = [
    {
      rawBody,
      verifiedReceipt: receipt(inventedEvidence),
      blocker: "TEMU_BUYER_CHAT_CONTRACT_UNKNOWN",
    },
    {
      rawBody: `${rawBody} `,
      verifiedReceipt: receipt(),
      blocker: "TEMU_BUYER_CHAT_SOURCE_RECEIPT_BINDING_MISMATCH",
    },
    {
      rawBody,
      verifiedReceipt: { ...receipt(), sellerAccountKey: "5".repeat(64) },
      blocker: "TEMU_BUYER_CHAT_SOURCE_RECEIPT_BINDING_MISMATCH",
    },
    {
      rawBody: "x".repeat(256_001),
      verifiedReceipt: receipt(),
      blocker: "TEMU_BUYER_CHAT_RAW_BODY_INVALID",
    },
  ];
  for (const input of cases) {
    const result = adaptTemuBuyerChatSource({ ...input, expected });
    assert.equal(result.status.sourceBlockers.includes(input.blocker), true);
    assert.equal(result.status.canonicalPromotionPerformed, false);
    assert.equal(result.status.canonicalInquiry, null);
  }
});
