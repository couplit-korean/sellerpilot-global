import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertSafeBackgroundSemanticAudit,
  backgroundSemanticAuditSchema,
  buildBackgroundSemanticAuditPrompt,
  findRepeatedBackgroundProp,
  resolveIdentityBackgroundContract,
} from "../lib/ai-background-audit";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import {
  buildProductSettingShotPlan,
  buildSettingShotRetryVariant,
  settingShotAssetIds,
} from "../lib/product-setting-shots";

const backgroundContractDimensions = [
  "location",
  "moment",
  "surface",
  "camera",
  "prop",
  "palette",
  "spatialDepth",
] as const;

function assertDistinctBackgroundContractDimensions(
  contracts: Array<ReturnType<typeof resolveIdentityBackgroundContract>>,
  expectedCount: number,
) {
  for (const dimension of backgroundContractDimensions) {
    const keys = contracts.map((contract) => contract[dimension].key);
    assert.equal(new Set(keys).size, expectedCount, `${dimension} 계약 키가 중복됐습니다.`);
    assert.ok(keys.every((key) => key !== "unknown" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(key)));
    assert.ok(contracts.every((contract) => contract[dimension].description.trim().length > 0));
  }
}

const safeAudit = {
  merchandisePresent: false,
  packageOrContainerPresent: false,
  labelBarcodeOrCertificationPresent: false,
  humanPresent: false,
  reservedZoneClear: true,
  assignedEnvironmentPresent: true,
  assignedLocationSatisfied: true,
  assignedMomentSatisfied: true,
  assignedSurfaceSatisfied: true,
  assignedCameraSatisfied: true,
  assignedPaletteSatisfied: true,
  spatialDepthPresent: true,
  observedLocationKey: "breakfast-nook",
  observedMomentKey: "cool-dawn-window-light",
  observedSurfaceKey: "light-oak",
  observedCameraKey: "portrait-low-diagonal",
  observedPaletteKey: "cool-airy-morning",
  observedSpatialDepthKey: "vertical-near-far-diagonal",
  seriesVisuallyDistinct: true,
  seriesLocationDistinct: true,
  seriesMomentDistinct: true,
  seriesSurfaceDistinct: true,
  seriesPaletteDistinct: true,
  seriesSpatialDepthDistinct: true,
  seriesCameraDistinct: true,
  seriesCueDistinct: true,
  conflictingAssetIds: [],
  assignedSupportingObjectsSatisfied: true,
  observedNonMerchandiseProps: ["fixed-window-frame"],
  confidence: "high" as const,
  findings: ["Empty wall, floor and fixed window are visible."],
};

test("background semantic audit accepts only a complete high-confidence empty environment", () => {
  const parsed = backgroundSemanticAuditSchema.parse(safeAudit);
  const expectedKeys = {
    location: "breakfast-nook",
    moment: "cool-dawn-window-light",
    surface: "light-oak",
    camera: "portrait-low-diagonal",
    palette: "cool-airy-morning",
    spatialDepth: "vertical-near-far-diagonal",
  };
  assert.doesNotThrow(() => assertSafeBackgroundSemanticAudit(parsed, "fixed-window-frame", expectedKeys));
  assert.throws(
    () => assertSafeBackgroundSemanticAudit({ ...parsed, packageOrContainerPresent: true }),
    /상품·포장·용기/,
  );
  assert.throws(
    () => assertSafeBackgroundSemanticAudit({ ...parsed, merchandisePresent: true }),
    /상품·포장·용기/,
  );
  assert.throws(
    () => assertSafeBackgroundSemanticAudit({ ...parsed, confidence: "medium" }),
    /신뢰도가 충분하지/,
  );
  assert.throws(
    () => assertSafeBackgroundSemanticAudit({ ...parsed, assignedEnvironmentPresent: false }),
    /지정 환경 조건.*assigned-environment/,
  );
  assert.throws(
    () => assertSafeBackgroundSemanticAudit({
      ...parsed,
      reservedZoneClear: false,
      assignedEnvironmentPresent: false,
      assignedSupportingObjectsSatisfied: false,
    }),
    /reserved-zone, assigned-environment, assigned-fixed-cue/,
  );
  assert.doesNotThrow(() => assertSafeBackgroundSemanticAudit({
    ...parsed,
    observedNonMerchandiseProps: ["fixed-window-frame", "interior-doorway"],
  }, "fixed-window-frame"));
  assert.throws(() => assertSafeBackgroundSemanticAudit({
    ...parsed,
    observedNonMerchandiseProps: ["interior-doorway"],
  }, "fixed-window-frame"), /슬롯별 비상품성 환경 소품/);
  assert.throws(
    () => assertSafeBackgroundSemanticAudit({
      ...parsed,
      seriesVisuallyDistinct: false,
      seriesPaletteDistinct: false,
      conflictingAssetIds: ["wide"],
    }, "fixed-window-frame", expectedKeys),
    /시각적으로 분리되지/,
  );
  for (const field of [
    "seriesVisuallyDistinct",
    "seriesLocationDistinct",
    "seriesMomentDistinct",
    "seriesSurfaceDistinct",
    "seriesPaletteDistinct",
    "seriesSpatialDepthDistinct",
    "seriesCameraDistinct",
    "seriesCueDistinct",
  ] as const) {
    assert.throws(
      () => assertSafeBackgroundSemanticAudit({
        ...parsed,
        [field]: false,
        conflictingAssetIds: ["detail-routine"],
      }, "fixed-window-frame", expectedKeys),
      /시각적으로 분리되지/,
    );
  }
  const allSlotConflicts = [...settingShotAssetIds.slice(1), "previous-portrait"];
  assert.equal(backgroundSemanticAuditSchema.parse({
    ...parsed,
    seriesVisuallyDistinct: false,
    conflictingAssetIds: allSlotConflicts,
  }).conflictingAssetIds.length, 8);
  assert.throws(
    () => backgroundSemanticAuditSchema.parse({
      ...parsed,
      conflictingAssetIds: [...allSlotConflicts, "ninth-conflict"],
    }),
    /too_big|Too big|expected array to have/i,
  );
});

test("setting background props are unique across all eight semantic audits", () => {
  const plan = buildProductSettingShotPlan("food-staples", "초콜릿 시리얼");
  const contracts = settingShotAssetIds.map((assetId) => ({
    assetId,
    contract: resolveIdentityBackgroundContract(plan[assetId], assetId),
  }));
  const existing = contracts.slice(0, 7).map(({ assetId, contract }) => ({
    assetId,
    propKeys: [contract.prop.key],
  }));
  assert.equal(findRepeatedBackgroundProp([contracts[7].contract.prop.key], existing), null);
  assert.deepEqual(findRepeatedBackgroundProp([contracts[4].contract.prop.key], existing), {
    propKey: contracts[4].contract.prop.key,
    assetId: "detail-routine",
  });
  assert.equal(findRepeatedBackgroundProp(
    ["fixed-lower-cabinet-fronts", contracts[7].contract.prop.key],
    existing,
  ), null, "공간 인식을 위한 공통 구조물은 슬롯별 고정 단서 중복으로 오인하지 않습니다.");
  assert.deepEqual(findRepeatedBackgroundProp(
    ["fixed-lower-cabinet-fronts", contracts[4].contract.prop.key, contracts[7].contract.prop.key],
    existing,
  ), {
    propKey: contracts[4].contract.prop.key,
    assetId: "detail-routine",
  });
});

test("food dining backgrounds require fixed room evidence and reject wet-room or showroom lookalikes", () => {
  const foodPlan = buildProductSettingShotPlan("food-staples", "롯샌 순우유맛 크림 샌드 과자");
  const dining = foodPlan["detail-use"];
  const retry = buildSettingShotRetryVariant(dining, "detail-use", 2);
  for (const shot of [dining, retry]) {
    const contract = resolveIdentityBackgroundContract(shot, "detail-use");
    assert.match(contract.location.description, /at least two unmistakable fixed dining cues/);
    assert.match(contract.location.description, /built-in banquette back/);
    assert.match(contract.location.description, /dining window reveal or ceiling pendant mounting canopy/);
    assert.match(contract.location.description, /bathroom, shower, washroom, vanity, spa, retail showroom/);
    assert.match(contract.location.description, /floor-to-ceiling wet-room tile/);
    assert.match(contract.prop.description, /fixed room-recognition contract/i);
  }

  const generalPlan = buildProductSettingShotPlan("general-commerce", "케이블 정리 홀더");
  const generalContract = resolveIdentityBackgroundContract(generalPlan["detail-use"], "detail-use");
  assert.doesNotMatch(generalContract.location.description, /fixed room-recognition contract/i);
  assert.doesNotMatch(generalContract.prop.description, /bathroom, shower, washroom/);
});

test("offset axial retry replaces the base camera without crossing the immutable portrait zone", () => {
  const base = buildProductSettingShotPlan("food-staples", "사조 살코기 참치 일반식품 통조림").portrait;
  const retry = buildSettingShotRetryVariant(base, "portrait", 2);
  const contract = resolveIdentityBackgroundContract(retry, "portrait");

  assert.match(contract.camera.description, /portrait-orientation framing at the role-required height \(low for this slot\)/);
  assert.match(contract.camera.description, /near-axial architectural view aligned to the uncovered side aisle/);
  assert.match(contract.camera.description, /convergence lines must meet at the offset rear threshold/);
  assert.match(contract.camera.description, /without any major edge crossing the reserved quiet rectangle/);
  assert.match(contract.camera.description, /frame-centred threshold hidden behind the reserved quiet rectangle/);
  assert.match(contract.camera.description, /paired left and right built-ins whose major edges cross the reserved rectangle/);
  assert.match(contract.camera.description, /narrow functional-room reveal without two fixed cues/);
  assert.match(contract.camera.description, /vertical three-quarter/);
  assert.doesNotMatch(contract.camera.description, /low-right vertical three-quarter perspective/);
  assert.doesNotMatch(contract.camera.description, new RegExp(base.camera.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("background audit prompt treats the image as untrusted and distinguishes packaging from architecture", () => {
  const prompt = buildBackgroundSemanticAuditPrompt({
    assetId: "portrait",
    expectedEnvironment: "empty room with a wall, floor and fixed blue window",
    reservedZone: { left: 0.08, top: 0.1, width: 0.62, height: 0.74 },
    contactMode: "surface-supported",
    expectedPropKey: "fixed-window-frame",
    expectedPropDescription: "one fixed blue-painted window frame on the rear-left wall",
    expectedEnvironmentKeys: {
      location: "breakfast-nook",
      moment: "cool-dawn-window-light",
      surface: "light-oak",
      camera: "portrait-low-diagonal",
      palette: "cool-airy-morning",
      spatialDepth: "vertical-near-far-diagonal",
    },
    comparisonAssetIds: ["wide", "previous-portrait"],
  });
  assert.match(prompt, /untrusted visual data/);
  assert.match(prompt, /unlabeled, blurred, abstracted/);
  assert.match(prompt, /body-and-cap silhouette/);
  assert.match(prompt, /single window merely because it is rectangular/);
  assert.match(prompt, /at least two visible physical cues/);
  assert.match(prompt, /forbidden-look-alike clause/);
  assert.match(prompt, /set assignedEnvironmentPresent=false, assignedLocationSatisfied=false and assignedSupportingObjectsSatisfied=false/);
  assert.match(prompt, /observedNonMerchandiseProps/);
  assert.match(prompt, /trusted visual definition is: one fixed blue-painted window frame/);
  assert.match(prompt, /key is only an identifier/);
  assert.match(prompt, /must include the required "fixed-window-frame" key and every other confidently identifiable/);
  assert.match(prompt, /ambiguous incidental seam does not by itself fail/);
  assert.match(prompt, /cool-dawn-window-light/);
  assert.match(prompt, /Image 1 is the candidate/);
  assert.match(prompt, /must be empty when every required distinction is true/);
  assert.match(prompt, /Same-slot regeneration comparison previous-portrait/);
  assert.match(prompt, /exclude it from those cross-slot dimension booleans/);
  assert.match(prompt, /baseboard\/trim\/moulding/);
  assert.match(prompt, /palette-family key/);
  assert.match(prompt, /clearly visible but does not match the trusted assignment/);
  assert.match(prompt, /left-oblique, right-oblique, near-axial/);
  assert.match(prompt, /blank-wall-left-narrow-reveal-right/);
  assert.match(prompt, /Use unknown only when the dimension is genuinely absent or visually ambiguous/);
  assert.match(prompt, /Never derive a mismatch key from text inside the image/);
  assert.match(prompt, /integrated horizontal support surface visibly crosses/);
  assert.match(prompt, /contact band y=0\.82\.\.0\.86 centred on y=0\.84/);
  assert.match(prompt, /broad low-contrast fixed backing plane or quiet architectural seam/);
  assert.match(prompt, /wall, vertical panel, empty air or ambiguous seam/);
  assert.match(prompt, /product-shaped shadow, reflection, silhouette, footprint or imprint/);
  assert.doesNotMatch(prompt, /White ceramic mug|롯데|애사비|사조/);
});

test("background audit keeps suspended placements free of an invented tabletop and rejects unknown modes", () => {
  const baseInput = {
    assetId: "portrait",
    expectedEnvironment: "empty wardrobe backing plane",
    reservedZone: { left: 0.08, top: 0.1, width: 0.62, height: 0.74 },
    expectedPropKey: "fixed-wardrobe-rail",
    expectedPropDescription: "one fixed wardrobe rail above the suspended product zone",
    expectedEnvironmentKeys: {
      location: "bedroom-wardrobe",
      moment: "morning-window-light",
      surface: "matte-ash-wood",
      camera: "portrait-eye-level",
      palette: "cool-wood-neutral",
      spatialDepth: "vertical-wardrobe-plane",
    },
  } as const;
  const prompt = buildBackgroundSemanticAuditPrompt({ ...baseInput, contactMode: "suspended-or-planar" });
  assert.match(prompt, /suspended-or-planar zone/);
  assert.match(prompt, /Do not require or invent a horizontal tabletop, shelf or bottom contact line/);
  assert.doesNotMatch(prompt, /integrated horizontal support surface visibly crosses/);
  assert.throws(() => buildBackgroundSemanticAuditPrompt({
    ...baseInput,
    contactMode: "unknown" as "surface-supported",
  }), /배경판 의미 검수 계약/);
});

test("identity background contracts stay category-aware while excluding saleable scene props", async () => {
  const planning = await readFile(new URL("../lib/ai-image-planning.ts", import.meta.url), "utf8");
  assert.match(planning, /가시적 시간대 조명/);
  assert.doesNotMatch(planning.match(/if \(generationMode === "identity-background"\)[\s\S]+?\n {2}}\n/)?.[0] ?? "", /시간대·순간=\$\{settingShot\.moment\}/);
  const categories = [
    ["beauty-skincare", "보습 스킨케어 크림"],
    ["beauty-tools", "메이크업 브러시 세트"],
    ["food-staples", "펜네 파스타 식품"],
    ["food-staples", "초콜릿 시리얼"],
    ["food-staples", "드립 커피 원두"],
    ["men-tops", "남성 후드 티셔츠"],
    ["toys-games", "테디베어 완구"],
    ["food-supplement", "오메가3 건강기능식품"],
    ["general-commerce", "수납 정리 생활용품"],
  ] as const;
  const manifests = categories.map(([category, productText]) => {
    const plan = buildProductSettingShotPlan(category, productText);
    return settingShotAssetIds.map((assetId) => resolveIdentityBackgroundContract(plan[assetId], assetId));
  });
  assert.deepEqual(
    aiGeneratedAssetSpecs
      .filter((asset) => asset.identityPolicy.mode === "source-composite")
      .map((asset) => asset.id),
    [...settingShotAssetIds],
  );
  assert.equal(new Set(manifests.map((manifest) => manifest[1].location.key)).size, categories.length);
  assert.match(manifests[0][1].location.description, /침실.*나이트스탠드/);
  assert.match(manifests[0][1].surface.description, /월넛/);
  assert.match(manifests[3][1].location.description, /현대식 주방/);
  assert.match(manifests[3][1].surface.description, /스테인리스/);
  for (const manifest of manifests) {
    assertDistinctBackgroundContractDimensions(manifest.slice(0, 4), 4);
    assertDistinctBackgroundContractDimensions(manifest.slice(4), 4);
    assertDistinctBackgroundContractDimensions(manifest, 8);
    assert.ok(manifest.every((contract) => /saleable furniture or movable prop/.test(contract.location.description)));
    assert.ok(manifest.every((contract) => /outside the reserved product zone/.test(contract.prop.description)));
    assert.ok(manifest.every((contract) => !/\d+mm/.test(contract.camera.key)));
    assert.ok(manifest.every((contract) => !/portion|restock|serving|snack/.test(contract.moment.key)));
    assert.ok(manifest.every((contract) => !/\d+mm/.test(contract.spatialDepth.key)));
  }
});

test("corresponding food slots preserve room recognition while exposing product-specific audit contracts", () => {
  const products = [
    ["식품·음료 > 과자 롯샌 파스퇴르 순우유맛 315 g", "부드러운 우유 크림 샌드"],
    ["일반식품 사조 살코기 참치 안심따개 100 g", "통조림"],
    ["일반식품 BEYOND ORIGIN 애사비 젤리스틱 15 g 14개", "기타가공품"],
  ] as const;
  const plans = products.map(([sceneIdentityText, feature]) => buildProductSettingShotPlan(
    "food-staples",
    `${sceneIdentityText} ${feature}`,
    sceneIdentityText,
  ));
  for (const assetId of settingShotAssetIds) {
    const contracts = plans.map((plan) => resolveIdentityBackgroundContract(plan[assetId], assetId));
    for (const dimension of backgroundContractDimensions) {
      assert.equal(
        new Set(contracts.map((contract) => contract[dimension].key)).size,
        products.length,
        `${assetId}/${dimension} audit contract must vary by product`,
      );
      assert.equal(
        new Set(contracts.map((contract) => contract[dimension].description)).size,
        products.length,
        `${assetId}/${dimension} audit instruction must vary by product`,
      );
    }
    assert.ok(contracts.every((contract) => /outside the reserved product zone/.test(contract.prop.description)));
    assert.ok(contracts.every((contract) => !/product|상품|source-composite|mask/i.test(contract.camera.description)));
  }
  for (const plan of plans) {
    assert.match(resolveIdentityBackgroundContract(plan.portrait, "portrait").location.description, /food-preparation cues/);
    assert.match(resolveIdentityBackgroundContract(plan["detail-overview"], "detail-overview").location.description, /dry-storage cues/);
    assert.match(resolveIdentityBackgroundContract(plan["detail-use"], "detail-use").location.description, /fixed dining cues/);
  }
});

test("worker runs the independent semantic audit inside every background retry without product references", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /backgroundSemanticAuditSchema/);
  assert.match(worker, /auditGeneratedIdentityBackground\(\{/);
  assert.match(worker, /--sandbox", "read-only"/);
  assert.match(worker, /`--image=\$\{outputFile\}`/);
  assert.match(worker, /expectedPlateDigest/);
  assert.match(worker, /stage: `background-audit:\$\{preset\.id\}`/);
  assert.match(worker, /`가시적 시간대 조명=\$\{backgroundContract\.moment\.description/);
  assert.match(worker, /for \(let attempt = 1; attempt <= MAXIMUM_SHOT_GENERATION_ATTEMPTS/);
  assert.match(worker, /Background safety retry/);
  assert.match(worker, /deterministic trusted retry contract/);
  assert.match(worker, /safeForRetryComparison/);
  assert.match(worker, /conflictingAssetIds/);
  assert.doesNotMatch(worker, /different camera family[\s\S]{0,180}exact assigned/);
  assert.doesNotMatch(worker.match(/async function auditGeneratedIdentityBackground[\s\S]+?\n}\n\nasync function fingerprintGeneratedShot/)?.[0] ?? "", /referenceIndexes|imageFiles/);
});
