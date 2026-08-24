import assert from "node:assert/strict";
import test from "node:test";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { AI_ASSET_PROMPT_VERSION, buildAssetImagePrompt, selectAssetReferenceIndexes } from "../lib/ai-image-planning";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import { buildProductSettingShotPlan, settingShotAssetIds } from "../lib/product-setting-shots";
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
    oneLine: "A plain white ceramic mug.",
    targetCustomer: "Coffee drinkers",
    features: ["Ceramic body", "Handle", "White finish"],
    cautions: ["Confirm dimensions before listing."],
  },
  design: {
    themeName: "Quiet tableware",
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
  assert.deepEqual(selectAssetReferenceIndexes(sourceSpecs, "detail-feature", sourceSpecs.length), [0, 7, 1, 3, 4, 5]);
  assert.deepEqual(selectAssetReferenceIndexes(sourceSpecs, "detail-package", sourceSpecs.length), [0, 2, 7, 8, 5, 6]);
  assert.deepEqual(selectAssetReferenceIndexes(sourceSpecs, "detail-use", sourceSpecs.length), [0, 1, 3, 4, 9, 2]);
});

test("the four detail slots receive visibly distinct scene and camera contracts", () => {
  const detailPresets = aiGeneratedAssetSpecs.filter((asset) => asset.role === "detail");
  const prompts = detailPresets.map((preset) => buildAssetImagePrompt(result, `/tmp/${preset.file}`, preset, ["main", ...preset.referenceRoles]));
  assert.equal(new Set(prompts).size, 4);
  assert.ok(prompts.every((prompt) => prompt.includes(AI_ASSET_PROMPT_VERSION)));
  assert.match(prompts[0], /environmental overview camera/);
  assert.match(prompts[1], /macro or close-focus/);
  assert.match(prompts[2], /medium environmental camera/);
  assert.match(prompts[3], /true overhead flat-lay camera/);
  assert.ok(prompts.every((prompt) => prompt.includes("중립적인 상업 사진")), "unknown categories must not fall back to skincare styling");
});

test("food use imagery selects a preparation or use shot instead of package quantity", () => {
  const foodResult = { ...result, product: { ...result.product, category: "식품", name: "초콜릿 시리얼" } };
  const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-use");
  assert.ok(preset);
  const prompt = buildAssetImagePrompt(foodResult, "/tmp/detail-use.png", preset, ["main", "front"]);
  assert.match(prompt, /Required shot for this slot: 조리 완성/);
  assert.doesNotMatch(prompt, /Required shot for this slot: 구성 수량/);
});

test("cereal generation assigns four recognizably different real setting shots", () => {
  const cerealResult = { ...result, product: { ...result.product, category: "식품", name: "첵스초코 초코 시리얼" } };
  const prompts = settingShotAssetIds.map((assetId) => {
    const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(preset);
    return buildAssetImagePrompt(cerealResult, `/tmp/${preset.file}`, preset, ["main", "front"]);
  });
  const assignments = prompts.map((prompt) => prompt.match(/^Mandatory product-specific setting: (.+)$/m)?.[1] ?? "");
  assert.equal(new Set(assignments).size, 4);
  assert.ok(assignments.every(Boolean));
  assert.match(assignments[0], /아침 식탁/);
  assert.match(assignments[1], /주방.*조리대/);
  assert.match(assignments[2], /팬트리/);
  assert.match(assignments[3], /거실 소파/);
  assert.match(assignments[3], /창문·주방·다이닝 가구가 보이지 않는/);
  assert.match(assignments[3], /저녁/);
  assert.ok(prompts.every((prompt) => prompt.includes("A colored wall, geometric panel, gradient or pedestal is not a setting shot.")));
  assert.ok(prompts.every((prompt) => prompt.includes("Mandatory self-QA before finishing:")));
  assert.ok(prompts.every((prompt) => prompt.includes("30–45% of the frame")));
});

test("every learned category receives four different places and surface materials", () => {
  const categories = ["beauty-skincare", "beauty-tools", "food-staples", "men-tops", "toys-games", "food-supplement", "general-commerce"];
  for (const category of categories) {
    const settingPlan = buildProductSettingShotPlan(category, category === "food-staples" ? "파스타 식품" : category);
    const shots = Object.values(settingPlan);
    assert.equal(shots.length, 4);
    assert.equal(new Set(shots.map((item) => item.location)).size, 4, `${category} must use four locations`);
    assert.equal(new Set(shots.map((item) => item.surface)).size, 4, `${category} must use four surface treatments`);
  }
});

test("catalog and factual inspection slots stay separate from setting-shot slots", () => {
  for (const assetId of ["hero", "square", "detail-feature", "detail-package"] as const) {
    const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(preset);
    const prompt = buildAssetImagePrompt(result, `/tmp/${preset.file}`, preset, ["main", "front"]);
    assert.match(prompt, /Inspection-shot assignment:/);
    assert.doesNotMatch(prompt, /^Mandatory product-specific setting:/m);
  }
});

test("failed order and inquiry reads are stored as failed gateway jobs", () => {
  assert.equal(gatewayJobCompletionStatus("orders.list", false), "failed");
  assert.equal(gatewayJobCompletionStatus("inquiries.list", false), "failed");
  assert.equal(gatewayJobCompletionStatus("listing.create", false), "succeeded");
  assert.equal(gatewayJobCompletionStatus("diagnostic.test", false), "succeeded");
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
