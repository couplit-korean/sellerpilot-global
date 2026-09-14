import rateData from "./shopee-rate-tables-20260701.json";

type Service = { key: string; label: string; zones: string[] };
type ServiceRule = Service & {
  totalColumns: string[];
  sellerColumn: string;
  buyerFees?: number[];
  buyerColumns?: string[];
  maximumGrams?: number;
  unsupported?: string;
};

// IDs identify rate-table services, not an assertion that a shop enables them.
const serviceRules: Record<string, ServiceRule[]> = {
  TW: [
    { key: "38015", label: "택배 / Home Delivery", zones: ["ALL"], totalColumns: ["I"], sellerColumn: "O", buyerFees: [70] },
    { key: "38016", label: "7-11", zones: ["ALL"], totalColumns: ["J"], sellerColumn: "O", buyerFees: [60] },
    { key: "38026", label: "Hi-Life", zones: ["ALL"], totalColumns: ["K"], sellerColumn: "O", buyerFees: [50] },
    { key: "38065", label: "SPX Collection Point", zones: ["ALL"], totalColumns: ["L"], sellerColumn: "O", buyerFees: [45] },
    { key: "38070", label: "SPX 5DD Collection Point", zones: ["ALL"], totalColumns: ["M"], sellerColumn: "O", buyerFees: [60] },
    { key: "38014", label: "F&B (구매자 배송비 미확인)", zones: ["ALL"], totalColumns: ["N"], sellerColumn: "O", unsupported: "F&B의 독립 구매자 배송비 근거가 없어 가격을 확정할 수 없습니다." },
  ],
  MX: [{ key: "108005", label: "Cosmetics channel", zones: ["ALL"], totalColumns: ["D"], sellerColumn: "E", buyerFees: [0] }],
  TH: [{ key: "78016", label: "국제 배송", zones: ["A", "B", "C"], totalColumns: ["F", "G", "H"], sellerColumn: "I", buyerFees: [22, 29, 79] }],
  BR: [{ key: "98002", label: "국제 배송", zones: ["A", "B", "C"], totalColumns: ["F", "G", "H"], sellerColumn: "I", buyerFees: [13, 17, 19] }],
  VN: ["58009", "58016"].map((key) => ({ key, label: `국제 배송 (${key})`, zones: ["A1", "A2", "B1", "B2"], totalColumns: ["G", "H", "I", "J"], sellerColumn: "K", buyerFees: [15_000, 17_000, 17_000, 30_000] })),
  MY: [
    ...["28050", "28062"].map((key) => ({ key, label: `Standard International / 5DD (${key})`, zones: ["A", "B", "C"], totalColumns: ["G", "H", "H"], sellerColumn: "I", buyerColumns: ["O", "P", "Q"] })),
    { key: "28037", label: "Buyer Self Collection (BSC)", zones: ["A", "B", "C"], totalColumns: ["J", "K", "K"], sellerColumn: "L", buyerFees: [0, 0, 0], maximumGrams: 10_000 },
  ],
  PH: ["48005", "48023"].map((key) => ({ key, label: `국제 배송 (${key})`, zones: ["A", "B", "C", "D"], totalColumns: ["F", "G", "H", "H"], sellerColumn: "I", buyerFees: [40, 60, 80, 80] })),
};

export const shopeePriceMarkets = rateData.markets.map((market) => ({
  market: market.market,
  name: market.name,
  currency: market.currency,
  sourceUrl: market.sourceUrl,
  sourceSheet: market.sourceSheet,
  transactionPercent: market.transactionPercent,
  commissionPercent: market.commissionPercent,
  services: (serviceRules[market.market] ?? []).map(({ key, label, zones }) => ({ key, label, zones: [...zones] })),
}));

export type ShopeePriceInput = {
  market: string;
  service: string;
  zone: string;
  weightGrams: number;
  basePrice: number;
  transactionPercent?: number;
  commissionPercent?: number;
  markupPercent?: number;
};
export type ShopeePriceSuccess = {
  ok: true;
  market: string;
  currency: string;
  weightGrams: number;
  totalShipping: number;
  buyerShipping: number;
  sellerShipping: number;
  transactionFee: number;
  commissionFee: number;
  calculatedPrice: number;
  recommendedPrice: number;
  sourceUrl: string;
  sourceSheet: string;
  sourceCells: string[];
  notes: string[];
};
export type ShopeePriceQuote = ShopeePriceSuccess | { ok: false; code: string; message: string };

const fail = (code: string, message: string): ShopeePriceQuote => ({ ok: false, code, message });
const textKey = (value: unknown) => typeof value === "string" ? value.trim().toUpperCase() : "";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// Only the eventual local listing price is rounded. Absorb arithmetic ULP noise
// at exact minor-unit boundaries, without rounding fee/price intermediate values.
function roundListingPriceUp(value: number, currency: string) {
  const scale = currency === "VND" ? 1 : 100;
  const scaled = value * scale;
  const nearest = Math.round(scaled);
  const stable = Math.abs(scaled - nearest) <= Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4 ? nearest : scaled;
  return Math.ceil(stable) / scale;
}

export function quoteShopeePrice(input: ShopeePriceInput): ShopeePriceQuote {
  if (!input || typeof input !== "object") return fail("INVALID_INPUT", "계산에 필요한 입력이 없습니다.");
  const marketKey = textKey(input.market);
  const table = rateData.markets.find((entry) => entry.market === marketKey);
  if (!table) return fail("UNSUPPORTED_MARKET", marketKey === "SG" ? "제공 문서에 싱가포르 요율표가 없어 계산할 수 없습니다." : "제공 요율표에 없는 마켓입니다.");
  const service = serviceRules[marketKey]?.find((entry) => entry.key === input.service);
  if (!service) return fail("UNSUPPORTED_SERVICE", "해당 마켓의 문서에 있는 배송 서비스를 선택하세요.");
  if (service.unsupported) return fail("BUYER_SHIPPING_UNVERIFIED", service.unsupported);
  const zoneIndex = service.zones.indexOf(textKey(input.zone));
  if (zoneIndex < 0) return fail("UNSUPPORTED_ZONE", "선택한 배송 서비스의 Zone을 선택하세요.");
  if (!finite(input.weightGrams) || !Number.isSafeInteger(input.weightGrams) || input.weightGrams <= 0 || input.weightGrams % 10 !== 0) {
    return fail("INVALID_WEIGHT", "청구 중량을 양수 10g 단위로 입력하세요. 자동 내림이나 외삽은 하지 않습니다.");
  }
  if (input.weightGrams > Math.min(table.maximumGrams, service.maximumGrams ?? table.maximumGrams)) {
    return fail("WEIGHT_OUT_OF_RANGE", service.maximumGrams === 10_000 ? "BSC 요율은 10kg까지만 제공됩니다." : `제공 요율표의 상한 ${table.maximumGrams.toLocaleString("ko-KR")}g을 초과했습니다.`);
  }
  if (!finite(input.basePrice) || input.basePrice <= 0) return fail("INVALID_BASE_PRICE", `상품 기준가격을 양수 ${table.currency} 금액으로 입력하세요.`);
  const transactionPercent = input.transactionPercent === undefined ? table.transactionPercent : input.transactionPercent;
  const commissionPercent = input.commissionPercent === undefined ? table.commissionPercent : input.commissionPercent;
  const markupPercent = input.markupPercent === undefined ? 0 : input.markupPercent;
  if (![transactionPercent, commissionPercent].every((value) => finite(value) && value >= 0 && value <= 100) || !finite(markupPercent) || markupPercent < 0) {
    return fail("INVALID_PERCENT", "수수료는 0~100%, 추천 인상률은 0 이상의 유한한 숫자로 입력하세요.");
  }

  const segment = table.segments.find((entry) => typeof entry[0] === "number" && typeof entry[1] === "number" && entry[0] <= input.weightGrams && input.weightGrams <= entry[1]);
  if (!segment || typeof segment[0] !== "number" || !Array.isArray(segment[2]) || !Array.isArray(segment[3])) return fail("RATE_UNAVAILABLE", "해당 청구 중량의 요율이 없습니다.");
  const start = segment[0];
  const values = segment[2];
  const deltas = segment[3];
  const read = (column: string) => {
    const index = table.columns.indexOf(column);
    const value = values[index];
    const delta = deltas[index];
    return finite(value) && finite(delta) ? value + ((input.weightGrams - start) / 10) * delta : NaN;
  };
  const row = table.firstRow + input.weightGrams / 10 - 1;
  const sellerColumn = marketKey === "MY" && service.key === "28037" && zoneIndex > 0 ? "K" : service.sellerColumn;
  const sourceCells = [`${table.sourceSheet}!A${row}`, `${table.sourceSheet}!${service.totalColumns[zoneIndex]}${row}`, `${table.sourceSheet}!${sellerColumn}${row}`, `${table.feeSourceSheet}!${table.feeSourceRange}`];
  const totalShipping = read(service.totalColumns[zoneIndex]);
  const buyerShipping = service.buyerColumns ? read(service.buyerColumns[zoneIndex]) : service.buyerFees?.[zoneIndex] ?? NaN;
  // The BSC L column is Zone A only; B/C use their full K rate with buyer fee 0.
  const sellerShipping = read(sellerColumn);
  if (service.buyerColumns) sourceCells.push(`${table.sourceSheet}!${service.buyerColumns[zoneIndex]}${row}`);
  else if (marketKey === "TW") sourceCells.push(`TW Price Tool!Q${43 + serviceRules.TW.indexOf(service)}`);
  else if (marketKey === "MY") sourceCells.push(`${table.sourceSheet}!${["O", "P", "Q"][zoneIndex]}6`);
  else sourceCells.push(`${table.feeSourceSheet}!${({ VN: "P27", PH: "R27", TH: "P26:P32", BR: "P28", MX: "F7" } as Record<string, string>)[marketKey]}`);
  if (![totalShipping, buyerShipping, sellerShipping].every((value) => finite(value) && value >= 0) || Math.abs(totalShipping - buyerShipping - sellerShipping) > 1e-6) {
    return fail("RATE_UNAVAILABLE", "총 운임·구매자 부담·판매자 부담의 요율 근거가 일치하지 않습니다.");
  }

  // MY's provided PriceTool PG basis uses the base ESF, excluding >800g extras.
  const transactionBuyerBasis = marketKey === "MY" && service.key !== "28037" ? (zoneIndex === 0 ? 4.9 : 8) : buyerShipping;
  const transactionFee = (input.basePrice + transactionBuyerBasis) * (transactionPercent / 100);
  const commissionFee = (input.basePrice + sellerShipping + transactionFee) * (commissionPercent / 100);
  const calculatedPrice = input.basePrice + sellerShipping + transactionFee + commissionFee;
  const recommendedPrice = roundListingPriceUp(calculatedPrice * (1 + markupPercent / 100), table.currency);
  const scale = table.currency === "VND" ? 1 : 100;
  if (![transactionFee, commissionFee, calculatedPrice, recommendedPrice].every(finite) || recommendedPrice <= 0 || !Number.isSafeInteger(Math.round(recommendedPrice * scale))) {
    return fail("INVALID_RESULT", "가격이 계산 가능한 금액 범위를 벗어났습니다.");
  }
  const notes = [
    "제공 문서의 2026.07.01 요율 기준 참고 계산이며, 표 상한은 실제 상품의 운송 접수나 물류 채널 활성화를 보장하지 않습니다.",
    "입력 기준가격은 현지 통화입니다. 환율·국내배송비를 자동 환산하거나 추가하지 않습니다.",
    "PG·판매수수료를 문서 순서로 합산합니다. 출금 수수료·상품 세금·FSP/CCB·기타 프로그램 비용은 추가 계산하지 않았습니다.",
    `추천 인상률 ${markupPercent}%는 선택한 가격 인상률이며 순이익률 보장이 아닙니다. 최종 추천가만 ${table.currency === "VND" ? "1 VND" : `0.01 ${table.currency}`} 단위로 올림합니다.`,
  ];
  if (marketKey === "TW") notes.push("서비스별 구매자 고정비와 NEW 표 O열 공통 판매자 부담을 대조했습니다. 구매자 배송비의 VAT 별도 안내가 있으나 세율은 이 자료에 없습니다.");
  if (marketKey === "MX") notes.push("이 표는 Cosmetics channel 전용입니다. 음료 등 다른 품목의 접수 가능성을 승인하거나 실제 물류 채널을 선택하지 않습니다.");
  if (marketKey === "MY") notes.push(service.key === "28037" ? "BSC는 구매자 배송비 0이며 10kg까지만 요율이 있습니다. Zone B/C의 판매자 부담은 K열 총운임입니다." : "MY 문서 I/J 뒤집힘을 적용하지 않고 NEW I열 판매자 실부담을 사용합니다. PG는 문서의 기본 ESF만 포함하며 800g 초과 추가 ESF는 제외합니다.");
  if (marketKey === "PH") notes.push("PH PriceTool의 Zone C&D 열을 Zone A에 사용하는 오류를 적용하지 않았습니다. PG 수식은 2.4%지만 구 설명에는 2.24%가 남아 있어 실제 숍 요율을 확인하세요.");
  if (marketKey === "PH" && textKey(input.zone) === "D") notes.push("Zone D 구매자 배송비 80PHP는 NEW H4의 C&D 총운임과 I4의 전 Zone 공통 실부담 차이로 도출했습니다. 독립 구매자 안내문 값은 아닙니다.");
  if (marketKey === "VN") notes.push("문서의 PG 4.91%·판매수수료 17%는 VAT 포함 안내입니다. 별도 상품 VAT·수입세를 0으로 확정하거나 VAT를 중복 추가하지 않습니다.");
  if (input.transactionPercent !== undefined || input.commissionPercent !== undefined) notes.push("수수료는 사용자가 입력한 값을 사용했습니다. 문서 기본요율과 구분해 확인하세요.");
  return { ok: true, market: table.market, currency: table.currency, weightGrams: input.weightGrams, totalShipping, buyerShipping, sellerShipping, transactionFee, commissionFee, calculatedPrice, recommendedPrice, sourceUrl: table.sourceUrl, sourceSheet: table.sourceSheet, sourceCells: [...new Set(sourceCells)], notes };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function applyShopeePriceToDraft(draft: Record<string, unknown>, quote: ShopeePriceSuccess, target: { market: string; currency: string }): Record<string, unknown> {
  const known = shopeePriceMarkets.find((entry) => entry.market === textKey(target?.market));
  if (!known || !quote || quote.ok !== true || quote.market !== known.market || quote.currency !== known.currency || textKey(target?.currency) !== known.currency) {
    throw new Error("가격 계산 마켓·통화가 현재 등록 대상과 일치하지 않습니다.");
  }
  const roundingTolerance = Number.EPSILON * Math.max(1, Math.abs(quote.calculatedPrice)) * 4;
  const scale = quote.currency === "VND" ? 1 : 100;
  if (!finite(quote.recommendedPrice) || quote.recommendedPrice <= 0 || !finite(quote.calculatedPrice) || quote.calculatedPrice <= 0 || quote.calculatedPrice - quote.recommendedPrice > roundingTolerance || !Number.isSafeInteger(Math.round(quote.recommendedPrice * scale)) || roundListingPriceUp(quote.recommendedPrice, quote.currency) !== quote.recommendedPrice) {
    throw new Error("유효한 양수의 현지 추천 판매가가 필요합니다.");
  }
  if (!record(draft) || !record(draft.publish) || !record(draft.publish.item)) throw new Error("현재 초안에 Shopee publish.item이 없습니다.");
  const next = structuredClone(draft);
  const publish = next.publish as Record<string, unknown>;
  const item = publish.item as Record<string, unknown>;
  item.original_price = quote.recommendedPrice;
  return next;
}
