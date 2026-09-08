import { z } from "zod";

const timestamp = z.string().datetime({ offset: true });
const key = z.string().regex(/^[a-f0-9]{64}$/);
export const quarantineCursorSchema = z.object({ beforeTime: timestamp, beforeKey: key, asOf: timestamp }).strict();
export const quarantinePageSchema = z.object({
  contract: z.literal("lazada_quarantine_read_v1"),
  asOf: timestamp,
  messages: z.array(z.object({
    key, sessionId: z.string().min(1).max(240), messageId: z.string().min(1).max(240),
    body: z.string().min(1).max(20000), senderRole: z.enum(["customer", "seller"]),
    observedAt: timestamp, expiresAt: timestamp, reason: z.enum(["conflict", "unverified"]),
  })).max(25),
  nextCursor: quarantineCursorSchema.nullable(),
}).superRefine((page, context) => {
  if (new Set(page.messages.map(message => message.key)).size !== page.messages.length)
    context.addIssue({ code: "custom", message: "Duplicate quarantine identities" });
  if (page.messages.some(message => Date.parse(message.expiresAt) <= Date.parse(message.observedAt)
    || Date.parse(message.observedAt) > Date.parse(page.asOf)))
    context.addIssue({ code: "custom", message: "Invalid quarantine observation" });
  const last = page.messages.at(-1);
  if (page.nextCursor && (page.messages.length !== 25 || page.nextCursor.asOf !== page.asOf
    || page.nextCursor.beforeKey !== last?.key || page.nextCursor.beforeTime !== last?.observedAt))
    context.addIssue({ code: "custom", message: "Invalid quarantine continuation" });
});
export type QuarantinePage = z.infer<typeof quarantinePageSchema>;
