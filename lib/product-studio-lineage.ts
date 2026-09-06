import { z } from "zod";
import { studioSourceEvidenceSchema } from "./studio-source-planning";
import {
  aiGeneratedAssetSpecs,
  coreFirstDraftAssetIds,
  type AiGeneratedAssetId,
} from "./ai-generated-assets";

export type ProductResearchLineageFailure =
  | "read_failed"
  | "not_visible"
  | "identity_mismatch"
  | "wrong_kind"
  | "not_succeeded";

export type ProductResearchLineageValidation =
  | { valid: true }
  | { valid: false; reason: ProductResearchLineageFailure };

export type ProductResearchPreflightLineageFailure =
  | "preflight_missing"
  | "preflight_invalid"
  | "research_input_mismatch"
  | "source_photo_mismatch";

type CoreFirstDraftAssetId = (typeof coreFirstDraftAssetIds)[number];

export type ProductResearchPreflightAuditLineage = {
  digest: string;
  role: "creative" | "detail";
  auditMode: "segmented-source-composite" | "source-photo-catalog";
  sourceRole: string;
  sourceSha256?: string;
};

export type ValidatedProductResearchPreflight = {
  sourcePhotoEvidence?: z.infer<typeof studioSourceEvidenceSchema>[];
  preflightVersion: 1;
  researchInputSha256: string;
  sourcePhotoSha256: string;
  claimToken: string;
  assetStoragePaths: Record<CoreFirstDraftAssetId, string>;
  assetDigests: Record<CoreFirstDraftAssetId, string>;
  auditLineage: Record<CoreFirstDraftAssetId, ProductResearchPreflightAuditLineage>;
};

export type ProductResearchPreflightLineageValidation =
  | { valid: true; preflight: ValidatedProductResearchPreflight }
  | { valid: false; reason: ProductResearchPreflightLineageFailure };

const lowercaseSha256Pattern = /^[a-f0-9]{64}$/;
const uuidPathPart = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const preflightAuditModes = new Set(["segmented-source-composite", "source-photo-catalog"]);
const assetSpecById = new Map<AiGeneratedAssetId, (typeof aiGeneratedAssetSpecs)[number]>(
  aiGeneratedAssetSpecs.map((asset) => [asset.id, asset]),
);

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactCoreAssetIds(value: Record<string, unknown>) {
  const actual = Object.keys(value).sort();
  const expected = [...coreFirstDraftAssetIds].sort();
  return actual.length === expected.length
    && actual.every((assetId, index) => assetId === expected[index]);
}

function hasAsciiControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function canonicalClaimScopedPath(
  researchJobId: string,
  assetId: CoreFirstDraftAssetId,
  value: unknown,
) {
  if (typeof value !== "string") return null;
  const file = assetSpecById.get(assetId)?.file;
  if (!file) return null;
  const match = new RegExp(
    `^results/(${uuidPathPart})/claims/(${uuidPathPart})/([^/]+)$`,
    "i",
  ).exec(value);
  if (!match
      || match[1].toLowerCase() !== researchJobId.toLowerCase()
      || match[3] !== file) return null;
  return match[2].toLowerCase();
}

export function validateVisibleSucceededProductResearchJob(input: {
  expectedJobId: string;
  data: unknown;
  error: unknown;
}): ProductResearchLineageValidation {
  if (input.error) return { valid: false, reason: "read_failed" };
  if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) {
    return { valid: false, reason: "not_visible" };
  }

  const job = input.data as Record<string, unknown>;
  if (job.id !== input.expectedJobId) return { valid: false, reason: "identity_mismatch" };
  if (job.kind !== "product_research") return { valid: false, reason: "wrong_kind" };
  if (job.status !== "succeeded") return { valid: false, reason: "not_succeeded" };
  return { valid: true };
}

/**
 * Validates the raw, creator-visible research result before a final Studio job
 * may reuse its first-draft assets. Legacy text-only research rows remain
 * readable through validateVisibleSucceededProductResearchJob, but they do not
 * satisfy this stronger preflight lineage contract.
 */
export function validateSucceededProductResearchPreflight(input: {
  expectedJobId: string;
  expectedResearchInputSha256: string;
  expectedSourcePhotoSha256: string;
  data: unknown;
}): ProductResearchPreflightLineageValidation {
  const job = recordValue(input.data);
  const result = recordValue(job?.result);
  if (!result) return { valid: false, reason: "preflight_missing" };

  const preflightFields = [
    result.preflightVersion,
    result.researchInputSha256,
    result.sourcePhotoSha256,
    result.asset_storage_paths,
    result.preflightAssetLineage,
  ];
  if (preflightFields.every((value) => value === undefined)) {
    return { valid: false, reason: "preflight_missing" };
  }
  if (result.preflightVersion !== 1
      || typeof result.researchInputSha256 !== "string"
      || !lowercaseSha256Pattern.test(result.researchInputSha256)
      || typeof result.sourcePhotoSha256 !== "string"
      || !lowercaseSha256Pattern.test(result.sourcePhotoSha256)) {
    return { valid: false, reason: "preflight_invalid" };
  }
  if (!lowercaseSha256Pattern.test(input.expectedResearchInputSha256)
      || result.researchInputSha256 !== input.expectedResearchInputSha256) {
    return { valid: false, reason: "research_input_mismatch" };
  }
  if (result.sourcePhotoSha256 !== input.expectedSourcePhotoSha256) {
    return { valid: false, reason: "source_photo_mismatch" };
  }

  const sourceEvidence = result.sourcePhotoEvidence === undefined ? undefined
    : z.array(studioSourceEvidenceSchema).min(1).max(10).safeParse(result.sourcePhotoEvidence);
  if (sourceEvidence && !sourceEvidence.success) return { valid: false, reason: "preflight_invalid" };
  if (sourceEvidence?.success && (
    sourceEvidence.data.some((source, index) => source.sourceIndex !== index)
    || sourceEvidence.data[0].inputRole !== "main"
    || sourceEvidence.data[0].sourceSha256 !== result.sourcePhotoSha256
  )) return { valid: false, reason: "preflight_invalid" };
  const sourceDigests = sourceEvidence?.success ? new Set(sourceEvidence.data.map(source => source.sourceSha256)) : null;
  const rawPaths = recordValue(result.asset_storage_paths);
  const rawLineage = recordValue(result.preflightAssetLineage);
  if (!rawPaths || !rawLineage
      || !hasExactCoreAssetIds(rawPaths)
      || !hasExactCoreAssetIds(rawLineage)) {
    return { valid: false, reason: "preflight_invalid" };
  }

  const assetStoragePaths = {} as Record<CoreFirstDraftAssetId, string>;
  const assetDigests = {} as Record<CoreFirstDraftAssetId, string>;
  const auditLineage = {} as Record<CoreFirstDraftAssetId, ProductResearchPreflightAuditLineage>;
  let sharedClaimToken = "";
  for (const assetId of coreFirstDraftAssetIds) {
    const path = rawPaths[assetId];
    const claimToken = canonicalClaimScopedPath(input.expectedJobId, assetId, path);
    const lineage = recordValue(rawLineage[assetId]);
    const expectedRole = assetSpecById.get(assetId)?.role;
    if (!claimToken
        || (sharedClaimToken && claimToken !== sharedClaimToken)
        || !lineage
        || typeof lineage.digest !== "string"
        || !lowercaseSha256Pattern.test(lineage.digest)
        || lineage.role !== expectedRole
        || typeof lineage.auditMode !== "string"
        || !preflightAuditModes.has(lineage.auditMode)
        || typeof lineage.sourceRole !== "string"
        || lineage.sourceRole.trim().length < 1
        || lineage.sourceRole.length > 80
        || hasAsciiControlCharacter(lineage.sourceRole)
        || (sourceDigests && !sourceDigests.has(String(lineage.sourceSha256)))
        || (lineage.sourceSha256 !== undefined && (typeof lineage.sourceSha256 !== "string" || !lowercaseSha256Pattern.test(lineage.sourceSha256)))) {
      return { valid: false, reason: "preflight_invalid" };
    }
    sharedClaimToken ||= claimToken;
    assetStoragePaths[assetId] = path as string;
    assetDigests[assetId] = lineage.digest;
    auditLineage[assetId] = {
      digest: lineage.digest,
      role: lineage.role as ProductResearchPreflightAuditLineage["role"],
      auditMode: lineage.auditMode as ProductResearchPreflightAuditLineage["auditMode"],
      sourceRole: lineage.sourceRole.trim(),
      ...(typeof lineage.sourceSha256 === "string" ? { sourceSha256: lineage.sourceSha256 } : {}),
    };
  }

  return {
    valid: true,
    preflight: {
      ...(sourceEvidence?.success ? { sourcePhotoEvidence: sourceEvidence.data } : {}),
      preflightVersion: 1,
      researchInputSha256: result.researchInputSha256,
      sourcePhotoSha256: result.sourcePhotoSha256,
      claimToken: sharedClaimToken,
      assetStoragePaths,
      assetDigests,
      auditLineage,
    },
  };
}
