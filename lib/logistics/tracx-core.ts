export type TracxSecretPayload = Record<string, unknown>;

export const tracxOperationNames = [
  "orders.list",
  "orders.get",
  "orders.cancel",
  "tracking.get",
  "shipping.get",
  "inquiries.list",
  "inquiries.get",
  "inquiries.reply",
] as const;

export type TracxOperationName = typeof tracxOperationNames[number];

export const tracxWriteOperations = new Set<TracxOperationName>([
  "orders.cancel",
  "inquiries.reply",
]);

type TracxMethod = {
  service: "SmartShipService" | "SmartShipInquiryService";
  method: string;
};

const methods: Record<TracxOperationName, TracxMethod> = {
  "orders.list": { service: "SmartShipService", method: "GetOrderList" },
  "orders.get": { service: "SmartShipService", method: "GetOrder" },
  "orders.cancel": { service: "SmartShipService", method: "CancelOrder" },
  "tracking.get": { service: "SmartShipService", method: "Tracking" },
  "shipping.get": { service: "SmartShipService", method: "GetShippingInfo" },
  "inquiries.list": { service: "SmartShipInquiryService", method: "GetIssueList" },
  "inquiries.get": { service: "SmartShipInquiryService", method: "GetIssueDetail" },
  "inquiries.reply": { service: "SmartShipInquiryService", method: "ReplyIssue" },
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function text(payload: TracxSecretPayload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(value: unknown, key: string, max = 160) {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!normalized || normalized.length > max) throw new Error(`TRACX_ARGUMENT_INVALID:${key}`);
  return normalized;
}

function optionalText(value: unknown, key: string, max = 160) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, key, max);
}

function requiredDate(value: unknown, key: string) {
  const normalized = requiredText(value, key, 10);
  if (!datePattern.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new Error(`TRACX_ARGUMENT_INVALID:${key}`);
  }
  return normalized;
}

function dateRange(argumentsValue: Record<string, unknown>, startKey: string, endKey: string) {
  const start = requiredDate(argumentsValue[startKey], startKey);
  const end = requiredDate(argumentsValue[endKey], endKey);
  const startTime = new Date(`${start}T00:00:00Z`).getTime();
  const endTime = new Date(`${end}T23:59:59Z`).getTime();
  if (startTime > endTime || endTime - startTime > 31 * 86_400_000) {
    throw new Error("TRACX_ARGUMENT_INVALID:dateRange");
  }
  return { start, end };
}

export function tracxOperationArguments(operation: TracxOperationName, input: Record<string, unknown>) {
  if (JSON.stringify(input).length > 32_000) throw new Error("TRACX_ARGUMENT_INVALID:payload");
  if (operation === "orders.list") {
    const { start, end } = dateRange(input, "startDate", "endDate");
    const shopNo = input.shopNo === undefined || input.shopNo === null || input.shopNo === ""
      ? undefined
      : Number(input.shopNo);
    if (shopNo !== undefined && (!Number.isSafeInteger(shopNo) || shopNo < 0)) {
      throw new Error("TRACX_ARGUMENT_INVALID:shopNo");
    }
    return {
      startDate: start,
      endDate: end,
      ...(optionalText(input.periodType, "periodType", 30) ? { periodType: optionalText(input.periodType, "periodType", 30) } : {}),
      ...(shopNo !== undefined ? { shopNo } : {}),
      ...(optionalText(input.status, "status", 30) ? { status: optionalText(input.status, "status", 30) } : {}),
    };
  }
  if (operation === "orders.get" || operation === "orders.cancel") {
    return { shippingNo: requiredText(input.shippingNo, "shippingNo", 100) };
  }
  if (operation === "tracking.get") {
    return { trackingNo: requiredText(input.trackingNo, "trackingNo", 100) };
  }
  if (operation === "shipping.get") {
    return { tracking_no: requiredText(input.trackingNo ?? input.tracking_no, "trackingNo", 100) };
  }
  if (operation === "inquiries.list") {
    const { start, end } = dateRange(input, "start_dt", "end_dt");
    const status = optionalText(input.status, "status", 10)?.toUpperCase();
    if (status && !["NEW", "ING", "END"].includes(status)) throw new Error("TRACX_ARGUMENT_INVALID:status");
    return {
      start_dt: start,
      end_dt: end,
      ...(status ? { status } : {}),
      ...(optionalText(input.seller_inquiry_type, "seller_inquiry_type", 80) ? { seller_inquiry_type: optionalText(input.seller_inquiry_type, "seller_inquiry_type", 80) } : {}),
      ...(optionalText(input.seller_inquiry_subtype, "seller_inquiry_subtype", 80) ? { seller_inquiry_subtype: optionalText(input.seller_inquiry_subtype, "seller_inquiry_subtype", 80) } : {}),
      ...(optionalText(input.sch_kind, "sch_kind", 40) ? { sch_kind: optionalText(input.sch_kind, "sch_kind", 40) } : {}),
      ...(optionalText(input.sch_value, "sch_value", 160) ? { sch_value: optionalText(input.sch_value, "sch_value", 160) } : {}),
    };
  }
  if (operation === "inquiries.get") {
    return { ticket_id: requiredText(input.ticketId ?? input.ticket_id, "ticketId", 100) };
  }
  return {
    ticket_id: requiredText(input.ticketId ?? input.ticket_id, "ticketId", 100),
    ticket_prcs_cn: requiredText(input.content ?? input.ticket_prcs_cn, "content", 4_000),
    attach_file_list: optionalText(input.attachFileList ?? input.attach_file_list, "attachFileList", 2_000) ?? "",
  };
}

export type TracxRemoteResponse = {
  response: Response;
  data: Record<string, unknown>;
};

export async function tracxRequest(input: {
  payload: TracxSecretPayload;
  operation: TracxOperationName;
  arguments: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<TracxRemoteResponse> {
  const apiKey = text(input.payload, "api_key");
  if (!apiKey || apiKey.length > 512) throw new Error("TRACX_CREDENTIALS_MISSING");
  const method = methods[input.operation];
  const url = new URL(`https://api.tracxlogis.com/GMKT.INC.GLPS.OpenApiService/${method.service}.qapi/${method.method}`);
  url.searchParams.set("returnType", "json");
  url.searchParams.set("key", apiKey);
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    body: JSON.stringify(tracxOperationArguments(input.operation, input.arguments)),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "user-agent": "SellerPilot-TracX-TxAPI-Connector/1.0",
    },
  });
  const data = await response.json().catch(() => null) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("TRACX_RESPONSE_INVALID");
  return { response, data: data as Record<string, unknown> };
}

export function tracxResultCode(data: Record<string, unknown>) {
  const value = data.ResultCode ?? data.resultCode;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function tracxResultMessage(data: Record<string, unknown>) {
  const value = data.ResultMsg ?? data.resultMessage;
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

export function tracxSucceeded(remote: TracxRemoteResponse) {
  return remote.response.ok && tracxResultCode(remote.data) === 0;
}

export function tracxNoData(remote: TracxRemoteResponse) {
  const resultObject = remote.data.ResultObject ?? remote.data.resultObject;
  return remote.response.ok
    && tracxResultCode(remote.data) === 1
    && tracxResultMessage(remote.data).toLowerCase() === "not found"
    && Array.isArray(resultObject)
    && resultObject.length === 0;
}

export function tracxOperationSucceeded(remote: TracxRemoteResponse, operation: TracxOperationName) {
  if (tracxSucceeded(remote)) return true;
  return (operation === "orders.list" || operation === "inquiries.list") && tracxNoData(remote);
}

export async function runTracxDiagnostic(payload: TracxSecretPayload, now = new Date()) {
  const endDate = now.toISOString().slice(0, 10);
  const startDate = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const remote = await tracxRequest({ payload, operation: "orders.list", arguments: { startDate, endDate } });
  if (tracxOperationSucceeded(remote, "orders.list")) {
    return {
      status: "passed" as const,
      message: tracxNoData(remote)
        ? "SmartShip TxAPI 인증과 주문 목록 읽기가 정상입니다 · 현재 조회 주문 0건"
        : "SmartShip TxAPI 주문 목록 읽기가 정상 응답했습니다.",
    };
  }
  const code = tracxResultCode(remote.data);
  return {
    status: "failed" as const,
    message: `SmartShip TxAPI 연결 검사 실패${code === null ? ` · HTTP ${remote.response.status}` : ` · 결과코드 ${code}`}`,
  };
}
