const SELLER_ACCOUNT_KEY = /^[a-f0-9]{64}$/u;
const ORDER_REVISION = /^[a-f0-9]{64}$/u;

export type CoupangOrderCandidate = {
  id: string;
  ownerId?: string | null;
  externalOrderId?: string | null;
  orderRevision?: string | null;
  sourceCredentialId?: string | null;
  sellerAccountKey?: string | null;
};

export type CoupangOrderLineageDecision =
  | { state: "exact"; orderId: string }
  | { state: "not_applicable" | "unmatched" | "unverified_credential" | "unverifiable_order_lineage" | "ambiguous_order_lineage" | "stale_order_lineage"; orderId: null };

/**
 * Fail-closed contract for linking a Coupang CS ticket to an order. An order ID
 * is usable only when one order row matches the ticket owner and external order
 * reference and its lineage carries the same credential incarnation and seller
 * key. This mirrors the proposal contract without wiring the proposal into the
 * shared order or ticket readers.
 */
export function decideCoupangOrderLineage(input: {
  ticketOwnerId?: string | null;
  externalOrderReference?: string | null;
  expectedOrderRevision?: string | null;
  ticketCredentialId?: string | null;
  ticketSellerAccountKey?: string | null;
  candidates: CoupangOrderCandidate[];
}): CoupangOrderLineageDecision {
  const ownerId = input.ticketOwnerId?.trim() ?? "";
  const externalOrderReference = input.externalOrderReference?.trim() ?? "";
  const expectedOrderRevision = input.expectedOrderRevision?.trim() ?? "";
  const credentialId = input.ticketCredentialId?.trim() ?? "";
  const sellerAccountKey = input.ticketSellerAccountKey?.trim() ?? "";
  if (!externalOrderReference) {
    return { state: "not_applicable", orderId: null };
  }
  if (!ownerId || !credentialId || !SELLER_ACCOUNT_KEY.test(sellerAccountKey)) {
    return { state: "unverified_credential", orderId: null };
  }
  if (!ORDER_REVISION.test(expectedOrderRevision)) {
    return { state: "unverifiable_order_lineage", orderId: null };
  }

  const productOrderCandidates = input.candidates.filter((candidate) =>
    candidate.ownerId === ownerId
    && candidate.externalOrderId?.trim() === externalOrderReference);
  if (productOrderCandidates.length === 0) {
    return { state: "unmatched", orderId: null };
  }
  if (productOrderCandidates.length > 1) {
    return { state: "ambiguous_order_lineage", orderId: null };
  }

  const candidate = productOrderCandidates[0]!;
  if (candidate.sourceCredentialId !== credentialId
      || candidate.sellerAccountKey !== sellerAccountKey) {
    return { state: "unverifiable_order_lineage", orderId: null };
  }
  return candidate.orderRevision === expectedOrderRevision
    ? { state: "exact", orderId: candidate.id }
    : { state: "stale_order_lineage", orderId: null };
}
