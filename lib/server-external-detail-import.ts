import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { aiDetailAssetIds } from "./ai-generated-assets";

/** Pure validation foundation, not an upload/approval API. No Studio job or manifest is mutated. */
export const externalDetailImportContract = "sellerpilot_external_detail_import_v1";
export const externalDetailImportMaximumBytes = 10 * 1024 * 1024;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const externalDetailImportAssetSchema = z.object({
  assetId: uuidSchema,
  role: z.enum(aiDetailAssetIds),
  originalFileName: z.string().trim().min(1).max(240)
    .refine((value) => !/[\\/]/u.test(value)
      && [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "A basename is required"),
  mediaType: z.literal("image/png"),
  byteLength: z.number().int().min(1).max(externalDetailImportMaximumBytes),
  sourceSha256: sha256Schema,
  alt: z.string().trim().min(1).max(180),
  caption: z.string().trim().min(1).max(2_000),
}).strict();

export const externalDetailImportRequestSchema = z.object({
  importId: uuidSchema,
  productId: uuidSchema,
  expectedProductUpdatedAt: timestampSchema,
  expectedDetailVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  expectedAiJobId: uuidSchema.nullable(),
  source: z.object({
    kind: z.literal("external_generated"),
    tool: z.string().trim().min(1).max(120),
    referenceSha256s: z.array(sha256Schema).min(1).max(32),
  }).strict(),
  assets: z.array(externalDetailImportAssetSchema).length(8),
  imageRightsConfirmed: z.literal(true),
  regeneratedPreviewAcknowledged: z.literal(true),
}).strict().superRefine((value, context) => {
  for (const field of ["assetId", "role", "sourceSha256"] as const) {
    if (new Set(value.assets.map((asset) => asset[field].toLowerCase())).size !== 8) {
      context.addIssue({ code: "custom", path: ["assets"], message: `Eight distinct ${field} values are required` });
    }
  }
  if (new Set(value.source.referenceSha256s).size !== value.source.referenceSha256s.length) {
    context.addIssue({ code: "custom", path: ["source", "referenceSha256s"], message: "Duplicate source references" });
  }
});

const serverContextSchema = z.object({
  actorId: uuidSchema,
  ownerId: uuidSchema,
  productId: uuidSchema,
  productUpdatedAt: timestampSchema,
  detailVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  aiJobId: uuidSchema.nullable(),
  verifiedReferenceSha256s: z.array(sha256Schema).min(1),
}).strict();
export type ExternalDetailImportServerContext = z.infer<typeof serverContextSchema>;
export type ExternalDetailImportRequest = z.infer<typeof externalDetailImportRequestSchema>;

/** Context MUST come from authenticated, authorized server reads, never request JSON.
 * Database reserve/commit must recheck these same fences under a product lock.
 * Timestamp comparison is exact: do not round Postgres microseconds to JS milliseconds.
 */
export function bindExternalDetailImportRequest(
  input: unknown,
  serverContext: ExternalDetailImportServerContext,
) {
  const request = externalDetailImportRequestSchema.parse(input);
  const context = serverContextSchema.parse(serverContext);
  if (request.productId !== context.productId
      || request.expectedProductUpdatedAt !== context.productUpdatedAt
      || request.expectedDetailVersion !== context.detailVersion
      || request.expectedAiJobId !== context.aiJobId) {
    throw new Error("EXTERNAL_DETAIL_IMPORT_PRODUCT_VERSION_CONFLICT");
  }
  if (request.source.referenceSha256s.some((hash) => !context.verifiedReferenceSha256s.includes(hash))) {
    throw new Error("EXTERNAL_DETAIL_IMPORT_REFERENCE_UNVERIFIED");
  }
  const record = {
    contract: externalDetailImportContract,
    actorId: context.actorId,
    ownerId: context.ownerId,
    ...request,
    assets: request.assets.map((asset) => ({
      ...asset,
      storagePath: `external-detail/${context.ownerId}/${context.productId}/${request.importId}/${asset.assetId}/${asset.sourceSha256}.png`,
    })),
  };
  return { ...record, requestSha256: digest(JSON.stringify(record)) };
}

/** Verifies downloaded original bytes without rewriting them or synthesizing an approval.
 * Byte validity is NOT label fidelity, provenance authenticity, or publishing permission.
 */
export async function inspectExternalDetailImportPng(
  declaredInput: unknown,
  bytes: Uint8Array,
) {
  const declared = externalDetailImportAssetSchema.parse(declaredInput);
  if (bytes.byteLength !== declared.byteLength
      || bytes.byteLength > externalDetailImportMaximumBytes
      || digest(bytes) !== declared.sourceSha256) {
    throw new Error("EXTERNAL_DETAIL_IMPORT_SOURCE_HASH_MISMATCH");
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < signature.length || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error("EXTERNAL_DETAIL_IMPORT_PNG_REQUIRED");
  }
  // Reject APNG even when its default image could decode as a still PNG.
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0);
    if (offset + 12 + length > bytes.byteLength) throw new Error("EXTERNAL_DETAIL_IMPORT_PNG_INVALID");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "acTL") throw new Error("EXTERNAL_DETAIL_IMPORT_ANIMATION_REJECTED");
    offset += length + 12;
    if (type === "IEND") break;
  }
  if (offset !== bytes.byteLength) throw new Error("EXTERNAL_DETAIL_IMPORT_PNG_INVALID");
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 16_000_000 });
    const metadata = await image.metadata();
    if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1
        || !metadata.width || !metadata.height
        || metadata.width < 600 || metadata.height < 600
        || metadata.width * metadata.height > 16_000_000) {
      throw new Error("EXTERNAL_DETAIL_IMPORT_DIMENSIONS_INVALID");
    }
    const { data, info } = await image.toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return {
      assetId: declared.assetId,
      role: declared.role,
      sourceSha256: digest(bytes),
      decodedRgbaSha256: digest(Buffer.concat([Buffer.from(`${info.width}x${info.height}:RGBA\n`), data])),
      width: info.width,
      height: info.height,
      byteLength: bytes.byteLength,
      mediaType: "image/png" as const,
      verification: "bytes_only_not_approved" as const,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "EXTERNAL_DETAIL_IMPORT_DIMENSIONS_INVALID") throw error;
    throw new Error("EXTERNAL_DETAIL_IMPORT_PNG_INVALID");
  }
}

/** Use after server-side download/inspection of all eight stored originals. No client receipt acceptance. */
export function assertExternalDetailImportByteSet(
  request: ExternalDetailImportRequest,
  inspected: Awaited<ReturnType<typeof inspectExternalDetailImportPng>>[],
) {
  const validated = externalDetailImportRequestSchema.parse(request);
  if (inspected.length !== 8
      || new Set(inspected.map((entry) => entry.decodedRgbaSha256)).size !== 8
      || inspected.some((entry, index) => {
        const declared = validated.assets[index];
        return entry.assetId !== declared.assetId || entry.role !== declared.role
          || entry.sourceSha256 !== declared.sourceSha256
          || entry.byteLength !== declared.byteLength
          || entry.verification !== "bytes_only_not_approved";
      })) throw new Error("EXTERNAL_DETAIL_IMPORT_BYTE_SET_MISMATCH");
}
