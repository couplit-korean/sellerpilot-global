import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  aiGeneratedAssetPath,
  aiGeneratedAssetSpecs,
  coreFirstDraftAssetIds,
} from "../lib/ai-generated-assets";
import { buildAssetImagePrompt } from "../lib/ai-image-planning";
import {
  buildFirstDraftImageEnqueuePayload,
  buildFirstDraftImageLineageUpdate,
  buildFirstDraftImageQualityManifest,
  buildFirstDraftImageQualityReceipt,
  buildFirstDraftStudioResult,
  firstDraftImageAssetSpec,
  firstDraftImageEnqueuePayloadSchema,
  firstDraftImageQualityManifestPath,
  isExactFirstDraftImageReplay,
  firstDraftImageSubmissionSchema,
  firstDraftImageWorkerPostSchema,
  validateFirstDraftImageQualityManifest,
  type FirstDraftImageProductFacts,
} from "../lib/first-draft-images";
import { productResearchInputSha256 } from "../lib/product-research-lineage-receipt-core";
import { validateSucceededProductResearchPreflight } from "../lib/product-studio-lineage";
import { firstDraftUsageLimitWaitMs, runFirstDraftImageLaneOnce } from "../scripts/first-draft-image-lane.mjs";

const ownerId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const claimToken = "33333333-3333-4333-8333-333333333333";
const researchInput = "https://example.com/product 단백질 보충제 1kg";
const sourcePhotoSha256 = "a".repeat(64);
const researchInputSha256 = productResearchInputSha256(researchInput);

function degradedResult({ auditMode = "source-photo-catalog" } = {}) {
  return {
    mode: "server-research",
    summary: "확인된 원본 사진과 판매자 설명에서 확인된 상품 정보만 정리한 1차 분석 결과입니다.",
    suggestedFields: {
      productName: "테스트 단백질 파우더",
      categoryHint: "일반 상품",
      brandName: "테스트브랜드",
      manufacturer: null,
      countryOfOrigin: null,
      material: null,
      packageContents: "본품 1개",
      description: "확인된 설명 문장입니다. 사용법과 주의사항은 라벨 표기가 기준입니다.",
      gtin: null,
    },
    searchQueries: [
      { locale: "ko-KR", query: "테스트 단백질 파우더" },
      { locale: "en-US", query: "test protein powder" },
      { locale: "ja-JP", query: "テストプロテイン" },
      { locale: "zh-TW", query: "測試蛋白粉" },
      { locale: "ms-MY", query: "serbuk protein ujian" },
      { locale: "id-ID", query: "bubuk protein uji" },
    ],
    details: {
      features: ["확인된 기능 1", "확인된 기능 2", "확인된 기능 3", "확인된 기능 4"],
      specifications: [{ label: "용량", value: "1kg", evidence: "라벨 표기" }],
      usage: ["라벨 표기 사용법"],
      cautions: ["직사광선을 피해 보관", "습기 없는 곳에 보관"],
    },
    sources: [],
    warnings: [],
    preflightVersion: 1,
    researchInputSha256,
    sourcePhotoSha256,
    asset_storage_paths: Object.fromEntries(coreFirstDraftAssetIds.map((assetId) => {
      const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!;
      return [assetId, aiGeneratedAssetPath(jobId, spec, claimToken)];
    })),
    preflightAssetLineage: Object.fromEntries(coreFirstDraftAssetIds.map((assetId, index) => {
      const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!;
      return [assetId, {
        digest: (index + 1).toString(16).repeat(64),
        role: spec.role,
        auditMode,
        sourceRole: "main",
      }];
    })),
  };
}

function researchJob(result: unknown = degradedResult()) {
  return {
    id: jobId,
    kind: "product_research",
    status: "succeeded",
    request: {
      jobId,
      researchInput,
      sourcePhotoFingerprint: sourcePhotoSha256,
      imagePaths: [`${ownerId}/${jobId}/input/001.jpg`],
      imageSpecs: [{
        name: "001.jpg",
        role: "main",
        bytes: 1024,
        width: 1200,
        height: 1200,
        mediaType: "image/jpeg",
        originalName: "001.source",
        originalPath: `${ownerId}/${jobId}/original/001.source`,
        originalBytes: 2048,
        originalWidth: 1200,
        originalHeight: 1200,
        originalMediaType: "image/jpeg",
        fit: "contain",
      }],
    },
    result,
  };
}

function digestsFor() {
  return Object.fromEntries(coreFirstDraftAssetIds.map((assetId, index) => [
    assetId,
    createHash("sha256").update(`${assetId}-${index}-generated`).digest("hex"),
  ])) as Record<string, string>;
}

function qualityReceiptFor(
  assetId: (typeof coreFirstDraftAssetIds)[number],
  productFacts: FirstDraftImageProductFacts,
  sourceSha256: string,
  bytes: Uint8Array,
  visualByte = coreFirstDraftAssetIds.indexOf(assetId) + 1,
) {
  return buildFirstDraftImageQualityReceipt({
    assetId,
    productFacts,
    sourcePhotoSha256: sourceSha256,
    sourceForegroundSha256: createHash("sha256").update(`foreground-${assetId}`).digest("hex"),
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
    visualHash: createHash("sha256").update(`visual-${assetId}-${visualByte}`).digest(),
    sourceCompositeVerified: true,
    sourcePixelIdentityVerified: true,
    sceneSemanticVerified: true,
    duplicateVerified: true,
  });
}

test("degraded research job resolves the source original, six canonical paths and product facts", () => {
  const resolved = buildFirstDraftImageEnqueuePayload({
    jobId,
    ownerId,
    data: researchJob(),
    error: null,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.payload.sourcePath, `${ownerId}/${jobId}/original/001.source`);
  assert.equal(resolved.payload.sourcePhotoSha256, sourcePhotoSha256);
  assert.deepEqual(resolved.payload.assets.map((asset) => asset.id), [...coreFirstDraftAssetIds]);
  assert.equal(new Set(resolved.payload.assets.map((asset) => asset.path)).size, 6);
  assert.equal(resolved.payload.productFacts.name, "테스트 단백질 파우더");
  assert.equal(resolved.payload.productFacts.category, "일반 상품");
  assert.equal(resolved.payload.productFacts.oneLine, "확인된 설명 문장입니다.");
  assert.equal(resolved.payload.productFacts.targetCustomer, "");
  assert.equal(resolved.payload.productFacts.classification.verificationStatus, "needs-review");
  assert.equal(resolved.payload.productFacts.classification.isHealthFunctionalFood, null);
  assert.equal(resolved.payload.productFacts.features.length, 4);
  // The payload must survive the same strict contract the worker validates.
  assert.equal(firstDraftImageEnqueuePayloadSchema.safeParse({ ...resolved.payload, sourceUrl: "https://example.com/x" }).success, true);
});

test("enqueue rejects non-adoptable jobs instead of inventing a source or paths", () => {
  const cases: Array<{ reason: string; input: Parameters<typeof buildFirstDraftImageEnqueuePayload>[0] }> = [
    {
      reason: "not_succeeded",
      input: { jobId, ownerId, data: { ...researchJob(), status: "running" }, error: null },
    },
    {
      reason: "wrong_kind",
      input: { jobId, ownerId, data: { ...researchJob(), kind: "product_studio" }, error: null },
    },
    {
      reason: "identity_mismatch",
      input: { jobId, ownerId, data: { ...researchJob(), id: "99999999-9999-4999-8999-999999999999" }, error: null },
    },
    {
      reason: "already_generated",
      input: { jobId, ownerId, data: researchJob(degradedResult({ auditMode: "segmented-source-composite" })), error: null },
    },
    {
      reason: "preflight_invalid",
      input: { jobId, ownerId, data: researchJob({ mode: "server-research", summary: "legacy text only" }), error: null },
    },
    {
      reason: "read_failed",
      input: { jobId, ownerId, data: null, error: { code: "503" } },
    },
  ];
  for (const scenario of cases) {
    const resolved = buildFirstDraftImageEnqueuePayload(scenario.input);
    assert.equal(resolved.ok, false, scenario.reason);
    if (!resolved.ok) assert.equal(resolved.reason, scenario.reason);
  }
});

test("enqueue rejects a preserved original path that is not the canonical source path", () => {
  const job = researchJob();
  job.request.imageSpecs[0]!.originalPath = `${ownerId}/${jobId}/original/002.source`;
  const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: job, error: null });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.reason, "source_path_unavailable");
});

test("submission contract accepts one..six verified assets and rejects duplicates or unknown ids", () => {
  const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const facts = resolved.payload.productFacts;
  const bytes = Buffer.from("test-png");
  const asset = (id: (typeof coreFirstDraftAssetIds)[number]) => ({
    id,
    pngBase64: bytes.toString("base64"),
    verification: qualityReceiptFor(id, facts, sourcePhotoSha256, bytes),
  });
  const one = firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: [asset("portrait")],
  });
  assert.equal(one.success, true);
  const six = firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: coreFirstDraftAssetIds.map(asset),
  });
  assert.equal(six.success, true);
  assert.equal(firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: [
      asset("portrait"),
      { ...asset("portrait"), pngBase64: "BBBB" },
    ],
  }).success, false);
  assert.equal(firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: [{ ...asset("portrait"), id: "hero" }],
  }).success, false);
  assert.equal(firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: [{ ...asset("portrait"), path: "results/x" }],
  }).success, false);
  assert.equal(firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: [{ id: "portrait", pngBase64: "AAAA" }],
  }).success, false);
  const failure = firstDraftImageWorkerPostSchema.safeParse({ jobId, failed: true, reason: "codex-timeout" });
  assert.equal(failure.success, true);
});

test("same-role replay is exact while changed bytes cannot overwrite the recorded role", () => {
  const facts = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
  assert.equal(facts.ok, true);
  if (!facts.ok) return;
  const bytes = Buffer.from("same-role-replay");
  const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait")!;
  const entry = {
    id: "portrait" as const,
    path: aiGeneratedAssetPath(jobId, spec, claimToken),
    digest: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    width: spec.width,
    height: spec.height,
    verification: qualityReceiptFor("portrait", facts.payload.productFacts, sourcePhotoSha256, bytes),
  };
  assert.equal(isExactFirstDraftImageReplay(entry, structuredClone(entry)), true);
  assert.equal(isExactFirstDraftImageReplay(entry, { ...entry, bytes: entry.bytes + 1 }), false);
  assert.equal(isExactFirstDraftImageReplay(entry, { ...entry, digest: "f".repeat(64) }), false);
  assert.equal(isExactFirstDraftImageReplay(entry, { ...entry, id: "wide" }), false);
});

test("lineage adoption rewrites only digests and audit mode, and stays readable by the recovery contract", () => {
  const stored = degradedResult();
  const digests = digestsFor();
  const update = buildFirstDraftImageLineageUpdate({
    jobId,
    result: stored,
    digests,
    expectedResearchInputSha256: researchInputSha256,
    expectedSourcePhotoSha256: sourcePhotoSha256,
  });
  assert.equal(update.ok, true);
  if (!update.ok) return;
  const next = update.nextResult as ReturnType<typeof degradedResult> & { preflightAssetLineage: Record<string, Record<string, unknown>> };
  for (const assetId of coreFirstDraftAssetIds) {
    assert.equal(next.preflightAssetLineage[assetId].auditMode, "segmented-source-composite");
    assert.equal(next.preflightAssetLineage[assetId].digest, digests[assetId]);
    assert.equal(next.preflightAssetLineage[assetId].role, firstDraftImageAssetSpec(assetId)!.role);
    assert.equal(next.preflightAssetLineage[assetId].sourceRole, "main");
  }
  // Everything except the lineage is untouched.
  const withoutLineage = (value: object) => Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "preflightAssetLineage"),
  );
  assert.deepEqual(withoutLineage(next), withoutLineage(stored));
  // The app's recovery path re-validates exactly this shape.
  assert.equal(validateSucceededProductResearchPreflight({
    expectedJobId: jobId,
    expectedResearchInputSha256: researchInputSha256,
    expectedSourcePhotoSha256: sourcePhotoSha256,
    data: { id: jobId, kind: "product_research", status: "succeeded", result: next },
  }).valid, true);
});

test("lineage adoption fails closed on partial, duplicated, malformed or already-adopted input", () => {
  const stored = degradedResult();
  const digests = digestsFor();
  const missing = { ...digests };
  delete (missing as Record<string, string>).wide;
  assert.deepEqual(buildFirstDraftImageLineageUpdate({
    jobId,
    result: stored,
    digests: missing,
    expectedResearchInputSha256: researchInputSha256,
    expectedSourcePhotoSha256: sourcePhotoSha256,
  }), { ok: false, reason: "submission_invalid" });
  assert.deepEqual(buildFirstDraftImageLineageUpdate({
    jobId,
    result: stored,
    digests: { ...digests, wide: digests.portrait },
    expectedResearchInputSha256: researchInputSha256,
    expectedSourcePhotoSha256: sourcePhotoSha256,
  }), { ok: false, reason: "submission_invalid" });
  assert.deepEqual(buildFirstDraftImageLineageUpdate({
    jobId,
    result: stored,
    digests: { ...digests, portrait: "not-a-digest" },
    expectedResearchInputSha256: researchInputSha256,
    expectedSourcePhotoSha256: sourcePhotoSha256,
  }), { ok: false, reason: "submission_invalid" });
  assert.deepEqual(buildFirstDraftImageLineageUpdate({
    jobId,
    result: degradedResult({ auditMode: "segmented-source-composite" }),
    digests,
    expectedResearchInputSha256: researchInputSha256,
    expectedSourcePhotoSha256: sourcePhotoSha256,
  }), { ok: false, reason: "not_degraded" });
  assert.deepEqual(buildFirstDraftImageLineageUpdate({
    jobId,
    result: { mode: "server-research", summary: "legacy" },
    digests,
    expectedResearchInputSha256: researchInputSha256,
    expectedSourcePhotoSha256: sourcePhotoSha256,
  }), { ok: false, reason: "result_invalid" });
});

test("quality manifest is claim-scoped and rejects stale or duplicated lineage", () => {
  const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const verifiedAssets = Object.fromEntries(coreFirstDraftAssetIds.map((assetId, index) => {
    const bytes = Buffer.from(`quality-manifest-${assetId}`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    return [assetId, {
      id: assetId,
      digest,
      verification: qualityReceiptFor(
        assetId,
        resolved.payload.productFacts,
        sourcePhotoSha256,
        bytes,
        index + 1,
      ),
    }];
  }));
  const manifest = buildFirstDraftImageQualityManifest({
    jobId,
    productFacts: resolved.payload.productFacts,
    sourcePhotoSha256,
    verifiedAssets,
  });
  assert.ok(manifest);
  const paths = Object.fromEntries(resolved.payload.assets.map((asset) => [asset.id, asset.path])) as Record<(typeof coreFirstDraftAssetIds)[number], string>;
  assert.equal(
    firstDraftImageQualityManifestPath(jobId, paths),
    `results/${jobId}/claims/${claimToken}/first-draft-quality-v1.json`,
  );
  const assetDigests = Object.fromEntries(coreFirstDraftAssetIds.map((assetId) => [
    assetId,
    verifiedAssets[assetId].digest,
  ])) as Record<(typeof coreFirstDraftAssetIds)[number], string>;
  assert.equal(validateFirstDraftImageQualityManifest({
    jobId,
    productFacts: resolved.payload.productFacts,
    sourcePhotoSha256,
    assetDigests,
    manifest,
  }), true);
  assert.equal(validateFirstDraftImageQualityManifest({
    jobId,
    productFacts: resolved.payload.productFacts,
    sourcePhotoSha256,
    assetDigests: { ...assetDigests, wide: assetDigests.portrait },
    manifest,
  }), false);
});

test("the six first-draft assets are planned with the shared detail-page prompt pipeline", () => {
  const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const studioResult = buildFirstDraftStudioResult(resolved.payload.productFacts);
  assert.equal(studioResult.localizedListings.length, 0);
  for (const assetId of coreFirstDraftAssetIds) {
    const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!;
    const prompt = buildAssetImagePrompt(studioResult, `/tmp/${spec.file}`, spec, ["main"]);
    assert.equal(typeof prompt, "string");
    assert.match(prompt, new RegExp(`Series slot: ${assetId}`));
    assert.match(prompt, new RegExp(`target aspect ratio ${spec.ratio}`));
    assert.match(prompt, new RegExp(spec.file));
    assert.match(prompt, /테스트 단백질 파우더/);
  }
});

test("the Mac lane draws and submits the six assets without a network or a real codex call", async () => {
  const laneSource = Buffer.from("authoritative-source-photo");
  const laneSourceSha256 = createHash("sha256").update(laneSource).digest("hex");
  const payload = {
    jobId,
    sourcePath: `${ownerId}/${jobId}/original/001.source`,
    sourcePhotoSha256: laneSourceSha256,
    sourceUrl: "https://signed.example.com/source",
    assets: coreFirstDraftAssetIds.map((assetId) => {
      const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!;
      return { id: assetId, path: aiGeneratedAssetPath(jobId, spec, claimToken) };
    }),
    completedAssets: [],
    completedAssetEvidence: [],
    uploadTransport: "signed-storage-v1",
    productFacts: (() => {
      const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
      assert.equal(resolved.ok, true);
      if (!resolved.ok) throw new Error("unreachable");
      return resolved.payload.productFacts;
    })(),
  };
  const posted: Array<{ jobId: string; assets: Array<{ id: string; path: string; digest: string; verification: unknown }> }> = [];
  const uploaded: string[] = [];
  const result = await runFirstDraftImageLaneOnce({
    api: async (path, init = {}) => {
      if (init.method !== "POST") {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      const body = JSON.parse(String(init.body ?? "{}"));
      posted.push(body);
      return new Response(JSON.stringify({ ok: true, status: posted.length === 6 ? "done" : "recorded" }), { status: 200 });
    },
    uploadVerifiedAsset: async ({ asset }) => {
      uploaded.push(asset.id);
      return { status: "uploaded" };
    },
    fetchSource: async () => laneSource,
    generateVerifiedAssets: async ({ payload: claimedPayload, studioResult, sourceFile }) => {
      assert.equal(claimedPayload.sourcePhotoSha256, laneSourceSha256);
      assert.match(studioResult.design.themeName, /1차 자동생성 이미지/);
      assert.deepEqual(await readFile(sourceFile), laneSource);
      return coreFirstDraftAssetIds.map((id, index) => {
        const bytes = Buffer.from(`generated-png-bytes-${id}`);
        return {
          id,
          bytes,
          verification: qualityReceiptFor(id, claimedPayload.productFacts, laneSourceSha256, bytes, index + 1),
        };
      });
    },
    log: () => undefined,
    logError: () => undefined,
  });

  assert.equal(result.status, "done");
  assert.equal(posted.length, 6);
  assert.equal(posted.every((body) => body.assets.length === 1), true);
  assert.equal(new Set(posted.flatMap((body) => body.assets.map((asset) => asset.id))).size, 6);
  assert.equal(posted.every((body) => Boolean(body.assets[0]?.verification)), true);
  assert.equal(posted.every((body) => Buffer.byteLength(JSON.stringify(body)) < 256 * 1024), true);
  assert.deepEqual(uploaded, [...coreFirstDraftAssetIds]);
  assert.equal(posted.every((body) => body.jobId === jobId), true);
});

test("the Mac lane skips already-verified assets and reports failures instead of staying busy", async () => {
  const idle = await runFirstDraftImageLaneOnce({
    api: async () => new Response(null, { status: 204 }),
    fetchSource: async () => {
      throw new Error("must not download without a claim");
    },
  });
  assert.deepEqual(idle, { status: "idle" });

  const laneSource = Buffer.from("authoritative-source-photo");
  const laneSourceSha256 = createHash("sha256").update(laneSource).digest("hex");
  const payload = {
    jobId,
    sourcePath: `${ownerId}/${jobId}/original/001.source`,
    sourcePhotoSha256: laneSourceSha256,
    sourceUrl: "https://signed.example.com/source",
    assets: coreFirstDraftAssetIds.map((assetId) => {
      const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!;
      return { id: assetId, path: aiGeneratedAssetPath(jobId, spec, claimToken) };
    }),
    completedAssets: ["portrait", "wide"],
    completedAssetEvidence: [],
    uploadTransport: "signed-storage-v1",
    productFacts: (() => {
      const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
      if (!resolved.ok) throw new Error("unreachable");
      return resolved.payload.productFacts;
    })(),
  };
  const failurePosts: Array<Record<string, unknown>> = [];
  const recorded = await runFirstDraftImageLaneOnce({
    api: async (path, init = {}) => {
      if (init.method !== "POST") return new Response(JSON.stringify(payload), { status: 200 });
      const body = JSON.parse(String(init.body ?? "{}"));
      if (body.failed) {
        failurePosts.push(body);
        return new Response(JSON.stringify({ ok: true, status: "released" }), { status: 200 });
      }
      throw new Error("generation must fail before any submission");
    },
    fetchSource: async () => laneSource,
    generateVerifiedAssets: async () => {
      throw new Error("codex 이미지 생성 실패");
    },
    uploadVerifiedAsset: async () => ({ status: "uploaded" }),
    log: () => undefined,
    logError: () => undefined,
  });
  assert.equal(recorded.status, "failed");
  assert.equal(failurePosts.length, 1);
  assert.equal(failurePosts[0]!.failed, true);
  assert.equal(typeof failurePosts[0]!.reason, "string");
});

test("Codex usage-limit errors wait until the stated resume time instead of looking like a repo-check failure", () => {
  const now = Date.parse("2026-09-12T14:21:00+09:00");
  const waitMs = firstDraftUsageLimitWaitMs(
    "skip-git-repo-check flag or add project to ~/.codex/config.toml\nERROR: You've hit your usage limit. try again at 3:08 PM.",
    now,
  );
  assert.equal(waitMs > 40 * 60 * 1000, true);
  assert.equal(waitMs < 55 * 60 * 1000, true);
  assert.equal(firstDraftUsageLimitWaitMs("codex 이미지 생성 실패", now), 0);
});

test("a failed verified batch settles sibling work before release and temporary cleanup", async () => {
  const laneSource = Buffer.from("resource-lifetime-source");
  const laneSourceSha256 = createHash("sha256").update(laneSource).digest("hex");
  const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const payload = {
    ...resolved.payload,
    sourcePhotoSha256: laneSourceSha256,
    sourceUrl: "https://signed.example.com/source",
    completedAssets: [],
    completedAssetEvidence: [],
    uploadTransport: "signed-storage-v1",
  };
  let siblingSettled = false;
  let releasedAfterSibling = false;
  let capturedJobDir = "";
  const outcome = await runFirstDraftImageLaneOnce({
    api: async (_path, init = {}) => {
      if (init.method !== "POST") return new Response(JSON.stringify(payload), { status: 200 });
      const body = JSON.parse(String(init.body ?? "{}"));
      assert.equal(body.failed, true);
      releasedAfterSibling = siblingSettled;
      return new Response(JSON.stringify({ ok: true, status: "released" }), { status: 200 });
    },
    fetchSource: async () => laneSource,
    generateVerifiedAssets: async ({ jobDir }) => {
      capturedJobDir = jobDir;
      const settlements = await Promise.allSettled([
        Promise.reject(new Error("portrait hard failure")),
        new Promise<void>((resolve) => setTimeout(() => {
          siblingSettled = true;
          resolve();
        }, 20)),
      ]);
      const failure = settlements.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
      throw failure?.reason ?? new Error("expected failure");
    },
    uploadVerifiedAsset: async () => ({ status: "uploaded" }),
    log: () => undefined,
    logError: () => undefined,
  });
  assert.equal(outcome.status, "failed");
  assert.equal(releasedAfterSibling, true);
  await assert.rejects(access(capturedJobDir));
});

test("a lost response after a one-asset metadata submission preserves remote state for exact replay", async () => {
  const laneSource = Buffer.from("completion-uncertain-source");
  const laneSourceSha256 = createHash("sha256").update(laneSource).digest("hex");
  const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const payload = {
    ...resolved.payload,
    sourcePhotoSha256: laneSourceSha256,
    sourceUrl: "https://signed.example.com/source",
    completedAssets: [],
    completedAssetEvidence: [],
    uploadTransport: "signed-storage-v1",
  };
  let metadataPosts = 0;
  const outcome = await runFirstDraftImageLaneOnce({
    api: async (_path, init = {}) => {
      if (init.method !== "POST") return new Response(JSON.stringify(payload), { status: 200 });
      metadataPosts += 1;
      throw new Error("response lost after commit");
    },
    fetchSource: async () => laneSource,
    generateVerifiedAssets: async ({ payload: claimedPayload }) => coreFirstDraftAssetIds.map((id, index) => {
      const bytes = Buffer.from(`uncertain-${id}`);
      return {
        id,
        bytes,
        verification: qualityReceiptFor(id, claimedPayload.productFacts, laneSourceSha256, bytes, index + 1),
      };
    }),
    uploadVerifiedAsset: async () => ({ status: "uploaded" }),
    log: () => undefined,
    logError: () => undefined,
  });
  assert.equal(outcome.status, "completion-uncertain");
  assert.equal(metadataPosts, 2);
});

test("an authoritative-read gap after metadata submission preserves the claim without regeneration", async () => {
  const laneSource = Buffer.from("completion-uncertain-conflict-source");
  const laneSourceSha256 = createHash("sha256").update(laneSource).digest("hex");
  const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const payload = {
    ...resolved.payload,
    sourcePhotoSha256: laneSourceSha256,
    sourceUrl: "https://signed.example.com/source",
    completedAssets: [],
    completedAssetEvidence: [],
    uploadTransport: "signed-storage-v1" as const,
  };
  let metadataPosts = 0;
  let releasePosts = 0;
  let generationCalls = 0;
  const outcome = await runFirstDraftImageLaneOnce({
    api: async (_path, init = {}) => {
      if (init.method !== "POST") return new Response(JSON.stringify(payload), { status: 200 });
      const body = JSON.parse(String(init.body ?? "{}"));
      if (body.failed === true) {
        releasePosts += 1;
        return new Response(JSON.stringify({ ok: true, status: "released" }), { status: 200 });
      }
      metadataPosts += 1;
      return new Response(JSON.stringify({
        ok: false,
        status: "completion-uncertain",
        code: "FIRST_DRAFT_COMPLETION_UNCERTAIN",
        message: "DB commit state is not visible to the active-claim read contract",
      }), { status: 409 });
    },
    fetchSource: async () => laneSource,
    generateVerifiedAssets: async ({ payload: claimedPayload }) => {
      generationCalls += 1;
      return coreFirstDraftAssetIds.map((id, index) => {
        const bytes = Buffer.from(`uncertain-conflict-${id}`);
        return {
          id,
          bytes,
          verification: qualityReceiptFor(id, claimedPayload.productFacts, laneSourceSha256, bytes, index + 1),
        };
      });
    },
    uploadVerifiedAsset: async () => ({ status: "uploaded" }),
    log: () => undefined,
    logError: () => undefined,
  });
  assert.equal(outcome.status, "completion-uncertain");
  assert.equal(generationCalls, 1);
  assert.equal(metadataPosts, 1);
  assert.equal(releasePosts, 0);
});

test("a 413 metadata rejection is a definite non-commit and releases the claim once", async () => {
  const laneSource = Buffer.from("payload-too-large-source");
  const laneSourceSha256 = createHash("sha256").update(laneSource).digest("hex");
  const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const payload = {
    ...resolved.payload,
    sourcePhotoSha256: laneSourceSha256,
    sourceUrl: "https://signed.example.com/source",
    completedAssets: [],
    completedAssetEvidence: [],
    uploadTransport: "signed-storage-v1" as const,
  };
  let metadataPosts = 0;
  let releasePosts = 0;
  const outcome = await runFirstDraftImageLaneOnce({
    api: async (_path, init = {}) => {
      if (init.method !== "POST") return new Response(JSON.stringify(payload), { status: 200 });
      const body = JSON.parse(String(init.body ?? "{}"));
      if (body.failed === true) {
        releasePosts += 1;
        return new Response(JSON.stringify({ ok: true, status: "released" }), { status: 200 });
      }
      metadataPosts += 1;
      return new Response(JSON.stringify({ code: "FUNCTION_PAYLOAD_TOO_LARGE" }), { status: 413 });
    },
    fetchSource: async () => laneSource,
    generateVerifiedAssets: async ({ payload: claimedPayload }) => coreFirstDraftAssetIds.map((id, index) => {
      const bytes = Buffer.from(`oversize-metadata-${id}`);
      return {
        id,
        bytes,
        verification: qualityReceiptFor(id, claimedPayload.productFacts, laneSourceSha256, bytes, index + 1),
      };
    }),
    uploadVerifiedAsset: async () => ({ status: "uploaded" }),
    log: () => undefined,
    logError: () => undefined,
  });
  assert.equal(outcome.status, "failed");
  assert.equal(metadataPosts, 1);
  assert.equal(releasePosts, 1);
});
