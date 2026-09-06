import { ebayRequest, runWithProviderReadOnlyTransport, type SecretPayload } from "./protocols";
import { hasRecordedEbayMessageScope } from "./ebay-oauth-scopes";
import { providerMessageTimestamp } from "./cs-history-values";

// Commerce Message API v1, not Trading ASQ. Native conversation/message IDs
// remain separate; they must never be passed to AddMemberMessageRTQ.
export type EbayConversationType = "FROM_MEMBERS" | "FROM_EBAY";
export type EbayMessageMedia = { name: string | null; type: "IMAGE" | "PDF" | "DOC" | "TXT"; url: string };
export type EbayConversationMessage = {
  messageId: string;
  body: string;
  subject: string;
  senderUsername: string;
  recipientUsername: string;
  createdAt: string;
  read: boolean;
  media: EbayMessageMedia[];
};
export type EbayConversationSummary = {
  conversationId: string;
  type: EbayConversationType;
  status: string;
  title: string;
  createdAt: string;
  referenceId: string | null;
  referenceType: "LISTING" | null;
  latestMessage: EbayConversationMessage;
};
export type EbayMessagePage<T> = {
  entries: T[];
  total: number;
  offset: number;
  nextOffset: number | null;
};
const pageSize = 25;
const invalid = (field: string): never => { throw new Error(`EBAY_MESSAGE_CONTRACT_INVALID:${field}`); };
function record(value: unknown, field: string): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid(field);
}
function string(value: unknown, field: string, max: number, empty = false) {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) return invalid(field);
  return value;
}
function id(value: unknown, field: string) {
  const text = string(value, field, 240);
  if (text !== text.trim() || [...text].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return invalid(field);
  return text;
}
function timestamp(value: unknown, field: string) {
  // This API documents ISO-8601 strings, not unix seconds.
  const text = string(value, field, 60);
  if (text !== text.trim() || !text.includes("T") || !providerMessageTimestamp(text)) return invalid(field);
  // Preserve the provider's offset and sub-millisecond precision for the ledger.
  return text;
}
function type(value: unknown): EbayConversationType {
  return value === "FROM_MEMBERS" || value === "FROM_EBAY" ? value : invalid("conversationType");
}
function media(value: unknown): EbayMessageMedia[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) return invalid("messageMedia");
  return value.map(item => {
    const row = record(item, "media");
    const mediaType = row.mediaType;
    if (mediaType !== "IMAGE" && mediaType !== "PDF" && mediaType !== "DOC" && mediaType !== "TXT") return invalid("mediaType");
    const url = string(row.mediaUrl, "mediaUrl", 8000);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || url !== url.trim()) return invalid("mediaUrl");
    } catch { return invalid("mediaUrl"); }
    return { name: row.mediaName === undefined ? null : string(row.mediaName, "mediaName", 500, true), type: mediaType, url };
  });
}
function message(value: unknown): EbayConversationMessage {
  const row = record(value, "message");
  const attachments = media(row.messageMedia);
  const body = string(row.messageBody, "messageBody", 20000, true);
  if (!body.trim() && attachments.length === 0) return invalid("emptyMessage");
  if (typeof row.readStatus !== "boolean") return invalid("readStatus");
  return {
    messageId: id(row.messageId, "messageId"), body,
    subject: row.subject === undefined ? "" : string(row.subject, "subject", 2000, true),
    senderUsername: id(row.senderUsername, "senderUsername"), recipientUsername: id(row.recipientUsername, "recipientUsername"),
    createdAt: timestamp(row.createdDate, "createdDate"), read: row.readStatus, media: attachments,
  };
}
function page<T>(data: Record<string, unknown>, key: "conversations" | "messages", offset: number, parse: (row: unknown) => T): EbayMessagePage<T> {
  const rows = data[key];
  if (!Array.isArray(rows) || rows.length > pageSize || data.offset !== offset || data.limit !== pageSize
    || !Number.isSafeInteger(data.total) || (data.total as number) < 0) return invalid("pagination");
  const total = data.total as number;
  const hasMore = offset + rows.length < total;
  // Partial/empty intermediate pages must not skip data or claim completion.
  if ((hasMore && rows.length !== pageSize) || (rows.length > 0 && offset + rows.length > total)
    || (data.next && !hasMore)) return invalid("paginationConsistency");
  const entries = rows.map(parse);
  const ids = entries.map(entry => {
    const row = record(entry, "entry");
    return key === "messages" ? row.messageId : row.conversationId;
  });
  if (new Set(ids).size !== entries.length) return invalid("duplicatePageIdentity");
  return { entries, total, offset, nextOffset: hasMore ? offset + pageSize : null };
}
function offsetValue(value: number | undefined) {
  const offset = value ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000 || offset % pageSize !== 0) return invalid("offset");
  return offset;
}
async function read(input: { payload: SecretPayload; environment: "sandbox" | "production" }, path: string, query: URLSearchParams) {
  if (!hasRecordedEbayMessageScope(input.payload)) throw new Error("EBAY_MESSAGE_CONSENT_REQUIRED");
  return runWithProviderReadOnlyTransport(async () => {
    const remote = await ebayRequest({ ...input, method: "GET", path, query });
    if (remote.response.status !== 200) throw new Error(`EBAY_MESSAGE_READ_HTTP_${remote.response.status}`);
    return remote.data;
  });
}

export async function readEbayConversationsPage(input: {
  payload: SecretPayload; environment: "sandbox" | "production";
  type: EbayConversationType; offset?: number; startTime?: string; endTime?: string;
}): Promise<EbayMessagePage<EbayConversationSummary>> {
  const conversationType = type(input.type);
  const offset = offsetValue(input.offset);
  const query = new URLSearchParams({ conversation_type: conversationType, limit: String(pageSize), offset: String(offset) });
  if (input.startTime !== undefined || input.endTime !== undefined) {
    if (conversationType !== "FROM_MEMBERS") return invalid("systemDateFilter");
    const start = timestamp(input.startTime, "startTime");
    const end = timestamp(input.endTime, "endTime");
    if (Date.parse(start) >= Date.parse(end)) return invalid("timeRange");
    query.set("start_time", start); query.set("end_time", end);
  }
  const data = await read(input, "/commerce/message/v1/conversation", query);
  return page(data, "conversations", offset, value => {
    const row = record(value, "conversation");
    if (type(row.conversationType) !== conversationType) return invalid("conversationTypeMismatch");
    const reference = row.referenceId !== undefined || row.referenceType !== undefined;
    if (reference && (row.referenceType !== "LISTING" || typeof row.referenceId !== "string" || !/^[1-9]\d*$/.test(row.referenceId))) return invalid("reference");
    return {
      conversationId: id(row.conversationId, "conversationId"), type: conversationType,
      status: string(row.conversationStatus, "conversationStatus", 30), title: string(row.conversationTitle, "conversationTitle", 2000, true),
      createdAt: timestamp(row.createdDate, "createdDate"), referenceId: reference ? row.referenceId as string : null,
      referenceType: reference ? "LISTING" : null, latestMessage: message(row.latestMessage),
    };
  });
}

export async function readEbayConversationMessagesPage(input: {
  payload: SecretPayload; environment: "sandbox" | "production";
  conversationId: string; type: EbayConversationType; offset?: number;
}): Promise<EbayMessagePage<EbayConversationMessage> & { status: string; title: string }> {
  const conversationId = id(input.conversationId, "conversationId");
  const conversationType = type(input.type);
  const offset = offsetValue(input.offset);
  const data = await read(input, `/commerce/message/v1/conversation/${encodeURIComponent(conversationId)}`,
    new URLSearchParams({ conversation_type: conversationType, limit: String(pageSize), offset: String(offset) }));
  if (type(data.conversationType) !== conversationType) return invalid("conversationTypeMismatch");
  return { ...page(data, "messages", offset, message), status: string(data.conversationStatus, "conversationStatus", 30), title: string(data.conversationTitle, "conversationTitle", 2000, true) };
}

export function ebayConversationMessageRole(message: EbayConversationMessage, conversationType: EbayConversationType, verifiedAccountIdentifiers: readonly string[]) {
  // Usernames can be replaced with immutable user IDs. Never guess who is the
  // seller from array position, a name prefix, unread status, or the message body.
  type(conversationType);
  const self = new Set(verifiedAccountIdentifiers.filter(value => value.trim() === value && value.length > 0));
  const senderIsSelf = self.has(message.senderUsername);
  const recipientIsSelf = self.has(message.recipientUsername);
  if (senderIsSelf === recipientIsSelf) return "unverified" as const;
  if (conversationType === "FROM_EBAY") return recipientIsSelf ? "system" as const : "unverified" as const;
  return senderIsSelf ? "seller" as const : "customer" as const;
}
