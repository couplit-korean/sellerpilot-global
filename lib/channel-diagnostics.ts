import { createHmac } from "node:crypto";

export type ChannelDiagnostic = {
  status: "passed" | "failed" | "manual";
  message: string;
  remoteRequestId?: string;
};

type SecretPayload = Record<string, unknown>;

function textValue(payload: SecretPayload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

async function fetchJson(url: URL, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json", "user-agent": "SellerPilot-Connection-Diagnostic/1.0", ...headers },
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { response, data };
}

async function testShopee(payload: SecretPayload): Promise<ChannelDiagnostic> {
  const partnerId = textValue(payload, "partner_id");
  const partnerKey = textValue(payload, "partner_key");
  const shopId = textValue(payload, "shop_id");
  const accessToken = textValue(payload, "access_token");
  if (!partnerId || !partnerKey || !shopId || !accessToken) {
    return { status: "failed", message: "Partner ID·Partner Key·Shop ID·Access Token이 모두 필요합니다." };
  }

  const path = "/api/v2/shop/get_shop_info";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  const sign = createHmac("sha256", partnerKey).update(baseString).digest("hex");
  const url = new URL(`https://partner.shopeemobile.com${path}`);
  url.search = new URLSearchParams({ partner_id: partnerId, timestamp, access_token: accessToken, shop_id: shopId, sign }).toString();
  const { response, data } = await fetchJson(url);
  const errorCode = typeof data.error === "string" ? data.error : "";
  const requestId = typeof data.request_id === "string" ? data.request_id : undefined;
  if (response.ok && !errorCode) return { status: "passed", message: "Shopee 판매점 정보 읽기 API가 정상 응답했습니다.", remoteRequestId: requestId };
  return { status: "failed", message: `Shopee 인증 검사 실패${errorCode ? ` · ${errorCode}` : ""}`, remoteRequestId: requestId };
}

const lazadaEndpoints: Record<string, string> = {
  my: "https://api.lazada.com.my/rest",
  sg: "https://api.lazada.sg/rest",
  ph: "https://api.lazada.com.ph/rest",
  th: "https://api.lazada.co.th/rest",
  vn: "https://api.lazada.vn/rest",
  id: "https://api.lazada.co.id/rest",
};

async function testLazada(payload: SecretPayload): Promise<ChannelDiagnostic> {
  const appKey = textValue(payload, "app_key");
  const appSecret = textValue(payload, "app_secret");
  const accessToken = textValue(payload, "access_token");
  const country = textValue(payload, "country").toLowerCase() || "my";
  if (!appKey || !appSecret || !accessToken) {
    return { status: "failed", message: "App Key·App Secret·Access Token이 모두 필요합니다." };
  }
  if (!lazadaEndpoints[country]) return { status: "failed", message: "지원 국가 코드는 MY·SG·PH·TH·VN·ID 중 하나여야 합니다." };

  const path = "/seller/get";
  const params: Record<string, string> = {
    access_token: accessToken,
    app_key: appKey,
    sign_method: "sha256",
    timestamp: Date.now().toString(),
  };
  const signingInput = path + Object.keys(params).sort().map((key) => `${key}${params[key]}`).join("");
  params.sign = createHmac("sha256", appSecret).update(signingInput).digest("hex").toUpperCase();
  const url = new URL(`${lazadaEndpoints[country]}${path}`);
  url.search = new URLSearchParams(params).toString();
  const { response, data } = await fetchJson(url);
  const code = typeof data.code === "string" ? data.code : String(data.code ?? "");
  const requestId = typeof data.request_id === "string" ? data.request_id : undefined;
  if (response.ok && (code === "0" || !code)) return { status: "passed", message: `Lazada ${country.toUpperCase()} 판매자 읽기 API가 정상 응답했습니다.`, remoteRequestId: requestId };
  return { status: "failed", message: `Lazada 인증 검사 실패${code ? ` · ${code}` : ""}`, remoteRequestId: requestId };
}

function testQoo10(payload: SecretPayload): ChannelDiagnostic {
  const apiKey = textValue(payload, "api_key");
  const sellerId = textValue(payload, "seller_id");
  if (!apiKey || !sellerId) return { status: "failed", message: "Certification Key와 Seller ID가 모두 필요합니다." };
  return { status: "manual", message: "QAPI 자격 형식은 확인됐습니다. 승인된 테스트 상품번호 입력 후 읽기 API 검사를 실행해야 합니다." };
}

export async function runChannelDiagnostic(channel: string, payload: SecretPayload): Promise<ChannelDiagnostic> {
  try {
    if (channel === "shopee") return await testShopee(payload);
    if (channel === "lazada") return await testLazada(payload);
    if (channel === "qoo10") return testQoo10(payload);
    return { status: "failed", message: "지원하지 않는 채널입니다." };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { status: "failed", message: timeout ? "채널 응답 제한시간(12초)을 초과했습니다." : "채널 연결 중 안전하게 처리된 오류가 발생했습니다." };
  }
}
