import { z } from "zod";

const blocker = z.string().regex(/^TEMU_[A-Z0-9_]+$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid();

export const temuBuyerChatSourceReceiptSchema = z.object({
  contract: z.literal("sellerpilot-temu-buyer-chat-source-receipt/1"),
  source: z.literal("sellerpilot_private.temu_buyer_chat_readiness_evidence"),
  receiptId: uuid,
  credentialId: uuid,
  sellerAccountKey: digest,
  environment: z.enum(["sandbox", "production"]),
  region: z.literal("GLOBAL"),
  rawSha256: digest,
  observedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  evidence: z.unknown(),
}).strict();

export type TemuBuyerChatSourceReceipt = z.infer<typeof temuBuyerChatSourceReceiptSchema>;

export const temuBuyerChatSourceStatusSchema = z.object({
  contract: z.literal("sellerpilot-temu-buyer-chat-source-status/1"),
  checkedAt: z.string().datetime({ offset: true }),
  credentialId: uuid,
  sellerAccountKey: digest,
  environment: z.enum(["sandbox", "production"]),
  sourceAdapterImplemented: z.literal(true),
  currentAssignmentLocalImplementationComplete: z.literal(true),
  localState: z.literal("implemented_fail_closed"),
  providerState: z.literal("unsupported"),
  officialContractVerified: z.literal(false),
  verifiedSourceReceiptAccepted: z.literal(false),
  providerFetchPerformed: z.literal(false),
  rawAccepted: z.literal(false),
  canonicalPromotionAllowed: z.literal(false),
  canonicalPromotionPerformed: z.literal(false),
  canonicalInquiry: z.null(),
  receive: z.literal(false),
  history: z.literal(false),
  reply: z.literal(false),
  readback: z.literal(false),
  localBlockers: z.array(blocker).max(8),
  providerEnablementBlockers: z.array(blocker).max(32),
  sourceBlockers: z.array(blocker).min(1).max(40),
}).strict().superRefine((value, context) => {
  if (value.localBlockers.length !== 0) {
    context.addIssue({ code: "custom", message: "implemented fail-closed boundary has local blockers" });
  }
  const expected = [...new Set([
    ...value.providerEnablementBlockers,
    "TEMU_BUYER_CHAT_VERIFIED_SOURCE_RECEIPT_REQUIRED",
    "TEMU_BUYER_CHAT_OFFICIAL_API_CONTRACT_UNAVAILABLE",
    "TEMU_BUYER_CHAT_SOURCE_UNSUPPORTED",
  ])];
  if (JSON.stringify(value.sourceBlockers) !== JSON.stringify(expected)) {
    context.addIssue({ code: "custom", message: "source blocker composition mismatch" });
  }
});

export type TemuBuyerChatSourceStatus = z.infer<typeof temuBuyerChatSourceStatusSchema>;

export const temuBuyerChatSourceAdapterResultSchema = z.object({
  contract: z.literal("sellerpilot-temu-buyer-chat-source-adapter-result/1"),
  status: temuBuyerChatSourceStatusSchema,
  rawSha256: digest.nullable(),
  rawBytes: z.number().int().min(0).max(256_000),
  receiptStructurallyValid: z.boolean(),
  receiptRawBindingMatched: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.status.canonicalPromotionPerformed || value.status.canonicalInquiry !== null) {
    context.addIssue({ code: "custom", message: "unsupported source cannot produce canonical inquiry" });
  }
  if (value.receiptRawBindingMatched && !value.receiptStructurallyValid) {
    context.addIssue({ code: "custom", message: "raw binding requires a structural receipt" });
  }
});

export type TemuBuyerChatSourceAdapterResult = z.infer<
  typeof temuBuyerChatSourceAdapterResultSchema
>;
