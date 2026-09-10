import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import {
  readEbayPaymentDisputesPage,
  readEbayResolutionCasesPage,
} from "../../../../../../../lib/channels/cs/ebay/cases-disputes";
import { ebayVerifiedMessageAccountIdentifiers } from "../../../../../../../lib/channels/ebay-message-pages";
import { readProviderAccountIdentity } from "../../../../../../../lib/channels/provider-account-identity";
import {
  ebayCaseDisputePageSize,
  ebayCaseDisputeQuerySchema,
} from "../../../../../../../lib/cs/channels/ebay/cases-disputes";

export const runtime = "nodejs";

const headers = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
};

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) {
    return fail(400, "INVALID_QUERY", "조회 조건이 중복됐습니다.");
  }
  const parsed = ebayCaseDisputeQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) {
    return fail(400, "INVALID_QUERY", "eBay 계정·종류·기간·페이지 선택을 확인해 주세요.");
  }
  const query = parsed.data;
  try {
    const credentials = await admin.userClient.rpc("sellerpilot_list_owned_ebay_message_accounts");
    if (credentials.error || !Array.isArray(credentials.data)) {
      return fail(503, "CREDENTIALS_UNAVAILABLE", "연결 계정을 확인하지 못했습니다.");
    }
    const accounts = credentials.data.map(record)
      .filter(row => row.environment === "production" || row.environment === "sandbox");
    if (query.view === "accounts") {
      return NextResponse.json({
        accounts: accounts.map(row => ({
          id: row.id,
          label: `eBay 연결 계정 · v${row.version}`,
          environment: row.environment,
        })),
      }, { headers });
    }
    const account = accounts.find(row => row.id === query.credentialId);
    if (!account) return fail(404, "ACCOUNT_UNAVAILABLE", "선택한 활성 eBay 계정을 찾지 못했습니다.");
    if (account.seller_account_key_source !== "provider_certified_v1" || !account.seller_account_key) {
      return fail(409, "ACCOUNT_UNVERIFIED", "eBay 판매자 계정 확인이 필요합니다.");
    }
    const decrypted = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
      p_credential_id: query.credentialId,
    });
    if (decrypted.error || !decrypted.data || Array.isArray(decrypted.data)
        || typeof decrypted.data !== "object") {
      return fail(503, "CREDENTIAL_UNAVAILABLE", "eBay 연결 정보를 안전하게 불러오지 못했습니다.");
    }
    const payload = record(decrypted.data);
    const identity = readProviderAccountIdentity(payload, "ebay");
    if (!identity) return fail(409, "ACCOUNT_UNVERIFIED", "eBay 판매자 계정 인증이 필요합니다.");
    const environment = account.environment as "sandbox" | "production";
    const accountKey = createHash("sha256")
      .update(["ebay", environment, identity.subject].join("\u001f"))
      .digest("hex");
    if (accountKey !== account.seller_account_key) {
      return fail(409, "ACCOUNT_UNVERIFIED", "eBay 연결 계정과 인증 정보가 일치하지 않습니다.");
    }
    if (query.view === "payment_disputes") {
      const page = await readEbayPaymentDisputesPage({
        payload,
        environment,
        offset: query.offset,
        limit: ebayCaseDisputePageSize,
      });
      return NextResponse.json({
        ...page,
        kind: "payment_disputes",
        credentialId: query.credentialId,
        environment,
      }, { headers });
    }
    const page = await readEbayResolutionCasesPage({
      payload,
      environment,
      offset: query.offset,
      limit: ebayCaseDisputePageSize,
      startTime: query.startTime!,
      endTime: query.endTime!,
      verifiedSellerIdentifiers: ebayVerifiedMessageAccountIdentifiers(payload),
    });
    return NextResponse.json({
      ...page,
      kind: "resolution_cases",
      credentialId: query.credentialId,
      environment,
    }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (/^EBAY_(?:ACCESS_TOKEN_MISSING|CASE_DISPUTE_READ_HTTP_(?:401|403))$/.test(code)) {
      return fail(409, "CASE_DISPUTE_AUTHORIZATION_REQUIRED", "eBay 케이스·분쟁 조회 권한을 확인해 주세요.");
    }
    if (code.startsWith("PROVIDER_ACCOUNT_IDENTITY_")) {
      return fail(409, "ACCOUNT_UNVERIFIED", "eBay 판매자 계정 인증 정보를 확인하지 못했습니다.");
    }
    return fail(502, "CASE_DISPUTE_READ_UNVERIFIED", "eBay 케이스·분쟁 응답을 확인하지 못했습니다. 0건으로 처리하지 않았습니다.");
  }
}
