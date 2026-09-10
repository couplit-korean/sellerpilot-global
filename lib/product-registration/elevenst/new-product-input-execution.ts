import { createHash } from "node:crypto";
import {
  elevenstProcessedFoodCategoryId,
  elevenstProcessedFoodNotificationFields,
  elevenstProcessedFoodNoticeType,
} from "../../channels/elevenst-listing";
import type { SecretPayload } from "../../channels/protocols";
import type { ElevenstNewProductInputPreflight } from "../../channels/elevenst-new-product-input";
import {
  assertElevenstCreateCredentialRequestBinding,
  elevenstCreateCredentialBindingArgument,
} from "./credential-request-binding";

export const elevenstNewProductInputReceiptArgument =
  "sellerpilotElevenstNewProductInputReceipt";
export const elevenstNewProductInputExecutionReceiptContract =
  "sellerpilot_elevenst_new_product_input_execution_receipt_v1" as const;
export const elevenstNewProductInputExecutionReceiptLifetimeMs = 10 * 60 * 1_000;

export type ElevenstNewProductInputExecutionReceipt = {
  contract: typeof elevenstNewProductInputExecutionReceiptContract;
  status: "verified";
  productId: string;
  categoryId: typeof elevenstProcessedFoodCategoryId;
  credentialId: string;
  credentialVersion: number;
  environment: "production";
  productApprovalRevision: number;
  sellerIdentityOwnershipRevision: number;
  providerAvailabilityObservedAt: string;
  issuedAt: string;
  validUntil: string;
  productNameSha256: string;
  sellerProductCodeSha256: string;
  notificationType: typeof elevenstProcessedFoodNoticeType;
  items: Array<{
    code: string;
    valueSha256: string;
    sourceRevision: number;
    approvalRevision: number;
  }>;
};

export type ElevenstNewProductExecutionBlocker = {
  code: string;
  path: string;
  required: true;
  fieldCode?: string;
  missing?: string[];
  message: string;
};

export type ElevenstNewProductExecutionPreflight =
  | {
    ok: true;
    receipt: ElevenstNewProductInputExecutionReceipt;
    notification: {
      type: typeof elevenstProcessedFoodNoticeType;
      item: Array<{ code: string; name: string }>;
    };
  }
  | {
    ok: false;
    errorCode: "ELEVENST_NEW_PRODUCT_INPUT_EXECUTION_BLOCKED";
    blockers: ElevenstNewProductExecutionBlocker[];
  };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const placeholderValue = /^(?:알\s*수\s*없음|모름|미정|미기재|미확인|확인\s*필요|판매자\s*확인\s*필요|tbd|unknown|not\s*provided|n\/?a|none|null|undefined|-+)$/iu;
const receiptKeys = new Set([
  "contract",
  "status",
  "productId",
  "categoryId",
  "credentialId",
  "credentialVersion",
  "environment",
  "productApprovalRevision",
  "sellerIdentityOwnershipRevision",
  "providerAvailabilityObservedAt",
  "issuedAt",
  "validUntil",
  "productNameSha256",
  "sellerProductCodeSha256",
  "notificationType",
  "items",
]);
const receiptItemKeys = new Set([
  "code",
  "valueSha256",
  "sourceRevision",
  "approvalRevision",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedText(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  const containsControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 31 && ![9, 10, 13].includes(code)) || code === 127;
  });
  if (!normalized || normalized.length > 1_000 || containsControlCharacter || placeholderValue.test(normalized)) return "";
  return normalized;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function identitySha256(kind: "name" | "seller-code", value: string) {
  return sha256(`elevenst-new-product\u0000${kind}\u0000${value}`);
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function parsedTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function blocker(
  code: string,
  path: string,
  message: string,
  extra: Partial<ElevenstNewProductExecutionBlocker> = {},
): ElevenstNewProductExecutionBlocker {
  return { code, path, required: true, message, ...extra };
}

function notificationItems(product: Record<string, unknown>) {
  const notification = record(product.ProductNotification);
  const rawItems = Array.isArray(notification?.item) ? notification.item : [];
  return {
    type: String(notification?.type ?? "").trim(),
    items: rawItems.map((value) => record(value)),
  };
}

export function buildElevenstNewProductInputExecutionReceipt(input: {
  preflight: ElevenstNewProductInputPreflight;
  productId: string;
  product: Record<string, unknown>;
  credentialId: string;
  credentialVersion: number;
  environment: "production";
  productApprovalRevision: number;
  sellerIdentityOwnershipRevision: number;
  providerAvailabilityObservedAt: string;
  issuedAt?: Date;
}): ElevenstNewProductInputExecutionReceipt {
  if (input.preflight.state !== "ready"
    || !input.preflight.canCreate
    || !input.preflight.productNotification
    || input.preflight.resolvedNoticeCount !== elevenstProcessedFoodNotificationFields.length) {
    throw new Error("ELEVENST_NEW_PRODUCT_INPUT_PREFLIGHT_NOT_READY");
  }
  if (!uuidPattern.test(input.productId)
    || !uuidPattern.test(input.credentialId)
    || !positiveInteger(input.credentialVersion)
    || !positiveInteger(input.productApprovalRevision)
    || !positiveInteger(input.sellerIdentityOwnershipRevision)) {
    throw new Error("ELEVENST_NEW_PRODUCT_INPUT_RECEIPT_METADATA_INVALID");
  }
  const issuedAt = input.issuedAt ?? new Date();
  if (!Number.isFinite(issuedAt.getTime())) {
    throw new Error("ELEVENST_NEW_PRODUCT_INPUT_RECEIPT_TIME_INVALID");
  }
  const providerObservedAt = parsedTime(input.providerAvailabilityObservedAt);
  if (providerObservedAt === null
    || providerObservedAt > issuedAt.getTime()
    || issuedAt.getTime() - providerObservedAt > elevenstNewProductInputExecutionReceiptLifetimeMs) {
    throw new Error("ELEVENST_NEW_PRODUCT_INPUT_PROVIDER_RECEIPT_STALE");
  }
  const productName = normalizedText(input.product.prdNm);
  const sellerProductCode = normalizedText(input.product.sellerPrdCd);
  const notification = notificationItems(input.product);
  if (String(input.product.dispCtgrNo ?? "") !== elevenstProcessedFoodCategoryId
    || !productName
    || !sellerProductCode
    || notification.type !== elevenstProcessedFoodNoticeType) {
    throw new Error("ELEVENST_NEW_PRODUCT_INPUT_PRODUCT_INVALID");
  }
  const resolvedByCode = new Map(input.preflight.resolved.map((item) => [item.code, item]));
  const items = elevenstProcessedFoodNotificationFields.map((field, index) => {
    const actual = notification.items[index];
    const value = normalizedText(actual?.name);
    const resolved = resolvedByCode.get(field.code);
    if (actual?.code !== field.code
      || !value
      || !resolved
      || resolved.valueSha256 !== sha256(value)
      || !positiveInteger(resolved.sourceRevision)
      || !positiveInteger(resolved.approvalRevision)) {
      throw new Error("ELEVENST_NEW_PRODUCT_INPUT_NOTICE_BINDING_INVALID");
    }
    return {
      code: field.code,
      valueSha256: resolved.valueSha256,
      sourceRevision: resolved.sourceRevision,
      approvalRevision: resolved.approvalRevision,
    };
  });
  if (notification.items.length !== items.length) {
    throw new Error("ELEVENST_NEW_PRODUCT_INPUT_NOTICE_BINDING_INVALID");
  }
  return {
    contract: elevenstNewProductInputExecutionReceiptContract,
    status: "verified",
    productId: input.productId,
    categoryId: elevenstProcessedFoodCategoryId,
    credentialId: input.credentialId,
    credentialVersion: input.credentialVersion,
    environment: input.environment,
    productApprovalRevision: input.productApprovalRevision,
    sellerIdentityOwnershipRevision: input.sellerIdentityOwnershipRevision,
    providerAvailabilityObservedAt: input.providerAvailabilityObservedAt,
    issuedAt: issuedAt.toISOString(),
    validUntil: new Date(issuedAt.getTime() + elevenstNewProductInputExecutionReceiptLifetimeMs).toISOString(),
    productNameSha256: identitySha256("name", productName),
    sellerProductCodeSha256: identitySha256("seller-code", sellerProductCode),
    notificationType: elevenstProcessedFoodNoticeType,
    items,
  };
}

export function preflightElevenstNewProductInputExecution(input: {
  arguments: Record<string, unknown>;
  payload: SecretPayload;
  environment: "sandbox" | "production";
  now?: Date;
}): ElevenstNewProductExecutionPreflight {
  const blockers: ElevenstNewProductExecutionBlocker[] = [];
  const product = record(input.arguments.product) ?? {};
  const productName = normalizedText(product.prdNm);
  const sellerProductCode = normalizedText(product.sellerPrdCd);
  const notification = notificationItems(product);
  const expectedCodes = new Set<string>(
    elevenstProcessedFoodNotificationFields.map(({ code }) => code),
  );
  const actualByCode = new Map<string, Array<Record<string, unknown>>>();
  for (const item of notification.items) {
    const code = String(item?.code ?? "").trim();
    if (!actualByCode.has(code)) actualByCode.set(code, []);
    if (item) actualByCode.get(code)?.push(item);
  }
  for (const field of elevenstProcessedFoodNotificationFields) {
    const matches = actualByCode.get(field.code) ?? [];
    const value = normalizedText(matches[0]?.name);
    if (matches.length !== 1 || !value) {
      blockers.push(blocker(
        matches.length > 1
          ? "ELEVENST_NEW_PRODUCT_NOTICE_DUPLICATE"
          : "ELEVENST_NEW_PRODUCT_NOTICE_INPUT_MISSING",
        `product.ProductNotification.item.${field.code}`,
        matches.length > 1
          ? `${field.label} 입력이 중복되었습니다.`
          : `${field.label}의 승인된 값이 없습니다.`,
        {
          fieldCode: field.code,
          missing: matches.length === 0 ? ["value", "source", "approval"] : !value ? ["value"] : undefined,
        },
      ));
    }
  }
  const unexpectedCodes = [...actualByCode.keys()].filter((code) => !expectedCodes.has(code));
  for (const code of unexpectedCodes) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_NOTICE_UNEXPECTED",
      `product.ProductNotification.item.${code || "(empty)"}`,
      `category 1346631 계약에 없는 고시 code ${code || "(empty)"}가 포함되었습니다.`,
      { fieldCode: code || undefined },
    ));
  }
  if (notification.type !== elevenstProcessedFoodNoticeType) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_NOTICE_TYPE_MISMATCH",
      "product.ProductNotification.type",
      "category 1346631의 고시 type은 891031이어야 합니다.",
    ));
  }

  const rawReceipt = record(input.arguments[elevenstNewProductInputReceiptArgument]);
  if (!rawReceipt) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_INPUT_RECEIPT_REQUIRED",
      elevenstNewProductInputReceiptArgument,
      "현재 product/category/credential revision에 결속된 server-owned 입력 영수증이 없습니다.",
      { missing: [elevenstNewProductInputReceiptArgument] },
    ));
    return { ok: false, errorCode: "ELEVENST_NEW_PRODUCT_INPUT_EXECUTION_BLOCKED", blockers };
  }
  const unknownReceiptKeys = Object.keys(rawReceipt).filter((key) => !receiptKeys.has(key));
  const receiptItems = Array.isArray(rawReceipt.items) ? rawReceipt.items.map(record) : [];
  const receiptShapeValid = unknownReceiptKeys.length === 0
    && rawReceipt.contract === elevenstNewProductInputExecutionReceiptContract
    && rawReceipt.status === "verified"
    && typeof rawReceipt.productId === "string"
    && uuidPattern.test(rawReceipt.productId)
    && rawReceipt.categoryId === elevenstProcessedFoodCategoryId
    && typeof rawReceipt.credentialId === "string"
    && uuidPattern.test(rawReceipt.credentialId)
    && positiveInteger(rawReceipt.credentialVersion)
    && rawReceipt.environment === "production"
    && positiveInteger(rawReceipt.productApprovalRevision)
    && positiveInteger(rawReceipt.sellerIdentityOwnershipRevision)
    && typeof rawReceipt.providerAvailabilityObservedAt === "string"
    && typeof rawReceipt.issuedAt === "string"
    && typeof rawReceipt.validUntil === "string"
    && typeof rawReceipt.productNameSha256 === "string"
    && sha256Pattern.test(rawReceipt.productNameSha256)
    && typeof rawReceipt.sellerProductCodeSha256 === "string"
    && sha256Pattern.test(rawReceipt.sellerProductCodeSha256)
    && rawReceipt.notificationType === elevenstProcessedFoodNoticeType
    && receiptItems.length === expectedCodes.size
    && receiptItems.every((item) => item
      && Object.keys(item).every((key) => receiptItemKeys.has(key))
      && typeof item.code === "string"
      && typeof item.valueSha256 === "string"
      && sha256Pattern.test(item.valueSha256)
      && positiveInteger(item.sourceRevision)
      && positiveInteger(item.approvalRevision));
  if (!receiptShapeValid) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_INPUT_RECEIPT_INVALID",
      elevenstNewProductInputReceiptArgument,
      "server-owned 입력 영수증의 필드·revision·digest 계약이 올바르지 않습니다.",
    ));
    return { ok: false, errorCode: "ELEVENST_NEW_PRODUCT_INPUT_EXECUTION_BLOCKED", blockers };
  }
  const receipt = rawReceipt as unknown as ElevenstNewProductInputExecutionReceipt;
  const nowMs = (input.now ?? new Date()).getTime();
  const issuedAt = parsedTime(receipt.issuedAt);
  const validUntil = parsedTime(receipt.validUntil);
  const providerObservedAt = parsedTime(receipt.providerAvailabilityObservedAt);
  if (!Number.isFinite(nowMs)
    || issuedAt === null
    || validUntil === null
    || providerObservedAt === null
    || issuedAt > nowMs
    || nowMs > validUntil
    || validUntil - issuedAt !== elevenstNewProductInputExecutionReceiptLifetimeMs
    || providerObservedAt > issuedAt
    || issuedAt - providerObservedAt > elevenstNewProductInputExecutionReceiptLifetimeMs) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_INPUT_RECEIPT_EXPIRED",
      `${elevenstNewProductInputReceiptArgument}.validUntil`,
      "입력 또는 provider 가용 영수증이 만료되어 fresh server-owned readback이 필요합니다.",
    ));
  }
  if (input.environment !== "production"
    || receipt.environment !== input.environment
    || receipt.categoryId !== String(product.dispCtgrNo ?? "")) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_INPUT_CONTEXT_MISMATCH",
      elevenstNewProductInputReceiptArgument,
      "입력 영수증의 category/environment가 현재 CREATE와 일치하지 않습니다.",
    ));
  }
  if (!productName
    || receipt.productNameSha256 !== identitySha256("name", productName)
    || !sellerProductCode
    || receipt.sellerProductCodeSha256 !== identitySha256("seller-code", sellerProductCode)) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_INPUT_PRODUCT_MISMATCH",
      elevenstNewProductInputReceiptArgument,
      "입력 영수증의 상품명/SKU가 현재 CREATE product와 일치하지 않습니다.",
    ));
  }
  try {
    assertElevenstCreateCredentialRequestBinding({
      credentialId: receipt.credentialId,
      credentialVersion: receipt.credentialVersion,
      environment: input.environment,
      credential: input.payload,
      binding: input.arguments[elevenstCreateCredentialBindingArgument],
    });
  } catch {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_INPUT_CREDENTIAL_REVISION_MISMATCH",
      elevenstCreateCredentialBindingArgument,
      "입력 영수증이 현재 선택된 credential ID/version/seller digest와 일치하지 않습니다.",
    ));
  }
  for (const [index, field] of elevenstProcessedFoodNotificationFields.entries()) {
    const actual = notification.items[index];
    const receiptItem = receipt.items[index];
    const value = normalizedText(actual?.name);
    if (actual?.code !== field.code
      || receiptItem?.code !== field.code
      || !value
      || receiptItem.valueSha256 !== sha256(value)) {
      blockers.push(blocker(
        "ELEVENST_NEW_PRODUCT_NOTICE_RECEIPT_MISMATCH",
        `${elevenstNewProductInputReceiptArgument}.items.${index}`,
        `${field.label} 값·순서가 server-owned 영수증과 일치하지 않습니다.`,
        { fieldCode: field.code },
      ));
    }
  }
  if (notification.items.length !== expectedCodes.size) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_NOTICE_COUNT_MISMATCH",
      "product.ProductNotification.item",
      "가공식품 고시는 정확히 11개여야 합니다.",
    ));
  }
  if (blockers.length > 0) {
    return { ok: false, errorCode: "ELEVENST_NEW_PRODUCT_INPUT_EXECUTION_BLOCKED", blockers };
  }
  return {
    ok: true,
    receipt,
    notification: {
      type: elevenstProcessedFoodNoticeType,
      item: notification.items.map((item) => ({
        code: String(item?.code ?? ""),
        name: normalizedText(item?.name),
      })),
    },
  };
}
