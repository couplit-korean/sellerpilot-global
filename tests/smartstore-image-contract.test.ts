import assert from "node:assert/strict";
import test from "node:test";
import {
  bindSmartstoreUploadedProductImages,
  finalizeSmartstoreListingBody,
  smartstoreImageUploadPlan,
  smartstoreReadbackImageProjection,
  strictSmartstoreUploadedImageUrl,
} from "../lib/channels/smartstore-image-contract";

const sourceDetailUrls = Array.from({ length: 8 }, (_, index) =>
  `https://sellerpilot.supabase.co/storage/v1/object/sign/detail-${index + 1}.jpg?token=source-${index + 1}`);
const sourceRepresentativeUrl =
  "https://sellerpilot.supabase.co/storage/v1/object/sign/representative.jpg?token=source-main";
const uploadedUrls = Array.from({ length: 9 }, (_, index) =>
  `https://shop-phinf.pstatic.net/20260830_sellerpilot/image-${index}.jpg`);

function detailHtml(urls = sourceDetailUrls) {
  return urls
    .map((url, index) => `<img src="${url.replaceAll("&", "&amp;")}" alt="상세 ${index + 1}">`)
    .join("");
}

function sourceBody() {
  return {
    originProduct: {
      name: "스마트스토어 검증 상품",
      detailContent: detailHtml(),
      salePrice: 5_001,
      detailAttribute: { originAreaInfo: { originAreaCode: "04", content: "대한민국" } },
    },
    smartstoreChannelProduct: { channelProductName: "스마트스토어 검증 상품" },
  };
}

test("SmartStore accepts only the exact durable Commerce API upload URL contract", () => {
  assert.equal(strictSmartstoreUploadedImageUrl(uploadedUrls[0]), uploadedUrls[0]);
  for (const invalid of [
    sourceRepresentativeUrl,
    `${uploadedUrls[0]}?token=signed`,
    `${uploadedUrls[0]}#fragment`,
    uploadedUrls[0].replace("shop-phinf.pstatic.net", "shopping-phinf.pstatic.net"),
    uploadedUrls[0].replace("https://", "http://"),
    "https://shop-phinf.pstatic.net:444/20260830_sellerpilot/image-0.jpg",
  ]) {
    assert.equal(strictSmartstoreUploadedImageUrl(invalid), "", invalid);
  }
});

test("SmartStore upload plan selects one representative plus the exact ordered eight detail images", () => {
  const plan = smartstoreImageUploadPlan({
    imageUrls: [
      sourceRepresentativeUrl,
      "https://sellerpilot.supabase.co/storage/v1/object/public/extra-gallery.jpg",
      ...sourceDetailUrls.slice(0, 3),
    ],
    body: sourceBody(),
  });
  assert.equal(plan.representativeSourceUrl, sourceRepresentativeUrl);
  assert.deepEqual(plan.detailSourceUrls, sourceDetailUrls);
  assert.deepEqual(plan.sourceUrls, [sourceRepresentativeUrl, ...sourceDetailUrls]);
});

test("SmartStore provider binding removes signed Supabase URLs from detail HTML and binds nine Naver images", () => {
  const sourceUrls = [sourceRepresentativeUrl, ...sourceDetailUrls];
  const body = bindSmartstoreUploadedProductImages({
    body: sourceBody(),
    sourceUrls,
    uploadedUrls,
  });
  const originProduct = body.originProduct as Record<string, unknown>;
  const detailContent = String(originProduct.detailContent);
  assert.equal(detailContent.includes("supabase.co"), false);
  assert.deepEqual(
    [...detailContent.matchAll(/src="([^"]+)"/g)].map((match) => match[1]),
    uploadedUrls.slice(1),
  );
  assert.deepEqual(originProduct.images, {
    representativeImage: { url: uploadedUrls[0] },
    optionalImages: uploadedUrls.slice(1).map((url) => ({ url })),
  });
  assert.equal(smartstoreReadbackImageProjection(originProduct).verified, true);
});

test("SmartStore update defaults preserve remote policy fields for read-before-write full replacement", () => {
  const updateBody = finalizeSmartstoreListingBody({
    body: {
      ...sourceBody(),
      originProduct: {
        ...(sourceBody().originProduct as Record<string, unknown>),
        images: {
          representativeImage: { url: uploadedUrls[0] },
          optionalImages: uploadedUrls.slice(1).map((url) => ({ url })),
        },
      },
    },
    operation: "listing.update",
    publicationIntent: undefined,
    afterServicePhone: "",
  });
  const originProduct = updateBody.originProduct as Record<string, unknown>;
  const channelProduct = updateBody.smartstoreChannelProduct as Record<string, unknown>;
  assert.equal(originProduct.salePrice, 5_010);
  assert.deepEqual(originProduct.detailAttribute, {
    originAreaInfo: { originAreaCode: "04", content: "대한민국" },
  });
  assert.equal(channelProduct.naverShoppingRegistration, undefined);
  assert.equal(channelProduct.channelProductDisplayStatusType, undefined);
});

test("SmartStore readback fails when any buyer-visible image is external, signed, missing, or reordered", () => {
  const valid = {
    detailContent: detailHtml(uploadedUrls.slice(1)),
    images: {
      representativeImage: { url: uploadedUrls[0] },
      optionalImages: uploadedUrls.slice(1).map((url) => ({ url })),
    },
  };
  assert.equal(smartstoreReadbackImageProjection(valid).verified, true);

  const externalDetail = structuredClone(valid);
  externalDetail.detailContent = detailHtml([
    sourceDetailUrls[0],
    ...uploadedUrls.slice(2),
  ]);
  assert.equal(smartstoreReadbackImageProjection(externalDetail).verified, false);

  const appendedExternalDetail = structuredClone(valid);
  appendedExternalDetail.detailContent += `<img src="${sourceDetailUrls[0]}">`;
  assert.equal(smartstoreReadbackImageProjection(appendedExternalDetail).verified, false);

  const signedRepresentative = structuredClone(valid);
  signedRepresentative.images.representativeImage.url = `${uploadedUrls[0]}?token=unexpected`;
  assert.equal(smartstoreReadbackImageProjection(signedRepresentative).verified, false);

  const reordered = structuredClone(valid);
  reordered.images.optionalImages.reverse();
  assert.equal(smartstoreReadbackImageProjection(reordered).verified, false);
});
