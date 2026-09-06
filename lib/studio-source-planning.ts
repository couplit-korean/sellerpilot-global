import { z } from "zod";
import { aiGeneratedAssetSpecs, type AiGeneratedAssetId } from "./ai-generated-assets";

export const studioSourceObservationSchema = z.object({
  role: z.enum(["front", "back", "left", "right", "top", "bottom", "label", "barcode", "contents", "detail", "unknown"]),
  confidence: z.number().min(0).max(1),
  sameProduct: z.enum(["yes", "no", "uncertain"]),
  wholeProduct: z.boolean(),
  readableText: z.string().max(4000),
  facts: z.array(z.object({
    kind: z.enum(["ingredients", "nutrition", "allergens", "contents", "storage", "caution", "identity", "other"]),
    value: z.string().min(1).max(600),
    quote: z.string().min(1).max(600),
    confidence: z.number().min(0).max(1),
  })).max(16),
  warnings: z.array(z.string().max(300)).max(5),
});
export type StudioSourceObservation = z.infer<typeof studioSourceObservationSchema>;
export type PlannedStudioSource = {
  path: string; role: string; name: string; mediaType: string; bytes: Uint8Array;
  observation?: StudioSourceObservation;
};
export const detailSourceAssetIds = ["detail-overview", "detail-feature", "detail-use", "detail-package", "detail-routine", "detail-dimensions", "detail-contents", "detail-care"] as const;
const viewRoles = new Set(["main", "front", "back", "left", "right", "top", "bottom"]);
const evidencePreferences: Partial<Record<AiGeneratedAssetId, readonly string[]>> = {
  "detail-feature": ["label", "detail", "front", "main"],
  "detail-package": ["back", "left", "right", "top", "bottom"],
  "detail-contents": ["contents", "left", "right", "back", "top", "bottom"],
  "detail-care": ["label", "back", "bottom"],
};

export function effectiveStudioSourceRole(source: PlannedStudioSource) {
  if (source.role === "main") return "main";
  const observation = source.observation;
  if (observation) return observation.sameProduct === "yes" && observation.confidence >= 0.85 ? observation.role : "unknown";
  return source.role;
}
export function isStudioSceneSource(source: PlannedStudioSource) {
  return viewRoles.has(effectiveStudioSourceRole(source))
    && (!source.observation || (source.observation.sameProduct === "yes" && source.observation.confidence >= 0.85 && source.observation.wholeProduct));
}
export function studioSourceFacts(source: PlannedStudioSource) {
  const observation = source.observation;
  if (!observation || observation.sameProduct !== "yes" || observation.confidence < 0.85) return [];
  return observation.facts.filter(fact => fact.confidence >= 0.95 && observation.readableText.includes(fact.quote))
    .map(fact => ({ ...fact, value: fact.quote }));
}

/** One frozen plan is shared by compositing, OCR audit and completion lineage. */
export function planStudioSourceAssignments<T extends PlannedStudioSource>(
  sources: readonly T[],
  specs: readonly (typeof aiGeneratedAssetSpecs)[number][] = aiGeneratedAssetSpecs,
) {
  if (!sources.length) throw new Error("source_image_missing");
  const main = sources.find(source => source.role === "main") ?? sources[0];
  const plan = new Map<AiGeneratedAssetId, T>();
  const sceneUses = new Map<string, number>();
  const detailUses = new Map<string, number>();
  // Plan the eight displayed roles before optional gallery roles so a source
  // used only in an unselected gallery slot cannot satisfy page coverage.
  const ordered = [...specs].sort((a, b) =>
    Number(!detailSourceAssetIds.includes(a.id as typeof detailSourceAssetIds[number]))
    - Number(!detailSourceAssetIds.includes(b.id as typeof detailSourceAssetIds[number])));
  for (const asset of ordered) {
    let source: T;
    if (asset.identityPolicy.mode === "source-catalog") source = main;
    else {
      const scene = asset.identityPolicy.mode === "source-composite";
      const preferences: readonly string[] = scene
        ? asset.identityPolicy.sourceRoles.filter(role => viewRoles.has(role))
        : evidencePreferences[asset.id] ?? asset.identityPolicy.sourceRoles;
      const candidates = sources.filter(candidate => scene ? isStudioSceneSource(candidate) : preferences.includes(effectiveStudioSourceRole(candidate)));
      const uses = scene ? sceneUses : detailUses;
      // A dedicated readable label / actual contents photo wins its semantic
      // slot; remaining views rotate before reusing the same original.
      const dedicated = candidates.filter(candidate =>
        (asset.id === "detail-feature" && effectiveStudioSourceRole(candidate) === "label")
        || (asset.id === "detail-contents" && effectiveStudioSourceRole(candidate) === "contents"));
      source = [...(dedicated.length ? dedicated : candidates)].sort((a, b) =>
        (uses.get(a.path) ?? 0) - (uses.get(b.path) ?? 0)
        || preferences.indexOf(effectiveStudioSourceRole(a)) - preferences.indexOf(effectiveStudioSourceRole(b)))[0] ?? main;
      uses.set(source.path, (uses.get(source.path) ?? 0) + 1);
    }
    plan.set(asset.id, source);
  }
  // Use unused, confidently identified evidence in a compatible displayed
  // evidence slot whose current source is repeated. Never turn a label into a prop.
  const displayed = ordered.filter(asset => detailSourceAssetIds.includes(asset.id as typeof detailSourceAssetIds[number]));
  for (const source of sources) {
    if (effectiveStudioSourceRole(source) === "unknown" || displayed.some(asset => plan.get(asset.id)?.path === source.path)) continue;
    const target = displayed.find(asset => asset.identityPolicy.mode === "source-evidence"
      && (evidencePreferences[asset.id] ?? asset.identityPolicy.sourceRoles).includes(effectiveStudioSourceRole(source))
      && displayed.filter(other => plan.get(other.id)?.path === plan.get(asset.id)?.path).length > 1
      && asset.id !== "detail-feature" && asset.id !== "detail-contents");
    if (target) plan.set(target.id, source);
  }
  return plan;
}

export function studioSourceCoverage<T extends PlannedStudioSource>(sources: readonly T[], plan: ReadonlyMap<AiGeneratedAssetId, T>) {
  return sources.map((source, index) => ({
    sourceIndex: index, inputRole: source.role, resolvedRole: effectiveStudioSourceRole(source),
    confidence: source.observation?.confidence ?? null,
    imageAssets: [...plan].filter(([, value]) => value.path === source.path).map(([id]) => id),
    detailAssets: [...plan].filter(([id, value]) => value.path === source.path && detailSourceAssetIds.includes(id as typeof detailSourceAssetIds[number])).map(([id]) => id),
    omissionReason: [...plan].some(([id, value]) => value.path === source.path && detailSourceAssetIds.includes(id as typeof detailSourceAssetIds[number])) ? null
      : effectiveStudioSourceRole(source) === "unknown" ? "unverified_role" as const : "no_compatible_detail_slot" as const,
    facts: studioSourceFacts(source), warnings: source.observation?.warnings ?? [],
  }));
}

export const studioSourceEvidenceSchema = z.object({
  sourceIndex: z.number().int().min(0).max(99),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  inputRole: z.string().min(1).max(40),
  resolvedRole: z.string().min(1).max(40),
  confidence: z.number().min(0).max(1).nullable(),
  omissionReason: z.enum(["unverified_role", "no_compatible_detail_slot"]).nullable().optional(),
  imageAssets: z.array(z.string()).max(16),
  detailAssets: z.array(z.string()).max(8),
  facts: studioSourceObservationSchema.shape.facts,
  warnings: z.array(z.string().max(300)).max(5),
});
