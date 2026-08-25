import assert from "node:assert/strict";
import test from "node:test";
import {
  channelTargetOptionValue,
  listingMutationGeneration,
  productEditSupportLabel,
  reconcileQueuedChannelResults,
  workbenchProductContextMatches,
  type WorkbenchChannelResult,
  type WorkbenchListingSnapshot,
} from "../app/_publishing/workbench-release-safety";

const listing = (overrides: Partial<WorkbenchListingSnapshot> = {}): WorkbenchListingSnapshot => ({
  id: "30000000-0000-4000-8000-000000000001",
  channel: "qoo10",
  market: "JP",
  targetId: "",
  remoteId: "123456789",
  status: "failed",
  lastError: "provider rejected",
  failureClass: "retryable",
  operationAttemptId: "40000000-0000-4000-8000-000000000001",
  ...overrides,
});

test("mutation generation only advances from exact retryable listing evidence", () => {
  assert.equal(listingMutationGeneration(undefined), "initial");
  assert.equal(listingMutationGeneration(listing({ status: "published", failureClass: null })), "listing:30000000-0000-4000-8000-000000000001");
  assert.equal(listingMutationGeneration(listing({ status: "published", failureClass: null }), "stable-response-loss"), "stable-response-loss");
  assert.equal(listingMutationGeneration(listing({ operationAttemptId: null }), "stable-response-loss"), "stable-response-loss");
  assert.equal(listingMutationGeneration(listing({ failureClass: "external_action" }), "stable-response-loss"), "stable-response-loss");
  assert.equal(
    listingMutationGeneration(listing(), "stable-response-loss"),
    "retryable:40000000-0000-4000-8000-000000000001",
  );
});

test("same market shops retain distinct select identities", () => {
  const first = channelTargetOptionValue({ marketCode: "SG", targetId: "1001" });
  const second = channelTargetOptionValue({ marketCode: "SG", targetId: "1002" });
  assert.notEqual(first, second);
  assert.deepEqual(JSON.parse(first), ["SG", "1001"]);
  assert.deepEqual(JSON.parse(second), ["SG", "1002"]);
});

test("support labels distinguish remote, central-only, and unsupported fields", () => {
  assert.equal(productEditSupportLabel("supported", "supported"), "원격 수정");
  assert.equal(productEditSupportLabel("partial", "supported"), "원격 일부");
  assert.equal(productEditSupportLabel("blocked", "supported"), "중앙만");
  assert.equal(productEditSupportLabel("blocked", "blocked"), "미지원");
});

test("workbench state belongs only to the exact selected product", () => {
  assert.equal(workbenchProductContextMatches("product-a", "product-a"), true);
  assert.equal(workbenchProductContextMatches("product-a", "product-b"), false);
  assert.equal(workbenchProductContextMatches(null, "product-a"), false);
  assert.equal(workbenchProductContextMatches("product-a", null), false);
});

test("queued reconciliation requires the exact listing and attempt", () => {
  const queued: Partial<Record<"qoo10", WorkbenchChannelResult>> = {
    qoo10: {
      phase: "queued",
      attemptId: "40000000-0000-4000-8000-000000000001",
      listingId: "30000000-0000-4000-8000-000000000001",
      market: "JP",
      targetId: "",
    },
  };
  const wrongAttempt = reconcileQueuedChannelResults(queued, [listing({
    status: "published",
    operationAttemptId: "40000000-0000-4000-8000-000000000099",
  })]);
  assert.equal(wrongAttempt, queued);

  const wrongListing = reconcileQueuedChannelResults(queued, [listing({
    id: "30000000-0000-4000-8000-000000000099",
    status: "published",
  })]);
  assert.equal(wrongListing, queued);

  const completed = reconcileQueuedChannelResults(queued, [listing({ status: "published", failureClass: null })]);
  assert.notEqual(completed, queued);
  assert.equal(completed.qoo10?.phase, "succeeded");
  assert.equal(completed.qoo10?.remoteId, "123456789");
});

test("a missing listing id binds only from one exact attempt candidate", () => {
  const queued: Partial<Record<"qoo10", WorkbenchChannelResult>> = {
    qoo10: {
      phase: "queued",
      attemptId: "40000000-0000-4000-8000-000000000001",
      market: "JP",
      targetId: "",
    },
  };
  const bound = reconcileQueuedChannelResults(queued, [listing({ status: "publishing" })]);
  assert.equal(bound.qoo10?.phase, "queued");
  assert.equal(bound.qoo10?.listingId, "30000000-0000-4000-8000-000000000001");

  const ambiguous = reconcileQueuedChannelResults(queued, [
    listing(),
    listing({ id: "30000000-0000-4000-8000-000000000002" }),
  ]);
  assert.equal(ambiguous, queued);
});

test("listing stop stays queued while published and completes only when paused", () => {
  const queued: Partial<Record<"qoo10", WorkbenchChannelResult>> = {
    qoo10: {
      phase: "queued",
      operation: "listing.stop",
      attemptId: "40000000-0000-4000-8000-000000000001",
      listingId: "30000000-0000-4000-8000-000000000001",
      market: "JP",
      targetId: "",
    },
  };

  const stillPublished = reconcileQueuedChannelResults(queued, [
    listing({ status: "published", failureClass: null }),
  ]);
  assert.equal(stillPublished, queued);

  const paused = reconcileQueuedChannelResults(queued, [
    listing({ status: "paused", failureClass: null }),
  ]);
  assert.notEqual(paused, queued);
  assert.equal(paused.qoo10?.phase, "succeeded");

  const blocked = reconcileQueuedChannelResults(queued, [
    listing({ status: "failed", failureClass: "external_action", lastError: "manual review" }),
  ]);
  assert.equal(blocked.qoo10?.phase, "blocked");
});
