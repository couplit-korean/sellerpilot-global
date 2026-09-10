import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGatewayWorkerHealth } from "../scripts/persistent-worker-health.mjs";

const [claimRoute, adminRoute, worker, migration] = await Promise.all([
  readFile(new URL("../app/api/channel-gateway/worker/claim/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8"),
  readFile(new URL(
    "../supabase/migrations/20260907110000_general_local_channel_executor.sql",
    import.meta.url,
  ), "utf8"),
]);

test("claim ingress independently binds worker release and observed Vercel egress", () => {
  assert.match(claimRoute, /vercelForwardedClientIp\(request\.headers\)/u);
  assert.match(claimRoute, /suppliedEgressSha256 !== observedEgressSha256/u);
  assert.match(claimRoute, /workerAttestation\.releaseSha !== releaseSha/u);
  assert.match(claimRoute, /LOCAL_CHANNEL_EXECUTOR_CLAIM_RPC/u);
  assert.match(claimRoute, /!isLocalChannelExecutorTuple/u);
});

test("admin enqueue readiness is checked before static-egress fallback", () => {
  const readiness = adminRoute.indexOf("LOCAL_CHANNEL_EXECUTOR_READINESS_RPC");
  const providerStaticFence = adminRoute.indexOf("const providerMutationStaticEgressChannel");
  const smartstoreStaticFence = adminRoute.indexOf('} else if (channel === "smartstore" && !localChannelExecutorReady)');
  assert.ok(readiness > 0 && readiness < providerStaticFence);
  assert.ok(smartstoreStaticFence > providerStaticFence);
  assert.match(adminRoute, /localExecutorAccess === "read" && !localChannelExecutorReady/u);
  assert.match(adminRoute, /externalDetailApprovalBindingFromPublishContext/u);
  assert.match(adminRoute, /const coupangScopedReleaseGateIsExact/u);
  assert.match(adminRoute, /releaseGateStatus\.openedChannel === "coupang"/u);
  assert.match(adminRoute, /releaseGateStatus\.coupangAttestedRelease === runtimeRelease\.release/u);
  assert.match(adminRoute, /channel === "coupang"[\s\S]{0,180}releaseGateStatus\.coupangEffectiveOpen === true/u);
});

test("worker attestation uses its module checkout and local lane falls back only after an empty claim", () => {
  assert.match(worker, /workerRepositoryRoot = resolve\(dirname\(fileURLToPath\(import\.meta\.url\)\), "\.\."\)/u);
  assert.match(worker, /"diff", "--quiet", "HEAD"/u);
  assert.match(worker, /"ls-files", "--others", "--exclude-standard"/u);
  assert.match(worker, /await captureLocalChannelExecutorAttestation\(\)/u);
  assert.match(worker, /gatewayResponse\.status === 204[\s\S]*JSON\.stringify\(\{ version: workerVersion \}\)/u);
  assert.doesNotMatch(worker, /local_channel_executor[\s\S]{0,200}(?:orders\.|inquiries\.)/u);
});

test("health output exposes the same release and egress hashes without an address", () => {
  const runtimeAttestation = {
    releaseSha: "8".repeat(40),
    egressIpSha256: "a".repeat(64),
  };
  const health = createGatewayWorkerHealth({
    version: "fixture",
    runtimeAttestation,
    gatewayConfigured: true,
    schedulerConfigured: false,
    now: () => 0,
  });
  assert.deepEqual(health.snapshot().runtimeAttestation, runtimeAttestation);
  assert.equal(JSON.stringify(health.snapshot()).includes("112.172"), false);
});

test("database lane is empty by default and has no exact job exception", () => {
  assert.doesNotMatch(migration, /j\.id\s*=\s*'[0-9a-f-]{36}'::uuid/iu);
  assert.doesNotMatch(migration, /insert\s+into\s+sellerpilot_private\.local_channel_executor_routes/iu);
  assert.match(migration, /categories\.attributes','categories\.validate'/u);
  assert.match(migration, /p_operation = 'listing\.create'/u);
  assert.match(migration, /external_detail_approval_revision_is_current/u);
  assert.match(migration, /not has_revision/u);
});
