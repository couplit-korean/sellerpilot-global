import { createHash } from "node:crypto";

export const qoo10ListingCreateFulfillmentEvidenceContract =
  "sellerpilot_qoo10_listing_create_fulfillment_evidence_v1" as const;
export const qoo10OfficialGetEvidenceContract =
  "sellerpilot_qoo10_official_get_evidence_v1" as const;
export const qoo10ListingCreateFulfillmentEvidenceArgument =
  "sellerpilotQoo10CreateFulfillmentEvidence" as const;

const maximumEvidenceAgeMs = 5 * 60 * 1_000;
const maximumEvidenceSkewMs = 5_000;
const maximumSnapshotSpreadMs = 30_000;
const officialOrigins = new Set([
  "https://api.qoo10.jp",
  "https://qsm.qoo10.jp",
]);

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type UnknownRecord = Record<string, unknown>;

export type Qoo10CreateFulfillmentResource =
  | "seller_account_identity"
  | "dispatch_places"
  | "return_policies";

export type Qoo10OfficialGetRequest = {
  method: "GET";
  resource: Qoo10CreateFulfillmentResource;
  sellerId: string;
  sellerAccountIdentityDigest?: string;
  testItemCode: string;
  selectedId?: string;
};

export type Qoo10OfficialGetEvidence = {
  contract: typeof qoo10OfficialGetEvidenceContract;
  method: "GET";
  resource: Qoo10CreateFulfillmentResource;
  sourceOrigin: string;
  authenticated: boolean;
  authenticatedSellerId: string;
  sellerAccountIdentityDigest: string;
  observedAt: string;
  revision: string;
  status: number;
  resultCode: string | number;
  records: Array<{
    id: string;
    active: boolean;
    sellerCode?: string;
    payload: JsonValue;
  }>;
};

export type Qoo10OfficialGet = (
  request: Qoo10OfficialGetRequest,
) => Promise<Qoo10OfficialGetEvidence>;

export type Qoo10ListingCreateFulfillmentEvidence = {
  contract: typeof qoo10ListingCreateFulfillmentEvidenceContract;
  sellerIdDigest: string;
  sellerAccountIdentityDigest: string;
  testItemCode: string;
  testItemSellerCodeDigest: string;
  dispatchPlaceId: string;
  returnPolicyId: string;
  dispatchPlaceDigest: string;
  returnPolicyDigest: string;
  sourceRevisions: Record<Qoo10CreateFulfillmentResource, string>;
  sourceObservedAt: Record<Qoo10CreateFulfillmentResource, string>;
  evidenceRevision: string;
  evidenceObservedAt: string;
  evidenceExpiresAt: string;
  evidenceDigest: string;
};

export class Qoo10CreateFulfillmentEvidenceError extends Error {
  constructor(readonly code:
    | "QOO10_CREATE_FULFILLMENT_INPUT_INVALID"
    | "QOO10_CREATE_FULFILLMENT_OFFICIAL_GET_FAILED"
    | "QOO10_CREATE_FULFILLMENT_RESPONSE_UNAUTHENTICATED"
    | "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE"
    | "QOO10_CREATE_FULFILLMENT_RESPONSE_AMBIGUOUS"
    | "QOO10_CREATE_FULFILLMENT_RESPONSE_STALE"
    | "QOO10_CREATE_FULFILLMENT_DISPATCH_PLACE_GET_UNAVAILABLE"
    | "QOO10_CREATE_FULFILLMENT_RETURN_POLICY_GET_UNAVAILABLE") {
    super(code);
    this.name = "Qoo10CreateFulfillmentEvidenceError";
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

function digestText(value: unknown) {
  const normalized = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/u.test(normalized) ? normalized : "";
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

function safeJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 12) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 1_000 && value.every((item) => safeJson(item, depth + 1));
  }
  const row = record(value);
  if (!row || Object.keys(row).length > 1_000) return false;
  return Object.entries(row).every(([key, item]) =>
    key.length > 0
    && key.length <= 200
    && !/(?:authorization|cookie|password|secret|token|api[_-]?key|certification[_-]?key)/iu.test(key)
    && safeJson(item, depth + 1));
}

function observedTime(value: unknown) {
  const normalized = text(value);
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === normalized
    ? milliseconds
    : null;
}

function revision(value: unknown) {
  const normalized = text(value);
  return normalized.length > 0 && normalized.length <= 200
    && !/[\p{Cc}]/u.test(normalized)
    ? normalized
    : "";
}

function parseRecords(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_000) return null;
  const allowedKeys = new Set(["id", "active", "sellerCode", "payload"]);
  const parsed = value.map((item) => {
    const row = record(item);
    const payload = record(row?.payload);
    const id = text(row?.id);
    const sellerCode = text(row?.sellerCode);
    if (!row || Object.keys(row).some((key) => !allowedKeys.has(key))
        || !id || id.length > 200 || typeof row.active !== "boolean"
        || !payload || Object.keys(payload).length === 0 || !safeJson(payload)) return null;
    return {
      id,
      active: row.active,
      ...(sellerCode ? { sellerCode } : {}),
      payload,
    };
  });
  if (parsed.some((item) => !item)) return null;
  return parsed as Qoo10OfficialGetEvidence["records"];
}

function parseOfficialGet(input: {
  value: unknown;
  expectedResource: Qoo10CreateFulfillmentResource;
  sellerId: string;
  sellerAccountIdentityDigest?: string;
  nowMs: number;
}) {
  const row = record(input.value);
  const observedAtMs = observedTime(row?.observedAt);
  const records = parseRecords(row?.records);
  if (!row || row.contract !== qoo10OfficialGetEvidenceContract
      || row.method !== "GET" || row.resource !== input.expectedResource
      || !officialOrigins.has(text(row.sourceOrigin))
      || row.authenticated !== true
      || text(row.authenticatedSellerId) !== input.sellerId
      || !digestText(row.sellerAccountIdentityDigest)
      || (input.sellerAccountIdentityDigest
        && digestText(row.sellerAccountIdentityDigest) !== input.sellerAccountIdentityDigest)
      || Number(row.status) !== 200 || text(row.resultCode) !== "0") {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_RESPONSE_UNAUTHENTICATED",
    );
  }
  if (observedAtMs === null || !revision(row.revision) || !records) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE",
    );
  }
  if (observedAtMs > input.nowMs + maximumEvidenceSkewMs
      || observedAtMs < input.nowMs - maximumEvidenceAgeMs) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_RESPONSE_STALE",
    );
  }
  return {
    sourceOrigin: text(row.sourceOrigin),
    sellerAccountIdentityDigest: digestText(row.sellerAccountIdentityDigest),
    observedAt: new Date(observedAtMs).toISOString(),
    observedAtMs,
    revision: revision(row.revision),
    records,
  };
}

function exactActiveRecord(
  records: Qoo10OfficialGetEvidence["records"],
  id: string,
) {
  const matches = records.filter((item) => item.id === id);
  if (matches.length !== 1) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      matches.length > 1
        ? "QOO10_CREATE_FULFILLMENT_RESPONSE_AMBIGUOUS"
        : "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE",
    );
  }
  if (!matches[0].active) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE",
    );
  }
  return matches[0];
}

function evidenceCore(value: Omit<Qoo10ListingCreateFulfillmentEvidence, "evidenceDigest">) {
  return {
    contract: value.contract,
    sellerIdDigest: value.sellerIdDigest,
    sellerAccountIdentityDigest: value.sellerAccountIdentityDigest,
    testItemCode: value.testItemCode,
    testItemSellerCodeDigest: value.testItemSellerCodeDigest,
    dispatchPlaceId: value.dispatchPlaceId,
    returnPolicyId: value.returnPolicyId,
    dispatchPlaceDigest: value.dispatchPlaceDigest,
    returnPolicyDigest: value.returnPolicyDigest,
    sourceRevisions: value.sourceRevisions,
    sourceObservedAt: value.sourceObservedAt,
    evidenceRevision: value.evidenceRevision,
    evidenceObservedAt: value.evidenceObservedAt,
    evidenceExpiresAt: value.evidenceExpiresAt,
  } satisfies JsonValue;
}

function normalizedInput(input: {
  sellerId: unknown;
  testItemCode: unknown;
  dispatchPlaceId: unknown;
  returnPolicyId: unknown;
  now?: Date;
}) {
  const sellerId = text(input.sellerId);
  const testItemCode = text(input.testItemCode);
  const dispatchPlaceId = text(input.dispatchPlaceId);
  const returnPolicyId = text(input.returnPolicyId);
  const nowMs = (input.now ?? new Date()).getTime();
  if (!sellerId || sellerId.length > 160 || !/^\d{9,10}$/u.test(testItemCode)
      || !dispatchPlaceId || dispatchPlaceId.length > 200
      || !returnPolicyId || returnPolicyId.length > 200
      || !Number.isFinite(nowMs)) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_INPUT_INVALID",
    );
  }
  return {
    sellerId,
    testItemCode,
    dispatchPlaceId,
    returnPolicyId,
    nowMs,
  };
}

export function qoo10ListingCreateFulfillmentEvidenceFromOfficialGets(input: {
  sellerId: string;
  testItemCode: string;
  dispatchPlaceId: string;
  returnPolicyId: string;
  responses: Record<Qoo10CreateFulfillmentResource, Qoo10OfficialGetEvidence>;
  now?: Date;
}): Qoo10ListingCreateFulfillmentEvidence {
  const {
    sellerId,
    testItemCode,
    dispatchPlaceId,
    returnPolicyId,
    nowMs,
  } = normalizedInput(input);

  const account = parseOfficialGet({
    value: input.responses.seller_account_identity,
    expectedResource: "seller_account_identity",
    sellerId,
    nowMs,
  });
  const testItem = exactActiveRecord(account.records, testItemCode);
  if (!text(testItem.sellerCode)) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE",
    );
  }
  const sellerIdDigest = protocolDigest({ sellerId });
  const sellerAccountIdentityDigest = protocolDigest({
    sellerIdDigest,
    testItemCode,
    testItemSellerCode: testItem.sellerCode,
  });
  if (account.sellerAccountIdentityDigest !== sellerAccountIdentityDigest) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_RESPONSE_UNAUTHENTICATED",
    );
  }
  const dispatch = parseOfficialGet({
    value: input.responses.dispatch_places,
    expectedResource: "dispatch_places",
    sellerId,
    sellerAccountIdentityDigest,
    nowMs,
  });
  const returns = parseOfficialGet({
    value: input.responses.return_policies,
    expectedResource: "return_policies",
    sellerId,
    sellerAccountIdentityDigest,
    nowMs,
  });
  const times = [account.observedAtMs, dispatch.observedAtMs, returns.observedAtMs];
  if (Math.max(...times) - Math.min(...times) > maximumSnapshotSpreadMs) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_RESPONSE_STALE",
    );
  }
  const dispatchPlace = exactActiveRecord(dispatch.records, dispatchPlaceId);
  const returnPolicy = exactActiveRecord(returns.records, returnPolicyId);
  const sourceRevisions = {
    seller_account_identity: account.revision,
    dispatch_places: dispatch.revision,
    return_policies: returns.revision,
  };
  const sourceObservedAt = {
    seller_account_identity: account.observedAt,
    dispatch_places: dispatch.observedAt,
    return_policies: returns.observedAt,
  };
  const evidenceObservedAtMs = Math.min(...times);
  const core = {
    contract: qoo10ListingCreateFulfillmentEvidenceContract,
    sellerIdDigest,
    sellerAccountIdentityDigest,
    testItemCode,
    testItemSellerCodeDigest: digest({
      sellerId,
      testItemCode,
      sellerCode: testItem.sellerCode ?? "",
    }),
    dispatchPlaceId,
    returnPolicyId,
    dispatchPlaceDigest: digest({
      resource: "dispatch_places",
      sellerId,
      sellerAccountIdentityDigest,
      sourceOrigin: dispatch.sourceOrigin,
      revision: dispatch.revision,
      record: dispatchPlace,
    }),
    returnPolicyDigest: digest({
      resource: "return_policies",
      sellerId,
      sellerAccountIdentityDigest,
      sourceOrigin: returns.sourceOrigin,
      revision: returns.revision,
      record: returnPolicy,
    }),
    sourceRevisions,
    sourceObservedAt,
    evidenceRevision: digest(sourceRevisions),
    evidenceObservedAt: new Date(evidenceObservedAtMs).toISOString(),
    evidenceExpiresAt: new Date(evidenceObservedAtMs + maximumEvidenceAgeMs).toISOString(),
  } satisfies Omit<Qoo10ListingCreateFulfillmentEvidence, "evidenceDigest">;
  return { ...core, evidenceDigest: digest(evidenceCore(core)) };
}

export async function buildQoo10ListingCreateFulfillmentEvidence(input: {
  sellerId: string;
  testItemCode: string;
  dispatchPlaceId: string;
  returnPolicyId: string;
  get: Qoo10OfficialGet;
  now?: Date;
}) {
  const normalized = normalizedInput(input);
  const requestBase = {
    method: "GET" as const,
    sellerId: normalized.sellerId,
    testItemCode: normalized.testItemCode,
  };
  let responses: Qoo10ListingCreateFulfillmentEvidenceFromOfficialGetsInput["responses"];
  let sellerAccountIdentity: Qoo10OfficialGetEvidence;
  try {
    sellerAccountIdentity = await input.get({
      ...requestBase,
      resource: "seller_account_identity",
    });
  } catch (error) {
    if (error instanceof Qoo10CreateFulfillmentEvidenceError) throw error;
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_OFFICIAL_GET_FAILED",
    );
  }
  const account = parseOfficialGet({
    value: sellerAccountIdentity,
    expectedResource: "seller_account_identity",
    sellerId: normalized.sellerId,
    nowMs: normalized.nowMs,
  });
  const testItem = exactActiveRecord(account.records, normalized.testItemCode);
  if (!text(testItem.sellerCode)) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE",
    );
  }
  const sellerIdDigest = protocolDigest({ sellerId: normalized.sellerId });
  const sellerAccountIdentityDigest = protocolDigest({
    sellerIdDigest,
    testItemCode: normalized.testItemCode,
    testItemSellerCode: testItem.sellerCode,
  });
  if (account.sellerAccountIdentityDigest !== sellerAccountIdentityDigest) {
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_RESPONSE_UNAUTHENTICATED",
    );
  }
  try {
    const [dispatchPlaces, returnPolicies] = await Promise.all([
      input.get({
        ...requestBase,
        resource: "dispatch_places",
        selectedId: normalized.dispatchPlaceId,
        sellerAccountIdentityDigest,
      }),
      input.get({
        ...requestBase,
        resource: "return_policies",
        selectedId: normalized.returnPolicyId,
        sellerAccountIdentityDigest,
      }),
    ]);
    responses = {
      seller_account_identity: sellerAccountIdentity,
      dispatch_places: dispatchPlaces,
      return_policies: returnPolicies,
    };
  } catch (error) {
    if (error instanceof Qoo10CreateFulfillmentEvidenceError) throw error;
    throw new Qoo10CreateFulfillmentEvidenceError(
      "QOO10_CREATE_FULFILLMENT_OFFICIAL_GET_FAILED",
    );
  }
  return qoo10ListingCreateFulfillmentEvidenceFromOfficialGets({ ...input, responses });
}

type Qoo10ListingCreateFulfillmentEvidenceFromOfficialGetsInput = Parameters<
  typeof qoo10ListingCreateFulfillmentEvidenceFromOfficialGets
>[0];

export function qoo10ListingCreateFulfillmentEvidence(
  value: unknown,
  now: Date = new Date(),
): Qoo10ListingCreateFulfillmentEvidence | null {
  const row = record(value);
  const revisions = record(row?.sourceRevisions);
  const observed = record(row?.sourceObservedAt);
  if (!row || row.contract !== qoo10ListingCreateFulfillmentEvidenceContract
      || !digestText(row.sellerIdDigest)
      || !digestText(row.sellerAccountIdentityDigest)
      || !/^\d{9,10}$/u.test(text(row.testItemCode))
      || !digestText(row.testItemSellerCodeDigest)
      || !text(row.dispatchPlaceId) || !text(row.returnPolicyId)
      || !digestText(row.dispatchPlaceDigest) || !digestText(row.returnPolicyDigest)
      || !revisions || !observed) return null;
  const parsedObserved = {
    seller_account_identity: text(observed.seller_account_identity),
    dispatch_places: text(observed.dispatch_places),
    return_policies: text(observed.return_policies),
  };
  const observedTimes = Object.values(parsedObserved).map(observedTime);
  const parsedRevisions = {
    seller_account_identity: revision(revisions.seller_account_identity),
    dispatch_places: revision(revisions.dispatch_places),
    return_policies: revision(revisions.return_policies),
  };
  if (observedTimes.some((item) => item === null)
      || Object.values(parsedRevisions).some((item) => !item)) return null;
  const evidenceObservedAtMs = observedTime(row.evidenceObservedAt);
  const evidenceExpiresAtMs = observedTime(row.evidenceExpiresAt);
  const nowMs = now.getTime();
  if (evidenceObservedAtMs === null || evidenceExpiresAtMs === null
      || !Number.isFinite(nowMs)
      || evidenceObservedAtMs !== Math.min(...observedTimes as number[])
      || evidenceExpiresAtMs !== evidenceObservedAtMs + maximumEvidenceAgeMs
      || nowMs > evidenceExpiresAtMs
      || nowMs < evidenceObservedAtMs - maximumEvidenceSkewMs
      || Math.max(...observedTimes as number[]) - Math.min(...observedTimes as number[])
        > maximumSnapshotSpreadMs
      || digestText(row.evidenceRevision) !== digest(parsedRevisions)) return null;
  const parsed = {
    contract: qoo10ListingCreateFulfillmentEvidenceContract,
    sellerIdDigest: digestText(row.sellerIdDigest),
    sellerAccountIdentityDigest: digestText(row.sellerAccountIdentityDigest),
    testItemCode: text(row.testItemCode),
    testItemSellerCodeDigest: digestText(row.testItemSellerCodeDigest),
    dispatchPlaceId: text(row.dispatchPlaceId),
    returnPolicyId: text(row.returnPolicyId),
    dispatchPlaceDigest: digestText(row.dispatchPlaceDigest),
    returnPolicyDigest: digestText(row.returnPolicyDigest),
    sourceRevisions: parsedRevisions,
    sourceObservedAt: parsedObserved,
    evidenceRevision: digestText(row.evidenceRevision),
    evidenceObservedAt: new Date(evidenceObservedAtMs).toISOString(),
    evidenceExpiresAt: new Date(evidenceExpiresAtMs).toISOString(),
    evidenceDigest: digestText(row.evidenceDigest),
  } satisfies Qoo10ListingCreateFulfillmentEvidence;
  return parsed.evidenceDigest === digest(evidenceCore(parsed)) ? parsed : null;
}
