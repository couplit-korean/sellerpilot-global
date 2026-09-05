import type { ActiveChannelKey } from "./catalog";
import type { ListingRequirement } from "./listing-preflight";

type RecordValue = Record<string, unknown>;
export type ListingShippingSource = {
  shippingFeeKrw?: number | null;
  shippingRule?: string;
  packagingRule?: string;
};

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function at(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => record(current)[key], value);
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

// Missing/invalid amounts must stay unknown: Number(null) and Number("") are 0.
export function listingShippingAmount(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || text(value) === "") return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function normalizeListingShippingSource(value: ListingShippingSource) {
  return {
    shippingFeeKrw: listingShippingAmount(value.shippingFeeKrw),
    shippingRule: typeof value.shippingRule === "string" ? value.shippingRule : "",
    packagingRule: typeof value.packagingRule === "string" ? value.packagingRule : "",
  };
}

export function listingShippingDraftSource(value: ListingShippingSource) {
  return { ...normalizeListingShippingSource(value), policyReview: "", shippingRuleReview: "", packagingRuleReview: "" };
}

export function listingShippingSourceChanged(previous: RecordValue, next: RecordValue) {
  const source = (draft: RecordValue) => normalizeListingShippingSource(record(at(draft, ["sellerpilotAssets", "shipping"])));
  return JSON.stringify(source(previous)) !== JSON.stringify(source(next));
}

export function shippingRequirementDependsOnSource(requirement: Pick<ListingRequirement, "manualPath">) {
  const path = requirement.manualPath?.join(".") ?? "";
  return path.startsWith("sellerpilotAssets.shipping.")
    || /^body\.(deliveryChargeType|deliveryCharge|freeShipOverAmount)$/.test(path)
    || /^body\.originProduct\.deliveryInfo\.deliveryFee\.(deliveryFeeType|baseFee|freeConditionalAmount)$/.test(path);
}

export function coupangShippingFeeDraft(value: ListingShippingSource) {
  const fee = listingShippingAmount(value.shippingFeeKrw);
  return { deliveryChargeType: fee === null ? "" : fee === 0 ? "FREE" : "NOT_FREE", deliveryCharge: fee, freeShipOverAmount: 0 };
}

export function smartstoreShippingDraft(value: ListingShippingSource) {
  const fee = listingShippingAmount(value.shippingFeeKrw);
  return {
    deliveryType: "DELIVERY",
    deliveryAttributeType: "NORMAL",
    deliveryCompany: "",
    deliveryFee: { deliveryFeeType: fee === null ? "" : fee === 0 ? "FREE" : "PAID", baseFee: fee, deliveryFeePayType: "PREPAID" },
    claimDeliveryInfo: {
      returnDeliveryCompanyPriorityType: "PRIMARY",
      returnDeliveryFee: "",
      exchangeDeliveryFee: "",
      shippingAddressId: "",
      returnAddressId: "",
    },
  };
}

// Official contracts:
// https://developers.coupangcorp.com/hc/en-us/articles/360033877853-Product-Creation
// https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/원상품-정보-구조체
export function validatedCoupangShippingFees(body: RecordValue) {
  const type = text(body.deliveryChargeType);
  const fee = listingShippingAmount(body.deliveryCharge);
  const threshold = listingShippingAmount(body.freeShipOverAmount);
  if (!["FREE", "NOT_FREE", "CONDITIONAL_FREE"].includes(type)
      || fee === null || threshold === null
      || (type === "FREE" && (fee !== 0 || threshold !== 0))
      || (type === "NOT_FREE" && (fee <= 0 || threshold !== 0))
      || (type === "CONDITIONAL_FREE" && (fee <= 0 || threshold < 100 || threshold % 100 !== 0))
      || (body.remoteAreaDeliverable !== undefined && !["Y", "N"].includes(text(body.remoteAreaDeliverable)))
      || (body.unionDeliveryType !== undefined && !["UNION_DELIVERY", "NOT_UNION_DELIVERY"].includes(text(body.unionDeliveryType)))) {
    throw new Error("COUPANG_SHIPPING_FEE_CONFIRMATION_REQUIRED");
  }
  return { deliveryChargeType: type, deliveryCharge: fee, freeShipOverAmount: threshold };
}

export function validatedSmartstoreShippingInfo(value: unknown) {
  const delivery = record(value);
  const fee = record(delivery.deliveryFee);
  const type = text(fee.deliveryFeeType);
  const baseFee = listingShippingAmount(fee.baseFee);
  const threshold = listingShippingAmount(fee.freeConditionalAmount);
  const claims = record(delivery.claimDeliveryInfo);
  const returnFee = listingShippingAmount(claims.returnDeliveryFee);
  const exchangeFee = listingShippingAmount(claims.exchangeDeliveryFee);
  const shippingAddressId = listingShippingAmount(claims.shippingAddressId);
  const returnAddressId = listingShippingAmount(claims.returnAddressId);
  if (delivery.deliveryType !== "DELIVERY" || !text(delivery.deliveryCompany)
      || !["FREE", "PAID", "CONDITIONAL_FREE"].includes(type)
      || baseFee === null || baseFee > 100_000
      || (type === "FREE" && baseFee !== 0)
      || (type !== "FREE" && baseFee <= 0)
      || (type === "CONDITIONAL_FREE" && (threshold === null || threshold <= 0 || threshold > 999_999_990))
      || !["PREPAID", "COLLECT", "COLLECT_OR_PREPAID"].includes(text(fee.deliveryFeePayType))
      || !/^(PRIMARY|SECONDARY_[1-9])$/.test(text(claims.returnDeliveryCompanyPriorityType))
      || returnFee === null || returnFee > 1_000_000 || exchangeFee === null || exchangeFee > 1_000_000
      || !shippingAddressId || !returnAddressId) {
    throw new Error("SMARTSTORE_SHIPPING_POLICY_CONFIRMATION_REQUIRED");
  }
  return {
    ...delivery,
    deliveryFee: { ...fee, baseFee, ...(type === "CONDITIONAL_FREE" ? { freeConditionalAmount: threshold } : {}) },
    claimDeliveryInfo: { ...claims, returnDeliveryFee: returnFee, exchangeDeliveryFee: exchangeFee, shippingAddressId, returnAddressId },
  };
}

function valid(run: () => unknown) {
  try { run(); return true; } catch { return false; }
}

export function listingShippingRequirements(
  channel: ActiveChannelKey,
  draft: RecordValue,
  operation: "listing.create" | "listing.update",
): ListingRequirement[] {
  // Existing remote updates preserve provider shipping and exact recovery hashes.
  // This metadata is only attached by new-create drafts; legacy reviewed requests
  // are not silently rewritten or reinterpreted here.
  const shipping = record(at(draft, ["sellerpilotAssets", "shipping"]));
  if (operation !== "listing.create" || !Object.keys(shipping).length) return [];
  const requirements: ListingRequirement[] = [];
  const add = (key: string, label: string, ready: boolean, manualPath?: string[], help?: string) => {
    requirements.push({ key: `shipping-${key}`, label, source: "판매자 계정", status: ready ? "ready" : "manual", manualPath, help });
  };
  const sourceFee = listingShippingAmount(shipping.shippingFeeKrw);
  add("source-fee", "입력 배송비 KRW", sourceFee !== null, undefined, "상품 정보에서 기본 배송비를 확인해 저장하세요. 미입력 배송비를 무료로 처리하지 않습니다.");
  for (const [field, label] of [["shippingRule", "배송 규칙"], ["packagingRule", "포장 규칙"]] as const) {
    if (!text(shipping[field])) continue;
    add(field, `${label} 적용 확인`, text(shipping[`${field}Review`]) === "확인", ["sellerpilotAssets", "shipping", `${field}Review`],
      `입력 내용: ${shipping[field]} — 채널 정책 또는 실제 출고 절차에 적용한 뒤 '확인'을 입력하세요. 이 문장은 원격 배송 설정으로 자동 변환되지 않습니다.`);
  }
  if (channel === "coupang") {
    const body = record(draft.body);
    for (const [key, label] of [["deliveryChargeType", "배송비 유형 FREE / NOT_FREE / CONDITIONAL_FREE"], ["deliveryCharge", "기본 배송비 KRW"], ["freeShipOverAmount", "조건부 무료배송 기준 KRW"]]) {
      add(key, label, key === "deliveryChargeType" ? ["FREE", "NOT_FREE", "CONDITIONAL_FREE"].includes(text(body[key])) : listingShippingAmount(body[key]) !== null, ["body", key]);
    }
    add("fee-contract", "쿠팡 배송비 조건 일치", valid(() => validatedCoupangShippingFees(body)) && sourceFee !== null && listingShippingAmount(body.deliveryCharge) === sourceFee, undefined,
      "입력 배송비와 전송 배송비가 같아야 합니다. 조건부 무료는 양수 배송비와 100원 단위 기준금액이 필요합니다. 착불은 카테고리 권한 확인 후 별도 처리해야 합니다.");
  } else if (channel === "smartstore") {
    const path = ["body", "originProduct", "deliveryInfo"];
    const delivery = record(at(draft, path));
    const fee = record(delivery.deliveryFee);
    const fields = [
      ["택배사 코드", ["deliveryCompany"]],
      ["배송비 유형 FREE / PAID / CONDITIONAL_FREE", ["deliveryFee", "deliveryFeeType"]],
      ["기본 배송비 KRW", ["deliveryFee", "baseFee"]],
      ["배송비 결제 방식", ["deliveryFee", "deliveryFeePayType"]],
      ["반품 배송비 KRW", ["claimDeliveryInfo", "returnDeliveryFee"]],
      ["교환 배송비 KRW", ["claimDeliveryInfo", "exchangeDeliveryFee"]],
      ["출고지 주소록 ID", ["claimDeliveryInfo", "shippingAddressId"]],
      ["반품지 주소록 ID", ["claimDeliveryInfo", "returnAddressId"]],
    ] as const;
    for (const [label, parts] of fields) add(parts.join("-"), label, text(at(delivery, [...parts])) !== "", [...path, ...parts], "판매자센터에 등록된 실제 배송 설정을 입력하세요.");
    if (fee.deliveryFeeType === "CONDITIONAL_FREE") add("threshold", "무료배송 기준 KRW", (listingShippingAmount(fee.freeConditionalAmount) ?? 0) > 0, [...path, "deliveryFee", "freeConditionalAmount"]);
    add("fee-contract", "스마트스토어 배송 설정 일치", valid(() => validatedSmartstoreShippingInfo(delivery)) && sourceFee !== null && listingShippingAmount(fee.baseFee) === sourceFee, undefined,
      "입력 기본 배송비와 전송 배송비, 택배사·출고지·반품지·반품/교환비를 확인하세요. 수량별/구간별 배송은 별도 정책 검토가 필요합니다.");
  } else {
    const policyPath = channel === "qoo10" ? ["params", "ShippingNo"]
      : channel === "ebay" ? ["offer", "listingPolicies", "fulfillmentPolicyId"]
        : channel === "temu" ? ["body", "goodsBasic", "costTemplate"] : null;
    const policy = policyPath ? text(at(draft, policyPath)) : "";
    if (policyPath) add("policy-id", "적용 배송 정책", Boolean(policy) && policy !== "SERVER_MANAGED"
      && (channel !== "qoo10" || /^\d+$/.test(policy)), policyPath,
      "현재 판매자 계정의 배송 정책을 확인하세요. Qoo10 무료배송 0도 직접 확인해 입력해야 합니다.");
    if (channel === "qoo10" && policy === "0") add("free-fee-match", "Qoo10 무료배송과 입력 배송비 일치", sourceFee === 0, undefined,
      "입력 배송비가 유료이면 무료배송 코드 0을 사용할 수 없습니다. 실제 배송그룹 번호를 확인하세요.");
    if (channel === "elevenst") add("supported-fee", "11번가 검증된 배송비 계약", sourceFee === 0, undefined,
      "현재 11번가 신규등록 어댑터는 무료배송 계약만 검증됐습니다. 유료배송은 공식 필드·권한 확인 후 별도 구현하거나 판매자센터에서 처리해야 합니다.");
    add("policy-review", "채널 배송비·배송 정책 대조", text(shipping.policyReview) === "확인", ["sellerpilotAssets", "shipping", "policyReview"],
      `입력 배송비 ${sourceFee ?? "미확인"} KRW와 ${channel === "elevenst" ? "공식 payload의 배송·반품 설정" : "판매 국가의 계정 배송 정책·물류 설정"}을 대조한 뒤 '확인'을 입력하세요. 원화 배송비를 임의로 현지 통화로 바꾸거나 무료로 처리하지 않습니다.`);
  }
  return requirements;
}

export function assertListingShippingReady(channel: ActiveChannelKey, draft: RecordValue, operation: "listing.create" | "listing.update") {
  const missing = listingShippingRequirements(channel, draft, operation).filter((item) => item.status === "manual");
  if (missing.length) throw new Error(`LISTING_SHIPPING_CONFIRMATION_REQUIRED:${missing.map((item) => item.key).join(",")}`);
}
