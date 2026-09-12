import {
  aiGeneratedAssetSpecs,
  coreFirstDraftAssetIds,
  type AiGeneratedAssetId,
} from "./ai-generated-assets";
import { serverProductResearchResultSchema } from "./ai-cli-contract";
import {
  validateSucceededProductResearchPreflight,
  validateVisibleSucceededProductResearchJob,
  type ProductResearchLineageFailure,
} from "./product-studio-lineage";
import { productResearchInputSha256 } from "./product-research-lineage-receipt-core";
import { originalStudioImagePath } from "./studio-image-paths";
import type { ProductStudioResult } from "../app/product-studio-types";
import { z } from "zod";

/**
 * First-draft concept images.
 *
 * The Vercel preflight degrades to a `source-photo-catalog` for this account
 * because the AI-Gateway image model is unavailable (403), so the six canonical
 * first-draft assets are crops of the source photo instead of generated scenes.
 * The detail-page studio lane on the operator's Mac is the only lane that can
 * draw those six assets, so it adopts them back into the same research result.
 *
 * This module owns the shared contract between the admin enqueue endpoint, the
 * worker endpoints, and the Mac worker loop. Everything here is pure so the
 * routes stay thin and the rules stay testable.
 */

export const firstDraftImageAssetIds = coreFirstDraftAssetIds;
export type FirstDraftImageAssetId = (typeof coreFirstDraftAssetIds)[number];

export const firstDraftImagePayloadVersion = 1;

const lowercaseSha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const firstDraftImageAssetSpecById = new Map<AiGeneratedAssetId, (typeof aiGeneratedAssetSpecs)[number]>(
  aiGeneratedAssetSpecs.map((asset) => [asset.id, asset]),
);

export function firstDraftImageAssetSpec(assetId: FirstDraftImageAssetId) {
  return firstDraftImageAssetSpecById.get(assetId) ?? null;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized ? normalized : null;
}

/** Reason codes are shared by both routes and the worker so failures stay legible. */
export type FirstDraftImageRejection =
  | ProductResearchLineageFailure
  | "research_input_mismatch"
  | "source_photo_mismatch"
  | "preflight_missing"
  | "preflight_invalid"
  | "not_degraded"
  | "already_generated"
  | "source_path_unavailable"
  | "result_invalid"
  | "next_result_invalid"
  | "submission_invalid";

export type FirstDraftImageEnqueueRequest = { jobId: string };

export const firstDraftImageEnqueueRequestSchema = z.object({ jobId: z.string().uuid() }).strict();

export const firstDraftImageProductFactsSchema = z.object({
  schemaVersion: z.literal(firstDraftImagePayloadVersion),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(120),
  brandName: z.string().trim().min(1).max(120).nullable(),
  manufacturer: z.string().trim().min(1).max(160).nullable(),
  countryOfOrigin: z.string().trim().min(1).max(80).nullable(),
  material: z.string().trim().min(1).max(500).nullable(),
  packageContents: z.string().trim().min(1).max(500).nullable(),
  description: z.string().trim().min(1).max(4_000),
  summary: z.string().trim().min(20).max(2_000),
  oneLine: z.string().trim().min(1).max(240),
  targetCustomer: z.string().trim().max(240),
  features: z.array(z.string().trim().min(1).max(300)).max(12),
  usage: z.array(z.string().trim().min(1).max(300)).max(10),
  cautions: z.array(z.string().trim().min(1).max(400)).max(10),
  specifications: z.array(z.object({
    label: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(500),
    evidence: z.string().trim().min(1).max(500),
  }).strict()).max(30),
  classification: z.object({
    displayName: z.string().trim().min(1).max(120),
    verificationStatus: z.literal("needs-review"),
    evidence: z.string().trim().min(10).max(500),
    isHealthFunctionalFood: z.null(),
  }).strict(),
}).strict();

export type FirstDraftImageProductFacts = z.infer<typeof firstDraftImageProductFactsSchema>;

export const firstDraftImageEnqueuePayloadSchema = z.object({
  jobId: z.string().uuid(),
  sourcePath: z.string().min(1).max(400),
  sourcePhotoSha256: z.string().regex(lowercaseSha256Pattern),
  sourceUrl: z.string().url().max(2_000),
  assets: z.array(z.object({
    id: z.enum(firstDraftImageAssetIds),
    path: z.string().min(1).max(400),
  }).strict()).length(firstDraftImageAssetIds.length),
  completedAssets: z.array(z.enum(firstDraftImageAssetIds)).max(firstDraftImageAssetIds.length),
  productFacts: firstDraftImageProductFactsSchema,
}).strict().superRefine((value, context) => {
  const ids = value.assets.map((asset) => asset.id);
  if (new Set(ids).size !== firstDraftImageAssetIds.length) {
    context.addIssue({ code: "custom", path: ["assets"], message: "1차 생성 이미지 여섯 역할이 중복됐습니다." });
  }
  for (const assetId of firstDraftImageAssetIds) {
    if (!ids.includes(assetId)) {
      context.addIssue({ code: "custom", path: ["assets"], message: `1차 생성 이미지 역할 ${assetId}이(가) 없습니다.` });
    }
  }
});

export type FirstDraftImageEnqueuePayload = z.infer<typeof firstDraftImageEnqueuePayloadSchema>;

export const firstDraftImageAssetSubmissionSchema = z.object({
  id: z.enum(firstDraftImageAssetIds),
  pngBase64: z.string().min(1).max(24_000_000),
}).strict();

/**
 * The worker submits one or more verified assets per call. Submitting the six
 * canonical ids in one call is still valid; the route adopts them once all six
 * are recorded, so a retried or split submission stays idempotent.
 */
export const firstDraftImageSubmissionSchema = z.object({
  jobId: z.string().uuid(),
  assets: z.array(firstDraftImageAssetSubmissionSchema).min(1).max(firstDraftImageAssetIds.length),
}).strict().superRefine((value, context) => {
  const ids = value.assets.map((asset) => asset.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["assets"], message: "1차 생성 이미지 제출에 중복 역할이 있습니다." });
  }
});

/** A bounded failure report releases the claimed request instead of leaving it generating. */
export const firstDraftImageFailureSchema = z.object({
  jobId: z.string().uuid(),
  failed: z.literal(true),
  reason: z.string().trim().min(1).max(300),
}).strict();

export type FirstDraftImageWorkerPost =
  | { jobId: string; assets: z.infer<typeof firstDraftImageAssetSubmissionSchema>[] }
  | { jobId: string; failed: true; reason: string };

export const firstDraftImageWorkerPostSchema: z.ZodType<FirstDraftImageWorkerPost> = z.union([
  firstDraftImageSubmissionSchema,
  firstDraftImageFailureSchema,
]);

function firstSentence(value: string, maximum: number) {
  const match = /^(.+?[.!?。！？])(?:\s|$)/u.exec(value);
  const candidate = (match?.[1] ?? value).replace(/\s+/g, " ").trim();
  return candidate.slice(0, maximum);
}

/**
 * Builds the ProductStudioResult-shaped object the shared detail-page prompt
 * pipeline expects, using only values the research job already carries. Missing
 * facts stay visibly unverified instead of being invented.
 */
export function buildFirstDraftStudioResult(productFacts: FirstDraftImageProductFacts): ProductStudioResult {
  const name = productFacts.name;
  const oneLine = productFacts.oneLine;
  return {
    mode: "cli",
    product: {
      name,
      category: productFacts.category,
      classification: { ...productFacts.classification },
      oneLine,
      targetCustomer: productFacts.targetCustomer,
      features: [...productFacts.features],
      cautions: [...productFacts.cautions],
    },
    design: {
      themeName: `${name} 1차 자동생성 이미지`,
      creativeStrategy: {
        designArchetype: "proof-led",
        purchaseDecision: oneLine,
        contentDensity: "concise",
        targetSectionCount: 8,
        lengthRationale: "1차 생성 이미지 여섯 장 전용 작업이며 상세 본문 구성은 사용하지 않습니다.",
        differentiationKey: `${name}의 확인된 형태와 사용 맥락`,
        artDirection: `${name}; 입력된 원본 사진의 색·형태·라벨만 근거로 한 사실적 상업 이미지`,
        motionPolicy: "static-first",
      },
      palette: { primary: "#1f2933", accent: "#8a6a4a", surface: "#f5f1ea", text: "#1b1b1b" },
      heroCopy: name.slice(0, 160),
      heroSubcopy: oneLine.slice(0, 240),
      cta: "",
      sections: [],
    },
    thumbnail: {
      headline: name.slice(0, 120),
      subline: productFacts.category.slice(0, 120),
      badge: "",
    },
    localizedListings: [],
    warnings: [],
  } as unknown as ProductStudioResult;
}

function productFactsFromResearchResult(input: {
  result: Record<string, unknown>;
  manualFields?: unknown;
}) {
  const suggestedFields = recordValue(input.result.suggestedFields) ?? {};
  const details = recordValue(input.result.details) ?? {};
  const manual = recordValue(input.manualFields) ?? {};
  const pick = (resultKey: string, manualKey: string) => nullableText(suggestedFields[resultKey])
    ?? nullableText(manual[manualKey]);
  const summary = text(input.result.summary);
  const description = pick("description", "description") ?? summary;
  const name = pick("productName", "productName")
    ?? firstSentence(description, 120)
    ?? firstSentence(summary, 120);
  const categoryHint = nullableText(suggestedFields.categoryHint) ?? nullableText(manual.categoryHint);
  const features = (Array.isArray(details.features) ? details.features : [])
    .flatMap((feature) => (text(feature) ? [text(feature)] : []))
    .slice(0, 12);
  const usage = (Array.isArray(details.usage) ? details.usage : [])
    .flatMap((item) => (text(item) ? [text(item)] : []))
    .slice(0, 10);
  const cautions = (Array.isArray(details.cautions) ? details.cautions : [])
    .flatMap((item) => (text(item) ? [text(item)] : []))
    .slice(0, 10);
  const specifications = (Array.isArray(details.specifications) ? details.specifications : [])
    .flatMap((specification) => {
      const entry = recordValue(specification);
      const label = text(entry?.label);
      const value = text(entry?.value);
      const evidence = text(entry?.evidence);
      return label && value && evidence ? [{ label, value, evidence }] : [];
    })
    .slice(0, 30);
  const oneLine = firstSentence(description, 200) || firstSentence(summary, 200) || name;
  return firstDraftImageProductFactsSchema.parse({
    schemaVersion: firstDraftImagePayloadVersion,
    name,
    category: categoryHint ?? "일반 상품",
    brandName: pick("brandName", "brandName"),
    manufacturer: pick("manufacturer", "manufacturer"),
    countryOfOrigin: pick("countryOfOrigin", "countryOfOrigin"),
    material: pick("material", "material"),
    packageContents: pick("packageContents", "packageContents"),
    description,
    summary,
    oneLine,
    targetCustomer: nullableText(manual.targetCustomer) ?? "",
    features,
    usage,
    cautions,
    specifications,
    classification: {
      displayName: categoryHint ?? "미분류",
      verificationStatus: "needs-review" as const,
      evidence: "1차 상품정보 분석 결과에는 건강기능식품 분류를 확정할 근거가 포함되어 있지 않아 추가 확인 상태로 유지합니다.",
      isHealthFunctionalFood: null,
    },
  });
}

/**
 * Validates one completed, degraded research job and resolves everything the
 * Mac worker needs: the authoritative source original, the six canonical target
 * paths already stored in the result, and the product facts the job carries.
 */
export function buildFirstDraftImageEnqueuePayload(input: {
  jobId: string;
  ownerId: string;
  data: unknown;
  error: unknown;
  manualFields?: unknown;
}):
  | { ok: true; payload: Omit<FirstDraftImageEnqueuePayload, "sourceUrl"> & { sourceUrl: string } }
  | { ok: false; reason: FirstDraftImageRejection } {
  const visible = validateVisibleSucceededProductResearchJob({
    expectedJobId: input.jobId,
    data: input.data,
    error: input.error,
  });
  if (!visible.valid) return { ok: false, reason: visible.reason };

  const job = recordValue(input.data);
  const storedResult = serverProductResearchResultSchema.safeParse(job?.result);
  if (!storedResult.success || storedResult.data.mode !== "server-research") {
    return { ok: false, reason: "preflight_invalid" };
  }
  if (!uuidPattern.test(input.ownerId)) return { ok: false, reason: "identity_mismatch" };

  const lineage = storedResult.data.preflightAssetLineage;
  const assetPaths = storedResult.data.asset_storage_paths;
  if (!lineage || !assetPaths) return { ok: false, reason: "preflight_missing" };
  const degraded = firstDraftImageAssetIds.every(
    (assetId) => lineage[assetId].auditMode === "source-photo-catalog",
  );
  if (!degraded) return { ok: false, reason: "already_generated" };

  const request = recordValue(job?.request)
    ?? recordValue((recordValue(input.data) as { request?: unknown } | null)?.request);
  const researchInput = text(request?.researchInput) || text(request?.research_input);
  const sourcePhotoFingerprint = text(request?.sourcePhotoFingerprint) || text(request?.source_photo_sha256);
  if (researchInput.length < 2 || !lowercaseSha256Pattern.test(sourcePhotoFingerprint)) {
    return { ok: false, reason: "preflight_missing" };
  }

  const preflight = validateSucceededProductResearchPreflight({
    expectedJobId: input.jobId,
    expectedResearchInputSha256: productResearchInputSha256(researchInput),
    expectedSourcePhotoSha256: sourcePhotoFingerprint,
    data: input.data,
  });
  if (!preflight.valid) return { ok: false, reason: preflight.reason };

  const sourcePath = originalStudioImagePath(input.ownerId, input.jobId, 0);
  const manualSpecs = Array.isArray(request?.imageSpecs)
    ? request.imageSpecs.flatMap((spec) => (recordValue(spec) ? [recordValue(spec)!] : []))
    : [];
  const originalSpecPath = text(manualSpecs[0]?.originalPath);
  if (originalSpecPath && originalSpecPath !== sourcePath) {
    return { ok: false, reason: "source_path_unavailable" };
  }

  let productFacts: FirstDraftImageProductFacts;
  try {
    productFacts = productFactsFromResearchResult({
      result: storedResult.data as unknown as Record<string, unknown>,
      manualFields: input.manualFields,
    });
  } catch {
    return { ok: false, reason: "result_invalid" };
  }

  return {
    ok: true,
    payload: {
      jobId: input.jobId,
      sourcePath,
      sourcePhotoSha256: storedResult.data.sourcePhotoSha256!,
      sourceUrl: "",
      completedAssets: [],
      assets: firstDraftImageAssetIds.map((assetId) => ({ id: assetId, path: assetPaths[assetId] })),
      productFacts,
    },
  };
}

/**
 * Rewrites only `preflightAssetLineage` so each digest matches the uploaded
 * bytes and the audit mode records the generated-background composite. Fails
 * closed unless the current result is a readable, degraded research result and
 * the next result still satisfies both stored contracts.
 */
export function buildFirstDraftImageLineageUpdate(input: {
  jobId: string;
  result: unknown;
  digests: Partial<Record<FirstDraftImageAssetId, string>>;
  expectedResearchInputSha256: string;
  expectedSourcePhotoSha256: string;
}):
  | { ok: true; nextResult: Record<string, unknown>; lineage: Record<string, unknown> }
  | { ok: false; reason: FirstDraftImageRejection } {
  const stored = serverProductResearchResultSchema.safeParse(input.result);
  if (!stored.success || !stored.data.preflightAssetLineage || !stored.data.asset_storage_paths) {
    return { ok: false, reason: "result_invalid" };
  }
  const digests = new Map<FirstDraftImageAssetId, string>();
  for (const assetId of firstDraftImageAssetIds) {
    const digest = input.digests[assetId];
    if (typeof digest !== "string" || !lowercaseSha256Pattern.test(digest)) {
      return { ok: false, reason: "submission_invalid" };
    }
    digests.set(assetId, digest);
  }
  if (new Set(digests.values()).size !== firstDraftImageAssetIds.length) {
    return { ok: false, reason: "submission_invalid" };
  }
  if (!firstDraftImageAssetIds.every(
    (assetId) => stored.data.preflightAssetLineage![assetId].auditMode === "source-photo-catalog",
  )) {
    return { ok: false, reason: "not_degraded" };
  }

  const lineage: Record<FirstDraftImageAssetId, Record<string, unknown>> = {} as never;
  for (const assetId of firstDraftImageAssetIds) {
    const previous = stored.data.preflightAssetLineage[assetId];
    const spec = firstDraftImageAssetSpec(assetId)!;
    lineage[assetId] = {
      digest: digests.get(assetId)!,
      role: spec.role,
      auditMode: "segmented-source-composite",
      sourceRole: previous.sourceRole,
      ...(previous.sourceSha256 ? { sourceSha256: previous.sourceSha256 } : {}),
    };
  }
  const nextResult = {
    ...(stored.data as unknown as Record<string, unknown>),
    preflightAssetLineage: lineage,
  };
  const validatedNext = serverProductResearchResultSchema.safeParse(nextResult);
  if (!validatedNext.success) return { ok: false, reason: "next_result_invalid" };
  const nextPreflight = validateSucceededProductResearchPreflight({
    expectedJobId: input.jobId,
    expectedResearchInputSha256: input.expectedResearchInputSha256,
    expectedSourcePhotoSha256: input.expectedSourcePhotoSha256,
    data: { id: input.jobId, kind: "product_research", status: "succeeded", result: nextResult },
  });
  if (!nextPreflight.valid || nextPreflight.preflight.auditLineage.portrait.auditMode !== "segmented-source-composite") {
    return { ok: false, reason: "next_result_invalid" };
  }
  return { ok: true, nextResult, lineage: lineage as unknown as Record<string, unknown> };
}

export function firstDraftImageAppliedAuditMode() {
  return "segmented-source-composite" as const;
}
