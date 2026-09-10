import { createHash } from "node:crypto";
import {
  elevenstProcessedFoodCategoryId,
  elevenstProcessedFoodNotificationFields,
  elevenstProcessedFoodNoticeType,
  elevenstProcessedFoodProductNameNoticeCode,
} from "./elevenst-listing";

export const elevenstNewProductInputContract = "sellerpilot_elevenst_new_product_input_v1" as const;
export const elevenstSellerIdentityReceiptContract = "sellerpilot_elevenst_seller_identity_receipt_v1" as const;
export const elevenstProviderAvailabilityReceiptContract = "sellerpilot_elevenst_provider_availability_v1" as const;
export const elevenstInputReceiptFreshnessMs = 10 * 60 * 1_000;

export const elevenstNoticeSourceKinds = [
  "product_label",
  "manufacturer_document",
  "seller_declaration",
  "sellerpilot_approved_fact",
] as const;

export type ElevenstNoticeSourceKind = typeof elevenstNoticeSourceKinds[number];

export type ElevenstNoticeSource = {
  kind: ElevenstNoticeSourceKind;
  productId: string;
  revision: number;
  sourceSha256: string;
  capturedAt: string;
};

export type ElevenstNoticeApproval = {
  productId: string;
  categoryId: string;
  fieldCode: string;
  revision: number;
  sourceSha256: string;
  valueSha256: string;
  approvedAt: string;
};

export type ElevenstNoticeInput = {
  code: string;
  required?: boolean;
  value?: unknown;
  source?: ElevenstNoticeSource;
  approval?: ElevenstNoticeApproval;
};

export type ElevenstSellerIdentityReceipt = {
  contract: typeof elevenstSellerIdentityReceiptContract;
  credentialId: string;
  credentialVersion: number;
  environment: "production";
  sellerIdSha256: string;
  sellerOfficeAccountSha256: string;
  ownershipRevision: number;
  verifiedAt: string;
};

export type ElevenstProviderAvailabilityReceipt = {
  contract: typeof elevenstProviderAvailabilityReceiptContract;
  state: "available" | "scheduled_maintenance" | "unavailable";
  observedAt: string;
  maintenance?: {
    startsAt: string;
    endsAt: string;
  };
};

export type ElevenstNewProductInput = {
  contract: typeof elevenstNewProductInputContract;
  product: {
    id: string;
    name: string;
    approvalRevision: number;
  };
  categoryId: string;
  notices: ElevenstNoticeInput[];
  sellerIdentity?: ElevenstSellerIdentityReceipt;
  providerAvailability?: ElevenstProviderAvailabilityReceipt;
};

export type ElevenstNewProductInputBlocker = {
  code: string;
  path: string;
  fieldCode?: string;
  label?: string;
  required: true;
  missing?: string[];
  acceptedSourceKinds?: ElevenstNoticeSourceKind[];
  retryAfter?: string;
  message: string;
};

export type ElevenstResolvedNoticeReceipt = {
  code: string;
  label: string;
  required: true;
  sourceKind: ElevenstNoticeSourceKind | "sellerpilot_product_approval";
  sourceRevision: number;
  approvalRevision: number;
  valueSha256: string;
};

export type ElevenstNewProductInputPreflight = {
  contract: "sellerpilot_elevenst_new_product_preflight_v1";
  state: "ready" | "blocked";
  canCreate: boolean;
  categoryId: string;
  notificationType: typeof elevenstProcessedFoodNoticeType;
  requiredNoticeCount: number;
  resolvedNoticeCount: number;
  resolved: ElevenstResolvedNoticeReceipt[];
  blockers: ElevenstNewProductInputBlocker[];
  productNotification: null | {
    type: typeof elevenstProcessedFoodNoticeType;
    item: Array<{ code: string; name: string }>;
  };
};

const sha256Pattern = /^[a-f0-9]{64}$/u;
const placeholderValue = /^(?:알\s*수\s*없음|모름|미정|미기재|미확인|확인\s*필요|판매자\s*확인\s*필요|tbd|unknown|not\s*provided|n\/?a|none|null|undefined|-+)$/iu;
const sellerIdentityKeys = new Set([
  "contract",
  "credentialId",
  "credentialVersion",
  "environment",
  "sellerIdSha256",
  "sellerOfficeAccountSha256",
  "ownershipRevision",
  "verifiedAt",
]);

const noticeSourceKindsByCode = new Map<string, readonly ElevenstNoticeSourceKind[]>([
  ["176400445", ["product_label", "manufacturer_document", "sellerpilot_approved_fact"]],
  ["176398001", ["product_label"]],
  ["42154823", ["product_label", "seller_declaration"]],
  ["23757260", ["product_label", "seller_declaration"]],
  ["23757095", ["product_label", "manufacturer_document"]],
  ["176312674", ["product_label", "manufacturer_document"]],
  ["23756754", ["product_label", "manufacturer_document", "seller_declaration"]],
  ["23757245", ["product_label", "manufacturer_document"]],
  ["42155152", ["product_label", "manufacturer_document", "sellerpilot_approved_fact"]],
  ["23757000", ["product_label", "manufacturer_document"]],
]);

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
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

function validPositiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function parsedTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function freshAt(value: unknown, nowMs: number) {
  const milliseconds = parsedTime(value);
  return milliseconds !== null && milliseconds <= nowMs && nowMs - milliseconds <= elevenstInputReceiptFreshnessMs;
}

function blocker(
  code: string,
  path: string,
  message: string,
  extra: Partial<ElevenstNewProductInputBlocker> = {},
): ElevenstNewProductInputBlocker {
  return { code, path, required: true, message, ...extra };
}

function sellerIdentityBlockers(value: ElevenstSellerIdentityReceipt | undefined, nowMs: number) {
  const blockers: ElevenstNewProductInputBlocker[] = [];
  if (!value) {
    return [blocker(
      "ELEVENST_SELLER_IDENTITY_RECEIPT_REQUIRED",
      "sellerIdentity",
      "현재 운영 credential과 Seller Office 계정의 동일성 영수증이 없습니다.",
      { missing: ["sellerIdentity"] },
    )];
  }
  const unknownKeys = Object.keys(value).filter((key) => !sellerIdentityKeys.has(key));
  if (unknownKeys.length > 0) {
    blockers.push(blocker(
      "ELEVENST_SELLER_IDENTITY_RAW_OR_UNKNOWN_FIELD_FORBIDDEN",
      "sellerIdentity",
      "seller identity에는 raw 계정값을 넣지 말고 서버가 만든 digest 영수증만 사용해야 합니다.",
      { missing: unknownKeys.map((key) => `remove:${key}`) },
    ));
  }
  if (value.contract !== elevenstSellerIdentityReceiptContract
    || !normalizedText(value.credentialId)
    || !validPositiveInteger(value.credentialVersion)
    || value.environment !== "production"
    || !validPositiveInteger(value.ownershipRevision)) {
    blockers.push(blocker(
      "ELEVENST_SELLER_IDENTITY_RECEIPT_INVALID",
      "sellerIdentity",
      "운영 credential ID/version/environment와 ownership revision을 다시 확인해야 합니다.",
    ));
  }
  if (!sha256Pattern.test(value.sellerIdSha256)
    || !sha256Pattern.test(value.sellerOfficeAccountSha256)
    || value.sellerIdSha256 !== value.sellerOfficeAccountSha256) {
    blockers.push(blocker(
      "ELEVENST_SELLER_IDENTITY_MISMATCH",
      "sellerIdentity",
      "운영 credential seller와 Seller Office 계정 소유가 일치하지 않습니다.",
    ));
  }
  if (!freshAt(value.verifiedAt, nowMs)) {
    blockers.push(blocker(
      "ELEVENST_SELLER_IDENTITY_FRESH_READ_REQUIRED",
      "sellerIdentity.verifiedAt",
      "Seller Office와 운영 credential 동일성을 최근 10분 이내 read-only로 다시 확인해야 합니다.",
    ));
  }
  return blockers;
}

function providerAvailabilityBlockers(value: ElevenstProviderAvailabilityReceipt | undefined, nowMs: number) {
  if (!value) {
    return [blocker(
      "ELEVENST_PROVIDER_AVAILABILITY_RECEIPT_REQUIRED",
      "providerAvailability",
      "11번가 점검/가용 상태의 최근 read-only 영수증이 없습니다.",
      { missing: ["providerAvailability"] },
    )];
  }
  if (value.contract !== elevenstProviderAvailabilityReceiptContract || parsedTime(value.observedAt) === null) {
    return [blocker(
      "ELEVENST_PROVIDER_AVAILABILITY_RECEIPT_INVALID",
      "providerAvailability",
      "11번가 가용 상태 영수증 형식을 확인해야 합니다.",
    )];
  }
  if (!freshAt(value.observedAt, nowMs)) {
    return [blocker(
      "ELEVENST_PROVIDER_AVAILABILITY_FRESH_READ_REQUIRED",
      "providerAvailability.observedAt",
      "11번가 가용 상태를 최근 10분 이내 read-only로 다시 확인해야 합니다.",
    )];
  }
  if (value.state === "scheduled_maintenance") {
    const startsAt = parsedTime(value.maintenance?.startsAt);
    const endsAt = parsedTime(value.maintenance?.endsAt);
    if (startsAt === null || endsAt === null || startsAt >= endsAt) {
      return [blocker(
        "ELEVENST_PROVIDER_MAINTENANCE_WINDOW_INVALID",
        "providerAvailability.maintenance",
        "점검 시작/종료 시각이 유효하지 않습니다.",
      )];
    }
    if (nowMs >= endsAt) {
      return [blocker(
        "ELEVENST_PROVIDER_AVAILABILITY_FRESH_READ_REQUIRED",
        "providerAvailability.observedAt",
        "점검 종료 뒤 11번가 상태를 새로 읽기 전에는 CREATE할 수 없습니다.",
      )];
    }
    return [blocker(
      nowMs >= startsAt ? "ELEVENST_PROVIDER_MAINTENANCE_WINDOW_ACTIVE" : "ELEVENST_PROVIDER_AVAILABILITY_NOT_AVAILABLE",
      "providerAvailability.state",
      nowMs >= startsAt ? "11번가 공식 점검창 안이므로 CREATE할 수 없습니다." : "예정된 점검 영수증은 현재 가용 상태를 증명하지 않습니다.",
      { retryAfter: value.maintenance?.endsAt },
    )];
  }
  if (value.state !== "available") {
    return [blocker(
      "ELEVENST_PROVIDER_AVAILABILITY_NOT_AVAILABLE",
      "providerAvailability.state",
      "11번가가 available로 새로 확인되지 않았습니다.",
    )];
  }
  return [];
}

function manualNoticeResolution(
  input: ElevenstNewProductInput,
  field: typeof elevenstProcessedFoodNotificationFields[number],
  duplicateCodes: Set<string>,
  nowMs: number,
) {
  const path = `notices.${field.code}`;
  const acceptedSourceKinds = [...(noticeSourceKindsByCode.get(field.code) ?? [])];
  const matching = input.notices.filter((candidate) => candidate.code === field.code);
  if (matching.length !== 1 || duplicateCodes.has(field.code)) {
    return {
      blocker: blocker(
        matching.length === 0 ? "ELEVENST_NOTICE_INPUT_MISSING" : "ELEVENST_NOTICE_INPUT_DUPLICATE",
        path,
        matching.length === 0 ? `${field.label} 필수 입력이 없습니다.` : `${field.label} 입력이 중복되었습니다.`,
        {
          fieldCode: field.code,
          label: field.label,
          missing: matching.length === 0 ? ["value", "source", "approval"] : undefined,
          acceptedSourceKinds,
        },
      ),
    };
  }
  const candidate = matching[0];
  const value = normalizedText(candidate.value);
  const missing = [
    ...(!value ? ["value"] : []),
    ...(!candidate.source ? ["source"] : []),
    ...(!candidate.approval ? ["approval"] : []),
  ];
  if (candidate.required === false) {
    return {
      blocker: blocker(
        "ELEVENST_NOTICE_REQUIREDNESS_TAMPERED",
        `${path}.required`,
        `${field.label}은 category 1346631의 필수 고시이며 선택 입력으로 낮출 수 없습니다.`,
        { fieldCode: field.code, label: field.label, acceptedSourceKinds },
      ),
    };
  }
  if (missing.length > 0) {
    return {
      blocker: blocker(
        "ELEVENST_NOTICE_INPUT_INCOMPLETE",
        path,
        `${field.label}의 값·출처·승인 revision이 모두 필요합니다.`,
        { fieldCode: field.code, label: field.label, missing, acceptedSourceKinds },
      ),
    };
  }
  const source = candidate.source as ElevenstNoticeSource;
  const approval = candidate.approval as ElevenstNoticeApproval;
  const capturedAt = parsedTime(source.capturedAt);
  const approvedAt = parsedTime(approval.approvedAt);
  const sourceValid = acceptedSourceKinds.includes(source.kind)
    && source.productId === input.product.id
    && validPositiveInteger(source.revision)
    && sha256Pattern.test(source.sourceSha256)
    && capturedAt !== null
    && capturedAt <= nowMs;
  if (!sourceValid) {
    return {
      blocker: blocker(
        "ELEVENST_NOTICE_SOURCE_INVALID",
        `${path}.source`,
        `${field.label} 출처가 현재 상품과 허용된 증빙 유형/revision에 결속되지 않았습니다.`,
        { fieldCode: field.code, label: field.label, acceptedSourceKinds },
      ),
    };
  }
  const valueSha256 = sha256(value);
  const approvalValid = approval.productId === input.product.id
    && approval.categoryId === input.categoryId
    && approval.fieldCode === field.code
    && validPositiveInteger(approval.revision)
    && approval.sourceSha256 === source.sourceSha256
    && approval.valueSha256 === valueSha256
    && approvedAt !== null
    && approvedAt <= nowMs
    && capturedAt !== null
    && approvedAt >= capturedAt;
  if (!approvalValid) {
    return {
      blocker: blocker(
        "ELEVENST_NOTICE_APPROVAL_BINDING_INVALID",
        `${path}.approval`,
        `${field.label} 승인 revision이 상품·카테고리·필드·출처·값 해시에 정확히 결속되지 않았습니다.`,
        { fieldCode: field.code, label: field.label, acceptedSourceKinds },
      ),
    };
  }
  return {
    value,
    receipt: {
      code: field.code,
      label: field.label,
      required: true as const,
      sourceKind: source.kind,
      sourceRevision: source.revision,
      approvalRevision: approval.revision,
      valueSha256,
    },
  };
}

export function resolveElevenstNewProductInput(
  input: ElevenstNewProductInput,
  now = new Date(),
): ElevenstNewProductInputPreflight {
  const blockers: ElevenstNewProductInputBlocker[] = [];
  const resolved: ElevenstResolvedNoticeReceipt[] = [];
  const notificationItems: Array<{ code: string; name: string }> = [];
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) throw new Error("ELEVENST_PREFLIGHT_NOW_INVALID");
  if (input.contract !== elevenstNewProductInputContract) {
    blockers.push(blocker("ELEVENST_NEW_PRODUCT_INPUT_CONTRACT_INVALID", "contract", "11번가 신규 입력 계약 버전이 일치하지 않습니다."));
  }
  if (input.categoryId !== elevenstProcessedFoodCategoryId) {
    blockers.push(blocker("ELEVENST_NEW_PRODUCT_CATEGORY_UNVERIFIED", "categoryId", "검증된 가공식품 category 1346631 입력만 처리할 수 있습니다."));
  }
  blockers.push(...sellerIdentityBlockers(input.sellerIdentity, nowMs));
  blockers.push(...providerAvailabilityBlockers(input.providerAvailability, nowMs));

  const duplicateCodes = new Set(input.notices
    .map(({ code }) => code)
    .filter((code, index, values) => values.indexOf(code) !== index));
  const manualCodes = new Set<string>(elevenstProcessedFoodNotificationFields
    .map(({ code }) => code)
    .filter((code) => code !== elevenstProcessedFoodProductNameNoticeCode));
  for (const [index, candidate] of input.notices.entries()) {
    if (!manualCodes.has(candidate.code)) {
      blockers.push(blocker(
        "ELEVENST_NOTICE_INPUT_UNEXPECTED",
        `notices.${index}`,
        candidate.code === elevenstProcessedFoodProductNameNoticeCode
          ? "제품명 고시는 승인된 상품명에서만 자동 생성하며 수동 입력을 허용하지 않습니다."
          : `category 1346631 계약에 없는 고시 code ${candidate.code || "(empty)"}를 허용하지 않습니다.`,
        { fieldCode: candidate.code || undefined },
      ));
    }
  }

  for (const field of elevenstProcessedFoodNotificationFields) {
    if (field.code === elevenstProcessedFoodProductNameNoticeCode) {
      const productName = normalizedText(input.product.name);
      if (!normalizedText(input.product.id) || !productName || !validPositiveInteger(input.product.approvalRevision)) {
        blockers.push(blocker(
          "ELEVENST_PRODUCT_NAME_APPROVAL_REQUIRED",
          "product",
          "제품명 자동 입력에는 현재 상품 ID, 승인된 상품명, 양의 approval revision이 필요합니다.",
          { fieldCode: field.code, label: field.label, missing: ["product.id", "product.name", "product.approvalRevision"] },
        ));
        continue;
      }
      const valueSha256 = sha256(productName);
      resolved.push({
        code: field.code,
        label: field.label,
        required: true,
        sourceKind: "sellerpilot_product_approval",
        sourceRevision: input.product.approvalRevision,
        approvalRevision: input.product.approvalRevision,
        valueSha256,
      });
      notificationItems.push({ code: field.code, name: productName });
      continue;
    }
    const resolution = manualNoticeResolution(input, field, duplicateCodes, nowMs);
    if (resolution.blocker) blockers.push(resolution.blocker);
    else if (resolution.receipt && resolution.value) {
      resolved.push(resolution.receipt);
      notificationItems.push({ code: field.code, name: resolution.value });
    }
  }

  const state = blockers.length === 0 ? "ready" : "blocked";
  return {
    contract: "sellerpilot_elevenst_new_product_preflight_v1",
    state,
    canCreate: state === "ready",
    categoryId: elevenstProcessedFoodCategoryId,
    notificationType: elevenstProcessedFoodNoticeType,
    requiredNoticeCount: elevenstProcessedFoodNotificationFields.length,
    resolvedNoticeCount: resolved.length,
    resolved,
    blockers,
    productNotification: state === "ready"
      ? { type: elevenstProcessedFoodNoticeType, item: notificationItems }
      : null,
  };
}
