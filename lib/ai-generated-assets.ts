export const aiGeneratedAssetSpecs = [
  { id: "hero", file: "hero.png", role: "gallery", label: "clean ecommerce product hero", ratio: "1:1", width: 1200, height: 1200, composition: "one product only, centered, filling 72–82% of the frame, clean neutral studio background, complete package visible" },
  { id: "square", file: "thumbnail-square.png", role: "gallery", label: "marketplace primary thumbnail", ratio: "1:1", width: 1200, height: 1200, composition: "one product only, centered, filling 78–86% of the square frame, front-facing catalog composition, complete silhouette visible" },
  { id: "portrait", file: "thumbnail-portrait.png", role: "creative", label: "mobile portrait thumbnail", ratio: "4:5", width: 1200, height: 1500, composition: "vertical editorial product layout, product filling 62–72% of the frame, complete package in the upper two-thirds" },
  { id: "wide", file: "thumbnail-wide.png", role: "creative", label: "wide promotion thumbnail", ratio: "16:9", width: 1600, height: 900, composition: "wide product composition, product filling at least 52% of the frame, uncluttered supporting surface" },
  { id: "detail-overview", file: "detail-overview.png", role: "detail", label: "detail page product overview", ratio: "1:1", width: 1200, height: 1200, composition: "one complete product in a realistic ecommerce studio scene, filling 62–72% of the square frame, clear front and material visibility" },
  { id: "detail-feature", file: "detail-feature.png", role: "detail", label: "detail page visible feature close-up", ratio: "1:1", width: 1200, height: 1200, composition: "close product crop showing only features visibly supported by the reference, product filling 72–86% of the square frame" },
  { id: "detail-use", file: "detail-use.png", role: "detail", label: "detail page use context", ratio: "1:1", width: 1200, height: 1200, composition: "realistic use context appropriate to the product, product remains dominant and fills at least 55% of the square frame, no people unless visible in the reference" },
  { id: "detail-package", file: "detail-package.png", role: "detail", label: "detail page package and included item view", ratio: "1:1", width: 1200, height: 1200, composition: "complete package or included item arrangement supported by the reference, centered and filling 65–78% of the square frame" },
] as const;

export type AiGeneratedAssetId = (typeof aiGeneratedAssetSpecs)[number]["id"];

export const aiGeneratedAssetIds = aiGeneratedAssetSpecs.map((asset) => asset.id) as [AiGeneratedAssetId, ...AiGeneratedAssetId[]];

export const aiDetailAssetIds = aiGeneratedAssetSpecs
  .filter((asset) => asset.role === "detail")
  .map((asset) => asset.id) as AiGeneratedAssetId[];

export function aiGeneratedAssetPath(jobId: string, asset: (typeof aiGeneratedAssetSpecs)[number]) {
  return `results/${jobId}/${asset.file}`;
}
