import { z } from "zod";
import {
  normalizeAuthorizedShopeeBuyerChatPage,
  type AuthorizedShopeeBuyerChatPage,
} from "./buyer-chat";

const shopId = z.string().regex(/^[1-9]\d{0,31}$/u);
const exactId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u);

export const shopeeBuyerChatIngestRequestSchema = z.object({
  credentialId: z.string().uuid(),
  shopId,
  entitlementId: z.string().uuid(),
  page: z.unknown(),
}).strict();

export const shopeeBuyerChatWorkerIngestRequestSchema = shopeeBuyerChatIngestRequestSchema
  .safeExtend({ workerVersion: z.string().min(1).max(80) });

const entitlementSchema = z.object({
  contract: z.literal("sellerpilot-shopee-buyer-chat-ingest-entitlement/1"),
  entitlementId: z.string().uuid(),
  credentialId: z.string().uuid(),
  shopId,
  expiresAt: z.string().datetime({ offset: true }),
  permissionEvidence: z.object({
    configuredKeys: z.boolean(),
    contractDocument: z.object({
      module: z.literal("sellerchat"),
      revision: exactId,
      sourceUrl: z.string().url().regex(/^https:\/\/open[.]shopee[.](?:com|cn)\//u),
      verifiedAt: z.string().datetime({ offset: true }),
      conversationListApproved: z.literal(true),
      messageHistoryApproved: z.literal(true),
    }).strict(),
    appApproval: z.object({
      state: z.literal("approved"),
      appType: exactId,
      approvedAt: z.string().datetime({ offset: true }),
    }).strict(),
    webhookApproval: z.object({
      state: z.literal("approved"),
      event: exactId,
      verifiedAt: z.string().datetime({ offset: true }),
    }).strict(),
  }).strict(),
}).strict();

const receiptSchema = z.object({
  contract: z.literal("sellerpilot-shopee-buyer-chat-authorized-ingest/1"),
  status: z.enum(["ingested", "replayed"]),
  credentialId: z.string().uuid(),
  shopId,
  conversationId: exactId,
  acceptedCount: z.number().int().min(0).max(100),
  committedCursor: z.string().min(1).max(512).nullable(),
  reply: z.literal(false),
}).strict();

type RpcResult = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
export type ShopeeBuyerChatIngestRpcClient = {
  rpc(name: string, arguments_: Record<string, unknown>): RpcResult;
};

export class ShopeeBuyerChatIngestError extends Error {
  readonly code: "REQUEST_INVALID" | "ENTITLEMENT_UNAVAILABLE"
    | "ENTITLEMENT_INVALID" | "PAGE_INVALID" | "WRITER_FAILED" | "RECEIPT_INVALID";

  constructor(
    code: "REQUEST_INVALID" | "ENTITLEMENT_UNAVAILABLE"
      | "ENTITLEMENT_INVALID" | "PAGE_INVALID" | "WRITER_FAILED" | "RECEIPT_INVALID",
    options?: { cause?: unknown },
  ) {
    super(`SHOPEE_BUYER_CHAT_${code}`, options);
    this.code = code;
  }
}

export async function ingestAuthorizedShopeeBuyerChatPage(
  input: unknown,
  serviceClient: ShopeeBuyerChatIngestRpcClient,
) {
  const request = shopeeBuyerChatIngestRequestSchema.safeParse(input);
  if (!request.success) throw new ShopeeBuyerChatIngestError("REQUEST_INVALID");

  const { data: entitlementData, error: entitlementError } = await serviceClient.rpc(
    "sellerpilot_service_read_shopee_chat_entitlement_v1",
    {
      p_credential_id: request.data.credentialId,
      p_shop_id: request.data.shopId,
      p_entitlement_id: request.data.entitlementId,
    },
  );
  if (entitlementError || entitlementData === null) {
    throw new ShopeeBuyerChatIngestError("ENTITLEMENT_UNAVAILABLE", {
      cause: entitlementError ?? undefined,
    });
  }
  const entitlement = entitlementSchema.safeParse(entitlementData);
  if (!entitlement.success
      || entitlement.data.credentialId !== request.data.credentialId
      || entitlement.data.shopId !== request.data.shopId
      || entitlement.data.entitlementId !== request.data.entitlementId
      || Date.parse(entitlement.data.expiresAt) <= Date.now()) {
    throw new ShopeeBuyerChatIngestError("ENTITLEMENT_INVALID");
  }

  let normalized: ReturnType<typeof normalizeAuthorizedShopeeBuyerChatPage>;
  try {
    normalized = normalizeAuthorizedShopeeBuyerChatPage({
      evidence: entitlement.data.permissionEvidence,
      expectedShopId: request.data.shopId,
      page: request.data.page as AuthorizedShopeeBuyerChatPage,
    });
  } catch (error) {
    throw new ShopeeBuyerChatIngestError("PAGE_INVALID", { cause: error });
  }

  const page = request.data.page as AuthorizedShopeeBuyerChatPage;
  const normalizedPage = {
    contract: "sellerpilot-shopee-buyer-chat-normalized-page/1",
    shopId: request.data.shopId,
    conversationId: page.conversationId,
    inputCursor: page.inputCursor,
    nextCursor: page.nextCursor,
    pageSize: page.pageSize,
    messages: normalized.storageRows,
  };
  const { data: receiptData, error: writerError } = await serviceClient.rpc(
    "sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1",
    {
      p_credential_id: request.data.credentialId,
      p_shop_id: request.data.shopId,
      p_entitlement_id: request.data.entitlementId,
      p_page: normalizedPage,
    },
  );
  if (writerError) {
    throw new ShopeeBuyerChatIngestError("WRITER_FAILED", { cause: writerError });
  }
  const receipt = receiptSchema.safeParse(receiptData);
  if (!receipt.success
      || receipt.data.credentialId !== request.data.credentialId
      || receipt.data.shopId !== request.data.shopId
      || receipt.data.conversationId !== page.conversationId
      || receipt.data.committedCursor !== page.nextCursor) {
    throw new ShopeeBuyerChatIngestError("RECEIPT_INVALID");
  }
  return receipt.data;
}
