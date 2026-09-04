/**
 * Exact Lotte Qoo10 S1 recovery identity.
 *
 * Create requested official free-shipping selector `0`. GetItemDetailInfo on
 * both the create job and the paused listing.update stored delivery group
 * `806971`. Confirmation and listing.update expectedState must keep `0`
 * (fail-closed fence). Only the read-only verifier / one-shot activate
 * expectedState may overlay the observed group.
 *
 * Do not reuse fac9 `qoo10-exact-localization-identity` pins.
 */
export const qoo10LotteShippingS1Identity = Object.freeze({
  productId: "1ed4acfc-7603-48ec-a638-241131e59358",
  listingId: "13858f41-78fd-463f-9390-e8f06e71e538",
  credentialId: "2b49d081-5188-4a75-9555-e0a6438e8a2b",
  remoteId: "1217536689",
  createJobId: "687852dc-36de-4049-b170-bdf7839ccf2f",
  updateJobId: "089467c1-cadb-4d31-93a8-d5882c46d753",
  sellerSku: "AUTO-780720401E2D4E4EA45F",
  market: "JP",
  targetId: "Japan · QAPI",
  locale: "ja-JP",
  requestShippingSelector: "0",
  observedShippingNo: "806971",
});

export const qoo10ShippingS1VerifierContract = "qoo10_shipping_s1_verifier_v1" as const;
export const qoo10ShippingS1VerifierArgument = "sellerpilotQoo10ShippingS1Recovery" as const;

export type Qoo10LotteShippingS1OverlayInput = {
  listingId?: string | null;
  remoteId?: string | null;
  sourceJobId?: string | null;
  updateJobId?: string | null;
  requestShippingNo?: string | null;
  confirmationShippingNo?: string | null;
  observedShippingNos: readonly (string | null | undefined)[];
};

function exactShippingSelector(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function qoo10LotteShippingS1Target(productId: string, listingId: string) {
  const identity = qoo10LotteShippingS1Identity;
  return productId === identity.productId && listingId === identity.listingId;
}

/**
 * Overlay is allowed only for this listing, only when request and confirmation
 * still carry selector `0`, and only when at least two independent observed
 * readbacks are the stored group `806971`. Any other mismatch stays fail-closed.
 */
export function qoo10LotteShippingS1OverlayAllowed(input: Qoo10LotteShippingS1OverlayInput) {
  const identity = qoo10LotteShippingS1Identity;
  const request = exactShippingSelector(input.requestShippingNo);
  const confirmation = exactShippingSelector(input.confirmationShippingNo);
  const observed = input.observedShippingNos.map(exactShippingSelector).filter(Boolean);
  return input.listingId === identity.listingId
    && input.remoteId === identity.remoteId
    && input.sourceJobId === identity.createJobId
    && input.updateJobId === identity.updateJobId
    && request === identity.requestShippingSelector
    && confirmation === identity.requestShippingSelector
    && observed.length >= 2
    && observed.every((value) => value === identity.observedShippingNo);
}

export function qoo10LotteShippingS1ExpectedShippingNo(input: Qoo10LotteShippingS1OverlayInput) {
  return qoo10LotteShippingS1OverlayAllowed(input)
    ? qoo10LotteShippingS1Identity.observedShippingNo
    : exactShippingSelector(input.confirmationShippingNo);
}
