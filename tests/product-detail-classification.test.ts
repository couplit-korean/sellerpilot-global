import assert from "node:assert/strict";
import test from "node:test";
import { productDetailHealthFunctionalStatus } from "../lib/product-detail-classification";

test("non-food product details omit the health-functional-food status", () => {
  assert.equal(productDetailHealthFunctionalStatus({
    name: "부착형 케이블 정리 클립 6개 세트",
    category: "케이블 정리용품",
    classification: {
      displayName: "케이블 정리 클립",
      verificationStatus: "needs-review",
      evidence: "판매자 자료 확인 필요",
      isHealthFunctionalFood: null,
    },
  }), "");

  assert.equal(productDetailHealthFunctionalStatus({
    name: "USB 케이블 홀더",
    category: "모바일 액세서리",
    classification: {
      displayName: "케이블 홀더",
      verificationStatus: "verified",
      evidence: "제품 포장 확인",
      isHealthFunctionalFood: false,
    },
  }), "");
});

test("food and supplement details preserve the health-functional-food status", () => {
  assert.equal(productDetailHealthFunctionalStatus({
    name: "통밀 시리얼",
    category: "일반식품",
    classification: {
      displayName: "시리얼류",
      verificationStatus: "verified",
      evidence: "식품 라벨 확인",
      isHealthFunctionalFood: false,
    },
  }), "건강기능식품 아님");

  assert.equal(productDetailHealthFunctionalStatus({
    name: "오메가3 캡슐",
    category: "건강기능식품",
    classification: {
      displayName: "건강기능식품",
      verificationStatus: "verified",
      evidence: "포장 표시 확인",
      isHealthFunctionalFood: true,
    },
  }), "건강기능식품 표시 확인");

  assert.equal(productDetailHealthFunctionalStatus({
    name: "과일 음료",
    category: "음료",
    classification: {
      displayName: "음료류",
      verificationStatus: "needs-review",
      evidence: "판매자 자료 확인 필요",
      isHealthFunctionalFood: null,
    },
  }), "표시 여부 확인 필요");
});
