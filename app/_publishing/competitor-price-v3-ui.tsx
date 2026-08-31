"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, ExternalLink, LoaderCircle, Package, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { channels } from "../channel-config";
import type { OperationMarginScenario } from "../use-operations-snapshot";
import { activeChannelKeys } from "../../lib/channels/catalog";
import {
  COMPETITOR_MATCHER_VERSION,
  competitorLowestPriceEligibility,
  deduplicateCompetitorObservations,
  lowestEligibleCompetitorPrice,
  type CompetitorMatchEvidence,
  type CompetitorPriceComponent,
  type CompetitorPriceObservationV3Fields,
} from "../../lib/competitor-price-model";
import {
  competitorMarketplaceProviderState,
  type CompetitorMarketplaceId,
  type CompetitorProviderDisplayStatus,
  type CompetitorProviderId,
} from "../../lib/competitor-provider-snapshot";
import { latestProductMarginScenario } from "../../lib/product-margin-loss-warning";
import { createClient as createSupabaseClient } from "../../lib/supabase/client";
import { competitorResearchEmptySlot, type CompetitorResearchUiState } from "./competitor-research-polling";

type CompetitorReviewDecision = "confirmed_exact" | "rejected" | "revoked";
type CompetitorReviewReason =
  | "source_opened"
  | "brand_model_match"
  | "gtin_mpn_match"
  | "quantity_pack_match"
  | "variant_condition_match"
  | "not_accessory_refill"
  | "identity_mismatch"
  | "insufficient_identity"
  | "review_withdrawn";

export type CompetitorHumanReview = {
  id: string;
  decision: CompetitorReviewDecision;
  reasonCodes: CompetitorReviewReason[];
  note: string;
  sourceObservationFingerprint: string;
  sourceCheckedAt: string;
  sourceCurrent: boolean;
  createdAt: string;
};

type CompetitorHumanReviewReadback = Omit<CompetitorHumanReview, "sourceCurrent"> & {
  sourceCurrent?: boolean;
  latestForSource: boolean;
};

export type CompetitorHumanReviewOverride = {
  review: CompetitorHumanReview;
  baseLatestReviewId: string | null;
};

export function competitorHumanReviewOverrideAfterSave(
  review: CompetitorHumanReview,
  currentOverride: CompetitorHumanReviewOverride | undefined,
  targetLatestReviewId: string | null,
): CompetitorHumanReviewOverride {
  return {
    review,
    baseLatestReviewId: currentOverride
      ? currentOverride.baseLatestReviewId
      : targetLatestReviewId,
  };
}

export type CompetitorDisplayItem = {
  id: string;
  externalId?: string;
  marketplace?: string;
  title: string;
  url: string;
  imageUrl: string | null;
  mallName: string;
  price: number;
  currency: string;
  checkedAt?: string;
  provider?: CompetitorProviderId | "manual" | null;
  preserved?: boolean;
  observationId?: string;
  observationFingerprint?: string;
  sourceProvider?: CompetitorProviderId;
  automatedMatchTier?: "exact" | "probable" | "rejected";
  effectiveMatchTier?: "exact" | "probable" | "rejected";
  latestHumanReview?: CompetitorHumanReview | null;
} & Partial<CompetitorPriceObservationV3Fields>;

export type CompetitorResearchItem = CompetitorDisplayItem & {
  provider: CompetitorProviderId;
  marketplace: CompetitorMarketplaceId;
  externalId: string;
  verifiedSameProduct: boolean;
};

export function competitorDisplayItemWithReviewOverride<T extends CompetitorDisplayItem>(
  item: T,
  override?: CompetitorHumanReviewOverride,
): T {
  if (!competitorHumanReviewOverrideApplies(item, override)) return item;
  const review = override.review;
  const effectiveMatchTier = review.decision === "confirmed_exact"
    ? "exact"
    : review.decision === "rejected"
      ? "rejected"
      : item.automatedMatchTier ?? item.matchTier;
  return {
    ...item,
    matchTier: effectiveMatchTier,
    effectiveMatchTier,
    latestHumanReview: review,
  };
}

export function competitorHumanReviewOverrideApplies(
  item: CompetitorDisplayItem,
  override?: CompetitorHumanReviewOverride,
): override is CompetitorHumanReviewOverride {
  if (!override
    || override.review.sourceObservationFingerprint !== item.observationFingerprint) return false;
  const serverLatestReviewId = item.latestHumanReview?.id ?? null;
  if (serverLatestReviewId !== override.baseLatestReviewId
    && serverLatestReviewId !== override.review.id) return false;
  return true;
}

type CompetitorV3DisplayItem = CompetitorDisplayItem & CompetitorPriceObservationV3Fields & {
  provider: CompetitorProviderId;
  marketplace: CompetitorMarketplaceId;
  externalId: string;
};

const componentLabels: Array<[keyof CompetitorPriceObservationV3Fields["priceComponents"], string]> = [
  ["itemPrice", "상품가"],
  ["requiredOptionSurcharge", "필수 옵션"],
  ["shipping", "필수 배송비"],
  ["taxAndDuty", "세금·관세"],
  ["discount", "확정 할인"],
];

const eligibilityLabels = {
  match_not_exact: "exact 판정 아님",
  not_in_stock: "재고 확인 불가",
  snapshot_time_unknown: "수집시각 확인 불가",
  snapshot_stale: "최신성 만료",
  total_purchase_price_unavailable: "총구매가 계산 불가",
  krw_conversion_unavailable: "KRW 환산 불가",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasCurrentHumanReview(item: CompetitorDisplayItem) {
  return Boolean(
    item.latestHumanReview?.sourceCurrent
    && item.observationFingerprint
    && item.latestHumanReview.sourceObservationFingerprint === item.observationFingerprint,
  );
}

function withEffectiveMatchTier<T extends CompetitorDisplayItem>(item: T): T {
  if (!hasCurrentHumanReview(item)) return item;
  const tier = item.latestHumanReview?.decision === "confirmed_exact"
    ? "exact"
    : item.latestHumanReview?.decision === "rejected"
      ? "rejected"
      : item.automatedMatchTier ?? item.matchTier;
  if (!tier || tier === item.matchTier) return item;
  return { ...item, matchTier: tier };
}

function isV3Observation(item: CompetitorDisplayItem): item is CompetitorV3DisplayItem {
  const components = item.priceComponents;
  return item.matcherVersion === COMPETITOR_MATCHER_VERSION
    && item.provider !== undefined
    && item.provider !== null
    && item.provider !== "manual"
    && typeof item.marketplace === "string"
    && typeof item.externalId === "string"
    && item.externalId.length > 0
    && (item.matchTier === "exact" || item.matchTier === "probable" || item.matchTier === "rejected")
    && typeof item.matchScore === "number"
    && Number.isFinite(item.matchScore)
    && Array.isArray(item.matchEvidence)
    && Array.isArray(item.mismatchEvidence)
    && (item.inventoryStatus === "in_stock" || item.inventoryStatus === "out_of_stock" || item.inventoryStatus === "unknown")
    && typeof item.observedAt === "string"
    && isRecord(components)
    && componentLabels.every(([key]) => isRecord(components[key]))
    && (item.totalPurchasePrice === null || isRecord(item.totalPurchasePrice));
}

export function deduplicatedV3CompetitorDisplayItems(items: readonly CompetitorDisplayItem[]) {
  return deduplicateCompetitorObservations(items.map(withEffectiveMatchTier).filter(isV3Observation));
}

export function isEligibleCompetitorObservation<T extends CompetitorDisplayItem>(item: T): item is T & CompetitorPriceObservationV3Fields {
  const effective = withEffectiveMatchTier(item);
  return isV3Observation(effective) && competitorLowestPriceEligibility(effective).eligible;
}

function formatMoney(amount: number | null | undefined, currency: string) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "unknown";
  try {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: currency || "KRW",
      maximumFractionDigits: currency === "KRW" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${currency || "통화 미확인"}`;
  }
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "시각 미확인";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function evidenceText(evidence: CompetitorMatchEvidence) {
  const comparison = evidence.expected || evidence.actual
    ? ` · 기준 ${evidence.expected || "미확인"} / 관측 ${evidence.actual || "미확인"}`
    : "";
  return `${evidence.attribute}${comparison}`;
}

function ComponentPrice({ component, discount = false }: { component: CompetitorPriceComponent; discount?: boolean }) {
  if (component.status === "unknown") return <dd><b>unknown</b><small>0원으로 간주하지 않음</small></dd>;
  const prefix = discount ? "− " : "";
  return <dd><b>{prefix}{formatMoney(component.amount, component.currency)}</b><small>{component.krwAmount === null ? "KRW 환산 미확인" : `${prefix}${formatMoney(component.krwAmount, "KRW")}`}</small></dd>;
}

function ObservationCard({
  item,
  review = false,
  onReview,
}: {
  item: CompetitorV3DisplayItem;
  review?: boolean;
  onReview?: (item: CompetitorV3DisplayItem) => void;
}) {
  const eligibility = competitorLowestPriceEligibility(item);
  const evidence = [...item.matchEvidence, ...item.mismatchEvidence].slice(0, 4);
  const currentReview = hasCurrentHumanReview(item) ? item.latestHumanReview : null;
  const automatedTier = item.automatedMatchTier ?? item.matchTier;
  const tierLabel = currentReview?.decision === "confirmed_exact"
    ? `자동 ${automatedTier} · 사람 exact 승인`
    : currentReview?.decision === "rejected"
      ? `자동 ${automatedTier} · 사람 제외`
      : currentReview?.decision === "revoked"
        ? `자동 ${automatedTier} · 검토 철회`
        : item.matchTier === "exact"
          ? "exact · 자동 확정"
          : item.matchTier === "probable"
            ? "probable · 사람 확인"
            : "rejected · 자동 제외";
  return <article className={`competitor-observation-card ${item.matchTier}`}>
    <header>
      <span>{item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="80px" unoptimized /> : <Package size={18} />}</span>
      <div><small>{item.mallName || item.marketplace || "판매처"}{item.provider ? ` · ${item.provider}` : ""}</small><b>{item.title}</b><em>{tierLabel} · {Math.round(item.matchScore)}점</em></div>
      <a href={item.url} target="_blank" rel="noreferrer" aria-label={`${item.title} 원본 링크`}><ExternalLink size={14} /></a>
    </header>
    <div className="competitor-total-price">
      <small>{review ? "검토 후보 총구매가" : "총구매가"}</small>
      {item.totalPurchasePrice
        ? <><strong>{formatMoney(item.totalPurchasePrice.amount, item.totalPurchasePrice.currency)}</strong><em>KRW 환산 {formatMoney(item.totalPurchasePrice.krwAmount, "KRW")}</em></>
        : <><strong>계산 불가</strong><em>unknown 구성요소가 있어 합산하지 않음</em></>}
    </div>
    <dl className="competitor-price-components">
      {componentLabels.map(([key, label]) => <div key={key}><dt>{label}</dt><ComponentPrice component={item.priceComponents[key]} discount={key === "discount"} /></div>)}
    </dl>
    <div className="competitor-price-provenance">
      <span><b>원 통화·환율</b><small>{item.exchangeRate ? `${item.exchangeRate.fromCurrency} 1 = KRW ${item.exchangeRate.rate.toLocaleString("ko-KR", { maximumFractionDigits: 6 })} · ${item.exchangeRate.provider} · ${formatTimestamp(item.exchangeRate.quotedAt)}` : item.currency === "KRW" ? "KRW 원값 · 환산 불필요" : "환율 provenance 미확인"}</small></span>
      <span><b>단위가격</b><small>{item.unitPrice ? `${formatMoney(item.unitPrice.amount, item.unitPrice.currency)} · KRW ${formatMoney(item.unitPrice.krwAmount, "KRW")} / ${item.unitPrice.quantity.value.toLocaleString("ko-KR")} ${item.unitPrice.quantity.unit}` : "확인된 용량·팩 수량 없음"}</small></span>
    </div>
    <div className="competitor-match-evidence"><b>동일상품 판정 근거</b>{evidence.length > 0 ? <ul>{evidence.map((entry, index) => <li className={item.mismatchEvidence.includes(entry) ? "mismatch" : "match"} key={`${entry.code}-${index}`}>{evidenceText(entry)}</li>)}</ul> : <small>저장된 판정 근거 없음</small>}</div>
    <footer><span>수집 {formatTimestamp(item.observedAt)} · {item.inventoryStatus === "in_stock" ? "재고 있음" : item.inventoryStatus === "out_of_stock" ? "품절" : "재고 미확인"} · 외부 ID {item.externalId || item.id} · provenance {item.provenance.length}건</span>{currentReview && <strong>사람 검토 {formatTimestamp(currentReview.createdAt)} · 원본 fingerprint 일치</strong>}{!eligibility.eligible && <em>{eligibility.reasons.map((reason) => eligibilityLabels[reason]).join(" · ")}</em>}{onReview && <button className="competitor-review-open" type="button" onClick={() => onReview(item)}>{currentReview && currentReview.decision !== "revoked" ? "검토 결과 철회" : "동일상품 사람 검토"}</button>}</footer>
  </article>;
}

const reviewReasonLabels: Record<CompetitorReviewReason, string> = {
  source_opened: "원본 상품 페이지를 직접 열어 확인함",
  brand_model_match: "브랜드와 모델명이 모두 일치함",
  gtin_mpn_match: "GTIN 또는 제조사 품번이 일치함",
  quantity_pack_match: "용량·수량·팩 구성이 일치함",
  variant_condition_match: "옵션·색상·상태가 일치함",
  not_accessory_refill: "액세서리·리필·호환품이 아님",
  identity_mismatch: "브랜드·모델·규격 등 상품 식별정보가 다름",
  insufficient_identity: "원본에 동일상품을 확정할 식별정보가 부족함",
  review_withdrawn: "이전 사람 검토 결정을 철회함",
};

const confirmReviewReasons: CompetitorReviewReason[] = [
  "source_opened",
  "brand_model_match",
  "gtin_mpn_match",
  "quantity_pack_match",
  "variant_condition_match",
  "not_accessory_refill",
];
const rejectReviewReasons: CompetitorReviewReason[] = ["source_opened", "identity_mismatch", "insufficient_identity"];

function isPersistedReviewCandidate(item: CompetitorV3DisplayItem, compact: boolean, productId?: string) {
  return !compact
    && Boolean(productId)
    && item.automatedMatchTier === "probable"
    && typeof item.observationId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(item.observationId)
    && typeof item.observationFingerprint === "string"
    && /^[0-9a-f]{64}$/u.test(item.observationFingerprint)
    && typeof item.checkedAt === "string"
    && Number.isFinite(Date.parse(item.checkedAt));
}

function reviewReasonsComplete(decision: CompetitorReviewDecision, reasons: ReadonlySet<CompetitorReviewReason>) {
  if (decision === "revoked") return reasons.size === 1 && reasons.has("review_withdrawn");
  if (decision === "rejected") return reasons.has("source_opened")
    && (reasons.has("identity_mismatch") || reasons.has("insufficient_identity"));
  return reasons.has("source_opened")
    && (reasons.has("brand_model_match") || reasons.has("gtin_mpn_match"))
    && reasons.has("quantity_pack_match")
    && reasons.has("variant_condition_match")
    && reasons.has("not_accessory_refill");
}

function reviewReasonCodesMatchDecision(
  decision: CompetitorReviewDecision,
  reasonCodes: CompetitorReviewReason[],
) {
  const reasons = new Set(reasonCodes);
  const allowed = decision === "revoked" ? ["review_withdrawn"]
    : decision === "rejected" ? rejectReviewReasons : confirmReviewReasons;
  return reasons.size === reasonCodes.length
    && reasonCodes.every((reason) => allowed.includes(reason))
    && reviewReasonsComplete(decision, reasons);
}

function isHumanReview(value: unknown): value is CompetitorHumanReviewReadback {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.id)
    && (value.decision === "confirmed_exact" || value.decision === "rejected" || value.decision === "revoked")
    && Array.isArray(value.reasonCodes)
    && value.reasonCodes.every((reason) => typeof reason === "string" && Object.hasOwn(reviewReasonLabels, reason))
    && reviewReasonCodesMatchDecision(value.decision, value.reasonCodes as CompetitorReviewReason[])
    && typeof value.note === "string"
    && typeof value.sourceObservationFingerprint === "string"
    && /^[0-9a-f]{64}$/u.test(value.sourceObservationFingerprint)
    && typeof value.sourceCheckedAt === "string"
    && Number.isFinite(Date.parse(value.sourceCheckedAt))
    && (value.sourceCurrent === undefined || typeof value.sourceCurrent === "boolean")
    && typeof value.latestForSource === "boolean"
    && typeof value.createdAt === "string"
    && Number.isFinite(Date.parse(value.createdAt));
}

function CompetitorReviewDialog({
  item,
  onClose,
  onSaved,
}: {
  item: CompetitorV3DisplayItem;
  onClose: () => void;
  onSaved: (review: CompetitorHumanReview) => void;
}) {
  const existing = hasCurrentHumanReview(item) && item.latestHumanReview?.decision !== "revoked"
    ? item.latestHumanReview
    : null;
  const exactApprovalAllowed = item.mismatchEvidence.length === 0;
  const [decision, setDecision] = useState<CompetitorReviewDecision>(existing ? "revoked" : exactApprovalAllowed ? "confirmed_exact" : "rejected");
  const [reasons, setReasons] = useState<Set<CompetitorReviewReason>>(
    () => new Set(existing ? ["review_withdrawn"] : []),
  );
  const [note, setNote] = useState(existing ? "기존 사람 검토 결정을 철회합니다." : "");
  const [sourceLinkOpened, setSourceLinkOpened] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("button, a, input, textarea")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled)")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus();
    };
  }, [onClose, submitting]);

  const visibleReasons = decision === "revoked" ? ["review_withdrawn"] as CompetitorReviewReason[]
    : decision === "confirmed_exact" ? confirmReviewReasons : rejectReviewReasons;
  const canSubmit = !submitting && note.trim().length >= 5 && reviewReasonsComplete(decision, reasons);

  const changeDecision = (nextDecision: CompetitorReviewDecision) => {
    if (nextDecision === "confirmed_exact" && !exactApprovalAllowed) return;
    setDecision(nextDecision);
    setError(null);
    setReasons(new Set(nextDecision === "revoked" ? ["review_withdrawn"] : []));
    if (nextDecision === "revoked") setNote("기존 사람 검토 결정을 철회합니다.");
  };

  const submitReview = async () => {
    if (!canSubmit || !item.observationId || !item.observationFingerprint || !item.checkedAt) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await createSupabaseClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("로그인 세션을 다시 확인해 주세요.");
      const response = await fetch("/api/admin/competitor-prices/reviews", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          observationId: item.observationId,
          expectedFingerprint: item.observationFingerprint,
          expectedCheckedAt: item.checkedAt,
          expectedLatestReviewId: item.latestHumanReview?.id ?? null,
          decision,
          reasonCodes: [...reasons],
          note: note.trim(),
          requestId,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "동일상품 검토 결과를 저장하지 못했습니다.";
        throw new Error(message);
      }
      const saved = isRecord(payload) ? payload.review : null;
      if (!isHumanReview(saved)) throw new Error("저장된 검토 결과를 다시 읽지 못했습니다.");
      if (!saved.latestForSource
        || saved.sourceObservationFingerprint !== item.observationFingerprint
        || Date.parse(saved.sourceCheckedAt) !== Date.parse(item.checkedAt)) {
        throw new Error("저장 중 가격 관측값이나 검토 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
      }
      onSaved({ ...saved, sourceCurrent: true });
    } catch (reviewError) {
      setError(reviewError instanceof Error && (reviewError.name === "AbortError" || reviewError.name === "TimeoutError")
        ? "저장 결과 확인 시간이 초과되었습니다. 같은 검토창에서 다시 시도하면 중복 없이 확인합니다."
        : reviewError instanceof Error ? reviewError.message : "동일상품 검토 결과를 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="competitor-review-overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !submitting) onClose();
  }}>
    <div className="competitor-review-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="competitor-review-title">
      <header><div><small>자동 판정 probable · 판매가/채널 변경 없음</small><h2 id="competitor-review-title">동일상품 사람 검토</h2><p>{item.title}</p></div><button type="button" aria-label="검토창 닫기" onClick={onClose} disabled={submitting}><X size={18} /></button></header>
      <div className="competitor-review-dialog-body">
        <div className="competitor-review-source"><span><b>{item.mallName || item.marketplace}</b><small>수집 {item.checkedAt ? formatTimestamp(item.checkedAt) : "시각 미확인"} · fingerprint {item.observationFingerprint?.slice(0, 12)}…</small></span><a href={item.url} target="_blank" rel="noreferrer" onClick={() => setSourceLinkOpened(true)}>원본 열기 <ExternalLink size={13} /></a></div>
        {!existing && <fieldset className="competitor-review-decision"><legend>검토 결정</legend><label><input type="radio" name="competitor-review-decision" checked={decision === "confirmed_exact"} disabled={!exactApprovalAllowed} onChange={() => changeDecision("confirmed_exact")} />exact 승인</label><label><input type="radio" name="competitor-review-decision" checked={decision === "rejected"} onChange={() => changeDecision("rejected")} />동일상품 아님·확정 불가</label>{!exactApprovalAllowed && <small>자동 판정에 불일치 근거가 남아 있어 exact 승인은 차단됩니다.</small>}</fieldset>}
        {existing && <p className="competitor-review-existing"><CheckCircle2 size={16} />기존 결정을 수정하지 않고 새 철회 이벤트를 추가합니다.</p>}
        <fieldset className="competitor-review-reasons"><legend>직접 확인한 근거</legend>{decision !== "revoked" && !sourceLinkOpened && <small>위 원본 열기 버튼을 누른 뒤 원본 확인 사실을 기록할 수 있습니다.</small>}{visibleReasons.map((reason) => <label key={reason}><input type="checkbox" checked={reasons.has(reason)} disabled={decision === "revoked" || (reason === "source_opened" && !sourceLinkOpened)} onChange={(event) => setReasons((current) => {
          const next = new Set(current);
          if (event.target.checked) next.add(reason); else next.delete(reason);
          return next;
        })} /><span>{reviewReasonLabels[reason]}</span></label>)}</fieldset>
        <label className="competitor-review-note"><span>감사 메모 <small>{note.length}/2,000</small></span><textarea value={note} maxLength={2_000} rows={4} placeholder="원본 페이지에서 확인한 브랜드·모델·규격 또는 제외 근거를 적어 주세요." onChange={(event) => setNote(event.target.value)} /></label>
        {error && <p className="competitor-review-error" role="alert"><AlertCircle size={14} />{error}</p>}
      </div>
      <footer><button type="button" onClick={onClose} disabled={submitting}>취소</button><button type="button" className="primary" disabled={!canSubmit} onClick={() => void submitReview()}>{submitting ? <><LoaderCircle className="spin" size={15} />저장 중</> : decision === "revoked" ? "결정 철회 기록" : decision === "confirmed_exact" ? "exact 승인 기록" : "제외 기록"}</button></footer>
    </div>
  </div>;
}

function validatedMarginScenarioTargetPrice(scenario: OperationMarginScenario | null) {
  if (!scenario || !Number.isFinite(Date.parse(scenario.createdAt))) return null;
  const numberValue = (key: string) => {
    const value = scenario.inputs[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const values = ["purchaseCost", "internationalShipping", "localShipping", "fulfillmentCost", "fixedCost", "platformFee", "paymentFee", "taxRate", "adRate", "reserveRate", "targetMargin"].map(numberValue);
  if (values.some((value) => value === null)) return null;
  const [purchaseCost, internationalShipping, localShipping, fulfillmentCost, fixedCost, platformFee, paymentFee, taxRate, adRate, reserveRate, targetMargin] = values as number[];
  const variableRate = platformFee + paymentFee + taxRate + adRate + reserveRate;
  const denominator = 1 - variableRate / 100 - targetMargin / 100;
  if (denominator <= 0 || variableRate >= 100 || targetMargin >= 100) return null;
  const fixedCosts = purchaseCost + internationalShipping + localShipping + fulfillmentCost + fixedCost;
  const expected = Math.ceil((fixedCosts / denominator) / 100) * 100;
  const stored = scenario.result.recommendedPrice;
  if (typeof stored !== "number" || !Number.isFinite(stored) || stored <= 0 || Math.abs(stored - expected) > 0.01) return null;
  return stored;
}

export function CompetitorPriceSlots({
  items,
  providers = [],
  state = "ready",
  compact = false,
  lastCheckedAt = null,
  productId,
  marginScenarios,
  retryAvailable = false,
  onRetry,
  onProceedWithoutPrices,
}: {
  items: CompetitorDisplayItem[];
  providers?: CompetitorProviderDisplayStatus[];
  state?: Exclude<CompetitorResearchUiState, "idle">;
  compact?: boolean;
  lastCheckedAt?: string | null;
  productId?: string;
  marginScenarios?: OperationMarginScenario[];
  retryAvailable?: boolean;
  onRetry?: () => void;
  onProceedWithoutPrices?: () => void;
}) {
  const [reviewOverrides, setReviewOverrides] = useState<Record<string, CompetitorHumanReviewOverride>>({});
  const [reviewTarget, setReviewTarget] = useState<CompetitorV3DisplayItem | null>(null);
  const displayItems = useMemo(() => items.map((item) => competitorDisplayItemWithReviewOverride(
    item,
    item.observationId ? reviewOverrides[item.observationId] : undefined,
  )), [items, reviewOverrides]);
  const marketplaceOrder: CompetitorMarketplaceId[] = [...activeChannelKeys];
  const marketplaceLabels: Record<string, string> = Object.fromEntries(Object.entries(channels).map(([key, channel]) => [key, channel.name]));
  const providerLabels: Record<CompetitorProviderDisplayStatus["provider"], string> = { naver_shopping: "네이버 쇼핑 검색", elevenst_product_search: "11번가 상품검색", ebay_browse: "eBay Browse", brave_marketplace_web: "Shopee·Lazada·Temu 웹 검색" };
  marketplaceLabels.other = "기타 판매처";
  const v3Items = deduplicatedV3CompetitorDisplayItems(displayItems);
  const exactItems = v3Items.filter((item) => item.matchTier === "exact");
  const probableItems = v3Items.filter((item) => item.matchTier === "probable");
  const rejectedItems = v3Items.filter((item) => item.matchTier === "rejected");
  const humanRejectedItems = rejectedItems.filter((item) => hasCurrentHumanReview(item) && item.latestHumanReview?.decision === "rejected");
  const automatedRejectedItems = rejectedItems.filter((item) => !humanRejectedItems.includes(item));
  const legacyItems = displayItems.filter((item) => !isV3Observation(item));
  const lowestPrice = lowestEligibleCompetitorPrice(v3Items);
  const marginScenario = productId && lowestPrice?.marketplace
    ? latestProductMarginScenario(productId, lowestPrice.marketplace, marginScenarios ?? []) as OperationMarginScenario | null
    : null;
  const marginTargetPrice = validatedMarginScenarioTargetPrice(marginScenario);
  const competitorTotalKrw = lowestPrice?.totalPurchasePrice?.krwAmount ?? null;
  const priceFollow = productId ? competitorTotalKrw === null
    ? { allowed: false, reason: "산정 가능한 exact 최저 총구매가가 없습니다." }
    : marginTargetPrice === null
      ? { allowed: false, reason: "최신 저장 마진 시나리오의 원가·수수료·배송·세금·목표마진 기준을 검증하지 못했습니다." }
      : competitorTotalKrw < marginTargetPrice
        ? { allowed: false, reason: `경쟁 총구매가 ${formatMoney(competitorTotalKrw, "KRW")}가 검증된 목표마진 제안가 ${formatMoney(marginTargetPrice, "KRW")}보다 낮아 추종하지 않습니다.` }
        : { allowed: true, reason: `판매가 제안 ${formatMoney(competitorTotalKrw, "KRW")} · 검증된 목표마진 제안가 ${formatMoney(marginTargetPrice, "KRW")}` }
    : null;
  const groups: Array<{ marketplace: CompetitorMarketplaceId; items: CompetitorV3DisplayItem[] }> = marketplaceOrder.map((marketplace) => ({ marketplace, items: exactItems.filter((item) => (item.marketplace || "other") === marketplace).slice(0, 3) }));
  const marketplaceOrderSet = new Set<string>(marketplaceOrder);
  const otherItems = exactItems.filter((item) => !marketplaceOrderSet.has(item.marketplace || "other")).slice(0, 3);
  if (otherItems.length) groups.push({ marketplace: "other", items: otherItems });
  const marketplaceGroups = groups.map((group) => ({ ...group, providerState: competitorMarketplaceProviderState(group.marketplace, providers) }));
  const hasPreservedItems = displayItems.some((item) => item.preserved === true);
  const hasIncompleteMarketplace = marketplaceGroups.some((group) => group.providerState === "partial" || group.providerState === "unavailable");
  const unavailableNotice = state === "stale" ? null : hasPreservedItems
    ? "일부 공급자의 새 응답을 확인하지 못해 해당 가격은 이전 확인값으로 표시합니다."
    : state === "unavailable" ? items.length > 0
      ? "가격 공급자의 새 응답은 확인하지 못했습니다. 수동 입력 가격만 표시합니다."
      : "가격 조회 연결을 확인하지 못했습니다. 상품 등록은 계속할 수 있으며 값은 공란으로 유지됩니다."
      : hasIncompleteMarketplace ? "일부 판매처의 가격 조회 연결을 확인하지 못해 빈 가격은 확인 불가로 표시합니다." : null;

  return <div className={`competitor-market-groups ${compact ? "compact" : ""}`}>
    <div className="competitor-lowest-summary">
      <span><small>조회 가능한 승인 공급자 범위의 동일상품 최저 총구매가</small>{lowestPrice ? <><strong>{formatMoney(lowestPrice.totalPurchasePrice?.krwAmount, "KRW")}</strong><em>원 통화 {formatMoney(lowestPrice.totalPurchasePrice?.amount, lowestPrice.totalPurchasePrice?.currency ?? lowestPrice.currency)} · exact · 재고 있음 · 최신 snapshot</em></> : <><strong>산정 불가</strong><em>exact · 재고 · 최신성 · 총구매가 · KRW 환산 조건을 모두 만족한 후보 없음</em></>}</span><small><AlertCircle size={13} />전체 인터넷 최저가가 아님</small>
    </div>
    {exactItems.length === 0 && state !== "loading" && state !== "pending" && <p className="competitor-exact-empty"><Search size={15} /><span><b>확정 동일상품 없음</b><small>probable 후보가 있으면 아래 사람 검토 목록에서만 확인합니다.</small></span></p>}
    {state === "loading" && <div className="competitor-loading"><LoaderCircle className="spin" size={17} />동일 상품 가격을 채널별로 찾고 있습니다.</div>}
    {state === "pending" && !retryAvailable && <div className="competitor-loading pending"><Clock3 size={17} />공식 채널 조회가 계속 진행 중입니다. 확인된 결과부터 표시합니다.</div>}
    {((retryAvailable && onRetry) || state === "stale") && <div className="competitor-retry" role="status"><span><Clock3 size={17} /><span><b>{state === "stale" ? "상품 식별정보가 변경되었습니다." : "자동 확인을 마쳤습니다."}</b><small>{state === "stale" ? "이전 상품의 가격 근거는 제거했습니다. 변경한 정보로 다시 확인하거나 공란으로 계속할 수 있습니다." : "공식 채널 작업이 늦게 끝날 수 있습니다. 다시 확인하거나, 현재 공란을 유지한 채 분석을 계속할 수 있습니다."}</small></span></span><div className="competitor-retry-actions">{retryAvailable && onRetry && <button type="button" onClick={onRetry}><RefreshCw size={15} />가격 다시 확인</button>}{(state === "pending" || state === "stale") && onProceedWithoutPrices && <button type="button" onClick={onProceedWithoutPrices}><ArrowRight size={15} />가격 없이 계속</button>}</div></div>}
    {providers.length > 0 && <div className="competitor-provider-summary" aria-label="가격 검색 공급자 상태">{providers.map((provider) => <span className={provider.status} key={provider.provider}><b>{providerLabels[provider.provider]}</b><em>{provider.blockedReason === "STATIC_EGRESS_REQUIRED" ? "고정 egress 필요 · 조회 안 함" : provider.status === "searched" ? `조회 완료 · 후보 ${provider.count}건` : provider.status === "pending" ? "조회 진행 중" : provider.status === "failed" ? "응답 실패" : "미연결"}</em><small>{lastCheckedAt ? `마지막 조회 ${formatTimestamp(lastCheckedAt)}` : "마지막 조회 미확인"}</small></span>)}</div>}
    {marketplaceGroups.map((group) => {
      const groupState: Exclude<CompetitorResearchUiState, "idle"> = state === "stale" ? "stale" : group.providerState === "partial" || group.providerState === "unavailable" ? "unavailable" : group.providerState === "loading" ? state === "pending" ? "pending" : "loading" : group.providerState ?? state;
      const emptySlot = competitorResearchEmptySlot(groupState);
      const preservedCount = group.items.filter((item) => item.preserved === true).length;
      const groupSummary = preservedCount > 0 ? `${preservedCount}개 이전 확인값${group.providerState === "partial" ? " · 일부 확인 불가" : ""}` : group.providerState === "partial" ? "일부 공급자 확인 불가" : groupState === "unavailable" ? "공급자 확인 불가" : state === "stale" ? "이전 결과 만료" : "최대 3개";
      return <section key={group.marketplace}><header><b>{marketplaceLabels[group.marketplace] ?? group.marketplace}</b><small>{group.items.length > 0 ? `exact ${group.items.length}개` : groupSummary}</small></header><div className="competitor-price-grid">{Array.from({ length: 3 }, (_, index) => {
        const item = group.items[index];
        return item ? <ObservationCard item={item} onReview={isPersistedReviewCandidate(item, compact, productId) ? setReviewTarget : undefined} key={`${item.id}-${item.observedAt}`} /> : <div className="competitor-price-empty" key={`${group.marketplace}-empty-${index}`} aria-busy={emptySlot.loading}><span>{emptySlot.loading ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}</span><div><small>{marketplaceLabels[group.marketplace] ?? "판매처"}</small><b>{emptySlot.label}</b><strong>{emptySlot.value}</strong></div></div>;
      })}</div></section>;
    })}
    {probableItems.length > 0 && <section className="competitor-review-section"><header><b>probable · 사람 검토 후보</b><small>자동 최저가 제외 · {probableItems.length}개</small></header><div className="competitor-review-grid">{probableItems.slice(0, 8).map((item) => <ObservationCard item={item} review onReview={isPersistedReviewCandidate(item, compact, productId) ? setReviewTarget : undefined} key={`${item.id}-${item.observedAt}`} />)}</div></section>}
    {humanRejectedItems.length > 0 && <section className="competitor-review-section rejected"><header><b>사람 검토로 제외</b><small>자동 판정은 probable · {humanRejectedItems.length}개</small></header><div className="competitor-review-grid">{humanRejectedItems.slice(0, 8).map((item) => <ObservationCard item={item} review onReview={isPersistedReviewCandidate(item, compact, productId) ? setReviewTarget : undefined} key={`${item.id}-${item.observedAt}`} />)}</div></section>}
    {automatedRejectedItems.length > 0 && <details className="competitor-rejected-list"><summary>자동 제외된 후보와 이유 {automatedRejectedItems.length}개</summary><div>{automatedRejectedItems.slice(0, 12).map((item) => <article key={`${item.id}-${item.observedAt}`}><span><b>{item.title}</b><small>rejected · {Math.round(item.matchScore)}점 · 가격 계산 제외</small></span><ul>{item.mismatchEvidence.slice(0, 4).map((entry, index) => <li key={`${entry.code}-${index}`}>{evidenceText(entry)}</li>)}</ul><a href={item.url} target="_blank" rel="noreferrer">원본 링크 <ExternalLink size={12} /></a></article>)}</div></details>}
    {legacyItems.length > 0 && <section className="competitor-legacy-section"><header><b>수동·기존 matcher 기준가격</b><small>v3 자동 최저가 제외 · {legacyItems.length}개</small></header><div>{legacyItems.slice(0, 12).map((item) => <article key={item.id}><span><b>{item.title}</b><small>{item.provider === "manual" ? "수동 기준가격" : "기존 matcher 관측값"}{item.preserved ? " · 이전 확인값 보존" : ""}</small></span><strong>{formatMoney(item.price, item.currency)}</strong><a href={item.url} target="_blank" rel="noreferrer" aria-label={`${item.title} 원본 링크`}><ExternalLink size={13} /></a></article>)}</div></section>}
    {priceFollow && <div className={`competitor-price-follow ${priceFollow.allowed ? "allowed" : "excluded"}`}><span><b>{priceFollow.allowed ? "사람 검토용 판매가 제안" : "가격 추종 제외"}</b><small>{priceFollow.reason}</small></span><em>운영 판매가 변경은 사람 승인·채널 readback 후</em></div>}
    {unavailableNotice && <p className="competitor-unavailable"><AlertCircle size={14} />{unavailableNotice}</p>}
    <p className="competitor-nonblocking-note"><ShieldCheck size={14} />경쟁가 실패·미연결·진행 중이어도 상세페이지 제작과 상품 등록을 차단하지 않습니다. 자동 가격 변경은 실행하지 않습니다.</p>
    {reviewTarget && <CompetitorReviewDialog item={reviewTarget} onClose={() => setReviewTarget(null)} onSaved={(savedReview) => {
      if (reviewTarget.observationId) setReviewOverrides((current) => {
        const observationId = reviewTarget.observationId as string;
        const currentOverride = competitorHumanReviewOverrideApplies(reviewTarget, current[observationId])
          ? current[observationId]
          : undefined;
        return {
          ...current,
          [observationId]: competitorHumanReviewOverrideAfterSave(
            savedReview,
            currentOverride,
            reviewTarget.latestHumanReview?.id ?? null,
          ),
        };
      });
      setReviewTarget(null);
    }} />}
  </div>;
}
