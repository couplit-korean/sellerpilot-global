import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import {
  validateFinalStudioAssetStoragePaths,
  validateStoredProductGeneratedAssetPaths,
} from "../lib/studio-result-assets";

const jobId = "10000000-0000-4000-8000-000000000001";
const claimToken = "20000000-0000-4000-8000-000000000002";

function exactPaths(nextJobId = jobId, nextClaimToken = claimToken) {
  return Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [
    asset.id,
    aiGeneratedAssetPath(nextJobId, asset, nextClaimToken),
  ]));
}

test("final Studio polling accepts only the exact 16 assets from one job and claim", () => {
  const paths = exactPaths();
  const entries = validateFinalStudioAssetStoragePaths(jobId, paths);
  assert.equal(entries?.length, aiGeneratedAssetSpecs.length);

  const missing = { ...paths };
  delete missing[aiGeneratedAssetSpecs[0].id];
  assert.equal(validateFinalStudioAssetStoragePaths(jobId, missing), null);

  const crossClaim = { ...paths };
  const changed = aiGeneratedAssetSpecs[1];
  crossClaim[changed.id] = aiGeneratedAssetPath(
    jobId,
    changed,
    "30000000-0000-4000-8000-000000000003",
  );
  assert.equal(validateFinalStudioAssetStoragePaths(jobId, crossClaim), null);

  assert.equal(
    validateFinalStudioAssetStoragePaths(
      "40000000-0000-4000-8000-000000000004",
      paths,
    ),
    null,
  );
});

test("stored product assets allow a canonical regenerated role but reject partial or mismatched files", () => {
  const paths = exactPaths();
  const regenerated = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-care");
  assert.ok(regenerated);
  paths[regenerated.id] = aiGeneratedAssetPath(
    "50000000-0000-4000-8000-000000000005",
    regenerated,
    "60000000-0000-4000-8000-000000000006",
  );
  assert.equal(validateStoredProductGeneratedAssetPaths(paths)?.length, aiGeneratedAssetSpecs.length);

  const wrongFile = { ...paths, hero: paths.square };
  assert.equal(validateStoredProductGeneratedAssetPaths(wrongFile), null);

  const partial = { ...paths };
  delete partial[aiGeneratedAssetSpecs.at(-1)!.id];
  assert.equal(validateStoredProductGeneratedAssetPaths(partial), null);
});

test("job polling and publish context fail closed without hiding a valid source-image fallback", async () => {
  const [jobRoute, publishContextRoute] = await Promise.all([
    readFile(new URL("../app/api/ai/jobs/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/products/[id]/publish-context/route.ts", import.meta.url), "utf8"),
  ]);

  const studioValidation = jobRoute.indexOf("validateFinalStudioAssetStoragePaths");
  const studioSigning = jobRoute.indexOf("createSignedUrls(entries.map", studioValidation);
  assert.ok(studioValidation >= 0);
  assert.ok(studioSigning > studioValidation);
  assert.match(jobRoute, /signed\.length !== entries\.length/);
  assert.match(jobRoute, /generated_asset_set_incomplete/);

  const storedValidation = publishContextRoute.indexOf("validateStoredProductGeneratedAssetPaths");
  const separatedSigning = publishContextRoute.indexOf("Promise.all", storedValidation);
  const sourceFailure = publishContextRoute.indexOf("상품 원본 이미지 접근 주소를 만들지 못했습니다", separatedSigning);
  const generatedFallback = publishContextRoute.indexOf('generatedImagesStatus = "unavailable"', sourceFailure);
  assert.ok(storedValidation >= 0);
  assert.ok(separatedSigning > storedValidation);
  assert.ok(sourceFailure > separatedSigning);
  assert.ok(generatedFallback > sourceFailure);
  assert.match(publishContextRoute, /generatedImagesStatus === "complete"[\s\S]*generatedImagesStatus = "unavailable"/);
  assert.match(publishContextRoute, /generatedImagesStatus === "complete"[\s\S]*: \[\];/);
});
