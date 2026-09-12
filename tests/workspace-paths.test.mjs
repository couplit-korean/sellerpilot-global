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
