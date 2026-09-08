export type OperationTicketDelivery = {
  jobId: string;
  ticketId: string;
  channel: string;
  inboundKey: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "reconciliation_required";
  verificationStatus?: "unverified" | "provider_accepted" | "remote_observed" | "reconciliation_required" | "failed";
  verificationContract?: string | null;
  safeMessage: string | null;
  reconciliationReason: string | null;
  qoo10S3StatusObserved?: boolean;
  qoo10S3StatusObservedAt?: string | null;
  qoo10S3LastCheckedAt?: string | null;
  qoo10S3ReadbackState?: "verified" | "pending" | "incomplete" | null;
  qoo10S3ReadbackReason?: string | null;
  qoo10S3MatchingRows?: number | null;
  qoo10S3VerificationContract?: string | null;
  qoo10ReplyContentObserved?: false;
  qoo10AutomaticResendAllowed?: false;
  providerRequestId: string | null;
  providerMessageId: string | null;
  providerAcceptedAt?: string | null;
  remoteObservedAt?: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type OperationTicket = {
  id: string;
  externalTicketId: string;
  channelKey: string;
  channelCode: string;
  customerName: string;
  subject: string;
  message: string;
  translatedMessage: string | null;
  replyDraft: string | null;
  replyDeliveryStatus: "never" | "preparing" | "sending" | "succeeded" | "failed" | "reconciliation_required";
  replyDeliveryError: string | null;
  replyOperationAttemptId: string | null;
  replyGatewayJobId: string | null;
  orderId: string | null;
  externalOrderReference?: string | null;
  providerStatus?: "unknown" | "waiting" | "answered" | "closed";
  providerStatusUpdatedAt?: string | null;
  providerContext?: Record<string, unknown>;
  latestInboundKey?: string | null;
  ticketKind?: "conversation" | "after_sales";
  latestMessageState?: "normal" | "recalled" | "conflict_review_required";
  replyAllowed?: boolean;
  delivery?: OperationTicketDelivery | null;
  blockingDelivery?: OperationTicketDelivery | null;
  status: "urgent" | "waiting" | "in_progress" | "resolved";
  priority: number;
  receivedAt: string;
  updatedAt: string;
  demo: boolean;
};

export type DisplayTicket = {
  sourceId: string;
  id: string;
  channelKey: string;
  customer: string;
  channel: string;
  subject: string;
  originalMessage: string;
  preview: string;
  replyDraft: string | null;
  replyDeliveryStatus: OperationTicket["replyDeliveryStatus"];
  replyDeliveryError: string | null;
  orderId: string | null;
  externalOrderReference: string | null;
  providerStatus: "unknown" | "waiting" | "answered" | "closed";
  latestInboundKey: string | null;
  ticketKind: "conversation" | "after_sales";
  latestMessageState: "normal" | "recalled" | "conflict_review_required";
  replyAllowed: boolean;
  remoteReplySupported: boolean;
  delivery: OperationTicketDelivery | null;
  blockingDelivery: OperationTicketDelivery | null;
  time: string;
  status: "긴급" | "답변 대기" | "처리 중" | "처리 완료";
};

export type DisplayOrder = {
  sourceId: string;
  id: string;
  channelKey: string;
  channel: string;
  customer: string;
  product: string;
  amount: string;
  status: string;
  time: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  carrierCode: string | null;
  trackingNumber: string | null;
  settlementStatus: string;
  settlementAmount: number | null;
  settlementCurrency: string | null;
  exchangeLossPercent: number | null;
};

export type ReplyQueueResult = {
  jobId: string;
  message: string;
  delivery: OperationTicketDelivery;
};

export type SupportLocale = "ko-KR" | "en-US" | "ja-JP" | "zh-TW" | "th-TH" | "vi-VN" | "id-ID" | "ms-MY" | "pt-BR" | "es-MX";

export type InquiryHistoryBackfill = {
  runId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "blocked";
  historyDays: number;
  fromDate: string;
  toDate: string;
  channels: Array<"coupang" | "elevenst" | "smartstore">;
  expectedInitialJobs: number;
  totalJobs: number;
  queuedJobs: number;
  runningJobs: number;
  succeededJobs: number;
  failedJobs: number;
  progressPercent: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  blockedReason?: "STATIC_EGRESS_REQUIRED";
  reused?: boolean;
  retriedJobs?: number;
};

export type CsSyncStatus = Array<{
    channel_key: string;
    data_type: "orders" | "inquiries";
    status: "never" | "queued" | "running" | "passed" | "failed" | "unsupported";
    imported_count: number;
    last_started_at: string | null;
    last_succeeded_at: string | null;
    last_error: string | null;
    updated_at: string;
  }>;
