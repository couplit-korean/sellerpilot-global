import assert from "node:assert/strict";
import { chmod, link, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  CodexJsonArtifactError,
  runCodexJsonArtifact,
} from "../scripts/codex-json-artifact.mjs";

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "codex-json-artifact-test-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("valid JSON is atomically promoted with private permissions", async () => {
  await withTemporaryDirectory(async (directory) => {
    const canonicalPath = join(directory, "result.json");
    let receivedAttempt;
    const result = await runCodexJsonArtifact({
      canonicalPath,
      runAttempt: async (attempt) => {
        receivedAttempt = attempt;
        assert.equal(Object.isFrozen(attempt), true);
        assert.equal(dirname(attempt.candidatePath), directory);
        await writeFile(attempt.candidatePath, JSON.stringify({ ok: true }), { mode: 0o644 });
        return { exit: 0 };
      },
    });

    assert.deepEqual(result.value, { ok: true });
    assert.equal(result.attempt, 1);
    assert.deepEqual(result.runResult, { exit: 0 });
    assert.equal(result.artifactPath, canonicalPath);
    assert.deepEqual(JSON.parse(await readFile(canonicalPath, "utf8")), { ok: true });
    assert.equal((await lstat(canonicalPath)).mode & 0o777, 0o600);
    await assert.rejects(lstat(receivedAttempt.candidatePath), { code: "ENOENT" });
  });
});

test("one missing exit-zero artifact is retried without replacing the canonical file early", async () => {
  await withTemporaryDirectory(async (directory) => {
    const canonicalPath = join(directory, "result.json");
    await writeFile(canonicalPath, JSON.stringify({ previous: true }));
    const candidates = [];
    const result = await runCodexJsonArtifact({
      canonicalPath,
      runAttempt: async ({ candidatePath, attempt }) => {
        candidates.push(candidatePath);
        if (attempt === 1) return;
        assert.deepEqual(JSON.parse(await readFile(canonicalPath, "utf8")), { previous: true });
        await writeFile(candidatePath, JSON.stringify({ recovered: true }));
      },
    });

    assert.equal(result.attempt, 2);
    assert.notEqual(candidates[0], candidates[1]);
    assert.deepEqual(JSON.parse(await readFile(canonicalPath, "utf8")), { recovered: true });
    for (const candidate of candidates) await assert.rejects(lstat(candidate), { code: "ENOENT" });
  });
});

test("a runner rejection is propagated unchanged and is never retried", async () => {
  await withTemporaryDirectory(async (directory) => {
    const canonicalPath = join(directory, "result.json");
    const timeout = new Error("runner timeout");
    let attempts = 0;
    await assert.rejects(
      runCodexJsonArtifact({
        canonicalPath,
        runAttempt: async () => {
          attempts += 1;
          throw timeout;
        },
      }),
      (error) => error === timeout,
    );
    assert.equal(attempts, 1);
  });
});

test("two malformed artifacts fail with a sanitized error and preserve the canonical file", async () => {
  await withTemporaryDirectory(async (directory) => {
    const canonicalPath = join(directory, "result.json");
    const secret = "DO_NOT_LEAK_THIS_OUTPUT";
    await writeFile(canonicalPath, JSON.stringify({ previous: true }));
    let attempts = 0;
    let thrown;
    try {
      await runCodexJsonArtifact({
        canonicalPath,
        runAttempt: async ({ candidatePath }) => {
          attempts += 1;
          await writeFile(candidatePath, `{${secret}`);
        },
      });
    } catch (error) {
      thrown = error;
    }

    assert.equal(attempts, 2);
    assert.ok(thrown instanceof CodexJsonArtifactError);
    assert.equal(thrown.code, "ARTIFACT_JSON");
    assert.doesNotMatch(thrown.message, new RegExp(secret));
    assert.doesNotMatch(thrown.message, /codex-json-artifact-test-/);
    assert.deepEqual(JSON.parse(await readFile(canonicalPath, "utf8")), { previous: true });
  });
});

test("empty artifacts receive one retry, while oversize and invalid UTF-8 fail closed", async () => {
  const cases = [
    { name: "empty", bytes: Buffer.alloc(0), code: "ARTIFACT_EMPTY", maximumBytes: 32, attempts: 2 },
    { name: "oversized", bytes: Buffer.alloc(33, 0x61), code: "ARTIFACT_OVERSIZE", maximumBytes: 32, attempts: 1 },
    { name: "invalid UTF-8", bytes: Buffer.from([0xc3, 0x28]), code: "ARTIFACT_UTF8", maximumBytes: 32, attempts: 1 },
  ];
  for (const fixture of cases) {
    await withTemporaryDirectory(async (directory) => {
      let attempts = 0;
      await assert.rejects(
        runCodexJsonArtifact({
          canonicalPath: join(directory, `${fixture.name}.json`),
          maximumBytes: fixture.maximumBytes,
          runAttempt: async ({ candidatePath }) => {
            attempts += 1;
            await writeFile(candidatePath, fixture.bytes);
          },
        }),
        (error) => error instanceof CodexJsonArtifactError && error.code === fixture.code,
      );
      assert.equal(attempts, fixture.attempts);
    });
  }
});

test("symlinks and multiply-linked files fail closed before reading", async () => {
  await withTemporaryDirectory(async (directory) => {
    const outsidePath = join(directory, "outside.json");
    await writeFile(outsidePath, JSON.stringify({ secret: true }));
    const canonicalPath = join(directory, "result.json");
    let attempts = 0;
    await assert.rejects(
      runCodexJsonArtifact({
        canonicalPath,
        runAttempt: async ({ candidatePath }) => {
          attempts += 1;
          await symlink(outsidePath, candidatePath);
        },
      }),
      (error) => error instanceof CodexJsonArtifactError && error.code === "ARTIFACT_UNSAFE",
    );
    assert.equal(attempts, 1);
    assert.deepEqual(JSON.parse(await readFile(outsidePath, "utf8")), { secret: true });
  });

  await withTemporaryDirectory(async (directory) => {
    const linkedSource = join(directory, "linked-source.json");
    await writeFile(linkedSource, JSON.stringify({ linked: true }));
    let attempts = 0;
    await assert.rejects(
      runCodexJsonArtifact({
        canonicalPath: join(directory, "result.json"),
        runAttempt: async ({ candidatePath }) => {
          attempts += 1;
          await link(linkedSource, candidatePath);
        },
      }),
      (error) => error instanceof CodexJsonArtifactError && error.code === "ARTIFACT_UNSAFE",
    );
    assert.equal(attempts, 1);
    assert.equal((await lstat(linkedSource)).nlink, 1);
  });
});

test("argument validation fails before invoking a runner", async () => {
  let called = false;
  await assert.rejects(
    runCodexJsonArtifact({
      canonicalPath: "/unused/result.json",
      maximumBytes: 0,
      runAttempt: async () => { called = true; },
    }),
    /maximumBytes/,
  );
  assert.equal(called, false);

  await assert.rejects(
    runCodexJsonArtifact({ canonicalPath: "/unused/result.json", runAttempt: null }),
    /runAttempt/,
  );
});

test("a private replacement does not inherit permissive canonical permissions", async () => {
  await withTemporaryDirectory(async (directory) => {
    const canonicalPath = join(directory, "result.json");
    await writeFile(canonicalPath, JSON.stringify({ old: true }));
    await chmod(canonicalPath, 0o666);
    await runCodexJsonArtifact({
      canonicalPath,
      runAttempt: async ({ candidatePath }) => {
        await writeFile(candidatePath, JSON.stringify({ new: true }));
      },
    });
    assert.equal((await lstat(canonicalPath)).mode & 0o777, 0o600);
  });
});
