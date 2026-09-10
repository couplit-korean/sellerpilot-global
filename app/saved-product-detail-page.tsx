"use client";

import dynamic from "next/dynamic";
import { AlertTriangle, CircleCheck, Clock3, LoaderCircle, PencilRuler } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  inspectProductDetailImageDocument,
  parseProductDetailImageManifest,
  productDetailImageCount,
  type ProductDetailImageManifest,
} from "../lib/product-detail-image-manifest";
import { makeValidatedProductDetailPersistable, parsePersistedProductDetailPage } from "./_publishing/product-detail-persistence";
import type { ProductDetailData, ProductDetailImageLoadState, ProductDetailSource } from "./product-detail-puck";
import { inspectStudioResultQuality, type StudioResultQuality } from "../lib/studio-result-quality";
import { productDetailImageLoadCycleKey } from "../lib/product-detail-image-load-cycle";

import { ProductDetailAssetImport, savedDetailSource } from "./product-detail-asset-import";

type QualityAwareDetailSource = ProductDetailSource & { studioQuality?: StudioResultQuality };

const ProductDetailRender = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailRender), { ssr: false });
const ProductDetailEditor = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailEditor), { ssr: false });

export type ProductDetailPageEnvelope = {
  data: ProductDetailData;
  version: number;
  updatedAt: string | null;
  approvedVersion: number | null;
  imageManifest: ProductDetailImageManifest | null;
};

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseProductDetailPageEnvelope(value: unknown): ProductDetailPageEnvelope | null {
  const parsed = parsePersistedProductDetailPage<ProductDetailData>(value);
  if (!parsed) return null;
  const record = isRecord(value) ? value : {};
  const approvedVersionValue = Number(record.approvedVersion);
  return {
    ...parsed,
    approvedVersion: Number.isSafeInteger(approvedVersionValue) && approvedVersionValue > 0
      ? approvedVersionValue
      : null,
    imageManifest: parseProductDetailImageManifest(record.imageManifest),
  };
}

export function parseProductDetailSource(value: unknown): QualityAwareDetailSource | null {
  if (!isRecord(value) || !isRecord(value.product) || !isRecord(value.design) || !isRecord(value.design.palette)) return null;
  const product = value.product as Record<string, unknown>;
  const design = value.design as Record<string, unknown>;
  const palette = design.palette as Record<string, unknown>;
  const strings = [product.name, product.category, product.oneLine, product.targetCustomer, design.themeName, design.heroCopy, design.heroSubcopy, design.cta, palette.primary, palette.accent, palette.surface, palette.text];
  if (strings.some((item) => typeof item !== "string" || !item)) return null;
  if (!Array.isArray(product.features) || !product.features.every((item) => typeof item === "string")) return null;
  if (!Array.isArray(product.cautions) || !product.cautions.every((item) => typeof item === "string")) return null;
  if (!Array.isArray(design.sections) || !design.sections.every((section) => isRecord(section)
    && typeof section.type === "string"
    && typeof section.eyebrow === "string"
    && typeof section.title === "string"
    && typeof section.body === "string"
    && Array.isArray(section.points)
    && section.points.every((point) => typeof point === "string"))) return null;
  return {
    product,
    design,
    ...(Array.isArray(value.localizedListings) ? { localizedListings: value.localizedListings } : {}),
    studioQuality: inspectStudioResultQuality(value),
  } as QualityAwareDetailSource;
}

export function SavedProductDetailPage({
  productId,
  source,
  initialDetailPage,
  assetUrls,
  authenticatedFetch,
  notify,
}: {
  productId: string;
  source: QualityAwareDetailSource | null;
  initialDetailPage: ProductDetailPageEnvelope | null;
  assetUrls: Record<string, string>;
  authenticatedFetch: AuthenticatedFetch;
  notify: (message: string) => void;
}) {
  const [detailPage, setDetailPage] = useState(initialDetailPage);
  const [editorOpen, setEditorOpen] = useState(false);
  const [savedSource, setSavedSource] = useState<"studio" | "external" | "unknown">("unknown");
  const [selectedSource, setSelectedSource] = useState<"studio" | "external">("studio");
  // An external persisted document must never resolve through Studio asset URLs.
  const studioDocument = savedSource === "studio" ? detailPage?.data ?? null : null;
  const [saving, setSaving] = useState(false);
  const detailImageLoadCycle = productDetailImageLoadCycleKey({
    productId,
    version: detailPage?.version ?? 0,
    savedSource,
    selectedSource,
    assetUrls,
  });
  const [imageLoadSnapshot, setImageLoadSnapshot] = useState<{
    cycle: string;
    states: Record<string, ProductDetailImageLoadState>;
  }>({ cycle: detailImageLoadCycle, states: {} });
  const saveInFlight = useRef(false);
  const latestRead = useRef(0);

  const detailInspection = useMemo(
    () => studioDocument ? inspectProductDetailImageDocument(studioDocument) : null,
    [studioDocument],
  );
  const expectedRoles = useMemo(
    () => detailInspection?.ok ? detailInspection.images.map((image) => image.role) : [],
    [detailInspection],
  );
  const expectedRoleSet = useMemo(() => new Set<string>(expectedRoles), [expectedRoles]);
  const imageLoadStates = imageLoadSnapshot.cycle === detailImageLoadCycle
    ? imageLoadSnapshot.states
    : {};
  const reportImageLoadState = useCallback((role: string, state: ProductDetailImageLoadState) => {
    if (!expectedRoleSet.has(role)) return;
    setImageLoadSnapshot((current) => {
      const states = current.cycle === detailImageLoadCycle ? current.states : {};
      return states[role] === state
        ? current
        : { cycle: detailImageLoadCycle, states: { ...states, [role]: state } };
    });
  }, [detailImageLoadCycle, expectedRoleSet]);
  const loadedImageCount = expectedRoles.filter((role) => imageLoadStates[role] === "loaded").length;
  const failedImageCount = expectedRoles.filter((role) => imageLoadStates[role] === "error").length;
  const manifestRoles = detailPage?.imageManifest?.images.map((image) => image.role) ?? [];
  const manifestMatchesDocument = manifestRoles.length === productDetailImageCount
    && manifestRoles.every((role, index) => role === expectedRoles[index]);
  const qualityBlocked = source?.studioQuality?.blockedForPublication === true;
  const detailImagesReady = Boolean(detailPage
    && savedSource === "studio" && selectedSource === "studio"
    && !qualityBlocked
    && detailInspection?.ok
    && detailPage.approvedVersion === detailPage.version
    && manifestMatchesDocument
    && expectedRoles.every((role) => Boolean(assetUrls[role]))
    && loadedImageCount === productDetailImageCount
    && failedImageCount === 0);

  const refreshLatest = useCallback(async () => {
    const ticket = ++latestRead.current;
    const response = await authenticatedFetch(`/api/admin/products/${productId}/publish-context`);
    if (ticket !== latestRead.current) return null;
    if (!response.ok) { setSavedSource("unknown"); throw new Error("현재 상세 문서 출처를 확인하지 못했습니다. 읽기를 다시 시도하세요."); }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (ticket !== latestRead.current) return null;
    const latest = parseProductDetailPageEnvelope(payload?.detailPage);
    setSavedSource(payload ? savedDetailSource(payload) : "unknown");
    if (latest) setDetailPage(latest);
    return latest;
  }, [authenticatedFetch, productId]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(refreshLatest).catch((error: unknown) => { if (active) notify(error instanceof Error ? error.message : "상세 출처 확인 실패"); });
    return () => { active = false; latestRead.current += 1; };
  }, [refreshLatest, notify]);

  const save = async (next: ProductDetailData) => {
    if (selectedSource === "external" || savedSource === "unknown") {
      notify("외부 승인 문안은 아래 external_generated 가져오기에서 새 수정본으로 검수해 주세요. 기존 Studio 자산으로 덮어쓰지 않습니다.");
      return;
    }
    if (qualityBlocked) {
      notify(source?.studioQuality?.message ?? "대체본은 다시 제작한 뒤 검수해 주세요.");
      return;
    }
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    latestRead.current += 1;
    setSaving(true);
    try {
      const persistable = makeValidatedProductDetailPersistable(next, assetUrls);
      const response = await authenticatedFetch(`/api/admin/products/${productId}/publish-context`, {
        method: "PUT",
        body: JSON.stringify({ data: persistable, expectedVersion: detailPage?.version ?? null }),
      });
      const payload = await response.json().catch(() => ({ message: "상세페이지 저장 응답을 읽지 못했습니다." })) as {
        detailPage?: unknown;
        code?: string;
        message?: string;
      };
      if (response.status === 409 && payload.code === "DETAIL_PAGE_VERSION_CONFLICT") {
        await refreshLatest();
        throw new Error(payload.message ?? "다른 화면의 최신 저장본을 불러왔습니다. 변경사항을 다시 확인해 주세요.");
      }
      if (!response.ok) throw new Error(payload.message ?? "상세페이지 편집 내용을 저장하지 못했습니다.");
      const saved = parseProductDetailPageEnvelope(payload.detailPage);
      if (!saved) throw new Error("저장된 상세페이지 버전을 확인하지 못했습니다.");
      latestRead.current += 1;
      setDetailPage(saved);
      setSavedSource("studio");
      setEditorOpen(false);
      notify("상세페이지 편집 내용을 운영 원장에 저장했습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "상세페이지 편집 내용을 저장하지 못했습니다.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const canEdit = Boolean(studioDocument || source);
  const heroUrl = assetUrls.hero ?? assetUrls["source-primary"] ?? "";
  return <section className="panel product-detail-assets saved-product-detail-page">
    <div className="panel-heading">
      <div><span className="panel-kicker">PUCK DETAIL PAGE</span><h3>저장된 상세페이지 편집</h3></div>
      <button type="button" className="publish-execute" disabled={!canEdit || saving || selectedSource !== "studio" || savedSource === "unknown"} onClick={() => setEditorOpen(true)}>{saving ? <LoaderCircle className="spin" size={15} /> : <PencilRuler size={15} />}{detailPage ? "상세페이지 다시 편집" : "상세페이지 편집 시작"}</button>
    </div>
    <div role="group" aria-label="상세 문서 출처 명시 선택">
      <button type="button" aria-pressed={selectedSource === "studio"} disabled={saving} onClick={() => { setSelectedSource("studio"); setEditorOpen(false); }}>기존 Studio 문서·초안 선택</button>
      <button type="button" aria-pressed={selectedSource === "external"} disabled={saving} onClick={() => { setSelectedSource("external"); setEditorOpen(false); }}>external_generated 외부 검수·승인본 선택</button>
      <button type="button" disabled={saving} onClick={() => { void refreshLatest().catch((error: unknown) => notify(error instanceof Error ? error.message : "출처 조회 실패")); }}>현재 문서 출처·버전 재확인</button>
    </div>
    {savedSource === "unknown" ? <p role="status">서버 문서 출처 확인 중 · Studio 초안은 원래 자산으로만 표시하며 저장은 확인 후 가능합니다.</p> : null}
    {savedSource === "external" && selectedSource === "studio" ? <p>저장 문서는 외부 가져오기입니다. 지금 선택한 화면은 기존 Studio 초안이며 외부 문서·이미지와 혼합하지 않습니다.</p> : null}
    {qualityBlocked ? <div className="saved-detail-image-readiness error" role="alert" data-studio-quality="degraded"><AlertTriangle size={15} /><span><b>대체 제작 결과 · 재제작 필요</b><small>{source?.studioQuality?.message}</small></span></div> : null}
    {canEdit ? <>
      <div className={`saved-detail-image-readiness ${detailImagesReady ? "ready" : failedImageCount > 0 ? "error" : "pending"}`} role="status" data-detail-images-ready={detailImagesReady ? "true" : "false"}>
        {detailImagesReady ? <CircleCheck size={15} /> : failedImageCount > 0 ? <AlertTriangle size={15} /> : <LoaderCircle className={detailPage ? "spin" : undefined} size={15} />}
        <span><b>상세 이미지 {loadedImageCount} / {productDetailImageCount}장</b><small>{qualityBlocked ? "이미지가 모두 열려도 대체본은 게시 준비 상태가 아닙니다." : detailImagesReady ? `저장 버전 ${detailPage?.version} · 이미지 연결 확인 완료 · 문안·채널 조건 별도 검수` : failedImageCount > 0 ? `불러오기 오류 ${failedImageCount}장 · 오류가 해소될 때까지 게시 준비 아님` : detailPage ? "저장된 역할·경로와 이미지 로드를 확인하는 중" : "원장 저장 후 8장 로드를 확인합니다."}</small></span>
      </div>
      {selectedSource === "external" ? <p role="status">아래에서 서버의 현재 외부 승인본 또는 진행 중 예약을 명시적으로 불러오세요. Studio 이미지와 섞지 않습니다.</p> : <div className="detail-preview-scroll"><div className="detail-preview-canvas"><ProductDetailRender key={`detail-image-load-${detailImageLoadCycle}`} result={source} imageUrl={heroUrl} assetUrls={assetUrls} data={studioDocument} onDetailImageLoadState={reportImageLoadState} /></div></div>}
      <p className="saved-detail-meta"><Clock3 size={13} />{detailPage ? `저장 버전 ${detailPage.version} · ${detailPage.updatedAt ? new Date(detailPage.updatedAt).toLocaleString("ko-KR") : "저장 시각 확인 중"}` : "아직 원장에 저장되지 않은 AI 초안입니다. 편집기의 발행 버튼을 누르면 영구 저장됩니다."}</p>
    </> : <div className="product-detail-empty compact"><PencilRuler size={24} /><b>편집 가능한 상세페이지 초안이 없습니다.</b><small>AI 상세페이지 제작을 먼저 완료하면 이 상품 화면에서 계속 수정할 수 있습니다.</small></div>}
    <div hidden={selectedSource !== "external"}><ProductDetailAssetImport key={productId} productId={productId} currentVersion={detailPage?.version ?? 0} authenticatedFetch={authenticatedFetch} onImported={async () => { setSelectedSource("external"); setEditorOpen(false); await refreshLatest(); }} /></div>
    {editorOpen && canEdit ? <ProductDetailEditor result={source} imageUrl={heroUrl} assetUrls={assetUrls} data={studioDocument} saving={saving} onSave={save} onClose={() => { if (!saving) setEditorOpen(false); }} /> : null}
  </section>;
}
