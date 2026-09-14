"use client";

import { useState } from "react";
import { quoteShopeePrice, shopeePriceMarkets } from "../lib/pricing/shopee-price-tool";
import styles from "./shopee-price-tool.module.css";

export type ShopeePriceQuote = Extract<ReturnType<typeof quoteShopeePrice>, { ok: true }>;
type Props = {
  market: string;
  currency: string;
  currentPrice: number | null;
  weightKg: number;
  disabled?: boolean;
  onApply: (quote: ShopeePriceQuote) => boolean;
};

export function ShopeePriceTool(props: Props) {
  const suppliedMarket = shopeePriceMarkets.find(item => item.market === props.market);
  const [previewMarket, setPreviewMarket] = useState(suppliedMarket?.market ?? "TW");
  const market = shopeePriceMarkets.find(item => item.market === previewMarket)!;
  return <details className={styles.panel}>
    <summary>쇼피 국가별 운임·판매가 계산 <span>2026.07.01 요율</span></summary>
    <div className={styles.body}>
      {!suppliedMarket && <p className={styles.notice}>현재 등록 국가 {props.market || "미선택"}의 요율은 제공된 7개 문서에 없습니다. 아래는 다른 국가의 비교 계산이며 현재 상품 가격에는 적용되지 않습니다.</p>}
      <label className={styles.country}>계산 국가<select aria-label="쇼피 운임 계산 국가" value={previewMarket} onChange={event => setPreviewMarket(event.target.value)}>
        {shopeePriceMarkets.map(item => <option key={item.market} value={item.market}>{item.name} · {item.currency}</option>)}
      </select></label>
      <ShopeePriceCalculator key={previewMarket} {...props} selected={market} />
    </div>
  </details>;
}

function ShopeePriceCalculator(props: Props & { selected: typeof shopeePriceMarkets[number] }) {
  const { selected } = props;
  const [serviceKey, setServiceKey] = useState(selected.services[0].key);
  const service = selected.services.find(item => item.key === serviceKey)!;
  const [zone, setZone] = useState(service.zones[0]);
  const [basePrice, setBasePrice] = useState(props.market === selected.market && props.currency === selected.currency && props.currentPrice && props.currentPrice > 0 ? String(props.currentPrice) : "");
  const [volumetricKg, setVolumetricKg] = useState("");
  const [transaction, setTransaction] = useState(String(selected.transactionPercent));
  const [commission, setCommission] = useState(String(selected.commissionPercent));
  const [markup, setMarkup] = useState("0");
  const [appliedSnapshot, setAppliedSnapshot] = useState("");
  const physicalGrams = props.weightKg * 1000;
  const volumetricGrams = volumetricKg.trim() ? Number(volumetricKg) * 1000 : 0;
  const weightValid = Number.isFinite(physicalGrams) && physicalGrams > 0 && Number.isFinite(volumetricGrams) && volumetricGrams >= 0;
  const billableGrams = weightValid ? Math.ceil((Math.max(physicalGrams, volumetricGrams) - 1e-8) / 10) * 10 : Number.NaN;
  const number = (value: string) => value.trim() ? Number(value) : Number.NaN;
  const quote = quoteShopeePrice({ market: selected.market, service: serviceKey, zone,
    weightGrams: billableGrams, basePrice: number(basePrice), transactionPercent: number(transaction) === selected.transactionPercent ? undefined : number(transaction),
    commissionPercent: number(commission) === selected.commissionPercent ? undefined : number(commission), markupPercent: number(markup) });
  const sameTarget = props.market === selected.market && props.currency === selected.currency;
  const format = (value: number) => `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: selected.currency === "VND" ? 0 : 2 }).format(value)} ${selected.currency}`;
  const quoteSnapshot = JSON.stringify(quote);
  function change(set: (value: string) => void, value: string) { set(value); setAppliedSnapshot(""); }
  return <div>
    <div className={styles.grid}>
      <label>운송 방식<select aria-label="쇼피 운송 방식" value={serviceKey} onChange={event => {
        const next = selected.services.find(item => item.key === event.target.value)!;
        setServiceKey(next.key); setZone(next.zones[0]); setAppliedSnapshot("");
      }}>{selected.services.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label>배송 지역<select aria-label="쇼피 배송 지역" value={zone} onChange={event => change(setZone, event.target.value)}>{service.zones.map(item => <option key={item} value={item}>{item === "ALL" ? "공통" : `Zone ${item}`}</option>)}</select></label>
      <label>부피중량 kg (확인한 경우)<input aria-label="쇼피 부피중량 kg" type="number" min="0" step="0.01" value={volumetricKg} onChange={event => change(setVolumetricKg, event.target.value)} placeholder="운송사 기준으로 산출한 값" /></label>
      <label>상품 기준금액 {selected.currency}<input aria-label="쇼피 상품 기준금액" type="number" min="0.01" step="any" value={basePrice} onChange={event => change(setBasePrice, event.target.value)} placeholder="현지 통화로 입력" /></label>
      <label>거래 수수료 %<input aria-label="쇼피 거래 수수료 퍼센트" type="number" min="0" max="100" step="0.01" value={transaction} onChange={event => change(setTransaction, event.target.value)} /></label>
      <label>판매 수수료 %<input aria-label="쇼피 판매 수수료 퍼센트" type="number" min="0" max="100" step="0.01" value={commission} onChange={event => change(setCommission, event.target.value)} /></label>
      <label>추가 가격 인상 %<input aria-label="쇼피 선택 가격 인상 퍼센트" type="number" min="0" max="300" step="1" value={markup} onChange={event => change(setMarkup, event.target.value)} /></label>
    </div>
    <p className={styles.help}>포장 실중량 {Number.isFinite(physicalGrams) ? physicalGrams.toLocaleString("ko-KR") : "미입력"}g · 예상 청구중량 {Number.isFinite(billableGrams) ? billableGrams.toLocaleString("ko-KR") : "미입력"}g (큰 중량을 10g 단위로 올림). {volumetricKg.trim() ? "입력한 부피중량과 비교했습니다." : "부피중량 미입력으로 실중량 기준 예상입니다."}</p>
    <p className={styles.help}>기준금액은 원가와 필요한 국내 운송비 등을 고려한 현지 통화 금액입니다. 자료에는 환율·부피중량 환산계수가 없으므로 임의 환산하지 않습니다. 추가 인상 30%는 문서의 선택 예시이며 순이익률 30%를 뜻하지 않습니다.</p>
    <div aria-live="polite">
      {!quote.ok ? <p className={styles.notice}>{quote.message}</p> : <>
        <dl className={styles.results}>
          <div><dt>전체 해외운임</dt><dd>{format(quote.totalShipping)}</dd></div>
          <div><dt>구매자 배송비</dt><dd>{format(quote.buyerShipping)}</dd></div>
          <div><dt>판매자 부담 운임</dt><dd>{format(quote.sellerShipping)}</dd></div>
          <div><dt>거래 수수료</dt><dd>{format(quote.transactionFee)}</dd></div>
          <div><dt>판매 수수료</dt><dd>{format(quote.commissionFee)}</dd></div>
          <div><dt>운임·수수료를 더한 금액</dt><dd>{format(quote.calculatedPrice)}</dd></div>
          <div className={styles.total}><dt>선택 인상률 포함 예상 판매가</dt><dd>{format(quote.recommendedPrice)}</dd></div>
        </dl>
        <button type="button" className={styles.apply} disabled={!sameTarget || props.disabled} onClick={() => { if (props.onApply(quote)) setAppliedSnapshot(quoteSnapshot); }}>예상 판매가를 {selected.market} 등록 초안에 넣기</button>
        {appliedSnapshot === quoteSnapshot && sameTarget && <p className={styles.help} role="status">가격을 초안에 반영했습니다. 원격 상품은 아직 변경되지 않았습니다.</p>}
        {!sameTarget && <p className={styles.help}>현재 등록 대상은 {props.market || "미선택"}입니다. 다른 국가의 계산 금액은 적용할 수 없습니다.</p>}
        <details className={styles.evidence}><summary>계산 근거와 제외 비용 보기</summary>
          {quote.notes.length > 0 && <ul className={styles.notes}>{quote.notes.map(note => <li key={note}>{note}</li>)}</ul>}
          <p className={styles.help}>근거: {quote.sourceSheet} · {quote.sourceCells.join(", ")}</p>
        </details>
      </>}
    </div>
    <p className={styles.help}>수수료 기본값은 제공된 계산표 기준입니다. 계정의 실제 수수료로 수정할 수 있습니다. 인출수수료·별도 수입세·프로모션 비용은 이 합계에 포함되지 않습니다. 계산값은 물류 사용 권한이나 최종 청구 금액을 보장하지 않습니다.</p>
    <a href={selected.sourceUrl} target="_blank" rel="noreferrer">{selected.name} 원본 가격·요율표 보기</a>
  </div>;
}
