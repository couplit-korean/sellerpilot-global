const SELLER_ACCOUNT_KEY = /^[a-f0-9]{64}$/u;

export type CoupangOrderCandidate = {
  id: string;
  sourceCredentialId?: string | null;
  sellerAccountKey?: string | null;
};

export type CoupangOrderLineageDecision =
  | { state: "exact"; orderId: string }
  | { state: "unmatched" | "unverified_credential" | "unverifiable_order_lineage" | "ambiguous_order_lineage"; orderId: null };

/**
 * Fail-closed contract for linking a Coupang CS ticket to an order. An order ID
 * is usable only when the order row carries the same credential incarnation
 * and seller key as the ticket. The current common commerce_orders schema does
 * not carry these fields, so legacy candidates intentionally remain
 * unverifiable instead of being linked by order number alone.
 */
export function decideCoupangOrderLineage(input: {
  ticketCredentialId?: string | null;
  ticketSellerAccountKey?: string | null;
  candidates: CoupangOrderCandidate[];
}): CoupangOrderLineageDecision {
  const credentialId = input.ticketCredentialId?.trim() ?? "";
  const sellerAccountKey = input.ticketSellerAccountKey?.trim() ?? "";
  if (!credentialId || !SELLER_ACCOUNT_KEY.test(sellerAccountKey)) {
    return { state: "unverified_credential", orderId: null };
  }
  if (input.candidates.length === 0) {
    return { state: "unmatched", orderId: null };
  }

  const exact = input.candidates.filter((candidate) =>
    candidate.sourceCredentialId === credentialId
    && candidate.sellerAccountKey === sellerAccountKey);
  if (exact.length === 1) {
    return { state: "exact", orderId: exact[0]!.id };
  }
  if (exact.length > 1) {
    return { state: "ambiguous_order_lineage", orderId: null };
  }
  return { state: "unverifiable_order_lineage", orderId: null };
}
