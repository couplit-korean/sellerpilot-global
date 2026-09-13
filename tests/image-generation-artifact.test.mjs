import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, rm, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { adoptGeneratedImageFromInvocation as adopt, CodexImageArtifactError } from "../scripts/image-generation-artifact.mjs";

const sessionId = "01a09c2c-462e-7722-a9c3-cb6c1cfc07b1";
const otherSessionId = "01a09c2e-2e25-70e2-ac62-e50e75971b24";
const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "blue" } }).png().toBuffer();

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), "sellerpilot-image-artifact-test-"));
  const generatedImagesRoot = join(dir, "generated_images");
  const session = join(generatedImagesRoot, sessionId);
  const outputDirectory = join(dir, "job");
  await mkdir(session, { recursive: true });
  await mkdir(outputDirectory);
  const source = join(session, "exec-image.png");
  const args = {
    stdout: JSON.stringify({ type: "thread.started", thread_id: sessionId }) + "\n" + JSON.stringify({ type: "turn.completed", usage: {} }),
    outputFile: join(outputDirectory, "portrait.png"), expectedOutputDirectory: outputDirectory,
    generatedImagesRoot, startedAtMs: Date.now() - 1000, completedAtMs: Date.now() + 1000,
  };
  try { await run({ dir, session, source, args }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

const code = (expected) => (error) => error instanceof CodexImageArtifactError && error.code === expected;

test("adopts one fresh PNG from the exact invocation and records digest and geometry", async () => {
  await fixture(async ({ source, args }) => {
    await writeFile(source, png);
    const result = await adopt(args);
    assert.equal(result.adopted, true);
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.sha256, createHash("sha256").update(png).digest("hex"));
    assert.equal(result.width, 30);
    assert.equal(result.height, 20);
    assert.deepEqual(await readFile(args.outputFile), png);
    assert.equal((await lstat(args.outputFile)).mode & 0o777, 0o600);
  });
});

test("leaves an existing destination entirely to the caller's validator", async () => {
  await fixture(async ({ source, args }) => {
    await writeFile(source, png);
    await writeFile(args.outputFile, "existing");
    assert.deepEqual(await adopt({ ...args, stdout: "bad receipt" }), { adopted: false, reason: "destination-exists" });
    assert.equal(await readFile(args.outputFile, "utf8"), "existing");
  });
});

test("never searches another session when this invocation has no image", async () => {
  await fixture(async ({ args }) => {
    const other = join(args.generatedImagesRoot, otherSessionId);
    await mkdir(other);
    await writeFile(join(other, "only-image.png"), png);
    assert.equal((await adopt(args)).reason, "no-fresh-image");
    await assert.rejects(lstat(args.outputFile), { code: "ENOENT" });
  });
});

test("missing session receipt or session directory cannot adopt anything", async () => {
  await fixture(async ({ args }) => {
    assert.equal((await adopt({ ...args, stdout: "" })).reason, "missing-session-receipt");
    assert.equal((await adopt({ ...args, stdout: JSON.stringify({ type: "thread.started", thread_id: otherSessionId }) })).reason, "missing-session-directory");
  });
});

test("malformed, multiple or traversal session receipts are rejected", async () => {
  await fixture(async ({ args }) => {
    await assert.rejects(adopt({ ...args, stdout: "not json" }), code("INVALID_RECEIPT"));
    await assert.rejects(adopt({ ...args, stdout: args.stdout + "\n" + args.stdout }), code("INVALID_SESSION_RECEIPT"));
    await assert.rejects(adopt({ ...args, stdout: JSON.stringify({ type: "thread.started", thread_id: "../../elsewhere" }) }), code("INVALID_SESSION_RECEIPT"));
  });
});

test("past and future timestamps cannot be adopted", async () => {
  await fixture(async ({ source, args }) => {
    await writeFile(source, png);
    await utimes(source, new Date(args.startedAtMs - 5000), new Date(args.startedAtMs - 5000));
    assert.equal((await adopt(args)).reason, "no-fresh-image");
    await utimes(source, new Date(args.completedAtMs + 5000), new Date(args.completedAtMs + 5000));
    assert.equal((await adopt(args)).reason, "no-fresh-image");
  });
});

test("multiple fresh candidates fail without selecting an arbitrary image", async () => {
  await fixture(async ({ source, session, args }) => {
    await writeFile(source, png);
    await writeFile(join(session, "second.png"), png);
    await assert.rejects(adopt(args), code("AMBIGUOUS_IMAGE_ARTIFACT"));
  });
});

test("symlinked root, session and source are rejected", async () => {
  await fixture(async ({ dir, session, source, args }) => {
    const rootLink = join(dir, "root-link");
    await symlink(args.generatedImagesRoot, rootLink);
    await assert.rejects(adopt({ ...args, generatedImagesRoot: rootLink }), code("UNSAFE_DIRECTORY"));
    await rm(session, { recursive: true });
    const elsewhere = join(dir, "elsewhere");
    await mkdir(elsewhere);
    await symlink(elsewhere, session);
    await assert.rejects(adopt(args), code("UNSAFE_DIRECTORY"));
    await rm(session);
    await mkdir(session);
    const realImage = join(elsewhere, "image.png");
    await writeFile(realImage, png);
    await symlink(realImage, source);
    await assert.rejects(adopt(args), code("UNSAFE_SOURCE"));
  });
});

test("hard-linked and oversized source files are rejected before reading", async () => {
  await fixture(async ({ dir, source, args }) => {
    const realImage = join(dir, "real.png");
    await writeFile(realImage, png);
    await link(realImage, source);
    await assert.rejects(adopt(args), code("UNSAFE_SOURCE"));
    await rm(source);
    await writeFile(source, png);
    await truncate(source, 40 * 1024 * 1024 + 1);
    await assert.rejects(adopt(args), code("SOURCE_SIZE_INVALID"));
  });
});

test("empty, renamed non-PNG and truncated PNG are rejected", async () => {
  await fixture(async ({ source, args }) => {
    await writeFile(source, "");
    await assert.rejects(adopt(args), code("SOURCE_SIZE_INVALID"));
    await writeFile(source, await sharp(png).jpeg().toBuffer());
    await assert.rejects(adopt(args), code("INVALID_PNG"));
    await writeFile(source, png.subarray(0, 40));
    await assert.rejects(adopt(args), code("INVALID_PNG"));
  });
});

test("explicit output boundary and invocation time bounds are enforced", async () => {
  await fixture(async ({ dir, args }) => {
    await assert.rejects(adopt({ ...args, outputFile: join(dir, "escape.png") }), code("INVALID_ARGUMENTS"));
    await assert.rejects(adopt({ ...args, startedAtMs: args.completedAtMs + 1 }), code("INVALID_ARGUMENTS"));
    await assert.rejects(adopt({ ...args, completedAtMs: Infinity }), code("INVALID_ARGUMENTS"));
    await assert.rejects(adopt({ ...args, generatedImagesRoot: "relative" }), code("INVALID_ARGUMENTS"));
  });
});

test("simultaneous adopters cannot overwrite each other's destination", async () => {
  await fixture(async ({ source, args }) => {
    await writeFile(source, png);
    const results = await Promise.allSettled([adopt(args), adopt(args)]);
    assert.equal(results.filter((result) => result.status === "fulfilled" && result.value.adopted).length, 1);
    assert.deepEqual(await readFile(args.outputFile), png);
    for (const result of results) if (result.status === "rejected") assert.equal(result.reason.code, "EEXIST");
  });
});
