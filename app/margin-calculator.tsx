"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  Percent,
  RefreshCw,
  Save,
  Target,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateChannelMargins,
  createChannelCostOverrides,
  createPaymentFeeOverrides,
  createPlatformFeeOverrides,
  marginChannelProfiles,
  quoteKrwPrice,
  type ChannelMarginCosts,
  type ChannelMarginProfile,
  type ChannelMarginResult,
  type MarginFormBase,
} from "../lib/pricing/channel-margin";
import { MARGIN_ENGINE_VERSION } from "../lib/pricing/margin-engine";
import { createClient } from "../lib/supabase/client";
import { fetchJsonWithDeadline } from "../lib/bounded-json-request";
import { channels, type ChannelKey } from "./channel-config";
import { useModalInteraction } from "./use-modal-interaction";
import type { OperationMarginScenario, OperationProduct } from "./use-operations-snapshot";

export type MarginForm = MarginFormBase;
type MarginResult = ChannelMarginResult;

type SavedScenario = {
  id: string;
  productId: string | null;
  product: string;
  channelKey: ChannelKey;
  sellingPrice: number;
  profit: number;
  margin: number;
  savedAt: string;
};

const defaultMarginForm: MarginForm = {
  sellingPrice: 0,
  marketReferencePrice: 0,
  purchaseCost: 0,
  taxRate: 0,
  adRate: 0,
  reserveRate: 0,
  targetMargin: 25,
};

const wonFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
export const marginExchangeRateTimeoutMs = 12_000;
export const marginExchangeRateRefreshMs = 60_000;
const requiredMarginExchangeRateCodes = ["USD", "JPY", "SGD", "MYR"] as const;

type MarginExchangeRatePayload = {
  source?: string;
  frequency?: "minute-market" | "daily-reference-fallback";
  asOf?: string;
  providerAsOf?: string | null;
  fetchedAt?: string;
  fallback?: boolean;
  changeBasis?: "latest-daily-reference" | "previous-daily-reference" | "unavailable";
  rates?: Array<{ code: string; unit: number; value: number; change?: number | null }>;
};

function formatMarginExchangeRateTimestamp(value: string | null | undefined) {
  if (!value) return "시각 확인 중";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export async function fetchMarginReferenceRates({
  signal,
  timeoutMs = marginExchangeRateTimeoutMs,
  fetcher = fetch,
}: {
  signal: AbortSignal;
  timeoutMs?: number;
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
}) {
  const { response, payload } = await fetchJsonWithDeadline<MarginExchangeRatePayload>({
    fetcher,
    input: "/api/exchange-rates",
    init: { cache: "no-store" },
    parentSignal: signal,
    timeoutMs,
    fallbackPayload: {},
  });
  if (!response.ok || !Array.isArray(payload.rates)) throw new Error("기준환율 응답 오류");
  const requiredCodes = new Set<string>(requiredMarginExchangeRateCodes);
  const normalizedRates = payload.rates.flatMap((rate) => {
    if (!requiredCodes.has(rate.code)
        || !Number.isFinite(rate.unit)
        || rate.unit <= 0
        || !Number.isFinite(rate.value)
        || rate.value <= 0) return [];
    return [{ code: rate.code, value: rate.value / rate.unit }];
  });
  if (new Set(normalizedRates.map((rate) => rate.code)).size !== normalizedRates.length) {
    throw new Error("기준환율 응답에 중복 통화가 있습니다.");
  }
  const normalizedByCode = new Map(normalizedRates.map((rate) => [rate.code, rate.value]));
  if (!requiredMarginExchangeRateCodes.every((code) => normalizedByCode.has(code))) {
    throw new Error("필수 기준환율이 누락되었습니다.");
  }
  const receivedAt = formatMarginExchangeRateTimestamp(payload.fetchedAt);
  const basis = payload.frequency === "daily-reference-fallback" || payload.fallback
    ? `${payload.source ?? "일일 기준환율"} · 일일 기준 대체값 ${payload.asOf ?? "기준일 확인 중"} · 수신 ${receivedAt}`
    : `${payload.source ?? "현재 환율"} · 60초 자동 조회 · 공급자 갱신 ${formatMarginExchangeRateTimestamp(payload.providerAsOf ?? payload.asOf)} · 수신 ${receivedAt}`;
  return {
    rates: Object.fromEntries(requiredMarginExchangeRateCodes.map((code) => [code, normalizedByCode.get(code)!])),
    basis,
  };
}

function formatWon(value: number) {
  const absolute = wonFormatter.format(Math.abs(Math.round(value)));
  return `${value < 0 ? "−" : ""}₩${absolute}`;
}

function formatLocalAmount(value: number, channel: Pick<ChannelMarginProfile, "currency" | "symbol">) {
  if (channel.currency === "KRW" || channel.currency === "JPY") return `${channel.symbol}${wonFormatter.format(value)}`;
  return `${channel.symbol}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatLocalPrice(valueInKrw: number, channel: ChannelMarginProfile) {
  const quote = quoteKrwPrice(valueInKrw, channel);
  return quote ? formatLocalAmount(quote.localAmount, channel) : "환율 확인 필요";
}

function formatProductBasePrice(product: OperationProduct | null) {
  if (!product || (product.baseSellingPrice === null && !product.baseCurrency)) return "기준 판매가 미입력";
  if (product.baseSellingPrice === null) return `가격 미입력 · ${product.baseCurrency}`;
  if (!product.baseCurrency) {
    return `${product.baseSellingPrice.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} · 통화 미입력`;
  }
  return `${product.baseSellingPrice.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${product.baseCurrency}`;
}

function MarginNumberField({
  id,
  label,
  value,
  suffix,
  hint,
  step = 100,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  suffix: string;
  hint?: string;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="margin-field" htmlFor={id}>
      <span>{label}</span>
      <div><input id={id} type="number" min="0" step={step} value={value} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} /><em>{suffix}</em></div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function MarginOptionalNumberField({
  id,
  label,
  value,
  suffix,
  hint,
  step = 0.1,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  suffix: string;
  hint?: string;
  step?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="margin-field" htmlFor={id}>
      <span>{label}</span>
      <div><input id={id} type="number" min="0" step={step} value={value ?? ""} placeholder="직접 입력" onChange={(event) => {
        const rawValue = event.target.value;
        onChange(rawValue === "" ? null : Math.max(0, Number(rawValue) || 0));
      }} /><em>{suffix}</em></div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function savedScenarioFromOperation(scenario: unknown): SavedScenario | null {
  const raw = recordValue(scenario);
  const channelKey = typeof raw.channelKey === "string" ? raw.channelKey as ChannelKey : null;
  if (!channelKey || !marginChannelProfiles.some((channel) => channel.key === channelKey)) return null;
  const inputs = recordValue(raw.inputs);
  const result = recordValue(raw.result);
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  const createdDate = new Date(createdAt);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `invalid-${channelKey}-${createdAt || "unknown"}`,
    productId: typeof raw.productId === "string" && raw.productId ? raw.productId : null,
    product: typeof raw.name === "string" && raw.name.trim() ? raw.name : "상품명 미입력",
    channelKey,
    sellingPrice: numeric(inputs.sellingPrice),
    profit: numeric(result.profit),
    margin: numeric(result.margin),
    savedAt: Number.isNaN(createdDate.getTime()) ? "저장 시각 없음" : createdDate.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

export function MarginCalculatorPage({ notify, scenarios, scenarioState, scenarioMessage, products, onChanged }: {
  notify: (message: string) => void;
  scenarios: OperationMarginScenario[];
  scenarioState: "checking" | "ready" | "unavailable";
  scenarioMessage: string | null;
  products: OperationProduct[];
  onChanged?: () => void;
}) {
  const [selectedProductId, setSelectedProductId] = useState("");
  const [form, setForm] = useState<MarginForm>(() => ({ ...defaultMarginForm }));
  const [feeOverrides, setFeeOverrides] = useState<Record<ChannelKey, number | null>>(() => createPlatformFeeOverrides());
  const [paymentFeeOverrides, setPaymentFeeOverrides] = useState<Record<ChannelKey, number>>(() => createPaymentFeeOverrides());
  const [channelCosts, setChannelCosts] = useState<Record<ChannelKey, ChannelMarginCosts>>(() => createChannelCostOverrides());
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>("qoo10");
  const [localScenarios, setLocalScenarios] = useState<SavedScenario[]>([]);
  const [deletedScenarioIds, setDeletedScenarioIds] = useState<Set<string>>(() => new Set());
  const [pendingDeleteScenario, setPendingDeleteScenario] = useState<SavedScenario | null>(null);
  const [deletingScenarioId, setDeletingScenarioId] = useState<string | null>(null);
  const [savingScenario, setSavingScenario] = useState(false);
  const [referenceRates, setReferenceRates] = useState<Record<string, number>>({});
  const [rateBasis, setRateBasis] = useState("실시간 환율 수신 전 · 해외 채널 계산 잠김");
  const rateRequestRef = useRef<AbortController | null>(null);
  const rateReceivedRef = useRef(false);
  const deleteConfirmationRef = useRef<HTMLDivElement>(null);
  const closeDeleteConfirmation = () => {
    if (deletingScenarioId) return;
    setPendingDeleteScenario(null);
  };
  useModalInteraction(Boolean(pendingDeleteScenario), deleteConfirmationRef, closeDeleteConfirmation, {
    dismissible: !deletingScenarioId,
  });
  useEffect(() => {
    let active = true;
    const loadRates = async () => {
      if (rateRequestRef.current) return;
      const controller = new AbortController();
      rateRequestRef.current = controller;
      try {
        const loaded = await fetchMarginReferenceRates({ signal: controller.signal });
        if (!active || controller.signal.aborted) return;
        rateReceivedRef.current = true;
        setReferenceRates(loaded.rates);
        setRateBasis(loaded.basis);
      } catch {
        if (active && !controller.signal.aborted) {
          if (!rateReceivedRef.current) {
            setRateBasis("실시간 환율 최초 수신 실패 · 해외 채널 계산 잠김");
          } else {
            setRateBasis((current) => current.includes("최근 자동 갱신 실패")
              ? current
              : `${current} · 최근 자동 갱신 실패(직전 실수신값 유지)`);
          }
        }
      } finally {
        if (rateRequestRef.current === controller) rateRequestRef.current = null;
      }
    };
    void loadRates();
    const interval = window.setInterval(() => void loadRates(), marginExchangeRateRefreshMs);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadRates();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      rateRequestRef.current?.abort(new DOMException("마진 계산 화면이 닫혀 기준환율 요청을 취소했습니다.", "AbortError"));
      rateRequestRef.current = null;
    };
  }, []);
  const calculationProfiles = useMemo(() => marginChannelProfiles.map((profile) => ({
    ...profile,
    rateToKrw: profile.currency === "KRW" ? 1 : referenceRates[profile.currency] ?? null,
  })), [referenceRates]);
  const results = useMemo(() => calculateChannelMargins(form, feeOverrides, paymentFeeOverrides, channelCosts, calculationProfiles), [calculationProfiles, channelCosts, form, feeOverrides, paymentFeeOverrides]);
  const selectedResult = results.find((result) => result.key === selectedChannel) ?? results[0];
  const selectedCosts = channelCosts[selectedChannel];
  const selectedChannelInfo = channels[selectedChannel];
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const targetProgress = selectedResult.calculationReady
    ? Math.max(0, Math.min(100, ((selectedResult.margin ?? 0) / Math.max(form.targetMargin, 1)) * 100))
    : 0;
  const manualFeeMessage = `${selectedChannelInfo.name} 플랫폼 수수료를 직접 입력하세요.`;
  const exchangeRateMessage = `${selectedResult.currency} 실시간 환율을 수신한 뒤 계산할 수 있습니다.`;
  const calculationBlockedMessage = !selectedResult.exchangeRateReady ? exchangeRateMessage : manualFeeMessage;
  const savedScenarios = useMemo(() => {
    const operationScenarios = (Array.isArray(scenarios) ? scenarios : [])
      .map(savedScenarioFromOperation)
      .filter((scenario): scenario is SavedScenario => scenario !== null);
    const merged = [...localScenarios, ...operationScenarios];
    return [...new Map(merged.map((scenario) => [scenario.id, scenario])).values()]
      .filter((scenario) => !deletedScenarioIds.has(scenario.id))
      .slice(0, 5);
  }, [deletedScenarioIds, localScenarios, scenarios]);

  const changeFormValue = (key: keyof MarginForm, value: number) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const changeCostValue = (key: keyof ChannelMarginCosts, value: number) => {
    setChannelCosts((current) => ({
      ...current,
      [selectedChannel]: { ...current[selectedChannel], [key]: value },
    }));
  };

  const resetInputs = () => {
    setSelectedProductId("");
    setForm({ ...defaultMarginForm });
    setFeeOverrides(createPlatformFeeOverrides());
    setPaymentFeeOverrides(createPaymentFeeOverrides());
    setChannelCosts(createChannelCostOverrides());
    setSelectedChannel("qoo10");
    notify("마진 계산 입력값을 초기화했습니다.");
  };

  const selectProduct = (productId: string) => {
    setSelectedProductId(productId);
    const product = products.find((item) => item.id === productId);
    if (product?.baseCurrency === "KRW" && product.baseSellingPrice !== null) {
      changeFormValue("sellingPrice", product.baseSellingPrice);
    }
  };

  const applyRecommendedPrice = () => {
    if (!selectedResult.exchangeRateReady) return notify(exchangeRateMessage);
    if (!selectedResult.feeReady) return notify(manualFeeMessage);
    if (selectedResult.recommendedPrice === null) return;
    changeFormValue("sellingPrice", selectedResult.recommendedPrice);
    notify(`${selectedChannelInfo.name} 목표 마진 판매가 ${formatWon(selectedResult.recommendedPrice)}를 적용했습니다.`);
  };

  const saveScenario = async () => {
    if (savingScenario) return;
    if (selectedResult.plannedSellingPriceKrw <= 0 || selectedResult.profit === null || selectedResult.margin === null) return notify("계획 판매가를 입력한 뒤 계산 결과를 저장할 수 있습니다.");
    if (!selectedResult.exchangeRateReady) return notify(`${exchangeRateMessage} 실환율 없는 계산은 저장하지 않습니다.`);
    if (!selectedResult.calculationReady || selectedResult.platformFee === null) return notify(`${manualFeeMessage} 입력 후 계산 결과를 저장할 수 있습니다.`);
    if (!selectedProduct) return notify("마진 계산을 연결할 실제 상품을 먼저 선택해 주세요.");
    const now = new Date();
    const saved: SavedScenario = {
      id: `${selectedChannel}-${now.getTime()}`,
      productId: selectedProduct.id,
      product: selectedProduct.name,
      channelKey: selectedChannel,
      sellingPrice: selectedResult.effectiveSellingPriceKrw ?? form.sellingPrice,
      profit: selectedResult.profit ?? 0,
      margin: selectedResult.margin ?? 0,
      savedAt: `오늘 ${now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}`,
    };
    setSavingScenario(true);
    try {
      const { data } = await createClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("마진 계산을 저장하려면 다시 로그인해 주세요.");
      const response = await fetch("/api/operations/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          action: "margin_save",
          name: saved.product,
          channelKey: selectedChannel,
          inputs: {
            ...selectedResult.engineInput,
            productId: selectedProduct.id,
            plannedSellingPriceKrw: selectedResult.plannedSellingPriceKrw,
            localSellingPrice: selectedResult.localSellingPrice,
            localPriceIncrement: selectedResult.localPriceIncrement,
            currency: selectedResult.currency,
            rateToKrw: selectedResult.rateToKrw,
            rateBasis,
            engineVersion: MARGIN_ENGINE_VERSION,
          },
          result: {
            engineVersion: selectedResult.engineVersion,
            calculationStatus: selectedResult.calculationStatus,
            profitabilityStatus: selectedResult.profitabilityStatus,
            marketStatus: selectedResult.marketStatus,
            reasons: selectedResult.reasons,
            fixedCosts: selectedResult.fixedCosts,
            variableRate: selectedResult.variableRate,
            variableCost: selectedResult.variableCost,
            profit: selectedResult.profit,
            margin: selectedResult.margin,
            breakEvenPrice: selectedResult.breakEvenPrice,
            recommendedPrice: selectedResult.recommendedPrice,
            marketGapRate: selectedResult.marketGapRate,
            status: selectedResult.status,
          },
        }),
      });
      const payload = await response.json().catch(() => ({ message: "저장 응답을 읽지 못했습니다." })) as { id?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "마진 계산 결과를 저장하지 못했습니다.");
      setLocalScenarios((current) => [{ ...saved, id: payload.id ?? saved.id }, ...current].slice(0, 5));
      onChanged?.();
      notify(`${selectedChannelInfo.name} 마진 계산 결과를 운영 DB에 저장했습니다.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "마진 계산 결과를 저장하지 못했습니다.");
    } finally {
      setSavingScenario(false);
    }
  };

  const deleteScenario = async (scenario: SavedScenario) => {
    if (deletingScenarioId) return;
    setDeletingScenarioId(scenario.id);
    try {
      const { data } = await createClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("마진 계산을 삭제하려면 다시 로그인해 주세요.");
      const response = await fetch("/api/operations/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "margin_delete", id: scenario.id }),
      });
      if (!response.ok) throw new Error("저장된 마진 계산을 삭제하지 못했습니다.");
      setLocalScenarios((current) => current.filter((item) => item.id !== scenario.id));
      setDeletedScenarioIds((current) => new Set(current).add(scenario.id));
      setPendingDeleteScenario(null);
      onChanged?.();
      notify("저장된 마진 계산을 운영 DB에서 삭제했습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "저장된 마진 계산을 삭제하지 못했습니다.");
    } finally {
      setDeletingScenarioId(null);
    }
  };

  return (
    <div className="page-stack margin-page">
      <section className="margin-hero">
        <div className="margin-hero-copy">
          <span className="eyebrow"><Calculator size={14} /> PROFIT PRICING ENGINE</span>
          <h2>원가를 입력하면 8개 채널의<br /><em>팔아도 남는 가격</em>을 찾습니다.</h2>
          <p>수수료·환율·광고비·반품 충당금을 반영해 목표 마진 가격과 계산 근거를 확인합니다.</p>
        </div>
        <div className="margin-formula-card">
          <span><Calculator size={17} />계산 기준</span>
          <strong>최소 판매가 = 고정 원가 ÷<br />(1 − 변동비율 − 목표 마진율)</strong>
          <small>모든 금액은 원화로 계산한 뒤 채널 통화로 환산합니다.</small>
          <small>{rateBasis}</small>
        </div>
      </section>

      <div className="margin-channel-tabs" role="tablist" aria-label="마진 계산 채널 선택">
        {marginChannelProfiles.map((channel) => {
          const channelInfo = channels[channel.key];
          const active = selectedChannel === channel.key;
          return <button key={channel.key} role="tab" aria-selected={active} className={active ? "active" : ""} style={{ "--channel-color": channelInfo.color } as React.CSSProperties} onClick={() => setSelectedChannel(channel.key)}><span>{channelInfo.mark}</span><b>{channelInfo.name}</b><small>{channel.currency}</small></button>;
        })}
      </div>

      <section className="margin-workspace">
        <article className="panel margin-input-panel">
          <div className="panel-heading margin-panel-heading"><div><span className="panel-kicker">COST INPUT</span><h3>상품 원가 · 비용 입력</h3></div><button type="button" className="filter-button" onClick={resetInputs}><RefreshCw size={14} />입력값 초기화</button></div>

          <label className="margin-product-field" htmlFor="margin-product-id"><span>계산 상품</span><select id="margin-product-id" value={selectedProductId} onChange={(event) => selectProduct(event.target.value)}><option value="">실상품 원장에서 선택</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select><small>{formatProductBasePrice(selectedProduct)} · 상품 이름이 아닌 원장 ID로 계산 결과를 연결합니다.</small></label>

          <div className="margin-field-section">
            <div className="margin-section-title"><span className="metric-icon violet"><CircleDollarSign size={17} /></span><div><b>판매가 기준</b><small>현재 계획가와 시장 참고가를 원화로 입력하세요.</small></div></div>
            <div className="margin-field-grid">
              <MarginNumberField id="selling-price" label="계획 판매가" value={form.sellingPrice} suffix="원" hint={`${selectedChannelInfo.name} ${formatLocalPrice(form.sellingPrice, selectedResult)}`} onChange={(value) => changeFormValue("sellingPrice", value)} />
              <MarginNumberField id="market-price" label="시장 참고가" value={form.marketReferencePrice} suffix="원" hint="경쟁가 또는 채널 평균가" onChange={(value) => changeFormValue("marketReferencePrice", value)} />
            </div>
          </div>

          <div className="margin-field-section">
            <div className="margin-section-title"><span className="metric-icon blue"><WalletCards size={17} /></span><div><b>{selectedChannelInfo.name} 건당 비용</b><small>매입 원가는 공통이고 배송·3PL·통관 비용은 현재 선택한 채널에만 적용됩니다.</small></div></div>
            <div className="margin-field-grid compact">
              <MarginNumberField id="purchase-cost" label="매입 원가" value={form.purchaseCost} suffix="원" onChange={(value) => changeFormValue("purchaseCost", value)} />
              <MarginNumberField id="international-shipping" label="국제 배송" value={selectedCosts.internationalShipping} suffix="원" hint="판매자 부담 실비" onChange={(value) => changeCostValue("internationalShipping", value)} />
              <MarginNumberField id="local-shipping" label="현지 배송" value={selectedCosts.localShipping} suffix="원" hint="판매자 부담 실비" onChange={(value) => changeCostValue("localShipping", value)} />
              <MarginNumberField id="fulfillment-cost" label="포장 · 3PL" value={selectedCosts.fulfillmentCost} suffix="원" onChange={(value) => changeCostValue("fulfillmentCost", value)} />
              <MarginNumberField id="fixed-cost" label="통관 · 기타 고정비" value={selectedCosts.fixedCost} suffix="원" onChange={(value) => changeCostValue("fixedCost", value)} />
            </div>
          </div>

          <div className="margin-field-section">
            <div className="margin-section-title"><span className="metric-icon orange"><Percent size={17} /></span><div><b>판매가 연동 비용</b><small>수수료는 선택 채널에만 수정 적용됩니다.</small></div></div>
            <div className="margin-field-grid compact">
              <MarginOptionalNumberField id="platform-fee" label={`${selectedChannelInfo.name} 수수료`} value={feeOverrides[selectedChannel]} suffix="%" hint={marginChannelProfiles.find((channel) => channel.key === selectedChannel)?.requiresManualFee ? "카테고리·계약 요율 입력 · 확인된 0%는 0 입력" : "기본값을 실제 계약 요율과 대조"} onChange={(value) => setFeeOverrides((current) => ({ ...current, [selectedChannel]: value }))} />
              <MarginNumberField id="payment-fee" label="결제 수수료" value={paymentFeeOverrides[selectedChannel]} suffix="%" step={0.1} hint="선택 채널에만 적용" onChange={(value) => setPaymentFeeOverrides((current) => ({ ...current, [selectedChannel]: value }))} />
              <MarginNumberField id="tax-rate" label="매출 연동 세금" value={form.taxRate} suffix="%" step={0.1} onChange={(value) => changeFormValue("taxRate", value)} />
              <MarginNumberField id="ad-rate" label="광고 · 쿠폰 부담" value={form.adRate} suffix="%" step={0.1} onChange={(value) => changeFormValue("adRate", value)} />
              <MarginNumberField id="reserve-rate" label="반품 · 분실 충당" value={form.reserveRate} suffix="%" step={0.1} onChange={(value) => changeFormValue("reserveRate", value)} />
              <MarginNumberField id="target-margin" label="목표 마진율" value={form.targetMargin} suffix="%" step={0.5} onChange={(value) => changeFormValue("targetMargin", value)} />
            </div>
            {!selectedResult.feeReady ? <p className="margin-manual-fee-warning" role="status"><AlertCircle size={14} />{selectedChannelInfo.name} 플랫폼 수수료가 미확인입니다. 확인된 0%라면 0을 직접 입력하세요.</p> : null}
            {!selectedResult.exchangeRateReady ? <p className="margin-manual-fee-warning" role="status"><AlertCircle size={14} />{exchangeRateMessage} 실환율 수신 전에는 해외채널 예상 손익·권장가·저장을 표시하지 않습니다.</p> : null}
            {selectedResult.calculationStatus === "target_unreachable" ? <p className="margin-manual-fee-warning" role="status"><AlertCircle size={14} />수수료·변동비와 목표 마진의 합이 100% 이상이라 목표 판매가를 계산할 수 없습니다.</p> : null}
          </div>
        </article>

        <div className="margin-result-column">
          <article className={`margin-result-card ${selectedResult.calculationReady && selectedResult.profitabilityStatus === "target_met" ? "positive" : "warning"}`}>
            <div className="margin-result-head"><div><span style={{ "--channel-color": selectedChannelInfo.color } as React.CSSProperties}>{selectedChannelInfo.mark}</span><div><small>{selectedChannelInfo.name} 예상 손익</small><b>{selectedResult.status}</b></div></div><em>{selectedResult.profitabilityStatus === "target_met" ? <><CheckCircle2 size={15} />목표 마진 충족</> : selectedResult.margin !== null ? <><AlertCircle size={15} />{Math.max(0, form.targetMargin - selectedResult.margin).toFixed(1)}%p 부족</> : <><AlertCircle size={15} />계산 기준 확인 필요</>}</em></div>
            <div className="margin-profit-value"><small>주문 1건 예상 순이익</small><strong>{selectedResult.calculationReady && selectedResult.profit !== null ? formatWon(selectedResult.profit) : "—"}</strong><span>{selectedResult.calculationReady && selectedResult.localSellingPrice !== null ? `${formatLocalAmount(selectedResult.localSellingPrice, selectedResult)} 판매 · 환산 ${formatWon(selectedResult.effectiveSellingPriceKrw ?? 0)}` : calculationBlockedMessage}</span></div>
            <div className="margin-progress"><div><span>예상 마진율</span><b>{selectedResult.calculationReady && selectedResult.margin !== null ? `${selectedResult.margin.toFixed(1)}%` : "—"}</b></div><span><i style={{ width: `${targetProgress}%` }} /></span><small>{selectedResult.calculationReady && selectedResult.variableRate !== null ? `목표 ${form.targetMargin.toFixed(1)}% · 변동비율 ${selectedResult.variableRate.toFixed(2)}%` : `${calculationBlockedMessage} 계산은 잠겨 있습니다.`}</small></div>
            <div className="margin-result-actions"><button type="button" onClick={applyRecommendedPrice} disabled={!selectedResult.calculationReady || selectedResult.recommendedPrice === null} title={!selectedResult.calculationReady ? calculationBlockedMessage : undefined}><Target size={15} />권장 판매가 적용</button><button type="button" onClick={() => void saveScenario()} disabled={savingScenario || !selectedResult.calculationReady || selectedResult.plannedSellingPriceKrw <= 0 || selectedResult.profit === null} title={!selectedResult.calculationReady ? calculationBlockedMessage : undefined}><Save size={15} />{savingScenario ? "저장 중" : "계산 결과 저장"}</button></div>
          </article>

          <section className="margin-summary-grid">
            <article className="panel"><span className="metric-icon violet"><Target size={17} /></span><div><small>목표 마진 권장 판매가</small><strong>{selectedResult.effectiveRecommendedPriceKrw === null ? "산정 불가" : formatWon(selectedResult.effectiveRecommendedPriceKrw)}</strong><em>{selectedResult.localRecommendedPrice === null ? calculationBlockedMessage : formatLocalAmount(selectedResult.localRecommendedPrice, selectedResult)}</em></div></article>
            <article className="panel"><span className="metric-icon blue"><TrendingUp size={17} /></span><div><small>손익분기 판매가</small><strong>{selectedResult.effectiveBreakEvenPriceKrw === null ? "산정 불가" : formatWon(selectedResult.effectiveBreakEvenPriceKrw)}</strong><em>{selectedResult.localBreakEvenPrice === null ? calculationBlockedMessage : `${formatLocalAmount(selectedResult.localBreakEvenPrice, selectedResult)}부터 손실 없음`}</em></div></article>
            <article className="panel"><span className="metric-icon orange"><Percent size={17} /></span><div><small>시장 참고가 대비 권장가</small><strong>{selectedResult.marketGapRate === null ? "—" : `${selectedResult.marketGapRate >= 0 ? "+" : ""}${selectedResult.marketGapRate.toFixed(1)}%`}</strong><em>{selectedResult.marketStatus === "reference_missing" ? "시장 비교 자료 없음" : selectedResult.marketStatus === "within_range" ? "시장 참고가 ±8% 범위" : selectedResult.marketStatus === "recommended_above_market" ? "권장가가 시장 참고가보다 높음" : selectedResult.marketStatus === "recommended_below_market" ? "권장가가 시장 참고가보다 낮음" : "계산 기준 확인 필요"}</em></div></article>
          </section>

          <article className="panel margin-breakdown">
            <div className="panel-heading"><div><span className="panel-kicker">COST BREAKDOWN</span><h3>현지 판매가 환산 후 1건 배분</h3></div><b>{selectedResult.effectiveSellingPriceKrw === null ? "—" : formatWon(selectedResult.effectiveSellingPriceKrw)}</b></div>
            {selectedResult.calculationReady && selectedResult.variableCost !== null && selectedResult.profit !== null && selectedResult.margin !== null && selectedResult.variableRate !== null ? <><div className="margin-stack-bar" aria-label="판매가 비용 배분"><i className="fixed" style={{ width: `${Math.min(100, (selectedResult.fixedCosts / Math.max(selectedResult.effectiveSellingPriceKrw ?? 1, 1)) * 100)}%` }} /><i className="variable" style={{ width: `${Math.min(100, (selectedResult.variableCost / Math.max(selectedResult.effectiveSellingPriceKrw ?? 1, 1)) * 100)}%` }} /><i className={selectedResult.profit >= 0 ? "profit" : "loss"} style={{ width: `${Math.min(100, Math.abs(selectedResult.profit) / Math.max(selectedResult.effectiveSellingPriceKrw ?? 1, 1) * 100)}%` }} /></div>
            <div className="margin-breakdown-list"><div><span><i className="fixed" />매입 · 선택 채널 배송 · 고정비</span><b>{formatWon(selectedResult.fixedCosts)}</b><small>{((selectedResult.fixedCosts / Math.max(selectedResult.effectiveSellingPriceKrw ?? 1, 1)) * 100).toFixed(1)}%</small></div><div><span><i className="variable" />수수료 · 변동비</span><b>{formatWon(selectedResult.variableCost)}</b><small>{selectedResult.variableRate.toFixed(1)}%</small></div><div><span><i className={selectedResult.profit >= 0 ? "profit" : "loss"} />순이익</span><b>{formatWon(selectedResult.profit)}</b><small>{selectedResult.margin.toFixed(1)}%</small></div></div></> : <p className="margin-manual-fee-warning" role="status"><AlertCircle size={14} />확인되지 않은 값을 0으로 계산하지 않습니다.</p>}
          </article>
        </div>
      </section>

      <section className="panel margin-comparison-panel">
        <div className="panel-heading table-title"><div><span className="panel-kicker">8 CHANNEL COMPARISON</span><h3>동일 상품 · 채널별 배송비와 환율 비교</h3></div><span className="margin-sample-note">채널별 직접 입력 비용 · {rateBasis}</span></div>
        <div className="table-wrap"><table className="data-table margin-table"><thead><tr><th>채널</th><th>현지 판매가</th><th>배송 · 고정비</th><th>플랫폼 + 결제 수수료</th><th>총 변동비율</th><th>예상 순이익</th><th>예상 마진율</th><th>권장 판매가</th><th>계산 상태</th><th /></tr></thead><tbody>{results.map((result) => { const channel = channels[result.key]; return <tr key={result.key} className={selectedChannel === result.key ? "selected" : ""}><td><button className="margin-channel-cell" onClick={() => setSelectedChannel(result.key)}><span style={{ "--channel-color": channel.color } as React.CSSProperties}>{channel.mark}</span><b>{channel.name}</b><small>{result.currency}</small></button></td><td><b>{result.localSellingPrice === null ? "환율 확인 필요" : formatLocalAmount(result.localSellingPrice, result)}</b><small>{result.effectiveSellingPriceKrw === null ? "원화 환산 불가" : `환산 ${formatWon(result.effectiveSellingPriceKrw)}`}</small></td><td><b>{formatWon(result.costs.internationalShipping + result.costs.localShipping + result.costs.fulfillmentCost + result.costs.fixedCost)}</b><small>해당 채널 입력값</small></td><td><b>{result.feeReady && result.platformFee !== null ? `${result.platformFee.toFixed(2)}% + ${result.paymentFee.toFixed(2)}%` : "직접 입력 필요"}</b></td><td><b>{result.variableRate === null ? "—" : `${result.variableRate.toFixed(2)}%`}</b></td><td><b className={result.profit !== null && result.profit >= 0 ? "profit-text" : "loss-text"}>{result.calculationReady && result.profit !== null ? formatWon(result.profit) : "—"}</b></td><td><b className={result.margin !== null && result.margin >= form.targetMargin ? "profit-text" : "loss-text"}>{result.calculationReady && result.margin !== null ? `${result.margin.toFixed(1)}%` : "—"}</b></td><td><b>{result.calculationReady && result.effectiveRecommendedPriceKrw !== null ? formatWon(result.effectiveRecommendedPriceKrw) : "—"}</b><small>{result.calculationReady && result.localRecommendedPrice !== null ? formatLocalAmount(result.localRecommendedPrice, result) : "기준 확인 후 계산"}</small></td><td><StatusPill status={result.status} /></td><td><button type="button" className="table-action" aria-label={`${channel.name} 계산 결과 보기`} onClick={() => setSelectedChannel(result.key)}><ArrowRight size={15} /></button></td></tr>; })}</tbody></table></div>
      </section>

      <section className="panel saved-margin-panel">
        <div className="panel-heading"><div><span className="panel-kicker">RECENT CALCULATIONS</span><h3>최근 저장한 계산</h3></div><small>운영 DB 저장 후 최근 5개를 화면에 표시합니다.</small></div>
        <div className="saved-margin-list">{scenarioState === "unavailable" ? <div className="live-empty-state" role="alert"><AlertCircle size={25} /><b>저장된 계산 이력을 불러오지 못했습니다.</b><small>{scenarioMessage ?? "잠시 후 다시 확인해 주세요."}</small></div> : scenarioState === "checking" && savedScenarios.length === 0 ? <div className="live-empty-state" role="status"><RefreshCw size={25} /><b>저장된 계산 이력을 확인하고 있습니다.</b><small>상품·주문 원장은 먼저 사용할 수 있습니다.</small></div> : <>{savedScenarios.map((scenario) => { const channel = channels[scenario.channelKey]; return <article key={scenario.id}><span style={{ "--channel-color": channel.color } as React.CSSProperties}>{channel.mark}</span><div><b>{scenario.product}</b><small>{channel.name} · {scenario.savedAt}{scenario.productId ? " · 상품 연결됨" : " · 기존 미연결 계산"}</small></div><dl><div><dt>판매가</dt><dd>{formatWon(scenario.sellingPrice)}</dd></div><div><dt>순이익</dt><dd>{formatWon(scenario.profit)}</dd></div><div><dt>마진</dt><dd>{scenario.margin.toFixed(1)}%</dd></div></dl><button type="button" aria-label={`${scenario.product} 계산 삭제 확인`} aria-haspopup="dialog" aria-expanded={pendingDeleteScenario?.id === scenario.id} onClick={() => setPendingDeleteScenario(scenario)}><Trash2 size={15} /></button></article>; })}{savedScenarios.length === 0 ? <div className="live-empty-state"><Calculator size={25} /><b>저장된 실제 계산이 없습니다.</b><small>상품 비용을 입력하고 결과를 운영 DB에 저장하면 여기에 표시됩니다.</small></div> : null}</>}</div>
        {pendingDeleteScenario ? <div
          ref={deleteConfirmationRef}
          className="publish-write-confirmation channel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="margin-delete-confirmation-title"
          aria-describedby="margin-delete-confirmation-description"
          aria-busy={deletingScenarioId === pendingDeleteScenario.id}
          tabIndex={-1}
        >
          <AlertTriangle size={18} />
          <div>
            <b id="margin-delete-confirmation-title">저장된 마진 계산을 삭제할까요?</b>
            <small id="margin-delete-confirmation-description">{pendingDeleteScenario.product} · {channels[pendingDeleteScenario.channelKey].name} 계산을 운영 DB에서 삭제합니다. 삭제 후에는 이 화면에서 복구할 수 없습니다.</small>
          </div>
          <button type="button" className="credential-secondary" disabled={deletingScenarioId === pendingDeleteScenario.id} onClick={closeDeleteConfirmation}>취소</button>
          <button type="button" className="publish-confirm-execute" disabled={deletingScenarioId === pendingDeleteScenario.id} onClick={() => void deleteScenario(pendingDeleteScenario)}>{deletingScenarioId === pendingDeleteScenario.id ? "삭제 중" : "확인 후 삭제"}</button>
        </div> : null}
        <div className="margin-disclaimer"><AlertCircle size={15} /><span><b>입력값 기반 예상 계산입니다.</b> 채널 수수료는 카테고리·판매자 등급·프로모션 기간에 따라 달라질 수 있으므로 등록 직전 채널 API 메타정보와 대조해야 합니다.</span></div>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: MarginResult["status"] }) {
  const tone = status === "목표 마진 충족" ? "success" : status === "가격 조정 검토" || status === "시장 자료 없음" ? "warning" : "danger";
  return <span className={`status-badge ${tone}`}><i />{status}</span>;
}
