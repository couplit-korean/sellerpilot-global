import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { readStudioTextCheckpoint, writeStudioTextCheckpoint } from "../../scripts/studio-text-checkpoint.mjs";

const validResult = (value) => Boolean(value && Object.keys(value).sort().join(",") === "localized,master"
  && typeof value.master === "string" && Array.isArray(value.localized)
  && value.localized.length === 9 && value.localized.every(item => typeof item === "string"));
const result = { master: "나랑드 500ml 상세 본문", localized: Array.from({ length: 9 }, (_, index) => `locale ${index} body`) };
const invalid = /STUDIO_TEXT_CHECKPOINT_INVALID/;

async function fixture(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), "studio-text-checkpoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    cacheDir: join(root, "cache"),
    identity: { jobId: "10000000-0000-4000-8000-000000000001", ownerId: "20000000-0000-4000-8000-000000000001",
      requestSha256: "a".repeat(64), sourcePhotosSha256: "b".repeat(64), preparedManifestSha256: "c".repeat(64) },
    hmacKey: Buffer.alloc(32, 7), validateResult: validResult,
  };
}

test("validated master plus nine locales survives unrelated jobDir cleanup with private modes and exact digest", async (t) => {
  const config = await fixture(t);
  assert.equal(await readStudioTextCheckpoint(config), null);
  const saved = await writeStudioTextCheckpoint({ ...config, result });
  const jobDir = join(dirname(config.cacheDir), "temporary-job");
  await mkdir(jobDir);
  await writeFile(join(jobDir, "partial-ocr.txt"), "failed after text completion");
  await rm(jobDir, { recursive: true });
  assert.equal((await lstat(config.cacheDir)).mode & 0o777, 0o700);
  assert.equal((await lstat(saved.path)).mode & 0o777, 0o600);
  assert.equal(saved.digest, createHash("sha256").update(JSON.stringify(result)).digest("hex"));
  assert.deepEqual(await readStudioTextCheckpoint(config), { result, digest: saved.digest });
  assert.deepEqual(await readdir(config.cacheDir), [saved.path.split("/").at(-1)]);
});

test("every identity dimension selects only its exact checkpoint and replay into another identity is rejected", async (t) => {
  const config = await fixture(t);
  const saved = await writeStudioTextCheckpoint({ ...config, result });
  for (const key of Object.keys(config.identity)) {
    const identity = { ...config.identity, [key]: key.endsWith("Id")
      ? "30000000-0000-4000-8000-000000000001" : "d".repeat(64) };
    const other = { ...config, identity };
    assert.equal(await readStudioTextCheckpoint(other), null);
    const otherSaved = await writeStudioTextCheckpoint({ ...other, result });
    await writeFile(otherSaved.path, await readFile(saved.path));
    await assert.rejects(readStudioTextCheckpoint(other), invalid);
  }
});

test("changed body, digest, HMAC or key is rejected before schema adoption", async (t) => {
  const config = await fixture(t);
  const saved = await writeStudioTextCheckpoint({ ...config, result });
  const original = await readFile(saved.path, "utf8");
  let schemaCalls = 0;
  const reader = { ...config, validateResult: () => { schemaCalls += 1; return true; } };
  for (const mutate of [
    value => { value.body = Buffer.from(JSON.stringify({ ...result, master: "changed" })).toString("base64"); },
    value => { value.digest = "f".repeat(64); },
    value => { value.mac = "f".repeat(64); },
    value => { value.version = 2; },
  ]) {
    const value = JSON.parse(original);
    mutate(value);
    await writeFile(saved.path, JSON.stringify(value));
    await assert.rejects(readStudioTextCheckpoint(reader), invalid);
  }
  await writeFile(saved.path, original);
  await assert.rejects(readStudioTextCheckpoint({ ...reader, hmacKey: Buffer.alloc(32, 8) }), invalid);
  assert.equal(schemaCalls, 0);
});

test("required schema validation rejects invalid writes and no longer valid stored text", async (t) => {
  const config = await fixture(t);
  await assert.rejects(writeStudioTextCheckpoint({ ...config, result: { master: "only master" } }), invalid);
  const saved = await writeStudioTextCheckpoint({ ...config, result });
  await assert.rejects(readStudioTextCheckpoint({ ...config, validateResult: () => false }), invalid);
  await assert.rejects(readStudioTextCheckpoint({ ...config, validateResult: () => {
    throw Object.assign(new Error("schema dependency absent"), { code: "ENOENT" });
  } }), invalid);
  assert.deepEqual(await readStudioTextCheckpoint(config), { result, digest: saved.digest });
});

test("symlink and hardlink files cannot be read or overwritten", async (t) => {
  for (const useLink of [symlink, link]) {
    const config = await fixture(t);
    const saved = await writeStudioTextCheckpoint({ ...config, result });
    const outside = join(dirname(config.cacheDir), "untouched.json");
    await writeFile(outside, await readFile(saved.path), { mode: 0o600 });
    await rm(saved.path);
    await useLink(outside, saved.path);
    const bytes = await readFile(outside);
    await assert.rejects(readStudioTextCheckpoint(config), invalid);
    await assert.rejects(writeStudioTextCheckpoint({ ...config, result }), invalid);
    assert.deepEqual(await readFile(outside), bytes);
  }
});

test("symlink directories, cloud paths and permissive existing files/directories are rejected", async (t) => {
  const config = await fixture(t);
  const actual = join(dirname(config.cacheDir), "actual");
  await mkdir(actual, { mode: 0o700 });
  await symlink(actual, config.cacheDir);
  await assert.rejects(writeStudioTextCheckpoint({ ...config, result }), invalid);
  await rm(config.cacheDir);
  for (const component of ["Documents", "Desktop", "CloudStorage", "Mobile Documents"]) {
    await assert.rejects(writeStudioTextCheckpoint({ ...config, cacheDir: join(dirname(config.cacheDir), component, "cache"), result }), invalid);
  }
  const saved = await writeStudioTextCheckpoint({ ...config, result });
  await chmod(saved.path, 0o644);
  await assert.rejects(readStudioTextCheckpoint(config), invalid);
  await chmod(saved.path, 0o600);
  await chmod(config.cacheDir, 0o755);
  await assert.rejects(readStudioTextCheckpoint(config), invalid);
  await assert.rejects(writeStudioTextCheckpoint({ ...config, result }), invalid);
});

test("oversized and malformed files fail without deleting the evidence", async (t) => {
  const config = await fixture(t);
  const saved = await writeStudioTextCheckpoint({ ...config, result });
  await truncate(saved.path, 13 * 1024 * 1024);
  await assert.rejects(readStudioTextCheckpoint(config), invalid);
  assert.equal((await lstat(saved.path)).size, 13 * 1024 * 1024);
  await writeFile(saved.path, "not json");
  await assert.rejects(readStudioTextCheckpoint(config), invalid);
  assert.equal(await readFile(saved.path, "utf8"), "not json");
  await assert.rejects(writeStudioTextCheckpoint({ ...config, result: { ...result, master: "x".repeat(9 * 1024 * 1024) } }), invalid);
});

test("atomic concurrent writes expose one complete authenticated value and leave no temporary files", async (t) => {
  const config = await fixture(t);
  await writeStudioTextCheckpoint({ ...config, result });
  const candidates = Array.from({ length: 8 }, (_, index) => ({ ...result, master: `verified master ${index}` }));
  await Promise.all(candidates.map(value => writeStudioTextCheckpoint({ ...config, result: value })));
  const recovered = await readStudioTextCheckpoint(config);
  assert.ok(candidates.some(value => value.master === recovered.result.master));
  assert.equal((await readdir(config.cacheDir)).length, 1);
});

test("missing identity fields, short keys and absent validators never authorize a cache", async (t) => {
  const config = await fixture(t);
  for (const override of [{ identity: { ...config.identity, sourcePhotosSha256: "" } },
    { identity: { ...config.identity, unexpected: "value" } }, { hmacKey: Buffer.alloc(31) }, { validateResult: undefined }]) {
    await assert.rejects(writeStudioTextCheckpoint({ ...config, ...override, result }), invalid);
    await assert.rejects(readStudioTextCheckpoint({ ...config, ...override }), invalid);
  }
});
