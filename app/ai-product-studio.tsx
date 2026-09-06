"use client";
/* eslint-disable @next/next/no-img-element -- previews use browser-generated object/data URLs */

import dynamic from "next/dynamic";
import { CheckCircle2, ChevronDown, Download, ExternalLink, ImageIcon, LoaderCircle, MonitorSmartphone, PencilRuler, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { classifyExactJobAdmission } from "../lib/exact-job-admission";
import { withPromiseTimeout } from "../lib/promise-timeout";
import { createClient } from "../lib/supabase/client";
import { productIntakeSchema, type ProductIntakeDraft, type SourcePreservingProductImageSpec } from "../lib/product-intake";
import { uploadStudioStorageObject } from "../lib/studio-direct-upload";
import { assertStudioPhotoBatch, uploadStudioPhotoPairs } from "../lib/studio-photo-upload";
import { isStudioExecutionReady, type StudioWorkerReadiness } from "../lib/studio-worker-readiness";
import {
  assertStudioSourceDimensions,
  assertStudioSourceFile,
  studioPhotoPreparationConcurrency,
  studioPhotoUploadConcurrency,
  type StudioSourceImageMediaType,
} from "../lib/studio-source-photo-policy";
import { CODEX_IMAGE_SOURCE } from "./product-studio-prompt";
import { makeValidatedProductDetailPersistable, parsePersistedProductDetailPage } from "./_publishing/product-detail-persistence";
import type { ProductDetailData } from "./product-detail-puck";
import type { ProductStudioResult } from "./product-studio-types";
import { waitForAbortablePromise } from "./operations-snapshot-request-coordinator";
import {
  activeStudioJobStorageKey,
  createStudioJobMonitorRegistry,
  isStudioJobAbort,
  normalizeActiveStudioJobs,
  removeActiveStudioJob,
  shouldDisplayStudioJob,
  studioJobMaximumAgeMs,
  studioJobAbortError,
  upsertActiveStudioJob,
  type ActiveStudioJob,
} from "./_registration/studio-job-session";
import { normalizeStudioPhotoReadError } from "./_publishing/studio-photo-read-error";

const ProductDetailRender = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailRender), { ssr: false, loading: () => <div className="studio-loading"><LoaderCircle className="spin" size={24} />상세페이지 불러오는 중</div> });
const ProductDetailEditor = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailEditor), { ssr: false });

export type StudioPhoto = { name: string; url: string; file: File; role: string; originalWidth: number; originalHeight: number };
export type StudioCompetitorContext = {
  query: string;
  providerStatuses: Array<{
    provider: "naver_shopping" | "elevenst_product_search" | "ebay_browse" | "brave_marketplace_web";
    status: "searched" | "pending" | "failed" | "unavailable";
    count: number;
    marketplaces: Array<"smartstore" | "coupang" | "elevenst" | "qoo10" | "shopee" | "lazada" | "ebay" | "temu" | "other">;
  }>;
  candidates: Array<{
    provider: "naver_shopping" | "elevenst_product_search" | "ebay_browse" | "brave_marketplace_web";
    marketplace: "smartstore" | "coupang" | "elevenst" | "qoo10" | "shopee" | "lazada" | "ebay" | "temu" | "other";
    externalId: string;
    title: string;
    url: string;
    mallName: string;
    price: number;
    currency: string;
    verifiedSameProduct: true;
  }>;
};
type AutoThumbnail = { id: string; label: string; ratio: string; width: number; height: number; dataUrl: string };
type OptimizedPhoto = {
  name: string;
  mediaType: "image/jpeg";
  blob: Blob;
  spec: Omit<SourcePreservingProductImageSpec, "originalPath">;
};
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
type StudioSubmissionPhase = "idle" | "submitting" | "reconciling" | "monitoring" | "uncertain";
export type StudioSubmissionMode = "ai" | "manual_mvp";
type StudioJobWaitOptions = {
  notFoundGraceMs?: number;
  maximumAgeMs?: number;
  onAccepted?: () => void;
  preserveMissingAdmission?: boolean;
};
type StudioAbortScope = {
  signal: AbortSignal;
  timeoutSignal: AbortSignal | null;
  didTimeout: () => boolean;
  cleanup: () => void;
};

const studioUploadTimeoutMs = 45_000;
const studioJobAdmissionGraceMs = 30_000;
const studioPreUploadOptimizationLimit = 9;
const maximumSubmittedIntakeSnapshots = 9;
const pendingManualProductRequestStoragePrefix = "sellerpilot.pending-manual-product.v1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PendingManualProductRequest = {
  version: 1;
  ownerId: string;
  jobId: string;
  requestFingerprint: string;
  requestBody: string;
  createdAt: number;
};

type ParsedManualProductRequestBody = {
  jobId: string;
  manualFields: ProductIntakeDraft;
  imagePaths: string[];
  imageSpecs: SourcePreservingProductImageSpec[];
};

export async function manualProductRequestFingerprint(sellerSku: string) {
  const normalizedSku = sellerSku.trim().toUpperCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedSku));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function pendingManualProductRequestStorageKey(ownerId: string, requestFingerprint: string) {
  return `${pendingManualProductRequestStoragePrefix}:${ownerId}:${requestFingerprint}`;
}

function parseManualProductRequestBody(value: string): ParsedManualProductRequestBody | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const manualFields = productIntakeSchema.safeParse(parsed.manualFields);
    const imagePaths = Array.isArray(parsed.imagePaths)
      ? parsed.imagePaths.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    const imageSpecs = Array.isArray(parsed.imageSpecs)
      ? parsed.imageSpecs as SourcePreservingProductImageSpec[]
      : [];
    if (!uuidPattern.test(String(parsed.jobId ?? ""))
      || !manualFields.success
      || !imagePaths.length
      || imagePaths.length !== imageSpecs.length) return null;
    return {
      jobId: String(parsed.jobId),
      manualFields: manualFields.data,
      imagePaths,
      imageSpecs,
    };
  } catch {
    return null;
  }
}

export function normalizePendingManualProductRequest(
  value: unknown,
  ownerId: string,
  requestFingerprint: string,
): PendingManualProductRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1
    || candidate.ownerId !== ownerId
    || candidate.requestFingerprint !== requestFingerprint
    || !uuidPattern.test(String(candidate.jobId ?? ""))
    || typeof candidate.requestBody !== "string"
    || typeof candidate.createdAt !== "number"
    || !Number.isFinite(candidate.createdAt)
    || candidate.createdAt <= 0) return null;
  const request = parseManualProductRequestBody(candidate.requestBody);
  if (!request || request.jobId !== candidate.jobId) return null;
  return candidate as PendingManualProductRequest;
}

function readPendingManualProductRequest(ownerId: string, requestFingerprint: string) {
  const storageKey = pendingManualProductRequestStorageKey(ownerId, requestFingerprint);
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const pending = normalizePendingManualProductRequest(JSON.parse(raw), ownerId, requestFingerprint);
    if (pending) return pending;
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Invalid or unavailable browser storage cannot identify an accepted
    // remote request. A failed write is handled before the POST begins.
  }
  return null;
}

function persistPendingManualProductRequest(pending: PendingManualProductRequest) {
  window.sessionStorage.setItem(
    pendingManualProductRequestStorageKey(pending.ownerId, pending.requestFingerprint),
    JSON.stringify(pending),
  );
}

function clearPendingManualProductRequest(pending: PendingManualProductRequest) {
  try {
    const storageKey = pendingManualProductRequestStorageKey(pending.ownerId, pending.requestFingerprint);
    const current = readPendingManualProductRequest(pending.ownerId, pending.requestFingerprint);
    if (current?.jobId === pending.jobId && current.requestBody === pending.requestBody) {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // A committed server result must remain successful even if Safari or an
    // embedded browser refuses the best-effort local cleanup.
  }
}

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

export function createStudioAbortScope(
  sourceSignals: readonly AbortSignal[],
  timeoutMs?: number,
  nativeTimeoutSignal: AbortSignal | null = null,
): StudioAbortScope {
  let fallbackTimeoutId: number | null = null;
  let timeoutSignal = nativeTimeoutSignal;
  if (timeoutMs !== undefined && !timeoutSignal) {
    const timeoutController = new AbortController();
    fallbackTimeoutId = window.setTimeout(() => {
      timeoutController.abort(new DOMException("요청 제한시간을 초과했습니다.", "TimeoutError"));
    }, timeoutMs);
    timeoutSignal = timeoutController.signal;
  }

  let timedOut = Boolean(timeoutSignal?.aborted);
  const markTimedOut = () => {
    timedOut = true;
  };
  timeoutSignal?.addEventListener("abort", markTimedOut, { once: true });

  const signals = timeoutSignal ? [...sourceSignals, timeoutSignal] : [...sourceSignals];
  let removeFallbackListeners = () => {};
  let signal: AbortSignal;
  if (signals.length === 1) {
    [signal] = signals;
  } else if (typeof AbortSignal.any === "function") {
    signal = AbortSignal.any(signals);
  } else {
    const combinedController = new AbortController();
    const abortFromSource = (source: AbortSignal) => {
      if (!combinedController.signal.aborted) {
        combinedController.abort(source.reason ?? studioJobAbortError());
      }
    };
    const listeners = signals.map((source) => {
      const listener = () => abortFromSource(source);
      if (source.aborted) abortFromSource(source);
      else source.addEventListener("abort", listener, { once: true });
      return { source, listener };
    });
    removeFallbackListeners = () => {
      for (const { source, listener } of listeners) source.removeEventListener("abort", listener);
    };
    signal = combinedController.signal;
  }

  let cleaned = false;
  return {
    signal,
    timeoutSignal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      if (fallbackTimeoutId !== null) window.clearTimeout(fallbackTimeoutId);
      timeoutSignal?.removeEventListener("abort", markTimedOut);
      removeFallbackListeners();
    },
  };
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
    const response = await waitForAbortablePromise(fetch(input, { ...init, signal: controller.signal }), controller.signal);
    const payload = await waitForAbortablePromise(response.json().catch(() => fallbackPayload), controller.signal) as Payload;
    if (controller.signal.aborted) throw controller.signal.reason ?? studioJobAbortError();
    return { response, payload };
  } finally {
    window.clearTimeout(timer);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

async function getStudioSessionWithDeadline(parentSignal: AbortSignal, timeoutMessage: string) {
  throwIfStudioJobAborted(parentSignal);
  const nativeTimeoutSignal = typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(15_000)
    : null;
  const abortScope = createStudioAbortScope([parentSignal], 15_000, nativeTimeoutSignal);
  try {
    return await waitForAbortablePromise(createClient().auth.getSession(), abortScope.signal);
  } catch (error) {
    if (parentSignal.aborted) throw parentSignal.reason ?? studioJobAbortError();
    if (abortScope.didTimeout()) throw new Error(timeoutMessage);
    throw error;
  } finally {
    abortScope.cleanup();
  }
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
    assertStudioSourceFile(photo.file);
    const image = await withPromiseTimeout(
      loadImage(photo.url),
      30_000,
      `${photo.name} 이미지를 30초 안에 해석하지 못했습니다. 지원되는 사진 형식인지 확인해 주세요.`,
    );
    try {
      assertStudioSourceDimensions(image.naturalWidth, image.naturalHeight);
      if (image.naturalWidth !== photo.originalWidth || image.naturalHeight !== photo.originalHeight) {
        throw new Error(`${photo.name} 원본 크기가 선택 당시 정보와 달라 사진을 다시 선택해 주세요.`);
      }
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
          originalName: photo.name,
          originalBytes: photo.file.size,
          originalMediaType: photo.file.type as StudioSourceImageMediaType,
          originalWidth: photo.originalWidth,
          originalHeight: photo.originalHeight,
          width: 1200,
          height: 1200,
          bytes: blob.size,
          mediaType: "image/jpeg",
          fit: "contain",
        },
      };
    } finally {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    }
  } catch (error) {
    throw normalizeStudioPhotoReadError(photo.name, error);
  }
}

export async function optimizeAndUploadStudioPhotos(
  photos: StudioPhoto[],
  userId: string,
  jobId: string,
  accessToken: string,
  signal: AbortSignal,
) {
  assertStudioPhotoBatch(photos.map((photo) => photo.file));
  const supabase = createClient();
  const uploadedStoragePaths = new Set<string>();
  const uploadedPaths: string[] = [];
  const imageSpecs: SourcePreservingProductImageSpec[] = [];
  const removeUploaded = async (paths: string[]) => {
    if (!paths.length) return;
    const { error } = await withPromiseTimeout(
      supabase.storage.from("sellerpilot-ai").remove(paths),
      15_000,
      "업로드 임시파일 정리 제한시간을 초과했습니다.",
    );
    if (error) throw new Error("업로드 임시파일을 정리하지 못했습니다.");
  };
  try {
    let preoptimizedPhotos: OptimizedPhoto[] | null = null;
    if (photos.length <= studioPreUploadOptimizationLimit) {
      preoptimizedPhotos = [];
      for (let start = 0; start < photos.length; start += studioPhotoPreparationConcurrency) {
        throwIfStudioJobAborted(signal);
        preoptimizedPhotos.push(...await Promise.all(photos
          .slice(start, start + studioPhotoPreparationConcurrency)
          .map((photo) => optimizePhoto(photo))));
        throwIfStudioJobAborted(signal);
      }
    }
    for (let start = 0; start < photos.length; start += studioPhotoPreparationConcurrency) {
      throwIfStudioJobAborted(signal);
      const sourceBatch = photos.slice(start, start + studioPhotoPreparationConcurrency);
      const batch = preoptimizedPhotos?.slice(start, start + studioPhotoPreparationConcurrency)
        ?? await Promise.all(sourceBatch.map((photo) => optimizePhoto(photo)));
      throwIfStudioJobAborted(signal);
      const uploaded = await uploadStudioPhotoPairs({
        userId,
        jobId,
        units: batch.map((photo, offset) => ({
          index: start + offset,
          original: sourceBatch[offset].file,
          originalMediaType: sourceBatch[offset].file.type,
          normalized: photo.blob,
          spec: photo.spec,
        })),
        concurrency: studioPhotoUploadConcurrency,
        signal,
        upload: async (path, body, contentType) => {
          await uploadStudioStorageObject({
            accessToken,
            path,
            body,
            contentType,
            cacheControl: path.includes("/original/") ? "31536000" : "3600",
            parentSignal: signal,
            timeoutMs: studioUploadTimeoutMs,
          });
        },
        cleanup: removeUploaded,
        onUploaded: (path) => uploadedStoragePaths.add(path),
        onCleanupCandidate: (path) => uploadedStoragePaths.add(path),
      });
      uploadedPaths.push(...uploaded.uploadedPaths);
      imageSpecs.push(...uploaded.imageSpecs);
      throwIfStudioJobAborted(signal);
    }
    return { uploadedPaths, imageSpecs, allUploadedPaths: [...uploadedStoragePaths] };
  } catch (error) {
    if (uploadedStoragePaths.size) await removeUploaded([...uploadedStoragePaths]).catch(() => undefined);
    throw error;
  }
}

export async function cleanupUnenqueuedStudioPhotos(paths: readonly string[]) {
  if (!paths.length) return;
  const { error } = await withPromiseTimeout(
    createClient().storage.from("sellerpilot-ai").remove([...new Set(paths)]),
    15_000,
    "업로드 임시파일 정리 제한시간을 초과했습니다.",
  );
  if (error) throw new Error("업로드 임시파일을 정리하지 못했습니다.");
}

const generatedAssetLabels: Record<string, string> = {
  square: "마켓 대표",
  portrait: "모바일 피드 설정샷",
  wide: "프로모션 배너 설정샷",
  "detail-overview": "상세 전체·준비컷",
  "detail-feature": "상세 특징 근접컷",
  "detail-use": "상세 사용 설정샷",
  "detail-package": "상세 포장 근거컷",
  "detail-routine": "상세 루틴 설정샷",
  "detail-scale": "상세 크기 설정샷",
  "detail-storage": "상세 보관 설정샷",
  "detail-context": "상세 생활 맥락컷",
  "detail-material": "상세 재질 근접컷",
  "detail-dimensions": "상세 형태·규격컷",
  "detail-contents": "상세 구성품컷",
  "detail-care": "상세 관리 근거컷",
};

function studioPreset(asset: (typeof aiGeneratedAssetSpecs)[number]) {
  return {
    id: asset.id,
    label: generatedAssetLabels[asset.id] ?? asset.label,
    ratio: `${asset.ratio} · ${asset.width}×${asset.height}`,
    width: asset.width,
    height: asset.height,
  };
}

function thumbnailPreviewStyle(thumbnail: Pick<AutoThumbnail, "width" | "height">) {
  return { "--thumbnail-ratio": `${thumbnail.width} / ${thumbnail.height}` } as CSSProperties;
}

const thumbnailPresets = aiGeneratedAssetSpecs
  .filter((asset) => asset.role !== "detail" && asset.id !== "hero")
  .map(studioPreset);

const detailPresets = aiGeneratedAssetSpecs
  .filter((asset) => asset.role === "detail")
  .map(studioPreset);

const generatedPreviewPresets = [...thumbnailPresets, ...detailPresets];

export function AiProductStudio({ mainPhoto, photos, manualFields, competitorContext, requestId, sourceResearchJobId, sourcePhotoFingerprint, sourceResearchLineageReceipt, firstDraftReviewed, submissionMode, workerReadiness, onRunningChange, notify, onJobQueued, onResultReady, onManualResultReady }: {
  mainPhoto: StudioPhoto | null;
  photos: StudioPhoto[];
  manualFields: ProductIntakeDraft;
  competitorContext: StudioCompetitorContext;
  requestId: number;
  sourceResearchJobId: string;
  sourcePhotoFingerprint: string;
  sourceResearchLineageReceipt: string;
  firstDraftReviewed: boolean;
  submissionMode: StudioSubmissionMode;
  workerReadiness: StudioWorkerReadiness | null;
  onRunningChange: (running: boolean) => void;
  notify: (message: string) => void;
  onJobQueued?: (jobId: string) => void;
  onResultReady?: (
    result: ProductStudioResult,
    productId: string | null,
    jobId: string,
    submittedIntake: ProductIntakeDraft | null,
  ) => void;
  onManualResultReady?: (
    productId: string,
    jobId: string,
    submittedIntake: ProductIntakeDraft,
  ) => void;
}) {
  const [result, setResult] = useState<ProductStudioResult | null>(null);
  const [thumbnails, setThumbnails] = useState<AutoThumbnail[]>([]);
  const [aiHero, setAiHero] = useState("");
  const [generating, setGenerating] = useState(false);
  const [cliPhase, setCliPhase] = useState<"idle" | "queued" | "running">("idle");
  const [editorOpen, setEditorOpen] = useState(false);
  const [savedDetailData, setSavedDetailData] = useState<ProductDetailData | null>(null);
  const [detailPageVersion, setDetailPageVersion] = useState<number | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [lastError, setLastError] = useState("");
  const [sourceJobId, setSourceJobId] = useState("");
  const [sourceProductId, setSourceProductId] = useState<string | null>(null);
  const [regeneratingAssetId, setRegeneratingAssetId] = useState("");
  const [uncertainRegenerationJobId, setUncertainRegenerationJobId] = useState("");
  const [queuedOwnJobId, setQueuedOwnJobId] = useState("");
  const [submissionPhase, setSubmissionPhase] = useState<StudioSubmissionPhase>("idle");
  const [studioSessionId] = useState(() => crypto.randomUUID());
  const [jobMonitors] = useState(() => createStudioJobMonitorRegistry());
  const handledRequest = useRef(0);
  const recoveryStarted = useRef(false);
  const displayJobId = useRef("");
  const queuedOwnJobIdRef = useRef("");
  const generateInFlightRef = useRef(false);
  const detailSaveInFlightRef = useRef(false);
  const uncertainRegenerationJobIdRef = useRef("");
  const announcedJobIdsRef = useRef(new Set<string>());
  const submittedIntakesByJobIdRef = useRef(new Map<string, ProductIntakeDraft>());
  const pendingManualRequestRef = useRef<PendingManualProductRequest | null>(null);
  const studioMountedRef = useRef(true);
  const lifecycleControllerRef = useRef<AbortController | null>(null);
  const currentImageUrl = aiHero || mainPhoto?.url || "";

  useEffect(() => {
    studioMountedRef.current = true;
    lifecycleControllerRef.current = new AbortController();
    const submittedIntakes = submittedIntakesByJobIdRef.current;
    return () => {
      studioMountedRef.current = false;
      lifecycleControllerRef.current?.abort(studioJobAbortError());
      lifecycleControllerRef.current = null;
      jobMonitors.abortAll();
      submittedIntakes.clear();
    };
  }, [jobMonitors]);

  const waitForCliJob = useCallback(async (
    jobId: string,
    accessToken: string,
    signal: AbortSignal,
    onPhase?: (phase: "queued" | "running") => void,
    options: StudioJobWaitOptions = {},
  ) => {
    const deadline = Date.now() + (options.maximumAgeMs ?? studioJobMaximumAgeMs);
    const notFoundDeadline = Date.now() + (options.notFoundGraceMs ?? 0);
    let consecutiveRequestFailures = 0;
    let accepted = false;
    while (Date.now() < deadline) {
      throwIfStudioJobAborted(signal);
      let response: Response;
      let payload: CliJobPayload & { message?: string };
      try {
        ({ response, payload } = await fetchJsonWithStudioJobTimeout(`/api/ai/jobs/${jobId}`, {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }, signal, 15_000, { message: "서버 AI 작업 상태 응답을 읽지 못했습니다." } as CliJobPayload & { message?: string }));
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
        if (response.status === 404 && Date.now() < notFoundDeadline) {
          await delay(2_000, signal);
          continue;
        }
        if (response.status === 404) {
          if (options.preserveMissingAdmission) {
            throw new Error(payload.message ?? "Supabase AI 작업 큐 접수 여부를 아직 확정하지 못했습니다.");
          }
          throw new StudioJobTerminalError(payload.message ?? "서버 AI 작업을 찾지 못했습니다.");
        }
        throw new Error(payload.message ?? "서버 AI 작업 상태를 확인하지 못했습니다.");
      }
      if (!accepted) {
        accepted = true;
        options.onAccepted?.();
      }
      if (payload.status === "succeeded" && payload.result) return payload.result;
      if (payload.status === "failed" || payload.status === "cancelled") {
        throw new StudioJobTerminalError(payload.error || "Vercel OIDC 서버 AI 작업이 완료되지 못했습니다.");
      }
      onPhase?.(payload.status === "running" ? "running" : "queued");
      await delay(3_000, signal);
    }
    throw new Error(`서버 AI 작업 자동 확인 상한 ${Math.round((options.maximumAgeMs ?? studioJobMaximumAgeMs) / 60_000)}분을 초과했습니다. 등록 이력과 서버 AI 연결 상태를 확인해 주세요.`);
  }, []);

  const finishStudioJob = useCallback(async (
    job: ActiveStudioJob,
    accessToken: string,
    recovered: boolean,
    waitOptions: StudioJobWaitOptions = {},
  ) => {
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
        }, waitOptions);
      } catch (error) {
        if (error instanceof StudioJobTerminalError) {
          clearActiveStudioJob(job.jobId);
          submittedIntakesByJobIdRef.current.delete(job.jobId);
        }
        throw error;
      }
      if (cliResult.mode !== "cli") {
        clearActiveStudioJob(job.jobId);
        submittedIntakesByJobIdRef.current.delete(job.jobId);
        throw new StudioJobTerminalError("상품 분석 결과 형식이 올바르지 않습니다.");
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
        setDetailPageVersion(null);
      }
      const { response: productResponse, payload: productPayload } = await fetchJsonWithStudioJobTimeout("/api/operations/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "product_create", jobId: job.jobId }),
      }, monitor.signal, 30_000, {} as { id?: string | null; code?: string; message?: string });
      throwIfStudioJobAborted(monitor.signal);
      const productId = productResponse.ok && typeof productPayload.id === "string" ? productPayload.id : null;
      if (!productId) {
        if (productResponse.status === 409 && productPayload.code === "DUPLICATE_SELLER_SKU") {
          clearActiveStudioJob(job.jobId);
          submittedIntakesByJobIdRef.current.delete(job.jobId);
          throw new StudioJobTerminalError(productPayload.message || "이미 등록된 판매자 SKU라서 상품 원장을 새로 만들지 않았습니다.");
        }
        throw new Error(productPayload.message || "AI 초안 자산 제작은 끝났지만 내부 draft 상품 저장을 확인하지 못했습니다. 새로고침하면 완료 작업부터 다시 연결합니다.");
      }
      if (canDisplay()) setSourceProductId(productId);
      const submittedIntake = submittedIntakesByJobIdRef.current.get(job.jobId) ?? null;
      clearActiveStudioJob(job.jobId);
      submittedIntakesByJobIdRef.current.delete(job.jobId);
      if (canDisplay()) onResultReady?.(nextResult, productId, job.jobId, submittedIntake);
      if (studioMountedRef.current) notify(recovered
        ? "이전 서버 AI 작업을 복구해 핵심 생활 설정샷 6개와 대표·근거 보조 자산, 상세페이지 AI 초안/내부 draft를 준비했습니다. 외부 채널에는 게시하지 않았습니다."
        : "핵심 생활 설정샷 6개와 대표·근거 보조 자산, 상세페이지 AI 초안/내부 draft를 준비했습니다. 외부 채널에는 게시하지 않았습니다.");
    } finally {
      jobMonitors.end(job.jobId, monitor);
    }
  }, [jobMonitors, notify, onResultReady, studioSessionId, waitForCliJob]);

  const releaseOwnJob = useCallback((jobId: string) => {
    if (queuedOwnJobIdRef.current !== jobId) return;
    queuedOwnJobIdRef.current = "";
    setQueuedOwnJobId((current) => current === jobId ? "" : current);
    setSubmissionPhase("idle");
  }, []);

  const announceOwnJob = useCallback((jobId: string, reconciled: boolean) => {
    if (announcedJobIdsRef.current.has(jobId)) return;
    announcedJobIdsRef.current.add(jobId);
    onJobQueued?.(jobId);
    notify(reconciled
      ? "상품 분석 접수 응답은 끊겼지만 기존 작업 ID가 운영 큐에 접수된 것을 확인했습니다. 새 작업을 중복 등록하지 않았습니다."
      : "상품 분석 작업을 운영 큐에 등록했습니다. 처리되는 동안 다른 상품 등록을 바로 시작할 수 있습니다.");
  }, [notify, onJobQueued]);

  const monitorOwnStudioJob = useCallback((
    job: ActiveStudioJob,
    accessToken: string,
    reconcileAdmission: boolean,
  ) => {
    if (!studioMountedRef.current) return;
    queuedOwnJobIdRef.current = job.jobId;
    setQueuedOwnJobId(job.jobId);
    setSubmissionPhase(reconcileAdmission ? "reconciling" : "monitoring");
    void finishStudioJob(job, accessToken, false, {
      notFoundGraceMs: reconcileAdmission ? studioJobAdmissionGraceMs : 0,
      preserveMissingAdmission: reconcileAdmission,
      onAccepted: () => {
        if (!studioMountedRef.current || queuedOwnJobIdRef.current !== job.jobId) return;
        setSubmissionPhase("monitoring");
        setLastError("");
        announceOwnJob(job.jobId, reconcileAdmission);
      },
    }).then(() => {
      if (!studioMountedRef.current) return;
      setLastError("");
      releaseOwnJob(job.jobId);
    }).catch((error) => {
      if (isStudioJobAbort(error) || !studioMountedRef.current) return;
      const message = error instanceof Error ? error.message : "AI 스튜디오 처리 상태를 확인하지 못했습니다.";
      setLastError(message);
      if (error instanceof StudioJobTerminalError) {
        clearActiveStudioJob(job.jobId);
        submittedIntakesByJobIdRef.current.delete(job.jobId);
        releaseOwnJob(job.jobId);
        notify(`${message} 기존 작업이 종료된 것이 확인되어 새로 시도할 수 있습니다.`);
        return;
      }
      if (queuedOwnJobIdRef.current === job.jobId) setSubmissionPhase("uncertain");
      notify(`${message} 새 작업을 만들지 않고 기존 작업 ID의 접수 상태를 유지합니다. 상태를 다시 확인해 주세요.`);
    });
  }, [announceOwnJob, finishStudioJob, notify, releaseOwnJob]);

  const generate = useCallback(async () => {
    if (!mainPhoto) {
      onRunningChange(false);
      return;
    }
    const manualMvp = submissionMode === "manual_mvp";
    const normalizedSourceResearchJobId = sourceResearchJobId?.trim() ?? "";
    const normalizedSourcePhotoFingerprint = sourcePhotoFingerprint?.trim() ?? "";
    const normalizedSourceResearchLineageReceipt = sourceResearchLineageReceipt?.trim() ?? "";
    if (!manualMvp && (!normalizedSourceResearchJobId
        || !/^[a-f0-9]{64}$/.test(normalizedSourcePhotoFingerprint)
        || !normalizedSourceResearchLineageReceipt
        || !firstDraftReviewed)) {
      const message = "먼저 1차 상품정보와 이미지 6개를 생성하고 사람이 확인한 뒤 상세페이지 제작을 시작해 주세요.";
      setLastError(message);
      notify(message);
      onRunningChange(false);
      return;
    }
    if (!manualMvp && !isStudioExecutionReady(workerReadiness)) {
      const message = workerReadiness?.message
        ?? "AI 제작 작업자 연결 상태를 확인하고 있습니다. 확인이 끝난 뒤 다시 시도해 주세요.";
      setLastError(message);
      notify(message);
      onRunningChange(false);
      return;
    }
    // A rapid duplicate event during the first upload still belongs to the
    // active operation, so its parent busy state must remain true.
    if (generating || generateInFlightRef.current) return;
    if (queuedOwnJobId || queuedOwnJobIdRef.current) {
      // PublishingPage sets its own busy flag before incrementing requestId.
      // Release only a stale outer flag when this child already owns an exact
      // server job and no local submission is still running.
      onRunningChange(false);
      return;
    }
    const lifecycleController = lifecycleControllerRef.current;
    if (!lifecycleController || lifecycleController.signal.aborted || !studioMountedRef.current) return;
    generateInFlightRef.current = true;
    displayJobId.current = "";
    setGenerating(true);
    onRunningChange(true);
    setAiHero("");
    setThumbnails([]);
    setResult(null);
    setSavedDetailData(null);
    setDetailPageVersion(null);
    setSourceJobId("");
    setSourceProductId(null);
    setEditorOpen(false);
    setLastError("");
    setCliPhase("queued");
    let uploadedCleanupPaths: string[] = [];
    let enqueueStarted = false;
    let terminallyRejected = false;
    let preparedJobId = "";
    try {
      const validatedIntake = productIntakeSchema.safeParse(manualFields);
      if (!validatedIntake.success) {
        throw new Error(validatedIntake.error.issues[0]?.message ?? "상품 필수정보와 자료 사용 권한을 확인해 주세요.");
      }
      const { data: sessionData } = await getStudioSessionWithDeadline(
        lifecycleController.signal,
        "상품 분석을 시작하기 위한 로그인 확인이 15초를 초과했습니다. 네트워크 상태를 확인해 주세요.",
      );
      const accessToken = sessionData.session?.access_token;
      const userId = sessionData.session?.user.id;
      if (!accessToken || !userId) throw new Error("AI 제작을 실행하려면 관리자 로그인이 필요합니다.");
      if (photos.length > 100) throw new Error("한 작업에는 대표사진을 포함해 최대 100장까지 분석할 수 있습니다.");
      if (manualMvp) {
        const requestFingerprint = await manualProductRequestFingerprint(validatedIntake.data.sellerSku);
        let pending = pendingManualRequestRef.current;
        if (pending?.ownerId !== userId || pending.requestFingerprint !== requestFingerprint) {
          pending = readPendingManualProductRequest(userId, requestFingerprint);
        }
        let preservedRequest = pending ? parseManualProductRequestBody(pending.requestBody) : null;
        if (pending && !preservedRequest) {
          pendingManualRequestRef.current = null;
          pending = null;
        }
        if (!pending || !preservedRequest) {
          const jobId = crypto.randomUUID();
          preparedJobId = jobId;
          const uploaded = await optimizeAndUploadStudioPhotos(
            photos,
            userId,
            jobId,
            accessToken,
            lifecycleController.signal,
          );
          uploadedCleanupPaths = uploaded.allUploadedPaths;
          throwIfStudioJobAborted(lifecycleController.signal);
          const requestBody = JSON.stringify({
            jobId,
            manualFields: validatedIntake.data,
            competitorContext,
            imagePaths: uploaded.uploadedPaths,
            imageSpecs: uploaded.imageSpecs,
          });
          pending = {
            version: 1,
            ownerId: userId,
            jobId,
            requestFingerprint,
            requestBody,
            createdAt: Date.now(),
          };
          persistPendingManualProductRequest(pending);
          pendingManualRequestRef.current = pending;
          preservedRequest = {
            jobId,
            manualFields: validatedIntake.data,
            imagePaths: uploaded.uploadedPaths,
            imageSpecs: uploaded.imageSpecs,
          };
        } else {
          preparedJobId = pending.jobId;
          pendingManualRequestRef.current = pending;
          notify("응답이 불명확했던 원본 상품을 새로 만들지 않고 기존 요청 ID와 동일한 내용으로 다시 확인합니다.");
        }

        const { jobId, manualFields: submittedManualFields, imagePaths } = preservedRequest;
        const requestBody = pending.requestBody;
        let response: Response | null = null;
        let payload: { productId?: string; jobId?: string; code?: string; message?: string } = {};
        enqueueStarted = true;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            ({ response, payload } = await fetchJsonWithStudioJobTimeout(
              "/api/admin/products/manual-intake",
              {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
                body: requestBody,
              },
              lifecycleController.signal,
              90_000,
              { message: "원본 사진 상품 저장 응답을 읽지 못했습니다." },
            ));
          } catch (error) {
            if (isStudioJobAbort(error) || !studioMountedRef.current) throw error;
            if (attempt === 0) continue;
            throw new Error("원본 사진 상품 저장 응답을 두 번 확인하지 못했습니다. 같은 요청 ID의 파일은 보존했으며 다시 시도하면 중복 없이 확인합니다.");
          }
          const ambiguous = response.status === 408
            || response.status === 425
            || response.status === 429
            || response.status >= 500;
          if (ambiguous && attempt === 0) continue;
          break;
        }
        throwIfStudioJobAborted(lifecycleController.signal);
        if (!response?.ok || typeof payload.productId !== "string" || payload.jobId !== jobId) {
          const ambiguous = !response
            || response.status === 408
            || response.status === 425
            || response.status === 429
            || response.status >= 500
            || (response.ok && (typeof payload.productId !== "string" || payload.jobId !== jobId));
          terminallyRejected = !ambiguous;
          if (terminallyRejected) {
            clearPendingManualProductRequest(pending);
            if (pendingManualRequestRef.current?.jobId === pending.jobId) pendingManualRequestRef.current = null;
          }
          throw new StudioJobTerminalError(payload.message ?? (ambiguous
            ? "원본 사진 상품 저장 상태를 확정하지 못했습니다. 업로드 파일은 보존했습니다."
            : "원본 사진 상품 원장을 저장하지 못했습니다."));
        }
        clearPendingManualProductRequest(pending);
        if (pendingManualRequestRef.current?.jobId === pending.jobId) pendingManualRequestRef.current = null;
        uploadedCleanupPaths = [];
        setSourceJobId(jobId);
        setSourceProductId(payload.productId);
        onManualResultReady?.(payload.productId, jobId, submittedManualFields);
        notify(`원본 사진 ${imagePaths.length}장과 판매자 확인 정보를 상품 원장에 저장했습니다. 이는 AI 초안 완료가 아니며, AI 생성 없이 공식 카테고리 확인과 채널 등록을 계속할 수 있습니다.`);
        return;
      }
      const jobId = crypto.randomUUID();
      preparedJobId = jobId;
      const { uploadedPaths: imagePaths, imageSpecs, allUploadedPaths } = await optimizeAndUploadStudioPhotos(
        photos,
        userId,
        jobId,
        accessToken,
        lifecycleController.signal,
      );
      uploadedCleanupPaths = allUploadedPaths;
      throwIfStudioJobAborted(lifecycleController.signal);
      const submittedIntakes = submittedIntakesByJobIdRef.current;
      while (submittedIntakes.size >= maximumSubmittedIntakeSnapshots) {
        const oldestJobId = submittedIntakes.keys().next().value;
        if (typeof oldestJobId !== "string") break;
        submittedIntakes.delete(oldestJobId);
      }
      submittedIntakes.set(jobId, { ...validatedIntake.data });
      const queuedJob = persistActiveStudioJob(jobId, studioSessionId);
      displayJobId.current = jobId;
      queuedOwnJobIdRef.current = jobId;
      setQueuedOwnJobId(jobId);
      setSubmissionPhase("submitting");
      let response: Response;
      let queued: { jobId?: string; code?: string; message?: string };
      try {
        enqueueStarted = true;
        ({ response, payload: queued } = await fetchJsonWithStudioJobTimeout("/api/ai/product-studio", {
          method: "POST",
          headers: { "Content-Type": "application/json", authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            jobId,
            sourceResearchJobId: normalizedSourceResearchJobId,
            sourcePhotoFingerprint: normalizedSourcePhotoFingerprint,
            sourceResearchLineageReceipt: normalizedSourceResearchLineageReceipt,
            humanReviewConfirmed: true,
            manualFields: validatedIntake.data,
            competitorContext,
            imagePaths,
            imageSpecs,
          }),
        }, lifecycleController.signal, 90_000, { message: "Supabase AI 작업 큐 접수 응답을 읽지 못했습니다." } as { jobId?: string; message?: string }));
      } catch (error) {
        if (isStudioJobAbort(error) || !studioMountedRef.current) throw error;
        setSubmissionPhase("reconciling");
        setLastError("상품 분석 접수 응답이 끊겨 기존 작업 ID의 서버 상태를 확인하고 있습니다.");
        notify("상품 분석 접수 응답이 유실되었을 수 있어 새 작업을 만들지 않고 기존 작업 ID부터 확인합니다.");
        monitorOwnStudioJob(queuedJob, accessToken, true);
        return;
      }
      throwIfStudioJobAborted(lifecycleController.signal);
      const deterministicPreEnqueueRejection = !response.ok && (
        queued.code === "AI_WORKER_UNAVAILABLE"
        || (response.status === 503 && queued.code === "SOURCE_RESEARCH_UNAVAILABLE")
        || (response.status === 409 && queued.code === "SOURCE_RESEARCH_REQUIRED")
        || (response.status === 503 && queued.code === "SOURCE_RESEARCH_REQUIRED")
        || (response.status === 409 && queued.code === "SOURCE_PHOTO_MISMATCH")
      );
      if (deterministicPreEnqueueRejection) {
        terminallyRejected = true;
        clearActiveStudioJob(jobId);
        submittedIntakesByJobIdRef.current.delete(jobId);
        releaseOwnJob(jobId);
        throw new StudioJobTerminalError(queued.message ?? "최종 제작 작업을 시작하지 않았습니다. 안내 내용을 확인한 뒤 바로 다시 시도해 주세요.");
      }
      const ambiguousResponse = response.status === 408
        || response.status === 425
        || response.status === 429
        || response.status >= 500
        || (response.ok && !queued.jobId)
        || (response.ok && queued.jobId !== jobId);
      if (ambiguousResponse) {
        setSubmissionPhase("reconciling");
        setLastError(queued.message ?? "상품 분석 접수 결과가 불명확해 기존 작업 ID의 서버 상태를 확인하고 있습니다.");
        notify("상품 분석 접수 결과가 불명확해 새 작업을 만들지 않고 기존 작업 ID부터 확인합니다.");
        monitorOwnStudioJob(queuedJob, accessToken, true);
        return;
      }
      if (!response.ok || !queued.jobId) {
        terminallyRejected = true;
        clearActiveStudioJob(jobId);
        submittedIntakesByJobIdRef.current.delete(jobId);
        releaseOwnJob(jobId);
        throw new StudioJobTerminalError(queued.message ?? "상품 분석 요청을 처리하지 못했습니다.");
      }
      displayJobId.current = queued.jobId;
      queuedOwnJobIdRef.current = queued.jobId;
      setQueuedOwnJobId(queued.jobId);
      setSubmissionPhase("monitoring");
      announceOwnJob(queued.jobId, false);
      monitorOwnStudioJob(queuedJob, accessToken, false);
    } catch (error) {
      if ((!enqueueStarted || terminallyRejected) && uploadedCleanupPaths.length) {
        await cleanupUnenqueuedStudioPhotos(uploadedCleanupPaths).catch(() => undefined);
      }
      if ((!enqueueStarted || terminallyRejected) && preparedJobId) {
        submittedIntakesByJobIdRef.current.delete(preparedJobId);
      }
      if (isStudioJobAbort(error) || !studioMountedRef.current) return;
      const message = error instanceof Error ? error.message : "AI 스튜디오 처리 중 오류가 발생했습니다.";
      setLastError(message);
      notify(message);
    } finally {
      generateInFlightRef.current = false;
      if (studioMountedRef.current) {
        setGenerating(false);
        setCliPhase("idle");
        onRunningChange(false);
      }
    }
  }, [announceOwnJob, competitorContext, firstDraftReviewed, generating, mainPhoto, manualFields, monitorOwnStudioJob, notify, onManualResultReady, onRunningChange, photos, queuedOwnJobId, releaseOwnJob, sourcePhotoFingerprint, sourceResearchJobId, sourceResearchLineageReceipt, studioSessionId, submissionMode, workerReadiness]);

  const retryOwnJobStatus = useCallback(async () => {
    const jobId = queuedOwnJobIdRef.current;
    if (!jobId || submissionPhase !== "uncertain" || generating || generateInFlightRef.current) return;
    const lifecycleController = lifecycleControllerRef.current;
    if (!lifecycleController || lifecycleController.signal.aborted || !studioMountedRef.current) return;
    generateInFlightRef.current = true;
    setGenerating(true);
    onRunningChange(true);
    try {
      const { data: sessionData } = await getStudioSessionWithDeadline(
        lifecycleController.signal,
        "기존 상품 분석 상태를 확인하려면 로그인 상태를 다시 확인해 주세요.",
      );
      throwIfStudioJobAborted(lifecycleController.signal);
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("기존 상품 분석 상태를 확인하려면 다시 로그인해 주세요.");
      const job = readActiveStudioJobs().find((candidate) => candidate.jobId === jobId)
        ?? persistActiveStudioJob(jobId, studioSessionId);
      displayJobId.current = jobId;
      setSubmissionPhase("reconciling");
      setLastError("");
      notify("새 상품 분석을 만들지 않고 기존 작업 ID의 접수·처리 상태를 다시 확인합니다.");
      monitorOwnStudioJob(job, accessToken, true);
    } catch (error) {
      if (isStudioJobAbort(error) || !studioMountedRef.current) return;
      const message = error instanceof Error ? error.message : "기존 상품 분석 상태를 확인하지 못했습니다.";
      setSubmissionPhase("uncertain");
      setLastError(message);
      notify(`${message} 기존 작업 ID는 유지합니다.`);
    } finally {
      generateInFlightRef.current = false;
      if (studioMountedRef.current) {
        setGenerating(false);
        onRunningChange(false);
      }
    }
  }, [generating, monitorOwnStudioJob, notify, onRunningChange, studioSessionId, submissionPhase]);

  const regenerateAsset = useCallback(async (assetId: string) => {
    if (!sourceJobId || generating || regeneratingAssetId || uncertainRegenerationJobIdRef.current) return;
    const lifecycleController = lifecycleControllerRef.current;
    if (!lifecycleController || lifecycleController.signal.aborted || !studioMountedRef.current) return;
    setRegeneratingAssetId(assetId);
    setLastError("");
    onRunningChange(true);
    let monitor: AbortController | null = null;
    let monitoredJobId = "";
    let regenerationMayExist = false;
    const lockUncertainJob = (jobId: string) => {
      uncertainRegenerationJobIdRef.current = jobId;
      setUncertainRegenerationJobId(jobId);
    };
    const releaseUncertainJob = (jobId: string) => {
      if (uncertainRegenerationJobIdRef.current !== jobId) return;
      uncertainRegenerationJobIdRef.current = "";
      setUncertainRegenerationJobId("");
    };
    try {
      const { data: sessionData } = await getStudioSessionWithDeadline(
        lifecycleController.signal,
        "이미지 재제작을 위한 로그인 확인이 15초를 초과했습니다. 네트워크 상태를 확인해 주세요.",
      );
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("이미지를 재제작하려면 관리자 로그인이 필요합니다.");
      const jobId = crypto.randomUUID();
      monitoredJobId = jobId;
      regenerationMayExist = true;
      const { response, payload: queued } = await fetchJsonWithStudioJobTimeout("/api/ai/product-studio/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jobId, sourceJobId, sourceProductId, assetId }),
      }, lifecycleController.signal, 30_000, { message: "재제작 작업 응답을 읽지 못했습니다." } as { jobId?: string; deduplicated?: boolean; message?: string });
      throwIfStudioJobAborted(lifecycleController.signal);
      const deduplicatedExistingJob = response.status === 202
        && response.ok
        && queued.deduplicated === true
        && typeof queued.jobId === "string";
      const admission = deduplicatedExistingJob ? "accepted" : classifyExactJobAdmission({
        status: response.status,
        ok: response.ok,
        requestedJobId: jobId,
        returnedJobId: queued.jobId,
      });
      if (admission === "rejected") {
        regenerationMayExist = false;
        throw new StudioJobTerminalError(queued.message ?? "이미지 재제작 작업을 등록하지 못했습니다.");
      }
      if (deduplicatedExistingJob) monitoredJobId = queued.jobId!;
      if (admission === "ambiguous") {
        lockUncertainJob(monitoredJobId);
        setLastError(`이미지 재제작 작업 ${monitoredJobId.slice(0, 8)}의 접수 응답이 불명확합니다. 새 작업을 만들지 않고 같은 작업 ID를 확인합니다.`);
        notify(`이미지 재제작 작업 ${monitoredJobId.slice(0, 8)}의 접수 결과가 불명확해 새 작업을 만들지 않고 기존 ID를 확인합니다.`);
      }
      monitor = jobMonitors.begin(monitoredJobId);
      if (!monitor) throw new Error("같은 이미지 작업 상태를 이미 확인하고 있습니다.");
      const regenerated = await waitForCliJob(monitoredJobId, accessToken, monitor.signal, undefined, {
        maximumAgeMs: 30 * 60_000,
        notFoundGraceMs: admission === "ambiguous" ? studioJobAdmissionGraceMs : 0,
        onAccepted: () => releaseUncertainJob(monitoredJobId),
      });
      regenerationMayExist = false;
      releaseUncertainJob(monitoredJobId);
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
      if (error instanceof StudioJobTerminalError) regenerationMayExist = false;
      if (regenerationMayExist && monitoredJobId) lockUncertainJob(monitoredJobId);
      else if (monitoredJobId) releaseUncertainJob(monitoredJobId);
      const message = regenerationMayExist && monitoredJobId
        ? `이미지 재제작 작업 ${monitoredJobId.slice(0, 8)}의 상태를 확정하지 못했습니다. 새 작업을 만들지 말고 등록 진행 중·히스토리에서 같은 작업 ID를 확인해 주세요.`
        : error instanceof Error ? error.message : "이미지 재제작 중 오류가 발생했습니다.";
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
    if (workerReadiness?.available !== false
        || !queuedOwnJobId
        || submissionPhase !== "monitoring") return;
    const stopMonitoring = window.setTimeout(() => {
      jobMonitors.abortAll(new DOMException(workerReadiness.message, "AbortError"));
      setSubmissionPhase("uncertain");
      setLastError(workerReadiness.message);
      notify(`${workerReadiness.message} 기존 작업 ID는 유지하며 자동 상태 확인을 중단했습니다.`);
    }, 0);
    return () => window.clearTimeout(stopMonitoring);
  }, [jobMonitors, notify, queuedOwnJobId, submissionPhase, workerReadiness]);

  useEffect(() => {
    if (recoveryStarted.current || requestId) return;
    const activeJobs = readActiveStudioJobs();
    if (!activeJobs.length) return;
    const recoveryTimer = window.setTimeout(() => {
      if (recoveryStarted.current) return;
      recoveryStarted.current = true;
      void (async () => {
        try {
          const lifecycleController = lifecycleControllerRef.current;
          if (!lifecycleController) return;
          const { data: sessionData } = await getStudioSessionWithDeadline(
            lifecycleController.signal,
            "진행 중인 상품 분석 복구를 위한 로그인 확인이 15초를 초과했습니다.",
          );
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
  const studioExecutionReady = isStudioExecutionReady(workerReadiness);
  const hasResearchDraft = Boolean(sourceResearchJobId?.trim())
    && /^[a-f0-9]{64}$/.test(sourcePhotoFingerprint?.trim() ?? "")
    && Boolean(sourceResearchLineageReceipt?.trim())
    && firstDraftReviewed;
  const submissionAvailable = submissionMode === "manual_mvp" || (studioExecutionReady && hasResearchDraft);
  const submissionUnavailableMessage = submissionMode !== "manual_mvp" && !hasResearchDraft
    ? "먼저 1차 상품정보와 이미지 6개를 생성하고 사람이 확인해 주세요."
    : workerReadiness?.message;
  const studioAssetUrls = useMemo(() => ({
    ...(currentImageUrl ? { hero: currentImageUrl } : {}),
    ...Object.fromEntries(thumbnails.map((thumbnail) => [thumbnail.id, thumbnail.dataUrl])),
  }), [currentImageUrl, thumbnails]);

  useEffect(() => {
    if (!sourceProductId) return;
    const controller = new AbortController();
    const lifecycleSignal = lifecycleControllerRef.current?.signal;
    const abortScope = lifecycleSignal
      ? createStudioAbortScope([controller.signal, lifecycleSignal])
      : null;
    const signal = abortScope?.signal ?? controller.signal;
    void (async () => {
      try {
        const { data: sessionData } = await getStudioSessionWithDeadline(
          signal,
          "저장된 상세페이지의 로그인 확인이 15초를 초과했습니다.",
        );
        const accessToken = sessionData.session?.access_token;
        if (!accessToken || signal.aborted) return;
        const { response, payload } = await fetchJsonWithStudioJobTimeout(
          `/api/admin/products/${sourceProductId}/publish-context`,
          { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
          signal,
          30_000,
          {} as { detailPage?: unknown },
        );
        if (!response.ok || signal.aborted) return;
        const detailPage = parsePersistedProductDetailPage<ProductDetailData>(payload.detailPage);
        if (!detailPage || signal.aborted) return;
        setSavedDetailData(detailPage.data);
        setDetailPageVersion(detailPage.version);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          notify("저장된 상세페이지 편집본은 불러오지 못했지만 AI 생성 결과는 유지했습니다.");
        }
      }
    })();
    return () => {
      controller.abort();
      abortScope?.cleanup();
    };
  }, [notify, sourceProductId]);

  const saveDetailPage = useCallback(async (next: ProductDetailData) => {
    if (!sourceProductId || detailSaving || detailSaveInFlightRef.current) return;
    const lifecycleController = lifecycleControllerRef.current;
    if (!lifecycleController || lifecycleController.signal.aborted || !studioMountedRef.current) return;
    detailSaveInFlightRef.current = true;
    setDetailSaving(true);
    try {
      const { data: sessionData } = await getStudioSessionWithDeadline(
        lifecycleController.signal,
        "상세페이지 저장을 위한 로그인 확인이 15초를 초과했습니다. 다시 시도해 주세요.",
      );
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("상세페이지를 저장하려면 관리자 로그인이 필요합니다.");
      const persistable = makeValidatedProductDetailPersistable(next, studioAssetUrls);
      const { response, payload } = await fetchJsonWithStudioJobTimeout(
        `/api/admin/products/${sourceProductId}/publish-context`,
        {
          method: "PUT",
          headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            data: persistable,
            expectedVersion: detailPageVersion,
          }),
        },
        lifecycleController.signal,
        30_000,
        { message: "상세페이지 저장 응답을 읽지 못했습니다." } as { detailPage?: unknown; code?: string; message?: string },
      );
      if (!response.ok) {
        if (response.status === 409 && payload.code === "DETAIL_PAGE_VERSION_CONFLICT") {
          const { response: latestResponse, payload: latestPayload } = await fetchJsonWithStudioJobTimeout(
            `/api/admin/products/${sourceProductId}/publish-context`,
            { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
            lifecycleController.signal,
            30_000,
            {} as { detailPage?: unknown },
          );
          const latest = parsePersistedProductDetailPage<ProductDetailData>(latestPayload?.detailPage);
          if (latestResponse.ok && latest) {
            setSavedDetailData(latest.data);
            setDetailPageVersion(latest.version);
          }
        }
        throw new Error(payload.message ?? "상세페이지 편집 내용을 저장하지 못했습니다.");
      }
      const saved = parsePersistedProductDetailPage<ProductDetailData>(payload.detailPage);
      if (!saved) throw new Error("저장된 상세페이지 버전을 확인하지 못했습니다.");
      const { saveProductDetailData } = await import("./product-detail-puck");
      await saveProductDetailData(sourceProductId, persistable, accessToken);
      setSavedDetailData(saved.data);
      setDetailPageVersion(saved.version);
      setEditorOpen(false);
      notify("상세페이지 편집 내용을 운영 원장에 저장했습니다.");
    } catch (error) {
      if (isStudioJobAbort(error) || !studioMountedRef.current) return;
      notify(error instanceof Error ? error.message : "상세페이지 편집 내용을 저장하지 못했습니다.");
    } finally {
      detailSaveInFlightRef.current = false;
      if (studioMountedRef.current) setDetailSaving(false);
    }
  }, [detailPageVersion, detailSaving, notify, sourceProductId, studioAssetUrls]);

  return (
    <section className="panel ai-product-studio" id="ai-product-studio">
      <div className="studio-heading">
        <div><span className="panel-kicker">AI DETAIL & CREATIVE STUDIO</span><h3>검토 완료 정보로 상세페이지 제작</h3><p>1차에서 만든 핵심 이미지 6장을 그대로 재사용하고, 사람이 확인한 상품정보를 기준으로 후속 자산과 상세페이지 내부 draft를 서버에서 준비합니다.</p></div>
        <div><span className={`studio-mode ${generating ? cliPhase : result?.mode ?? "idle"}`}><i />{generating ? submissionMode === "manual_mvp" ? "원본 사진 저장 중" : cliPhase === "running" ? "상세페이지 제작 중" : "Supabase 큐 대기 중" : result ? "상세페이지 준비됨" : submissionMode === "manual_mvp" ? "AI 없이 원본 등록" : submissionPhase === "reconciling" || submissionPhase === "submitting" ? "접수 확인 중" : submissionPhase === "uncertain" ? "접수 확인 필요" : queuedOwnJobId ? "상세페이지 처리 중" : !hasResearchDraft ? "1차 정보·6장 확인 필요" : !workerReadiness ? "서버 AI 확인 중" : workerReadiness.reason === "gateway_unverified" || workerReadiness.reason === "gateway_verification_failed" ? "AI Gateway 점검 필요" : !studioExecutionReady ? "서버 AI 연결 필요" : "상세페이지 제작 가능"}</span><button type="button" onClick={() => void generate()} disabled={!mainPhoto || !submissionAvailable || generating || Boolean(queuedOwnJobId)} title={!submissionAvailable ? submissionUnavailableMessage : undefined}>{generating || (queuedOwnJobId && submissionPhase !== "uncertain") ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{generating && submissionMode === "manual_mvp" ? "원본 저장 중" : submissionMode === "manual_mvp" ? "원본 사진 직접등록" : submissionPhase === "reconciling" || submissionPhase === "submitting" ? "접수 확인 중" : submissionPhase === "uncertain" ? "접수 확인 필요" : queuedOwnJobId ? "이 상품 처리 중" : !hasResearchDraft ? "1차 정보·6장 확인 필요" : !workerReadiness ? "서버 AI 확인 중" : workerReadiness.reason === "gateway_unverified" || workerReadiness.reason === "gateway_verification_failed" ? "AI Gateway 점검 필요" : !studioExecutionReady ? "서버 AI 연결 필요" : result ? "상세페이지 다시 만들기" : "상세페이지 제작 시작"}</button></div>
      </div>
      <div className="studio-source-row">
        <span><CheckCircle2 size={15} /><b>이미지 분석</b><small>{mainPhoto ? `${photos.length}장 반영` : "대표사진 등록 대기"}</small></span>
        <span><Sparkles size={15} /><b>상세 기획</b><small>8–12개 이미지 중심 섹션</small></span>
        <span><ImageIcon size={15} /><b>자동 이미지</b><small>핵심 생활 설정샷 6개 · 대표/근거 보조 자산 10개</small></span>
        <a href={CODEX_IMAGE_SOURCE} target="_blank" rel="noreferrer"><WandSparkles size={15} /><b>Codex Image 규칙</b><small>gpt-image-2 · MIT</small><ExternalLink size={12} /></a>
      </div>
      <div className="studio-workspace">
        <aside className="creative-rail">
          <div className="creative-rail-head"><span><b>자동 제작 썸네일</b><small>제품이 프레임의 70% 이상 보이는 마켓용 이미지</small></span><em>{creativeThumbnails.length || 3}종</em></div>
          {aiHero && <article className="thumbnail-card ai"><div><img src={aiHero} alt="codex-image가 제작한 상품 연출컷" loading="lazy" decoding="async" /><span>CODEX IMAGE</span></div><b>서버 AI 상품 연출컷</b><small>Vercel OIDC · 원본 충실도 높음</small><button type="button" className="asset-regenerate" onClick={() => void regenerateAsset("hero")} disabled={Boolean(regeneratingAssetId) || generating || Boolean(uncertainRegenerationJobId)}>{regeneratingAssetId === "hero" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}{uncertainRegenerationJobId ? "작업 확인 필요" : "이 이미지만 재제작"}</button></article>}
          <div className="thumbnail-grid">
            {creativeThumbnails.length ? creativeThumbnails.map((thumbnail) => <article className="thumbnail-card" key={thumbnail.id}><button type="button" className="thumbnail-preview" style={thumbnailPreviewStyle(thumbnail)} onClick={() => downloadImage(thumbnail)}><img src={thumbnail.dataUrl} alt={`${thumbnail.label} 자동 썸네일`} loading="lazy" decoding="async" /><span><Download size={13} />다운로드</span></button><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small><button type="button" className="asset-regenerate" onClick={() => void regenerateAsset(thumbnail.id)} disabled={Boolean(regeneratingAssetId) || generating || Boolean(uncertainRegenerationJobId)}>{regeneratingAssetId === thumbnail.id ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}{uncertainRegenerationJobId ? "작업 확인 필요" : "이 이미지만 재제작"}</button></article>) : thumbnailPresets.map((thumbnail) => <article className="thumbnail-card placeholder" key={thumbnail.id}><div style={thumbnailPreviewStyle(thumbnail)}><ImageIcon size={22} /><span>대표사진을 올리면 자동 제작</span></div><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>)}
          </div>
          <details className="studio-detail-assets-disclosure">
            <summary><span><b>상세페이지 이미지 {detailThumbnails.length || detailPresets.length}종</b><small>핵심 생활 설정샷 6개와 대표·근거 보조 자산을 상세 본문에 연결</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="thumbnail-grid detail-assets">
              {detailThumbnails.length ? detailThumbnails.map((thumbnail) => <article className="thumbnail-card" key={thumbnail.id}><button type="button" className="thumbnail-preview" style={thumbnailPreviewStyle(thumbnail)} onClick={() => downloadImage(thumbnail)}><img src={thumbnail.dataUrl} alt={`${thumbnail.label} 자동 상세 이미지`} loading="lazy" decoding="async" /><span><Download size={13} />다운로드</span></button><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small><button type="button" className="asset-regenerate" onClick={() => void regenerateAsset(thumbnail.id)} disabled={Boolean(regeneratingAssetId) || generating || Boolean(uncertainRegenerationJobId)}>{regeneratingAssetId === thumbnail.id ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}{uncertainRegenerationJobId ? "작업 확인 필요" : "이 이미지만 재제작"}</button></article>) : detailPresets.map((thumbnail) => <article className="thumbnail-card placeholder" key={thumbnail.id}><div style={thumbnailPreviewStyle(thumbnail)}><ImageIcon size={22} /><span>상세 전용 이미지 생성 대기</span></div><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>)}
            </div>
          </details>
          {result ? <div className="creative-summary"><span>CREATIVE DIRECTION</span><b>{result.design.themeName}</b><p>{result.product.oneLine}</p><div>{Object.values(result.design.palette).map((color) => <i key={color} style={{ background: color }} title={color} />)}</div></div> : <div className="creative-summary empty"><span>SERVER AI DRAFT</span><b>AI 초안 결과 대기</b><p>1차 상품정보 초안을 사람이 확인하고 최종 작성을 시작하면 내부 draft 결과만 표시합니다.</p></div>}
        </aside>

        <article className="detail-preview-panel">
          <div className="detail-preview-toolbar"><span><MonitorSmartphone size={16} /><b>상세페이지 라이브 미리보기</b><small>모바일 우선 · 블록형 구성</small></span><button type="button" onClick={() => setEditorOpen(true)} disabled={!result || !sourceProductId || detailSaving}><PencilRuler size={15} />{sourceProductId ? "Puck으로 직접 편집" : "상품 원장 연결 중"}</button></div>
          <div className="detail-preview-scroll">{result && currentImageUrl ? <div className="detail-preview-canvas"><ProductDetailRender result={result} imageUrl={currentImageUrl} assetUrls={studioAssetUrls} data={savedDetailData} /></div> : <div className="studio-empty-preview"><ImageIcon size={34} /><b>실제 상세페이지 결과가 아직 없습니다.</b><small>대표사진과 상품 정보를 분석한 뒤 서버 AI 결과를 표시합니다.</small></div>}</div>
        </article>
      </div>
      {lastError && <div className="studio-warning error"><b>{submissionPhase === "uncertain" || uncertainRegenerationJobId ? "접수 상태 확인 필요" : "실제 AI 작업 실패"}</b><p>{lastError}</p><small>{uncertainRegenerationJobId ? `새 재제작을 만들지 않고 기존 이미지 작업 ID ${uncertainRegenerationJobId}를 잠근 상태입니다. 등록 진행 중·히스토리에서 확인해 주세요.` : submissionPhase === "uncertain" ? `새 작업을 만들지 않고 기존 작업 ID ${queuedOwnJobId}를 잠근 상태입니다.` : "예시 결과로 대체하지 않았습니다. 작업 이력에서 재시도하거나 서버 AI 연결 상태를 확인해 주세요."}</small>{submissionPhase === "uncertain" && queuedOwnJobId && <button type="button" className="asset-regenerate" onClick={() => void retryOwnJobStatus()} disabled={generating}><RefreshCw size={13} />기존 작업 상태 다시 확인</button>}</div>}
      {result && result.warnings.length > 0 && <div className="studio-warning"><b>AI 검수 메모</b><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      {editorOpen && result && <ProductDetailEditor result={result} imageUrl={currentImageUrl} assetUrls={studioAssetUrls} data={savedDetailData} saving={detailSaving} onSave={saveDetailPage} onClose={() => { if (!detailSaving) setEditorOpen(false); }} />}
    </section>
  );
}
