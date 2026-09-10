import { createHash } from "node:crypto";
import {
  Qoo10CreateFulfillmentEvidenceError,
  qoo10OfficialGetEvidenceContract,
  type Qoo10OfficialGet,
  type Qoo10OfficialGetEvidence,
  type Qoo10OfficialGetRequest,
} from "./qoo10-listing-create-fulfillment-evidence";

export const qoo10OfficialGetOrigin = "https://api.qoo10.jp" as const;
export const qoo10OfficialGetPath =
  "/GMKT.INC.Front.QAPIService/ebayjapan.qapi" as const;
export const qoo10OfficialSellerAccountMethod =
  "ItemsLookup.GetItemDetailInfo" as const;
export const qoo10OfficialSellerDeliveryGroupMethod =
  "ItemsLookup.GetSellerDeliveryGroupInfo" as const;

export const qoo10OfficialFulfillmentSurfaceStatus = {
  seller_account_identity: {
    available: true,
    method: qoo10OfficialSellerAccountMethod,
    version: "1.2",
    documentedResponseFields: [
      "ItemCode", "ItemStatus", "ItemTitle", "SellerCode", "ShippingNo",
      "AvailableDateType", "AvailableDateValue", "ChangedDate",
    ],
  },
  dispatch_places: {
    available: false,
    reason: "QOO10_PUBLIC_QAPI_HAS_NO_SELLER_DISPATCH_PLACE_MASTER_GET",
    documentedClosestMethod: qoo10OfficialSellerDeliveryGroupMethod,
    closestMethodFields: [
      "ShippingNo", "ShippingFee", "ShippingType", "FreeCondition",
      "Region", "Oversea", "transcName",
    ],
  },
  return_policies: {
    available: false,
    reason: "QOO10_PUBLIC_QAPI_HAS_NO_SELLER_RETURN_POLICY_MASTER_GET",
  },
} as const;

type UnknownRecord = Record<string, unknown>;
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Qoo10OfficialHttpGetInput = {
  method: "GET";
  url: URL;
  headers: {
    accept: "application/json";
    "user-agent": "SellerPilot-Qoo10-Official-Read/1.0";
  };
};

export type Qoo10OfficialHttpGetResponse = {
  status: number;
  data: unknown;
  observedAt: string;
};

export type Qoo10OfficialHttpGet = (
  input: Qoo10OfficialHttpGetInput,
) => Promise<Qoo10OfficialHttpGetResponse>;

export class Qoo10OfficialGetAdapterError extends Error {
  constructor(readonly code:
    | "QOO10_OFFICIAL_GET_INPUT_INVALID"
    | "QOO10_OFFICIAL_GET_TRANSPORT_FAILED"
    | "QOO10_OFFICIAL_GET_RESPONSE_INVALID") {
    super(code);
    this.name = "Qoo10OfficialGetAdapterError";
  }
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function safeJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 12) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 1_000 && value.every((item) => safeJson(item, depth + 1));
  }
  const row = record(value);
  if (!row || Object.keys(row).length === 0 || Object.keys(row).length > 1_000) return false;
  return Object.entries(row).every(([key, item]) =>
    key.length > 0
    && key.length <= 200
    && !/(?:authorization|cookie|password|secret|token|api[_-]?key|certification[_-]?key)/iu.test(key)
    && safeJson(item, depth + 1));
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = record(value);
  if (row) {
    return `{${Object.entries(row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item as JsonValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: JsonValue) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function protocolDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function resultRows(value: unknown) {
  if (Array.isArray(value)) return value.map(record).filter(Boolean) as UnknownRecord[];
  const row = record(value);
  return row ? [row] : [];
}

function qapiGetUrl(input: {
  certificationKey: string;
  version: string;
  method: string;
  params?: Record<string, string>;
}) {
  const url = new URL(qoo10OfficialGetPath, qoo10OfficialGetOrigin);
  url.searchParams.set("key", input.certificationKey);
  url.searchParams.set("v", input.version);
  url.searchParams.set("returnType", "json");
  url.searchParams.set("method", input.method);
  for (const [name, value] of Object.entries(input.params ?? {})) {
    url.searchParams.set(name, value);
  }
  return url;
}

function requestInput(url: URL): Qoo10OfficialHttpGetInput {
  return {
    method: "GET",
    url,
    headers: {
      accept: "application/json",
      "user-agent": "SellerPilot-Qoo10-Official-Read/1.0",
    },
  };
}

function sellerAccountEvidence(input: {
  request: Qoo10OfficialGetRequest;
  response: Qoo10OfficialHttpGetResponse;
}): Qoo10OfficialGetEvidence {
  const data = record(input.response.data);
  const rows = resultRows(data?.ResultObject);
  const matches = rows.filter((row) =>
    [row.ItemCode, row.ItemNo].map(text).includes(input.request.testItemCode));
  const observedAt = isoTimestamp(input.response.observedAt);
  if (input.response.status !== 200 || text(data?.ResultCode) !== "0"
      || !observedAt || matches.length !== 1 || !safeJson(matches[0])) {
    throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_RESPONSE_INVALID");
  }
  const selected = matches[0] as JsonValue & UnknownRecord;
  const sellerCode = text(selected.SellerCode);
  if (!sellerCode) {
    throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_RESPONSE_INVALID");
  }
  const sellerIdDigest = protocolDigest({ sellerId: input.request.sellerId });
  const sellerAccountIdentityDigest = protocolDigest({
    sellerIdDigest,
    testItemCode: input.request.testItemCode,
    testItemSellerCode: sellerCode,
  });
  return {
    contract: qoo10OfficialGetEvidenceContract,
    method: "GET",
    resource: "seller_account_identity",
    sourceOrigin: qoo10OfficialGetOrigin,
    authenticated: true,
    authenticatedSellerId: input.request.sellerId,
    sellerAccountIdentityDigest,
    observedAt,
    revision: `sha256:${digest(selected)}`,
    status: input.response.status,
    resultCode: text(data?.ResultCode),
    records: [{
      id: input.request.testItemCode,
      active: true,
      sellerCode,
      payload: selected,
    }],
  };
}

function validAdapterInput(value: {
  sellerId: string;
  certificationKey: string;
  get: Qoo10OfficialHttpGet;
}) {
  return text(value.sellerId).length > 0
    && text(value.sellerId).length <= 160
    && text(value.certificationKey).length > 0
    && text(value.certificationKey).length <= 2_000
    && typeof value.get === "function";
}

export function createQoo10ListingCreateFulfillmentOfficialGet(input: {
  sellerId: string;
  certificationKey: string;
  get: Qoo10OfficialHttpGet;
}): Qoo10OfficialGet {
  if (!validAdapterInput(input)) {
    throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_INPUT_INVALID");
  }
  return async (request) => {
    if (request.method !== "GET" || request.sellerId !== input.sellerId) {
      throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_INPUT_INVALID");
    }
    if (request.resource === "dispatch_places") {
      throw new Qoo10CreateFulfillmentEvidenceError(
        "QOO10_CREATE_FULFILLMENT_DISPATCH_PLACE_GET_UNAVAILABLE",
      );
    }
    if (request.resource === "return_policies") {
      throw new Qoo10CreateFulfillmentEvidenceError(
        "QOO10_CREATE_FULFILLMENT_RETURN_POLICY_GET_UNAVAILABLE",
      );
    }
    if (request.sellerAccountIdentityDigest !== undefined
        || !/^\d{9,10}$/u.test(request.testItemCode)) {
      throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_INPUT_INVALID");
    }
    const url = qapiGetUrl({
      certificationKey: input.certificationKey,
      version: "1.2",
      method: qoo10OfficialSellerAccountMethod,
      params: { ItemCode: request.testItemCode, SellerCode: "" },
    });
    let response: Qoo10OfficialHttpGetResponse;
    try {
      response = await input.get(requestInput(url));
    } catch {
      throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_TRANSPORT_FAILED");
    }
    return sellerAccountEvidence({ request, response });
  };
}

export type Qoo10OfficialSellerDeliveryGroup = {
  shippingNo: string;
  shippingFee: string;
  shippingType: "X" | "F" | "M" | "W" | "D" | "R";
  freeCondition: string;
  region: "Y" | "N";
  oversea: "Y" | "N";
  deliveryCompany: string;
};

export type Qoo10OfficialSellerDeliveryGroupEvidence = {
  contract: "sellerpilot_qoo10_official_seller_delivery_groups_v1";
  method: "GET";
  sourceOrigin: typeof qoo10OfficialGetOrigin;
  authenticatedSellerId: string;
  observedAt: string;
  revision: string;
  groups: Qoo10OfficialSellerDeliveryGroup[];
};

function decimal(value: unknown) {
  const normalized = text(value);
  const parsed = Number(normalized);
  return normalized && Number.isFinite(parsed) && parsed >= 0 ? normalized : "";
}

function isoTimestamp(value: unknown) {
  const normalized = text(value);
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === normalized
    ? normalized
    : "";
}

export async function getQoo10OfficialSellerDeliveryGroups(input: {
  sellerId: string;
  certificationKey: string;
  get: Qoo10OfficialHttpGet;
}): Promise<Qoo10OfficialSellerDeliveryGroupEvidence> {
  if (!validAdapterInput(input)) {
    throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_INPUT_INVALID");
  }
  const url = qapiGetUrl({
    certificationKey: input.certificationKey,
    version: "1.0",
    method: qoo10OfficialSellerDeliveryGroupMethod,
  });
  let response: Qoo10OfficialHttpGetResponse;
  try {
    response = await input.get(requestInput(url));
  } catch {
    throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_TRANSPORT_FAILED");
  }
  const data = record(response.data);
  const rows = resultRows(data?.ResultObject);
  const observedAt = isoTimestamp(response.observedAt);
  if (response.status !== 200 || text(data?.ResultCode) !== "0"
      || !observedAt || rows.length === 0) {
    throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_RESPONSE_INVALID");
  }
  const groups = rows.map((row) => {
    const shippingNo = text(row.ShippingNo);
    const shippingFee = decimal(row.ShippingFee);
    const shippingType = text(row.ShippingType);
    const freeCondition = decimal(row.FreeCondition);
    const region = text(row.Region);
    const oversea = text(row.Oversea);
    const deliveryCompany = text(row.transcName);
    if (!/^\d+$/u.test(shippingNo) || !shippingFee
        || !/^[XFMWDR]$/u.test(shippingType) || !freeCondition
        || !/^[YN]$/u.test(region) || !/^[YN]$/u.test(oversea)) {
      throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_RESPONSE_INVALID");
    }
    return {
      shippingNo,
      shippingFee,
      shippingType: shippingType as Qoo10OfficialSellerDeliveryGroup["shippingType"],
      freeCondition,
      region: region as "Y" | "N",
      oversea: oversea as "Y" | "N",
      deliveryCompany,
    };
  });
  if (new Set(groups.map((group) => group.shippingNo)).size !== groups.length) {
    throw new Qoo10OfficialGetAdapterError("QOO10_OFFICIAL_GET_RESPONSE_INVALID");
  }
  const ordered = groups.toSorted((left, right) =>
    left.shippingNo.localeCompare(right.shippingNo, "en", { numeric: true }));
  return {
    contract: "sellerpilot_qoo10_official_seller_delivery_groups_v1",
    method: "GET",
    sourceOrigin: qoo10OfficialGetOrigin,
    authenticatedSellerId: input.sellerId,
    observedAt,
    revision: `sha256:${digest(ordered as unknown as JsonValue)}`,
    groups: ordered,
  };
}
