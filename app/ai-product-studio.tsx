"use client";
/* eslint-disable @next/next/no-img-element -- previews use browser-generated object/data URLs */

import dynamic from "next/dynamic";
import { CheckCircle2, Download, ExternalLink, ImageIcon, LoaderCircle, MonitorSmartphone, PencilRuler, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { createDemoStudioResult } from "./product-studio-fallback";
import { CODEX_IMAGE_SOURCE } from "./product-studio-prompt";
import type { ProductDetailData } from "./product-detail-puck";
import type { ProductStudioResult } from "./product-studio-types";

const ProductDetailRender = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailRender), { ssr: false, loading: () => <div className="studio-loading"><LoaderCircle className="spin" size={24} />상세페이지 불러오는 중</div> });
const ProductDetailEditor = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailEditor), { ssr: false });

type StudioPhoto = { name: string; url: string; file: File };
type AutoThumbnail = { id: string; label: string; ratio: string; width: number; height: number; dataUrl: string };
type OptimizedPhoto = { name: string; mediaType: "image/jpeg"; blob: Blob };
type CliJobPayload = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  result?: (ProductStudioResult & { heroUrl?: string | null }) | null;
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

async function optimizePhoto(photo: StudioPhoto, isMain: boolean): Promise<OptimizedPhoto> {
  try {
    const source = await blobToDataUrl(photo.file);
    const image = await loadImage(source);
    const maxEdge = isMain ? 1600 : 1200;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", isMain ? 0.84 : 0.78));
    if (!blob) throw new Error("이미지 변환 실패");
    return { name: photo.name.replace(/\.[^.]+$/, ".jpg"), mediaType: "image/jpeg", blob };
  } catch {
    throw new Error(`${photo.name} 이미지를 JPEG로 변환하지 못했습니다.`);
  }
}

async function optimizeAndUploadInBatches(photos: StudioPhoto[], userId: string, jobId: string) {
  const supabase = createClient();
  const uploadedPaths: string[] = [];
  try {
    for (let start = 0; start < photos.length; start += 4) {
      const batch = await Promise.all(photos.slice(start, start + 4).map((photo, offset) => optimizePhoto(photo, start + offset === 0)));
      const results = await Promise.allSettled(batch.map(async (photo, offset) => {
        const index = start + offset;
        const path = `${userId}/${jobId}/input/${String(index + 1).padStart(3, "0")}.jpg`;
        const { error } = await supabase.storage.from("sellerpilot-ai").upload(path, photo.blob, {
          contentType: photo.mediaType,
          cacheControl: "3600",
          upsert: false,
        });
        if (error) throw new Error(`${photo.name} 비공개 업로드에 실패했습니다.`);
        return path;
      }));
      for (const result of results) if (result.status === "fulfilled") uploadedPaths.push(result.value);
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    }
    return uploadedPaths;
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from("sellerpilot-ai").remove(uploadedPaths);
    throw error;
  }
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

function drawContained(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 3) {
  const manualLines = text.split("\n");
  let lineIndex = 0;
  for (const manualLine of manualLines) {
    const words = manualLine.split(" ");
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width > maxWidth && line) {
        context.fillText(line, x, y + lineIndex * lineHeight);
        lineIndex += 1;
        line = word;
        if (lineIndex >= maxLines) return;
      } else line = next;
    }
    if (lineIndex < maxLines) context.fillText(line, x, y + lineIndex * lineHeight);
    lineIndex += 1;
    if (lineIndex >= maxLines) return;
  }
}

async function renderThumbnail(photoUrl: string, result: ProductStudioResult, preset: Omit<AutoThumbnail, "dataUrl">): Promise<AutoThumbnail> {
  const image = await loadImage(photoUrl);
  const canvas = document.createElement("canvas");
  canvas.width = preset.width;
  canvas.height = preset.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas를 사용할 수 없습니다.");
  const { primary, accent, surface } = result.design.palette;
  const gradient = context.createLinearGradient(0, 0, preset.width, preset.height);
  gradient.addColorStop(0, surface);
  gradient.addColorStop(1, accent);
  context.fillStyle = gradient;
  context.fillRect(0, 0, preset.width, preset.height);

  context.globalAlpha = 0.18;
  context.fillStyle = primary;
  context.beginPath();
  context.arc(preset.width * 0.82, preset.height * 0.22, Math.min(preset.width, preset.height) * 0.3, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  const isWide = preset.width / preset.height > 1.4;
  const imageX = isWide ? preset.width * 0.53 : preset.width * 0.25;
  const imageY = isWide ? preset.height * 0.07 : preset.height * 0.08;
  const imageWidth = isWide ? preset.width * 0.43 : preset.width * 0.7;
  const imageHeight = isWide ? preset.height * 0.86 : preset.height * 0.6;
  context.save();
  context.shadowColor = "rgba(30, 35, 28, .18)";
  context.shadowBlur = Math.round(preset.width * 0.025);
  context.shadowOffsetY = Math.round(preset.height * 0.015);
  drawContained(context, image, imageX, imageY, imageWidth, imageHeight);
  context.restore();

  const copyX = Math.round(preset.width * 0.07);
  const copyWidth = isWide ? preset.width * 0.42 : preset.width * 0.86;
  const copyY = isWide ? preset.height * 0.22 : preset.height * 0.72;
  context.fillStyle = primary;
  context.font = `800 ${Math.round(preset.width * (isWide ? 0.022 : 0.025))}px Arial, sans-serif`;
  roundedRect(context, copyX, copyY - preset.height * 0.08, preset.width * 0.22, preset.height * 0.045, preset.height * 0.022);
  context.fillStyle = surface;
  context.textBaseline = "middle";
  context.fillText(result.thumbnail.badge, copyX + preset.width * 0.018, copyY - preset.height * 0.058);
  context.textBaseline = "alphabetic";
  context.fillStyle = primary;
  context.font = `900 ${Math.round(preset.width * (isWide ? 0.052 : 0.064))}px Arial, sans-serif`;
  wrapText(context, result.thumbnail.headline, copyX, copyY + preset.height * 0.04, copyWidth, preset.height * (isWide ? 0.105 : 0.065), 2);
  context.font = `700 ${Math.round(preset.width * (isWide ? 0.018 : 0.024))}px Arial, sans-serif`;
  context.globalAlpha = 0.72;
  context.fillText(result.thumbnail.subline, copyX, preset.height * 0.94);
  context.globalAlpha = 1;
  return { ...preset, dataUrl: canvas.toDataURL("image/jpeg", 0.92) };
}

const thumbnailPresets = [
  { id: "square", label: "마켓 대표", ratio: "1:1 · 1080", width: 1080, height: 1080 },
  { id: "portrait", label: "모바일 피드", ratio: "4:5 · 1080×1350", width: 1080, height: 1350 },
  { id: "wide", label: "프로모션 배너", ratio: "16:9 · 1200×675", width: 1200, height: 675 },
];

export function AiProductStudio({ mainPhoto, photos, description, productUrl, requestId, onRunningChange, notify, sampleImage }: {
  mainPhoto: StudioPhoto | null;
  photos: StudioPhoto[];
  description: string;
  productUrl: string;
  requestId: number;
  onRunningChange: (running: boolean) => void;
  notify: (message: string) => void;
  sampleImage: string;
}) {
  const [result, setResult] = useState<ProductStudioResult>(() => createDemoStudioResult(description));
  const [thumbnails, setThumbnails] = useState<AutoThumbnail[]>([]);
  const [aiHero, setAiHero] = useState("");
  const [generating, setGenerating] = useState(false);
  const [cliPhase, setCliPhase] = useState<"idle" | "queued" | "running">("idle");
  const [editorOpen, setEditorOpen] = useState(false);
  const [savedDetailData, setSavedDetailData] = useState<ProductDetailData | null>(null);
  const handledRequest = useRef(0);
  const currentImageUrl = aiHero || mainPhoto?.url || sampleImage;

  const makeLocalThumbnails = useCallback(async (nextResult: ProductStudioResult, photo = mainPhoto) => {
    if (!photo) return;
    const items = await Promise.all(thumbnailPresets.map((preset) => renderThumbnail(photo.url, nextResult, preset)));
    setThumbnails(items);
  }, [mainPhoto]);

  const waitForCliJob = useCallback(async (jobId: string, accessToken: string) => {
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
      const response = await fetch(`/api/ai/jobs/${jobId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({ message: "CLI 작업 상태 응답을 읽지 못했습니다." })) as CliJobPayload & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "CLI 작업 상태를 확인하지 못했습니다.");
      if (payload.status === "succeeded" && payload.result) return payload.result;
      if (payload.status === "failed" || payload.status === "cancelled") {
        throw new Error(payload.error || "ChatGPT CLI 작업이 완료되지 못했습니다.");
      }
      setCliPhase(payload.status === "running" ? "running" : "queued");
      await delay(3_000);
    }
    throw new Error("ChatGPT CLI 작업 대기시간이 12분을 초과했습니다. 작업자 연결 상태를 확인해 주세요.");
  }, []);

  const generate = useCallback(async () => {
    if (!mainPhoto || generating) return;
    setGenerating(true);
    onRunningChange(true);
    setAiHero("");
    setCliPhase("queued");
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const userId = sessionData.session?.user.id;
      if (!accessToken || !userId) throw new Error("AI 제작을 실행하려면 관리자 로그인이 필요합니다.");
      if (photos.length > 100) throw new Error("한 작업에는 대표사진을 포함해 최대 100장까지 분석할 수 있습니다.");
      const jobId = crypto.randomUUID();
      const imagePaths = await optimizeAndUploadInBatches(photos, userId, jobId);
      const response = await fetch("/api/ai/product-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jobId, description, productUrl, imagePaths }),
      });
      const queued = await response.json().catch(() => ({ message: "CLI 작업 등록 응답을 읽지 못했습니다." })) as { jobId?: string; message?: string };
      if (!response.ok || !queued.jobId) throw new Error(queued.message ?? "상품 분석 요청을 처리하지 못했습니다.");
      const cliResult = await waitForCliJob(queued.jobId, accessToken);
      const { heroUrl, ...nextResult } = cliResult;
      setResult(nextResult);
      setAiHero(heroUrl ?? "");
      setSavedDetailData(null);
      await makeLocalThumbnails(nextResult, mainPhoto);
      notify("ChatGPT CLI 분석과 codex-image 상품 연출컷 제작을 완료했습니다.");
    } catch (error) {
      const fallback = createDemoStudioResult(description);
      setResult(fallback);
      await makeLocalThumbnails(fallback, mainPhoto);
      notify(error instanceof Error ? error.message : "AI 스튜디오 처리 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
      setCliPhase("idle");
      onRunningChange(false);
    }
  }, [description, generating, mainPhoto, makeLocalThumbnails, notify, onRunningChange, photos, productUrl, waitForCliJob]);

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

  return (
    <section className="panel ai-product-studio" id="ai-product-studio">
      <div className="studio-heading">
        <div><span className="panel-kicker">AI DETAIL & CREATIVE STUDIO</span><h3>상세페이지 · 썸네일 자동 제작</h3><p>로컬 ChatGPT CLI가 사진과 설명을 분석하고, codex-image와 Puck 편집 흐름으로 결과를 만듭니다.</p></div>
        <div><span className={`studio-mode ${generating ? cliPhase : result.mode}`}><i />{generating ? cliPhase === "running" ? "CLI 제작 중" : "CLI 대기 중" : result.mode === "cli" ? "CLI 실데이터" : "임의 데이터"}</span><button type="button" onClick={() => void generate()} disabled={!mainPhoto || generating}>{generating ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}다시 생성</button></div>
      </div>
      <div className="studio-source-row">
        <span><CheckCircle2 size={15} /><b>이미지 분석</b><small>{mainPhoto ? `${photos.length}장 반영` : "대표사진 등록 대기"}</small></span>
        <span><Sparkles size={15} /><b>상세 기획</b><small>5–7개 구매 흐름 섹션</small></span>
        <span><ImageIcon size={15} /><b>자동 썸네일</b><small>1:1 · 4:5 · 16:9</small></span>
        <a href={CODEX_IMAGE_SOURCE} target="_blank" rel="noreferrer"><WandSparkles size={15} /><b>Codex Image 규칙</b><small>gpt-image-2 · MIT</small><ExternalLink size={12} /></a>
      </div>
      <div className="studio-workspace">
        <aside className="creative-rail">
          <div className="creative-rail-head"><span><b>자동 제작 썸네일</b><small>채널에 맞춰 즉시 다운로드</small></span><em>{thumbnails.length || 3}종</em></div>
          {aiHero && <article className="thumbnail-card ai"><div><img src={aiHero} alt="codex-image가 제작한 상품 연출컷" /><span>CODEX IMAGE</span></div><b>CLI 상품 연출컷</b><small>ChatGPT OAuth · 원본 충실도 높음</small></article>}
          <div className="thumbnail-grid">
            {thumbnails.length ? thumbnails.map((thumbnail) => <article className="thumbnail-card" key={thumbnail.id}><button type="button" className="thumbnail-preview" onClick={() => downloadImage(thumbnail)}><img src={thumbnail.dataUrl} alt={`${thumbnail.label} 자동 썸네일`} /><span><Download size={13} />다운로드</span></button><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>) : thumbnailPresets.map((thumbnail) => <article className="thumbnail-card placeholder" key={thumbnail.id}><div><ImageIcon size={22} /><span>대표사진을 올리면 자동 제작</span></div><b>{thumbnail.label}</b><small>{thumbnail.ratio}</small></article>)}
          </div>
          <div className="creative-summary"><span>CREATIVE DIRECTION</span><b>{result.design.themeName}</b><p>{result.product.oneLine}</p><div>{Object.values(result.design.palette).map((color) => <i key={color} style={{ background: color }} title={color} />)}</div></div>
        </aside>

        <article className="detail-preview-panel">
          <div className="detail-preview-toolbar"><span><MonitorSmartphone size={16} /><b>상세페이지 라이브 미리보기</b><small>모바일 우선 · 블록형 구성</small></span><button type="button" onClick={() => setEditorOpen(true)}><PencilRuler size={15} />Puck으로 직접 편집</button></div>
          <div className="detail-preview-scroll"><div className="detail-preview-canvas"><ProductDetailRender result={result} imageUrl={currentImageUrl} data={savedDetailData} /></div></div>
        </article>
      </div>
      {result.warnings.length > 0 && <div className="studio-warning"><b>AI 검수 메모</b><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      {editorOpen && <ProductDetailEditor result={result} imageUrl={currentImageUrl} data={savedDetailData} onSave={(next) => { setSavedDetailData(next); notify("상세페이지 편집 내용을 현재 작업에 저장했습니다."); }} onClose={() => setEditorOpen(false)} />}
    </section>
  );
}
