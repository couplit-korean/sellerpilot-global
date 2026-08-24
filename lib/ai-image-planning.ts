import { aiGeneratedAssetSpecs, type AiGeneratedAssetId } from "./ai-generated-assets";
import { channelStyleProfiles, matchStyleCategory } from "./marketplace-style-learning";
import { buildProductSettingShotPlan, formatProductSettingShot, settingShotAssetIds } from "./product-setting-shots";
import type { ProductStudioResult } from "../app/product-studio-types";

export const AI_ASSET_PROMPT_VERSION = "2026.08.24-r5";

type AssetSpec = (typeof aiGeneratedAssetSpecs)[number];

export type SourceImageSpec = {
  role?: string | null;
};

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
  const semanticPatterns: Partial<Record<AiGeneratedAssetId, RegExp>> = {
    hero: /정면|대표|히어로|전체/,
    square: /정면|대표|히어로|전체/,
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
  if (assetId === "detail-overview") return "Do not turn this into a macro crop or overhead package flat lay. Show the whole product in its assigned storage or preparation environment, distinct from the active-use scene.";
  if (assetId === "detail-feature") return "Do not repeat the full-product front hero or overview composition; the visible feature must be the clear subject.";
  if (assetId === "detail-use") return "Do not use a seamless catalog backdrop, macro-only crop, or package flat lay; the environment must explain real use.";
  if (assetId === "detail-package") return "Do not create a lifestyle scene or hero pedestal, and never duplicate one physical item to imply a set.";
  if (assetId === "square") return "Do not add lifestyle props, gradients, banners, badges, or promotional text.";
  if (assetId === "portrait") return "Do not reuse the centered square catalog layout or a colored studio wall; the vertical composition must be a real assigned environment.";
  if (assetId === "wide") return "Do not crop a square composition into a banner or use an abstract studio set; compose the assigned real environment natively for the horizontal frame.";
  return "Do not reuse the exact framing intended for the square catalog thumbnail or any detail-page slot.";
}

export function buildAssetImagePrompt(
  result: ProductStudioResult,
  outputPath: string,
  preset: AssetSpec,
  inputRoles: string[] = [],
  noveltyGuidance = "",
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
  const productText = [result.product.category, result.product.name, ...result.product.features].join(" ");
  const settingPlan = buildProductSettingShotPlan(categoryStyle.id, productText);
  const settingShot = settingShotAssetIds.includes(preset.id as (typeof settingShotAssetIds)[number])
    ? settingPlan[preset.id as keyof typeof settingPlan]
    : null;

  return [
    "설치된 codex-image 스킬의 규칙을 사용하고 반드시 내장 image_gen 도구로 이미지를 제작하세요.",
    `SellerPilot asset prompt version: ${AI_ASSET_PROMPT_VERSION}`,
    "Use case: product-mockup",
    `Asset type: ${preset.label} for a real marketplace listing`,
    `Series slot: ${preset.id}. This slot must have a recognizably different camera, crop, setting and purchase-information purpose from the other seven slots.`,
    "Uniqueness contract: no SellerPilot output may reuse another slot's camera position, crop, background layout, prop arrangement or subject placement. A merely recolored or lightly reframed version counts as a duplicate and must not be produced.",
    "Series setting-shot contract: hero and square are the only catalog-background shots. Portrait, wide, detail-overview and detail-use are four mandatory real-world setting shots, each in a different physical location, moment, surface material, prop set and subject placement. A colored wall, geometric panel, gradient or pedestal is not a setting shot.",
    `Input references in order: ${referenceRoles}. Image 1 anchors product identity; later images are factual views for shape, label, material and package verification, not separate products.`,
    `Scene/backdrop: ${preset.scene}. Use ${result.design.palette.surface} and ${result.design.palette.accent} only as restrained palette guidance, not as the same repeated studio set.`,
    settingShot ? `Mandatory product-specific setting: ${formatProductSettingShot(settingShot)}` : "Inspection-shot assignment: keep this factual catalog, macro or package view free from lifestyle staging so it cannot duplicate the four setting shots.",
    settingShot ? "Setting-shot validity: the assigned place and use moment must be immediately recognizable without text through at least two physical environmental cues. Reserve roughly 30–45% of the frame for readable spatial context while keeping the real product dominant. Do not replace it with an abstract commercial background, colored blocks, a seamless sweep or a generic pedestal." : "",
    `Subject: ${result.product.name}; preserve package shape, label, logo, printed information, color, count and included items exactly as visible.`,
    `Composition/framing: ${preset.composition}; target aspect ratio ${preset.ratio}.`,
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
    settingShot ? "Mandatory self-QA before finishing: inspect the generated PNG. If the assigned physical place is not instantly identifiable, if it looks like a studio background, or if its location/surface/props could be confused with another SellerPilot setting slot, regenerate it before saving the final file." : "",
    `생성 결과 PNG를 정확히 ${outputPath} 경로에 저장하세요. Python·SVG·Canvas로 대체 이미지를 만들지 마세요.`,
  ].filter(Boolean).join("\n");
}
