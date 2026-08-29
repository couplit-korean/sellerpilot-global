export type IdentityPlacement = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ProductSceneDimension = "location" | "moment" | "surface" | "cue" | "staging" | "camera";

const settingShotSceneIndex: Record<string, number> = {
  portrait: 0,
  wide: 1,
  "detail-overview": 2,
  "detail-use": 3,
  "detail-routine": 4,
  "detail-scale": 5,
  "detail-storage": 6,
  "detail-context": 7,
};

function normalizedSceneIdentityText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") || "unknown product";
}

function seededSceneHash(value: string, seed: number) {
  let hash = (seed ^ value.length) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x5bd1e995);
    hash = ((hash << 13) | (hash >>> 19)) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function sceneDigestRemainder(value: string, modulus: number) {
  const high = seededSceneHash(value, 0x243f6a88);
  const low = seededSceneHash(value, 0x9e3779b9);
  // Combine both independent 32-bit lanes as an unsigned 64-bit remainder.
  // Every current scene pool is tiny; the bound also keeps this arithmetic exact
  // under Number.MAX_SAFE_INTEGER without requiring BigInt in browser bundles.
  if (modulus > 1_000_000) throw new Error("상품 장면 변형 모듈러스가 너무 큽니다.");
  return (((high % modulus) * (0x1_0000_0000 % modulus)) + (low % modulus)) % modulus;
}

export function resolveProductSceneVariantCode(
  sceneIdentityText: string,
  assetId: string,
  dimension: ProductSceneDimension,
  modulus: number,
) {
  if (!Number.isSafeInteger(modulus) || modulus < 2) throw new Error("상품 장면 변형 모듈러스가 올바르지 않습니다.");
  const slot = settingShotSceneIndex[assetId];
  if (slot === undefined) return 0;
  const lane = [
    normalizedSceneIdentityText(sceneIdentityText),
    assetId,
    dimension,
    String(slot),
  ].join("\u001f");
  return sceneDigestRemainder(lane, modulus);
}

function placementDirection(value: number, negative: string, positive: string) {
  if (value === 0) return "기준";
  return value < 0 ? negative : positive;
}

export function resolveProductPlacementVariant(sceneIdentityText: string, assetId: string) {
  const code = resolveProductSceneVariantCode(sceneIdentityText, assetId, "staging", 999_983);
  const horizontalOffset = ((code % 161) - 80) / 1_000;
  const bottomOffset = ((Math.floor(code / 161) % 91) - 45) / 1_000;
  const scale = 1 + ((Math.floor(code / (161 * 91)) % 69) - 34) / 1_000;
  const horizontalMagnitude = Math.abs(horizontalOffset * 100).toFixed(1);
  const verticalMagnitude = Math.abs(bottomOffset * 100).toFixed(1);
  const scalePercent = (scale * 100).toFixed(1);
  const horizontalDirection = placementDirection(horizontalOffset, "왼쪽", "오른쪽");
  const verticalDirection = placementDirection(bottomOffset, "위", "아래");
  return {
    key: `x-${horizontalDirection === "왼쪽" ? "left" : horizontalDirection === "오른쪽" ? "right" : "axis"}-${Math.abs(Math.round(horizontalOffset * 1_000))}-y-${verticalDirection === "위" ? "up" : verticalDirection === "아래" ? "down" : "contact"}-${Math.abs(Math.round(bottomOffset * 1_000))}-scale-${Math.round(scale * 1_000)}`,
    description: `역할 기준점에서 ${horizontalDirection} 방향 ${horizontalMagnitude}%p, 접촉선은 ${verticalDirection} 방향 ${verticalMagnitude}%p 이동하고 원본 실루엣 크기는 ${scalePercent}%로 유지하는 물리적 배치`,
    horizontalOffset,
    bottomOffset,
    scale,
  };
}

function boundedPlacementValue(value: number) {
  return Number(Math.min(0.97, Math.max(0.03, value)).toFixed(4));
}

export function resolveProductIdentityPlacement(
  preset: { id: string; identityPolicy: { placement: IdentityPlacement } },
  sceneIdentityText: string,
): IdentityPlacement {
  if (!(preset.id in settingShotSceneIndex)) return { ...preset.identityPolicy.placement };
  const canonical = aiGeneratedAssetSpecs.find((candidate) => candidate.id === preset.id)?.identityPolicy.placement
    ?? preset.identityPolicy.placement;
  const variant = resolveProductPlacementVariant(sceneIdentityText, preset.id);
  const width = Number((canonical.width * variant.scale).toFixed(4));
  const height = Number((canonical.height * variant.scale).toFixed(4));
  const centerX = canonical.left + canonical.width / 2 + variant.horizontalOffset;
  const bottom = canonical.top + canonical.height + variant.bottomOffset;
  const left = boundedPlacementValue(Math.min(0.97 - width, Math.max(0.03, centerX - width / 2)));
  const top = boundedPlacementValue(Math.min(0.97 - height, Math.max(0.03, bottom - height)));
  return { left, top, width, height };
}

export const aiGeneratedAssetSpecs = [
  {
    id: "hero",
    file: "hero.png",
    role: "gallery",
    label: "clean ecommerce product hero",
    purpose: "brand-led representative image that establishes premium product identity",
    shotClass: "asymmetric-front-three-quarter-hero",
    ratio: "1:1",
    width: 1200,
    height: 1200,
    referenceRoles: ["main", "front", "left", "right"],
    composition: "one product only, positioned on the right visual third, filling 72–82% of the frame, complete package visible, with intentional clean negative space on the left",
    subjectPlacement: "right third on a low pedestal with open negative space to the left",
    scene: "warm light-neutral seamless studio sweep with a restrained low pedestal and one directional soft contact shadow",
    camera: "eye-level 35mm front three-quarter camera from the product's left side",
    mustDifferFrom: ["square", "detail-feature", "detail-package", "detail-material"],
    identityPolicy: { mode: "source-catalog", sourceRoles: ["main", "front"], background: "#f7f3ed", placement: { left: 0.26, top: 0.08, width: 0.70, height: 0.84 } },
  },
  {
    id: "square",
    file: "thumbnail-square.png",
    role: "gallery",
    label: "marketplace primary thumbnail",
    purpose: "literal front identification image for marketplace search results",
    shotClass: "centered-straight-on-white-catalog",
    ratio: "1:1",
    width: 1200,
    height: 1200,
    referenceRoles: ["main", "front", "left", "right"],
    composition: "one product only, dead centered, filling 78–86% of the square frame, straight-on front catalog composition, complete silhouette visible and symmetric margins",
    subjectPlacement: "dead center with equal four-side margins and no pedestal",
    scene: "pure white shadow-minimal catalog background without props, gradient, horizon line or pedestal",
    camera: "straight-on 70mm orthographic-looking front product camera at label height",
    mustDifferFrom: ["hero", "detail-feature", "detail-package", "detail-dimensions"],
    identityPolicy: { mode: "source-catalog", sourceRoles: ["main", "front"], background: "#ffffff", placement: { left: 0.07, top: 0.07, width: 0.86, height: 0.86 } },
  },
  {
    id: "portrait",
    file: "thumbnail-portrait.png",
    role: "creative",
    label: "mobile portrait setting shot",
    purpose: "vertical lifestyle discovery image that establishes the first real use setting",
    shotClass: "vertical-environmental-setting",
    ratio: "4:5",
    width: 1200,
    height: 1500,
    referenceRoles: ["main", "front", "left", "right", "top"],
    composition: "vertical real-world setting shot, product filling 58–70% of the frame, complete package in the upper two-thirds, assigned place clearly visible",
    subjectPlacement: "assigned product-specific portrait placement, never centered like square",
    scene: "the first assigned product-specific real environment, never a colored studio wall or geometric set",
    camera: "the product-specific portrait camera assigned by the setting-shot plan",
    mustDifferFrom: ["hero", "square", "wide", "detail-overview", "detail-routine"],
    identityPolicy: { mode: "source-composite", sourceRoles: ["main", "front", "extra"], background: "#f5f1ea", placement: { left: 0.08, top: 0.10, width: 0.62, height: 0.74 } },
  },
  {
    id: "wide",
    file: "thumbnail-wide.png",
    role: "creative",
    label: "wide product setting shot",
    purpose: "horizontal activity narrative showing how the product enters a real task",
    shotClass: "horizontal-activity-setting",
    ratio: "16:9",
    width: 1600,
    height: 900,
    referenceRoles: ["main", "front", "left", "right"],
    composition: "wide real-world setting shot, product filling at least 48% of the frame, assigned activity area readable across the frame",
    subjectPlacement: "assigned far-side product position with a long activity path across the opposite side",
    scene: "the second assigned product-specific real environment in a different location and moment from portrait",
    camera: "the product-specific wide camera assigned by the setting-shot plan",
    mustDifferFrom: ["portrait", "detail-overview", "detail-use", "detail-context"],
    identityPolicy: { mode: "source-composite", sourceRoles: ["left", "right", "back", "extra", "main", "front"], background: "#f3efe7", placement: { left: 0.61, top: 0.10, width: 0.34, height: 0.78 } },
  },
  {
    id: "detail-overview",
    file: "detail-overview.png",
    role: "detail",
    label: "detail page environmental overview",
    purpose: "whole-product storage or preparation overview that explains scale and organization",
    shotClass: "high-environmental-overview",
    ratio: "4:5",
    width: 1200,
    height: 1500,
    referenceRoles: ["main", "front", "left", "right", "back"],
    composition: "one complete product in its assigned storage or preparation environment, filling 58–70% of the portrait frame, product and environmental relationship immediately readable",
    subjectPlacement: "assigned rear or central storage position with readable empty foreground depth",
    scene: "the third assigned product-specific real environment, focused on storage or preparation rather than active use",
    camera: "the product-specific high rear overview camera assigned by the setting-shot plan",
    mustDifferFrom: ["hero", "square", "portrait", "wide", "detail-feature", "detail-use", "detail-storage"],
    identityPolicy: { mode: "source-composite", sourceRoles: ["back", "top", "left", "right", "extra", "main", "front"], background: "#f6f4ef", placement: { left: 0.18, top: 0.14, width: 0.56, height: 0.70 } },
  },
  {
    id: "detail-feature",
    file: "detail-feature.png",
    role: "detail",
    label: "source label and visible-feature close-up",
    purpose: "source-pixel evidence of visible front label, material and construction without inferred claims",
    shotClass: "source-front-feature-crop",
    ratio: "1:1",
    width: 1200,
    height: 1200,
    referenceRoles: ["main", "label", "front", "left", "right"],
    composition: "a close source-pixel crop of the verified front package or visible product feature; retain only facts physically present in the selected source and never reconstruct hidden areas",
    subjectPlacement: "verified source pixels fill the square crop while printed marks remain unaltered",
    scene: "plain neutral evidence canvas without generated product pixels or lifestyle staging",
    camera: "direct crop from the verified source view; no synthetic camera rotation",
    mustDifferFrom: ["hero", "square", "detail-overview", "detail-package", "detail-material"],
    identityPolicy: { mode: "source-evidence", sourceRoles: ["label", "front", "main", "left", "right", "top", "bottom"], background: "#fafafa", fit: "inside", placement: { left: 0.03, top: 0.03, width: 0.94, height: 0.94 } },
  },
  {
    id: "detail-use",
    file: "detail-use.png",
    role: "detail",
    label: "detail page use context",
    purpose: "active-use evidence image showing the product's verified functional outcome",
    shotClass: "active-use-environment",
    ratio: "4:5",
    width: 1200,
    height: 1500,
    referenceRoles: ["main", "front", "left", "right", "extra"],
    composition: "realistic use context appropriate to the product, product remains dominant and fills at least 55% of the portrait frame, no people unless visible in the reference",
    subjectPlacement: "assigned product-specific use position separated in depth from the verified functional result",
    scene: "the fourth assigned category-specific environment with functional surrounding objects and clear spatial context",
    camera: "the product-specific table-level camera assigned by the setting-shot plan",
    mustDifferFrom: ["hero", "square", "portrait", "wide", "detail-overview", "detail-feature", "detail-package", "detail-routine"],
    identityPolicy: { mode: "source-composite", sourceRoles: ["label", "bottom", "left", "right", "extra", "main", "front"], background: "#f2ede4", placement: { left: 0.54, top: 0.28, width: 0.42, height: 0.64 } },
  },
  {
    id: "detail-package",
    file: "detail-package.png",
    role: "detail",
    label: "source side or rear package evidence",
    purpose: "factual source-pixel evidence of an actually supplied side, rear, label or barcode panel",
    shotClass: "source-side-rear-evidence",
    ratio: "4:5",
    width: 1200,
    height: 1500,
    referenceRoles: ["back", "label", "barcode", "top", "bottom", "left", "right", "extra", "main"],
    composition: "show only the selected supplied side, rear, label or barcode source view; do not claim a top closure, hidden plane or package structure unless it is visible in that exact source",
    subjectPlacement: "selected evidence panel centered with enough margin to keep its source pixels readable",
    scene: "plain cool neutral evidence canvas without lifestyle props, synthetic rotation or generated product pixels",
    camera: "direct crop from the selected supplied evidence view; no inferred high-oblique camera",
    mustDifferFrom: ["hero", "square", "detail-overview", "detail-feature", "detail-contents"],
    identityPolicy: { mode: "source-evidence", sourceRoles: ["back", "label", "barcode", "top", "bottom", "left", "right", "extra"], requiresDedicatedRole: true, background: "#f3f5f6", placement: { left: 0.08, top: 0.08, width: 0.84, height: 0.84 } },
  },
  {
    id: "detail-routine",
    file: "detail-routine.png",
    role: "detail",
    label: "detail page routine setting shot",
    purpose: "a verified before-use routine that explains when the product enters the customer's day",
    shotClass: "pre-use-routine-environment",
    ratio: "4:5",
    width: 1200,
    height: 1500,
    referenceRoles: ["main", "front", "left", "right", "top", "extra"],
    composition: "a complete product within a clearly readable before-use routine, product filling 52–64% of the portrait frame with only factually safe contextual cues",
    subjectPlacement: "assigned fifth-scene placement with the next-action zone visually separated",
    scene: "the fifth assigned product-specific real environment, showing a different time and routine stage from every earlier scene",
    camera: "the product-specific routine camera assigned by the setting-shot plan",
    mustDifferFrom: ["portrait", "wide", "detail-use", "detail-storage", "detail-context"],
    identityPolicy: { mode: "source-composite", sourceRoles: ["main", "front", "left", "right", "extra"], background: "#ece8e1", placement: { left: 0.31, top: 0.13, width: 0.54, height: 0.68 } },
  },
  {
    id: "detail-scale",
    file: "detail-scale.png",
    role: "detail",
    label: "detail page scale setting shot",
    purpose: "relative footprint context without invented numeric dimensions",
    shotClass: "relative-scale-spatial-context",
    ratio: "1:1",
    width: 1200,
    height: 1200,
    referenceRoles: ["main", "front", "left", "right", "top", "bottom", "extra"],
    composition: "the complete product in a spatial comparison scene, filling 55–68% of the square frame; never imply exact measurements",
    subjectPlacement: "assigned sixth-scene placement on one shared focus plane with ample separation",
    scene: "the sixth assigned real environment, dedicated to practical footprint rather than use or storage",
    camera: "the product-specific spatial comparison camera assigned by the setting-shot plan",
    mustDifferFrom: ["square", "detail-overview", "detail-dimensions", "detail-storage"],
    identityPolicy: { mode: "source-composite", sourceRoles: ["top", "bottom", "left", "right", "extra", "main", "front"], background: "#e8ecef", placement: { left: 0.12, top: 0.22, width: 0.58, height: 0.62 } },
  },
  {
    id: "detail-storage",
    file: "detail-storage.png",
    role: "detail",
    label: "detail page storage setting shot",
    purpose: "after-use storage clearance and access context",
    shotClass: "after-use-storage-environment",
    ratio: "4:5",
    width: 1200,
    height: 1500,
    referenceRoles: ["main", "back", "left", "right", "top", "extra"],
    composition: "one complete product in a credible storage position, filling 50–62% of the portrait frame with enough negative space to understand clearance and access",
    subjectPlacement: "assigned seventh-scene deep storage placement with an unobstructed access path",
    scene: "the seventh assigned product-specific real environment dedicated to storage after use, never the earlier overview location",
    camera: "the product-specific high-corner storage camera assigned by the setting-shot plan",
    mustDifferFrom: ["detail-overview", "detail-routine", "detail-scale", "detail-context"],
    identityPolicy: { mode: "source-composite", sourceRoles: ["back", "top", "left", "right", "extra", "main", "front"], background: "#eef0ea", placement: { left: 0.38, top: 0.20, width: 0.48, height: 0.58 } },
  },
  {
    id: "detail-context",
    file: "detail-context.png",
    role: "detail",
    label: "detail page wide lifestyle context",
    purpose: "a factual closing context that summarizes an everyday outcome without efficacy claims",
    shotClass: "wide-closing-context-environment",
    ratio: "16:9",
    width: 1600,
    height: 900,
    referenceRoles: ["main", "front", "left", "right", "back", "extra"],
    composition: "a wide factual everyday context with the product still clearly visible and filling at least 40% of the frame; show no efficacy, bodily change or before-and-after claim",
    subjectPlacement: "assigned eighth-scene edge placement with layered foreground and background context",
    scene: "the eighth assigned real environment or closing routine moment with a different surface, cue family and light direction",
    camera: "the product-specific wide closing-context camera assigned by the setting-shot plan",
    mustDifferFrom: ["wide", "detail-use", "detail-routine", "detail-storage"],
    identityPolicy: { mode: "source-composite", sourceRoles: ["main", "front", "left", "right", "extra"], background: "#e9edf1", placement: { left: 0.67, top: 0.18, width: 0.28, height: 0.68 } },
  },
  {
    id: "detail-material",
    file: "detail-material.png",
    role: "detail",
    label: "detail page material evidence macro",
    purpose: "source-pixel evidence of one visible material, seam, edge, texture or finish",
    shotClass: "source-material-macro-evidence",
    ratio: "1:1",
    width: 1200,
    height: 1200,
    referenceRoles: ["label", "front", "main", "left", "right", "top", "bottom", "extra"],
    composition: "a source-pixel close crop of one visibly verified material, seam, edge, texture or finish without inventing internal construction",
    subjectPlacement: "verified material pixels fill the crop while any visible marks remain unaltered",
    scene: "plain neutral evidence canvas without lifestyle props or generated product pixels",
    camera: "direct macro crop from the selected supplied source; no synthetic cutaway or rotation",
    mustDifferFrom: ["detail-feature", "detail-package", "detail-dimensions", "detail-contents"],
    identityPolicy: { mode: "source-evidence", sourceRoles: ["label", "front", "main", "left", "right", "top", "bottom", "extra"], background: "#f8f8f6", fit: "cover", placement: { left: 0.02, top: 0.02, width: 0.96, height: 0.96 } },
  },
  {
    id: "detail-dimensions",
    file: "detail-dimensions.png",
    role: "detail",
    label: "detail page form and dimensions inspection",
    purpose: "source-pixel form evidence with clean HTML annotation space and no invented measurements",
    shotClass: "source-form-proportion-evidence",
    ratio: "4:5",
    width: 1200,
    height: 1500,
    referenceRoles: ["main", "front", "left", "right", "top", "bottom"],
    composition: "full source-backed product form with visible proportions preserved; leave safe space for HTML labels but render no dimensions or text",
    subjectPlacement: "verified source form centered low with clean upper annotation space",
    scene: "precise neutral evidence canvas without measurement grid, rulers or generated product pixels",
    camera: "direct source view that best preserves verified form; no inferred isometric plane",
    mustDifferFrom: ["square", "detail-scale", "detail-material", "detail-package"],
    identityPolicy: { mode: "source-evidence", sourceRoles: ["main", "front", "left", "right", "top", "bottom"], background: "#f4f5f3", placement: { left: 0.10, top: 0.18, width: 0.80, height: 0.72 } },
  },
  {
    id: "detail-contents",
    file: "detail-contents.png",
    role: "detail",
    label: "detail page verified contents evidence",
    purpose: "source-pixel evidence of only the included items visible in a supplied contents or package view",
    shotClass: "source-contents-evidence",
    ratio: "4:5",
    width: 1200,
    height: 1500,
    referenceRoles: ["back", "label", "barcode", "top", "bottom", "left", "right", "extra"],
    composition: "show only the selected supplied contents or package view; never add, remove, separate or duplicate a physical item",
    subjectPlacement: "selected source evidence centered with every visible included item retained exactly once",
    scene: "plain light neutral evidence canvas without lifestyle props or generated accessories",
    camera: "direct crop from a supplied contents or package view; no synthetic top-down reconstruction",
    mustDifferFrom: ["detail-package", "detail-material", "detail-dimensions", "detail-care"],
    identityPolicy: { mode: "source-evidence", sourceRoles: ["back", "label", "barcode", "top", "bottom", "left", "right", "extra"], requiresDedicatedRole: true, background: "#f7f6f2", fit: "inside", placement: { left: 0.08, top: 0.10, width: 0.84, height: 0.80 } },
  },
  {
    id: "detail-care",
    file: "detail-care.png",
    role: "detail",
    label: "detail page care evidence shot",
    purpose: "source-pixel evidence of a visible care, closure, refill or handling area without inventing an action",
    shotClass: "source-care-area-evidence",
    ratio: "4:5",
    width: 1200,
    height: 1500,
    referenceRoles: ["back", "label", "left", "right", "top", "bottom", "extra", "main", "front"],
    composition: "show one verified care, closure, refill or handling area from the selected source; when no method is proven, show the physical area only",
    subjectPlacement: "selected source area centered with the surrounding verified structure retained",
    scene: "clean neutral evidence canvas with no generated tools, hands or maintenance action",
    camera: "direct crop from the supplied care or package view; no synthetic instructional angle",
    mustDifferFrom: ["detail-feature", "detail-package", "detail-material", "detail-contents"],
    identityPolicy: { mode: "source-evidence", sourceRoles: ["back", "label", "left", "right", "top", "bottom", "extra", "main", "front"], background: "#f2f4f5", fit: "cover", placement: { left: 0.06, top: 0.08, width: 0.88, height: 0.84 } },
  },
] as const;

export type AiGeneratedAssetId = (typeof aiGeneratedAssetSpecs)[number]["id"];
export type AiDetailAssetId = Extract<(typeof aiGeneratedAssetSpecs)[number], { role: "detail" }>["id"];

export const aiGeneratedAssetIds = aiGeneratedAssetSpecs.map((asset) => asset.id) as [AiGeneratedAssetId, ...AiGeneratedAssetId[]];

export const coreFirstDraftAssetIds = [
  "portrait",
  "wide",
  "detail-overview",
  "detail-use",
  "detail-routine",
  "detail-scale",
] as const satisfies readonly AiGeneratedAssetId[];

export const remainingFinalAssetIds = [
  "hero",
  "square",
  "detail-feature",
  "detail-package",
  "detail-storage",
  "detail-context",
  "detail-material",
  "detail-dimensions",
  "detail-contents",
  "detail-care",
] as const satisfies readonly AiGeneratedAssetId[];

export const aiDetailAssetIds = aiGeneratedAssetSpecs
  .filter((asset) => asset.role === "detail")
  .map((asset) => asset.id) as [AiDetailAssetId, ...AiDetailAssetId[]];

export function aiGeneratedAssetPath(
  jobId: string,
  asset: (typeof aiGeneratedAssetSpecs)[number],
  claimToken?: string | null,
) {
  return claimToken
    ? `results/${jobId}/claims/${claimToken}/${asset.file}`
    : `results/${jobId}/${asset.file}`;
}
