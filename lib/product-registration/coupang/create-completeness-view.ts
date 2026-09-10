import type { RegistrationPatch, RegistrationValue } from "../../channel-registration-form";

export const coupangCreateCompletenessViewContract =
  "sellerpilot_coupang_create_completeness_view_v1" as const;

export const coupangCreateCompletenessKeys = [
  "create_lineage",
  "category",
  "title",
  "brand",
  "options",
  "external_vendor_sku",
  "price",
  "stock",
  "unit",
  "attributes",
  "notices",
  "certifications",
  "outbound_shipping_place",
  "return_center",
  "carrier",
  "fees",
  "representative_image",
  "approved_detail_images",
  "credential_revision",
] as const;

export type CoupangCreateCompletenessKey =
  typeof coupangCreateCompletenessKeys[number];

export type CoupangCreateCompletenessStatus =
  | "resolved"
  | "manual_required"
  | "provider_read_required"
  | "blocked";

export type CoupangCreateObservedTuple = {
  productId: string;
  credentialId: string;
  credentialVersion?: number;
  categoryId: string;
  sourceFingerprint: string;
  draftFingerprint?: string;
  requestSha256?: string;
  observedAt?: string;
};

export type CoupangCreateExpectedTuple = Pick<CoupangCreateObservedTuple,
  "productId" | "credentialId" | "categoryId" | "sourceFingerprint"
> & { credentialVersion?: number };

export type CoupangCreateCompletenessViewRow = {
  key: CoupangCreateCompletenessKey;
  label: string;
  message: string;
  status: CoupangCreateCompletenessStatus;
  statusLabel: string;
  fieldPaths: string[];
  fieldPathLabel: string;
  selectedSource: string | null;
  selectedSourceLabel: string;
};

export type CoupangCreateCompletenessValidation = {
  canBindCreateSourceRevision: boolean;
  blockingFieldKeys: CoupangCreateCompletenessKey[];
  observedTuple: CoupangCreateObservedTuple | null;
};

export type CoupangCreateCompletenessView = {
  contract: typeof coupangCreateCompletenessViewContract;
  rows: CoupangCreateCompletenessViewRow[];
  autoFillPatches: RegistrationPatch[];
  validation: CoupangCreateCompletenessValidation;
};

type UnknownRecord = Record<string, unknown>;

const statusLabels: Record<CoupangCreateCompletenessStatus, string> = {
  resolved: "확인됨",
  manual_required: "직접 입력 필요",
  provider_read_required: "쿠팡 공식 조회 필요",
  blocked: "등록 차단",
};

const sourceLabels: Record<string, string> = {
  "publish_context.confirmed_assignment": "확정 카테고리",
  "publish_context.product": "상품 원장",
  "seller_confirmed.body": "판매자 확인 입력",
  "seller_confirmed.option_rows": "판매자 확인 옵션",
  "provider.category_metadata": "쿠팡 카테고리 메타데이터",
  "provider.category_status": "쿠팡 카테고리 상태",
  "provider.outbound_shipping_places": "쿠팡 출고지",
  "provider.return_centers": "쿠팡 반품지",
  approved_detail_manifest: "승인 상세 이미지 원장",
  "server.active_credential_revision": "서버 활성 인증 revision",
};

const statuses = new Set<CoupangCreateCompletenessStatus>(
  Object.keys(statusLabels) as CoupangCreateCompletenessStatus[],
);
const keys = new Set<CoupangCreateCompletenessKey>(coupangCreateCompletenessKeys);
const forbiddenKey = /(?:access.?key|secret|token|password|signature)/iu;
const forbiddenPathPart = /^(?:__proto__|prototype|constructor)$/u;
const koreanText = /[가-힣]/u;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as UnknownRecord)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function coupangCreateReadinessRequestIdentity(input: {
  tuple: CoupangCreateExpectedTuple;
  draft: unknown;
}): string {
  const serialized = canonical({ ...input.tuple, draft: input.draft });
  // This identity is only a client-side stale-response discriminator. Keep the
  // draft itself out of React state/refs; the server independently verifies the
  // authoritative source and request SHA before returning readiness.
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${serialized.length}:${left.toString(16).padStart(8, "0")}:${right.toString(16).padStart(8, "0")}`;
}

export function coupangCreateReadinessResponseIsCurrent(input: {
  latestIdentity: string;
  requestIdentity: string;
  aborted: boolean;
}) {
  return !input.aborted && input.latestIdentity === input.requestIdentity;
}

function tupleFrom(value: unknown): CoupangCreateObservedTuple | null {
  const source = record(value);
  if (!source) return null;
  const tuple: CoupangCreateObservedTuple = {
    productId: text(source.productId),
    credentialId: text(source.credentialId),
    categoryId: text(source.categoryId),
    sourceFingerprint: text(source.sourceFingerprint),
  };
  if (!tuple.productId || !tuple.credentialId || !tuple.categoryId || !tuple.sourceFingerprint) {
    return null;
  }
  const draftFingerprint = text(source.draftFingerprint);
  const requestSha256 = text(source.requestSha256);
  const observedAt = text(source.observedAt);
  const credentialVersion = Number(source.credentialVersion);
  if (Number.isSafeInteger(credentialVersion) && credentialVersion > 0) {
    tuple.credentialVersion = credentialVersion;
  }
  if (draftFingerprint) tuple.draftFingerprint = draftFingerprint;
  if (requestSha256) tuple.requestSha256 = requestSha256;
  if (observedAt) tuple.observedAt = observedAt;
  return tuple;
}

function tupleMatches(
  observed: CoupangCreateObservedTuple,
  expected: CoupangCreateExpectedTuple,
): boolean {
  return observed.productId === expected.productId
    && observed.credentialId === expected.credentialId
    && (expected.credentialVersion === undefined
      || observed.credentialVersion === expected.credentialVersion)
    && observed.categoryId === expected.categoryId
    && observed.sourceFingerprint === expected.sourceFingerprint;
}

function registrationValue(value: unknown, depth = 0): RegistrationValue | undefined {
  if (depth > 16 || value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const children = value.map((child) => registrationValue(child, depth + 1));
    return children.some((child) => child === undefined)
      ? undefined
      : children as RegistrationValue[];
  }
  const source = record(value);
  if (!source) return undefined;
  const output: Record<string, RegistrationValue> = {};
  for (const [key, child] of Object.entries(source)) {
    if (forbiddenPathPart.test(key) || forbiddenKey.test(key)) return undefined;
    const safeChild = registrationValue(child, depth + 1);
    if (safeChild === undefined) return undefined;
    output[key] = safeChild;
  }
  return output;
}

function autoFillPatchesFrom(value: unknown): RegistrationPatch[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const patches: RegistrationPatch[] = [];
  for (const candidate of value) {
    const source = record(candidate);
    if (!source || !Array.isArray(source.path) || source.path.length < 2 || source.path.length > 16) {
      return null;
    }
    const path = source.path.map(text);
    if (path.some((part) => !part || forbiddenPathPart.test(part) || forbiddenKey.test(part))) {
      return null;
    }
    const valueAtPath = registrationValue(source.value);
    if (valueAtPath === undefined) return null;
    patches.push({ path, value: valueAtPath });
  }
  return patches;
}

function blockedValidation(): CoupangCreateCompletenessValidation {
  return {
    canBindCreateSourceRevision: false,
    blockingFieldKeys: [...coupangCreateCompletenessKeys],
    observedTuple: null,
  };
}

export function emptyCoupangCreateCompletenessValidation():
  CoupangCreateCompletenessValidation {
  return blockedValidation();
}

export function mapCoupangCreateCompletenessView(
  payload: unknown,
  expectedTuple: CoupangCreateExpectedTuple,
): CoupangCreateCompletenessView | null {
  const envelope = record(payload);
  const completeness = record(envelope?.completeness);
  const observedTuple = tupleFrom(envelope?.observedTuple);
  if (!envelope || !completeness || !observedTuple
    || !tupleMatches(observedTuple, expectedTuple)
    || completeness.contract !== "sellerpilot_coupang_create_completeness_v1"
    || !Array.isArray(completeness.fields)) return null;

  const rows: CoupangCreateCompletenessViewRow[] = [];
  for (const [index, candidate] of completeness.fields.entries()) {
    const source = record(candidate);
    const key = text(source?.key) as CoupangCreateCompletenessKey;
    const status = text(source?.status) as CoupangCreateCompletenessStatus;
    const label = text(source?.label);
    const message = text(source?.message);
    const fieldPaths = Array.isArray(source?.fieldPaths)
      ? source.fieldPaths.map(text).filter(Boolean)
      : [];
    const selectedSource = source?.selectedSource === null
      ? null
      : text(source?.selectedSource);
    if (!source || index >= coupangCreateCompletenessKeys.length
      || key !== coupangCreateCompletenessKeys[index]
      || !keys.has(key) || !statuses.has(status) || !label || !message
      || !koreanText.test(label) || !koreanText.test(message)
      || fieldPaths.length === 0
      || (source.selectedSource !== null
        && (!selectedSource || !Object.hasOwn(sourceLabels, selectedSource)))) return null;
    rows.push({
      key,
      label,
      message,
      status,
      statusLabel: statusLabels[status],
      fieldPaths,
      fieldPathLabel: fieldPaths.join(" · "),
      selectedSource,
      selectedSourceLabel: selectedSource
        ? sourceLabels[selectedSource] ?? selectedSource
        : "현재 값 출처 없음",
    });
  }
  if (rows.length !== coupangCreateCompletenessKeys.length) return null;

  const blockingFieldKeys = Array.isArray(completeness.blockingFieldKeys)
    ? completeness.blockingFieldKeys.map(text) as CoupangCreateCompletenessKey[]
    : [];
  const derivedBlockingKeys = rows
    .filter((row) => row.status !== "resolved")
    .map((row) => row.key);
  if (blockingFieldKeys.some((key) => !keys.has(key))
    || canonical(blockingFieldKeys) !== canonical(derivedBlockingKeys)
    || typeof completeness.canBindCreateSourceRevision !== "boolean"
    || completeness.canBindCreateSourceRevision !== (derivedBlockingKeys.length === 0)) return null;
  const autoFillPatches = autoFillPatchesFrom(envelope.autoFillPatches);
  if (!autoFillPatches) return null;
  return {
    contract: coupangCreateCompletenessViewContract,
    rows,
    autoFillPatches,
    validation: {
      canBindCreateSourceRevision: completeness.canBindCreateSourceRevision,
      blockingFieldKeys: derivedBlockingKeys,
      observedTuple,
    },
  };
}
