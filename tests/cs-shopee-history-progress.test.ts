import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  projectShopeeHistoryProgress,
  shopeeHistoryRecordDigest,
  type ShopeeHistoryEvent,
} from "../lib/channels/cs/shopee/history-progress";
import {
  reconcileShopeeReturnDetailRevision,
  shopeeReturnInboundKey,
  shopeeReturnLegacyRemoteMessageId,
  type ShopeeReturnRevisionCandidate,
  type ShopeeReturnRevisionIdentity,
} from "../lib/channels/cs/shopee/detail-revision-reconciliation";
import { planShopeeReviewHistory } from "../lib/channels/cs/shopee/history-plan";
import { shopeeHistoryProgressSchema } from "../lib/cs/channels/shopee/history-progress";
import { shopeeHistoryResumeFixture } from "./fixtures/cs/shopee/history-resume";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

test("Shopee history progress resumes without scope loss and keeps shop authorization isolated", () => {
  const projected = projectShopeeHistoryProgress(
    shopeeHistoryResumeFixture.plannedScopes,
    shopeeHistoryResumeFixture.events,
  );
  assert.deepEqual(shopeeHistoryProgressSchema.parse(projected), projected);
  const sgReview = projected.scopes.find((scope) =>
    scope.scopeKey === shopeeHistoryResumeFixture.scopeKeys.sgReview)!;
  const twReview = projected.scopes.find((scope) =>
    scope.scopeKey === shopeeHistoryResumeFixture.scopeKeys.twReview)!;
  const myReview = projected.scopes.find((scope) =>
    scope.scopeKey === shopeeHistoryResumeFixture.scopeKeys.myReview)!;
  assert.equal(sgReview.status, "complete");
  assert.equal(sgReview.remoteUniqueCount, 3);
  assert.equal(sgReview.normalizedUniqueCount, 3);
  assert.equal(sgReview.duplicateRemoteCount, 1);
  assert.equal(sgReview.unprocessedUniqueCount, 0);
  assert.equal(sgReview.replayedEventCount, 1);
  assert.equal(sgReview.lastErrorCode, null);
  assert.equal(twReview.status, "authorization_required");
  assert.equal(twReview.lastErrorCode, "SHOPEE_403_PERMISSION_DENIED");
  assert.equal(myReview.status, "authorization_required");
  assert.equal(myReview.lastErrorCode, "SHOPEE_ACCESS_TOKEN_EXPIRED");
  assert.equal(projected.shopKinds.find((group) =>
    group.shopId === sgReview.shopId && group.kind === "product_review")?.status, "complete");
  assert.equal(projected.shopKinds.find((group) =>
    group.shopId === twReview.shopId && group.kind === "product_review")?.status, "authorization_required");
  assert.equal(projected.shopKinds.find((group) =>
    group.shopId === myReview.shopId && group.kind === "product_review")?.status, "authorization_required");
});

test("Shopee Returns projects exact 10 plus 1 detail resume and remaining windows", () => {
  const projected = projectShopeeHistoryProgress(
    shopeeHistoryResumeFixture.plannedScopes,
    shopeeHistoryResumeFixture.events,
  );
  const resumed = projected.scopes.find((scope) =>
    scope.scopeKey === shopeeHistoryResumeFixture.scopeKeys.sgReturnInterrupted)!;
  const group = projected.shopKinds.find((item) =>
    item.shopId === resumed.shopId && item.kind === "return_refund")!;
  assert.equal(resumed.status, "complete");
  assert.equal(resumed.pageCount, 2);
  assert.equal(resumed.remoteUniqueCount, 11);
  assert.equal(resumed.normalizedUniqueCount, 11);
  assert.equal(resumed.duplicateRemoteCount, 0);
  assert.equal(resumed.unprocessedUniqueCount, 0);
  assert.equal(group.status, "partial");
  assert.equal(group.completedScopeCount, 1);
  assert.ok(group.remainingScopeKeys.includes(shopeeHistoryResumeFixture.scopeKeys.sgReturnPending));
  assert.equal(group.providerRemainderUnknown, true);
});

test("same Shopee comment ID is shop-bound before it reaches a coverage ledger", () => {
  assert.notEqual(
    shopeeHistoryRecordDigest("1719148844", "product_review", "7001"),
    shopeeHistoryRecordDigest("1758392145", "product_review", "7001"),
  );
});

test("Shopee history projection rejects an empty review page with next cursor and a repeated cursor", () => {
  const [scope] = planShopeeReviewHistory([{ country: "SG", shopId: "1719148844" }]);
  const checkpoint = {
    kind: "product_review" as const,
    checkpointDigest: hash("checkpoint"),
    cursorDigest: hash("cursor"),
    paginationEpoch: 0,
    paginationDepth: 1,
  };
  const empty: ShopeeHistoryEvent = {
    type: "page", eventKey: "empty", sequence: 1, scopeKey: scope.scopeKey,
    shopId: scope.shopId, kind: scope.kind, inputCheckpointDigest: null,
    pageDigest: hash("empty"), remoteRecordDigests: [], normalizedRecordDigests: [],
    isolatedRecordDigests: [], excludedRecordDigests: [], projectedEventDigests: [],
    nextCheckpoint: checkpoint,
  };
  assert.throws(() => projectShopeeHistoryProgress([scope], [empty]),
    /SHOPEE_HISTORY_EMPTY_PAGE_WITH_CONTINUATION/);

  const record = shopeeHistoryRecordDigest(scope.shopId, scope.kind, "7001");
  const first = { ...empty, eventKey: "first", remoteRecordDigests: [record],
    normalizedRecordDigests: [record], projectedEventDigests: [hash("event")],
    pageDigest: hash("first") };
  const repeated: ShopeeHistoryEvent = {
    ...first,
    eventKey: "second",
    sequence: 2,
    inputCheckpointDigest: checkpoint.checkpointDigest,
    pageDigest: hash("second"),
  };
  assert.throws(() => projectShopeeHistoryProgress([scope], [first, repeated]),
    /SHOPEE_HISTORY_CHECKPOINT_REPEATED/);
});

function returnIdentity(
  shopId: string,
  returnSn: string,
  remoteRevision: string,
  detailRevision: string | null,
): ShopeeReturnRevisionIdentity {
  const externalTicketId = `shopee:return:${shopId}:${returnSn}`;
  const remoteMessageId = `${shopId}:${returnSn}:${remoteRevision}`;
  return {
    shopId,
    returnSn,
    externalTicketId,
    remoteMessageId,
    inboundKey: shopeeReturnInboundKey(externalTicketId, remoteMessageId),
    detailRevision,
    ticketKind: "after_sales",
    replySupported: false,
  };
}

test("new Shopee detailRevision appends to the stable ticket and rerun adds nothing", () => {
  const legacyRemoteMessageId = shopeeReturnLegacyRemoteMessageId("1719148844", "RETURN_1", {
    reason: "NOT_RECEIPT",
    textReason: "synthetic fixture",
    status: "REQUESTED",
    negotiationStatus: "",
    nativeMedia: { images: [], buyer_videos: [] },
  });
  const legacy = returnIdentity(
    "1719148844",
    "RETURN_1",
    legacyRemoteMessageId.split(":").at(-1)!,
    null,
  );
  const current: ShopeeReturnRevisionCandidate = {
    ...returnIdentity("1719148844", "RETURN_1", hash("current-remote"), hash("detail-v1")),
    detailRevision: hash("detail-v1"),
    legacyRemoteMessageId: legacy.remoteMessageId,
  };
  const first = reconcileShopeeReturnDetailRevision([legacy], current);
  assert.equal(first.decision, "append_revision");
  assert.equal(first.reason, "legacy_remote_revision_attested");
  assert.equal(first.externalTicketId, legacy.externalTicketId);
  assert.equal(first.appendOnly, true);
  assert.equal(first.replySupported, false);
  const rerun = reconcileShopeeReturnDetailRevision([legacy, current], current);
  assert.equal(rerun.decision, "duplicate");
  assert.equal(rerun.incomingInboundKey, current.inboundKey);
});

test("unattested legacy revision requires reconciliation and shop mismatch is rejected", () => {
  const legacy = returnIdentity("1719148844", "RETURN_1", hash("legacy-remote"), null);
  const current: ShopeeReturnRevisionCandidate = {
    ...returnIdentity("1719148844", "RETURN_1", hash("current-remote"), hash("detail-v1")),
    detailRevision: hash("detail-v1"),
    legacyRemoteMessageId: null,
  };
  assert.equal(reconcileShopeeReturnDetailRevision([legacy], current).decision, "reconciliation_required");
  const otherShop = returnIdentity("1758392145", "RETURN_1", hash("other-shop"), null);
  assert.throws(() => reconcileShopeeReturnDetailRevision([otherShop], current),
    /SHOPEE_RETURN_REVISION_LEDGER_IDENTITY_MISMATCH/);
});
