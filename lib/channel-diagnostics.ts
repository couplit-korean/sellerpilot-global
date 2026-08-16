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

async function testQoo10(payload: SecretPayload): Promise<ChannelDiagnostic> {
  const apiKey = textValue(payload, "api_key");
  const sellerId = textValue(payload, "seller_id");
  const testItemCode = textValue(payload, "test_item_code");
  if (!apiKey || !sellerId || !testItemCode) return { status: "failed", message: "Certification Key·Seller ID·승인된 테스트 상품번호가 모두 필요합니다." };
  if (!/^\d{6,14}$/.test(testItemCode)) return { status: "failed", message: "Qoo10 테스트 상품번호 형식을 확인해 주세요." };

  const url = new URL("https://api.qoo10.jp/GMKT.INC.Front.OpenApiService/GoodsBasicService.api/GetItemDetailInfo");
  url.search = new URLSearchParams({ key: apiKey, ItemCode: testItemCode, SellerCode: "" }).toString();
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/xml,text/xml", "user-agent": "SellerPilot-Connection-Diagnostic/1.0" },
  });
  const xml = (await response.text()).slice(0, 250_000);
  const resultCode = xml.match(/<ResultCode>([^<]*)<\/ResultCode>/i)?.[1]?.trim() ?? "";
  const itemNumber = xml.match(/<(?:ItemNo|ItemCode)>([^<]*)<\/(?:ItemNo|ItemCode)>/i)?.[1]?.trim() ?? "";
  if (response.ok && resultCode === "0" && itemNumber) {
    return { status: "passed", message: `Qoo10 상품 상세 읽기 API가 정상 응답했습니다 · 상품 ${itemNumber.slice(-6)}` };
  }
  return { status: "failed", message: `Qoo10 인증 검사 실패 · ${resultCode ? `결과코드 ${resultCode}` : `HTTP ${response.status}`}` };
}

export async function runChannelDiagnostic(channel: string, payload: SecretPayload): Promise<ChannelDiagnostic> {
  try {
    if (channel === "lazada") return await testLazada(payload);
    if (channel === "qoo10") return await testQoo10(payload);
    return { status: "failed", message: "지원하지 않는 채널입니다." };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { status: "failed", message: timeout ? "채널 응답 제한시간(12초)을 초과했습니다." : "채널 연결 중 안전하게 처리된 오류가 발생했습니다." };
  }
}
