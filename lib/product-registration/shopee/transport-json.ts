import { createHash } from "node:crypto";

import { listingPublicationIntentFromArguments } from "../../channels/listing-publication-state";
import { shopeeGlobalCreateBody } from "../../channels/shopee-create-preflight";
import { shopeeGlobalPublishArgumentsForIntent } from "../../channels/provider-shopee-publication-readback";

type UnknownRecord = Record<string, unknown>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function utf8KeyOrder(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalValue(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("SHOPEE_SG_CANONICAL_JSON_INVALID");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") throw new Error("SHOPEE_SG_CANONICAL_JSON_INVALID");
  const entries = Object.entries(value as UnknownRecord)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => utf8KeyOrder(left, right));
  return Object.fromEntries(entries.map(([key, item]) => [key, canonicalValue(item)]));
}

export function canonicalShopeeSgObjectJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalShopeeSgObjectSha256(value: unknown) {
  return createHash("sha256").update(canonicalShopeeSgObjectJson(value), "utf8").digest("hex");
}

export type ShopeeSgTransportBinding = {
  bytes: string;
  sha256: string;
};

export function bindShopeeSgTransportBytes(body: unknown): ShopeeSgTransportBinding {
  if (body === undefined) throw new Error("SHOPEE_SG_TRANSPORT_BODY_INVALID");
  const bytes = JSON.stringify(body);
  if (typeof bytes !== "string" || !bytes.length) {
    throw new Error("SHOPEE_SG_TRANSPORT_BODY_INVALID");
  }
  return {
    bytes,
    sha256: createHash("sha256").update(bytes, "utf8").digest("hex"),
  };
}

export function parseShopeeSgTransportBody(binding: ShopeeSgTransportBinding): UnknownRecord {
  const parsed = JSON.parse(binding.bytes) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SHOPEE_SG_TRANSPORT_BODY_INVALID");
  }
  const replay = bindShopeeSgTransportBytes(parsed);
  if (replay.bytes !== binding.bytes || replay.sha256 !== binding.sha256) {
    throw new Error("SHOPEE_SG_TRANSPORT_BYTES_MISMATCH");
  }
  return parsed as UnknownRecord;
}

export function bindShopeeSgCreateTransportPayload(input: {
  globalBody: unknown;
  localBody: unknown;
}) {
  const global = bindShopeeSgTransportBytes(input.globalBody);
  const local = bindShopeeSgTransportBytes(input.localBody);
  const combined = `${global.bytes.length}:${global.bytes}\n${local.bytes.length}:${local.bytes}`;
  return {
    global,
    local,
    payloadSha256: createHash("sha256").update(combined, "utf8").digest("hex"),
  };
}

function withoutDeferredImageBytes(value: unknown) {
  const body = { ...record(value) };
  delete body.image;
  delete body.description_info;
  if (body.item && typeof body.item === "object" && !Array.isArray(body.item)) {
    const item = { ...record(body.item) };
    delete item.image;
    delete item.description_info;
    body.item = item;
  }
  return body;
}

export function shopeeSgCreateTransportPayloadFromArguments(argumentsValue: UnknownRecord) {
  const intent = listingPublicationIntentFromArguments(argumentsValue);
  if (!intent) throw new Error("SHOPEE_SG_TRANSPORT_INTENT_REQUIRED");
  return bindShopeeSgCreateTransportPayload({
    globalBody: withoutDeferredImageBytes(
      shopeeGlobalCreateBody(record(argumentsValue.body), true),
    ),
    localBody: withoutDeferredImageBytes(
      shopeeGlobalPublishArgumentsForIntent(argumentsValue.publish, intent),
    ),
  });
}

function exactObject(value: unknown, keys: readonly string[], code: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  const source = value as UnknownRecord;
  const unknown = Object.keys(source).filter((key) => !keys.includes(key));
  if (unknown.length) throw new Error(`${code}:UNKNOWN_KEY:${unknown.join(",")}`);
  return source;
}

function integer(value: unknown, code: string, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(code);
  }
  return value;
}

export function bindShopeeSgWarehouseListTransport(body: unknown) {
  const source = exactObject(body, ["cursor"], "SHOPEE_SG_WAREHOUSE_LIST_BODY_FORBIDDEN");
  const cursor = exactObject(source.cursor, ["next_id", "page_size"], "SHOPEE_SG_WAREHOUSE_LIST_BODY_FORBIDDEN");
  const parsed = {
    cursor: {
      next_id: integer(cursor.next_id, "SHOPEE_SG_WAREHOUSE_LIST_BODY_FORBIDDEN"),
      page_size: integer(cursor.page_size, "SHOPEE_SG_WAREHOUSE_LIST_BODY_FORBIDDEN", 1),
    },
  };
  return bindShopeeSgTransportBytes(parsed);
}

export function bindShopeeSgWarehouseEligibleShopTransport(body: unknown) {
  const source = exactObject(
    body,
    ["warehouse_id", "warehouse_type", "cursor"],
    "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_BODY_FORBIDDEN",
  );
  const cursor = exactObject(
    source.cursor,
    ["next_id", "page_size"],
    "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_BODY_FORBIDDEN",
  );
  const parsed = {
    warehouse_id: integer(source.warehouse_id, "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_BODY_FORBIDDEN", 1),
    warehouse_type: integer(source.warehouse_type, "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_BODY_FORBIDDEN", 1),
    cursor: {
      next_id: integer(cursor.next_id, "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_BODY_FORBIDDEN"),
      page_size: integer(cursor.page_size, "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_BODY_FORBIDDEN", 1),
    },
  };
  return bindShopeeSgTransportBytes(parsed);
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function isShopeeSgFullPublishDraft(value: unknown) {
  const row = record(value);
  const data = record(row.data ?? value);
  const common = record(data.common);
  const fields = record(common.fields);
  const channels = record(data.channels);
  const sg = record(channels.sg);
  const kind = text(row.kind || "publish");
  return kind === "publish"
    && Boolean(text(fields.productName))
    && typeof common.quantity === "number" && Number.isSafeInteger(common.quantity) && common.quantity > 0
    && typeof common.globalBaseUsdPrice === "number" && Number.isFinite(common.globalBaseUsdPrice)
    && Boolean(text(sg.categoryId));
}

export function assertShopeeSgExactOneFullDraft(drafts: readonly unknown[]) {
  const current = drafts.filter((draft) => {
    const row = record(draft);
    const kind = text(row.kind || record(row.data).kind || "publish");
    return kind === "publish";
  });
  const full = current.filter(isShopeeSgFullPublishDraft);
  if (current.length !== 1 || full.length !== 1) {
    throw new Error("SHOPEE_SG_FULL_DRAFT_CARDINALITY");
  }
  return full[0];
}
