import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFirstDraftStudioResult,
  firstDraftImageAssetIds,
  firstDraftImageAssetSpec,
  firstDraftImageEnqueuePayloadSchema,
  firstDraftImageReceiptReviewProfile,
  validateFirstDraftImageQualityReceipt,
} from "../lib/first-draft-images.ts";
import { maximumStudioSourceImageBytes } from "../lib/studio-source-photo-policy.ts";

export function firstDraftUsageLimitWaitMs(reason, now = Date.now()) {
  const text = String(reason ?? "");
  if (!/usage limit|hit your usage limit|try again at /i.test(text)) return 0;
  const match = text.match(/try again at (\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 45 * 60 * 1000;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const resume = new Date(now);
  resume.setHours(hour, minute, 0, 0);
  if (resume.getTime() <= now) resume.setDate(resume.getDate() + 1);
  return Math.min(6 * 60 * 60 * 1000, Math.max(60_000, resume.getTime() - now + 60_000));
}

export const maximumFirstDraftMetadataRequestBytes = 256 * 1024;

async function submitFirstDraftMetadata(api, jobId, asset) {
  const body = JSON.stringify({ jobId, assets: [asset] });
  const bodyBytes = Buffer.byteLength(body, "utf8");
  if (bodyBytes > maximumFirstDraftMetadataRequestBytes) {
    throw new Error(`1차 이미지 완료 metadata가 안전 한도를 초과했습니다 · ${bodyBytes} bytes`);
  }
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response;
    try {
      response = await api("/api/ai/worker/first-draft-images", { method: "POST", body });
    } catch (error) {
      if (attempt === 2) {
        const uncertain = new Error(error instanceof Error ? error.message : "1차 이미지 완료 응답 유실");
        uncertain.completionUncertain = true;
        throw uncertain;
      }
      continue;
    }
    lastStatus = response.status;
    if (response.ok) return response.json().catch(() => null);
    const failure = await response.json().catch(() => null);
    if (failure?.code === "FIRST_DRAFT_COMPLETION_UNCERTAIN"
        || failure?.status === "completion-uncertain") {
      const uncertain = new Error(
        failure?.message || `1차 이미지 완료 저장 여부 불명확 · HTTP ${response.status}`,
      );
      uncertain.completionUncertain = true;
      throw uncertain;
    }
    if (response.status < 500) {
      throw new Error(`1차 이미지 완료 metadata 거절 · HTTP ${response.status}`);
    }
  }
  const uncertain = new Error(`1차 이미지 완료 저장 여부 불명확 · HTTP ${lastStatus || "unknown"}`);
  uncertain.completionUncertain = true;
  throw uncertain;
}

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

export async function runFirstDraftImageLaneOnce({
  api,
  fetchSource,
  generateVerifiedAssets,
  uploadVerifiedAsset,
  log = console.log,
  logError = console.error,
  cancellationPollMs = 5_000,
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
  let completionUncertain = false;
  let submissionTail = Promise.resolve();
  let acceptingVerifiedAssets = true;
  let authoritativeDone = false;
  const cancellation = new AbortController();
  let checking = false;
  const checkCancellation = async () => {
    if (checking || cancellation.signal.aborted || authoritativeDone) return;
    checking = true;
    try {
      const response = await api(`/api/ai/worker/first-draft-images?jobId=${payload.jobId}`, {
        method: "GET", signal: AbortSignal.timeout(10_000),
      });
      const state = response.ok ? await response.json().catch(() => null) : null;
      if (!authoritativeDone && state?.jobId === payload.jobId && state.active === false) {
        cancellation.abort(new DOMException("관리자가 작업을 중지했습니다.", "AbortError"));
      }
    } catch { /* A failed read is not evidence of cancellation. */ }
    finally { checking = false; }
  };
  const cancellationTimer = setInterval(() => void checkCancellation(), cancellationPollMs);
  cancellationTimer.unref?.();
  try {
    await checkCancellation();
    cancellation.signal.throwIfAborted();
    if (payload.uploadTransport !== "signed-storage-v1" || typeof uploadVerifiedAsset !== "function") {
      throw new Error("1차 이미지 signed Storage 전송 계약이 배포되지 않았습니다.");
    }
    const sourceFile = join(jobDir, `source-${randomUUID()}.source`);
    const sourceBytes = await fetchSource(payload.sourceUrl);
    const downloadedSourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    if (downloadedSourceSha256 !== payload.sourcePhotoSha256) {
      throw new Error("1차 생성 원본 사진의 다운로드 해시가 요청 계보와 일치하지 않습니다.");
    }
    await writeBoundedSourceFile(sourceFile, sourceBytes);
    const studioResult = buildFirstDraftStudioResult(payload.productFacts);
    if (typeof generateVerifiedAssets !== "function") {
      throw new Error("1차 생성 이미지 공통 품질 검수기가 연결되지 않았습니다.");
    }
    const completed = new Set(payload.completedAssets);
    const pendingIds = firstDraftImageAssetIds.filter((assetId) => !completed.has(assetId));
    log(`[1차 생성 이미지 시작] ${payload.jobId} · 생성 ${pendingIds.length}장 · 검증 완료 ${completed.size}장`);
    const persisted = new Map();
    let receiptProfile = payload.completedAssetEvidence[0]
      ? firstDraftImageReceiptReviewProfile(payload.completedAssetEvidence[0].verification) : null;
    let lastOutcome = completed.size === firstDraftImageAssetIds.length ? { status: "done" } : null;
    const validateAsset = (asset) => {
      const assetId = asset?.id;
      const bytes = asset?.bytes instanceof Uint8Array ? Buffer.from(asset.bytes) : null;
      const spec = firstDraftImageAssetSpec(assetId);
      const path = payload.assets.find((candidate) => candidate.id === assetId)?.path;
      const outputSha256 = bytes ? createHash("sha256").update(bytes).digest("hex") : "";
      if (!pendingIds.includes(assetId) || !bytes?.length || !spec || !path || !validateFirstDraftImageQualityReceipt({
        assetId, productFacts: payload.productFacts, sourcePhotoSha256: payload.sourcePhotoSha256,
        outputSha256, receipt: asset?.verification,
      })) throw new Error(`${assetId} 1차 생성 이미지의 공통 품질 검수 증거가 올바르지 않습니다.`);
      const profile = firstDraftImageReceiptReviewProfile(asset.verification);
      if (receiptProfile && receiptProfile !== profile) throw new Error("1차 이미지 부분 저장 검수 프로필이 혼합되어 있습니다.");
      receiptProfile ??= profile;
      return {
        id: assetId, path, digest: outputSha256, bytes: bytes.byteLength,
        width: spec.width, height: spec.height, verification: asset.verification, imageBytes: bytes,
      };
    };
    const persistVerifiedAsset = (asset) => {
      const verified = validateAsset(asset);
      const operation = submissionTail.then(async () => {
        const prior = persisted.get(verified.id);
        if (prior) {
          if (prior !== verified.digest) throw new Error(`${verified.id} 검수 완료 이미지가 저장 중 변경됐습니다.`);
          return;
        }
        cancellation.signal.throwIfAborted();
        const { imageBytes, ...metadata } = verified;
        const uploaded = await uploadVerifiedAsset({ jobId: payload.jobId, asset: metadata, imageBytes });
        try {
          lastOutcome = await submitFirstDraftMetadata(api, payload.jobId, metadata);
        } catch (error) {
          completionUncertain ||= Boolean(error?.completionUncertain);
          throw error;
        }
        if (lastOutcome?.status !== "done" && lastOutcome?.status !== "recorded" && uploaded?.status !== "already-recorded") {
          throw new Error(`1차 이미지 완료 readback 실패 · ${lastOutcome?.status ?? "unknown"}`);
        }
        persisted.set(verified.id, verified.digest);
        completed.add(verified.id);
        if (lastOutcome?.status === "done" && completed.size !== firstDraftImageAssetIds.length) {
          throw new Error("1차 이미지 전체 완료 응답이 저장된 역할 수와 일치하지 않습니다.");
        }
        if (lastOutcome?.status === "done" && completed.size === firstDraftImageAssetIds.length) {
          authoritativeDone = true;
          clearInterval(cancellationTimer);
        }
        log(`[1차 이미지 부분 저장] ${payload.jobId} · ${verified.id} · ${completed.size}/${firstDraftImageAssetIds.length}`);
      });
      submissionTail = operation;
      void operation.catch(() => undefined);
      return operation;
    };
    const generated = await generateVerifiedAssets({
      payload, studioResult, sourceFile, jobDir, signal: cancellation.signal,
      // Only the deterministic coordinator's awaited commitCandidate may call
      // this after its batch barrier. Generation candidates never upload here.
      onVerifiedAsset: (asset) => {
        if (!acceptingVerifiedAssets) throw new Error("종료된 이미지 제작 작업에는 결과를 추가할 수 없습니다.");
        return persistVerifiedAsset(asset);
      },
    });
    acceptingVerifiedAssets = false;
    await submissionTail;
    if (!authoritativeDone) cancellation.signal.throwIfAborted();
    if (!Array.isArray(generated)
        || generated.length !== pendingIds.length
        || new Set(generated.map((asset) => asset?.id)).size !== pendingIds.length
        || generated.some((asset) => !pendingIds.includes(asset?.id))) {
      throw new Error("미완료 1차 이미지 역할의 검수 결과가 완전하지 않습니다.");
    }
    // Compatible injected generators may return a fully verified batch without
    // callbacks. Validate every returned asset before that fallback uploads.
    generated.forEach(validateAsset);
    const byId = new Map(generated.map((asset) => [asset.id, asset]));
    for (const assetId of pendingIds) await persistVerifiedAsset(byId.get(assetId));
    if (lastOutcome?.status !== "done") {
      throw new Error(`1차 생성 이미지 8장 완료 readback 실패 · ${lastOutcome?.status ?? "unknown"}`);
    }
    log(`[1차 생성 이미지 완료] ${payload.jobId} · 8장 생성·검수·계보 반영`);
    return { status: "done", jobId: payload.jobId };
  }
  catch (error) {
    acceptingVerifiedAssets = false;
    // Drain a started write before releasing the claim or deleting its files.
    await submissionTail.catch(() => undefined);
    if (cancellation.signal.aborted && !completionUncertain) {
      log(`[1차 생성 이미지 중지] ${payload.jobId}`);
      return { status: "cancelled", jobId: payload.jobId };
    }
    const rawReason = error instanceof Error ? error.message : "first-draft-image-failed";
    const usageWaitMs = firstDraftUsageLimitWaitMs(rawReason);
    const resume = String(rawReason).match(/try again at \d{1,2}:\d{2}\s*(AM|PM)/i)?.[0];
    const reason = usageWaitMs > 0
      ? `Codex usage limit${resume ? ` · ${resume}` : ""}`
      : rawReason.slice(-300);
    if (completionUncertain) {
      logError(`[1차 생성 이미지 상태 보존] ${payload.jobId} · ${reason}`);
      return { status: "completion-uncertain", jobId: payload.jobId, reason };
    }
    logError(`[1차 생성 이미지 실패] ${payload.jobId} · ${reason}`);
    await api("/api/ai/worker/first-draft-images", {
      method: "POST",
      body: JSON.stringify({ jobId: payload.jobId, failed: true, reason: reason.slice(0, 300) }),
    }).catch(() => undefined);
    return { status: "failed", jobId: payload.jobId, reason };
  }
  finally {
    acceptingVerifiedAssets = false;
    await submissionTail.catch(() => undefined);
    clearInterval(cancellationTimer);
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
