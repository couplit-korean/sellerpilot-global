import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCategoryLearning,
  categoryKindCompatibility,
  productLearningKey,
  type CategoryLearningExample,
  type LearnableCategorySuggestion,
} from "../lib/channels/category-learning";

const official: LearnableCategorySuggestion[] = [
  { id: "generic", name: "Beauty", path: ["Beauty"], confidence: 0.97, leaf: true },
  { id: "lip", name: "Lipstick", path: ["Beauty", "Makeup", "Lipstick"], confidence: 0.76, leaf: true },
];

function example(overrides: Partial<CategoryLearningExample> = {}): CategoryLearningExample {
  return {
    product_name: "레드 립스틱 화장품",
    category_id: "lip",
    category_path: ["Beauty", "Makeup", "Lipstick"],
    assignment_status: "confirmed",
    listing_success: true,
    permission_blocked: false,
    confirmed_at: "2026-08-17T01:00:00.000Z",
    published_at: "2026-08-17T01:05:00.000Z",
    blocked_at: null,
    updated_at: "2026-08-17T01:05:00.000Z",
    ...overrides,
  };
}

test("product learning uses stable product kinds across Korean and English titles", () => {
  assert.equal(productLearningKey("레드 립스틱 화장품"), "beauty.lipstick");
  assert.equal(productLearningKey("Premium lipstick cosmetics"), "beauty.lipstick");
  assert.equal(productLearningKey("메이크업 브러시 8종"), "beauty.brush");
  assert.equal(productLearningKey("Cica facial toner skincare"), "beauty.toner");
  assert.equal(productLearningKey("Wooden toy train"), "toy.train");
  assert.equal(productLearningKey("어유 오메가3 소프트젤"), "health.fish_oil");
});

test("the six customer product groups resolve to distinct reusable kinds", () => {
  const cases = [
    ["메이크업 팔레트 화장품", "beauty.eyeshadow"],
    ["펜네 파스타 식품", "food.pasta"],
    ["여성 데님 원피스", "clothing.dress"],
    ["컬러 블록 장난감", "toy.blocks"],
    ["비타민 정제 건강식품", "health.vitamin"],
    ["생활 수납 박스 잡화", "misc.storage_box"],
  ] as const;
  for (const [title, expected] of cases) assert.equal(productLearningKey(title), expected);
});

test("semantic guard rejects a confidently wrong product family and risky audience", () => {
  assert.equal(categoryKindCompatibility("비타민 정제 건강식품", "Pet Supplies > Dog Vitamins"), false);
  assert.equal(categoryKindCompatibility("여성 데님 원피스", "Toys > Dress Up Costumes"), false);
  assert.equal(categoryKindCompatibility("즉석 흰쌀밥", "Kitchen Appliances > Rice Cookers"), false);
  assert.equal(categoryKindCompatibility("비타민 정제 건강식품", "Health > Adult Vitamins"), true);
  assert.equal(categoryKindCompatibility("Cica facial toner skincare", "Beauty > Beauty Supplements"), false);
  assert.equal(categoryKindCompatibility("Cica facial toner skincare", "Beauty > Toners & Mists"), true);
});

test("learning removes an explicit cross-kind provider suggestion", () => {
  const suggestions: LearnableCategorySuggestion[] = [
    { id: "mascara", name: "Mascara", path: ["Beauty", "Mascara"], confidence: 0.99, leaf: true },
    { id: "lip", name: "Lipstick", path: ["Beauty", "Lipstick"], confidence: 0.74, leaf: true },
  ];
  const learned = applyCategoryLearning("레드 립스틱 화장품", suggestions, []);
  assert.deepEqual(learned.map((item) => item.id), ["lip"]);
});

test("a successful category outranks a higher-confidence generic API suggestion", () => {
  const learned = applyCategoryLearning("Premium lipstick", official, [example()]);
  assert.equal(learned[0]?.id, "lip");
  assert.equal(learned[0]?.learning?.successfulListings, 1);
  assert.equal(learned[0]?.learning?.learnedFromHistory, true);
});

test("a previously published category is reused even when the suggestion endpoint omits it", () => {
  const learned = applyCategoryLearning("립스틱 신상품", [official[0]], [example()]);
  assert.equal(learned[0]?.id, "lip");
  assert.deepEqual(learned[0]?.path, ["Beauty", "Makeup", "Lipstick"]);
});

test("learning never crosses distinct product kinds", () => {
  const learned = applyCategoryLearning("메이크업 브러시 세트", official, [example()]);
  assert.equal(learned.some((item) => item.learning?.successfulListings), false);
});

test("a successful but semantically wrong toner history is never reintroduced", () => {
  const wrongHistory = example({
    product_name: "Cica facial toner skincare",
    category_id: "brush",
    category_path: ["Beauty", "Makeup", "Makeup Brushes"],
  });
  const suggestions: LearnableCategorySuggestion[] = [
    { id: "toner", name: "Toners & Mists", path: ["Beauty", "Skin Care", "Toners & Mists"], confidence: 0.82, leaf: true },
  ];
  const learned = applyCategoryLearning("Cica facial toner skincare", suggestions, [wrongHistory]);
  assert.deepEqual(learned.map((item) => item.id), ["toner"]);
});

test("a later category-permission rejection demotes the blocked category", () => {
  const blocked = example({
    assignment_status: "rejected",
    listing_success: false,
    permission_blocked: true,
    published_at: null,
    blocked_at: "2026-08-18T01:00:00.000Z",
    updated_at: "2026-08-18T01:00:00.000Z",
  });
  const learned = applyCategoryLearning("립스틱 신상품", official, [example(), blocked]);
  assert.equal(learned.at(-1)?.id, "lip");
  assert.equal(learned.at(-1)?.learning?.permissionBlocked, true);
});

test("a verified success after a permission failure restores the category", () => {
  const blocked = example({
    assignment_status: "rejected",
    listing_success: false,
    permission_blocked: true,
    published_at: null,
    blocked_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
  });
  const laterSuccess = example({
    published_at: "2026-08-19T01:00:00.000Z",
    updated_at: "2026-08-19T01:00:00.000Z",
  });
  const learned = applyCategoryLearning("립스틱 신상품", official, [blocked, laterSuccess]);
  assert.equal(learned[0]?.id, "lip");
  assert.equal(learned[0]?.learning?.permissionBlocked, false);
});
