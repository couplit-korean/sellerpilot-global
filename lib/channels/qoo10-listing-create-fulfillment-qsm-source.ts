import { createHash } from "node:crypto";
import {
  buildQoo10ListingCreateFulfillmentEvidence,
  qoo10OfficialGetEvidenceContract,
  type Qoo10ListingCreateFulfillmentEvidence,
  type Qoo10OfficialGet,
  type Qoo10OfficialGetEvidence,
} from "./qoo10-listing-create-fulfillment-evidence";

export const qoo10QsmCreateFulfillmentCaptureContract =
  "sellerpilot_qoo10_qsm_create_fulfillment_capture_v1" as const;
export const qoo10QsmCreateFulfillmentCollector =
  "sellerpilot_qsm_changhee_create_fulfillment_readonly_v1" as const;
export const qoo10QsmCreateFulfillmentTrustBoundary =
  "server_injected_changhee_browser_capture" as const;
export const qoo10QsmCreateFulfillmentOrigin = "https://qsm.qoo10.jp" as const;
export const qoo10QsmCreateFulfillmentMaximumAgeMs = 5 * 60 * 1_000;

const maximumFutureSkewMs = 5_000;
type UnknownRecord = Record<string, unknown>;
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Qoo10QsmCreateFulfillmentRecord = {
  id: string;
  active: boolean;
  payload: { [key: string]: JsonValue };
};

export type Qoo10QsmCreateFulfillmentCaptureDraft = {
  contract: typeof qoo10QsmCreateFulfillmentCaptureContract;
  collector: typeof qoo10QsmCreateFulfillmentCollector;
  trustBoundary: typeof qoo10QsmCreateFulfillmentTrustBoundary;
  browser: {
    name: "Chrome";
    family: "chrome";
    type: "extension";
    profileName: "CHANGHEE";
  };
  sourceOrigin: typeof qoo10QsmCreateFulfillmentOrigin;
  authenticatedSellerId: string;
  testItemCode: string;
  testItemSellerCode: string;
  observedAt: string;
  dispatchPlaces: Qoo10QsmCreateFulfillmentRecord[];
  returnPolicies: Qoo10QsmCreateFulfillmentRecord[];
};

export type Qoo10QsmCreateFulfillmentCapture =
  Qoo10QsmCreateFulfillmentCaptureDraft & {
    sourceRevision: string;
    captureDigest: string;
  };

export type Qoo10QsmCreateFulfillmentReadRequest = {
  method: "BROWSER_READ";
  readOnly: true;
  browser: {
    name: "Chrome";
    family: "chrome";
    type: "extension";
    profileName: "CHANGHEE";
  };
  sourceOrigin: typeof qoo10QsmCreateFulfillmentOrigin;
  sellerId: string;
  testItemCode: string;
  dispatchPlaceId: string;
  returnPolicyId: string;
};

export type Qoo10ServerQsmCreateFulfillmentCaptureReader = (
  request: Qoo10QsmCreateFulfillmentReadRequest,
) => Promise<unknown>;

export class Qoo10QsmCreateFulfillmentSourceError extends Error {
  constructor(readonly code:
    | "QOO10_QSM_CREATE_FULFILLMENT_INPUT_INVALID"
    | "QOO10_QSM_CREATE_FULFILLMENT_SOURCE_FAILED"
    | "QOO10_QSM_CREATE_FULFILLMENT_SOURCE_INVALID"
    | "QOO10_QSM_CREATE_FULFILLMENT_SECRET_FORBIDDEN"
    | "QOO10_QSM_CREATE_FULFILLMENT_PROFILE_INVALID"
    | "QOO10_QSM_CREATE_FULFILLMENT_ACCOUNT_MISMATCH"
    | "QOO10_QSM_CREATE_FULFILLMENT_SELECTION_INVALID"
    | "QOO10_QSM_CREATE_FULFILLMENT_FRESHNESS_INVALID"
    | "QOO10_QSM_CREATE_FULFILLMENT_TAMPERED"
    | "QOO10_QSM_CREATE_FULFILLMENT_REQUEST_ORDER_INVALID") {
    super(code);
    this.name = "Qoo10QsmCreateFulfillmentSourceError";
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

function exactKeys(value: UnknownRecord, keys: readonly string[]) {
  return Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
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

function isoTime(value: unknown) {
  const normalized = text(value);
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === normalized
    ? milliseconds
    : null;
}

const draftKeys = [
  "contract", "collector", "trustBoundary", "browser", "sourceOrigin",
  "authenticatedSellerId", "testItemCode", "testItemSellerCode", "observedAt",
  "dispatchPlaces", "returnPolicies",
] as const;
const captureKeys = [...draftKeys, "sourceRevision", "captureDigest"] as const;
const browserKeys = ["name", "family", "type", "profileName"] as const;
const recordKeys = ["id", "active", "payload"] as const;
const dispatchPayloadKeys = ["label", "countryCode", "postalCode", "addressLine1"] as const;
const returnPayloadKeys = ["label", "returnWindowDays", "returnShippingPaidBy"] as const;

function parseRecords(value: unknown, resource: "dispatch_places" | "return_policies") {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_000) return null;
  const parsed = value.map((item) => {
    const row = record(item);
    const payload = record(row?.payload);
    const id = text(row?.id);
    const exactPayload = payload && (resource === "dispatch_places"
      ? exactKeys(payload, dispatchPayloadKeys)
        && Boolean(text(payload.label))
        && /^[A-Z]{2}$/u.test(text(payload.countryCode))
        && Boolean(text(payload.postalCode))
        && Boolean(text(payload.addressLine1))
      : exactKeys(payload, returnPayloadKeys)
        && Boolean(text(payload.label))
        && Number.isSafeInteger(payload.returnWindowDays)
        && Number(payload.returnWindowDays) > 0
        && Number(payload.returnWindowDays) <= 365
        && ["buyer", "seller"].includes(text(payload.returnShippingPaidBy)));
    if (!row || !exactKeys(row, recordKeys) || !id || id.length > 200
        || typeof row.active !== "boolean" || !payload || !safeJson(payload)
        || !exactPayload) return null;
    return { id, active: row.active, payload };
  });
  if (parsed.some((item) => item === null)) return null;
  const records = parsed as Qoo10QsmCreateFulfillmentRecord[];
  return new Set(records.map((item) => item.id)).size === records.length
    ? records.sort((left, right) => left.id.localeCompare(right.id))
    : null;
}

function validDraft(value: unknown): value is Qoo10QsmCreateFulfillmentCaptureDraft {
  const row = record(value);
  const browser = record(row?.browser);
  return Boolean(row && browser
    && exactKeys(row, draftKeys)
    && exactKeys(browser, browserKeys)
    && row.contract === qoo10QsmCreateFulfillmentCaptureContract
    && row.collector === qoo10QsmCreateFulfillmentCollector
    && row.trustBoundary === qoo10QsmCreateFulfillmentTrustBoundary
    && browser.name === "Chrome"
    && browser.family === "chrome"
    && browser.type === "extension"
    && browser.profileName === "CHANGHEE"
    && row.sourceOrigin === qoo10QsmCreateFulfillmentOrigin
    && text(row.authenticatedSellerId)
    && /^\d{9,10}$/u.test(text(row.testItemCode))
    && text(row.testItemSellerCode)
    && isoTime(row.observedAt) !== null
    && parseRecords(row.dispatchPlaces, "dispatch_places")
    && parseRecords(row.returnPolicies, "return_policies"));
}

export function sealQoo10QsmCreateFulfillmentCapture(
  input: Qoo10QsmCreateFulfillmentCaptureDraft,
): Qoo10QsmCreateFulfillmentCapture {
  if (!safeJson(input)) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_SECRET_FORBIDDEN",
    );
  }
  if (!validDraft(input)) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_SOURCE_INVALID",
    );
  }
  const cloned = {
    ...structuredClone(input),
    dispatchPlaces: parseRecords(input.dispatchPlaces, "dispatch_places")!,
    returnPolicies: parseRecords(input.returnPolicies, "return_policies")!,
  };
  const sourceRevision = `sha256:${digest(cloned as unknown as JsonValue)}`;
  return {
    ...cloned,
    sourceRevision,
    captureDigest: digest({ ...cloned, sourceRevision } as unknown as JsonValue),
  };
}

function expectedInput(input: {
  sellerId: unknown;
  testItemCode: unknown;
  dispatchPlaceId: unknown;
  returnPolicyId: unknown;
  readCapture: unknown;
}) {
  const sellerId = text(input.sellerId);
  const testItemCode = text(input.testItemCode);
  const dispatchPlaceId = text(input.dispatchPlaceId);
  const returnPolicyId = text(input.returnPolicyId);
  if (!sellerId || sellerId.length > 160 || !/^\d{9,10}$/u.test(testItemCode)
      || !dispatchPlaceId || dispatchPlaceId.length > 200
      || !returnPolicyId || returnPolicyId.length > 200
      || typeof input.readCapture !== "function") {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_INPUT_INVALID",
    );
  }
  return { sellerId, testItemCode, dispatchPlaceId, returnPolicyId };
}

function captureReadRequest(
  expected: ReturnType<typeof expectedInput>,
): Qoo10QsmCreateFulfillmentReadRequest {
  return {
    method: "BROWSER_READ",
    readOnly: true,
    browser: {
      name: "Chrome",
      family: "chrome",
      type: "extension",
      profileName: "CHANGHEE",
    },
    sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
    ...expected,
  };
}

function parseCapture(input: {
  value: unknown;
  sellerId: string;
  testItemCode: string;
  dispatchPlaceId: string;
  returnPolicyId: string;
  nowMs: number;
}) {
  const row = record(input.value);
  const browser = record(row?.browser);
  if (!row || !browser || !exactKeys(row, captureKeys)) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_SOURCE_INVALID",
    );
  }
  if (!safeJson(row)) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_SECRET_FORBIDDEN",
    );
  }
  if (!exactKeys(browser, browserKeys)
      || browser.name !== "Chrome" || browser.family !== "chrome"
      || browser.type !== "extension" || browser.profileName !== "CHANGHEE"
      || row.sourceOrigin !== qoo10QsmCreateFulfillmentOrigin
      || row.collector !== qoo10QsmCreateFulfillmentCollector
      || row.trustBoundary !== qoo10QsmCreateFulfillmentTrustBoundary) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_PROFILE_INVALID",
    );
  }
  if (row.contract !== qoo10QsmCreateFulfillmentCaptureContract
      || text(row.authenticatedSellerId) !== input.sellerId
      || text(row.testItemCode) !== input.testItemCode
      || !text(row.testItemSellerCode)) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_ACCOUNT_MISMATCH",
    );
  }
  const observedAtMs = isoTime(row.observedAt);
  if (observedAtMs === null || observedAtMs > input.nowMs + maximumFutureSkewMs
      || observedAtMs < input.nowMs - qoo10QsmCreateFulfillmentMaximumAgeMs) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_FRESHNESS_INVALID",
    );
  }
  const dispatchPlaces = parseRecords(row.dispatchPlaces, "dispatch_places");
  const returnPolicies = parseRecords(row.returnPolicies, "return_policies");
  const exactActive = (records: Qoo10QsmCreateFulfillmentRecord[] | null, id: string) =>
    records?.filter((item) => item.id === id && item.active).length === 1;
  if (!dispatchPlaces || !returnPolicies
      || !exactActive(dispatchPlaces, input.dispatchPlaceId)
      || !exactActive(returnPolicies, input.returnPolicyId)) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_SELECTION_INVALID",
    );
  }
  const draft = {
    ...Object.fromEntries(draftKeys.map((key) => [key, row[key]])),
    dispatchPlaces,
    returnPolicies,
  };
  const expectedRevision = `sha256:${digest(draft as JsonValue)}`;
  const expectedDigest = digest({ ...draft, sourceRevision: expectedRevision } as JsonValue);
  if (text(row.sourceRevision) !== expectedRevision
      || text(row.captureDigest) !== expectedDigest) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_TAMPERED",
    );
  }
  return {
    capture: structuredClone({ ...row, dispatchPlaces, returnPolicies }) as
      Qoo10QsmCreateFulfillmentCapture,
    dispatchPlaces,
    returnPolicies,
  };
}

export function createQoo10ListingCreateFulfillmentQsmGet(input: {
  sellerId: string;
  testItemCode: string;
  dispatchPlaceId: string;
  returnPolicyId: string;
  readCapture: Qoo10ServerQsmCreateFulfillmentCaptureReader;
  now?: Date;
}): Qoo10OfficialGet {
  const expected = expectedInput(input);
  const nowMs = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_INPUT_INVALID",
    );
  }
  let sourcePromise: ReturnType<typeof load> | null = null;
  let establishedAccountDigest = "";
  async function load() {
    let value: unknown;
    try {
      value = await input.readCapture(captureReadRequest(expected));
    } catch {
      throw new Qoo10QsmCreateFulfillmentSourceError(
        "QOO10_QSM_CREATE_FULFILLMENT_SOURCE_FAILED",
      );
    }
    return parseCapture({ value, ...expected, nowMs });
  }
  const source = () => sourcePromise ??= load();

  return async (request): Promise<Qoo10OfficialGetEvidence> => {
    if (request.method !== "GET" || request.sellerId !== expected.sellerId
        || request.testItemCode !== expected.testItemCode) {
      throw new Qoo10QsmCreateFulfillmentSourceError(
        "QOO10_QSM_CREATE_FULFILLMENT_INPUT_INVALID",
      );
    }
    const parsed = await source();
    const sellerIdDigest = protocolDigest({ sellerId: expected.sellerId });
    const sellerAccountIdentityDigest = protocolDigest({
      sellerIdDigest,
      testItemCode: expected.testItemCode,
      testItemSellerCode: parsed.capture.testItemSellerCode,
    });
    if (request.resource === "seller_account_identity") {
      if (request.selectedId !== undefined
          || request.sellerAccountIdentityDigest !== undefined) {
        throw new Qoo10QsmCreateFulfillmentSourceError(
          "QOO10_QSM_CREATE_FULFILLMENT_REQUEST_ORDER_INVALID",
        );
      }
      establishedAccountDigest = sellerAccountIdentityDigest;
      return {
        contract: qoo10OfficialGetEvidenceContract,
        method: "GET",
        resource: request.resource,
        sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
        authenticated: true,
        authenticatedSellerId: expected.sellerId,
        sellerAccountIdentityDigest,
        observedAt: parsed.capture.observedAt,
        revision: `${parsed.capture.sourceRevision}:account`,
        status: 200,
        resultCode: "0",
        records: [{
          id: expected.testItemCode,
          active: true,
          sellerCode: parsed.capture.testItemSellerCode,
          payload: {
            captureMode: "QSM_CHANGHEE_READ_ONLY",
            profileName: "CHANGHEE",
            itemCode: expected.testItemCode,
            sellerCode: parsed.capture.testItemSellerCode,
          },
        }],
      };
    }
    const selectedId = request.resource === "dispatch_places"
      ? expected.dispatchPlaceId
      : expected.returnPolicyId;
    if (!establishedAccountDigest
        || request.sellerAccountIdentityDigest !== establishedAccountDigest
        || request.sellerAccountIdentityDigest !== sellerAccountIdentityDigest
        || request.selectedId !== selectedId) {
      throw new Qoo10QsmCreateFulfillmentSourceError(
        "QOO10_QSM_CREATE_FULFILLMENT_REQUEST_ORDER_INVALID",
      );
    }
    return {
      contract: qoo10OfficialGetEvidenceContract,
      method: "GET",
      resource: request.resource,
      sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
      authenticated: true,
      authenticatedSellerId: expected.sellerId,
      sellerAccountIdentityDigest,
      observedAt: parsed.capture.observedAt,
      revision: `${parsed.capture.sourceRevision}:${request.resource}`,
      status: 200,
      resultCode: "0",
      records: request.resource === "dispatch_places"
        ? parsed.dispatchPlaces
        : parsed.returnPolicies,
    };
  };
}

export async function buildQoo10ListingCreateFulfillmentEvidenceFromServerQsm(input: {
  sellerId: string;
  testItemCode: string;
  dispatchPlaceId: string;
  returnPolicyId: string;
  readCapture: Qoo10ServerQsmCreateFulfillmentCaptureReader;
  now?: Date;
}): Promise<Qoo10ListingCreateFulfillmentEvidence> {
  const expected = expectedInput(input);
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_INPUT_INVALID",
    );
  }
  let value: unknown;
  try {
    value = await input.readCapture(captureReadRequest(expected));
  } catch {
    throw new Qoo10QsmCreateFulfillmentSourceError(
      "QOO10_QSM_CREATE_FULFILLMENT_SOURCE_FAILED",
    );
  }
  const parsed = parseCapture({ value, ...expected, nowMs });
  const get = createQoo10ListingCreateFulfillmentQsmGet({
    ...input,
    now,
    readCapture: async () => parsed.capture,
  });
  return buildQoo10ListingCreateFulfillmentEvidence({ ...input, now, get });
}
