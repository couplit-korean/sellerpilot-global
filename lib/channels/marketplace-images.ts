import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { ActiveChannelKey } from "./catalog";

const marketplaceImageBucket = "sellerpilot-marketplace";
const inputMimeTypes = ["image/jpeg", "image/png", "image/webp"];
const maxInputBytes = 10 * 1024 * 1024;
const maxOutputBytes = 3 * 1024 * 1024;
const outputSize = 1200;

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1"
    || normalized === "0.0.0.0"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
  ) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) !== 4) return false;
  const parts = normalized.split(".").map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] >= 224;
}

async function assertPublicImageUrl(sourceUrl: string) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error("MARKETPLACE_IMAGE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("MARKETPLACE_IMAGE_URL_INVALID");
  }
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("MARKETPLACE_IMAGE_URL_PRIVATE");
  }
  return url;
}

async function ensureMarketplaceImageBucket(serviceClient: SupabaseClient) {
  const { data: bucket } = await serviceClient.storage.getBucket(marketplaceImageBucket);
  const options = { public: true, allowedMimeTypes: ["image/jpeg"], fileSizeLimit: "3MB" };
  if (!bucket) {
    const { error } = await serviceClient.storage.createBucket(marketplaceImageBucket, options);
    if (error) {
      const { data: racedBucket } = await serviceClient.storage.getBucket(marketplaceImageBucket);
      if (!racedBucket) throw new Error("MARKETPLACE_IMAGE_BUCKET_CREATE_FAILED");
      const { error: updateError } = await serviceClient.storage.updateBucket(marketplaceImageBucket, options);
      if (updateError) throw new Error("MARKETPLACE_IMAGE_BUCKET_UPDATE_FAILED");
    }
    return;
  }
  if (!bucket.public || bucket.file_size_limit !== maxOutputBytes) {
    const { error } = await serviceClient.storage.updateBucket(marketplaceImageBucket, options);
    if (error) throw new Error("MARKETPLACE_IMAGE_BUCKET_UPDATE_FAILED");
  }
}

async function downloadImage(sourceUrl: string) {
  const url = await assertPublicImageUrl(sourceUrl);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
  if (!response.ok || !inputMimeTypes.includes(contentType)) throw new Error("MARKETPLACE_IMAGE_DOWNLOAD_FAILED");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxInputBytes) throw new Error("MARKETPLACE_IMAGE_SIZE_INVALID");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxInputBytes) throw new Error("MARKETPLACE_IMAGE_SIZE_INVALID");
  return bytes;
}

async function normalizedJpeg(source: Buffer) {
  const inputMetadata = await sharp(source, { failOn: "warning", limitInputPixels: 64_000_000 }).metadata();
  if (!inputMetadata.width || !inputMetadata.height) throw new Error("MARKETPLACE_IMAGE_DIMENSIONS_INVALID");
  let output: Uint8Array = new Uint8Array();
  for (const quality of [90, 84, 76, 68]) {
    output = await sharp(source, { failOn: "warning", limitInputPixels: 64_000_000 })
      .rotate()
      .resize(outputSize, outputSize, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, progressive: true, mozjpeg: true })
      .toBuffer();
    if (output.length <= maxOutputBytes) break;
  }
  if (!output.length || output.length > maxOutputBytes) throw new Error("MARKETPLACE_IMAGE_SIZE_INVALID");
  const outputMetadata = await sharp(output).metadata();
  if (outputMetadata.width !== outputSize || outputMetadata.height !== outputSize || outputMetadata.format !== "jpeg") {
    throw new Error("MARKETPLACE_IMAGE_NORMALIZATION_FAILED");
  }
  return Buffer.from(output);
}

async function publishNormalizedImage(serviceClient: SupabaseClient, sourceUrl: string) {
  const normalized = await normalizedJpeg(await downloadImage(sourceUrl));
  await ensureMarketplaceImageBucket(serviceClient);
  const digest = createHash("sha256").update(normalized).digest("hex");
  const objectPath = `normalized/${digest.slice(0, 2)}/${digest}.jpg`;
  const { error: uploadError } = await serviceClient.storage
    .from(marketplaceImageBucket)
    .upload(objectPath, normalized, { cacheControl: "31536000", contentType: "image/jpeg", upsert: true });
  if (uploadError) throw new Error("MARKETPLACE_IMAGE_UPLOAD_FAILED");
  const { data } = serviceClient.storage.from(marketplaceImageBucket).getPublicUrl(objectPath);
  if (!data.publicUrl || data.publicUrl.length > 500) throw new Error("MARKETPLACE_IMAGE_PUBLIC_URL_INVALID");
  const verify = await fetch(data.publicUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  await verify.body?.cancel();
  if (!verify.ok || !(verify.headers.get("content-type") ?? "").toLowerCase().startsWith("image/jpeg")) {
    throw new Error("MARKETPLACE_IMAGE_READBACK_FAILED");
  }
  return data.publicUrl;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export async function prepareMarketplaceImages(serviceClient: SupabaseClient, channel: ActiveChannelKey, argumentsValue: Record<string, unknown>) {
  const next = structuredClone(argumentsValue);
  const normalizedBySource = new Map<string, string>();
  const normalize = async (sourceUrl: string) => {
    const cached = normalizedBySource.get(sourceUrl);
    if (cached) return cached;
    const outputUrl = await publishNormalizedImage(serviceClient, sourceUrl);
    normalizedBySource.set(sourceUrl, outputUrl);
    return outputUrl;
  };
  const normalizeList = async (value: unknown, limit: number) => {
    const unique = [...new Set(strings(value))].slice(0, limit);
    if (!unique.length) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    return Promise.all(unique.map(normalize));
  };

  if (channel === "qoo10") {
    const params = record(next.params);
    const sourceUrl = typeof params?.StandardImage === "string" ? params.StandardImage.trim() : "";
    if (!params || !sourceUrl) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    params.StandardImage = await normalize(sourceUrl);
    return next;
  }

  if (channel === "shopee" || channel === "lazada" || channel === "smartstore") {
    next.imageUrls = await normalizeList(next.imageUrls, channel === "smartstore" ? 10 : channel === "shopee" ? 9 : 8);
    return next;
  }

  if (channel === "coupang") {
    const body = record(next.body);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    let count = 0;
    for (const itemValue of items) {
      const item = record(itemValue);
      const images = Array.isArray(item?.images) ? item.images : [];
      for (const imageValue of images) {
        const image = record(imageValue);
        const sourceUrl = typeof image?.vendorPath === "string" ? image.vendorPath.trim() : "";
        if (!image || !sourceUrl) continue;
        image.vendorPath = await normalize(sourceUrl);
        count += 1;
      }
    }
    if (!count) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    return next;
  }

  if (channel === "temu") {
    const body = record(next.body);
    const goodsBasic = record(body?.goodsBasic);
    if (!body || !goodsBasic) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    const normalized = await normalizeList(goodsBasic.goodsCarouselImage, 10);
    goodsBasic.goodsCarouselImage = normalized;
    goodsBasic.detailImage = normalized;
    const skuList = Array.isArray(body.skuList) ? body.skuList : [];
    for (const skuValue of skuList) {
      const sku = record(skuValue);
      if (sku) sku.images = normalized;
    }
    return next;
  }

  const inventoryItem = record(next.inventoryItem);
  const product = record(inventoryItem?.product);
  if (!product) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
  product.imageUrls = await normalizeList(product.imageUrls, 12);
  return next;
}
