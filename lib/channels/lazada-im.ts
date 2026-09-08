import { createHash } from "node:crypto";
import { originalMessageBody as messageBody, providerMessageTimestamp as providerTimestamp } from "./cs-history-values.ts";

export type LazadaImInquiry = {
  externalTicketId: string;
  customerName: string;
  subject: string;
  message: string;
  status: "waiting" | "resolved";
  priority: number;
  receivedAt: string;
  remoteMessageId: string;
  senderRole?: "customer" | "seller" | "system";
  orderingStatus?: "unverified" | "conflict";
  providerContext?: Record<string, unknown>;
};

export type LazadaImHistoryRawPage = {
  rawBody: string;
  processingStatus: "normalized" | "unsupported";
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

function safeHttpsUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate || candidate.length > 8_000) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function lazadaNativeMedia(content: Record<string, unknown>) {
  const imageUrl = safeHttpsUrl(content.imgUrl ?? content.image_url ?? content.imageUrl);
  const fileUrl = safeHttpsUrl(content.fileUrl ?? content.file_url ?? content.url);
  const fileName = text(content.fileName, content.file_name, content.name).slice(0, 500);
  if (!imageUrl && !fileUrl) return undefined;
  return {
    ...(imageUrl ? { imageUrl } : {}),
    ...(fileUrl ? { fileUrl } : {}),
    ...(fileName ? { fileName } : {}),
  };
}

const lazadaTemplateKinds = {
  1: "text",
  2: "system_text",
  3: "image",
  4: "emoji",
  6: "video",
  10006: "item_card",
  10007: "order_card",
  10008: "voucher_card",
  10010: "follow_invitation",
  10011: "refund_order_card",
  10015: "auto_reply",
} as const;

export function lazadaImTemplateKind(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && Object.hasOwn(lazadaTemplateKinds, id)
    ? lazadaTemplateKinds[id as keyof typeof lazadaTemplateKinds]
    : "unknown" as const;
}

function officialSession(value: unknown) {
  return Array.isArray(value) && value.some((tag) => typeof tag === "string" && tag.trim().toLowerCase() === "official");
}

function lazadaEventDetails(
  row: Record<string, unknown>,
  content: Record<string, unknown>,
  options: { officialSession?: boolean } = {},
) {
  const nativeText = messageBody(content.txt, content.text, row.txt, row.text);
  const senderType = Number(row.from_account_type);
  const messageStatusValue = Number(row.status);
  const messageStatus = Number.isInteger(messageStatusValue) ? messageStatusValue : null;
  const messageTypeValue = Number(row.type);
  const messageType = Number.isInteger(messageTypeValue) ? messageTypeValue : null;
  const templateIdValue = Number(row.template_id);
  const templateId = Number.isInteger(templateIdValue) ? templateIdValue : null;
  const templateKind = lazadaImTemplateKind(templateId);
  const blocked = Boolean(text(row.process_msg));
  const nativeMedia = lazadaNativeMedia(content);
  const revisionContentKey = JSON.stringify({ nativeText, nativeMedia: nativeMedia ?? null });
  const nativeContentFingerprint = createHash("sha256").update(revisionContentKey, "utf8").digest("hex");
  const roleBasis = senderType === 2 ? "account_type"
    : options.officialSession ? "official_session_tag"
      : messageType === 2 || templateKind === "system_text" || templateKind === "auto_reply" ? "system_message"
        : templateKind === "unknown" ? "unknown_template"
          : senderType === 1 ? "account_type" : "unknown_sender";
  const plainText = Boolean(nativeText && [1, 2].includes(senderType)
    && messageStatus === 0 && messageType === 1 && templateId === 1 && !blocked
    && (!options.officialSession || senderType === 2));
  const eventKind = blocked ? "blocked"
    : messageStatus === 1 ? "recalled"
      : messageStatus !== 0 ? "status_unverified"
      : nativeMedia?.imageUrl ? "image"
        : nativeMedia?.fileUrl ? "file"
          : messageType === 2 || templateKind === "system_text" ? "system"
            : templateKind !== "text" ? "rich_or_system"
            : nativeText ? "text_unverified_sender" : "unknown";
  const displayMessage = eventKind === "blocked"
    ? `Lazada 전달 차단 · ${nativeText || "원문함에서 확인"}`
    : eventKind === "recalled"
      ? `Lazada 발신자 회수 · ${nativeText || text(content.recallContent) || "원문함에서 확인"}`
      : eventKind === "status_unverified"
        ? `Lazada 상태 의미 확인 필요 · ${nativeText || "원문함에서 확인"}`
      : nativeText || (eventKind === "image" ? "Lazada 이미지 메시지"
        : eventKind === "file" ? "Lazada 파일 메시지"
          : templateKind === "emoji" ? "Lazada 이모지 메시지"
            : templateKind === "video" ? "Lazada 동영상 메시지"
              : templateKind === "item_card" ? "Lazada 상품 카드"
                : templateKind === "order_card" ? "Lazada 주문 카드"
                  : templateKind === "voucher_card" ? "Lazada 바우처 카드"
                    : templateKind === "follow_invitation" ? "Lazada 스토어 팔로우 초대"
                      : templateKind === "refund_order_card" ? "Lazada 환불 주문 카드"
                        : templateKind === "auto_reply" ? "Lazada 자동 응답"
          : eventKind === "rich_or_system" ? "Lazada 형식 확인이 필요한 메시지"
            : "Lazada 알 수 없는 메시지 이벤트");
  return {
    senderType,
    messageStatusNormal: messageStatus === 0,
    systemEvent: (options.officialSession === true && senderType !== 2) || ![1, 2].includes(senderType)
      || eventKind === "unknown" || messageType === 2
      || templateKind === "system_text" || templateKind === "auto_reply"
      || (templateKind === "unknown" && senderType !== 2),
    blocked,
    plainText,
    displayMessage,
    revisionContentKey,
    providerContext: {
      nativeContentFingerprint,
      eventKind,
      messageStatus,
      messageType,
      templateId,
      templateKind,
      ...(roleBasis !== "account_type" ? { roleBasis } : {}),
      ...(messageStatus === 1 && text(row.message_id)
        ? { recallTargetMessageId: text(row.message_id) }
        : {}),
      ...(nativeMedia ? { nativeMedia } : {}),
    },
  };
}

function normalizableHistoryMessage(row: Record<string, unknown>) {
  return Boolean(text(row.message_id));
}

export function lazadaImHistoryRawPages(
  steps: Array<{ name: string; data: Record<string, unknown>; ok?: boolean }>,
): LazadaImHistoryRawPage[] {
  return steps.filter((item) => item.ok !== false && item.name.startsWith("inquiries-message:")).map((item) => {
    const root = record(item.data.data);
    const rawMessages = root.message_list ?? root.messages ?? item.data.message_list;
    if (!Array.isArray(rawMessages) || rawMessages.some(value => !value || typeof value !== "object" || Array.isArray(value))) {
      throw new Error("LAZADA_HISTORY_MESSAGE_PAGE_INVALID");
    }
    const rawBody = JSON.stringify(item.data);
    if (Buffer.byteLength(rawBody, "utf8") > 256_000) throw new Error("LAZADA_HISTORY_RAW_PAGE_TOO_LARGE");
    return {
      rawBody,
      processingStatus: rawMessages.every((value) => normalizableHistoryMessage(value as Record<string, unknown>))
        ? "normalized" as const
        : "unsupported" as const,
    };
  });
}


export function parseLazadaImPush(payload: Record<string, unknown>): LazadaImInquiry | null {
  const data = parsedRecord(payload.data);
  const nestedMessage = record(data.message);
  const message = Object.keys(nestedMessage).length ? nestedMessage : data;
  const content = parsedRecord(message.content ?? data.content);
  const sessionId = text(data.session_id, data.sessionId, message.session_id, payload.session_id);
  // The push envelope UUID identifies delivery, not the native IM message.
  const messageId = text(message.message_id, data.message_id, payload.message_id);
  const event = lazadaEventDetails({ ...data, ...message }, content, {
    officialSession: officialSession(data.tags) || officialSession(payload.tags),
  });
  if (!sessionId || !messageId) return null;
  const { senderType, blocked, messageStatusNormal, systemEvent } = event;
  // LPM timestamp is delivery time, not the native message send_time. The
  // receiver requires the v3 readiness fence before storing an undated event.
  const timestamp = blocked ? "" : providerTimestamp(message.send_time ?? data.send_time) ?? "";
  return {
    externalTicketId: `lazada-im:${sessionId}`,
    customerName: systemEvent ? "Lazada 시스템" : senderType === 2 ? "Lazada 판매자"
      : timestamp ? text(data.buyer_name, data.from_account_name, message.from_name, "Lazada 고객") : "Lazada 고객",
    subject: timestamp ? text(data.product_name, data.title, data.site_id ? `Lazada ${data.site_id} IM 문의` : "Lazada IM 문의") : "Lazada 시각 미확정 메시지",
    message: event.displayMessage,
    status: messageStatusNormal && (systemEvent || senderType === 2) && timestamp ? "resolved" : "waiting",
    priority: 3,
    receivedAt: timestamp,
    ...(!timestamp ? { orderingStatus: "unverified" as const } : {}),
    remoteMessageId: messageId,
    ...(event.plainText
      ? {
        ...(senderType === 2 ? { senderRole: "seller" as const } : {}),
        providerContext: { nativeContentFingerprint: event.providerContext.nativeContentFingerprint },
      }
      : {
        senderRole: systemEvent ? "system" as const : senderType === 2 ? "seller" as const : "customer" as const,
        providerContext: event.providerContext,
      }),
  };
}

export function normalizeLazadaImHistory(
  steps: Array<{ name: string; data: Record<string, unknown>; ok?: boolean }>,
  _collectionTimestamp?: string,
  options: { rawStorageReady?: boolean } = {},
) {
  // Retain the existing caller ABI; collection time is never message evidence.
  void _collectionTimestamp;
  const sessions = new Map<string, { session: Record<string, unknown>; messages: Record<string, unknown>[] }>();
  for (const step of steps.filter((item) => item.ok !== false && item.name.startsWith("inquiries-message:"))) {
      const root = record(step.data.data);
      const session = record(step.data.sellerpilotSession);
      const nameSessionId = step.name.slice("inquiries-message:".length).split(":")[0];
      const sessionId = text(session.session_id, nameSessionId);
      if (!sessionId) continue;
      const rawMessages = root.message_list ?? root.messages ?? step.data.message_list;
      if (!Array.isArray(rawMessages) || rawMessages.some(value => !value || typeof value !== "object" || Array.isArray(value))) {
        throw new Error("LAZADA_HISTORY_MESSAGE_PAGE_INVALID");
      }
      const messages = list(rawMessages);
      const current = sessions.get(sessionId);
      sessions.set(sessionId, {
        session: Object.keys(session).length ? session : current?.session ?? {},
        messages: [...(current?.messages ?? []), ...messages],
      });
  }

  return [...sessions.entries()].flatMap(([sessionId, { session, messages }]) => {
    const byMessageId = new Map<string, LazadaImInquiry>();
    const revisionContentKeys = new Map<string, string>();
    const conflicts = new Map<string, LazadaImInquiry[]>();
    for (const row of messages) {
      const remoteMessageId = text(row.message_id);
      const content = parsedRecord(row.content);
      const event = lazadaEventDetails(row, content, { officialSession: officialSession(session.tags) });
      const { senderType, messageStatusNormal, systemEvent } = event;
      if (!remoteMessageId) {
        // Never complete a historical page after silently dropping malformed
        // native identities. Unknown native event types with a stable identity
        // remain visible as system events after their raw page is stored.
        if (options.rawStorageReady) continue;
        throw new Error("LAZADA_HISTORY_MESSAGE_STORAGE_REQUIRED");
      }
      if (!event.plainText && !options.rawStorageReady) {
        throw new Error("LAZADA_HISTORY_MESSAGE_STORAGE_REQUIRED");
      }
      // A nonempty process_msg means blocked delivery. Retain its original in
      // quarantine, never mark the conversation answered or allow readback ACK.
      const receivedAt = text(row.process_msg) ? "" : providerTimestamp(row.send_time) ?? "";
      const previous = byMessageId.get(remoteMessageId);
      const candidate: LazadaImInquiry = {
        externalTicketId: `lazada-im:${sessionId}`,
        customerName: systemEvent ? "Lazada 시스템" : senderType === 2 ? "Lazada 판매자"
          : receivedAt ? text(session.title, session.buyer_name, "Lazada 고객") : "Lazada 고객",
        subject: receivedAt ? text(session.product_name, session.site_id ? `Lazada ${session.site_id} IM 문의` : "Lazada IM 문의") : "Lazada 시각 미확정 메시지",
        message: event.displayMessage,
        // These are message events, not a session summary. The ledger keeps
        // latest_inbound_key on the latest buyer and processes seller events
        // separately to derive the current conversation's provider status.
        status: messageStatusNormal && (systemEvent || senderType === 2) && receivedAt ? "resolved" : "waiting",
        priority: Number(session.unread_count ?? 0) > 0 ? 2 : 3,
        receivedAt,
        ...(!receivedAt ? { orderingStatus: "unverified" as const } : {}),
        remoteMessageId,
        senderRole: systemEvent ? "system" : senderType === 2 ? "seller" : "customer",
        providerContext: event.plainText
          ? { nativeContentFingerprint: event.providerContext.nativeContentFingerprint }
          : event.providerContext,
      };
      const variants = conflicts.get(remoteMessageId);
      const previousRecalled = previous?.providerContext?.eventKind === "recalled";
      const candidateRecalled = candidate.providerContext?.eventKind === "recalled";
      const sameRevisionContent = revisionContentKeys.get(remoteMessageId) === event.revisionContentKey;
      if (!variants && previous && previous.senderRole === candidate.senderRole
          && previousRecalled !== candidateRecalled && sameRevisionContent) {
        // Lazada emits the original message identity again with status=1 and a
        // separate system event. Raw pages retain both observations; the card
        // projection must converge on the recalled revision in either order.
        byMessageId.set(remoteMessageId, candidateRecalled ? candidate : previous);
      } else if (variants || (previous && (previous.message !== candidate.message
          || previous.senderRole !== candidate.senderRole
          || JSON.stringify(previous.providerContext) !== JSON.stringify(candidate.providerContext)))) {
        const all = variants ?? [previous!];
        if (!all.some(value => value.message === candidate.message
            && value.senderRole === candidate.senderRole
            && JSON.stringify(value.providerContext) === JSON.stringify(candidate.providerContext))) all.push(candidate);
        conflicts.set(remoteMessageId, all);
        byMessageId.delete(remoteMessageId);
        revisionContentKeys.delete(remoteMessageId);
      } else if (!previous || (!previous.receivedAt && receivedAt)) {
        byMessageId.set(remoteMessageId, candidate);
        revisionContentKeys.set(remoteMessageId, event.revisionContentKey);
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
