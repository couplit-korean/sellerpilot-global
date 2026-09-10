import { z } from "zod";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const nullableTime = z.string().datetime({ offset: true }).nullable();
const count = z.number().int().nonnegative();

const canonicalCountsSchema = z.object({
  ticketCount: count,
  inboundMessageCount: count,
  waitingTicketCount: count,
  answeredTicketCount: count,
  closedTicketCount: count,
  unknownTicketCount: count,
  lastReceivedAt: nullableTime,
}).strict().superRefine((value, context) => {
  if (value.ticketCount !== value.waitingTicketCount
      + value.answeredTicketCount
      + value.closedTicketCount
      + value.unknownTicketCount) {
    context.addIssue({
      code: "custom",
      message: "QOO10_INQUIRY_SOURCE_CANONICAL_COUNTS_INVALID",
    });
  }
  if ((value.inboundMessageCount === 0) !== (value.lastReceivedAt === null)) {
    context.addIssue({
      code: "custom",
      message: "QOO10_INQUIRY_SOURCE_LAST_RECEIVED_INVALID",
    });
  }
});

const historyCountsSchema = z.object({
  windowCount: count,
  queuedWindowCount: count,
  completeWindowCount: count,
  refiningWindowCount: count,
  gapWindowCount: count,
  verifiedZeroWindowCount: count,
  positiveCompleteWindowCount: count,
  earliestCalendarDate: z.string().date().nullable(),
  latestCalendarDate: z.string().date().nullable(),
  lastUpdatedAt: nullableTime,
}).strict().superRefine((value, context) => {
  if (value.windowCount !== value.queuedWindowCount
      + value.completeWindowCount
      + value.refiningWindowCount
      + value.gapWindowCount
      || value.verifiedZeroWindowCount > value.completeWindowCount
      || value.positiveCompleteWindowCount > value.completeWindowCount) {
    context.addIssue({
      code: "custom",
      message: "QOO10_INQUIRY_SOURCE_HISTORY_COUNTS_INVALID",
    });
  }
  const noWindows = value.windowCount === 0;
  if (noWindows !== (value.earliestCalendarDate === null)
      || noWindows !== (value.latestCalendarDate === null)
      || noWindows !== (value.lastUpdatedAt === null)) {
    context.addIssue({
      code: "custom",
      message: "QOO10_INQUIRY_SOURCE_HISTORY_RANGE_INVALID",
    });
  }
});

export const qoo10InquirySourceReadSchema = z.object({
  contract: z.literal("sellerpilot-qoo10-inquiry-source-read/1"),
  checkedAt: z.string().datetime({ offset: true }),
  credentialId: uuid,
  sellerAccountKeyHash: sha256.nullable(),
  environment: z.literal("production"),
  scopeState: z.enum([
    "account_scoped",
    "credential_unavailable",
    "identity_unverified",
  ]),
  canonical: canonicalCountsSchema,
  history: historyCountsSchema,
}).strict().superRefine((value, context) => {
  if ((value.scopeState === "identity_unverified")
      !== (value.sellerAccountKeyHash === null)) {
    context.addIssue({
      code: "custom",
      message: "QOO10_INQUIRY_SOURCE_SCOPE_INVALID",
    });
  }
  if (value.scopeState !== "account_scoped"
      && (value.canonical.ticketCount !== 0
        || value.canonical.inboundMessageCount !== 0
        || value.history.windowCount !== 0)) {
    context.addIssue({
      code: "custom",
      message: "QOO10_INQUIRY_SOURCE_UNVERIFIED_COUNTS_INVALID",
    });
  }
});

export type Qoo10InquirySourceRead = z.infer<typeof qoo10InquirySourceReadSchema>;

export const qoo10OfficialInquirySourceCapability = Object.freeze({
  contractVersion: "sellerpilot-qoo10-official-inquiry-source/1",
  source: "qapi_sales_inquiry",
  receiveMethod: "CSCenter.GetInquiryMessage",
  replyMethod: "CSCenter.SetInquiryMessage",
  adapter: "lib/cs/channels/qoo10/adapter.ts",
  normalizer: "lib/channels/inquiry-sync.ts",
  canonicalStore: "sellerpilot_private.support_tickets+support_inbound_messages",
  historyLedger: "sellerpilot_private.qoo10_history_windows",
  receiveSupported: true,
  replySupported: true,
  reviewOrBuyerChatPromotionAllowed: false,
});

export const qoo10UnsupportedSourceCapabilities = Object.freeze({
  review: {
    source: "qsm_review_export",
    officialQapiMethod: null,
    supportState: "unsupported",
    reason: "qsm_export_row_contract_unverified",
  },
  buyerChat: {
    source: "official_buyer_chat_source_unavailable",
    officialQapiMethod: null,
    supportState: "unsupported",
    reason: "official_receive_history_contract_unavailable",
  },
});
