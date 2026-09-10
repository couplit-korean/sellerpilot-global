import assert from "node:assert/strict";
import test from "node:test";
import { projectTemuAfterSalesStatusChange } from "../lib/channels/cs/temu/after-sales-event";
import { planTemuAfterSalesHistory } from "../lib/channels/cs/temu/history-plan";
import { temuAfterSalesRevision } from "../lib/channels/cs/temu/revision";
import {
  temuCsReadiness,
  temuKnownBuyerChatContractCount,
  type TemuBuyerChatExpectedContext,
  type TemuBuyerChatRuntimeEvidence,
  type TemuCsRuntimeState,
} from "../lib/channels/cs/temu/runtime-readiness";

const sellerHash = "b".repeat(64);
const credentialId = "00000000-0000-4000-8000-00000000b601";
const readyState: TemuCsRuntimeState = {
  appRegion: "GLOBAL",
  expectedRegion: "GLOBAL",
  appStatus: "Active",
  complianceStatus: "Approved",
  securityQuestionnaireStatus: "Approved",
  sellerAuthorizationStatus: "Approved",
  credentialSellerAccountKey: "seller-certified-key",
  expectedSellerAccountKey: "seller-certified-key",
  permissionPackages: ["Aftersales Management View"],
};

test("Temu runtime readiness blocks inactive, missing permission, region and seller mismatches", () => {
  assert.deepEqual(temuCsReadiness("after_sales", readyState), {
    ready: true,
    kind: "after_sales",
    blockers: [],
  });
  const blocked = temuCsReadiness("after_sales", {
    ...readyState,
    appRegion: "OTHER",
    appStatus: "Inactive",
    complianceStatus: "Rejected",
    sellerAuthorizationStatus: "Rejected",
    credentialSellerAccountKey: "other-seller",
    permissionPackages: [],
  });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers, [
    "TEMU_APP_REGION_MISMATCH",
    "TEMU_APP_INACTIVE",
    "TEMU_COMPLIANCE_NOT_APPROVED",
    "TEMU_SELLER_AUTHORIZATION_NOT_APPROVED",
    "TEMU_SELLER_SCOPE_MISMATCH",
    "TEMU_AFTER_SALES_VIEW_PERMISSION_MISSING",
  ]);
});

const buyerChatExpected: TemuBuyerChatExpectedContext = {
  credentialId,
  sellerAccountKey: sellerHash,
  environment: "production",
  expectedRegion: "GLOBAL",
  now: "2026-09-09T18:30:00Z",
};

function buyerChatEvidence(
  overrides: Partial<TemuBuyerChatRuntimeEvidence> = {},
): TemuBuyerChatRuntimeEvidence {
  return {
    contract: "sellerpilot-temu-buyer-chat-runtime-evidence/1",
    source: "sellerpilot_private.temu_buyer_chat_readiness_evidence",
    sourceKind: "partner_center_authenticated_readback",
    sourceRevision: 7,
    sourceRevisionSha256: "a".repeat(64),
    credentialId,
    sellerAccountKey: sellerHash,
    environment: "production",
    region: "GLOBAL",
    observedAt: "2026-09-09T18:25:00Z",
    expiresAt: "2026-09-09T18:35:00Z",
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

test("Temu Buyer Chat rejects arbitrary strings and every unknown contract revision", () => {
  assert.equal(temuKnownBuyerChatContractCount(), 0);
  assert.deepEqual(temuCsReadiness("buyer_chat", readyState, buyerChatExpected), {
    ready: false,
    kind: "buyer_chat",
    blockers: ["TEMU_BUYER_CHAT_EVIDENCE_INVALID"],
  });
  assert.deepEqual(temuCsReadiness("buyer_chat", buyerChatEvidence(), buyerChatExpected), {
    ready: false,
    kind: "buyer_chat",
    blockers: ["TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED"],
  });
  const unknownContract = buyerChatEvidence({
    contractKey: "TEMU.BUYER_CHAT.PLACEHOLDER",
    contractRevisionSha256: "c".repeat(64),
    permissionPackage: "Placeholder Buyer Chat Permission",
    grantedPermissionPackages: ["Placeholder Buyer Chat Permission"],
  });
  assert.deepEqual(temuCsReadiness("buyer_chat", unknownContract, buyerChatExpected).blockers,
    ["TEMU_BUYER_CHAT_CONTRACT_UNKNOWN"]);
});

test("Temu Buyer Chat rejects null, malformed, cross-bound and expired evidence", () => {
  assert.deepEqual(temuCsReadiness("buyer_chat", null, buyerChatExpected).blockers,
    ["TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE"]);
  assert.deepEqual(temuCsReadiness("buyer_chat", { ...buyerChatEvidence(), extra: true }, buyerChatExpected).blockers,
    ["TEMU_BUYER_CHAT_EVIDENCE_INVALID"]);
  const crossBound = temuCsReadiness("buyer_chat", buyerChatEvidence({
    credentialId: "00000000-0000-4000-8000-00000000b699",
    sellerAccountKey: "d".repeat(64),
    environment: "sandbox",
    region: "US",
    expiresAt: "2026-09-09T18:29:00Z",
  }), buyerChatExpected);
  assert.deepEqual(crossBound.blockers, [
    "TEMU_BUYER_CHAT_CREDENTIAL_MISMATCH",
    "TEMU_BUYER_CHAT_SELLER_ACCOUNT_MISMATCH",
    "TEMU_BUYER_CHAT_ENVIRONMENT_MISMATCH",
    "TEMU_APP_REGION_MISMATCH",
    "TEMU_BUYER_CHAT_EVIDENCE_EXPIRED",
    "TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED",
  ]);
});

test("Temu current inactive and Reviewing observations stay external blockers", () => {
  const readiness = temuCsReadiness("buyer_chat", buyerChatEvidence({
    appStatus: "Inactive",
    complianceStatus: "Reviewing",
    securityQuestionnaireStatus: "Reviewing",
    sellerAuthorizationStatus: "Reviewing",
  }), buyerChatExpected);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers, [
    "TEMU_APP_INACTIVE",
    "TEMU_COMPLIANCE_NOT_APPROVED",
    "TEMU_SECURITY_QUESTIONNAIRE_NOT_APPROVED",
    "TEMU_SELLER_AUTHORIZATION_NOT_APPROVED",
    "TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED",
  ]);
});

test("Temu fixed history plan uses closed KST day windows by status and verified provider range", () => {
  const windows = planTemuAfterSalesHistory({
    fromDate: "2026-08-09",
    toDate: "2026-08-10",
    statusGroups: [1, 7],
    scope: {
      region: "GLOBAL",
      sellerAccountKeyHash: sellerHash,
      earliestProviderDate: "2026-07-01",
      providerRangeVerifiedAt: "2026-09-08T10:00:00+09:00",
    },
  });
  assert.equal(windows.length, 4);
  assert.equal(windows[0]?.from, "2026-08-09T00:00:00+09:00");
  assert.equal(windows[0]?.to, "2026-08-09T23:59:59+09:00");
  assert.equal(windows[0]?.arguments.updateAtStart, 1_786_201_200);
  assert.equal(windows[0]?.arguments.updateAtEnd, 1_786_287_599);
  assert.equal(windows[0]?.scope.statusGroup, 1);
  assert.equal(windows[1]?.scope.statusGroup, 7);
  assert.ok(windows.every((window) => window.timezone === "Asia/Seoul"));
  assert.ok(windows.every((window) => window.arguments.updateAtStart < 10_000_000_000));
  assert.equal(Object.hasOwn(windows[0]!.arguments, "region"), false);
  assert.equal(Object.hasOwn(windows[0]!.arguments, "sellerAccountKeyHash"), false);

  assert.throws(() => planTemuAfterSalesHistory({
    fromDate: "2026-06-30",
    toDate: "2026-07-01",
    scope: {
      region: "GLOBAL",
      sellerAccountKeyHash: sellerHash,
      earliestProviderDate: "2026-07-01",
      providerRangeVerifiedAt: "2026-09-08T10:00:00+09:00",
    },
  }), /TEMU_HISTORY_PROVIDER_RANGE_UNVERIFIED/);
});

test("Temu 14-day and 30-day history boundaries retain every KST calendar day and status", () => {
  const scope = {
    region: "GLOBAL",
    sellerAccountKeyHash: sellerHash,
    earliestProviderDate: "2026-01-01",
    providerRangeVerifiedAt: "2026-09-08T10:00:00+09:00",
  };
  const current = planTemuAfterSalesHistory({
    fromDate: "2026-08-26",
    toDate: "2026-09-08",
    scope,
  });
  assert.equal(current.length, 14 * 7);
  assert.equal(current[0]?.from, "2026-08-26T00:00:00+09:00");
  assert.equal(current.at(-1)?.to, "2026-09-08T23:59:59+09:00");

  const repair = planTemuAfterSalesHistory({
    fromDate: "2026-08-10",
    toDate: "2026-09-08",
    statusGroups: [1],
    scope,
  });
  assert.equal(repair.length, 30);
  assert.equal(new Date(repair[0]!.arguments.updateAtStart * 1000).toISOString(), "2026-08-09T15:00:00.000Z");
  assert.equal(new Date(repair.at(-1)!.arguments.updateAtEnd * 1000).toISOString(), "2026-09-08T14:59:59.000Z");
  for (let index = 1; index < repair.length; index += 1) {
    assert.equal(
      repair[index]!.arguments.updateAtStart,
      repair[index - 1]!.arguments.updateAtEnd + 1,
    );
  }
});

test("Temu detail-only timestamp and content changes produce distinct revisions", () => {
  const base = {
    listUpdateAt: 1_788_000_000,
    lastUpdateAtMillis: 1_788_000_000_000,
    statusGroup: "1",
    parentAfterSalesStatus: "1",
    afterSalesType: "2",
    operateExpireTimeMs: null,
    availableOperations: [],
    afterSalesCases: [{ afterSalesSn: "AFTER-1-CHILD", buyerComment: "state one" }],
    refundSummary: {},
  };
  const original = temuAfterSalesRevision(base);
  const timestampChanged = temuAfterSalesRevision({
    ...base,
    lastUpdateAtMillis: 1_788_000_001_000,
  });
  const contentChanged = temuAfterSalesRevision({
    ...base,
    afterSalesCases: [{ afterSalesSn: "AFTER-1-CHILD", buyerComment: "state two" }],
  });
  assert.equal(original.providerRevisionSource, "detailLastUpdateAtMillis");
  assert.notEqual(original.providerRevision, timestampChanged.providerRevision);
  assert.notEqual(original.providerRevision, contentChanged.providerRevision);
  assert.equal(original.detailUpdatedAt, "2026-08-29T10:40:00.000Z");
  assert.throws(() => temuAfterSalesRevision({
    ...base,
    lastUpdateAtMillis: 1_788_000_000,
  }), /TEMU_AFTER_SALES_DETAIL_TIMESTAMP_INVALID/);
});

test("Temu after-sales webhook milliseconds project to second-based detail polling without PII", () => {
  const projected = projectTemuAfterSalesStatusChange({
    mallId: "MALL-1",
    parentAfterSalesSn: "AFTER-1",
    parentOrderSn: "ORDER-1",
    parentAfterSalesStatus: 2,
    updateAt: 1_788_000_123_456,
    phone: "do-not-store",
    address: "do-not-store",
  }, "MALL-1");
  assert.equal(projected.updateAtMillis, 1_788_000_123_456);
  assert.equal(projected.readArguments.updateAtStart, 1_788_000_123);
  assert.equal(projected.readArguments.updateAtEnd, 1_788_000_123);
  assert.doesNotMatch(JSON.stringify(projected), /phone|address|do-not-store/);
  assert.throws(() => projectTemuAfterSalesStatusChange({
    mallId: "MALL-1",
    parentAfterSalesSn: "AFTER-1",
    parentOrderSn: "ORDER-1",
    updateAt: 1_788_000_123,
  }, "MALL-1"), /MILLISECOND_TIMESTAMP_INVALID/);
  assert.throws(() => projectTemuAfterSalesStatusChange({
    mallId: "MALL-2",
    parentAfterSalesSn: "AFTER-1",
    parentOrderSn: "ORDER-1",
    updateAt: 1_788_000_123_456,
  }, "MALL-1"), /SCOPE_MISMATCH/);
});
