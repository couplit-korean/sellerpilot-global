import { createHash } from "node:crypto";
import sharp from "sharp";
import { smartstoreContentRepairBinding } from "./smartstore-content-repair-contract";
export { smartstoreContentRepairArgument, smartstoreContentRepairBindingSchema, smartstoreContentRepairBinding } from "./smartstore-content-repair-contract";
export type { SmartstoreContentRepairBinding } from "./smartstore-content-repair-contract";
import { externalDetailCanonical } from "../external-detail-canonical";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function smartstoreContentRepairBodyHashes(body: {
  originProduct: Record<string, unknown>;
  smartstoreChannelProduct: Record<string, unknown>;
}) {
  const protectedOrigin = { ...body.originProduct };
  for (const key of ["name", "detailContent", "images"]) delete protectedOrigin[key];
  const protectedChannel = { ...body.smartstoreChannelProduct };
  delete protectedChannel.channelProductName;
  const digest = (value: unknown) => createHash("sha256").update(externalDetailCanonical(value)).digest("hex");
  return {
    baselineBodySha256: digest(body),
    protectedBodySha256: digest({ originProduct: protectedOrigin, smartstoreChannelProduct: protectedChannel }),
  };
}

/** Rebuild a content-only update from fresh official documents. The initial
 * request may contain no commercial fields; the image-prepared body may carry
 * them only if they still equal the immutable baseline's protected projection. */
export function prepareSmartstoreContentRepairBody(input: {
  argumentsValue: Record<string, unknown>;
  currentOriginProduct: Record<string, unknown>;
  currentChannelProduct: Record<string, unknown>;
  phase?: "source" | "prepared";
}) {
  const binding = smartstoreContentRepairBinding(input.argumentsValue);
  if (!binding || String(input.argumentsValue.originProductNo ?? "") !== binding.originProductNo) {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_IDENTITY_REQUIRED");
  }
  const currentBody = { originProduct: input.currentOriginProduct, smartstoreChannelProduct: input.currentChannelProduct };
  const currentHashes = smartstoreContentRepairBodyHashes(currentBody);
  if (currentHashes.baselineBodySha256 !== binding.baselineBodySha256
      || currentHashes.protectedBodySha256 !== binding.protectedBodySha256) {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_PREWRITE_DRIFT");
  }
  const requested = record(input.argumentsValue.body);
  const originPatch = record(requested.originProduct);
  const channelPatch = record(requested.smartstoreChannelProduct);
  if (Object.keys(requested).some(key => key !== "originProduct" && key !== "smartstoreChannelProduct")) {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_BODY_FIELDS_FORBIDDEN");
  }
  if (input.phase === "prepared") {
    if (smartstoreContentRepairBodyHashes({ originProduct: originPatch, smartstoreChannelProduct: channelPatch }).protectedBodySha256
        !== binding.protectedBodySha256) throw new Error("SMARTSTORE_CONTENT_REPAIR_PROTECTED_FIELDS_CHANGED");
  } else if (Object.keys(originPatch).some(key => !["name", "detailContent", "images"].includes(key))
      || Object.keys(channelPatch).some(key => key !== "channelProductName")) {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_BODY_FIELDS_FORBIDDEN");
  }
  if (typeof originPatch.name !== "string" || !originPatch.name.trim()
      || typeof originPatch.detailContent !== "string" || !originPatch.detailContent.trim()
      || !Object.keys(record(originPatch.images)).length
      || (Object.hasOwn(channelPatch, "channelProductName") && typeof channelPatch.channelProductName !== "string")) {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_CONTENT_REQUIRED");
  }
  const body = {
    originProduct: { ...structuredClone(input.currentOriginProduct),
      name: originPatch.name, detailContent: originPatch.detailContent, images: structuredClone(originPatch.images) },
    smartstoreChannelProduct: { ...structuredClone(input.currentChannelProduct),
      ...(Object.hasOwn(channelPatch, "channelProductName") ? { channelProductName: channelPatch.channelProductName } : {}) },
  };
  if (smartstoreContentRepairBodyHashes(body).protectedBodySha256 !== binding.protectedBodySha256) {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_PROTECTED_FIELDS_CHANGED");
  }
  return body;
}

export async function inspectSmartstoreContentRepairTransmission(url: string, bytes: Buffer, index: number) {
  const parsed = new URL(url);
  let project: URL;
  try { project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""); }
  catch { throw new Error("SMARTSTORE_CONTENT_REPAIR_PROJECT_ORIGIN_REQUIRED"); }
  if (project.protocol !== "https:" || project.pathname !== "/" || project.search || project.hash
      || project.username || project.password || parsed.origin !== project.origin) {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_PROJECT_ORIGIN_MISMATCH");
  }
  const path = parsed.pathname.match(/^\/storage\/v1\/object\/public\/sellerpilot-marketplace\/normalized\/([a-f0-9]{2})\/([a-f0-9]{64})\.jpg$/);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash || !path || path[1] !== path[2].slice(0, 2)
      || path[2] !== contentSha256) throw new Error("SMARTSTORE_CONTENT_REPAIR_TRANSMISSION_DIGEST_MISMATCH");
  if (index === 0) return null;
  const decoded = await sharp(bytes, { failOn: "warning", limitInputPixels: 16_000_000 })
    .rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (channels !== 4 || width < 600 || height < 600 || width > 1600 || height > 1600) {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_TRANSMISSION_DIMENSIONS_INVALID");
  }
  const decodedRgbaSha256 = createHash("sha256")
    .update(Buffer.concat([Buffer.from(`${width}x${height}:RGBA\n`, "utf8"), decoded.data])).digest("hex");
  return { index: index - 1, url, contentSha256, decodedRgbaSha256, width, height };
}
