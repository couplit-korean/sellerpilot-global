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
import { useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { channels, type ChannelKey } from "./channel-config";

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
  platformFee: number;
  paymentFee: number;
};

type MarginResult = ChannelProfile & {
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
  product: string;
  channelKey: ChannelKey;
  sellingPrice: number;
  profit: number;
  margin: number;
  savedAt: string;
};

const marginChannelProfiles: ChannelProfile[] = [
  { key: "qoo10", currency: "JPY", symbol: "¥", rateToKrw: 9.3112, platformFee: 10, paymentFee: 2 },
  { key: "shopee", currency: "SGD", symbol: "S$", rateToKrw: 1072.65, platformFee: 10, paymentFee: 2.18 },
  { key: "lazada", currency: "MYR", symbol: "RM", rateToKrw: 325.84, platformFee: 10, paymentFee: 3 },
  { key: "coupang", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: 10.8, paymentFee: 0 },
  { key: "elevenst", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: 13, paymentFee: 0 },
  { key: "smartstore", currency: "KRW", symbol: "₩", rateToKrw: 1, platformFee: 5.63, paymentFee: 0 },
  { key: "ebay", currency: "USD", symbol: "$", rateToKrw: 1378.4, platformFee: 12.35, paymentFee: 2.9 },
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
) as Record<ChannelKey, number>;

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

function calculateMargins(form: MarginForm, feeOverrides: Record<ChannelKey, number>, paymentFeeOverrides: Record<ChannelKey, number>): MarginResult[] {
  const fixedCosts = form.purchaseCost + form.internationalShipping + form.localShipping + form.fulfillmentCost + form.fixedCost;

  return marginChannelProfiles.map((channel) => {
    const platformFee = feeOverrides[channel.key];
    const paymentFee = paymentFeeOverrides[channel.key];
    const variableRate = platformFee + paymentFee + form.taxRate + form.adRate + form.reserveRate;
    const variableCost = form.sellingPrice * (variableRate / 100);
    const profit = form.sellingPrice - fixedCosts - variableCost;
    const margin = form.sellingPrice > 0 ? (profit / form.sellingPrice) * 100 : 0;
    const breakEvenDenominator = 1 - variableRate / 100;
    const targetDenominator = breakEvenDenominator - form.targetMargin / 100;
    const breakEvenPrice = breakEvenDenominator > 0 ? roundSellingPrice(fixedCosts / breakEvenDenominator) : 0;
    const recommendedPrice = targetDenominator > 0 ? roundSellingPrice(fixedCosts / targetDenominator) : 0;
    const marketGapRate = form.marketReferencePrice > 0 ? ((recommendedPrice - form.marketReferencePrice) / form.marketReferencePrice) * 100 : 0;
    const status = !recommendedPrice
      ? "마진 기준 확인"
      : margin >= form.targetMargin
      ? "자동 등록 가능"
      : marketGapRate <= 8
        ? "가격 조정 권장"
        : "마진 기준 확인";

    return { ...channel, platformFee, paymentFee, fixedCosts, variableRate, variableCost, profit, margin, breakEvenPrice, recommendedPrice, marketGapRate, status };
  });
}

export function MarginCalculatorPage({ notify }: { notify: (message: string) => void }) {
  const [productName, setProductName] = useState("");
  const [form, setForm] = useState<MarginForm>(() => ({ ...defaultMarginForm }));
  const [feeOverrides, setFeeOverrides] = useState<Record<ChannelKey, number>>(() => ({ ...defaultFeeOverrides }));
  const [paymentFeeOverrides, setPaymentFeeOverrides] = useState<Record<ChannelKey, number>>(() => ({ ...defaultPaymentFeeOverrides }));
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>("qoo10");
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [savingScenario, setSavingScenario] = useState(false);
  const results = useMemo(() => calculateMargins(form, feeOverrides, paymentFeeOverrides), [form, feeOverrides, paymentFeeOverrides]);
  const selectedResult = results.find((result) => result.key === selectedChannel) ?? results[0];
  const selectedChannelInfo = channels[selectedChannel];
  const targetProgress = Math.max(0, Math.min(100, (selectedResult.margin / Math.max(form.targetMargin, 1)) * 100));

  const changeFormValue = (key: keyof MarginForm, value: number) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resetInputs = () => {
    setProductName("");
    setForm({ ...defaultMarginForm });
    setFeeOverrides({ ...defaultFeeOverrides });
    setPaymentFeeOverrides({ ...defaultPaymentFeeOverrides });
    setSelectedChannel("qoo10");
    notify("마진 계산 입력값을 초기화했습니다.");
  };

  const applyRecommendedPrice = () => {
    if (!selectedResult.recommendedPrice) return;
    changeFormValue("sellingPrice", selectedResult.recommendedPrice);
    notify(`${selectedChannelInfo.name} 목표 마진 판매가 ${formatWon(selectedResult.recommendedPrice)}를 적용했습니다.`);
  };

  const saveScenario = async () => {
    if (savingScenario) return;
    const now = new Date();
    const saved: SavedScenario = {
      id: `${selectedChannel}-${now.getTime()}`,
      product: productName.trim() || "상품명 미입력",
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
          inputs: { ...form, platformFee: selectedResult.platformFee, paymentFee: selectedResult.paymentFee },
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
      setSavedScenarios((current) => [{ ...saved, id: payload.id ?? saved.id }, ...current].slice(0, 5));
      notify(`${selectedChannelInfo.name} 마진 계산 결과를 운영 DB에 저장했습니다.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "마진 계산 결과를 저장하지 못했습니다.");
    } finally {
      setSavingScenario(false);
    }
  };

  return (
    <div className="page-stack margin-page">
      <section className="margin-hero">
        <div className="margin-hero-copy">
          <span className="eyebrow"><Calculator size={14} /> PROFIT PRICING ENGINE</span>
          <h2>원가를 입력하면 7개 채널의<br /><em>팔아도 남는 가격</em>을 찾습니다.</h2>
          <p>수수료·환율·광고비·반품 충당금을 한 번에 반영해 자동 등록 전 마진 하한을 검증합니다.</p>
        </div>
        <div className="margin-formula-card">
          <span><Calculator size={17} />계산 기준</span>
          <strong>최소 판매가 = 고정 원가 ÷<br />(1 − 변동비율 − 목표 마진율)</strong>
          <small>모든 금액은 원화로 계산한 뒤 채널 통화로 환산합니다.</small>
        </div>
      </section>

      <div className="margin-channel-tabs" role="tablist" aria-label="마진 계산 채널 선택">
        {marginChannelProfiles.map((channel) => {
          const channelInfo = channels[channel.key];
          const active = selectedChannel === channel.key;
          return <button key={channel.key} role="tab" aria-selected={active} className={active ? "active" : ""} style={{ "--channel-color": channelInfo.color } as React.CSSProperties} onClick={() => setSelectedChannel(channel.key)}><span>{channelInfo.letter}</span><b>{channelInfo.name}</b><small>{channel.currency}</small></button>;
        })}
      </div>

      <section className="margin-workspace">
        <article className="panel margin-input-panel">
          <div className="panel-heading margin-panel-heading"><div><span className="panel-kicker">COST INPUT</span><h3>상품 원가 · 비용 입력</h3></div><button type="button" className="filter-button" onClick={resetInputs}><RefreshCw size={14} />입력값 초기화</button></div>

          <label className="margin-product-field" htmlFor="margin-product-name"><span>계산 상품</span><input id="margin-product-name" value={productName} onChange={(event) => setProductName(event.target.value)} /></label>

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
              <MarginNumberField id="platform-fee" label={`${selectedChannelInfo.name} 수수료`} value={feeOverrides[selectedChannel]} suffix="%" step={0.1} onChange={(value) => setFeeOverrides((current) => ({ ...current, [selectedChannel]: value }))} />
              <MarginNumberField id="payment-fee" label="결제 수수료" value={paymentFeeOverrides[selectedChannel]} suffix="%" step={0.1} hint="선택 채널에만 적용" onChange={(value) => setPaymentFeeOverrides((current) => ({ ...current, [selectedChannel]: value }))} />
              <MarginNumberField id="tax-rate" label="매출 연동 세금" value={form.taxRate} suffix="%" step={0.1} onChange={(value) => changeFormValue("taxRate", value)} />
              <MarginNumberField id="ad-rate" label="광고 · 쿠폰 부담" value={form.adRate} suffix="%" step={0.1} onChange={(value) => changeFormValue("adRate", value)} />
              <MarginNumberField id="reserve-rate" label="반품 · 분실 충당" value={form.reserveRate} suffix="%" step={0.1} onChange={(value) => changeFormValue("reserveRate", value)} />
              <MarginNumberField id="target-margin" label="목표 마진율" value={form.targetMargin} suffix="%" step={0.5} onChange={(value) => changeFormValue("targetMargin", value)} />
            </div>
          </div>
        </article>

        <div className="margin-result-column">
          <article className={`margin-result-card ${selectedResult.margin >= form.targetMargin ? "positive" : "warning"}`}>
            <div className="margin-result-head"><div><span style={{ "--channel-color": selectedChannelInfo.color } as React.CSSProperties}>{selectedChannelInfo.letter}</span><div><small>{selectedChannelInfo.name} 예상 손익</small><b>{selectedResult.status}</b></div></div><em>{selectedResult.margin >= form.targetMargin ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{selectedResult.margin >= form.targetMargin ? "목표 마진 충족" : `${(form.targetMargin - selectedResult.margin).toFixed(1)}%p 부족`}</em></div>
            <div className="margin-profit-value"><small>주문 1건 예상 순이익</small><strong>{formatWon(selectedResult.profit)}</strong><span>{formatLocalPrice(form.sellingPrice, selectedResult)} 판매 기준</span></div>
            <div className="margin-progress"><div><span>예상 마진율</span><b>{selectedResult.margin.toFixed(1)}%</b></div><span><i style={{ width: `${targetProgress}%` }} /></span><small>목표 {form.targetMargin.toFixed(1)}% · 변동비율 {selectedResult.variableRate.toFixed(2)}%</small></div>
            <div className="margin-result-actions"><button type="button" onClick={applyRecommendedPrice}><Target size={15} />권장 판매가 적용</button><button type="button" onClick={() => void saveScenario()} disabled={savingScenario}><Save size={15} />{savingScenario ? "저장 중" : "계산 결과 저장"}</button></div>
          </article>

          <section className="margin-summary-grid">
            <article className="panel"><span className="metric-icon violet"><Target size={17} /></span><div><small>목표 마진 권장 판매가</small><strong>{formatWon(selectedResult.recommendedPrice)}</strong><em>{formatLocalPrice(selectedResult.recommendedPrice, selectedResult)}</em></div></article>
            <article className="panel"><span className="metric-icon blue"><TrendingUp size={17} /></span><div><small>손익분기 판매가</small><strong>{formatWon(selectedResult.breakEvenPrice)}</strong><em>이 가격부터 손실 없음</em></div></article>
            <article className="panel"><span className="metric-icon orange"><Percent size={17} /></span><div><small>시장 참고가 대비 권장가</small><strong>{selectedResult.marketGapRate >= 0 ? "+" : ""}{selectedResult.marketGapRate.toFixed(1)}%</strong><em>{selectedResult.marketGapRate <= 8 ? "시장 범위 내" : "시장성 재검토 필요"}</em></div></article>
          </section>

          <article className="panel margin-breakdown">
            <div className="panel-heading"><div><span className="panel-kicker">COST BREAKDOWN</span><h3>판매가 1건 배분</h3></div><b>{formatWon(form.sellingPrice)}</b></div>
            <div className="margin-stack-bar" aria-label="판매가 비용 배분"><i className="fixed" style={{ width: `${Math.min(100, (selectedResult.fixedCosts / Math.max(form.sellingPrice, 1)) * 100)}%` }} /><i className="variable" style={{ width: `${Math.min(100, (selectedResult.variableCost / Math.max(form.sellingPrice, 1)) * 100)}%` }} /><i className={selectedResult.profit >= 0 ? "profit" : "loss"} style={{ width: `${Math.min(100, Math.abs(selectedResult.profit) / Math.max(form.sellingPrice, 1) * 100)}%` }} /></div>
            <div className="margin-breakdown-list"><div><span><i className="fixed" />고정 원가</span><b>{formatWon(selectedResult.fixedCosts)}</b><small>{((selectedResult.fixedCosts / Math.max(form.sellingPrice, 1)) * 100).toFixed(1)}%</small></div><div><span><i className="variable" />수수료 · 변동비</span><b>{formatWon(selectedResult.variableCost)}</b><small>{selectedResult.variableRate.toFixed(1)}%</small></div><div><span><i className={selectedResult.profit >= 0 ? "profit" : "loss"} />순이익</span><b>{formatWon(selectedResult.profit)}</b><small>{selectedResult.margin.toFixed(1)}%</small></div></div>
          </article>
        </div>
      </section>

      <section className="panel margin-comparison-panel">
        <div className="panel-heading table-title"><div><span className="panel-kicker">7 CHANNEL COMPARISON</span><h3>동일 상품 · 채널별 예상 마진 비교</h3></div><span className="margin-sample-note">직접 입력 비용 · 기준 환율 적용</span></div>
        <div className="table-wrap"><table className="data-table margin-table"><thead><tr><th>채널</th><th>계획 판매가</th><th>플랫폼 + 결제 수수료</th><th>총 변동비율</th><th>예상 순이익</th><th>예상 마진율</th><th>권장 판매가</th><th>자동 등록 판정</th><th /></tr></thead><tbody>{results.map((result) => { const channel = channels[result.key]; return <tr key={result.key} className={selectedChannel === result.key ? "selected" : ""}><td><button className="margin-channel-cell" onClick={() => setSelectedChannel(result.key)}><span style={{ "--channel-color": channel.color } as React.CSSProperties}>{channel.letter}</span><b>{channel.name}</b><small>{result.currency}</small></button></td><td><b>{formatLocalPrice(form.sellingPrice, result)}</b><small>{formatWon(form.sellingPrice)}</small></td><td><b>{result.platformFee.toFixed(2)}% + {result.paymentFee.toFixed(2)}%</b></td><td><b>{result.variableRate.toFixed(2)}%</b></td><td><b className={result.profit >= 0 ? "profit-text" : "loss-text"}>{formatWon(result.profit)}</b></td><td><b className={result.margin >= form.targetMargin ? "profit-text" : "loss-text"}>{result.margin.toFixed(1)}%</b></td><td><b>{formatWon(result.recommendedPrice)}</b><small>{formatLocalPrice(result.recommendedPrice, result)}</small></td><td><StatusPill status={result.status} /></td><td><button type="button" className="table-action" aria-label={`${channel.name} 계산 결과 보기`} onClick={() => setSelectedChannel(result.key)}><ArrowRight size={15} /></button></td></tr>; })}</tbody></table></div>
      </section>

      <section className="panel saved-margin-panel">
        <div className="panel-heading"><div><span className="panel-kicker">RECENT CALCULATIONS</span><h3>최근 저장한 계산</h3></div><small>운영 DB 저장 후 최근 5개를 화면에 표시합니다.</small></div>
        <div className="saved-margin-list">{savedScenarios.map((scenario) => { const channel = channels[scenario.channelKey]; return <article key={scenario.id}><span style={{ "--channel-color": channel.color } as React.CSSProperties}>{channel.letter}</span><div><b>{scenario.product}</b><small>{channel.name} · {scenario.savedAt}</small></div><dl><div><dt>판매가</dt><dd>{formatWon(scenario.sellingPrice)}</dd></div><div><dt>순이익</dt><dd>{formatWon(scenario.profit)}</dd></div><div><dt>마진</dt><dd>{scenario.margin.toFixed(1)}%</dd></div></dl><button type="button" aria-label={`${scenario.product} 계산 삭제`} onClick={() => setSavedScenarios((current) => current.filter((item) => item.id !== scenario.id))}><Trash2 size={15} /></button></article>; })}{savedScenarios.length === 0 ? <div className="live-empty-state"><Calculator size={25} /><b>저장된 실제 계산이 없습니다.</b><small>상품 비용을 입력하고 결과를 운영 DB에 저장하면 여기에 표시됩니다.</small></div> : null}</div>
        <div className="margin-disclaimer"><AlertCircle size={15} /><span><b>입력값 기반 예상 계산입니다.</b> 채널 수수료는 카테고리·판매자 등급·프로모션 기간에 따라 달라질 수 있으므로 등록 직전 채널 API 메타정보와 대조해야 합니다.</span></div>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: MarginResult["status"] }) {
  const tone = status === "자동 등록 가능" ? "success" : status === "가격 조정 권장" ? "warning" : "danger";
  return <span className={`status-badge ${tone}`}><i />{status}</span>;
}
