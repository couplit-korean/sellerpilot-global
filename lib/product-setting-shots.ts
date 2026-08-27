import {
  resolveProductPlacementVariant,
  resolveProductSceneVariantCode,
  type AiGeneratedAssetId,
} from "./ai-generated-assets";

export const settingShotAssetIds = [
  "portrait",
  "wide",
  "detail-overview",
  "detail-use",
  "detail-routine",
  "detail-scale",
  "detail-storage",
  "detail-context",
] as const satisfies readonly AiGeneratedAssetId[];
export const settingShotDimensions = ["location", "moment", "surface", "supportingObjects", "staging", "camera"] as const;

export type SettingShotAssetId = (typeof settingShotAssetIds)[number];
export type SettingShotDimension = (typeof settingShotDimensions)[number];
export type SettingShotSeparation = Record<SettingShotDimension, string>;

export type ProductSettingShot = {
  label: string;
  location: string;
  moment: string;
  surface: string;
  supportingObjects: string;
  staging: string;
  camera: string;
  separation: SettingShotSeparation;
  backgroundVariation?: {
    fixedCue: { key: string; description: string };
    camera: { key: string; description: string };
    moment: { key: string; description: string };
  };
};

export type SettingShotRetryAuditFeedback = {
  failedDimensions?: string[];
  hardNegativeLocationKeys?: string[];
  hardNegativeMomentKeys?: string[];
  hardNegativeSurfaceKeys?: string[];
  hardNegativeCameraKeys?: string[];
  hardNegativePaletteKeys?: string[];
  hardNegativeSpatialDepthKeys?: string[];
  hardNegativeCueKeys?: string[];
};

export type ProductSettingShotPlan = Record<SettingShotAssetId, ProductSettingShot>;

const settingShotRetryProfiles = [
  {
    key: "opposite-side-rectangular-task-light",
    location: "stay inside the assigned functional room and keep at least two room-recognition structures, but replace the base floor-plan with an L-shaped built-in or work-surface bay seen from the opposite side; anchor a full-height doorway or opening in the larger uncovered outer band beside the reserved quiet rectangle, and continue the functional built-in through the uncovered lower and opposite perimeter without drawing a dominant junction across the rectangle",
    supportingObjects: "one ordinary rectangular built-in task-light recess integrated into the functional bay in the larger uncovered outer band beside the reserved zone; it is secondary to the room's built-in, work surface, doorway, window or storage evidence",
    staging: "around but never through the reserved quiet rectangle, reverse the near/far support-or-backing relationship and place the longest negative-space run in the larger uncovered outer band opposite the base composition",
    camera: "AUTHORITATIVE replacement camera: view the room from the opposite architectural side at the role-required height and framing, rotate roughly 70 degrees from the base axis, and show wide two-point convergence using the visible outer, upper and lower architectural perimeter around the reserved quiet rectangle",
    forbiddenTopology: "the base camera axis; a dominant blank half-frame with only a narrow functional-room reveal; a one-sided daylight strip without a second fixed room cue; centred axial symmetry; any major doorway, cabinet or fixture edge cutting through the reserved quiet rectangle; or a crop, mirror, recolour or small lateral shift of any rejected plate",
  },
  {
    key: "offset-access-threshold",
    location: "stay inside the assigned functional room and keep at least two room-recognition structures, but replace the base floor-plan with an offset access aisle entirely readable in the larger uncovered side band: one fixed functional wall system, the ceiling return and the lower support-plane edge converge toward a rear threshold outside the reserved quiet rectangle, while a second room-recognition structure occupies the opposite uncovered perimeter",
    supportingObjects: "one room-appropriate fixed access threshold or cabinet toe-kick return on the rear axis of the uncovered side aisle; it must remain outside the reserved zone, belong to the functional room system and never become a display plinth",
    staging: "around the reserved quiet rectangle, use a long offset side aisle and a rear plane visible above or beside it; do not force paired structures or a central threshold through the rectangle",
    camera: "AUTHORITATIVE replacement camera: use a near-axial architectural view aligned to the uncovered side aisle at the role-required height and framing, rotated roughly 155 degrees from the base axis; the outer wall, ceiling return and lower support-plane convergence lines must meet at the offset rear threshold without any major edge crossing the reserved quiet rectangle",
    forbiddenTopology: "the base vertical three-quarter axis; a frame-centred threshold hidden behind the reserved quiet rectangle; paired left and right built-ins whose major edges cross the reserved rectangle; a dominant blank half-frame; a narrow functional-room reveal without two fixed cues; or the opposite-side L-shaped topology from retry 1",
  },
  {
    key: "third-corner-rectangular-vent",
    location: "stay inside the assigned functional room and keep at least two room-recognition structures, but replace the base floor-plan with a third-corner cross-axis layout: a broad full-height opening with an integrated transom or vent spans the larger uncovered side band while a perpendicular built-in, storage bank or work-surface return occupies an uncovered upper or lower perimeter, exposing two distinct vanishing directions around the reserved quiet rectangle",
    supportingObjects: "one fixed rectangular ventilation or transom panel integrated above the broad full-height opening in the uncovered side band; it must stay outside the reserved zone and be visibly attached to the real wall, doorway or storage system rather than floating as decoration",
    staging: "around the reserved quiet rectangle, use crossing side and rear planes with a long perimeter path from the uncovered foreground to the uncovered rear opening; neither the offset aisle nor the previous side-heavy hierarchy may remain",
    camera: "AUTHORITATIVE replacement camera: move to a third architectural corner at the role-required height and framing, rotate roughly 245 degrees from the base axis, and look across the uncovered broad opening toward the perpendicular upper-or-lower built-in return so two non-symmetric vanishing directions and long near/middle/rear separation remain visible around the reserved quiet rectangle",
    forbiddenTopology: "the base vertical three-quarter axis; a dominant blank half-frame with a narrow functional-room reveal; a one-sided daylight strip without two fixed room cues; any major opening or return edge cutting through the reserved quiet rectangle; the offset side aisle from retry 2; the opposite-side L-shaped bay from retry 1; or a crop, mirror, recolour or fixture-only edit of a rejected plate",
  },
] as const;

const retryCameraEnvelopeByAsset: Readonly<Record<SettingShotAssetId, string>> = {
  portrait: "portrait-orientation framing at the role-required height (low for this slot)",
  wide: "wide horizontal framing at the role-required height (elevated lateral for this slot)",
  "detail-overview": "overview framing at the role-required height (elevated storage-reading for this slot)",
  "detail-use": "medium functional framing at the role-required height (surface-level for this slot)",
  "detail-routine": "routine-transition framing at the role-required height (shoulder-level for this slot)",
  "detail-scale": "reference framing at the role-required height (waist-level for this slot)",
  "detail-storage": "storage-access framing at the role-required height (high access for this slot)",
  "detail-context": "wide contextual framing at the role-required height (low context for this slot)",
};

export function resolveSettingShotRetryCameraDescription(
  assetId: SettingShotAssetId,
  retry: number,
) {
  const boundedRetry = Math.max(1, Math.min(Math.trunc(retry), settingShotRetryProfiles.length));
  const profile = settingShotRetryProfiles[boundedRetry - 1];
  return `${retryCameraEnvelopeByAsset[assetId]}; ${profile.camera}. This replacement camera axis overrides and excludes the base camera description. FORBIDDEN CAMERA/TOPOLOGY: ${profile.forbiddenTopology}.`;
}

const settingShotRetryRepairDirectives: Readonly<Record<string, string>> = {
  "audit-confidence": "render every required fixed architectural cue, material boundary, light direction and depth junction with enough clarity for a high-confidence whole-frame audit; haze, ambiguous crops and implied off-frame evidence are forbidden",
  "safety-merchandise": "remove every saleable object and every product-like silhouette from the complete plate, including distant, blurred, miniature and partly hidden forms",
  "safety-package-container": "remove every bottle, can, jar, pouch, carton, packet, tube, retail box and generic container silhouette from the complete plate",
  "safety-label-text": "remove every label-like panel, logo, barcode, certification mark, QR code and readable or pseudo-readable package text",
  "safety-human": "remove every person, hand, arm, face, reflection and human-shaped shadow from the complete plate",
  "reserved-zone": "keep the exact normalized rectangle declared by the enclosing prompt at the identical left, top, width and height; never move, resize, crop or reinterpret it, and keep its full interior free of fixtures, slot-specific cues, object clusters, strong shadows, reflections and product-shaped traces. A broad low-contrast fixed backing plane or quiet architectural seam may continue through the zone only when it cannot compete with the composited product; the independent pixel-density gate still rejects busy geometry. For a surface-supported slot, align the support boundary to the declared bottom edge within the enclosing prompt's narrow tolerance band",
  "assigned-environment": "make the assigned real-life room function immediately recognizable from at least two visible fixed architectural structures named by its trusted room-recognition contract; color, material or one generic shelf cannot substitute for those structures",
  "assigned-location": "show the retry's exact assigned functional room and its required fixed recognition structures while rebuilding the surrounding floor-plan, doorway/cabinet junctions and vanishing geometry from the designated new architectural side",
  "assigned-location-key": "make the retry location contract unambiguous enough that the trusted location key, rather than unknown or a prior location family, is the only defensible audit result",
  "assigned-time-light": "show the retry's exact time-of-day through one visible source direction, matching color temperature and unmistakable cast-shadow length/direction; a generic evenly lit room fails",
  "assigned-time-light-key": "make the retry light signature unambiguous enough that the trusted moment key, rather than unknown or a prior light family, is the only defensible audit result",
  "assigned-surface": "show a broad integrated plane with the retry's exact material, readable texture and grain direction outside the quiet product zone; a recolor of the prior material or an ambiguous generic slab fails",
  "assigned-surface-key": "make the retry surface family unambiguous enough that the trusted surface key, rather than unknown or a prior material family, is the only defensible audit result",
  "assigned-camera": "prove the retry's authoritative replacement camera axis with multiple fixed architectural convergence lines, the profile's mandatory screen-space topology and a visibly changed near/middle/rear relationship; the base camera family is forbidden, and a crop, mirror or small lateral shift fails",
  "assigned-camera-key": "make the retry camera transform unambiguous enough that the trusted camera key, rather than unknown or a prior perspective family, is the only defensible audit result",
  "assigned-palette": "make the retry palette a coherent consequence of its assigned surface and light, visibly separated from every blacklisted cream/beige or prior palette family rather than applying a simple tint",
  "assigned-palette-key": "make the retry palette family unambiguous enough that the trusted palette key, rather than unknown or a prior palette family, is the only defensible audit result",
  "assigned-spatial-depth": "expose separate foreground, middle and rear fixed architectural planes with readable occlusion and convergence; a flat wall, shallow niche or isolated shelf fails",
  "assigned-spatial-depth-key": "make the retry depth structure unambiguous enough that the trusted spatial-depth key, rather than unknown or a prior depth family, is the only defensible audit result",
  "assigned-fixed-cue": "show exactly the retry's mandatory slot-specific fixed cue as real integrated architecture outside the entire reserved product rectangle and attach it to the retry profile's required doorway, built-in or room system; a renamed, reshaped, relocated or isolated version of a rejected cue fails",
  "overall-layout": "rebuild the complete architectural floor-plan, screen-space occupancy, convergence, negative-space direction, fixed-cue placement and near/middle/rear hierarchy; a dominant blank half-frame wall, narrow side reveal, changing only color, crop, one fixture or product-zone surroundings fails",
  location: "retain the exact assigned room function but use visibly different fixed-room geometry and access/cabinet/window relationships from every comparison plate",
  "time-light": "use the retry's different source side, time treatment, shadow direction and shadow length so no comparison plate shares its lighting signature",
  surface: "use the retry's different integrated material family, texture scale and grain direction so no comparison plate shares its support-plane appearance",
  palette: "separate hue family, value range and light-surface interaction from every comparison plate; a global recolor alone fails",
  "spatial-depth": "use a different foreground/middle/rear arrangement and vanishing-depth hierarchy from every comparison plate",
  camera: "use a clearly different architectural side, azimuth, perspective convergence and focal-depth relationship from every comparison plate",
  "fixed-cue": "use the retry's unique fixed architectural cue outside the reserved zone and do not reuse, rename or slightly reshape any cue from a comparison plate",
};

const retryAuditFeedbackFields = [
  "failedDimensions",
  "hardNegativeLocationKeys",
  "hardNegativeMomentKeys",
  "hardNegativeSurfaceKeys",
  "hardNegativeCameraKeys",
  "hardNegativePaletteKeys",
  "hardNegativeSpatialDepthKeys",
  "hardNegativeCueKeys",
] as const satisfies readonly (keyof SettingShotRetryAuditFeedback)[];

function sanitizedRetryAuditValues(field: keyof SettingShotRetryAuditFeedback, values: unknown) {
  if (!Array.isArray(values)) return [];
  const pattern = field === "failedDimensions"
    ? /^[a-z][a-z-]{0,31}$/
    : /^[a-z0-9][a-z0-9-]{0,63}$/;
  return [...new Set(values.filter((value): value is string => typeof value === "string" && pattern.test(value)))]
    .slice(0, 24);
}

export function mergeSettingShotRetryAuditFeedback(
  current?: SettingShotRetryAuditFeedback | null,
  incoming?: SettingShotRetryAuditFeedback | null,
) {
  const merged: SettingShotRetryAuditFeedback = {};
  for (const field of retryAuditFeedbackFields) {
    merged[field] = sanitizedRetryAuditValues(field, [
      ...(current?.[field] ?? []),
      ...(incoming?.[field] ?? []),
    ]);
  }
  return merged;
}

const retryMomentsByAsset: Record<SettingShotAssetId, readonly [string, string, string]> = {
  portrait: [
    "cool pre-sunrise light entering low from frame left with a long vertical-to-diagonal shadow",
    "bright late-morning light entering high from frame right with crisp short diagonal shadows",
    "warm post-sunset edge light entering from behind with deep foreground falloff",
  ],
  wide: [
    "hard neutral noon light running left-to-right across the full horizontal work path",
    "cool overcast early-morning light with broad shadowless lateral separation",
    "low amber late-afternoon light running right-to-left with elongated horizontal shadows",
  ],
  "detail-overview": [
    "amber sunset light entering from the rear-left and separating front, middle and rear storage planes",
    "cool blue-hour top-side light entering from the front-right with three stepped depth shadows",
    "neutral midday clerestory light entering from the rear-right with short nested overview shadows",
  ],
  "detail-use": [
    "warm late-night side light entering low from frame right with a deep functional foreground falloff",
    "bright early-afternoon cross-light entering from frame left with a sharply separated midground",
    "cool dawn backlight entering from the far-right rear with a readable low support-or-backing plane",
  ],
  "detail-routine": [
    "soft overcast morning threshold light entering from the next-action zone",
    "narrow evening side light crossing the fixed transition boundary at a steep angle",
    "high neutral midday light isolating preparation, threshold and next-action planes",
  ],
  "detail-scale": [
    "neutral raking midday light entering from front-left and revealing only the fixed reference plane",
    "cool early-evening light entering from rear-right with long scale-reference shadows",
    "warm early-morning top-left light separating support-or-backing, reference and rear planes",
  ],
  "detail-storage": [
    "cool twilight top light revealing the access opening, bay floor and rear wall",
    "warm late-morning side light entering through the access reveal with a bright front clearance",
    "neutral late-afternoon backlight separating the storage jamb, floor and rear plane",
  ],
  "detail-context": [
    "bright afternoon backlight separating foreground, midground and a distant fixed opening",
    "cool sunrise side light entering through a deep reveal and leaving the opposite foreground dark",
    "warm night architectural edge light separating all three context planes without ambient fill",
  ],
};

const retrySurfacesByAsset: Record<SettingShotAssetId, readonly [string, string, string]> = {
  portrait: ["dark cleft slate", "ivory fine-chip terrazzo", "blue-grey oxidized zinc"],
  wide: ["ribbed pale ceramic tile", "smoked structural glass", "charred end-grain timber"],
  "detail-overview": ["brushed stainless steel", "deep green soapstone", "sealed dark cork composite"],
  "detail-use": ["black saddle leather over a fixed slab", "cobalt glazed tile", "pale honed limestone"],
  "detail-routine": ["matte red architectural brick", "satin-finished brass sheet", "bright white quartz"],
  "detail-scale": ["fine grey cast concrete", "cross-cut white oak", "frosted laminated glass"],
  "detail-storage": ["powder-coated perforated steel", "honed black basalt", "sealed woven-canvas laminate"],
  "detail-context": ["dark mineral composite", "mint enamelled steel", "warm unglazed terracotta"],
};

function boundedSettingShotRetry(retry: number) {
  return Math.max(1, Math.min(Math.trunc(retry), settingShotRetryProfiles.length));
}

export function buildSettingShotRetryVariant(
  setting: ProductSettingShot,
  assetId: SettingShotAssetId,
  retry: number,
) {
  const boundedRetry = boundedSettingShotRetry(retry);
  const profile = settingShotRetryProfiles[boundedRetry - 1];
  const retryMoment = retryMomentsByAsset[assetId][boundedRetry - 1];
  const retrySurface = retrySurfacesByAsset[assetId][boundedRetry - 1];
  const key = `retry-${boundedRetry}-${assetId}`;
  const functionalRoom = setting.location.split(";")[0]?.trim() || setting.location.trim();
  return {
    label: `${setting.label} · 재생성 ${boundedRetry}`,
    location: `assigned functional room=${functionalRoom}; ${profile.location}. The base location text supplies room function only: its floor-plan, wall occupancy, opening side, negative-space axis and viewpoint are blacklisted. Never turn it into a rotunda, gallery, showroom, abstract chamber, display niche or pedestal set`,
    moment: `${retryMoment}; the previous candidate's time and light direction are fully blacklisted`,
    surface: `an integrated ${retrySurface} plane; the previous candidate's material and grain direction are fully blacklisted`,
    supportingObjects: `${profile.supportingObjects}; retain the mandatory functional room-recognition structures required by assigned functional room ${functionalRoom}, but do not reuse the base floor-plan or treat those common structures as the slot-specific unique cue; the previous candidate's unique cue arrangement is blacklisted`,
    staging: `keep ${assetId}'s exact reserved product rectangle at its original left, top, width and height, fully quiet and unobstructed; only the surrounding architecture outside that immutable rectangle changes. ${profile.staging}; preserve the source-product pixel mask and persisted rectangle only, and do not import the base staging direction, background support-or-backing geometry, depth or negative-space hierarchy`,
    camera: resolveSettingShotRetryCameraDescription(assetId, boundedRetry),
    separation: {
      location: `${key}-place`,
      moment: `${key}-light`,
      surface: `${key}-surface`,
      supportingObjects: `${key}-cue`,
      staging: `${key}-zone`,
      camera: `${key}-camera`,
    },
  } satisfies ProductSettingShot;
}

export function buildSettingShotRetryGuidance(
  assetId: SettingShotAssetId,
  conflictingAssetIds: string[],
  retry: number,
  settingVariant: ProductSettingShot,
  auditFeedback?: SettingShotRetryAuditFeedback | null,
) {
  const boundedRetry = boundedSettingShotRetry(retry);
  const profile = settingShotRetryProfiles[boundedRetry - 1];
  const conflicts = [...new Set(conflictingAssetIds)]
    .filter((value) => /^[a-z0-9][a-z0-9:-]{0,63}$/.test(value))
    .slice(0, settingShotAssetIds.length);
  const blacklist = conflicts.length ? conflicts.join(", ") : "every earlier setting-shot plate supplied to the audit";
  const sanitizedAuditFeedback = mergeSettingShotRetryAuditFeedback(null, auditFeedback);
  const failedDimensions = sanitizedAuditFeedback.failedDimensions ?? [];
  const hardNegativeSignatures = [
    ["location", sanitizedAuditFeedback.hardNegativeLocationKeys],
    ["time-light", sanitizedAuditFeedback.hardNegativeMomentKeys],
    ["surface", sanitizedAuditFeedback.hardNegativeSurfaceKeys],
    ["camera", sanitizedAuditFeedback.hardNegativeCameraKeys],
    ["palette", sanitizedAuditFeedback.hardNegativePaletteKeys],
    ["spatial-depth", sanitizedAuditFeedback.hardNegativeSpatialDepthKeys],
    ["fixed-cue/supporting-object", sanitizedAuditFeedback.hardNegativeCueKeys],
  ]
    .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0)
    .map(([dimension, values]) => `${dimension}=${values.join("|")}`);
  const auditDirectedRepairs = [...new Set(failedDimensions
    .map((dimension) => settingShotRetryRepairDirectives[dimension])
    .filter((directive): directive is string => Boolean(directive)))];
  return [
    `Deterministic setting-shot retry ${boundedRetry} of ${settingShotRetryProfiles.length} for ${assetId}.`,
    `HARD ROLE BLACKLIST: ${blacklist}. Do not reuse any blacklisted role's room geometry, light direction, surface family, fixed cue, background support-or-backing geometry around the immutable product zone, staging relationship, negative-space direction, depth hierarchy, camera azimuth or focal perspective.`,
    `Retry transform ${profile.key} replaces all six scene dimensions together while retaining the product-category function and hard shot class: location=${settingVariant.location}; time/light=${settingVariant.moment}; surface=${settingVariant.surface}; fixed cue=${settingVariant.supportingObjects}; product placement=${settingVariant.staging}; camera=${settingVariant.camera}.`,
    `MANDATORY SCREEN-SPACE TOPOLOGY: ${profile.location}. FORBIDDEN CAMERA/TOPOLOGY: ${profile.forbiddenTopology}. If the forbidden topology is visible anywhere in the candidate, reject the composition and render a new plate instead of repairing it.`,
    failedDimensions.length
      ? `Validated prior audit failure dimensions: ${failedDimensions.join(", ")}. Make each named visual dimension unmistakably different from every blacklisted role while still satisfying this retry's trusted assignment.`
      : "The prior candidate did not provide safe high-confidence dimension feedback; replace every scene dimension according to this deterministic retry contract.",
    auditDirectedRepairs.length
      ? `AUDIT-DIRECTED REPAIR GATE: ${auditDirectedRepairs.map((directive, index) => `${index + 1}) ${directive}`).join("; ")}.`
      : "AUDIT-DIRECTED REPAIR GATE: no narrow repair is trusted, so regenerate the complete plate from the deterministic six-axis replacement contract.",
    hardNegativeSignatures.length
      ? `STRUCTURED FAILED-PLATE BLACKLIST (schema-validated semantic keys only): ${hardNegativeSignatures.join("; ")}. These identify forbidden visual families from all earlier rejected candidates, not words to render in the image.`
      : "No validated failed-plate semantic keys are available; rely on the complete deterministic replacement contract.",
    "IMMUTABLE RESERVED-ZONE GATE: the exact normalized rectangle declared by the enclosing prompt never moves, resizes or changes aspect ratio on a retry. Keep its complete interior visually quiet and unobstructed; place the retry-specific fixed cue, fixtures and all busy or high-contrast room-recognition junctions outside it. A broad low-contrast fixed backing plane or quiet architectural seam may continue through the zone only when it remains subordinate to the later source-pixel product composite and passes the independent pixel-density gate. For a surface-supported slot, align a continuous quiet support plane with the declared bottom contact tolerance band; for a suspended-or-planar slot, keep one coherent backing plane and do not invent a contact surface.",
    "FULL SIX-AXIS REPLACEMENT GATE: even when only one audit dimension failed, this candidate must visibly satisfy the newly assigned room geometry, time/light, integrated surface, camera/convergence, fixed architectural cue and surrounding layout/depth, and each must remain clearly distinct from every supplied rejected or cross-slot plate. Repairing one axis while repeating another is a failure.",
    "FORBIDDEN STRUCTURAL EQUIVALENCE: never rename or slightly reshape the specifically rejected slot-specific cue. Ordinary cabinet fronts, worktop-to-backsplash junctions, doorway or window frames needed to prove the assigned real room may remain, but they cannot substitute for the new unique cue and the overall layout, light, surface, depth and camera must still change materially.",
    "The retry assignment preserves the original real-life room function and its required recognition evidence while replacing the rejected composition; it never changes the hard shot class or product facts. Rotunda, gallery, showroom, abstract chamber, display niche and pedestal-set interpretations are forbidden.",
    "Generate only the empty architectural plate. The verified product is composited afterward from unchanged source pixels; never invent, redraw or anticipate package text, logos, labels, quantities or product parts.",
  ].join("\n");
}

type BaseSettingShotAssetId = "portrait" | "wide" | "detail-overview" | "detail-use";
type SupplementalSettingShotAssetId = Exclude<SettingShotAssetId, BaseSettingShotAssetId>;
type BaseProductSettingShotPlan = Record<BaseSettingShotAssetId, ProductSettingShot>;

type SceneDescriptions = [location: string, moment: string, surface: string, supportingObjects: string, staging: string];
type SceneSeparation = [location: string, moment: string, surface: string, supportingObjects: string, staging: string];
type CameraContract = [key: string, description: string];
type SceneParts = { descriptions: SceneDescriptions; separation: SceneSeparation; camera: CameraContract };

const cameras = {
  portrait: ["low-right-vertical-35mm", "상품보다 약간 낮은 오른쪽 35mm 세로 3/4 시점으로 공간의 앞뒤 층을 함께 보여준다"],
  wide: ["high-left-lateral-28mm", "왼쪽 위에서 내려보는 28mm 가로 시점으로 상품과 활동 영역 사이의 긴 동선을 만든다"],
  overview: ["high-rear-overview-50mm", "상품 뒤쪽 위 50mm 사선 시점으로 전체 형태와 보관·준비 공간의 관계를 읽게 한다"],
  use: ["table-level-opposite-65mm", "표면 높이의 반대편 65mm 시점으로 기능 결과를 전경에 두고 상품을 다른 깊이에 분리한다"],
  routine: ["shoulder-height-rear-45mm", "상품 뒤쪽 어깨 높이의 45mm 시점으로 다음 행동 영역과 상품을 앞뒤로 분리한다"],
  scale: ["waist-height-front-left-55mm", "허리 높이의 왼쪽 앞 55mm 시점으로 같은 초점면의 상대적 공간 점유를 왜곡 없이 보여준다"],
  storage: ["high-corner-right-40mm", "오른쪽 위 모서리의 40mm 시점으로 수납 깊이와 꺼내는 여백을 함께 보여준다"],
  context: ["low-wide-rear-24mm", "낮은 뒤쪽 24mm 가로 시점으로 전경·중경·후경을 겹치지 않게 나누고 상품을 한쪽에 고정한다"],
} as const satisfies Record<"portrait" | "wide" | "overview" | "use" | "routine" | "scale" | "storage" | "context", CameraContract>;

type SemanticVariant = { key: string; description: string };

const spatialOrientationVariants = [
  { key: "rear-left-to-front-right", location: "후면 왼쪽에서 전면 오른쪽으로 흐르는 비대칭 축", moment: "후면 왼쪽에서 전면 오른쪽으로 긴 사선 그림자를 만든다", surface: "결과 줄눈이 후면 왼쪽에서 전면 오른쪽으로 이어진다", cue: "상품 합성 구역 밖의 후면 왼쪽 상단", camera: "기준축에서 왼쪽으로 12도 이동해 오른쪽 후경의 소실점을 더 길게 연다" },
  { key: "rear-right-to-front-left", location: "후면 오른쪽에서 전면 왼쪽으로 흐르는 역대각 축", moment: "후면 오른쪽에서 전면 왼쪽으로 낮은 역대각 그림자를 만든다", surface: "결과 줄눈이 후면 오른쪽에서 전면 왼쪽으로 이어진다", cue: "상품 합성 구역 밖의 후면 오른쪽 상단", camera: "기준축에서 오른쪽으로 14도 이동해 왼쪽 후경의 소실점을 더 길게 연다" },
  { key: "high-left-horizontal", location: "왼쪽 높은 곳에서 오른쪽으로 길게 이어지는 수평 축", moment: "왼쪽 높은 광원에서 짧고 선명한 수평 그림자를 만든다", surface: "긴 결 방향을 왼쪽에서 오른쪽으로 수평 정렬한다", cue: "상품 합성 구역보다 높은 왼쪽 천장 가장자리", camera: "같은 높이 역할을 지키며 왼쪽으로 평행 이동해 수평 소실선을 강조한다" },
  { key: "high-right-horizontal", location: "오른쪽 높은 곳에서 왼쪽으로 길게 이어지는 수평 축", moment: "오른쪽 높은 광원에서 반대 방향의 짧은 수평 그림자를 만든다", surface: "긴 결 방향을 오른쪽에서 왼쪽으로 수평 정렬한다", cue: "상품 합성 구역보다 높은 오른쪽 천장 가장자리", camera: "같은 높이 역할을 지키며 오른쪽으로 평행 이동해 반대 수평 소실선을 강조한다" },
  { key: "off-center-aisle", location: "고정 선반·수납장·작업면 사이의 실제 통로가 한쪽 소실점으로 수렴하는 비대칭 구성", moment: "통로 한쪽의 평범한 창이나 작업등에서 반대쪽 고정면으로 명암이 이어진다", surface: "선반·조리대의 직선 결이 한쪽 후면 소실점으로 이어진다", cue: "상품 합성 구역 밖의 통로 끝 고정 수납장 또는 출입문틀", camera: "역할 고유 높이에서 통로 중심을 9도 벗어나 실제 선반·작업면 수렴을 비대칭으로 보여준다" },
  { key: "low-left-sweep", location: "왼쪽 낮은 바닥선에서 오른쪽 후면으로 올라가는 완만한 축", moment: "왼쪽 낮은 광원이 오른쪽 후면으로 길게 올라가는 그림자를 만든다", surface: "왼쪽 낮은 모서리에서 오른쪽 후면으로 결을 올린다", cue: "상품 합성 구역 밖의 왼쪽 낮은 건축 경계", camera: "기준축보다 왼쪽 아래로 이동하되 역할 고유의 카메라 높이 범위를 유지한다" },
  { key: "low-right-sweep", location: "오른쪽 낮은 바닥선에서 왼쪽 후면으로 올라가는 완만한 축", moment: "오른쪽 낮은 광원이 왼쪽 후면으로 길게 올라가는 그림자를 만든다", surface: "오른쪽 낮은 모서리에서 왼쪽 후면으로 결을 올린다", cue: "상품 합성 구역 밖의 오른쪽 낮은 건축 경계", camera: "기준축보다 오른쪽 아래로 이동하되 역할 고유의 카메라 높이 범위를 유지한다" },
  { key: "front-left-deep-rear", location: "왼쪽 전경을 열고 오른쪽 깊은 후면으로 수렴하는 구성", moment: "왼쪽 전면의 넓은 빛이 오른쪽 후면으로 점차 어두워진다", surface: "왼쪽 전경의 넓은 판에서 오른쪽 후면으로 결 간격을 좁힌다", cue: "상품 합성 구역 밖의 오른쪽 깊은 후면", camera: "왼쪽 전면으로 평행 이동해 오른쪽 깊은 후면의 원근 수렴을 강조한다" },
  { key: "front-right-deep-rear", location: "오른쪽 전경을 열고 왼쪽 깊은 후면으로 수렴하는 구성", moment: "오른쪽 전면의 넓은 빛이 왼쪽 후면으로 점차 어두워진다", surface: "오른쪽 전경의 넓은 판에서 왼쪽 후면으로 결 간격을 좁힌다", cue: "상품 합성 구역 밖의 왼쪽 깊은 후면", camera: "오른쪽 전면으로 평행 이동해 왼쪽 깊은 후면의 원근 수렴을 강조한다" },
  { key: "sloped-ceiling-cabinet-axis", location: "평범한 완경사 천장 아래 고정 수납장·작업면 접합이 공간 기능을 지배하는 구성", moment: "일반 창이나 작업등의 사선광이 수납장 전면과 작업면에 서로 다른 길이의 그림자를 만든다", surface: "주 지지면의 직선 결을 수납장 끝단에서 반대편 낮은 모서리로 이어 준다", cue: "상품 합성 구역 밖의 고정 수납장 끝단과 작업면 접합", camera: "기준축을 18도 이동해 완경사 천장보다 수납장·작업면 접합과 후면 수렴선을 먼저 보여준다" },
  { key: "low-horizontal-depth", location: "낮은 수평선이 먼 후경까지 끊김 없이 이어지는 구성", moment: "낮은 측면광이 긴 수평 그림자 띠를 후경까지 이어 만든다", surface: "낮고 긴 수평 결을 전경과 후경에 연속시킨다", cue: "상품 합성 구역 밖의 먼 후경 하단", camera: "역할 고유 높이에서 측면으로 20도 이동해 낮은 수평 깊이층을 길게 보여준다" },
] as const;

const locationArchitectureVariants: readonly SemanticVariant[] = [
  { key: "offset-window-reveal", description: "평범한 평천장 아래 중심에서 벗어난 창문턱과 직선 후벽 접합이 보이는" },
  { key: "service-soffit-doorway", description: "기존 수납·작업 구역 위 얕은 서비스 소핏과 옆쪽 출입문틀이 함께 보이는" },
  { key: "half-height-built-in-return", description: "반높이 고정 수납 벽의 끝단과 평범한 직선 천장 경계가 분리되는" },
  { key: "rectangular-skylight-return", description: "작은 직사각형 천창 또는 고창의 깊은 턱과 일반 벽 모서리가 보이는" },
  { key: "continuous-cabinet-soffit", description: "고정 수납장 위 연속된 얕은 소핏과 깊은 직선 후벽이 이어지는" },
  { key: "ordinary-sloped-ceiling", description: "실제 주거·업무 공간의 완만한 경사지붕과 낮은 반대편 직선 벽이 만나는" },
  { key: "rounded-corner-straight-wall", description: "한쪽 벽 모서리만 완만하게 라운드 처리되고 나머지는 직선 벽·바닥인" },
  { key: "corner-window-orthogonal-walls", description: "코너 창문턱과 서로 직각인 두 고정 벽면이 명확히 보이는" },
  { key: "stepped-beam-recessed-door", description: "높이가 다른 두 평범한 천장 보와 안쪽으로 들어간 출입문이 보이는" },
  { key: "under-cabinet-light-junction", description: "작업면과 평행한 하부 조명선, 수납장 끝단, 후벽 접합이 함께 보이는" },
  { key: "walk-in-access-aisle", description: "출입문틀과 양쪽 고정 수납·작업면 사이의 좁은 실제 접근 통로가 보이는" },
];

const momentLightVariants: readonly SemanticVariant[] = [
  { key: "clear-crisp-light", description: "맑고 선명한 단일 자연광" },
  { key: "thin-overcast-light", description: "얇은 구름을 통과한 넓고 부드러운 자연광" },
  { key: "post-rain-reflection", description: "비가 갠 뒤 차갑게 반사되는 깨끗한 자연광" },
  { key: "warm-dry-edge", description: "건조하고 따뜻한 공기에서 경계가 또렷한 측면광" },
  { key: "cool-high-contrast", description: "차갑고 대비가 큰 방향성 자연광" },
  { key: "hazy-soft-beam", description: "옅은 안개를 통과해 가장자리가 부드러운 빛줄기" },
  { key: "narrow-slot-light", description: "좁은 건축 개구부를 통과한 집중광" },
  { key: "broad-bounced-light", description: "큰 고정 벽면에 한 번 반사된 넓은 간접광" },
  { key: "neutral-cross-light", description: "중립색의 강한 교차광" },
  { key: "low-grazing-light", description: "표면을 스치며 질감을 드러내는 낮은 광선" },
  { key: "high-diffuse-light", description: "천장 쪽에서 넓게 퍼지는 높은 확산광" },
];

const surfaceMaterialVariants: readonly SemanticVariant[] = [
  { key: "honed-travertine", description: "옅은 회백색 연마 트래버틴" },
  { key: "dark-soapstone", description: "짙은 녹회색 무광 소프스톤" },
  { key: "brushed-stainless", description: "가는 결의 브러시드 스테인리스" },
  { key: "sealed-white-oak", description: "방수 마감한 밝은 화이트 오크" },
  { key: "fine-chip-terrazzo", description: "잔골재가 드문 아이보리 테라조" },
  { key: "blue-grey-linoleum", description: "청회색 천연 리놀륨" },
  { key: "satin-quartz", description: "새틴 광택의 옅은 쿼츠 복합재" },
  { key: "sage-ceramic", description: "세이지색 저광택 세라믹 판" },
  { key: "honed-basalt", description: "균일하게 연마한 짙은 현무암" },
  { key: "amber-mineral-resin", description: "호박색 미세 골재가 든 무광 미네랄 레진" },
  { key: "powder-coated-steel", description: "미세 질감의 중립색 분체도장 강판" },
];

const fixedArchitecturalCueVariants: readonly SemanticVariant[] = [
  { key: "rectangular-task-light-recess", description: "고정 수납·작업 구역 위 직사각형 매입 작업등 턱" },
  { key: "continuous-clerestory-slot", description: "실제 벽 상부의 끊김 없는 수평 고창 슬롯" },
  { key: "cabinet-toe-kick-return", description: "하부 수납장과 바닥 사이의 연속된 토킥 리세스 끝단" },
  { key: "doorway-threshold-return", description: "출입문틀과 바닥이 만나는 고정 문턱 끝단" },
  { key: "fixed-ventilation-grille", description: "벽이나 고정 수납장에 매입된 직사각형 환기 그릴" },
  { key: "flush-utility-access-panel", description: "벽과 같은 면에 설치된 작은 직사각형 점검 패널" },
  { key: "ceiling-beam-junction", description: "평천장과 얕은 고정 보가 만나는 직선 접합부" },
  { key: "under-cabinet-task-light", description: "작업면과 평행한 고정 하부장 작업 조명선" },
  { key: "rectangular-high-transom", description: "출입문 위에 통합된 직사각형 고정 트랜섬" },
  { key: "cabinet-side-panel-return", description: "고정 수납장 측판과 후벽이 만나는 분명한 직선 끝단" },
  { key: "cabinet-service-soffit", description: "고정 수납장 위에 붙은 넓고 얕은 서비스 소핏" },
];

const cameraMovementVariants: readonly SemanticVariant[] = [
  { key: "short-lateral-shift", description: "기준 시점에서 짧게 평행 이동해 전경과 후경의 겹침을 끊는다" },
  { key: "long-lateral-shift", description: "기준 시점에서 크게 평행 이동해 반대편 소실선을 길게 드러낸다" },
  { key: "near-axial-offset", description: "완전 정면은 피하면서 축에 가까운 시점으로 면의 폭 차이를 강조한다" },
  { key: "deep-oblique-offset", description: "역할 범위 안의 더 깊은 사선 시점으로 세 깊이층을 분리한다" },
  { key: "wide-convergence", description: "역할 고유 화각 범위의 넓은 쪽을 사용해 건축 수렴선을 벌린다" },
  { key: "compressed-convergence", description: "역할 고유 화각 범위의 긴 쪽을 사용해 중경을 압축한다" },
  { key: "raised-axis", description: "역할 고유 높이 범위의 상단에서 바닥·벽·후면 접합을 함께 드러낸다" },
  { key: "lowered-axis", description: "역할 고유 높이 범위의 하단에서 지지면과 후면 외피를 분리한다" },
  { key: "foreground-led", description: "전경 고정면을 넓게 두고 후면 수렴을 한쪽으로 밀어낸다" },
  { key: "rear-plane-led", description: "후면 고정면을 넓게 두고 전경 경계를 짧게 끊는다" },
  { key: "corner-to-axis", description: "한 모서리에서 중심축 쪽으로 접근해 서로 다른 두 소실선을 보인다" },
];

const stagingDepthVariants: readonly SemanticVariant[] = [
  { key: "open-opposite-foreground", description: "합성 구역 반대편 전경을 넓게 비우고 후면 지지면을 짧게 끊는다" },
  { key: "deep-rear-clearance", description: "합성 구역 뒤에 긴 후면 여백을 남기고 전경 경계를 가깝게 둔다" },
  { key: "diagonal-negative-space", description: "합성 구역에서 반대 모서리까지 비어 있는 사선 네거티브 공간을 만든다" },
  { key: "horizontal-negative-space", description: "합성 구역의 반대쪽에 긴 수평 네거티브 공간을 만든다" },
  { key: "layered-near-mid-far", description: "합성 구역 바깥에서 근경·중경·후경 고정면을 세 단계로 분리한다" },
  { key: "shallow-front-deep-back", description: "짧은 전면 지지 구간과 깊은 후면 외피를 대비시킨다" },
  { key: "deep-front-shallow-back", description: "넓은 전면 지지 구간과 짧은 후면 경계를 대비시킨다" },
  { key: "asymmetric-side-clearance", description: "합성 구역 한쪽의 접근 여백을 다른 쪽보다 두 배 이상 넓게 둔다" },
  { key: "offset-rear-plane", description: "합성 구역 뒤 고정면의 중심축을 옆으로 이동해 정대칭을 피한다" },
  { key: "split-depth-corridor", description: "합성 구역 바깥에 서로 겹치지 않는 두 개의 깊이 통로를 만든다" },
  { key: "low-horizon-clearance", description: "낮은 건축 수평선을 유지하고 합성 구역 위쪽 여백을 크게 연다" },
];

function pairedVariant(
  sceneIdentityText: string,
  assetId: SettingShotAssetId,
  dimension: "location" | "moment" | "surface" | "cue" | "camera",
  primary: readonly SemanticVariant[],
) {
  const modulus = primary.length * spatialOrientationVariants.length;
  const code = resolveProductSceneVariantCode(sceneIdentityText, assetId, dimension, modulus);
  return {
    primary: primary[code % primary.length],
    orientation: spatialOrientationVariants[Math.floor(code / primary.length)],
    measurement: resolveVisualMeasurement(
      dimension,
      resolveProductSceneVariantCode(sceneIdentityText, assetId, dimension, 997),
    ),
  };
}

function resolveVisualMeasurement(
  dimension: "location" | "moment" | "surface" | "cue" | "camera",
  code: number,
): SemanticVariant {
  if (dimension === "location") {
    const horizontal = 20 + (code % 61);
    const depth = 30 + Math.floor(code / 61);
    return {
      key: `rear-focus-x-${horizontal}-depth-${depth}`,
      description: `후면 소실점은 프레임 가로 ${horizontal}% 지점, 주 깊이 경계는 세로 ${depth}% 지점에 고정한다`,
    };
  }
  if (dimension === "moment") {
    const incidence = 12 + (code % 77);
    const shadowEdge = 2 + Math.floor(code / 77);
    return {
      key: `light-angle-${incidence}-edge-${shadowEdge}`,
      description: `고정 건축면 기준 주광 입사각은 ${incidence}도이며 그림자 경계 폭은 프레임의 ${shadowEdge}%로 보이게 한다`,
    };
  }
  if (dimension === "surface") {
    const grainAngle = code % 181;
    const jointRhythm = 4 + Math.floor(code / 181);
    return {
      key: `grain-angle-${grainAngle}-joint-${jointRhythm}`,
      description: `표면 결은 가로축 기준 ${grainAngle}도이고 고정 이음 간격은 상품 폭의 약 ${jointRhythm}배로 유지한다`,
    };
  }
  if (dimension === "cue") {
    const horizontal = 10 + (code % 81);
    const vertical = 10 + Math.floor(code / 81);
    return {
      key: `cue-x-${horizontal}-y-${vertical}`,
      description: `고정 단서 중심은 프레임 가로 ${horizontal}%, 세로 ${vertical}% 지점에 두되 합성 구역과 겹치지 않는다`,
    };
  }
  const azimuth = 5 + (code % 71);
  const depthCompression = 85 + Math.floor(code / 71);
  return {
    key: `azimuth-${azimuth}-depth-${depthCompression}`,
    description: `역할 기준축에서 ${azimuth}도 이동하고 기준 원근 깊이의 ${depthCompression}% 압축감을 사용한다`,
  };
}

function scene(separation: SceneSeparation, descriptions: SceneDescriptions, camera: CameraContract): SceneParts {
  return { separation, descriptions, camera };
}

function shot(label: string, parts: SceneParts): ProductSettingShot {
  const [location, moment, surface, supportingObjects, staging] = parts.descriptions;
  const [locationKey, momentKey, surfaceKey, supportingObjectsKey, stagingKey] = parts.separation;
  return {
    label,
    location,
    moment,
    surface,
    supportingObjects,
    staging,
    camera: parts.camera[1],
    separation: {
      location: locationKey,
      moment: momentKey,
      surface: surfaceKey,
      supportingObjects: supportingObjectsKey,
      staging: stagingKey,
      camera: parts.camera[0],
    },
  };
}

export function assertDistinctSettingShotPlan(plan: ProductSettingShotPlan, planLabel = "product") {
  const shots = Object.values(plan);
  for (const dimension of settingShotDimensions) {
    const values = shots.map((item) => item.separation[dimension].trim());
    if (values.some((value) => !value) || new Set(values).size !== settingShotAssetIds.length) {
      throw new Error(`${planLabel} 설정샷의 ${dimension} 의미 분리 계약이 중복되었습니다.`);
    }
    const descriptions = shots.map((item) => item[dimension].trim());
    if (descriptions.some((value) => !value) || new Set(descriptions).size !== settingShotAssetIds.length) {
      throw new Error(`${planLabel} 설정샷의 ${dimension} 촬영 지시가 중복되었습니다.`);
    }
  }
  return plan;
}

function plan(parts: Record<BaseSettingShotAssetId, SceneParts>): BaseProductSettingShotPlan {
  return {
    portrait: shot("설정샷 1", parts.portrait),
    wide: shot("설정샷 2", parts.wide),
    "detail-overview": shot("설정샷 3", parts["detail-overview"]),
    "detail-use": shot("설정샷 4", parts["detail-use"]),
  };
}

function supplementalScene(
  planLabel: string,
  assetId: SupplementalSettingShotAssetId,
  descriptions: SceneDescriptions,
  camera: CameraContract,
) {
  const key = `${planLabel}-${assetId}`;
  return scene(
    [`${key}-place`, `${key}-moment`, `${key}-surface`, `${key}-objects`, `${key}-staging`],
    descriptions,
    camera,
  );
}

function completePlan(
  planLabel: string,
  base: BaseProductSettingShotPlan,
  supplemental: Record<SupplementalSettingShotAssetId, SceneParts>,
): ProductSettingShotPlan {
  return assertDistinctSettingShotPlan({
    ...base,
    "detail-routine": shot("설정샷 5", supplemental["detail-routine"]),
    "detail-scale": shot("설정샷 6", supplemental["detail-scale"]),
    "detail-storage": shot("설정샷 7", supplemental["detail-storage"]),
    "detail-context": shot("설정샷 8", supplemental["detail-context"]),
  }, planLabel);
}

function applyProductSpecificSceneVariation(
  planLabel: string,
  sourcePlan: ProductSettingShotPlan,
  sceneIdentityText: string,
): ProductSettingShotPlan {
  const varied = Object.fromEntries(settingShotAssetIds.map((assetId) => {
    const source = sourcePlan[assetId];
    const location = pairedVariant(sceneIdentityText, assetId, "location", locationArchitectureVariants);
    const moment = pairedVariant(sceneIdentityText, assetId, "moment", momentLightVariants);
    const surface = pairedVariant(sceneIdentityText, assetId, "surface", surfaceMaterialVariants);
    const cue = pairedVariant(sceneIdentityText, assetId, "cue", fixedArchitecturalCueVariants);
    const camera = pairedVariant(sceneIdentityText, assetId, "camera", cameraMovementVariants);
    const stagingCode = resolveProductSceneVariantCode(
      sceneIdentityText,
      assetId,
      "staging",
      stagingDepthVariants.length * spatialOrientationVariants.length,
    );
    const stagingDepth = stagingDepthVariants[stagingCode % stagingDepthVariants.length];
    const stagingOrientation = spatialOrientationVariants[Math.floor(stagingCode / stagingDepthVariants.length)];
    const placement = resolveProductPlacementVariant(sceneIdentityText, assetId);
    return [assetId, {
      ...source,
      location: `${source.location}; 이 기본 생활공간의 실제 기능과 필수 고정 단서를 먼저 유지한다. 그 공간 내부에 종속된 구조 변형으로 ${location.primary.description} 구성을 사용하고 공간의 주 방향은 ${location.orientation.location}으로 고정한다; ${location.measurement.description}. 로툰다·갤러리·쇼룸·추상 챔버·전시 니치·페데스털 세트로 바꾸지 않는다`,
      moment: `${source.moment}; ${moment.primary.description}이 ${moment.orientation.moment}; ${moment.measurement.description}`,
      surface: `상품과 맞닿는 주 지지면은 ${source.surface}로 유지한다; 합성 구역 밖의 보조 고정면만 ${surface.primary.description}이며 ${surface.orientation.surface}; ${surface.measurement.description}`,
      supportingObjects: `${source.supportingObjects}; 지정 생활공간을 증명하는 필수 수납장·작업면·출입문·창문 단서는 유지하되 고유한 보조 고정 단서로 ${cue.primary.description}을 ${cue.orientation.cue}에 둔다; ${cue.measurement.description}. 보조 단서가 생활공간을 전시장처럼 지배하지 않게 한다`,
      staging: `${source.staging}; 실제 정규화 합성 구역은 ${placement.description}; ${stagingDepth.description}; 깊이 방향은 ${stagingOrientation.location}을 따른다`,
      camera: `${source.camera}; 같은 하드 역할 카메라군 안에서 ${camera.primary.description}; ${camera.orientation.camera}; ${camera.measurement.description}`,
      separation: {
        location: `${location.primary.key}-${location.orientation.key}-${location.measurement.key}-${source.separation.location}`,
        moment: `${moment.primary.key}-${moment.orientation.key}-${moment.measurement.key}-${source.separation.moment}`,
        surface: `${surface.primary.key}-${surface.orientation.key}-${surface.measurement.key}-${source.separation.surface}`,
        supportingObjects: `${cue.primary.key}-${cue.orientation.key}-${cue.measurement.key}-${source.separation.supportingObjects}`,
        staging: `${placement.key}-${stagingDepth.key}-${stagingOrientation.key}-${source.separation.staging}`,
        camera: `${camera.primary.key}-${camera.orientation.key}-${camera.measurement.key}-${source.separation.camera}`,
      },
      backgroundVariation: {
        fixedCue: {
          key: `${cue.primary.key}-${cue.orientation.key}-${cue.measurement.key}`,
          description: `${cue.primary.description} fixed ${cue.orientation.cue}; ${cue.measurement.description}; fully outside the reserved product-composite zone`,
        },
        camera: {
          key: `${camera.primary.key}-${camera.orientation.key}-${camera.measurement.key}`,
          description: `${camera.primary.description}; ${camera.orientation.camera}; ${camera.measurement.description}; preserve the slot's hard camera height and framing family`,
        },
        moment: {
          key: `${moment.primary.key}-${moment.orientation.key}-${moment.measurement.key}`,
          description: `${moment.primary.description}; ${moment.orientation.moment}; ${moment.measurement.description}`,
        },
      },
    } satisfies ProductSettingShot] as const;
  })) as ProductSettingShotPlan;
  return assertDistinctSettingShotPlan(varied, `${planLabel}-product-specific`);
}

function cerealPlan() {
  return plan({
    portrait: scene(
      ["breakfast-nook", "dawn-breakfast", "light-oak", "cereal-bowl-linen", "package-right-bowl-low-left"],
      ["주방과 분리된 창가의 작은 원목 아침 식탁", "등교·출근 전 첫 식사를 막 차리는 이른 아침", "결이 선명한 밝은 참나무 식탁", "실제 섭취를 설명하는 투명 시리얼 볼과 접힌 흰 리넨만 사용", "패키지는 오른쪽 뒤에 세우고 볼은 왼쪽 낮은 전경에 두어 비대칭 세로 깊이를 만든다"],
      cameras.portrait,
    ),
    wide: scene(
      ["modern-kitchen-island", "late-morning-portioning", "brushed-stainless", "portion-cup-serving-tray", "package-left-prep-right"],
      ["정돈된 현대식 주방의 넓은 독립 조리대", "늦은 오전에 1회분을 덜어 이동 간식을 준비하는 순간", "빛을 차갑게 반사하는 브러시드 스테인리스 상판", "빈 1회분 컵과 낮은 서빙 트레이만 사용하며 아침 식탁 소품은 반복하지 않는다", "패키지는 왼쪽 가장자리, 준비 영역은 오른쪽에 길게 두어 가로 동선을 만든다"],
      cameras.wide,
    ),
    "detail-overview": scene(
      ["walk-in-pantry", "midday-restock", "matte-cream-shelf", "single-storage-basket", "package-rear-center-shelf-edge"],
      ["문이 열린 독립 팬트리의 상온 식품 선반", "낮에 장을 본 뒤 보관 위치를 정리하는 순간", "빛 반사가 없는 크림색 도장 선반", "다른 브랜드나 추가 제품 없이 낮은 수납 바구니 하나만 배경에 둔다", "패키지를 선반 뒤 중앙에 두고 앞 가장자리를 비워 실제 크기와 수납 깊이를 보여준다"],
      cameras.overview,
    ),
    "detail-use": scene(
      ["living-room-sofa-side", "evening-snack", "dark-walnut-table", "snack-cup-closed-book", "snack-front-package-back-left"],
      ["창문·주방·다이닝 가구가 보이지 않는 거실 소파 옆", "따뜻한 스탠드 조명 아래 저녁 간식을 먹기 직전", "낮고 짙은 월넛 사이드 테이블", "완성된 시리얼 스낵컵과 닫힌 무지 책 한 권만 사용하며 앞 장면의 볼·리넨·트레이는 쓰지 않는다", "스낵컵을 중앙 전경의 주인공으로, 패키지를 왼쪽 후경에 낮춰 아침 장면과 반대 배치로 만든다"],
      cameras.use,
    ),
  });
}

function coffeeTeaPlan() {
  return plan({
    portrait: scene(["bedroom-balcony-ledge", "sunrise-first-cup", "warm-terracotta", "cup-single-brewer", "package-upper-right-cup-lower-left"], ["침실과 연결된 작은 발코니의 음료 선반", "해가 막 오른 뒤 첫 잔을 준비하는 아침", "따뜻한 무광 테라코타 선반", "깨끗한 컵과 상품에 맞는 추출 도구 하나만 사용", "제품은 오른쪽 위, 컵은 왼쪽 아래에 두어 세로 대각선을 만든다"], cameras.portrait),
    wide: scene(["office-breakroom", "midmorning-refill", "brushed-steel-counter", "travel-tumbler-filter", "package-far-left-tools-right"], ["업무 공간과 분리된 오피스 브레이크룸", "오전 업무 중 텀블러를 채우기 직전", "긴 브러시드 스틸 음료 조리대", "텀블러와 확인된 필터·티 인퓨저 중 맞는 도구만 사용", "제품은 먼 왼쪽, 준비 도구는 오른쪽에 두어 긴 가로 이동을 만든다"], cameras.wide),
    "detail-overview": scene(["dry-goods-cabinet", "afternoon-restock", "powder-coated-wire-shelf", "single-airtight-jar", "package-back-right-door-frame"], ["주방 밖 건식 식품 수납장의 안쪽 선반", "오후에 보관 상태와 잔량을 확인하는 순간", "흰색 분체도장 철망 선반", "다른 브랜드 없이 비어 있는 밀폐 용기 하나만 배경에 둔다", "패키지를 뒤 오른쪽에 두고 열린 문틀과 선반 깊이가 함께 보이게 한다"], cameras.overview),
    "detail-use": scene(["living-room-reading-corner", "late-evening-drink", "black-leather-top", "finished-drink-reading-glasses", "drink-front-product-rear-right"], ["거실의 독립된 독서 코너", "늦은 저녁 완성 음료를 마시기 직전", "검은 가죽 상판의 작은 독서 테이블", "완성 음료 한 잔과 접힌 독서 안경만 사용", "음료를 왼쪽 전경, 제품을 오른쪽 후경에 두어 다른 세 장면과 반대 깊이를 만든다"], cameras.use),
  });
}

function generalFoodPlan() {
  return plan({
    portrait: scene(["grocery-unpacking-island", "morning-unpack", "butcher-block-maple", "single-prep-bowl", "package-right-contents-low-center"], ["현관과 가까운 식료품 정리용 키친 아일랜드", "아침 장바구니에서 상품을 꺼낸 직후", "두꺼운 메이플 부처블록 상판", "상품 사실에 맞는 빈 준비 볼 하나만 사용", "제품은 오른쪽에 세우고 확인된 내용물은 낮은 중앙에만 둔다"], cameras.portrait),
    wide: scene(["covered-patio-prep-cart", "noon-cooking-prep", "galvanized-metal-cart", "single-cooking-tool", "package-left-work-zone-right"], ["비를 피할 수 있는 야외 테라스의 이동식 준비 카트", "한낮 조리를 시작하기 직전", "아연도금 금속 카트 상판", "실제 조리에 필요한 도구 하나와 확인된 내용물만 사용", "패키지는 왼쪽 끝, 조리 준비 영역은 오른쪽에 넓게 분리한다"], cameras.wide),
    "detail-overview": scene(["deep-pantry-alcove", "afternoon-storage-check", "matte-laminate-shelf", "single-wire-basket", "package-back-center-empty-front"], ["주방과 떨어진 깊은 팬트리 벽감", "오후에 보관 조건을 확인하는 순간", "회백색 무광 라미네이트 선반", "다른 식품 없이 철제 수납 바구니 하나만 둔다", "패키지를 뒤 중앙에 두고 앞쪽 선반을 비워 전체와 보관 맥락을 보여준다"], cameras.overview),
    "detail-use": scene(["formal-dining-table", "evening-serving", "woven-mat-dark-wood", "finished-dish-cutlery", "dish-front-package-far-back"], ["주방이 보이지 않는 독립 다이닝 공간", "저녁 식사를 내기 직전", "직조 매트가 놓인 짙은 체리우드 테이블", "상품 정보로 뒷받침되는 완성 음식과 식기만 사용", "완성 음식은 크게 전경, 제품은 먼 후경에 두어 결과와 원재료 역할을 분리한다"], cameras.use),
  });
}

const categoryPlans: Record<string, BaseProductSettingShotPlan> = {
  "beauty-skincare": plan({
    portrait: scene(["bathroom-vanity", "morning-post-cleanse", "pale-limestone", "single-folded-towel", "product-right-mirror-left-depth"], ["아침 자연광이 드는 욕실 세면대", "세안 직후 첫 스킨케어 단계를 준비하는 아침", "미세한 결의 밝은 석회석 세면대", "깨끗하게 접은 수건 하나만 사용", "용기를 오른쪽에 세우고 왼쪽 거울 반사는 빈 공간 깊이로만 쓴다"], cameras.portrait),
    wide: scene(["bedroom-nightstand", "bedtime-final-step", "smoked-walnut", "ceramic-tray-sleep-mask", "product-left-routine-space-right"], ["욕실과 분리된 침실의 낮은 나이트스탠드", "취침 전 마지막 관리 단계를 준비하는 밤", "연기색 짙은 월넛 상판", "작은 세라믹 트레이와 접힌 무지 수면안대만 사용", "제품은 왼쪽 끝에 두고 오른쪽 루틴 공간을 길게 비운다"], cameras.wide),
    "detail-overview": scene(["hallway-linen-cabinet", "midday-storage", "frosted-glass-shelf", "single-cotton-basket", "product-rear-center-cap-visible"], ["복도의 리넨 수납장 안쪽", "낮 시간에 보관 상태를 확인하는 순간", "반투명 서리 유리 선반", "다른 화장품 없이 낮은 면 수납 바구니 하나만 둔다", "용기를 뒤 중앙에 놓고 캡·펌프와 선반 깊이가 함께 보이게 한다"], cameras.overview),
    "detail-use": scene(["gym-locker-vanity", "after-workout-refresh", "brushed-stainless-vanity", "plain-toiletry-pouch", "product-front-left-pouch-back-right"], ["사람이 없는 체육관 탈의실의 세면 코너", "운동 후 간단한 관리를 시작하기 직전", "물기 없는 브러시드 스테인리스 세면 상판", "닫힌 무지 세면 파우치만 사용하고 다른 제품은 두지 않는다", "제품은 왼쪽 전경, 파우치는 오른쪽 후경에 두어 욕실 장면과 반대 구도를 만든다"], cameras.use),
  }),
  "beauty-tools": plan({
    portrait: scene(["bedroom-dressing-table", "morning-makeup", "whitewashed-oak", "standing-mirror", "tools-vertical-right-heads-high"], ["침실 창가의 개인 화장대", "아침 메이크업을 시작하기 전", "백색 워시드 오크 화장대", "단순한 스탠드 거울 하나만 사용", "도구를 오른쪽 세로축에 펼쳐 모든 헤드가 위쪽에서 겹치지 않게 한다"], cameras.portrait),
    wide: scene(["home-office-craft-desk", "afternoon-sorting", "blue-grey-linoleum", "single-section-tray", "tools-left-to-right-workflow"], ["생활 공간과 분리된 홈오피스 취미 책상", "오후에 도구 용도를 나눠 정리하는 순간", "청회색 리놀륨 작업 상판", "칸이 하나인 무광 분류 트레이만 사용", "도구를 왼쪽에서 오른쪽 사용 순서로 길게 배열한다"], cameras.wide),
    "detail-overview": scene(["entry-luggage-bench", "pre-travel-packing", "woven-canvas-bench", "verified-case-only", "tools-center-case-rear"], ["현관 옆 여행 짐 전용 벤치", "외출용 파우치에 넣기 직전", "촘촘한 캔버스 직물 벤치", "포함이 확인된 케이스가 있을 때만 사용", "실제 구성은 중앙에 완전히 펼치고 케이스는 뒤쪽에만 둔다"], cameras.overview),
    "detail-use": scene(["laundry-utility-sink", "post-use-cleaning", "ribbed-silicone-mat", "verified-cleaning-piece", "heads-front-handles-back-diagonal"], ["욕실과 떨어진 세탁실의 유틸리티 싱크", "사용 후 세척·건조를 시작하는 단계", "골이 있는 단색 실리콘 건조 매트", "물방울과 포함이 확인된 세척 부품만 사용", "도구 헤드는 전경, 손잡이는 후경으로 향하는 긴 사선에 둔다"], cameras.use),
  }),
  "men-tops": plan({
    portrait: scene(["bedroom-wardrobe", "morning-outfit-choice", "matte-ash-wood", "single-hanger", "garment-full-height-center-right"], ["자연광이 드는 침실 옷장 앞", "외출복을 고르는 아침", "무광 애시우드 옷장 문", "옷걸이 하나만 사용하고 다른 의류는 두지 않는다", "의류 전체 실루엣을 중앙보다 오른쪽 세로축에 완전히 보이게 건다"], cameras.portrait),
    wide: scene(["entryway-foyer", "pre-departure-styling", "dark-slate-bench", "single-clothes-brush", "garment-left-bench-empty-right"], ["침실과 분리된 현관 포이어", "문을 나서기 직전 최종 상태를 보는 순간", "짙은 슬레이트 상판 벤치", "단순한 옷솔 하나만 환경 소품으로 사용", "의류는 왼쪽에 길게 놓고 오른쪽 벤치는 비워 가로 실루엣을 만든다"], cameras.wide),
    "detail-overview": scene(["laundry-folding-station", "afternoon-folding", "white-quartz-counter", "single-folding-board", "garment-center-folded-label-up"], ["세탁실의 독립 접이 작업대", "오후에 세탁·건조 후 접어 보관하기 직전", "밝은 흰색 쿼츠 상판", "무지 접이 보드 하나만 사용", "한 벌을 중앙에 접되 확인 가능한 라벨·두께와 전체 폭이 읽히게 한다"], cameras.overview),
    "detail-use": scene(["guest-room-luggage-area", "evening-trip-pack", "neutral-wool-cover", "empty-open-suitcase", "garment-front-suitcase-back-left"], ["손님방의 여행 가방 정리 공간", "저녁에 다음 날 여행 짐을 꾸리기 직전", "중립색 울 침대 커버", "완전히 빈 열린 캐리어만 사용", "의류는 전경에 완전히 펼치고 캐리어는 왼쪽 후경으로 밀어 길이와 형태를 유지한다"], cameras.use),
  }),
  "toys-games": plan({
    portrait: scene(["child-bedroom-reading-nook", "morning-play-start", "light-cork-platform", "single-book-bin", "product-upper-right-parts-low-left"], ["햇빛이 드는 어린이 방의 독서 벽감", "아침 놀이를 시작하기 직전", "밝은 코르크 단차 플랫폼", "인물 없이 낮은 책 수납함 하나만 둔다", "완성 제품은 오른쪽 위, 확인된 부품은 왼쪽 낮은 전경에 분리한다"], cameras.portrait),
    wide: scene(["living-room-floor", "afternoon-rule-layout", "solid-wool-rug", "included-parts-only", "parts-left-result-right"], ["가구를 치운 넓은 거실 바닥", "오후에 놀이 규칙과 구성품을 펼쳐 보는 순간", "단색 짙은 울 러그", "상품에 실제 포함된 구성품만 사용", "남은 구성품은 왼쪽, 놀이 결과는 오른쪽으로 나눠 긴 흐름을 만든다"], cameras.wide),
    "detail-overview": scene(["hall-storage-closet", "evening-cleanup", "matte-birch-shelf", "verified-storage-box", "product-rear-box-front-open"], ["놀이방 밖 복도의 수납장", "저녁 놀이 후 정리하기 직전", "무광 자작나무 선반", "포함이 확인된 수납함이 있을 때만 사용", "제품 전체를 뒤쪽에 두고 앞쪽 수납 관계와 실제 수량을 위에서 읽게 한다"], cameras.overview),
    "detail-use": scene(["covered-balcony-activity-table", "weekend-active-play", "mint-powder-coated-table", "included-active-pieces", "result-front-pieces-back-right"], ["비를 피할 수 있는 발코니의 낮은 활동 테이블", "주말 낮 대표 놀이가 진행되는 중간 상태", "민트색 분체도장 금속 테이블", "사람·손 없이 포함된 작동 부품만 사용", "놀이 결과는 왼쪽 전경, 남은 부품은 오른쪽 후경에 분리한다"], cameras.use),
  }),
  "food-supplement": plan({
    portrait: scene(["dry-label-review-shelf", "morning-package-check", "pale-bamboo", "single-blank-note", "package-upper-left-note-lower-right"], ["아침 자연광의 독립 건식 식품 선반", "구매 전 패키지 표시사항을 확인하는 순간", "밝은 대나무 집성 선반", "글자가 없는 메모 카드 하나만 사용하고 물·낱알·섭취 도구는 두지 않는다", "패키지는 왼쪽 위에 세우고 빈 검토 영역은 오른쪽 아래에 둔다"], cameras.portrait),
    wide: scene(["office-package-review-desk", "midday-composition-check", "charcoal-felt-desk", "blank-notepad-only", "product-left-review-space-right"], ["주방과 떨어진 조용한 업무용 검토 책상", "낮에 패키지·구성 정보를 대조하는 순간", "차콜색 펠트 데스크 매트", "빈 메모장만 사용하고 물병·알약·섭취 장면은 제외한다", "제품은 왼쪽, 검토 공간은 오른쪽 끝까지 넓게 비운다"], cameras.wide),
    "detail-overview": scene(["dry-food-locker", "late-afternoon-storage", "perforated-steel-shelf", "single-closed-pouch", "package-back-center-label-visible"], ["사람이 없는 건식 식품 보관장의 독립 칸", "늦은 오후 보관 상태를 확인하는 순간", "구멍이 난 회색 철제 선반", "닫힌 단색 파우치 하나만 배경에 두고 다른 건강상품은 두지 않는다", "패키지를 뒤 중앙에 두고 라벨과 선반 깊이를 함께 보여준다"], cameras.overview),
    "detail-use": scene(["independent-evidence-table", "evening-classification-review", "dark-green-stone", "blank-evidence-card", "package-front-left-evidence-space-right"], ["식사 공간과 분리된 상품 근거 확인 테이블", "저녁에 분류·함량·구성을 실물과 대조하는 순간", "짙은 녹색 무광 석재 상판", "빈 근거 카드만 사용하고 물잔·낱알·신체·섭취 행동은 보이지 않게 한다", "패키지는 왼쪽 전경, 근거 검토 공간은 오른쪽 후경에 둔다"], cameras.use),
  }),
};

type SupplementalDescriptions = Record<SupplementalSettingShotAssetId, SceneDescriptions>;

function supplementalPlan(planLabel: string, descriptions: SupplementalDescriptions) {
  return {
    "detail-routine": supplementalScene(planLabel, "detail-routine", descriptions["detail-routine"], cameras.routine),
    "detail-scale": supplementalScene(planLabel, "detail-scale", descriptions["detail-scale"], cameras.scale),
    "detail-storage": supplementalScene(planLabel, "detail-storage", descriptions["detail-storage"], cameras.storage),
    "detail-context": supplementalScene(planLabel, "detail-context", descriptions["detail-context"], cameras.context),
  } satisfies Record<SupplementalSettingShotAssetId, SceneParts>;
}

const supplementalPlans = {
  cereal: supplementalPlan("cereal", {
    "detail-routine": ["현관 가까이의 밝은 평일 아침 준비 콘솔", "외출 전 간식 준비물을 확인하는 순간", "옅은 회색 미세 시멘트 상판", "밀폐된 무지 도시락 용기 하나만 사용하고 앞 장면의 볼·리넨은 제외한다", "패키지는 왼쪽 뒤에 세우고 닫힌 용기는 오른쪽 낮은 전경에 둔다"],
    "detail-scale": ["식료품을 정리하는 독립형 아일랜드 끝", "한낮에 실제 보관 부피를 가늠하는 순간", "짙은 청록색 라미네이트 상판", "손잡이 없는 빈 표준 머그 하나만 상대 크기 단서로 두고 수치를 만들지 않는다", "패키지와 머그 사이를 넓게 비우고 같은 초점면에서 전체 실루엣을 보여준다"],
    "detail-storage": ["닫힘 구조가 보이는 깊은 서랍형 건식 식품 수납장", "개봉 전 건조하게 정리한 늦은 오후", "밝은 자작나무 서랍 바닥", "다른 포장 식품 없이 고정 칸막이 하나만 사용한다", "패키지는 오른쪽 안쪽에 두고 왼쪽 앞의 꺼내는 공간을 완전히 비운다"],
    "detail-context": ["주방과 분리된 밝은 홈오피스 창가 벽감", "오후 간식 준비를 마친 직후", "무광 흰 금속 고정 선반", "완성된 시리얼 한 컵과 작은 티스푼만 사용하고 아침 그릇은 반복하지 않는다", "가로 화면 왼쪽에 컵, 오른쪽에 패키지를 두고 낮은 후면광으로 마무리한다"],
  }),
  "coffee-tea": supplementalPlan("coffee-tea", {
    "detail-routine": ["현관 벽면의 출근 준비 음료 벽감", "텀블러에 담기 전 포장을 챙기는 이른 아침", "검은 분체도장 고정 금속 선반", "닫힌 무지 텀블러와 고정 열쇠 트레이만 사용한다", "제품은 오른쪽 뒤에 세우고 텀블러는 왼쪽 아래에 비스듬히 둔다"],
    "detail-scale": ["작은 홈카페의 벽 고정 작업 선반", "한낮에 포장 크기와 작업대 점유를 확인하는 순간", "짙은 녹색 고무 상판", "표준 드리퍼 하나만 상대 크기 기준으로 사용하고 용량 수치는 만들지 않는다", "제품과 드리퍼를 같은 초점면에 떨어뜨려 배치한다"],
    "detail-storage": ["문이 열린 상부 찬장의 독립 건식 보관 칸", "향을 지키기 위해 정리한 늦은 오후", "화이트 오크 찬장 바닥", "다른 원두·차 포장 없이 고정 선반 분리대 하나만 둔다", "제품은 왼쪽 안쪽에 세우고 오른쪽 앞의 손이 닿는 여백을 보여준다"],
    "detail-context": ["침실·업무공간과 분리된 저녁 거실 벽난로 벽감", "음료 준비를 마친 휴식 직전", "짙은 석재 고정 선반", "완성 음료 한 잔과 무지 코스터만 사용하고 독서 안경은 반복하지 않는다", "제품은 왼쪽 후경, 잔은 오른쪽 전경에 두고 따뜻한 측면광을 사용한다"],
  }),
  "general-food": supplementalPlan("general-food", {
    "detail-routine": ["장보기 물품을 분류하는 현관 옆 고정 보조대", "조리 전 재료를 확인하는 오전", "짙은 고무나무 상판", "무지 종이 장바구니 하나와 빈 보관 용기 하나만 사용한다", "제품은 장바구니 바깥 오른쪽에 세워 전체 포장을 확인하게 한다"],
    "detail-scale": ["소형 주방 카트가 놓인 독립 조리 벽감", "한낮에 조리 공간 점유를 확인하는 순간", "청회색 스테인리스 상판", "빈 표준 접시 하나만 상대 크기 단서로 두고 수치를 암시하지 않는다", "제품은 왼쪽 뒤, 접시는 오른쪽 앞 같은 초점면에 둔다"],
    "detail-storage": ["주방 밖 계단 아래의 깊은 건식 식품 서랍", "개봉 전 보관 위치를 정한 늦은 오후", "밝은 코르크 안감 서랍 바닥", "다른 식품 없이 고정 칸막이만 사용한다", "제품은 서랍 오른쪽 안쪽에 두고 왼쪽 앞 접근 여백을 보여준다"],
    "detail-context": ["거실과 주방에서 떨어진 베란다 식사 벽감", "저녁 식사 준비가 끝난 직후", "무광 남색 타일 고정 선반", "상품 정보로 확인되는 완성 음식 한 접시만 사용하고 조리 도구는 반복하지 않는다", "완성 음식은 왼쪽 전경, 제품은 오른쪽 후경에 가로로 분리한다"],
  }),
  "beauty-skincare": supplementalPlan("beauty-skincare", {
    "detail-routine": ["현관과 욕실에서 떨어진 아침 드레스룸 벽감", "외출 전 마지막 보습 단계를 준비하는 오전", "차가운 회백색 마이크로시멘트 선반", "무지 손거울 하나만 사용하고 수건·트레이는 반복하지 않는다", "용기는 왼쪽 뒤, 빈 루틴 영역은 오른쪽 전경에 둔다"],
    "detail-scale": ["창이 없는 파우더룸의 벽 고정 점검대", "한낮에 용기 점유 면적을 확인하는 순간", "짙은 청색 세라믹 상판", "빈 표준 면 패드 케이스 하나만 상대 크기 단서로 사용한다", "제품과 빈 케이스를 같은 초점면에 간격을 두고 세운다"],
    "detail-storage": ["여행용품 전용 붙박이 서랍의 안쪽 칸", "여행 전 저녁에 보관 위치를 정하는 순간", "밝은 코르크 서랍 안감", "다른 화장품 없이 고정 칸막이 하나만 둔다", "용기는 오른쪽 안쪽에 세우고 왼쪽 앞의 꺼내는 공간을 비운다"],
    "detail-context": ["욕실과 분리된 늦은 밤 서재의 세면 벽감", "하루 루틴을 마친 뒤 패키지를 정리하는 순간", "짙은 녹색 석재 고정 선반", "닫힌 무지 세면 파우치 하나만 사용하고 수면안대는 반복하지 않는다", "용기는 왼쪽 전경, 파우치는 오른쪽 후경에 두고 낮은 측면광을 사용한다"],
  }),
  "beauty-tools": supplementalPlan("beauty-tools", {
    "detail-routine": ["공연장 뒤편의 비어 있는 고정 메이크업 스테이션", "사용 순서를 점검하는 이른 저녁", "무광 자주색 수지 상판", "고정 조명 거울과 빈 무지 카드만 사용한다", "도구는 오른쪽 뒤에 모으고 왼쪽 앞 작업 구역을 비운다"],
    "detail-scale": ["공예실의 작은 벽 고정 검사대", "한낮에 손잡이 길이와 점유 면적을 비교하는 순간", "연한 회색 고무 상판", "빈 표준 카드 케이스 하나만 상대 크기 기준으로 둔다", "도구와 케이스를 같은 초점면에 평행하게 분리한다"],
    "detail-storage": ["침실 밖 붙박이 액세서리 서랍", "세척 후 완전히 마른 도구를 정리하는 밤", "짙은 펠트 서랍 안감", "다른 뷰티 제품 없이 고정 분리대만 사용한다", "도구 헤드는 오른쪽 안쪽, 손잡이는 왼쪽 앞 접근 방향으로 둔다"],
    "detail-context": ["욕실이 아닌 밝은 여행 준비 벽감", "주말 외출 준비를 마친 늦은 오전", "밝은 테라조 고정 선반", "포함이 확인된 케이스가 있을 때만 닫힌 상태로 사용한다", "제품은 왼쪽 전경, 케이스는 오른쪽 후경에 두어 앞 여행 벤치와 반대 구도로 만든다"],
  }),
  "men-tops": supplementalPlan("men-tops", {
    "detail-routine": ["현관 밖 복도형 코트 정리 벽감", "외출 전 주름과 형태를 확인하는 오전", "짙은 호두나무 고정 선반", "무지 의류 브러시 하나만 사용하고 옷걸이는 반복하지 않는다", "의류는 오른쪽 뒤에 접고 왼쪽 앞 점검 공간을 비운다"],
    "detail-scale": ["재봉실의 독립 검품 벽면", "한낮에 전체 폭과 형태를 상대적으로 확인하는 순간", "청회색 펠트 작업판", "빈 표준 접이 보드 하나만 상대 크기 단서로 사용하고 수치를 만들지 않는다", "의류와 보드를 같은 평면에 간격을 두고 완전히 보이게 둔다"],
    "detail-storage": ["계절 의류 전용 붙박이 깊은 서랍", "세탁 후 장기 보관을 준비하는 늦은 오후", "무광 삼나무 서랍 바닥", "다른 의류 없이 고정 칸막이만 사용한다", "접힌 의류는 왼쪽 안쪽, 오른쪽 앞은 꺼낼 여백으로 둔다"],
    "detail-context": ["침실과 현관에서 떨어진 호텔형 복도 벽감", "저녁 약속 전에 최종 코디를 확인하는 순간", "밝은 석회석 고정 벤치", "확인되지 않은 액세서리 없이 제품 한 벌만 사용한다", "의류는 오른쪽 가로축에 펼치고 왼쪽 전경을 비워 실루엣을 강조한다"],
  }),
  "toys-games": supplementalPlan("toys-games", {
    "detail-routine": ["현관과 거실 밖의 놀이 준비 벽감", "주말 오전 구성품을 확인하는 순간", "주황색 천연 리놀륨 고정 상판", "포함된 구성품만 한 줄로 두고 다른 장난감은 제외한다", "본체는 왼쪽 뒤, 확인된 부품은 오른쪽 앞에 단계적으로 둔다"],
    "detail-scale": ["도서관형 놀이 교실의 고정 활동대", "한낮에 바닥 점유와 높이를 상대적으로 확인하는 순간", "짙은 파란 고무 상판", "빈 표준 보드판 하나만 상대 크기 단서로 사용한다", "제품과 보드판을 같은 초점면에 떨어뜨려 둔다"],
    "detail-storage": ["계단 아래 장난감 전용 깊은 붙박이 서랍", "놀이를 마친 늦은 오후", "밝은 회색 펠트 서랍 안감", "다른 장난감 없이 고정 칸막이 하나만 둔다", "제품은 오른쪽 안쪽에 두고 왼쪽 앞의 꺼내는 여백을 크게 남긴다"],
    "detail-context": ["침실과 거실에서 떨어진 비어 있는 실내 놀이 복도", "저녁 정리를 끝낸 직후", "무광 보라색 코르크 고정 단차", "상품에 포함된 완성 상태만 사용하고 사람·손·추가 소품은 제외한다", "완성 제품은 왼쪽 전경, 확인된 남은 부품은 오른쪽 후경에 가로로 분리한다"],
  }),
  "food-supplement": supplementalPlan("food-supplement", {
    "detail-routine": ["아침 자연광의 독립 상품 검수 벽감", "판매 전 정면 표시를 확인하는 오전", "밝은 무광 유리 고정 선반", "글자 없는 검수 카드 하나만 사용하고 섭취 도구는 제외한다", "패키지는 오른쪽 뒤에 세우고 왼쪽 앞 검수 영역을 비운다"],
    "detail-scale": ["문서 보관실의 고정 표본 점검대", "한낮에 포장 점유 면적을 상대적으로 확인하는 순간", "푸른 회색 수지 상판", "빈 표준 카드 케이스 하나만 크기 단서로 사용하고 수치를 만들지 않는다", "패키지와 케이스를 같은 초점면에 충분히 떨어뜨려 둔다"],
    "detail-storage": ["건식 식품 전용 잠금 수납장의 깊은 칸", "빛과 습기를 피해 정리한 늦은 오후", "밝은 자작나무 고정 선반", "다른 건강상품 없이 고정 분리대 하나만 둔다", "패키지는 왼쪽 안쪽에 세우고 오른쪽 앞 접근 공간을 비운다"],
    "detail-context": ["식사 공간과 분리된 야간 상품 기록 벽감", "표시 근거 기록을 마친 늦은 저녁", "짙은 남색 석재 고정 선반", "빈 무지 기록지 하나만 사용하고 물·낱알·신체는 제외한다", "패키지는 오른쪽 전경, 기록지는 왼쪽 후경에 두고 차가운 측면광을 사용한다"],
  }),
  "general-commerce": supplementalPlan("general-commerce", {
    "detail-routine": ["현관과 작업실 사이의 사용 준비 벽감", "핵심 기능을 시작하기 전 오전", "연한 회색 미세 시멘트 고정 상판", "검증 가능한 기능 단서 하나만 사용하고 앞 장면 소품은 반복하지 않는다", "상품은 왼쪽 뒤, 다음 행동 영역은 오른쪽 앞에 둔다"],
    "detail-scale": ["창고형 홈오피스의 고정 검사대", "한낮에 실제 공간 점유를 상대적으로 확인하는 순간", "짙은 청록색 고무 상판", "상품군에 맞는 빈 표준 보관함 하나만 상대 크기 단서로 사용한다", "상품과 보관함을 같은 초점면에 충분히 떨어뜨려 둔다"],
    "detail-storage": ["생활용품 전용 붙박이 깊은 수납 칸", "사용 후 정리하는 늦은 오후", "밝은 코르크 고정 선반", "다른 판매 상품 없이 고정 칸막이 하나만 둔다", "상품은 오른쪽 안쪽에 두고 왼쪽 앞의 꺼내는 경로를 비운다"],
    "detail-context": ["앞 장소들과 분리된 저녁 실내 다용도 벽감", "핵심 작업을 마친 직후", "짙은 자주색 석재 고정 상판", "검증된 사용 결과 하나만 두고 장식 소품은 제외한다", "결과는 왼쪽 전경, 상품은 오른쪽 후경에 가로로 분리한다"],
  }),
} as const;

const generalPlan = plan({
  portrait: scene(["entryway-console", "morning-ready-to-use", "natural-rattan", "single-function-cue", "product-upper-right-cue-lower-left"], ["상품 크기와 용도에 맞춘 현관 콘솔 주변", "아침에 처음 사용하려는 직전", "상품과 대비되는 천연 라탄 표면", "기능을 설명하는 검증 가능한 환경 소품 하나만 사용", "상품은 오른쪽 위, 기능 단서는 왼쪽 낮은 전경에 둔다"], cameras.portrait),
  wide: scene(["home-office-workbench", "midday-task-setup", "blue-rubber-worktop", "different-function-cue", "product-left-task-zone-right"], ["첫 장면과 분리된 홈오피스 작업대", "한낮 실제 작업을 준비하는 순간", "파란 무광 고무 작업 상판", "첫 장면과 겹치지 않는 기능성 소품 하나만 사용", "상품은 왼쪽 끝, 실제 작업 영역은 오른쪽에 길게 둔다"], cameras.wide),
  "detail-overview": scene(["utility-closet", "afternoon-storage", "white-wire-shelf", "single-storage-divider", "product-rear-center-empty-front"], ["상품이 실제로 보관되는 독립 유틸리티 수납장", "오후에 보관 위치에서 꺼내기 직전", "흰색 철망 선반", "다른 판매 상품 없이 수납 칸막이 하나만 둔다", "상품은 뒤 중앙에 두고 앞 선반을 비워 전체 크기와 보관 관계를 보여준다"], cameras.overview),
  "detail-use": scene(["covered-balcony-table", "evening-core-use", "dark-composite-slab", "verified-use-target", "result-front-product-back-right"], ["앞 세 장소와 겹치지 않는 지붕 있는 발코니 작업 테이블", "저녁에 핵심 기능이 가장 분명하게 수행되는 순간", "짙은 복합소재 슬래브 표면", "상품 사실로 뒷받침되는 사용 대상만 두고 장식 소품은 배제", "기능 결과는 왼쪽 전경, 상품은 오른쪽 후경에 두어 사용법을 설명한다"], cameras.use),
});

export function buildProductSettingShotPlan(
  categoryId: string,
  detectionText: string,
  sceneIdentityText = detectionText,
): ProductSettingShotPlan {
  if (categoryId === "food-staples") {
    if (/시리얼|cereal|오트밀|oatmeal|granola|그래놀라/i.test(detectionText)) {
      return applyProductSpecificSceneVariation(
        "cereal",
        completePlan("cereal", cerealPlan(), supplementalPlans.cereal),
        sceneIdentityText,
      );
    }
    if (/커피|coffee|원두|tea|티백|차\b/i.test(detectionText)) {
      return applyProductSpecificSceneVariation(
        "coffee-tea",
        completePlan("coffee-tea", coffeeTeaPlan(), supplementalPlans["coffee-tea"]),
        sceneIdentityText,
      );
    }
    return applyProductSpecificSceneVariation(
      "general-food",
      completePlan("general-food", generalFoodPlan(), supplementalPlans["general-food"]),
      sceneIdentityText,
    );
  }
  const planLabel = categoryId in categoryPlans ? categoryId : "general-commerce";
  const base = categoryPlans[categoryId] ?? generalPlan;
  const supplemental = supplementalPlans[planLabel as keyof typeof supplementalPlans] ?? supplementalPlans["general-commerce"];
  return applyProductSpecificSceneVariation(
    planLabel,
    completePlan(planLabel, base, supplemental),
    sceneIdentityText,
  );
}

export function formatProductSettingShot(setting: ProductSettingShot) {
  const separation = settingShotDimensions.map((dimension) => setting.separation[dimension]).join("/");
  return `${setting.label} · 장소=${setting.location} · 시간대·순간=${setting.moment} · 표면=${setting.surface} · 허용 소품=${setting.supportingObjects} · 상품 위치=${setting.staging} · 카메라=${setting.camera} · 장면 분리키=${separation}`;
}
