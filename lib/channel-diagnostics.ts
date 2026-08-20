import {
  coupangRequest,
  elevenstRequest,
  ebayRequest,
  fetchNaverAccessToken,
  lazadaRequest,
  naverRequest,
  qoo10Request,
  shopeeRequest,
  temuRequest,
  textValue,
  type SecretPayload,
} from "./channels/protocols";
import { isActiveChannelKey } from "./channels/catalog";

export type ChannelDiagnostic = {
  status: "passed" | "failed" | "manual";
  message: string;
  remoteRequestId?: string;
};

function remoteRequestId(data: Record<string, unknown>) {
  for (const key of ["request_id", "requestId", "traceId", "rCode"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  }
  return undefined;
}

async function testLazada(payload: SecretPayload): Promise<ChannelDiagnostic> {
  const remote = await lazadaRequest({ payload, path: "/seller/get" });
  const code = String(remote.data.code ?? "");
  const country = (textValue(payload, "country") || "my").toUpperCase();
  if (remote.response.ok && (!code || code === "0")) {
    return { status: "passed", message: `Lazada ${country} 판매자 읽기 API가 정상 응답했습니다.`, remoteRequestId: remoteRequestId(remote.data) };
  }
  return { status: "failed", message: `Lazada 인증 검사 실패${code ? ` · ${code}` : ` · HTTP ${remote.response.status}`}`, remoteRequestId: remoteRequestId(remote.data) };
}

async function testShopee(payload: SecretPayload, environment: "sandbox" | "production"): Promise<ChannelDiagnostic> {
  if (!textValue(payload, "partner_id") || !textValue(payload, "partner_key") || !textValue(payload, "shop_id") || !textValue(payload, "access_token")) {
    return { status: "failed", message: "Partner ID·Partner Key·Shop ID·Access Token이 모두 필요합니다." };
  }
  const remote = await shopeeRequest({
    payload,
    environment,
    method: "GET",
    path: "/api/v2/shop/get_shop_info",
  });
  const errorCode = textValue(remote.data, "error");
  if (remote.response.ok && !errorCode) {
    return { status: "passed", message: "Shopee 판매점 정보 읽기 API가 정상 응답했습니다.", remoteRequestId: remoteRequestId(remote.data) };
  }
  return { status: "failed", message: `Shopee 인증 검사 실패${errorCode ? ` · ${errorCode}` : ` · HTTP ${remote.response.status}`}`, remoteRequestId: remoteRequestId(remote.data) };
}

async function testQoo10(payload: SecretPayload): Promise<ChannelDiagnostic> {
  const testItemCode = textValue(payload, "test_item_code");
  if (!textValue(payload, "api_key") || !textValue(payload, "seller_id") || !testItemCode) {
    return { status: "failed", message: "Seller Authorization Key·Seller ID·검사 상품번호가 모두 필요합니다." };
  }
  const remote = await qoo10Request({
    payload,
    service: "ItemsLookup",
    method: "GetItemDetailInfo",
    version: "1.2",
    params: { ItemCode: testItemCode, SellerCode: "" },
  });
  const resultCode = String(remote.data.ResultCode ?? remote.data.ErrorCode ?? "");
  const resultObject = remote.data.ResultObject;
  if (remote.response.ok && (resultCode === "0" || resultCode === "") && resultObject) {
    return { status: "passed", message: `Qoo10 QAPI 상품 읽기가 정상 응답했습니다 · 상품 ${testItemCode.slice(-6)}` };
  }
  const errorMessage = typeof remote.data.ErrorMsg === "string" ? remote.data.ErrorMsg.slice(0, 100) : "";
  return { status: "failed", message: `Qoo10 QAPI 인증 검사 실패 · ${resultCode ? `결과코드 ${resultCode}` : `HTTP ${remote.response.status}`}${errorMessage ? ` · ${errorMessage}` : ""}` };
}

async function testCoupang(payload: SecretPayload): Promise<ChannelDiagnostic> {
  const vendorId = textValue(payload, "vendor_id");
  if (!vendorId || !textValue(payload, "access_key") || !textValue(payload, "secret_key")) {
    return { status: "failed", message: "Vendor ID·Access Key·Secret Key가 모두 필요합니다." };
  }
  const query = new URLSearchParams({ vendorId, maxPerPage: "1" });
  const remote = await coupangRequest({
    payload,
    method: "GET",
    path: "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products",
    query,
  });
  const code = String(remote.data.code ?? "");
  if (remote.response.ok && !["ERROR", "FAIL"].includes(code.toUpperCase())) {
    return { status: "passed", message: "쿠팡 서명 인증과 등록상품 목록 읽기가 정상 응답했습니다.", remoteRequestId: remoteRequestId(remote.data) };
  }
  return { status: "failed", message: `쿠팡 HMAC 연결 검사 실패${code ? ` · ${code}` : ` · HTTP ${remote.response.status}`}`, remoteRequestId: remoteRequestId(remote.data) };
}

async function testElevenst(payload: SecretPayload): Promise<ChannelDiagnostic> {
  const apiKey = textValue(payload, "api_key");
  if (!/^[A-Za-z0-9]{32}$/.test(apiKey)) {
    return { status: "failed", message: "11번가에서 발급한 32자리 OPEN API Key가 필요합니다." };
  }
  const remote = await elevenstRequest({
    payload,
    apiCode: "ProductSearch",
    params: { keyword: "생활용품", pageNum: "1", pageSize: "1" },
  });
  if (remote.response.ok && remote.data.accepted === true) {
    return { status: "passed", message: "11번가 OPEN API Key와 등록 IP에서 상품 검색 읽기가 정상 응답했습니다." };
  }
  const errorCode = textValue(remote.data, "errorCode");
  return { status: "failed", message: `11번가 OPEN API 연결 검사 실패${errorCode ? ` · ${errorCode}` : ` · HTTP ${remote.response.status}`}` };
}

async function testSmartstore(payload: SecretPayload): Promise<ChannelDiagnostic> {
  const tokenType = (textValue(payload, "token_type") || "SELF").toUpperCase();
  if (!["SELF", "SELLER"].includes(tokenType) || (tokenType === "SELLER" && !textValue(payload, "account_id"))) {
    return { status: "failed", message: "내 스토어 앱은 SELF, 솔루션 판매자 연동은 SELLER + account_id가 필요합니다." };
  }
  const token = await fetchNaverAccessToken(payload);
  const remote = await naverRequest({ accessToken: token.accessToken, method: "GET", path: "/v1/seller/account" });
  if (remote.response.ok) {
    return { status: "passed", message: `네이버 Commerce API 판매자 계정 읽기가 정상 응답했습니다 · 토큰 ${Math.round(token.expiresIn / 60)}분`, remoteRequestId: remoteRequestId(remote.data) };
  }
  return { status: "failed", message: `네이버 판매자 계정 검사 실패 · HTTP ${remote.response.status}`, remoteRequestId: remoteRequestId(remote.data) };
}

async function testEbay(payload: SecretPayload, environment: "sandbox" | "production"): Promise<ChannelDiagnostic> {
  if (!textValue(payload, "access_token") || !textValue(payload, "refresh_token")) {
    return { status: "failed", message: "eBay 판매자 OAuth 승인을 먼저 완료해 주세요." };
  }
  const remote = await ebayRequest({ payload, environment, method: "GET", path: "/sell/account/v1/privilege/" });
  if (remote.response.ok && remote.data.sellerRegistrationCompleted === true) {
    return { status: "passed", message: "eBay Seller 계정 권한과 판매한도 읽기가 정상 응답했습니다.", remoteRequestId: remoteRequestId(remote.data) };
  }
  return { status: "failed", message: `eBay 판매자 권한 검사 실패 · HTTP ${remote.response.status}`, remoteRequestId: remoteRequestId(remote.data) };
}

async function testTemu(payload: SecretPayload): Promise<ChannelDiagnostic> {
  if (!textValue(payload, "app_key") || !textValue(payload, "app_secret") || !textValue(payload, "access_token")) {
    return { status: "failed", message: "Temu App Key·App Secret·판매자 Access Token이 모두 필요합니다." };
  }
  const remote = await temuRequest({ payload, type: "temu.local.goods.list.retrieve", arguments: { pageSize: 1, goodsSearchType: "ALL" } });
  if (remote.response.ok && remote.data.success === true) {
    return { status: "passed", message: "Temu 판매자 상품 목록 읽기 API가 정상 응답했습니다.", remoteRequestId: remoteRequestId(remote.data) };
  }
  const errorCode = String(remote.data.errorCode ?? "");
  return { status: "failed", message: `Temu 인증 검사 실패${errorCode ? ` · ${errorCode}` : ` · HTTP ${remote.response.status}`}`, remoteRequestId: remoteRequestId(remote.data) };
}

export async function runChannelDiagnostic(
  channel: string,
  payload: SecretPayload,
  environment: "sandbox" | "production" = "production",
): Promise<ChannelDiagnostic> {
  try {
    if (!isActiveChannelKey(channel)) return { status: "failed", message: "지원하지 않는 채널입니다." };
    if (channel === "shopee") return await testShopee(payload, environment);
    if (channel === "lazada") return await testLazada(payload);
    if (channel === "qoo10") return await testQoo10(payload);
    if (channel === "coupang") return await testCoupang(payload);
    if (channel === "elevenst") return await testElevenst(payload);
    if (channel === "smartstore") return await testSmartstore(payload);
    if (channel === "ebay") return await testEbay(payload, environment);
    if (channel === "temu") return await testTemu(payload);
    return { status: "failed", message: "지원하지 않는 채널입니다." };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const missing = error instanceof Error && /(?:CREDENTIALS_MISSING|TOKEN_EXCHANGE_FAILED|ACCESS_TOKEN_MISSING)/.test(error.message);
    return {
      status: "failed",
      message: timeout
        ? "채널 응답 제한시간(15초)을 초과했습니다."
        : missing
          ? "필수 인증값 또는 OAuth 토큰이 누락되었거나 만료됐습니다."
          : "채널 연결 중 안전하게 처리된 오류가 발생했습니다.",
    };
  }
}
