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
  orderingStatus?: "unverified" | "conflict";
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : [];
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";

// Store only the original text body, not provider envelopes or customer names.
const messageBody = (...values: unknown[]) => (values.find((value) => typeof value === "string" && value.trim()) as string | undefined) ?? "";

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
  // Empty means unordered, never collection time. The v2 ingestion boundary
  // quarantines this event before the ordinary seller state machine.
  return timestamp ?? (senderType === 2 ? "" : fallbackTimestamp);
}

export function parseLazadaImPush(payload: Record<string, unknown>): LazadaImInquiry | null {
  const receivedAt = new Date().toISOString();
  const data = parsedRecord(payload.data);
  const nestedMessage = record(data.message);
  const message = Object.keys(nestedMessage).length ? nestedMessage : data;
  const content = parsedRecord(message.content ?? data.content);
  const sessionId = text(data.session_id, data.sessionId, message.session_id, payload.session_id);
  const messageId = text(message.message_id, data.message_id, payload.message_id, payload.uuid);
  const messageText = messageBody(content.txt, content.text, message.txt, message.text, data.txt, content.translateTxt);
  const senderType = Number(message.from_account_type ?? data.from_account_type ?? 1);
  const messageStatus = Number(message.status ?? data.status ?? 0);
  if (!sessionId || !messageId || !messageText || ![1, 2].includes(senderType) || messageStatus === 1) return null;

  const timestamp = messageTimestamp(message.send_time ?? data.send_time ?? (senderType === 2 ? undefined : payload.timestamp), senderType, receivedAt);
  return {
    externalTicketId: `lazada-im:${sessionId}`,
    customerName: timestamp ? text(data.buyer_name, data.from_account_name, message.from_name, "Lazada 고객") : "Lazada 판매자",
    subject: timestamp ? text(data.product_name, data.title, data.site_id ? `Lazada ${data.site_id} IM 문의` : "Lazada IM 문의") : "Lazada 시각 미확정 메시지",
    message: messageText,
    status: senderType === 2 && timestamp ? "resolved" : "waiting",
    priority: 3,
    receivedAt: timestamp,
    ...(!timestamp ? { orderingStatus: "unverified" as const } : {}),
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
    const conflicts = new Map<string, LazadaImInquiry[]>();
    for (const row of messages) {
      const remoteMessageId = text(row.message_id);
      const senderType = Number(row.from_account_type);
      const content = parsedRecord(row.content);
      const message = messageBody(content.txt, content.text, row.txt, row.text, content.translateTxt);
      // Session summaries are not message bodies. Never invent an identity or
      // a sender, and do not ingest recalled/system messages as customer text.
      if (!remoteMessageId || !message || ![1, 2].includes(senderType)
          || Number(row.status ?? 0) !== 0) continue;
      const receivedAt = messageTimestamp(row.send_time, senderType, fallbackTimestamp);
      const previous = byMessageId.get(remoteMessageId);
      const candidate: LazadaImInquiry = {
        externalTicketId: `lazada-im:${sessionId}`,
        customerName: receivedAt ? text(session.title, session.buyer_name, "Lazada 고객") : "Lazada 판매자",
        subject: receivedAt ? text(session.product_name, session.site_id ? `Lazada ${session.site_id} IM 문의` : "Lazada IM 문의") : "Lazada 시각 미확정 메시지",
        message,
        // These are message events, not a session summary. The ledger keeps
        // latest_inbound_key on the latest buyer and processes seller events
        // separately to derive the current conversation's provider status.
        status: senderType === 2 && receivedAt ? "resolved" : "waiting",
        priority: Number(session.unread_count ?? 0) > 0 ? 2 : 3,
        receivedAt,
        ...(!receivedAt ? { orderingStatus: "unverified" as const } : {}),
        remoteMessageId,
        senderRole: senderType === 2 ? "seller" : "customer",
      };
      const variants = conflicts.get(remoteMessageId);
      if (variants || (previous && (previous.message !== message || previous.senderRole !== candidate.senderRole))) {
        const all = variants ?? [previous!];
        if (!all.some(value => value.message === message && value.senderRole === candidate.senderRole)) all.push(candidate);
        conflicts.set(remoteMessageId, all);
        byMessageId.delete(remoteMessageId);
      } else if (!previous || (!previous.receivedAt && receivedAt)) {
        byMessageId.set(remoteMessageId, candidate);
      }
    }
    const quarantined = [...conflicts.values()].flat().map((value): LazadaImInquiry => ({
      ...value, orderingStatus: "conflict", receivedAt: "", status: "waiting",
      customerName: "Lazada 메시지", subject: "Lazada 식별 충돌",
    }));
    return [...byMessageId.values(), ...quarantined].sort((left, right) =>
      left.receivedAt.localeCompare(right.receivedAt)
      || left.remoteMessageId.localeCompare(right.remoteMessageId));
  });
}
