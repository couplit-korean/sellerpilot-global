import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { emptyProductIntake, productEditSchema } from "../lib/product-intake";

const productEditFields = [
  "researchInput",
  "productName",
  "sellerSku",
  "categoryHint",
  "brandName",
  "manufacturer",
  "countryOfOrigin",
  "material",
  "packageContents",
  "condition",
  "gtinStatus",
  "gtin",
  "sellingPrice",
  "currency",
  "stock",
  "weightKg",
  "packageLengthCm",
  "packageWidthCm",
  "packageHeightCm",
  "shippingFeeKrw",
  "shippingRule",
  "packagingRule",
  "productUrl",
  "description",
  "imageRightsConfirmed",
  "productFactsConfirmed",
] as const;

test("every structured product-edit field error is linked to its input and rendered after it", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("function ProductDetailEditDialog");
  const end = page.indexOf("function ProductDetailPage", start);
  const dialog = page.slice(start, end);

  assert.match(dialog, /const fieldErrorId = .*`product-edit-error-\$\{field\}`/);
  assert.match(dialog, /"aria-invalid": errors\[field\] \? true : undefined/);
  assert.match(dialog, /"aria-describedby": errors\[field\] \? fieldErrorId\(field\) : undefined/);
  for (const field of productEditFields) {
    const inputLink = dialog.indexOf(`fieldErrorAttributes("${field}")`);
    const inlineMessage = dialog.indexOf(`fieldError("${field}")`, inputLink);
    assert.ok(inputLink >= 0, `${field} input must expose its structured validation error`);
    assert.ok(inlineMessage > inputLink, `${field} error must render immediately after its input`);
    assert.match(dialog, new RegExp(`errors\\.${field} \\? "field-error"`));
  }
  assert.match(dialog, /draft\.gtinStatus === "HAS_GTIN" \|\| errors\.gtin/);
  assert.match(dialog, /errors\.form && <p className="inventory-editor-message">\{errors\.form\}<\/p>/);
  assert.match(dialog, /<ProductRevisionImagePicker sessionId=\{photoSessionId\} disabled=\{saving\}/);
});

test("invalid edit data still produces field-specific schema paths and sold-out stock stays valid", () => {
  const invalid = productEditSchema.safeParse({
    ...emptyProductIntake,
    stock: 0,
  });
  assert.equal(invalid.success, false);
  if (invalid.success) return;
  const paths = new Set(invalid.error.issues.map((issue) => String(issue.path[0])));
  for (const field of [
    "researchInput",
    "productName",
    "sellerSku",
    "categoryHint",
    "brandName",
    "manufacturer",
    "countryOfOrigin",
    "material",
    "packageContents",
    "sellingPrice",
    "weightKg",
    "packageLengthCm",
    "packageWidthCm",
    "packageHeightCm",
    "description",
    "imageRightsConfirmed",
    "productFactsConfirmed",
  ]) assert.equal(paths.has(field), true, `${field} must remain a structured schema issue`);
  assert.equal(paths.has("stock"), false, "sold-out stock remains valid in the edit schema");
});

test("product margin edit warnings use listing channels and disclose unavailable baselines", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const detailStart = page.indexOf("function ProductDetailPage");
  const detailEnd = page.indexOf("type UploadedPhoto", detailStart);
  const detailPage = page.slice(detailStart, detailEnd);
  const dialogStart = page.indexOf("function ProductDetailEditDialog");
  const dialog = page.slice(dialogStart, detailStart);

  assert.match(detailPage, /productMarginListingChannelKeys\(\{/);
  assert.match(detailPage, /remoteListings\.map\(\(listing\) => listing\.channel\)/);
  assert.match(detailPage, /commerceOperations\.listings\.map\(\(listing\) => listing\.channel\)/);
  assert.match(detailPage, /listingChannelCodes: product\.channels/);
  assert.match(detailPage, /edits: detailChannelKeys\.map\(\(channelKey\)/);
  assert.doesNotMatch(detailPage, /const channelKeys = \[\.\.\.new Set\(productMarginData\.scenarios/);
  assert.match(dialog, /unavailableMarginEvaluations\.map/);
  assert.match(dialog, /수수료·이익을 임의로 채우지 않았습니다/);
  assert.match(dialog, /productMarginUnavailableReasonMessage\(evaluation\.reason\)/);
});
