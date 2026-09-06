import { ebayRequest, runWithProviderReadOnlyTransport, type SecretPayload } from "./protocols";

// Contract: https://developer.ebay.com/develop/api/spec/message_api.json
// Separate from Trading ASQ. A successful read is not a reply certification.
export const ebayMessageScope = "https://api.ebay.com/oauth/api_scope/commerce.message";

export function hasRecordedEbayMessageScope(payload: SecretPayload) {
  return typeof payload.scopes === "string" && payload.scopes.split(/\s+/).includes(ebayMessageScope);
}

export type EbayMessageAccessEvidence = {
  recordedScope: boolean;
  httpStatus: number;
  status: "readable" | "authorization_required" | "unverified";
  pageCount: number | null;
  total: number | null;
  hasMore: boolean | null;
};

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
    if (!Array.isArray(data.conversations) || data.conversations.length > 1
      || data.limit !== 1 || data.offset !== 0
      || !Number.isSafeInteger(data.total) || (data.total as number) < data.conversations.length
      || (data.conversations.length === 0 && data.total !== 0)) return evidence;
    return {
      ...evidence,
      status: "readable",
      pageCount: data.conversations.length,
      total: data.total as number,
      hasMore: (data.total as number) > data.conversations.length || Boolean(data.next),
    };
  });
}
