import { createHash } from "node:crypto";
import {
  aiGeneratedAssetSpecs,
  coreFirstDraftAssetIds,
  type AiGeneratedAssetId,
} from "./ai-generated-assets";
import {
  resolveProductImageStyleCategory,
  resolveProductSettingShot,
} from "./ai-image-planning";
import { serverProductResearchResultSchema } from "./ai-cli-contract";
import {
  validateSucceededProductResearchPreflight,
  validateVisibleSucceededProductResearchJob,
  type ProductResearchLineageFailure,
} from "./product-studio-lineage";
import { productResearchInputSha256 } from "./product-research-lineage-receipt-core";
import { findDuplicateShot, type ShotFingerprint } from "./image-shot-uniqueness";
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
export const firstDraftImageQualityReceiptVersion = 1;

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

export const firstDraftImageQualityReceiptSchema = z.object({
  version: z.literal(firstDraftImageQualityReceiptVersion),
  auditMode: z.literal("segmented-source-composite"),
  sourcePhotoSha256: z.string().regex(lowercaseSha256Pattern),
  sourceForegroundSha256: z.string().regex(lowercaseSha256Pattern),
  productFactsSha256: z.string().regex(lowercaseSha256Pattern),
  scenePlanSha256: z.string().regex(lowercaseSha256Pattern),
  outputSha256: z.string().regex(lowercaseSha256Pattern),
  visualHash: z.string().regex(/^[a-f0-9]{64}$/),
  checks: z.object({
    sourceComposite: z.literal(true),
    sourcePixelIdentity: z.literal(true),
    sceneSemantic: z.literal(true),
    duplicate: z.literal(true),
  }).strict(),
}).strict();

export type FirstDraftImageQualityReceipt = z.infer<typeof firstDraftImageQualityReceiptSchema>;

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
  completedAssetEvidence: z.array(z.object({
    id: z.enum(firstDraftImageAssetIds),
    path: z.string().min(1).max(400),
    url: z.string().url().max(2_000),
    digest: z.string().regex(lowercaseSha256Pattern),
    verification: firstDraftImageQualityReceiptSchema,
  }).strict()).max(firstDraftImageAssetIds.length).optional().default([]),
  uploadTransport: z.literal("signed-storage-v1").optional(),
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
  const completedIds = value.completedAssetEvidence.map((asset) => asset.id);
  if (new Set(completedIds).size !== completedIds.length
      || completedIds.some((assetId) => !value.completedAssets.includes(assetId))) {
    context.addIssue({ code: "custom", path: ["completedAssetEvidence"], message: "완료된 1차 이미지 증거가 역할 목록과 일치하지 않습니다." });
  }
});

export type FirstDraftImageEnqueuePayload = z.infer<typeof firstDraftImageEnqueuePayloadSchema>;

const firstDraftImageQualityManifestAssetSchema = z.object({
  digest: z.string().regex(lowercaseSha256Pattern),
  verification: firstDraftImageQualityReceiptSchema,
}).strict();

export const firstDraftImageQualityManifestSchema = z.object({
  version: z.literal(firstDraftImageQualityReceiptVersion),
  jobId: z.string().uuid(),
  sourcePhotoSha256: z.string().regex(lowercaseSha256Pattern),
  productFactsSha256: z.string().regex(lowercaseSha256Pattern),
  assets: z.record(z.enum(firstDraftImageAssetIds), firstDraftImageQualityManifestAssetSchema),
}).strict().superRefine((value, context) => {
  const keys = Object.keys(value.assets);
  if (keys.length !== firstDraftImageAssetIds.length
      || firstDraftImageAssetIds.some((assetId) => !Object.hasOwn(value.assets, assetId))) {
    context.addIssue({ code: "custom", path: ["assets"], message: "1차 이미지 품질 manifest에는 정확히 6개 역할이 필요합니다." });
  }
});

export type FirstDraftImageQualityManifest = z.infer<typeof firstDraftImageQualityManifestSchema>;

export const firstDraftImageAssetSubmissionSchema = z.object({
  id: z.enum(firstDraftImageAssetIds),
  pngBase64: z.string().min(1).max(24_000_000),
  verification: firstDraftImageQualityReceiptSchema,
}).strict();

export const firstDraftImageStagedAssetSchema = z.object({
  id: z.enum(firstDraftImageAssetIds),
  path: z.string().min(1).max(400),
  digest: z.string().regex(lowercaseSha256Pattern),
  bytes: z.number().int().min(1).max(16 * 1024 * 1024),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  verification: firstDraftImageQualityReceiptSchema,
}).strict();

export function isExactFirstDraftImageReplay(previous: unknown, incoming: unknown) {
  const stored = firstDraftImageStagedAssetSchema.safeParse(previous);
  const candidate = firstDraftImageStagedAssetSchema.safeParse(incoming);
  return stored.success && candidate.success
    && stored.data.id === candidate.data.id
    && stored.data.path === candidate.data.path
    && stored.data.digest === candidate.data.digest
    && stored.data.bytes === candidate.data.bytes
    && stored.data.width === candidate.data.width
    && stored.data.height === candidate.data.height
    && JSON.stringify(stored.data.verification) === JSON.stringify(candidate.data.verification);
}

export const firstDraftImageUploadAuthorizationSchema = z.object({
  jobId: z.string().uuid(),
  authorizeUpload: firstDraftImageStagedAssetSchema,
}).strict();

/**
 * The worker submits one or more verified assets per call. Submitting the six
 * canonical ids in one call is still valid; the route adopts them once all six
 * are recorded, so a retried or split submission stays idempotent.
 */
export const firstDraftImageSubmissionSchema = z.object({
  jobId: z.string().uuid(),
  assets: z.array(z.union([
    firstDraftImageAssetSubmissionSchema,
    firstDraftImageStagedAssetSchema,
  ])).min(1).max(firstDraftImageAssetIds.length),
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
  | z.infer<typeof firstDraftImageSubmissionSchema>
  | z.infer<typeof firstDraftImageUploadAuthorizationSchema>
  | { jobId: string; failed: true; reason: string };

export const firstDraftImageWorkerPostSchema: z.ZodType<FirstDraftImageWorkerPost> = z.union([
  firstDraftImageSubmissionSchema,
  firstDraftImageUploadAuthorizationSchema,
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

function normalizedFactText(value: unknown) {
  return text(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
}

export function firstDraftImageFactsMatchStudioResult(
  productFacts: FirstDraftImageProductFacts,
  result: Pick<ProductStudioResult, "product">,
) {
  const facts = firstDraftImageProductFactsSchema.parse(productFacts);
  const requiredFeatures = new Set(facts.features.map(normalizedFactText).filter(Boolean));
  const finalFeatures = new Set(result.product.features.map(normalizedFactText).filter(Boolean));
  return normalizedFactText(facts.name) === normalizedFactText(result.product.name)
    && normalizedFactText(facts.category) === normalizedFactText(result.product.category)
    && facts.classification.isHealthFunctionalFood === result.product.classification.isHealthFunctionalFood
    && requiredFeatures.size === finalFeatures.size
    && [...requiredFeatures].every((feature) => finalFeatures.has(feature));
}

export function firstDraftImageFactsMatchStudioRequest(
  productFacts: FirstDraftImageProductFacts,
  manualFields: unknown,
) {
  const facts = firstDraftImageProductFactsSchema.parse(productFacts);
  const manual = recordValue(manualFields);
  if (!manual) return false;
  const exactPairs: Array<[unknown, unknown]> = [
    [facts.name, manual.productName],
    [facts.category, manual.categoryHint],
    [facts.brandName, manual.brandName],
    [facts.manufacturer, manual.manufacturer],
    [facts.countryOfOrigin, manual.countryOfOrigin],
    [facts.material, manual.material],
    [facts.packageContents, manual.packageContents],
    [facts.description, manual.description],
  ];
  return exactPairs.every(([expected, actual]) => normalizedFactText(expected) === normalizedFactText(actual));
}

export function firstDraftImageScenePlansMatchStudioResult(
  productFacts: FirstDraftImageProductFacts,
  result: Pick<ProductStudioResult, "product">,
) {
  const firstDraft = buildFirstDraftStudioResult(productFacts);
  return firstDraftImageAssetIds.every((assetId) => {
    const expected = resolveProductSettingShot(firstDraft, assetId);
    const actual = resolveProductSettingShot(result as ProductStudioResult, assetId);
    return Boolean(expected && actual && canonicalSha256(expected) === canonicalSha256(actual));
  });
}

export function firstDraftImageProductFactsFromResearchResult(input: {
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function firstDraftImageProductFactsSha256(productFacts: FirstDraftImageProductFacts) {
  return canonicalSha256(firstDraftImageProductFactsSchema.parse(productFacts));
}

export function firstDraftImageScenePlanSha256(
  productFacts: FirstDraftImageProductFacts,
  assetId: FirstDraftImageAssetId,
) {
  const studioResult = buildFirstDraftStudioResult(productFacts);
  const spec = firstDraftImageAssetSpec(assetId);
  const settingShot = resolveProductSettingShot(studioResult, assetId);
  if (!spec || !settingShot) throw new Error(`${assetId} 1차 이미지 장면 계획을 확인하지 못했습니다.`);
  return canonicalSha256({
    assetId,
    categoryStyleId: resolveProductImageStyleCategory(studioResult).id,
    product: studioResult.product,
    role: spec.role,
    purpose: spec.purpose,
    shotClass: spec.shotClass,
    ratio: spec.ratio,
    width: spec.width,
    height: spec.height,
    settingShot,
  });
}

export function buildFirstDraftImageQualityReceipt(input: {
  assetId: FirstDraftImageAssetId;
  productFacts: FirstDraftImageProductFacts;
  sourcePhotoSha256: string;
  sourceForegroundSha256: string;
  outputSha256: string;
  visualHash: Uint8Array;
  sourceCompositeVerified: boolean;
  sourcePixelIdentityVerified: boolean;
  sceneSemanticVerified: boolean;
  duplicateVerified: boolean;
}): FirstDraftImageQualityReceipt {
  if (input.visualHash.byteLength !== 32) {
    throw new Error(`${input.assetId} 1차 이미지 dHash 검수 증거가 올바르지 않습니다.`);
  }
  return firstDraftImageQualityReceiptSchema.parse({
    version: firstDraftImageQualityReceiptVersion,
    auditMode: "segmented-source-composite",
    sourcePhotoSha256: input.sourcePhotoSha256,
    sourceForegroundSha256: input.sourceForegroundSha256,
    productFactsSha256: firstDraftImageProductFactsSha256(input.productFacts),
    scenePlanSha256: firstDraftImageScenePlanSha256(input.productFacts, input.assetId),
    outputSha256: input.outputSha256,
    visualHash: Buffer.from(input.visualHash).toString("hex"),
    checks: {
      sourceComposite: input.sourceCompositeVerified,
      sourcePixelIdentity: input.sourcePixelIdentityVerified,
      sceneSemantic: input.sceneSemanticVerified,
      duplicate: input.duplicateVerified,
    },
  });
}

export function validateFirstDraftImageQualityReceipt(input: {
  assetId: FirstDraftImageAssetId;
  productFacts: FirstDraftImageProductFacts;
  sourcePhotoSha256: string;
  outputSha256?: string;
  receipt: unknown;
}) {
  const parsed = firstDraftImageQualityReceiptSchema.safeParse(input.receipt);
  if (!parsed.success) return false;
  return parsed.data.sourcePhotoSha256 === input.sourcePhotoSha256
    && parsed.data.productFactsSha256 === firstDraftImageProductFactsSha256(input.productFacts)
    && parsed.data.scenePlanSha256 === firstDraftImageScenePlanSha256(input.productFacts, input.assetId)
    && (!input.outputSha256 || parsed.data.outputSha256 === input.outputSha256);
}

export function validateFirstDraftImageQualityReceiptSet(input: {
  productFacts: FirstDraftImageProductFacts;
  sourcePhotoSha256: string;
  verifiedAssets: unknown;
}):
  | { valid: true; receipts: Record<FirstDraftImageAssetId, FirstDraftImageQualityReceipt> }
  | { valid: false; reason: "missing" | "invalid" | "duplicate" } {
  const stored = recordValue(input.verifiedAssets);
  if (!stored) return { valid: false, reason: "missing" };
  const receipts = {} as Record<FirstDraftImageAssetId, FirstDraftImageQualityReceipt>;
  const fingerprints: ShotFingerprint[] = [];
  for (const assetId of firstDraftImageAssetIds) {
    const asset = recordValue(stored[assetId]);
    const digest = text(asset?.digest);
    const parsed = firstDraftImageQualityReceiptSchema.safeParse(asset?.verification);
    if (!digest || !parsed.success || !validateFirstDraftImageQualityReceipt({
      assetId,
      productFacts: input.productFacts,
      sourcePhotoSha256: input.sourcePhotoSha256,
      outputSha256: digest,
      receipt: parsed.data,
    })) return { valid: false, reason: "invalid" };
    const fingerprint = {
      assetId,
      digest,
      visualHash: Buffer.from(parsed.data.visualHash, "hex"),
    };
    if (findDuplicateShot(fingerprint, fingerprints)) {
      return { valid: false, reason: "duplicate" };
    }
    fingerprints.push(fingerprint);
    receipts[assetId] = parsed.data;
  }
  return { valid: true, receipts };
}

export function firstDraftImageQualityManifestPath(
  jobId: string,
  assetPaths: Record<FirstDraftImageAssetId, string>,
) {
  const prefixes = firstDraftImageAssetIds.map((assetId) => {
    const spec = firstDraftImageAssetSpec(assetId);
    const path = assetPaths[assetId];
    if (!spec || typeof path !== "string" || !path.endsWith(`/${spec.file}`)) return "";
    return path.slice(0, -spec.file.length);
  });
  if (!uuidPattern.test(jobId)
      || prefixes.some((prefix) => !prefix)
      || new Set(prefixes).size !== 1
      || !prefixes[0].startsWith(`results/${jobId}/claims/`)) return null;
  return `${prefixes[0]}first-draft-quality-v1.json`;
}

export function firstDraftImageQualityManifestPathFromAsset(
  jobId: string,
  assetId: FirstDraftImageAssetId,
  assetPath: string,
) {
  const spec = firstDraftImageAssetSpec(assetId);
  if (!uuidPattern.test(jobId)
      || !spec
      || !assetPath.endsWith(`/${spec.file}`)) return null;
  const prefix = assetPath.slice(0, -spec.file.length);
  return prefix.startsWith(`results/${jobId}/claims/`)
    ? `${prefix}first-draft-quality-v1.json`
    : null;
}

export function buildFirstDraftImageQualityManifest(input: {
  jobId: string;
  productFacts: FirstDraftImageProductFacts;
  sourcePhotoSha256: string;
  verifiedAssets: unknown;
}) {
  const verified = validateFirstDraftImageQualityReceiptSet(input);
  if (!verified.valid) return null;
  const stored = recordValue(input.verifiedAssets)!;
  return firstDraftImageQualityManifestSchema.parse({
    version: firstDraftImageQualityReceiptVersion,
    jobId: input.jobId,
    sourcePhotoSha256: input.sourcePhotoSha256,
    productFactsSha256: firstDraftImageProductFactsSha256(input.productFacts),
    assets: Object.fromEntries(firstDraftImageAssetIds.map((assetId) => [assetId, {
      digest: text(recordValue(stored[assetId])?.digest),
      verification: verified.receipts[assetId],
    }])),
  });
}

export function validateFirstDraftImageQualityManifest(input: {
  jobId: string;
  productFacts: FirstDraftImageProductFacts;
  sourcePhotoSha256: string;
  assetDigests: Record<FirstDraftImageAssetId, string>;
  manifest: unknown;
}) {
  const parsed = firstDraftImageQualityManifestSchema.safeParse(input.manifest);
  if (!parsed.success
      || parsed.data.jobId !== input.jobId
      || parsed.data.sourcePhotoSha256 !== input.sourcePhotoSha256
      || parsed.data.productFactsSha256 !== firstDraftImageProductFactsSha256(input.productFacts)) return false;
  return firstDraftImageAssetIds.every((assetId) => {
    const asset = parsed.data.assets[assetId];
    return asset.digest === input.assetDigests[assetId]
      && validateFirstDraftImageQualityReceipt({
        assetId,
        productFacts: input.productFacts,
        sourcePhotoSha256: input.sourcePhotoSha256,
        outputSha256: asset.digest,
        receipt: asset.verification,
      });
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
    productFacts = firstDraftImageProductFactsFromResearchResult({
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
      completedAssetEvidence: [],
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
