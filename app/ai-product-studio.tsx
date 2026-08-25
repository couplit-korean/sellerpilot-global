"use client";
/* eslint-disable @next/next/no-img-element -- previews use browser-generated object/data URLs */

import dynamic from "next/dynamic";
import { CheckCircle2, Download, ExternalLink, ImageIcon, LoaderCircle, MonitorSmartphone, PencilRuler, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { withPromiseTimeout } from "../lib/promise-timeout";
import { createClient } from "../lib/supabase/client";
import { productIntakeSchema, type NormalizedProductImageSpec, type ProductIntakeDraft } from "../lib/product-intake";
import { CODEX_IMAGE_SOURCE } from "./product-studio-prompt";
import type { ProductDetailData } from "./product-detail-puck";
import type { ProductStudioResult } from "./product-studio-types";
import {
  createStudioJobMonitorRegistry,
  isStudioJobAbort,
  normalizeActiveStudioJobs,
  removeActiveStudioJob,
  shouldDisplayStudioJob,
  studioJobAbortError,
  upsertActiveStudioJob,
  type ActiveStudioJob,
} from "./_registration/studio-job-session";

const ProductDetailRender = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailRender), { ssr: false, loading: () => <div className="studio-loading"><LoaderCircle className="spin" size={24} />상세페이지 불러오는 중</div> });
const ProductDetailEditor = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailEditor), { ssr: false });

type StudioPhoto = { name: string; url: string; file: File; role: string; originalWidth: number; originalHeight: number };
type AutoThumbnail = { id: string; label: string; ratio: string; width: number; height: number; dataUrl: string };
type OptimizedPhoto = { name: string; mediaType: "image/jpeg"; blob: Blob; spec: NormalizedProductImageSpec };
type RegeneratedAssetResult = {
  mode: "asset-regeneration";
  assetId: string;
  sourceJobId: string;
  sourceProductId: string | null;
  generatedImages?: { id: string; url: string | null }[];
};
type CliStudioResult = (ProductStudioResult & {
  heroUrl?: string | null;
  generatedImages?: { id: string; url: string | null }[];
}) | RegeneratedAssetResult;
type CliJobPayload = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  result?: CliStudioResult | null;
  error?: string | null;
};

const activeStudioJobStorageKey = "sellerpilot:product-studio:active-job:v1";
const studioJobMaximumAgeMs = 2 * 60 * 60_000;
const studioUploadTimeoutMs = 45_000;

class StudioJobTerminalError extends Error {}

function readActiveStudioJobs(): ActiveStudioJob[] {
  try {
    const raw = window.sessionStorage.getItem(activeStudioJobStorageKey);
    if (!raw) return [];
    const jobs = normalizeActiveStudioJobs(JSON.parse(raw), Date.now(), studioJobMaximumAgeMs);
    const normalized = JSON.stringify(jobs);
    if (raw !== normalized) window.sessionStorage.setItem(activeStudioJobStorageKey, normalized);
    return jobs;
  } catch {
    window.sessionStorage.removeItem(activeStudioJobStorageKey);
    return [];
  }
}

function persistActiveStudioJob(jobId: string, ownerSessionId: string) {
  const job = { jobId, ownerSessionId, startedAt: Date.now() } satisfies ActiveStudioJob;
  window.sessionStorage.setItem(activeStudioJobStorageKey, JSON.stringify(upsertActiveStudioJob(readActiveStudioJobs(), job)));
  return job;
}

function clearActiveStudioJob(jobId: string) {
  const remaining = removeActiveStudioJob(readActiveStudioJobs(), jobId);
  if (remaining.length) window.sessionStorage.setItem(activeStudioJobStorageKey, JSON.stringify(remaining));
  else window.sessionStorage.removeItem(activeStudioJobStorageKey);
}

function throwIfStudioJobAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? studioJobAbortError();
}

function delay(ms: number, signal: AbortSignal) {
  throwIfStudioJobAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? studioJobAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchJsonWithStudioJobTimeout<Payload>(
  input: RequestInfo | URL,
  init: RequestInit,
  parentSignal: AbortSignal,
  timeoutMs: number,
  fallbackPayload: Payload,
) {
  throwIfStudioJobAborted(parentSignal);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason ?? studioJobAbortError());
  parentSignal.addEventListener("abort", abortFromParent, { once: true });
  const timer = window.setTimeout(() => controller.abort(new DOMException("요청 제한시간을 초과했습니다.", "TimeoutError")), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => fallbackPayload) as Payload;
    if (controller.signal.aborted) throw controller.signal.reason ?? studioJobAbortError();
    return { response, payload };
  } finally {
    window.clearTimeout(timer);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

async function canvasToJpeg(canvas: HTMLCanvasElement) {
  for (const quality of [0.9, 0.82, 0.72]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 3 * 1024 * 1024) return blob;
  }
  throw new Error("채널 공통 제한인 3MB 아래로 이미지를 최적화하지 못했습니다.");
}

async function optimizePhoto(photo: StudioPhoto): Promise<OptimizedPhoto> {
  try {
    const source = await withPromiseTimeout(
      blobToDataUrl(photo.file),
      30_000,
      `${photo.name} 파일을 30초 안에 읽지 못했습니다. 다른 사진으로 다시 시도해 주세요.`,
    );
    const image = await withPromiseTimeout(
      loadImage(source),
      30_000,
      `${photo.name} 이미지를 30초 안에 해석하지 못했습니다. 지원되는 사진 형식인지 확인해 주세요.`,
    );
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1200;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 변환 화면을 열지 못했습니다.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const inset = 48;
    const scale = Math.min((canvas.width - inset * 2) / image.naturalWidth, (canvas.height - inset * 2) / image.naturalHeight);
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, Math.round((canvas.width - width) / 2), Math.round((canvas.height - height) / 2), width, height);
    const blob = await withPromiseTimeout(
      canvasToJpeg(canvas),
      30_000,
      `${photo.name} 이미지 보정이 30초 안에 끝나지 않았습니다. 사진 크기를 줄여 다시 시도해 주세요.`,
    );
    const name = photo.name.replace(/\.[^.]+$/, ".jpg");
    return {
      name,
      mediaType: "image/jpeg",
      blob,
      spec: {
        name,
        role: photo.role,
        originalWidth: photo.originalWidth,
        originalHeight: photo.originalHeight,
        width: 1200,
        height: 1200,
        bytes: blob.size,
        mediaType: "image/jpeg",
        fit: "contain",
      },
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`${photo.name} 이미지를 JPEG로 변환하지 못했습니다.`);
  }
}

async function optimizeAndUploadInBatches(photos: StudioPhoto[], userId: string, jobId: string, signal: AbortSignal) {
  const supabase = createClient();
  const uploadedPaths: string[] = [];
  const imageSpecs: NormalizedProductImageSpec[] = [];
  try {
    for (let start = 0; start < photos.length; start += 4) {
      throwIfStudioJobAborted(signal);
      const batch = await Promise.all(photos.slice(start, start + 4).map((photo) => optimizePhoto(photo)));
      throwIfStudioJobAborted(signal);
      const results = await Promise.allSettled(batch.map(async (photo, offset) => {
        const index = start + offset;
        const path = `${userId}/${jobId}/input/${String(index + 1).padStart(3, "0")}.jpg`;
        const { error } = await withPromiseTimeout(
          supabase.storage.from("sellerpilot-ai").upload(path, photo.blob, {
            contentType: photo.mediaType,
            cacheControl: "3600",
            upsert: false,
          }),
          studioUploadTimeoutMs,
          `${photo.name} 비공개 업로드가 45초 안에 끝나지 않았습니다. 모바일 연결을 확인한 뒤 다시 시도해 주세요.`,
        );
        if (error) throw new Error(`${photo.name} 비공개 업로드에 실패했습니다.`);
        return { path, spec: photo.spec };
      }));
      for (const result of results) if (result.status === "fulfilled") {
        uploadedPaths.push(result.value.path);
        imageSpecs.push(result.value.spec);
      }
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
      throwIfStudioJobAborted(signal);
    }
    return { uploadedPaths, imageSpecs };
  } catch (error) {
    if (uploadedPaths.length) {
      await withPromiseTimeout(
        supabase.storage.from("sellerpilot-ai").remove(uploadedPaths),
        15_000,
        "업로드 임시파일 정리 제한시간을 초과했습니다.",
      ).catch(() => null);
    }
    throw error;
  }
}

const thumbnailPresets = [
  { id: "square", label: "마켓 대표", ratio: "1:1 · 1200", width: 1200, height: 1200 },
  { id: "portrait", label: "모바일 피드", ratio: "4:5 · 1200×1500", width: 1200, height: 1500 },
  { id: "wide", label: "프로모션 배너", ratio: "16:9 · 1600×900", width: 1600, height: 900 },
];

const detailPresets = [
  { id: "detail-overview", label: "상세 전체컷", ratio: "1:1 · 1200", width: 1200, height: 1200 },
  { id: "detail-feature", label: "상세 특징컷", ratio: "1:1 · 1200", width: 1200, height: 1200 },
  { id: "detail-use", label: "상세 사용컷", ratio: "1:1 · 1200", width: 1200, height: 1200 },
  { id: "detail-package", label: "상세 구성컷", ratio: "1:1 · 1200", width: 1200, height: 1200 },
];

const generatedPreviewPresets = [...thumbnailPresets, ...detailPresets];

export function AiProductStudio({ mainPhoto, photos, manualFields, requestId, onRunningChange, notify, onJobQueued, onResultReady }: {
  mainPhoto: StudioPhoto | null;
  photos: StudioPhoto[];
  manualFields: ProductIntakeDraft;
  requestId: number;
  onRunningChange: (running: boolean) => void;
  notify: (message: string) => void;
  onJobQueued?: (jobId: string) => void;
  onResultReady?: (result: ProductStudioResult, productId: string | null) => void;
}) {
  const [result, setResult] = useState<ProductStudioResult | null>(null);
  const [thumbnails, setThumbnails] = useState<AutoThumbnail[]>([]);
  const [aiHero, setAiHero] = useState("");
  const [generating, setGenerating] = useState(false);
  const [cliPhase, setCliPhase] = useState<"idle" | "queued" | "running">("idle");
  const [editorOpen, setEditorOpen] = useState(false);
  const [savedDetailData, setSavedDetailData] = useState<ProductDetailData | null>(null);
  const [lastError, setLastError] = useState("");
  const [sourceJobId, setSourceJobId] = useState("");
  const [sourceProductId, setSourceProductId] = useState<string | null>(null);
  const [regeneratingAssetId, setRegeneratingAssetId] = useState("");
  const [queuedOwnJobId, setQueuedOwnJobId] = useState("");
  const [studioSessionId] = useState(() => crypto.randomUUID());
  const [jobMonitors] = useState(() => createStudioJobMonitorRegistry());
  const handledRequest = useRef(0);
  const recoveryStarted = useRef(false);
  const displayJobId = useRef("");
  const studioMountedRef = useRef(true);
  const lifecycleControllerRef = useRef<AbortController | null>(null);
  const currentImageUrl = aiHero || mainPhoto?.url || "";

  useEffect(() => {
    studioMountedRef.current = true;
    lifecycleControllerRef.current = new AbortController();
    return () => {
      studioMountedRef.current = false;
      lifecycleControllerRef.current?.abort(studioJobAbortError());
      lifecycleControllerRef.current = null;
      jobMonitors.abortAll();
    };
  }, [jobMonitors]);

  const waitForCliJob = useCallback(async (
    jobId: string,
    accessToken: string,
    signal: AbortSignal,
    onPhase?: (phase: "queued" | "running") => void,
  ) => {
    const deadline = Date.now() + studioJobMaximumAgeMs;
    let consecutiveRequestFailures = 0;
    while (Date.now() < deadline) {
      throwIfStudioJobAborted(signal);
      let response: Response;
      let payload: CliJobPayload & { message?: string };
      try {
        ({ response, payload } = await fetchJsonWithStudioJobTimeout(`/api/ai/jobs/${jobId}`, {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }, signal, 15_000, { message: "CLI 작업 상태 응답을 읽지 못했습니다." } as CliJobPayload & { message?: string }));
        consecutiveRequestFailures = 0;
      } catch (error) {
        if (signal.aborted || isStudioJobAbort(error)) throw signal.reason ?? error;
        consecutiveRequestFailures += 1;
        if (consecutiveRequestFailures >= 5) throw new Error("모바일 네트워크에서 작업 상태를 5회 연속 확인하지 못했습니다. 등록 이력에서 서버 작업 상태를 계속 확인할 수 있습니다.");
        await delay(2_000, signal);
        continue;
      }
      throwIfStudioJobAborted(signal);
      if (!response.ok) {
        if (response.status === 404) throw new StudioJobTerminalError(payload.message ?? "CLI 작업을 찾지 못했습니다.");
        throw new Error(payload.message ?? "CLI 작업 상태를 확인하지 못했습니다.");
      }
      if (payload.status === "succeeded" && payload.result) return payload.result;
      if (payload.status === "failed" || payload.status === "cancelled") {
        throw new StudioJobTerminalError(payload.error || "ChatGPT CLI 작업이 완료되지 못했습니다.");
      }
      onPhase?.(payload.status === "running" ? "running" : "queued");
      await delay(3_000, signal);
    }
    throw new Error("ChatGPT CLI 작업 대기시간이 2시간을 초과했습니다. 등록 이력과 작업자 연결 상태를 확인해 주세요.");
  }, []);

  const finishStudioJob = useCallback(async (job: ActiveStudioJob, accessToken: string, recovered: boolean) => {
    const monitor = jobMonitors.begin(job.jobId);
    if (!monitor) return;
    const canDisplay = () => shouldDisplayStudioJob({
      job,
      mounted: studioMountedRef.current,
      currentSessionId: studioSessionId,
      displayJobId: displayJobId.current,
    });
    try {
      let cliResult: CliStudioResult;
      try {
        cliResult = await waitForCliJob(job.jobId, accessToken, monitor.signal, (phase) => {
          if (canDisplay()) setCliPhase(phase);
        });
      } catch (error) {
        if (error instanceof StudioJobTerminalError) clearActiveStudioJob(job.jobId);
        throw error;
      }
      if (cliResult.mode !== "cli") {
        clearActiveStudioJob(job.jobId);
        throw new Error("상품 분석 결과 형식이 올바르지 않습니다.");
      }
      const { heroUrl, generatedImages, ...nextResult } = cliResult;
      if (canDisplay()) {
        setSourceJobId(job.jobId);
        setResult(nextResult);
        setAiHero(heroUrl ?? "");
        setThumbnails(generatedPreviewPresets.map((preset) => ({
          ...preset,
          dataUrl: generatedImages?.find((image) => image.id === preset.id)?.url ?? "",
        })).filter((thumbnail) => thumbnail.dataUrl));
        setSavedDetailData(null);
      }
      const { response: productResponse, payload: productPayload } = await fetchJsonWithStudioJobTimeout("/api/operations/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "product_create", jobId: job.jobId }),
      }, monitor.signal, 30_000, {} as { id?: string | null; code?: string; message?: string });
      throwIfStudioJobAborted(monitor.signal);
      const productId = productResponse.ok && typeof productPayload.id === "string" ? productPayload.id : null;
      if (!productId) {
        if (productResponse.status === 409 && productPayload.code === "DUPLICATE_SELLER_SKU") clearActiveStudioJob(job.jobId);
        throw new Error(productPayload.message || "이미지 제작은 완료됐지만 상품 원장 저장을 확인하지 못했습니다. 새로고침하면 완료 작업부터 다시 연결합니다.");
      }
      if (canDisplay()) setSourceProductId(productId);
      clearActiveStudioJob(job.jobId);
      if (canDisplay()) onResultReady?.(nextResult, productId);
      if (studioMountedRef.current) notify(recovered
        ? `이전 상품의 ChatGPT CLI 작업을 백그라운드에서 복구해 이미지 ${aiGeneratedAssetSpecs.length}종과 상품 원장을 등록 이력에 연결했습니다.`
        : `ChatGPT CLI 분석, codex-image 이미지 ${aiGeneratedAssetSpecs.length}종과 상품 원장 연결을 완료했습니다.`);
    } finally {
      jobMonitors.end(job.jobId, monitor);
    }
  }, [jobMonitors, notify, onResultReady, studioSessionId, waitForCliJob]);

  const generate = useCallback(async () => {
    if (!mainPhoto || generating || queuedOwnJobId) return;
    const lifecycleController = lifecycleControllerRef.current;
    if (!lifecycleController || lifecycleController.signal.aborted || !studioMountedRef.current) return;
    displayJobId.current = "";
    setGenerating(true);
    onRunningChange(true);
    setAiHero("");
    setThumbnails([]);
    setLastError("");
    setCliPhase("queued");
    try {
      const validatedIntake = productIntakeSchema.safeParse(manualFields);
      if (!validatedIntake.success) {
        throw new Error(validatedIntake.error.issues[0]?.message ?? "상품 필수정보와 자료 사용 권한을 확인해 주세요.");
      }
      const { data: sessionData } = await createClient().auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const userId = sessionData.session?.user.id;
      if (!accessToken || !userId) throw new Error("AI 제작을 실행하려면 관리자 로그인이 필요합니다.");
      if (photos.length > 100) throw new Error("한 작업에는 대표사진을 포함해 최대 100장까지 분석할 수 있습니다.");
      const jobId = crypto.randomUUID();
      const { uploadedPaths: imagePaths, imageSpecs } = await optimizeAndUploadInBatches(photos, userId, jobId, lifecycleController.signal);
      throwIfStudioJobAborted(lifecycleController.signal);
      persistActiveStudioJob(jobId, studioSessionId);
      const { response, payload: queued } = await fetchJsonWithStudioJobTimeout("/api/ai/product-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jobId, manualFields: validatedIntake.data, imagePaths, imageSpecs }),
      }, lifecycleController.signal, 30_000, { message: "CLI 작업 등록 응답을 읽지 못했습니다." } as { jobId?: string; message?: string });
      throwIfStudioJobAborted(lifecycleController.signal);
      if (!response.ok || !queued.jobId) {
        clearActiveStudioJob(jobId);
        throw new Error(queued.message ?? "상품 분석 요청을 처리하지 못했습니다.");
      }
      if (queued.jobId !== jobId) clearActiveStudioJob(jobId);
      const queuedJob = persistActiveStudioJob(queued.jobId, studioSessionId);
      displayJobId.current = queued.jobId;
      setQueuedOwnJobId(queued.jobId);
      onJobQueued?.(queued.jobId);
      notify("상품 분석 작업을 운영 큐에 등록했습니다. 처리되는 동안 다른 상품 등록을 바로 시작할 수 있습니다.");
      void finishStudioJob(queuedJob, accessToken, false).catch((error) => {
        if (isStudioJobAbort(error) || !studioMountedRef.current) return;
        const message = error instanceof Error ? error.message : "AI 스튜디오 처리 중 오류가 발생했습니다.";
        setLastError(message);
        notify(message);
      }).finally(() => {
        if (studioMountedRef.current) setQueuedOwnJobId((current) => current === queued.jobId ? "" : current);
      });
    } catch (error) {
      if (isStudioJobAbort(error) || !studioMountedRef.current) return;
      const message = error instanceof Error ? error.message : "AI 스튜디오 처리 중 오류가 발생했습니다.";
      setLastError(message);
      notify(message);
    } finally {
      if (studioMountedRef.current) {
        setGenerating(false);
        setCliPhase("idle");
        onRunningChange(false);
      }
    }
  }, [finishStudioJob, generating, mainPhoto, manualFields, notify, onJobQueued, onRunningChange, photos, queuedOwnJobId, studioSessionId]);

  const regenerateAsset = useCallback(async (assetId: string) => {
    if (!sourceJobId || generating || regeneratingAssetId) return;
    const lifecycleController = lifecycleControllerRef.current;
    if (!lifecycleController || lifecycleController.signal.aborted || !studioMountedRef.current) return;
    setRegeneratingAssetId(assetId);
    setLastError("");
    onRunningChange(true);
    let monitor: AbortController | null = null;
    let monitoredJobId = "";
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("이미지를 재제작하려면 관리자 로그인이 필요합니다.");
      const jobId = crypto.randomUUID();
      const { response, payload: queued } = await fetchJsonWithStudioJobTimeout("/api/ai/product-studio/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jobId, sourceJobId, sourceProductId, assetId }),
      }, lifecycleController.signal, 30_000, { message: "재제작 작업 응답을 읽지 못했습니다." } as { jobId?: string; message?: string });
      throwIfStudioJobAborted(lifecycleController.signal);
      if (!response.ok || !queued.jobId) throw new Error(queued.message ?? "이미지 재제작 작업을 등록하지 못했습니다.");
      monitoredJobId = queued.jobId;
      monitor = jobMonitors.begin(monitoredJobId);
      if (!monitor) throw new Error("같은 이미지 작업 상태를 이미 확인하고 있습니다.");
      const regenerated = await waitForCliJob(monitoredJobId, accessToken, monitor.signal);
      if (regenerated.mode !== "asset-regeneration" || regenerated.assetId !== assetId) {
        throw new Error("재제작 이미지 결과가 요청과 일치하지 않습니다.");
      }
      const nextUrl = regenerated.generatedImages?.find((asset) => asset.id === assetId)?.url ?? "";
      if (!nextUrl) throw new Error("재제작 이미지 주소를 확인하지 못했습니다.");
      if (assetId === "hero") setAiHero(nextUrl);
      else setThumbnails((current) => current.map((asset) => asset.id === assetId ? { ...asset, dataUrl: nextUrl } : asset));
      notify(`${aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)?.label ?? "선택 이미지"} 1장만 다시 제작해 교체했습니다.`);
    } catch (error) {
      if (isStudioJobAbort(error) || !studioMountedRef.current) return;
      const message = error instanceof Error ? error.message : "이미지 재제작 중 오류가 발생했습니다.";
      setLastError(message);
      notify(message);
    } finally {
      if (monitor) jobMonitors.end(monitoredJobId, monitor);
      if (studioMountedRef.current) {
        setRegeneratingAssetId("");
        onRunningChange(false);
      }
    }
  }, [generating, jobMonitors, notify, onRunningChange, regeneratingAssetId, sourceJobId, sourceProductId, waitForCliJob]);

  useEffect(() => {
    if (!requestId || handledRequest.current === requestId) return;
    handledRequest.current = requestId;
    void generate();
  }, [generate, requestId]);

  useEffect(() => {
    if (recoveryStarted.current || requestId) return;
    const activeJobs = readActiveStudioJobs();
    if (!activeJobs.length) return;
    const recoveryTimer = window.setTimeout(() => {
      if (recoveryStarted.current) return;
      recoveryStarted.current = true;
      void (async () => {
        try {
          const { data: sessionData } = await createClient().auth.getSession();
          const accessToken = sessionData.session?.access_token;
          if (!accessToken) throw new Error("진행 중인 상품 분석을 복구하려면 관리자 로그인이 필요합니다.");
          if (!studioMountedRef.current) return;
          notify(`이전 폼에서 시작한 상품 분석 ${activeJobs.length}건을 등록 이력에만 백그라운드 연결합니다. 현재 새 상품 입력은 변경하지 않습니다.`);
          for (const activeJob of activeJobs) {
            void finishStudioJob(activeJob, accessToken, true).catch((error) => {
              if (isStudioJobAbort(error) || !studioMountedRef.current) return;
              const message = error instanceof Error ? error.message : "상품 분석 작업 복구 중 오류가 발생했습니다.";
              notify(`이전 상품 작업 복구: ${message}`);
            });
          }
        } catch (error) {
          if (isStudioJobAbort(error) || !studioMountedRef.current) return;
          const message = error instanceof Error ? error.message : "상품 분석 작업 복구 중 오류가 발생했습니다.";
          notify(`이전 상품 작업 복구: ${message}`);
        }
      })();
    }, 0);
    return () => window.clearTimeout(recoveryTimer);
  }, [finishStudioJob, notify, requestId]);

  const downloadImage = (thumbnail: AutoThumbnail) => {
    const anchor = document.createElement("a");
    anchor.href = thumbnail.dataUrl;
    anchor.download = `sellerpilot-${thumbnail.id}.jpg`;
    anchor.click();
  };

  const creativeThumbnails = thumbnails.filter((thumbnail) => thumbnailPresets.some((preset) => preset.id === thumbnail.id));
  const detailThumbnails = thumbnails.filter((thumbnail) => detailPresets.some((preset) => preset.id === thumbnail.id));
  const studioAssetUrls = useMemo(() => Object.fromEntries(thumbnails.map((thumbnail) => [thumbnail.id, thumbnail.dataUrl])), [thumbnails]);

  return (
    <section className="panel ai-product-studio" id="ai-product-studio">
      <div className="studio-heading">
        <div><span className="panel-kicker">AI DETAIL & CREATIVE STUDIO</span><h3>상세페이지 · 썸네일 자동 제작</h3><p>로컬 ChatGPT CLI가 사진과 설명을 분석하고, codex-image와 Puck 편집 흐름으로 결과를 만듭니다.</p></div>
        <div><span className={`studio-mode ${generating ? cliPhase : result?.mode ?? "idle"}`}><i />{generating ? cliPhase === "running" ? "CLI 제작 중" : "CLI 대기 중" : result ? "CLI 실데이터" : queuedOwnJobId ? "서버 처리 중" : "실행 대기"}</span><button type="button" onClick={() => void generate()} disabled={!mainPhoto || generating || Boolean(queuedOwnJobId)}>{generating || queuedOwnJobId ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{queuedOwnJobId ? "이 상품 처리 중" : "다시 생성"}</button></div>
      </div>
      <div className="studio-source-row">
        <span><CheckCircle2 size={15} /><b>이미지 분석</b><small>{mainPhoto ? `${photos.length}장 반영` : "대표사진 등록 대기"}</small></span>
        <span><Sparkles size={15} /><b>상세 기획</b><small>5–7개 구매 흐름 섹션</small></span>
        <span><ImageIcon size={15} /><b>자동 이미지</b><small>대표 4종 · 상세 4종</small></span>
        <a href={CODEX_IMAGE_SOURCE} target="_blank" rel="noreferrer"><WandSparkles size={15} /><b>Codex Image 규칙</b><small>gpt-image-2 · MIT</small><ExternalLink size={12} /></a>
      </div>
      <div className="studio-workspace">
        <aside className="creative-rail">
          <div className="creative-rail-head"><span><b>자동 제작 썸네일</b><small>제품이 프레임의 70% 이상 보이는 마켓용 이미지</small></span><em>{creativeThumbnails.length || 3}종</em></div>
          {aiHero && <article className="thumbnail-card ai"><div><img src={aiHero} alt="codex-image가 제작한 상품 연출컷" /><span>CODEX IMAGE</span></div><b>CLI 상품 연출컷</b><small>ChatGPT OAuth · 원본 충실도 높음</small><button type="button" className="asset-regenerate" onClick={() => void regenerateAsset("hero")} disabled={Boolean(regeneratingAssetId) || generating}>{regeneratingAssetId === "hero" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}이 이미지만 재제작</button></article>}
          <div className="thumbnail-grid">
            {creativeThumbnails.length ? creativeThumbnails.map((thumbnail) => <article className="thumbnail-card" key={thumbnail.id}><button type="button" className="thumbnail-preview" onClick={() => downloadImage(thumbnail)}><img src={thumbnail.dataUrl} alt={`${thumbnail.label} 자동 썸네일`} /><span><Download size={13} />다운로드</span></button><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small><button type="button" className="asset-regenerate" onClick={() => void regenerateAsset(thumbnail.id)} disabled={Boolean(regeneratingAssetId) || generating}>{regeneratingAssetId === thumbnail.id ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}이 이미지만 재제작</button></article>) : thumbnailPresets.map((thumbnail) => <article className="thumbnail-card placeholder" key={thumbnail.id}><div><ImageIcon size={22} /><span>대표사진을 올리면 자동 제작</span></div><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>)}
          </div>
          <div className="creative-rail-head"><span><b>상세페이지 이미지</b><small>전체·특징·사용·구성 4장을 채널 상세 본문에 삽입</small></span><em>{detailThumbnails.length || 4}종</em></div>
          <div className="thumbnail-grid detail-assets">
            {detailThumbnails.length ? detailThumbnails.map((thumbnail) => <article className="thumbnail-card" key={thumbnail.id}><button type="button" className="thumbnail-preview" onClick={() => downloadImage(thumbnail)}><img src={thumbnail.dataUrl} alt={`${thumbnail.label} 자동 상세 이미지`} /><span><Download size={13} />다운로드</span></button><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small><button type="button" className="asset-regenerate" onClick={() => void regenerateAsset(thumbnail.id)} disabled={Boolean(regeneratingAssetId) || generating}>{regeneratingAssetId === thumbnail.id ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}이 이미지만 재제작</button></article>) : detailPresets.map((thumbnail) => <article className="thumbnail-card placeholder" key={thumbnail.id}><div><ImageIcon size={22} /><span>상세 전용 이미지 생성 대기</span></div><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>)}
          </div>
          {result ? <div className="creative-summary"><span>CREATIVE DIRECTION</span><b>{result.design.themeName}</b><p>{result.product.oneLine}</p><div>{Object.values(result.design.palette).map((color) => <i key={color} style={{ background: color }} title={color} />)}</div></div> : <div className="creative-summary empty"><span>CLI RESULT</span><b>실제 분석 결과 대기</b><p>대표사진을 등록하고 분석을 시작하면 결과만 표시합니다.</p></div>}
        </aside>

        <article className="detail-preview-panel">
          <div className="detail-preview-toolbar"><span><MonitorSmartphone size={16} /><b>상세페이지 라이브 미리보기</b><small>모바일 우선 · 블록형 구성</small></span><button type="button" onClick={() => setEditorOpen(true)} disabled={!result}><PencilRuler size={15} />Puck으로 직접 편집</button></div>
          <div className="detail-preview-scroll">{result && currentImageUrl ? <div className="detail-preview-canvas"><ProductDetailRender result={result} imageUrl={currentImageUrl} assetUrls={studioAssetUrls} data={savedDetailData} /></div> : <div className="studio-empty-preview"><ImageIcon size={34} /><b>실제 상세페이지 결과가 아직 없습니다.</b><small>대표사진과 상품 정보를 분석한 뒤 ChatGPT CLI 결과를 표시합니다.</small></div>}</div>
        </article>
      </div>
      {lastError && <div className="studio-warning error"><b>실제 AI 작업 실패</b><p>{lastError}</p><small>예시 결과로 대체하지 않았습니다. 작업 이력에서 재시도하거나 CLI 작업자 상태를 확인해 주세요.</small></div>}
      {result && result.warnings.length > 0 && <div className="studio-warning"><b>AI 검수 메모</b><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      {editorOpen && result && <ProductDetailEditor result={result} imageUrl={currentImageUrl} assetUrls={studioAssetUrls} data={savedDetailData} onSave={(next) => { setSavedDetailData(next); notify("상세페이지 편집 내용을 현재 작업에 저장했습니다."); }} onClose={() => setEditorOpen(false)} />}
    </section>
  );
}
