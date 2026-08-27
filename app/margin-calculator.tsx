"use client";

import {
  AlertCircle,
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
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { channels, type ChannelKey } from "./channel-config";
import type { OperationMarginScenario, OperationProduct } from "./use-operations-snapshot";

type MarginForm = {
  sellingPrice: number;
  marketReferencePrice: number;
  purchaseCost: number;
  internationalShipping: number;
  localShipping: number;
  fulfillmentCost: number;
  fixedCost: number;
  taxRate: number;
  adRate: number;
  reserveRate: number;
  targetMargin: number;
};

type ChannelProfile = {
  key: ChannelKey;
  currency: "JPY" | "SGD" | "MYR" | "KRW" | "USD";
  symbol: string;
  rateToKrw: number;
  platformFee: number | null;
  paymentFee: number;
  requiresManualFee?: boolean;
};

type MarginResult = ChannelProfile & {
  feeReady: boolean;
  fixedCosts: number;
  variableRate: number;
  variableCost: number;
  profit: number;
  margin: number;
  breakEvenPrice: number;
  recommendedPrice: number;
  marketGapRate: number;
  status: "자동 등록 가능" | "가격 조정 권장" | "마진 기준 확인";
};

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

const marginChannelProfiles: ChannelProfile[] = [
  { key: "qoo10", currency: "JPY", symbol: "¥", rateToKrw: 8.7789, platformFee: 10, paymentFee: 2 },
  { key: "shopee", currency: "SGD", symbol: "S$", rateToKrw: 1098.9, platformFee: 10, paymentFee: 2.18 },
  { key: "lazada", currency: "MYR", symbol: "RM", rateToKrw: 344.83, platformFee: 10, paymentFee: 3 },
  { key: "coupang", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: 10.8, paymentFee: 0 },
  { key: "elevenst", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: null, paymentFee: 0, requiresManualFee: true },
  { key: "smartstore", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: 5.63, paymentFee: 0 },
  { key: "ebay", currency: "USD", symbol: "$", rateToKrw: 1388.89, platformFee: 12.35, paymentFee: 2.9 },
  { key: "temu", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: null, paymentFee: 0, requiresManualFee: true },
];

const defaultMarginForm: MarginForm = {
  sellingPrice: 0,
  marketReferencePrice: 0,
  purchaseCost: 0,
  internationalShipping: 0,
  localShipping: 0,
  fulfillmentCost: 0,
  fixedCost: 0,
  taxRate: 0,
  adRate: 0,
  reserveRate: 0,
  targetMargin: 25,
};

const defaultFeeOverrides = Object.fromEntries(
  marginChannelProfiles.map((channel) => [channel.key, channel.platformFee]),
) as Record<ChannelKey, number | null>;

const defaultPaymentFeeOverrides = Object.fromEntries(
  marginChannelProfiles.map((channel) => [channel.key, channel.paymentFee]),
) as Record<ChannelKey, number>;

const wonFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

function formatWon(value: number) {
  const absolute = wonFormatter.format(Math.abs(Math.round(value)));
  return `${value < 0 ? "−" : ""}₩${absolute}`;
}

function formatLocalPrice(valueInKrw: number, channel: ChannelProfile) {
  const localValue = valueInKrw / channel.rateToKrw;
  if (channel.currency === "KRW") return `${channel.symbol}${wonFormatter.format(Math.round(localValue))}`;
  if (channel.currency === "JPY") return `${channel.symbol}${wonFormatter.format(Math.ceil(localValue / 10) * 10)}`;
  return `${channel.symbol}${localValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatProductBasePrice(product: OperationProduct | null) {
  if (!product || (product.baseSellingPrice === null && !product.baseCurrency)) return "기준 판매가 미입력";
  if (product.baseSellingPrice === null) return `가격 미입력 · ${product.baseCurrency}`;
  if (!product.baseCurrency) {
    return `${product.baseSellingPrice.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} · 통화 미입력`;
  }
  return `${product.baseSellingPrice.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${product.baseCurrency}`;
}

function roundSellingPrice(value: number) {
  return Math.ceil(value / 100) * 100;
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

export function calculateMargins(form: MarginForm, feeOverrides: Record<ChannelKey, number | null>, paymentFeeOverrides: Record<ChannelKey, number>, profiles: ChannelProfile[]): MarginResult[] {
  const fixedCosts = form.purchaseCost + form.internationalShipping + form.localShipping + form.fulfillmentCost + form.fixedCost;

  return profiles.map((channel) => {
    const platformFee = feeOverrides[channel.key];
    const paymentFee = paymentFeeOverrides[channel.key];
    const feeReady = platformFee !== null && (!channel.requiresManualFee || platformFee > 0);
    const variableRate = (platformFee ?? 0) + paymentFee + form.taxRate + form.adRate + form.reserveRate;
    const variableCost = form.sellingPrice * (variableRate / 100);
    const profit = form.sellingPrice - fixedCosts - variableCost;
    const margin = form.sellingPrice > 0 ? (profit / form.sellingPrice) * 100 : 0;
    const breakEvenDenominator = 1 - variableRate / 100;
    const targetDenominator = breakEvenDenominator - form.targetMargin / 100;
    const breakEvenPrice = breakEvenDenominator > 0 ? roundSellingPrice(fixedCosts / breakEvenDenominator) : 0;
    const recommendedPrice = targetDenominator > 0 ? roundSellingPrice(fixedCosts / targetDenominator) : 0;
    const marketGapRate = form.marketReferencePrice > 0 ? ((recommendedPrice - form.marketReferencePrice) / form.marketReferencePrice) * 100 : 0;
    const status = !feeReady || !recommendedPrice
      ? "마진 기준 확인"
      : margin >= form.targetMargin
      ? "자동 등록 가능"
      : marketGapRate <= 8
        ? "가격 조정 권장"
        : "마진 기준 확인";

    return { ...channel, platformFee, paymentFee, feeReady, fixedCosts, variableRate, variableCost, profit, margin, breakEvenPrice, recommendedPrice, marketGapRate, status };
  });
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
  const [feeOverrides, setFeeOverrides] = useState<Record<ChannelKey, number | null>>(() => ({ ...defaultFeeOverrides }));
  const [paymentFeeOverrides, setPaymentFeeOverrides] = useState<Record<ChannelKey, number>>(() => ({ ...defaultPaymentFeeOverrides }));
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>("qoo10");
  const [localScenarios, setLocalScenarios] = useState<SavedScenario[]>([]);
  const [deletedScenarioIds, setDeletedScenarioIds] = useState<Set<string>>(() => new Set());
  const [savingScenario, setSavingScenario] = useState(false);
  const [referenceRates, setReferenceRates] = useState<Record<string, number>>({});
  const [rateBasis, setRateBasis] = useState("기준환율 확인 중");
  useEffect(() => {
    let active = true;
    const loadRates = async () => {
      const response = await fetch("/api/exchange-rates", { cache: "no-store" });
      const payload = await response.json() as { source?: string; asOf?: string; rates?: Array<{ code: string; unit: number; value: number }> };
      if (!response.ok || !Array.isArray(payload.rates)) throw new Error("기준환율 응답 오류");
      if (!active) return;
      setReferenceRates(Object.fromEntries(payload.rates.map((rate) => [rate.code, rate.value / Math.max(rate.unit, 1)])));
      setRateBasis(`${payload.source ?? "기준환율"} · ${payload.asOf ?? "기준일 확인 중"}`);
    };
    void loadRates().catch(() => {
      if (active) setRateBasis("최근 기준환율 대체값 · API 재확인 필요");
    });
    return () => { active = false; };
  }, []);
  const calculationProfiles = useMemo(() => marginChannelProfiles.map((profile) => ({
    ...profile,
    rateToKrw: profile.currency === "KRW" ? 1 : referenceRates[profile.currency] ?? profile.rateToKrw,
  })), [referenceRates]);
  const results = useMemo(() => calculateMargins(form, feeOverrides, paymentFeeOverrides, calculationProfiles), [calculationProfiles, form, feeOverrides, paymentFeeOverrides]);
  const selectedResult = results.find((result) => result.key === selectedChannel) ?? results[0];
  const selectedChannelInfo = channels[selectedChannel];
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const targetProgress = selectedResult.feeReady
    ? Math.max(0, Math.min(100, (selectedResult.margin / Math.max(form.targetMargin, 1)) * 100))
    : 0;
  const manualFeeMessage = `${selectedChannelInfo.name} 플랫폼 수수료를 직접 입력하세요.`;
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

  const resetInputs = () => {
    setSelectedProductId("");
    setForm({ ...defaultMarginForm });
    setFeeOverrides({ ...defaultFeeOverrides });
    setPaymentFeeOverrides({ ...defaultPaymentFeeOverrides });
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
    if (!selectedResult.feeReady) return notify(manualFeeMessage);
    if (!selectedResult.recommendedPrice) return;
    changeFormValue("sellingPrice", selectedResult.recommendedPrice);
    notify(`${selectedChannelInfo.name} 목표 마진 판매가 ${formatWon(selectedResult.recommendedPrice)}를 적용했습니다.`);
  };

  const saveScenario = async () => {
    if (savingScenario) return;
    if (!selectedResult.feeReady || selectedResult.platformFee === null) return notify(`${manualFeeMessage} 입력 후 계산 결과를 저장할 수 있습니다.`);
    if (!selectedProduct) return notify("마진 계산을 연결할 실제 상품을 먼저 선택해 주세요.");
    const now = new Date();
    const saved: SavedScenario = {
      id: `${selectedChannel}-${now.getTime()}`,
      productId: selectedProduct.id,
      product: selectedProduct.name,
      channelKey: selectedChannel,
      sellingPrice: form.sellingPrice,
      profit: selectedResult.profit,
      margin: selectedResult.margin,
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
          inputs: { ...form, productId: selectedProduct.id, platformFee: selectedResult.platformFee, paymentFee: selectedResult.paymentFee },
          result: {
            profit: selectedResult.profit,
            margin: selectedResult.margin,
            breakEvenPrice: selectedResult.breakEvenPrice,
            recommendedPrice: selectedResult.recommendedPrice,
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
      onChanged?.();
      notify("저장된 마진 계산을 운영 DB에서 삭제했습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "저장된 마진 계산을 삭제하지 못했습니다.");
    }
  };

  return (
    <div className="page-stack margin-page">
      <section className="margin-hero">
        <div className="margin-hero-copy">
          <span className="eyebrow"><Calculator size={14} /> PROFIT PRICING ENGINE</span>
          <h2>원가를 입력하면 8개 채널의<br /><em>팔아도 남는 가격</em>을 찾습니다.</h2>
          <p>수수료·환율·광고비·반품 충당금을 한 번에 반영해 자동 등록 전 마진 하한을 검증합니다.</p>
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
            <div className="margin-section-title"><span className="metric-icon blue"><WalletCards size={17} /></span><div><b>건당 고정 원가</b><small>주문 1건이 발생할 때 고정으로 빠지는 비용입니다.</small></div></div>
            <div className="margin-field-grid compact">
              <MarginNumberField id="purchase-cost" label="매입 원가" value={form.purchaseCost} suffix="원" onChange={(value) => changeFormValue("purchaseCost", value)} />
              <MarginNumberField id="international-shipping" label="국제 배송" value={form.internationalShipping} suffix="원" onChange={(value) => changeFormValue("internationalShipping", value)} />
              <MarginNumberField id="local-shipping" label="현지 배송" value={form.localShipping} suffix="원" onChange={(value) => changeFormValue("localShipping", value)} />
              <MarginNumberField id="fulfillment-cost" label="포장 · 3PL" value={form.fulfillmentCost} suffix="원" onChange={(value) => changeFormValue("fulfillmentCost", value)} />
              <MarginNumberField id="fixed-cost" label="통관 · 기타 고정비" value={form.fixedCost} suffix="원" onChange={(value) => changeFormValue("fixedCost", value)} />
            </div>
          </div>

          <div className="margin-field-section">
            <div className="margin-section-title"><span className="metric-icon orange"><Percent size={17} /></span><div><b>판매가 연동 비용</b><small>수수료는 선택 채널에만 수정 적용됩니다.</small></div></div>
            <div className="margin-field-grid compact">
              <MarginOptionalNumberField id="platform-fee" label={`${selectedChannelInfo.name} 수수료`} value={feeOverrides[selectedChannel]} suffix="%" hint={marginChannelProfiles.find((channel) => channel.key === selectedChannel)?.requiresManualFee ? "카테고리·계약의 실제 플랫폼 수수료를 직접 입력" : undefined} onChange={(value) => setFeeOverrides((current) => ({ ...current, [selectedChannel]: value }))} />
              <MarginNumberField id="payment-fee" label="결제 수수료" value={paymentFeeOverrides[selectedChannel]} suffix="%" step={0.1} hint="선택 채널에만 적용" onChange={(value) => setPaymentFeeOverrides((current) => ({ ...current, [selectedChannel]: value }))} />
              <MarginNumberField id="tax-rate" label="매출 연동 세금" value={form.taxRate} suffix="%" step={0.1} onChange={(value) => changeFormValue("taxRate", value)} />
              <MarginNumberField id="ad-rate" label="광고 · 쿠폰 부담" value={form.adRate} suffix="%" step={0.1} onChange={(value) => changeFormValue("adRate", value)} />
              <MarginNumberField id="reserve-rate" label="반품 · 분실 충당" value={form.reserveRate} suffix="%" step={0.1} onChange={(value) => changeFormValue("reserveRate", value)} />
              <MarginNumberField id="target-margin" label="목표 마진율" value={form.targetMargin} suffix="%" step={0.5} onChange={(value) => changeFormValue("targetMargin", value)} />
            </div>
            {!selectedResult.feeReady ? <p className="margin-manual-fee-warning" role="status"><AlertCircle size={14} />{manualFeeMessage} 입력 전에는 예상 손익·권장가·비용 배분을 표시하지 않습니다.</p> : null}
          </div>
        </article>

        <div className="margin-result-column">
          <article className={`margin-result-card ${selectedResult.feeReady && selectedResult.margin >= form.targetMargin ? "positive" : "warning"}`}>
            <div className="margin-result-head"><div><span style={{ "--channel-color": selectedChannelInfo.color } as React.CSSProperties}>{selectedChannelInfo.mark}</span><div><small>{selectedChannelInfo.name} 예상 손익</small><b>{selectedResult.feeReady ? selectedResult.status : "계산 대기"}</b></div></div><em>{!selectedResult.feeReady ? <><AlertCircle size={15} />플랫폼 수수료 입력 필요</> : selectedResult.margin >= form.targetMargin ? <><CheckCircle2 size={15} />목표 마진 충족</> : <><AlertCircle size={15} />{(form.targetMargin - selectedResult.margin).toFixed(1)}%p 부족</>}</em></div>
            <div className="margin-profit-value"><small>주문 1건 예상 순이익</small><strong>{selectedResult.feeReady ? formatWon(selectedResult.profit) : "계산 대기"}</strong><span>{selectedResult.feeReady ? `${formatLocalPrice(form.sellingPrice, selectedResult)} 판매 기준` : manualFeeMessage}</span></div>
            <div className="margin-progress"><div><span>예상 마진율</span><b>{selectedResult.feeReady ? `${selectedResult.margin.toFixed(1)}%` : "—"}</b></div><span><i style={{ width: `${targetProgress}%` }} /></span><small>{selectedResult.feeReady ? `목표 ${form.targetMargin.toFixed(1)}% · 변동비율 ${selectedResult.variableRate.toFixed(2)}%` : "플랫폼 수수료 입력 후 계산됩니다."}</small></div>
            <div className="margin-result-actions"><button type="button" onClick={applyRecommendedPrice} disabled={!selectedResult.feeReady || !selectedResult.recommendedPrice} title={!selectedResult.feeReady ? manualFeeMessage : undefined}><Target size={15} />권장 판매가 적용</button><button type="button" onClick={() => void saveScenario()} disabled={savingScenario || !selectedResult.feeReady} title={!selectedResult.feeReady ? manualFeeMessage : undefined}><Save size={15} />{savingScenario ? "저장 중" : "계산 결과 저장"}</button></div>
          </article>

          <section className="margin-summary-grid">
            <article className="panel"><span className="metric-icon violet"><Target size={17} /></span><div><small>목표 마진 권장 판매가</small><strong>{selectedResult.feeReady ? formatWon(selectedResult.recommendedPrice) : "—"}</strong><em>{selectedResult.feeReady ? formatLocalPrice(selectedResult.recommendedPrice, selectedResult) : manualFeeMessage}</em></div></article>
            <article className="panel"><span className="metric-icon blue"><TrendingUp size={17} /></span><div><small>손익분기 판매가</small><strong>{selectedResult.feeReady ? formatWon(selectedResult.breakEvenPrice) : "—"}</strong><em>{selectedResult.feeReady ? "이 가격부터 손실 없음" : "수수료 입력 후 계산"}</em></div></article>
            <article className="panel"><span className="metric-icon orange"><Percent size={17} /></span><div><small>시장 참고가 대비 권장가</small><strong>{selectedResult.feeReady ? `${selectedResult.marketGapRate >= 0 ? "+" : ""}${selectedResult.marketGapRate.toFixed(1)}%` : "—"}</strong><em>{selectedResult.feeReady ? selectedResult.marketGapRate <= 8 ? "시장 범위 내" : "시장성 재검토 필요" : "수수료 입력 후 계산"}</em></div></article>
          </section>

          <article className="panel margin-breakdown">
            <div className="panel-heading"><div><span className="panel-kicker">COST BREAKDOWN</span><h3>판매가 1건 배분</h3></div><b>{selectedResult.feeReady ? formatWon(form.sellingPrice) : "계산 대기"}</b></div>
            {selectedResult.feeReady ? <><div className="margin-stack-bar" aria-label="판매가 비용 배분"><i className="fixed" style={{ width: `${Math.min(100, (selectedResult.fixedCosts / Math.max(form.sellingPrice, 1)) * 100)}%` }} /><i className="variable" style={{ width: `${Math.min(100, (selectedResult.variableCost / Math.max(form.sellingPrice, 1)) * 100)}%` }} /><i className={selectedResult.profit >= 0 ? "profit" : "loss"} style={{ width: `${Math.min(100, Math.abs(selectedResult.profit) / Math.max(form.sellingPrice, 1) * 100)}%` }} /></div>
            <div className="margin-breakdown-list"><div><span><i className="fixed" />고정 원가</span><b>{formatWon(selectedResult.fixedCosts)}</b><small>{((selectedResult.fixedCosts / Math.max(form.sellingPrice, 1)) * 100).toFixed(1)}%</small></div><div><span><i className="variable" />수수료 · 변동비</span><b>{formatWon(selectedResult.variableCost)}</b><small>{selectedResult.variableRate.toFixed(1)}%</small></div><div><span><i className={selectedResult.profit >= 0 ? "profit" : "loss"} />순이익</span><b>{formatWon(selectedResult.profit)}</b><small>{selectedResult.margin.toFixed(1)}%</small></div></div></> : <p className="margin-manual-fee-warning" role="status"><AlertCircle size={14} />{manualFeeMessage} 비용 배분은 요율 확인 후 표시됩니다.</p>}
          </article>
        </div>
      </section>

      <section className="panel margin-comparison-panel">
        <div className="panel-heading table-title"><div><span className="panel-kicker">8 CHANNEL COMPARISON</span><h3>동일 상품 · 채널별 예상 마진 비교</h3></div><span className="margin-sample-note">직접 입력 비용 · {rateBasis}</span></div>
        <div className="table-wrap"><table className="data-table margin-table"><thead><tr><th>채널</th><th>계획 판매가</th><th>플랫폼 + 결제 수수료</th><th>총 변동비율</th><th>예상 순이익</th><th>예상 마진율</th><th>권장 판매가</th><th>자동 등록 판정</th><th /></tr></thead><tbody>{results.map((result) => { const channel = channels[result.key]; return <tr key={result.key} className={selectedChannel === result.key ? "selected" : ""}><td><button className="margin-channel-cell" onClick={() => setSelectedChannel(result.key)}><span style={{ "--channel-color": channel.color } as React.CSSProperties}>{channel.mark}</span><b>{channel.name}</b><small>{result.currency}</small></button></td><td><b>{formatLocalPrice(form.sellingPrice, result)}</b><small>{formatWon(form.sellingPrice)}</small></td><td><b>{result.feeReady ? `${(result.platformFee ?? 0).toFixed(2)}% + ${result.paymentFee.toFixed(2)}%` : "직접 입력 필요"}</b></td><td><b>{result.feeReady ? `${result.variableRate.toFixed(2)}%` : "—"}</b></td><td><b className={result.profit >= 0 ? "profit-text" : "loss-text"}>{result.feeReady ? formatWon(result.profit) : "—"}</b></td><td><b className={result.margin >= form.targetMargin ? "profit-text" : "loss-text"}>{result.feeReady ? `${result.margin.toFixed(1)}%` : "—"}</b></td><td><b>{result.feeReady ? formatWon(result.recommendedPrice) : "—"}</b><small>{result.feeReady ? formatLocalPrice(result.recommendedPrice, result) : "요율 확인 후 계산"}</small></td><td><StatusPill status={result.status} /></td><td><button type="button" className="table-action" aria-label={`${channel.name} 계산 결과 보기`} onClick={() => setSelectedChannel(result.key)}><ArrowRight size={15} /></button></td></tr>; })}</tbody></table></div>
      </section>

      <section className="panel saved-margin-panel">
        <div className="panel-heading"><div><span className="panel-kicker">RECENT CALCULATIONS</span><h3>최근 저장한 계산</h3></div><small>운영 DB 저장 후 최근 5개를 화면에 표시합니다.</small></div>
        <div className="saved-margin-list">{scenarioState === "unavailable" ? <div className="live-empty-state" role="alert"><AlertCircle size={25} /><b>저장된 계산 이력을 불러오지 못했습니다.</b><small>{scenarioMessage ?? "잠시 후 다시 확인해 주세요."}</small></div> : scenarioState === "checking" && savedScenarios.length === 0 ? <div className="live-empty-state" role="status"><RefreshCw size={25} /><b>저장된 계산 이력을 확인하고 있습니다.</b><small>상품·주문 원장은 먼저 사용할 수 있습니다.</small></div> : <>{savedScenarios.map((scenario) => { const channel = channels[scenario.channelKey]; return <article key={scenario.id}><span style={{ "--channel-color": channel.color } as React.CSSProperties}>{channel.mark}</span><div><b>{scenario.product}</b><small>{channel.name} · {scenario.savedAt}{scenario.productId ? " · 상품 연결됨" : " · 기존 미연결 계산"}</small></div><dl><div><dt>판매가</dt><dd>{formatWon(scenario.sellingPrice)}</dd></div><div><dt>순이익</dt><dd>{formatWon(scenario.profit)}</dd></div><div><dt>마진</dt><dd>{scenario.margin.toFixed(1)}%</dd></div></dl><button type="button" aria-label={`${scenario.product} 계산 삭제`} onClick={() => void deleteScenario(scenario)}><Trash2 size={15} /></button></article>; })}{savedScenarios.length === 0 ? <div className="live-empty-state"><Calculator size={25} /><b>저장된 실제 계산이 없습니다.</b><small>상품 비용을 입력하고 결과를 운영 DB에 저장하면 여기에 표시됩니다.</small></div> : null}</>}</div>
        <div className="margin-disclaimer"><AlertCircle size={15} /><span><b>입력값 기반 예상 계산입니다.</b> 채널 수수료는 카테고리·판매자 등급·프로모션 기간에 따라 달라질 수 있으므로 등록 직전 채널 API 메타정보와 대조해야 합니다.</span></div>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: MarginResult["status"] }) {
  const tone = status === "자동 등록 가능" ? "success" : status === "가격 조정 권장" ? "warning" : "danger";
  return <span className={`status-badge ${tone}`}><i />{status}</span>;
}
