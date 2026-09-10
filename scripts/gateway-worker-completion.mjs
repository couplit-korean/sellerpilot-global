import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const maximumCompletionErrorLength = 500;
const sensitiveKey = /authorization|cookie|credential|password|secret|signature|token/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function boundedGatewayCompletionError(value, fallback = "CHANNEL_OPERATION_FAILED") {
  const message = typeof value === "string" ? value.trim() : "";
  return (message || fallback).slice(0, maximumCompletionErrorLength);
}

function journalDirectory(override) {
  const configured = override ?? process.env.SELLERPILOT_GATEWAY_COMPLETION_JOURNAL_DIR?.trim();
  if (configured) return resolve(configured);
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "SellerPilot", "completion-journal")
    : join(homedir(), ".sellerpilot", "completion-journal");
}

function privateJson(value) {
  const serialized = JSON.stringify(value, (key, child) => {
    if (key && sensitiveKey.test(key)) return undefined;
    return child;
  });
  if (!serialized) throw new Error("GATEWAY_COMPLETION_JOURNAL_INVALID");
  return JSON.parse(serialized);
}

export function smartstoreListingUpdateCompletionJournal(payload, recordedAt = new Date().toISOString()) {
  const result = payload?.result;
  if (!uuid.test(String(payload?.jobId ?? ""))
      || !uuid.test(String(payload?.claimToken ?? ""))
      || !result || typeof result !== "object" || Array.isArray(result)
      || result.channel !== "smartstore" || result.operation !== "listing.update") {
    return null;
  }
  if (payload.status === "succeeded"
      && result.evidence?.contract !== "smartstore_existing_content_repair_result_v1") {
    return null;
  }
  return privateJson({
    contract: "sellerpilot_gateway_completion_journal_v1",
    recordedAt,
    job: {
      id: payload.jobId,
      channel: "smartstore",
      operation: "listing.update",
    },
    claim: { id: payload.claimToken },
    completionStatus: payload.status,
    completionError: payload.error === undefined
      ? undefined
      : boundedGatewayCompletionError(payload.error),
    result,
  });
}

export function smartstoreListingUpdateCompletionEvidenceStored(payload, responseBody) {
  return payload?.status === "succeeded"
    && responseBody?.completionStatus === "verification_queued"
    && responseBody?.durableEvidenceStored === true;
}

export async function stageSmartstoreListingUpdateCompletionJournal(payload, options = {}) {
  const entry = smartstoreListingUpdateCompletionJournal(payload, options.recordedAt);
  if (!entry) return null;
  const directory = journalDirectory(options.directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const directoryState = await lstat(directory);
  if (!directoryState.isDirectory() || directoryState.isSymbolicLink()) {
    throw new Error("GATEWAY_COMPLETION_JOURNAL_DIRECTORY_UNSAFE");
  }
  const target = join(directory, `${entry.job.id}.json`);
  const temporary = join(directory, `.${entry.job.id}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
    const targetState = await lstat(target);
    if (!targetState.isFile() || targetState.isSymbolicLink()
        || (targetState.mode & 0o777) !== 0o600) {
      throw new Error("GATEWAY_COMPLETION_JOURNAL_FILE_UNSAFE");
    }
    return target;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function clearSmartstoreListingUpdateCompletionJournal(path) {
  if (typeof path === "string" && path) await rm(path, { force: true });
}
