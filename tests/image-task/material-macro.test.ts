import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { aiGeneratedAssetSpecs } from "../../lib/ai-generated-assets";
import { renderIdentityMaterialMacro, renderIdentitySingleContents, renderIdentityOnNeutralCanvas, selectCanonicalWholeProductIdentityView } from "../../lib/product-identity-protection";
import { buildServerImageAuditReference, buildServerSourceDerivedAsset, resolveServerAssetSource } from "../../lib/server-product-studio";
import { planStudioSourceAssignments } from "../../lib/studio-source-planning";

import { hasConfirmedSinglePackageContents } from "../../lib/first-draft-images";

const material = aiGeneratedAssetSpecs.find(asset => asset.id === "detail-material")!;
const feature = aiGeneratedAssetSpecs.find(asset => asset.id === "detail-feature")!;

async function exteriorFixture() {
  const width = 600, height = 800;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    raw[i] = x % 251; raw[i + 1] = y % 241; raw[i + 2] = (x + y) % 239; raw[i + 3] = 255;
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

test("material macros preserve an exact visible source region and use four distinct bounded crops", async () => {
  const source = await exteriorFixture();
  const spec = { ...material, width: 264, height: 264 };
  const crops = new Set<string>();
  for (let variant = 1; variant <= 4; variant++) {
    const macro = await renderIdentityMaterialMacro(source, spec, variant);
    assert.equal(macro.availablePlans, 4);
    assert.equal(macro.sourceCrop.width, 264);
    assert.equal(macro.sourceCrop.height, 264);
    assert.ok(macro.sourceCrop.left >= 0 && macro.sourceCrop.top >= 0);
    assert.ok(macro.sourceCrop.left + macro.sourceCrop.width <= 600);
    assert.ok(macro.sourceCrop.top + macro.sourceCrop.height <= 800);
    crops.add(JSON.stringify(macro.sourceCrop));
    const [actual, selectedSourcePixels] = await Promise.all([
      sharp(macro.bytes).raw().toBuffer(),
      sharp(source).extract(macro.sourceCrop).raw().toBuffer(),
    ]);
    assert.deepEqual(actual, selectedSourcePixels, "the macro adds no background, texture or hidden geometry");
  }
  assert.equal(crops.size, 4);
  await assert.rejects(renderIdentityMaterialMacro(source, material, 5), /시도 번호/);
  await assert.rejects(renderIdentityMaterialMacro(source, feature, 1), /원본 역할/);
  const empty = await sharp({ create: { width: 600, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await assert.rejects(renderIdentityMaterialMacro(empty, material, 1), /다른 검증 외부 표면/);
});

test("Mac macro, Vercel output and Vercel mandatory audit reference share the same source crop", async () => {
  const bytes = await exteriorFixture();
  const source = { path: "verified-source", role: "main", name: "source.png", mediaType: "image/png", bytes };
  const macro = await renderIdentityMaterialMacro(bytes, material, 2);
  const [server, reference] = await Promise.all([
    buildServerSourceDerivedAsset(material, source, bytes, 2),
    buildServerImageAuditReference(material, source, 2),
  ]);
  assert.deepEqual(server, macro.bytes);
  assert.deepEqual(Buffer.from(reference.bytes), macro.bytes);
});

test("readable label, barcode and rear evidence precede the front fallback in feature planning", () => {
  const source = (role: string) => ({ path: role, role, name: role, mediaType: "image/png", bytes: new Uint8Array() });
  const main = source("main"), barcode = source("barcode"), back = source("back"), label = source("label");
  assert.equal(resolveServerAssetSource(feature, [main, back, barcode]).source.path, "barcode");
  assert.equal(planStudioSourceAssignments([main, back, barcode]).get("detail-feature")?.path, "barcode");
  assert.equal(planStudioSourceAssignments([main, barcode, label]).get("detail-feature")?.path, "label");
  assert.equal(planStudioSourceAssignments([main, back]).get("detail-feature")?.path, "back");
  assert.equal(planStudioSourceAssignments([main]).get("detail-feature")?.path, "main");
  const unverifiedBarcode = { ...barcode, observation: { role: "barcode" as const, confidence: 0.99, sameProduct: "uncertain" as const, wholeProduct: false, readableText: "", facts: [], warnings: [] } };
  assert.equal(planStudioSourceAssignments([main, unverifiedBarcode]).get("detail-feature")?.path, "main");
});


test("whole-product contents requires explicit reviewed single-unit configuration, never bundles or inferred quantities", () => {
  for (const packageContents of ["1개", "1병", "단품", "본품 1개 구성"]) {
    assert.equal(hasConfirmedSinglePackageContents({ productFactsConfirmed: true, packageContents }), true);
    assert.equal(hasConfirmedSinglePackageContents({ productFactsConfirmed: false, packageContents }), false);
  }
  for (const packageContents of ["", "미확인", "500ml", "500ml 1병", "1+1", "1박스 12병", "1개 + 뚜껑", "2병", "1세트", "나랑드사이다 제로 500 ml"]) {
    assert.equal(hasConfirmedSinglePackageContents({ productFactsConfirmed: true, packageContents }), false, packageContents);
  }
});

test("single-unit contents still requires the exact verified complete single-instance canonical view", () => {
  const contents = aiGeneratedAssetSpecs.find(asset => asset.id === "detail-contents")!;
  const canonicalWhole = {
    foreground: { buffer: Buffer.alloc(0), width: 300, height: 600, sourceDigest: "a".repeat(64), retainedPixelRatio: 0.4 },
    report: { inputIndex: 0, inputRole: "main", method: "single-instance" as const, instanceCount: 1,
      boundingCoverage: 0.95, score: 20, textCount: 5, identityMatches: 3, productTokenCount: 2,
      productNameMatches: 2, brandMatches: 1, manufacturerMatches: 0, gtinExpected: true,
      gtinMatch: false, evidenceSignals: 2, retainedRatio: 0.4 },
  };
  const cutouts = { canonicalWhole, front: canonicalWhole, canonicalCompletenessProof: "subject-full-instance" as const, statutoryIdentity: true };
  assert.strictEqual(selectCanonicalWholeProductIdentityView(cutouts, contents, true), canonicalWhole);
  assert.throws(() => selectCanonicalWholeProductIdentityView(cutouts, contents), /전체 상품 원본/);
  for (const change of [{ instanceCount: 2 }, { method: "rectangle" as const }, { inputIndex: 1 }, { inputRole: "barcode" }]) {
    assert.throws(() => selectCanonicalWholeProductIdentityView({ ...cutouts, canonicalWhole: { ...canonicalWhole, report: { ...canonicalWhole.report, ...change } } }, contents, true), /canonical/);
  }
  assert.equal(contents.identityPolicy.requiresDedicatedRole, true);
});

test("server contents plan reserves a reviewed whole main only for a confirmed single unit", () => {
  const main = { path: "main", role: "main", name: "main", mediaType: "image/png", bytes: new Uint8Array(),
    observation: { role: "front" as const, confidence: 0.99, sameProduct: "yes" as const, wholeProduct: true, readableText: "", facts: [], warnings: [] } };
  const back = { ...main, path: "back", role: "back", observation: { ...main.observation, role: "back" as const } };
  assert.equal(planStudioSourceAssignments([main, back], aiGeneratedAssetSpecs.filter(asset => asset.id === "detail-contents"), true).get("detail-contents")?.path, "main");
  assert.equal(planStudioSourceAssignments([main, back], aiGeneratedAssetSpecs.filter(asset => asset.id === "detail-contents"), false).get("detail-contents")?.path, "back");
  assert.equal(planStudioSourceAssignments([{ ...main, observation: { ...main.observation, wholeProduct: false } }, back], aiGeneratedAssetSpecs.filter(asset => asset.id === "detail-contents"), true).get("detail-contents")?.path, "back");
});


test("single contents uses the shared whole-item panel without cropping, duplication or decorative raster content", async () => {
  const contents = aiGeneratedAssetSpecs.find(asset => asset.id === "detail-contents")!;
  const buffer = await exteriorFixture();
  const actual = await renderIdentitySingleContents({ buffer }, contents);
  const expected = await renderIdentityOnNeutralCanvas({ buffer }, { ...contents, identityPolicy: {
    ...contents.identityPolicy, fit: "inside", placement: { left: 0.38, top: 0.20, width: 0.54, height: 0.66 },
  } });
  assert.deepEqual(actual, expected);
  await assert.rejects(renderIdentitySingleContents({ buffer }, feature), /원본 역할/);
});


test("server material plans only segmentable whole exterior views while feature retains label evidence", () => {
  const observation = { role: "front" as const, confidence: 0.99, sameProduct: "yes" as const, wholeProduct: true, readableText: "", facts: [], warnings: [] };
  const main = { path: "main", role: "main", name: "main", mediaType: "image/png", bytes: new Uint8Array(), observation };
  const label = { ...main, path: "label", role: "label", observation: { ...observation, role: "label" as const, wholeProduct: false } };
  const plan = planStudioSourceAssignments([main, label]);
  assert.equal(plan.get("detail-material")?.path, "main");
  assert.equal(plan.get("detail-feature")?.path, "label");
  assert.throws(() => planStudioSourceAssignments([label], [material]), /source_view_not_compositable/);
});
