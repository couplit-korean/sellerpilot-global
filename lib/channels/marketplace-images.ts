import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { aiDetailAssetIds } from "../ai-generated-assets";
import type { ActiveChannelKey } from "./catalog";
import {
  marketplaceChannelDetailImageCount,
  marketplaceLocalizedDetailSectionTypes,
} from "./marketplace-image-contract";
import { qoo10RollbackUpdateRecoveryBinding } from "./listing-update";

const marketplaceImageBucket = "sellerpilot-marketplace";
const inputMimeTypes = ["image/jpeg", "image/png", "image/webp"];
const maxInputBytes = 10 * 1024 * 1024;
const maxOutputBytes = 3 * 1024 * 1024;
const outputSize = 1200;
const detailMaxDimension = 1600;
const marketplaceUploadConcurrency = 4;
const marketplaceImageDownloadTimeoutMs = 20_000;
const marketplaceImageMaximumAddresses = 4;

export type MarketplaceImageNormalizationMode = "gallery-square" | "detail-ratio";

export type MarketplaceImageLifecycleReference = {
  attemptId: string;
  productId: string;
  market: string;
  targetId: string;
};

export type PreparedMarketplaceNormalizedAsset = {
  objectPath: string;
  bytes: Buffer;
  publicUrl: string;
  sourceObjectPath?: string;
  sourceSha256?: string;
};

export const listingPublicationAssetBindingContract =
  "sellerpilot_publication_asset_binding_v1" as const;

function normalizedMarketplaceAssetIdentity(url: string) {
  let pathname = "";
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const match = pathname.match(/(?:^|\/)(normalized\/([0-9a-f]{2})\/([0-9a-f]{64})\.jpg)$/u);
  if (!match || match[2] !== match[3].slice(0, 2)) return null;
  return { publicUrl: url, objectPath: match[1], contentSha256: match[3] };
}

export function buildListingPublicationAssetBinding(input: {
  approvedDetailPageVersion: number;
  approvedManifestDigest: string;
  approvedDetailRoles: string[];
  approvedDetailImagePaths: string[];
  approvedDetailImageSha256s: string[];
  approvedDetailImageUrls: string[];
  providerImageSurface: "detail_content" | "gallery" | "buyer_visible";
  providerTransportRoles: string[];
  providerTransportUrls: string[];
}) {
  const detailIdentities = input.approvedDetailImageUrls.map(normalizedMarketplaceAssetIdentity);
  const transportIdentities = input.providerTransportUrls.map(normalizedMarketplaceAssetIdentity);
  const valid = /^[a-f0-9]{64}$/u.test(input.approvedManifestDigest)
    && Number.isSafeInteger(input.approvedDetailPageVersion)
    && input.approvedDetailPageVersion > 0
    && input.approvedDetailRoles.length === marketplaceChannelDetailImageCount
    && new Set(input.approvedDetailRoles).size === marketplaceChannelDetailImageCount
    && input.approvedDetailImagePaths.length === marketplaceChannelDetailImageCount
    && new Set(input.approvedDetailImagePaths).size === marketplaceChannelDetailImageCount
    && input.approvedDetailImageSha256s.length === marketplaceChannelDetailImageCount
    && input.approvedDetailImageSha256s.every((digest) => /^[a-f0-9]{64}$/u.test(digest))
    && new Set(input.approvedDetailImageSha256s).size === marketplaceChannelDetailImageCount
    && detailIdentities.length === marketplaceChannelDetailImageCount
    && detailIdentities.every(Boolean)
    && new Set(detailIdentities.map((identity) => identity?.objectPath)).size === marketplaceChannelDetailImageCount
    && input.providerTransportRoles.length === marketplaceChannelDetailImageCount
    && new Set(input.providerTransportRoles).size === marketplaceChannelDetailImageCount
    && transportIdentities.length === marketplaceChannelDetailImageCount
    && transportIdentities.every(Boolean)
    && new Set(transportIdentities.map((identity) => identity?.objectPath)).size === marketplaceChannelDetailImageCount
    && (input.providerImageSurface === "detail_content" || input.providerImageSurface === "buyer_visible"
      ? input.providerTransportRoles.every((role, index) => role === input.approvedDetailRoles[index])
        && input.providerTransportUrls.every((url, index) => url === input.approvedDetailImageUrls[index])
      : input.providerTransportRoles[0] === "gallery-representative"
        && input.providerTransportRoles.slice(1).every((role, index) => role === input.approvedDetailRoles[index])
        && input.providerTransportUrls.slice(1).every((url, index) => url === input.approvedDetailImageUrls[index]));
  if (!valid) return null;
  return {
    contract: listingPublicationAssetBindingContract,
    approvedDetailPageVersion: input.approvedDetailPageVersion,
    approvedManifestDigest: input.approvedManifestDigest,
    approvedDetailImages: input.approvedDetailRoles.map((role, index) => ({
      role,
      approvedObjectPath: input.approvedDetailImagePaths[index],
      approvedSourceSha256: input.approvedDetailImageSha256s[index],
      ...detailIdentities[index]!,
    })),
    providerImageSurface: input.providerImageSurface,
    providerTransportImages: input.providerTransportRoles.map((role, index) => ({
      role,
      ...transportIdentities[index]!,
    })),
  };
}

function embeddedIpv4Address(address: string) {
  let normalized = address.toLowerCase().split("%", 1)[0];
  if (!normalized.includes(":")) return null;

  const dottedTail = normalized.slice(normalized.lastIndexOf(":") + 1);
  if (dottedTail.includes(".")) {
    const octets = dottedTail.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return null;
    }
    normalized = `${normalized.slice(0, normalized.lastIndexOf(":") + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const textGroups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (textGroups.length !== 8 || textGroups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const groups = textGroups.map((group) => Number.parseInt(group, 16));

  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const ipv4Compatible = groups.slice(0, 6).every((group) => group === 0);
  const wellKnownNat64 = groups[0] === 0x64
    && groups[1] === 0xff9b
    && groups.slice(2, 6).every((group) => group === 0);
  if (!ipv4Mapped && !ipv4Compatible && !wellKnownNat64) return null;

  const value = groups[6] * 65_536 + groups[7];
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

export function isPrivateMarketplaceAddress(address: string) {
  const normalized = address.toLowerCase();
  const embeddedIpv4 = embeddedIpv4Address(normalized);
  if (embeddedIpv4) return isPrivateMarketplaceAddress(embeddedIpv4);
  if (
    normalized === "::"
    || normalized === "::1"
    || normalized === "0.0.0.0"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("ff")
  ) return true;
  if (isIP(normalized) !== 4) return false;
  const parts = normalized.split(".").map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    || parts[0] >= 224;
}

type MarketplaceDnsResolver = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export async function resolveMarketplaceImageAddresses(
  hostname: string,
  ownerSignal?: AbortSignal,
  resolver: MarketplaceDnsResolver = lookup,
) {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
  ownerSignal?.throwIfAborted();
  const resolution = resolver(hostname, { all: true });
  if (!ownerSignal) return resolution;
  return new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, records?: Array<{ address: string; family: number }>) => {
      if (settled) return;
      settled = true;
      ownerSignal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(records ?? []);
    };
    const onAbort = () => finish(ownerSignal.reason ?? new Error("MARKETPLACE_IMAGE_DOWNLOAD_ABORTED"));
    ownerSignal.addEventListener("abort", onAbort, { once: true });
    resolution.then((records) => finish(null, records), (error) => finish(error));
  });
}

async function assertPublicImageUrl(
  sourceUrl: string,
  ownerSignal?: AbortSignal,
  resolver: MarketplaceDnsResolver = lookup,
) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error("MARKETPLACE_IMAGE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("MARKETPLACE_IMAGE_URL_INVALID");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const records = await resolveMarketplaceImageAddresses(hostname, ownerSignal, resolver);
  if (!records.length || records.some((record) => isPrivateMarketplaceAddress(record.address))) {
    throw new Error("MARKETPLACE_IMAGE_URL_PRIVATE");
  }
  const addresses = [...new Map(
    records.map((record) => [`${record.family}:${record.address}`, record]),
  ).values()].slice(0, marketplaceImageMaximumAddresses);
  return { url, hostname, addresses };
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

export async function collectBoundedMarketplaceImage(
  source: AsyncIterable<Uint8Array>,
  maximumBytes = maxInputBytes,
) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maximumBytes) throw new Error("MARKETPLACE_IMAGE_SIZE_INVALID");
    chunks.push(bytes);
  }
  if (!total) throw new Error("MARKETPLACE_IMAGE_SIZE_INVALID");
  return Buffer.concat(chunks, total);
}

type MarketplaceImageDownloadTarget = {
  url: URL;
  hostname: string;
  address: string;
  family: number;
};

type MarketplaceImageAddressRequester = (
  target: MarketplaceImageDownloadTarget,
  ownerSignal: AbortSignal | undefined,
  timeoutMs: number,
) => Promise<{ bytes: Buffer; contentType: string }>;

async function downloadMarketplaceImageFromAddress(
  target: MarketplaceImageDownloadTarget,
  ownerSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  ownerSignal?.throwIfAborted();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = ownerSignal
    ? AbortSignal.any([ownerSignal, timeoutSignal])
    : timeoutSignal;
  return new Promise<{ bytes: Buffer; contentType: string }>((resolveDownload, rejectDownload) => {
    let settled = false;
    const finish = (error: Error | null, result?: { bytes: Buffer; contentType: string }) => {
      if (settled) return;
      settled = true;
      if (error) rejectDownload(error);
      else resolveDownload(result!);
    };
    const request = httpsRequest({
      protocol: "https:",
      hostname: target.address,
      family: target.family,
      port: 443,
      method: "GET",
      path: `${target.url.pathname}${target.url.search}`,
      headers: {
        accept: inputMimeTypes.join(","),
        "accept-encoding": "identity",
        host: target.url.host,
        "user-agent": "SellerPilot-Marketplace-Image/1.0",
      },
      agent: false,
      servername: isIP(target.hostname) ? undefined : target.hostname,
      signal: requestSignal,
    }, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers["content-type"] ?? "").split(";", 1)[0].toLowerCase();
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (status < 200 || status >= 300 || !inputMimeTypes.includes(contentType)) {
        response.destroy();
        finish(new Error("MARKETPLACE_IMAGE_DOWNLOAD_FAILED"));
        return;
      }
      if (Number.isFinite(declaredLength) && declaredLength > maxInputBytes) {
        response.destroy();
        finish(new Error("MARKETPLACE_IMAGE_SIZE_INVALID"));
        return;
      }
      void collectBoundedMarketplaceImage(response)
        .then((bytes) => finish(null, { bytes, contentType }))
        .catch((error) => {
          response.destroy();
          finish(error instanceof Error ? error : new Error("MARKETPLACE_IMAGE_DOWNLOAD_FAILED"));
        });
    });
    request.once("error", (error) => finish(error instanceof Error ? error : new Error("MARKETPLACE_IMAGE_DOWNLOAD_FAILED")));
    request.end();
  });
}

export async function downloadMarketplaceImage(
  sourceUrl: string,
  ownerSignal?: AbortSignal,
  resolver: MarketplaceDnsResolver = lookup,
  requester: MarketplaceImageAddressRequester = downloadMarketplaceImageFromAddress,
) {
  ownerSignal?.throwIfAborted();
  const target = await assertPublicImageUrl(sourceUrl, ownerSignal, resolver);
  ownerSignal?.throwIfAborted();
  const timeoutPerAddress = Math.max(
    5_000,
    Math.floor(marketplaceImageDownloadTimeoutMs / target.addresses.length),
  );
  let lastError: Error | null = null;
  for (const record of target.addresses) {
    try {
      return await requester({
        url: target.url,
        hostname: target.hostname,
        address: record.address,
        family: record.family,
      }, ownerSignal, timeoutPerAddress);
    } catch (error) {
      ownerSignal?.throwIfAborted();
      const normalized = error instanceof Error
        ? error
        : new Error("MARKETPLACE_IMAGE_DOWNLOAD_FAILED");
      if (normalized.message === "MARKETPLACE_IMAGE_SIZE_INVALID") throw normalized;
      lastError = normalized;
    }
  }
  throw lastError ?? new Error("MARKETPLACE_IMAGE_DOWNLOAD_FAILED");
}

async function downloadImage(sourceUrl: string) {
  return (await downloadMarketplaceImage(sourceUrl)).bytes;
}

export async function normalizeMarketplaceImageBytes(source: Buffer, mode: MarketplaceImageNormalizationMode) {
  const inputMetadata = await sharp(source, { failOn: "warning", limitInputPixels: 64_000_000 }).metadata();
  if (!inputMetadata.width || !inputMetadata.height) throw new Error("MARKETPLACE_IMAGE_DIMENSIONS_INVALID");
  let output: Uint8Array = new Uint8Array();
  for (const quality of [90, 84, 76, 68]) {
    const pipeline = sharp(source, { failOn: "warning", limitInputPixels: 64_000_000 }).rotate();
    output = await (mode === "gallery-square"
      ? pipeline.resize(outputSize, outputSize, { fit: "contain", background: "#ffffff" })
      : pipeline.resize({ width: detailMaxDimension, height: detailMaxDimension, fit: "inside", withoutEnlargement: true }))
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, progressive: true, mozjpeg: true })
      .toBuffer();
    if (output.length <= maxOutputBytes) break;
  }
  if (!output.length || output.length > maxOutputBytes) throw new Error("MARKETPLACE_IMAGE_SIZE_INVALID");
  const outputMetadata = await sharp(output).metadata();
  const galleryInvalid = mode === "gallery-square" && (outputMetadata.width !== outputSize || outputMetadata.height !== outputSize);
  const detailInvalid = mode === "detail-ratio" && (
    !outputMetadata.width
    || !outputMetadata.height
    || outputMetadata.width > detailMaxDimension
    || outputMetadata.height > detailMaxDimension
  );
  if (galleryInvalid || detailInvalid || outputMetadata.format !== "jpeg") {
    throw new Error("MARKETPLACE_IMAGE_NORMALIZATION_FAILED");
  }
  return Buffer.from(output);
}

async function prepareNormalizedImage(
  serviceClient: SupabaseClient,
  sourceUrl: string,
  mode: MarketplaceImageNormalizationMode,
  sourceObjectPath?: string,
  expectedSourceSha256?: string,
) {
  const source = await downloadImage(sourceUrl);
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  if (expectedSourceSha256 && sourceSha256 !== expectedSourceSha256) {
    throw new Error("MARKETPLACE_APPROVED_SOURCE_DIGEST_MISMATCH");
  }
  const normalized = await normalizeMarketplaceImageBytes(source, mode);
  const digest = createHash("sha256").update(normalized).digest("hex");
  const objectPath = `normalized/${digest.slice(0, 2)}/${digest}.jpg`;
  const { data } = serviceClient.storage.from(marketplaceImageBucket).getPublicUrl(objectPath);
  if (!data.publicUrl || data.publicUrl.length > 500) throw new Error("MARKETPLACE_IMAGE_PUBLIC_URL_INVALID");
  return {
    objectPath,
    bytes: normalized,
    publicUrl: data.publicUrl,
    ...(sourceObjectPath ? { sourceObjectPath } : {}),
    ...(expectedSourceSha256 ? { sourceSha256 } : {}),
  } satisfies PreparedMarketplaceNormalizedAsset;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await task(item);
    }
  });
  await Promise.all(workers);
}

export async function persistMarketplaceNormalizedAssets(
  serviceClient: SupabaseClient,
  channel: ActiveChannelKey,
  lifecycle: MarketplaceImageLifecycleReference,
  assets: PreparedMarketplaceNormalizedAsset[],
) {
  const uniqueAssets = [...new Map(assets.map((asset) => [asset.objectPath, asset])).values()];
  if (!uniqueAssets.length) return;
  if (uniqueAssets.length > 32
      || !lifecycle.attemptId
      || !lifecycle.productId
      || uniqueAssets.some((asset) => !/^normalized\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/.test(asset.objectPath))) {
    throw new Error("MARKETPLACE_IMAGE_LIFECYCLE_INVALID");
  }

  const paths = uniqueAssets.map((asset) => asset.objectPath);
  const { data: registered, error: registerError } = await serviceClient.rpc(
    "sellerpilot_service_register_marketplace_normalized_asset_refs",
    {
      p_attempt_id: lifecycle.attemptId,
      p_product_id: lifecycle.productId,
      p_channel: channel,
      p_market: lifecycle.market,
      p_target_id: lifecycle.targetId,
      p_paths: paths,
    },
  );
  if (registerError || registered !== true) throw new Error("MARKETPLACE_IMAGE_REFERENCE_REGISTER_FAILED");

  await ensureMarketplaceImageBucket(serviceClient);
  await runWithConcurrency(uniqueAssets, marketplaceUploadConcurrency, async (asset) => {
    const { error: uploadError } = await serviceClient.storage
      .from(marketplaceImageBucket)
      .upload(asset.objectPath, asset.bytes, {
        cacheControl: "31536000",
        contentType: "image/jpeg",
        upsert: false,
      });
    // A content-addressed object may already exist from an earlier attempt.
    // Whether this upload succeeded or raced, only exact remote bytes can
    // authorize the durable reference below.
    void uploadError;
    const verify = await fetch(asset.publicUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    const declaredLength = Number(verify.headers.get("content-length") ?? 0);
    if (!verify.ok
        || !(verify.headers.get("content-type") ?? "").toLowerCase().startsWith("image/jpeg")
        || (Number.isFinite(declaredLength) && declaredLength > maxOutputBytes)
        || !verify.body) {
      await verify.body?.cancel();
      throw new Error("MARKETPLACE_IMAGE_READBACK_FAILED");
    }
    const remoteBytes = await collectBoundedMarketplaceImage(
      verify.body as unknown as AsyncIterable<Uint8Array>,
      maxOutputBytes,
    );
    const expectedDigest = asset.objectPath.match(/([0-9a-f]{64})\.jpg$/u)?.[1] ?? "";
    if (createHash("sha256").update(remoteBytes).digest("hex") !== expectedDigest) {
      throw new Error("MARKETPLACE_IMAGE_READBACK_DIGEST_MISMATCH");
    }
  });

  const { data: marked, error: markError } = await serviceClient.rpc(
    "sellerpilot_service_mark_marketplace_normalized_assets_uploaded",
    { p_attempt_id: lifecycle.attemptId, p_paths: paths },
  );
  if (markError || marked !== true) throw new Error("MARKETPLACE_IMAGE_UPLOAD_MARK_FAILED");

  const { data: urlsBound, error: urlBindingError } = await serviceClient.rpc(
    "sellerpilot_service_bind_marketplace_normalized_asset_urls",
    {
      p_attempt_id: lifecycle.attemptId,
      p_assets: uniqueAssets.map((asset) => ({
        objectPath: asset.objectPath,
        contentSha256: asset.objectPath.match(/([0-9a-f]{64})\.jpg$/u)?.[1] ?? "",
        publicUrl: asset.publicUrl,
        ...(asset.sourceObjectPath ? { sourceObjectPath: asset.sourceObjectPath } : {}),
        ...(asset.sourceSha256 ? { sourceSha256: asset.sourceSha256 } : {}),
      })),
    },
  );
  if (urlBindingError || urlsBound !== true) throw new Error("MARKETPLACE_IMAGE_URL_BINDING_FAILED");
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function boundedText(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.length >= minimum && text.length <= maximum;
}

function hasCompleteLocalizedDetailSections(assets: Record<string, unknown>) {
  const classification = record(assets.classification);
  const verificationStatus = String(classification?.verificationStatus ?? "");
  const healthFunctionalFood = classification?.isHealthFunctionalFood;
  if (!classification
      || !["verified", "needs-review"].includes(verificationStatus)
      || !boundedText(classification.displayName, 1, 120)
      || !boundedText(classification.evidence, 10, 500)
      || (verificationStatus === "verified" && typeof healthFunctionalFood !== "boolean")
      || (verificationStatus === "needs-review" && healthFunctionalFood !== null)) return false;
  if (!Array.isArray(assets.localizedDetailSections)
      || assets.localizedDetailSections.length !== marketplaceChannelDetailImageCount) return false;
  const sections = assets.localizedDetailSections.map(record);
  if (sections.some((section) => !section)) return false;
  const allowedImageRoles = new Set<string>(aiDetailAssetIds);
  const allowedSectionTypes = new Set<string>(marketplaceLocalizedDetailSectionTypes);
  const imageRoles = sections.map((section) => String(section?.imageAsset ?? "").trim());
  const sectionTypes = sections.map((section) => String(section?.type ?? "").trim());
  const declaredImageRoles = Array.isArray(assets.detailImageRoles)
    ? assets.detailImageRoles.map((role) => typeof role === "string" ? role.trim() : "")
    : [];
  const declaredAltTexts = Array.isArray(assets.detailImageAltTexts)
    ? assets.detailImageAltTexts
    : [];
  const sectionByImageRole = new Map(sections.map((section) => [String(section?.imageAsset ?? "").trim(), section]));
  return sections.every((section) => Boolean(section)
      && boundedText(section?.heading, 4, 100)
      && boundedText(section?.body, 60, 700)
      && boundedText(section?.buyerQuestion, 8, 180)
      && boundedText(section?.evidence, 10, 500)
      && boundedText(section?.imageAltText, 1, 180))
    && imageRoles.every((role) => allowedImageRoles.has(role))
    && sectionTypes.every((type) => allowedSectionTypes.has(type))
    && new Set(imageRoles).size === marketplaceChannelDetailImageCount
    && new Set(sectionTypes).size === marketplaceChannelDetailImageCount
    && declaredImageRoles.length === marketplaceChannelDetailImageCount
    && new Set(declaredImageRoles).size === marketplaceChannelDetailImageCount
    && declaredImageRoles.every((role) => allowedImageRoles.has(role) && sectionByImageRole.has(role))
    && declaredAltTexts.length === marketplaceChannelDetailImageCount
    && declaredAltTexts.every((altText, index) => boundedText(altText, 1, 180)
      && String(altText).trim() === String(sectionByImageRole.get(declaredImageRoles[index])?.imageAltText ?? "").trim());
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function escapedAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function detailImageTag(url: string, altText: string, qoo10 = false) {
  const safeUrl = escapedAttribute(url);
  const safeAlt = escapedAttribute(altText);
  return qoo10
    ? `<img src="${safeUrl}" alt="${safeAlt}" width="860" border="0" style="display:block;width:100%;max-width:860px;height:auto;margin:0 auto 18px" /><br />`
    : `<img src="${safeUrl}" alt="${safeAlt}" style="display:block;width:100%;height:auto;margin:0 auto 18px" />`;
}

export function renderMarketplaceDetailImages(urls: string[], altTexts: string[] = []) {
  if (!urls.length) return "";
  return `<section data-sellerpilot-detail-images="true" style="max-width:860px;margin:24px auto">${urls
    .map((url, index) => detailImageTag(url, altTexts[index] || `상품 상세 이미지 ${index + 1}`))
    .join("")}</section>`;
}

function injectMarketplaceDetailImages(value: unknown, urls: string[], altTexts: string[], roles: string[], qoo10 = false) {
  let source = typeof value === "string" ? value : "";
  const used = new Set<number>();
  roles.forEach((role, index) => {
    if (!role || !urls[index]) return;
    const token = `{{SELLERPILOT_IMAGE:${role}}}`;
    if (!source.includes(token)) return;
    source = source.replaceAll(token, detailImageTag(urls[index], altTexts[index] || `상품 상세 이미지 ${index + 1}`, qoo10));
    used.add(index);
  });
  const remainingUrls = urls.filter((_, index) => !used.has(index));
  const remainingAltTexts = altTexts.filter((_, index) => !used.has(index));
  if (!remainingUrls.length) return source;
  const images = remainingUrls.map((url, index) => detailImageTag(url, remainingAltTexts[index] || `상품 상세 이미지 ${index + 1}`, qoo10)).join("");
  return qoo10
    ? `${source}<div align="center" style="text-align:center;margin:24px auto">${images}</div>`
    : `${source}<section data-sellerpilot-detail-images="true" style="max-width:860px;margin:24px auto">${images}</section>`;
}

export function renderQoo10DetailDescription(value: unknown, urls: string[], altTexts: string[] = [], roles: string[] = []) {
  const source = (typeof value === "string" ? value : "")
    .replace(/<\/?section(?:\s[^>]*)?>/gi, (tag) => tag.startsWith("</") ? "</div>" : "<div>")
    .replace(/<dl(?:\s[^>]*)?>/gi, "<div>")
    .replace(/<\/dl>/gi, "</div>")
    .replace(/<dt(?:\s[^>]*)?>/gi, "<p><strong>")
    .replace(/<\/dt>/gi, "</strong></p>")
    .replace(/<dd(?:\s[^>]*)?>/gi, "<p>")
    .replace(/<\/dd>/gi, "</p>");
  if (!urls.length) return source;
  return injectMarketplaceDetailImages(source, urls, altTexts, roles, true);
}

export function qoo10RollbackRecoveryPreservesRepresentativeImage(
  channel: ActiveChannelKey,
  argumentsValue: Record<string, unknown>,
) {
  return channel === "qoo10" && Boolean(qoo10RollbackUpdateRecoveryBinding(argumentsValue));
}

/** Applies already-normalized Qoo10 images without authorizing the recovery. */
export function applyPreparedQoo10Images(
  argumentsValue: Record<string, unknown>,
  gallery: string[],
  details: string[],
  detailImageAltTexts: string[] = [],
  detailImageRoles: string[] = [],
) {
  const params = record(argumentsValue.params);
  if (!params) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
  if (qoo10RollbackRecoveryPreservesRepresentativeImage("qoo10", argumentsValue)) {
    delete params.StandardImage;
  } else {
    const sourceUrl = gallery[0]
      ?? (typeof params.StandardImage === "string" ? params.StandardImage.trim() : "");
    if (!sourceUrl) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    params.StandardImage = sourceUrl;
  }
  params.ItemDescription = renderQoo10DetailDescription(
    params.ItemDescription,
    details,
    detailImageAltTexts,
    detailImageRoles,
  );
  return argumentsValue;
}

export function upsertMarketplaceDetailImages(value: unknown, urls: string[], altTexts: string[], roles: string[]) {
  const source = (typeof value === "string" ? value : "")
    .replace(/<section\b[^>]*\bdata-sellerpilot-detail-images=(?:"true"|'true')[^>]*>[\s\S]*?<\/section>/gi, "")
    .trimEnd();
  return injectMarketplaceDetailImages(source, urls, altTexts, roles);
}

export function buildCoupangMarketplaceContents(
  currentContentsValue: unknown,
  localizedSectionsValue: unknown,
  classificationValue: unknown,
  detailUrls: string[],
  detailRoles: string[],
) {
  const currentContents = Array.isArray(currentContentsValue) ? currentContentsValue : [];
  const classification = record(classificationValue);
  const localizedSections = Array.isArray(localizedSectionsValue)
    ? localizedSectionsValue.map(record).filter((section): section is Record<string, unknown> => Boolean(section))
    : [];
  const currentContentsText = JSON.stringify(currentContents);
  const classificationValues = [classification?.displayName, classification?.evidence]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean);
  const evidenceValues = localizedSections.flatMap((section) => [
    section.heading,
    section.body,
    section.buyerQuestion,
    section.evidence,
  ]).map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean);
  const currentContentsPreserveEvidence = [...classificationValues, ...evidenceValues]
    .every((value) => currentContentsText.includes(value));
  const classificationHtml = classificationValues.length
    ? `<section data-sellerpilot-classification="true"><h2>${escapedAttribute(String(classification?.displayName ?? ""))}</h2><p>${escapedAttribute(String(classification?.verificationStatus ?? "needs-review"))}</p><p>${escapedAttribute(String(classification?.evidence ?? ""))}</p></section>`
    : "";
  const learnedContents = detailRoles.flatMap((role, index) => {
    const section = localizedSections.find((candidate) => candidate.imageAsset === role);
    const heading = typeof section?.heading === "string" ? section.heading.trim() : "";
    const sectionBody = typeof section?.body === "string" ? section.body.trim() : "";
    const buyerQuestion = typeof section?.buyerQuestion === "string" ? section.buyerQuestion.trim() : "";
    const evidence = typeof section?.evidence === "string" ? section.evidence.trim() : "";
    const sectionHtml = [
      heading ? `<h2>${escapedAttribute(heading)}</h2>` : "",
      buyerQuestion ? `<p><strong>구매 전 질문</strong> ${escapedAttribute(buyerQuestion)}</p>` : "",
      sectionBody ? `<p>${escapedAttribute(sectionBody)}</p>` : "",
      evidence ? `<p><strong>확인 근거</strong> ${escapedAttribute(evidence)}</p>` : "",
    ].join("");
    return [
      ...(sectionHtml ? [{ contentsType: "TEXT", contentDetails: [{ content: sectionHtml, detailType: "TEXT" }] }] : []),
      ...(detailUrls[index] ? [{ contentsType: "IMAGE", contentDetails: [{ content: detailUrls[index], detailType: "IMAGE" }] }] : []),
    ];
  });
  const detailImages = detailUrls.map((url) => ({
    contentsType: "IMAGE",
    contentDetails: [{ content: url, detailType: "IMAGE" }],
  }));
  return currentContentsPreserveEvidence && currentContents.length
    ? [...currentContents, ...detailImages]
    : [
        ...(classificationHtml ? [{ contentsType: "TEXT", contentDetails: [{ content: classificationHtml, detailType: "TEXT" }] }] : []),
        ...currentContents,
        ...(learnedContents.length ? learnedContents : detailImages),
      ];
}

export async function prepareMarketplaceImages(
  serviceClient: SupabaseClient,
  channel: ActiveChannelKey,
  argumentsValue: Record<string, unknown>,
  lifecycle?: MarketplaceImageLifecycleReference,
) {
  const next = structuredClone(argumentsValue);
  delete next.sellerpilotPublicationAssetBinding;
  const normalizedBySource = new Map<string, Promise<PreparedMarketplaceNormalizedAsset>>();
  const preparedAssets: PreparedMarketplaceNormalizedAsset[] = [];
  const normalize = async (
    sourceUrl: string,
    mode: MarketplaceImageNormalizationMode,
    sourceObjectPath?: string,
    expectedSourceSha256?: string,
  ) => {
    const cacheKey = `${mode}:${sourceUrl}:${sourceObjectPath ?? ""}:${expectedSourceSha256 ?? ""}`;
    const cached = normalizedBySource.get(cacheKey);
    if (cached) return (await cached).publicUrl;
    const pending = prepareNormalizedImage(
      serviceClient,
      sourceUrl,
      mode,
      sourceObjectPath,
      expectedSourceSha256,
    );
    normalizedBySource.set(cacheKey, pending);
    const prepared = await pending;
    preparedAssets.push(prepared);
    return prepared.publicUrl;
  };
  const normalizeList = async (
    value: unknown,
    limit: number,
    mode: MarketplaceImageNormalizationMode,
    sourceObjectPaths: string[] = [],
    expectedSourceSha256s: string[] = [],
  ) => {
    const sourceUrls = strings(value);
    const unique = [...new Set(sourceUrls)].slice(0, limit);
    if (!unique.length) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    const lineageRequired = sourceObjectPaths.length > 0 || expectedSourceSha256s.length > 0;
    if (lineageRequired && (
      sourceUrls.length !== unique.length
      || sourceObjectPaths.length !== unique.length
      || expectedSourceSha256s.length !== unique.length
      || new Set(sourceObjectPaths).size !== unique.length
      || new Set(expectedSourceSha256s).size !== unique.length
      || expectedSourceSha256s.some((digest) => !/^[a-f0-9]{64}$/u.test(digest))
    )) {
      throw new Error("MARKETPLACE_APPROVED_SOURCE_LINEAGE_INVALID");
    }
    const normalized = new Array<string>(unique.length);
    await runWithConcurrency(
      unique.map((sourceUrl, index) => ({ sourceUrl, index })),
      marketplaceUploadConcurrency,
      async ({ sourceUrl, index }) => {
        normalized[index] = await normalize(
          sourceUrl,
          mode,
          lineageRequired ? sourceObjectPaths[index] : undefined,
          lineageRequired ? expectedSourceSha256s[index] : undefined,
        );
      },
    );
    return normalized;
  };
  const finish = async () => {
    if (preparedAssets.length) {
      if (!lifecycle) throw new Error("MARKETPLACE_IMAGE_LIFECYCLE_REQUIRED");
      await persistMarketplaceNormalizedAssets(serviceClient, channel, lifecycle, preparedAssets);
    }
    return next;
  };

  const assets = record(next.sellerpilotAssets);
  delete next.sellerpilotAssets;
  const manualSourceMode = assets?.contentMode === "manual_mvp"
    && assets.detailAssetMode === "manual_source";
  if (manualSourceMode) next.sellerpilotContentMode = "manual_mvp";
  const elevenstProductPatch = channel === "elevenst" ? record(next.productPatch) : null;
  const elevenstMediaFields = ["prdImage01", "prdImage02", "prdImage03", "prdImage04", "htmlDetail"] as const;
  if (channel === "elevenst"
      && elevenstProductPatch
      && !elevenstMediaFields.some((field) => Object.hasOwn(elevenstProductPatch, field))) {
    // 11st updates replace the complete Product document. A title/brand/etc.
    // patch must not opportunistically renormalize images or append detail
    // panels that were not part of the requested mutable projection.
    return next;
  }
  if (!assets || (manualSourceMode
    ? new Set(strings(assets.galleryImageUrls)).size < 1
      || new Set(strings(assets.detailImageUrls)).size < 1
    : assets.detailAssetMode !== "dedicated"
      || new Set(strings(assets.detailImageUrls)).size < marketplaceChannelDetailImageCount
      || !hasCompleteLocalizedDetailSections(assets))) {
    throw new Error("MARKETPLACE_DETAIL_IMAGE_REQUIRED");
  }
  const approvedDetailImagePaths = strings(assets?.approvedDetailImagePaths);
  const approvedDetailImageSha256s = strings(assets?.approvedDetailImageSha256s);
  const preserveQoo10RepresentativeImage = qoo10RollbackRecoveryPreservesRepresentativeImage(channel, next);
  const gallery = assets
    ? preserveQoo10RepresentativeImage
      ? []
      : await normalizeList(assets.galleryImageUrls, channel === "qoo10" ? 1 : 12, "gallery-square")
    : [];
  const details = assets
    ? await normalizeList(
        assets.detailImageUrls,
        manualSourceMode ? 10 : marketplaceChannelDetailImageCount,
        "detail-ratio",
        manualSourceMode ? [] : approvedDetailImagePaths,
        manualSourceMode ? [] : approvedDetailImageSha256s,
      )
    : [];
  const detailImageAltTexts = strings(assets?.detailImageAltTexts).slice(0, details.length);
  const detailImageRoles = strings(assets?.detailImageRoles).slice(0, details.length);
  const bindPublicationAssets = (
    surface: "detail_content" | "gallery" | "buyer_visible",
    transportUrls: string[],
    transportRoles: string[],
  ) => {
    if (manualSourceMode) return;
    const manifestDigest = String(assets?.detailImageManifestDigest ?? "").trim();
    const approvedVersion = Number(assets?.approvedDetailPageVersion);
    const binding = buildListingPublicationAssetBinding({
      approvedDetailPageVersion: approvedVersion,
      approvedManifestDigest: manifestDigest,
      approvedDetailRoles: detailImageRoles,
      approvedDetailImagePaths,
      approvedDetailImageSha256s,
      approvedDetailImageUrls: details,
      providerImageSurface: surface,
      providerTransportRoles: transportRoles,
      providerTransportUrls: transportUrls,
    });
    if (!binding) {
      if (next.publicationStateContract === "verified_remote_state_v1") {
        throw new Error("MARKETPLACE_PUBLICATION_ASSET_BINDING_INVALID");
      }
      return;
    }
    next.sellerpilotPublicationAssetBinding = binding;
  };
  bindPublicationAssets("detail_content", details, detailImageRoles);

  if (channel === "qoo10") {
    applyPreparedQoo10Images(next, gallery, details, detailImageAltTexts, detailImageRoles);
    return finish();
  }

  if (channel === "shopee" || channel === "lazada" || channel === "smartstore") {
    const limit = channel === "smartstore" ? 10 : channel === "shopee" ? 9 : 8;
    const sourceGallery = gallery.length ? gallery : await normalizeList(next.imageUrls, limit, "gallery-square");
    const normalizedAssets = uniqueStrings([...sourceGallery, ...details]);
    const listingImages = channel === "shopee"
      ? uniqueStrings([sourceGallery[0] ?? "", ...details]).slice(0, limit)
      : normalizedAssets.slice(0, limit);
    if (channel === "shopee" && !manualSourceMode) {
      bindPublicationAssets(
        "buyer_visible",
        details,
        detailImageRoles,
      );
    }
    // Lazada rejects any external URL left in description HTML. Keep every
    // normalized detail asset in imageUrls so the local worker migrates all of
    // them into Lazada media space, while the product gallery stays at 8.
    next.imageUrls = channel === "lazada" ? normalizedAssets : listingImages;
    if (channel === "lazada") {
      const request = record(next.request);
      const requestRoot = record(request?.Request);
      const product = record(requestRoot?.Product);
      const attributes = record(product?.Attributes);
      if (!product || !attributes) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
      product.Images = { Image: listingImages };
      const skus = record(product.Skus);
      const skuList = Array.isArray(skus?.Sku) ? skus.Sku : [];
      for (const skuValue of skuList) {
        const sku = record(skuValue);
        if (sku) sku.Images = { Image: listingImages };
      }
      attributes.description = upsertMarketplaceDetailImages(attributes.description, details, detailImageAltTexts, detailImageRoles);
    }
    if (channel === "smartstore") {
      const body = record(next.body);
      const originProduct = record(body?.originProduct);
      if (!originProduct) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
      originProduct.detailContent = upsertMarketplaceDetailImages(originProduct.detailContent, details, detailImageAltTexts, detailImageRoles);
    }
    return finish();
  }

  if (channel === "coupang") {
    const body = record(next.body);
    const items = Array.isArray(body?.items) ? body.items : [];
    const classification = record(assets?.classification);
    const localizedSections = Array.isArray(assets?.localizedDetailSections)
      ? assets.localizedDetailSections.map(record).filter((section): section is Record<string, unknown> => Boolean(section))
      : [];
    if (!items.length) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    let count = 0;
    for (const itemValue of items) {
      const item = record(itemValue);
      if (item && gallery.length) {
        const combined = uniqueStrings([...gallery, ...details]).slice(0, 10);
        item.images = combined.map((url, index) => ({
          imageOrder: index,
          imageType: index === 0 ? "REPRESENTATION" : "DETAIL",
          vendorPath: url,
        }));
        item.contents = buildCoupangMarketplaceContents(
          item.contents,
          localizedSections,
          classification,
          details,
          detailImageRoles,
        );
        count += combined.length;
        continue;
      }
      const images = Array.isArray(item?.images) ? item.images : [];
      for (const imageValue of images) {
        const image = record(imageValue);
        const sourceUrl = typeof image?.vendorPath === "string" ? image.vendorPath.trim() : "";
        if (!image || !sourceUrl) continue;
        image.vendorPath = await normalize(sourceUrl, "gallery-square");
        count += 1;
      }
    }
    if (!count) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    return finish();
  }

  if (channel === "elevenst") {
    const product = record(next.product);
    const productPatch = record(next.productPatch);
    if (!product) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    const imageFields = ["prdImage01", "prdImage02", "prdImage03", "prdImage04"] as const;
    const requestedImageFields = productPatch
      ? imageFields.filter((field) => Object.hasOwn(productPatch, field))
      : imageFields;
    let normalized: string[] = [];
    if (requestedImageFields.some((field) => productPatch?.[field] !== "" && productPatch?.[field] !== null)) {
      normalized = gallery.length ? uniqueStrings(manualSourceMode ? gallery : [...gallery, ...details]).slice(0, 4) : await normalizeList([
        product.prdImage01,
        product.prdImage02,
        product.prdImage03,
        product.prdImage04,
      ], 4, "gallery-square");
      if (!normalized.length) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    }
    for (const field of requestedImageFields) {
      const index = imageFields.indexOf(field);
      const requestedValue = productPatch?.[field];
      if (productPatch && (requestedValue === "" || requestedValue === null)) {
        product[field] = requestedValue;
      } else {
        const url = normalized[index];
        if (!url) {
          // 11st only requires the representative image on create. Manual-MVP
          // products may intentionally have a single verified source photo;
          // keep optional image slots empty instead of turning that valid
          // create into a false MARKETPLACE_IMAGE_REQUIRED failure.
          if (!productPatch && index > 0) product[field] = "";
          else throw new Error("MARKETPLACE_IMAGE_REQUIRED");
        } else {
          product[field] = url;
        }
      }
      if (productPatch) productPatch[field] = product[field];
    }
    if (!productPatch || Object.hasOwn(productPatch, "htmlDetail")) {
      product.htmlDetail = upsertMarketplaceDetailImages(product.htmlDetail, details, detailImageAltTexts, detailImageRoles);
      if (productPatch) productPatch.htmlDetail = product.htmlDetail;
    }
    return finish();
  }

  if (channel === "temu") {
    const body = record(next.body);
    const goodsBasic = record(body?.goodsBasic);
    if (!body || !goodsBasic) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
    const normalized = gallery.length
      ? gallery.slice(0, 10)
      : await normalizeList(goodsBasic.goodsCarouselImage, 10, "gallery-square");
    const normalizedDetails = details.length ? details.slice(0, 10) : normalized;
    goodsBasic.goodsCarouselImage = normalized;
    goodsBasic.detailImage = normalizedDetails;
    const skuList = Array.isArray(body.skuList) ? body.skuList : [];
    for (const skuValue of skuList) {
      const sku = record(skuValue);
      if (sku) sku.images = normalized;
    }
    return finish();
  }

  const inventoryItem = record(next.inventoryItem);
  const product = record(inventoryItem?.product);
  if (!product) throw new Error("MARKETPLACE_IMAGE_REQUIRED");
  const normalized = gallery.length
    ? uniqueStrings([...gallery, ...details]).slice(0, 12)
    : await normalizeList(product.imageUrls, 12, "gallery-square");
  product.imageUrls = normalized;
  product.description = upsertMarketplaceDetailImages(product.description, details, detailImageAltTexts, detailImageRoles);
  const offer = record(next.offer);
  if (offer) offer.listingDescription = upsertMarketplaceDetailImages(offer.listingDescription, details, detailImageAltTexts, detailImageRoles);
  return finish();
}
