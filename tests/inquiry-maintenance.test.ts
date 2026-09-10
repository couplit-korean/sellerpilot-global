import assert from "node:assert/strict";
import test from "node:test";
import { executeSmartstoreInquiry } from "../lib/channels/smartstore-inquiries";
import { executeCoupangInquiry } from "../lib/channels/coupang-inquiries";
import { executeShopeeInquiry } from "../lib/channels/shopee-inquiries";
import { inquirySyncRequests } from "../lib/channels/sync-arguments";

test("answered-status coverage survives durable continuation and short provider pages", async () => {
  for (const channel of ["coupang", "smartstore"] as const) {
    const answeredStatusRequests = inquirySyncRequests(channel, new Date("2026-09-07T03:00:00Z"))
      .filter((sync) => channel !== "coupang" || ["product", "call-center"].includes(String(sync.arguments.kind)));
    for (const sync of answeredStatusRequests) {
      let argumentsValue = sync.arguments;
      const requests: URLSearchParams[] = [];
      const originalFetch = globalThis.fetch;
      const request = async (query: URLSearchParams) => {
        requests.push(query);
        const page = Number(query.get(channel === "coupang" ? "pageNum" : "page"));
        const rows = [{ inquiryId: page, questionId: page, inquiryNo: page }];
        const data = channel === "coupang" ? { code: "SUCCESS", data: { content: rows, totalPages: 2 } }
          : sync.arguments.kind === "customer" ? { content: rows, totalPages: 2 }
            : { contents: rows, totalPages: 2 };
        return { response: new Response(null, { status: 200 }), data };
      };
      globalThis.fetch = async (input) => Response.json((await request(new URL(String(input)).searchParams)).data);
      try {
        for (let page = 1; page <= 2; page++) {
          const response = channel === "coupang"
            ? await executeCoupangInquiry({ operation: "inquiries.list", arguments: argumentsValue,
              payload: { vendor_id: "V1", access_key: "test", secret_key: "test" } })
            : await executeSmartstoreInquiry({ operation: "inquiries.list", arguments: argumentsValue, payload: {} },
              (input) => request(input.query!));
          assert.equal(Boolean(response.continuationArguments), page === 1);
          if (response.continuationArguments) argumentsValue = response.continuationArguments;
        }
        assert.equal(requests.length, 2);
        for (const query of requests) {
          if (channel === "smartstore") assert.equal(query.has("answered"), false);
          else if (sync.arguments.kind === "product") assert.equal(query.get("answeredType"), "ALL");
          else assert.equal(query.get("partnerCounselingStatus"), "NONE");
        }
      } finally { globalThis.fetch = originalFetch; }
    }
  }
});

test("a missing list or empty intermediate page is an error, never completed history", async () => {
  for (const data of [{}, { content: [], totalPages: 2 }]) {
    await assert.rejects(executeSmartstoreInquiry({
      operation: "inquiries.list", payload: {}, arguments: { kind: "customer", query: {
        startSearchDate: "2026-09-01", endSearchDate: "2026-09-07", page: 1, size: 200,
      } },
    }, async () => ({ response: new Response(null, { status: 200 }), data })), /INQUIRY_(PAGE_INVALID|PAGINATION_INCONSISTENT)/);
  }
});

test("Shopee comments persist a bounded page batch and return the exact next cursor", async () => {
  const originalFetch = globalThis.fetch;
  const cursors: string[] = [];
  globalThis.fetch = async (input) => {
    const cursor = new URL(String(input)).searchParams.get("cursor") ?? "";
    cursors.push(cursor);
    const page = cursors.length;
    return Response.json({
      error: "",
      response: {
        item_comment_list: [{ comment_id: page, item_id: 10, comment: `page-${page}` }],
        more: true,
        next_cursor: `cursor-${page}`,
      },
    });
  };
  try {
    const result = await executeShopeeInquiry({
      operation: "inquiries.list",
      payload: { partner_id: "1", partner_key: "secret", shop_id: "10", access_token: "token" },
      arguments: { pageSize: 100 },
      environment: "production",
    });
    assert.equal(result.steps.length, 4);
    assert.deepEqual(cursors, ["", "cursor-1", "cursor-2", "cursor-3"]);
    assert.equal(result.continuationArguments?.cursor, "cursor-4");
    assert.equal(result.continuationArguments?.pageSize, 100);
    assert.equal(result.steps.every((step) => step.ok), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
