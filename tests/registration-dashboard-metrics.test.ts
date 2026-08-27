import assert from "node:assert/strict";
import test from "node:test";
import { reconcileRegistrationDashboardMetrics } from "../lib/registration-dashboard-metrics";

const failedAiJob = {
  id: "job:11111111-1111-4111-8111-111111111111",
  productId: null,
  status: "failed",
  channels: [],
};

test("dashboard retryable count combines unique AI jobs with the channel retryable population once", () => {
  const payload = {
    pipeline: { aiRunning: 1, listingQueued: 0, listingPublished: 4, listingFailed: 2, listingBlocked: 7 },
    summary: { registrationErrorCount: 3, registrationBlockedCount: 7 },
  };
  const result = reconcileRegistrationDashboardMetrics(payload, [
    failedAiJob,
    { ...failedAiJob },
    {
      id: "product:22222222-2222-4222-8222-222222222222",
      productId: "22222222-2222-4222-8222-222222222222",
      status: "failed",
      channels: [
        { channel: "elevenst", market: "KR", status: "failed" },
        { channel: "elevenst", market: "KR", status: "failed" },
      ],
    },
    {
      id: "job:33333333-3333-4333-8333-333333333333",
      productId: null,
      status: "failed",
      channels: [],
    },
  ]);

  assert.equal((result.pipeline as Record<string, unknown>).listingFailed, 5);
  assert.equal((result.pipeline as Record<string, unknown>).channelListingFailed, 3);
  assert.equal((result.pipeline as Record<string, unknown>).aiRetryableFailed, 2);
  assert.equal((result.summary as Record<string, unknown>).registrationErrorCount, 5);
});

test("blocked and running counts stay unchanged and non-recoverable AI cards are excluded", () => {
  const pipeline = { aiRunning: 1, listingQueued: 2, listingPublished: 3, listingFailed: 0, listingBlocked: 4 };
  const summary = { registrationErrorCount: 0, registrationBlockedCount: 4, openTicketCount: 9 };
  const result = reconcileRegistrationDashboardMetrics({ pipeline, summary }, [
    { ...failedAiJob, status: "analyzing" },
    { ...failedAiJob, id: "revision:11111111-1111-4111-8111-111111111111" },
    { ...failedAiJob, id: "job:not-a-uuid" },
    { ...failedAiJob, productId: "11111111-1111-4111-8111-111111111111" },
    {
      id: "product:44444444-4444-4444-8444-444444444444",
      productId: "44444444-4444-4444-8444-444444444444",
      status: "blocked",
      channels: [{ channel: "lazada", market: "MY", status: "blocked" }],
    },
  ]);

  assert.equal((result.pipeline as Record<string, unknown>).aiRunning, pipeline.aiRunning);
  assert.equal((result.pipeline as Record<string, unknown>).listingQueued, pipeline.listingQueued);
  assert.equal((result.pipeline as Record<string, unknown>).listingPublished, pipeline.listingPublished);
  assert.equal((result.pipeline as Record<string, unknown>).listingFailed, pipeline.listingFailed);
  assert.equal((result.pipeline as Record<string, unknown>).listingBlocked, pipeline.listingBlocked);
  assert.equal((result.pipeline as Record<string, unknown>).aiRetryableFailed, 0);
  assert.equal((result.summary as Record<string, unknown>).registrationErrorCount, summary.registrationErrorCount);
  assert.equal((result.summary as Record<string, unknown>).registrationBlockedCount, summary.registrationBlockedCount);
  assert.equal((result.summary as Record<string, unknown>).openTicketCount, summary.openTicketCount);
});
