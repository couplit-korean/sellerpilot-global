import type { ProductStudioResult } from "./product-studio-types";

export const CODEX_IMAGE_SOURCE = "https://github.com/wjb127/codex-image";

export function buildThumbnailPrompt(result: ProductStudioResult) {
  const { product, design, thumbnail } = result;
  // Prompt order follows codex-image's MIT-licensed recipe: backdrop → subject → details → constraints.
  return [
    `Scene / backdrop: premium Korean ecommerce product thumbnail, clean studio set using ${design.palette.surface} and ${design.palette.accent}, soft directional daylight, elegant editorial composition.`,
    `Subject: preserve the uploaded ${product.name} package exactly as the hero product, centered and fully visible.`,
    `Details: ${thumbnail.badge}; visual mood ${design.themeName}; communicate ${product.oneLine}; subtle botanical props and realistic soft shadow.`,
    "Constraints: do not invent or alter package text, logo, ingredients, count, barcode, certification marks, or product shape; no extra products; no floating text; no watermark; commercial ecommerce quality.",
  ].join("\n");
}
