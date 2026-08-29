import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { cliStudioResultSchema, requiredLocalizedMarkets } from "../lib/ai-cli-contract";
import {
  assertPortableAudit,
  buildPortableProductCutout,
  buildServerImageAuditReference,
  buildServerSourceDerivedAsset,
  buildServerSourceEvidencePanel,
  buildServerStudioMasterPrompt,
  normalizeServerStudioMasterContract,
  resolveServerAssetSource,
  runOneServerProductStudio,
  ServerProductStudioError,
  serverStudioRemoteWorkPlan,
  type ServerStudioSource,
} from "../lib/server-product-studio";
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

test("server Studio plans 8 setting shots as 3+3+2 and caps three lanes at nine", () => {
  const plan = serverStudioRemoteWorkPlan();
  assert.deepEqual(plan.settingWaves, [3, 3, 2]);
  assert.deepEqual(plan.sourceAuditWaves, [3, 3, 2]);
  assert.deepEqual(plan.localizedWaves, [3, 3, 3]);
  assert.equal(plan.maximumRemoteConcurrency, 9);
  assert.ok(Math.max(...plan.settingWaves) + Math.max(...plan.sourceAuditWaves) + Math.max(...plan.localizedWaves) <= 9);
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
  const uploadedPaths: string[] = [];
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
    download: async (path) => path === originalPath
      ? sourceBytes
      : path === originalBackPath
        ? backBytes
        : assert.fail(`unexpected source path: ${path}`),
    upload: async (path, bytes) => {
      assert.ok(bytes.byteLength > 0);
      uploadedPaths.push(path);
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
    segmentSource: async () => ({
      segmentation: {
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
      },
      segmentationSource: sourceBytes,
    }),
    generateBackground: async ({ asset, prompt, references }) => {
      const attemptMatch = /distinct retry=(\d+)/u.exec(prompt);
      const attempt = Number(attemptMatch?.[1] ?? 0);
      assert.ok(attempt >= 1 && attempt <= 4);
      backgroundCalls.push({
        assetId: asset.id,
        prompt,
        referencePaths: references.map((reference) => reference.path),
      });
      const sharedRejectedPlate = (asset.id === "portrait" && attempt <= 2)
        || (asset.id === "detail-overview" && attempt === 1);
      return patternedBackground(
        asset.width,
        asset.height,
        sharedRejectedPlate ? "shared-portrait-overview-plate" : `${asset.id}:${attempt}`,
        "#d63b30",
        sharedRejectedPlate,
      );
    },
    auditImage: async ({ assetId }) => {
      const attempt = (auditAttempts.get(assetId) ?? 0) + 1;
      auditAttempts.set(assetId, attempt);
      if (assetId === "portrait" && attempt === 1) {
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

  const portraitCalls = backgroundCalls.filter((call) => call.assetId === "portrait");
  assert.equal(portraitCalls.length, 3, "portrait must retry once for OCR/semantic audit and once for duplicate topology");
  assert.doesNotMatch(portraitCalls[0].prompt, /REJECTED CANDIDATE LINEAGE/u);
  assert.match(portraitCalls[1].prompt, /REJECTED CANDIDATE LINEAGE/u);
  assert.match(portraitCalls[1].prompt, /ocr:missing-token/u);
  assert.match(portraitCalls[1].prompt, /ocr:quantity-unit/u);
  assert.match(portraitCalls[1].prompt, /semantic:assigned-scene/u);
  assert.match(portraitCalls[1].prompt, /500 g/u);
  assert.match(portraitCalls[1].prompt, /400 g/u);
  assert.match(portraitCalls[1].referencePaths[0] ?? "", /^rejected-background:portrait:1$/u);
  assert.match(portraitCalls[2].prompt, /visual:duplicate/u);
  assert.match(portraitCalls[2].prompt, /detail-overview/u);
  assert.match(portraitCalls[2].prompt, /duplicateDistance/u);
  assert.deepEqual(
    portraitCalls[2].referencePaths.slice(0, 2),
    ["rejected-background:portrait:1", "rejected-background:portrait:2"],
  );
});

test("a 300-second-compatible runtime timeout completes the exact claim as failed and never releases it", async () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const claimToken = "22222222-2222-4222-8222-222222222222";
  const userId = "33333333-3333-4333-8333-333333333333";
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
