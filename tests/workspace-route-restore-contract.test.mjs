import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("idle logout restores only the saved user-scoped route and never promises unsaved form recovery", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /storedWorkspaceRoute\(userId\)/);
  assert.match(page, /selectWorkspaceInitialRouteSource\(\{[\s\S]{0,240}freshLogin,[\s\S]{0,240}hasStoredRoute: Boolean\(storedRoute\)/);
  assert.match(page, /initialRouteSource === "default"[\s\S]{0,100}"view=overview"/);
  assert.match(page, /const trustedInitialState = trustingScopedHistory \|\| trustingDirectRoute \? initialState : \{\}/);
  assert.match(page, /persistWorkspaceView\(userId, viewRef\.current, now, currentWorkspaceRelativeUrl\(\)\)/);
  assert.match(page, /raw: readUserWorkspaceStorage\(\(\) => window\.localStorage\.getItem\(key\)\)/);
  assert.match(page, /const now = Date\.now\(\);[\s\S]{0,160}synchronizeStoredActivity\(readUserWorkspaceStorage\(\(\) => window\.localStorage\.getItem\(key\)\), now\);[\s\S]{0,160}now - lastActivityAt < workspaceIdleTimeoutMs/);
  assert.doesNotMatch(page, /synchronizeStoredActivity\(window\.localStorage\.getItem\(key\)\)/);
  assert.match(page, /저장된 마지막 화면과 필터만 엽니다/);
  assert.match(page, /저장하지 않은 입력 내용은 복원되지 않습니다/);
  assert.doesNotMatch(page, /미저장[^\n]{0,40}(?:복원|보존)[^\n]{0,20}(?:합니다|됩니다)/);
});
