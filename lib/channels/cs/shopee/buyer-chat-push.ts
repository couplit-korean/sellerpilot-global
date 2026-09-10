import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { TextDecoder } from "node:util";
import { z } from "zod";
import {
  type ShopeeBuyerChatIngestRpcClient,
} from "./buyer-chat-ingest";

const decimalId = z.union([
  z.string().regex(/^[1-9]\d{0,31}$/u),
  z.number().int().positive().safe(),
]);
const shopDirectionId = z.union([z.literal(0), decimalId]);
const exactId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_/-]{0,159}$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const callbackUrl = z.string().url().max(2_048).superRefine((value, context) => {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    context.addIssue({ code: "custom", message: "exact HTTPS callback URL required" });
  }
});

const rawAddressSchema = z.object({
  shop_id: decimalId,
  code: z.literal(10),
}).passthrough();

const textContentSchema = z.object({
  text: z.string().min(1).max(4_000),
}).passthrough();

const mediaReference = z.string().min(1).max(2_048)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u);
const mediaDimension = z.number().int().positive().max(20_000).safe();
const mediaDuration = z.number().int().positive().max(86_400).safe();
const officialShopeeImageUrl = z.string().min(1).max(2_048).superRefine((value, context) => {
  try {
    const parsed = new URL(value);
    const officialHost = /^cf[.]shopee[.](?:sg|com[.]my|co[.]th|vn|co[.]id|ph|com[.]br|jp|kr|com[.]hk|cn)$/u;
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port
        || parsed.search || parsed.hash || !officialHost.test(parsed.hostname)
        || !/^\/file\/[A-Za-z0-9._~%/-]{1,1900}$/u.test(parsed.pathname)
        || parsed.pathname.includes("..") || parsed.href !== value) {
      context.addIssue({ code: "custom", message: "exact official Shopee image URL required" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "exact official Shopee image URL required" });
  }
});

const imageContentSchema = z.object({
  url: officialShopeeImageUrl,
  thumb_url: mediaReference,
  thumb_height: mediaDimension,
  thumb_width: mediaDimension,
  file_server_id: shopDirectionId,
}).strict();

const videoContentSchema = z.object({
  video_url: mediaReference,
  thumb_url: mediaReference,
  thumb_height: mediaDimension,
  thumb_width: mediaDimension,
  duration_seconds: mediaDuration,
}).strict();

const itemContentSchema = z.object({
  shop_id: decimalId,
  item_id: decimalId,
}).strict();

const textSourceContentSchema = z.object({
  order_sn: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u).optional(),
}).passthrough();

const itemSourceContentSchema = z.object({ item_id: decimalId }).strict();

const messageContentSchema = z.object({
  message_id: decimalId,
  request_id: exactId,
  conversation_id: decimalId,
  created_timestamp: z.number().int().positive().safe(),
  region: z.string().regex(/^[A-Z]{2}$/u),
  message_type: z.enum(["text", "faq_liveagent", "image", "video", "item"]),
  content: z.unknown(),
  business_type: z.number().int().optional(),
  to_shop_id: shopDirectionId.optional(),
  from_shop_id: shopDirectionId.optional(),
  source_content: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const messagePushSchema = z.object({
  data: z.object({
    type: z.literal("message"),
    region: z.string().regex(/^[A-Z]{2}$/u),
    content: messageContentSchema,
  }).passthrough(),
  shop_id: decimalId,
  code: z.literal(10),
  timestamp: z.number().int().positive().safe(),
}).passthrough();

const pushTypeProbeSchema = z.object({
  data: z.object({
    type: z.string(),
    content: z.object({ message_type: z.string().optional() }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

export const shopeeBuyerChatPushTransportSchema = z.object({
  contract: z.literal("sellerpilot-shopee-buyer-chat-push-transport/1"),
  credentialId: z.string().uuid(),
  entitlementId: z.string().uuid(),
  shopId: z.string().regex(/^[1-9]\d{0,31}$/u),
  partnerKey: z.string().min(16).max(4_096),
  webhookEvent: z.literal("webchat_push"),
}).strict();

const verifiedPushReceiptSchema = z.object({
  contract: z.literal("sellerpilot-shopee-buyer-chat-verified-push-ingest/1"),
  status: z.enum(["ingested", "replayed"]),
  credentialId: z.string().uuid(),
  shopId: z.string().regex(/^[1-9]\d{0,31}$/u),
  conversationId: exactId,
  messageId: exactId,
  reply: z.literal(false),
}).strict();

export type ShopeeBuyerChatVerifiedPush = ReturnType<
  typeof verifyAndNormalizeShopeeBuyerChatPush
>;

export class ShopeeBuyerChatPushError extends Error {
  readonly code: "REQUEST_INVALID" | "SIGNATURE_INVALID" | "SCOPE_MISMATCH"
    | "MESSAGE_UNSUPPORTED" | "TRANSPORT_UNAVAILABLE" | "RECEIPT_FAILED";

  constructor(
    code: "REQUEST_INVALID" | "SIGNATURE_INVALID" | "SCOPE_MISMATCH"
      | "MESSAGE_UNSUPPORTED" | "TRANSPORT_UNAVAILABLE" | "RECEIPT_FAILED",
    options?: { cause?: unknown },
  ) {
    super(`SHOPEE_BUYER_CHAT_PUSH_${code}`, options);
    this.code = code;
  }
}

type ShopeePushRawBody = string | Uint8Array;

function exactRawBytes(value: ShopeePushRawBody) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedDecimalId(value: z.infer<typeof shopDirectionId>) {
  return typeof value === "number" ? String(value) : value;
}

function parseRawJson(rawBody: ShopeePushRawBody) {
  const bytes = exactRawBytes(rawBody);
  if (bytes.byteLength > 65_536
      || bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    throw new ShopeeBuyerChatPushError("REQUEST_INVALID", { cause: error });
  }
  try {
    return JSON.parse(decoded) as unknown;
  } catch (error) {
    throw new ShopeeBuyerChatPushError("REQUEST_INVALID", { cause: error });
  }
}

export function readShopeeBuyerChatPushAddress(rawBody: ShopeePushRawBody) {
  const parsed = rawAddressSchema.safeParse(parseRawJson(rawBody));
  if (!parsed.success) throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
  return { shopId: normalizedDecimalId(parsed.data.shop_id), code: parsed.data.code };
}

export function verifyShopeePushAuthorization(input: {
  callbackUrl: string;
  rawBody: ShopeePushRawBody;
  partnerKey: string;
  authorization: string;
}) {
  const parsedCallback = callbackUrl.safeParse(input.callbackUrl);
  if (!parsedCallback.success || typeof input.partnerKey !== "string"
      || input.partnerKey.length < 16 || input.partnerKey.length > 4_096
      || typeof input.authorization !== "string"
      || !/^[a-f0-9]{64}$/iu.test(input.authorization)) {
    throw new ShopeeBuyerChatPushError("SIGNATURE_INVALID");
  }
  const expected = createHmac("sha256", input.partnerKey)
    .update(`${parsedCallback.data}|`, "utf8")
    .update(exactRawBytes(input.rawBody))
    .digest();
  const received = Buffer.from(input.authorization, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new ShopeeBuyerChatPushError("SIGNATURE_INVALID");
  }
}

export function verifyAndNormalizeShopeeBuyerChatPush(input: {
  callbackUrl: string;
  rawBody: ShopeePushRawBody;
  partnerKey: string;
  authorization: string;
  expectedShopId: string;
  receivedAt?: string;
}) {
  verifyShopeePushAuthorization(input);
  const parsedJson = parseRawJson(input.rawBody);
  const parsed = messagePushSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const address = rawAddressSchema.safeParse(parsedJson);
    const typeProbe = pushTypeProbeSchema.safeParse(parsedJson);
    if (address.success && typeProbe.success) {
      const type = typeProbe.data.data.type;
      const messageType = typeProbe.data.data.content?.message_type;
      if (type !== "message" || messageType
          && !["text", "faq_liveagent", "image", "video", "item"].includes(messageType)) {
        throw new ShopeeBuyerChatPushError("MESSAGE_UNSUPPORTED");
      }
    }
    throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
  }
  const shopId = normalizedDecimalId(parsed.data.shop_id);
  const content = parsed.data.data.content;
  const conversationId = normalizedDecimalId(content.conversation_id);
  const messageId = normalizedDecimalId(content.message_id);
  const toShopId = content.to_shop_id === undefined
    ? null : String(content.to_shop_id);
  const fromShopId = content.from_shop_id === undefined
    ? null : String(content.from_shop_id);
  if (shopId !== input.expectedShopId
      || parsed.data.data.region !== content.region) {
    throw new ShopeeBuyerChatPushError("SCOPE_MISMATCH");
  }
  const senderRole = toShopId === shopId && fromShopId === "0"
    ? "buyer"
    : fromShopId === shopId && toShopId === "0"
      ? "seller"
      : null;
  if (senderRole === null) throw new ShopeeBuyerChatPushError("SCOPE_MISMATCH");
  if (content.business_type !== undefined && content.business_type !== 0) {
    throw new ShopeeBuyerChatPushError("MESSAGE_UNSUPPORTED");
  }
  let body: string;
  let orderSn: string | null = null;
  let itemId: string | null = null;
  let attachmentCount = 0;
  let media: null | {
    type: "image";
    imageUrl: string;
    thumbnailReference: string;
    thumbnailWidth: number;
    thumbnailHeight: number;
    fileServerId: string;
    descriptorDigest: string;
  } | {
    type: "video";
    videoReference: string;
    thumbnailReference: string;
    thumbnailWidth: number;
    thumbnailHeight: number;
    durationSeconds: number;
    descriptorDigest: string;
  } | {
    type: "item";
    itemShopId: string;
    itemId: string;
    sourceItemId: string;
    descriptorDigest: string;
  } = null;
  if (content.message_type === "text" || content.message_type === "faq_liveagent") {
    const textContent = textContentSchema.safeParse(content.content);
    const sourceContent = content.source_content === undefined
      ? null : textSourceContentSchema.safeParse(content.source_content);
    if (!textContent.success || sourceContent && !sourceContent.success) {
      throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
    }
    body = textContent.data.text.trim();
    if (!body) throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
    orderSn = sourceContent?.data.order_sn ?? null;
  } else if (content.message_type === "image") {
    const image = imageContentSchema.safeParse(content.content);
    if (!image.success) throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
    body = "Shopee 이미지 첨부";
    attachmentCount = 1;
    const fileServerId = normalizedDecimalId(image.data.file_server_id);
    const material = ["image", image.data.url, image.data.thumb_url,
      String(image.data.thumb_width), String(image.data.thumb_height), fileServerId].join("\n");
    media = {
      type: "image", imageUrl: image.data.url,
      thumbnailReference: image.data.thumb_url,
      thumbnailWidth: image.data.thumb_width, thumbnailHeight: image.data.thumb_height,
      fileServerId, descriptorDigest: sha256(material),
    };
  } else if (content.message_type === "video") {
    const video = videoContentSchema.safeParse(content.content);
    if (!video.success) throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
    body = "Shopee 동영상 첨부";
    attachmentCount = 1;
    const material = ["video", video.data.video_url, video.data.thumb_url,
      String(video.data.thumb_width), String(video.data.thumb_height),
      String(video.data.duration_seconds)].join("\n");
    media = {
      type: "video", videoReference: video.data.video_url,
      thumbnailReference: video.data.thumb_url,
      thumbnailWidth: video.data.thumb_width, thumbnailHeight: video.data.thumb_height,
      durationSeconds: video.data.duration_seconds, descriptorDigest: sha256(material),
    };
  } else {
    const item = itemContentSchema.safeParse(content.content);
    const source = itemSourceContentSchema.safeParse(content.source_content);
    if (!item.success || !source.success) {
      throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
    }
    body = "Shopee 상품 정보";
    attachmentCount = 1;
    const itemShopId = normalizedDecimalId(item.data.shop_id);
    itemId = normalizedDecimalId(item.data.item_id);
    const sourceItemId = normalizedDecimalId(source.data.item_id);
    const material = ["item", itemShopId, itemId, sourceItemId].join("\n");
    media = { type: "item", itemShopId, itemId, sourceItemId,
      descriptorDigest: sha256(material) };
  }
  const sentAt = new Date(content.created_timestamp * 1_000);
  const pushedAt = new Date(parsed.data.timestamp * 1_000);
  const receivedAt = new Date(input.receivedAt ?? Date.now());
  if (![sentAt, pushedAt, receivedAt].every(value => Number.isFinite(value.getTime()))) {
    throw new ShopeeBuyerChatPushError("REQUEST_INVALID");
  }
  const sentAtIso = sentAt.toISOString();
  const identityDigest = sha256(`${shopId}\n${conversationId}\n${messageId}`);
  const bodyFingerprint = sha256(body);
  const evidenceDigest = sha256([
    identityDigest,
    bodyFingerprint,
    senderRole,
    sentAtIso,
    orderSn ?? "",
    itemId ?? "",
    String(attachmentCount),
  ].join("\n"));
  return {
    contract: "sellerpilot-shopee-buyer-chat-verified-push/1" as const,
    callbackUrlSha256: sha256(input.callbackUrl),
    rawBodySha256: sha256(exactRawBytes(input.rawBody)),
    authorizationSha256: sha256(input.authorization.toLowerCase()),
    code: 10 as const,
    requestId: content.request_id,
    shopId,
    conversationId,
    messageId,
    region: content.region,
    pushTimestamp: pushedAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    page: {
      contract: "sellerpilot-shopee-buyer-chat-authorized-page/1" as const,
      shopId,
      conversationId,
      inputCursor: null,
      nextCursor: null,
      pageSize: 1,
      messages: [{
        conversationId,
        messageId,
        senderRole,
        body,
        sentAt: sentAtIso,
        orderSn,
        itemId,
        attachmentCount,
      }],
    },
    canonicalPage: {
      contract: "sellerpilot-shopee-buyer-chat-normalized-page/1" as const,
      shopId,
      conversationId,
      inputCursor: null,
      nextCursor: null,
      pageSize: 1,
      messages: [{
        shopId,
        conversationId,
        messageId,
        identityDigest,
        senderRole,
        body,
        bodyFingerprint,
        sentAt: sentAtIso,
        orderSn,
        itemId,
        attachmentCount,
        evidenceDigest,
      }],
    },
    media,
  };
}

export async function persistVerifiedShopeeBuyerChatPush(input: {
  transport: z.infer<typeof shopeeBuyerChatPushTransportSchema>;
  push: ShopeeBuyerChatVerifiedPush;
}, serviceClient: ShopeeBuyerChatIngestRpcClient) {
  const transport = shopeeBuyerChatPushTransportSchema.safeParse(input.transport);
  if (!transport.success || transport.data.shopId !== input.push.shopId) {
    throw new ShopeeBuyerChatPushError("TRANSPORT_UNAVAILABLE");
  }
  const rpcName = input.push.media === null
    ? "sellerpilot_service_ingest_shopee_buyer_chat_push_v1"
    : "sellerpilot_service_ingest_shopee_buyer_chat_media_v1";
  const rpcArguments: Record<string, unknown> = {
      p_credential_id: transport.data.credentialId,
      p_shop_id: transport.data.shopId,
      p_entitlement_id: transport.data.entitlementId,
      p_evidence: {
        contract: input.push.contract,
        callbackUrlSha256: input.push.callbackUrlSha256,
        rawBodySha256: input.push.rawBodySha256,
        authorizationSha256: input.push.authorizationSha256,
        code: input.push.code,
        requestId: input.push.requestId,
        shopId: input.push.shopId,
        conversationId: input.push.conversationId,
        messageId: input.push.messageId,
        region: input.push.region,
        pushTimestamp: input.push.pushTimestamp,
        receivedAt: input.push.receivedAt,
      },
      p_page: input.push.canonicalPage,
  };
  if (input.push.media !== null) rpcArguments.p_media = input.push.media;
  const { data, error } = await serviceClient.rpc(rpcName, rpcArguments);
  if (error) {
    throw new ShopeeBuyerChatPushError(
      error.code === "42501" ? "TRANSPORT_UNAVAILABLE" : "RECEIPT_FAILED",
      { cause: error },
    );
  }
  const receipt = verifiedPushReceiptSchema.safeParse(data);
  if (!receipt.success
      || receipt.data.credentialId !== transport.data.credentialId
      || receipt.data.shopId !== transport.data.shopId
      || receipt.data.conversationId !== input.push.conversationId
      || receipt.data.messageId !== input.push.messageId) {
    throw new ShopeeBuyerChatPushError("RECEIPT_FAILED");
  }
  return receipt.data;
}

export function isSha256Digest(value: unknown): value is string {
  return digest.safeParse(value).success;
}
