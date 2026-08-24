import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { compareSync as bcryptCompareSync } from "bcryptjs";
import { activeChannelKeys, channelCatalog } from "../lib/channels/catalog";
import {
  buildCoupangAuthorization,
  buildEbayConsentUrl,
  buildQoo10Url,
  buildShopeeAuthorizationUrl,
  buildShopeeSignature,
  buildTemuSignature,
  createNaverClientSecretSign,
  ebayRequest,
  ensureEbayAccessToken,
  ensureShopeeAccessToken,
  ensureShopeeMerchantAccessToken,
  elevenstRequest,
  exchangeShopeeOAuthToken,
  fetchNaverAccessToken,
  lazadaRequest,
} from "../lib/channels/protocols";
import { executeChannelOperation } from "../lib/channels/operations";
import { inquirySyncArguments, orderSyncRequests } from "../lib/channels/sync-arguments";
import { buildShipmentArguments } from "../lib/channels/shipment-draft";
import { qoo10CatalogCode, qoo10ExpiryDate, qoo10PauseParams, qoo10ProductionPlace, qoo10ResultMessage, qoo10SellerCode } from "../lib/channels/qoo10";

test("Coupang CEA authorization signs the documented canonical value", () => {
  const now = new Date("2026-08-16T03:04:05.000Z");
  const path = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";
  const query = "vendorId=A00012345&maxPerPage=1";
  const expectedSignature = createHmac("sha256", "test-secret")
    .update(`260816T030405ZGET${path}${query}`)
    .digest("hex");
  assert.equal(
    buildCoupangAuthorization({ method: "GET", path, query, accessKey: "test-access", secretKey: "test-secret", now }),
    `CEA algorithm=HmacSHA256, access-key=test-access, signed-date=260816T030405Z, signature=${expectedSignature}`,
  );
});

test("Naver client secret signature is a bcrypt hash wrapped in Base64", () => {
  const clientId = "test-client";
  const timestamp = 1_786_848_245_000;
  const bcryptSalt = "$2b$10$abcdefghijklmnopqrstuu";
  const encoded = createNaverClientSecretSign(clientId, bcryptSalt, timestamp);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  assert.equal(bcryptCompareSync(`${clientId}_${timestamp}`, decoded), true);
});

test("Naver seller data token rejects SELLER without account_id", async () => {
  await assert.rejects(
    fetchNaverAccessToken({
      client_id: "client",
      client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
      token_type: "SELLER",
    }),
    /NAVER_CREDENTIALS_MISSING/,
  );
});

test("Naver self-store token uses SELF without account_id", async () => {
  const originalFetch = globalThis.fetch;
  let tokenBody = new URLSearchParams();
  globalThis.fetch = async (_input, init) => {
    tokenBody = new URLSearchParams(String(init?.body));
    return Response.json({ access_token: "self-token", expires_in: 10_800, token_type: "Bearer" });
  };
  try {
    const token = await fetchNaverAccessToken({
      client_id: "client",
      client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
      token_type: "SELF",
    });
    assert.equal(token.accessToken, "self-token");
    assert.equal(tokenBody.get("type"), "SELF");
    assert.equal(tokenBody.has("account_id"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 uses current QAPI endpoint and qualified method name", () => {
  const url = buildQoo10Url({
    apiKey: "hidden-key",
    service: "ItemsLookup",
    method: "GetItemDetailInfo",
    version: "1.2",
    params: { ItemCode: "1234567890", SellerCode: "" },
  });
  assert.equal(url.pathname, "/GMKT.INC.Front.QAPIService/ebayjapan.qapi/ItemsLookup.GetItemDetailInfo");
  assert.equal(url.search, "");
});

test("11st fixed-IP diagnostic calls ProductSearch and returns only safe XML metadata", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return new Response("<?xml version=\"1.0\"?><ProductSearchResponse><TotalCount>1</TotalCount><Products><Product><ProductCode>1</ProductCode></Product></Products></ProductSearchResponse>", {
      status: 200,
      headers: { "content-type": "text/xml; charset=euc-kr" },
    });
  };
  try {
    const result = await elevenstRequest({
      payload: { api_key: "A".repeat(32) },
      apiCode: "ProductSearch",
      params: { keyword: "생활용품", pageNum: "1", pageSize: "1" },
    });
    const url = new URL(calledUrl);
    assert.equal(url.hostname, "openapi.11st.co.kr");
    assert.equal(url.searchParams.get("apiCode"), "ProductSearch");
    assert.equal(result.data.accepted, true);
    assert.equal(result.data.hasProduct, true);
    assert.equal(result.data.totalCount, 1);
    assert.equal(result.text, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 periodic order sync uses the documented Japan-time parameters for every shipping state", () => {
  const requests = orderSyncRequests("qoo10", new Date("2026-08-20T07:00:00.000Z"));
  assert.deepEqual(requests.map((request) => request.periodicKey), ["orders:0", "orders:3", "orders:4", "orders:5"]);
  assert.deepEqual(requests[0]?.arguments.params, {
    SearchStartDate: "20260806160000",
    SearchEndDate: "20260820160000",
    ShippingStatus: "0",
    SearchCondition: "1",
  });
});

test("Coupang cancellation sync uses the documented minute range with the Korean UTC offset", () => {
  const requests = orderSyncRequests("coupang", new Date("2026-08-20T07:00:00.000Z"));
  const cancellation = requests.find((request) => request.periodicKey === "orders:cancellations");
  assert.deepEqual(cancellation?.arguments, {
    kind: "cancellations",
    query: {
      searchType: "timeFrame",
      createdAtFrom: "2026-08-19T16:00+09:00",
      createdAtTo: "2026-08-20T16:00+09:00",
      cancelType: "CANCEL",
    },
  });
});

test("Qoo10 unanswered inquiry sync uses the current CSCenter parameter names", () => {
  assert.deepEqual(inquirySyncArguments("qoo10", new Date("2026-08-20T07:00:00.000Z")), [{
    params: { search_start_dt: "20260814", search_end_dt: "20260820", proc_status: "S1" },
  }]);
});

test("Smartstore inquiry sync sends the required W3C date range and unanswered filter", () => {
  assert.deepEqual(inquirySyncArguments("smartstore", new Date("2026-08-20T07:00:00.000Z")), [{
    query: {
      fromDate: "2026-08-14T07:00:00.000Z",
      toDate: "2026-08-20T07:00:00.000Z",
      answered: false,
      page: 1,
      size: 100,
    },
  }]);
});

test("Temu order and after-sales sync use the documented update checkpoints", () => {
  const now = new Date("2026-08-20T07:00:00.000Z");
  assert.deepEqual(orderSyncRequests("temu", now), [{
    periodicKey: "orders",
    arguments: {
      pageNumber: 1,
      pageSize: 100,
      updateAtStart: new Date("2026-08-06T07:00:00.000Z").getTime(),
      updateAtEnd: now.getTime(),
      sortby: "updateTime",
    },
  }]);
  assert.deepEqual(inquirySyncArguments("temu", now), [{
    pageNo: 1,
    pageSize: 200,
    updateAtStart: new Date("2026-08-06T07:00:00.000Z").getTime(),
    updateAtEnd: now.getTime(),
  }]);
});

test("shipment drafts map carrier and tracking fields without changing internal order state", () => {
  const shippedAt = new Date("2026-08-21T03:04:05.000Z");
  assert.deepEqual(buildShipmentArguments({
    channel: "qoo10",
    externalOrderId: "123456789",
    carrierCode: "CJ",
    trackingNumber: "123456789012",
    shippedAt,
  }), {
    params: { OrderNo: "123456789", ShippingCorp: "CJ", TrackingNo: "123456789012" },
  });
  assert.deepEqual(buildShipmentArguments({
    channel: "coupang",
    externalOrderId: "987654321",
    carrierCode: "CJGLS",
    trackingNumber: "111222333444",
    shippedAt,
  }), {
    body: {
      orderSheetInvoiceApplyDtoList: [{
        shipmentBoxId: 987654321,
        deliveryCompanyCode: "CJGLS",
        invoiceNumber: "111222333444",
      }],
    },
  });
  assert.deepEqual(buildShipmentArguments({
    channel: "smartstore",
    externalOrderId: "PROD-ORDER-1",
    carrierCode: "CJGLS",
    trackingNumber: "111222333444",
    shippedAt,
  }), {
    body: {
      dispatchProductOrders: [{
        productOrderId: "PROD-ORDER-1",
        deliveryMethod: "DELIVERY",
        deliveryCompanyCode: "CJGLS",
        trackingNumber: "111222333444",
        dispatchDate: "2026-08-21T03:04:05.000Z",
      }],
    },
  });
  const temuContext = {
    parentOrderSn: "PO-100",
    regionId: "211",
    inventoryDeductionWarehouseId: "3001",
    orderItems: [{ parentOrderSn: "PO-100", orderSn: "O-101", goodsId: "G-1", skuId: "S-1", quantity: 1 }],
  };
  assert.deepEqual(buildShipmentArguments({
    channel: "temu",
    externalOrderId: "PO-100",
    carrierCode: "CJGLS",
    trackingNumber: "111222333444",
    providerContext: temuContext,
  }), {
    parentOrderSn: "PO-100",
    carrierCode: "CJGLS",
    trackingNumber: "111222333444",
    providerContext: temuContext,
  });
  const lazadaContext = { orderId: "ORDER-1", orderItemIds: ["ITEM-1", "ITEM-2"], deliveryType: "dropship" };
  assert.deepEqual(buildShipmentArguments({
    channel: "lazada",
    externalOrderId: "ORDER-1",
    carrierCode: "FM49",
    trackingNumber: "",
    providerContext: lazadaContext,
  }), {
    orderId: "ORDER-1",
    carrierCode: "FM49",
    trackingNumber: "",
    providerContext: lazadaContext,
  });
});

test("shipment drafts fail closed for incomplete marketplace-specific data", () => {
  assert.throws(() => buildShipmentArguments({
    channel: "coupang",
    externalOrderId: "not-a-shipment-box-id",
    carrierCode: "CJGLS",
    trackingNumber: "111222333444",
  }), /SHIPMENT_FIELD_INVALID:shipmentBoxId/);
  assert.throws(() => buildShipmentArguments({
    channel: "lazada",
    externalOrderId: "ORDER-1",
    carrierCode: "LEX",
    trackingNumber: "111222333444",
  }), /SHIPMENT_PACKAGE_DETAILS_REQUIRED:lazada/);
  assert.throws(() => buildShipmentArguments({
    channel: "elevenst",
    externalOrderId: "ORDER-1",
    carrierCode: "CJGLS",
    trackingNumber: "111222333444",
  }), /SHIPMENT_CHANNEL_UNAVAILABLE:elevenst/);
});

test("Qoo10 product creation uses SetNewGoods v1.1 and records GdNo", async () => {
  const originalFetch = globalThis.fetch;
  let createUrl = "";
  let createInit: RequestInit | undefined;
  let detailUrl = "";
  let detailInit: RequestInit | undefined;
  let fetchCount = 0;
  globalThis.fetch = async (input, init) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      createUrl = String(input);
      createInit = init;
    }
    if (fetchCount === 2) {
      detailUrl = String(input);
      detailInit = init;
      return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    }
    if (fetchCount > 2) {
      return new Response(JSON.stringify({
        ResultCode: 0,
        ResultObject: { ItemDetail: '<div><img src="1.jpg"><img src="2.jpg"><img src="3.jpg"><img src="4.jpg"></div>' },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ ResultCode: 0, ResultMsg: "SUCCESS", ResultObject: { GdNo: "1234567890" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload: { api_key: "test-key" },
      arguments: { params: { SecondSubCat: "320002604", ItemTitle: "Test", StandardImage: "https://example.test/item.jpg", ItemDescription: '<p>Test</p><img src="1.jpg"><img src="2.jpg"><img src="3.jpg"><img src="4.jpg">', RetailPrice: "0", ItemPrice: "2500", ItemQty: "1", ExpireDate: "2027-12-31", ShippingNo: "0", AvailableDateType: "0", AvailableDateValue: "3", AudultYN: "N" } },
      environment: "production",
    });
    const url = new URL(createUrl);
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "1234567890");
    assert.equal(url.pathname.endsWith("/ItemsBasic.SetNewGoods"), true);
    assert.equal(createInit?.method, "POST");
    assert.equal(new Headers(createInit?.headers).get("QAPIVersion"), "1.1");
    assert.equal(new Headers(createInit?.headers).get("GiosisCertificationKey"), "test-key");
    const body = JSON.parse(String(createInit?.body)) as Record<string, string>;
    assert.equal((body.ItemDescription?.match(/<img /g) ?? []).length, 4);
    const detailRequestUrl = new URL(detailUrl);
    assert.equal(detailRequestUrl.pathname.endsWith("/ItemsContents.EditGoodsContents"), true);
    assert.equal(detailInit?.method, "POST");
    assert.equal(new Headers(detailInit?.headers).get("QAPIVersion"), "1.0");
    const detailBody = JSON.parse(String(detailInit?.body)) as Record<string, string>;
    assert.equal(detailBody.ItemCode, "1234567890");
    assert.equal((detailBody.Contents?.match(/<img /g) ?? []).length, 4);
    assert.equal(result.steps.at(-2)?.name, "EditGoodsContents");
    assert.equal(result.steps.at(-2)?.ok, true);
    assert.equal(result.steps.at(-1)?.name, "detail-image-readback");
    assert.equal(result.steps.at(-1)?.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 pauses a created item when detail-image readback is incomplete", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; body: string; status: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    calls.push({ method, body: String(init?.body ?? ""), status: body.Status ?? null });
    if (method === "ItemsBasic.SetNewGoods") {
      return Response.json({ ResultCode: 0, ResultObject: { GdNo: "1234567890" } });
    }
    if (method === "ItemsContents.EditGoodsContents") {
      return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    }
    if (method === "ItemsBasic.EditGoodsStatus") {
      return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    }
    return Response.json({ ResultCode: 0, ResultObject: { ItemDetail: "<p>description only</p>" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload: { api_key: "test-key" },
      arguments: { params: { SecondSubCat: "320002604", ItemTitle: "Test", StandardImage: "https://example.test/item.jpg", ItemDescription: '<img src="1"><img src="2"><img src="3"><img src="4">', RetailPrice: "0", ItemPrice: "2500", ItemQty: "1", ExpireDate: "2027-12-31", ShippingNo: "0", AvailableDateType: "0", AvailableDateValue: "3", AudultYN: "N" } },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.remoteId, "1234567890");
    assert.equal(calls.some((item) => item.method === "ItemsContents.EditGoodsContents"), true);
    assert.equal(result.steps.find((item) => item.name === "detail-image-readback")?.ok, false);
    assert.equal(calls.at(-1)?.method, "ItemsBasic.EditGoodsStatus");
    assert.equal(calls.at(-1)?.status, "1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 draft helpers keep internal catalog codes numeric and use a one-year sale period", () => {
  assert.equal(qoo10CatalogCode("1234567890"), "1234567890");
  assert.equal(qoo10CatalogCode("No Brand"), "");
  assert.equal(qoo10CatalogCode("12345678901"), "");
  assert.equal(qoo10ExpiryDate(new Date("2026-08-17T12:00:00.000Z")), "2027-08-17");
  assert.equal(qoo10SellerCode("PROGRAM-20260818-003"), "PROGRAM-20260818-003");
  assert.equal(qoo10SellerCode("PROGRAM-20260818-003", "1216221951"), "PROGRAM-20260-R21951");
  assert.ok(qoo10SellerCode("PROGRAM-20260818-003", "1216221951").length <= 20);
  assert.deepEqual(qoo10PauseParams("1216221951"), { ItemCode: "1216221951", Status: "1" });
  assert.throws(() => qoo10PauseParams("invalid"), /QOO10_ITEM_CODE_INVALID/);
  assert.equal(qoo10ProductionPlace("대한민국"), "South Korea");
  assert.equal(qoo10ProductionPlace("Japan"), "Japan");
});

test("Qoo10 provider errors are useful without exposing remote URLs or tokens", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ResultCode: -9999,
    ResultMsg: "ManufactureNo is invalid https://private.example/item?token=secret-value",
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload: { api_key: "test-key" },
      arguments: { params: { SecondSubCat: "300000503", ItemTitle: "Test", StandardImage: "https://example.test/item.jpg", ItemDescription: "<p>Test</p>", RetailPrice: "0", ItemPrice: "2500", ItemQty: "1", ExpireDate: "2027-08-17", ShippingNo: "0", AvailableDateType: "0", AvailableDateValue: "3", AudultYN: "N" } },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.match(result.safeMessage, /ManufactureNo is invalid/);
    assert.doesNotMatch(result.safeMessage, /private\.example|secret-value/);
    assert.equal(qoo10ResultMessage({ ResultMsg: "  invalid   value  " }), "invalid value");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay consent URL separates sandbox and production and includes CSRF state", () => {
  const url = buildEbayConsentUrl({
    environment: "sandbox",
    clientId: "test-client",
    ruName: "test-runame",
    state: "sellerpilot-ebay-test-state",
  });
  assert.equal(url.origin, "https://auth.sandbox.ebay.com");
  assert.equal(url.searchParams.get("redirect_uri"), "test-runame");
  assert.equal(url.searchParams.get("state"), "sellerpilot-ebay-test-state");
  assert.match(url.searchParams.get("scope") ?? "", /sell\.inventory/);
});

test("eBay Sell requests override the runtime Accept-Language wildcard", async () => {
  const originalFetch = globalThis.fetch;
  let headers: HeadersInit | undefined;
  globalThis.fetch = async (_input, init) => {
    headers = init?.headers;
    return Response.json({ locations: [] });
  };
  try {
    await ebayRequest({
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      environment: "production",
      method: "GET",
      path: "/sell/inventory/v1/location",
    });
    const normalized = new Headers(headers);
    assert.equal(normalized.get("accept-language"), "en-US");
    assert.equal(normalized.get("content-language"), "en-US");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee authorization URL uses the current auth endpoint and preserves SellerPilot CSRF state", () => {
  const timestamp = 1_786_848_245;
  const path = "/api/v2/shop/auth_partner";
  const expected = createHmac("sha256", "partner-secret").update(`2031489${path}${timestamp}`).digest("hex");
  assert.equal(buildShopeeSignature({ partnerId: "2031489", partnerKey: "partner-secret", path, timestamp }), expected);
  const url = buildShopeeAuthorizationUrl({
    environment: "production",
    partnerId: "2031489",
    redirectUri: "https://sellerpilot-global.vercel.app/",
    state: "sellerpilot-shopee-test-state",
  });
  assert.equal(url.origin, "https://open.shopee.com");
  assert.equal(url.pathname, "/auth");
  assert.equal(url.searchParams.get("auth_type"), "seller");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://sellerpilot-global.vercel.app/");
  assert.equal(url.searchParams.get("state"), "sellerpilot-shopee-test-state");
});

test("Shopee MediaSpace partner signature excludes shop authorization dimensions", () => {
  const timestamp = 1_786_848_245;
  const expected = createHmac("sha256", "partner-secret")
    .update(`2031489/api/v2/media_space/upload_image${timestamp}`)
    .digest("hex");
  assert.equal(buildShopeeSignature({
    partnerId: "2031489",
    partnerKey: "partner-secret",
    path: "/api/v2/media_space/upload_image",
    timestamp,
  }), expected);
});

test("all eight active channels define every normalized capability", () => {
  assert.deepEqual(activeChannelKeys, ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]);
  const expectedCapabilities = Object.keys(channelCatalog.qoo10.capabilities).sort();
  for (const channel of activeChannelKeys) {
    assert.deepEqual(Object.keys(channelCatalog[channel].capabilities).sort(), expectedCapabilities);
    assert.ok(channelCatalog[channel].officialDocs.length > 0);
  }
  assert.equal(channelCatalog.temu.capabilities.listingCreate.mode, "api");
  assert.equal(channelCatalog.qoo10.capabilities.webhooks.mode, "unsupported");
  assert.equal(channelCatalog.elevenst.capabilities.orders.mode, "polling");
});

test("Shopee operation routing signs the shop request and uses v2 order detail", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ error: "", request_id: "request", response: { order_list: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "orders.get",
      payload: { partner_id: "2031489", partner_key: "partner-secret", shop_id: "123456", access_token: "access-token" },
      arguments: { orderSn: "260816ABC123" },
      environment: "production",
    });
    const url = new URL(calledUrl);
    assert.equal(result.ok, true);
    assert.equal(url.pathname, "/api/v2/order/get_order_detail");
    assert.equal(url.searchParams.get("order_sn_list"), "260816ABC123");
    assert.equal(url.searchParams.get("shop_id"), "123456");
    assert.match(url.searchParams.get("sign") ?? "", /^[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee main-account code exchange uses main_account_id and returns the authorized shop lists", async () => {
  const originalFetch = globalThis.fetch;
  let calledBody = "";
  globalThis.fetch = async (_input, init) => {
    calledBody = String(init?.body ?? "");
    return new Response(JSON.stringify({
      error: "",
      access_token: "main-access",
      refresh_token: "main-refresh",
      shop_id_list: [1001, 1002],
      merchant_id_list: [2001],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await exchangeShopeeOAuthToken({
      environment: "production",
      partnerId: "2031489",
      partnerKey: "partner-secret",
      code: "one-time-code",
      mainAccountId: "3001",
    });
    assert.equal(result.response.ok, true);
    assert.deepEqual(JSON.parse(calledBody), { code: "one-time-code", main_account_id: 3001, partner_id: 2031489 });
    assert.deepEqual(result.data.shop_id_list, [1001, 1002]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee operation token selection projects the requested authorized shop without exposing another shop token", async () => {
  const payload = {
    partner_id: "2031489",
    partner_key: "partner-secret",
    shop_id: "1001",
    merchant_id: "2001",
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
    shopee_targets: [
      { type: "shop", id: "1001", access_token: "shop-one-access", refresh_token: "shop-one-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
      { type: "shop", id: "1002", access_token: "shop-two-access", refresh_token: "shop-two-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
    ],
  };
  const selected = await ensureShopeeAccessToken(payload, "production", 10 * 60 * 1000, "1002");
  assert.equal(selected.refreshed, false);
  assert.equal(selected.payload.shop_id, "1002");
  assert.equal(selected.payload.merchant_id, undefined);
  assert.equal(selected.payload.access_token, "shop-two-access");
  assert.equal(selected.payload.refresh_token, "shop-two-refresh");
  await assert.rejects(ensureShopeeAccessToken(payload, "production", 10 * 60 * 1000, "9999"), /SHOPEE_SHOP_NOT_AUTHORIZED/);
});

test("Shopee merchant token and GlobalProduct category request use the merchant signature dimension", async () => {
  const payload = {
    partner_id: "2031489",
    partner_key: "partner-secret",
    shop_id: "1001",
    merchant_id: "2001",
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
    shopee_targets: [
      { type: "merchant", id: "2001", access_token: "merchant-access", refresh_token: "merchant-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
      { type: "shop", id: "1001", access_token: "shop-access", refresh_token: "shop-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
    ],
  };
  const selected = await ensureShopeeMerchantAccessToken(payload, "production", 10 * 60 * 1000, "2001");
  assert.equal(selected.payload.merchant_id, "2001");
  assert.equal(selected.payload.shop_id, undefined);
  assert.equal(selected.payload.access_token, "merchant-access");

  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ error: "", request_id: "request", response: { category_list: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "categories.list",
      payload: selected.payload,
      arguments: { globalProduct: true, query: { language: "en" } },
      environment: "production",
    });
    const url = new URL(calledUrl);
    assert.equal(result.ok, true);
    assert.equal(url.pathname, "/api/v2/global_product/get_category");
    assert.equal(url.searchParams.get("merchant_id"), "2001");
    assert.equal(url.searchParams.get("shop_id"), null);
    assert.equal(url.searchParams.get("access_token"), "merchant-access");
    assert.match(url.searchParams.get("sign") ?? "", /^[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada product create serializes the structured request as official XML and reads the item back", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    const creating = String(input).includes("/product/create");
    return new Response(JSON.stringify(creating
      ? { code: "0", request_id: "create-request", data: { item_id: 987654321 } }
      : { code: "0", request_id: "read-request", data: { item_id: 987654321, primary_category: 12345 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "listing.create",
      payload: { app_key: "app-key", app_secret: "app-secret", access_token: "access-token", country: "my" },
      arguments: {
        request: {
          Request: {
            Product: {
              PrimaryCategory: "12345",
              Images: { Image: ["https://example.com/cup-1.jpg", "https://example.com/cup-2.jpg"] },
              Attributes: { name: "White cup", description: "Cup & mug", "Units_(per_Bundle)": "" },
              Skus: { Sku: [{ SellerSku: "CUP-001", price: "12.90", quantity: "1", Status: "inactive", Images: { Image: ["https://example.com/cup-1.jpg"] } }] },
            },
          },
        },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.equal(calls.length, 2);
    const form = new URLSearchParams(calls[0].body);
    const xml = form.get("payload") ?? "";
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<Request><Product><PrimaryCategory>12345<\/PrimaryCategory>/);
    assert.match(xml, /<Images><Image>https:\/\/example\.com\/cup-1\.jpg<\/Image><Image>https:\/\/example\.com\/cup-2\.jpg<\/Image><\/Images>/);
    assert.match(xml, /<description>Cup &amp; mug<\/description>/);
    assert.doesNotMatch(xml, /Units_\(per_Bundle\)/);
    assert.match(xml, /<Skus><Sku><SellerSku>CUP-001<\/SellerSku>/);
    assert.match(xml, /<Status>inactive<\/Status><Images><Image>https:\/\/example\.com\/cup-1\.jpg<\/Image><\/Images>/);
    assert.match(calls[1].url, /\/product\/item\/get/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada request retries once after the provider frequency-limit window", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return Response.json({ code: "ApiCallLimit", message: "Api access frequency exceeds the limit. this ban will last 0 seconds" });
    }
    return Response.json({ code: "0", data: { orders: [] } });
  };
  try {
    const remote = await lazadaRequest({
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      path: "/orders/get",
      params: { created_after: "2026-08-23T00:00:00+09:00" },
    });
    assert.equal(calls.length, 2);
    assert.equal(remote.data.code, "0");
    assert.notEqual(new URL(calls[0]).searchParams.get("timestamp"), new URL(calls[1]).searchParams.get("timestamp"));
    assert.notEqual(new URL(calls[0]).searchParams.get("sign"), new URL(calls[1]).searchParams.get("sign"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada order sync enriches actionable orders with official order item details", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/order/items/get")) {
      return Response.json({
        code: "0",
        data: [{ order_id: "9001", order_item_id: "9101", name: "Lazada product", shipping_type: "Dropshipping" }],
      });
    }
    return Response.json({
      code: "0",
      data: {
        orders: [{ order_id: "9001", statuses: ["pending"], items_count: 1, price: "19.90", currency: "MYR", created_at: "2026-08-24T00:00:00Z" }],
      },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "orders.list",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: { queryParams: { created_after: "2026-08-23T00:00:00+09:00" } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps.map((item) => item.name), ["orders", "order-items:9001"]);
    assert.equal(new URL(calls[1]).searchParams.get("order_id"), "9001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada order sync also enriches ready-to-ship orders needed by fulfillment", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/order/items/get")) {
      return Response.json({ code: "0", data: [{ order_id: "9002", order_item_id: "9102", shipping_type: "Dropshipping" }] });
    }
    return Response.json({ code: "0", data: { orders: [{ order_id: "9002", statuses: ["ready_to_ship"] }] } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "orders.list",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: { queryParams: { created_after: "2026-08-23T00:00:00+09:00" } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(calls.some((url) => url.includes("/order/items/get")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada shipment confirmation uses Pack then ReadyToShip with the official JSON parameters", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; form: URLSearchParams }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const form = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, form });
    if (url.includes("/order/shipment/providers/get")) {
      return Response.json({
        code: "0",
        result: {
          success: "true",
          error_code: "0",
          data: { shipment_providers: [{ name: "LEX", provider_code: "FM49" }], shipping_allocate_type: "TFS" },
        },
      });
    }
    if (url.includes("/order/fulfill/pack")) {
      return Response.json({
        code: "0",
        result: { success: "true", error_code: "0", data: { packages: [{ package_id: "PK-100", tracking_number: "LEX-TRACK-100" }] } },
      });
    }
    if (url.includes("/order/package/rts")) {
      return Response.json({
        code: "0",
        result: { success: "true", error_code: "0", data: { packages: [{ package_id: "PK-100", retry: "false" }] } },
      });
    }
    throw new Error(`Unexpected Lazada URL: ${url}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "shipment.confirm",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: {
        orderId: "9001",
        carrierCode: "FM49",
        trackingNumber: "IGNORED-BY-LAZADA",
        providerContext: { orderId: "9001", orderItemIds: ["9101"], deliveryType: "dropship" },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "LEX-TRACK-100");
    assert.deepEqual(result.steps.map((item) => item.name), ["shipment-providers", "pack", "ready-to-ship"]);
    assert.equal(calls[0].form.has("payload"), false);
    assert.deepEqual(JSON.parse(calls[0].form.get("getShipmentProvidersReq") ?? "{}"), {
      orders: [{ order_id: "9001", order_item_ids: ["9101"] }],
    });
    assert.equal(calls[1].form.has("payload"), false);
    assert.deepEqual(JSON.parse(calls[1].form.get("packReq") ?? "{}"), {
      pack_order_list: [{ order_id: "9001", order_item_list: ["9101"] }],
      delivery_type: "dropship",
      shipment_provider_code: "FM49",
      shipping_allocate_type: "TFS",
    });
    assert.deepEqual(JSON.parse(calls[2].form.get("readyToShipReq") ?? "{}"), {
      packages: [{ package_id: "PK-100" }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada inventory update uses SkuId and verifies the resulting quantity", async () => {
  const originalFetch = globalThis.fetch;
  let updatePayload = "";
  let readbacks = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/product/item/get")) {
      readbacks += 1;
      return Response.json({
        code: "0",
        data: { item: { Skus: { Sku: [{ SkuId: "987654", SellerSku: "LEGACY-SKU", Quantity: readbacks > 1 ? 1 : 4 }] } } },
      });
    }
    if (url.includes("/product/price_quantity/update")) {
      updatePayload = new URLSearchParams(String(init?.body)).get("payload") ?? "";
      return Response.json({ code: "0", data: {} });
    }
    throw new Error(`Unexpected Lazada URL: ${url}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "inventory.update",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: { itemId: "123456", quantity: 1 },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(updatePayload, /<SkuId>987654<\/SkuId>/);
    assert.doesNotMatch(updatePayload, /<SellerSku>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada category suggestion forwards the mandatory product image URL", async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls: string[] = [];
  globalThis.fetch = async (input) => {
    calledUrls.push(String(input));
    return new Response(JSON.stringify({ code: "0", request_id: "category-request", data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "categories.suggest",
      payload: { app_key: "app-key", app_secret: "app-secret", access_token: "access-token", country: "my" },
      arguments: {
        query: "Moisturizing cream",
        queryParams: { language_code: "en_US", image_url: "https://example.com/cream.jpg" },
      },
      environment: "production",
    });
    const suggestionUrl = new URL(calledUrls.find((url) => url.includes("/product/category/suggestion/get")) ?? "");
    const treeUrl = new URL(calledUrls.find((url) => url.includes("/category/tree/get")) ?? "");
    assert.equal(result.ok, true);
    assert.equal(suggestionUrl.pathname, "/rest/product/category/suggestion/get");
    assert.equal(suggestionUrl.searchParams.get("product_name"), "Moisturizing cream");
    assert.equal(suggestionUrl.searchParams.get("image_url"), "https://example.com/cream.jpg");
    assert.equal(treeUrl.pathname, "/rest/category/tree/get");
    assert.equal(treeUrl.searchParams.get("language_code"), "en_US");
    assert.equal(treeUrl.searchParams.get("image_url"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang operation routing uses the documented item price endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ code: "SUCCESS", message: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "price.update",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: { vendorItemId: "3572784698", price: 49_000, forceSalePriceUpdate: false },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(calls[0].url, /vendor-items\/3572784698\/prices\/49000\?forceSalePriceUpdate=false$/);
    assert.match(String(new Headers(calls[0].init?.headers).get("authorization")), /^CEA algorithm=HmacSHA256/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang category recommendation sends the official product context payload", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ code: 200, data: { autoCategorizationPredictionResultType: "SUCCESS", predictedCategoryId: "63955", predictedCategoryName: "분말형" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "categories.suggest",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: { query: "유한젠 가루세제 1kg", body: { productDescription: "분말형 살균 표백제", brand: "유한양행" } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(new URL(calledUrl).pathname, "/v2/providers/openapi/apis/api/v1/categorization/predict");
    assert.deepEqual(JSON.parse(calledBody), { productDescription: "분말형 살균 표백제", brand: "유한양행", productName: "유한젠 가루세제 1kg" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang category list uses the required root or parent category path segment", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ code: "SUCCESS", data: { displayItemCategoryCode: 0, child: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const input = {
      channel: "coupang" as const,
      operation: "categories.list" as const,
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      environment: "production" as const,
    };
    assert.equal((await executeChannelOperation({ ...input, arguments: {} })).ok, true);
    assert.equal((await executeChannelOperation({ ...input, arguments: { categoryId: "77834" } })).ok, true);
    assert.equal(new URL(calls[0]).pathname, "/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/0");
    assert.equal(new URL(calls[1]).pathname, "/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/77834");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang product creation is only successful after seller-product readback matches", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ code: "SUCCESS", data: 987654321 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ code: "SUCCESS", data: { sellerProductId: 987654321, requested: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.create",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret", requested_by: "wing-user" },
      arguments: { body: { sellerProductName: "[API TEST]", vendorUserId: "wing-user", requested: true, items: [{}] } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.deepEqual(result.steps.map((item) => item.name), ["listing.create", "listing-readback"]);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1].url).pathname, "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/987654321");
    assert.equal(calls[1].init?.method, "GET");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang listing resume waits for SAVED before requesting approval without creating a duplicate", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let readbackCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/approvals") && init?.method === "PUT") {
      return new Response(JSON.stringify({ code: "SUCCESS", data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (init?.method === "POST") throw new Error("resume must not create another seller product");
    readbackCount += 1;
    const data = readbackCount === 1
      ? { sellerProductId: 987654321, requested: false, mdId: "NLUP_ID_GEN" }
      : readbackCount === 2
        ? { sellerProductId: 987654321, requested: false, mdId: "NLUP_TEMP_SAVED" }
        : { sellerProductId: 987654321, requested: true, mdId: "NLUP_APPROVAL_REQUESTED" };
    return new Response(JSON.stringify({ code: "SUCCESS", data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.create",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret", requested_by: "wing-user" },
      arguments: {
        resumeRemoteId: "987654321",
        body: { sellerProductName: "[API TEST]", vendorUserId: "wing-user", requested: true, items: [{}] },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.deepEqual(result.steps.map((item) => item.name), ["listing.resume", "listing-readback", "listing-approval-request", "listing-approval-readback"]);
    assert.equal(calls.some((call) => call.init?.method === "POST"), false);
    const approvalIndex = calls.findIndex((call) => call.url.endsWith("/approvals"));
    assert.equal(approvalIndex, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang product update reuses the requested seller product ID and verifies approval state", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let readbackCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/approvals") && init?.method === "PUT") {
      return new Response(JSON.stringify({ code: "ERROR", message: "already requested" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (init?.method === "PUT") {
      return new Response(JSON.stringify({ code: "SUCCESS", data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    readbackCount += 1;
    return new Response(JSON.stringify({
      code: "SUCCESS",
      data: readbackCount === 1
        ? { sellerProductId: 987654321, requested: false, mdId: "NLUP_TEMP_SAVED" }
        : { sellerProductId: 987654321, requested: true, mdId: "NLUP_APPROVAL_REQUESTED" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.update",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret", requested_by: "wing-user" },
      arguments: { body: { sellerProductId: 987654321, sellerProductName: "[API TEST]", vendorUserId: "wing-user", requested: true, items: [{}] } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.deepEqual(result.steps.map((item) => item.name), ["listing.update", "listing-readback", "listing-approval-request", "listing-approval-readback"]);
    assert.equal(calls[0].init?.method, "PUT");
    assert.equal(new URL(calls[1].url).pathname, "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/987654321");
    assert.equal(new URL(calls[2].url).pathname, "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/987654321/approvals");
    assert.equal(calls[2].init?.method, "PUT");
    assert.equal(calls[3].init?.method, "GET");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver order detail routing exchanges a token and uses the official batch query", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "naver-token", expires_in: 10_800 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ traceId: "trace", data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "orders.get",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: { productOrderId: "2022040521691281" },
      environment: "production",
    });
    assert.equal(result.ok, true);
    const tokenBody = new URLSearchParams(String(calls[0].init?.body));
    assert.equal(tokenBody.get("type"), "SELLER");
    assert.equal(tokenBody.get("account_id"), "seller-uid");
    assert.equal(calls[1].url, "https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/query");
    assert.equal(calls[1].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
      productOrderIds: ["2022040521691281"],
      quantityClaimCompatibility: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver seller request refreshes once after GW.AUTHN", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let tokenCount = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/oauth2/token")) {
      tokenCount += 1;
      return new Response(JSON.stringify({ access_token: `naver-token-${tokenCount}`, expires_in: 10_800 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (calls.filter((item) => item.includes("/v1/categories/")).length === 1) {
      return new Response(JSON.stringify({ code: "GW.AUTHN", message: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "50000000", name: "패션의류" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "categories.list",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: { categoryId: "50000000" },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(tokenCount, 2);
    assert.equal(calls.filter((item) => item.includes("/v1/categories/50000000")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver category preflight loads the category, attributes, values, and standard options", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "naver-token", expires_in: 10_800 }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/v1/categories/50000805")) return new Response(JSON.stringify({ id: "50000805", name: "건강기능식품", last: true }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "categories.attributes",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: { categoryId: "50000805" },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.steps.length, 4);
    assert.equal(calls.some((url) => url.includes("/v1/product-attributes/attributes?categoryId=50000805")), true);
    assert.equal(calls.some((url) => url.includes("/v1/product-attributes/attribute-values?categoryId=50000805")), true);
    assert.equal(calls.some((url) => url.includes("/v1/options/standard-options?categoryId=50000805")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver category preflight accepts an official NOT_FOUND response as empty optional metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "naver-token", expires_in: 10_800 }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/v1/categories/50001330")) return new Response(JSON.stringify({ id: "50001330", name: "소품수납함", last: true }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/v1/options/standard-options")) return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ code: "NOT_FOUND", message: "데이터를 찾을 수 없습니다." }), { status: 404, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "categories.attributes",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: { categoryId: "50001330" },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps.map((item) => [item.name, item.ok, item.status]), [
      ["category", true, 200],
      ["attributes", true, 404],
      ["attribute-values", true, 404],
      ["standard-options", true, 200],
    ]);
    assert.deepEqual(result.steps[1].data, { items: [] });
    assert.deepEqual(result.steps[2].data, { items: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver product creation is only successful after the origin product readback succeeds", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "naver-token", expires_in: 10_800 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/v2/products") && init?.method === "POST") {
      return new Response(JSON.stringify({ originProductNo: 10000001, smartstoreChannelProductNo: 20000001 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ originProduct: { statusType: "SALE" } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: { body: { originProduct: { name: "API test" }, smartstoreChannelProduct: {} } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "10000001");
    assert.deepEqual(result.steps.map((item) => item.name), ["product-create", "product-readback"]);
    assert.equal(calls.some((call) => call.url.endsWith("/v2/products/origin-products/10000001") && call.init?.method === "GET"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver product creation reconciles an existing seller management code without creating a duplicate", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "naver-token", expires_in: 10_800 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/v1/products/search") && init?.method === "POST") {
      return new Response(JSON.stringify({ contents: [{ originProductNo: 10000001, channelProducts: [{ sellerManagementCode: "SELLERPILOT-001", channelProductNo: 20000001 }] }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/v2/products/origin-products/10000001") && init?.method === "PUT") {
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/v2/products/origin-products/10000001") && init?.method === "GET") {
      return new Response(JSON.stringify({ originProduct: { statusType: "SALE" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ code: "UNEXPECTED" }), { status: 500, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: {
        body: {
          originProduct: { detailAttribute: { sellerCodeInfo: { sellerManagementCode: "SELLERPILOT-001" } } },
          smartstoreChannelProduct: {},
        },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "10000001");
    assert.deepEqual(result.steps.map((item) => item.name), ["product-reconcile", "product-update", "product-readback"]);
    assert.equal(calls.some((call) => call.url.endsWith("/v2/products") && call.init?.method === "POST"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay listing workflow creates inventory, creates an offer, then publishes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  const imageUrls = [
    "https://cdn.example.com/hero.jpg",
    "https://cdn.example.com/detail-1.jpg",
    "https://cdn.example.com/detail-2.jpg",
    "https://cdn.example.com/detail-3.jpg",
    "https://cdn.example.com/detail-4.jpg",
  ];
  const listingDescription = imageUrls.slice(1).map((url) => `<img src="${url}" />`).join("");
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/inventory_item/") && method === "GET") return Response.json({ product: { imageUrls } });
    if (url.endsWith("/offer") && method === "POST") return new Response(JSON.stringify({ offerId: "36445435465" }), { status: 201, headers: { "content-type": "application/json" } });
    if (url.endsWith("/offer/36445435465") && method === "GET") return Response.json({ listingDescription });
    if (url.endsWith("/publish")) return new Response(JSON.stringify({ listingId: "110000000001" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(null, { status: 204 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: {
        sku: "SELLERPILOT-001",
        inventoryItem: { availability: { shipToLocationAvailability: { quantity: 1 } }, condition: "NEW", product: { title: "Test", imageUrls } },
        offer: {
          sku: "SELLERPILOT-001",
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          listingDescription,
          listingPolicies: { fulfillmentPolicyId: "fulfillment-1", paymentPolicyId: "payment-1", returnPolicyId: "return-1" },
          merchantLocationKey: "seoul-warehouse",
        },
        publish: true,
      },
      environment: "sandbox",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "110000000001");
    assert.deepEqual(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`), [
      "PUT /sell/inventory/v1/inventory_item/SELLERPILOT-001",
      "GET /sell/inventory/v1/inventory_item/SELLERPILOT-001",
      "POST /sell/inventory/v1/offer",
      "GET /sell/inventory/v1/offer/36445435465",
      "POST /sell/inventory/v1/offer/36445435465/publish",
    ]);
    assert.deepEqual(result.steps.map((item) => item.name), ["inventory-item", "inventory-image-readback", "offer", "offer-detail-image-readback", "publish"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay listing auto-selects non-vehicle policies and an enabled inventory location", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, body });
    if (url.includes("/fulfillment_policy")) return Response.json({ fulfillmentPolicies: [{ fulfillmentPolicyId: "fulfillment-auto", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }] }] });
    if (url.includes("/payment_policy")) return Response.json({ paymentPolicies: [{ paymentPolicyId: "payment-auto", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }] }] });
    if (url.includes("/return_policy")) return Response.json({ returnPolicies: [{ returnPolicyId: "return-auto", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }] }] });
    if (url.includes("/location?")) return Response.json({ locations: [{ merchantLocationKey: "warehouse-auto", location: { merchantLocationStatus: "ENABLED" } }] });
    if (url.includes("/inventory_item/") && init?.method === "GET") return Response.json({ product: { imageUrls: ["https://cdn.example.com/item.jpg"] } });
    if (url.endsWith("/offer") && init?.method === "POST") return Response.json({ offerId: "offer-auto" }, { status: 201 });
    if (url.endsWith("/offer/offer-auto") && init?.method === "GET") return Response.json({ offerId: "offer-auto" });
    return new Response(null, { status: 204 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: {
        sku: "SELLERPILOT-AUTO",
        inventoryItem: { product: { title: "Test", imageUrls: ["https://cdn.example.com/item.jpg"] } },
        offer: {
          sku: "SELLERPILOT-AUTO",
          marketplaceId: "EBAY_US",
          listingPolicies: { fulfillmentPolicyId: "SERVER_MANAGED", paymentPolicyId: "SERVER_MANAGED", returnPolicyId: "SERVER_MANAGED" },
          merchantLocationKey: "SERVER_MANAGED",
        },
        publish: false,
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    const offerCall = calls.find((call) => call.url.endsWith("/offer"));
    assert.deepEqual(offerCall?.body?.listingPolicies, {
      fulfillmentPolicyId: "fulfillment-auto",
      paymentPolicyId: "payment-auto",
      returnPolicyId: "return-auto",
    });
    assert.equal(offerCall?.body?.merchantLocationKey, "warehouse-auto");
    assert.deepEqual(result.steps.map((item) => item.name), ["fulfillment-policies", "payment-policies", "return-policies", "inventory-locations", "inventory-item", "inventory-image-readback", "offer", "offer-readback"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay listing provisions and verifies a reusable inventory location when the account has none", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (url.includes("/fulfillment_policy")) return Response.json({ fulfillmentPolicies: [{ fulfillmentPolicyId: "f-1", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }] }] });
    if (url.includes("/payment_policy")) return Response.json({ paymentPolicies: [{ paymentPolicyId: "p-1", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }] }] });
    if (url.includes("/return_policy")) return Response.json({ returnPolicies: [{ returnPolicyId: "r-1", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }] }] });
    if (url.includes("/location?") && method === "GET") return Response.json({ locations: [] });
    if (url.endsWith("/location/sellerpilot-seoul") && method === "POST") return new Response(null, { status: 204 });
    if (url.endsWith("/location/sellerpilot-seoul") && method === "GET") return Response.json({ merchantLocationKey: "sellerpilot-seoul", merchantLocationStatus: "ENABLED" });
    if (url.includes("/inventory_item/") && method === "GET") return Response.json({ product: { imageUrls: ["https://cdn.example.com/item.jpg"] } });
    if (url.endsWith("/offer") && method === "POST") return Response.json({ offerId: "offer-new-location" }, { status: 201 });
    if (url.endsWith("/offer/offer-new-location") && method === "GET") return Response.json({ offerId: "offer-new-location" });
    return new Response(null, { status: 204 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: {
        sku: "SELLERPILOT-LOCATION",
        inventoryItem: { product: { title: "Test", imageUrls: ["https://cdn.example.com/item.jpg"] } },
        offer: {
          sku: "SELLERPILOT-LOCATION",
          marketplaceId: "EBAY_US",
          listingPolicies: { fulfillmentPolicyId: "SERVER_MANAGED", paymentPolicyId: "SERVER_MANAGED", returnPolicyId: "SERVER_MANAGED" },
          merchantLocationKey: "SERVER_MANAGED",
        },
        publish: false,
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(calls.find((call) => call.url.endsWith("/location/sellerpilot-seoul") && call.method === "POST")?.body?.merchantLocationStatus, "ENABLED");
    assert.equal(calls.find((call) => call.url.endsWith("/offer"))?.body?.merchantLocationKey, "sellerpilot-seoul");
    assert.equal(result.steps.some((item) => item.name === "inventory-location-readback" && item.ok), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider listing errors expose a sanitized actionable message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: "invalid_attribute",
    message: "Missing attribute shade https://private.example/item?token=secret-value",
  }, { status: 400 });
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "listing.create",
      payload: { partner_id: "1", partner_key: "secret", shop_id: "2", access_token: "token" },
      arguments: { body: {} },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.match(result.safeMessage, /invalid_attribute|Missing attribute shade/);
    assert.doesNotMatch(result.safeMessage, /private\.example|secret-value/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay listing retry reconciles an existing SKU offer and returns its published listing", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  const imageUrls = [
    "https://cdn.example.com/hero.jpg",
    "https://cdn.example.com/detail-1.jpg",
    "https://cdn.example.com/detail-2.jpg",
    "https://cdn.example.com/detail-3.jpg",
    "https://cdn.example.com/detail-4.jpg",
  ];
  const listingDescription = imageUrls.slice(1).map((url) => `<img src="${url}" />`).join("");
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/inventory_item/") && method === "GET") return Response.json({ product: { imageUrls } });
    if (url.endsWith("/offer") && method === "POST") {
      return Response.json({ errors: [{ errorId: 25002, message: "Offer already exists" }] }, { status: 409 });
    }
    if (url.includes("/offer?sku=") && method === "GET") {
      return Response.json({ offers: [{ offerId: "existing-offer", marketplaceId: "EBAY_US", format: "FIXED_PRICE", status: "PUBLISHED" }] });
    }
    if (url.endsWith("/offer/existing-offer") && method === "GET") {
      return Response.json({
        offerId: "existing-offer",
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        status: "PUBLISHED",
        listing: { listingId: "110000000777" },
        listingDescription,
      });
    }
    return new Response(null, { status: 204 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: {
        sku: "SELLERPILOT-RETRY",
        inventoryItem: { product: { title: "Retry", imageUrls } },
        offer: {
          sku: "SELLERPILOT-RETRY",
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          listingDescription,
          listingPolicies: { fulfillmentPolicyId: "fulfillment-1", paymentPolicyId: "payment-1", returnPolicyId: "return-1" },
          merchantLocationKey: "seoul-warehouse",
        },
        publish: true,
      },
      environment: "production",
    });

    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "110000000777");
    assert.deepEqual(result.steps.map((item) => item.name), [
      "inventory-item",
      "inventory-image-readback",
      "offer-reconcile",
      "offer-update-after-reconcile",
      "offer-detail-image-readback",
    ]);
    assert.equal(result.steps[2].data.sellerpilotVerification, "EXISTING_OFFER_RECOVERED");
    assert.equal(calls.some((call) => call.url.endsWith("/publish")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay stops before offer creation when the inventory image readback loses detail images", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/inventory_item/") && method === "GET") {
      return Response.json({ product: { imageUrls: ["https://cdn.example.com/hero.jpg"] } });
    }
    return new Response(null, { status: 204 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: {
        sku: "SELLERPILOT-IMAGE-FAIL",
        inventoryItem: {
          product: {
            title: "Image readback test",
            imageUrls: [
              "https://cdn.example.com/hero.jpg",
              "https://cdn.example.com/detail-1.jpg",
              "https://cdn.example.com/detail-2.jpg",
              "https://cdn.example.com/detail-3.jpg",
              "https://cdn.example.com/detail-4.jpg",
            ],
          },
        },
        offer: {
          sku: "SELLERPILOT-IMAGE-FAIL",
          marketplaceId: "EBAY_US",
          listingPolicies: { fulfillmentPolicyId: "fulfillment-1", paymentPolicyId: "payment-1", returnPolicyId: "return-1" },
          merchantLocationKey: "seoul-warehouse",
        },
        publish: true,
      },
      environment: "production",
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.steps.map((item) => item.name), ["inventory-item", "inventory-image-readback"]);
    assert.equal(result.steps[1].data.expectedImageCount, 5);
    assert.equal(result.steps[1].data.actualImageCount, 1);
    assert.equal(calls.some((call) => call.url.endsWith("/offer")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu signs compact request values in ASCII key order", () => {
  const request = { type: "temu.local.goods.v3.add", timestamp: 1_786_848_245, app_key: "app-key", data_type: "JSON", goodsBasic: { goodsName: "테스트" } };
  const ordered = `app_keyapp-keydata_typeJSONgoodsBasic${JSON.stringify(request.goodsBasic)}timestamp${request.timestamp}typetemu.local.goods.v3.add`;
  const expected = createHash("md5").update(`app-secret${ordered}app-secret`, "utf8").digest("hex").toUpperCase();
  assert.equal(buildTemuSignature("app-secret", request), expected);
});

test("Temu order and after-sales operations paginate provider result arrays", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "bg.order.list.v2.get") {
      const count = Number(body.pageNumber) === 1 ? 100 : 1;
      return Response.json({ success: true, result: { pageItems: Array.from({ length: count }, (_, index) => ({ parentOrderMap: { parentOrderSn: `P-${body.pageNumber}-${index}` }, orderList: [] })) } });
    }
    return Response.json({ success: true, result: { data: [{ parentAfterSalesSn: "AS-1", parentOrderSn: "P-1", afterSalesStatusGroup: 1 }] } });
  };
  try {
    const orders = await executeChannelOperation({
      channel: "temu",
      operation: "orders.list",
      payload: { app_key: "app-key", app_secret: "app-secret", access_token: "seller-token" },
      arguments: { pageNumber: 1, pageSize: 100, updateAtStart: 1, updateAtEnd: 2, sortby: "updateTime" },
      environment: "production",
    });
    const inquiries = await executeChannelOperation({
      channel: "temu",
      operation: "inquiries.list",
      payload: { app_key: "app-key", app_secret: "app-secret", access_token: "seller-token" },
      arguments: { pageNo: 1, pageSize: 200, updateAtStart: 1, updateAtEnd: 2 },
      environment: "production",
    });
    assert.equal(orders.ok, true);
    assert.deepEqual(orders.steps.map((item) => item.name), ["orders", "orders:2"]);
    assert.equal(inquiries.ok, true);
    assert.deepEqual(inquiries.steps.map((item) => item.name), ["inquiries"]);
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.order.list.v2.get",
      "bg.order.list.v2.get",
      "bg.aftersales.parentaftersales.list.get",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu shipment confirmation resolves warehouse and carrier then verifies tracking readback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  let shipmentReads = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "bg.logistics.shipment.v2.get") {
      shipmentReads += 1;
      return Response.json({ success: true, result: { shipmentInfoDTO: shipmentReads === 1 ? [] : [{ trackingNumber: "111222333444" }] } });
    }
    if (body.type === "bg.logistics.warehouse.list.get") {
      return Response.json({ success: true, result: { warehouseList: [{ warehouseId: 3001, regionId1: 211, defaultWarehouse: true }] } });
    }
    if (body.type === "bg.logistics.companies.get") {
      return Response.json({ success: true, result: [{ logisticsServiceProviderId: 88, logisticsServiceProviderName: "CJ대한통운", logisticsBrandName: "CJ Logistics" }] });
    }
    return Response.json({ success: true, result: { accepted: true } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "shipment.confirm",
      payload: { app_key: "app-key", app_secret: "app-secret", access_token: "seller-token" },
      arguments: {
        parentOrderSn: "PO-100",
        carrierCode: "CJGLS",
        trackingNumber: "111222333444",
        providerContext: {
          parentOrderSn: "PO-100",
          regionId: "211",
          inventoryDeductionWarehouseId: "3001",
          orderItems: [{ parentOrderSn: "PO-100", orderSn: "O-101", goodsId: "G-1", skuId: "S-1", quantity: 1 }],
        },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.logistics.shipment.v2.get",
      "bg.logistics.warehouse.list.get",
      "bg.logistics.companies.get",
      "bg.logistics.shipment.v2.confirm",
      "bg.logistics.shipment.v2.get",
    ]);
    assert.deepEqual(calls[3].sendRequestList, [{
      carrierId: 88,
      trackingNumber: "111222333444",
      selfShippingWarehouseId: 3001,
      orderSendInfoList: [{ parentOrderSn: "PO-100", orderSn: "O-101", goodsId: "G-1", skuId: "S-1", quantity: 1 }],
    }]);
    assert.equal(result.steps.at(-1)?.data.sellerpilotVerification, "TRACKING_NUMBER_VERIFIED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu V3 product creation requires an external-id readback match", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "temu.local.goods.v3.add") {
      return new Response(JSON.stringify({ success: true, result: { goodsId: 900001, externalGoodsId: "TEST-TEMU-001" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (body.type === "temu.local.goods.list.retrieve") {
      return new Response(JSON.stringify({ success: true, result: { goodsList: [{ goodsId: 900001, outGoodsSn: "TEST-TEMU-001", status: 1 }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (body.type === "bg.local.goods.publish.status.get") {
      return new Response(JSON.stringify({ success: true, result: { goodsPublishStatusList: [{ goodsId: 900001, status: 1, subStatus: 2 }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ success: true, result: { goodsId: 900001, goodsGallery: { goodsCarouselImage: ["https://cdn.example.com/hero.jpg"], detailImage: ["https://cdn.example.com/detail.jpg"] } } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app-key", app_secret: "app-secret", access_token: "seller-token" },
      arguments: { body: { goodsBasic: { externalGoodsId: "TEST-TEMU-001", goodsName: "API test", goodsCarouselImage: ["https://cdn.example.com/hero.jpg"], detailImage: ["https://cdn.example.com/detail.jpg"] }, skuList: [{ externalSkuId: "TEST-TEMU-001" }] } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "900001");
    assert.deepEqual(calls.map((call) => call.type), [
      "temu.local.goods.v3.add",
      "temu.local.goods.list.retrieve",
      "bg.local.goods.publish.status.get",
      "bg.local.goods.detail.query",
    ]);
    assert.deepEqual(calls[1].outGoodsSnList, ["TEST-TEMU-001"]);
    assert.deepEqual(calls[2].goodsIdList, [900001]);
    assert.equal(calls[3].versionQueryType, 1);
    assert.equal(result.steps[2].data.sellerpilotVerification, "PUBLISH_STATUS_VERIFIED");
    assert.equal(result.steps[3].data.sellerpilotVerification, "IMAGES_VERIFIED");
    assert.equal(result.steps[3].data.actualCarouselImageCount, 1);
    assert.equal(result.steps[3].data.actualDetailImageCount, 1);
    assert.equal("app_secret" in calls[0], false);
    assert.match(String(calls[0].sign), /^[0-9A-F]{32}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu listing retry reconciles an existing external ID and still verifies images", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "temu.local.goods.v3.add") {
      return new Response(JSON.stringify({ success: false, errorCode: 150010041, errorMsg: "externalGoodsId already exists" }), { status: 409, headers: { "content-type": "application/json" } });
    }
    if (body.type === "temu.local.goods.list.retrieve") {
      return Response.json({ success: true, result: { goodsList: [{ goodsId: 900002, outGoodsSn: "TEST-TEMU-RETRY" }] } });
    }
    if (body.type === "bg.local.goods.publish.status.get") {
      return Response.json({ success: true, result: { goodsPublishStatusList: [{ goodsId: 900002, status: 1, subStatus: 1 }] } });
    }
    return Response.json({ success: true, result: { goodsId: 900002, goodsGallery: { goodsCarouselImage: ["https://cdn.example.com/hero.jpg"], detailImage: ["https://cdn.example.com/detail.jpg"] } } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app-key", app_secret: "app-secret", access_token: "seller-token" },
      arguments: {
        body: {
          goodsBasic: {
            externalGoodsId: "TEST-TEMU-RETRY",
            goodsName: "Retry test",
            goodsCarouselImage: ["https://cdn.example.com/hero.jpg"],
            detailImage: ["https://cdn.example.com/detail.jpg"],
          },
          skuList: [{ externalSkuId: "TEST-TEMU-RETRY" }],
        },
      },
      environment: "production",
    });

    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "900002");
    assert.deepEqual(result.steps.map((item) => item.name), [
      "goods-reconcile",
      "goods-readback",
      "goods-publish-status",
      "goods-detail-image-readback",
    ]);
    assert.equal(result.steps[0].data.sellerpilotVerification, "EXISTING_GOODS_RECOVERED");
    assert.equal(calls.filter((call) => call.type === "temu.local.goods.v3.add").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu listing fails verification when processed detail images are missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.type === "temu.local.goods.v3.add") return Response.json({ success: true, result: { goodsId: 900003 } });
    if (body.type === "temu.local.goods.list.retrieve") return Response.json({ success: true, result: { goodsList: [{ goodsId: 900003, outGoodsSn: "TEST-TEMU-IMAGE-FAIL" }] } });
    if (body.type === "bg.local.goods.publish.status.get") return Response.json({ success: true, result: { goodsPublishStatusList: [{ goodsId: 900003, status: 1, subStatus: 1 }] } });
    return Response.json({ success: true, result: { goodsId: 900003, goodsGallery: { goodsCarouselImage: ["https://cdn.example.com/hero.jpg"], detailImage: [] } } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.create",
      payload: { app_key: "app-key", app_secret: "app-secret", access_token: "seller-token" },
      arguments: {
        body: {
          goodsBasic: {
            externalGoodsId: "TEST-TEMU-IMAGE-FAIL",
            goodsName: "Image test",
            goodsCarouselImage: ["https://cdn.example.com/hero.jpg"],
            detailImage: ["https://cdn.example.com/detail-1.jpg", "https://cdn.example.com/detail-2.jpg"],
          },
          skuList: [{ externalSkuId: "TEST-TEMU-IMAGE-FAIL" }],
        },
      },
      environment: "production",
    });

    assert.equal(result.ok, false);
    assert.equal(result.steps.at(-1)?.name, "goods-detail-image-readback");
    assert.equal(result.steps.at(-1)?.data.expectedDetailImageCount, 2);
    assert.equal(result.steps.at(-1)?.data.actualDetailImageCount, 0);
    assert.equal(result.steps.at(-1)?.data.sellerpilotVerification, "TEMU_IMAGE_READBACK_MISSING");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay does not invent a domestic-style order acknowledgement step", async () => {
  await assert.rejects(
    executeChannelOperation({
      channel: "ebay",
      operation: "shipment.acknowledge",
      payload: { access_token: "token" },
      arguments: {},
      environment: "sandbox",
    }),
    /CHANNEL_OPERATION_UNSUPPORTED/,
  );
});

test("eBay refreshes an expired two-hour access token before a live operation", async () => {
  const originalFetch = globalThis.fetch;
  let tokenBody = "";
  globalThis.fetch = async (_input, init) => {
    tokenBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ access_token: "fresh-access-token", expires_in: 7200 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const ensured = await ensureEbayAccessToken({
      client_id: "client",
      client_secret: "secret",
      ru_name: "runame",
      access_token: "expired-access-token",
      access_token_expires_at: "2000-01-01T00:00:00.000Z",
      refresh_token: "refresh-token",
      refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
    }, "sandbox");
    assert.equal(ensured.refreshed, true);
    assert.equal(ensured.payload.access_token, "fresh-access-token");
    assert.match(tokenBody, /grant_type=refresh_token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee refresh rotates both the four-hour access token and thirty-day refresh token", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ access_token: "fresh-access", refresh_token: "fresh-refresh", expire_in: 14_400 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const ensured = await ensureShopeeAccessToken({
      partner_id: "2031489",
      partner_key: "partner-secret",
      shop_id: "123456",
      access_token: "expired-access",
      access_token_expires_at: "2000-01-01T00:00:00.000Z",
      refresh_token: "refresh-token",
      refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
      authorization_expires_at: "2099-01-01T00:00:00.000Z",
    }, "production");
    assert.equal(ensured.refreshed, true);
    assert.equal(ensured.payload.access_token, "fresh-access");
    assert.equal(ensured.payload.refresh_token, "fresh-refresh");
    assert.equal(new URL(calledUrl).pathname, "/api/v2/auth/access_token/get");
    assert.deepEqual(JSON.parse(calledBody), { refresh_token: "refresh-token", shop_id: 123456, partner_id: 2031489 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
