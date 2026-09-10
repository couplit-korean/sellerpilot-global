import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyProductIntake,
  emptyProductIntakeDraftDecisions,
  isProductIntakePublicationReady,
  productIntakeDraftSchema,
  productIntakeSchema,
  productRegistrationIntakeDraftSchema,
} from "../lib/product-intake";

const publishableIntake = {
  ...emptyProductIntake,
  researchInput: "https://supplier.example/products/mug-1",
  productName: "화이트 세라믹 머그",
  sellerSku: "MUG-001",
  categoryHint: "머그컵",
  brandName: "No Brand",
  manufacturer: "Couplit 공급처",
  countryOfOrigin: "대한민국",
  material: "도자기 100%",
  packageContents: "머그컵 1개",
  sellingPrice: 12_000,
  stock: 3,
  weightKg: 0.4,
  packageLengthCm: 14,
  packageWidthCm: 11,
  packageHeightCm: 12,
  description: "화이트 세라믹 머그컵 1개 구성으로 일상 음료에 사용하는 상품입니다.",
  imageRightsConfirmed: true,
  productFactsConfirmed: true,
};

test("editable intake drafts accept incomplete zero values without weakening publication validation", () => {
  assert.equal(productIntakeDraftSchema.safeParse(emptyProductIntake).success, true);
  assert.equal(productIntakeSchema.safeParse(emptyProductIntake).success, false);
  assert.equal(productIntakeSchema.safeParse(publishableIntake).success, true);
});

test("initial defaults do not confirm new condition, KRW, free shipping, or NO_GTIN", () => {
  assert.equal(isProductIntakePublicationReady(publishableIntake, emptyProductIntakeDraftDecisions), false);
  assert.equal(isProductIntakePublicationReady(publishableIntake, {
    condition: true,
    gtinStatus: true,
    currency: true,
    shippingFeeKrw: true,
  }), true);
});

test("server intake draft keeps dirty fields and JSON image metadata but rejects browser-only URLs", () => {
  const data = {
    schemaVersion: 1 as const,
    intake: { ...publishableIntake, imageRightsConfirmed: false, productFactsConfirmed: false },
    decisions: { condition: true, gtinStatus: true, currency: true, shippingFeeKrw: true },
    userEditedFields: ["productName", "shippingFeeKrw"],
    imageSelections: [{
      role: "main",
      name: "mug.jpg",
      mediaType: "image/jpeg",
      bytes: 42_000,
      originalWidth: 1_200,
      originalHeight: 1_200,
      uploadedPath: null,
    }],
    researchJobId: null,
  };
  const parsed = productRegistrationIntakeDraftSchema.parse(data);
  assert.deepEqual(parsed.userEditedFields, ["productName", "shippingFeeKrw"]);
  assert.equal(parsed.imageSelections[0]?.uploadedPath, null);
  assert.equal(productRegistrationIntakeDraftSchema.safeParse({
    ...data,
    imageSelections: [{ ...data.imageSelections[0], uploadedPath: "blob:https://sellerpilot.example/local-file" }],
  }).success, false);
});
