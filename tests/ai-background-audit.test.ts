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
import { buildProductSettingShotPlan, settingShotAssetIds } from "../lib/product-setting-shots";

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
    /지정 환경 조건/,
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
});

test("setting background props are unique across all four semantic audits", () => {
  const existing = [
    { assetId: "portrait", propKeys: ["fixed-window-frame"] },
    { assetId: "wide", propKeys: ["built-in-wall-rail"] },
    { assetId: "detail-overview", propKeys: ["fixed-shelf-divider"] },
  ];
  assert.equal(findRepeatedBackgroundProp(["fixed-wall-sconce"], existing), null);
  assert.deepEqual(findRepeatedBackgroundProp(["fixed-window-frame"], existing), {
    propKey: "fixed-window-frame",
    assetId: "portrait",
  });
});

test("background audit prompt treats the image as untrusted and distinguishes packaging from architecture", () => {
  const prompt = buildBackgroundSemanticAuditPrompt({
    assetId: "portrait",
    expectedEnvironment: "empty room with a wall, floor and fixed blue window",
    reservedZone: { left: 0.08, top: 0.1, width: 0.62, height: 0.74 },
    expectedPropKey: "fixed-window-frame",
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
  assert.match(prompt, /observedNonMerchandiseProps/);
  assert.match(prompt, /exhaustively list every nontrivial fixed architectural/);
  assert.match(prompt, /cool-dawn-window-light/);
  assert.match(prompt, /Image 1 is the candidate/);
  assert.match(prompt, /must be empty when every required distinction is true/);
  assert.match(prompt, /Same-slot regeneration comparison previous-portrait/);
  assert.match(prompt, /exclude it from those cross-slot dimension booleans/);
  assert.match(prompt, /baseboard\/trim\/moulding/);
  assert.match(prompt, /palette-family key/);
  assert.doesNotMatch(prompt, /White ceramic mug|롯데|애사비|사조/);
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
  assert.equal(new Set(manifests.map((manifest) => manifest[1].location.key)).size, categories.length);
  assert.match(manifests[0][1].location.description, /침실.*나이트스탠드/);
  assert.match(manifests[0][1].surface.description, /월넛/);
  assert.match(manifests[3][1].location.description, /현대식 주방/);
  assert.match(manifests[3][1].surface.description, /스테인리스/);
  for (const manifest of manifests) {
    assert.equal(new Set(manifest.map((contract) => contract.location.key)).size, 4);
    assert.equal(new Set(manifest.map((contract) => contract.moment.key)).size, 4);
    assert.equal(new Set(manifest.map((contract) => contract.palette.key)).size, 4);
    assert.equal(new Set(manifest.map((contract) => contract.prop.key)).size, 4);
    assert.ok(manifest.every((contract) => /saleable furniture or movable prop/.test(contract.location.description)));
    assert.ok(manifest.every((contract) => !/\d+mm/.test(contract.camera.key)));
    assert.ok(manifest.every((contract) => !/portion|restock|serving|snack|routine/.test(contract.moment.key)));
    assert.ok(manifest.every((contract) => !/\d+mm/.test(contract.spatialDepth.key)));
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
  assert.match(worker, /literal assigned camera/);
  assert.doesNotMatch(worker.match(/async function auditGeneratedIdentityBackground[\s\S]+?\n}\n\nasync function fingerprintGeneratedShot/)?.[0] ?? "", /referenceIndexes|imageFiles/);
});
