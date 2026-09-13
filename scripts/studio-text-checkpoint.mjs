import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";

const version = 1;
const maxBodyBytes = 8 * 1024 * 1024;
const maxFileBytes = 12 * 1024 * 1024;
const shaPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const identityKeys = ["jobId", "ownerId", "requestSha256", "sourcePhotosSha256", "preparedManifestSha256"];
const noFollow = constants.O_NOFOLLOW;
const fail = () => { throw new Error("STUDIO_TEXT_CHECKPOINT_INVALID"); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const owned = (stat) => typeof process.getuid !== "function" || stat.uid === process.getuid();
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;

function identityValue(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== identityKeys.length) return fail();
  const value = {};
  for (const key of identityKeys) {
    if (typeof input[key] !== "string"
        || !(key === "jobId" || key === "ownerId" ? uuidPattern : shaPattern).test(input[key])) return fail();
    value[key] = input[key];
  }
  return value;
}

function options(input) {
  if (typeof input?.cacheDir !== "string" || !isAbsolute(input.cacheDir)
      || typeof noFollow !== "number" || typeof input.validateResult !== "function"
      || !(input.hmacKey instanceof Uint8Array) || input.hmacKey.byteLength < 32) return fail();
  const cacheDir = resolve(input.cacheDir);
  // Accept only a caller-selected local runtime cache. Never create a default
  // in the checkout, jobDir, Documents, Desktop, or a cloud storage mount.
  if (cacheDir === parse(cacheDir).root
      || /(?:^|\/)(?:Documents|Desktop|Mobile Documents|CloudStorage|iCloud Drive|Dropbox|OneDrive)(?:\/|$)/i.test(cacheDir)) return fail();
  const identity = identityValue(input.identity);
  const identityDigest = sha256(JSON.stringify(identity));
  return { cacheDir, identity, identityDigest, key: Buffer.from(input.hmacKey),
    path: join(cacheDir, `studio-text-${identityDigest}.json`) };
}

async function privateDirectory(path, create) {
  let current = parse(path).root;
  for (const component of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    let stat = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat && !create) throw Object.assign(new Error("STUDIO_TEXT_CHECKPOINT_MISSING"), { code: "ENOENT" });
    if (!stat && create) {
      await mkdir(current, { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      stat = await lstat(current);
    }
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return fail();
  }
  const stat = await lstat(path);
  if (!owned(stat) || (stat.mode & 0o777) !== 0o700 || await realpath(path) !== path) return fail();
  return stat;
}

function privateFile(stat) {
  return stat.isFile() && stat.nlink === 1 && owned(stat)
    && (stat.mode & 0o777) === 0o600 && stat.size <= maxFileBytes;
}

async function existingPrivateFile(path) {
  const stat = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (stat && !privateFile(stat)) return fail();
  return stat;
}

const signature = (key, identityDigest, digest, body) => createHmac("sha256", key)
  .update(`sellerpilot-studio-text/${version}\n${identityDigest}\n${digest}\n${body}`).digest("hex");
const equalHex = (left, right) => typeof left === "string" && shaPattern.test(left)
  && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));

/** Store only schema-validated Studio text. Identity hashes are computed by the
 * caller from stable text inputs, all ordered source digests and the manifest;
 * rotating signed URLs and claim tokens must not be included in those hashes.
 * This receipt never attests that image/label/composite validation has passed. */
export async function writeStudioTextCheckpoint(input) {
  const config = options(input);
  const serialized = JSON.stringify(input.result);
  if (typeof serialized !== "string" || Buffer.byteLength(serialized) > maxBodyBytes) return fail();
  const parsed = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || await input.validateResult(parsed) !== true) return fail();
  const bytes = Buffer.from(serialized, "utf8");
  const digest = sha256(bytes);
  const body = bytes.toString("base64");
  const envelope = Buffer.from(JSON.stringify({ version, identity: config.identity, digest, body,
    mac: signature(config.key, config.identityDigest, digest, body) }), "utf8");
  if (envelope.length > maxFileBytes) return fail();
  const directory = await privateDirectory(config.cacheDir, true);
  await existingPrivateFile(config.path);
  const temporary = join(config.cacheDir, `.studio-text-${randomUUID()}.tmp`);
  let handle;
  let temporaryStat;
  let published = false;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
    temporaryStat = await handle.stat();
    if (!privateFile(temporaryStat)) return fail();
    await handle.writeFile(envelope);
    await handle.sync();
    if (!privateFile(await handle.stat())) return fail();
    await handle.close();
    handle = undefined;
    if (!sameFile(directory, await privateDirectory(config.cacheDir, false))) return fail();
    await existingPrivateFile(config.path);
    const staged = await lstat(temporary);
    if (!privateFile(staged) || !sameFile(temporaryStat, staged)) return fail();
    await rename(temporary, config.path);
    published = true;
    // Flush the directory entry as well as the body before acknowledging save.
    const dirHandle = await open(config.cacheDir, constants.O_RDONLY | constants.O_DIRECTORY | noFollow);
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    return { path: config.path, digest };
  } finally {
    await handle?.close().catch(() => {});
    if (!published && temporaryStat) {
      const remaining = await lstat(temporary).catch(() => null);
      if (remaining && sameFile(temporaryStat, remaining)) await unlink(temporary).catch(() => {});
    }
  }
}

/** Only absent files are cache misses. Existing but invalid files stop reuse
 * and generation; never silently replace rejected text or switch jobs. */
export async function readStudioTextCheckpoint(input) {
  let handle;
  let found = false;
  try {
    const config = options(input);
    const directory = await privateDirectory(config.cacheDir, false);
    const before = await existingPrivateFile(config.path);
    if (!before) return null;
    found = true;
    if (before.size < 1) return fail();
    handle = await open(config.path, constants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (!privateFile(opened) || !sameFile(before, opened)) return fail();
    const bytes = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    const linked = await existingPrivateFile(config.path);
    if (length !== opened.size || !privateFile(after) || !linked
        || !sameFile(opened, linked) || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
        || !sameFile(directory, await privateDirectory(config.cacheDir, false))) return fail();
    const envelope = JSON.parse(bytes.subarray(0, length).toString("utf8"));
    if (!envelope || Object.keys(envelope).sort().join(",") !== "body,digest,identity,mac,version"
        || envelope.version !== version
        || JSON.stringify(identityValue(envelope.identity)) !== JSON.stringify(config.identity)
        || !shaPattern.test(envelope.digest) || typeof envelope.body !== "string"
        || !equalHex(envelope.mac, signature(config.key, config.identityDigest, envelope.digest, envelope.body))) return fail();
    const body = Buffer.from(envelope.body, "base64");
    if (body.length > maxBodyBytes || body.toString("base64") !== envelope.body
        || !equalHex(envelope.digest, sha256(body))) return fail();
    const result = JSON.parse(body.toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)
        || await input.validateResult(result) !== true) return fail();
    return { result, digest: envelope.digest };
  } catch (error) {
    if (!found && error?.code === "ENOENT") return null;
    return fail();
  }
  finally { await handle?.close().catch(() => {}); }
}
