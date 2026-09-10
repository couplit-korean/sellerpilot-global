import { createHash } from "node:crypto";

export const coupangCreateOfficialReadEvidenceContract =
  "sellerpilot_coupang_create_official_read_evidence_v1" as const;
export const coupangCreateOfficialReadEvidenceMaximumAgeMs = 5 * 60 * 1_000;

type Row = Record<string, unknown>;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type CoupangCreateOfficialReadEvidence = {
  contract: typeof coupangCreateOfficialReadEvidenceContract;
  displayCategoryCode: number;
  environment: "sandbox" | "production";
  observedAt: string;
  categoryMetadataSha256: string;
  categoryStatusSha256: string;
  outboundShippingPlacesSha256: string;
  returnCentersSha256: string;
  evidenceSha256: string;
};

export const coupangCreateOfficialReadSnapshotPayloadContract =
  "sellerpilot_coupang_create_official_read_snapshot_payload_v1" as const;

export type CoupangCreateOfficialReadSnapshotPayload = {
  contract: typeof coupangCreateOfficialReadSnapshotPayloadContract;
  officialReadEvidence: CoupangCreateOfficialReadEvidence;
  normalizedReads: {
    categoryMetadata: Json;
    categoryStatus: Json;
    outboundShippingPlaces: Json;
    returnCenters: Json;
  };
};

const sha256 = /^[a-f0-9]{64}$/u;
const maximumFutureSkewMs = 5_000;

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row : null;
}

function compareUtf8(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: Json) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function normalizeJson(value: unknown, depth = 0): Json {
  if (depth > 24) throw new Error("COUPANG_CREATE_OFFICIAL_READ_INVALID");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item, depth + 1));
  const valueRow = row(value);
  if (!valueRow) throw new Error("COUPANG_CREATE_OFFICIAL_READ_INVALID");
  return Object.fromEntries(Object.entries(valueRow)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, normalizeJson(item, depth + 1)]));
}

function providerData(value: unknown): Json {
  const outer = row(value);
  if (!outer) throw new Error("COUPANG_CREATE_OFFICIAL_READ_INVALID");
  const response = row(outer.response);
  if ((response && response.ok !== true) || outer.ok === false || outer.error
      || (typeof outer.code === "string" && outer.code !== "SUCCESS")) {
    throw new Error("COUPANG_CREATE_OFFICIAL_READ_INVALID");
  }
  return normalizeJson(Object.hasOwn(outer, "data") ? outer.data : outer);
}

function evidenceCore(input: Omit<CoupangCreateOfficialReadEvidence, "evidenceSha256">): Json {
  return input as unknown as Json;
}

type OfficialReadInput = {
  displayCategoryCode: number;
  environment: "sandbox" | "production";
  now: Date;
  categoryMetadataRead: unknown;
  categoryStatusRead: unknown;
  outboundShippingPlacesRead: unknown;
  returnCentersRead: unknown;
};

function normalizedReads(input: OfficialReadInput) {
  return {
    categoryMetadata: providerData(input.categoryMetadataRead),
    categoryStatus: providerData(input.categoryStatusRead),
    outboundShippingPlaces: providerData(input.outboundShippingPlacesRead),
    returnCenters: providerData(input.returnCentersRead),
  };
}

export function buildCoupangCreateOfficialReadEvidence(
  input: OfficialReadInput,
): CoupangCreateOfficialReadEvidence {
  const observedAt = input.now.toISOString();
  if (!Number.isSafeInteger(input.displayCategoryCode) || input.displayCategoryCode < 1
      || !Number.isFinite(input.now.getTime())) {
    throw new Error("COUPANG_CREATE_OFFICIAL_READ_INVALID");
  }
  const reads = normalizedReads(input);
  const core = {
    contract: coupangCreateOfficialReadEvidenceContract,
    displayCategoryCode: input.displayCategoryCode,
    environment: input.environment,
    observedAt,
    categoryMetadataSha256: digest(reads.categoryMetadata),
    categoryStatusSha256: digest(reads.categoryStatus),
    outboundShippingPlacesSha256: digest(reads.outboundShippingPlaces),
    returnCentersSha256: digest(reads.returnCenters),
  };
  return { ...core, evidenceSha256: digest(evidenceCore(core)) };
}

export function buildCoupangCreateOfficialReadSnapshotPayload(
  input: OfficialReadInput,
): CoupangCreateOfficialReadSnapshotPayload {
  const reads = normalizedReads(input);
  const officialReadEvidence = buildCoupangCreateOfficialReadEvidence(input);
  const payload = {
    contract: coupangCreateOfficialReadSnapshotPayloadContract,
    officialReadEvidence,
    normalizedReads: reads,
  } satisfies CoupangCreateOfficialReadSnapshotPayload;
  if (JSON.stringify(payload).length > 512_000) {
    throw new Error("COUPANG_CREATE_OFFICIAL_READ_SNAPSHOT_TOO_LARGE");
  }
  return payload;
}

export function assertCoupangCreateOfficialReadEvidence(input: {
  value: unknown;
  displayCategoryCode: number;
  environment: "sandbox" | "production";
  now?: Date;
}): CoupangCreateOfficialReadEvidence {
  const value = row(input.value);
  const observedAt = typeof value?.observedAt === "string" ? Date.parse(value.observedAt) : Number.NaN;
  const now = (input.now ?? new Date()).getTime();
  const core = value ? {
    contract: value.contract,
    displayCategoryCode: value.displayCategoryCode,
    environment: value.environment,
    observedAt: value.observedAt,
    categoryMetadataSha256: value.categoryMetadataSha256,
    categoryStatusSha256: value.categoryStatusSha256,
    outboundShippingPlacesSha256: value.outboundShippingPlacesSha256,
    returnCentersSha256: value.returnCentersSha256,
  } : null;
  if (!value || Object.keys(value).length !== 9
      || value.contract !== coupangCreateOfficialReadEvidenceContract
      || value.displayCategoryCode !== input.displayCategoryCode
      || value.environment !== input.environment
      || !Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== value.observedAt
      || observedAt > now + maximumFutureSkewMs
      || observedAt < now - coupangCreateOfficialReadEvidenceMaximumAgeMs
      || !sha256.test(String(value.categoryMetadataSha256 ?? ""))
      || !sha256.test(String(value.categoryStatusSha256 ?? ""))
      || !sha256.test(String(value.outboundShippingPlacesSha256 ?? ""))
      || !sha256.test(String(value.returnCentersSha256 ?? ""))
      || value.evidenceSha256 !== digest(evidenceCore(core as Omit<CoupangCreateOfficialReadEvidence, "evidenceSha256">))) {
    throw new Error("COUPANG_CREATE_OFFICIAL_READ_MISMATCH");
  }
  return structuredClone(value) as CoupangCreateOfficialReadEvidence;
}
