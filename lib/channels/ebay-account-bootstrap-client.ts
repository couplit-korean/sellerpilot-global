import {
  parseStoredListingHandoff,
  type StoredListingHandoff,
} from "../channel-listing-handoff";

// Client side companion of app/api/admin/ebay-account-bootstrap. It exists so the
// product publish workbench can resolve eBay business policy ids and the inventory
// location key from operator supplied terms without anyone hunting for ids by hand.
//
// This module never invents a business value: every term, every policy name and the
// whole warehouse address travel from the operator form to the route untouched.

export const EBAY_ACCOUNT_BOOTSTRAP_PATH = "/api/admin/ebay-account-bootstrap";

export const EBAY_ACCOUNT_BOOTSTRAP_FAILED = "EBAY_ACCOUNT_BOOTSTRAP_FAILED";
export const EBAY_ACCOUNT_BOOTSTRAP_REQUEST_FAILED = "EBAY_ACCOUNT_BOOTSTRAP_REQUEST_FAILED";
export const EBAY_ACCOUNT_BOOTSTRAP_ABORTED = "EBAY_ACCOUNT_BOOTSTRAP_ABORTED";
export const EBAY_ACCOUNT_BOOTSTRAP_RESPONSE_MALFORMED = "EBAY_ACCOUNT_BOOTSTRAP_RESPONSE_MALFORMED";
export const EBAY_ACCOUNT_BOOTSTRAP_INPUT_INCOMPLETE = "EBAY_ACCOUNT_BOOTSTRAP_INPUT_INCOMPLETE";

// One Korean operator message per failure code the bootstrap route can answer with.
// Codes may carry a ":detail" suffix (for example
// EBAY_BUSINESS_POLICY_TERMS_INVALID:fulfillment.shippingServiceCode), so lookup
// always resolves through the base code.
export const EBAY_ACCOUNT_BOOTSTRAP_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  EBAY_ACCOUNT_BOOTSTRAP_INPUT_INVALID: "판매 조건과 창고 주소 형식을 확인해 주세요.",
  EBAY_CREDENTIAL_UNAVAILABLE: "eBay 연결 정보를 불러오지 못했습니다. OAuth 연결을 먼저 완료해 주세요.",
  EBAY_ACCESS_TOKEN_MISSING: "eBay 액세스 토큰이 없습니다. OAuth 연결을 다시 완료해 주세요.",
  EBAY_MARKETPLACE_MISMATCH: "연결된 eBay 계정의 마켓과 선택한 판매 국가가 일치하지 않습니다.",
  EBAY_MARKETPLACE_ID_INVALID: "eBay 마켓 식별값이 올바르지 않습니다. 판매 국가를 다시 선택해 주세요.",
  EBAY_BUSINESS_POLICY_TERMS_INVALID: "판매 정책 조건이 eBay 규칙에 맞지 않습니다. 배송·결제·반품 입력값을 확인해 주세요.",
  EBAY_BUSINESS_POLICY_GET_UNVERIFIED: "eBay의 기존 판매 정책 목록을 검증하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  EBAY_BUSINESS_POLICY_SELECTION_REQUIRED: "사용할 기존 판매 정책을 하나로 확정하지 못했습니다. 다른 정책 이름으로 다시 시도해 주세요.",
  EBAY_BUSINESS_POLICY_EXPECTED_MISSING: "저장돼 있던 정책 ID를 eBay가 더 이상 반환하지 않습니다. 정책을 다시 확보해야 합니다.",
  EBAY_BUSINESS_POLICY_CREATE_FAILED: "eBay가 판매 정책 생성을 거부했습니다. 입력값과 계정 권한을 확인해 주세요.",
  EBAY_BUSINESS_POLICY_CREATE_UNVERIFIED: "판매 정책 생성 응답에서 정책 ID를 확인하지 못했습니다. 아무 값도 저장하지 않았습니다.",
  EBAY_INVENTORY_LOCATION_INPUT_INVALID: "창고 주소 형식이 올바르지 않습니다. 주소와 위치 키를 확인해 주세요.",
  EBAY_INVENTORY_LOCATION_GET_UNVERIFIED: "eBay의 기존 창고 위치 목록을 검증하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  EBAY_INVENTORY_LOCATION_DISABLED: "사용할 수 없는 창고 위치 키입니다. 다른 위치 키를 입력해 주세요.",
  EBAY_INVENTORY_LOCATION_CREATE_FAILED: "eBay가 창고 위치 생성을 거부했습니다. 주소를 확인해 주세요.",
  EBAY_LISTING_HANDOFF_MALFORMED: "저장된 판매 정책 형식이 올바르지 않습니다.",
  EBAY_LISTING_HANDOFF_UNAVAILABLE: "저장된 판매 정책을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  EBAY_LISTING_HANDOFF_SAVE_FAILED: "eBay가 확정한 정책 ID를 저장하지 못했습니다. 다시 시도해 주세요.",
  EBAY_LISTING_HANDOFF_PRODUCT_UNAVAILABLE: "판매 정책을 저장할 상품을 확인하지 못했습니다.",
  EBAY_LISTING_HANDOFF_MISMATCH: "저장된 판매 정책의 상품·마켓이 일치하지 않습니다.",
  EBAY_ACCOUNT_BOOTSTRAP_FAILED: "eBay 판매 정책과 창고 위치를 확정하지 못했습니다. 아무 값도 저장하지 않았습니다.",
  EBAY_ACCOUNT_BOOTSTRAP_REQUEST_FAILED: "eBay 판매 정책 요청을 보내지 못했습니다. 네트워크와 로그인 상태를 확인해 주세요.",
  EBAY_ACCOUNT_BOOTSTRAP_ABORTED: "eBay 판매 정책 요청이 취소되었습니다. 다시 시도해 주세요.",
  EBAY_ACCOUNT_BOOTSTRAP_RESPONSE_MALFORMED: "eBay 판매 정책 응답을 읽지 못했습니다. 판매자센터에서 실제 상태를 확인해 주세요.",
  EBAY_ACCOUNT_BOOTSTRAP_INPUT_INCOMPLETE: "배송·결제·반품 조건과 창고 주소를 모두 입력해 주세요.",
};

export type EbayAccountBootstrapRequest = {
  productId: string;
  channel: "ebay";
  environment: "production" | "sandbox";
  market: string;
  policies: {
    fulfillment: {
      name: string;
      handlingTime: { value: number; unit: string };
      shippingOptions: Array<{
        optionType: string;
        costType: string;
        shippingServices: Array<{
          shippingCarrierCode: string;
          shippingServiceCode: string;
          freeShipping?: boolean;
          shippingCost?: { value: string; currency: string };
        }>;
      }>;
    };
    payment: {
      name: string;
      paymentMethods: Array<{ paymentMethodType: string }>;
    };
    return: {
      name: string;
      returnsAccepted: boolean;
      returnPeriod?: { value: number; unit: string };
      returnShippingCostPayer?: string;
      refundMethod?: string;
      returnMethod?: string;
    };
  };
  location: {
    merchantLocationKey: string;
    name: string;
    address: {
      addressLine1: string;
      addressLine2?: string;
      city: string;
      stateOrProvince: string;
      postalCode: string;
      country: string;
    };
    phone?: string;
  };
};

export type EbayAccountBootstrapSummary = {
  policyCreated?: { fulfillment?: boolean; payment?: boolean; return?: boolean };
  locationCreated?: boolean;
  providerWrites?: number;
  discardedStoredPolicyIds?: boolean;
  marketplaceId?: string;
};

export type EbayAccountBootstrapResult =
  | {
    ok: true;
    handoff: StoredListingHandoff;
    bootstrap: EbayAccountBootstrapSummary;
    message: string;
  }
  | { ok: false; code: string; message: string };

// Operator form state. Everything starts empty on purpose: names, windows, shipping
// services and the address are operator decisions, so this module never seeds them.
export type EbayAccountBootstrapFormValues = {
  fulfillmentName: string;
  fulfillmentHandlingTime: string;
  fulfillmentHandlingTimeUnit: string;
  shippingOptionType: string;
  shippingCostType: string;
  shippingCarrierCode: string;
  shippingServiceCode: string;
  shippingFreeShipping: "" | "true" | "false";
  shippingCostValue: string;
  shippingCostCurrency: string;
  paymentName: string;
  paymentMethodType: string;
  returnName: string;
  returnsAccepted: "" | "true" | "false";
  returnPeriodValue: string;
  returnPeriodUnit: string;
  returnShippingCostPayer: string;
  refundMethod: string;
  returnMethod: string;
  merchantLocationKey: string;
  locationName: string;
  locationAddressLine1: string;
  locationAddressLine2: string;
  locationCity: string;
  locationStateOrProvince: string;
  locationPostalCode: string;
  locationCountry: string;
  locationPhone: string;
};

export function emptyEbayAccountBootstrapFormValues(): EbayAccountBootstrapFormValues {
  return {
    fulfillmentName: "",
    fulfillmentHandlingTime: "",
    fulfillmentHandlingTimeUnit: "",
    shippingOptionType: "",
    shippingCostType: "",
    shippingCarrierCode: "",
    shippingServiceCode: "",
    shippingFreeShipping: "",
    shippingCostValue: "",
    shippingCostCurrency: "",
    paymentName: "",
    paymentMethodType: "",
    returnName: "",
    returnsAccepted: "",
    returnPeriodValue: "",
    returnPeriodUnit: "",
    returnShippingCostPayer: "",
    refundMethod: "",
    returnMethod: "",
    merchantLocationKey: "",
    locationName: "",
    locationAddressLine1: "",
    locationAddressLine2: "",
    locationCity: "",
    locationStateOrProvince: "",
    locationPostalCode: "",
    locationCountry: "",
    locationPhone: "",
  };
}

export type EbayAccountBootstrapBuildResult =
  | { ok: true; request: EbayAccountBootstrapRequest }
  | { ok: false; code: string; message: string };

const amountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u;
const currencyPattern = /^[A-Z]{3}$/u;
const countryPattern = /^[A-Z]{2}$/u;
const merchantLocationKeyPattern = /^[A-Za-z0-9_-]{1,50}$/u;

function text(value: string) {
  return value.trim();
}

function incomplete(message: string): EbayAccountBootstrapBuildResult {
  return { ok: false, code: EBAY_ACCOUNT_BOOTSTRAP_INPUT_INCOMPLETE, message };
}

function integer(text_: string, minimum: number, maximum: number, message: string) {
  if (!/^\d+$/u.test(text_)) return { ok: false as const, message };
  const value = Number(text_);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return { ok: false as const, message };
  }
  return { ok: true as const, value };
}

// Turns the operator form into the exact POST body of the bootstrap route. Any
// missing or malformed field is reported in Korean before a network call happens.
export function buildEbayAccountBootstrapRequest(
  values: EbayAccountBootstrapFormValues,
  target: { productId: string; environment: "production" | "sandbox"; market: string },
): EbayAccountBootstrapBuildResult {
  const fulfillmentName = text(values.fulfillmentName);
  if (!fulfillmentName) return incomplete("배송 정책 이름을 입력해 주세요.");

  const handlingTime = integer(
    text(values.fulfillmentHandlingTime),
    0,
    30,
    "처리 시간은 0~30 사이 정수(일)로 입력해 주세요.",
  );
  if (!handlingTime.ok) return incomplete(handlingTime.message);
  const handlingTimeUnit = text(values.fulfillmentHandlingTimeUnit);
  if (handlingTimeUnit !== "DAY" && handlingTimeUnit !== "BUSINESS_DAY") {
    return incomplete("처리 시간 단위를 영업일 또는 일반일로 선택해 주세요.");
  }

  const shippingOptionType = text(values.shippingOptionType);
  if (!shippingOptionType) return incomplete("배송 옵션 유형(DOMESTIC 등)을 입력해 주세요.");
  const shippingCostType = text(values.shippingCostType);
  if (!shippingCostType) return incomplete("배송비 유형(FLAT_RATE 등)을 입력해 주세요.");
  const shippingCarrierCode = text(values.shippingCarrierCode);
  if (!shippingCarrierCode) return incomplete("배송사 코드를 입력해 주세요.");
  const shippingServiceCode = text(values.shippingServiceCode);
  if (!shippingServiceCode) return incomplete("배송 서비스 코드를 입력해 주세요.");
  if (values.shippingFreeShipping !== "true" && values.shippingFreeShipping !== "false") {
    return incomplete("무료 배송 여부를 선택해 주세요.");
  }
  const freeShipping = values.shippingFreeShipping === "true";
  let shippingCost: { value: string; currency: string } | undefined;
  if (!freeShipping) {
    const value = text(values.shippingCostValue);
    if (!amountPattern.test(value)) {
      return incomplete("배송비 금액을 12.50 같은 숫자 형식으로 입력해 주세요.");
    }
    const currency = text(values.shippingCostCurrency).toUpperCase();
    if (!currencyPattern.test(currency)) {
      return incomplete("배송비 통화를 USD 같은 3자리 코드로 입력해 주세요.");
    }
    shippingCost = { value, currency };
  }

  const paymentName = text(values.paymentName);
  if (!paymentName) return incomplete("결제 정책 이름을 입력해 주세요.");
  const paymentMethodType = text(values.paymentMethodType);
  if (!paymentMethodType) return incomplete("결제 수단 유형(CREDIT_CARD 등)을 입력해 주세요.");

  const returnName = text(values.returnName);
  if (!returnName) return incomplete("반품 정책 이름을 입력해 주세요.");
  if (values.returnsAccepted !== "true" && values.returnsAccepted !== "false") {
    return incomplete("반품 수락 여부를 선택해 주세요.");
  }
  const returnsAccepted = values.returnsAccepted === "true";
  let returnPeriod: { value: number; unit: string } | undefined;
  let returnShippingCostPayer: string | undefined;
  if (returnsAccepted) {
    const period = integer(
      text(values.returnPeriodValue),
      1,
      365,
      "반품 기간을 1~365 사이 정수로 입력해 주세요.",
    );
    if (!period.ok) return incomplete(period.message);
    const unit = text(values.returnPeriodUnit).toUpperCase();
    if (unit !== "DAY" && unit !== "MONTH") {
      return incomplete("반품 기간 단위를 일 또는 개월로 선택해 주세요.");
    }
    returnShippingCostPayer = text(values.returnShippingCostPayer);
    if (!returnShippingCostPayer) {
      return incomplete("반품 배송비 부담 주체(BUYER 등)를 입력해 주세요.");
    }
    returnPeriod = { value: period.value, unit };
  }
  const refundMethod = text(values.refundMethod);
  const returnMethod = text(values.returnMethod);

  const merchantLocationKey = text(values.merchantLocationKey);
  if (!merchantLocationKeyPattern.test(merchantLocationKey)) {
    return incomplete("창고 위치 키를 영문·숫자·-·_ 1~50자로 입력해 주세요.");
  }
  const locationName = text(values.locationName);
  if (!locationName) return incomplete("창고 이름을 입력해 주세요.");
  const addressLine1 = text(values.locationAddressLine1);
  if (!addressLine1) return incomplete("창고 주소 1을 입력해 주세요.");
  const city = text(values.locationCity);
  if (!city) return incomplete("창고 도시를 입력해 주세요.");
  const stateOrProvince = text(values.locationStateOrProvince);
  if (!stateOrProvince) return incomplete("창고 주·도를 입력해 주세요.");
  const postalCode = text(values.locationPostalCode);
  if (!postalCode) return incomplete("창고 우편번호를 입력해 주세요.");
  const country = text(values.locationCountry).toUpperCase();
  if (!countryPattern.test(country)) {
    return incomplete("창고 국가 코드를 US 같은 2자리로 입력해 주세요.");
  }
  const addressLine2 = text(values.locationAddressLine2);
  const phone = text(values.locationPhone);

  return {
    ok: true,
    request: {
      productId: target.productId,
      channel: "ebay",
      environment: target.environment,
      market: target.market.trim().toUpperCase(),
      policies: {
        fulfillment: {
          name: fulfillmentName,
          handlingTime: { value: handlingTime.value, unit: handlingTimeUnit },
          shippingOptions: [{
            optionType: shippingOptionType,
            costType: shippingCostType,
            shippingServices: [{
              shippingCarrierCode,
              shippingServiceCode,
              freeShipping,
              ...(shippingCost ? { shippingCost } : {}),
            }],
          }],
        },
        payment: {
          name: paymentName,
          paymentMethods: [{ paymentMethodType }],
        },
        return: {
          name: returnName,
          returnsAccepted,
          ...(returnPeriod ? { returnPeriod } : {}),
          ...(returnShippingCostPayer ? { returnShippingCostPayer } : {}),
          ...(refundMethod ? { refundMethod } : {}),
          ...(returnMethod ? { returnMethod } : {}),
        },
      },
      location: {
        merchantLocationKey,
        name: locationName,
        address: {
          addressLine1,
          ...(addressLine2 ? { addressLine2 } : {}),
          city,
          stateOrProvince,
          postalCode,
          country,
        },
        ...(phone ? { phone } : {}),
      },
    },
  };
}

export function ebayAccountBootstrapBaseCode(code: string) {
  return code.trim().split(":")[0] || EBAY_ACCOUNT_BOOTSTRAP_FAILED;
}

export function ebayAccountBootstrapFailureMessage(code: string, fallbackMessage?: string) {
  const base = ebayAccountBootstrapBaseCode(code);
  const mapped = EBAY_ACCOUNT_BOOTSTRAP_FAILURE_MESSAGES[base];
  if (mapped) {
    const detail = code.trim().slice(base.length).replace(/^:/u, "");
    return detail ? `${mapped} (상세: ${detail})` : mapped;
  }
  const fallback = fallbackMessage?.trim();
  return fallback
    || EBAY_ACCOUNT_BOOTSTRAP_FAILURE_MESSAGES[EBAY_ACCOUNT_BOOTSTRAP_FAILED]!;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function summary(value: unknown): EbayAccountBootstrapSummary {
  const row = record(value);
  const created = record(row.policyCreated);
  const policyCreated: NonNullable<EbayAccountBootstrapSummary["policyCreated"]> = {};
  for (const kind of ["fulfillment", "payment", "return"] as const) {
    if (typeof created[kind] === "boolean") policyCreated[kind] = created[kind] as boolean;
  }
  return {
    ...(Object.keys(policyCreated).length ? { policyCreated } : {}),
    ...(typeof row.locationCreated === "boolean" ? { locationCreated: row.locationCreated } : {}),
    ...(typeof row.providerWrites === "number" ? { providerWrites: row.providerWrites } : {}),
    ...(typeof row.discardedStoredPolicyIds === "boolean"
      ? { discardedStoredPolicyIds: row.discardedStoredPolicyIds }
      : {}),
    ...(typeof row.marketplaceId === "string" ? { marketplaceId: row.marketplaceId } : {}),
  };
}

// Calls the admin bootstrap route and returns the resolved handoff. A provider or
// route failure is returned as a coded outcome instead of a thrown message so the
// workbench can show the Korean reason for that exact code.
export async function bootstrapEbayAccount(
  request: EbayAccountBootstrapRequest,
  accessToken: string,
  signal?: AbortSignal,
): Promise<EbayAccountBootstrapResult> {
  let response: Response;
  try {
    response = await fetch(EBAY_ACCOUNT_BOOTSTRAP_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(request),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        code: EBAY_ACCOUNT_BOOTSTRAP_ABORTED,
        message: ebayAccountBootstrapFailureMessage(EBAY_ACCOUNT_BOOTSTRAP_ABORTED),
      };
    }
    return {
      ok: false,
      code: EBAY_ACCOUNT_BOOTSTRAP_REQUEST_FAILED,
      message: ebayAccountBootstrapFailureMessage(EBAY_ACCOUNT_BOOTSTRAP_REQUEST_FAILED),
    };
  }

  const payload = await response.json().catch(() => null) as
    | { code?: unknown; message?: unknown; handoff?: unknown; bootstrap?: unknown }
    | null;
  const payloadMessage = typeof payload?.message === "string" ? payload.message : undefined;
  const payloadCode = typeof payload?.code === "string" && payload.code.trim()
    ? payload.code.trim()
    : EBAY_ACCOUNT_BOOTSTRAP_FAILED;

  if (!response.ok) {
    return {
      ok: false,
      code: payloadCode,
      message: ebayAccountBootstrapFailureMessage(payloadCode, payloadMessage),
    };
  }

  const handoff = parseStoredListingHandoff(payload?.handoff ?? null);
  if (!handoff.success || !handoff.data) {
    return {
      ok: false,
      code: EBAY_ACCOUNT_BOOTSTRAP_RESPONSE_MALFORMED,
      message: ebayAccountBootstrapFailureMessage(EBAY_ACCOUNT_BOOTSTRAP_RESPONSE_MALFORMED),
    };
  }
  if (
    handoff.data.productId !== request.productId
    || handoff.data.channel !== request.channel
    || handoff.data.environment !== request.environment
    || handoff.data.market !== request.market
  ) {
    return {
      ok: false,
      code: "EBAY_LISTING_HANDOFF_MISMATCH",
      message: ebayAccountBootstrapFailureMessage("EBAY_LISTING_HANDOFF_MISMATCH"),
    };
  }
  return {
    ok: true,
    handoff: handoff.data,
    bootstrap: summary(payload?.bootstrap),
    message: payloadMessage ?? "eBay 판매 정책과 창고 위치를 확정했습니다.",
  };
}

// The ids/key the route resolved, ready to render next to the operator action.
export function ebayAccountBootstrapResolvedFields(handoff: StoredListingHandoff) {
  return [
    { label: "마켓플레이스", value: handoff.marketplaceId },
    { label: "배송 정책", value: handoff.fulfillmentPolicyId },
    { label: "결제 정책", value: handoff.paymentPolicyId },
    { label: "반품 정책", value: handoff.returnPolicyId },
    { label: "창고 위치 키", value: handoff.merchantLocationKey },
  ];
}
