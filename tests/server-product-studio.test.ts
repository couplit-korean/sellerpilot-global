import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import {
  aiGeneratedAssetPath,
  aiGeneratedAssetSpecs,
  coreFirstDraftAssetIds,
  remainingFinalAssetIds,
} from "../lib/ai-generated-assets";
import { cliStudioResultSchema, requiredLocalizedMarkets } from "../lib/ai-cli-contract";
import type { AiGatewayFailureDiagnostic } from "../lib/ai-gateway-failure";
import {
  assertPortableAudit,
  buildReviewedServerStudioFallbackMaster,
  buildPortableProductCutout,
  buildServerImageAuditReference,
  buildServerSourceDerivedAsset,
  buildServerSourceEvidencePanel,
  buildServerStudioMasterPrompt,
  normalizeServerStudioMasterContract,
  resolveServerAssetSource,
  runOneServerProductStudio,
  SERVER_PRODUCT_STUDIO_IMAGE_MODEL,
  SERVER_PRODUCT_STUDIO_TEXT_MODEL,
  ServerProductStudioError,
  serverStudioAllowsReviewedTransientFallback,
  serverStudioRequestMode,
  serverStudioSegmentationAllowsCatalogFallback,
  serverStudioRemoteWorkPlan,
  type ServerStudioSource,
} from "../lib/server-product-studio";
import {
  hasPrescriptiveIntakeInstruction,
  hasUnsupportedGeneralFoodEfficacyClaim,
} from "../lib/product-classification";
import {
  buildDifferenceHash,
  MINIMUM_SHOT_HASH_DISTANCE,
  visualHashDistance,
} from "../lib/image-shot-uniqueness";
import {
  planStudioLocalizedChunks,
  studioMasterDetailImageRoleIssue,
  type StudioLocalizedTarget,
} from "../lib/studio-segment-generation";

const MASTER_SECTION_TYPES = [
  "benefit", "story", "howto", "proof", "spec", "caution", "comparison", "faq", "notice",
  "benefit", "story", "howto", "proof", "spec", "caution", "comparison",
] as const;
const MASTER_LAYOUTS = ["split", "full-bleed", "cards", "steps", "spec-grid", "editorial"] as const;
const LOCALIZED_SECTION_TYPES = ["overview", "feature", "howto", "spec", "routine", "contents", "care", "proof"] as const;
const LOCALIZED_SECTION_ASSETS = [
  "detail-overview", "detail-feature", "detail-use", "detail-package",
  "detail-routine", "detail-contents", "detail-care", "detail-material",
] as const;

test("server Studio uses GPT-5.5 for text and preserves GPT Image 2", () => {
  assert.equal(SERVER_PRODUCT_STUDIO_TEXT_MODEL, "openai/gpt-5.5");
  assert.equal(SERVER_PRODUCT_STUDIO_IMAGE_MODEL, "openai/gpt-image-2");
});

function testMasterResult() {
  const detailAssets = aiGeneratedAssetSpecs.filter((asset) => asset.role === "detail").map((asset) => asset.id);
  assert.equal(detailAssets.length, 12);
  return {
    mode: "cli" as const,
    product: {
      name: "Portable verified desk organizer",
      category: "Office organization",
      classification: {
        displayName: "Desk organization product",
        verificationStatus: "verified" as const,
        evidence: "The seller source visibly confirms one portable organizer product.",
        isHealthFunctionalFood: false,
      },
      oneLine: "A source-verified organizer for an ordinary desk.",
      targetCustomer: "People arranging small items on a work surface.",
      features: ["Visible outer shell", "Single-product form", "Portable footprint", "Source-backed finish"],
      cautions: ["Dimensions require seller confirmation.", "Only the visibly supplied item is included."],
    },
    design: {
      themeName: "Verified workspace",
      creativeStrategy: {
        designArchetype: "proof-led" as const,
        purchaseDecision: "Whether the visible form and supplied quantity match the buyer's desk organization need.",
        contentDensity: "long" as const,
        targetSectionCount: 16,
        lengthRationale: "Sixteen distinct questions cover visible form, use, evidence, care, fit and ordering boundaries.",
        differentiationKey: "Each section answers one separately verified purchase question.",
        artDirection: "Use restrained practical workspaces and source-backed product evidence without invented labels.",
        motionPolicy: "static-first" as const,
      },
      palette: { primary: "#252525", accent: "#976942", surface: "#f5f2ec", text: "#171717" },
      heroCopy: "Organize with visible evidence",
      heroSubcopy: "A practical product story limited to facts supplied by the seller.",
      cta: "Review verified details",
      sections: MASTER_SECTION_TYPES.map((type, index) => {
        const unique = Array.from({ length: 40 }, (_, token) => `section${index}fact${token}`).join(" ");
        const question = Array.from({ length: 6 }, (_, token) => `s${index}q${token}unique`).join(" ");
        return {
          type,
          buyerQuestion: `Does ${question} resolve?`,
          evidence: `Seller evidence record ${index} supports only the separately visible fact for this section.`,
          eyebrow: `VERIFIED ${index + 1}`,
          title: `section${index}distinct section${index}purchase section${index}checkpoint`,
          body: `${unique}. This bounded explanation uses only seller-confirmed evidence and keeps unknown measurements or hidden structure outside the claim.`,
          points: [
            `section${index}pointalpha section${index}visiblealpha section${index}factalpha`,
            `section${index}pointbeta section${index}sellerbeta section${index}boundarybeta`,
            `section${index}pointgamma section${index}buyergamma section${index}decisiongamma`,
          ],
          layout: MASTER_LAYOUTS[index % MASTER_LAYOUTS.length],
          imageAsset: detailAssets[index] ?? "none",
          visualDirection: `Create role ${index + 1} as a distinct evidence-led composition without invented text or hidden structure.`,
          motion: index % 3 === 0 ? "none" as const : index % 3 === 1 ? "reveal" as const : "stagger" as const,
        };
      }),
    },
    thumbnail: {
      headline: "Verified desk organizer",
      subline: "One source-backed product",
      badge: "Seller checked",
    },
    warnings: [],
  };
}

function localizedPhrase(locale: string) {
  if (locale === "ko-KR") return "검증된 상품 정보";
  if (locale === "ja-JP") return "確認済み商品情報";
  if (locale === "th-TH") return "ข้อมูลสินค้าที่ตรวจสอบแล้ว";
  if (locale === "zh-TW" || locale === "zh-HK") return "已驗證商品資訊";
  if (locale === "vi-VN") return "Thông tin sản phẩm đã xác nhận";
  if (locale === "pt-BR") return "Informação verificada do produto";
  if (locale === "es-MX") return "Información verificada del producto";
  return "Verified product information";
}

function localizedListing(target: StudioLocalizedTarget) {
  const phrase = localizedPhrase(target.locale);
  const repeated = Array.from({ length: 6 }, () => phrase).join(". ");
  return {
    ...target,
    title: `${phrase} ${target.market}`,
    shortDescription: `${phrase}. ${phrase}.`,
    description: `${phrase}. ${phrase}. ${phrase}.`,
    keywords: [phrase, `${phrase} item`, `${phrase} details`],
    thumbnailAltText: `${phrase} ${target.market}`,
    classification: {
      displayName: `${phrase} category`,
      verificationStatus: "verified" as const,
      evidence: `${phrase}. ${phrase}. Seller evidence.`,
      isHealthFunctionalFood: false,
    },
    detailSections: LOCALIZED_SECTION_TYPES.map((type, index) => ({
      type,
      buyerQuestion: `${phrase} ${index + 1}? ${phrase}?`,
      evidence: `${phrase}. ${phrase}. ${index + 1}.`,
      heading: `${phrase} ${index + 1}`,
      body: `${repeated}. Section ${index + 1}.`,
      imageAsset: LOCALIZED_SECTION_ASSETS[index],
      imageAltText: `${phrase} ${index + 1}`,
    })),
  };
}

function passingPortableAudit() {
  return {
    sameProduct: true,
    samePackageCount: true,
    brandCaseMatches: true,
    quantityUnitMatches: true,
    assignedSceneVisible: true,
    exactlyOneProduct: true,
    backgroundContainsResidualProductOrPackage: false,
    productEdgesNatural: true,
    evidencePanelIntact: true,
    referenceHasReadableText: false,
    candidateHasReadableText: false,
    referenceTokens: [],
    requiredTokens: [],
    candidateTokens: [],
    unsupportedTokens: [],
    missingTokens: [],
  };
}

function reviewedFallbackManualFields() {
  return {
    researchInput: "롯데샌드 파인애플 맛 과자",
    productName: "롯데샌드 파인애플",
    sellerSku: "QA-LOTTE-SAND",
    categoryHint: "일반식품 과자",
    brandName: "롯데",
    manufacturer: "롯데웰푸드",
    countryOfOrigin: "대한민국",
    material: "판매자가 실물에서 확인한 과자 원재료 표시",
    packageContents: "낱개 포장 1개",
    condition: "NEW" as const,
    gtinStatus: "NO_GTIN" as const,
    gtin: "",
    sellingPrice: 5_000,
    currency: "KRW" as const,
    stock: 1,
    weightKg: 0.1,
    packageLengthCm: 20,
    packageWidthCm: 15,
    packageHeightCm: 5,
    shippingFeeKrw: 3_000,
    shippingRule: "판매자 확인 기본 배송",
    packagingRule: "판매자 확인 완충 포장",
    description: "판매자가 실물과 대조해 확인한 롯데샌드 파인애플 맛 과자 상품 설명입니다.",
    productUrl: "",
    imageRightsConfirmed: true as const,
    productFactsConfirmed: true as const,
  };
}

test("server master normalization repairs presentation metadata without changing seller-backed copy", () => {
  const alreadyValid = testMasterResult();
  assert.equal(normalizeServerStudioMasterContract(alreadyValid), alreadyValid);

  const master = testMasterResult();
  master.design.creativeStrategy.targetSectionCount = 20;
  master.design.sections = master.design.sections.map((section, index) => ({
    ...section,
    type: "benefit" as const,
    layout: "split" as const,
    imageAsset: index < 12 ? "detail-overview" as const : "none" as const,
  }));
  const sellerBackedCopy = master.design.sections.map((section) => ({
    buyerQuestion: section.buyerQuestion,
    evidence: section.evidence,
    eyebrow: section.eyebrow,
    title: section.title,
    body: section.body,
    points: section.points,
    visualDirection: section.visualDirection,
  }));

  const normalized = normalizeServerStudioMasterContract(master);

  assert.deepEqual(
    normalized.design.sections.map((section) => ({
      buyerQuestion: section.buyerQuestion,
      evidence: section.evidence,
      eyebrow: section.eyebrow,
      title: section.title,
      body: section.body,
      points: section.points,
      visualDirection: section.visualDirection,
    })),
    sellerBackedCopy,
  );
  assert.equal(normalized.design.creativeStrategy.targetSectionCount, normalized.design.sections.length);
  assert.deepEqual(
    [...new Set(normalized.design.sections.map((section) => section.type))].sort(),
    [...MASTER_SECTION_TYPES.slice(0, 9)].sort(),
  );
  assert.equal(studioMasterDetailImageRoleIssue(normalized), "");
  assert.ok(new Set(normalized.design.sections.map((section) => section.layout)).size >= 5);
  normalized.design.sections.forEach((section, index, sections) => {
    if (index > 0) assert.notEqual(section.layout, sections[index - 1]?.layout);
  });
  assert.deepEqual(normalizeServerStudioMasterContract(normalized), normalized);

  const noneBeforeDuplicate = testMasterResult();
  noneBeforeDuplicate.design.sections = noneBeforeDuplicate.design.sections.map((section, index) => ({
    ...section,
    imageAsset: index === 11
      ? "none" as const
      : index === 12
        ? "detail-overview" as const
        : section.imageAsset,
  }));
  assert.equal(
    studioMasterDetailImageRoleIssue(normalizeServerStudioMasterContract(noneBeforeDuplicate)),
    "",
  );
});

async function patternedBackground(
  width: number,
  height: number,
  key: string,
  productColour = "#d63b30",
  coverProductZones = false,
) {
  const digest = createHash("sha256").update(key).digest();
  const columns = 17;
  const rows = 16;
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const channel = digest[index % digest.length] ^ ((index * 73) & 255);
    const value = 35 + (channel % 190);
    const x = Math.floor((index % columns) * width / columns);
    const y = Math.floor(Math.floor(index / columns) * height / rows);
    const cellWidth = Math.ceil(width / columns) + 1;
    const cellHeight = Math.ceil(height / rows) + 1;
    return `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="rgb(${value},${value},${value})"/>`;
  }).join("");
  const protectedZones = coverProductZones
    ? [
      `<rect x="${Math.floor(width * 0.08)}" y="${Math.floor(height * 0.10)}" width="${Math.ceil(width * 0.62)}" height="${Math.ceil(height * 0.74)}" fill="${productColour}"/>`,
      `<rect x="${Math.floor(width * 0.18)}" y="${Math.floor(height * 0.14)}" width="${Math.ceil(width * 0.56)}" height="${Math.ceil(height * 0.70)}" fill="${productColour}"/>`,
    ].join("")
    : "";
  return sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${cells}${protectedZones}</svg>`,
  )).png().toBuffer();
}

async function firstDraftPreflightFixture(
  researchJobId: string,
  claimToken: string,
  sourcePhotoSha256: string,
  overrides: Partial<Record<(typeof coreFirstDraftAssetIds)[number], Uint8Array>> = {},
) {
  const paths: Record<string, string> = {};
  const digests: Record<string, string> = {};
  const lineage: Record<string, {
    digest: string;
    role: "creative" | "detail";
    auditMode: "segmented-source-composite" | "source-photo-catalog";
    sourceRole: string;
  }> = {};
  const bytesByPath = new Map<string, Uint8Array>();
  for (const [index, assetId] of coreFirstDraftAssetIds.entries()) {
    const asset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === assetId);
    assert.ok(asset);
    const bytes = overrides[assetId] ?? await patternedBackground(
      asset.width,
      asset.height,
      `preflight:${assetId}:${index}`,
      ["#cf3328", "#19674f", "#273f79", "#7a3d92", "#a86418", "#176b83"][index],
      true,
    );
    const path = aiGeneratedAssetPath(researchJobId, asset, claimToken);
    const digest = createHash("sha256").update(bytes).digest("hex");
    paths[assetId] = path;
    digests[assetId] = digest;
    lineage[assetId] = {
      digest,
      role: asset.role,
      auditMode: "segmented-source-composite",
      sourceRole: "main",
    };
    bytesByPath.set(path, new Uint8Array(bytes));
  }
  return {
    request: {
      source_research_job_id: researchJobId,
      source_photo_sha256: sourcePhotoSha256,
      preflight_version: 1,
      preflight_asset_storage_paths: paths,
      preflight_asset_digests: digests,
      preflight_asset_audit_lineage: lineage,
    },
    bytesByPath,
  };
}

async function runReviewedTransientPipelineFixture(options: {
  requestMode?: "reviewed" | "marker-mismatch" | "legacy";
  providerScenario?: "all-transient" | "segmentation-transient" | "partial-localization-transient" | "mixed-localization-transient" | "classification-mismatch" | "classification-copy-contradiction" | "reordered-localization" | "race-contract-and-transient" | "partial-image-transient" | "image-rate-limit-circuit" | "queued-image-timeout-budget";
  transientReason?: string;
  corruptPreflightAssetId?: (typeof coreFirstDraftAssetIds)[number];
  duplicatePreflightAsset?: boolean;
  sourcePhotoHashMismatch?: boolean;
  uploadFailureReason?: string;
  runtimeTimeoutMs?: number;
  remoteCallDelayMs?: number;
  transientDiagnostic?: AiGatewayFailureDiagnostic;
} = {}) {
  const jobId = "41414141-4141-4141-8141-414141414141";
  const claimToken = "42424242-4242-4242-8242-424242424242";
  const userId = "43434343-4343-4343-8343-434343434343";
  const researchJobId = "44414141-4141-4141-8141-414141414141";
  const researchClaimToken = "45454545-4545-4545-8545-454545454545";
  const normalizedPath = `${userId}/${jobId}/input/001.jpg`;
  const originalPath = `${userId}/${jobId}/original/001.source`;
  const manual = reviewedFallbackManualFields();
  const sourceBytes = await patternedBackground(
    1200,
    1200,
    "reviewed-transient-source",
    "#d7462f",
    true,
  );
  const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
  const preflight = await firstDraftPreflightFixture(
    researchJobId,
    researchClaimToken,
    sourceDigest,
  );
  if (options.duplicatePreflightAsset) {
    const sourceAssetId = "detail-overview" as const;
    const duplicateAssetId = "detail-use" as const;
    const sourcePath = preflight.request.preflight_asset_storage_paths[sourceAssetId];
    const duplicatePath = preflight.request.preflight_asset_storage_paths[duplicateAssetId];
    const duplicateBytes = preflight.bytesByPath.get(sourcePath);
    assert.ok(duplicateBytes);
    const digest = preflight.request.preflight_asset_digests[sourceAssetId];
    preflight.bytesByPath.set(duplicatePath, duplicateBytes);
    preflight.request.preflight_asset_digests[duplicateAssetId] = digest;
    preflight.request.preflight_asset_audit_lineage[duplicateAssetId].digest = digest;
  }
  if (options.sourcePhotoHashMismatch) {
    preflight.request.source_photo_sha256 = "0".repeat(64);
  }
  const corruptAsset = options.corruptPreflightAssetId
    ? aiGeneratedAssetSpecs.find((asset) => asset.id === options.corruptPreflightAssetId)
    : null;
  const corruptedPreflightBytes = corruptAsset
    ? await patternedBackground(
      corruptAsset.width,
      corruptAsset.height,
      `reviewed-corrupt:${corruptAsset.id}`,
      "#2b69c7",
      true,
    )
    : null;
  const baseRequest = {
    description: manual.description,
    product_url: manual.productUrl,
    research_input: manual.researchInput,
    manual_fields: manual,
    image_paths: [normalizedPath],
    image_specs: [{
      name: "001.jpg",
      role: "main",
      originalName: "source.png",
      originalBytes: sourceBytes.byteLength,
      originalMediaType: "image/png",
      originalPath,
      originalWidth: 1200,
      originalHeight: 1200,
      width: 1200,
      height: 1200,
      bytes: Math.min(sourceBytes.byteLength, 3 * 1024 * 1024),
      mediaType: "image/jpeg",
      fit: "contain",
    }],
  };
  const requestMode = options.requestMode ?? "reviewed";
  const request = requestMode === "legacy"
    ? baseRequest
    : {
      ...baseRequest,
      ...preflight.request,
      human_review_confirmation: {
        first_draft_reviewed: true,
        source: "authenticated_admin_request",
        source_research_job_id: requestMode === "reviewed"
          ? researchJobId
          : "46464646-4646-4646-8646-464646464646",
      },
    };
  const uploaded = new Map<string, Uint8Array>();
  const completionCalls: Record<string, unknown>[] = [];
  const logs: Array<{ stage: string; details: Record<string, string | number | boolean> }> = [];
  let structuredCalls = 0;
  const structuredChunkCalls: string[] = [];
  const localizedPrompts: string[] = [];
  let segmentationCalls = 0;
  let backgroundCalls = 0;
  let auditCalls = 0;
  let activeRemoteCalls = 0;
  let peakRemoteCalls = 0;
  let imageRateLimitObserved = false;
  let imageCallsStartedAfterRateLimit = 0;
  const backgroundAssetIds: string[] = [];
  const backgroundSignalsAbortedOnEntry: boolean[] = [];
  const completionActiveRemoteCounts: number[] = [];
  const wakeActiveRemoteCounts: number[] = [];
  let wakeCalls = 0;
  const auditedCandidateDigests = new Map<string, string[]>();
  const transientReason = options.transientReason ?? "gateway_rate_limited";
  const transientError = () => new ServerProductStudioError(
    transientReason,
    false,
    options.transientDiagnostic,
  );
  const providerScenario = options.providerScenario ?? "all-transient";
  const observeRemoteCall = async <Result>(work: () => Promise<Result> | Result) => {
    activeRemoteCalls += 1;
    peakRemoteCalls = Math.max(peakRemoteCalls, activeRemoteCalls);
    try {
      if (options.remoteCallDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.remoteCallDelayMs));
      }
      return await work();
    } finally {
      activeRemoteCalls -= 1;
    }
  };
  const validSegmentation = {
    containsSingleProduct: true,
    touchesFrame: false,
    foregroundConfidence: 0.99,
    edgeConfidence: 0.99,
    polygons: [{
      points: [
        { x: 0.24, y: 0.24 }, { x: 0.37, y: 0.24 }, { x: 0.50, y: 0.24 },
        { x: 0.63, y: 0.24 }, { x: 0.76, y: 0.24 }, { x: 0.76, y: 0.50 },
        { x: 0.76, y: 0.76 }, { x: 0.63, y: 0.76 }, { x: 0.50, y: 0.76 },
        { x: 0.37, y: 0.76 }, { x: 0.24, y: 0.76 }, { x: 0.24, y: 0.50 },
      ],
    }],
  };

  const response = await runOneServerProductStudio({
    tokenHash: "f".repeat(64),
    runtimeTimeoutMs: options.runtimeTimeoutMs ?? 120_000,
    rpc: async (name, arguments_ = {}) => {
      if (name === "sellerpilot_claim_product_ai_job") {
        return {
          data: {
            id: jobId,
            claim_token: claimToken,
            kind: "product_studio",
            claim_scope: "product",
            request,
          },
          error: null,
        };
      }
      if (name === "sellerpilot_touch_ai_job") return { data: "running", error: null };
      if (name === "sellerpilot_complete_ai_job_with_image_context") {
        completionActiveRemoteCounts.push(activeRemoteCalls);
        completionCalls.push(structuredClone(arguments_));
      }
      return { data: true, error: null };
    },
    download: async (path) => {
      if (path === originalPath) return sourceBytes;
      const bytes = preflight.bytesByPath.get(path);
      if (!bytes) return assert.fail(`unexpected source path: ${path}`);
      if (options.corruptPreflightAssetId
          && path === preflight.request.preflight_asset_storage_paths[options.corruptPreflightAssetId]) {
        return corruptedPreflightBytes ?? assert.fail("missing corrupted preflight fixture");
      }
      return bytes;
    },
    upload: async (path, bytes) => {
      if (options.uploadFailureReason) {
        throw new ServerProductStudioError(options.uploadFailureReason, true);
      }
      uploaded.set(path, new Uint8Array(bytes));
      return "uploaded";
    },
    generateStructured: async (input) => observeRemoteCall(async () => {
      structuredCalls += 1;
      if (providerScenario === "all-transient") {
        throw transientError();
      }
      if (input.tags.includes("feature:product-studio-master")) {
        return input.schema.parse({
          ...buildReviewedServerStudioFallbackMaster(manual),
          warnings: [],
        });
      }
      const chunkTag = input.tags.find((tag) => tag.startsWith("chunk:"));
      assert.ok(chunkTag);
      structuredChunkCalls.push(chunkTag);
      localizedPrompts.push(input.prompt);
      const chunkNumber = Number(chunkTag.slice("chunk:".length));
      if (providerScenario === "queued-image-timeout-budget" && chunkNumber <= 3) {
        await new Promise((resolve) => setTimeout(resolve, 60));
      } else if (providerScenario === "image-rate-limit-circuit" && chunkNumber <= 3) {
        await new Promise((resolve) => setTimeout(resolve, chunkNumber === 1 ? 5 : 40));
      }
      if ((providerScenario === "partial-localization-transient" && chunkTag === "chunk:2")
          || (providerScenario === "mixed-localization-transient" && chunkNumber >= 4)
          || (providerScenario === "race-contract-and-transient" && chunkTag === "chunk:2")) {
        throw transientError();
      }
      const targets = planStudioLocalizedChunks(4)[chunkNumber - 1];
      assert.ok(targets);
      const outputTargets = providerScenario === "reordered-localization"
        ? [...targets].reverse()
        : targets;
      return input.schema.parse({
        localizedListings: outputTargets.map((target, targetIndex) => {
          const effectiveTarget = providerScenario === "race-contract-and-transient"
              && chunkTag === "chunk:1" && targetIndex > 0
            ? targets[0]
            : target;
          assert.ok(effectiveTarget);
          const listing = localizedListing(effectiveTarget);
          if (providerScenario === "classification-mismatch") return listing;
          if (providerScenario === "classification-copy-contradiction") {
            return {
              ...listing,
              classification: {
                ...listing.classification,
                verificationStatus: "needs-review" as const,
                isHealthFunctionalFood: null,
              },
            };
          }
          return {
            ...listing,
            classification: {
              ...listing.classification,
              verificationStatus: "needs-review" as const,
              isHealthFunctionalFood: null,
            },
          };
        }),
      });
    }),
    segmentSource: async () => observeRemoteCall(async () => {
      segmentationCalls += 1;
      if (providerScenario !== "partial-image-transient"
          && providerScenario !== "image-rate-limit-circuit"
          && providerScenario !== "queued-image-timeout-budget") {
        throw transientError();
      }
      return { segmentation: validSegmentation, segmentationSource: sourceBytes };
    }),
    generateBackground: async ({ asset, signal }) => observeRemoteCall(async () => {
      backgroundSignalsAbortedOnEntry.push(signal.aborted);
      if (imageRateLimitObserved) imageCallsStartedAfterRateLimit += 1;
      backgroundCalls += 1;
      backgroundAssetIds.push(asset.id);
      if (providerScenario === "image-rate-limit-circuit") {
        imageRateLimitObserved = true;
        throw transientError();
      }
      if (providerScenario === "queued-image-timeout-budget") {
        throw transientError();
      }
      if (providerScenario !== "partial-image-transient") {
        return assert.fail("reviewed segmentation fallback must not invoke image generation");
      }
      return patternedBackground(asset.width, asset.height, `partial:${asset.id}`, "#d7462f", true);
    }),
    auditImage: async ({ assetId, candidate }) => observeRemoteCall(async () => {
      if (imageRateLimitObserved) imageCallsStartedAfterRateLimit += 1;
      auditCalls += 1;
      if (providerScenario === "image-rate-limit-circuit"
          || providerScenario === "queued-image-timeout-budget") return passingPortableAudit();
      if (providerScenario !== "partial-image-transient") {
        return assert.fail("deterministic source-photo assets must not invoke remote vision audit");
      }
      auditedCandidateDigests.set(assetId, [
        ...(auditedCandidateDigests.get(assetId) ?? []),
        createHash("sha256").update(candidate).digest("hex"),
      ]);
      if (assetId === "detail-material") throw transientError();
      return passingPortableAudit();
    }),
    wakeNext: async () => {
      wakeCalls += 1;
      wakeActiveRemoteCounts.push(activeRemoteCalls);
    },
    logError: (stage, details) => logs.push({ stage, details }),
  });

  return {
    response,
    jobId,
    claimToken,
    manual,
    sourceBytes,
    preflight,
    uploaded,
    completionCalls,
    logs,
    structuredCalls,
    structuredChunkCalls,
    localizedPrompts,
    segmentationCalls,
    backgroundCalls,
    auditCalls,
    peakRemoteCalls,
    imageCallsStartedAfterRateLimit,
    backgroundAssetIds,
    backgroundSignalsAbortedOnEntry,
    completionActiveRemoteCounts,
    wakeActiveRemoteCounts,
    wakeCalls,
    auditedCandidateDigests,
  };
}

test("final server Studio restores six assets and plans only the remaining 2+8 roles", () => {
  const plan = serverStudioRemoteWorkPlan();
  assert.deepEqual(plan.settingWaves, [2]);
  assert.deepEqual(plan.sourceAuditWaves, [3, 3, 2]);
  assert.deepEqual(plan.localizedWaves, [3, 3, 3]);
  assert.equal(plan.maximumRemoteConcurrency, 3);
  assert.ok([
    ...plan.settingWaves,
    ...plan.sourceAuditWaves,
    ...plan.localizedWaves,
  ].every((wave) => wave <= plan.maximumRemoteConcurrency));
});

test("new registration requires the complete preflight while revisions and queued legacy jobs remain executable", async () => {
  const jobId = "12121212-1212-4121-8121-121212121212";
  const userId = "13131313-1313-4131-8131-131313131313";
  const baseRequest = {
    description: "Existing product revision remains compatible.",
    product_url: "",
    research_input: "existing product revision",
    manual_fields: { categoryHint: "Office organization" },
    image_paths: [`${userId}/${jobId}/input/001.jpg`],
    image_specs: [{
      name: "001.jpg",
      role: "main",
      originalName: "source.png",
      originalBytes: 2_000,
      originalMediaType: "image/png",
      originalPath: `${userId}/${jobId}/original/001.source`,
      originalWidth: 1_200,
      originalHeight: 1_200,
      width: 1_200,
      height: 1_200,
      bytes: 1_000,
      mediaType: "image/jpeg",
      fit: "contain",
    }],
  };
  assert.equal(serverStudioRequestMode({
    ...baseRequest,
    revision_mode: "replace_product_assets",
    revision_product_id: "14141414-1414-4141-8141-141414141414",
  }), "legacy");
  assert.equal(serverStudioRequestMode({
    ...baseRequest,
    source_research_job_id: "15151515-1515-4151-8151-151515151515",
    source_photo_sha256: "a".repeat(64),
  }), "legacy", "a job queued by the previous release must not become terminal after deployment");

  const preflight = await firstDraftPreflightFixture(
    "16161616-1616-4161-8161-161616161616",
    "17171717-1717-4171-8171-171717171717",
    "b".repeat(64),
  );
  assert.equal(serverStudioRequestMode({ ...baseRequest, ...preflight.request }), "preflight");
  for (const marker of [
    "preflight_version",
    "preflight_asset_storage_paths",
    "preflight_asset_digests",
    "preflight_asset_audit_lineage",
  ] as const) {
    assert.equal(serverStudioRequestMode({ ...baseRequest, [marker]: preflight.request[marker] }), "invalid");
  }
});

test("localization terminal contract covers 34 channel markets and exactly 26 countries", () => {
  const entries = Object.entries(requiredLocalizedMarkets);
  assert.equal(entries.length, 34);
  assert.equal(new Set(entries.map(([key]) => key.split(":")[1])).size, 26);
  assert.deepEqual(entries.filter(([key]) => /^ebay:(AT|BE|CH|HK|IE|NL|PL)$/.test(key)), [
    ["ebay:AT", "de-AT"],
    ["ebay:BE", "nl-BE"],
    ["ebay:CH", "de-CH"],
    ["ebay:HK", "zh-HK"],
    ["ebay:IE", "en-IE"],
    ["ebay:NL", "nl-NL"],
    ["ebay:PL", "pl-PL"],
  ]);
});

test("portable segmentation keeps only opaque product pixels and trims the transparent background", async () => {
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
  const cutout = await buildPortableProductCutout({
    segmentation: {
      containsSingleProduct: true,
      touchesFrame: false,
      foregroundConfidence: 0.99,
      edgeConfidence: 0.98,
      polygons: [{ points }],
    },
    segmentationSource: source,
  });
  const metadata = await sharp(cutout).metadata();
  assert.ok((metadata.width ?? 0) >= 405 && (metadata.width ?? 0) <= 415);
  assert.ok((metadata.height ?? 0) >= 405 && (metadata.height ?? 0) <= 415);
  assert.notEqual(metadata.width, 1024, "an opaque background mask would fail to trim");
  const centre = await sharp(cutout).extract({
    left: Math.floor((metadata.width ?? 1) / 2),
    top: Math.floor((metadata.height ?? 1) / 2),
    width: 1,
    height: 1,
  }).raw().toBuffer();
  assert.ok(centre[0] > 240 && centre[1] < 16 && centre[2] < 16 && centre[3] > 240);
});

test("source evidence roles remain visually distinct even when they share one source", async () => {
  const sourceBytes = await sharp({
    create: { width: 1200, height: 1200, channels: 3, background: "#f8efe2" },
  }).composite([{
    input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect x="150" y="90" width="570" height="940" rx="70" fill="#c23b2e"/><circle cx="820" cy="310" r="170" fill="#163d63"/><path d="M80 1080 L1100 780" stroke="#1f8a70" stroke-width="80"/></svg>'),
  }]).png().toBuffer();
  const source: ServerStudioSource = {
    path: "source",
    role: "main",
    name: "source.png",
    mediaType: "image/png",
    bytes: sourceBytes,
  };
  const specs = aiGeneratedAssetSpecs.filter((asset) => asset.identityPolicy.mode === "source-evidence");
  const outputs = await Promise.all(specs.map((asset) => buildServerSourceDerivedAsset(asset, source, sourceBytes, 1)));
  assert.equal(new Set(outputs.map((bytes) => createHash("sha256").update(bytes).digest("hex"))).size, specs.length);
  const hashes = await Promise.all(outputs.map(async (bytes) => buildDifferenceHash(
    await sharp(bytes).resize(17, 16, { fit: "fill" }).grayscale().raw().toBuffer(),
    17,
    16,
  )));
  for (let left = 0; left < hashes.length; left += 1) {
    for (let right = left + 1; right < hashes.length; right += 1) {
      assert.ok(
        visualHashDistance(hashes[left], hashes[right]) >= MINIMUM_SHOT_HASH_DISTANCE,
        `${specs[left].id} and ${specs[right].id} must not be near duplicates`,
      );
    }
  }
});

test("cover evidence audits the exact role crop embedded in the candidate", async () => {
  const sourceBytes = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: "#f6f1e8" },
  }).composite([{
    input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect x="80" y="90" width="520" height="720" fill="#b83228"/><rect x="680" y="120" width="840" height="180" fill="#173d66"/><text x="720" y="245" font-size="110" font-family="Arial" fill="#fff">BRAND 60 g</text><circle cx="1120" cy="600" r="210" fill="#21865e"/></svg>'),
  }]).png().toBuffer();
  const source: ServerStudioSource = {
    path: "cover-source",
    role: "label",
    name: "cover-source.png",
    mediaType: "image/png",
    bytes: sourceBytes,
  };
  const asset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === "detail-material");
  assert.ok(asset && asset.identityPolicy.mode === "source-evidence" && asset.identityPolicy.fit === "cover");
  const variant = 2;
  const panel = await buildServerSourceEvidencePanel(asset, source, variant);
  const auditReference = await buildServerImageAuditReference(asset, source, variant);
  const candidate = await buildServerSourceDerivedAsset(asset, source, sourceBytes, variant);
  assert.equal(createHash("sha256").update(auditReference.bytes).digest("hex"), createHash("sha256").update(panel.bytes).digest("hex"));
  assert.notEqual(createHash("sha256").update(auditReference.bytes).digest("hex"), createHash("sha256").update(source.bytes).digest("hex"));
  const [panelPixels, candidatePanelPixels] = await Promise.all([
    sharp(panel.bytes).removeAlpha().raw().toBuffer(),
    sharp(candidate).extract({ left: panel.left, top: panel.top, width: panel.width, height: panel.height }).removeAlpha().raw().toBuffer(),
  ]);
  assert.deepEqual(candidatePanelPixels, panelPixels, "the audited cover crop must be embedded byte-for-byte at the evidence-panel pixel boundary");
});

test("source catalog requires natural cutout edges without pretending it is an evidence panel", () => {
  const audit = {
    sameProduct: true,
    samePackageCount: true,
    brandCaseMatches: true,
    quantityUnitMatches: true,
    assignedSceneVisible: false,
    exactlyOneProduct: true,
    backgroundContainsResidualProductOrPackage: false,
    productEdgesNatural: true,
    evidencePanelIntact: false,
    referenceHasReadableText: false,
    candidateHasReadableText: false,
    referenceTokens: [],
    requiredTokens: [],
    candidateTokens: [],
    unsupportedTokens: [],
    missingTokens: [],
  };
  assert.doesNotThrow(() => assertPortableAudit(audit, "source-catalog"));
  assert.throws(
    () => assertPortableAudit({ ...audit, productEdgesNatural: false }, "source-catalog"),
    /portable_image_identity_audit_failed/u,
  );
  assert.throws(
    () => assertPortableAudit(audit, "source-evidence"),
    /portable_image_identity_audit_failed/u,
  );
});

test("source-photo catalog fallback is limited to deterministic segmentation quality failures", () => {
  assert.equal(
    serverStudioSegmentationAllowsCatalogFallback(
      new ServerProductStudioError("product_segmentation_low_confidence", true),
    ),
    true,
  );
  assert.equal(
    serverStudioSegmentationAllowsCatalogFallback(
      new ServerProductStudioError("product_segmentation_area_invalid", true),
    ),
    true,
  );
  for (const reason of [
    "gateway_authentication_error",
    "gateway_result_invalid",
    "server_studio_runtime_timeout",
    "source_image_metadata_mismatch",
  ]) {
    assert.equal(
      serverStudioSegmentationAllowsCatalogFallback(new ServerProductStudioError(reason, true)),
      false,
      `${reason} must remain fail-closed`,
    );
  }
  assert.equal(serverStudioSegmentationAllowsCatalogFallback(new Error("network timeout")), false);
  for (const reason of [
    "gateway_rate_limited",
    "gateway_billing_required",
    "gateway_timeout",
    "gateway_customer_verification_required",
  ]) {
    assert.equal(
      serverStudioAllowsReviewedTransientFallback(new ServerProductStudioError(reason)),
      true,
      `${reason} is the exact reviewed-input emergency allowlist`,
    );
    assert.equal(
      serverStudioAllowsReviewedTransientFallback(new ServerProductStudioError(reason, true)),
      false,
      `${reason} marked terminal must remain fail-closed`,
    );
  }
  for (const reason of [
    "gateway_authentication_error",
    "gateway_forbidden",
    "gateway_model_not_found",
    "gateway_request_failed",
    "gateway_result_invalid",
    "runtime_timeout",
    "source_image_metadata_mismatch",
  ]) {
    assert.equal(
      serverStudioAllowsReviewedTransientFallback(new ServerProductStudioError(reason)),
      false,
      `${reason} must never enter the reviewed-input fallback`,
    );
  }
});

test("reviewed transient gateway failure completes an exact 16-asset deterministic Studio result and preserves the approved first six bytes", async () => {
  const run = await runReviewedTransientPipelineFixture();
  assert.equal(run.response.status, 200);
  assert.deepEqual(
    await run.response.json(),
    { ok: true, status: "succeeded", processed: 1 },
    JSON.stringify({ logs: run.logs, completion: run.completionCalls.at(-1) }),
  );
  assert.equal(run.logs.length, 0);
  assert.equal(run.structuredCalls, 1, "only the master provider call should be attempted before deterministic localization");
  assert.equal(run.segmentationCalls, 1);
  assert.equal(run.backgroundCalls, 0);
  assert.equal(run.auditCalls, 0);
  assert.equal(run.completionCalls.length, 1);
  assert.equal(run.completionCalls[0].p_status, "succeeded");
  const resultPayload = run.completionCalls[0].p_result_payload as Record<string, unknown>;
  const parsed = cliStudioResultSchema.safeParse(resultPayload);
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
  assert.ok(parsed.data.design.sections.length >= 16 && parsed.data.design.sections.length <= 20);
  assert.equal(parsed.data.localizedListings.length, 34);
  assert.equal(parsed.data.product.name, run.manual.productName);
  const koreanListing = parsed.data.localizedListings.find((listing) => listing.locale === "ko-KR");
  assert.ok(koreanListing);
  const koreanCopy = JSON.stringify(koreanListing);
  assert.match(koreanCopy, new RegExp(run.manual.productName, "u"));
  assert.match(koreanCopy, new RegExp(run.manual.brandName, "u"));
  assert.match(koreanCopy, new RegExp(run.manual.packageContents, "u"));
  parsed.data.localizedListings.forEach((listing) => {
    const copy = JSON.stringify(listing);
    assert.match(copy, /5000 KRW/u, `${listing.channel}:${listing.market} must preserve the reviewed price`);
    assert.match(copy, /20 x 15 x 5 cm \/ 0\.1 kg/u, `${listing.channel}:${listing.market} must preserve reviewed dimensions`);
    assert.match(copy, /QA-LOTTE-SAND/u, `${listing.channel}:${listing.market} must preserve the reviewed product identity`);
  });
  assert.ok(parsed.data.warnings.some((warning) => /gateway_rate_limited.*검수한 입력만 사용해 16개 상세 섹션/u.test(warning)));
  assert.ok(parsed.data.warnings.some((warning) => /사람이 승인한 1차 이미지 6장은 그대로 보존/u.test(warning)));
  assert.equal(hasUnsupportedGeneralFoodEfficacyClaim(JSON.stringify(parsed.data)), false);
  assert.equal(hasPrescriptiveIntakeInstruction(JSON.stringify(parsed.data)), false);
  const sectionAssetsByTitle = Object.fromEntries(parsed.data.design.sections.map((section) => [
    section.title,
    section.imageAsset,
  ]));
  assert.deepEqual({
    "검수된 상품명부터 대조": sectionAssetsByTitle["검수된 상품명부터 대조"],
    "판매 구성과 촬영 소품 구별": sectionAssetsByTitle["판매 구성과 촬영 소품 구별"],
    "소재·성분은 실물 표시 우선": sectionAssetsByTitle["소재·성분은 실물 표시 우선"],
    "포장 단위 수치 한눈에 확인": sectionAssetsByTitle["포장 단위 수치 한눈에 확인"],
  }, {
    "검수된 상품명부터 대조": "detail-overview",
    "판매 구성과 촬영 소품 구별": "detail-contents",
    "소재·성분은 실물 표시 우선": "detail-material",
    "포장 단위 수치 한눈에 확인": "detail-dimensions",
  });
  assert.equal(run.uploaded.size, aiGeneratedAssetSpecs.length);
  assert.equal(Object.keys(resultPayload.asset_storage_paths as Record<string, string>).length, 16);

  const auditModes = resultPayload.asset_audit_modes as Record<string, string>;
  for (const assetId of coreFirstDraftAssetIds) {
    const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(spec);
    const sourcePath = run.preflight.request.preflight_asset_storage_paths[assetId];
    const finalPath = aiGeneratedAssetPath(run.jobId, spec, run.claimToken);
    const sourceBytes = run.preflight.bytesByPath.get(sourcePath);
    const finalBytes = run.uploaded.get(finalPath);
    assert.ok(sourceBytes && finalBytes);
    assert.deepEqual(finalBytes, sourceBytes, `${assetId} must remain byte-identical after final upload`);
    assert.equal(
      createHash("sha256").update(finalBytes).digest("hex"),
      run.preflight.request.preflight_asset_digests[assetId],
    );
    assert.equal(auditModes[assetId], "segmented-source-composite");
  }
  for (const assetId of remainingFinalAssetIds) {
    const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(spec);
    const finalBytes = run.uploaded.get(aiGeneratedAssetPath(run.jobId, spec, run.claimToken));
    assert.ok(finalBytes);
    const metadata = await sharp(finalBytes, { failOn: "warning", limitInputPixels: 16_000_000 }).metadata();
    assert.deepEqual(
      { width: metadata.width, height: metadata.height, format: metadata.format },
      { width: spec.width, height: spec.height, format: "png" },
    );
    assert.equal(auditModes[assetId], "source-photo-catalog");
  }
  const uploadedDigests = [...run.uploaded.values()].map((bytes) => (
    createHash("sha256").update(bytes).digest("hex")
  ));
  assert.equal(new Set(uploadedDigests).size, 16, "fallback must not accept exact duplicate output assets");
  const uploadedHashes = new Map(await Promise.all(aiGeneratedAssetSpecs.map(async (spec) => {
    const bytes = run.uploaded.get(aiGeneratedAssetPath(run.jobId, spec, run.claimToken));
    assert.ok(bytes);
    return [spec.id, buildDifferenceHash(
      await sharp(bytes).resize(17, 16, { fit: "fill" }).grayscale().raw().toBuffer(),
      17,
      16,
    )] as const;
  })));
  for (const finalAssetId of remainingFinalAssetIds) {
    const finalHash = uploadedHashes.get(finalAssetId);
    assert.ok(finalHash);
    for (const [otherAssetId, otherHash] of uploadedHashes) {
      if (otherAssetId === finalAssetId) continue;
      assert.ok(
        visualHashDistance(finalHash, otherHash) >= MINIMUM_SHOT_HASH_DISTANCE,
        `${finalAssetId} must remain visually distinct from ${otherAssetId}`,
      );
    }
  }
  assert.deepEqual(resultPayload.deterministic_fallback, {
    reviewedInputOnly: true,
    masterReason: "gateway_rate_limited",
    localizationReasons: ["master_transient_fallback"],
    imageReason: "gateway_rate_limited",
  });
});

test("successful reviewed fallback logs one bounded Gateway diagnostic without another provider attempt", async () => {
  const diagnostic: AiGatewayFailureDiagnostic = {
    reason: "gateway_rate_limited",
    httpStatus: 429,
    limitKind: "provider_image_rate_limit",
    retryAfterMs: 12_000,
    generationId: "gen_01SAFEFALLBACK",
    requestId: "req_safe_fallback",
    upstreamProviderAttempted: true,
  };
  const run = await runReviewedTransientPipelineFixture({ transientDiagnostic: diagnostic });
  assert.equal(run.response.status, 200);
  assert.equal(run.structuredCalls, 1, "the diagnostic path must not add a provider retry");
  assert.equal(run.segmentationCalls, 1, "the existing parallel segmentation attempt remains the only other provider call");
  assert.deepEqual(run.logs, [{
    stage: "gateway_fallback",
    details: {
      reason: "gateway_rate_limited",
      status: 429,
      limitKind: "provider_image_rate_limit",
      retryAfterMs: 12_000,
      generationId: "gen_01SAFEFALLBACK",
      requestId: "req_safe_fallback",
      upstreamProviderAttempted: true,
      kind: "product_studio",
      fallbackPath: "master",
      fallbackCount: 2,
    },
  }]);
  assert.equal(run.completionCalls.length, 1);
  assert.equal(run.completionCalls[0].p_status, "succeeded");
});

test("master success plus a transient segmentation outage keeps normal text and exposes the deterministic ten-image warning", async () => {
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "segmentation-transient",
  });
  assert.deepEqual(
    await run.response.json(),
    { ok: true, status: "succeeded", processed: 1 },
    JSON.stringify({ logs: run.logs, completion: run.completionCalls.at(-1) }),
  );
  assert.equal(run.backgroundCalls, 0);
  assert.equal(run.auditCalls, 0);
  const completion = run.completionCalls.at(-1);
  assert.equal(completion?.p_status, "succeeded");
  const payload = completion?.p_result_payload as {
    warnings: string[];
    deterministic_fallback: Record<string, unknown>;
    asset_audit_modes: Record<string, string>;
    localizedListings: Array<{
      classification: { verificationStatus: string; isHealthFunctionalFood: boolean | null };
    }>;
  };
  assert.equal(payload.deterministic_fallback.masterReason, null);
  assert.deepEqual(payload.deterministic_fallback.localizationReasons, []);
  assert.equal(payload.deterministic_fallback.imageReason, "gateway_rate_limited");
  assert.ok(payload.warnings.some((warning) => /gateway_rate_limited.*나머지 10장은 AI 생성 이미지가 아니라 원본 사진 기반/u.test(warning)));
  assert.equal(run.localizedPrompts.length, 9);
  run.localizedPrompts.forEach((prompt) => {
    assert.match(prompt, /verificationStatus는 needs-review, isHealthFunctionalFood는 null/u);
  });
  payload.localizedListings.forEach((listing) => {
    assert.equal(listing.classification.verificationStatus, "needs-review");
    assert.equal(listing.classification.isHealthFunctionalFood, null);
  });
  remainingFinalAssetIds.forEach((assetId) => assert.equal(payload.asset_audit_modes[assetId], "source-photo-catalog"));
});

test("one transient localization chunk atomically replaces all countries from reviewed facts", async () => {
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "partial-localization-transient",
  });
  assert.deepEqual(
    await run.response.json(),
    { ok: true, status: "succeeded", processed: 1 },
    JSON.stringify({ logs: run.logs, completion: run.completionCalls.at(-1) }),
  );
  const completion = run.completionCalls.at(-1);
  assert.equal(completion?.p_status, "succeeded");
  const payload = completion?.p_result_payload as {
    warnings: string[];
    localizedListings: Array<{ channel: string; market: string; description: string }>;
    deterministic_fallback: { localizationReasons: string[] };
  };
  assert.deepEqual(payload.deterministic_fallback.localizationReasons, ["gateway_rate_limited"]);
  assert.ok(payload.warnings.some((warning) => /34개 채널·국가 문안 전체/u.test(warning)));
  assert.equal(payload.localizedListings.length, 34);
  assert.ok(payload.localizedListings.every((listing) => /5000 KRW/u.test(listing.description)));
  assert.deepEqual([...run.structuredChunkCalls].sort(), ["chunk:1", "chunk:2", "chunk:3"]);
});

test("a transient localization batch atomically replaces earlier AI chunks and stops later remote chunks", async () => {
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "mixed-localization-transient",
  });
  assert.deepEqual(
    await run.response.json(),
    { ok: true, status: "succeeded", processed: 1 },
    JSON.stringify({ logs: run.logs, completion: run.completionCalls.at(-1) }),
  );
  const completion = run.completionCalls.at(-1);
  assert.equal(completion?.p_status, "succeeded");
  const payload = completion?.p_result_payload as {
    warnings: string[];
    localizedListings: Array<{
      channel: string;
      market: string;
      description: string;
      classification: { verificationStatus: string; isHealthFunctionalFood: boolean | null };
    }>;
    asset_storage_paths: Record<string, string>;
    deterministic_fallback: { localizationReasons: string[] };
  };
  const parsed = cliStudioResultSchema.safeParse(payload);
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
  assert.equal(payload.localizedListings.length, 34);
  assert.deepEqual(
    new Set(payload.localizedListings.map((listing) => `${listing.channel}:${listing.market}`)),
    new Set(Object.keys(requiredLocalizedMarkets)),
  );
  assert.equal(Object.keys(payload.asset_storage_paths).length, 16);
  assert.equal(run.structuredCalls, 7, "one master plus the first two localization batches must run without retries");
  assert.deepEqual(
    [...run.structuredChunkCalls].sort(),
    ["chunk:1", "chunk:2", "chunk:3", "chunk:4", "chunk:5", "chunk:6"],
    "chunks after the first transient batch must not be remotely scheduled",
  );
  assert.deepEqual(payload.deterministic_fallback.localizationReasons, ["gateway_rate_limited"]);
  assert.ok(payload.warnings.some((warning) => /34개 채널·국가 문안 전체.*gateway_rate_limited/u.test(warning)));
  payload.localizedListings.forEach((listing) => {
    assert.match(listing.description, /5000 KRW/u, "every target must be rebuilt from the same reviewed facts");
    assert.equal(listing.classification.verificationStatus, "needs-review");
    assert.equal(listing.classification.isHealthFunctionalFood, null);
  });
});

test("a classification contradiction discards AI copy instead of relabeling contradictory evidence", async () => {
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "classification-mismatch",
  });
  assert.deepEqual(await run.response.json(), { ok: true, status: "succeeded", processed: 1 });
  const completion = run.completionCalls.at(-1);
  assert.equal(completion?.p_status, "succeeded");
  const payload = completion?.p_result_payload as {
    warnings: string[];
    localizedListings: Array<{
      description: string;
      classification: { evidence: string; verificationStatus: string; isHealthFunctionalFood: boolean | null };
    }>;
    deterministic_fallback: { localizationReasons: string[] };
  };
  assert.deepEqual(payload.deterministic_fallback.localizationReasons, ["studio_localization_contract_invalid"]);
  assert.ok(payload.warnings.some((warning) => /34개 채널·국가 문안 전체.*studio_localization_contract_invalid/u.test(warning)));
  assert.deepEqual([...run.structuredChunkCalls].sort(), ["chunk:1", "chunk:2", "chunk:3"]);
  payload.localizedListings.forEach((listing) => {
    assert.match(listing.description, /5000 KRW/u);
    assert.doesNotMatch(listing.classification.evidence, /Verified product information/u);
    assert.equal(listing.classification.verificationStatus, "needs-review");
    assert.equal(listing.classification.isHealthFunctionalFood, null);
  });
});

test("a transient sibling and a contract-invalid sibling never launch a provider repair attempt", async () => {
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "race-contract-and-transient",
  });
  assert.deepEqual(await run.response.json(), { ok: true, status: "succeeded", processed: 1 });
  const completion = run.completionCalls.at(-1);
  assert.equal(completion?.p_status, "succeeded");
  const payload = completion?.p_result_payload as {
    localizedListings: Array<{ description: string }>;
    deterministic_fallback: { localizationReasons: string[] };
  };
  assert.equal(payload.localizedListings.length, 34);
  assert.ok(payload.localizedListings.every((listing) => /5000 KRW/u.test(listing.description)));
  assert.deepEqual([...run.structuredChunkCalls].sort(), ["chunk:1", "chunk:2", "chunk:3"]);
  assert.ok(run.structuredChunkCalls.every((tag) => run.structuredChunkCalls.indexOf(tag) === run.structuredChunkCalls.lastIndexOf(tag)));
  assert.ok(payload.deterministic_fallback.localizationReasons.length >= 1);
});

test("reviewed classification copy is derived from trusted facts even when AI flags look valid", async () => {
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "classification-copy-contradiction",
  });
  assert.deepEqual(await run.response.json(), { ok: true, status: "succeeded", processed: 1 });
  const completion = run.completionCalls.at(-1);
  assert.equal(completion?.p_status, "succeeded");
  const payload = completion?.p_result_payload as {
    localizedListings: Array<{
      classification: {
        displayName: string;
        evidence: string;
        verificationStatus: string;
        isHealthFunctionalFood: boolean | null;
      };
    }>;
    deterministic_fallback: { localizationReasons: string[] };
  };
  assert.equal(payload.localizedListings.length, 34);
  assert.deepEqual(payload.deterministic_fallback.localizationReasons, []);
  assert.equal(run.structuredChunkCalls.length, 9);
  payload.localizedListings.forEach((listing) => {
    assert.doesNotMatch(listing.classification.displayName, /Verified product information/u);
    assert.doesNotMatch(listing.classification.evidence, /Verified product information/u);
    assert.equal(listing.classification.verificationStatus, "needs-review");
    assert.equal(listing.classification.isHealthFunctionalFood, null);
  });
});

test("reviewed classification copy follows the exact channel market locale key after AI reorders a chunk", async () => {
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "reordered-localization",
  });
  assert.deepEqual(await run.response.json(), { ok: true, status: "succeeded", processed: 1 });
  const completion = run.completionCalls.at(-1);
  assert.equal(completion?.p_status, "succeeded");
  const payload = completion?.p_result_payload as {
    localizedListings: Array<{
      channel: string;
      market: string;
      locale: string;
      classification: { evidence: string; verificationStatus: string; isHealthFunctionalFood: boolean | null };
    }>;
    deterministic_fallback: { localizationReasons: string[] };
  };
  assert.equal(payload.localizedListings.length, 34);
  assert.deepEqual(payload.deterministic_fallback.localizationReasons, []);
  assert.equal(run.structuredChunkCalls.length, 9);
  payload.localizedListings.forEach((listing) => {
    assert.equal(listing.classification.verificationStatus, "needs-review");
    assert.equal(listing.classification.isHealthFunctionalFood, null);
    assert.ok(listing.classification.evidence.length >= 10);
  });
});

test("a transient image failure after remote candidates exist discards every partial final asset and rebuilds all ten deterministically", async () => {
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "partial-image-transient",
  });
  assert.deepEqual(await run.response.json(), { ok: true, status: "succeeded", processed: 1 });
  assert.ok(run.backgroundCalls >= 2);
  assert.ok(run.auditCalls >= 4);
  assert.ok(run.auditedCandidateDigests.size >= 4);
  const completion = run.completionCalls.at(-1);
  assert.equal(completion?.p_status, "succeeded");
  const payload = completion?.p_result_payload as {
    warnings: string[];
    deterministic_fallback: Record<string, unknown>;
    asset_audit_modes: Record<string, string>;
  };
  assert.equal(payload.deterministic_fallback.imageReason, "gateway_rate_limited");
  assert.ok(payload.warnings.some((warning) => /사람이 승인한 1차 이미지 6장은 그대로 보존/u.test(warning)));
  for (const assetId of remainingFinalAssetIds) {
    const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(spec);
    const uploadedBytes = run.uploaded.get(aiGeneratedAssetPath(run.jobId, spec, run.claimToken));
    assert.ok(uploadedBytes);
    const uploadedDigest = createHash("sha256").update(uploadedBytes).digest("hex");
    assert.equal(payload.asset_audit_modes[assetId], "source-photo-catalog");
    assert.equal(
      run.auditedCandidateDigests.get(assetId)?.includes(uploadedDigest) ?? false,
      false,
      `${assetId} must not retain a partial remote candidate after another lane fails`,
    );
  }
});

test("the shared remote gate caps all lanes at three and one image 429 cancels queued siblings", async () => {
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "image-rate-limit-circuit",
  });
  assert.deepEqual(await run.response.json(), { ok: true, status: "succeeded", processed: 1 });
  assert.equal(run.peakRemoteCalls, 3, "text and image lanes must remain concurrent up to the shared cap");
  assert.deepEqual(
    run.backgroundAssetIds,
    ["detail-storage"],
    "the first image 429 must cancel the queued sibling before it reaches the provider",
  );
  assert.equal(run.imageCallsStartedAfterRateLimit, 0);
  assert.equal(run.backgroundCalls, 1, "the failed image must not receive a blind retry");

  const completion = run.completionCalls.at(-1);
  assert.equal(completion?.p_status, "succeeded");
  const payload = completion?.p_result_payload as {
    asset_storage_paths: Record<string, string>;
    asset_audit_modes: Record<string, string>;
    deterministic_fallback: { imageReason: string };
  };
  assert.equal(Object.keys(payload.asset_storage_paths).length, aiGeneratedAssetSpecs.length);
  assert.equal(run.uploaded.size, aiGeneratedAssetSpecs.length);
  assert.equal(payload.deterministic_fallback.imageReason, "gateway_rate_limited");

  for (const assetId of coreFirstDraftAssetIds) {
    const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(spec);
    const sourcePath = run.preflight.request.preflight_asset_storage_paths[assetId];
    const restoredBytes = run.preflight.bytesByPath.get(sourcePath);
    const uploadedBytes = run.uploaded.get(aiGeneratedAssetPath(run.jobId, spec, run.claimToken));
    assert.ok(restoredBytes && uploadedBytes);
    assert.deepEqual(uploadedBytes, restoredBytes, `${assetId} must remain byte-identical`);
  }
  for (const assetId of remainingFinalAssetIds) {
    assert.equal(payload.asset_audit_modes[assetId], "source-photo-catalog");
  }
});

test("a queued image receives its full operation timeout only after the shared gate grants a permit", async (context) => {
  const originalTimeout = AbortSignal.timeout;
  context.mock.method(AbortSignal, "timeout", (delay: number) => (
    originalTimeout(delay === 40_000 ? 20 : delay)
  ));
  const run = await runReviewedTransientPipelineFixture({
    providerScenario: "queued-image-timeout-budget",
  });
  assert.deepEqual(
    await run.response.json(),
    { ok: true, status: "succeeded", processed: 1 },
    JSON.stringify({ logs: run.logs, completion: run.completionCalls.at(-1) }),
  );
  assert.equal(run.peakRemoteCalls, 3);
  assert.equal(run.backgroundCalls, 1, "the first queued background must reach the provider before its 429 trips the circuit");
  assert.equal(
    run.backgroundSignalsAbortedOnEntry.every((aborted) => aborted === false),
    true,
    "the 20ms injected execution budget must start after, not during, the 60ms queue wait",
  );
  const payload = run.completionCalls.at(-1)?.p_result_payload as {
    asset_storage_paths: Record<string, string>;
    deterministic_fallback: { imageReason: string };
  };
  assert.equal(Object.keys(payload.asset_storage_paths).length, aiGeneratedAssetSpecs.length);
  assert.equal(payload.deterministic_fallback.imageReason, "gateway_rate_limited");
});

test("reviewed general-food efficacy or intake claims remain fail-closed instead of entering the emergency fallback", () => {
  assert.throws(
    () => buildReviewedServerStudioFallbackMaster({
      ...reviewedFallbackManualFields(),
      description: "판매자가 입력한 일반 과자이며 면역력 개선에 도움을 주고 하루 2개 섭취하도록 안내합니다.",
    }),
    /reviewed_general_food_claim_requires_manual_correction/u,
  );
});

test("transient gateway failures remain terminal for marker-mismatched and legacy jobs", async () => {
  for (const requestMode of ["marker-mismatch", "legacy"] as const) {
    const run = await runReviewedTransientPipelineFixture({ requestMode });
    assert.equal(run.response.status, 200);
    assert.deepEqual(await run.response.json(), { ok: false, status: "failed", processed: 1 });
    assert.equal(run.uploaded.size, 0);
    assert.equal(run.completionCalls.length, 1);
    assert.equal(run.completionCalls[0].p_status, "failed");
    assert.equal(run.completionCalls[0].p_error_message, "gateway_rate_limited");
    assert.equal(run.logs.at(-1)?.details.reason, "gateway_rate_limited");
  }
});

test("a hard first-draft restore failure settles active providers before completion and next-claim wake", async () => {
  const run = await runReviewedTransientPipelineFixture({
    corruptPreflightAssetId: "portrait",
    remoteCallDelayMs: 40,
  });
  assert.equal(run.response.status, 200);
  assert.deepEqual(await run.response.json(), { ok: false, status: "failed", processed: 1 });
  assert.equal(run.peakRemoteCalls, 2, "master and segmentation should prove the initial provider overlap");
  assert.deepEqual(run.completionActiveRemoteCounts, [0]);
  assert.deepEqual(run.wakeActiveRemoteCounts, [0]);
  assert.equal(run.wakeCalls, 1);
  assert.equal(run.uploaded.size, 0);
  assert.equal(run.completionCalls.length, 1);
  assert.equal(run.completionCalls[0].p_status, "failed");
  assert.equal(run.completionCalls[0].p_error_message, "preflight_asset_digest_mismatch");
});

test("reviewed transient fallback rejects exact duplicates inside the approved first six", async () => {
  const run = await runReviewedTransientPipelineFixture({ duplicatePreflightAsset: true });
  assert.deepEqual(await run.response.json(), { ok: false, status: "failed", processed: 1 });
  assert.equal(run.uploaded.size, 0);
  assert.equal(run.completionCalls[0].p_status, "failed");
  assert.equal(run.completionCalls[0].p_error_message, "preflight_asset_exact_duplicate");
});

test("reviewed transient fallback rejects a main source whose sha no longer matches the reviewed first stage", async () => {
  const run = await runReviewedTransientPipelineFixture({ sourcePhotoHashMismatch: true });
  assert.deepEqual(await run.response.json(), { ok: false, status: "failed", processed: 1 });
  assert.equal(run.uploaded.size, 0);
  assert.equal(run.completionCalls[0].p_status, "failed");
  assert.equal(run.completionCalls[0].p_error_message, "source_photo_sha256_mismatch");
});

test("reviewed transient fallback never reports success after a result storage upload failure", async () => {
  const run = await runReviewedTransientPipelineFixture({
    uploadFailureReason: "result_storage_upload_failed",
  });
  assert.equal(run.response.status, 200);
  assert.deepEqual(await run.response.json(), { ok: false, status: "failed", processed: 1 });
  assert.equal(run.uploaded.size, 0);
  assert.equal(run.completionCalls.length, 1);
  assert.equal(run.completionCalls[0].p_status, "failed");
  assert.equal(run.completionCalls[0].p_error_message, "result_storage_upload_failed");
});

test("reviewed deterministic image fallback observes the runtime abort fence before upload or success completion", async () => {
  const run = await runReviewedTransientPipelineFixture({ runtimeTimeoutMs: 100 });
  assert.deepEqual(await run.response.json(), { ok: false, status: "failed", processed: 1 });
  assert.equal(run.completionCalls.length, 1);
  assert.equal(run.completionCalls[0].p_status, "failed");
  assert.equal(run.completionCalls[0].p_error_message, "server_studio_runtime_timeout");
  assert.equal(run.uploaded.size, 0);
});

test("single-main intake keeps package and contents images honest instead of failing for an optional role", async () => {
  const sourceBytes = await sharp({
    create: { width: 1200, height: 1200, channels: 3, background: "#f5f1e8" },
  }).composite([{
    input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect x="330" y="170" width="540" height="860" rx="48" fill="#b33b2f"/><text x="430" y="610" font-size="72" font-family="Arial" fill="#fff">BRAND</text></svg>'),
  }]).png().toBuffer();
  const main: ServerStudioSource = {
    path: "main",
    role: "main",
    name: "main.png",
    mediaType: "image/png",
    bytes: sourceBytes,
  };
  const extra: ServerStudioSource = { ...main, path: "extra-1", role: "extra-1" };
  const back: ServerStudioSource = { ...main, path: "back", role: "back" };
  const packageAsset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-package");
  const contentsAsset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-contents");
  assert.ok(packageAsset && contentsAsset);

  for (const asset of [packageAsset, contentsAsset]) {
    const mainOnly = resolveServerAssetSource(asset, [main]);
    assert.equal(mainOnly.source.role, "main");
    assert.equal(mainOnly.auditMode, "source-catalog");
    assert.equal(mainOnly.dedicatedEvidence, false);

    const numberedExtra = resolveServerAssetSource(asset, [main, extra]);
    assert.equal(numberedExtra.source.role, "main", "extra-* must not be mistaken for a labelled package view");
    assert.equal(numberedExtra.auditMode, "source-catalog");

    const labelledBack = resolveServerAssetSource(asset, [main, back]);
    assert.equal(labelledBack.source.role, "back");
    assert.equal(labelledBack.auditMode, "source-evidence");
    assert.equal(labelledBack.dedicatedEvidence, true);
  }

  const fallbackImages = await Promise.all([packageAsset, contentsAsset].map((asset) => (
    buildServerSourceDerivedAsset(asset, main, sourceBytes, 1, "source-catalog")
  )));
  assert.equal(new Set(fallbackImages.map((bytes) => createHash("sha256").update(bytes).digest("hex"))).size, 2);
  const fallbackHashes = await Promise.all(fallbackImages.map(async (bytes) => buildDifferenceHash(
    await sharp(bytes).resize(17, 16, { fit: "fill" }).grayscale().raw().toBuffer(),
    17,
    16,
  )));
  assert.ok(
    visualHashDistance(fallbackHashes[0], fallbackHashes[1]) >= MINIMUM_SHOT_HASH_DISTANCE,
    "main-derived package and contents catalog views must not be near duplicates",
  );
});

test("single-main master prompt labels package imagery as catalog fallback, never hidden evidence", () => {
  const prompt = buildServerStudioMasterPrompt({
    description: "판매자가 확인한 상품 설명입니다.",
    product_url: "",
    research_input: "테스트 상품",
    manual_fields: { packageContents: "1개" },
    competitor_context: null,
    image_paths: ["user/job/input/001.jpg"],
    image_specs: [{
      name: "001.jpg",
      role: "main",
      originalName: "main.png",
      originalBytes: 1000,
      originalMediaType: "image/png",
      originalPath: "user/job/original/001.source",
      originalWidth: 1200,
      originalHeight: 1200,
      width: 1200,
      height: 1200,
      bytes: 1000,
      mediaType: "image/jpeg",
      fit: "contain",
    }],
  });
  assert.match(prompt, /detail-package, detail-contents/u);
  assert.match(prompt, /대표사진에서 분리한 동일상품의 중립 카탈로그 보기/u);
  assert.match(prompt, /라벨·바코드·후면·숨은 구성품의 이미지 근거라고 쓰지 마세요/u);
});

test("full server Studio retries rejected OCR and duplicate lineage, uploads 16 assets, and completes idempotently", async () => {
  const jobId = "44444444-4444-4444-8444-444444444444";
  const claimToken = "55555555-5555-4555-8555-555555555555";
  const userId = "66666666-6666-4666-8666-666666666666";
  const researchJobId = "77777777-7777-4777-8777-777777777777";
  const researchClaimToken = "88888888-8888-4888-8888-888888888888";
  const normalizedPath = `${userId}/${jobId}/input/001.jpg`;
  const originalPath = `${userId}/${jobId}/original/001.source`;
  const normalizedBackPath = `${userId}/${jobId}/input/002.jpg`;
  const originalBackPath = `${userId}/${jobId}/original/002.source`;
  const sourceBytes = await sharp({
    create: { width: 1200, height: 1200, channels: 3, background: "#f7f7f7" },
  }).composite([{
    input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect x="180" y="180" width="840" height="840" fill="#d63b30"/></svg>'),
  }]).png().toBuffer();
  const backBytes = await patternedBackground(1200, 1200, "dedicated-back-evidence");
  const validSegmentation = {
    containsSingleProduct: true,
    touchesFrame: false,
    foregroundConfidence: 0.99,
    edgeConfidence: 0.99,
    polygons: [{
      points: [
        { x: 0.25, y: 0.25 }, { x: 0.375, y: 0.25 }, { x: 0.5, y: 0.25 },
        { x: 0.625, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.75, y: 0.5 },
        { x: 0.75, y: 0.75 }, { x: 0.625, y: 0.75 }, { x: 0.5, y: 0.75 },
        { x: 0.375, y: 0.75 }, { x: 0.25, y: 0.75 }, { x: 0.25, y: 0.5 },
      ],
    }],
  };
  const cutout = await buildPortableProductCutout({
    segmentation: validSegmentation,
    segmentationSource: sourceBytes,
  });
  const contextSpec = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-context");
  assert.ok(contextSpec);
  const contextBackgroundInput = await patternedBackground(
    contextSpec.width,
    contextSpec.height,
    "detail-context:1",
    "#d63b30",
    true,
  );
  const contextBackground = await sharp(contextBackgroundInput, { failOn: "warning", limitInputPixels: 16_000_000 })
    .rotate()
    .resize(contextSpec.width, contextSpec.height, { fit: "cover" })
    .png()
    .toBuffer();
  const contextPlacement = contextSpec.identityPolicy.placement;
  const contextProduct = await sharp(cutout)
    .resize(
      Math.max(1, Math.round(contextSpec.width * contextPlacement.width)),
      Math.max(1, Math.round(contextSpec.height * contextPlacement.height)),
      { fit: "contain" },
    )
    .png()
    .toBuffer();
  const duplicateContextBytes = await sharp(contextBackground).composite([{
    input: contextProduct,
    left: Math.round(contextSpec.width * contextPlacement.left),
    top: Math.round(contextSpec.height * contextPlacement.top),
  }]).png().toBuffer();
  const preflight = await firstDraftPreflightFixture(
    researchJobId,
    researchClaimToken,
    createHash("sha256").update(sourceBytes).digest("hex"),
    { wide: duplicateContextBytes },
  );
  const localizedChunks = planStudioLocalizedChunks(4);
  const terminalFixture = cliStudioResultSchema.safeParse({
    ...testMasterResult(),
    localizedListings: localizedChunks.flat().map(localizedListing),
  });
  if (!terminalFixture.success) assert.fail(JSON.stringify(terminalFixture.error.issues, null, 2));
  const backgroundCalls: Array<{
    assetId: string;
    prompt: string;
    referencePaths: string[];
  }> = [];
  const auditAttempts = new Map<string, number>();
  const contextCandidateDigests: string[] = [];
  const uploadedPaths: string[] = [];
  const uploadedDigests = new Map<string, string>();
  const completionCalls: Record<string, unknown>[] = [];
  let completionAttempt = 0;
  let masterAttempts = 0;

  const response = await runOneServerProductStudio({
    tokenHash: "b".repeat(64),
    runtimeTimeoutMs: 120_000,
    rpc: async (name, arguments_ = {}) => {
      if (name === "sellerpilot_claim_product_ai_job") {
        return {
          data: {
            id: jobId,
            claim_token: claimToken,
            kind: "product_studio",
            claim_scope: "product",
            request: {
              description: "A seller-confirmed portable organizer used for server Studio integration verification.",
              product_url: "",
              research_input: "portable desk organizer",
              manual_fields: { categoryHint: "Office organization" },
              image_paths: [normalizedPath, normalizedBackPath],
              image_specs: [{
                name: "001.jpg",
                role: "main",
                originalName: "source.png",
                originalBytes: sourceBytes.byteLength,
                originalMediaType: "image/png",
                originalPath,
                originalWidth: 1200,
                originalHeight: 1200,
                width: 1200,
                height: 1200,
                bytes: Math.min(sourceBytes.byteLength, 3 * 1024 * 1024),
                mediaType: "image/jpeg",
                fit: "contain",
              }, {
                name: "002.jpg",
                role: "back",
                originalName: "back.png",
                originalBytes: backBytes.byteLength,
                originalMediaType: "image/png",
                originalPath: originalBackPath,
                originalWidth: 1200,
                originalHeight: 1200,
                width: 1200,
                height: 1200,
                bytes: Math.min(backBytes.byteLength, 3 * 1024 * 1024),
                mediaType: "image/jpeg",
                fit: "contain",
              }],
              ...preflight.request,
            },
          },
          error: null,
        };
      }
      if (name === "sellerpilot_touch_ai_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_stage_ai_result_uploads") return { data: true, error: null };
      if (name === "sellerpilot_service_begin_ai_job_completion") return { data: true, error: null };
      if (name === "sellerpilot_complete_ai_job_with_image_context") {
        completionCalls.push(structuredClone(arguments_));
        completionAttempt += 1;
        return completionAttempt === 1
          ? { data: null, error: { code: "response_lost_after_commit" } }
          : { data: true, error: null };
      }
      return { data: true, error: null };
    },
    download: async (path) => {
      if (path === originalPath) return sourceBytes;
      if (path === originalBackPath) return backBytes;
      const bytes = preflight.bytesByPath.get(path);
      return bytes ?? assert.fail(`unexpected source path: ${path}`);
    },
    upload: async (path, bytes) => {
      assert.ok(bytes.byteLength > 0);
      uploadedPaths.push(path);
      uploadedDigests.set(path, createHash("sha256").update(bytes).digest("hex"));
      return "uploaded";
    },
    generateStructured: async (input) => {
      if (input.tags.includes("feature:product-studio-master")) {
        masterAttempts += 1;
        if (masterAttempts === 1) {
          throw new ServerProductStudioError("gateway_result_invalid");
        }
        const repeatedMetadata = testMasterResult();
        repeatedMetadata.design.creativeStrategy.targetSectionCount = 20;
        repeatedMetadata.design.sections = repeatedMetadata.design.sections.map((section, index) => ({
          ...section,
          type: "benefit" as const,
          layout: "split" as const,
          imageAsset: index < 12 ? "detail-overview" as const : "none" as const,
        }));
        return input.schema.parse(repeatedMetadata);
      }
      const chunkTag = input.tags.find((tag) => tag.startsWith("chunk:"));
      assert.ok(chunkTag);
      const chunkIndex = Number(chunkTag.slice("chunk:".length)) - 1;
      const targets = localizedChunks[chunkIndex];
      assert.ok(targets);
      return input.schema.parse({ localizedListings: targets.map(localizedListing) });
    },
    segmentSource: async () => ({ segmentation: validSegmentation, segmentationSource: sourceBytes }),
    generateBackground: async ({ asset, prompt, references }) => {
      const attemptMatch = /distinct retry=(\d+)/u.exec(prompt);
      const attempt = Number(attemptMatch?.[1] ?? 0);
      assert.ok(attempt >= 1 && attempt <= 4);
      backgroundCalls.push({
        assetId: asset.id,
        prompt,
        referencePaths: references.map((reference) => reference.path),
      });
      return patternedBackground(
        asset.width,
        asset.height,
        `${asset.id}:${attempt}`,
        "#d63b30",
        true,
      );
    },
    auditImage: async ({ assetId, candidate }) => {
      const attempt = (auditAttempts.get(assetId) ?? 0) + 1;
      auditAttempts.set(assetId, attempt);
      if (assetId === "detail-context") {
        contextCandidateDigests.push(createHash("sha256").update(candidate).digest("hex"));
      }
      if (assetId === "detail-storage" && attempt === 1) {
        return {
          ...passingPortableAudit(),
          quantityUnitMatches: false,
          assignedSceneVisible: false,
          referenceHasReadableText: true,
          candidateHasReadableText: true,
          referenceTokens: ["BRAND", "500 g"],
          requiredTokens: ["BRAND", "500 g"],
          candidateTokens: ["BRAND", "400 g"],
          unsupportedTokens: ["400 g"],
          missingTokens: ["500 g"],
        };
      }
      return passingPortableAudit();
    },
    logError: (stage, details) => assert.fail(`unexpected ${stage}: ${JSON.stringify(details)}`),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "succeeded", processed: 1 });
  assert.equal(masterAttempts, 2, "an invalid structured master must receive one bounded retry");
  assert.equal(new Set(uploadedPaths).size, 16);
  assert.equal(uploadedPaths.length, 16);
  assert.deepEqual(
    [...new Set(uploadedPaths.map((path) => path.split("/").at(-1)))].sort(),
    aiGeneratedAssetSpecs.map((asset) => asset.file).sort(),
  );
  assert.equal(completionCalls.length, 2, "an uncertain completion response must retry one byte-identical receipt");
  assert.deepEqual(completionCalls[1], completionCalls[0]);
  assert.equal(completionCalls[0].p_status, "succeeded");
  const resultPayload = completionCalls[0].p_result_payload as { asset_storage_paths?: Record<string, string> };
  assert.equal(Object.keys(resultPayload.asset_storage_paths ?? {}).length, 16);

  for (const assetId of coreFirstDraftAssetIds) {
    assert.equal(auditAttempts.has(assetId), false, `${assetId} must be restored instead of regenerated`);
    const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
    assert.ok(spec);
    const finalPath = aiGeneratedAssetPath(jobId, spec, claimToken);
    assert.equal(uploadedDigests.get(finalPath), preflight.request.preflight_asset_digests[assetId]);
  }
  assert.equal(contextCandidateDigests[0], preflight.request.preflight_asset_digests.wide);
  assert.equal(contextCandidateDigests.length, 2, "a final asset duplicating a restored first-draft asset must retry");
  assert.notEqual(contextCandidateDigests[1], contextCandidateDigests[0]);

  const finalSettingCalls = backgroundCalls.filter((call) => call.assetId === "detail-storage");
  assert.equal(finalSettingCalls.length, 2, "the remaining setting asset must retry its rejected OCR audit");
  assert.doesNotMatch(finalSettingCalls[0].prompt, /REJECTED CANDIDATE LINEAGE/u);
  assert.match(finalSettingCalls[1].prompt, /REJECTED CANDIDATE LINEAGE/u);
  assert.match(finalSettingCalls[1].prompt, /ocr:missing-token/u);
  assert.match(finalSettingCalls[1].prompt, /ocr:quantity-unit/u);
  assert.match(finalSettingCalls[1].prompt, /semantic:assigned-scene/u);
  assert.match(finalSettingCalls[1].prompt, /500 g/u);
  assert.match(finalSettingCalls[1].prompt, /400 g/u);
  assert.match(finalSettingCalls[1].referencePaths[0] ?? "", /^rejected-background:detail-storage:1$/u);
  assert.deepEqual(
    [...new Set(backgroundCalls.map((call) => call.assetId))].sort(),
    ["detail-context", "detail-storage"],
  );
  assert.deepEqual(
    Object.keys((completionCalls[0].p_result_payload as { asset_audit_modes: Record<string, string> }).asset_audit_modes).sort(),
    aiGeneratedAssetSpecs.map((asset) => asset.id).sort(),
  );
});

test("main then front segmentation quality failures preserve the full source frame for the final catalog roles", async () => {
  const jobId = "91919191-9191-4191-8191-919191919191";
  const claimToken = "92929292-9292-4292-8292-929292929292";
  const userId = "93939393-9393-4393-8393-939393939393";
  const mainOriginalPath = `${userId}/${jobId}/original/001.source`;
  const frontOriginalPath = `${userId}/${jobId}/original/002.source`;
  const mainBytes = await patternedBackground(1200, 1200, "fallback-main-source", "#c9392d", true);
  const frontBytes = await patternedBackground(1200, 1200, "fallback-front-source", "#2d6ac9", true);
  const preflight = await firstDraftPreflightFixture(
    "94949494-9494-4494-8494-949494949494",
    "95959595-9595-4595-8595-959595959595",
    createHash("sha256").update(mainBytes).digest("hex"),
  );
  const localizedChunks = planStudioLocalizedChunks(4);
  const attemptedRoles: string[] = [];
  const auditModes = new Map<string, string>();
  const uploadedPaths: string[] = [];
  let resultPayload: Record<string, unknown> | null = null;

  const response = await runOneServerProductStudio({
    tokenHash: "d".repeat(64),
    runtimeTimeoutMs: 120_000,
    rpc: async (name, arguments_ = {}) => {
      if (name === "sellerpilot_claim_product_ai_job") {
        return {
          data: {
            id: jobId,
            claim_token: claimToken,
            kind: "product_studio",
            claim_scope: "product",
            request: {
              description: "Fallback catalog integration fixture.",
              product_url: "",
              research_input: "fallback catalog product",
              manual_fields: {},
              image_paths: [
                `${userId}/${jobId}/input/001.jpg`,
                `${userId}/${jobId}/input/002.jpg`,
              ],
              image_specs: [{
                name: "main.jpg",
                role: "main",
                originalName: "main.png",
                originalBytes: mainBytes.byteLength,
                originalMediaType: "image/png",
                originalPath: mainOriginalPath,
                originalWidth: 1200,
                originalHeight: 1200,
                width: 1200,
                height: 1200,
                bytes: mainBytes.byteLength,
                mediaType: "image/jpeg",
                fit: "contain",
              }, {
                name: "front.jpg",
                role: "front",
                originalName: "front.png",
                originalBytes: frontBytes.byteLength,
                originalMediaType: "image/png",
                originalPath: frontOriginalPath,
                originalWidth: 1200,
                originalHeight: 1200,
                width: 1200,
                height: 1200,
                bytes: frontBytes.byteLength,
                mediaType: "image/jpeg",
                fit: "contain",
              }],
              ...preflight.request,
            },
          },
          error: null,
        };
      }
      if (name === "sellerpilot_complete_ai_job_with_image_context") {
        resultPayload = arguments_.p_result_payload as Record<string, unknown>;
      }
      if (name === "sellerpilot_touch_ai_job") return { data: "running", error: null };
      return { data: true, error: null };
    },
    download: async (path) => {
      if (path === mainOriginalPath) return mainBytes;
      if (path === frontOriginalPath) return frontBytes;
      return preflight.bytesByPath.get(path) ?? assert.fail(`unexpected source path: ${path}`);
    },
    upload: async (path, bytes) => {
      assert.ok(bytes.byteLength > 0);
      uploadedPaths.push(path);
      return "uploaded";
    },
    generateStructured: async (input) => {
      if (input.tags.includes("feature:product-studio-master")) {
        return input.schema.parse(testMasterResult());
      }
      const chunkTag = input.tags.find((tag) => tag.startsWith("chunk:"));
      assert.ok(chunkTag);
      const targets = localizedChunks[Number(chunkTag.slice("chunk:".length)) - 1];
      assert.ok(targets);
      return input.schema.parse({ localizedListings: targets.map(localizedListing) });
    },
    segmentSource: async (source) => {
      attemptedRoles.push(source.role);
      if (source.role === "main") {
        throw new ServerProductStudioError("product_segmentation_low_confidence", true);
      }
      throw new ServerProductStudioError("product_segmentation_area_invalid", true);
    },
    generateBackground: async () => assert.fail("catalog fallback must not invoke background generation"),
    auditImage: async ({ assetId, auditMode }) => {
      auditModes.set(assetId, auditMode);
      return passingPortableAudit();
    },
    logError: (stage, details) => assert.fail(`unexpected ${stage}: ${JSON.stringify(details)}`),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "succeeded", processed: 1 });
  assert.deepEqual(attemptedRoles, ["main", "front"]);
  assert.equal(uploadedPaths.length, 16);
  assert.equal(auditModes.get("detail-storage"), "source-photo-catalog");
  assert.equal(auditModes.get("detail-context"), "source-photo-catalog");
  assert.ok(resultPayload);
  assert.deepEqual(resultPayload.segmentation_attempted_roles, ["main", "front"]);
  const recordedModes = resultPayload.asset_audit_modes as Record<string, string>;
  assert.equal(recordedModes["detail-storage"], "source-photo-catalog");
  assert.equal(recordedModes["detail-context"], "source-photo-catalog");
});

test("a 300-second-compatible runtime timeout completes the exact claim as failed and never releases it", async () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const claimToken = "22222222-2222-4222-8222-222222222222";
  const userId = "33333333-3333-4333-8333-333333333333";
  const preflight = await firstDraftPreflightFixture(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "c".repeat(64),
  );
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runOneServerProductStudio({
    tokenHash: "a".repeat(64),
    runtimeTimeoutMs: 5,
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_claim_product_ai_job") {
        return {
          data: {
            id: jobId,
            claim_token: claimToken,
            kind: "product_studio",
            claim_scope: "product",
            request: {
              description: "",
              product_url: "",
              research_input: "테스트 상품",
              manual_fields: {},
              image_paths: [`${userId}/${jobId}/input/001.jpg`],
              image_specs: [{
                name: "001.jpg",
                role: "main",
                originalName: "source.png",
                originalBytes: 1000,
                originalMediaType: "image/png",
                originalPath: `${userId}/${jobId}/original/001.source`,
                originalWidth: 1200,
                originalHeight: 1200,
                width: 1200,
                height: 1200,
                bytes: 1000,
                mediaType: "image/jpeg",
                fit: "contain",
              }],
              ...preflight.request,
            },
          },
          error: null,
        };
      }
      return { data: true, error: null };
    },
    download: async (_path, signal) => new Promise<Uint8Array>((_resolve, reject) => {
      const hold = setTimeout(() => reject(new Error("test timeout did not abort the pending download")), 250);
      signal.addEventListener("abort", () => {
        clearTimeout(hold);
        reject(signal.reason);
      }, { once: true });
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "failed");
  assert.equal(calls.some((call) => call.name === "sellerpilot_service_release_ai_job_claim"), false);
  const completion = calls.findLast((call) => call.name === "sellerpilot_complete_ai_job_with_image_context");
  assert.equal(completion?.arguments_.p_status, "failed");
  assert.equal(completion?.arguments_.p_error_message, "server_studio_runtime_timeout");
});
