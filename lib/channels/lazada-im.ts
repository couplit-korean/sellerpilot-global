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

function providerTimestamp(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : value;
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) {
    const numeric = Number(raw);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
    const parsed = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  // Do not let Date.parse invent a timezone or turn "0"/"1" into dates.
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const calendarDate = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== raw.slice(0, 10)) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function messageTimestamp(value: unknown, senderType: number, fallbackTimestamp: string) {
  const timestamp = providerTimestamp(value);
  // The existing seller ledger derives answered state from receivedAt alone.
  // It cannot persist an unordered seller event. Fail the batch before ingest
  // rather than fabricate ordering, silently drop the original, or return a
  // success whose collection timestamp closes a newer buyer inquiry.
  if (senderType === 2 && !timestamp) throw new Error("LAZADA_IM_SELLER_TIMESTAMP_UNVERIFIED");
  return timestamp ?? fallbackTimestamp;
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
    receivedAt: messageTimestamp(
      message.send_time ?? data.send_time ?? (senderType === 2 ? undefined : payload.timestamp),
      senderType,
      receivedAt,
    ),
    remoteMessageId: messageId,
    ...(senderType === 2 ? { senderRole: "seller" as const } : {}),
  };
}

export function normalizeLazadaImHistory(
  steps: Array<{ name: string; data: Record<string, unknown>; ok?: boolean }>,
  fallbackTimestamp = new Date().toISOString(),
) {
  const sessions = new Map<string, { session: Record<string, unknown>; messages: Record<string, unknown>[] }>();
  for (const step of steps.filter((item) => item.ok !== false && item.name.startsWith("inquiries-message:"))) {
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

  return [...sessions.entries()].flatMap(([sessionId, { session, messages }]) => {
    const byMessageId = new Map<string, LazadaImInquiry>();
    for (const row of messages) {
      const remoteMessageId = text(row.message_id);
      const senderType = Number(row.from_account_type);
      const content = parsedRecord(row.content);
      const message = text(content.txt, content.text, row.txt, row.text, content.translateTxt);
      // Session summaries are not message bodies. Never invent an identity or
      // a sender, and do not ingest recalled/system messages as customer text.
      if (!remoteMessageId || !message || ![1, 2].includes(senderType)
          || Number(row.status ?? 0) !== 0) continue;
      const receivedAt = messageTimestamp(row.send_time, senderType, fallbackTimestamp);
      if (byMessageId.has(remoteMessageId)) continue;
      byMessageId.set(remoteMessageId, {
        externalTicketId: `lazada-im:${sessionId}`,
        customerName: text(session.title, session.buyer_name, "Lazada 고객"),
        subject: text(session.product_name, session.site_id ? `Lazada ${session.site_id} IM 문의` : "Lazada IM 문의"),
        message,
        // These are message events, not a session summary. The ledger keeps
        // latest_inbound_key on the latest buyer and processes seller events
        // separately to derive the current conversation's provider status.
        status: senderType === 2 ? "resolved" : "waiting",
        priority: Number(session.unread_count ?? 0) > 0 ? 2 : 3,
        receivedAt,
        remoteMessageId,
        senderRole: senderType === 2 ? "seller" : "customer",
      });
    }
    return [...byMessageId.values()].sort((left, right) =>
      left.receivedAt.localeCompare(right.receivedAt)
      || left.remoteMessageId.localeCompare(right.remoteMessageId));
  });
}
