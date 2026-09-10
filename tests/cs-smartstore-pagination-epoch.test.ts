import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";

const payload = {
  client_id: "client",
  client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
  token_type: "SELLER",
  account_id: "seller-uid",
};

test("SmartStore product inquiry continuation crosses page 50 with bounded epochs", async () => {
  const originalFetch = globalThis.fetch;
  const observedPages: number[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1/oauth2/token")) {
      return Response.json({ access_token: "token", expires_in: 10_800 });
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    observedPages.push(page);
    return Response.json({
      contents: [{ questionId: page, question: `문의 ${page}`, createDate: "2026-09-01T00:00:00Z" }],
      totalPages: 55,
    });
  };

  try {
    let arguments_: Record<string, unknown> = {
      kind: "product",
      query: {
        fromDate: "2026-09-01T00:00:00.000Z",
        toDate: "2026-09-02T00:00:00.000Z",
        page: 1,
        size: 100,
      },
    };
    const states: Array<{ page: number; depth: number; epoch: number; trailLength: number }> = [];
    for (let page = 1; page <= 55; page += 1) {
      const result = await executeChannelOperation({
        channel: "smartstore",
        operation: "inquiries.list",
        payload,
        arguments: arguments_,
        environment: "production",
      });
      assert.equal(result.ok, true, `page ${page}`);
      if (page === 55) {
        assert.equal(result.continuation, undefined);
        break;
      }
      arguments_ = result.continuation!.arguments;
      states.push({
        page: Number((arguments_.query as Record<string, unknown>).page),
        depth: Number(arguments_.sellerpilotPaginationDepth),
        epoch: Number(arguments_.sellerpilotPaginationEpoch),
        trailLength: (arguments_.sellerpilotPaginationTrail as string[]).length,
      });
    }

    assert.deepEqual(observedPages, Array.from({ length: 55 }, (_, index) => index + 1));
    assert.deepEqual(states.find(state => state.page === 50), {
      page: 50,
      depth: 49,
      epoch: 0,
      trailLength: 49,
    });
    assert.deepEqual(states.find(state => state.page === 51), {
      page: 51,
      depth: 1,
      epoch: 1,
      trailLength: 50,
    });
    assert.deepEqual(states.find(state => state.page === 55), {
      page: 55,
      depth: 5,
      epoch: 1,
      trailLength: 50,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("one legacy SmartStore page-51 job rotates into the bounded epoch contract", async () => {
  const originalFetch = globalThis.fetch;
  const observedPages: number[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1/oauth2/token")) {
      return Response.json({ access_token: "token", expires_in: 10_800 });
    }
    observedPages.push(Number(url.searchParams.get("page") ?? 1));
    return Response.json({ contents: [{ questionId: 51, question: "문의 51" }], totalPages: 52 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "product",
        query: {
          fromDate: "2026-09-01T00:00:00.000Z",
          toDate: "2026-09-02T00:00:00.000Z",
          page: 51,
          size: 100,
        },
        sellerpilotPaginationDepth: 50,
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(observedPages, [51]);
    assert.equal(result.continuation?.arguments.sellerpilotPaginationDepth, 1);
    assert.equal(result.continuation?.arguments.sellerpilotPaginationEpoch, 1);
    assert.equal((result.continuation?.arguments.sellerpilotPaginationTrail as string[]).length, 1);

    const forged = await executeChannelOperation({
      channel: "smartstore",
      operation: "inquiries.list",
      payload,
      arguments: {
        ...(result.continuation?.arguments ?? {}),
        sellerpilotPaginationDepth: 50,
      },
      environment: "production",
    });
    assert.equal(forged.ok, false);
    assert.equal(forged.steps[0]?.name, "pagination-safety-stop");
    assert.deepEqual(observedPages, [51]);

    const wrongPage = await executeChannelOperation({
      channel: "smartstore",
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "product",
        query: { page: 52, size: 100 },
        sellerpilotPaginationDepth: 50,
      },
      environment: "production",
    });
    assert.equal(wrongPage.ok, false);
    assert.equal(wrongPage.steps[0]?.name, "pagination-safety-stop");
    assert.deepEqual(observedPages, [51]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
