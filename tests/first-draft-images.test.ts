import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  buildFirstDraftStudioResult,
  firstDraftImageAssetSpec,
  firstDraftImageEnqueuePayloadSchema,
  firstDraftImageSubmissionSchema,
  firstDraftImageWorkerPostSchema,
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
  const one = firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: [{ id: "portrait", pngBase64: "AAAA" }],
  });
  assert.equal(one.success, true);
  const six = firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: coreFirstDraftAssetIds.map((id) => ({ id, pngBase64: "AAAA" })),
  });
  assert.equal(six.success, true);
  assert.equal(firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: [
      { id: "portrait", pngBase64: "AAAA" },
      { id: "portrait", pngBase64: "BBBB" },
    ],
  }).success, false);
  assert.equal(firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: [{ id: "hero", pngBase64: "AAAA" }],
  }).success, false);
  assert.equal(firstDraftImageSubmissionSchema.safeParse({
    jobId,
    assets: [{ id: "portrait", pngBase64: "AAAA", path: "results/x" }],
  }).success, false);
  const failure = firstDraftImageWorkerPostSchema.safeParse({ jobId, failed: true, reason: "codex-timeout" });
  assert.equal(failure.success, true);
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
  const payload = {
    jobId,
    sourcePath: `${ownerId}/${jobId}/original/001.source`,
    sourcePhotoSha256,
    sourceUrl: "https://signed.example.com/source",
    assets: coreFirstDraftAssetIds.map((assetId) => {
      const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!;
      return { id: assetId, path: aiGeneratedAssetPath(jobId, spec, claimToken) };
    }),
    completedAssets: [],
    productFacts: (() => {
      const resolved = buildFirstDraftImageEnqueuePayload({ jobId, ownerId, data: researchJob(), error: null });
      assert.equal(resolved.ok, true);
      if (!resolved.ok) throw new Error("unreachable");
      return resolved.payload.productFacts;
    })(),
  };
  const posted: Array<{ jobId: string; assets: Array<{ id: string; pngBase64: string }> }> = [];
  const codexStages: string[] = [];
  const outputFiles = coreFirstDraftAssetIds.map(
    (assetId) => aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!.file,
  );
  let generatedCount = 0;
  const result = await runFirstDraftImageLaneOnce({
    api: async (path, init = {}) => {
      if (init.method !== "POST") {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      const body = JSON.parse(String(init.body ?? "{}"));
      posted.push(body);
      generatedCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        status: generatedCount === coreFirstDraftAssetIds.length ? "done" : "recorded",
      }), { status: 200 });
    },
    fetchSource: async () => Buffer.from("authoritative-source-photo"),
    runCodex: async (args) => {
      const prompt = String(args[args.length - 1]);
      codexStages.push(args[args.indexOf("--cd") + 1]);
      assert.match(prompt, /Series slot/);
      assert.match(prompt, /1차 자동생성 이미지|테스트 단백질 파우더/);
      const outputFile = join(args[args.indexOf("--cd") + 1], outputFiles.shift()!);
      await writeFile(outputFile, Buffer.from("generated-png-bytes"));
    },
    normalizeGeneratedAsset: async (outputFile, spec) => {
      const bytes = await readFile(outputFile);
      assert.equal(spec.width > 0 && spec.height > 0, true);
      return bytes;
    },
    buildCodexImageArgs: ({ spec, outputFile, sourceFile, jobDir, prompt }) => ([
      "exec", "--model", "stub-model", "--enable", "image_generation", "--sandbox", "workspace-write",
      "--skip-git-repo-check", "--ephemeral", "--cd", jobDir, `--image=${sourceFile}`, prompt.replace(String(outputFile), `${jobDir}/${spec.file}`),
    ]),
    log: () => undefined,
    logError: () => undefined,
  });

  assert.equal(result.status, "done");
  assert.equal(posted.length, 6);
  assert.equal(new Set(posted.map((body) => body.assets[0]!.id)).size, 6);
  assert.equal(codexStages.length, 6);
  assert.equal(codexStages.every((dir) => Boolean(dir)), true);
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

  const payload = {
    jobId,
    sourcePath: `${ownerId}/${jobId}/original/001.source`,
    sourcePhotoSha256,
    sourceUrl: "https://signed.example.com/source",
    assets: coreFirstDraftAssetIds.map((assetId) => {
      const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)!;
      return { id: assetId, path: aiGeneratedAssetPath(jobId, spec, claimToken) };
    }),
    completedAssets: ["portrait", "wide"],
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
    fetchSource: async () => Buffer.from("authoritative-source-photo"),
    runCodex: async () => {
      throw new Error("codex 이미지 생성 실패");
    },
    normalizeGeneratedAsset: async () => Buffer.from("unused"),
    buildCodexImageArgs: () => [],
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
