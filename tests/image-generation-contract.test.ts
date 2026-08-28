import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aiGeneratedAssetSpecs,
  resolveProductIdentityPlacement,
} from "../lib/ai-generated-assets";
import { resolveIdentityBackgroundContract } from "../lib/ai-background-audit";
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
  buildSettingShotRetryGuidance,
  buildSettingShotRetryVariant,
  buildProductSettingShotPlan,
  mergeSettingShotRetryAuditFeedback,
  settingShotAssetIds,
  settingShotDimensions,
} from "../lib/product-setting-shots";
import type { ProductStudioResult } from "../app/product-studio-types";

const baseResult: ProductStudioResult = {
  mode: "cli",
  product: {
    name: "검증 상품",
    category: "일반상품",
    classification: { displayName: "일반상품", verificationStatus: "verified", evidence: "원본 상품 사진", isHealthFunctionalFood: false },
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
      assert.equal(new Set(Object.values(plan).map((shot) => shot.separation[dimension])).size, 8, `${category}/${productText}/${dimension} semantic key`);
      assert.equal(new Set(Object.values(plan).map((shot) => shot[dimension])).size, 8, `${category}/${productText}/${dimension} instruction`);
    }
  }
});

test("worker retries only missing or decoder-rejected Codex image artifacts inside the existing role budget", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  const normalizeStart = worker.indexOf("async function normalizeGeneratedAsset(");
  const normalizeEnd = worker.indexOf("function createAssetGenerationRetryState(", normalizeStart);
  const normalizeSource = worker.slice(normalizeStart, normalizeEnd);
  const generateStart = worker.indexOf("async function generateDistinctAsset(");
  const generateEnd = worker.indexOf("async function prepareProductImageBatchLoserRetry(", generateStart);
  const generateSource = worker.slice(generateStart, generateEnd);

  assert.ok(normalizeStart > 0 && normalizeEnd > normalizeStart);
  assert.match(normalizeSource, /isMissingGeneratedImageOutput\(error\)[\s\S]*RetryableGeneratedImageOutputError\("missing-output", preset\.id\)/);
  assert.match(normalizeSource, /outputStats\.size < 1[\s\S]*RetryableGeneratedImageOutputError\("empty-output", preset\.id\)/);
  assert.match(normalizeSource, /isObviousGeneratedImageDecodeFailure\(error\)[\s\S]*RetryableGeneratedImageOutputError\("undecodable-output", preset\.id\)/);
  assert.match(generateSource, /attempt < maximumAttempt[\s\S]{0,160}error instanceof RetryableGeneratedImageOutputError/);
  assert.match(generateSource, /\[이미지 산출물 재시도\][\s\S]{0,240}reason=\$\{error\.reason\}[\s\S]{0,400}continue/);
  assert.match(generateSource, /for \(let attempt = startingAttempt; attempt <= maximumAttempt; attempt \+= 1\)/);
  assert.match(generateSource, /maximumAttempt > MAXIMUM_SHOT_GENERATION_ATTEMPTS/);

  const outputRetryCatchEnd = generateSource.indexOf("const compositeSource", generateSource.indexOf("retryableMissingOrUndecodableOutput"));
  const deterministicQualityStart = generateSource.indexOf("assertIdentityBackgroundPlate", outputRetryCatchEnd);
  assert.ok(outputRetryCatchEnd > 0 && deterministicQualityStart > outputRetryCatchEnd);
  assert.doesNotMatch(generateSource.slice(0, outputRetryCatchEnd), /assertIdentityBackgroundPlate|auditGeneratedIdentityBackground|verifyGeneratedLabelFidelity/);
});

test("different real food products receive deterministic cross-product variation in every corresponding setting slot", () => {
  const products = [
    {
      detectionText: "식품·음료 > 과자 롯샌 파스퇴르 순우유맛 315 g 부드러운 우유 크림 샌드",
      sceneIdentityText: "식품·음료 > 과자 롯샌 파스퇴르 순우유맛 315 g",
    },
    {
      detectionText: "일반식품 사조 살코기 참치 안심따개 100 g 통조림",
      sceneIdentityText: "일반식품 사조 살코기 참치 안심따개 100 g",
    },
    {
      detectionText: "일반식품 BEYOND ORIGIN 애사비 젤리스틱 15 g 14개 기타가공품",
      sceneIdentityText: "일반식품 BEYOND ORIGIN 애사비 젤리스틱 15 g 14개",
    },
  ] as const;
  const plans = products.map((product) => buildProductSettingShotPlan(
    "food-staples",
    product.detectionText,
    product.sceneIdentityText,
  ));

  assert.deepEqual(
    buildProductSettingShotPlan("food-staples", products[0].detectionText, products[0].sceneIdentityText),
    plans[0],
    "the same category and product identity must reproduce the exact plan",
  );
  for (const assetId of settingShotAssetIds) {
    for (const dimension of settingShotDimensions) {
      assert.equal(
        new Set(plans.map((plan) => plan[assetId][dimension])).size,
        products.length,
        `${assetId}/${dimension} must materially vary by product`,
      );
      assert.equal(
        new Set(plans.map((plan) => plan[assetId].separation[dimension])).size,
        products.length,
        `${assetId}/${dimension} semantic key must vary by product`,
      );
    }
    const preset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === assetId);
    assert.ok(preset);
    const placements = products.map((product) => resolveProductIdentityPlacement(preset, product.sceneIdentityText));
    assert.equal(new Set(placements.map((placement) => JSON.stringify(placement))).size, products.length, `${assetId}/actual placement`);
    assert.ok(placements.every((placement) => (
      placement.left >= 0
      && placement.top >= 0
      && placement.width > 0
      && placement.height > 0
      && placement.left + placement.width <= 1
      && placement.top + placement.height <= 1
    )));
  }
});

test("independent scene digest lanes avoid the known FNV collision and 5,000 full-plan identities", () => {
  const collisionPair = [
    "일반식품 테스트 일반식품 상품 90",
    "일반식품 테스트 일반식품 상품 234",
  ] as const;
  const pairPlans = collisionPair.map((identity) => buildProductSettingShotPlan(
    "food-staples",
    identity,
    identity,
  ));
  for (const assetId of settingShotAssetIds) {
    const changedDimensions = settingShotDimensions.filter((dimension) => (
      pairPlans[0][assetId].separation[dimension] !== pairPlans[1][assetId].separation[dimension]
    ));
    assert.ok(changedDimensions.length >= 5, `${assetId} must vary in at least five of six visual dimensions`);
    const preset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === assetId);
    assert.ok(preset);
    assert.notDeepEqual(
      resolveProductIdentityPlacement(preset, collisionPair[0]),
      resolveProductIdentityPlacement(preset, collisionPair[1]),
      `${assetId} must not reuse the prior colliding normalized placement`,
    );
  }

  const signatures = new Set<string>();
  for (let index = 0; index < 5_000; index += 1) {
    const identity = `일반식품 테스트 일반식품 상품 ${index}`;
    const first = buildProductSettingShotPlan("food-staples", identity, identity);
    const second = buildProductSettingShotPlan("food-staples", identity, identity);
    assert.deepEqual(second, first, `${identity} plan must be deterministic`);
    const signature = settingShotAssetIds.map((assetId) => {
      const preset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === assetId);
      assert.ok(preset);
      return [
        ...settingShotDimensions.map((dimension) => first[assetId].separation[dimension]),
        JSON.stringify(resolveProductIdentityPlacement(preset, identity)),
      ].join("|");
    }).join("\n");
    assert.equal(signatures.has(signature), false, `${identity} must have a unique full-plan signature`);
    signatures.add(signature);
  }
  assert.equal(signatures.size, 5_000);
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
    assert.match(prompt, /Series role manifest \(all sixteen are mutually exclusive\)/);
    assert.match(prompt, /Mandatory role self-QA before finishing/);
  }

  const heroPrompt = buildAssetImagePrompt(baseResult, "/tmp/hero.png", critical[0], ["main", "front"]);
  const squarePrompt = buildAssetImagePrompt(baseResult, "/tmp/square.png", critical[1], ["main", "front"]);
  const featurePrompt = buildAssetImagePrompt(baseResult, "/tmp/feature.png", critical[2], ["main", "label"]);
  const packagePrompt = buildAssetImagePrompt(baseResult, "/tmp/package.png", critical[3], ["main", "back", "top"]);
  assert.match(heroPrompt, /오른쪽 1\/3 배치와 왼쪽 네거티브 공간/);
  assert.match(squarePrompt, /순백 배경의 완전 정면 상품 식별컷/);
  assert.match(featurePrompt, /원본 픽셀 근접 증거컷/);
  assert.match(packagePrompt, /실제로 제공된 측면·후면·표시사항 패널/);
  assert.doesNotMatch(packagePrompt, /상단 봉합·뚜껑/);
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
  const evidenceRetry = buildDuplicateRetryGuidance("detail-feature", "square", 2, "source-evidence");
  assert.notEqual(firstRetry, thirdRetry);
  assert.match(firstRetry, /retry 1 of 3/);
  assert.match(firstRetry, /different camera height and angle/);
  assert.match(firstRetry, /azimuth at least 45 degrees/);
  assert.match(firstRetry, /HARD ROLE BLACKLIST: portrait/);
  assert.match(firstRetry, /factual product identity/);
  assert.doesNotMatch(firstRetry, /unchanged source product pixels/);
  assert.match(thirdRetry, /retry 3 of 3/);
  assert.match(thirdRetry, /opposite permitted camera height/);
  assert.match(thirdRetry, /faithful to the supplied references/);
  assert.match(evidenceRetry, /different permitted verified source view/);
  assert.match(evidenceRetry, /without fabricating a camera view or hidden product plane/);
  assert.match(evidenceRetry, /unchanged source product pixels/);
  assert.match(evidenceRetry, /never invent or redraw package text/);
  assert.doesNotMatch(evidenceRetry, /opposite permitted camera height/);
});

test("setting-shot retries deterministically replace all six scene dimensions without losing category context or source pixels", () => {
  const plan = buildProductSettingShotPlan("food-staples", "롯샌 순우유맛 크림 샌드 과자");
  const base = plan["detail-overview"];
  const variants = [1, 2, 3].map((retry) => buildSettingShotRetryVariant(base, "detail-overview", retry));
  for (const dimension of settingShotDimensions) {
    assert.equal(new Set([base, ...variants].map((shot) => shot.separation[dimension])).size, 4, dimension);
    assert.equal(new Set([base, ...variants].map((shot) => shot[dimension])).size, 4, dimension);
  }
  const functionalRoom = base.location.split(";")[0];
  assert.ok(variants.every((variant) => variant.location.includes(functionalRoom)));
  assert.ok(variants.every((variant) => !variant.location.includes(base.location)));
  assert.ok(variants.every((variant) => variant.camera.includes("AUTHORITATIVE replacement camera")));
  assert.ok(variants.every((variant) => variant.camera.includes("role-required height")));
  assert.ok(variants.every((variant) => variant.camera.includes("overrides and excludes the base camera description")));
  assert.ok(variants.every((variant) => !variant.camera.includes(base.camera)));
  assert.ok(variants.every((variant) => !/contact plane|contact geometry/i.test(variant.staging)));
  assert.ok(variants.every((variant) => /exact reserved product rectangle at its original left, top, width and height/.test(variant.staging)));
  assert.ok(variants.every((variant) => /fully quiet and unobstructed/.test(variant.staging)));
  assert.ok(variants.every((variant) => /persisted rectangle only/.test(variant.staging)));
  assert.ok(variants.every((variant) => !variant.staging.includes(base.staging)));
  assert.ok(variants.every((variant) => /mandatory functional room-recognition structures/.test(variant.supportingObjects)));
  assert.ok(variants.every((variant) => /assigned functional room/.test(variant.location)));
  assert.ok(variants.every((variant) => /at least two room-recognition structures/.test(variant.location)));
  assert.match(variants[0].supportingObjects, /rectangular built-in task-light recess/);
  assert.match(variants[1].supportingObjects, /fixed access threshold or cabinet toe-kick return/);
  assert.match(variants[2].supportingObjects, /fixed rectangular ventilation or transom panel/);
  assert.match(variants[1].location, /offset access aisle entirely readable in the larger uncovered side band/);
  assert.match(variants[1].location, /rear threshold outside the reserved quiet rectangle/);
  assert.match(variants[1].camera, /near-axial architectural view aligned to the uncovered side aisle/);
  assert.match(variants[1].camera, /without any major edge crossing the reserved quiet rectangle/);
  assert.match(variants[1].camera, /frame-centred threshold hidden behind the reserved quiet rectangle/);
  assert.match(variants[1].camera, /paired left and right built-ins whose major edges cross the reserved rectangle/);
  assert.match(variants[1].camera, /narrow functional-room reveal without two fixed cues/);
  assert.match(variants[1].camera, /vertical three-quarter/);

  const contracts = variants.map((variant) => resolveIdentityBackgroundContract(variant, "detail-overview"));
  for (const dimension of ["location", "moment", "surface", "camera", "palette", "spatialDepth", "prop"] as const) {
    assert.equal(new Set(contracts.map((contract) => contract[dimension].key)).size, 3, dimension);
    assert.ok(contracts.every((contract) => contract[dimension].key.length <= 64));
  }
  assert.match(contracts[0].moment.description, /sunset|post-sunset/);
  assert.match(contracts[1].moment.description, /blue-hour|twilight/);
  assert.match(contracts[2].moment.description, /midday/);
  assert.match(contracts[0].prop.description, /rectangular built-in task-light recess/);
  assert.match(contracts[1].prop.description, /fixed access threshold or cabinet toe-kick return/);
  assert.match(contracts[2].prop.description, /fixed rectangular ventilation or transom panel/);
  assert.ok(contracts.every((contract) => !/fixed-zone-divider/.test(contract.prop.key)));
  assert.ok(contracts.every((contract) => /architectural/.test(contract.camera.description)));
  assert.ok(contracts.every((contract) => /junction|convergence|vanishing/.test(contract.camera.description)));
  assert.ok(contracts.every((contract) => !/product|상품|source-composite|mask/i.test(contract.camera.description)));

  const cumulativeAudit = mergeSettingShotRetryAuditFeedback(
    {
      failedDimensions: ["time-light", "fixed-cue"],
      hardNegativeMomentKeys: ["portrait-warm-side-light"],
      hardNegativeCueKeys: ["portrait-fixed-vertical-post", "right-side-wall-return"],
    },
    {
      failedDimensions: ["camera", "fixed-cue", "INVALID VALUE"],
      hardNegativeCameraKeys: ["rejected-detail-overview-1-near-axial"],
      hardNegativeCueKeys: ["right-side-wall-return", "stepped-divider-array", "unsafe key!"],
    },
  );
  assert.deepEqual(cumulativeAudit.failedDimensions, ["time-light", "fixed-cue", "camera"]);
  assert.deepEqual(cumulativeAudit.hardNegativeCueKeys, [
    "portrait-fixed-vertical-post",
    "right-side-wall-return",
    "stepped-divider-array",
  ]);

  const guidance = buildSettingShotRetryGuidance(
    "detail-overview",
    ["portrait", "wide"],
    2,
    variants[1],
    cumulativeAudit,
  );
  assert.match(guidance, /HARD ROLE BLACKLIST: portrait, wide/);
  assert.match(guidance, /location=.*time\/light=.*surface=.*fixed cue=.*product placement=.*camera=/);
  assert.match(guidance, /Validated prior audit failure dimensions: time-light, fixed-cue, camera/);
  assert.match(guidance, /STRUCTURED FAILED-PLATE BLACKLIST/);
  assert.match(guidance, /time-light=portrait-warm-side-light/);
  assert.match(guidance, /camera=rejected-detail-overview-1-near-axial/);
  assert.match(guidance, /fixed-cue\/supporting-object=portrait-fixed-vertical-post\|right-side-wall-return\|stepped-divider-array/);
  assert.match(guidance, /Ordinary cabinet fronts, worktop-to-backsplash junctions, doorway or window frames needed to prove the assigned real room may remain/);
  assert.match(guidance, /Rotunda, gallery, showroom, abstract chamber, display niche and pedestal-set interpretations are forbidden/);
  assert.doesNotMatch(guidance, /unsafe key/);
  assert.match(guidance, /unchanged source pixels/);
  assert.match(guidance, /immutable product zone/);
  assert.match(guidance, /IMMUTABLE RESERVED-ZONE GATE/);
  assert.match(guidance, /FULL SIX-AXIS REPLACEMENT GATE/);
  assert.match(guidance, /MANDATORY SCREEN-SPACE TOPOLOGY/);
  assert.match(guidance, /FORBIDDEN CAMERA\/TOPOLOGY/);
  assert.match(guidance, /blank architecture extending materially outside the reserved rectangle/);
  assert.match(guidance, /narrow functional-room reveal without two fixed cues in separate outer bands/);
  assert.match(guidance, /OUTER-BAND RECONSTRUCTION GATE/);
  assert.match(guidance, /FUNCTIONAL-ROOM PIXEL-PROOF GATE/);
  assert.match(guidance, /two independent fixed room-recognition structures/);
  assert.match(guidance, /third, separately identifiable integrated architectural element/);
  assert.match(guidance, /continuous horizontal support boundary across the complete reserved x-span/);
  assert.match(guidance, /256-by-256/);
  assert.match(guidance, /within 2 sampled pixels of the nominal reserved-zone bottom/);
  assert.match(guidance, /leaving no wall, vertical panel, open-air or diagonal-boundary pixels in the below-boundary region/);
  assert.match(guidance, /Do not classify or repair blankness confined to the immutable quiet rectangle as a dominant wall or repeated topology/);
  assert.match(guidance, /at least two non-collinear outer bands/);
  assert.doesNotMatch(guidance, /blacklisted role's product zone|product zone moves|move the product zone/i);
  assert.doesNotMatch(guidance, /contact plane|contact geometry/i);
  assert.doesNotMatch(guidance, /bathroom vanity|bedroom nightstand/);
});

test("surface-supported retries use horizontal functional materials instead of wet-room-like planes", () => {
  const plan = buildProductSettingShotPlan("food-staples", "롯샌 순우유맛 크림 샌드 과자");
  const useRetry = buildSettingShotRetryVariant(plan["detail-use"], "detail-use", 2);
  const wideRetry = buildSettingShotRetryVariant(plan.wide, "wide", 3);

  assert.match(useRetry.surface, /integrated horizontal dining or work ledge/);
  assert.match(useRetry.surface, /continuous physical support plane/);
  assert.doesNotMatch(useRetry.surface, /cobalt glazed tile/);
  assert.match(wideRetry.surface, /continuous horizontal worktop/);
  assert.match(wideRetry.surface, /within two 256-by-256 sampled pixels of the nominal reserved-zone bottom/);
  assert.match(wideRetry.location, /fronto-parallel support\/backing seam/);
  assert.match(wideRetry.location, /normalized end-to-end slope no greater than 0\.005/);
  assert.match(wideRetry.location, /contact band is only the audit search range/);
  assert.match(wideRetry.location, /within 2 sampled pixels of the nominal reserved-zone bottom/);
  assert.match(wideRetry.location, /Within that x-span, every pixel from the seam through the frame bottom/);
  assert.doesNotMatch(wideRetry.location, /lower support-plane edge converge/);

  const suspendedWideRetry = buildSettingShotRetryVariant(plan.wide, "wide", 2, "suspended-or-planar");
  assert.doesNotMatch(suspendedWideRetry.location, /WIDE SURFACE-SUPPORT SCREEN-SPACE INVARIANT/);
  assert.match(suspendedWideRetry.location, /coherent hanging or backing plane/);
  assert.match(suspendedWideRetry.surface, /woven architectural backing panel/);
  assert.match(suspendedWideRetry.surface, /never a tabletop, shelf, ledge, pedestal or bottom contact line/);
  assert.doesNotMatch(`${suspendedWideRetry.location} ${suspendedWideRetry.surface} ${suspendedWideRetry.camera}`, /worktop|work bench|support-plane|contact bridge/i);
});

test("wide surface-supported retry guidance keeps perspective edges out of the contact bridge", () => {
  const plan = buildProductSettingShotPlan("food-staples", "롯샌 순우유맛 크림 샌드 과자");
  const retry = buildSettingShotRetryVariant(plan.wide, "wide", 2, "surface-supported");
  const guidance = buildSettingShotRetryGuidance("wide", ["rejected-wide-1"], 2, retry, null, "surface-supported");

  assert.match(guidance, /fronto-parallel support\/backing seam/);
  assert.match(guidance, /no column, threshold, cabinet side, worktop side, diagonal boundary, wall or open-air region/);
  assert.match(guidance, /below-seam x-span/);
  assert.match(guidance, /Inspect this invariant before saving/);
  assert.doesNotMatch(guidance, /lower support-plane edge converge/);
});

test("portrait and wide background prompts pin the support ridge to the nominal 256-grid contact line", () => {
  const plan = buildProductSettingShotPlan("food-staples", "사조 살코기 참치 일반식품 통조림");
  for (const assetId of ["portrait", "wide"] as const) {
    const preset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === assetId);
    assert.ok(preset);
    const initialPrompt = buildAssetImagePrompt(
      baseResult,
      `/tmp/${preset.file}`,
      preset,
      [],
      "",
      "identity-background",
      plan[assetId],
      "surface-supported",
    );
    assert.match(initialPrompt, /tolerance band is only the audit search range/);
    assert.match(initialPrompt, /after normalizing the plate to 256-by-256/);
    assert.match(initialPrompt, /within 2 sampled pixels of nominal y=/);
    assert.match(initialPrompt, /Merely placing a seam somewhere inside the tolerance band fails/);

    const retry = buildSettingShotRetryVariant(plan[assetId], assetId, 2, "surface-supported");
    const retryPrompt = buildSettingShotRetryGuidance(
      assetId,
      [`rejected-${assetId}-1`],
      2,
      retry,
      { failedDimensions: ["reserved-zone"] },
      "surface-supported",
    );
    assert.match(retryPrompt, /contact band is only the audit search range/);
    assert.match(retryPrompt, /after normalizing the plate to 256-by-256/);
    assert.match(retryPrompt, /within 2 sampled pixels of the nominal reserved-zone bottom/);
    assert.match(retryPrompt, /seam merely somewhere inside the tolerance band fails/i);
  }
});

test("wide suspended retry guidance never asks for a support surface", () => {
  const plan = buildProductSettingShotPlan("men-clothing", "남성용 재킷");
  const retry = buildSettingShotRetryVariant(plan.wide, "wide", 2, "suspended-or-planar");
  const guidance = buildSettingShotRetryGuidance("wide", ["rejected-wide-1"], 2, retry, null, "suspended-or-planar");

  assert.match(guidance, /one coherent, unobstructed hanging or backing plane/);
  assert.match(guidance, /Never invent a tabletop, shelf, ledge, pedestal or bottom contact line/);
  assert.doesNotMatch(guidance, /continuous horizontal support boundary|support-plane convergence|contact-bridge instruction/i);
});

test("all suspended setting retries keep every slot free of support-surface contradictions", () => {
  const plan = buildProductSettingShotPlan("men-clothing", "벽걸이형 남성용 재킷");
  for (const assetId of settingShotAssetIds) {
    for (const retryIndex of [1, 2, 3]) {
      const retry = buildSettingShotRetryVariant(plan[assetId], assetId, retryIndex, "suspended-or-planar");
      const guidance = buildSettingShotRetryGuidance(
        assetId,
        [`rejected-${assetId}-1`],
        retryIndex,
        retry,
        { failedDimensions: ["reserved-zone", "surface"] },
        "suspended-or-planar",
      );
      const contract = `${retry.location} ${retry.surface} ${retry.supportingObjects} ${retry.camera} ${guidance}`;
      assert.match(contract, /coherent, unobstructed hanging or backing plane/);
      assert.doesNotMatch(contract, /worktop|work bench|support-plane|continuous horizontal support boundary|contact-bridge instruction/i);
    }
  }
});

test("audit-directed retries explicitly repair reserved-zone, assigned-scene and series failures without weakening the full gate", () => {
  const base = buildProductSettingShotPlan("food-staples", "사조 살코기 참치 일반식품 통조림").portrait;
  const retry = buildSettingShotRetryVariant(base, "portrait", 2);
  const guidance = buildSettingShotRetryGuidance(
    "portrait",
    ["wide", "rejected-portrait-1"],
    2,
    retry,
    {
      failedDimensions: [
        "reserved-zone",
        "assigned-environment",
        "assigned-location",
        "assigned-camera",
        "assigned-fixed-cue",
        "overall-layout",
        "location",
        "time-light",
        "surface",
        "camera",
        "fixed-cue",
      ],
      hardNegativeLocationKeys: ["generic-beige-room"],
      hardNegativeMomentKeys: ["flat-neutral-fill"],
      hardNegativeSurfaceKeys: ["beige-stone"],
      hardNegativeCameraKeys: ["near-front-crop"],
      hardNegativeCueKeys: ["right-wall-return"],
    },
  );

  assert.match(guidance, /AUDIT-DIRECTED REPAIR GATE/);
  assert.match(guidance, /identical left, top, width and height/);
  assert.match(guidance, /continuous horizontal support boundary across the complete width of the reserved rectangle/);
  assert.match(guidance, /within 2 sampled pixels of the nominal reserved-zone bottom/);
  assert.match(guidance, /at least two visible fixed architectural structures/);
  assert.match(guidance, /exact assigned functional room/);
  assert.match(guidance, /multiple fixed architectural convergence lines/);
  assert.match(guidance, /mandatory slot-specific fixed cue.*outside the entire reserved product rectangle/);
  assert.match(guidance, /rebuild the complete outer-band architectural floor-plan/);
  assert.match(guidance, /different source side, time treatment, shadow direction and shadow length/);
  assert.match(guidance, /different integrated material family, texture scale and grain direction/);
  assert.match(guidance, /different architectural side, azimuth, perspective convergence and focal-depth relationship/);
  assert.match(guidance, /Repairing one axis while repeating another is a failure/);
  assert.match(guidance, /STRUCTURED FAILED-PLATE BLACKLIST.*location=generic-beige-room.*time-light=flat-neutral-fill.*surface=beige-stone.*camera=near-front-crop.*fixed-cue\/supporting-object=right-wall-return/);
  assert.doesNotMatch(guidance, /ignore the audit|relax|best effort|approximately clear/i);
});

test("every retry index keeps all eight setting slots visually and semantically separated", () => {
  const basePlan = buildProductSettingShotPlan("food-staples", "사조 참치 일반식품 통조림");
  for (const retry of [1, 2, 3]) {
    const variants = settingShotAssetIds.map((assetId) => ({
      assetId,
      shot: buildSettingShotRetryVariant(basePlan[assetId], assetId, retry),
    }));
    for (const dimension of settingShotDimensions) {
      assert.equal(new Set(variants.map(({ shot }) => shot[dimension])).size, settingShotAssetIds.length, `retry ${retry} ${dimension}`);
      assert.equal(new Set(variants.map(({ shot }) => shot.separation[dimension])).size, settingShotAssetIds.length, `retry ${retry} ${dimension} key`);
    }
    const contracts = variants.map(({ assetId, shot }) => resolveIdentityBackgroundContract(shot, assetId));
    for (const dimension of ["location", "moment", "surface", "camera", "palette", "spatialDepth", "prop"] as const) {
      assert.equal(new Set(contracts.map((contract) => contract[dimension].key)).size, settingShotAssetIds.length, `retry ${retry} ${dimension} contract key`);
      assert.equal(new Set(contracts.map((contract) => contract[dimension].description)).size, settingShotAssetIds.length, `retry ${retry} ${dimension} contract description`);
    }
  }
});

test("product-specific setting variations stay subordinate to recognizable real-life rooms", () => {
  for (const productText of [
    "롯샌 순우유맛 크림 샌드 일반식품 과자",
    "사조 살코기 참치 일반식품 통조림",
    "첵스초코 초콜릿 시리얼",
  ]) {
    const plan = buildProductSettingShotPlan("food-staples", productText, productText);
    for (const assetId of settingShotAssetIds) {
      const shot = plan[assetId];
      assert.match(shot.location, /기본 생활공간의 실제 기능과 필수 고정 단서를 먼저 유지/);
      assert.match(shot.supportingObjects, /지정 생활공간을 증명하는 필수 수납장·작업면·출입문·창문 단서는 유지/);
      assert.match(shot.surface, /상품과 맞닿는 주 지지면은/);
      assert.doesNotMatch(shot.location, /배럴|다면 천장|방사형 천장|갤러리형 천장|큰 사선 지붕 접힘/);
      assert.doesNotMatch(shot.backgroundVariation?.fixedCue.description ?? "", /타원형|방사형|갤러리|페데스털|전시 니치/);
    }
  }
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
  assert.match(worker, /for \(let attempt = startingAttempt; attempt <= maximumAttempt; attempt \+= 1\)/);
  assert.match(worker, /maximumAttempt > MAXIMUM_SHOT_GENERATION_ATTEMPTS/);
  assert.match(worker, /await runDeterministicProductImageBatches\(\{/);
  assert.match(worker, /attemptsUsed: generated\.attempts - attempt \+ 1/);
  assert.match(worker, /findPostGenerationConflict: \(\{[\s\S]{0,260}acceptedCandidates,[\s\S]{0,260}findProductImageBatchSemanticConflict\(\{/);
  assert.match(worker, /acceptedSettingCandidates = acceptedCandidates\.filter/);
  assert.match(worker, /auditGeneratedIdentityBackground\(\{[\s\S]{0,1000}comparisonPlates,/);
  assert.match(worker, /kind: "semantic",[\s\S]{0,300}retryAuditFeedback:[\s\S]{0,260}safeForRetryComparison:/);
  assert.match(worker, /conflict\.kind !== "semantic" \|\| conflict\.safeForRetryComparison/);
  assert.match(worker, /commitCandidate: async[\s\S]{0,900}uploadAiResultAsset\(\{/);
  const batchLoserRetryStart = worker.indexOf("async function prepareProductImageBatchLoserRetry(");
  const batchLoserRetryEnd = worker.indexOf("async function throwProductImageBatchExhausted(", batchLoserRetryStart);
  const batchLoserRetry = worker.slice(batchLoserRetryStart, batchLoserRetryEnd);
  assert.ok(batchLoserRetryStart > 0 && batchLoserRetryEnd > batchLoserRetryStart);
  assert.match(batchLoserRetry, /if \(identityCutouts && preset\.identityPolicy\.mode !== "source-composite"\)/);
  assert.match(worker, /await rm\(outputFile, \{ force: true \}\)/);
  assert.match(worker, /createHash\("sha256"\)\.update\(buffer\)/);
  assert.match(worker, /\.flatten\(\{ background: "#ffffff" \}\)/);
  assert.match(worker, /pixels\.length !== \(SHOT_DHASH_COLUMNS \+ 1\) \* SHOT_DHASH_ROWS/);
  assert.match(worker, /buildDifferenceHash\(pixels\)/);
  assert.match(worker, /findDuplicateShot\([\s\S]*fingerprint,[\s\S]*existingShots[\s\S]*rejectedSourceEvidenceShots/);
  assert.match(worker, /const currentSceneIdentityText = resolveProductSceneIdentityText\(parsedSource\.data\)[\s\S]{0,500}downloadComparisonShots\([\s\S]{0,240}currentSceneIdentityText/);
  assert.match(worker, /const comparisonDownloadGate = createConcurrencyGate\(3\)/);
  assert.match(worker, /downloadComparisonShots\([\s\S]{0,260}const expectedOrigin = resolveComparisonStorageOrigin\(job\)/);
  assert.match(worker, /comparisonById\.set\(image\.assetId, \{[\s\S]{0,180}validateComparisonSignedUrl\(image\.signedUrl, expectedOrigin, "재제작 중복 비교 이미지"\)/);
  assert.match(worker, /fetch\(image\.signedUrl, \{[\s\S]{0,180}signal: downloadSignal\(leaseSignal, 30_000\),[\s\S]{0,80}redirect: "error"/);
  assert.match(worker, /expectedAssetIds[\s\S]*assetId !== targetAssetId/);
  assert.match(worker, /const previousAssetId = `previous:\$\{targetAssetId\}`/);
  assert.match(worker, /comparisonById\.size !== expectedAssetIds\.length \+ 1/);
  assert.match(worker, /\[\.\.\.expectedAssetIds, previousAssetId\]/);
  assert.match(claimRoute, /candidate\.id === assetId \? `previous:\$\{candidate\.id\}` : candidate\.id/);
  assert.match(worker, /existingShots\.length !== imagePresets\.length/);
  assert.match(worker, /match=\$\{duplicate\.exact \? "sha256" : "dhash"\}/);
  assert.match(worker, /buildSettingShotRetryVariant\(baseSettingShot, preset\.id, retryIndex, backgroundContactMode\)/);
  assert.match(worker, /buildSettingShotRetryGuidance\([\s\S]{0,260}retryAuditFeedback,[\s\S]{0,80}backgroundContactMode/);
  assert.match(worker, /never this persisted source-composite mask/);
  assert.match(worker, /const generationPreset = backgroundOnly[\s\S]{0,320}placement: resolveProductIdentityPlacement\(preset, resolveProductSceneIdentityText\(result\)\)/);
  assert.match(worker, /resolveProductIdentityPlacement\(targetPreset, sceneIdentityText\)[\s\S]{0,120}resolveProductIdentityPlacement\(comparisonPreset, sceneIdentityText\)/);
  assert.match(worker, /targetPreset\.identityPolicy\.placement,[\s\S]{0,120}comparisonPreset\.identityPolicy\.placement,[\s\S]{0,180}resolveProductIdentityPlacement\(targetPreset, sceneIdentityText\)/);
  assert.match(worker, /preset: generationPreset,/);
  assert.match(worker, /reservedZone: preset\.identityPolicy\.placement/);
  assert.match(worker, /compositeIdentityForeground\([\s\S]{0,300}generationPreset/);
  assert.match(worker, /retryConflictAssetIds/);
  assert.match(worker, /failedDimensions/);
  assert.match(worker, /auditError\.retryAuditFeedback = \{/);
  assert.match(worker, /hardNegativeMomentKeys: validatedObservedKey\(parsed\.data\.observedMomentKey\)/);
  assert.match(worker, /hardNegativeCueKeys: parsed\.data\.observedNonMerchandiseProps/);
  assert.match(worker, /reservedZoneClear: "reserved-zone"/);
  assert.match(worker, /parsed\.data\.assignedCameraSatisfied && parsed\.data\.observedCameraKey !== expectedEnvironmentKeys\.camera[\s\S]{0,100}"assigned-camera-key"/);
  assert.match(worker, /final acceptance, which remains guarded by assertSafeBackgroundSemanticAudit/);
  const retryComparisonGate = worker.match(/const safeForRetryComparison = parsed\.data\.confidence[\s\S]*?&& !parsed\.data\.humanPresent;/)?.[0] ?? "";
  assert.match(retryComparisonGate, /confidence === "high"/);
  assert.doesNotMatch(retryComparisonGate, /reservedZoneClear|assignedLocationSatisfied|assignedCameraSatisfied/);
  assert.match(worker, /expectedPropDescription: backgroundContract\.prop\.description/);
  assert.match(worker, /retryAuditFeedback = mergeSettingShotRetryAuditFeedback\(/);
  assert.match(worker, /\.\.\.retryConflictAssetIds,[\s\S]*error\?\.conflictingAssetIds/);
  assert.match(worker, /Source-composited output duplicate reason[\s\S]*retryAuditFeedback = mergeSettingShotRetryAuditFeedback|retryAuditFeedback = mergeSettingShotRetryAuditFeedback\([\s\S]*Source-composited output duplicate reason/);
  assert.match(worker, /rejectedBackgroundShots/);
  assert.match(worker, /comparisonPlates: boundedBackgroundComparisonShots\(\)/);
  assert.doesNotMatch(worker, /rejectedBackgroundShots\.splice\(0\)/);
  assert.match(worker, /maximumRejectedBackgroundHistory = MAXIMUM_SHOT_GENERATION_ATTEMPTS - 1/);
  assert.match(worker, /while \(retryState\.rejectedBackgroundShots\.length >= maximumRejectedBackgroundHistory\)/);
  assert.match(worker, /const candidates = \[[\s\S]*\.\.\.rejectedBackgroundShots,[\s\S]*\.\.\.existingBackgroundShots,[\s\S]*\.\.\.comparisonBackgroundShots/);
  assert.match(worker, /slice\(0, maximumBackgroundAuditComparisons\)/);
  assert.match(worker, /failedDimensions: \["overall-layout", "camera", "spatial-depth", "fixed-cue"\]/);
  assert.match(worker, /buildDuplicateRetryGuidance\(preset\.id, duplicate\.assetId, attempt, "source-evidence"\)/);
  assert.match(worker, /buildDuplicateRetryGuidance\(preset\.id, duplicate\.assetId, attempt, "product-mockup"\)/);
  assert.match(worker, /Keep the immutable source-product mask and follow the next deterministic background retry contract/);
  assert.match(worker, /maximumCrossProductComparisonProducts = 8/);
  assert.match(worker, /crossProductComparisonDownloadConcurrency = 4/);
  assert.match(worker, /crossProductComparisonDownloadTimeoutMs = 25_000/);
  assert.match(worker, /createConcurrencyGate\(crossProductComparisonDownloadConcurrency\)/);
  assert.match(worker, /downloadSignal\(leaseSignal, crossProductComparisonDownloadTimeoutMs\)/);
  assert.match(claimRoute, /createSignedUrls\([\s\S]{0,180}10 \* 60/);
  assert.ok(
    Math.ceil(64 / 4) * 25_000 + 60_000 < 10 * 60_000,
    "최악의 교차상품 비교 다운로드 파동과 60초 여유가 서명 TTL 안에 있어야 합니다.",
  );
  assert.match(worker, /validateCrossProductComparisonRequest\(job\)/);
  assert.match(worker, /products\.length > maximumCrossProductComparisonProducts/);
  assert.match(worker, /images\.length !== settingShotAssetIds\.length/);
  assert.match(worker, /rawExcludedSourceJobId[\s\S]{0,360}rawExcludedSourceJobId\.toLowerCase\(\)/);
  assert.match(worker, /rawSourceJobId[\s\S]{0,260}rawSourceJobId\.toLowerCase\(\)[\s\S]{0,120}sourceJobId === excludedSourceJobId[\s\S]{0,120}seenSourceJobs\.has\(sourceJobId\)/);
  assert.match(worker, /sourceJobId === excludedSourceJobId/);
  assert.match(worker, /parsed\.protocol !== "https:"[\s\S]*parsed\.origin !== expectedOrigin/);
  assert.match(worker, /downloadCrossProductComparisonArchive\(job, jobDir, jobHeartbeat\.signal\)/);
  assert.match(worker, /metadata\.format !== "png" \|\| metadata\.width !== preset\.width \|\| metadata\.height !== preset\.height/);
  assert.match(worker, /readCrossProductComparisonSource\(image\)/);
  assert.match(worker, /fileStats\.isSymbolicLink\(\)/);
  assert.match(worker, /prepareCrossProductBackgroundShots\([\s\S]*resolveProductIdentityPlacement\(targetPreset, product\.sceneIdentityText\)/);
  assert.match(worker, /targetPreset\.identityPolicy\.placement,[\s\S]{0,120}currentPlacement,[\s\S]{0,120}previousPlacement/);
  assert.match(worker, /comparisonShots: settingShot \? crossProductArchive\.shots : \[\]/);
  assert.match(worker, /comparisonBackgroundShots/);
});

test("image generation retries only the exact Codex timeout inside the finite shot-attempt loop", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  const timeoutRetryBlock = worker.match(
    /catch \(error\) \{\s*const retryableGenerationTimeout =[\s\S]{0,900}?continue;\s*\}/,
  )?.[0];

  assert.ok(timeoutRetryBlock, "the image-generation timeout retry block must remain explicit");
  assert.match(
    timeoutRetryBlock,
    /attempt < maximumAttempt\s*&& error instanceof Error\s*&& error\.message === "Codex CLI 실행 제한시간을 초과했습니다\."/,
  );
  assert.match(timeoutRetryBlock, /if \(!retryableGenerationTimeout\) throw error;/);
  assert.match(timeoutRetryBlock, /noveltyGuidance = `Image generation timeout retry/);
  assert.match(timeoutRetryBlock, /continue;/);
  assert.doesNotMatch(timeoutRetryBlock, /error\.message\.includes|error\.name|\/timeout\//i);

  const loopStart = worker.indexOf(
    "for (let attempt = startingAttempt; attempt <= maximumAttempt; attempt += 1)",
  );
  const retryStart = worker.indexOf("const retryableGenerationTimeout =", loopStart);
  assert.notEqual(loopStart, -1);
  assert.ok(retryStart > loopStart, "the timeout retry must stay inside the bounded attempt loop");
});

test("individual regeneration fetches the cross-product archive only for setting-shot assets", async () => {
  const [worker, claimRoute] = await Promise.all([
    readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(
    claimRoute,
    /const crossProductPreparation = crossProductSettingAssetIds\.includes\(\s*assetId as \(typeof crossProductSettingAssetIds\)\[number\],?\s*\)\s*\? await prepareCrossProductComparisons\(\)\s*: \{ comparisons: \[\], failure: null \} as const;/,
  );
  assert.match(
    worker,
    /const crossProductArchivePromise = settingShotAssetIds\.includes\(preset\.id\)\s*\? downloadCrossProductComparisonArchive\(job, jobDir, jobHeartbeat\.signal\)\s*: Promise\.resolve\(\{ products: \[\], shots: \[\] \}\);/,
  );
  assert.match(
    worker,
    /const \[imageFiles, crossProductArchive, previousComparisons\] = await Promise\.all\(\[\s*downloadInputs\(job, jobDir, jobHeartbeat\.signal\),\s*crossProductArchivePromise,/,
  );
  assert.match(
    worker,
    /if \(job\.kind !== "product_studio"\)[\s\S]{0,500}const \[imageFiles, crossProductArchive\] = await Promise\.all\(\[\s*downloadInputs\(job, jobDir, jobHeartbeat\.signal\),\s*downloadCrossProductComparisonArchive\(job, jobDir, jobHeartbeat\.signal\),/,
  );
});

test("cross-product UUID fences canonicalize case variants before self and duplicate checks", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  const lower = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const upper = lower.toUpperCase();
  assert.equal(upper === lower, false);
  assert.equal(upper.toLowerCase(), lower);
  assert.equal(new Set([lower]).has(upper.toLowerCase()), true);
  assert.match(worker, /const excludedSourceJobId = rawExcludedSourceJobId\.toLowerCase\(\)/);
  assert.match(worker, /const sourceJobId = rawSourceJobId\.toLowerCase\(\)/);
  assert.ok(
    worker.indexOf("const sourceJobId = rawSourceJobId.toLowerCase()")
      < worker.indexOf("seenSourceJobs.has(sourceJobId)"),
    "UUIDs must be canonicalized before the duplicate Set lookup",
  );
});

test("protected products never send source pixels to image generation and preserve legacy input compatibility", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  const cutout = await readFile(new URL("../scripts/source-product-cutout.swift", import.meta.url), "utf8");
  assert.match(worker, /preset\.identityPolicy\.mode !== "source-composite"[\s\S]*renderIdentityOnNeutralCanvas/);
  assert.match(worker, /const backgroundOnly = Boolean\(identityCutouts && preset\.identityPolicy\.mode === "source-composite"\)/);
  assert.match(worker, /\.\.\.\(!backgroundOnly \? referenceIndexes\.map[\s\S]*: \[\]\)/);
  assert.match(worker, /backgroundOnly \? "identity-background" : "product"/);
  assert.match(worker, /compositeIdentityForeground\([\s\S]*generated,[\s\S]*compositeSource\.foreground,[\s\S]*generationPreset,[\s\S]*backgroundContactMode,[\s\S]*\)/);
  assert.match(worker, /originalMediaType[\s\S]*image\/jpeg[\s\S]*return "\.jpg"/);
  assert.match(worker, /trustedLegacyStudioImagePath\.test/);
  assert.match(worker, /const expectedBytes = preservedOriginal \? sourceSpec\.originalBytes : sourceSpec\.bytes/);
  assert.match(worker, /imageFiles\.some\(\(image\) => !image\.preservedOriginal\)/);
  assert.match(worker, /preservedCount === 0[^\n]*legacy jobs/);
  assert.match(worker, /prepareIdentityCutoutsForJob\([\s\S]*prepareSourceIdentityCutouts/);
  assert.match(worker, /readResponseBodyBounded\([\s\S]*getReader\(\)/);
  assert.match(worker, /maximumCutoutInputCount = 8/);
  assert.match(worker, /assetSources\[preset\.id\]/);
  assert.match(worker, /\? \[front, evidence\] : \[front\]/);
  assert.match(worker, /executeSourceProductCutout\(\s*"subject",\s*identityAnchor,\s*join\(jobDir, "source-identity-canonical-whole\.png"\)/);
  assert.match(worker, /canonicalWhole\.report\.inputIndex !== front\.report\.inputIndex/);
  assert.match(worker, /frontProvidesWholeInstance[\s\S]*front\.report\.boundingCoverage >= 0\.90/);
  assert.match(worker, /frontMode !== "subject" && !frontProvidesWholeInstance/);
  assert.match(worker, /canonicalCompletenessProof = "subject-full-instance"/);
  assert.match(worker, /selectCanonicalWholeProductIdentityView\(\{[\s\S]*canonicalWhole,[\s\S]*front,[\s\S]*statutoryIdentity,[\s\S]*\}, preset\)/);
  assert.match(worker, /preset\.identityPolicy\.mode === "source-catalog"[\s\S]*selectCanonicalWholeProductIdentityView\(identityCutouts, preset\)/);
  assert.match(worker, /renderMissingIdentityEvidence\(preset\)/);
  assert.match(worker, /packageEvidencePreset[\s\S]*requiredIdentityRoles[\s\S]*return requiredIdentityRoles\.has\(role\)/);
  assert.match(worker, /identitySourceCandidatesForPreset\(identityCutouts, preset\)/);
  assert.match(worker, /const packageEvidenceViews = evidence \? \[\{ \.\.\.evidence, packageEvidenceGrade: "strict-evidence" \}\] : \[\]/);
  assert.match(worker, /dedicatedRoles\.has\(normalizedRole\)[\s\S]*executeSourceProductCutout\([\s\S]*"evidence"[\s\S]*assertIdentityEvidenceLinkage\(front, view, "evidence"\)[\s\S]*packageEvidenceGrade: "strict-evidence"/);
  assert.match(worker, /statutoryIdentity \? "view" : "evidence"[\s\S]*!statutoryIdentity[\s\S]*packageEvidenceGrade: "linked-alternate"/);
  assert.match(worker, /preset\.id === "detail-package"[\s\S]*identityCutouts\.packageEvidenceViews/);
  assert.match(worker, /packageEvidenceViews\.sort[\s\S]*rolePriority\.indexOf\(leftRole\)[\s\S]*left\.report\.inputIndex - right\.report\.inputIndex/);
  assert.match(worker, /dedicatedRolePriority\.indexOf\(leftRole\)[\s\S]*left\.sourceIndex - right\.sourceIndex[\s\S]*\.slice\(0, Math\.max\(0, maximumCutoutInputCount - verifiedViews\.length\)\)/);
  assert.match(worker, /planIdentityEvidenceAttempt\(sourceCandidates\.length, attempt\)/);
  assert.match(worker, /packageEvidencePlan\?\.mode === "two-source-board"[\s\S]*renderIdentityEvidenceBoard\([\s\S]*packageEvidencePlanSources\.map\(\(candidate\) => candidate\.foreground\)/);
  assert.match(worker, /packageEvidencePlan\?\.mode === "single-source-panel"[\s\S]*renderIdentityEvidencePanel\([\s\S]*source\.foreground/);
  assert.match(worker, /labelReferenceFiles = preset\.id === "detail-package"[\s\S]*candidate\.referenceFile/);
  assert.match(worker, /for \(const requiredReferencePath of requiredReferencePaths\)[\s\S]*verifyGeneratedLabelFidelity\([\s\S]*referencePaths: \[[\s\S]*\.\.\.requiredReferencePaths,[\s\S]*\.\.\.referenceIndexes\.map/);
  assert.match(worker, /hasNextPackageEvidencePlan = preset\.id === "detail-package"[\s\S]*planIdentityEvidenceAttempt\(identitySourceCandidateCount, attempt \+ 1\)/);
  assert.match(worker, /rejectedSourceEvidenceShots[\s\S]*\.\.\.existingShots, \.\.\.comparisonShots, \.\.\.rejectedSourceEvidenceShots/);
  assert.match(worker, /const nextPlan = planIdentityEvidenceAttempt\(identitySourceCandidateCount, nextAttempt\)/);
  assert.match(worker, /strictLabelEvidenceAssetIds = new Set\(\["detail-feature", "detail-package"\]\)/);
  assert.match(worker, /sourcePixelEvidencePolicy:[\s\S]*strictLabelEvidenceAssetIds\.has\(preset\.id\)[\s\S]*"strict-label"[\s\S]*"crop"/);
  assert.match(worker, /sourcePixelBaselineFile[\s\S]*renderIdentityOnNeutralCanvas[\s\S]*writeFile\(sourcePixelBaselineFile/);
  assert.match(worker, /: \[sourcePixelBaselineFile\]/);
  assert.match(worker, /labelCandidateSnapshotFile[\s\S]*expectedPixelDigest = imageLabelPixelDigest\(normalized\)[\s\S]*assertSourcePixelLabelBaseline/);
  assert.match(worker, /candidatePath: labelCandidateSnapshotFile/);
  assert.match(worker, /finally \{[\s\S]*await assertLabelInputsIntact\(\)/);
  assert.match(worker, /error instanceof ImageLabelPixelIntegrityError\) throw error/);
  assert.match(worker, /batchImageLabelFidelityReferencePaths\(requiredReferencePath, referencePaths\)/);
  assert.match(worker, /await writeFile\(file, sourceBytes, \{ flag: "wx", mode: 0o400 \}\)/);
  assert.match(worker, /!allowedRoleSet\.has\(role\)/);
  assert.match(worker, /preset\.identityPolicy\.requiresDedicatedRole && !dedicatedEvidenceRoles\.has\(role\)/);
  assert.match(worker, /buildImageLabelFidelitySwiftArguments\(\{/);
  assert.match(worker, /imageLabelFidelityGate\.run\(\(\) => runLeaseBoundedProcess\(\s*"\/usr\/bin\/swift"/);
  assert.match(worker, /evaluateImageLabelFidelityReport\(rawReport,/);
  assert.match(worker, /const dedicatedRolePriority = \["back", "label", "barcode", "top", "bottom", "left", "right"\]/);
  assert.match(worker, /outputStats\.nlink !== 1/);
  assert.match(worker, /constants\.O_RDONLY \| constants\.O_NOFOLLOW/);
  assert.match(worker, /openedStats\.dev !== outputStats\.dev[\s\S]*openedStats\.ino !== outputStats\.ino/);
  assert.match(worker, /sourceHandle\.readFile\(\)/);
  assert.match(worker, /assertIdentityBackgroundPlate\(generated, generationPreset, backgroundContactMode\)/);
  assert.match(worker, /if \(backgroundOnly\) \{[\s\S]*normalizeIdentityBackgroundPlate\(generated, generationPreset\)[\s\S]*writeFile\(outputFile, generated\)[\s\S]*assertIdentityBackgroundPlate\(generated, generationPreset, backgroundContactMode\)/);
  assert.match(worker, /attempt === maximumAttempt[\s\S]*backgroundContactMode === "surface-supported"[\s\S]*isRepairableMissingIdentitySupportBoundary\(error\)/);
  assert.doesNotMatch(worker, /mayRepairSupportBoundary[\s\S]{0,180}preset\.id === "portrait"/);
  assert.match(worker, /repairMissingIdentitySupportSurface\(generated, generationPreset\)[\s\S]*assertIdentityBackgroundPlate\(generated, generationPreset, backgroundContactMode\)/);
  assert.match(worker, /await writeFile\(outputFile, generated\)[\s\S]*executeSourceProductCutout\("background"/);
  assert.match(worker, /executeSourceProductCutout\("background"/);
  assert.match(worker, /auditGeneratedIdentityBackground\(\{/);
  assert.match(worker, /contactMode: backgroundContactMode/);
  assert.match(worker, /compositeIdentityForeground\([\s\S]*backgroundContactMode,[\s\S]*\)/);
  assert.match(worker, /for \(const existingBackground of \[[\s\S]*\.\.\.existingBackgroundShots,[\s\S]*\.\.\.comparisonBackgroundShots,[\s\S]*\.\.\.rejectedBackgroundShots,[\s\S]*\]\)[\s\S]*findDuplicateShot\(candidateFingerprint, \[existingBackground\]\)/);
  assert.match(cutout, /IndexSet\(integer: instance\)/);
  assert.match(cutout, /generateScaledMaskForImage\(forInstances: instances/);
  assert.doesNotMatch(cutout, /generateScaledMaskForImage\(forInstances: observation\.allInstances/);
  assert.match(cutout, /VNDetectBarcodesRequest/);
  assert.match(cutout, /VNDetectHumanRectanglesRequest/);
  assert.match(cutout, /for quarterTurns in 1\.\.\.3/);
  assert.match(cutout, /barcodePayloads\.insert\(payload\)\.inserted/);
  assert.match(cutout, /CommandLine\.arguments\[1\] == "background"/);
  assert.match(worker, /front\.report\.inputIndex === evidence\.report\.inputIndex/);
});
