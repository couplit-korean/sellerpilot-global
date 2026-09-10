import { z } from "zod";

export const EBAY_PUBLICATION_RECONCILIATION_CONTRACT =
  "sellerpilot-ebay-publication-reconciliation/1" as const;
export const EBAY_PUBLICATION_RECONCILIATION_CLAIM_MODE =
  "ebay_publication_reconciliation" as const;
export const EBAY_PUBLICATION_RECONCILIATION_CLAIM_RPC =
  "sellerpilot_claim_ebay_publication_reconciliation" as const;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^[a-f0-9]{64}$/u;
const safeIdentityPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;

export const ebayPublicationReconciliationBindingSchema = z.object({
  contract: z.literal(EBAY_PUBLICATION_RECONCILIATION_CONTRACT),
  sourceJobId: z.string().regex(uuidPattern),
  attemptId: z.string().regex(uuidPattern),
  credentialId: z.string().regex(uuidPattern),
  sku: z.string().regex(safeIdentityPattern),
  marketplaceId: z.literal("EBAY_US"),
  offerId: z.string().regex(safeIdentityPattern).nullable(),
  lastStage: z.enum(["inventory", "offer", "publish"]),
  requestFingerprint: z.string().regex(digestPattern),
}).strict();

export type EbayPublicationReconciliationBinding = z.infer<
  typeof ebayPublicationReconciliationBindingSchema
>;
