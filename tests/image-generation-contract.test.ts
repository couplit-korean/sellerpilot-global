import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
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
  assert.ok(variants.every((variant) => variant.location.includes(base.location)));
  assert.ok(variants.every((variant) => variant.camera.includes("assigned camera family")));
  assert.ok(variants.every((variant) => variant.camera.includes("role-required height")));
  assert.ok(variants.every((variant) => !/contact plane|contact geometry/i.test(variant.staging)));
  assert.ok(variants.every((variant) => /no vertical fin, post, divider, jamb, return, reveal, bay/i.test(variant.supportingObjects)));
  assert.match(variants[0].supportingObjects, /circular light well/);
  assert.match(variants[1].supportingObjects, /horizontal shadow channel/);
  assert.match(variants[2].supportingObjects, /diagonal wall-to-ceiling fold/);

  const contracts = variants.map((variant) => resolveIdentityBackgroundContract(variant, "detail-overview"));
  for (const dimension of ["location", "moment", "surface", "camera", "palette", "spatialDepth", "prop"] as const) {
    assert.equal(new Set(contracts.map((contract) => contract[dimension].key)).size, 3, dimension);
    assert.ok(contracts.every((contract) => contract[dimension].key.length <= 64));
  }
  assert.match(contracts[0].moment.description, /sunset|post-sunset/);
  assert.match(contracts[1].moment.description, /blue-hour|twilight/);
  assert.match(contracts[2].moment.description, /midday/);
  assert.match(contracts[0].prop.description, /circular light well/);
  assert.match(contracts[1].prop.description, /horizontal shadow channel/);
  assert.match(contracts[2].prop.description, /diagonal wall-to-ceiling fold/);
  assert.ok(contracts.every((contract) => !/fixed-zone-divider/.test(contract.prop.key)));
  assert.ok(contracts.every((contract) => /architectural/.test(contract.camera.description)));
  assert.ok(contracts.every((contract) => /junction|convergence/.test(contract.camera.description)));
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
    1,
    variants[0],
    cumulativeAudit,
  );
  assert.match(guidance, /HARD ROLE BLACKLIST: portrait, wide/);
  assert.match(guidance, /location=.*time\/light=.*surface=.*fixed cue=.*product placement=.*camera=/);
  assert.match(guidance, /Validated prior audit failure dimensions: time-light, fixed-cue, camera/);
  assert.match(guidance, /STRUCTURED FAILED-PLATE BLACKLIST/);
  assert.match(guidance, /time-light=portrait-warm-side-light/);
  assert.match(guidance, /camera=rejected-detail-overview-1-near-axial/);
  assert.match(guidance, /fixed-cue\/supporting-object=portrait-fixed-vertical-post\|right-side-wall-return\|stepped-divider-array/);
  assert.match(guidance, /fixed vertical divider, post, wall return, jamb, fin, stepped divider array, deep reveal, recessed bay/);
  assert.doesNotMatch(guidance, /unsafe key/);
  assert.match(guidance, /unchanged source pixels/);
  assert.match(guidance, /immutable product zone/);
  assert.doesNotMatch(guidance, /blacklisted role's product zone|product zone moves|move the product zone/i);
  assert.doesNotMatch(guidance, /contact plane|contact geometry/i);
  assert.doesNotMatch(guidance, /bathroom vanity|bedroom nightstand/);
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
  assert.match(worker, /findDuplicateShot\([\s\S]*fingerprint,[\s\S]*existingShots[\s\S]*rejectedSourceEvidenceShots/);
  assert.match(worker, /downloadComparisonShots\(job, preset\.id, jobDir, jobHeartbeat\.signal\)/);
  assert.match(worker, /const comparisonDownloadGate = createConcurrencyGate\(3\)/);
  assert.match(worker, /fetch\(image\.signedUrl, \{ signal: downloadSignal\(leaseSignal, 30_000\) \}\)/);
  assert.match(worker, /expectedAssetIds[\s\S]*assetId !== targetAssetId/);
  assert.match(worker, /const previousAssetId = `previous:\$\{targetAssetId\}`/);
  assert.match(worker, /comparisonById\.size !== expectedAssetIds\.length \+ 1/);
  assert.match(worker, /\[\.\.\.expectedAssetIds, previousAssetId\]/);
  assert.match(claimRoute, /candidate\.id === assetId \? `previous:\$\{candidate\.id\}` : candidate\.id/);
  assert.match(worker, /existingShots\.length !== imagePresets\.length/);
  assert.match(worker, /match=\$\{duplicate\.exact \? "sha256" : "dhash"\}/);
  assert.match(worker, /buildSettingShotRetryVariant\(baseSettingShot, preset\.id, retryIndex\)/);
  assert.match(worker, /never this persisted source-composite mask/);
  assert.match(worker, /retryConflictAssetIds/);
  assert.match(worker, /failedDimensions/);
  assert.match(worker, /auditError\.retryAuditFeedback = \{/);
  assert.match(worker, /hardNegativeMomentKeys: \[parsed\.data\.observedMomentKey\]/);
  assert.match(worker, /hardNegativeCueKeys: parsed\.data\.observedNonMerchandiseProps/);
  assert.match(worker, /expectedPropDescription: backgroundContract\.prop\.description/);
  assert.match(worker, /retryAuditFeedback = mergeSettingShotRetryAuditFeedback\(/);
  assert.match(worker, /\.\.\.retryConflictAssetIds,[\s\S]*error\?\.conflictingAssetIds/);
  assert.match(worker, /Source-composited output duplicate reason[\s\S]*retryAuditFeedback = mergeSettingShotRetryAuditFeedback|retryAuditFeedback = mergeSettingShotRetryAuditFeedback\([\s\S]*Source-composited output duplicate reason/);
  assert.match(worker, /rejectedBackgroundShots/);
  assert.match(worker, /comparisonPlates: boundedBackgroundComparisonShots\(\)/);
  assert.match(worker, /hasPublishedSameSlotComparison[\s\S]*\? \[\.\.\.existingBackgroundShots\][\s\S]*: \[\.\.\.rejectedBackgroundShots, \.\.\.existingBackgroundShots\]/);
  assert.match(worker, /slice\(0, maximumBackgroundAuditComparisons\)/);
  assert.match(worker, /buildDuplicateRetryGuidance\(preset\.id, duplicate\.assetId, attempt, "source-evidence"\)/);
  assert.match(worker, /buildDuplicateRetryGuidance\(preset\.id, duplicate\.assetId, attempt, "product-mockup"\)/);
  assert.match(worker, /Keep the immutable source-product mask and follow the next deterministic background retry contract/);
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
  assert.match(worker, /rejectedSourceEvidenceShots[\s\S]*\.\.\.existingShots, \.\.\.rejectedSourceEvidenceShots/);
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
  assert.match(worker, /assertIdentityBackgroundPlate\(generated, generationPreset\)/);
  assert.match(worker, /executeSourceProductCutout\("background"/);
  assert.match(worker, /auditGeneratedIdentityBackground\(\{/);
  assert.match(worker, /contactMode: backgroundContactMode/);
  assert.match(worker, /compositeIdentityForeground\([\s\S]*backgroundContactMode,[\s\S]*\)/);
  assert.match(worker, /for \(const existingBackground of \[\.\.\.existingBackgroundShots, \.\.\.rejectedBackgroundShots\]\)[\s\S]*findDuplicateShot\(candidateFingerprint, \[existingBackground\]\)/);
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
