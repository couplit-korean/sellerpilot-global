import { constants } from "node:fs";
import { open, lstat, realpath, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

const DEFAULT_MAXIMUM_JSON_ARTIFACT_BYTES = 4 * 1024 * 1024;
const JSON_ARTIFACT_ATTEMPTS = 2;
const PRIVATE_FILE_MODE = 0o600;
const RETRYABLE_ARTIFACT_CODES = new Set([
  "ARTIFACT_MISSING",
  "ARTIFACT_EMPTY",
  "ARTIFACT_JSON",
]);

const artifactMessages = Object.freeze({
  ARTIFACT_MISSING: "Codex JSON 결과 파일이 생성되지 않았습니다.",
  ARTIFACT_EMPTY: "Codex JSON 결과 파일이 비어 있습니다.",
  ARTIFACT_OVERSIZE: "Codex JSON 결과 파일이 안전한 크기 한도를 초과했습니다.",
  ARTIFACT_UNSAFE: "Codex JSON 결과 파일이 안전한 일반 파일이 아닙니다.",
  ARTIFACT_CHANGED: "Codex JSON 결과 파일이 검증 도중 변경됐습니다.",
  ARTIFACT_UTF8: "Codex JSON 결과 파일의 문자 인코딩이 올바르지 않습니다.",
  ARTIFACT_JSON: "Codex JSON 결과 파일이 올바른 JSON이 아닙니다.",
});

export class CodexJsonArtifactError extends Error {
  constructor(code) {
    super(artifactMessages[code] ?? "Codex JSON 결과 파일을 안전하게 확인하지 못했습니다.");
    this.name = "CodexJsonArtifactError";
    this.code = code;
  }
}

function artifactError(code) {
  return new CodexJsonArtifactError(code);
}

function isMissing(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

function isArtifactError(error) {
  return error instanceof CodexJsonArtifactError;
}

function isRetryableArtifactError(error) {
  return isArtifactError(error) && RETRYABLE_ARTIFACT_CODES.has(error.code);
}

function assertMaximumBytes(maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes는 1 이상의 안전한 정수여야 합니다.");
  }
}

function sameStatIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameParentIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function captureParent(parentPath) {
  const parentStats = await lstat(parentPath, { bigint: true });
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw artifactError("ARTIFACT_UNSAFE");
  }
  return {
    path: parentPath,
    realPath: await realpath(parentPath),
    stats: parentStats,
  };
}

async function assertParentStable(parent) {
  let currentStats;
  let currentRealPath;
  try {
    [currentStats, currentRealPath] = await Promise.all([
      lstat(parent.path, { bigint: true }),
      realpath(parent.path),
    ]);
  } catch (error) {
    if (isMissing(error)) throw artifactError("ARTIFACT_UNSAFE");
    throw error;
  }
  if (!currentStats.isDirectory()
      || currentStats.isSymbolicLink()
      || currentRealPath !== parent.realPath
      || !sameParentIdentity(parent.stats, currentStats)) {
    throw artifactError("ARTIFACT_UNSAFE");
  }
}

async function allocateCandidatePath(parentPath, attempt) {
  for (let allocation = 0; allocation < 10; allocation += 1) {
    const candidatePath = join(parentPath, `.codex-json-${randomUUID()}.attempt-${attempt}.json`);
    try {
      await lstat(candidatePath);
    } catch (error) {
      if (isMissing(error)) return candidatePath;
      throw error;
    }
  }
  throw new Error("Codex JSON 결과 파일 경로를 안전하게 준비하지 못했습니다.");
}

async function readBoundedFile(handle, expectedSize, maximumBytes) {
  const buffer = Buffer.allocUnsafe(Number(expectedSize));
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  const overflow = Buffer.allocUnsafe(1);
  const { bytesRead: overflowBytes } = await handle.read(overflow, 0, 1, null);
  if (overflowBytes > 0 || offset > maximumBytes) throw artifactError("ARTIFACT_OVERSIZE");
  if (offset !== buffer.length) throw artifactError("ARTIFACT_CHANGED");
  return buffer;
}

async function readAndParseCandidate(candidatePath, parent, maximumBytes) {
  let candidateStats;
  try {
    candidateStats = await lstat(candidatePath, { bigint: true });
  } catch (error) {
    if (isMissing(error)) throw artifactError("ARTIFACT_MISSING");
    throw error;
  }
  if (!candidateStats.isFile() || candidateStats.isSymbolicLink() || candidateStats.nlink !== 1n) {
    throw artifactError("ARTIFACT_UNSAFE");
  }
  if (candidateStats.size === 0n) throw artifactError("ARTIFACT_EMPTY");
  if (candidateStats.size > BigInt(maximumBytes)) throw artifactError("ARTIFACT_OVERSIZE");

  let candidateRealPath;
  try {
    candidateRealPath = await realpath(candidatePath);
  } catch (error) {
    if (isMissing(error)) throw artifactError("ARTIFACT_CHANGED");
    throw error;
  }
  await assertParentStable(parent);
  if (dirname(candidateRealPath) !== parent.realPath) throw artifactError("ARTIFACT_UNSAFE");

  let handle;
  try {
    handle = await open(candidatePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isMissing(error) || error?.code === "ELOOP") throw artifactError("ARTIFACT_CHANGED");
    throw error;
  }
  let bytes;
  try {
    const openedStats = await handle.stat({ bigint: true });
    if (!openedStats.isFile()
        || openedStats.nlink !== 1n
        || !sameStatIdentity(candidateStats, openedStats)) {
      throw artifactError("ARTIFACT_CHANGED");
    }
    bytes = await readBoundedFile(handle, openedStats.size, maximumBytes);
    const afterReadStats = await handle.stat({ bigint: true });
    if (!sameStatIdentity(openedStats, afterReadStats)) throw artifactError("ARTIFACT_CHANGED");
  } finally {
    await handle.close();
  }
  await assertParentStable(parent);

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw artifactError("ARTIFACT_UTF8");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw artifactError("ARTIFACT_JSON");
  }
  return { bytes, value };
}

async function promoteCandidate(bytes, canonicalPath, parent) {
  const temporaryPath = join(parent.path, `.codex-json-promote-${randomUUID()}.tmp`);
  let temporaryHandle;
  try {
    await assertParentStable(parent);
    temporaryHandle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    await temporaryHandle.chmod(PRIVATE_FILE_MODE);
    await temporaryHandle.writeFile(bytes);
    await temporaryHandle.sync();
    const temporaryStats = await temporaryHandle.stat({ bigint: true });
    const temporaryRealPath = await realpath(temporaryPath);
    if (!temporaryStats.isFile()
        || temporaryStats.nlink !== 1n
        || temporaryStats.size !== BigInt(bytes.length)
        || (temporaryStats.mode & 0o777n) !== 0o600n
        || dirname(temporaryRealPath) !== parent.realPath) {
      throw artifactError("ARTIFACT_UNSAFE");
    }
    await temporaryHandle.close();
    temporaryHandle = null;
    await assertParentStable(parent);
    await rename(temporaryPath, canonicalPath);
  } finally {
    if (temporaryHandle) await temporaryHandle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function cleanCandidate(candidatePath) {
  await rm(candidatePath, { force: true, recursive: true, maxRetries: 0 }).catch(() => {});
}

/**
 * Runs Codex against a unique output path, validates the JSON artifact, and only
 * then atomically replaces the canonical result. Runner failures are not retried
 * unless a caller supplies a narrow retryRunError predicate. Artifact and opted-
 * in runner retries share the same two-attempt ceiling.
 */
export async function runCodexJsonArtifact({
  canonicalPath,
  runAttempt,
  maximumBytes = DEFAULT_MAXIMUM_JSON_ARTIFACT_BYTES,
  maximumAttempts = JSON_ARTIFACT_ATTEMPTS,
  retryRunError,
}) {
  if (typeof canonicalPath !== "string" || canonicalPath.length === 0) {
    throw new TypeError("canonicalPath가 필요합니다.");
  }
  if (typeof runAttempt !== "function") throw new TypeError("runAttempt 함수가 필요합니다.");
  if (retryRunError !== undefined && typeof retryRunError !== "function") {
    throw new TypeError("retryRunError 함수가 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > JSON_ARTIFACT_ATTEMPTS) {
    throw new TypeError("maximumAttempts는 1 또는 2여야 합니다.");
  }
  assertMaximumBytes(maximumBytes);

  const resolvedCanonicalPath = resolve(canonicalPath);
  const parent = await captureParent(dirname(resolvedCanonicalPath));
  let lastArtifactError = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const candidatePath = await allocateCandidatePath(parent.path, attempt);
    try {
      const runResult = await runAttempt(Object.freeze({ candidatePath, attempt }));
      const artifact = await readAndParseCandidate(candidatePath, parent, maximumBytes);
      await promoteCandidate(artifact.bytes, resolvedCanonicalPath, parent);
      return Object.freeze({
        value: artifact.value,
        artifactPath: resolvedCanonicalPath,
        attempt,
        runResult,
      });
    } catch (error) {
      const retryableArtifact = isRetryableArtifactError(error);
      const retryableRunner = !isArtifactError(error)
        && retryRunError?.(error, attempt) === true;
      if (!retryableArtifact && !retryableRunner) throw error;
      lastArtifactError = error;
      if (attempt === maximumAttempts) throw error;
    } finally {
      await cleanCandidate(candidatePath);
    }
  }
  throw lastArtifactError;
}

export const codexJsonArtifactMaximumBytes = DEFAULT_MAXIMUM_JSON_ARTIFACT_BYTES;
