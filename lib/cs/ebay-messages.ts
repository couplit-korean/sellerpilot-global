import { z } from "zod";

export const ebayConversationTypeSchema = z.enum(["FROM_MEMBERS", "FROM_EBAY"]);
export const ebayMessageRoleSchema = z.enum(["customer", "seller", "system", "unverified"]);
const mediaSchema = z.object({
  name: z.string().max(500).nullable(), type: z.enum(["IMAGE", "PDF", "DOC", "TXT"]),
  url: z.string().max(8000).refine(value => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && value.trim() === value; }
    catch { return false; }
  }),
});
const messageSchema = z.object({
  messageId: z.string().min(1).max(240), body: z.string().max(20000), subject: z.string().max(2000),
  senderUsername: z.string().min(1).max(240), recipientUsername: z.string().min(1).max(240),
  createdAt: z.string().datetime({ offset: true }), read: z.boolean(), media: z.array(mediaSchema).max(100),
  role: ebayMessageRoleSchema,
});
const pagination = {
  total: z.number().int().nonnegative(), offset: z.number().int().nonnegative().multipleOf(25),
  nextOffset: z.number().int().nonnegative().multipleOf(25).nullable(),
};
export const ebayMessageAccountsSchema = z.object({ accounts: z.array(z.object({
  id: z.string().uuid(), label: z.string(), environment: z.enum(["sandbox", "production"]),
})) });
export const ebayConversationPageSchema = z.object({
  kind: z.literal("conversations"), credentialId: z.string().uuid(), ...pagination,
  entries: z.array(z.object({
    conversationId: z.string().min(1).max(240), type: ebayConversationTypeSchema,
    status: z.string(), title: z.string().max(2000), createdAt: z.string().datetime({ offset: true }),
    referenceId: z.string().nullable(), referenceType: z.literal("LISTING").nullable(), latestMessage: messageSchema,
  })).max(25),
});
export const ebayConversationMessagesSchema = z.object({
  kind: z.literal("messages"), credentialId: z.string().uuid(), conversationId: z.string().min(1).max(240),
  type: ebayConversationTypeSchema, status: z.string(), title: z.string().max(2000),
  ...pagination, entries: z.array(messageSchema).max(25),
});
export type EbayMessageAccounts = z.infer<typeof ebayMessageAccountsSchema>["accounts"];
export type EbayConversationPage = z.infer<typeof ebayConversationPageSchema>;
export type EbayConversationMessages = z.infer<typeof ebayConversationMessagesSchema>;
