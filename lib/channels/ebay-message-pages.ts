import { ebayEnvironment, ebayRequest, runWithProviderReadOnlyTransport, type SecretPayload } from "./protocols";
import { hasRecordedEbayMessageScope } from "./ebay-oauth-scopes";
import { providerMessageTimestamp } from "./cs-history-values";
import { readProviderAccountIdentity } from "./provider-account-identity";

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
  total: number | null;
  offset: number;
  nextOffset: number | null;
};
export const ebayConversationPageSize = 10;
export const ebayConversationMessagePageSize = 25;
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
function page<T>(
  data: Record<string, unknown>,
  key: "conversations" | "messages",
  environment: "sandbox" | "production",
  path: string,
  query: URLSearchParams,
  offset: number,
  limit: number,
  parse: (row: unknown) => T,
): EbayMessagePage<T> {
  const rows = data[key];
  if (!Array.isArray(rows) || rows.length > limit || data.offset !== offset || data.limit !== limit) {
    return invalid("pagination");
  }
  const total = data.total === undefined || data.total === null
    ? null
    : Number.isSafeInteger(data.total) && (data.total as number) >= 0
      ? data.total as number
      : invalid("paginationTotal");
  const nextOffset = commerceNextOffset(data.next, environment, path, query, offset, limit);
  // The provider can return an empty intermediate page with a valid `next`.
  // Its cursor, rather than row count, is authoritative for continuation. A
  // reported total is only a consistency bound and is never invented when it
  // is omitted.
  if (total !== null && (offset + rows.length > total
      || nextOffset !== null && offset + rows.length >= total
      || nextOffset === null && offset + rows.length < total)) {
    return invalid("paginationConsistency");
  }
  const entries = rows.map(parse);
  const ids = entries.map(entry => {
    const row = record(entry, "entry");
    return key === "messages" ? row.messageId : row.conversationId;
  });
  if (new Set(ids).size !== entries.length) return invalid("duplicatePageIdentity");
  return { entries, total, offset, nextOffset };
}
function commerceNextOffset(
  value: unknown,
  environment: "sandbox" | "production",
  path: string,
  query: URLSearchParams,
  offset: number,
  limit: number,
) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) return invalid("paginationNext");
  let next: URL;
  try { next = new URL(value); } catch { return invalid("paginationNext"); }
  if (next.origin !== ebayEnvironment(environment).api || next.pathname !== path
      || next.username || next.password || next.hash) return invalid("paginationNext");
  const expected = new URLSearchParams(query);
  expected.set("offset", String(offset + limit));
  const expectedKeys = [...new Set(expected.keys())].sort();
  const actualKeys = [...new Set(next.searchParams.keys())].sort();
  if (expectedKeys.length !== [...expected.keys()].length
      || actualKeys.length !== [...next.searchParams.keys()].length
      || JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)
      || expectedKeys.some(key => next.searchParams.get(key) !== expected.get(key))) {
    return invalid("paginationNext");
  }
  const nextOffset = Number(next.searchParams.get("offset"));
  if (!Number.isSafeInteger(nextOffset) || nextOffset !== offset + limit
      || nextOffset <= offset || nextOffset > 10_000_000 || nextOffset % limit !== 0) {
    return invalid("paginationCursor");
  }
  return nextOffset;
}
function offsetValue(value: number | undefined, pageSize: number) {
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
  const offset = offsetValue(input.offset, ebayConversationPageSize);
  const query = new URLSearchParams({ conversation_type: conversationType, limit: String(ebayConversationPageSize), offset: String(offset) });
  if (input.startTime !== undefined || input.endTime !== undefined) {
    if (conversationType !== "FROM_MEMBERS") return invalid("systemDateFilter");
    const start = timestamp(input.startTime, "startTime");
    const end = timestamp(input.endTime, "endTime");
    if (Date.parse(start) >= Date.parse(end)) return invalid("timeRange");
    query.set("start_time", start); query.set("end_time", end);
  }
  const data = await read(input, "/commerce/message/v1/conversation", query);
  return page(data, "conversations", input.environment, "/commerce/message/v1/conversation", query,
    offset, ebayConversationPageSize, value => {
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
  const offset = offsetValue(input.offset, ebayConversationMessagePageSize);
  const path = `/commerce/message/v1/conversation/${encodeURIComponent(conversationId)}`;
  const query = new URLSearchParams({ conversation_type: conversationType, limit: String(ebayConversationMessagePageSize), offset: String(offset) });
  const data = await read(input, path, query);
  if (type(data.conversationType) !== conversationType) return invalid("conversationTypeMismatch");
  return { ...page(data, "messages", input.environment, path, query,
    offset, ebayConversationMessagePageSize, message), status: string(data.conversationStatus, "conversationStatus", 30), title: string(data.conversationTitle, "conversationTitle", 2000, true) };
}

export async function sendEbayConversationMessage(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  conversationId: string;
  messageText: string;
}) {
  if (!hasRecordedEbayMessageScope(input.payload)) throw new Error("EBAY_MESSAGE_CONSENT_REQUIRED");
  const conversationId = id(input.conversationId, "conversationId");
  const messageText = string(input.messageText, "messageText", 4_000);
  if ([...messageText].some(character => {
    const code = character.charCodeAt(0);
    return code === 127 || (code <= 31 && code !== 9 && code !== 10 && code !== 13);
  })) return invalid("messageText");
  const remote = await ebayRequest({
    payload: input.payload,
    environment: input.environment,
    method: "POST",
    path: "/commerce/message/v1/send_message",
    body: { conversationId, messageText },
  });
  if (![200, 201].includes(remote.response.status)) {
    throw new Error(`EBAY_MESSAGE_SEND_HTTP_${remote.response.status}`);
  }
  const messageId = id(remote.data.messageId, "messageId");
  const createdAt = timestamp(remote.data.createdDate, "createdDate");
  return { remote, conversationId, messageId, createdAt };
}

export function ebayVerifiedMessageAccountIdentifiers(payload: SecretPayload) {
  const identifiers = new Set<string>();
  const username = typeof payload.ebay_user_id === "string" ? payload.ebay_user_id : "";
  if (username && username.trim() === username && username.length <= 240) identifiers.add(username);
  const identity = readProviderAccountIdentity(payload, "ebay");
  const immutableId = identity?.subject.startsWith("ebay:eias:")
    ? identity.subject.slice("ebay:eias:".length)
    : "";
  if (immutableId && immutableId.length <= 240) identifiers.add(immutableId);
  return [...identifiers];
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
