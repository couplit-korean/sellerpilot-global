import assert from "node:assert/strict";
import test from "node:test";
import {
  ebayCaseDisputeGatewayPlan,
  ebayCaseDisputeGatewayPageSize,
  executeEbayCaseDisputeGatewayPage,
  recordEbayCaseDisputeGatewayObservation,
  validateEbayCaseDisputeGatewayResult,
} from "../lib/channels/cs/ebay/case-dispute-gateway";
import { executeChannelOperation } from "../lib/channels/operations";

const payload = {
  access_token: "fixture-token",
  marketplace_id: "EBAY_US",
  ebay_user_id: "fixture-seller",
  provider_account_identity_version: "v1",
  provider_account_subject: "ebay:eias:fixtureSellerEiasToken01",
};

const caseRow = {
  caseId: "case-gateway-1",
  caseStatusEnum: "OPEN",
  itemId: "item-1",
  transactionId: "transaction-1",
  creationDate: { value: "2026-09-01T00:00:00.000Z" },
  lastModifiedDate: { value: "2026-09-02T00:00:00.000Z" },
  respondByDate: null,
  claimAmount: { value: "10.00", currency: "USD" },
  seller: "fixture-seller",
  buyer: "must-not-survive",
};

const disputeRow = {
  paymentDisputeId: "dispute-gateway-1",
  orderId: "order-1",
  paymentDisputeStatus: "ACTION_NEEDED",
  reason: "ITEM_NOT_RECOGNIZED",
  openDate: "2026-09-03T00:00:00.000Z",
  respondByDate: null,
  closedDate: null,
  amount: { value: "20.00", currency: "USD" },
  buyerAddress: "must-not-survive",
};

test("scheduler plan chains one exact 18-month backfill, a 48-hour overlap, and a payment cursor root", () => {
  const plan = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:42:31.999Z"));
  assert.equal(plan.anchorAt, "2026-09-08T13:00:00.000Z");
  assert.equal(plan.jobs.length, 3);
  const [initial, recent, payment] = plan.jobs;
  assert.equal(initial.arguments.collectionRangeStart, "2025-03-08T13:00:00.000Z");
  assert.equal(initial.arguments.collectionRangeEnd, plan.anchorAt);
  const windows = [{ startTime: initial.arguments.startTime, endTime: initial.arguments.endTime },
    ...initial.arguments.windowQueue];
  assert.ok(windows.length >= 18 && windows.length <= 20);
  for (const [index, window] of windows.entries()) {
    const duration = Date.parse(window.endTime) - Date.parse(window.startTime);
    assert.ok(duration > 0 && duration <= 31 * 86_400_000);
    if (index) assert.equal(Date.parse(window.startTime), Date.parse(windows[index - 1].endTime) + 1);
  }
  assert.equal(windows.at(-1)?.endTime, plan.anchorAt);
  assert.equal(Date.parse(recent.arguments.endTime) - Date.parse(recent.arguments.startTime), 48 * 3_600_000);
  assert.equal(payment.arguments.resourceKind, "payment_dispute");
  assert.equal(payment.arguments.pageNumber, 1);
  assert.equal(payment.arguments.pageSize, ebayCaseDisputeGatewayPageSize);
  assert.doesNotMatch(JSON.stringify(plan), /"access_token"|buyer|address/i);
});

test("resolution collection advances provider pages before moving to the next 31-day window", async () => {
  const plan = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z"));
  const initial = plan.jobs[0].arguments;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      const target = new URL(String(url));
      assert.equal(target.pathname, "/post-order/v2/casemanagement/search");
      assert.equal(target.searchParams.get("offset"), "0");
      assert.equal(target.searchParams.get("limit"), "25");
      assert.equal(new Headers(init?.headers).get("authorization"), "IAF fixture-token");
      return Response.json({
        members: [caseRow],
        paginationOutput: { limit: 25, offset: 0, totalEntries: 1 },
        totalNumberOfCases: 1,
      });
    };
    const result = await executeEbayCaseDisputeGatewayPage({
      payload,
      environment: "production",
      arguments: initial,
    });
    assert.equal(result.steps[0].ok, true);
    assert.equal(result.continuationArguments?.pageNumber, 1);
    assert.equal(result.continuationArguments?.startTime, initial.windowQueue[0].startTime);
    assert.equal((result.continuationArguments?.windowQueue as unknown[]).length, initial.windowQueue.length - 1);
    assert.doesNotMatch(JSON.stringify(result), /buyer|address|access_token/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("payment dispute continuation preserves the exact provider offset through pageNumber", async () => {
  const payment = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z")).jobs[2].arguments;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      const target = new URL(String(url));
      assert.equal(target.pathname, "/sell/fulfillment/v1/payment_dispute_summary");
      assert.equal(target.searchParams.get("offset"), "0");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-token");
      return Response.json({
        paymentDisputeSummaries: [disputeRow],
        limit: 25,
        offset: 0,
        total: 26,
        next: "https://api.ebay.com/sell/fulfillment/v1/payment_dispute_summary?limit=25&offset=25",
      });
    };
    const result = await executeEbayCaseDisputeGatewayPage({
      payload,
      environment: "production",
      arguments: payment,
    });
    assert.equal(result.continuationArguments?.pageNumber, 2);
    assert.equal(result.continuationArguments?.pageSize, 25);
    assert.doesNotMatch(JSON.stringify(result), /buyer|address|access_token/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("common executor pagination metadata is accepted and exact on the next dedicated page", async () => {
  const arguments_ = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z")).jobs[2].arguments;
  const originalFetch = globalThis.fetch;
  const offsets: string[] = [];
  try {
    globalThis.fetch = async (url) => {
      const offset = new URL(String(url)).searchParams.get("offset") ?? "";
      offsets.push(offset);
      return Response.json({
        paymentDisputeSummaries: offset === "0"
          ? [disputeRow]
          : [{ ...disputeRow, paymentDisputeId: "dispute-gateway-2" }],
        limit: 25,
        offset: Number(offset),
        total: 26,
        ...(offset === "0" ? {
          next: "https://api.ebay.com/sell/fulfillment/v1/payment_dispute_summary?limit=25&offset=25",
        } : {}),
      });
    };
    const input = {
      channel: "ebay" as const,
      operation: "inquiries.list" as const,
      environment: "production" as const,
      payload,
      arguments: arguments_ as Record<string, unknown>,
    };
    const first = await executeChannelOperation(input);
    assert.ok(first.continuation);
    validateEbayCaseDisputeGatewayResult({ arguments: input.arguments, result: first });
    const second = await executeChannelOperation({
      ...input,
      arguments: first.continuation!.arguments,
    });
    validateEbayCaseDisputeGatewayResult({
      arguments: first.continuation!.arguments,
      result: second,
    });
    assert.equal(second.continuation, undefined);
    assert.deepEqual(offsets, ["0", "25"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dedicated validation rejects a repeated common cursor digest", async () => {
  const root = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z")).jobs[0].arguments;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({
      members: [],
      paginationOutput: { limit: 25, offset: 0, totalEntries: 0 },
      totalNumberOfCases: 0,
    });
    const first = await executeChannelOperation({
      channel: "ebay", operation: "inquiries.list", payload, environment: "production", arguments: root,
    });
    const current = first.continuation!.arguments;
    const second = await executeChannelOperation({
      channel: "ebay", operation: "inquiries.list", payload, environment: "production", arguments: current,
    });
    const repeated = structuredClone(second);
    const currentTrail = current.sellerpilotPaginationTrail as string[];
    repeated.continuation!.arguments.sellerpilotPaginationTrail = [...currentTrail, currentTrail[0]];
    assert.throws(() => validateEbayCaseDisputeGatewayResult({
      arguments: current,
      result: repeated,
    }), /EBAY_CASE_DISPUTE_GATEWAY_CONTINUATION_MISMATCH/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("one unavailable resource is observed through its claim fence without inventing counts", async () => {
  const payment = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z")).jobs[2].arguments;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload,
      environment: "production",
      arguments: payment,
    });
    assert.equal(result.steps[0].ok, false);
    assert.equal(result.continuationArguments, undefined);
    let recorded: Record<string, unknown> | null = null;
    const receipt = await recordEbayCaseDisputeGatewayObservation({
      jobId: "10000000-0000-4000-8000-000000000001",
      claimToken: "20000000-0000-4000-8000-000000000001",
      tokenHash: "worker-token-hash",
      arguments: payment,
      result,
      rpc: async (name, args) => {
        assert.equal(name, "sellerpilot_service_record_ebay_case_dispute_gateway_page_v2");
        recorded = args.p_page as Record<string, unknown>;
        assert.equal(args.p_continuation_arguments, null);
        return { data: {
          contract: "sellerpilot-ebay-case-dispute-gateway-record/1",
          jobId: "10000000-0000-4000-8000-000000000001",
          resourceKind: "payment_dispute",
          status: "authorization_blocked",
          observedCount: 0,
          insertedCount: 0,
        }, error: null };
      },
    });
    assert.equal(receipt?.status, "authorization_blocked");
    const page = (recorded?.page as Record<string, unknown>);
    assert.equal(page.total, null);
    assert.deepEqual(page.entries, []);
    assert.equal(page.nextOffset, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("collection arguments reject cross-resource ranges and action-shaped input before provider access", async () => {
  const payment = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z")).jobs[2].arguments;
  let calls = 0;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { calls += 1; return Response.json({}); };
    await assert.rejects(executeEbayCaseDisputeGatewayPage({
      payload,
      environment: "production",
      arguments: { ...payment, startTime: "2026-09-01T00:00:00.000Z", action: "accept" },
    }), /CHANNEL_ARGUMENT_INVALID:caseDisputeHistory/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
