import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { acquireWorkspaceLock, checkOwnership, workspaceOwner } from "../scripts/parallel-workspace.mjs";

test("the four tasks cannot claim each other's write surfaces", () => {
  const files = {
    "publishing-ui": "app/_publishing/use-first-draft-images.ts",
    "image-detail": "scripts/first-draft-image-lane.mjs",
    "cs-runtime": "lib/cs/operations/provider.ts",
    "channels-integration": "lib/channels/serverless-gateway.ts",
  };
  for (const [owner, file] of Object.entries(files)) {
    assert.equal(workspaceOwner(file), owner);
    for (const lane of Object.keys(files)) assert.equal(checkOwnership(lane, [file])[0].allowed, lane === owner);
  }
  assert.equal(workspaceOwner("supabase/migrations/new.sql"), "channels-integration");
  assert.equal(workspaceOwner("lib/channels/protocols.ts"), "channels-integration");
  assert.throws(() => workspaceOwner("../elsewhere/file.ts"), /outside workspace/);
  assert.throws(() => checkOwnership("unknown", ["app/page.tsx"]), /Unknown task/);
});

test("every tracked path has exactly one owner", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  for (const file of files) assert.ok(workspaceOwner(file));
});

test("competing builds cannot both acquire the shared Next output", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sellerpilot-lock-test-"));
  try {
    const results = await Promise.allSettled([
      acquireWorkspaceLock("next", "publishing-ui", dir),
      acquireWorkspaceLock("next", "image-detail", dir),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
    await results.find(r => r.status === "fulfilled").value();
    const release = await acquireWorkspaceLock("next", "cs-runtime", dir);
    await release();
    await assert.rejects(acquireWorkspaceLock("git", "publishing-ui", dir), /cannot own/);
    await assert.rejects(acquireWorkspaceLock("database", "image-detail", dir), /cannot own/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the command wrapper propagates failure and releases its lock", () => {
  for (const code of [7, 0]) {
    const result = spawnSync(process.execPath, ["scripts/parallel-workspace.mjs", "run", "channels-integration", "git", "--", process.execPath, "-e", `process.exit(${code})`], { encoding: "utf8" });
    assert.equal(result.status, code, result.stderr);
  }
});
