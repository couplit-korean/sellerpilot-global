import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aiGeneratedAssetPath,
  aiGeneratedAssetSpecs,
  coreFirstDraftAssetIds,
} from "../lib/ai-generated-assets";
import { createProductResearchJobWithLegacyFallback } from "../lib/product-research-rpc-compatibility";
import {
  validateSucceededProductResearchPreflight,
  validateVisibleSucceededProductResearchJob,
} from "../lib/product-studio-lineage";

const researchJobId = "22222222-2222-4222-8222-222222222222";
const claimToken = "33333333-3333-4333-8333-333333333333";
const otherClaimToken = "44444444-4444-4444-8444-444444444444";
const sourcePhotoSha256 = "a".repeat(64);
const researchInputSha256 = "c".repeat(64);

function researchResult() {
  const asset_storage_paths = Object.fromEntries(coreFirstDraftAssetIds.map((assetId) => {
    const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!;
    return [assetId, aiGeneratedAssetPath(researchJobId, spec, claimToken)];
  }));
  const preflightAssetLineage = Object.fromEntries(coreFirstDraftAssetIds.map((assetId, index) => {
    const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!;
    return [assetId, {
      digest: (index + 1).toString(16).repeat(64),
      role: spec.role,
      auditMode: index % 2 === 0 ? "segmented-source-composite" : "source-photo-catalog",
      sourceRole: "main",
    }];
  }));
  return {
    preflightVersion: 1,
    researchInputSha256,
    sourcePhotoSha256,
    asset_storage_paths,
    preflightAssetLineage,
  };
}

function succeededResearchJob(result: unknown = researchResult()) {
  return {
    id: researchJobId,
    kind: "product_research",
    status: "succeeded",
    result,
  };
}

test("legacy research remains visible but cannot satisfy final image preflight lineage", () => {
  const legacy = succeededResearchJob({ mode: "server-research", summary: "legacy text result" });
  assert.deepEqual(validateVisibleSucceededProductResearchJob({
    expectedJobId: researchJobId,
    data: legacy,
    error: null,
  }), { valid: true });
  assert.deepEqual(validateSucceededProductResearchPreflight({
    expectedJobId: researchJobId,
    expectedResearchInputSha256: researchInputSha256,
    expectedSourcePhotoSha256: sourcePhotoSha256,
    data: legacy,
  }), { valid: false, reason: "preflight_missing" });
});

test("final lineage accepts exactly six canonical same-claim research assets", () => {
  const validated = validateSucceededProductResearchPreflight({
    expectedJobId: researchJobId,
    expectedResearchInputSha256: researchInputSha256,
    expectedSourcePhotoSha256: sourcePhotoSha256,
    data: succeededResearchJob(),
  });
  assert.equal(validated.valid, true);
  if (!validated.valid) return;
  assert.equal(validated.preflight.preflightVersion, 1);
  assert.equal(validated.preflight.researchInputSha256, researchInputSha256);
  assert.equal(validated.preflight.claimToken, claimToken);
  assert.deepEqual(Object.keys(validated.preflight.assetStoragePaths), [...coreFirstDraftAssetIds]);
  assert.deepEqual(Object.keys(validated.preflight.assetDigests), [...coreFirstDraftAssetIds]);
  assert.deepEqual(Object.keys(validated.preflight.auditLineage), [...coreFirstDraftAssetIds]);
});

test("final lineage rejects missing, extra, cross-job, cross-claim, digest and source-photo drift", () => {
  const mutations: Array<{ expectedReason: string; mutate: (result: ReturnType<typeof researchResult>) => void }> = [
    {
      expectedReason: "preflight_invalid",
      mutate: (result) => { Reflect.deleteProperty(result.asset_storage_paths, "portrait"); },
    },
    {
      expectedReason: "preflight_invalid",
      mutate: (result) => { Object.assign(result.asset_storage_paths, { hero: "results/unsafe/hero.png" }); },
    },
    {
      expectedReason: "preflight_invalid",
      mutate: (result) => {
        const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait")!;
        result.asset_storage_paths.portrait = aiGeneratedAssetPath(
          "55555555-5555-4555-8555-555555555555",
          spec,
          claimToken,
        );
      },
    },
    {
      expectedReason: "preflight_invalid",
      mutate: (result) => {
        const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === "wide")!;
        result.asset_storage_paths.wide = aiGeneratedAssetPath(researchJobId, spec, otherClaimToken);
      },
    },
    {
      expectedReason: "preflight_invalid",
      mutate: (result) => { result.preflightAssetLineage["detail-use"].digest = "A".repeat(64); },
    },
    {
      expectedReason: "research_input_mismatch",
      mutate: (result) => { result.researchInputSha256 = "d".repeat(64); },
    },
    {
      expectedReason: "source_photo_mismatch",
      mutate: (result) => { result.sourcePhotoSha256 = "b".repeat(64); },
    },
  ];

  for (const { expectedReason, mutate } of mutations) {
    const result = structuredClone(researchResult());
    mutate(result);
    assert.deepEqual(validateSucceededProductResearchPreflight({
      expectedJobId: researchJobId,
      expectedResearchInputSha256: researchInputSha256,
      expectedSourcePhotoSha256: sourcePhotoSha256,
      data: succeededResearchJob(result),
    }), { valid: false, reason: expectedReason });
  }
});

test("new image preflight enqueue never downgrades to a legacy product_studio job", async () => {
  const calls: Array<{ p_kind: string; p_request_payload: Record<string, unknown> }> = [];
  const missingRpc = {
    code: "PGRST202",
    message: "Could not find the function public.sellerpilot_create_ai_job(p_id, p_kind, p_request_payload) in the schema cache",
  };
  const result = await createProductResearchJobWithLegacyFallback({
    jobId: researchJobId,
    researchInput: "사진 기반 1차 분석",
    sourcePhotoSha256,
    imagePaths: [`owner/${researchJobId}/input/001.jpg`],
    imageSpecs: [{ role: "main" }],
    preflightVersion: 1,
    createJob: async (arguments_) => {
      calls.push(arguments_);
      return { error: missingRpc };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_kind, "product_research");
  assert.deepEqual(calls[0].p_request_payload.image_paths, [`owner/${researchJobId}/input/001.jpg`]);
  assert.deepEqual(calls[0].p_request_payload.image_specs, [{ role: "main" }]);
  assert.equal(calls[0].p_request_payload.preflight_version, 1);
  assert.equal(result.error, missingRpc);
  assert.equal(result.usedLegacyFallback, false);
});

test("research and final routes enforce source images, exact absence cleanup and preflight propagation", async () => {
  const [researchRoute, studioRoute] = await Promise.all([
    readFile(new URL("../app/api/ai/product-research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/product-studio/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(researchRoute, /validatePreservedStudioUploadPaths/);
  assert.match(researchRoute, /verifyPreservedStudioImages/);
  assert.match(researchRoute, /sha256PreservedStudioOriginalImage/);
  assert.match(researchRoute, /uploadedMainSourceSha256 !== parsed\.data\.sourcePhotoFingerprint/);
  assert.match(researchRoute, /imagePaths: uploadedPaths/);
  assert.match(researchRoute, /imageSpecs: parsed\.data\.imageSpecs/);
  assert.match(researchRoute, /preflightVersion: 1/);
  assert.match(researchRoute, /if \(!readback \|\| readback\.error \|\| readback\.data != null\) return false;[\s\S]*\.remove\(paths\)/);
  assert.match(researchRoute, /PRODUCT_RESEARCH_PREFLIGHT_UNAVAILABLE/);

  assert.match(studioRoute, /validateSucceededProductResearchPreflight/);
  assert.match(studioRoute, /expectedResearchInputSha256: productResearchInputSha256\(parsed\.data\.manualFields\.researchInput\)/);
  assert.match(studioRoute, /preflight_asset_storage_paths: sourcePreflight\.preflight\.assetStoragePaths/);
  assert.match(studioRoute, /preflight_asset_digests: sourcePreflight\.preflight\.assetDigests/);
  assert.match(studioRoute, /preflight_asset_audit_lineage: sourcePreflight\.preflight\.auditLineage/);
  assert.match(studioRoute, /SOURCE_RESEARCH_PREFLIGHT_REQUIRED/);
});

test("job polling validates the exact research result before signing the six image paths", async () => {
  const route = await readFile(new URL("../app/api/ai/jobs/[id]/route.ts", import.meta.url), "utf8");
  const validation = route.indexOf("serverProductResearchResultSchema.safeParse(result)");
  const signing = route.indexOf("createSignedUrls(entries.map", validation);

  assert.ok(validation >= 0);
  assert.ok(signing > validation);
  assert.match(route, /validateVisibleSucceededProductResearchJob/);
  assert.match(route, /validateSucceededProductResearchPreflight/);
  assert.match(route, /expectedJobId: id/);
  assert.match(route, /preflight\.preflight\.assetStoragePaths\[assetId\]/);
  assert.match(route, /coreFirstDraftAssetIds\.map/);
  assert.match(route, /signed\.length !== entries\.length/);
  assert.match(route, /status: "failed"[\s\S]{0,180}productResearchFailureMessage\("gateway_result_invalid"\)/);
  assert.ok(route.indexOf("delete result.asset_storage_paths", signing) > signing);
});


test("multi-photo lineage preserves every original digest and rejects mixed source sets", () => {
  const result = {
    ...researchResult(),
    sourcePhotoEvidence: ["main", "extra-1", "extra-2", "extra-3"].map((inputRole, index) => ({
      sourceIndex: index, sourceSha256: index === 0 ? sourcePhotoSha256 : String(index).repeat(64),
      inputRole, resolvedRole: ["main", "left", "label", "back"][index], confidence: 0.99,
      imageAssets: [], detailAssets: [], facts: [], warnings: [],
    })),
  };
  for (const [index, asset] of Object.values(result.preflightAssetLineage).entries()) {
    Object.assign(asset, { sourceSha256: result.sourcePhotoEvidence[index % 4].sourceSha256 });
  }
  const validate = (value: unknown) => validateSucceededProductResearchPreflight({ expectedJobId: researchJobId,
    expectedResearchInputSha256: researchInputSha256, expectedSourcePhotoSha256: sourcePhotoSha256, data: succeededResearchJob(value) });
  const valid = validate(result);
  assert.equal(valid.valid, true);
  if (valid.valid) assert.deepEqual(valid.preflight.sourcePhotoEvidence, result.sourcePhotoEvidence);
  const reordered = structuredClone(result);
  reordered.sourcePhotoEvidence.reverse();
  assert.equal(validate(reordered).valid, false);
  const replaced = structuredClone(result);
  replaced.sourcePhotoEvidence[1].sourceSha256 = "f".repeat(64);
  assert.equal(validate(replaced).valid, false);
  const missingDigest = structuredClone(result);
  Reflect.deleteProperty(missingDigest.preflightAssetLineage.portrait, "sourceSha256");
  assert.equal(validate(missingDigest).valid, false);
});
