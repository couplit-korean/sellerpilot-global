"use client";

import dynamic from "next/dynamic";
import { AlertTriangle, CircleCheck, Clock3, LoaderCircle, PencilRuler } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  inspectProductDetailImageDocument,
  parseProductDetailImageManifest,
  productDetailImageCount,
  type ProductDetailImageManifest,
} from "../lib/product-detail-image-manifest";
import { makeValidatedProductDetailPersistable, parsePersistedProductDetailPage } from "./_publishing/product-detail-persistence";
import type { ProductDetailData, ProductDetailImageLoadState, ProductDetailSource } from "./product-detail-puck";

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

export function parseProductDetailSource(value: unknown): ProductDetailSource | null {
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
  } as ProductDetailSource;
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
  source: ProductDetailSource | null;
  initialDetailPage: ProductDetailPageEnvelope | null;
  assetUrls: Record<string, string>;
  authenticatedFetch: AuthenticatedFetch;
  notify: (message: string) => void;
}) {
  const [detailPage, setDetailPage] = useState(initialDetailPage);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const detailImageLoadCycle = detailPage?.version ?? 0;
  const [imageLoadSnapshot, setImageLoadSnapshot] = useState<{
    cycle: number;
    states: Record<string, ProductDetailImageLoadState>;
  }>({ cycle: detailImageLoadCycle, states: {} });
  const saveInFlight = useRef(false);

  const detailInspection = useMemo(
    () => detailPage ? inspectProductDetailImageDocument(detailPage.data) : null,
    [detailPage],
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
  const detailImagesReady = Boolean(detailPage
    && detailInspection?.ok
    && detailPage.approvedVersion === detailPage.version
    && manifestMatchesDocument
    && expectedRoles.every((role) => Boolean(assetUrls[role]))
    && loadedImageCount === productDetailImageCount
    && failedImageCount === 0);

  const refreshLatest = async () => {
    const response = await authenticatedFetch(`/api/admin/products/${productId}/publish-context`);
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const latest = parseProductDetailPageEnvelope(payload?.detailPage);
    if (latest) setDetailPage(latest);
    return latest;
  };

  const save = async (next: ProductDetailData) => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
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
      setDetailPage(saved);
      setEditorOpen(false);
      notify("상세페이지 편집 내용을 운영 원장에 저장했습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "상세페이지 편집 내용을 저장하지 못했습니다.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const canEdit = Boolean(detailPage || source);
  const heroUrl = assetUrls.hero ?? assetUrls["source-primary"] ?? "";
  return <section className="panel product-detail-assets saved-product-detail-page">
    <div className="panel-heading">
      <div><span className="panel-kicker">PUCK DETAIL PAGE</span><h3>저장된 상세페이지 편집</h3></div>
      <button type="button" className="publish-execute" disabled={!canEdit || saving} onClick={() => setEditorOpen(true)}>{saving ? <LoaderCircle className="spin" size={15} /> : <PencilRuler size={15} />}{detailPage ? "상세페이지 다시 편집" : "상세페이지 편집 시작"}</button>
    </div>
    {canEdit ? <>
      <div className={`saved-detail-image-readiness ${detailImagesReady ? "ready" : failedImageCount > 0 ? "error" : "pending"}`} role="status" data-detail-images-ready={detailImagesReady ? "true" : "false"}>
        {detailImagesReady ? <CircleCheck size={15} /> : failedImageCount > 0 ? <AlertTriangle size={15} /> : <LoaderCircle className={detailPage ? "spin" : undefined} size={15} />}
        <span><b>상세 이미지 {loadedImageCount} / {productDetailImageCount}장</b><small>{detailImagesReady ? `저장 버전 ${detailPage?.version} · 운영 게시 준비 완료` : failedImageCount > 0 ? `불러오기 오류 ${failedImageCount}장 · 오류가 해소될 때까지 게시 준비 아님` : detailPage ? "저장된 역할·경로와 이미지 로드를 확인하는 중" : "원장 저장 후 8장 로드를 확인합니다."}</small></span>
      </div>
      <div className="detail-preview-scroll"><div className="detail-preview-canvas"><ProductDetailRender key={`detail-image-load-${detailImageLoadCycle}`} result={source} imageUrl={heroUrl} assetUrls={assetUrls} data={detailPage?.data ?? null} onDetailImageLoadState={reportImageLoadState} /></div></div>
      <p className="saved-detail-meta"><Clock3 size={13} />{detailPage ? `저장 버전 ${detailPage.version} · ${detailPage.updatedAt ? new Date(detailPage.updatedAt).toLocaleString("ko-KR") : "저장 시각 확인 중"}` : "아직 원장에 저장되지 않은 AI 초안입니다. 편집기의 발행 버튼을 누르면 영구 저장됩니다."}</p>
    </> : <div className="product-detail-empty compact"><PencilRuler size={24} /><b>편집 가능한 상세페이지 초안이 없습니다.</b><small>AI 상세페이지 제작을 먼저 완료하면 이 상품 화면에서 계속 수정할 수 있습니다.</small></div>}
    {editorOpen && canEdit ? <ProductDetailEditor result={source} imageUrl={heroUrl} assetUrls={assetUrls} data={detailPage?.data ?? null} saving={saving} onSave={save} onClose={() => { if (!saving) setEditorOpen(false); }} /> : null}
  </section>;
}
