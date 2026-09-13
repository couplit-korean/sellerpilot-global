import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import sharp from "sharp";

const MAXIMUM_BYTES = 40 * 1024 * 1024;
const MAXIMUM_PIXELS = 40_000_000;
const MAXIMUM_RECEIPT_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CodexImageArtifactError extends Error {
  constructor(code) {
    super(`Codex image artifact could not be safely adopted: ${code}`);
    this.name = "CodexImageArtifactError";
    this.code = code;
  }
}

function fail(code) { throw new CodexImageArtifactError(code); }
function missing(error) { return error?.code === "ENOENT"; }
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.nlink === b.nlink
    && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

async function directorySnapshot(path) {
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail("UNSAFE_DIRECTORY");
  return { path, realPath: await realpath(path), stats };
}

async function unchangedDirectory(snapshot) {
  const current = await directorySnapshot(snapshot.path);
  if (current.realPath !== snapshot.realPath || current.stats.dev !== snapshot.stats.dev
    || current.stats.ino !== snapshot.stats.ino) fail("DIRECTORY_CHANGED");
}

function invocationSession(stdout) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > MAXIMUM_RECEIPT_BYTES) fail("INVALID_RECEIPT");
  let sessionId = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { fail("INVALID_RECEIPT"); }
    if (event?.type !== "thread.started") continue;
    if (!UUID.test(event.thread_id ?? "") || sessionId !== null) fail("INVALID_SESSION_RECEIPT");
    sessionId = event.thread_id;
  }
  return sessionId;
}

/**
 * Only recover a missing destination from this invocation's documented JSONL
 * thread.started receipt and generated_images/<thread_id> directory. No search
 * of neighboring sessions or agent-provided arbitrary paths is permitted.
 * The caller still runs its normal image quality/identity validation afterward.
 */
export async function adoptGeneratedImageFromInvocation({
  stdout, outputFile, startedAtMs, completedAtMs,
  generatedImagesRoot = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "generated_images"),
  expectedOutputDirectory = dirname(outputFile),
}) {
  if (!isAbsolute(outputFile) || !isAbsolute(generatedImagesRoot) || !isAbsolute(expectedOutputDirectory)
    || resolve(dirname(outputFile)) !== resolve(expectedOutputDirectory)
    || !Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs) || startedAtMs > completedAtMs) fail("INVALID_ARGUMENTS");
  const destination = await directorySnapshot(expectedOutputDirectory);
  try {
    await lstat(outputFile);
    return { adopted: false, reason: "destination-exists" };
  } catch (error) { if (!missing(error)) throw error; }

  const sessionId = invocationSession(stdout);
  if (!sessionId) return { adopted: false, reason: "missing-session-receipt" };
  let root;
  let session;
  try {
    root = await directorySnapshot(generatedImagesRoot);
    session = await directorySnapshot(join(root.path, sessionId));
  } catch (error) {
    if (missing(error)) return { adopted: false, reason: "missing-session-directory", sessionId };
    throw error;
  }
  if (dirname(session.realPath) !== root.realPath) fail("SESSION_OUTSIDE_ROOT");
  const names = await readdir(session.path);
  const candidates = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".png")) continue;
    const path = join(session.path, name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) fail("UNSAFE_SOURCE");
    // Exact invocation time bounds, with only sub-millisecond clock rounding.
    if (stats.mtimeMs < startedAtMs || stats.mtimeMs >= completedAtMs + 1) continue;
    if (stats.birthtimeMs > 0 && (stats.birthtimeMs < startedAtMs || stats.birthtimeMs >= completedAtMs + 1)) continue;
    if (stats.size < 1 || stats.size > MAXIMUM_BYTES) fail("SOURCE_SIZE_INVALID");
    candidates.push({ path, stats });
  }
  if (candidates.length === 0) return { adopted: false, reason: "no-fresh-image", sessionId };
  if (candidates.length !== 1) fail("AMBIGUOUS_IMAGE_ARTIFACT");
  const source = candidates[0];
  await unchangedDirectory(root);
  await unchangedDirectory(session);
  if (dirname(await realpath(source.path)) !== session.realPath) fail("SOURCE_OUTSIDE_SESSION");
  const handle = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    if (!sameFile(source.stats, await handle.stat())) fail("SOURCE_CHANGED");
    // A growth race cannot cause an unbounded read.
    bytes = Buffer.alloc(source.stats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) fail("SOURCE_CHANGED");
      offset += bytesRead;
    }
    if (!sameFile(source.stats, await handle.stat())) fail("SOURCE_CHANGED");
  } finally { await handle.close(); }
  let metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: MAXIMUM_PIXELS, failOn: "warning" }).metadata();
    if (metadata.format !== "png" || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) fail("INVALID_PNG");
    // Decode all pixels so a plausible PNG header alone never passes.
    await sharp(bytes, { limitInputPixels: MAXIMUM_PIXELS, failOn: "warning" }).raw().toBuffer();
  } catch (error) {
    if (error instanceof CodexImageArtifactError) throw error;
    fail("INVALID_PNG");
  }
  await unchangedDirectory(root);
  await unchangedDirectory(session);
  await unchangedDirectory(destination);
  if (!sameFile(source.stats, await lstat(source.path))) fail("SOURCE_CHANGED");
  // O_EXCL never overwrites a concurrently produced destination, including links.
  const target = await open(outputFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await target.writeFile(bytes); } finally { await target.close(); }
  return {
    adopted: true, path: outputFile, sourcePath: source.path, sessionId,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length, width: metadata.width, height: metadata.height,
  };
}
