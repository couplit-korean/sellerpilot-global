import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { buildAssetImagePrompt } from "../lib/ai-image-planning";
import {
  buildDifferenceHash,
  buildDuplicateRetryGuidance,
  findDuplicateShot,
  MAXIMUM_SHOT_GENERATION_ATTEMPTS,
  MAXIMUM_SHOT_GENERATION_RETRIES,
  MINIMUM_SHOT_HASH_DISTANCE,
  SHOT_DHASH_BYTES,
  visualHashDistance,
} from "../lib/image-shot-uniqueness";
import {
  assertDistinctSettingShotPlan,
  buildProductSettingShotPlan,
  settingShotAssetIds,
  settingShotDimensions,
} from "../lib/product-setting-shots";
import type { ProductStudioResult } from "../app/product-studio-types";

const baseResult: ProductStudioResult = {
  mode: "cli",
  product: {
    name: "검증 상품",
    category: "일반상품",
    oneLine: "촬영 계약 검증용 상품",
    targetCustomer: "일반 구매자",
    features: ["확인된 외형"],
    cautions: [],
  },
  design: {
    themeName: "검증",
    palette: { primary: "#222222", accent: "#777777", surface: "#f6f6f6", text: "#111111" },
    heroCopy: "상품",
    heroSubcopy: "검증",
    cta: "보기",
    sections: [],
  },
  thumbnail: { headline: "상품", subline: "검증", badge: "" },
  localizedListings: [],
  warnings: [],
};

test("all nine product groups enforce six semantic setting-shot boundaries", () => {
  const groups = [
    ["beauty-skincare", "보습 스킨케어 크림"],
    ["beauty-tools", "메이크업 브러시 세트"],
    ["food-staples", "펜네 파스타 일반식품"],
    ["food-staples", "초콜릿 시리얼"],
    ["food-staples", "드립 커피 원두"],
    ["men-tops", "남성 후드 티셔츠"],
    ["toys-games", "조립 완구"],
    ["food-supplement", "오메가3 건강기능식품"],
    ["general-commerce", "수납 정리 생활용품"],
  ] as const;

  assert.deepEqual(settingShotDimensions, ["location", "moment", "surface", "supportingObjects", "staging", "camera"]);
  for (const [category, productText] of groups) {
    const plan = buildProductSettingShotPlan(category, productText);
    assert.deepEqual(Object.keys(plan), settingShotAssetIds);
    for (const dimension of settingShotDimensions) {
      assert.equal(new Set(Object.values(plan).map((shot) => shot.separation[dimension])).size, 4, `${category}/${productText}/${dimension} semantic key`);
      assert.equal(new Set(Object.values(plan).map((shot) => shot[dimension])).size, 4, `${category}/${productText}/${dimension} instruction`);
    }
  }
});

test("the setting-shot validator rejects a future semantic or camera collision", () => {
  const locationCollision = structuredClone(buildProductSettingShotPlan("beauty-skincare", "보습 크림"));
  locationCollision.wide.separation.location = locationCollision.portrait.separation.location;
  assert.throws(() => assertDistinctSettingShotPlan(locationCollision, "collision"), /location 의미 분리 계약/);

  const cameraCollision = structuredClone(buildProductSettingShotPlan("toys-games", "조립 완구"));
  cameraCollision["detail-use"].camera = cameraCollision.portrait.camera;
  assert.throws(() => assertDistinctSettingShotPlan(cameraCollision, "collision"), /camera 촬영 지시/);
});

test("hero, square, feature and package have mutually exclusive purpose, crop, placement and camera contracts", () => {
  const criticalIds = ["hero", "square", "detail-feature", "detail-package"] as const;
  const critical = criticalIds.map((id) => aiGeneratedAssetSpecs.find((asset) => asset.id === id)!);
  for (const key of ["purpose", "shotClass", "composition", "subjectPlacement", "scene", "camera"] as const) {
    assert.equal(new Set(critical.map((asset) => asset[key])).size, critical.length, key);
  }
  for (const asset of critical) {
    assert.ok(asset.mustDifferFrom.length >= 3);
    assert.ok(asset.mustDifferFrom.every((opponent) => opponent !== asset.id));
    const prompt = buildAssetImagePrompt(baseResult, `/tmp/${asset.file}`, asset, ["main", "front", "back", "top"]);
    assert.match(prompt, new RegExp(`Hard shot class: ${asset.shotClass}`));
    assert.match(prompt, /Series role manifest \(all eight are mutually exclusive\)/);
    assert.match(prompt, /Mandatory role self-QA before finishing/);
  }

  const heroPrompt = buildAssetImagePrompt(baseResult, "/tmp/hero.png", critical[0], ["main", "front"]);
  const squarePrompt = buildAssetImagePrompt(baseResult, "/tmp/square.png", critical[1], ["main", "front"]);
  const featurePrompt = buildAssetImagePrompt(baseResult, "/tmp/feature.png", critical[2], ["main", "label"]);
  const packagePrompt = buildAssetImagePrompt(baseResult, "/tmp/package.png", critical[3], ["main", "back", "top"]);
  assert.match(heroPrompt, /오른쪽 1\/3 배치와 왼쪽 네거티브 공간/);
  assert.match(squarePrompt, /순백 배경의 완전 정면 상품 식별컷/);
  assert.match(featurePrompt, /전체 패키지 금지/);
  assert.match(packagePrompt, /상단 봉합·뚜껑과 측면 또는 후면/);
});

test("the exact SHA-256 and 256-bit dHash gate allows an initial image plus three materially different retries", () => {
  const tinyHash = buildDifferenceHash(Uint8Array.from([
    3, 2, 1,
    1, 2, 3,
  ]), 3, 2);
  assert.deepEqual(tinyHash, Uint8Array.from([0b1100_0000]));
  assert.throws(() => buildDifferenceHash(new Uint8Array(5), 3, 2), /dHash 픽셀이 부족/);
  assert.equal(SHOT_DHASH_BYTES, 32);
  assert.ok(MINIMUM_SHOT_HASH_DISTANCE >= 64);
  assert.equal(MAXIMUM_SHOT_GENERATION_RETRIES, 3);
  assert.equal(MAXIMUM_SHOT_GENERATION_ATTEMPTS, 4);

  const base = { assetId: "hero", digest: "sha", visualHash: new Uint8Array(SHOT_DHASH_BYTES) };
  const exact = findDuplicateShot({ assetId: "square", digest: "sha", visualHash: new Uint8Array(SHOT_DHASH_BYTES).fill(255) }, [base]);
  assert.equal(exact?.exact, true);
  const closeHash = new Uint8Array(SHOT_DHASH_BYTES);
  closeHash[0] = 1;
  const close = findDuplicateShot({ assetId: "wide", digest: "other", visualHash: closeHash }, [base]);
  assert.equal(close?.exact, false);
  assert.equal(close?.distance, 1);
  assert.equal(visualHashDistance(base.visualHash, closeHash), 1);

  const firstRetry = buildDuplicateRetryGuidance("wide", "portrait", 1);
  const thirdRetry = buildDuplicateRetryGuidance("wide", "portrait", 3);
  assert.notEqual(firstRetry, thirdRetry);
  assert.match(firstRetry, /retry 1 of 3/);
  assert.match(firstRetry, /azimuth at least 45 degrees/);
  assert.match(thirdRetry, /retry 3 of 3/);
  assert.match(thirdRetry, /opposite permitted camera height/);
});

test("individual regeneration rejects exact and near duplicates of the pre-replacement target", () => {
  const previousTarget = {
    assetId: "previous:detail-use",
    digest: "old-target-digest",
    visualHash: new Uint8Array(SHOT_DHASH_BYTES),
  };
  const exact = findDuplicateShot({
    assetId: "detail-use",
    digest: "old-target-digest",
    visualHash: new Uint8Array(SHOT_DHASH_BYTES).fill(255),
  }, [previousTarget]);
  assert.equal(exact?.assetId, "previous:detail-use");
  assert.equal(exact?.exact, true);

  const nearHash = new Uint8Array(SHOT_DHASH_BYTES);
  nearHash[0] = 1;
  const near = findDuplicateShot({
    assetId: "detail-use",
    digest: "new-target-digest",
    visualHash: nearHash,
  }, [previousTarget]);
  assert.equal(near?.assetId, "previous:detail-use");
  assert.equal(near?.exact, false);
  assert.equal(near?.distance, 1);
});

test("both full-series and individual-regeneration worker paths use the same hash gate and initial-plus-three-retry loop", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  const claimRoute = await readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8");
  assert.equal(worker.match(/await generateDistinctAsset\(\{/g)?.length, 2);
  assert.match(worker, /for \(let attempt = 1; attempt <= MAXIMUM_SHOT_GENERATION_ATTEMPTS; attempt \+= 1\)/);
  assert.match(worker, /await rm\(outputFile, \{ force: true \}\)/);
  assert.match(worker, /createHash\("sha256"\)\.update\(buffer\)/);
  assert.match(worker, /\.flatten\(\{ background: "#ffffff" \}\)/);
  assert.match(worker, /pixels\.length !== \(SHOT_DHASH_COLUMNS \+ 1\) \* SHOT_DHASH_ROWS/);
  assert.match(worker, /buildDifferenceHash\(pixels\)/);
  assert.match(worker, /findDuplicateShot\(fingerprint, existingShots\)/);
  assert.match(worker, /downloadComparisonShots\(job, preset\.id\)/);
  assert.match(worker, /expectedAssetIds[\s\S]*assetId !== targetAssetId/);
  assert.match(worker, /const previousAssetId = `previous:\$\{targetAssetId\}`/);
  assert.match(worker, /comparisonById\.size !== expectedAssetIds\.length \+ 1/);
  assert.match(worker, /\[\.\.\.expectedAssetIds, previousAssetId\]/);
  assert.match(claimRoute, /candidate\.id === assetId \? `previous:\$\{candidate\.id\}` : candidate\.id/);
  assert.match(worker, /existingShots\.length !== imagePresets\.length/);
  assert.match(worker, /match=\$\{duplicate\.exact \? "sha256" : "dhash"\}/);
});
