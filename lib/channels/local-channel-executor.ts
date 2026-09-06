import { createHash } from "node:crypto";

export const LOCAL_CHANNEL_EXECUTOR_CLAIM_MODE = "local_channel_executor" as const;
export const LOCAL_CHANNEL_EXECUTOR_CLAIM_RPC = "sellerpilot_claim_local_channel_executor_job" as const;
export const LOCAL_CHANNEL_EXECUTOR_READINESS_RPC = "sellerpilot_service_local_channel_executor_readiness" as const;
export const LOCAL_CHANNEL_EXECUTOR_CONTRACT = "local_channel_executor_readiness_v1" as const;

const releasePattern = /^[a-f0-9]{40}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const workerVersionPattern = /^sellerpilot-cli-worker\/1\.61\+([a-f0-9]{40})\.([a-f0-9]{11})$/u;

const readOnlyTuples = new Set([
  "coupang:categories.attributes",
  "coupang:categories.validate",
]);

const writeTuples = new Set([
  "coupang:listing.create",
  "smartstore:listing.create",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tuple(channel: string, operation: string) {
  return `${channel.trim().toLowerCase()}:${operation.trim().toLowerCase()}`;
}

export function localChannelExecutorAccess(channel: string, operation: string) {
  const key = tuple(channel, operation);
  if (readOnlyTuples.has(key)) return "read" as const;
  if (writeTuples.has(key)) return "write" as const;
  return null;
}

export function isLocalChannelExecutorTuple(channel: string, operation: string) {
  return localChannelExecutorAccess(channel, operation) !== null;
}

export function parseLocalChannelExecutorClaimMode(value: unknown) {
  return value === LOCAL_CHANNEL_EXECUTOR_CLAIM_MODE
    ? LOCAL_CHANNEL_EXECUTOR_CLAIM_MODE
    : null;
}

export function normalizeReleaseSha(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return releasePattern.test(normalized) ? normalized : null;
}

export function normalizeEgressIp(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 64 || /[\s,]/u.test(normalized)) return null;
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(normalized)
      && !/^[a-f0-9:]+$/u.test(normalized)) return null;
  if (normalized.includes(".")) {
    const octets = normalized.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return null;
    }
  }
  return normalized;
}

export function egressIpSha256(value: unknown) {
  const normalized = normalizeEgressIp(value);
  return normalized
    ? createHash("sha256").update(normalized, "utf8").digest("hex")
    : null;
}

export function vercelForwardedClientIp(headers: Headers) {
  const raw = headers.get("x-vercel-forwarded-for");
  if (!raw || raw.includes(",")) return null;
  return normalizeEgressIp(raw);
}

export function localExecutorWorkerVersion(releaseSha: unknown, egressSha256: unknown) {
  const release = normalizeReleaseSha(releaseSha);
  const egress = typeof egressSha256 === "string" ? egressSha256.trim().toLowerCase() : "";
  if (!release || !digestPattern.test(egress)) return null;
  return `sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}`;
}

export function parseLocalExecutorWorkerVersion(value: unknown) {
  if (typeof value !== "string") return null;
  const match = workerVersionPattern.exec(value.trim().toLowerCase());
  return match ? { releaseSha: match[1], egressSha256Prefix: match[2] } : null;
}

export type ExternalDetailApprovalBinding = {
  approvalRevision: number | null;
  contentSha256: string | null;
};

export function externalDetailApprovalBindingFromPublishContext(
  context: unknown,
): ExternalDetailApprovalBinding {
  const root = record(context);
  const importRow = record(root?.externalDetailImport);
  const snapshot = record(root?.externalDetailSnapshot);
  const revisionValues = [importRow?.approvalRevision, snapshot?.approvalRevision]
    .filter((value) => value !== undefined);
  const digestValues = [importRow?.contentSha256, snapshot?.contentSha256]
    .filter((value) => value !== undefined);
  if (![...revisionValues, ...digestValues].some((value) => value !== null)) {
    return { approvalRevision: null, contentSha256: null };
  }
  const approvalRevision = Number(revisionValues[0]);
  const contentSha256 = typeof digestValues[0] === "string"
    ? digestValues[0].trim().toLowerCase()
    : "";
  if (revisionValues.some((value) => Number(value) !== approvalRevision)
      || digestValues.some((value) => String(value).trim().toLowerCase() !== contentSha256)
      || !Number.isSafeInteger(approvalRevision)
      || approvalRevision < 1
      || !digestPattern.test(contentSha256)) {
    throw new Error("EXTERNAL_DETAIL_APPROVAL_REVISION_INVALID");
  }
  return { approvalRevision, contentSha256 };
}

export type LocalChannelExecutorReadiness = {
  contract: typeof LOCAL_CHANNEL_EXECUTOR_CONTRACT;
  ready: true;
  access: "read" | "write";
  channel: string;
  operation: string;
  credentialId: string;
  productId: string | null;
  releaseSha: string;
  approvalRevision: number | null;
  contentSha256: string | null;
};

export function parseLocalChannelExecutorReadiness(
  value: unknown,
  expected: Omit<LocalChannelExecutorReadiness, "contract" | "ready">,
): LocalChannelExecutorReadiness | null {
  const row = record(value);
  if (!row
      || row.contract !== LOCAL_CHANNEL_EXECUTOR_CONTRACT
      || row.ready !== true
      || row.access !== expected.access
      || row.channel !== expected.channel
      || row.operation !== expected.operation
      || row.credentialId !== expected.credentialId
      || (row.productId ?? null) !== expected.productId
      || row.releaseSha !== expected.releaseSha
      || (row.approvalRevision ?? null) !== expected.approvalRevision
      || (row.contentSha256 ?? null) !== expected.contentSha256) return null;
  return row as LocalChannelExecutorReadiness;
}
