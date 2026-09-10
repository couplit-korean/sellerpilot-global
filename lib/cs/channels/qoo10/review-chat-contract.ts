import { z } from "zod";
import { qoo10ReviewCapability } from "../../../channels/cs/qoo10/review";
import {
  qoo10InquirySourceReadSchema,
  qoo10OfficialInquirySourceCapability,
  qoo10UnsupportedSourceCapabilities,
  type Qoo10InquirySourceRead,
} from "./source-capability";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const nullableTime = z.string().datetime({ offset: true }).nullable();
const navigationResultSchema = z.enum([
  "history_visible",
  "redirected_to_login",
  "unavailable",
]);

export const qoo10ReviewChatHistoryStateSchema = z.enum([
  "unknown",
  "verified_zero",
  "imported_reconciled",
]);

const observationSchema = z.object({
  historyState: qoo10ReviewChatHistoryStateSchema,
  observedCount: z.number().int().nonnegative().nullable(),
  importedCount: z.number().int().nonnegative(),
  reconciledCount: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.historyState === "unknown"
      && (value.observedCount !== null
        || value.importedCount !== 0
        || value.reconciledCount !== 0)) {
    context.addIssue({
      code: "custom",
      message: "QOO10_REVIEW_CHAT_UNKNOWN_COUNTS_INVALID",
    });
  }
  if (value.historyState === "verified_zero"
      && (value.observedCount !== 0
        || value.importedCount !== 0
        || value.reconciledCount !== 0)) {
    context.addIssue({
      code: "custom",
      message: "QOO10_REVIEW_CHAT_ZERO_COUNTS_INVALID",
    });
  }
  if (value.historyState === "imported_reconciled"
      && (value.observedCount === null
        || value.importedCount < 1
        || value.observedCount !== value.importedCount
        || value.importedCount !== value.reconciledCount)) {
    context.addIssue({
      code: "custom",
      message: "QOO10_REVIEW_CHAT_RECONCILIATION_INVALID",
    });
  }
});

export const qoo10ReviewChatAccountSchema = z.object({
  credentialId: uuid,
  label: z.string().min(1).max(120),
  credentialState: z.enum([
    "active",
    "grace",
    "expired",
    "revoked",
    "invalid",
    "unverified",
  ]),
  credentialExpiresAt: nullableTime,
  sellerAccountBinding: z.enum([
    "provider_certified",
    "credential_incarnation",
    "unverified",
  ]),
  sellerAccountKeyHash: sha256.nullable(),
  environment: z.literal("production"),
}).strict();

export const qoo10ReviewChatAccountsSchema = z.object({
  contract: z.literal("sellerpilot-qoo10-review-chat-accounts/2"),
  checkedAt: z.string().datetime({ offset: true }),
  accounts: z.array(qoo10ReviewChatAccountSchema).max(100),
}).strict();

export const qoo10ReviewChatDurableObservationSchema = z.object({
  contract: z.literal("sellerpilot-qoo10-review-chat-durable-observation/1"),
  source: z.literal("sellerpilot_private.qoo10_review_chat_observations"),
  sourceRevision: z.number().int().positive(),
  sourceRevisionSha256: sha256,
  sourceArtifactId: z.string()
    .min(8)
    .max(240)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]+$/u),
  sourceArtifactSha256: sha256,
  credentialId: uuid,
  sellerAccountKeyHash: sha256,
  environment: z.literal("production"),
  observedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
  sellerDashboardVisible: z.boolean(),
  buyerInquirySummaryVisible: z.boolean(),
  reviewHistoryVisible: z.boolean(),
  reviewNavigationResult: navigationResultSchema,
  review: observationSchema,
  buyerChatHistoryVisible: z.literal(false),
  buyerChatNavigationResult: z.literal("unavailable"),
  buyerChat: observationSchema,
}).strict().superRefine((value, context) => {
  if ((!value.reviewHistoryVisible
      || value.reviewNavigationResult !== "history_visible")
      && value.review.historyState !== "unknown") {
    context.addIssue({
      code: "custom",
      message: "QOO10_REVIEW_SOURCE_NOT_VISIBLE",
    });
  }
  if (value.buyerChat.historyState !== "unknown") {
    context.addIssue({
      code: "custom",
      message: "QOO10_BUYER_CHAT_CONTRACT_UNVERIFIED",
    });
  }
  if (Date.parse(value.validUntil) <= Date.parse(value.observedAt)
      || Date.parse(value.validUntil) - Date.parse(value.observedAt) > 15 * 60_000) {
    context.addIssue({
      code: "custom",
      message: "QOO10_REVIEW_CHAT_EVIDENCE_INTERVAL_INVALID",
    });
  }
});

export const qoo10ReviewChatObservationReadSchema = z.object({
  contract: z.literal("sellerpilot-qoo10-review-chat-observation-read/1"),
  checkedAt: z.string().datetime({ offset: true }),
  account: qoo10ReviewChatAccountSchema,
  observationState: z.enum(["no_evidence", "current", "expired"]),
  evidence: qoo10ReviewChatDurableObservationSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.observationState === "no_evidence") !== (value.evidence === null)) {
    context.addIssue({
      code: "custom",
      message: "QOO10_REVIEW_CHAT_OBSERVATION_STATE_INVALID",
    });
  }
  if (!value.evidence) return;
  if (value.evidence.credentialId !== value.account.credentialId
      || value.evidence.environment !== value.account.environment
      || value.evidence.sellerAccountKeyHash !== value.account.sellerAccountKeyHash) {
    context.addIssue({
      code: "custom",
      message: "QOO10_REVIEW_CHAT_OBSERVATION_SCOPE_MISMATCH",
    });
  }
  const checkedAt = Date.parse(value.checkedAt);
  if (Date.parse(value.evidence.observedAt) > checkedAt) {
    context.addIssue({
      code: "custom",
      message: "QOO10_REVIEW_CHAT_EVIDENCE_FROM_FUTURE",
    });
  }
  const isExpired = Date.parse(value.evidence.validUntil) <= checkedAt;
  if ((value.observationState === "expired") !== isExpired) {
    context.addIssue({
      code: "custom",
      message: "QOO10_REVIEW_CHAT_EXPIRY_STATE_INVALID",
    });
  }
});

export type Qoo10ReviewChatAccount = z.infer<typeof qoo10ReviewChatAccountSchema>;
export type Qoo10ReviewChatAccounts = z.infer<typeof qoo10ReviewChatAccountsSchema>;
export type Qoo10ReviewChatDurableObservation = z.infer<
  typeof qoo10ReviewChatDurableObservationSchema
>;
export type Qoo10ReviewChatObservationRead = z.infer<
  typeof qoo10ReviewChatObservationReadSchema
>;

const surfaceEvidenceStateSchema = z.enum([
  "no_evidence",
  "missing_source",
  "current",
  "expired",
  "identity_unverified",
  "credential_unavailable",
  "contract_unverified",
  "unsupported",
]);

const surfaceSchema = z.object({
  key: z.enum(["review", "buyer_chat"]),
  label: z.string().min(1).max(80),
  source: z.string().min(1).max(120),
  officialQapiMethod: z.null(),
  supportState: z.literal("unsupported"),
  unsupportedReason: z.string().min(1).max(160),
  evidenceState: surfaceEvidenceStateSchema,
  historyState: qoo10ReviewChatHistoryStateSchema,
  observedCount: z.number().int().nonnegative().nullable(),
  importedCount: z.number().int().nonnegative(),
  reconciledCount: z.number().int().nonnegative(),
  missingSource: z.string().min(1).max(160).nullable(),
  missingPermission: z.string().min(1).max(160).nullable(),
  receiveEnabled: z.literal(false),
  historyImportEnabled: z.literal(false),
  replyEnabled: z.literal(false),
}).strict();

export const qoo10ReviewChatStatusSchema = z.object({
  contract: z.literal("sellerpilot-qoo10-review-chat-status/3"),
  checkedAt: z.string().datetime({ offset: true }),
  account: qoo10ReviewChatAccountSchema,
  accountEvidenceState: z.enum([
    "current",
    "identity_unverified",
    "credential_unavailable",
  ]),
  observationState: z.enum(["no_evidence", "current", "expired"]),
  lastEvidence: z.object({
    sourceRevision: z.number().int().positive(),
    sourceRevisionSha256: sha256,
    sourceArtifactId: z.string().min(8).max(240),
    sourceArtifactSha256: sha256,
    observedAt: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }),
    sellerDashboardVisible: z.boolean(),
    buyerInquirySummaryVisible: z.boolean(),
    reviewHistoryVisible: z.boolean(),
    reviewNavigationResult: navigationResultSchema,
    buyerChatHistoryVisible: z.literal(false),
    buyerChatNavigationResult: z.literal("unavailable"),
  }).strict().nullable(),
  inquiryHistory: z.object({
    separateSurface: z.literal(true),
    canPromoteReviewOrBuyerChat: z.literal(false),
  }).strict(),
  ordinaryInquiry: z.object({
    key: z.literal("ordinary_inquiry"),
    label: z.string().min(1).max(80),
    source: z.literal("qapi_sales_inquiry"),
    supportState: z.literal("supported"),
    evidenceState: z.enum([
      "canonical_rows",
      "verified_zero",
      "not_observed",
      "incomplete_coverage",
      "persistence_mismatch",
      "identity_unverified",
      "credential_unavailable",
    ]),
    receiveMethod: z.literal("CSCenter.GetInquiryMessage"),
    replyMethod: z.literal("CSCenter.SetInquiryMessage"),
    adapter: z.literal("lib/cs/channels/qoo10/adapter.ts"),
    normalizer: z.literal("lib/channels/inquiry-sync.ts"),
    canonicalStore: z.literal(
      "sellerpilot_private.support_tickets+support_inbound_messages",
    ),
    historyLedger: z.literal("sellerpilot_private.qoo10_history_windows"),
    receiveImplemented: z.literal(true),
    canonicalPersistenceImplemented: z.literal(true),
    replyImplemented: z.literal(true),
    panelReplyActionEnabled: z.literal(false),
    canonical: qoo10InquirySourceReadSchema.shape.canonical,
    history: qoo10InquirySourceReadSchema.shape.history,
  }).strict(),
  review: surfaceSchema,
  buyerChat: surfaceSchema,
  recordingBoundary: z.object({
    browserWriteAvailable: z.literal(false),
    serviceRoleOnly: z.literal(true),
    permissionsGrantedByObservation: z.literal(false),
  }).strict(),
  customerActionsAvailable: z.literal(false),
}).strict();

export type Qoo10ReviewChatStatus = z.infer<typeof qoo10ReviewChatStatusSchema>;

function unavailableObservation() {
  return {
    historyState: "unknown" as const,
    observedCount: null,
    importedCount: 0,
    reconciledCount: 0,
  };
}

function accountEvidenceState(account: Qoo10ReviewChatAccount) {
  if (account.credentialState !== "active") {
    return "credential_unavailable" as const;
  }
  if (account.sellerAccountBinding === "unverified"
      || account.sellerAccountKeyHash === null) {
    return "identity_unverified" as const;
  }
  return "current" as const;
}

function reviewEvidenceState(input: {
  accountState: ReturnType<typeof accountEvidenceState>;
  read: Qoo10ReviewChatObservationRead;
}) {
  if (input.accountState !== "current") return input.accountState;
  if (input.read.observationState === "no_evidence") return "no_evidence" as const;
  if (input.read.observationState === "expired") return "expired" as const;
  if (!input.read.evidence?.reviewHistoryVisible
      || input.read.evidence.reviewNavigationResult !== "history_visible") {
    return "missing_source" as const;
  }
  return "current" as const;
}

function ordinaryInquiryEvidenceState(input: {
  accountState: ReturnType<typeof accountEvidenceState>;
  read: Qoo10InquirySourceRead;
}) {
  if (input.accountState !== "current") return input.accountState;
  if (input.read.scopeState !== "account_scoped") return "identity_unverified" as const;
  if (input.read.history.positiveCompleteWindowCount > 0
      && input.read.canonical.inboundMessageCount === 0) {
    return "persistence_mismatch" as const;
  }
  if (input.read.canonical.inboundMessageCount > 0) return "canonical_rows" as const;
  if (input.read.history.verifiedZeroWindowCount > 0) return "verified_zero" as const;
  if (input.read.history.queuedWindowCount > 0
      || input.read.history.refiningWindowCount > 0
      || input.read.history.gapWindowCount > 0) {
    return "incomplete_coverage" as const;
  }
  return "not_observed" as const;
}

export function projectQoo10ReviewChatStatus(input: {
  expectedAccount: unknown;
  runtimeRead: unknown;
  inquirySourceRead: unknown;
}): Qoo10ReviewChatStatus {
  const expectedAccount = qoo10ReviewChatAccountSchema.parse(input.expectedAccount);
  const read = qoo10ReviewChatObservationReadSchema.parse(input.runtimeRead);
  const inquirySourceRead = qoo10InquirySourceReadSchema.parse(input.inquirySourceRead);
  if (JSON.stringify(read.account) !== JSON.stringify(expectedAccount)) {
    throw new Error("QOO10_REVIEW_CHAT_SELECTED_ACCOUNT_MISMATCH");
  }
  if (inquirySourceRead.credentialId !== expectedAccount.credentialId
      || inquirySourceRead.environment !== expectedAccount.environment
      || inquirySourceRead.sellerAccountKeyHash !== expectedAccount.sellerAccountKeyHash) {
    throw new Error("QOO10_INQUIRY_SOURCE_SELECTED_ACCOUNT_MISMATCH");
  }

  const accountState = accountEvidenceState(read.account);
  const reviewState = reviewEvidenceState({ accountState, read });
  const review = reviewState === "current" && read.evidence
    ? read.evidence.review
    : unavailableObservation();
  const evidence = read.evidence;
  const ordinaryInquiryState = ordinaryInquiryEvidenceState({
    accountState: accountState,
    read: inquirySourceRead,
  });
  return qoo10ReviewChatStatusSchema.parse({
    contract: "sellerpilot-qoo10-review-chat-status/3",
    checkedAt: read.checkedAt,
    account: read.account,
    accountEvidenceState: accountState,
    observationState: read.observationState,
    lastEvidence: evidence ? {
      sourceRevision: evidence.sourceRevision,
      sourceRevisionSha256: evidence.sourceRevisionSha256,
      sourceArtifactId: evidence.sourceArtifactId,
      sourceArtifactSha256: evidence.sourceArtifactSha256,
      observedAt: evidence.observedAt,
      validUntil: evidence.validUntil,
      sellerDashboardVisible: evidence.sellerDashboardVisible,
      buyerInquirySummaryVisible: evidence.buyerInquirySummaryVisible,
      reviewHistoryVisible: evidence.reviewHistoryVisible,
      reviewNavigationResult: evidence.reviewNavigationResult,
      buyerChatHistoryVisible: evidence.buyerChatHistoryVisible,
      buyerChatNavigationResult: evidence.buyerChatNavigationResult,
    } : null,
    inquiryHistory: {
      separateSurface: true,
      canPromoteReviewOrBuyerChat: false,
    },
    ordinaryInquiry: {
      key: "ordinary_inquiry",
      label: "일반 문의 MSG·HELP·ITEM",
      source: qoo10OfficialInquirySourceCapability.source,
      supportState: "supported",
      evidenceState: ordinaryInquiryState,
      receiveMethod: qoo10OfficialInquirySourceCapability.receiveMethod,
      replyMethod: qoo10OfficialInquirySourceCapability.replyMethod,
      adapter: qoo10OfficialInquirySourceCapability.adapter,
      normalizer: qoo10OfficialInquirySourceCapability.normalizer,
      canonicalStore: qoo10OfficialInquirySourceCapability.canonicalStore,
      historyLedger: qoo10OfficialInquirySourceCapability.historyLedger,
      receiveImplemented: true,
      canonicalPersistenceImplemented: true,
      replyImplemented: true,
      panelReplyActionEnabled: false,
      canonical: inquirySourceRead.canonical,
      history: inquirySourceRead.history,
    },
    review: {
      key: "review",
      label: "상품 리뷰·댓글",
      source: qoo10ReviewCapability.source,
      officialQapiMethod: qoo10ReviewCapability.officialQapiMethod,
      supportState: "unsupported",
      unsupportedReason: qoo10UnsupportedSourceCapabilities.review.reason,
      evidenceState: "unsupported",
      ...review,
      missingSource: reviewState === "current"
        ? null
        : reviewState === "expired"
          ? "fresh_credential_bound_qsm_review_observation"
          : "credential_bound_qsm_review_observation",
      missingPermission: reviewState === "current"
        ? null
        : "fresh_authenticated_qsm_history_session",
      receiveEnabled: false,
      historyImportEnabled: false,
      replyEnabled: false,
    },
    buyerChat: {
      key: "buyer_chat",
      label: "Buyer Chat·판매자 채팅",
      source: "verified_official_buyer_chat_contract",
      officialQapiMethod: null,
      supportState: "unsupported",
      unsupportedReason: qoo10UnsupportedSourceCapabilities.buyerChat.reason,
      evidenceState: "unsupported",
      ...unavailableObservation(),
      missingSource: "official_buyer_chat_history_source_and_format",
      missingPermission: "account_scoped_buyer_chat_permission",
      receiveEnabled: false,
      historyImportEnabled: false,
      replyEnabled: false,
    },
    recordingBoundary: {
      browserWriteAvailable: false,
      serviceRoleOnly: true,
      permissionsGrantedByObservation: false,
    },
    customerActionsAvailable: false,
  });
}
