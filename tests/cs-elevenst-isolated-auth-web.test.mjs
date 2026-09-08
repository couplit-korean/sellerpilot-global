import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("11st isolated DB reaches the authenticated read-only web route without an auth bypass", async () => {
  const { stdout, stderr } = await execute(process.execPath, [
    "--import",
    "tsx",
    "scripts/cs-elevenst-isolated-auth-web-smoke.mjs",
    "--port=0",
  ], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, NODE_ENV: "test" },
  });
  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.database, "PGlite-memory");
  assert.equal(result.webRuntime, "next-dev");
  assert.equal(result.unauthorizedStatus, 401);
  assert.equal(result.invalidTokenStatus, 401);
  assert.equal(result.authorizedStatus, 200);
  assert.equal(result.databaseReadCount, 1);
  assert.equal(result.productQna.remoteCount, null);
  assert.equal(result.urgentAlimi.remoteCount, 0);
  assert.deepEqual(result.sellerTalk, {
    accessMode: "seller_office_session_only",
    remoteCount: null,
    retention: { maximum: 3, unit: "month", exactDays: null },
    automaticReadAvailable: false,
  });
  assert.deepEqual(result.review, {
    accessMode: "seller_office_export_only",
    remoteCount: null,
    retention: null,
    automaticReadAvailable: false,
  });
  assert.equal(result.uiRendered, true);
  assert.deepEqual(result.uiStoredCounts, { productQna: 4, urgentAlimi: 0 });
  assert.equal(result.providerWrites, 0);
  assert.equal(result.productionDatabaseWrites, 0);
});
