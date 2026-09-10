import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export const lazadaMyCreateOfficialEvidenceContract =
  "lazada_my_create_official_evidence_r7" as const;
export const lazadaMyCreatePostReceiptContract =
  "lazada_my_create_post_receipt_r7" as const;
export const lazadaMyCreateGetRecoveryReceiptContract =
  "lazada_my_create_get_recovery_receipt_r7" as const;
export const lazadaMyCreateCurrentStateContract =
  "lazada_my_create_current_state_r7" as const;

export type LazadaMyCreateReceiptKind = "post_create" | "get_recovery";

export type LazadaMyCreateOfficialEvidence = Readonly<{
  contract: typeof lazadaMyCreateOfficialEvidenceContract;
  receiptKind: LazadaMyCreateReceiptKind;
  postMethod: "POST";
  postPath: "/product/create";
  postRequestBytes: string;
  postResponseBytes: string;
  postRequestSha256: string;
  postResponseSha256: string;
  itemGetMethod: "GET";
  itemGetPath: "/product/item/get";
  itemGetRequestBytes: string;
  itemGetResponseBytes: string;
  itemGetRequestSha256: string;
  itemGetResponseSha256: string;
  imageRaw: string;
  contentRaw: string;
  localeRaw: string;
}>;

export type LazadaMyCreateGetRecoveryReceipt = Readonly<{
  contract: typeof lazadaMyCreateGetRecoveryReceiptContract;
  receiptKind: "get_recovery";
  method: "GET";
  path: "/product/item/get";
  requestBytes: string;
  responseBytes: string;
  requestSha256: string;
  responseSha256: string;
  imageRaw: string;
  contentRaw: string;
  localeRaw: string;
}>;

export type LazadaMyCreateCurrentSourceSnapshot = Readonly<{
  contract: typeof lazadaMyCreateCurrentStateContract;
  productId: string;
  productStatus: string;
  productDemo: boolean;
  productOnHand: number;
  productUpdatedAt: string;
  listingStatus: string;
  listingRemoteId: string | null;
  listingUpdatedAt: string;
  credentialId: string;
  credentialStatus: string;
  credentialVersion: number;
}>;

export type LazadaSkuIdentity = Readonly<{
  sellerSku: string;
  skuId: string;
}>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function lazadaUtf8Sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function assertLazadaRawBytesBound(input: {
  bytes: unknown;
  sha256: unknown;
  code: string;
}) {
  if (typeof input.bytes !== "string" || input.bytes.length < 2) {
    throw new Error(input.code);
  }
  const digest = lazadaUtf8Sha256(input.bytes);
  if (typeof input.sha256 !== "string" || input.sha256 !== digest) {
    throw new Error(input.code);
  }
  return digest;
}

function parseJsonObject(bytes: string, code: string): UnknownRecord {
  try {
    const parsed: unknown = JSON.parse(bytes);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(code);
    }
    return parsed as UnknownRecord;
  } catch {
    throw new Error(code);
  }
}

function requireSubstring(haystack: string, needle: string, code: string) {
  if (!needle || !haystack.includes(needle)) throw new Error(code);
}

function skuIdBySellerSku(rows: readonly LazadaSkuIdentity[]) {
  return Object.fromEntries(
    [...rows]
      .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku))
      .map((row) => [row.sellerSku, row.skuId]),
  );
}

export function assertLazadaExactSkuMapsEqual(
  left: readonly LazadaSkuIdentity[],
  right: readonly LazadaSkuIdentity[],
) {
  if (JSON.stringify(skuIdBySellerSku(left))
      !== JSON.stringify(skuIdBySellerSku(right))) {
    throw new Error("LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID");
  }
}

export function assertLazadaExactSellerSkuSet(input: {
  expected: readonly string[];
  observed: readonly LazadaSkuIdentity[];
}) {
  if (!input.expected.length
      || new Set(input.expected).size !== input.expected.length
      || input.observed.length !== input.expected.length) {
    throw new Error("LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID");
  }
  const observedSkus = input.observed.map((row) => row.sellerSku);
  const observedIds = input.observed.map((row) => row.skuId);
  if (new Set(observedSkus).size !== observedSkus.length
      || new Set(observedIds).size !== observedIds.length
      || observedIds.some((skuId) => !/^\d+$/u.test(skuId))
      || observedSkus.some((sellerSku) => !sellerSku)) {
    throw new Error("LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID");
  }
  const expected = [...input.expected].sort();
  const observed = [...observedSkus].sort();
  if (expected.some((sellerSku, index) => sellerSku !== observed[index])) {
    throw new Error("LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID");
  }
  return Object.freeze(input.observed.map((row) => Object.freeze({
    sellerSku: row.sellerSku,
    skuId: row.skuId,
  })));
}

function skuIdentities(value: unknown): LazadaSkuIdentity[] {
  const root = record(value);
  const data = record(root.data);
  const rows = Array.isArray(data.sku_list)
    ? data.sku_list
    : Array.isArray(data.skus)
      ? data.skus
      : [];
  return rows.map((row) => {
    const sku = record(row);
    return {
      sellerSku: text(sku.seller_sku ?? sku.SellerSku),
      skuId: text(sku.sku_id ?? sku.SkuId ?? sku.SkuID),
    };
  });
}

function itemIdFrom(value: unknown) {
  const root = record(value);
  const data = record(root.data);
  return text(data.item_id ?? data.ItemId ?? data.itemId);
}

function imageUrlsFrom(value: unknown) {
  const data = record(record(value).data);
  const images = Array.isArray(data.images)
    ? data.images
    : Array.isArray(record(data.Images).Image)
      ? record(data.Images).Image as unknown[]
      : [];
  return images.map(text).filter(Boolean);
}

function contentFrom(value: unknown) {
  const attributes = record(record(record(value).data).attributes);
  return {
    name: text(attributes.name),
    description: text(attributes.description),
  };
}

function localeFrom(value: unknown) {
  const data = record(record(value).data);
  return text(data.locale ?? data.language ?? data.Language);
}

function providerStatusFrom(value: unknown) {
  const data = record(record(value).data);
  const skus = Array.isArray(data.skus) ? data.skus.map(record) : [];
  return [
    text(data.status),
    ...skus.map((sku) => text(sku.Status ?? sku.status)),
  ].filter(Boolean);
}

export function assertLazadaMyCreateCurrentSource(input: {
  claimed: LazadaMyCreateCurrentSourceSnapshot;
  current: LazadaMyCreateCurrentSourceSnapshot;
}) {
  const claimed = input.claimed;
  const current = input.current;
  if (claimed.contract !== lazadaMyCreateCurrentStateContract
      || current.contract !== lazadaMyCreateCurrentStateContract
      || claimed.productId !== current.productId
      || claimed.credentialId !== current.credentialId) {
    throw new Error("LAZADA_MY_CREATE_CURRENT_SOURCE_INVALID");
  }
  if (claimed.productUpdatedAt !== current.productUpdatedAt
      || claimed.listingUpdatedAt !== current.listingUpdatedAt) {
    throw new Error("LAZADA_MY_CREATE_CURRENT_SOURCE_DRIFT");
  }
  if (claimed.productStatus !== current.productStatus
      || claimed.productDemo !== current.productDemo
      || claimed.productOnHand !== current.productOnHand
      || claimed.listingStatus !== current.listingStatus
      || claimed.listingRemoteId !== current.listingRemoteId
      || claimed.credentialStatus !== current.credentialStatus
      || claimed.credentialVersion !== current.credentialVersion) {
    throw new Error("LAZADA_MY_CREATE_CURRENT_SOURCE_DRIFT");
  }
  return current;
}

export function assertLazadaMyCreateOfficialEvidence(input: {
  evidence: unknown;
  expectedSellerSkus: readonly string[];
  expectedLocale: string;
  expectedImageUrls: readonly string[];
  expectedName: string;
  expectedDescription: string;
}): {
  evidence: LazadaMyCreateOfficialEvidence;
  itemId: string;
  skuIdentities: readonly LazadaSkuIdentity[];
  postBody: UnknownRecord;
  itemBody: UnknownRecord;
} {
  const evidence = record(input.evidence);
  if (evidence.contract !== lazadaMyCreateOfficialEvidenceContract
      || evidence.receiptKind !== "post_create"
      || evidence.postMethod !== "POST"
      || evidence.postPath !== "/product/create"
      || evidence.itemGetMethod !== "GET"
      || evidence.itemGetPath !== "/product/item/get") {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED");
  }
  const postRequestSha256 = assertLazadaRawBytesBound({
    bytes: evidence.postRequestBytes,
    sha256: evidence.postRequestSha256,
    code: "LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED",
  });
  const postResponseSha256 = assertLazadaRawBytesBound({
    bytes: evidence.postResponseBytes,
    sha256: evidence.postResponseSha256,
    code: "LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED",
  });
  const itemGetRequestSha256 = assertLazadaRawBytesBound({
    bytes: evidence.itemGetRequestBytes,
    sha256: evidence.itemGetRequestSha256,
    code: "LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED",
  });
  const itemGetResponseSha256 = assertLazadaRawBytesBound({
    bytes: evidence.itemGetResponseBytes,
    sha256: evidence.itemGetResponseSha256,
    code: "LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED",
  });

  const postRequest = parseJsonObject(
    String(evidence.postRequestBytes),
    "LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED",
  );
  if (text(postRequest.method) !== "POST"
      || text(postRequest.path) !== "/product/create") {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED");
  }
  const postBody = parseJsonObject(
    String(evidence.postResponseBytes),
    "LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID",
  );
  const itemRequest = parseJsonObject(
    String(evidence.itemGetRequestBytes),
    "LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED",
  );
  if (text(itemRequest.method) !== "GET"
      || text(itemRequest.path) !== "/product/item/get") {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED");
  }
  const itemBody = parseJsonObject(
    String(evidence.itemGetResponseBytes),
    "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE",
  );

  const itemId = itemIdFrom(postBody);
  const readbackItemId = itemIdFrom(itemBody);
  const identities = assertLazadaExactSellerSkuSet({
    expected: input.expectedSellerSkus,
    observed: skuIdentities(postBody),
  });
  const readbackIdentities = assertLazadaExactSellerSkuSet({
    expected: input.expectedSellerSkus,
    observed: skuIdentities(itemBody),
  });
  if (!/^\d+$/u.test(itemId)
      || itemId !== readbackItemId
      || text(record(itemRequest.params).item_id) !== itemId) {
    throw new Error("LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID");
  }
  assertLazadaExactSkuMapsEqual(identities, readbackIdentities);

  const itemBytes = String(evidence.itemGetResponseBytes);
  const imageRaw = text(evidence.imageRaw);
  const contentRaw = text(evidence.contentRaw);
  const localeRaw = text(evidence.localeRaw);
  const images = imageUrlsFrom(itemBody);
  const content = contentFrom(itemBody);
  const locale = localeFrom(itemBody);
  if (images.length !== 8
      || images.length !== input.expectedImageUrls.length
      || images.some((url) => !input.expectedImageUrls.includes(url))
      || input.expectedImageUrls.some((url) => !images.includes(url))) {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  }
  requireSubstring(itemBytes, imageRaw, "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  requireSubstring(itemBytes, content.name, "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  requireSubstring(itemBytes, content.description, "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  requireSubstring(itemBytes, localeRaw, "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  images.forEach((url) => requireSubstring(
    itemBytes,
    url,
    "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE",
  ));
  if (imageRaw !== JSON.stringify(images)
      || contentRaw !== `${content.name}\n${content.description}`
      || content.name !== input.expectedName
      || content.description !== input.expectedDescription
      || localeRaw !== input.expectedLocale
      || locale !== input.expectedLocale) {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  }
  const statuses = providerStatusFrom(itemBody);
  if (!statuses.length
      || statuses.some((status) => !itemBytes.includes(status))) {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  }

  return {
    evidence: Object.freeze({
      contract: lazadaMyCreateOfficialEvidenceContract,
      receiptKind: "post_create",
      postMethod: "POST",
      postPath: "/product/create",
      postRequestBytes: String(evidence.postRequestBytes),
      postResponseBytes: String(evidence.postResponseBytes),
      postRequestSha256,
      postResponseSha256,
      itemGetMethod: "GET",
      itemGetPath: "/product/item/get",
      itemGetRequestBytes: String(evidence.itemGetRequestBytes),
      itemGetResponseBytes: String(evidence.itemGetResponseBytes),
      itemGetRequestSha256,
      itemGetResponseSha256,
      imageRaw,
      contentRaw,
      localeRaw,
    }),
    itemId,
    skuIdentities: identities,
    postBody,
    itemBody,
  };
}

export function assertLazadaMyCreateGetRecoveryReceipt(input: {
  receipt: unknown;
  expectedSellerSkus: readonly string[];
  expectedLocale: string;
  expectedImageUrls: readonly string[];
  expectedName: string;
  expectedDescription: string;
}) {
  const receipt = record(input.receipt);
  if (receipt.contract !== lazadaMyCreateGetRecoveryReceiptContract
      || receipt.receiptKind !== "get_recovery"
      || receipt.method !== "GET"
      || receipt.path !== "/product/item/get") {
    throw new Error("LAZADA_MY_CREATE_GET_RECOVERY_RECEIPT_REQUIRED");
  }
  if (text(receipt.path) === "/products/get"
      || text(receipt.method) === "POST"
      || String(receipt.receiptKind) === "post_create"
      || "sku_list" in receipt
      || "createResponse" in receipt
      || "synthesizedCreateResponse" in receipt) {
    throw new Error("LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE");
  }
  const requestSha256 = assertLazadaRawBytesBound({
    bytes: receipt.requestBytes,
    sha256: receipt.requestSha256,
    code: "LAZADA_MY_CREATE_GET_RECOVERY_RECEIPT_REQUIRED",
  });
  const responseSha256 = assertLazadaRawBytesBound({
    bytes: receipt.responseBytes,
    sha256: receipt.responseSha256,
    code: "LAZADA_MY_CREATE_GET_RECOVERY_RECEIPT_REQUIRED",
  });
  const request = parseJsonObject(
    String(receipt.requestBytes),
    "LAZADA_MY_CREATE_GET_RECOVERY_RECEIPT_REQUIRED",
  );
  if (text(request.method) !== "GET"
      || text(request.path) !== "/product/item/get"
      || text(request.path) === "/products/get") {
    throw new Error("LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE");
  }
  const body = parseJsonObject(
    String(receipt.responseBytes),
    "LAZADA_MY_CREATE_GET_RECOVERY_RECEIPT_REQUIRED",
  );
  if ("sku_list" in record(body.data) || "sku_list" in body) {
    throw new Error("LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE");
  }
  const itemId = itemIdFrom(body);
  const identities = assertLazadaExactSellerSkuSet({
    expected: input.expectedSellerSkus,
    observed: skuIdentities(body),
  });
  const bytes = String(receipt.responseBytes);
  const imageRaw = text(receipt.imageRaw);
  const contentRaw = text(receipt.contentRaw);
  const localeRaw = text(receipt.localeRaw);
  const images = imageUrlsFrom(body);
  const content = contentFrom(body);
  const locale = localeFrom(body);
  if (!/^\d+$/u.test(itemId)
      || images.length !== 8
      || imageRaw !== JSON.stringify(images)
      || contentRaw !== `${content.name}\n${content.description}`
      || localeRaw !== input.expectedLocale
      || locale !== input.expectedLocale
      || content.name !== input.expectedName
      || content.description !== input.expectedDescription) {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  }
  requireSubstring(bytes, imageRaw, "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  requireSubstring(bytes, content.name, "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  requireSubstring(bytes, content.description, "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  requireSubstring(bytes, localeRaw, "LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  return Object.freeze({
    contract: lazadaMyCreateGetRecoveryReceiptContract,
    receiptKind: "get_recovery" as const,
    method: "GET" as const,
    path: "/product/item/get" as const,
    requestBytes: String(receipt.requestBytes),
    responseBytes: String(receipt.responseBytes),
    requestSha256,
    responseSha256,
    imageRaw,
    contentRaw,
    localeRaw,
    itemId,
    skuIdentities: identities,
  });
}

export function lazadaMyCreateOfficialEvidenceFromBytes(input: {
  postRequest: { method: "POST"; path: "/product/create"; body: unknown };
  postResponseBytes: string;
  itemGetRequest: {
    method: "GET";
    path: "/product/item/get";
    params: { item_id: string };
  };
  itemGetResponseBytes: string;
  imageRaw: string;
  contentRaw: string;
  localeRaw: string;
}): LazadaMyCreateOfficialEvidence {
  const postRequestBytes = JSON.stringify(input.postRequest);
  const itemGetRequestBytes = JSON.stringify(input.itemGetRequest);
  return Object.freeze({
    contract: lazadaMyCreateOfficialEvidenceContract,
    receiptKind: "post_create",
    postMethod: "POST",
    postPath: "/product/create",
    postRequestBytes,
    postResponseBytes: input.postResponseBytes,
    postRequestSha256: lazadaUtf8Sha256(postRequestBytes),
    postResponseSha256: lazadaUtf8Sha256(input.postResponseBytes),
    itemGetMethod: "GET",
    itemGetPath: "/product/item/get",
    itemGetRequestBytes,
    itemGetResponseBytes: input.itemGetResponseBytes,
    itemGetRequestSha256: lazadaUtf8Sha256(itemGetRequestBytes),
    itemGetResponseSha256: lazadaUtf8Sha256(input.itemGetResponseBytes),
    imageRaw: input.imageRaw,
    contentRaw: input.contentRaw,
    localeRaw: input.localeRaw,
  });
}
