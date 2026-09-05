/**
 * Reviewed-input emergency reconstructions (8x8 gray mosaics, source-photo
 * catalogs, boilerplate master/localization copy) are not Studio completions.
 * Callers must fail closed with the original safe reason and the existing
 * failed completion contract. Do not invent extra DB statuses.
 */

export const SERVER_STUDIO_REVIEWED_FALLBACK_NOT_COMPLETION = "reviewed_studio_fallback_not_a_completion";
export const PREFLIGHT_ASSETS_REQUIRE_REGENERATION = "preflight_assets_require_regeneration";

export function isServerStudioSourcePhotoCatalogMode(auditMode: string | undefined) {
  return auditMode === "source-photo-catalog";
}

export function sourcePhotoCatalogRenderRejectedReason() {
  return "source_photo_catalog_not_a_studio_completion";
}

export function degradedSourcePhotoCatalogAssetIds(
  lineage: Record<string, { auditMode?: string } | undefined> | null | undefined,
) {
  if (!lineage) return [];
  return Object.entries(lineage)
    .filter(([, entry]) => isServerStudioSourcePhotoCatalogMode(entry?.auditMode))
    .map(([assetId]) => assetId)
    .sort();
}
