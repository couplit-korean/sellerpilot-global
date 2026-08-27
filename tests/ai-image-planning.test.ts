import assert from "node:assert/strict";
import test from "node:test";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import {
  AI_ASSET_PROMPT_VERSION,
  buildAssetImagePrompt,
  requiresSourceIdentityProtection,
  resolveIdentityBackgroundContactMode,
  resolveProductImageStyleCategory,
  resolveProductIdentityBackgroundContract,
  resolveProductSettingShot,
  selectAssetReferenceIndexes,
} from "../lib/ai-image-planning";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import {
  buildProductSettingShotPlan,
  buildSettingShotRetryVariant,
  settingShotAssetIds,
} from "../lib/product-setting-shots";
import {
  buildDuplicateRetryGuidance,
  findDuplicateShot,
  MINIMUM_SHOT_HASH_DISTANCE,
  visualHashDistance,
} from "../lib/image-shot-uniqueness";
import type { ProductStudioResult } from "../app/product-studio-types";

const sourceSpecs = [
  { role: "main" },
  { role: "front" },
  { role: "back" },
  { role: "left" },
  { role: "right" },
  { role: "top" },
  { role: "bottom" },
  { role: "label" },
  { role: "barcode" },
  { role: "extra-1" },
];

const result: ProductStudioResult = {
  mode: "cli",
  product: {
    name: "White ceramic mug",
    category: "Drinkware",
    classification: { displayName: "일반상품", verificationStatus: "verified", evidence: "원본 상품 사진", isHealthFunctionalFood: false },
    oneLine: "A plain white ceramic mug.",
    targetCustomer: "Coffee drinkers",
    features: ["Ceramic body", "Handle", "White finish"],
    cautions: ["Confirm dimensions before listing."],
  },
  design: {
    themeName: "Quiet tableware",
    creativeStrategy: {
      designArchetype: "proof-led",
      purchaseDecision: "Confirm the visible material, form and included item.",
      contentDensity: "long",
      targetSectionCount: 16,
      lengthRationale: "Each section answers a different purchase question.",
      differentiationKey: "Visible white ceramic form",
      artDirection: "Source-faithful quiet tableware photography",
      motionPolicy: "static-first",
    },
    palette: { primary: "#262626", accent: "#b7895b", surface: "#f6f2ed", text: "#171717" },
    heroCopy: "A calm coffee moment",
    heroSubcopy: "A white ceramic mug for daily drinks.",
    cta: "View details",
    sections: [],
  },
  thumbnail: { headline: "White mug", subline: "Ceramic", badge: "1 piece" },
  localizedListings: [],
  warnings: [],
};

test("each detail image selects the uploaded views that match its factual role", () => {
  assert.deepEqual(selectAssetReferenceIndexes(sourceSpecs, "detail-feature", sourceSpecs.length), [0, 7, 1, 3, 4, 2]);
  assert.deepEqual(selectAssetReferenceIndexes(sourceSpecs, "detail-package", sourceSpecs.length), [0, 2, 7, 8, 5, 6]);
  assert.deepEqual(selectAssetReferenceIndexes(sourceSpecs, "detail-use", sourceSpecs.length), [0, 1, 3, 4, 9, 2]);
});

test("the sixteen assets keep twelve mutually distinct detail roles and claim-scoped paths", () => {
  const detailPresets = aiGeneratedAssetSpecs.filter((asset) => asset.role === "detail");
  const prompts = detailPresets.map((preset) => buildAssetImagePrompt(result, `/tmp/${preset.file}`, preset, ["main", ...preset.referenceRoles]));
  assert.equal(aiGeneratedAssetSpecs.length, 16);
  assert.equal(detailPresets.length, 12);
  assert.equal(new Set(aiGeneratedAssetSpecs.map((asset) => asset.id)).size, 16);
  assert.equal(new Set(aiGeneratedAssetSpecs.map((asset) => asset.file)).size, 16);
  assert.equal(new Set(prompts).size, 12);
  assert.ok(prompts.every((prompt) => prompt.includes(AI_ASSET_PROMPT_VERSION)));
  assert.ok(prompts.every((prompt) => prompt.includes("all sixteen are mutually exclusive")));
  assert.ok(prompts.every((prompt) => prompt.includes("Label fidelity:")));
  assert.match(prompts[0], /high rear overview camera/);
  assert.match(prompts[1], /direct crop from the verified source view/);
  assert.match(prompts[2], /table-level camera/);
  assert.match(prompts[3], /direct crop from the selected supplied evidence view/);
  assert.ok(prompts.every((prompt) => prompt.includes("중립적인 상업 사진")), "unknown categories must not fall back to skincare styling");
  const hero = aiGeneratedAssetSpecs[0];
  assert.equal(aiGeneratedAssetPath("job-id", hero, "claim-token"), "results/job-id/claims/claim-token/hero.png");
  assert.equal(aiGeneratedAssetPath("job-id", hero), "results/job-id/hero.png");
  assert.ok(aiGeneratedAssetSpecs.every((asset) => asset.identityPolicy.mode && asset.shotClass && asset.mustDifferFrom.length > 0));
});

test("food use imagery selects a preparation or use shot instead of package quantity", () => {
  const foodResult = { ...result, product: { ...result.product, category: "식품", name: "초콜릿 시리얼" } };
  const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-use");
  assert.ok(preset);
  const prompt = buildAssetImagePrompt(foodResult, "/tmp/detail-use.png", preset, ["main", "front"]);
  assert.match(prompt, /Required shot for this slot: 조리 완성/);
  assert.doesNotMatch(prompt, /Required shot for this slot: 구성 수량/);
});

test("structured food classification wins over cream-like flavor copy while true skincare still uses beauty", () => {
  const creamSnack = {
    ...result,
    product: {
      ...result.product,
      category: "식품·음료 > 과자",
      name: "롯샌 순우유맛",
      features: ["부드러운 우유 크림 샌드"],
      classification: {
        displayName: "과자",
        verificationStatus: "verified" as const,
        evidence: "제품 전면 식품 표시",
        isHealthFunctionalFood: false,
      },
    },
  };
  const creamDrink = {
    ...creamSnack,
    product: { ...creamSnack.product, category: "음료", name: "크림 소다 음료" },
  };
  const skincare = {
    ...result,
    product: {
      ...result.product,
      category: "화장품 > 스킨케어",
      name: "보습 크림",
      features: ["크림 제형"],
    },
  };
  assert.equal(resolveProductImageStyleCategory(creamSnack).id, "food-staples");
  assert.equal(resolveProductImageStyleCategory(creamDrink).id, "food-staples");
  assert.equal(resolveProductImageStyleCategory(skincare).id, "beauty-skincare");
  assert.equal(resolveProductImageStyleCategory(result).id, "general-commerce", "Drinkware is not a drink category");
  assert.equal(resolveProductImageStyleCategory({
    ...result,
    product: { ...result.product, category: "Drinkware", name: "Coffee mug", features: ["Coffee cup handle"] },
  }).id, "general-commerce", "a non-empty unknown taxonomy must not fall through to food keywords");
  assert.match(resolveProductSettingShot(creamSnack, "portrait")?.location ?? "", /식료품|키친/);
  assert.doesNotMatch(resolveProductSettingShot(creamSnack, "portrait")?.location ?? "", /욕실|화장대/);
});

test("cereal generation assigns eight recognizably different real setting shots", () => {
  const cerealResult = { ...result, product: { ...result.product, category: "식품", name: "첵스초코 초코 시리얼" } };
  const prompts = settingShotAssetIds.map((assetId) => {
    const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(preset);
    return buildAssetImagePrompt(cerealResult, `/tmp/${preset.file}`, preset, ["main", "front"]);
  });
  const assignments = prompts.map((prompt) => prompt.match(/^Mandatory product-specific setting: (.+)$/m)?.[1] ?? "");
  assert.equal(new Set(assignments).size, 8);
  assert.ok(assignments.every(Boolean));
  assert.match(assignments[0], /아침 식탁/);
  assert.match(assignments[1], /주방.*조리대/);
  assert.match(assignments[2], /팬트리/);
  assert.match(assignments[3], /거실 소파/);
  assert.match(assignments[3], /창문·주방·다이닝 가구가 보이지 않는/);
  assert.match(assignments[3], /저녁/);
  assert.match(assignments[4], /현관.*준비 콘솔/);
  assert.match(assignments[5], /독립형 아일랜드/);
  assert.match(assignments[6], /서랍형 건식 식품 수납장/);
  assert.match(assignments[7], /홈오피스 창가 벽감/);
  assert.ok(prompts.every((prompt) => prompt.includes("A colored wall, geometric panel, gradient or pedestal is not a setting shot.")));
  assert.ok(prompts.every((prompt) => prompt.includes("Mandatory self-QA before finishing:")));
  assert.ok(prompts.every((prompt) => prompt.includes("30–45% of the frame")));
});

test("all nine production product groups receive eight distinct six-dimensional setting-shot contracts", () => {
  const categories = [
    ["스킨케어", "beauty-skincare", "보습 스킨케어 크림"],
    ["뷰티도구", "beauty-tools", "메이크업 브러시 세트"],
    ["일반식품", "food-staples", "펜네 파스타 식품"],
    ["시리얼", "food-staples", "초콜릿 시리얼"],
    ["커피·차", "food-staples", "드립 커피 원두"],
    ["남성의류", "men-tops", "남성 후드 티셔츠"],
    ["완구", "toys-games", "테디베어 완구"],
    ["건강기능식품", "food-supplement", "오메가3 건강기능식품"],
    ["일반상품", "general-commerce", "수납 정리 생활용품"],
  ] as const;
  for (const [label, category, productText] of categories) {
    const settingPlan = buildProductSettingShotPlan(category, productText);
    const shots = Object.values(settingPlan);
    assert.equal(shots.length, 8);
    for (const key of ["location", "moment", "surface", "supportingObjects", "staging", "camera"] as const) {
      assert.equal(new Set(shots.map((item) => item[key])).size, 8, `${label} must use eight different ${key} values`);
      assert.equal(new Set(shots.map((item) => item.separation[key])).size, 8, `${label} must use eight different ${key} semantic keys`);
    }
  }
});

test("catalog and factual inspection slots stay separate from all eight setting-shot slots", () => {
  for (const assetId of ["hero", "square", "detail-feature", "detail-package", "detail-material", "detail-dimensions", "detail-contents", "detail-care"] as const) {
    const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(preset);
    const prompt = buildAssetImagePrompt(result, `/tmp/${preset.file}`, preset, ["main", "front"]);
    assert.match(prompt, /Inspection-shot assignment:/);
    assert.doesNotMatch(prompt, /^Mandatory product-specific setting:/m);
  }
});

test("supplemental setting shots retain an explicit source-pixel background-only contract", () => {
  const cerealResult = { ...result, product: { ...result.product, category: "식품", name: "첵스초코 초코 시리얼" } };
  for (const assetId of ["detail-routine", "detail-scale", "detail-storage", "detail-context"] as const) {
    const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(preset);
    assert.equal(preset.identityPolicy.mode, "source-composite");
    const setting = resolveProductSettingShot(cerealResult, assetId);
    assert.ok(setting);
    const contract = resolveProductIdentityBackgroundContract(setting, assetId);
    assert.ok(contract);
    assert.match(contract.location.description, /empty fixed architectural envelope/);
    const prompt = buildAssetImagePrompt(cerealResult, `/tmp/${assetId}.png`, preset, [], "", "identity-background");
    assert.match(prompt, /HARD IDENTITY FIREWALL/);
    assert.match(prompt, /generate only an empty background plate/);
    assert.match(prompt, /authoritative product contact line/);
    assert.match(prompt, /support plane must visibly cross that line and continue below it/);
    assert.match(prompt, /Do not pre-render a product-shaped shadow, reflection, silhouette, footprint or imprint/);
    assert.doesNotMatch(prompt, /첵스초코/);
  }
});

test("trusted contact mode keeps packages surface-supported while hung garments stay planar", () => {
  const foodResult = {
    ...result,
    product: { ...result.product, category: "일반식품", name: "롯샌 파스퇴르 순우유맛 315 g", features: ["6봉 포장"] },
  };
  const menResult = {
    ...result,
    product: { ...result.product, category: "남성의류", name: "남성 무지 셔츠", features: ["면 소재"] },
  };
  const wallMountedResult = {
    ...result,
    product: { ...result.product, category: "일반상품", name: "벽걸이 케이블 정리 홀더", features: ["벽 부착형"] },
  };
  const foodWide = resolveProductSettingShot(foodResult, "wide");
  const menPortrait = resolveProductSettingShot(menResult, "portrait");
  const menWide = resolveProductSettingShot(menResult, "wide");
  assert.equal(resolveIdentityBackgroundContactMode(foodResult, foodWide), "surface-supported");
  assert.equal(resolveIdentityBackgroundContactMode(menResult, menPortrait), "suspended-or-planar");
  assert.equal(resolveIdentityBackgroundContactMode(menResult, menWide), "surface-supported");
  assert.equal(resolveIdentityBackgroundContactMode(wallMountedResult, resolveProductSettingShot(wallMountedResult, "portrait")), "suspended-or-planar");

  const portrait = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(portrait);
  const garmentPrompt = buildAssetImagePrompt(menResult, "/tmp/garment.png", portrait, [], "", "identity-background", menPortrait ?? undefined);
  assert.match(garmentPrompt, /trusted slot uses suspended-or-planar placement/);
  assert.match(garmentPrompt, /Do not force or invent a tabletop, shelf, pedestal or bottom contact line/);
  assert.doesNotMatch(garmentPrompt, /authoritative product contact line/);
});

test("package evidence never invents a closure or hidden package plane", () => {
  const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-package");
  assert.ok(preset);
  const prompt = buildAssetImagePrompt(result, `/tmp/${preset.file}`, preset, ["main", "back", "top"]);
  assert.match(prompt, /실제로 제공된 측면·후면·표시사항 패널/);
  assert.match(prompt, /do not claim a top closure, hidden plane or package structure/);
  assert.match(prompt, /no inferred high-oblique camera/);
  assert.doesNotMatch(prompt, /top closure plus a verified/);
});

test("statutory-package products use a background-only identity firewall", () => {
  const foodResult = {
    ...result,
    product: { ...result.product, category: "일반식품", name: "롯데 과자 315 g", features: ["HACCP 포장"] },
  };
  const apparelResult = {
    ...result,
    product: { ...result.product, category: "남성의류", name: "무지 면 티셔츠", features: ["면 소재"] },
  };
  assert.equal(requiresSourceIdentityProtection(foodResult), true);
  assert.equal(requiresSourceIdentityProtection(apparelResult), false);
  const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait");
  assert.ok(preset);
  const prompt = buildAssetImagePrompt(foodResult, "/tmp/background.png", preset, [], "", "identity-background");
  assert.match(prompt, /HARD IDENTITY FIREWALL/);
  assert.match(prompt, /generate only an empty background plate/);
  assert.match(prompt, /real product will be composited afterward from a verified transparent source-pixel cutout/);
  assert.match(prompt, /Mandatory empty-environment assignment:.*키친 아일랜드/);
  assert.match(prompt, /fixed architecture, built-in surfaces, natural light direction and spatial depth/);
  assert.match(prompt, /Slot-specific non-merchandise environmental cue \(grocery-unpacking-island-fixed-side-frame\): one integrated side reveal/);
  assert.match(prompt, /Deliberately omit every retail product, small saleable prop/);
  assert.doesNotMatch(prompt, /투명 시리얼 볼과 접힌 흰 리넨/);
  assert.doesNotMatch(prompt, /롯데 과자/);
  assert.doesNotMatch(prompt, /Input references in order/);
});

test("food dining background prompts require built-in dining cues and ban bathroom or showroom ambiguity", () => {
  const foodResult = {
    ...result,
    product: {
      ...result.product,
      category: "일반식품",
      name: "롯샌 파스퇴르 순우유맛 315 g",
      features: ["6봉 포장"],
    },
  };
  const detailUse = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-use");
  assert.ok(detailUse);
  const setting = resolveProductSettingShot(foodResult, "detail-use");
  assert.ok(setting);
  const retry = buildSettingShotRetryVariant(
    buildProductSettingShotPlan("food-staples", foodResult.product.name)["detail-use"],
    "detail-use",
    2,
  );
  const prompt = buildAssetImagePrompt(
    foodResult,
    "/tmp/food-detail-use.png",
    detailUse,
    [],
    "",
    "identity-background",
    retry,
  );
  assert.match(prompt, /at least two unmistakable fixed dining cues/);
  assert.match(prompt, /built-in banquette back/);
  assert.match(prompt, /floor-to-ceiling wet-room tile/);
  assert.match(prompt, /retail showroom, abstract gallery, generic empty shelf/);
  assert.match(prompt, /cobalt glazed tile/);

  const generalSetting = resolveProductSettingShot(result, "detail-use");
  assert.ok(generalSetting);
  const generalPrompt = buildAssetImagePrompt(
    result,
    "/tmp/general-detail-use.png",
    detailUse,
    [],
    "",
    "identity-background",
    generalSetting,
  );
  assert.doesNotMatch(generalPrompt, /fixed room-recognition contract/i);
  assert.doesNotMatch(generalPrompt, /floor-to-ceiling wet-room tile/);
});

test("failed order and inquiry reads are stored as failed gateway jobs", () => {
  assert.equal(gatewayJobCompletionStatus("orders.list", false), "failed");
  assert.equal(gatewayJobCompletionStatus("inquiries.list", false), "failed");
  assert.equal(gatewayJobCompletionStatus("listing.create", false), "succeeded");
  assert.equal(gatewayJobCompletionStatus("diagnostic.test", false), "succeeded");
});

test("a trusted provider mutation followed by failed verification requires reconciliation", () => {
  const cases = [
    ["listing.create", "product-create"],
    ["listing.update", "listing.update"],
    ["listing.stop", "goods-off-shelf"],
    ["price.update", "bulk-price"],
    ["inventory.update", "bulk-inventory"],
    ["shipment.acknowledge", "pack"],
    ["shipment.confirm", "shipment-confirm"],
  ] as const;
  for (const [operation, mutation] of cases) {
    assert.equal(gatewayJobCompletionStatus(operation, false, [
      { name: mutation, ok: true },
      { name: "inventory-readback", ok: false },
    ]), "reconciliation_required", operation);
  }

  assert.equal(gatewayJobCompletionStatus("inventory.update", false, [
    { name: "inventory-item-readback", ok: true },
    { name: "inventory.update", ok: false },
  ]), "succeeded", "an explicit provider rejection before mutation remains a structured failure");
  assert.equal(gatewayJobCompletionStatus("inventory.update", false, [
    { name: "inventory-readback", ok: true },
    { name: "inventory.update", ok: false },
  ]), "succeeded", "successful readback/preflight steps are not mutations");
  assert.equal(gatewayJobCompletionStatus("shipment.confirm", false, [
    { name: "shipping-fulfillment", ok: false, status: 503 },
  ]), "reconciliation_required", "a provider 5xx on the exact mutation request is an ambiguous write outcome");
  assert.equal(gatewayJobCompletionStatus("listing.update", false, [
    { name: "listing.update", ok: false, status: 408 },
  ]), "reconciliation_required", "a timeout response on the exact mutation request is ambiguous");
  assert.equal(gatewayJobCompletionStatus("listing.update", false, [
    { name: "listing.update", ok: false, status: 429 },
  ]), "succeeded", "a non-ambiguous provider rejection remains a structured failure");
  assert.equal(gatewayJobCompletionStatus("inventory.update", false, [
    { name: "inventory.update", ok: false, status: 409 },
    { name: "inventory-readback", ok: false, status: 503 },
  ]), "succeeded", "a readback 5xx cannot turn an explicitly rejected mutation into an observed write");
});

test("generated shots reject exact and perceptually close duplicates", () => {
  const base = { assetId: "hero", digest: "same", visualHash: Uint8Array.from([0, 0, 0, 0]) };
  const exact = findDuplicateShot({ assetId: "wide", digest: "same", visualHash: Uint8Array.from([255, 255, 255, 255]) }, [base]);
  assert.equal(exact?.assetId, "hero");
  assert.equal(exact?.exact, true);

  const close = findDuplicateShot({ assetId: "detail-use", digest: "different", visualHash: Uint8Array.from([0, 0, 0, 1]) }, [base], 2);
  assert.equal(close?.distance, 1);
  assert.equal(visualHashDistance(base.visualHash, Uint8Array.from([255, 255, 255, 255])), 32);
  assert.ok(MINIMUM_SHOT_HASH_DISTANCE > 32);
  assert.match(buildDuplicateRetryGuidance("detail-use", "hero", 2), /different camera height and angle/);
});
