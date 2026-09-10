import { z } from "zod";

const supportedSurfaceSchema = z.object({
  key: z.enum(["product_review", "return_refund"]),
  label: z.string().min(1).max(80),
  receive: z.literal(true),
  history: z.literal(true),
  reply: z.boolean(),
  providerReadPaths: z.array(z.string().startsWith("/api/v2/")).min(1).max(2),
}).strict();

const blockedBuyerChatSurfaceSchema = z.object({
  key: z.enum(["buyer_chat_push", "buyer_chat_history", "buyer_chat_reply"]),
  label: z.string().min(1).max(80),
  operational: z.literal(false),
  providerPath: z.null(),
  reason: z.enum([
    "live_push_unverified",
    "document_permission_denied",
    "reply_contract_unavailable",
  ]),
}).strict();

export const shopeeTransportAcceptanceSchema = z.object({
  contract: z.literal("sellerpilot-shopee-transport-acceptance/1"),
  supported: z.array(supportedSurfaceSchema).length(2),
  buyerChat: z.array(blockedBuyerChatSurfaceSchema).length(3),
}).strict().superRefine((value, context) => {
  const supported = new Set(value.supported.map((surface) => surface.key));
  const blocked = new Set(value.buyerChat.map((surface) => surface.key));
  if (supported.size !== 2 || !supported.has("product_review") || !supported.has("return_refund")) {
    context.addIssue({ code: "custom", message: "Shopee supported surface matrix is incomplete" });
  }
  if (blocked.size !== 3 || !blocked.has("buyer_chat_push")
      || !blocked.has("buyer_chat_history") || !blocked.has("buyer_chat_reply")) {
    context.addIssue({ code: "custom", message: "Shopee Buyer Chat block matrix is incomplete" });
  }
});

export const shopeeTransportAcceptance = shopeeTransportAcceptanceSchema.parse({
  contract: "sellerpilot-shopee-transport-acceptance/1",
  supported: [
    {
      key: "product_review",
      label: "상품 후기·댓글",
      receive: true,
      history: true,
      reply: true,
      providerReadPaths: ["/api/v2/product/get_comment"],
    },
    {
      key: "return_refund",
      label: "반품·환불 작업함",
      receive: true,
      history: true,
      reply: false,
      providerReadPaths: [
        "/api/v2/returns/get_return_list",
        "/api/v2/returns/get_return_detail",
      ],
    },
  ],
  buyerChat: [
    {
      key: "buyer_chat_push",
      label: "Buyer Chat push 수신",
      operational: false,
      providerPath: null,
      reason: "live_push_unverified",
    },
    {
      key: "buyer_chat_history",
      label: "Buyer Chat 이력 조회",
      operational: false,
      providerPath: null,
      reason: "document_permission_denied",
    },
    {
      key: "buyer_chat_reply",
      label: "Buyer Chat 답변",
      operational: false,
      providerPath: null,
      reason: "reply_contract_unavailable",
    },
  ],
});

export type ShopeeTransportAcceptance = z.infer<typeof shopeeTransportAcceptanceSchema>;
