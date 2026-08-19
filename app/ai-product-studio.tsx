"use client";
/* eslint-disable @next/next/no-img-element -- previews use browser-generated object/data URLs */

import dynamic from "next/dynamic";
import { CheckCircle2, Download, ImageIcon, LoaderCircle, MonitorSmartphone, PencilRuler, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { createClient } from "../lib/supabase/client";
import { productIntakeSchema, type NormalizedProductImageSpec, type ProductIntakeDraft } from "../lib/product-intake";
import { userFacingErrorMessage } from "../lib/user-facing-errors";
import type { ProductDetailData } from "./product-detail-puck";
import type { ProductStudioResult } from "./product-studio-types";

const ProductDetailRender = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailRender), { ssr: false, loading: () => <div className="studio-loading"><LoaderCircle className="spin" size={24} />상세페이지 불러오는 중</div> });
const ProductDetailEditor = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailEditor), { ssr: false });

type StudioPhoto = { name: string; url: string; file: File; role: string; originalWidth: number; originalHeight: number };
type AutoThumbnail = { id: string; label: string; ratio: string; width: number; height: number; dataUrl: string };
type OptimizedPhoto = { name: string; mediaType: "image/jpeg"; blob: Blob; spec: NormalizedProductImageSpec };
type CliJobPayload = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  result?: (ProductStudioResult & {
    heroUrl?: string | null;
    generatedImages?: { id: string; url: string | null }[];
  }) | null;
  error?: string | null;
};

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

export function AiProductStudio({ mainPhoto, photos, manualFields, requestId, onRunningChange, notify, onResultReady, compact = false }: {
  mainPhoto: StudioPhoto | null;
  photos: StudioPhoto[];
  manualFields: ProductIntakeDraft;
  requestId: number;
  onRunningChange: (running: boolean) => void;
  notify: (message: string) => void;
  onResultReady?: (result: ProductStudioResult, productId: string | null) => void;
  compact?: boolean;
}) {
  const [result, setResult] = useState<ProductStudioResult | null>(null);
  const [thumbnails, setThumbnails] = useState<AutoThumbnail[]>([]);
  const [aiHero, setAiHero] = useState("");
  const [generating, setGenerating] = useState(false);
  const [cliPhase, setCliPhase] = useState<"idle" | "queued" | "running">("idle");
  const [editorOpen, setEditorOpen] = useState(false);
  const [savedDetailData, setSavedDetailData] = useState<ProductDetailData | null>(null);
  const [lastError, setLastError] = useState("");
  const handledRequest = useRef(0);
  const currentImageUrl = aiHero || mainPhoto?.url || "";

  const waitForCliJob = useCallback(async (jobId: string, accessToken: string) => {
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      const response = await fetch(`/api/ai/jobs/${jobId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({ message: "AI 제작 상태를 확인하지 못했습니다." })) as CliJobPayload & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "AI 제작 상태를 확인하지 못했습니다.");
      if (payload.status === "succeeded" && payload.result) return payload.result;
      if (payload.status === "failed" || payload.status === "cancelled") {
        throw new Error(payload.error || "AI 제작을 완료하지 못했습니다.");
      }
      setCliPhase(payload.status === "running" ? "running" : "queued");
      await delay(3_000);
    }
    throw new Error("AI 제작 시간이 예상보다 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.");
  }, []);

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
      const queued = await response.json().catch(() => ({ message: "AI 제작 요청을 시작하지 못했습니다." })) as { jobId?: string; message?: string };
      if (!response.ok || !queued.jobId) throw new Error(queued.message ?? "상품 분석 요청을 처리하지 못했습니다.");
      const cliResult = await waitForCliJob(queued.jobId, accessToken);
      const { heroUrl, generatedImages, ...nextResult } = cliResult;
      setResult(nextResult);
      setAiHero(heroUrl ?? "");
      setThumbnails(generatedPreviewPresets.map((preset) => ({
        ...preset,
        dataUrl: generatedImages?.find((image) => image.id === preset.id)?.url ?? "",
      })).filter((thumbnail) => thumbnail.dataUrl));
      setSavedDetailData(null);
      const productResponse = await fetch("/api/operations/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          action: "product_create",
          jobId: queued.jobId,
        }),
      });
      const productPayload = await productResponse.json().catch(() => ({})) as { id?: string | null };
      const productId = productResponse.ok && typeof productPayload.id === "string" ? productPayload.id : null;
      onResultReady?.(nextResult, productId);
      notify(productResponse.ok
        ? `상품 분석과 이미지 ${aiGeneratedAssetSpecs.length}종 제작을 완료했습니다.`
        : `이미지 ${aiGeneratedAssetSpecs.length}종 제작을 완료했습니다. 상품 저장 상태를 확인해 주세요.`);
    } catch (error) {
      const message = userFacingErrorMessage(error, "상품 이미지와 상세페이지를 만들지 못했습니다. 입력한 사진과 정보를 확인하고 다시 시도해 주세요.");
      setLastError(message);
      notify(message);
    } finally {
      setGenerating(false);
      setCliPhase("idle");
      onRunningChange(false);
    }
  }, [generating, mainPhoto, manualFields, notify, onResultReady, onRunningChange, photos, waitForCliJob]);

  useEffect(() => {
    if (!requestId || handledRequest.current === requestId) return;
    handledRequest.current = requestId;
    void generate();
  }, [generate, requestId]);

  const downloadImage = (thumbnail: AutoThumbnail) => {
    const anchor = document.createElement("a");
    anchor.href = thumbnail.dataUrl;
    anchor.download = `sellerpilot-${thumbnail.id}.jpg`;
    anchor.click();
  };

  if (compact) {
    return (
      <article className={`batch-studio-item ${generating ? "running" : result ? "succeeded" : lastError ? "failed" : "ready"}`}>
        <span className="batch-studio-thumb">{currentImageUrl ? <img src={currentImageUrl} alt="동시 처리 상품 대표사진" /> : <ImageIcon size={18} />}</span>
        <span><b>{manualFields.productName}</b><small>{manualFields.sellerSku} · {photos.length}장</small></span>
        <em>{generating ? cliPhase === "running" ? "AI 제작 중" : "대기 중" : result ? "준비 완료" : lastError ? "확인 필요" : "시작 전"}</em>
      </article>
    );
  }

  const creativeThumbnails = thumbnails.filter((thumbnail) => thumbnailPresets.some((preset) => preset.id === thumbnail.id));
  const detailThumbnails = thumbnails.filter((thumbnail) => detailPresets.some((preset) => preset.id === thumbnail.id));

  return (
    <section className="panel ai-product-studio" id="ai-product-studio">
      <div className="studio-heading">
        <div><span className="panel-kicker">AI 자동 제작</span><h3>상품 이미지 · 상세페이지</h3><p>등록한 사진과 설명을 분석해 판매 채널에 맞는 이미지와 상세페이지를 만듭니다.</p></div>
        <div><span className={`studio-mode ${generating ? cliPhase : result?.mode ?? "idle"}`}><i />{generating ? cliPhase === "running" ? "제작 중" : "대기 중" : result ? "준비 완료" : "시작 전"}</span><button type="button" onClick={() => void generate()} disabled={!mainPhoto || generating}>{generating ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}다시 만들기</button></div>
      </div>
      <div className="studio-source-row">
        <span><CheckCircle2 size={15} /><b>이미지 분석</b><small>{mainPhoto ? `${photos.length}장 반영` : "대표사진 등록 대기"}</small></span>
        <span><Sparkles size={15} /><b>상세 기획</b><small>5–7개 구매 흐름 섹션</small></span>
        <span><ImageIcon size={15} /><b>자동 이미지</b><small>대표 4종 · 상세 4종</small></span>
        <span><WandSparkles size={15} /><b>상품 특징 유지</b><small>원본을 참고해 자연스럽게 제작</small></span>
      </div>
      <div className="studio-workspace">
        <aside className="creative-rail">
          <div className="creative-rail-head"><span><b>자동 제작 썸네일</b><small>제품이 프레임의 70% 이상 보이는 마켓용 이미지</small></span><em>{creativeThumbnails.length || 3}종</em></div>
          {aiHero && <article className="thumbnail-card ai"><div><img src={aiHero} alt="AI가 제작한 상품 연출 이미지" /><span>AI 생성 이미지</span></div><b>상품 연출 이미지</b><small>원본 상품의 특징을 유지해 제작</small></article>}
          <div className="thumbnail-grid">
            {creativeThumbnails.length ? creativeThumbnails.map((thumbnail) => <article className="thumbnail-card" key={thumbnail.id}><button type="button" className="thumbnail-preview" onClick={() => downloadImage(thumbnail)}><img src={thumbnail.dataUrl} alt={`${thumbnail.label} 자동 썸네일`} /><span><Download size={13} />다운로드</span></button><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>) : thumbnailPresets.map((thumbnail) => <article className="thumbnail-card placeholder" key={thumbnail.id}><div><ImageIcon size={22} /><span>대표사진을 올리면 자동 제작</span></div><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>)}
          </div>
          <div className="creative-rail-head"><span><b>상세페이지 이미지</b><small>전체·특징·사용·구성 4장을 채널 상세 본문에 삽입</small></span><em>{detailThumbnails.length || 4}종</em></div>
          <div className="thumbnail-grid detail-assets">
            {detailThumbnails.length ? detailThumbnails.map((thumbnail) => <article className="thumbnail-card" key={thumbnail.id}><button type="button" className="thumbnail-preview" onClick={() => downloadImage(thumbnail)}><img src={thumbnail.dataUrl} alt={`${thumbnail.label} 자동 상세 이미지`} /><span><Download size={13} />다운로드</span></button><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>) : detailPresets.map((thumbnail) => <article className="thumbnail-card placeholder" key={thumbnail.id}><div><ImageIcon size={22} /><span>상세 전용 이미지 생성 대기</span></div><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>)}
          </div>
          {result ? <div className="creative-summary"><span>디자인 방향</span><b>{result.design.themeName}</b><p>{result.product.oneLine}</p><div>{Object.values(result.design.palette).map((color) => <i key={color} style={{ background: color }} title={color} />)}</div></div> : <div className="creative-summary empty"><span>분석 결과</span><b>상품 사진을 기다리고 있어요</b><p>대표사진을 등록하고 분석을 시작하면 결과를 표시합니다.</p></div>}
        </aside>

        <article className="detail-preview-panel">
          <div className="detail-preview-toolbar"><span><MonitorSmartphone size={16} /><b>상세페이지 미리보기</b><small>모바일 화면에 맞게 제작</small></span><button type="button" onClick={() => setEditorOpen(true)} disabled={!result}><PencilRuler size={15} />상세페이지 편집</button></div>
          <div className="detail-preview-scroll">{result && currentImageUrl ? <div className="detail-preview-canvas"><ProductDetailRender result={result} imageUrl={currentImageUrl} data={savedDetailData} /></div> : <div className="studio-empty-preview"><ImageIcon size={34} /><b>상세페이지를 아직 만들지 않았습니다.</b><small>대표사진과 상품 정보를 분석하면 결과를 여기에서 확인할 수 있습니다.</small></div>}</div>
        </article>
      </div>
      {lastError && <div className="studio-warning error" role="alert"><b>상품 콘텐츠를 만들지 못했습니다</b><p>{lastError}</p><small>입력한 사진과 정보를 확인한 뒤 다시 시도해 주세요.</small></div>}
      {result && result.warnings.length > 0 && <div className="studio-warning"><b>AI 검수 메모</b><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      {editorOpen && result && <ProductDetailEditor result={result} imageUrl={currentImageUrl} data={savedDetailData} onSave={(next) => { setSavedDetailData(next); notify("상세페이지 편집 내용을 현재 작업에 저장했습니다."); }} onClose={() => setEditorOpen(false)} />}
    </section>
  );
}
