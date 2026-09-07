import assert from "node:assert/strict";
import test from "node:test";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { buildAssetImagePrompt, resolveProductSettingShot } from "../lib/ai-image-planning";
import {
  CATEGORY_DETAIL_PAGE_DENSITY_CONTRACT,
  CATEGORY_PRODUCTION_GUIDELINE_VERSION,
  formatCategoryProductionGuideline,
  resolveCategoryProductionGuideline,
} from "../lib/category-production-guidelines";
import { productSceneProfiles, resolveProductSceneProfile } from "../lib/product-scene-profiles";
import type { ProductStudioResult } from "../app/product-studio-types";

const result = {
  mode: "cli",
  product: {
    name: "테스트 상품",
    category: "일반상품",
    features: [],
    cautions: [],
    classification: { isHealthFunctionalFood: false },
    oneLine: "확인된 실제 상품",
  },
  design: {
    themeName: "source faithful",
    palette: { surface: "#f4f1ed", accent: "#49433f" },
    creativeStrategy: {
      differentiationKey: "실제 외관",
      artDirection: "원본 중심",
      purchaseDecision: "형태와 구성 확인",
    },
    sections: [],
  },
  localizedListings: [],
} as unknown as ProductStudioResult;

test("scene routing expands from broad rooms to more than one hundred product subtypes", () => {
  assert.ok(productSceneProfiles.length >= 110, String(productSceneProfiles.length));
  const examples = [
    ["신라면 봉지라면", "식품 > 라면", "food-instant-bag-noodles"],
    ["프로메가 오메가3", "건강기능식품", "health-omega3-softgel"],
    ["킬커버 쿠션 파운데이션", "화장품 > 베이스메이크업", "beauty-cushion-foundation"],
    ["여성 니트 카디건", "여성의류 > 니트", "fashion-knit"],
    ["무광 대형 집게핀", "패션잡화 > 헤어액세서리", "fashion-hair-accessory"],
    ["스테인리스 밀폐용기", "주방용품 > 보관용기", "kitchen-food-container"],
  ] as const;
  for (const [name, category, profileId] of examples) {
    assert.equal(resolveProductSceneProfile({ name, category }).profile.id, profileId, name);
  }
});

test("flavor words cannot reroute a packaged snack to dairy or cosmetics", () => {
  const profile = resolveProductSceneProfile({
    name: "롯샌 파스퇴르 순우유맛 크림 샌드 과자 315 g",
    category: "일반식품 > 과자",
  }).profile.id;
  assert.equal(profile, "food-snack");
});

test("every requested family receives eight purpose-specific production directives", () => {
  const profiles = [
    "food-cup-noodles",
    "health-probiotic-stick",
    "beauty-serum",
    "fashion-tops",
    "fashion-wallet",
    "kitchen-knife",
  ];
  const expectedFamilies = ["food", "health-supplement", "cosmetics", "apparel", "fashion-accessory", "kitchen"];
  profiles.forEach((profileId, index) => {
    const guideline = resolveCategoryProductionGuideline(profileId);
    assert.equal(guideline.version, CATEGORY_PRODUCTION_GUIDELINE_VERSION);
    assert.equal(guideline.family, expectedFamilies[index]);
    assert.equal(Object.keys(guideline.slotDirectives).length, 8);
    assert.equal(new Set(Object.values(guideline.slotDirectives)).size, 8);
    assert.match(guideline.sourcePriority, /→/);
    assert.ok(guideline.forbidden.length > 10);
  });
});

test("every category guideline carries the balanced long-page density contract", () => {
  assert.equal(CATEGORY_DETAIL_PAGE_DENSITY_CONTRACT.minimumSections, 16);
  assert.equal(CATEGORY_DETAIL_PAGE_DENSITY_CONTRACT.maximumSections, 20);
  assert.equal(CATEGORY_DETAIL_PAGE_DENSITY_CONTRACT.requiredImageSections, 12);
  assert.equal(CATEGORY_DETAIL_PAGE_DENSITY_CONTRACT.requiredUniqueImageFiles, 13);
  assert.equal(CATEGORY_DETAIL_PAGE_DENSITY_CONTRACT.maximumAdjacentTextOnlySections, 2);
  for (const profile of productSceneProfiles) {
    const text = formatCategoryProductionGuideline(profile.id);
    assert.match(text, /상세 밀도: 16~20개 섹션 중 서로 다른 이미지 섹션 12개/u, profile.id);
    assert.match(text, /이미지-문안 연결:/u, profile.id);
    assert.match(text, /텍스트 전용 섹션은 2개를 초과해 연속 배치하지 않는다/u, profile.id);
    assert.match(text, /단순 확대·축소·크롭·좌우반전·색상 변경/u, profile.id);
    assert.match(text, /고유 이미지 파일 13개/u, profile.id);
  }
});

test("every selectable scene profile resolves a specific playbook instead of general fallback", () => {
  for (const profile of productSceneProfiles) {
    const guideline = resolveCategoryProductionGuideline(profile.id);
    assert.notEqual(guideline.family, "general", profile.id);
    assert.notEqual(guideline.subject, "실제 상품의 전체 형태와 정면 식별", profile.id);
  }
});

test("the generated prompt contains the category source order, truth boundary and slot purpose", () => {
  const cosmeticResult = {
    ...result,
    product: {
      ...result.product,
      name: "수분 세럼 앰플",
      category: "화장품 > 스킨케어 > 세럼",
    },
  };
  const asset = aiGeneratedAssetSpecs.find(({ id }) => id === "detail-use")!;
  const setting = resolveProductSettingShot(cosmeticResult, "detail-use")!;
  const prompt = buildAssetImagePrompt(cosmeticResult, "/tmp/serum.png", asset, ["main", "front", "label"], "", "product", setting);
  assert.match(prompt, /카테고리 제작 지침 2026-09-08-v4-unique-visual-story: 화장품\/beauty-serum/);
  assert.match(prompt, /상세 밀도: 16~20개 섹션 중 서로 다른 이미지 섹션 12개/u);
  assert.match(prompt, /원본사진 우선순위: 정면 용기·단상자 → 펌프·스포이드·캡·팁/);
  assert.match(prompt, /Required shot for this slot: 스포이드·펌프의 닫힌 준비 상태/);
  assert.match(prompt, /피부·모발 전후/);
});

test("prepared food prompts carry both the preparation state and the subtype playbook", () => {
  const foodResult = {
    ...result,
    product: {
      ...result.product,
      name: "신라면 봉지라면",
      category: "식품 > 봉지라면",
    },
  };
  const asset = aiGeneratedAssetSpecs.find(({ id }) => id === "detail-use")!;
  const setting = resolveProductSettingShot(foodResult, "detail-use")!;
  assert.equal(setting.sceneProfile?.id, "food-instant-bag-noodles");
  assert.equal(setting.foodPresentation?.mode, "cook-and-serve");
  const prompt = buildAssetImagePrompt(foodResult, "/tmp/noodles.png", asset, ["main", "front"], "", "prepared-food", setting);
  assert.match(prompt, /Category production contract:/);
  assert.match(prompt, /봉지 규격·스프 구성·조리법과 기본 조리 결과/);
  assert.match(prompt, /컵라면 용기, 확인되지 않은 계란/);
  assert.match(prompt, /Slot-specific purchase purpose:/);
});
