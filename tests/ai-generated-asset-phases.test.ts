import assert from "node:assert/strict";
import test from "node:test";
import {
  aiGeneratedAssetIds,
  coreFirstDraftAssetIds,
  remainingFinalAssetIds,
} from "../lib/ai-generated-assets";

test("first-draft and final asset phases partition all 16 roles in canonical order", () => {
  assert.equal(aiGeneratedAssetIds.length, 16);
  assert.equal(coreFirstDraftAssetIds.length, 6);
  assert.equal(remainingFinalAssetIds.length, 10);

  const coreIds = new Set(coreFirstDraftAssetIds);
  const remainingIds = new Set(remainingFinalAssetIds);
  const phasedIds = [...coreFirstDraftAssetIds, ...remainingFinalAssetIds];

  assert.equal(coreIds.size, coreFirstDraftAssetIds.length, "core roles must not contain duplicates");
  assert.equal(remainingIds.size, remainingFinalAssetIds.length, "remaining roles must not contain duplicates");
  assert.equal(new Set(phasedIds).size, aiGeneratedAssetIds.length, "each role must belong to exactly one phase");
  assert.ok(coreFirstDraftAssetIds.every((assetId) => !remainingIds.has(assetId)));
  assert.deepEqual(new Set(phasedIds), new Set(aiGeneratedAssetIds));

  assert.deepEqual(
    aiGeneratedAssetIds.filter((assetId) => coreIds.has(assetId)),
    [...coreFirstDraftAssetIds],
    "core roles must retain their canonical 16-role order",
  );
  assert.deepEqual(
    aiGeneratedAssetIds.filter((assetId) => remainingIds.has(assetId)),
    [...remainingFinalAssetIds],
    "remaining roles must retain their canonical 16-role order",
  );
});
