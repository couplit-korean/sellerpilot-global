import assert from "node:assert/strict";
import test from "node:test";
import { readSmartstoreUpdateIdentity } from "../lib/channels/smartstore-update-identity";
const originProductNo = "13688607602", channelProductNo = "13749310594", sellerSku = "TEST-ONLY";
function fixture() {
  const product = { name: "기존 상품", statusType: "SALE", salePrice: 3190, stockQuantity: 1,
    detailContent: "old detail", detailAttribute: { sellerCodeInfo: { sellerManagementCode: sellerSku } } };
  const bodies: Record<string, Record<string, unknown>> = {
    "/v1/products/search": { page: 1, size: 50, totalElements: 1, totalPages: 1, first: true, last: true,
      contents: [{ originProductNo, channelProducts: [{ channelProductNo, sellerManagementCode: sellerSku }] }] },
    [`/v2/products/origin-products/${originProductNo}`]: { originProduct: structuredClone(product), smartstoreChannelProduct: { channelProductDisplayStatusType: "ON" } },
    [`/v2/products/channel-products/${channelProductNo}`]: { originProduct: structuredClone(product), smartstoreChannelProduct: { channelProductDisplayStatusType: "ON" } },
  };
  const calls: string[] = [];
  const input = { originProductNo, sellerSku, request: async (request: { path: string }) => {
    calls.push(request.path); return { response: new Response(null, { status: 200 }), data: bodies[request.path] };
  } };
  return { bodies, calls, input };
}
test("official GET without number echoes resolves unique search pair and preserves remote commercial values", async () => {
  const { input, calls } = fixture();
  const result = await readSmartstoreUpdateIdentity(input);
  assert.equal(result.channelProductNo, channelProductNo);
  assert.equal(result.currentOriginProduct.salePrice, 3190);
  assert.equal(result.currentOriginProduct.stockQuantity, 1);
  assert.equal(calls.length, 3);
});
test("missing update seller code is derived from the exact origin path before the complete identity reads", async () => {
  const { input, calls } = fixture();
  const result = await readSmartstoreUpdateIdentity({ ...input, sellerSku: undefined });
  assert.equal(result.sellerSku, sellerSku);
  assert.deepEqual(calls, [
    `/v2/products/origin-products/${originProductNo}`,
    "/v1/products/search",
    `/v2/products/origin-products/${originProductNo}`,
    `/v2/products/channel-products/${channelProductNo}`,
  ]);
});
for (const mode of ["missingOrigin", "emptySku", "changedSku"] as const) {
  test(`seller-code fallback rejects ${mode} before update identity can be trusted`, async () => {
    const { input, bodies } = fixture();
    const originPath = `/v2/products/origin-products/${originProductNo}`;
    if (mode === "missingOrigin") delete bodies[originPath].originProduct;
    if (mode === "emptySku") {
      (((bodies[originPath].originProduct as Record<string, unknown>).detailAttribute as Record<string, unknown>)
        .sellerCodeInfo as Record<string, unknown>).sellerManagementCode = "";
    }
    const originalRequest = input.request;
    const request = async (requestInput: { path: string }) => {
      if (mode === "changedSku" && requestInput.path === "/v1/products/search") {
        (((bodies[originPath].originProduct as Record<string, unknown>).detailAttribute as Record<string, unknown>)
          .sellerCodeInfo as Record<string, unknown>).sellerManagementCode = "OTHER";
      }
      return originalRequest(requestInput);
    };
    await assert.rejects(
      readSmartstoreUpdateIdentity({ ...input, sellerSku: undefined, request }),
      /NAVER_UPDATE_/,
    );
  });
}
for (const mode of ["duplicate", "incomplete", "wrongOrigin", "conflictingSearchAlias", "wrongOriginAlias", "wrongChannelAlias", "missingChannelOrigin", "changedDetail", "wrongChannelSku", "wrongExpectedChannel"] as const) {
  test(`update rejects ${mode} before any provider mutation`, async () => {
    const { input, bodies } = fixture();
    const search = bodies["/v1/products/search"];
    const origin = bodies[`/v2/products/origin-products/${originProductNo}`];
    const channel = bodies[`/v2/products/channel-products/${channelProductNo}`];
    if (mode === "duplicate") { (search.contents as unknown[]).push(structuredClone((search.contents as unknown[])[0])); search.totalElements = 2; }
    if (mode === "incomplete") search.last = false;
    if (mode === "wrongOrigin") (search.contents as Record<string, unknown>[])[0].originProductNo = "99999999999";
    if (mode === "conflictingSearchAlias") ((search.contents as Record<string, unknown>[])[0].channelProducts as Record<string, unknown>[])[0].smartstoreChannelProductNo = "99999999999";
    if (mode === "wrongOriginAlias") origin.originProductNo = "99999999999";
    if (mode === "wrongChannelAlias") channel.channelProductNo = "99999999999";
    if (mode === "missingChannelOrigin") delete channel.originProduct;
    if (mode === "changedDetail") (channel.originProduct as Record<string, unknown>).detailContent = "different";
    if (mode === "wrongChannelSku") (channel.smartstoreChannelProduct as Record<string, unknown>).sellerManagementCode = "OTHER";
    await assert.rejects(readSmartstoreUpdateIdentity({ ...input, ...(mode === "wrongExpectedChannel" ? { expectedChannelProductNo: "99999999999" } : {}) }), /NAVER_UPDATE_/);
  });
}
