import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { requiredLocalizedMarkets } from "../lib/ai-cli-contract";
import {
  assertPortableAudit,
  buildPortableProductCutout,
  buildServerImageAuditReference,
  buildServerSourceDerivedAsset,
  buildServerSourceEvidencePanel,
  buildServerStudioMasterPrompt,
  resolveServerAssetSource,
  runOneServerProductStudio,
  serverStudioRemoteWorkPlan,
  type ServerStudioSource,
} from "../lib/server-product-studio";
import {
  buildDifferenceHash,
  MINIMUM_SHOT_HASH_DISTANCE,
  visualHashDistance,
} from "../lib/image-shot-uniqueness";

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
