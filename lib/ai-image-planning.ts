import { aiGeneratedAssetSpecs, type AiGeneratedAssetId } from "./ai-generated-assets";
import { resolveIdentityBackgroundContract } from "./ai-background-audit";
import { channelStyleProfiles, matchStyleCategory } from "./marketplace-style-learning";
import { buildProductSettingShotPlan, formatProductSettingShot, settingShotAssetIds } from "./product-setting-shots";
import type { ProductStudioResult } from "../app/product-studio-types";

export const AI_ASSET_PROMPT_VERSION = "2026.08.26-r9-source-identity";

type AssetSpec = (typeof aiGeneratedAssetSpecs)[number];

export type SourceImageSpec = {
  role?: string | null;
};

const sourceIdentityCategoryIds = new Set([
  "beauty-skincare",
  "food-staples",
  "food-supplement",
  "toys-games",
]);

const statutoryPackageSignals = /식품|시리얼|과자|커피|차|음료|참치|통조림|건강기능|영양제|보충제|화장품|스킨케어|크림|로션|샴푸|완구|어린이|의약외품|haccp|건기식|인증|법정표시|\b(?:g|kg|ml|kcal)\b/i;

export function requiresSourceIdentityProtection(result: ProductStudioResult) {
  const productText = [
    result.product.category,
    result.product.name,
    ...result.product.features,
    ...result.product.cautions,
  ].join(" ");
  return sourceIdentityCategoryIds.has(matchStyleCategory(productText).id)
    || statutoryPackageSignals.test(productText);
}

function normalizedRole(value: unknown) {
  const role = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  return role.startsWith("extra-") ? "extra" : role;
}

export function selectAssetReferenceIndexes(
  imageSpecs: SourceImageSpec[],
  assetId: AiGeneratedAssetId,
  imageCount = imageSpecs.length,
  maximum = 6,
) {
  const preset = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
  if (!preset || imageCount <= 0) return [];
  const safeMaximum = Math.max(1, Math.min(maximum, imageCount));
  const roles = Array.from({ length: imageCount }, (_, index) => normalizedRole(imageSpecs[index]?.role) || (index === 0 ? "main" : "extra"));
  const ordered: number[] = [];
  const add = (index: number) => {
    if (index >= 0 && index < imageCount && !ordered.includes(index)) ordered.push(index);
  };

  add(roles.indexOf("main"));
  for (const desiredRole of preset.referenceRoles) {
    roles.forEach((role, index) => { if (role === desiredRole) add(index); });
  }
  roles.forEach((_, index) => add(index));
  return ordered.slice(0, safeMaximum);
}

function assetShot(categoryShots: string[], assetId: AiGeneratedAssetId) {
  const fixedRoleShots: Partial<Record<AiGeneratedAssetId, string>> = {
    hero: "대표 정면 3/4 브랜드 히어로 — 오른쪽 1/3 배치와 왼쪽 네거티브 공간",
    square: "순백 배경의 완전 정면 상품 식별컷 — 정중앙 대칭과 균일 여백",
    "detail-feature": "실제 원본 정면에서 확인되는 라벨·재질·구조의 원본 픽셀 근접 증거컷 — 추측 금지",
    "detail-package": "실제로 제공된 측면·후면·표시사항 패널의 원본 픽셀 증거컷 — 숨은 면 추측 금지",
  };
  if (fixedRoleShots[assetId]) return fixedRoleShots[assetId];
  const semanticPatterns: Partial<Record<AiGeneratedAssetId, RegExp>> = {
    portrait: /45도|입체|측면|세로/,
    wide: /사용|활용|맥락|완성|조리|섭취|착용|놀이/,
    "detail-overview": /45도|입체|전체|완성/,
    "detail-feature": /근접|디테일|재질|텍스처|입자|기능/,
    "detail-use": /사용|활용|맥락|완성|조리|섭취|착용|놀이|루틴/,
    "detail-package": /구성|패키지|라벨|표시|수량|용량/,
  };
  const semanticMatch = categoryShots.find((shot) => semanticPatterns[assetId]?.test(shot));
  if (semanticMatch) return semanticMatch;
  const fallbackIndexes: Record<AiGeneratedAssetId, number> = {
    hero: 0, square: 0, portrait: 1, wide: 4,
    "detail-overview": 1, "detail-feature": 2, "detail-use": 4, "detail-package": 3,
  };
  return categoryShots[fallbackIndexes[assetId]] ?? categoryShots[0] ?? "상품 전체와 확인 가능한 구성";
}

function seriesExclusion(assetId: AiGeneratedAssetId) {
  if (assetId === "hero") return "Do not center the product like square, use a pure-white flat catalog background, crop into a macro, or expose top/rear package planes as the main information. Keep the right-third three-quarter hero and left negative space.";
  if (assetId === "detail-overview") return "Do not turn this into a macro crop or overhead package flat lay. Show the whole product in its assigned storage or preparation environment, distinct from the active-use scene.";
  if (assetId === "detail-feature") return "Do not repeat the full-product front hero, centered square, overview or package inspection. One verified texture or construction feature must fill the frame and the complete silhouette must remain outside the crop.";
  if (assetId === "detail-use") return "Do not use a seamless catalog backdrop, macro-only crop, or package flat lay; the environment must explain real use.";
  if (assetId === "detail-package") return "Do not create a lifestyle scene, hero pedestal, synthetic rotation or hidden package plane. Use only a supplied side, rear, label or barcode source view and never claim a closure or structure that is not visible in that exact source.";
  if (assetId === "square") return "Do not add lifestyle props, gradients, banners, badges, promotional text, a pedestal, three-quarter rotation or hero-style negative space. This is the only dead-centered straight-on white identification slot.";
  if (assetId === "portrait") return "Do not reuse the centered square catalog layout or a colored studio wall; the vertical composition must be a real assigned environment.";
  if (assetId === "wide") return "Do not crop a square composition into a banner or use an abstract studio set; compose the assigned real environment natively for the horizontal frame.";
  return "Do not reuse the exact framing intended for the square catalog thumbnail or any detail-page slot.";
}

export function resolveProductSettingShot(result: ProductStudioResult, assetId: AiGeneratedAssetId) {
  if (!settingShotAssetIds.includes(assetId as (typeof settingShotAssetIds)[number])) return null;
  const categoryStyle = matchStyleCategory([
    result.product.category,
    result.product.name,
    ...result.product.features,
  ].join(" "));
  const productText = [result.product.category, result.product.name, ...result.product.features].join(" ");
  const settingPlan = buildProductSettingShotPlan(categoryStyle.id, productText);
  return settingPlan[assetId as keyof typeof settingPlan];
}

export function buildAssetImagePrompt(
  result: ProductStudioResult,
  outputPath: string,
  preset: AssetSpec,
  inputRoles: string[] = [],
  noveltyGuidance = "",
  generationMode: "product" | "identity-background" = "product",
) {
  const categoryStyle = matchStyleCategory([
    result.product.category,
    result.product.name,
    ...result.product.features,
  ].join(" "));
  const channelVisuals = channelStyleProfiles.map((profile) => `${profile.label}: ${profile.thumbnailStyle}`).join(" | ");
  const localizedVisualSignals = [...new Set((Array.isArray(result.localizedListings) ? result.localizedListings : []).flatMap((listing) => {
    if (preset.id.startsWith("detail-")) {
      const detail = Array.isArray(listing.detailSections)
        ? listing.detailSections.find((section) => section.imageAsset === preset.id)
        : null;
      return detail?.imageAltText ? [`${listing.channel}:${listing.market} ${detail.imageAltText}`] : [];
    }
    return listing.thumbnailAltText ? [`${listing.channel}:${listing.market} ${listing.thumbnailAltText}`] : [];
  }))].join(" | ").slice(0, 2_400);
  const referenceRoles = inputRoles.length ? inputRoles.join(", ") : "main";
  const requiredShot = assetShot(categoryStyle.shotList, preset.id);
  const settingShot = resolveProductSettingShot(result, preset.id);
  const seriesRoleManifest = aiGeneratedAssetSpecs
    .map((asset) => `${asset.id}=${asset.shotClass} | purpose=${asset.purpose} | placement=${asset.subjectPlacement}`)
    .join(" || ");
  const mustDifferFrom = preset.mustDifferFrom.join(", ");

  if (generationMode === "identity-background") {
    const placement = preset.identityPolicy.placement;
    const safeContract = settingShot ? resolveIdentityBackgroundContract(settingShot, preset.id) : null;
    const safeEnvironmentAssignment = settingShot
      ? [
          `장소=${safeContract?.location.description ?? settingShot.location}`,
          `가시적 시간대 조명=${safeContract?.moment.description ?? settingShot.moment}`,
          `표면=${safeContract?.surface.description ?? settingShot.surface}`,
          `카메라=${safeContract?.camera.description ?? settingShot.camera}`,
          `장면 분리키=${safeContract?.location.key ?? settingShot.separation.location}/${safeContract?.moment.key ?? settingShot.separation.moment}/${safeContract?.surface.key ?? settingShot.separation.surface}/${safeContract?.camera.key ?? settingShot.separation.camera}`,
        ].join(" · ")
      : "factual neutral commercial architecture appropriate to the broad category";
    return [
      "설치된 codex-image 스킬의 규칙을 사용하고 반드시 내장 image_gen 도구로 배경 이미지만 제작하세요.",
      `SellerPilot asset prompt version: ${AI_ASSET_PROMPT_VERSION}`,
      "Use case: background-plate-only",
      `Series slot: ${preset.id}; target aspect ratio ${preset.ratio}.`,
      `Background environment: ${preset.scene}`,
      `Mandatory empty-environment assignment: ${safeEnvironmentAssignment}. Make it readable with fixed architecture, built-in surfaces, natural light direction and spatial depth. Slot-specific non-merchandise environmental cue (${safeContract?.prop.key ?? "fixed-architectural-detail"}): ${safeContract?.prop.description ?? "one fixed architectural detail"}. Deliberately omit every retail product, small saleable prop, serving item, loose ingredient, use-result object and container from the product setting plan; those cannot be trusted before source-pixel compositing.`,
      `Hard series visual split: visibly auditable time-light ${safeContract?.moment.key ?? "distinct-visible-time-light"} (${safeContract?.moment.description ?? "a clearly distinct time-of-day lighting pattern"}); palette-family ${safeContract?.palette.key ?? "distinct-category-palette"} (${safeContract?.palette.description ?? "a clearly distinct palette"}); spatial-depth ${safeContract?.spatialDepth.key ?? "distinct-spatial-depth"} (${safeContract?.spatialDepth.description ?? "a clearly distinct depth layout"}). A beige/cream generic room or shelf repeated across slots fails even if the fixture geometry changes.`,
      `Reserve the normalized rectangle left=${placement.left}, top=${placement.top}, width=${placement.width}, height=${placement.height} as a visually quiet product-placement zone with believable contact surface and lighting.`,
      "HARD IDENTITY FIREWALL: generate only an empty background plate. No source product, staged saleable good, package, pouch, carton, bottle, can, jar, tube, label, logo, barcode, certification mark, printed text, small movable consumer prop, loose unit, ingredient, serving, accessory or hand may appear anywhere. The declared fixed non-merchandise cue and other necessary fixed architectural context are allowed, but every contextual cue must be visually distinct from the other slots.",
      "The real product will be composited afterward from a verified transparent source-pixel cutout. Never anticipate, reconstruct, trace, imitate or redraw any part of it.",
      `Composition must remain materially different from: ${mustDifferFrom}. ${seriesExclusion(preset.id)}`,
      noveltyGuidance,
      "Mandatory self-QA: inspect the entire plate. If any object could be mistaken for merchandise, packaging, product contents, a labeled container or a certification mark, regenerate before saving.",
      `생성 결과 PNG를 정확히 ${outputPath} 경로에 저장하세요. Python·SVG·Canvas로 대체 이미지를 만들지 마세요.`,
    ].filter(Boolean).join("\n");
  }

  return [
    "설치된 codex-image 스킬의 규칙을 사용하고 반드시 내장 image_gen 도구로 이미지를 제작하세요.",
    `SellerPilot asset prompt version: ${AI_ASSET_PROMPT_VERSION}`,
    "Use case: product-mockup",
    `Asset type: ${preset.label} for a real marketplace listing`,
    `Information purpose: ${preset.purpose}`,
    `Hard shot class: ${preset.shotClass}. Do not satisfy this slot with another shot class.`,
    `Series slot: ${preset.id}. This slot must have a recognizably different camera, crop, setting and purchase-information purpose from the other seven slots.`,
    `Series role manifest (all eight are mutually exclusive): ${seriesRoleManifest}`,
    `Hard role-separation opponents for this slot: ${mustDifferFrom}. If the draft could plausibly be labeled as any of these slots, reject and regenerate it.`,
    "Uniqueness contract: no SellerPilot output may reuse another slot's camera position, crop, background layout, prop arrangement or subject placement. A merely recolored or lightly reframed version counts as a duplicate and must not be produced.",
    "Series setting-shot contract: hero and square are the only catalog-background shots. Portrait, wide, detail-overview and detail-use are four mandatory real-world setting shots, each in a different physical location, time/use moment, surface material, prop set, subject placement and camera family. A colored wall, geometric panel, gradient or pedestal is not a setting shot.",
    `Input references in order: ${referenceRoles}. Image 1 anchors product identity; later images are factual views for shape, label, material and package verification, not separate products.`,
    `Scene/backdrop: ${preset.scene}. Use ${result.design.palette.surface} and ${result.design.palette.accent} only as restrained palette guidance, not as the same repeated studio set.`,
    settingShot ? `Mandatory product-specific setting: ${formatProductSettingShot(settingShot)}` : "Inspection-shot assignment: keep this factual catalog, macro or package view free from lifestyle staging so it cannot duplicate the four setting shots.",
    settingShot ? "Setting-shot validity: every 장면 분리키 dimension is a hard semantic boundary, not a naming hint. The assigned place and use moment must be immediately recognizable without text through at least two physical environmental cues. Reserve roughly 30–45% of the frame for readable spatial context while keeping the real product dominant. Do not replace it with an abstract commercial background, colored blocks, a seamless sweep or a generic pedestal." : "",
    `Subject: ${result.product.name}; preserve package shape, label, logo, printed information, color, count and included items exactly as visible.`,
    `Composition/framing: ${preset.composition}; target aspect ratio ${preset.ratio}.`,
    `Required subject placement: ${preset.subjectPlacement}.`,
    `Camera: ${preset.camera}.`,
    `Category direction: ${categoryStyle.thumbnailStyle}`,
    `Required shot for this slot: ${requiredShot}.`,
    `Series differentiation: ${seriesExclusion(preset.id)}`,
    noveltyGuidance,
    `Marketplace adaptation references: ${channelVisuals}`,
    "Image SEO intent: make the product type, silhouette, material, count and use context visually unambiguous so the same factual master can receive accurate locale-specific alt text. Do not render SEO keywords as visible text.",
    localizedVisualSignals ? `Cross-market localized visual semantics (meaning only; never render this text in the image): ${localizedVisualSignals}` : "",
    "Lighting/mood: commercially realistic lighting appropriate to this specific shot; crisp product identity and believable contact shadows.",
    "Constraints: the product must be the obvious dominant subject; no invented ingredients, certification, barcode, quantity, accessories, package text or extra product; no watermark; no floating copy; no decorative text.",
    "Avoid: distant product, tiny subject, scenic landscape dominating the frame, illegible altered label, duplicate product, cropped package, busy props, people or hands unless a supplied reference proves them, and logos not present in the reference.",
    settingShot ? "Mandatory self-QA before finishing: inspect the generated PNG. If the assigned physical place is not instantly identifiable, if it looks like a studio background, or if its location/time/surface/props/product-position/camera could be confused with another SellerPilot setting slot, regenerate it before saving the final file." : "Mandatory role self-QA before finishing: inspect the generated PNG against the full series role manifest. If its crop, camera, subject placement or information purpose fits another slot, regenerate it before saving.",
    `생성 결과 PNG를 정확히 ${outputPath} 경로에 저장하세요. Python·SVG·Canvas로 대체 이미지를 만들지 마세요.`,
  ].filter(Boolean).join("\n");
}
