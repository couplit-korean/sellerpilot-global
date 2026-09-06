import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { readProviderAccountIdentity } from "../../../../../lib/channels/provider-account-identity";
import { readEbayConversationsPage, readEbayConversationMessagesPage, ebayConversationMessageRole } from "../../../../../lib/channels/ebay-message-pages";
import { ebayConversationTypeSchema } from "../../../../../lib/cs/ebay-messages";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer" };
const querySchema = z.object({
  view: z.enum(["accounts", "conversations", "messages"]).default("accounts"),
  credentialId: z.string().uuid().optional(), type: ebayConversationTypeSchema.default("FROM_MEMBERS"),
  conversationId: z.string().min(1).max(240).optional(),
  offset: z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().min(0).max(10_000_000).multipleOf(25)).default(0),
}).strict().superRefine((value, ctx) => {
  if (value.view !== "accounts" && !value.credentialId) ctx.addIssue({ code: "custom", message: "credential required" });
  if ((value.view === "messages") !== Boolean(value.conversationId)) ctx.addIssue({ code: "custom", message: "conversation selection mismatch" });
});
function fail(status: number, code: string, message: string) { return NextResponse.json({ code, message }, { status, headers }); }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8000 });
  if (isAdminApiError(admin)) return admin;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return fail(400, "INVALID_QUERY", "조회 조건이 중복됐습니다.");
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return fail(400, "INVALID_QUERY", "eBay 계정·대화·페이지 선택을 확인해 주세요.");
  const query = parsed.data;
  try {
    // The user-scoped RPC checks ownership before the service can decrypt a key.
    const credentials = await admin.userClient.rpc("sellerpilot_list_owned_ebay_message_accounts");
    if (credentials.error || !Array.isArray(credentials.data)) return fail(503, "CREDENTIALS_UNAVAILABLE", "연결 계정을 확인하지 못했습니다.");
    const accounts = credentials.data.map(record).filter(row => row.environment === "production" || row.environment === "sandbox");
    if (query.view === "accounts") return NextResponse.json({ accounts: accounts.map(row => ({
      id: row.id, label: `eBay 연결 계정 · v${row.version}`, environment: row.environment,
    })) }, { headers });
    const account = accounts.find(row => row.id === query.credentialId);
    if (!account) return fail(404, "ACCOUNT_UNAVAILABLE", "선택한 활성 eBay 계정을 찾지 못했습니다.");
    if (account.seller_account_key_source !== "provider_certified_v1" || !account.seller_account_key) {
      return fail(409, "ACCOUNT_UNVERIFIED", "eBay 판매자 계정 확인이 필요합니다. 채널 연결 관리에서 인증 상태를 확인해 주세요.");
    }
    const decrypted = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: query.credentialId });
    if (decrypted.error || !decrypted.data || Array.isArray(decrypted.data) || typeof decrypted.data !== "object") {
      return fail(503, "CREDENTIAL_UNAVAILABLE", "eBay 연결 정보를 안전하게 불러오지 못했습니다.");
    }
    const payload = record(decrypted.data);
    const identity = readProviderAccountIdentity(payload, "ebay");
    if (!identity) return fail(409, "ACCOUNT_UNVERIFIED", "eBay 판매자 계정 인증이 필요합니다.");
    const accountKey = createHash("sha256").update(["ebay", account.environment, identity.subject].join("\u001f")).digest("hex");
    if (accountKey !== account.seller_account_key) return fail(409, "ACCOUNT_UNVERIFIED", "eBay 연결 계정과 인증 정보가 일치하지 않습니다.");
    const sellerUsername = typeof payload.ebay_user_id === "string" ? payload.ebay_user_id : "";
    const verifiedIdentifiers = sellerUsername && sellerUsername.trim() === sellerUsername ? [sellerUsername] : [];
    const input = { payload, environment: account.environment as "sandbox" | "production", type: query.type, offset: query.offset };
    const withRole = <T extends Parameters<typeof ebayConversationMessageRole>[0]>(message: T) => ({
      ...message, role: ebayConversationMessageRole(message, query.type, verifiedIdentifiers),
    });
    if (query.view === "messages") {
      const page = await readEbayConversationMessagesPage({ ...input, conversationId: query.conversationId! });
      return NextResponse.json({ ...page, kind: "messages", credentialId: query.credentialId, conversationId: query.conversationId,
        type: query.type, entries: page.entries.map(withRole) }, { headers });
    }
    const page = await readEbayConversationsPage(input);
    return NextResponse.json({ ...page, kind: "conversations", credentialId: query.credentialId,
      entries: page.entries.map(row => ({ ...row, latestMessage: withRole(row.latestMessage) })) }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "EBAY_MESSAGE_CONSENT_REQUIRED" || /^EBAY_MESSAGE_READ_HTTP_(401|403)$/.test(code)) {
      return fail(409, "MESSAGE_AUTHORIZATION_REQUIRED", "eBay 일반 대화 권한이 없거나 만료됐습니다. 채널 연결 관리의 ‘일반 대화 권한 연결’을 완료한 뒤 다시 조회해 주세요.");
    }
    if (code === "EBAY_MESSAGE_READ_HTTP_429") return fail(429, "PROVIDER_RATE_LIMITED", "eBay 조회 한도에 도달했습니다. 잠시 후 다시 조회해 주세요.");
    if (code.startsWith("PROVIDER_ACCOUNT_IDENTITY_")) return fail(409, "ACCOUNT_UNVERIFIED", "eBay 판매자 계정 인증 정보를 확인하지 못했습니다.");
    // Never return raw provider errors, signed media URLs, customer content, or tokens in failures.
    return fail(502, "MESSAGE_READ_UNVERIFIED", "eBay 대화 응답을 확인하지 못했습니다. 연결 완료나 문의 0건으로 처리하지 않았습니다.");
  }
}
