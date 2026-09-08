import {
  ebayEnvironment,
  ebayRequest,
  ebayTradingRequest,
  runWithProviderReadOnlyTransport,
  textValue,
  type SecretPayload,
} from "./protocols";
import { hasRecordedEbayMessageScope } from "./ebay-oauth-scopes";
export { ebayMessageScope, hasRecordedEbayMessageScope } from "./ebay-oauth-scopes";

// Contract: https://developer.ebay.com/develop/api/spec/message_api.json
// Separate from Trading ASQ. A successful read is not a reply certification.
export type EbayMessageAccessEvidence = {
  recordedScope: boolean;
  httpStatus: number;
  status: "readable" | "authorization_required" | "unverified";
  pageCount: number | null;
  total: number | null;
  hasMore: boolean | null;
};

export type EbayTradingMailboxEvidence = {
  httpStatus: number;
  status: "readable" | "authorization_required" | "unverified";
  providerErrorCode?: string;
  contractReason?: "provider_rejected" | "summary_missing" | "summary_invalid";
  pageCount: number | null;
  total: number | null;
  unread: number | null;
};

export async function probeEbayTradingMyMessages(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  now?: Date;
}): Promise<EbayTradingMailboxEvidence> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("EBAY_MY_MESSAGES_TIME_INVALID");
  const marketplaceId = textValue(input.payload, "marketplace_id") || "EBAY_US";
  const body = `<?xml version="1.0" encoding="utf-8"?><GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnSummary</DetailLevel></GetMyMessagesRequest>`;
  return runWithProviderReadOnlyTransport(async () => {
    const remote = await ebayTradingRequest({
      payload: input.payload,
      environment: input.environment,
      callName: "GetMyMessages",
      marketplaceId,
      body,
    });
    const httpStatus = remote.response.status;
    if (httpStatus === 401 || httpStatus === 403) return {
      httpStatus,
      status: "authorization_required",
      pageCount: null,
      total: null,
      unread: null,
    };
    if (httpStatus !== 200 || remote.data.code !== "SUCCESS") {
      const errors = Array.isArray(remote.data.errors) ? remote.data.errors : [];
      const first = errors[0];
      const errorCode = first && typeof first === "object" && !Array.isArray(first)
        ? String((first as Record<string, unknown>).errorCode ?? "")
        : "";
      return {
      httpStatus,
      status: "unverified",
      ...(/^[A-Za-z0-9_.-]{1,80}$/.test(errorCode) ? { providerErrorCode: errorCode } : {}),
      contractReason: "provider_rejected",
      pageCount: null,
      total: null,
      unread: null,
      };
    }
    const summary = remote.data.summary;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {
      httpStatus,
      status: "unverified",
      contractReason: "summary_missing",
      pageCount: null,
      total: null,
      unread: null,
    };
    const total = (summary as Record<string, unknown>).totalMessageCount;
    const unread = (summary as Record<string, unknown>).newMessageCount;
    if (!Number.isSafeInteger(total) || Number(total) < 0
        || !Number.isSafeInteger(unread) || Number(unread) < 0 || Number(unread) > Number(total)) return {
      httpStatus,
      status: "unverified",
      contractReason: "summary_invalid",
      pageCount: null,
      total: null,
      unread: null,
    };
    return {
      httpStatus,
      status: "readable",
      pageCount: 0,
      total: Number(total),
      unread: Number(unread),
    };
  });
}

export async function probeEbayMessageAccess(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
}): Promise<EbayMessageAccessEvidence> {
  return runWithProviderReadOnlyTransport(async () => {
    // No date/status filter: a probe must not confuse an empty recent range
    // with an empty account. Read one conversation and discard all content.
    const remote = await ebayRequest({
      ...input,
      method: "GET",
      path: "/commerce/message/v1/conversation",
      query: new URLSearchParams({ conversation_type: "FROM_MEMBERS", limit: "1", offset: "0" }),
    });
    const httpStatus = remote.response.status;
    const evidence: EbayMessageAccessEvidence = {
      recordedScope: hasRecordedEbayMessageScope(input.payload),
      httpStatus,
      status: httpStatus === 401 || httpStatus === 403 ? "authorization_required" : "unverified",
      pageCount: null,
      total: null,
      hasMore: null,
    };
    if (httpStatus !== 200) return evidence;
    const data = remote.data;
    const total = data.total === undefined || data.total === null
      ? null
      : Number.isSafeInteger(data.total) && (data.total as number) >= 0
        ? data.total as number
        : Number.NaN;
    let next = false;
    if (data.next !== undefined && data.next !== null) {
      if (typeof data.next !== "string") return evidence;
      try {
        const cursor = new URL(data.next);
        const keys = [...cursor.searchParams.keys()];
        next = cursor.origin === ebayEnvironment(input.environment).api
          && cursor.pathname === "/commerce/message/v1/conversation"
          && keys.length === 3 && new Set(keys).size === 3
          && cursor.searchParams.get("conversation_type") === "FROM_MEMBERS"
          && cursor.searchParams.get("limit") === "1"
          && cursor.searchParams.get("offset") === "1";
      } catch { next = false; }
      if (!next) return evidence;
    }
    if (!Array.isArray(data.conversations) || data.conversations.length > 1
      || data.limit !== 1 || data.offset !== 0 || Number.isNaN(total)
      || total !== null && (total < data.conversations.length
        || next && data.conversations.length >= total
        || !next && data.conversations.length < total)) return evidence;
    return {
      ...evidence,
      status: "readable",
      pageCount: data.conversations.length,
      total,
      hasMore: next,
    };
  });
}
