import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { productDetailDataToHtml } from "../app/_publishing/product-detail-html";
import { defaultProductDetailImageRoles, inspectProductDetailImageDocument } from "../lib/product-detail-image-manifest";
import { ProductDetailBuyer } from "../app/product-detail-buyer";
import type { ProductDetailData } from "../app/product-detail-puck";

test("buyer presentation retains cautions without exposing internal evidence or mutating saved data", () => {
  const data: ProductDetailData = { content: [{ type: "StoryBlock", props: {
    id: "caution", sectionType: "caution", eyebrow: "사용 안내", title: "사용 전 확인", body: "알레르기 유발 원료는 포장의 원재료명에서 확인하세요.", points: "소비기한은 포장을 확인하세요.", tone: "light", primary: "#342469", accent: "#f7eb96", layout: "editorial", motion: "none", buyerQuestion: "INTERNAL_QUESTION", evidence: "INTERNAL_SOURCE_PHOTO", verificationStatus: "needs-review",
  } }] };
  const before = structuredClone(data);
  const html = renderToStaticMarkup(createElement(ProductDetailBuyer, { data }));
  assert.match(html, /알레르기 유발 원료/);
  assert.match(html, /소비기한/);
  assert.doesNotMatch(html, /INTERNAL_|자료 확인|확인 근거/);
  assert.deepEqual(data, before);
});

test("non-food classification does not acquire a health-functional-food badge", () => {
  const data: ProductDetailData = { content: [{ type: "VerificationRibbonBlock", props: {
    id: "classification", classification: "생활용품", verificationStatus: "verified", evidence: "INTERNAL_SOURCE", healthFunctionalStatus: "건강기능식품 아님", targetCustomer: "수납용품 구매자", primary: "#342469", accent: "#f7eb96", surface: "#fff",
  } }] };
  const html = renderToStaticMarkup(createElement(ProductDetailBuyer, { data }));
  assert.match(html, /생활용품/);
  assert.doesNotMatch(html, /건강기능식품|INTERNAL_SOURCE/);
});


test("buyer rendering and HTML export preserve all eight publishing roles without audit prose", () => {
  const data: ProductDetailData = { root: {}, content: defaultProductDetailImageRoles.map((role, index) => ({
    type: "ImageStoryBlock", props: {
      id: `image-${index}`, sectionType: index === 7 ? "caution" : "spec",
      eyebrow: "제품 정보", title: `구매 정보 ${index}`, body: "포장의 표시사항과 실제 상품 구성을 확인하세요.",
      points: "알레르기 원료 확인", imageUrl: `sellerpilot-asset://${role}`, imageRole: role,
      imageAlt: `제품 사진 ${index}`, imageFit: "contain", reverse: false,
      primary: "#342469", accent: "#f7eb96", surface: "#f4f1fa", layout: "split", motion: "none",
      buyerQuestion: "INTERNAL_BUYER_QUESTION", evidence: "INTERNAL_LABEL_EVIDENCE", verificationStatus: "verified",
    },
  })) };
  const before = structuredClone(data);
  assert.equal(inspectProductDetailImageDocument(data).ok, true);
  const preview = renderToStaticMarkup(createElement(ProductDetailBuyer, { data }));
  assert.equal((preview.match(/data-sellerpilot-detail-image-role=/g) ?? []).length, 8);
  assert.equal((preview.match(/loading="eager"/g) ?? []).length, 8);
  assert.doesNotMatch(preview, /INTERNAL_/);
  const exported = productDetailDataToHtml(data);
  for (const role of defaultProductDetailImageRoles) {
    assert.equal(exported.split(`{{SELLERPILOT_IMAGE:${role}}}`).length - 1, 1);
  }
  assert.match(exported, /알레르기 원료 확인/);
  assert.doesNotMatch(exported, /INTERNAL_|구매 전 질문|확인 근거/);
  assert.deepEqual(data, before);
});

test("export escapes seller content and rejects CSS injection in palette", () => {
  const data: ProductDetailData = { content: [{ type: "HeroBlock", props: {
    id: "hero", title: "<script>alert(1)</script>", eyebrow: "상품", description: "확인된 설명",
    cta: "FAKE_BUTTON", imageUrl: "", imageAlt: "", primary: "red;position:fixed", accent: "#f7eb96", surface: "#f4f1fa", layout: "split",
  } }] };
  const html = productDetailDataToHtml(data);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|position:fixed|FAKE_BUTTON/);
});
