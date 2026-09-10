export type BaseNormalizedChannelInquiry = {
  externalTicketId: string;
  customerName: string;
  subject: string;
  message: string;
  status: "waiting" | "resolved";
  priority: number;
  receivedAt: string;
  remoteMessageId?: string;
  senderRole?: "customer" | "seller" | "system";
  orderingStatus?: "unverified" | "conflict";
  providerContext?: Record<string, unknown>;
  externalOrderReference?: string;
  ticketKind?: "conversation" | "after_sales";
  replyContext?: Record<string, unknown>;
};

export type NormalizedChannelInquiry = BaseNormalizedChannelInquiry & {
  inboundKey: string;
  providerStatus: "waiting" | "answered";
  providerContext: Record<string, unknown>;
  ticketKind: "conversation" | "after_sales";
};
