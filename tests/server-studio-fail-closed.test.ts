import assert from "node:assert/strict";
import test from "node:test";
import {
  SERVER_STUDIO_REVIEWED_FALLBACK_NOT_COMPLETION,
  PREFLIGHT_ASSETS_REQUIRE_REGENERATION,
  degradedSourcePhotoCatalogAssetIds,
  isServerStudioSourcePhotoCatalogMode,
  sourcePhotoCatalogRenderRejectedReason,
} from "../lib/server-studio-fail-closed";

test("reviewed fallback markers never describe a completed Studio result", () => {
  assert.equal(SERVER_STUDIO_REVIEWED_FALLBACK_NOT_COMPLETION, "reviewed_studio_fallback_not_a_completion");
  assert.equal(PREFLIGHT_ASSETS_REQUIRE_REGENERATION, "preflight_assets_require_regeneration");
  assert.equal(sourcePhotoCatalogRenderRejectedReason(), "source_photo_catalog_not_a_studio_completion");
  assert.equal(isServerStudioSourcePhotoCatalogMode("source-photo-catalog"), true);
  assert.equal(isServerStudioSourcePhotoCatalogMode("scene-composite"), false);
  assert.equal(isServerStudioSourcePhotoCatalogMode("segmented-source-composite"), false);
  assert.deepEqual(
    degradedSourcePhotoCatalogAssetIds({
      portrait: { auditMode: "segmented-source-composite" },
      wide: { auditMode: "source-photo-catalog" },
    }),
    ["wide"],
  );
});
