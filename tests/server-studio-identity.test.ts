import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { sourcePhotoCatalogRenderRejectedReason } from "../lib/server-studio-fail-closed";
import {
  compositeServerStudioSettingShot,
  loadServerStudioIdentityForeground,
  renderServerStudioCatalogAsset,
  renderServerStudioEvidenceAsset,
  serverStudioIdentitySpec,
} from "../lib/server-studio-identity";
import { buildPortableProductCutout, buildServerSourceDerivedAsset } from "../lib/server-product-studio";
import { repairMissingIdentitySupportSurface } from "../lib/product-identity-protection";
import type { ServerStudioSource } from "../lib/server-product-studio";

async function redCutout() {
  const source = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  }).composite([{
    input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="307" y="307" width="410" height="410" fill="#f00"/></svg>'),
  }]).png().toBuffer();
  const points = [
    [0.30, 0.30], [0.40, 0.30], [0.50, 0.30], [0.60, 0.30],
    [0.70, 0.30], [0.70, 0.50], [0.70, 0.70], [0.60, 0.70],
    [0.50, 0.70], [0.40, 0.70], [0.30, 0.70], [0.30, 0.50],
  ].map(([x, y]) => ({ x, y }));
  return buildPortableProductCutout({
    segmentation: {
      containsSingleProduct: true,
      touchesFrame: false,
      foregroundConfidence: 0.99,
      edgeConfidence: 0.98,
      polygons: [{ points }],
    },
    segmentationSource: source,
  });
}

test("server identity foreground loads from in-memory cutout bytes, not a filesystem path", async () => {
  const cutout = await redCutout();
  const foreground = await loadServerStudioIdentityForeground(cutout);
  assert.match(foreground.sourceDigest, /^[a-f0-9]{64}$/u);
  assert.ok(foreground.width >= 120 && foreground.height >= 120);
  const centre = await sharp(foreground.buffer).extract({
    left: Math.floor(foreground.width / 2),
    top: Math.floor(foreground.height / 2),
    width: 1,
    height: 1,
  }).raw().toBuffer();
  assert.ok(centre[0] > 240 && centre[1] < 16 && centre[2] < 16);
});

test("setting-shot compositor keeps source product pixels and rejects gray mosaic as a final render", async () => {
  const cutout = await redCutout();
  const storage = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-storage");
  assert.ok(storage);
  const plate = await repairMissingIdentitySupportSurface(
    await sharp({
      create: { width: storage.width, height: storage.height, channels: 3, background: "#ece8df" },
    }).png().toBuffer(),
    serverStudioIdentitySpec(storage),
  );
  const composed = await compositeServerStudioSettingShot({
    background: plate,
    cutout,
    asset: storage,
    contactMode: "surface-supported",
    attempt: 4,
  });
  const placement = storage.identityPolicy.placement;
  const sampleX = Math.min(storage.width - 1, Math.round(storage.width * (placement.left + placement.width / 2)));
  const sampleY = Math.min(storage.height - 1, Math.round(storage.height * (placement.top + placement.height - 0.08)));
  const pixel = await sharp(composed.bytes).extract({
    left: sampleX,
    top: sampleY,
    width: 1,
    height: 1,
  }).raw().toBuffer();
  assert.ok(pixel[0] > 180, "composited setting shot must keep source product red pixels");

  const source: ServerStudioSource = {
    path: "main",
    role: "main",
    name: "main.png",
    mediaType: "image/png",
    bytes: cutout,
  };
  await assert.rejects(
    buildServerSourceDerivedAsset(storage, source, cutout, 1, "source-photo-catalog"),
    new RegExp(sourcePhotoCatalogRenderRejectedReason(), "u"),
  );
});

test("catalog and evidence adapters reuse identity renderers without inventing label pixels", async () => {
  const cutout = await redCutout();
  const hero = aiGeneratedAssetSpecs.find((asset) => asset.id === "hero");
  const feature = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-feature");
  assert.ok(hero && feature);
  const catalog = await renderServerStudioCatalogAsset(hero, cutout);
  const evidence = await renderServerStudioEvidenceAsset(feature, cutout, 2);
  assert.notEqual(
    createHash("sha256").update(catalog).digest("hex"),
    createHash("sha256").update(evidence).digest("hex"),
  );
  const catalogMeta = await sharp(catalog).metadata();
  const evidenceMeta = await sharp(evidence).metadata();
  assert.equal(catalogMeta.format, "png");
  assert.equal(evidenceMeta.format, "png");
  assert.equal(catalogMeta.width, hero.width);
  assert.equal(evidenceMeta.width, feature.width);
});
