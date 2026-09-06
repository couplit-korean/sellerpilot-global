import test from "node:test";
import assert from "node:assert/strict";
import { inspectListingDraft, setListingDraftValue } from "../lib/channels/listing-preflight";
import { buildChannelArguments, buildSynchronizedDraftMap } from "../app/product-publish-workbench";

function context(): Parameters<typeof buildChannelArguments>[1] {
  return {
    product: { id: "setter-fixture", externalCode: "SETTER", sku: "SETTER", name: "setter fixture", description: "shipping setter fixture", sourceUrl: null, status: "ready" },
    manualFields: { productName: "setter fixture", description: "shipping setter fixture", sellerSku: "SETTER", categoryHint: "생활용품", brandName: "TEST", manufacturer: "TEST", countryOfOrigin: "대한민국", material: "test", packageContents: "상품 1개", condition: "NEW", gtinStatus: "NO_GTIN", gtin: "", sellingPrice: 10000, currency: "KRW", stock: 1, shippingFeeKrw: 3000, shippingRule: "결제 후 1~2영업일 내 출고", packagingRule: "완충재 포장", weightKg: 0.2, packageLengthCm: 10, packageWidthCm: 8, packageHeightCm: 4 },
    contentMode: "manual_mvp", imageSpecs: [], assignments: [], listings: [], sourceImages: [{ path: "fixture.jpg", url: "https://example.com/fixture.jpg" }], generatedImages: [], localizedListings: [], detailData: null,
  };
}
const packageFields = { weight: 0.2, length: 10, width: 8, height: 4 };

const weight = (draft: Record<string, unknown>) => (draft.facts as Record<string, unknown>).weightAttribute;
function resync(current: Record<string, unknown>) {
  return JSON.parse(buildSynchronizedDraftMap(context(), { coupang: JSON.stringify(current) }, 3290, 2, {}, { ...packageFields, weight: 0.4 }, 10).coupang!) as Record<string, unknown>;
}

test("Coupang exposes an explicit net-weight manual field and preserves 315g through price/stock/package synchronization", () => {
  const initial = buildChannelArguments("coupang", context(), 3190, 1, undefined, packageFields, 10) as Record<string, unknown>;
  const field = inspectListingDraft("coupang", initial).find(item => item.key === "weight-attribute");
  assert.deepEqual(field?.manualPath, ["facts", "weightAttribute"]);
  assert.match(field?.help ?? "", /배송·포장 중량으로 추정하지 않습니다/);
  const entered = setListingDraftValue(initial, field!.manualPath!, "315g");
  const next = resync(entered);
  assert.equal(weight(next), "315g");
  assert.equal(weight(entered), "315g");
  assert.equal(weight(initial), undefined);
  const item = (next.body as { items: Array<Record<string, unknown>> }).items[0];
  assert.equal(item.salePrice, 3290);
  assert.equal(item.maximumBuyCount, 2);
  assert.equal((next.facts as Record<string, unknown>).weightKg, 0.4);
});

test("Coupang absent net weight is never invented from shipping mass", () => {
  const initial = buildChannelArguments("coupang", context(), 3190, 1, undefined, packageFields, 10) as Record<string, unknown>;
  assert.equal(weight(resync(initial)), undefined);
});

test("Coupang common synchronization preserves raw net-weight types rather than silently repairing JSON", () => {
  for (const value of [null, 315, false, ["315g"], { net: "315g" }, " 315g ", ""]) {
    const initial = buildChannelArguments("coupang", context(), 3190, 1, undefined, packageFields, 10) as Record<string, unknown>;
    (initial.facts as Record<string, unknown>).weightAttribute = value;
    const before = structuredClone(initial);
    const next = resync(initial);
    assert.deepEqual(weight(next), value);
    assert.deepEqual(initial, before);
  }
});
