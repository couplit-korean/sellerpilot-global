export type LazadaImInquiry = {
  externalTicketId: string;
  customerName: string;
  subject: string;
  message: string;
  status: "waiting" | "resolved";
  priority: number;
  receivedAt: string;
  remoteMessageId: string;
  senderRole?: "customer" | "seller";
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : [];
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";

function parsedRecord(value: unknown) {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value) as unknown);
  } catch {
    return { txt: value };
  }
}

function iso(value: unknown, fallbackTimestamp: string) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const parsed = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallbackTimestamp;
}

export function parseLazadaImPush(payload: Record<string, unknown>): LazadaImInquiry | null {
  const receivedAt = new Date().toISOString();
  const data = parsedRecord(payload.data);
  const nestedMessage = record(data.message);
  const message = Object.keys(nestedMessage).length ? nestedMessage : data;
  const content = parsedRecord(message.content ?? data.content);
  const sessionId = text(data.session_id, data.sessionId, message.session_id, payload.session_id);
  const messageId = text(message.message_id, data.message_id, payload.message_id, payload.uuid);
  const messageText = text(content.translateTxt, content.txt, content.text, message.txt, message.text, data.txt);
  const senderType = Number(message.from_account_type ?? data.from_account_type ?? 1);
  const messageStatus = Number(message.status ?? data.status ?? 0);
  if (!sessionId || !messageId || !messageText || ![1, 2].includes(senderType) || messageStatus === 1) return null;

  return {
    externalTicketId: `lazada-im:${sessionId}`,
    customerName: text(data.buyer_name, data.from_account_name, message.from_name, "Lazada 고객"),
    subject: text(data.product_name, data.title, data.site_id ? `Lazada ${data.site_id} IM 문의` : "Lazada IM 문의"),
    message: messageText,
    status: senderType === 2 ? "resolved" : "waiting",
    priority: 3,
    receivedAt: iso(message.send_time ?? data.send_time ?? payload.timestamp, receivedAt),
    remoteMessageId: messageId,
    ...(senderType === 2 ? { senderRole: "seller" as const } : {}),
  };
}

export function normalizeLazadaImHistory(
  steps: Array<{ name: string; data: Record<string, unknown> }>,
  fallbackTimestamp = new Date().toISOString(),
) {
  const sessions = new Map<string, { session: Record<string, unknown>; messages: Record<string, unknown>[] }>();
  for (const step of steps.filter((item) => item.name.startsWith("inquiries-message:"))) {
      const root = record(step.data.data);
      const session = record(step.data.sellerpilotSession);
      const nameSessionId = step.name.slice("inquiries-message:".length).split(":")[0];
      const sessionId = text(session.session_id, nameSessionId);
      if (!sessionId) continue;
      const messages = list(root.message_list).length ? list(root.message_list)
        : list(root.messages).length ? list(root.messages)
          : list(step.data.message_list);
      const current = sessions.get(sessionId);
      sessions.set(sessionId, {
        session: Object.keys(session).length ? session : current?.session ?? {},
        messages: [...(current?.messages ?? []), ...messages],
      });
  }

  return [...sessions.entries()]
    .map(([sessionId, history]): LazadaImInquiry | null => {
      const { session, messages } = history;
      const normalMessages = messages.filter((message) => Number(message.status ?? 0) === 0);
      const buyerMessages = normalMessages.filter((message) => Number(message.from_account_type ?? 1) === 1);
      const sellerMessages = normalMessages.filter((message) => Number(message.from_account_type ?? 1) === 2);
      const latest = [...buyerMessages].sort((left, right) => Number(right.send_time ?? 0) - Number(left.send_time ?? 0))[0];
      const latestSeller = [...sellerMessages].sort((left, right) => Number(right.send_time ?? 0) - Number(left.send_time ?? 0))[0];
      const content = parsedRecord(latest?.content);
      const message = text(content.translateTxt, content.txt, latest?.txt, session.summary);
      if (!message) return null;
      const unreadCount = Number(session.unread_count ?? 0);
      return {
        externalTicketId: `lazada-im:${sessionId}`,
        customerName: text(session.title, session.buyer_name, "Lazada 고객"),
        subject: text(session.product_name, session.site_id ? `Lazada ${session.site_id} IM 문의` : "Lazada IM 문의"),
        message,
        // unread_count only describes whether the seller has opened the IM.
        // A conversation is answered only when a seller message is newer than
        // the latest buyer message.
        status: Number(latestSeller?.send_time ?? 0) > Number(latest?.send_time ?? 0) ? "resolved" : "waiting",
        priority: unreadCount > 0 ? 2 : 3,
        receivedAt: iso(latest?.send_time ?? session.last_message_time, fallbackTimestamp),
        remoteMessageId: text(latest?.message_id),
      };
    })
    .filter((row): row is LazadaImInquiry => Boolean(row));
}
