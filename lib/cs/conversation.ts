import { z } from "zod";

export const conversationCursorSchema = z.object({
  beforeTime: z.string().datetime({ offset: true }),
  beforeKey: z.string().regex(/^[idt]:[0-9a-f-]{36}$/),
  asOf: z.string().datetime({ offset: true }),
});
export const conversationPageSchema = z.object({
  ticketId: z.string().uuid(),
  asOf: z.string().datetime({ offset: true }),
  messages: z.array(z.object({
    key: z.string(), role: z.enum(["customer", "seller", "system"]), body: z.string().nullable(),
    occurredAt: z.string().datetime({ offset: true }), observedAt: z.string().datetime({ offset: true }).nullable(),
    source: z.enum(["channel", "sellerpilot", "legacy_ticket"]),
    deliveryStatus: z.enum(["remote_observed", "recorded", "provider_accepted", "queued", "running", "failed", "cancelled", "reconciliation_required"]),
    remoteMessageId: z.string().nullable(), jobId: z.string().uuid().nullable(),
    unsequencedAnswers: z.array(z.object({ body: z.string().max(20000), reason: z.literal("provider_timestamp_unavailable") })).max(100).default([]),
  })).max(100),
  nextCursor: conversationCursorSchema.nullable(),
});
export type ConversationPage = z.infer<typeof conversationPageSchema>;
export type ConversationMessage = ConversationPage["messages"][number];
export const deliveryLabels: Record<ConversationMessage["deliveryStatus"], string> = {
  remote_observed: "채널에서 수집", recorded: "기존 문의 원장", provider_accepted: "채널 접수 · 원격 반영 별도 확인",
  queued: "전송 대기", running: "전송 중", failed: "전송 실패", cancelled: "전송 취소", reconciliation_required: "전송 결과 확인 필요",
};
export function mergeConversationMessages(current: ConversationMessage[], older: ConversationMessage[]) {
  return [...new Map([...current, ...older].map((message) => [message.key, message])).values()]
    .sort((a,b) => Date.parse(a.occurredAt)-Date.parse(b.occurredAt) || a.key.localeCompare(b.key));
}
