import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertLocalWorkspace } from "../scripts/workspace-paths.mjs";

test("local runtime is allowed but an indirect dependency on Documents is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "sellerpilot-path-test-"));
  try {
    mkdirSync(join(root, "scripts"));
    assert.ok(assertLocalWorkspace(root).length >= 2);
    symlinkSync(join(homedir(), "Documents"), join(root, "node_modules"));
    assert.throws(() => assertLocalWorkspace(root), /SELLERPILOT_CLOUD_PATH_REJECTED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Vercel metadata-only Git builds retain cloud checks while invalid local Git still fails", () => {
  const root = mkdtempSync(join(tmpdir(), "sellerpilot-path-test-"));
  const hosted = { VERCEL: "1", VERCEL_PROJECT_ID: "prj_9fRYsoTT4fD6XVEMe4NX9mpPlljA" };
  try {
    mkdirSync(join(root, ".git"));
    assert.throws(() => assertLocalWorkspace(root, {}), /git rev-parse/);
    assert.throws(() => assertLocalWorkspace(root, { ...hosted, VERCEL_PROJECT_ID: "wrong-project" }), /git rev-parse/);
    assert.ok(assertLocalWorkspace(root, hosted).length >= 2);
    symlinkSync(join(homedir(), "Documents"), join(root, "node_modules"));
    assert.throws(() => assertLocalWorkspace(root, hosted), /SELLERPILOT_CLOUD_PATH_REJECTED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
