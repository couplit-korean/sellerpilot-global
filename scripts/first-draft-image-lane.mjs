import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets.ts";

const firstDraftImageConcurrency = (() => {
  const parsed = Number(process.env.SELLERPILOT_FIRST_DRAFT_IMAGE_CONCURRENCY ?? 3);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(6, Math.floor(parsed))) : 3;
})();
import {
  buildAssetImagePrompt,
  resolveIdentityBackgroundContactMode,
  resolveProductSettingShot,
} from "../lib/ai-image-planning.ts";
import {
  buildFirstDraftStudioResult,
  firstDraftImageAssetIds,
  firstDraftImageEnqueuePayloadSchema,
} from "../lib/first-draft-images.ts";
import { maximumStudioSourceImageBytes } from "../lib/studio-source-photo-policy.ts";

/**
 * Mac-side first-draft image lane.
 *
 * The Vercel preflight cannot reach the image model for this account, so a
 * degraded research job is queued through the admin endpoint and this loop draws
 * the six canonical assets with the same Codex image pipeline (and the same
 * prompt planner) the detail-page studio lane uses, then hands the bytes back to
 * the worker endpoint for adoption.
 *
 * Everything is injected so the lane can be tested without a network call, a
 * Codex process, or a real image model.
 */

const assetSpecById = new Map(aiGeneratedAssetSpecs.map((asset) => [asset.id, asset]));

function payloadOrNull(value) {
  const parsed = firstDraftImageEnqueuePayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function writeBoundedSourceFile(sourceFile, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
    throw new Error("1차 생성에 사용할 원본 사진 바이트가 없습니다.");
  }
  if (bytes.byteLength > maximumStudioSourceImageBytes) {
    throw new Error("1차 생성에 사용할 원본 사진이 안전 한도를 초과했습니다.");
  }
  const handle = await open(sourceFile, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
  }
  finally {
    await handle.close();
  }
}

export async function generateFirstDraftAsset({
  spec,
  studioResult,
  sourceFile,
  jobDir,
  runCodex,
  normalizeGeneratedAsset,
  codexArgs,
}) {
  const outputFile = join(jobDir, spec.file);
  const settingShot = resolveProductSettingShot(studioResult, spec.id);
  const contactMode = resolveIdentityBackgroundContactMode(studioResult, settingShot);
  const prompt = buildAssetImagePrompt(
    studioResult,
    outputFile,
    spec,
    ["main"],
    "",
    "product",
    settingShot ?? undefined,
    contactMode,
  );
  await runCodex(codexArgs({ spec, outputFile, sourceFile, jobDir, prompt }));
  return normalizeGeneratedAsset(outputFile, spec);
}

export async function runFirstDraftImageLaneOnce({
  api,
  fetchSource,
  runCodex,
  normalizeGeneratedAsset,
  buildCodexImageArgs,
  log = console.log,
  logError = console.error,
} = {}) {
  const claimed = await api("/api/ai/worker/first-draft-images", { method: "GET" });
  if (claimed.status === 204) return { status: "idle" };
  if (claimed.status === 401) return { status: "unauthorized" };
  if (!claimed.ok) {
    return { status: "unavailable", httpStatus: claimed.status };
  }

  const payload = payloadOrNull(await claimed.json().catch(() => null));
  if (!payload) {
    logError("[1차 생성 이미지] 작업자 payload 계약을 확인하지 못해 건너뜁니다.");
    return { status: "invalid-payload" };
  }

  const jobDir = await mkdtemp(join(tmpdir(), "sellerpilot-first-draft-"));
  try {
    const sourceFile = join(jobDir, `source-${randomUUID()}.source`);
    await writeBoundedSourceFile(sourceFile, await fetchSource(payload.sourceUrl));
    const studioResult = buildFirstDraftStudioResult(payload.productFacts);
    const completed = new Set(payload.completedAssets);
    const pending = payload.assets.filter((asset) => !completed.has(asset.id));
    log(`[1차 생성 이미지 시작] ${payload.jobId} · ${pending.length}장 · 완료 ${completed.size}장`);

    // The six roles are independent, and one Codex image call takes minutes, so the
    // assets are generated with bounded parallelism instead of one after another.
    let finishedAll = false;
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(pending.length, firstDraftImageConcurrency));
    const generateOne = async () => {
      for (;;) {
        if (finishedAll) return;
        const index = cursor;
        cursor += 1;
        if (index >= pending.length) return;
        const asset = pending[index];
        const spec = assetSpecById.get(asset.id);
        if (!spec) {
          throw new Error(`1차 생성 이미지 역할 ${asset.id}을(를) 확인하지 못했습니다.`);
        }
        const normalized = await generateFirstDraftAsset({
          spec,
          studioResult,
          sourceFile,
          jobDir,
          runCodex,
          normalizeGeneratedAsset,
          codexArgs: buildCodexImageArgs,
        });
        const submitted = await api("/api/ai/worker/first-draft-images", {
          method: "POST",
          body: JSON.stringify({
            jobId: payload.jobId,
            assets: [{ id: spec.id, pngBase64: Buffer.from(normalized).toString("base64") }],
          }),
        });
        if (!submitted.ok) {
          throw new Error(`1차 생성 이미지 ${spec.id} 제출 실패 · HTTP ${submitted.status}`);
        }
        const outcome = await submitted.json().catch(() => null);
        const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
        log(`[1차 생성 이미지 업로드] ${payload.jobId} · ${spec.id} · ${outcome?.status ?? "recorded"} · sha256=${digest}`);
        if (outcome?.status === "done") {
          finishedAll = true;
          log(`[1차 생성 이미지 완료] ${payload.jobId} · 6장 생성 및 계보 반영`);
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => generateOne()));
    if (finishedAll) return { status: "done", jobId: payload.jobId };
    return { status: "recorded", jobId: payload.jobId, pending: pending.map((asset) => asset.id) };
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : "first-draft-image-failed";
    logError(`[1차 생성 이미지 실패] ${payload.jobId} · ${reason}`);
    await api("/api/ai/worker/first-draft-images", {
      method: "POST",
      body: JSON.stringify({ jobId: payload.jobId, failed: true, reason: reason.slice(0, 300) }),
    }).catch(() => undefined);
    return { status: "failed", jobId: payload.jobId, reason };
  }
  finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

export async function readSourceBytesBounded(response, maximumBytes = maximumStudioSourceImageBytes) {
  if (!response.ok) throw new Error(`원본 사진 다운로드 실패 · HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error("원본 사진 크기가 허용 한도를 초과합니다.");
  }
  if (!response.body) throw new Error("원본 사진 응답 본문이 없습니다.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("원본 사진 크기가 허용 한도를 초과합니다.");
      chunks.push(Buffer.from(value));
    }
  }
  finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export const firstDraftImageLaneAssetIds = [...firstDraftImageAssetIds];
