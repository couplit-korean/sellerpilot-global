type LedgerBindingStatus = "exact" | "unmatched" | "unverified_credential" | "not_applicable";
type ProviderOrderReferenceState = "unavailable" | "exact_product_order" | "ambiguous_product_orders" | "invalid_product_order_list";
export type SmartstoreOrderBindingUiState = LedgerBindingStatus
  | "ambiguous_product_orders"
  | "invalid_product_order_list"
  | "contract_mismatch";

export type SmartstoreOrderBindingProjection = {
  contract: "smartstore-cs-order-binding-projection/1";
  sourceKind: "product" | "customer" | "unknown";
  providerState: ProviderOrderReferenceState | "unknown";
  ledgerState: LedgerBindingStatus | "missing";
  uiState: SmartstoreOrderBindingUiState;
  productOrderIdCount: number;
  hasExternalOrderReference: boolean;
  automaticOrderLinkAllowed: boolean;
  csCommerceMutationAllowed: false;
};

const validProductOrderId = (value: string) => /^[1-9]\d{0,19}$/u.test(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function projectSmartstoreOrderBinding(input: {
  providerContext?: unknown;
  externalOrderReference?: unknown;
  ledgerStatus?: unknown;
}): SmartstoreOrderBindingProjection {
  const context = record(input.providerContext);
  const sourceKind = context.kind === "product" || context.kind === "customer" ? context.kind : "unknown";
  const providerState = ["unavailable", "exact_product_order", "ambiguous_product_orders", "invalid_product_order_list"]
    .includes(string(context.orderReferenceState))
    ? string(context.orderReferenceState) as ProviderOrderReferenceState
    : sourceKind === "product" ? "unavailable" : "unknown";
  const ledgerState = ["exact", "unmatched", "unverified_credential", "not_applicable"]
    .includes(string(input.ledgerStatus))
    ? string(input.ledgerStatus) as LedgerBindingStatus
    : "missing";
  const rawProductOrderIds = context.productOrderIds;
  const productOrderIdsShapeValid = rawProductOrderIds === undefined || Array.isArray(rawProductOrderIds);
  const productOrderIds = Array.isArray(rawProductOrderIds) ? rawProductOrderIds.map(string) : [];
  const productOrderIdsValid = productOrderIdsShapeValid && productOrderIds.every(validProductOrderId);
  const externalOrderReference = string(input.externalOrderReference);

  let uiState: SmartstoreOrderBindingUiState = "contract_mismatch";
  if (sourceKind === "product") {
    if (!externalOrderReference && productOrderIdsShapeValid && productOrderIds.length === 0
        && (ledgerState === "not_applicable" || ledgerState === "missing")) {
      uiState = "not_applicable";
    }
  } else if (sourceKind === "customer") {
    if (providerState === "exact_product_order") {
      const exactProviderReference = productOrderIds.length === 1 && productOrderIdsValid
        && externalOrderReference === productOrderIds[0];
      if (exactProviderReference && ["exact", "unmatched", "unverified_credential"].includes(ledgerState)) {
        uiState = ledgerState as "exact" | "unmatched" | "unverified_credential";
      }
    } else if (providerState === "ambiguous_product_orders" && !externalOrderReference
        && productOrderIds.length > 0 && productOrderIdsValid) {
      uiState = "ambiguous_product_orders";
    } else if (providerState === "invalid_product_order_list" && !externalOrderReference) {
      uiState = "invalid_product_order_list";
    } else if (providerState === "unavailable" && !externalOrderReference
        && productOrderIdsShapeValid && productOrderIds.length === 0
        && (ledgerState === "not_applicable" || ledgerState === "missing")) {
      uiState = "not_applicable";
    }
  }

  return {
    contract: "smartstore-cs-order-binding-projection/1",
    sourceKind,
    providerState,
    ledgerState,
    uiState,
    productOrderIdCount: productOrderIds.length,
    hasExternalOrderReference: Boolean(externalOrderReference),
    automaticOrderLinkAllowed: uiState === "exact",
    csCommerceMutationAllowed: false,
  };
}

export const smartstoreOrderBindingUiLabels: Record<SmartstoreOrderBindingUiState, string> = {
  exact: "상품주문 정확 결속",
  unmatched: "상품주문 미발견",
  unverified_credential: "판매자 credential 미검증",
  not_applicable: "주문 참조 없음",
  ambiguous_product_orders: "복수·중복 상품주문 확인 필요",
  invalid_product_order_list: "상품주문 참조 오류",
  contract_mismatch: "정규화·원장 상태 불일치",
};
