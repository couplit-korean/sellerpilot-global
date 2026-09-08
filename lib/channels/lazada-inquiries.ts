import { lazadaRequest, type SecretPayload } from "./protocols";
import { step, type ChannelOperationStep } from "./operation-step";
import { replyAcceptanceMarker } from "./reply-verification";
import { objectValue, stringArgument, integerArgument } from "./operation-values";

type LazadaInquiryInput = {
  operation: "inquiries.list" | "inquiries.reply";
  payload: SecretPayload;
  arguments: Record<string, unknown>;
};
type LazadaInquiryExecution = {
  steps: ChannelOperationStep[];
  remoteId?: string;
  continuationArguments?: Record<string, unknown>;
};

function historyPage(data: Record<string, unknown>, kind: "session" | "message", pageSize: number) {
  const raw = data[`${kind}_list`];
  if (!Array.isArray(raw) || raw.length > pageSize || raw.some(row =>
    !row || typeof row !== "object" || Array.isArray(row)
    || typeof row[`${kind}_id`] !== "string" || !row[`${kind}_id`].trim())) {
    throw new Error(`LAZADA_HISTORY_${kind.toUpperCase()}_PAGE_INVALID`);
  }
  const hasMore = data.has_more === true || data.has_more === "true";
  if (!hasMore && data.has_more !== false && data.has_more !== "false") {
    throw new Error("LAZADA_HISTORY_HAS_MORE_INVALID");
  }
  if (hasMore && raw.length === 0) throw new Error("LAZADA_HISTORY_EMPTY_PAGE_WITH_REMAINDER");
  return { rows: raw as Record<string, unknown>[], hasMore };
}

function nextHistoryCursor(
  data: Record<string, unknown>, kind: "session" | "message", start: string, seen: Set<string>,
) {
  const nextStart = String(data.next_start_time ?? "").trim();
  const lastId = data[`last_${kind}_id`];
  if (!/^\d+$/.test(nextStart) || !Number.isSafeInteger(Number(nextStart)) || Number(nextStart) <= 0
      || Number(nextStart) > Number(start) || typeof lastId !== "string" || !lastId.trim()) {
    throw new Error("LAZADA_HISTORY_CURSOR_INVALID");
  }
  const last = lastId.trim();
  const key = JSON.stringify([nextStart, last]);
  if (seen.has(key)) throw new Error("LAZADA_HISTORY_CURSOR_REPEATED");
  seen.add(key);
  return { nextStart, last };
}

function historyString(value: unknown, name: string, maxLength = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`LAZADA_HISTORY_${name}_INVALID`);
  }
  return value.trim();
}

function compactHistorySession(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LAZADA_HISTORY_SESSION_STATE_INVALID");
  }
  const source = value as Record<string, unknown>;
  const sessionId = historyString(source.session_id, "SESSION_ID");
  const result: Record<string, unknown> = { session_id: sessionId };
  for (const key of ["title", "buyer_name", "product_name", "site_id", "unread_count"] as const) {
    const candidate = source[key];
    if (typeof candidate === "string" || typeof candidate === "number") {
      const text = String(candidate).trim();
      if (text) result[key] = text.slice(0, key === "product_name" ? 2_000 : 500);
    }
  }
  if (source.tags !== undefined) {
    if (!Array.isArray(source.tags) || source.tags.length > 20
        || source.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 100)) {
      throw new Error("LAZADA_HISTORY_SESSION_TAGS_INVALID");
    }
    result.tags = source.tags.map((tag) => tag.trim());
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 8_000) {
    throw new Error("LAZADA_HISTORY_SESSION_STATE_INVALID");
  }
  return result;
}

function optionalHistoryCursor(arguments_: Record<string, unknown>, prefix: "Session" | "Message") {
  const rawStart = arguments_[`sellerpilotLazada${prefix}StartTime`];
  const rawLast = arguments_[`sellerpilotLazadaLast${prefix}Id`];
  if (rawStart === undefined && rawLast === undefined) return null;
  const start = historyString(String(rawStart ?? ""), `${prefix.toUpperCase()}_START_TIME`, 40);
  const last = historyString(rawLast, `LAST_${prefix.toUpperCase()}_ID`);
  if (!/^\d+$/.test(start) || !Number.isSafeInteger(Number(start)) || Number(start) <= 0) {
    throw new Error(`LAZADA_HISTORY_${prefix.toUpperCase()}_CURSOR_INVALID`);
  }
  return { start, last };
}

export async function executeLazadaInquiry(input: LazadaInquiryInput): Promise<LazadaInquiryExecution> {
  if (input.operation === "inquiries.list") {
    if (input.arguments.bootstrap !== true) throw new Error("CHANNEL_ARGUMENT_REQUIRED:bootstrap");
    const pageSize = input.arguments.pageSize === undefined
      ? 20
      : integerArgument(input.arguments, "pageSize", { min: 1, max: 20 });
    const sessionLimit = input.arguments.sessionLimit === undefined
      ? 100
      : integerArgument(input.arguments, "sessionLimit", { min: 1, max: 100 });
    const messageLimit = input.arguments.messageLimit === undefined
      ? 100
      : integerArgument(input.arguments, "messageLimit", { min: 20, max: 100 });
    const startTime = input.arguments.startTime === undefined
      ? Date.now()
      : integerArgument(input.arguments, "startTime", { min: 1 });
    // Validate the legacy bounds even though durable execution now processes
    // one session and one message page per transaction.
    void pageSize;
    void sessionLimit;
    const steps: ChannelOperationStep[] = [];
    const resumedSession = input.arguments.sellerpilotLazadaSession;
    const sessionCursor = optionalHistoryCursor(input.arguments, "Session");
    const messageCursor = optionalHistoryCursor(input.arguments, "Message");
    let session: Record<string, unknown>;
    let nextSessionCursor: { nextStart: string; last: string } | null = null;

    if (resumedSession !== undefined) {
      session = compactHistorySession(resumedSession);
      if (!messageCursor) throw new Error("LAZADA_HISTORY_MESSAGE_CURSOR_REQUIRED");
      const pendingSessionCursor = input.arguments.sellerpilotLazadaNextSessionCursor;
      if (pendingSessionCursor !== undefined) {
        if (!pendingSessionCursor || typeof pendingSessionCursor !== "object" || Array.isArray(pendingSessionCursor)) {
          throw new Error("LAZADA_HISTORY_SESSION_CURSOR_INVALID");
        }
        const pending = pendingSessionCursor as Record<string, unknown>;
        nextSessionCursor = {
          nextStart: historyString(String(pending.nextStart ?? ""), "SESSION_START_TIME", 40),
          last: historyString(pending.last, "LAST_SESSION_ID"),
        };
      }
    } else {
      if (messageCursor) throw new Error("LAZADA_HISTORY_SESSION_STATE_REQUIRED");
      const sessionStart = sessionCursor?.start ?? String(startTime);
      const params: Record<string, string> = { start_time: sessionStart, page_size: "1" };
      if (sessionCursor) params.last_session_id = sessionCursor.last;
      const remote = await lazadaRequest({ payload: input.payload, path: "/im/session/list", params });
      const sessionStep = step("inquiries-session-list:1", remote);
      steps.push(sessionStep);
      if (!sessionStep.ok) return { steps };
      const responseData = objectValue(remote.data, "data", false);
      const { rows, hasMore } = historyPage(responseData, "session", 1);
      if (!rows.length) return { steps };
      session = compactHistorySession(rows[0]);
      if (hasMore) {
        const seen = new Set<string>();
        if (sessionCursor) seen.add(JSON.stringify([sessionCursor.start, sessionCursor.last]));
        nextSessionCursor = nextHistoryCursor(responseData, "session", sessionStart, seen);
      }
    }

    const sessionId = historyString(session.session_id, "SESSION_ID");
    const messageStart = messageCursor?.start ?? String(startTime);
    const messageParams: Record<string, string> = {
      session_id: sessionId,
      start_time: messageStart,
      page_size: String(Math.min(20, messageLimit)),
    };
    if (messageCursor) messageParams.last_message_id = messageCursor.last;
    const messageRemote = await lazadaRequest({ payload: input.payload, path: "/im/message/list", params: messageParams });
    messageRemote.data = { ...messageRemote.data, sellerpilotSession: session };
    const messageStep = step(`inquiries-message:${sessionId}:1`, messageRemote);
    steps.push(messageStep);
    if (!messageStep.ok) return { steps };
    const messageData = objectValue(messageRemote.data, "data", false);
    const { hasMore: hasMoreMessages } = historyPage(messageData, "message", Number(messageParams.page_size));
    if (hasMoreMessages) {
      const seen = new Set<string>();
      if (messageCursor) seen.add(JSON.stringify([messageCursor.start, messageCursor.last]));
      const nextMessageCursor = nextHistoryCursor(messageData, "message", messageStart, seen);
      return {
        steps,
        continuationArguments: {
          ...input.arguments,
          sellerpilotLazadaSession: session,
          sellerpilotLazadaMessageStartTime: nextMessageCursor.nextStart,
          sellerpilotLazadaLastMessageId: nextMessageCursor.last,
          ...(nextSessionCursor ? { sellerpilotLazadaNextSessionCursor: nextSessionCursor } : {}),
        },
      };
    }
    if (nextSessionCursor) {
      const nextArguments = { ...input.arguments };
      delete nextArguments.sellerpilotLazadaSession;
      delete nextArguments.sellerpilotLazadaMessageStartTime;
      delete nextArguments.sellerpilotLazadaLastMessageId;
      delete nextArguments.sellerpilotLazadaNextSessionCursor;
      return {
        steps,
        continuationArguments: {
          ...nextArguments,
          sellerpilotLazadaSessionStartTime: nextSessionCursor.nextStart,
          sellerpilotLazadaLastSessionId: nextSessionCursor.last,
        },
      };
    }
    return { steps };
  }

  if (input.operation === "inquiries.reply") {
    const sessionId = stringArgument(input.arguments, "sessionId");
    const reply = stringArgument(input.arguments, "reply");
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/im/message/send",
      method: "POST",
      params: { template_id: "1", session_id: sessionId, txt: reply },
    });
    const replyStep = step("inquiry-reply", remote);
    if (replyStep.ok) replyStep.data = { ...replyStep.data, sellerpilotReplyAcceptance: replyAcceptanceMarker(
      "lazada", "im", { sessionId },
    ) };
    return { steps: [replyStep], remoteId: sessionId };
  }
  throw new Error("LAZADA_INQUIRY_OPERATION_REQUIRED");
}
