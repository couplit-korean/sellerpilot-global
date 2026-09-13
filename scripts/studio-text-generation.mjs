import { createHash } from "node:crypto";
import { readStudioTextCheckpoint, writeStudioTextCheckpoint } from "./studio-text-checkpoint.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const imageSpecFields = ["name", "role", "originalWidth", "originalHeight", "width", "height", "bytes",
  "mediaType", "fit", "originalName", "originalBytes", "originalMediaType"];

export function studioTextCheckpointIdentity({ job, imageFiles, referenceText, referenceWarnings, competitorContext }) {
  // Older claim contracts did not identify the job owner. Never guess one from
  // the shared administrator's worker token or from an input URL.
  if (job.owner_id == null) return null;
  if (!uuid.test(job.owner_id) || !uuid.test(job.id)) throw new Error("STUDIO_TEXT_CHECKPOINT_IDENTITY_INVALID");
  if (!Array.isArray(imageFiles) || !imageFiles.length) throw new Error("STUDIO_TEXT_CHECKPOINT_SOURCES_INVALID");
  const sources = imageFiles.map((image, index) => {
    if (image.sourceIndex !== index || typeof image.role !== "string" || !image.role
        || !sha.test(image.sourceDigest) || !Number.isSafeInteger(image.sourceBytes) || image.sourceBytes < 1) {
      throw new Error("STUDIO_TEXT_CHECKPOINT_SOURCES_INVALID");
    }
    return { sourceIndex: image.sourceIndex, role: image.role, sourceDigest: image.sourceDigest, sourceBytes: image.sourceBytes };
  });
  const request = job.request ?? {};
  const semanticRequest = {
    contractVersion: 1,
    description: request.description ?? "",
    productUrl: request.productUrl ?? "",
    researchInput: request.researchInput ?? "",
    manualFields: request.manualFields ?? {},
    imageSpecs: (request.imageSpecs ?? []).map((spec) => Object.fromEntries(imageSpecFields
      .filter((field) => spec[field] !== undefined).map((field) => [field, spec[field]]))),
    competitorContext: competitorContext ?? null,
    firstDraftProductFacts: request.firstDraftProductFacts ?? null,
    firstDraftSourceResearchJobId: request.firstDraftSourceResearchJobId ?? null,
    firstDraftSourcePhotoSha256: request.firstDraftSourcePhotoSha256 ?? null,
    referenceText,
    referenceWarnings: referenceWarnings ?? [],
  };
  return {
    jobId: job.id,
    ownerId: job.owner_id,
    requestSha256: digest(semanticRequest),
    sourcePhotosSha256: digest(sources),
    preparedManifestSha256: digest(request.firstDraftQualityManifest ?? null),
  };
}

/** Cache only a complete validated text result, before any image production.
 * The caller still performs every source, prepared-image and output check. */
export async function generateStudioTextWithCheckpoint(options) {
  const identity = studioTextCheckpointIdentity(options);
  const checkpoint = identity ? {
    cacheDir: options.cacheDir, identity, hmacKey: options.hmacKey, validateResult: options.validateResult,
  } : null;
  if (checkpoint) {
    const cached = await readStudioTextCheckpoint(checkpoint);
    if (cached) return { result: cached.result, digest: cached.digest, reused: true };
  }
  const result = await options.generate();
  if (await options.validateResult(result) !== true) throw new Error("STUDIO_TEXT_CHECKPOINT_RESULT_INVALID");
  const saved = checkpoint ? await writeStudioTextCheckpoint({ ...checkpoint, result }) : null;
  return { result, digest: saved?.digest ?? null, reused: false };
}
