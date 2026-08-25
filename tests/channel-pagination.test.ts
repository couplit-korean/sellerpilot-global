import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gatewayWorkerCompletionSchema } from "../lib/channels/gateway-contract";
import { executeChannelOperation } from "../lib/channels/operations";

const naverPayload = {
  client_id: "client",
  client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
  token_type: "SELLER",
  account_id: "seller-uid",
};

test("Shopee order sync follows the official next_cursor until more is false", async () => {
  const originalFetch = globalThis.fetch;
  const cursors: string[] = [];
  globalThis.fetch = async (input) => {
    const cursor = new URL(String(input)).searchParams.get("cursor") ?? "";
    cursors.push(cursor);
    return Response.json({
      response: {
        order_list: [{ order_sn: cursor ? "ORDER-2" : "ORDER-1" }],
        more: !cursor,
        next_cursor: cursor ? "" : "cursor-2",
      },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "orders.list",
      payload: { partner_id: "1", partner_key: "secret", shop_id: "2", access_token: "token" },
      arguments: { query: { time_range_field: "create_time", time_from: 1, time_to: 2, page_size: 50 } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps.map((item) => item.name), ["orders", "orders:2"]);
    assert.deepEqual(cursors, ["", "cursor-2"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada order sync returns one complete page and advances by continuation", async () => {
  const originalFetch = globalThis.fetch;
  const offsets: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const offset = url.searchParams.get("offset") ?? "0";
    offsets.push(offset);
    const orders = offset === "0"
      ? [{ order_id: "L-1", statuses: ["delivered"] }, { order_id: "L-2", statuses: ["delivered"] }]
      : [{ order_id: "L-3", statuses: ["delivered"] }];
    return Response.json({ code: "0", data: { orders, countTotal: 3 } });
  };
  try {
    const base = {
      channel: "lazada",
      operation: "orders.list",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: { queryParams: { created_after: "2026-08-01T00:00:00Z", limit: "2" } },
      environment: "production" as const,
    } as const;
    const first = await executeChannelOperation(base);
    assert.equal(first.ok, true);
    assert.deepEqual(first.steps.map((item) => item.name), ["orders"]);
    assert.equal((first.continuation?.arguments.queryParams as Record<string, unknown>).offset, "2");
    const second = await executeChannelOperation({ ...base, arguments: first.continuation!.arguments });
    assert.equal(second.continuation, undefined);
    assert.deepEqual(second.steps.map((item) => item.name), ["orders"]);
    assert.deepEqual(offsets, ["0", "2"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang order and inquiry sync follow nextToken and pageNum independently", async () => {
  const originalFetch = globalThis.fetch;
  const orderTokens: string[] = [];
  const inquiryPages: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/onlineInquiries")) {
      const page = url.searchParams.get("pageNum") ?? "1";
      inquiryPages.push(page);
      return Response.json({ code: "SUCCESS", data: { content: page === "1" ? [{ inquiryId: 1 }, { inquiryId: 2 }] : [{ inquiryId: 3 }], totalPages: 2 } });
    }
    const token = url.searchParams.get("nextToken") ?? "";
    orderTokens.push(token);
    return Response.json({
      code: "SUCCESS",
      data: [{ shipmentBoxId: token ? 2 : 1 }],
      ...(token ? {} : { nextToken: "next-2" }),
    });
  };
  try {
    const payload = { vendor_id: "A0001", access_key: "access", secret_key: "secret" };
    const orders = await executeChannelOperation({
      channel: "coupang",
      operation: "orders.list",
      payload,
      arguments: { query: { createdAtFrom: "2026-08-01+09:00", createdAtTo: "2026-08-02+09:00", status: "ACCEPT", maxPerPage: 50 } },
      environment: "production",
    });
    const inquiries = await executeChannelOperation({
      channel: "coupang",
      operation: "inquiries.list",
      payload,
      arguments: { kind: "product", query: { inquiryStartAt: "2026-08-01", inquiryEndAt: "2026-08-02", pageNum: 1, pageSize: 2 } },
      environment: "production",
    });
    assert.equal(orders.ok, true);
    assert.deepEqual(orders.steps.map((item) => item.name), ["orders", "orders:2"]);
    assert.deepEqual(orderTokens, ["", "next-2"]);
    assert.equal(inquiries.ok, true);
    assert.deepEqual(inquiries.steps.map((item) => item.name), ["inquiries", "inquiries:2"]);
    assert.deepEqual(inquiryPages, ["1", "2"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore order checkpoints and inquiry pages are exhausted", async () => {
  const originalFetch = globalThis.fetch;
  const orderQueries: URLSearchParams[] = [];
  const inquiryPages: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 10_800 });
    if (url.pathname.endsWith("/last-changed-statuses")) {
      orderQueries.push(url.searchParams);
      const continued = url.searchParams.get("moreSequence") === "seq-2";
      return Response.json(continued
        ? { lastChangeStatuses: [{ productOrderId: "N-2" }] }
        : { lastChangeStatuses: [{ productOrderId: "N-1" }], more: { moreFrom: "2026-08-01T01:00:00Z", moreSequence: "seq-2" } });
    }
    const page = url.searchParams.get("page") ?? "1";
    inquiryPages.push(page);
    return Response.json({ contents: page === "1" ? [{ questionId: 1 }, { questionId: 2 }] : [{ questionId: 3 }], totalPages: 2 });
  };
  try {
    const orders = await executeChannelOperation({
      channel: "smartstore",
      operation: "orders.list",
      payload: naverPayload,
      arguments: { query: { lastChangedFrom: "2026-08-01T00:00:00Z", limitCount: 300 } },
      environment: "production",
    });
    const inquiries = await executeChannelOperation({
      channel: "smartstore",
      operation: "inquiries.list",
      payload: naverPayload,
      arguments: { query: { fromDate: "2026-08-01T00:00:00Z", toDate: "2026-08-02T00:00:00Z", page: 1, size: 2 } },
      environment: "production",
    });
    assert.equal(orders.ok, true);
    assert.deepEqual(orders.steps.map((item) => item.name), ["orders", "orders:2"]);
    assert.equal(orderQueries[1]?.get("lastChangedFrom"), "2026-08-01T01:00:00Z");
    assert.equal(orderQueries[1]?.get("moreSequence"), "seq-2");
    assert.equal(inquiries.ok, true);
    assert.deepEqual(inquiries.steps.map((item) => item.name), ["inquiries", "inquiries:2"]);
    assert.deepEqual(inquiryPages, ["1", "2"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay order sync advances the numeric offset until total is reached", async () => {
  const originalFetch = globalThis.fetch;
  const offsets: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const offset = url.searchParams.get("offset") ?? "0";
    offsets.push(offset);
    const orders = offset === "0" ? [{ orderId: "E-1" }, { orderId: "E-2" }] : [{ orderId: "E-3" }];
    return Response.json({ orders, total: 3, limit: 2, offset: Number(offset), ...(offset === "0" ? { next: `${url.origin}${url.pathname}?limit=2&offset=2` } : {}) });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "orders.list",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: { query: { limit: 2, filter: "creationdate:[2026-08-01T00:00:00Z..2026-08-02T00:00:00Z]" } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps.map((item) => item.name), ["orders", "orders:2"]);
    assert.deepEqual(offsets, ["0", "2"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee page cap returns a durable cursor and the next execution advances", async () => {
  const originalFetch = globalThis.fetch;
  const cursors: string[] = [];
  globalThis.fetch = async (input) => {
    const cursor = new URL(String(input)).searchParams.get("cursor") ?? "";
    cursors.push(cursor);
    const page = cursor ? Number(cursor.slice("cursor-".length)) : 1;
    return Response.json({
      response: {
        order_list: [{ order_sn: `S-${page}` }],
        more: page <= 20,
        next_cursor: page <= 20 ? `cursor-${page + 1}` : "",
      },
    });
  };
  try {
    const base = {
      channel: "shopee" as const,
      operation: "orders.list" as const,
      payload: { partner_id: "1", partner_key: "secret", shop_id: "2", access_token: "token" },
      arguments: { query: { time_range_field: "create_time", time_from: 1, time_to: 2, page_size: 1 } },
      environment: "production" as const,
    };
    const first = await executeChannelOperation(base);
    assert.equal(first.steps.length, 20);
    assert.equal((first.continuation?.arguments.query as Record<string, unknown>).cursor, "cursor-21");
    assert.equal(first.continuation?.arguments.sellerpilotPaginationDepth, 1);
    const second = await executeChannelOperation({ ...base, arguments: first.continuation!.arguments });
    assert.equal(second.continuation, undefined);
    assert.equal(cursors.at(-1), "cursor-21");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada keeps every item detail within one 100-order page before continuing", async () => {
  const originalFetch = globalThis.fetch;
  const offsets: number[] = [];
  const detailedOrderIds: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/order/items/get")) {
      const orderId = url.searchParams.get("order_id") ?? "";
      detailedOrderIds.push(orderId);
      return Response.json({ code: "0", data: [{ order_item_id: `ITEM-${orderId}` }] });
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    offsets.push(offset);
    const orders = offset === 0
      ? Array.from({ length: 100 }, (_, index) => ({ order_id: `L-${index}`, statuses: ["pending"] }))
      : [{ order_id: "L-100", statuses: ["pending"] }];
    return Response.json({
      code: "0",
      data: { orders },
    });
  };
  try {
    const base = {
      channel: "lazada" as const,
      operation: "orders.list" as const,
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: { queryParams: { created_after: "2026-08-01T00:00:00Z", limit: "100" } },
      environment: "production" as const,
    };
    const first = await executeChannelOperation(base);
    assert.equal(first.steps.length, 101);
    assert.deepEqual(
      detailedOrderIds.slice(0, 100).sort(),
      Array.from({ length: 100 }, (_, index) => `L-${index}`).sort(),
    );
    assert.equal(gatewayWorkerCompletionSchema.safeParse({
      jobId: "00000000-0000-4000-8000-000000000011",
      claimToken: "00000000-0000-4000-8000-000000000012",
      status: "succeeded",
      result: first,
    }).success, true);
    assert.equal((first.continuation?.arguments.queryParams as Record<string, unknown>).offset, "100");
    const second = await executeChannelOperation({ ...base, arguments: first.continuation!.arguments });
    assert.equal(second.continuation, undefined);
    assert.deepEqual(offsets, [0, 100]);
    assert.equal(detailedOrderIds.at(-1), "L-100");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang page cap persists nextToken and numbered inquiry continuation", async () => {
  const originalFetch = globalThis.fetch;
  const orderTokens: string[] = [];
  const inquiryPages: number[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/onlineInquiries")) {
      const page = Number(url.searchParams.get("pageNum") ?? 1);
      inquiryPages.push(page);
      return Response.json({
        code: "SUCCESS",
        data: { content: page <= 20 ? [{ inquiryId: page }] : [], totalPages: 21 },
      });
    }
    const token = url.searchParams.get("nextToken") ?? "";
    orderTokens.push(token);
    const page = token ? Number(token.slice("token-".length)) : 1;
    return Response.json({
      code: "SUCCESS",
      data: [{ shipmentBoxId: page }],
      ...(page <= 20 ? { nextToken: `token-${page + 1}` } : {}),
    });
  };
  try {
    const payload = { vendor_id: "A0001", access_key: "access", secret_key: "secret" };
    const orderBase = {
      channel: "coupang" as const,
      operation: "orders.list" as const,
      payload,
      arguments: { query: { createdAtFrom: "2026-08-01+09:00", createdAtTo: "2026-08-02+09:00", maxPerPage: 1 } },
      environment: "production" as const,
    };
    const firstOrders = await executeChannelOperation(orderBase);
    assert.equal((firstOrders.continuation?.arguments.query as Record<string, unknown>).nextToken, "token-21");
    await executeChannelOperation({ ...orderBase, arguments: firstOrders.continuation!.arguments });
    assert.equal(orderTokens.at(-1), "token-21");

    const inquiryBase = {
      channel: "coupang" as const,
      operation: "inquiries.list" as const,
      payload,
      arguments: { kind: "product", query: { inquiryStartAt: "2026-08-01", inquiryEndAt: "2026-08-02", pageNum: 1, pageSize: 1 } },
      environment: "production" as const,
    };
    const firstInquiries = await executeChannelOperation(inquiryBase);
    assert.equal((firstInquiries.continuation?.arguments.query as Record<string, unknown>).pageNum, 21);
    await executeChannelOperation({ ...inquiryBase, arguments: firstInquiries.continuation!.arguments });
    assert.equal(inquiryPages.at(-1), 21);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore cap persists exact more token and inquiry page", async () => {
  const originalFetch = globalThis.fetch;
  const orderSequences: string[] = [];
  const inquiryPages: number[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 10_800 });
    if (url.pathname.endsWith("/last-changed-statuses")) {
      const sequence = url.searchParams.get("moreSequence") ?? "";
      orderSequences.push(sequence);
      const page = sequence ? Number(sequence.slice("seq-".length)) : 1;
      return Response.json({
        lastChangeStatuses: [{ productOrderId: `N-${page}` }],
        ...(page <= 20 ? { more: { moreFrom: `2026-08-01T${String(page).padStart(2, "0")}:00:00Z`, moreSequence: `seq-${page + 1}` } } : {}),
      });
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    inquiryPages.push(page);
    return Response.json({ contents: page <= 21 ? [{ questionId: page }] : [], totalPages: 21 });
  };
  try {
    const orderBase = {
      channel: "smartstore" as const,
      operation: "orders.list" as const,
      payload: naverPayload,
      arguments: { query: { lastChangedFrom: "2026-08-01T00:00:00Z", limitCount: 1 } },
      environment: "production" as const,
    };
    const firstOrders = await executeChannelOperation(orderBase);
    assert.equal((firstOrders.continuation?.arguments.query as Record<string, unknown>).moreSequence, "seq-21");
    await executeChannelOperation({ ...orderBase, arguments: firstOrders.continuation!.arguments });
    assert.equal(orderSequences.at(-1), "seq-21");

    const inquiryBase = {
      channel: "smartstore" as const,
      operation: "inquiries.list" as const,
      payload: naverPayload,
      arguments: { query: { fromDate: "2026-08-01T00:00:00Z", toDate: "2026-08-02T00:00:00Z", page: 1, size: 1 } },
      environment: "production" as const,
    };
    const firstInquiries = await executeChannelOperation(inquiryBase);
    assert.equal((firstInquiries.continuation?.arguments.query as Record<string, unknown>).page, 21);
    await executeChannelOperation({ ...inquiryBase, arguments: firstInquiries.continuation!.arguments });
    assert.equal(inquiryPages.at(-1), 21);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay and Temu cap continuations start at the first unprocessed page", async () => {
  const originalFetch = globalThis.fetch;
  const ebayOffsets: number[] = [];
  const temuOrderPages: number[] = [];
  const temuInquiryPages: number[] = [];
  const temuInternalMetadataLeaks: boolean[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/sell/fulfillment/")) {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      ebayOffsets.push(offset);
      return Response.json({ orders: [{ orderId: `E-${offset}` }], total: 21, limit: 1, offset });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    temuInternalMetadataLeaks.push("sellerpilotPaginationDepth" in body);
    const type = String(body.type ?? "");
    const args = body.data && typeof body.data === "object" ? body.data as Record<string, unknown>
      : body.arguments && typeof body.arguments === "object" ? body.arguments as Record<string, unknown>
        : body;
    if (type === "bg.order.list.v2.get") {
      const page = Number(args.pageNumber ?? 1);
      temuOrderPages.push(page);
      return Response.json({ success: true, result: { pageItems: page <= 20 ? [{ parentOrderMap: { parentOrderSn: `T-${page}` } }] : [] } });
    }
    const page = Number(args.pageNo ?? 1);
    temuInquiryPages.push(page);
    return Response.json({ success: true, result: { data: page <= 20 ? [{ parentAfterSalesSn: `A-${page}` }] : [] } });
  };
  try {
    const ebayBase = {
      channel: "ebay" as const,
      operation: "orders.list" as const,
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: { query: { limit: 1, filter: "creationdate:[2026-08-01T00:00:00Z..2026-08-02T00:00:00Z]" } },
      environment: "production" as const,
    };
    const firstEbay = await executeChannelOperation(ebayBase);
    assert.equal((firstEbay.continuation?.arguments.query as Record<string, unknown>).offset, 20);
    await executeChannelOperation({ ...ebayBase, arguments: firstEbay.continuation!.arguments });
    assert.equal(ebayOffsets.at(-1), 20);

    const temuPayload = { app_key: "app", app_secret: "secret", access_token: "token" };
    const temuOrderBase = {
      channel: "temu" as const,
      operation: "orders.list" as const,
      payload: temuPayload,
      arguments: { pageNumber: 1, pageSize: 1, updateAtStart: 1, updateAtEnd: 2 },
      environment: "production" as const,
    };
    const firstTemuOrders = await executeChannelOperation(temuOrderBase);
    assert.equal(firstTemuOrders.continuation?.arguments.pageNumber, 21);
    await executeChannelOperation({ ...temuOrderBase, arguments: firstTemuOrders.continuation!.arguments });
    assert.equal(temuOrderPages.at(-1), 21);

    const temuInquiryBase = {
      channel: "temu" as const,
      operation: "inquiries.list" as const,
      payload: temuPayload,
      arguments: { pageNo: 1, pageSize: 1, updateAtStart: 1, updateAtEnd: 2 },
      environment: "production" as const,
    };
    const firstTemuInquiries = await executeChannelOperation(temuInquiryBase);
    assert.equal(firstTemuInquiries.continuation?.arguments.pageNo, 21);
    await executeChannelOperation({ ...temuInquiryBase, arguments: firstTemuInquiries.continuation!.arguments });
    assert.equal(temuInquiryPages.at(-1), 21);
    assert.equal(temuInternalMetadataLeaks.some(Boolean), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("order and inquiry normalizers consume every successful provider page", async () => {
  const [orders, inquiries] = await Promise.all([
    readFile(new URL("../lib/channels/order-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/inquiry-sync.ts", import.meta.url), "utf8"),
  ]);
  assert.match(orders, /orderSteps = result\.steps\.filter[\s\S]*pageData\.flatMap/);
  assert.match(inquiries, /inquirySteps = result\.steps\.filter[\s\S]*pageData\.flatMap/);
});

test("gateway completion accepts only bounded provider-specific continuations", () => {
  const base = {
    jobId: "00000000-0000-4000-8000-000000000001",
    claimToken: "00000000-0000-4000-8000-000000000002",
    status: "succeeded" as const,
    result: {
      ok: true,
      channel: "shopee",
      operation: "orders.list",
      steps: [{ name: "orders", ok: true, status: 200, data: {} }],
      safeMessage: "next page",
      continuation: {
        reason: "page_cap_reached",
        arguments: { query: { cursor: "cursor-21" }, sellerpilotPaginationDepth: 1 },
      },
    },
  };
  assert.equal(gatewayWorkerCompletionSchema.safeParse(base).success, true);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...base,
    result: {
      ...base.result,
      continuation: {
        reason: "page_cap_reached",
        arguments: { query: { cursor: "" }, sellerpilotPaginationDepth: 1 },
      },
    },
  }).success, false);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...base,
    result: {
      ...base.result,
      continuation: {
        reason: "page_cap_reached",
        arguments: { query: { cursor: "cursor-21" }, sellerpilotPaginationDepth: 51 },
      },
    },
  }).success, false);
});

test("continuation depth safety stop fails before another provider request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ response: { order_list: [], more: false } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "orders.list",
      payload: { partner_id: "1", partner_key: "secret", shop_id: "2", access_token: "token" },
      arguments: {
        query: { time_range_field: "create_time", time_from: 1, time_to: 2, page_size: 1, cursor: "cursor-1001" },
        sellerpilotPaginationDepth: 50,
      },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.name, "pagination-safety-stop");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
