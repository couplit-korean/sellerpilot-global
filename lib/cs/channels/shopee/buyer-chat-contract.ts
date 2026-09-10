import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u);
const shopId = z.string().regex(/^[1-9]\d{0,31}$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.string().datetime({ offset: true });

export const shopeeBuyerChatReadQuerySchema = z.object({
  credentialId: z.string().uuid().optional(),
  shopId: shopId.optional(),
  conversationId: id.optional(),
  cursor: z.string().min(1).max(1_024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict().superRefine((value, context) => {
  if ((value.credentialId || value.conversationId || value.cursor) && !value.shopId) {
    context.addIssue({ code: "custom", message: "exact Buyer Chat shop scope required" });
  }
  if (value.cursor && !value.credentialId) {
    context.addIssue({ code: "custom", message: "exact Buyer Chat credential scope required" });
  }
});

export const shopeeBuyerChatMessageSchema = z.object({
  shopId,
  conversationId: id,
  messageId: id,
  identityDigest: digest,
  senderRole: z.enum(["buyer", "seller", "system"]),
  body: z.string().min(1).max(4_000),
  bodyFingerprint: digest,
  sentAt: instant,
  orderSn: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u).nullable(),
  itemId: z.string().regex(/^[1-9]\d{0,31}$/u).nullable(),
  attachmentCount: z.number().int().min(0).max(20),
}).strict();

const shopeeMediaReferenceSchema = z.string().min(1).max(2_048)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u);
const shopeeOfficialImageUrlSchema = z.string().min(1).max(2_048).superRefine(
  (value, context) => {
    try {
      const parsed = new URL(value);
      const officialHost = /^cf[.]shopee[.](?:sg|com[.]my|co[.]th|vn|co[.]id|ph|com[.]br|jp|kr|com[.]hk|cn)$/u;
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port
          || parsed.search || parsed.hash || !officialHost.test(parsed.hostname)
          || !/^\/file\/[A-Za-z0-9._~%/-]{1,1900}$/u.test(parsed.pathname)
          || parsed.pathname.includes("..") || parsed.href !== value) {
        context.addIssue({ code: "custom", message: "invalid Shopee media URL" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "invalid Shopee media URL" });
    }
  },
);

export const shopeeBuyerChatMediaSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image"),
    imageUrl: shopeeOfficialImageUrlSchema,
    thumbnailReference: shopeeMediaReferenceSchema,
    thumbnailWidth: z.number().int().positive().max(20_000),
    thumbnailHeight: z.number().int().positive().max(20_000),
    fileServerId: z.string().regex(/^\d{1,32}$/u),
  }).strict(),
  z.object({
    type: z.literal("video"),
    videoReference: shopeeMediaReferenceSchema,
    thumbnailReference: shopeeMediaReferenceSchema,
    thumbnailWidth: z.number().int().positive().max(20_000),
    thumbnailHeight: z.number().int().positive().max(20_000),
    durationSeconds: z.number().int().positive().max(86_400),
  }).strict(),
  z.object({
    type: z.literal("item"),
    itemShopId: shopId,
    itemId: z.string().regex(/^[1-9]\d{0,31}$/u),
    sourceItemId: z.string().regex(/^[1-9]\d{0,31}$/u),
  }).strict(),
]);

export const shopeeBuyerChatMediaRecordSchema = z.object({
  credentialId: z.string().uuid(),
  shopId,
  conversationId: id,
  messageId: id,
  media: shopeeBuyerChatMediaSchema,
}).strict();

export const shopeeBuyerChatMediaReadSchema = z.object({
  contract: z.literal("sellerpilot-shopee-buyer-chat-media-read/1"),
  checkedAt: instant,
  records: z.array(shopeeBuyerChatMediaRecordSchema).max(800),
}).strict();

export const shopeeBuyerChatApiMessageSchema = shopeeBuyerChatMessageSchema.safeExtend({
  media: shopeeBuyerChatMediaSchema.nullable(),
});

export const shopeeBuyerChatShopReadSchema = z.object({
  credentialId: z.string().uuid(),
  shopId,
  state: z.enum(["permission_pending", "read_only_ready"]),
  runtimeReady: z.boolean(),
  storedHistory: z.boolean(),
  conversationCount: z.number().int().nonnegative(),
  messages: z.array(shopeeBuyerChatMessageSchema).max(100),
  nextCursor: z.string().min(1).max(1_024).nullable(),
}).strict().superRefine((value, context) => {
  if (value.runtimeReady !== (value.state === "read_only_ready")
      || value.storedHistory !== (value.conversationCount > 0)
      || (!value.storedHistory && (value.messages.length !== 0 || value.nextCursor !== null))) {
    context.addIssue({ code: "custom", message: "invalid Buyer Chat runtime/history projection" });
  }
});

export const shopeeBuyerChatReadSchema = z.object({
  contract: z.literal("sellerpilot-shopee-buyer-chat-read/2"),
  checkedAt: instant,
  state: z.enum(["permission_pending", "read_only_ready"]),
  reason: z.enum([
    "contract_permission_unverified",
    "app_approval_unverified",
    "webhook_permission_unverified",
    "credential_unavailable",
    "approved_read_only",
  ]),
  receive: z.boolean(),
  history: z.boolean(),
  storedHistory: z.boolean(),
  reply: z.literal(false),
  shops: z.array(shopeeBuyerChatShopReadSchema).max(8),
}).strict().superRefine((value, context) => {
  const ready = value.shops.some((shop) => shop.runtimeReady);
  const stored = value.shops.some((shop) => shop.storedHistory);
  if (value.receive !== ready || value.history !== ready
      || value.storedHistory !== stored
      || (value.state === "read_only_ready") !== ready
      || (ready && value.reason !== "approved_read_only")
      || (!ready && value.shops.some((shop) => shop.runtimeReady))) {
    context.addIssue({ code: "custom", message: "invalid Buyer Chat capability projection" });
  }
});

export const shopeeBuyerChatTransportSchema = z.object({
  state: z.literal("verified_push_receiver_implemented"),
  trustedIngestEntrypoint: z.literal(true),
  providerNetworkAdapter: z.literal(true),
  automaticReads: z.literal(false),
  webhookReceiver: z.literal(true),
  reply: z.literal(false),
}).strict();

export const shopeeBuyerChatPushObservationShopSchema = z.object({
  credentialId: z.string().uuid(),
  shopId,
  receiverImplemented: z.literal(true),
  credentialCurrent: z.boolean(),
  entitlementCurrent: z.boolean(),
  verifiedReceipt: z.boolean(),
  lastVerifiedReceivedAt: instant.nullable(),
  currentConnectionVerified: z.literal(false),
}).strict().superRefine((value, context) => {
  if (value.entitlementCurrent && !value.credentialCurrent
      || value.verifiedReceipt !== (value.lastVerifiedReceivedAt !== null)) {
    context.addIssue({ code: "custom", message: "invalid Buyer Chat push observation" });
  }
});

export const shopeeBuyerChatPushObservationSchema = z.object({
  contract: z.literal("sellerpilot-shopee-buyer-chat-push-status/1"),
  checkedAt: instant,
  receiverImplemented: z.literal(true),
  operationalReceive: z.literal(false),
  automaticHistoryCollection: z.literal(false),
  reply: z.literal(false),
  shops: z.array(shopeeBuyerChatPushObservationShopSchema).max(8),
}).strict();

const ledgerPermissionStateSchema = z.enum(["permission_pending", "page_evidence_approved"]);
const ledgerPermissionReasonSchema = z.enum([
  "contract_permission_unverified",
  "app_approval_unverified",
  "webhook_permission_unverified",
  "credential_unavailable",
  "approved_page_evidence",
]);

export const shopeeBuyerChatApiShopSchema = z.object({
  credentialId: z.string().uuid(),
  shopId,
  ledgerPermissionState: ledgerPermissionStateSchema,
  storedHistory: z.boolean(),
  conversationCount: z.number().int().nonnegative(),
  messages: z.array(shopeeBuyerChatApiMessageSchema).max(100),
  nextCursor: z.string().min(1).max(1_024).nullable(),
  push: shopeeBuyerChatPushObservationShopSchema,
}).strict().superRefine((value, context) => {
  if (value.storedHistory !== (value.conversationCount > 0)
      || (!value.storedHistory && (value.messages.length !== 0 || value.nextCursor !== null))
      || value.credentialId !== value.push.credentialId
      || value.shopId !== value.push.shopId
      || value.messages.some((message) => message.media !== null
        && (message.attachmentCount !== 1
          || message.media.type === "item" && (message.itemId !== message.media.itemId
            || message.body !== "Shopee 상품 정보")
          || message.media.type === "image" && (message.itemId !== null
            || message.body !== "Shopee 이미지 첨부")
          || message.media.type === "video" && (message.itemId !== null
            || message.body !== "Shopee 동영상 첨부")))) {
    context.addIssue({ code: "custom", message: "invalid Buyer Chat stored-history projection" });
  }
});

export const shopeeBuyerChatApiSchema = z.object({
  contract: z.literal("sellerpilot-shopee-buyer-chat-status/1"),
  checkedAt: instant,
  ledgerPermissionState: ledgerPermissionStateSchema,
  ledgerPermissionReason: ledgerPermissionReasonSchema,
  operationalReceive: z.literal(false),
  automaticHistoryCollection: z.literal(false),
  storedHistory: z.boolean(),
  reply: z.literal(false),
  shops: z.array(shopeeBuyerChatApiShopSchema).max(8),
  transport: shopeeBuyerChatTransportSchema,
}).strict().superRefine((value, context) => {
  const approved = value.shops.some((shop) => shop.ledgerPermissionState === "page_evidence_approved");
  const stored = value.shops.some((shop) => shop.storedHistory);
  if (value.storedHistory !== stored
      || (value.ledgerPermissionState === "page_evidence_approved") !== approved
      || (approved && value.ledgerPermissionReason !== "approved_page_evidence")
      || (!approved && value.ledgerPermissionReason === "approved_page_evidence")) {
    context.addIssue({ code: "custom", message: "invalid Buyer Chat status projection" });
  }
});

export const SHOPEE_BUYER_CHAT_TRANSPORT = {
  state: "verified_push_receiver_implemented",
  trustedIngestEntrypoint: true,
  providerNetworkAdapter: true,
  automaticReads: false,
  webhookReceiver: true,
  reply: false,
} as const;

export type ShopeeBuyerChatRead = z.infer<typeof shopeeBuyerChatReadSchema>;
export type ShopeeBuyerChatTransport = z.infer<typeof shopeeBuyerChatTransportSchema>;
export type ShopeeBuyerChatShopRead = z.infer<typeof shopeeBuyerChatShopReadSchema>;
export type ShopeeBuyerChatMessage = z.infer<typeof shopeeBuyerChatMessageSchema>;
export type ShopeeBuyerChatApiMessage = z.infer<typeof shopeeBuyerChatApiMessageSchema>;
export type ShopeeBuyerChatApi = z.infer<typeof shopeeBuyerChatApiSchema>;

export function projectShopeeBuyerChatApi(
  ledgerInput: ShopeeBuyerChatRead,
  transportInput: ShopeeBuyerChatTransport,
  pushObservationInput?: z.infer<typeof shopeeBuyerChatPushObservationSchema>,
  mediaReadInput?: z.infer<typeof shopeeBuyerChatMediaReadSchema>,
): ShopeeBuyerChatApi {
  const ledger = shopeeBuyerChatReadSchema.parse(ledgerInput);
  const transport = shopeeBuyerChatTransportSchema.parse(transportInput);
  const pushObservation = shopeeBuyerChatPushObservationSchema.parse(
    pushObservationInput ?? {
      contract: "sellerpilot-shopee-buyer-chat-push-status/1",
      checkedAt: ledger.checkedAt,
      receiverImplemented: true,
      operationalReceive: false,
      automaticHistoryCollection: false,
      reply: false,
      shops: ledger.shops.map((shop) => ({
        credentialId: shop.credentialId,
        shopId: shop.shopId,
        receiverImplemented: true,
        credentialCurrent: false,
        entitlementCurrent: false,
        verifiedReceipt: false,
        lastVerifiedReceivedAt: null,
        currentConnectionVerified: false,
      })),
    },
  );
  const pushByScope = new Map(pushObservation.shops.map((shop) => [
    `${shop.credentialId}:${shop.shopId}`, shop,
  ]));
  if (pushByScope.size !== ledger.shops.length
      || pushObservation.shops.length !== ledger.shops.length) {
    throw new Error("SHOPEE_BUYER_CHAT_PUSH_STATUS_SCOPE_MISMATCH");
  }
  const messageScopes = new Set(ledger.shops.flatMap((shop) => shop.messages.map((message) => (
    `${shop.credentialId}\n${shop.shopId}\n${message.conversationId}\n${message.messageId}`
  ))));
  const mediaRead = shopeeBuyerChatMediaReadSchema.parse(mediaReadInput ?? {
    contract: "sellerpilot-shopee-buyer-chat-media-read/1",
    checkedAt: ledger.checkedAt,
    records: [],
  });
  const mediaByMessage = new Map<string, z.infer<typeof shopeeBuyerChatMediaSchema>>();
  for (const record of mediaRead.records) {
    const key = `${record.credentialId}\n${record.shopId}\n${record.conversationId}\n${record.messageId}`;
    if (!messageScopes.has(key) || mediaByMessage.has(key)) {
      throw new Error("SHOPEE_BUYER_CHAT_MEDIA_SCOPE_MISMATCH");
    }
    mediaByMessage.set(key, record.media);
  }
  return shopeeBuyerChatApiSchema.parse({
    contract: "sellerpilot-shopee-buyer-chat-status/1",
    checkedAt: ledger.checkedAt,
    ledgerPermissionState: ledger.state === "read_only_ready"
      ? "page_evidence_approved" : "permission_pending",
    ledgerPermissionReason: ledger.reason === "approved_read_only"
      ? "approved_page_evidence" : ledger.reason,
    operationalReceive: false,
    automaticHistoryCollection: false,
    storedHistory: ledger.storedHistory,
    reply: false,
    shops: ledger.shops.map((shop) => {
      const push = pushByScope.get(`${shop.credentialId}:${shop.shopId}`);
      if (!push) throw new Error("SHOPEE_BUYER_CHAT_PUSH_STATUS_SCOPE_MISMATCH");
      return {
        credentialId: shop.credentialId,
        shopId: shop.shopId,
        ledgerPermissionState: shop.runtimeReady
          ? "page_evidence_approved" : "permission_pending",
        storedHistory: shop.storedHistory,
        conversationCount: shop.conversationCount,
        messages: shop.messages.map((message) => ({
          ...message,
          media: mediaByMessage.get(
            `${shop.credentialId}\n${shop.shopId}\n${message.conversationId}\n${message.messageId}`,
          ) ?? null,
        })),
        nextCursor: shop.nextCursor,
        push,
      };
    }),
    transport,
  });
}

export const SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT = 500;

export type ShopeeBuyerChatViewShop = Omit<z.infer<typeof shopeeBuyerChatApiShopSchema>, "messages"> & {
  messages: ShopeeBuyerChatApiMessage[];
  memoryLimitReached: boolean;
};

export type ShopeeBuyerChatView = Omit<ShopeeBuyerChatApi, "shops"> & {
  shops: ShopeeBuyerChatViewShop[];
};

export function createShopeeBuyerChatView(page: ShopeeBuyerChatApi): ShopeeBuyerChatView {
  const parsed = shopeeBuyerChatApiSchema.parse(page);
  return {
    ...parsed,
    shops: parsed.shops.map((shop) => ({ ...shop, memoryLimitReached: false })),
  };
}

export function mergeShopeeBuyerChatStatusPage(
  current: ShopeeBuyerChatView,
  incomingInput: ShopeeBuyerChatApi,
  scope: { credentialId: string; shopId: string },
): ShopeeBuyerChatView {
  const incoming = shopeeBuyerChatApiSchema.parse(incomingInput);
  if (JSON.stringify(current.transport) !== JSON.stringify(incoming.transport)) {
    throw new Error("SHOPEE_BUYER_CHAT_PAGE_TRANSPORT_CHANGED");
  }
  if (incoming.shops.length !== 1
      || incoming.shops[0].credentialId !== scope.credentialId
      || incoming.shops[0].shopId !== scope.shopId) {
    throw new Error("SHOPEE_BUYER_CHAT_PAGE_SCOPE_MISMATCH");
  }
  const index = current.shops.findIndex((shop) => (
    shop.credentialId === scope.credentialId && shop.shopId === scope.shopId
  ));
  if (index < 0) throw new Error("SHOPEE_BUYER_CHAT_PAGE_SCOPE_MISSING");
  const next = incoming.shops[0];
  const identities = new Map(current.shops[index].messages.map((message) => [
    message.identityDigest, message,
  ]));
  const mergedMessages = [...current.shops[index].messages];
  for (const message of next.messages) {
    const existing = identities.get(message.identityDigest);
    if (existing && JSON.stringify(existing) !== JSON.stringify(message)) {
      throw new Error("SHOPEE_BUYER_CHAT_PAGE_IDENTITY_CONFLICT");
    }
    if (!existing) {
      identities.set(message.identityDigest, message);
      mergedMessages.push(message);
    }
  }
  const memoryLimitReached = mergedMessages.length > SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT
    || (mergedMessages.length === SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT && next.nextCursor !== null);
  const shops = [...current.shops];
  shops[index] = {
    ...next,
    messages: mergedMessages.slice(-SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT),
    nextCursor: next.nextCursor,
    memoryLimitReached,
  };
  const pageEvidenceApproved = shops.some((shop) => (
    shop.ledgerPermissionState === "page_evidence_approved"
  ));
  const storedHistory = shops.some((shop) => shop.storedHistory);
  return {
    ...current,
    checkedAt: incoming.checkedAt,
    ledgerPermissionState: pageEvidenceApproved ? "page_evidence_approved" : "permission_pending",
    ledgerPermissionReason: pageEvidenceApproved
      ? "approved_page_evidence" : incoming.ledgerPermissionReason,
    operationalReceive: false,
    automaticHistoryCollection: false,
    storedHistory,
    shops,
  };
}
