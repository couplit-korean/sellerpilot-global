"use client";

import dynamic from "next/dynamic";
import { Clock3, LoaderCircle, PencilRuler } from "lucide-react";
import { useRef, useState } from "react";
import { makeProductDetailPersistable, parsePersistedProductDetailPage } from "./_publishing/product-detail-persistence";
import type { ProductDetailData, ProductDetailSource } from "./product-detail-puck";

const ProductDetailRender = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailRender), { ssr: false });
const ProductDetailEditor = dynamic(() => import("./product-detail-puck").then((module) => module.ProductDetailEditor), { ssr: false });

export type ProductDetailPageEnvelope = {
  data: ProductDetailData;
  version: number;
  updatedAt: string | null;
};

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseProductDetailPageEnvelope(value: unknown): ProductDetailPageEnvelope | null {
  return parsePersistedProductDetailPage<ProductDetailData>(value);
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
  return { product, design } as ProductDetailSource;
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
  const saveInFlight = useRef(false);

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
      const persistable = makeProductDetailPersistable(next, assetUrls);
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
      <div className="detail-preview-scroll"><div className="detail-preview-canvas"><ProductDetailRender result={source} imageUrl={heroUrl} assetUrls={assetUrls} data={detailPage?.data ?? null} /></div></div>
      <p className="saved-detail-meta"><Clock3 size={13} />{detailPage ? `저장 버전 ${detailPage.version} · ${detailPage.updatedAt ? new Date(detailPage.updatedAt).toLocaleString("ko-KR") : "저장 시각 확인 중"}` : "아직 원장에 저장되지 않은 AI 초안입니다. 편집기의 발행 버튼을 누르면 영구 저장됩니다."}</p>
    </> : <div className="product-detail-empty compact"><PencilRuler size={24} /><b>편집 가능한 상세페이지 초안이 없습니다.</b><small>AI 상세페이지 제작을 먼저 완료하면 이 상품 화면에서 계속 수정할 수 있습니다.</small></div>}
    {editorOpen && canEdit ? <ProductDetailEditor result={source} imageUrl={heroUrl} assetUrls={assetUrls} data={detailPage?.data ?? null} saving={saving} onSave={save} onClose={() => { if (!saving) setEditorOpen(false); }} /> : null}
  </section>;
}
