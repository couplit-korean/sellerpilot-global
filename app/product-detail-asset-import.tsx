"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { aiDetailAssetIds } from "../lib/ai-generated-assets";
import { externalDetailCanonical as externalImportCanonical } from "../lib/external-detail-canonical";
export { externalImportCanonical };
import { inspectProductDetailImageDocument, productDetailAssetReferencePrefix } from "../lib/product-detail-image-manifest";
import type { ProductDetailData } from "./product-detail-puck";
import type { ExternalDetailImportRequest } from "../lib/server-external-detail-import";

const Preview = dynamic(() => import("./product-detail-puck").then((m) => m.ProductDetailRender), { ssr: false });
const Editor = dynamic(() => import("./product-detail-puck").then((m) => m.ProductDetailEditor), { ssr: false });
const locales = ["ko", "ja", "en"] as const;
type Locale = typeof locales[number];
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Copy = Record<Locale, { document: ProductDetailData; reviewNote: string }>;
export type ExternalImportPackage = {
  source: ExternalDetailImportRequest["source"];
  assets: { role: ExternalDetailImportRequest["assets"][number]["role"]; alt: string; caption: string }[];
  reviewedCopy: Copy;
  audit: { rightsBasis: string; limitations: string; sourceReferences: { label: string; sha256: string; url?: string }[] };
};
type Context = { productId: string; ownerId: string; productUpdatedAt: string; detailVersion: number; aiJobId: string | null };
type Receipt = { id: string; product_id: string; owner_id: string; request_sha256: string; status: "reserved" | "verified" | "approved" | "cancelled" };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

/** External import only: the component supplies its exact current local preview or
 * server-bound signedImages map. Scheme alone never authorizes an image URL.
 * Keep the legacy Studio HTTPS-only serializer unchanged. */
export function makeExternalImportDocumentCanonical(
  document: ProductDetailData,
  assets: ExternalImportPackage["assets"],
  currentAssetUrls: Readonly<Record<string, string>>,
): ProductDetailData {
  const roles = assets.map((asset) => asset.role);
  if (roles.length !== 8 || new Set(roles).size !== 8 || roles.some((role) => !aiDetailAssetIds.includes(role))) throw new Error("외부 가져오기는 서로 다른 정식 상세 역할 8개가 필요합니다.");
  const currentUrls = roles.map((role) => currentAssetUrls[role]);
  if (currentUrls.some((url) => {
    if (!text(url)) return true;
    try { const parsed = new URL(url); return !["blob:", "https:"].includes(parsed.protocol) || Boolean(parsed.username || parsed.password); } catch { return true; }
  }) || new Set(currentUrls).size !== 8) throw new Error("현재 외부 원본 8장의 서로 다른 미리보기 매핑을 먼저 확인하세요.");
  if (!record(document) || !record(document.root) || !Array.isArray(document.content)) throw new Error("외부 Puck 문서 형식이 올바르지 않습니다.");
  let imageIndex = 0;
  const canonical = {
    ...document,
    root: { ...document.root },
    content: document.content.map((block) => {
      if (!record(block) || !record(block.props)) throw new Error("외부 Puck 블록 형식이 올바르지 않습니다.");
      const props: Record<string, unknown> = { ...block.props };
      if (block.type !== "ImageStoryBlock") {
        if (props.imageUrl !== undefined && props.imageUrl !== "") throw new Error("정식 8개 이미지 블록 밖의 이미지 URL은 가져올 수 없습니다.");
        return { ...block, props };
      }
      const role = roles[imageIndex++];
      if (!role || props.imageRole !== role) throw new Error("편집 이미지의 역할·순서가 현재 외부 자산과 다릅니다.");
      const reference = `${productDetailAssetReferencePrefix}${role}`;
      if (props.imageUrl !== currentAssetUrls[role] && props.imageUrl !== reference) throw new Error("현재 역할에 결속되지 않은 이미지 URL입니다. 임의·이전 blob/signed URL은 저장할 수 없습니다.");
      return { ...block, props: { ...props, imageUrl: reference } };
    }),
  } as ProductDetailData;
  const inspection = inspectProductDetailImageDocument(canonical);
  if (!inspection.ok) throw new Error(inspection.message);
  if (inspection.images.some((image, index) => image.role !== roles[index])) throw new Error("외부 이미지 역할·순서가 바뀌었습니다.");
  return canonical;
}

/** Local checks are usability gates only. The server owns identity, evidence and approval. */
export function parseExternalImportPackage(input: string): ExternalImportPackage {
  const value: unknown = JSON.parse(input);
  if (!record(value) || Object.keys(value).some((key) => !["source", "assets", "reviewedCopy", "audit"].includes(key))) throw new Error("패키지는 source, assets, reviewedCopy, audit만 포함해야 합니다. 상품·소유자·버전은 서버에서 읽습니다.");
  const { source, assets, reviewedCopy, audit } = value;
  if (!record(source) || source.kind !== "external_generated" || !text(source.tool) || !Array.isArray(source.referenceSha256s) || !source.referenceSha256s.length || !source.referenceSha256s.every(hash)) throw new Error("external_generated 출처·생성 도구·원본 SHA256 근거가 필요합니다.");
  if (!Array.isArray(assets) || assets.length !== 8 || assets.some((a) => !record(a) || !aiDetailAssetIds.includes(a.role as typeof aiDetailAssetIds[number]) || !text(a.alt) || a.alt.length > 180 || !text(a.caption)) || new Set(assets.map((a) => a.role)).size !== 8) throw new Error("서로 다른 상세 역할 8개와 대체텍스트·연출 설명이 필요합니다.");
  if (!record(reviewedCopy)) throw new Error("ko/ja/en 정식 검수 문안이 필요합니다.");
  for (const locale of locales) {
    const copy = reviewedCopy[locale];
    if (!record(copy) || !text(copy.reviewNote)) throw new Error(`${locale} 검수 기록이 필요합니다.`);
    const inspected = inspectProductDetailImageDocument(copy.document);
    if (!inspected.ok || inspected.images.some((image, i) => image.role !== assets[i].role)) throw new Error(`${locale} Puck 문서의 8개 역할과 순서가 이미지와 일치해야 합니다.`);
    const document = copy.document as ProductDetailData;
    if (document.content.some((block) => {
      const props = block.props as unknown as Record<string, unknown>;
      return !["ImageStoryBlock", "StoryBlock", "BenefitBlock", "CtaBlock"].includes(block.type)
        || (block.type === "ImageStoryBlock" && (!text(props.caption) || !text(props.body) || !props.body.includes(props.caption)));
    })) throw new Error(`${locale} 지원 Puck 블록과 본문에 포함된 해당 언어의 연출·한계 설명이 필요합니다.`);
  }
  if (!record(audit) || !text(audit.rightsBasis) || !text(audit.limitations) || !Array.isArray(audit.sourceReferences) || !audit.sourceReferences.length || audit.sourceReferences.some((r) => !record(r) || !text(r.label) || !hash(r.sha256) || (r.url !== undefined && (typeof r.url !== "string" || !/^https:\/\//.test(r.url))))) throw new Error("이미지 권리 근거·한계·원본 참조를 입력해 주세요.");
  return value as ExternalImportPackage;
}

export function assertExternalImportReceipt(value: unknown, context: Context, importId: string, expected: Receipt["status"], fingerprint?: string): Receipt {
  if (!record(value) || value.id !== importId || value.product_id !== context.productId || value.owner_id !== context.ownerId || value.status !== expected || !hash(value.request_sha256) || (fingerprint && value.request_sha256 !== fingerprint)) throw new Error("서버 응답의 상품·소유자·수정본·상태 결속을 확인하지 못했습니다.");
  return value as Receipt;
}

export async function prepareExternalImportRequest(context: Context, draft: ExternalImportPackage, files: Record<string, File>): Promise<ExternalDetailImportRequest> {
  const assets = await Promise.all(draft.assets.map(async (asset) => {
    const file = files[asset.role];
    if (!file || file.type !== "image/png" || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error(`${asset.role}: 10MiB 이하 PNG 원본이 필요합니다.`);
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return { ...asset, assetId: crypto.randomUUID(), originalFileName: file.name, mediaType: "image/png" as const, byteLength: file.size, sourceSha256: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("") };
  }));
  if (new Set(assets.map((a) => a.sourceSha256)).size !== 8) throw new Error("8장의 원본 바이트가 모두 달라야 합니다. 서버는 디코딩 픽셀 중복도 검사합니다.");
  return { importId: crypto.randomUUID(), productId: context.productId, expectedProductUpdatedAt: context.productUpdatedAt, expectedDetailVersion: context.detailVersion, expectedAiJobId: context.aiJobId, source: draft.source, assets, imageRightsConfirmed: true, regeneratedPreviewAcknowledged: true };
}

export async function externalImportDigest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(externalImportCanonical(value)));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
}
export function savedDetailSource(payload: Record<string, unknown>): "studio" | "external" | "unknown" {
  if (payload.externalDetailImportStatus === "unavailable") return "unknown";
  const row = payload.externalDetailImport;
  if (record(row) && row.status === "approved" && record(payload.detailPage) && row.approved_detail_version === payload.detailPage.version) return "external";
  return payload.externalDetailImportStatus === "available" || payload.externalDetailImportStatus === "not_applicable" ? "studio" : "unknown";
}
export type ExternalImportRow = Receipt & { current: boolean; expires_at: string; approved_detail_version: number | null; approved_product_updated_at: string | null; payload: Record<string, unknown> };
export type BoundExternalImport = { row: ExternalImportRow; request: ExternalDetailImportRequest; draft: ExternalImportPackage };
export async function bindExternalImportRow(input: unknown, context: Context, importId: string, fingerprint?: string): Promise<BoundExternalImport> {
  if (!record(input) || !["reserved", "verified", "approved", "cancelled"].includes(String(input.status))) throw new Error("서버 가져오기 상태를 확인하지 못했습니다.");
  assertExternalImportReceipt(input, context, importId, input.status as Receipt["status"], fingerprint);
  if (!record(input.payload) || !text(input.expires_at) || !Number.isFinite(Date.parse(input.expires_at))) throw new Error("서버 예약 본문·만료시각이 없습니다.");
  const row = input as ExternalImportRow;
  const { requestSha256, ...payload } = row.payload;
  if (requestSha256 !== row.request_sha256 || await externalImportDigest(payload) !== row.request_sha256 || payload.contract !== "sellerpilot_external_detail_import_v1" || payload.importId !== row.id || payload.productId !== context.productId || payload.ownerId !== context.ownerId || payload.actorId !== context.ownerId) throw new Error("가져오기 본문 지문·소유자 결속이 다릅니다.");
  if (!Array.isArray(payload.assets) || !record(payload.reviewedCopy) || !record(payload.audit)) throw new Error("서버 검수 본문이 없습니다.");
  const copies: Record<string, unknown> = {};
  for (const locale of locales) {
    const entry = payload.reviewedCopy[locale];
    if (!record(entry) || await externalImportDigest(entry.document) !== entry.documentSha256) throw new Error(`${locale} 문서 지문이 다릅니다.`);
    copies[locale] = { document: entry.document, reviewNote: entry.reviewNote };
  }
  const assets = payload.assets.map((asset) => {
    if (!record(asset) || !text(asset.assetId) || !hash(asset.sourceSha256) || asset.mediaType !== "image/png" || !Number.isSafeInteger(asset.byteLength) || Number(asset.byteLength) <= 0 || Number(asset.byteLength) > 10 * 1024 * 1024 || asset.storagePath !== `external-detail/${context.ownerId}/${context.productId}/${importId}/${asset.assetId}/${asset.sourceSha256}.png`) throw new Error("서버 자산의 역할·원본·저장 경로가 다릅니다.");
    const { storagePath, ...declared } = asset; void storagePath;
    return declared;
  });
  const draft = parseExternalImportPackage(JSON.stringify({ source: payload.source, assets: assets.map((a) => ({ role: a.role, alt: a.alt, caption: a.caption })), reviewedCopy: copies, audit: { rightsBasis: payload.audit.rightsBasis, limitations: payload.audit.limitations, sourceReferences: payload.audit.sourceReferences } }));
  if (new Set(assets.map((a) => a.assetId)).size !== 8 || new Set(assets.map((a) => a.sourceSha256)).size !== 8) throw new Error("서버 자산 정체가 중복됩니다.");
  const request = { importId, productId: context.productId, expectedProductUpdatedAt: payload.expectedProductUpdatedAt, expectedDetailVersion: payload.expectedDetailVersion, expectedAiJobId: payload.expectedAiJobId, source: draft.source, assets, imageRightsConfirmed: true, regeneratedPreviewAcknowledged: true } as ExternalDetailImportRequest;
  return { row, request, draft };
}
export function externalImportDraftBlock(bound: BoundExternalImport, context: Context, now = Date.now()): string | null {
  if (bound.row.status === "cancelled") return "취소된 가져오기입니다. 새 수정본이 필요합니다.";
  if (bound.row.status === "approved") return bound.row.current === true && bound.row.approved_detail_version === context.detailVersion && bound.row.approved_product_updated_at === context.productUpdatedAt ? null : "외부 승인본은 현재 상품 버전이 아닙니다.";
  if (Date.parse(bound.row.expires_at) <= now) return "예약이 만료됐습니다. 부분 바이트는 비공개로 남으며 새 수정본이 필요합니다.";
  const request = bound.request;
  return request.expectedProductUpdatedAt === context.productUpdatedAt && request.expectedDetailVersion === context.detailVersion && request.expectedAiJobId === context.aiJobId ? null : "상품·AI 작업·상세 버전이 변경됐습니다. 기존 수정본으로 승인할 수 없습니다.";
}
export async function bindExternalImportSignedView(bound: BoundExternalImport, context: Context, payload: Record<string, unknown>) {
  if (bound.row.status !== "approved" || externalImportDraftBlock(bound, context)) throw new Error("현재 외부 승인본이 아닙니다.");
  const view = payload.externalDetailImport;
  if (!record(view) || view.current !== true || view.id !== bound.row.id || view.request_sha256 !== bound.row.request_sha256 || view.approved_detail_version !== context.detailVersion || !record(view.manifest) || !Array.isArray(view.signedImages) || view.signedImages.length !== 8 || !record(payload.detailPage) || payload.detailPage.version !== context.detailVersion) throw new Error("승인 후 GET 문서·버전이 달라졌습니다. 성공으로 표시하지 않습니다.");
  const manifest = view.manifest;
  if (manifest.contract !== "sellerpilot_external_detail_manifest_v1" || manifest.source !== "external_generated" || manifest.importId !== bound.row.id || manifest.requestSha256 !== bound.row.request_sha256 || manifest.version !== context.detailVersion || !record(manifest.reviewedCopy)) throw new Error("외부 승인 manifest 결속이 다릅니다.");
  for (const locale of locales) {
    const copy = manifest.reviewedCopy[locale];
    if (!record(copy) || await externalImportDigest(copy.document) !== await externalImportDigest(bound.draft.reviewedCopy[locale].document)) throw new Error(`${locale} 승인 후 문서가 변경됐습니다.`);
  }
  if (await externalImportDigest(payload.detailPage.data) !== await externalImportDigest(bound.draft.reviewedCopy.ko.document)) throw new Error("저장된 한국어 본문이 승인 문서와 다릅니다.");
  const urls: Record<string, string> = {};
  for (let i = 0; i < bound.request.assets.length; i++) {
    const asset = bound.request.assets[i]; const signed = view.signedImages[i];
    const expectedPath = `external-detail/${context.ownerId}/${context.productId}/${bound.row.id}/${asset.assetId}/${asset.sourceSha256}.png`;
    if (!record(signed) || signed.assetId !== asset.assetId || signed.role !== asset.role || signed.sourceSha256 !== asset.sourceSha256 || signed.path !== expectedPath || !text(signed.url) || !signed.url.startsWith("https://")) throw new Error("읽기 전용 이미지의 역할·경로·원본 지문이 다릅니다.");
    urls[asset.role] = signed.url;
  }
  // Temporary signed URLs are access locations, never the document/image identity.
  return { urls, identity: `${bound.row.id}:${bound.row.request_sha256}:${context.detailVersion}` };
}

export function ProductDetailAssetImport({ productId, currentVersion, authenticatedFetch, onImported }: {
  productId: string; currentVersion: number; authenticatedFetch: Fetcher; onImported: () => Promise<unknown>;
}) {
  const [raw, setRaw] = useState("");
  const [draft, setDraft] = useState<ExternalImportPackage | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [request, setRequest] = useState<ExternalDetailImportRequest | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [approved, setApproved] = useState(false);
  const [editing, setEditing] = useState<Locale | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [resumeId, setResumeId] = useState("");
  const [bound, setBound] = useState<BoundExternalImport | null>(null);
  const [remoteIdentity, setRemoteIdentity] = useState("");
  const inFlight = useRef(false);
  const objectUrls = useRef<Record<string, string>>({});
  useEffect(() => () => { Object.values(objectUrls.current).forEach((url) => URL.revokeObjectURL(url)); }, []);
  const endpoint = `/api/admin/products/${encodeURIComponent(productId)}/detail-assets/import`;
  const changed = () => { setChecks({}); setApproved(false); if (!receipt) setRequest(null); };
  const locked = busy || !!receipt;
  const stateBlock = bound && context ? externalImportDraftBlock(bound, context) : null;
  const stale = (!!context && !remoteIdentity && context.detailVersion !== currentVersion) || !!stateBlock;
  const allChecked = ["facts", "rights", "limits", ...locales].every((key) => checks[key]);
  const ready = !editing && !!draft && !!context && !stale && allChecked && draft.assets.every((asset) => files[asset.role] && loaded[asset.role]);
  const run = async (task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : "가져오기를 완료하지 못했습니다."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const call = async (body?: unknown, query = "", bytes?: File) => {
    const response = await authenticatedFetch(endpoint + query, bytes ? { method: "PUT", headers: { "Content-Type": "image/png" }, body: bytes } : body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) { if (response.status === 409) { setChecks({}); setApproved(false); } throw new Error(`가져오기 요청 실패 (${response.status}). ${record(value) && text(value.code) ? value.code : "서버 응답을 확인해 주세요."} 재시도 전 현재 버전과 업로드 상태를 확인하세요.`); }
    if (!record(value)) throw new Error("가져오기 응답 형식을 확인하지 못했습니다.");
    return value;
  };
  const readContext = async () => {
    const value = await call();
    if (value.productId !== productId || !text(value.ownerId) || !text(value.productUpdatedAt) || !Number.isSafeInteger(value.detailVersion) || Number(value.detailVersion) < 0 || !(value.aiJobId === null || text(value.aiJobId))) throw new Error("현재 상품·소유자·버전 정보를 확인하지 못했습니다.");
    return value as Context & Record<string, unknown>;
  };
  const remember = (id: string, owner: string) => { try { sessionStorage.setItem(`detail-import:${productId}:${owner}`, id); } catch { /* Manual ID entry remains available. */ } };
  const rebind = async (id: string, fingerprint?: string) => {
    setRemoteIdentity(""); setUrls({}); setLoaded({}); setChecks({}); setApproved(false);
    const current = await readContext();
    const value = await call(undefined, `?importId=${encodeURIComponent(id)}`);
    const next = await bindExternalImportRow(value.import, current, id, fingerprint);
    setContext(current); setBound(next); setRequest(next.request); setReceipt(next.row); setDraft(next.draft); setRaw(JSON.stringify(next.draft, null, 2)); setFiles({}); setResumeId(id); remember(id, current.ownerId);
    const blocked = externalImportDraftBlock(next, current);
    if (blocked) { setMessage(blocked); return next; }
    if (next.row.status === "approved") {
      const response = await authenticatedFetch(`/api/admin/products/${encodeURIComponent(productId)}/publish-context`, { cache: "no-store" });
      const publication: unknown = await response.json().catch(() => null);
      if (!response.ok || !record(publication)) throw new Error("승인본의 읽기 전용 이미지 GET을 확인하지 못했습니다.");
      const signed = await bindExternalImportSignedView(next, current, publication);
      setUrls(signed.urls); setRemoteIdentity(signed.identity);
      setMessage(`external_generated 서버 승인본 재결속 확인 · 버전 ${current.detailVersion} · 채널 게시 승인은 별도입니다.`);
    } else setMessage(`${next.row.status} 예약을 복원했습니다. 동일 원본 8장을 다시 선택·검수하세요. 이미 올라간 동일 바이트는 안전하게 재시도합니다.`);
    return next;
  };
  const loadContext = () => run(async () => {
    setRemoteIdentity(""); setChecks({}); setApproved(false);
    const current = await readContext(); setContext(current);
    let remembered = "";
    try { remembered = sessionStorage.getItem(`detail-import:${productId}:${current.ownerId}`) ?? ""; } catch { /* Optional pointer only. */ }
    const id = resumeId.trim() || remembered || (record(current.externalDetailImport) && text(current.externalDetailImport.id) ? current.externalDetailImport.id : "");
    if (id) { await rebind(id); return; }
    setBound(null); setReceipt(null); setRequest(null);
    setMessage("서버 상품 버전을 읽었습니다. 새 패키지 또는 재개할 import ID를 선택하세요.");
  });
  const uploadAndVerify = () => run(async () => {
    if (!ready || !draft || !context) throw new Error("현재 버전과 8장·3언어 검수를 먼저 확인하세요.");
    if (bound && externalImportDraftBlock(bound, context)) throw new Error(externalImportDraftBlock(bound, context)!);
    const next = request ?? await prepareExternalImportRequest(context, draft, files);
    const selected = await prepareExternalImportRequest(context, draft, files);
    if (next.assets.some((asset, index) => asset.sourceSha256 !== selected.assets[index].sourceSha256 || asset.byteLength !== selected.assets[index].byteLength)) throw new Error("재개 파일이 예약된 원본 SHA256·크기와 다릅니다. 새 수정본으로 가져오세요.");
    setRequest(next); setResumeId(next.importId); remember(next.importId, context.ownerId);
    const reserved = await call({ action: "reserve", request: next, reviewedCopy: draft.reviewedCopy, audit: draft.audit });
    const verifiedRow = await bindExternalImportRow(reserved.import, context, next.importId, receipt?.request_sha256);
    if (externalImportDraftBlock(verifiedRow, context)) throw new Error(externalImportDraftBlock(verifiedRow, context)!);
    if (!["reserved", "verified"].includes(verifiedRow.row.status)) throw new Error("업로드 재개 가능한 상태가 아닙니다. 서버 상태를 다시 읽으세요.");
    const reservation = verifiedRow.row;
    setReceipt(reservation); setBound(verifiedRow);
    for (const asset of next.assets) { setMessage(`${asset.role} 원본 업로드 중`); await call(undefined, `?importId=${next.importId}&assetId=${asset.assetId}`, files[asset.role]); }
    const verified = await call({ action: "verify", importId: next.importId });
    const checked = await bindExternalImportRow(verified.import, context, next.importId, reservation.request_sha256);
    assertExternalImportReceipt(checked.row, context, next.importId, "verified", reservation.request_sha256);
    setReceipt(checked.row); setBound(checked);
    setApproved(false); setMessage("서버 바이트 검증 완료. 아래 별도 승인을 눌러야 정식 외부 가져오기가 반영됩니다. 아직 게시 승인이 아닙니다.");
  });
  const approve = () => run(async () => {
    if (!request || !context || receipt?.status !== "verified" || !approved || !ready) throw new Error("검증된 수정본과 명시적 승인 확인이 필요합니다.");
    if (!bound || externalImportDraftBlock(bound, context) || !draft) throw new Error("만료·버전 상태를 다시 확인하세요.");
    const reviewedFiles = await prepareExternalImportRequest(context, draft, files);
    if (request.assets.some((asset, index) => asset.sourceSha256 !== reviewedFiles.assets[index].sourceSha256 || asset.byteLength !== reviewedFiles.assets[index].byteLength)) throw new Error("미리보기 파일이 검증된 원본과 다릅니다. 동일 원본을 다시 선택하거나 새 수정본으로 검수하세요.");
    const response = await call({ action: "approve", importId: request.importId, requestSha256: receipt.request_sha256, reviewConfirmed: true });
    assertExternalImportReceipt(response.import, context, request.importId, "approved", receipt.request_sha256);
    const confirmed = await rebind(request.importId, receipt.request_sha256);
    if (confirmed.row.status !== "approved" || confirmed.row.current !== true) throw new Error("승인 후 GET에서 현재 승인본을 확인하지 못했습니다.");
    await onImported();
  });
  const cancel = () => run(async () => {
    if (request && context) { const response = await call({ action: "cancel", importId: request.importId }); assertExternalImportReceipt(response.import, context, request.importId, "cancelled", receipt?.request_sha256); }
    setRequest(null); setReceipt(null); setBound(null); setRemoteIdentity(""); setContext(null); changed(); setMessage("현재 가져오기를 닫았습니다. 부분 업로드 바이트는 서버의 비공개 보관 정책을 따릅니다. 새 버전을 다시 읽어 주세요.");
  });
  return <section className="panel" aria-label="외부 상세 이미지와 정식 검수 문안 가져오기" data-source-kind="external_generated">
    <h3>외부 생성 8컷 + 정식 검수 문안 가져오기</h3>
    <p><b>external_generated</b> · AI Studio 생성 성공이 아닙니다. 원본 사실·이미지 권리·연출 소품 및 패키지 차이에 대해 검수 주체와 근거를 명시한 검수·별도 승인이 필요합니다. 기존 Studio 원본과 채널 게시 조건은 보존됩니다.</p>
    <label>재개할 import ID (비우면 저장된 예약 또는 현재 승인본)<input value={resumeId} disabled={busy} onChange={(event) => setResumeId(event.target.value)} /></label>
    <button type="button" disabled={busy} onClick={loadContext}>현재 상품·소유자·버전 읽기 · 예약/승인본 재로딩</button>
    {receipt ? <p>import {receipt.id} · {receipt.status} · 만료 {bound?.row.expires_at ?? "조회 필요"} · 지문 {receipt.request_sha256}</p> : null}
    {stateBlock ? <p role="alert">{stateBlock}</p> : null}
    {remoteIdentity ? <p data-external-identity={remoteIdentity}>현재 외부 승인본 · URL은 읽기 위치일 뿐 정체가 아닙니다. 이미지 {Object.values(loaded).filter(Boolean).length}/8 로드 · AI Studio 품질·게시 guard는 별도 보존</p> : null}
    {context ? <p>상품 {context.productId} · 소유자 {context.ownerId} · 상세 버전 {context.detailVersion} · 수정시각 {context.productUpdatedAt}</p> : null}
    {stale && receipt?.status !== "approved" ? <p role="alert">현재 상세 버전이 달라졌습니다. 이 수정본으로는 승인할 수 없습니다.</p> : null}
    <label>정식 검수 패키지 JSON (source, assets[8], reviewedCopy.ko/ja/en, audit)
      <textarea rows={8} value={raw} disabled={locked} onChange={(event) => { setRaw(event.target.value); setDraft(null); changed(); }} />
    </label>
    <p>각 문서는 Puck document와 reviewNote를 포함해야 합니다. source.kind는 external_generated이며 권리 근거·한계·원본 SHA256 참조가 필요합니다. 임의 소유자·상품·버전 필드는 받지 않습니다.</p>
    <button type="button" disabled={locked || !raw} onClick={() => { try { setDraft(parseExternalImportPackage(raw)); setMessage("패키지 형식 확인. 아래 실제 파일·문안 검수는 아직 필요합니다."); changed(); } catch (error) { setDraft(null); setMessage(error instanceof Error ? error.message : "JSON 형식 오류"); } }}>패키지 검수 화면 열기</button>
    {draft ? <>
      <p>권리 근거: {draft.audit.rightsBasis}</p><p>연출·사실 한계: {draft.audit.limitations}</p>
      <ul>{draft.audit.sourceReferences.map((reference, index) => <li key={index}>{reference.label} · {reference.sha256} {reference.url ?? ""}</li>)}</ul>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {draft.assets.map((asset) => <fieldset key={asset.role} disabled={busy || receipt?.status === "approved" || receipt?.status === "cancelled" || !!stateBlock}>
          <legend>{asset.role}</legend><p>{asset.alt}</p><p>{asset.caption}</p>
          <input type="file" accept="image/png" aria-label={`${asset.role} PNG 원본`} onChange={(event) => {
            const file = event.target.files?.[0]; if (!file) return;
            if (objectUrls.current[asset.role]) URL.revokeObjectURL(objectUrls.current[asset.role]);
            const url = URL.createObjectURL(file); objectUrls.current[asset.role] = url;
            setFiles((previous) => ({ ...previous, [asset.role]: file })); setUrls((previous) => ({ ...previous, [asset.role]: url }));
            setLoaded((previous) => ({ ...previous, [asset.role]: false })); changed();
          }} />
          {/* Local blob URLs must not be sent to an image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {urls[asset.role] ? <img src={urls[asset.role]} alt={asset.alt} style={{ width: "100%", maxHeight: 260, objectFit: "contain" }} onLoad={() => setLoaded((previous) => ({ ...previous, [asset.role]: true }))} onError={() => { setLoaded((previous) => ({ ...previous, [asset.role]: false })); changed(); }} /> : <p>미선택</p>}
          <small>{loaded[asset.role] ? remoteIdentity ? "승인된 원본의 읽기 전용 이미지 로드 확인" : "로컬 미리보기 로드 확인 · 서버 검증/재검수 필요" : "미리보기 확인 필요"}</small>
        </fieldset>)}
      </div>
      {locales.map((locale) => <details key={locale} open><summary>{locale} 정식 본문 검수</summary>
        <p>{draft.reviewedCopy[locale].reviewNote}</p>
        <ul>{draft.reviewedCopy[locale].document.content.filter((block) => block.type === "ImageStoryBlock").map((block) => <li key={block.props.id}>{String((block.props as unknown as Record<string, unknown>).caption)}</li>)}</ul>
        <Preview result={null} imageUrl="" assetUrls={urls} data={draft.reviewedCopy[locale].document} locale={locale} />
        <button type="button" disabled={locked || draft.assets.some((asset) => !urls[asset.role] || !loaded[asset.role])} onClick={() => setEditing(locale)}>{locale} Puck 문안 수정</button>
        <label><input type="checkbox" disabled={busy || receipt?.status === "approved" || !!stateBlock} checked={!!checks[locale]} onChange={(event) => setChecks((previous) => ({ ...previous, [locale]: event.target.checked }))} />{locale} 본문·수치·단위·연출 설명을 읽고 정식 문안으로 검수했습니다.</label>
      </details>)}
      {([["facts", "원본 제품의 사실·수치·구성 및 번역 일치를 확인했습니다."], ["rights", "원본·생성 이미지와 문안의 사용 권리 및 위 근거를 확인했습니다."], ["limits", "재생성 이미지이며 소품 제외·포장 차이·과장 가능성과 위 한계를 확인했습니다."]] as const).map(([key, label]) => <label key={key} style={{ display: "block" }}><input type="checkbox" disabled={busy || receipt?.status === "approved" || !!stateBlock} checked={!!checks[key]} onChange={(event) => setChecks((previous) => ({ ...previous, [key]: event.target.checked }))} />{label}</label>)}
      <button type="button" disabled={busy || !ready || receipt?.status === "verified" || receipt?.status === "approved"} onClick={uploadAndVerify}>원본 8장 업로드·서버 검증{request ? " 재시도" : ""}</button>
    </> : null}
    {receipt?.status === "verified" ? <div><p>검증 지문 {receipt.request_sha256} · 문안/파일 수정 시 새 가져오기 필요</p><label><input type="checkbox" disabled={busy || stale} checked={approved} onChange={(event) => setApproved(event.target.checked)} />이 정확한 수정본의 8장과 ko/ja/en 문안을 외부 생성 결과로 명시적으로 승인합니다. 채널 게시 승인은 아닙니다.</label><button type="button" disabled={busy || !approved || !ready} onClick={approve}>검증된 외부 가져오기 명시적 승인</button></div> : null}
    {request && !receipt ? <button type="button" disabled={busy} onClick={() => { setRequest(null); changed(); setMessage("응답 미확인 요청을 로컬에서 초기화했습니다. 서버 예약 취소를 확인한 것은 아닙니다. 미승인 부분 자료는 비공개로 남을 수 있습니다."); }}>응답 미확인 수정본 초기화</button> : null}
    {request && receipt?.status !== "approved" ? <button type="button" disabled={busy} onClick={cancel}>예약 취소 후 수정</button> : null}
    {receipt ? <button type="button" disabled={busy} onClick={() => { if (context) { try { sessionStorage.removeItem(`detail-import:${productId}:${context.ownerId}`); } catch { /* optional pointer */ } } setResumeId(""); setRequest(null); setReceipt(null); setBound(null); setRemoteIdentity(""); setFiles({}); setUrls({}); setLoaded({}); setChecks({}); setApproved(false); setMessage("새 수정본 검수 시작. 기존 예약을 취소하거나 승인 자료를 변경한 것은 아닙니다. 현재 버전과 파일을 다시 검수하세요."); }}>새 외부 수정본 검수 시작</button> : null}
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
    {editing && draft ? <Editor result={null} imageUrl="" assetUrls={urls} data={draft.reviewedCopy[editing].document} locale={editing} onClose={() => setEditing(null)} onSave={(document) => {
      try {
        const next = { ...draft, reviewedCopy: { ...draft.reviewedCopy, [editing]: { ...draft.reviewedCopy[editing], document: makeExternalImportDocumentCanonical(document, draft.assets, urls) } } };
        const normalized = parseExternalImportPackage(JSON.stringify(next)); setDraft(normalized); setRaw(JSON.stringify(normalized, null, 2)); setEditing(null); changed(); } catch (error) { setMessage(error instanceof Error ? error.message : "문서 검증 실패"); }
    }} /> : null}
  </section>;
}
