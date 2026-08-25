import assert from "node:assert/strict";
import test from "node:test";
import {
  gatewayJobCompletionStatus,
  gatewayResultHasObservedMutation,
  gatewayWorkerCompletionSchema,
} from "../lib/channels/gateway-contract";

test("channel gateway accepts the full Shopee asynchronous verification trail", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "1b1f43a7-16d1-4a59-93df-22e76e9c8726",
    claimToken: "b9af413b-8ed5-4d47-956e-e7594bfbb902",
    status: "succeeded",
    result: {
      ok: false,
      channel: "shopee",
      operation: "listing.create",
      remoteId: "48366301456",
      safeMessage: "Shopee 게시 결과를 다시 확인해야 합니다.",
      steps: Array.from({ length: 25 }, (_, index) => ({
        name: `published-item-readback-${index + 1}`,
        ok: index < 24,
        status: 200,
        data: {},
      })),
    },
  });

  assert.equal(parsed.success, true);
});

test("channel gateway reconciliation can preserve a structured partial-write result", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "4c547930-1f56-46ea-b65d-a628fb440e9b",
    claimToken: "cb3b9b9b-9830-4997-8bd8-af1e6657e2f3",
    status: "reconciliation_required",
    error: "재고 변경 후 읽기 검증을 확정하지 못했습니다.",
    result: {
      ok: false,
      channel: "ebay",
      operation: "inventory.update",
      remoteId: "seller-sku-1",
      safeMessage: "재고 변경 후 읽기 검증을 확정하지 못했습니다.",
      steps: [
        { name: "bulk-inventory", ok: true, status: 204, data: {} },
        { name: "inventory-readback", ok: false, status: 503, data: {} },
      ],
    },
  });
  assert.equal(parsed.success, true);
});

test("channel gateway accepts sanitized 11st competitor search candidates", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "21f486a3-f6c5-4e68-8a67-31368874af04",
    claimToken: "808d1bb4-8437-4df0-ac3f-b72a3aa730d3",
    status: "succeeded",
    result: {
      ok: true,
      channel: "elevenst",
      operation: "competitor.search",
      items: [{
        provider: "elevenst_product_search",
        externalId: "123456789",
        title: "켈로그 첵스초코 570g",
        url: "https://www.11st.co.kr/products/123456789",
        imageUrl: "https://image.11st.co.kr/example.jpg",
        mallName: "공식 판매처",
        marketplace: "elevenst",
        price: 7_900,
        currency: "KRW",
      }],
      safeMessage: "11번가 공식 상품검색에서 후보 1건을 확인했습니다.",
    },
  });
  assert.equal(parsed.success, true);
});

test("channel gateway accepts a staged eBay OAuth completion", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "51fc7348-3e07-45ba-94c7-62e5244b511b",
    claimToken: "f0308779-b8dd-4fbb-8cad-f55fe0d33f2d",
    status: "succeeded",
    result: {
      ok: true,
      channel: "ebay",
      operation: "oauth.exchange",
      credentialPayload: {
        client_id: "test-client",
        client_secret: "test-secret",
        ru_name: "test-redirect",
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
      },
      expiresAt: "2027-08-25T00:00:00.000Z",
      safeMessage: "eBay OAuth 토큰 교환을 완료했습니다.",
    },
  });

  assert.equal(parsed.success, true);
});

for (const status of ["failed", "reconciliation_required"] as const) {
  test(`channel gateway preserves a known credential refresh for ${status}`, () => {
    const parsed = gatewayWorkerCompletionSchema.safeParse({
      jobId: "0a29a4ca-4502-49fb-af23-4299d01cbd9c",
      claimToken: "7976da2d-6cc2-4ac2-9c99-1e10ddb0c30b",
      status,
      error: "provider outcome requires reconciliation",
      credentialRefresh: {
        payload: {
          app_key: "123456",
          app_secret: "secret-value",
          access_token: "next-access-token",
          refresh_token: "next-refresh-token",
        },
        expiresAt: "2027-08-25T00:00:00.000Z",
      },
    });

    assert.equal(parsed.success, true);
  });
}

test("inquiry reply provider uncertainty is never classified as safely retryable", () => {
  assert.equal(gatewayResultHasObservedMutation("inquiries.reply", false, [
    { name: "inquiry-reply", ok: true, status: 200 },
    { name: "reply-readback", ok: false, status: 503 },
  ]), true);
  assert.equal(gatewayJobCompletionStatus("inquiries.reply", false, [
    { name: "inquiry-reply", ok: false, status: 503 },
  ]), "reconciliation_required");
  assert.equal(gatewayJobCompletionStatus("inquiries.reply", false, [
    { name: "inquiry-preflight", ok: false, status: 422 },
  ]), "succeeded");
});
