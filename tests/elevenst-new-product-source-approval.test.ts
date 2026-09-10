import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  elevenstProviderAvailabilityReceiptContract,
} from "../lib/channels/elevenst-new-product-input";
import {
  elevenstProcessedFoodNotificationFields,
  elevenstProcessedFoodProductNameNoticeCode,
} from "../lib/channels/elevenst-listing";
import {
  buildElevenstNewProductSourceApproval,
  elevenstNewProductSourceApprovalContract,
  elevenstNewProductSourceApprovalRequestSchema,
} from "../lib/product-registration/elevenst/new-product-source-approval";

const actorId = "10000000-0000-4000-8000-000000000001";
const ownerId = "10000000-0000-4000-8000-000000000002";
const productId = "20000000-0000-4000-8000-000000000001";
const credentialId = "30000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-10T07:00:00+09:00");

function request() {
  return {
    contract: elevenstNewProductSourceApprovalContract,
    approvalRequestId: "40000000-0000-4000-8000-000000000001",
    productId,
    credentialId,
    market: "KR",
    targetId: "11st",
    notices: elevenstProcessedFoodNotificationFields
      .filter(({ code }) => code !== elevenstProcessedFoodProductNameNoticeCode)
      .map(({ code }) => ({
        code,
        value: `승인값 ${code}`,
        sourceKind: "product_label" as const,
        sourceSha256: code.padEnd(64, "a").slice(0, 64),
        capturedAt: "2026-09-10T06:50:00+09:00",
      })),
    sellerOfficeAccountSha256: "b".repeat(64),
    sellerVerifiedAt: "2026-09-10T06:55:00+09:00",
    availability: {
      contract: elevenstProviderAvailabilityReceiptContract,
      state: "available" as const,
      observedAt: "2026-09-10T06:59:00+09:00",
    },
    shipping: {
      shippingFeeKrw: 3_000 as const,
      bundleDeliveryCode: "Y" as const,
      outboundAddressId: "1234",
      returnAddressId: "5678",
    },
    returns: {
      returnFeeKrw: 3_000,
      exchangeFeeKrw: 6_000,
      asDetail: "11번가 판매자 문의 이용",
      returnExchangeDetail: "승인 반품지로 반송",
    },
  };
}

function automatic() {
  return {
    actorId,
    ownerId,
    productId,
    productUpdatedAt: "2026-09-10T06:40:00+09:00",
    productRevision: 11,
    productApprovalRevision: 11,
    productName: "서버 승인 가공식품",
    sellerProductCode: "SERVER-FOOD-011",
    inventoryQuantity: 1,
    credentialId,
    credentialVersion: 4,
    credentialSellerIdSha256: "b".repeat(64),
    draftVersion: 12,
    approvedPriceKrw: 3_190,
    approvedQuantity: 1,
    brand: "롯데",
    countryOfOrigin: "대한민국",
    conditionCode: "01" as const,
    productImageUrls: Array.from({ length: 4 }, (_, index) =>
      `https://signed.example.test/product-${index + 1}.jpg`),
    detailImageUrls: Array.from({ length: 8 }, (_, index) =>
      `https://signed.example.test/detail-${index + 1}.jpg`),
    detailManifestDigest: "d".repeat(64),
  };
}

test("11st approval builds source identity and revisions only from automatic context", async () => {
  const built = await buildElevenstNewProductSourceApproval(request(), automatic(), now);
  assert.equal(built.payload.actorId, actorId);
  assert.equal(built.payload.ownerId, ownerId);
  assert.equal(built.payload.productRevision, 11);
  assert.equal(built.payload.productApprovalRevision, 11);
  assert.equal(built.payload.credentialVersion, 4);
  assert.equal(built.payload.draftVersion, 12);
  assert.equal(built.payload.providerProduct.prdNm, "서버 승인 가공식품");
  assert.equal(built.payload.providerProduct.sellerPrdCd, "SERVER-FOOD-011");
  assert.equal(built.payload.providerProduct.selPrc, "3190");
  assert.equal(built.payload.providerProduct.prdSelQty, "1");
  assert.equal(built.payload.notices.length, 10);
  assert.equal(built.payload.notices.every((notice) =>
    notice.source?.productId === productId
      && notice.source.revision === 12
      && notice.approval?.productId === productId
      && notice.approval.revision === 12), true);
  assert.equal(built.payload.policySource.shipping.shippingFeeKrw, 3_000);
  assert.equal(built.payload.policySource.shipping.deliveryCostBasisCode, "02");
  assert.equal(built.payload.policySource.shipping.paymentTypeCode, "03");
  assert.equal(built.payload.policySource.content.productImageUrls.length, 4);
  assert.equal(built.payload.policySource.content.detailImageUrls.length, 8);
  const preparedProduct = built.preparedArguments.product as Record<string, unknown>;
  assert.equal(preparedProduct.dlvCst1, "3000");
  assert.equal(preparedProduct.ProductNotification != null, true);
});

test("11st approval request cannot carry owner, credential version, revision or provider Product", () => {
  for (const forged of [
    { ownerId },
    { actorId },
    { credentialVersion: 999 },
    { productRevision: 999 },
    { productApprovalRevision: 999 },
    { draftVersion: 999 },
    { providerProduct: { dispCtgrNo: "1346631" } },
    { ProductNotification: { type: "891031" } },
    { existingProductId: "9598600918" },
    { remoteId: "9598600918" },
  ]) {
    assert.equal(elevenstNewProductSourceApprovalRequestSchema.safeParse({
      ...request(),
      ...forged,
    }).success, false, JSON.stringify(forged));
  }
});

test("11st approval blocks cross-product, cross-credential and stale automatic revisions", async () => {
  await assert.rejects(
    buildElevenstNewProductSourceApproval({
      ...request(),
      productId: "20000000-0000-4000-8000-000000000099",
    }, automatic(), now),
    /AUTOMATIC_CONTEXT_INVALID/u,
  );
  await assert.rejects(
    buildElevenstNewProductSourceApproval({
      ...request(),
      credentialId: "30000000-0000-4000-8000-000000000099",
    }, automatic(), now),
    /AUTOMATIC_CONTEXT_INVALID/u,
  );
  await assert.rejects(
    buildElevenstNewProductSourceApproval(request(), {
      ...automatic(),
      productApprovalRevision: 10,
    }, now),
    /AUTOMATIC_CONTEXT_INVALID/u,
  );
  await assert.rejects(
    buildElevenstNewProductSourceApproval(request(), {
      ...automatic(),
      approvedQuantity: 0,
    }, now),
    /AUTOMATIC_CONTEXT_INVALID/u,
  );
});

test("11st approval blocks forged seller ownership, stale availability and notice order", async () => {
  await assert.rejects(
    buildElevenstNewProductSourceApproval({
      ...request(),
      sellerOfficeAccountSha256: "c".repeat(64),
    }, automatic(), now),
    /APPROVAL_INPUT_BLOCKED/u,
  );
  await assert.rejects(
    buildElevenstNewProductSourceApproval({
      ...request(),
      availability: {
        contract: elevenstProviderAvailabilityReceiptContract,
        state: "available",
        observedAt: "2026-09-10T06:00:00+09:00",
      },
    }, automatic(), now),
    /APPROVAL_INPUT_BLOCKED/u,
  );
  const reordered = request();
  [reordered.notices[0], reordered.notices[1]] = [
    reordered.notices[1]!,
    reordered.notices[0]!,
  ];
  assert.equal(elevenstNewProductSourceApprovalRequestSchema.safeParse(reordered).success, false);
});

test("11st admin approval route derives identity before write and has no provider mutation", async () => {
  const route = await readFile(new URL(
    "../app/api/admin/elevenst/new-product-source-approval/route.ts",
    import.meta.url,
  ), "utf8");
  const contextIndex = route.indexOf("sellerpilot_service_elevenst_new_product_approval_context");
  const credentialIndex = route.indexOf("sellerpilot_decrypt_credential");
  const buildIndex = route.indexOf("buildElevenstNewProductSourceApproval(body.data");
  const writeIndex = route.lastIndexOf("elevenstNewProductSourceApprovalWriterRpc");
  assert.equal(contextIndex > 0, true);
  assert.equal(credentialIndex > contextIndex, true);
  assert.equal(buildIndex > credentialIndex, true);
  assert.equal(writeIndex > buildIndex, true);
  assert.doesNotMatch(route, /9598600918|existingProductId|remoteId/u);
  assert.doesNotMatch(route, /gateway|provider.*(?:create|put)|createMarketplaceListing/iu);
});
