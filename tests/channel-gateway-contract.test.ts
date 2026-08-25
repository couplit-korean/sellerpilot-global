import assert from "node:assert/strict";
import test from "node:test";
import { gatewayWorkerCompletionSchema } from "../lib/channels/gateway-contract";

test("channel gateway accepts the full Shopee asynchronous verification trail", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "1b1f43a7-16d1-4a59-93df-22e76e9c8726",
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

test("channel gateway accepts sanitized 11st competitor search candidates", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "21f486a3-f6c5-4e68-8a67-31368874af04",
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
