import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("actual Next completion POST preserves business 500 and keeps transport failures body-free", () => {
  const execution = spawnSync(process.execPath, [
    "--import", "tsx",
    "scripts/cs-elevenst-worker-failed-completion-web-smoke.mjs",
    "--port=3214",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "test" },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(execution.status, 0, `${execution.stderr}\n${execution.stdout}`);
  const result = JSON.parse(execution.stdout.trim().split("\n").at(-1));
  assert.equal(result.webRuntime, "next-dev");
  assert.equal(result.webPort, 3214);
  assert.equal(result.businessCompletionStatus, 200);
  assert.equal(result.businessResultForwarded, true);
  assert.equal(result.businessStoredMarker, "normalized_inquiries_v1");
  assert.equal(result.businessObservationRecorded, true);
  assert.equal(result.transportCompletionStatus, 200);
  assert.equal(result.transportResultForwarded, false);
  assert.equal(result.transportStoredResponse, null);
  assert.equal(result.transportObservationRecorded, false);
  assert.equal(result.providerWrites, 0);
  assert.equal(result.productionDatabaseWrites, 0);
  assert.equal(result.customerReplies, 0);
});
