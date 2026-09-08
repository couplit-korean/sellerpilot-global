import { createHash } from "node:crypto";
import {
  shopeeHistoryRecordDigest,
  type ShopeeHistoryEvent,
} from "../../../../lib/channels/cs/shopee/history-progress";
import {
  planShopeeReturnHistory,
  planShopeeReviewHistory,
} from "../../../../lib/channels/cs/shopee/history-plan";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const shops = [
  { country: "SG", shopId: "1719148844" },
  { country: "TW", shopId: "1758392145" },
  { country: "MY", shopId: "1758392135" },
];
const reviewScopes = planShopeeReviewHistory(shops);
const returnScopes = planShopeeReturnHistory(shops, {
  from: 1_780_000_000,
  to: 1_780_000_000 + 16 * 86_400,
});
const sgReview = reviewScopes.find((scope) => scope.country === "SG")!;
const twReview = reviewScopes.find((scope) => scope.country === "TW")!;
const myReview = reviewScopes.find((scope) => scope.country === "MY")!;
const sgReturns = returnScopes.filter((scope) => scope.country === "SG");
const detailDigests = Array.from({ length: 11 }, (_, index) =>
  shopeeHistoryRecordDigest(sgReview.shopId, "return_refund", `RETURN_${index + 1}`));
const reviewOne = shopeeHistoryRecordDigest(sgReview.shopId, "product_review", "7001");
const reviewTwo = shopeeHistoryRecordDigest(sgReview.shopId, "product_review", "7002");
const reviewThree = shopeeHistoryRecordDigest(sgReview.shopId, "product_review", "7003");
const reviewCheckpoint = {
  kind: "product_review" as const,
  checkpointDigest: hash("sg-review-checkpoint-1"),
  cursorDigest: hash("sg-review-cursor-1"),
  paginationEpoch: 0,
  paginationDepth: 1,
};
const returnCheckpoint = {
  kind: "return_refund" as const,
  checkpointDigest: hash("sg-return-checkpoint-1"),
  pageNo: 1,
  pendingDetailCount: 1,
  nextListPageNo: null,
  paginationEpoch: 0,
  paginationDepth: 1,
};

const firstReviewPage: ShopeeHistoryEvent = {
  type: "page",
  eventKey: "sg-review-page-1",
  sequence: 1,
  scopeKey: sgReview.scopeKey,
  shopId: sgReview.shopId,
  kind: sgReview.kind,
  inputCheckpointDigest: null,
  pageDigest: hash("sg-review-page-1"),
  remoteRecordDigests: [reviewOne, reviewTwo],
  normalizedRecordDigests: [reviewOne, reviewTwo],
  isolatedRecordDigests: [],
  excludedRecordDigests: [],
  projectedEventDigests: [hash("sg-review-event-1"), hash("sg-review-event-2")],
  nextCheckpoint: reviewCheckpoint,
};

export const shopeeHistoryResumeFixture = {
  shops,
  plannedScopes: [...reviewScopes, ...returnScopes],
  scopeKeys: {
    sgReview: sgReview.scopeKey,
    twReview: twReview.scopeKey,
    myReview: myReview.scopeKey,
    sgReturnInterrupted: sgReturns[0].scopeKey,
    sgReturnPending: sgReturns[1].scopeKey,
  },
  events: [
    firstReviewPage,
    { ...firstReviewPage },
    {
      type: "interruption",
      eventKey: "sg-review-network-interruption",
      sequence: 2,
      scopeKey: sgReview.scopeKey,
      shopId: sgReview.shopId,
      kind: sgReview.kind,
      checkpointDigest: reviewCheckpoint.checkpointDigest,
      reason: "failed",
      errorCode: "SHOPEE_UPSTREAM_TIMEOUT",
    },
    {
      type: "page",
      eventKey: "sg-review-page-2",
      sequence: 3,
      scopeKey: sgReview.scopeKey,
      shopId: sgReview.shopId,
      kind: sgReview.kind,
      inputCheckpointDigest: reviewCheckpoint.checkpointDigest,
      pageDigest: hash("sg-review-page-2"),
      remoteRecordDigests: [reviewTwo, reviewThree],
      normalizedRecordDigests: [reviewTwo, reviewThree],
      isolatedRecordDigests: [],
      excludedRecordDigests: [],
      projectedEventDigests: [hash("sg-review-event-2"), hash("sg-review-event-3")],
      nextCheckpoint: null,
    },
    {
      type: "interruption",
      eventKey: "tw-review-authorization",
      sequence: 1,
      scopeKey: twReview.scopeKey,
      shopId: twReview.shopId,
      kind: twReview.kind,
      checkpointDigest: null,
      reason: "authorization_required",
      errorCode: "SHOPEE_403_PERMISSION_DENIED",
    },
    {
      type: "interruption",
      eventKey: "my-review-access-expired",
      sequence: 1,
      scopeKey: myReview.scopeKey,
      shopId: myReview.shopId,
      kind: myReview.kind,
      checkpointDigest: null,
      reason: "authorization_required",
      errorCode: "SHOPEE_ACCESS_TOKEN_EXPIRED",
    },
    {
      type: "page",
      eventKey: "sg-return-detail-batch-10",
      sequence: 1,
      scopeKey: sgReturns[0].scopeKey,
      shopId: sgReturns[0].shopId,
      kind: sgReturns[0].kind,
      inputCheckpointDigest: null,
      pageDigest: hash("sg-return-detail-batch-10"),
      remoteRecordDigests: detailDigests.slice(0, 10),
      normalizedRecordDigests: detailDigests.slice(0, 10),
      isolatedRecordDigests: [],
      excludedRecordDigests: [],
      projectedEventDigests: detailDigests.slice(0, 10).map((item) => hash(`event:${item}`)),
      nextCheckpoint: returnCheckpoint,
    },
    {
      type: "interruption",
      eventKey: "sg-return-worker-interruption",
      sequence: 2,
      scopeKey: sgReturns[0].scopeKey,
      shopId: sgReturns[0].shopId,
      kind: sgReturns[0].kind,
      checkpointDigest: returnCheckpoint.checkpointDigest,
      reason: "failed",
      errorCode: "WORKER_INTERRUPTED",
    },
    {
      type: "page",
      eventKey: "sg-return-detail-resume-1",
      sequence: 3,
      scopeKey: sgReturns[0].scopeKey,
      shopId: sgReturns[0].shopId,
      kind: sgReturns[0].kind,
      inputCheckpointDigest: returnCheckpoint.checkpointDigest,
      pageDigest: hash("sg-return-detail-resume-1"),
      remoteRecordDigests: detailDigests.slice(10),
      normalizedRecordDigests: detailDigests.slice(10),
      isolatedRecordDigests: [],
      excludedRecordDigests: [],
      projectedEventDigests: detailDigests.slice(10).map((item) => hash(`event:${item}`)),
      nextCheckpoint: null,
    },
  ] satisfies ShopeeHistoryEvent[],
};
