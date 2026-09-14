"use client";
/* eslint-disable @next/next/no-img-element -- previews use browser-generated object/data URLs */

import dynamic from "next/dynamic";
import { CheckCircle2, Download, ExternalLink, ImageIcon, LoaderCircle, MonitorSmartphone, PencilRuler, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { createClient } from "../lib/supabase/client";
import { productIntakeSchema, type NormalizedProductImageSpec, type ProductIntakeDraft } from "../lib/product-intake";
import { CODEX_IMAGE_SOURCE } from "./product-studio-prompt";
import type { ProductDetailData } from "./product-detail-puck";
import type { ProductStudioResult } from "./product-studio-types";

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

type ActiveStudioJob = {
  jobId: string;
  startedAt: number;
};

function readActiveStudioJobs(): ActiveStudioJob[] {
  try {
    const raw = window.sessionStorage.getItem(activeStudioJobStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<ActiveStudioJob> | Array<Partial<ActiveStudioJob>>;
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const valid = candidates.filter((job): job is ActiveStudioJob => typeof job.jobId === "string"
      && /^[0-9a-f-]{36}$/i.test(job.jobId)
      && typeof job.startedAt === "number"
      && Date.now() - job.startedAt <= studioJobMaximumAgeMs);
    if (valid.length !== candidates.length) window.sessionStorage.setItem(activeStudioJobStorageKey, JSON.stringify(valid));
    return valid;
  } catch {
    window.sessionStorage.removeItem(activeStudioJobStorageKey);
    return [];
  }
}

function persistActiveStudioJob(jobId: string) {
  const jobs = readActiveStudioJobs().filter((job) => job.jobId !== jobId);
  jobs.push({ jobId, startedAt: Date.now() });
  window.sessionStorage.setItem(activeStudioJobStorageKey, JSON.stringify(jobs));
}

function clearActiveStudioJob(jobId: string) {
  const remaining = readActiveStudioJobs().filter((job) => job.jobId !== jobId);
  if (remaining.length) window.sessionStorage.setItem(activeStudioJobStorageKey, JSON.stringify(remaining));
  else window.sessionStorage.removeItem(activeStudioJobStorageKey);
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
    const source = await blobToDataUrl(photo.file);
    const image = await loadImage(source);
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
    const blob = await canvasToJpeg(canvas);
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
  } catch {
    throw new Error(`${photo.name} 이미지를 JPEG로 변환하지 못했습니다.`);
  }
}

async function optimizeAndUploadInBatches(photos: StudioPhoto[], userId: string, jobId: string) {
  const supabase = createClient();
  const uploadedPaths: string[] = [];
  const imageSpecs: NormalizedProductImageSpec[] = [];
  try {
    for (let start = 0; start < photos.length; start += 4) {
      const batch = await Promise.all(photos.slice(start, start + 4).map((photo) => optimizePhoto(photo)));
      const results = await Promise.allSettled(batch.map(async (photo, offset) => {
        const index = start + offset;
        const path = `${userId}/${jobId}/input/${String(index + 1).padStart(3, "0")}.jpg`;
        const { error } = await supabase.storage.from("sellerpilot-ai").upload(path, photo.blob, {
          contentType: photo.mediaType,
          cacheControl: "3600",
          upsert: false,
        });
        if (error) throw new Error(`${photo.name} 비공개 업로드에 실패했습니다.`);
        return { path, spec: photo.spec };
      }));
      for (const result of results) if (result.status === "fulfilled") {
        uploadedPaths.push(result.value.path);
        imageSpecs.push(result.value.spec);
      }
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    }
    return { uploadedPaths, imageSpecs };
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from("sellerpilot-ai").remove(uploadedPaths);
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
  const handledRequest = useRef(0);
  const recoveryStarted = useRef(false);
  const latestQueuedJob = useRef("");
  const currentImageUrl = aiHero || mainPhoto?.url || "";

  const waitForCliJob = useCallback(async (jobId: string, accessToken: string) => {
    const deadline = Date.now() + 30 * 60_000;
    let consecutiveRequestFailures = 0;
    while (Date.now() < deadline) {
      let response: Response;
      try {
        response = await fetch(`/api/ai/jobs/${jobId}`, {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        consecutiveRequestFailures = 0;
      } catch {
        consecutiveRequestFailures += 1;
        if (consecutiveRequestFailures >= 5) throw new Error("모바일 네트워크에서 작업 상태를 5회 연속 확인하지 못했습니다. 등록 이력에서 서버 작업 상태를 계속 확인할 수 있습니다.");
        await delay(2_000);
        continue;
      }
      const payload = await response.json().catch(() => ({ message: "CLI 작업 상태 응답을 읽지 못했습니다." })) as CliJobPayload & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "CLI 작업 상태를 확인하지 못했습니다.");
      if (payload.status === "succeeded" && payload.result) return payload.result;
      if (payload.status === "failed" || payload.status === "cancelled") {
        throw new Error(payload.error || "ChatGPT CLI 작업이 완료되지 못했습니다.");
      }
      setCliPhase(payload.status === "running" ? "running" : "queued");
      await delay(3_000);
    }
    throw new Error("ChatGPT CLI 작업 대기시간이 30분을 초과했습니다. 작업자 연결 상태를 확인해 주세요.");
  }, []);

  const finishStudioJob = useCallback(async (jobId: string, accessToken: string, recovered: boolean) => {
    let cliResult: CliStudioResult;
    try {
      cliResult = await waitForCliJob(jobId, accessToken);
    } catch (error) {
      clearActiveStudioJob(jobId);
      throw error;
    }
    if (cliResult.mode !== "cli") throw new Error("상품 분석 결과 형식이 올바르지 않습니다.");
    const { heroUrl, generatedImages, ...nextResult } = cliResult;
    const shouldDisplayResult = recovered || latestQueuedJob.current === jobId;
    if (shouldDisplayResult) {
      setSourceJobId(jobId);
      setResult(nextResult);
      setAiHero(heroUrl ?? "");
      setThumbnails(generatedPreviewPresets.map((preset) => ({
        ...preset,
        dataUrl: generatedImages?.find((image) => image.id === preset.id)?.url ?? "",
      })).filter((thumbnail) => thumbnail.dataUrl));
      setSavedDetailData(null);
    }
    const productResponse = await fetch("/api/operations/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action: "product_create", jobId }),
    });
    const productPayload = await productResponse.json().catch(() => ({})) as { id?: string | null; message?: string };
    const productId = productResponse.ok && typeof productPayload.id === "string" ? productPayload.id : null;
    if (!productId) throw new Error(productPayload.message || "이미지 제작은 완료됐지만 상품 원장 저장을 확인하지 못했습니다. 새로고침하면 완료 작업부터 다시 연결합니다.");
    if (shouldDisplayResult) setSourceProductId(productId);
    clearActiveStudioJob(jobId);
    if (shouldDisplayResult) onResultReady?.(nextResult, productId);
    notify(recovered
      ? `새로고침 전 ChatGPT CLI 작업을 복구해 이미지 ${aiGeneratedAssetSpecs.length}종과 상품 원장을 다시 연결했습니다.`
      : `ChatGPT CLI 분석, codex-image 이미지 ${aiGeneratedAssetSpecs.length}종과 상품 원장 연결을 완료했습니다.`);
  }, [notify, onResultReady, waitForCliJob]);

  const generate = useCallback(async () => {
    if (!mainPhoto || generating) return;
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
      const { uploadedPaths: imagePaths, imageSpecs } = await optimizeAndUploadInBatches(photos, userId, jobId);
      const response = await fetch("/api/ai/product-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jobId, manualFields: validatedIntake.data, imagePaths, imageSpecs }),
      });
      const queued = await response.json().catch(() => ({ message: "CLI 작업 등록 응답을 읽지 못했습니다." })) as { jobId?: string; message?: string };
      if (!response.ok || !queued.jobId) throw new Error(queued.message ?? "상품 분석 요청을 처리하지 못했습니다.");
      persistActiveStudioJob(queued.jobId);
      latestQueuedJob.current = queued.jobId;
      onJobQueued?.(queued.jobId);
      notify("상품 분석 작업을 운영 큐에 등록했습니다. 처리되는 동안 다른 상품 등록을 바로 시작할 수 있습니다.");
      void finishStudioJob(queued.jobId, accessToken, false).catch((error) => {
        const message = error instanceof Error ? error.message : "AI 스튜디오 처리 중 오류가 발생했습니다.";
        setLastError(message);
        notify(message);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 스튜디오 처리 중 오류가 발생했습니다.";
      setLastError(message);
      notify(message);
    } finally {
      setGenerating(false);
      setCliPhase("idle");
      onRunningChange(false);
    }
  }, [finishStudioJob, generating, mainPhoto, manualFields, notify, onJobQueued, onRunningChange, photos]);

  const regenerateAsset = useCallback(async (assetId: string) => {
    if (!sourceJobId || generating || regeneratingAssetId) return;
    setRegeneratingAssetId(assetId);
    setLastError("");
    onRunningChange(true);
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("이미지를 재제작하려면 관리자 로그인이 필요합니다.");
      const jobId = crypto.randomUUID();
      const response = await fetch("/api/ai/product-studio/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jobId, sourceJobId, sourceProductId, assetId }),
      });
      const queued = await response.json().catch(() => ({ message: "재제작 작업 응답을 읽지 못했습니다." })) as { jobId?: string; message?: string };
      if (!response.ok || !queued.jobId) throw new Error(queued.message ?? "이미지 재제작 작업을 등록하지 못했습니다.");
      const regenerated = await waitForCliJob(queued.jobId, accessToken);
      if (regenerated.mode !== "asset-regeneration" || regenerated.assetId !== assetId) {
        throw new Error("재제작 이미지 결과가 요청과 일치하지 않습니다.");
      }
      const nextUrl = regenerated.generatedImages?.find((asset) => asset.id === assetId)?.url ?? "";
      if (!nextUrl) throw new Error("재제작 이미지 주소를 확인하지 못했습니다.");
      if (assetId === "hero") setAiHero(nextUrl);
      else setThumbnails((current) => current.map((asset) => asset.id === assetId ? { ...asset, dataUrl: nextUrl } : asset));
      notify(`${aiGeneratedAssetSpecs.find((asset) => asset.id === assetId)?.label ?? "선택 이미지"} 1장만 다시 제작해 교체했습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "이미지 재제작 중 오류가 발생했습니다.";
      setLastError(message);
      notify(message);
    } finally {
      setRegeneratingAssetId("");
      onRunningChange(false);
    }
  }, [generating, notify, onRunningChange, regeneratingAssetId, sourceJobId, sourceProductId, waitForCliJob]);

  useEffect(() => {
    if (!requestId || handledRequest.current === requestId) return;
    handledRequest.current = requestId;
    void generate();
  }, [generate, requestId]);

  useEffect(() => {
    if (recoveryStarted.current || requestId) return;
    const activeJobs = readActiveStudioJobs();
    if (!activeJobs.length) return;
    recoveryStarted.current = true;
    const recoveryTimer = window.setTimeout(() => {
      setGenerating(true);
      setCliPhase("queued");
      setLastError("");
      onRunningChange(true);
      void (async () => {
        try {
          const { data: sessionData } = await createClient().auth.getSession();
          const accessToken = sessionData.session?.access_token;
          if (!accessToken) throw new Error("진행 중인 상품 분석을 복구하려면 관리자 로그인이 필요합니다.");
          notify(`새로고침 전에 시작한 상품 분석 작업을 다시 연결하고 있습니다. (${activeJobs.length}건)`);
          const recovered = await Promise.allSettled(activeJobs.map((activeJob) => finishStudioJob(activeJob.jobId, accessToken, true)));
          const failed = recovered.find((item): item is PromiseRejectedResult => item.status === "rejected");
          if (failed) throw failed.reason;
        } catch (error) {
          const message = error instanceof Error ? error.message : "상품 분석 작업 복구 중 오류가 발생했습니다.";
          setLastError(message);
          notify(message);
        } finally {
          setGenerating(false);
          setCliPhase("idle");
          onRunningChange(false);
        }
      })();
    }, 0);
    return () => window.clearTimeout(recoveryTimer);
  }, [finishStudioJob, notify, onRunningChange, requestId]);

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
        <div><span className={`studio-mode ${generating ? cliPhase : result?.mode ?? "idle"}`}><i />{generating ? cliPhase === "running" ? "CLI 제작 중" : "CLI 대기 중" : result ? "CLI 실데이터" : "실행 대기"}</span><button type="button" onClick={() => void generate()} disabled={!mainPhoto || generating}>{generating ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}다시 생성</button></div>
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
