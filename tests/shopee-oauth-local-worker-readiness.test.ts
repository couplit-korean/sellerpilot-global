import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOPEE_OAUTH_LOCAL_GATEWAY_FRESHNESS_MS,
  SHOPEE_OAUTH_LOCAL_ROUTING_CONTRACT,
  SHOPEE_OAUTH_OPERATION,
  resolveShopeeOAuthExecutorReadiness,
} from "../lib/channels/shopee-oauth-executor-readiness";

const nowMs = Date.parse("2026-09-05T07:00:00.000Z");

function gatewayStatus(input: {
  lastSeenAt?: string | null;
  lastVersion?: string | null;
  scope?: string;
  extraWorkers?: Record<string, unknown>;
}) {
  return {
    workers: {
      ...(input.extraWorkers ?? {}),
      gateway: {
        last_seen_at: input.lastSeenAt ?? new Date(nowMs - 5_000).toISOString(),
        last_version: input.lastVersion === undefined ? "sellerpilot-cli-worker/1.60" : input.lastVersion,
        ...(input.scope ? { scope: input.scope } : {}),
        fingerprint: "SECRET-FINGERPRINT",
        label: "must-not-leak",
      },
    },
  };
}

function resolve(overrides: Partial<Parameters<typeof resolveShopeeOAuthExecutorReadiness>[0]> = {}) {
  return resolveShopeeOAuthExecutorReadiness({
    nowMs,
    staticEgressRpcError: false,
    envConfigured: false,
    databaseAllows: false,
    runtimeStatus: null,
    runtimeStatusAvailable: false,
    ...overrides,
  });
}

test("Shopee OAuth local contract is oauth.exchange only and does not probe recon", () => {
  assert.equal(SHOPEE_OAUTH_LOCAL_ROUTING_CONTRACT.operation, SHOPEE_OAUTH_OPERATION);
  assert.equal(SHOPEE_OAUTH_LOCAL_ROUTING_CONTRACT.operation, "oauth.exchange");
  assert.equal(SHOPEE_OAUTH_LOCAL_ROUTING_CONTRACT.refreshExcluded, true);
  assert.equal(SHOPEE_OAUTH_LOCAL_ROUTING_CONTRACT.reconProbed, false);
  assert.equal(SHOPEE_OAUTH_LOCAL_ROUTING_CONTRACT.registeredIpHistoryIsNotAttestation, true);
  assert.equal(SHOPEE_OAUTH_LOCAL_ROUTING_CONTRACT.runtimeRpc, "sellerpilot_ai_runtime_status");
  assert.equal(SHOPEE_OAUTH_LOCAL_ROUTING_CONTRACT.runtimePath, "workers.gateway.last_seen_at");
  assert.ok(SHOPEE_OAUTH_LOCAL_GATEWAY_FRESHNESS_MS >= 60_000);
});

test("real serverless static attestation with CS wakeup is allowed without local last_seen", () => {
  const ready = resolve({
    envConfigured: true,
    databaseAllows: true,
    serverlessCs: { configured: true, active: true },
    runtimeStatusAvailable: false,
    runtimeStatus: null,
  });
  assert.equal(ready.allowed, true);
  assert.equal(ready.mode, "serverless_static_egress");
  assert.equal(ready.reason, "ready_serverless_static_egress");
  assert.equal(ready.evidence.reconProbed, false);
});

test("real serverless static attestation still requires CS wakeup and ignores stale local heartbeat", () => {
  const blocked = resolve({
    envConfigured: true,
    databaseAllows: true,
    serverlessCs: { configured: true, active: false },
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({ lastSeenAt: "2026-09-04T12:00:00.000Z" }),
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "serverless_worker_required");
  assert.equal(blocked.blockedReason, "SERVERLESS_WORKER_REQUIRED");
});

test("env-only static egress is fake and requires a fresh local gateway", () => {
  const fakeEnv = resolve({
    envConfigured: true,
    databaseAllows: false,
    serverlessCs: { configured: true, active: true },
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({}),
  });
  assert.equal(fakeEnv.allowed, true);
  assert.equal(fakeEnv.mode, "local_mac_gateway");
  assert.equal(fakeEnv.reason, "ready_local_mac_gateway");
  assert.doesNotMatch(JSON.stringify(fakeEnv), /SECRET-FINGERPRINT|must-not-leak/);
});

test("database static egress without env attestation cannot prove exclusive execution", () => {
  const blocked = resolve({
    envConfigured: false,
    databaseAllows: true,
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({}),
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "executor_exclusive_unproven");
  assert.equal(blocked.blockedReason, "SHOPEE_OAUTH_EXECUTOR_UNPROVEN");
  assert.match(blocked.prerequisites.join("\n"), /env만 켜서 static egress를 가장하지 마세요/);
});

test("static egress RPC failure fails closed even with a fresh local heartbeat", () => {
  const blocked = resolve({
    staticEgressRpcError: true,
    envConfigured: false,
    databaseAllows: false,
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({}),
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "static_egress_status_unavailable");
  assert.equal(blocked.evidence.databaseStaticEgress, null);
});

test("fresh local gateway last_seen allows oauth.exchange readiness", () => {
  const ready = resolve({
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({ lastSeenAt: new Date(nowMs - 30_000).toISOString() }),
  });
  assert.equal(ready.allowed, true);
  assert.equal(ready.mode, "local_mac_gateway");
  assert.equal(ready.evidence.localGatewayScopePresent, true);
  assert.equal(ready.evidence.reconProbed, false);
});

test("September 4 last_seen is stale and is not local execution proof", () => {
  const blocked = resolve({
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({ lastSeenAt: "2026-09-04T23:59:59.000Z" }),
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "local_gateway_heartbeat_stale");
  assert.equal(blocked.blockedReason, "LOCAL_GATEWAY_WORKER_REQUIRED");
});

test("exactly stale freshness window is rejected", () => {
  const blocked = resolve({
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({
      lastSeenAt: new Date(nowMs - SHOPEE_OAUTH_LOCAL_GATEWAY_FRESHNESS_MS).toISOString(),
    }),
  });
  assert.equal(blocked.reason, "local_gateway_heartbeat_stale");
});

test("inactive local gateway fails closed", () => {
  const blocked = resolve({
    runtimeStatusAvailable: true,
    runtimeStatus: { workers: {} },
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "local_gateway_missing");
});

test("wrong active worker scope fails closed", () => {
  const serverlessOnly = resolve({
    runtimeStatusAvailable: true,
    runtimeStatus: {
      workers: {
        serverless_cs: {
          last_seen_at: new Date(nowMs - 1_000).toISOString(),
          last_version: "sellerpilot-vercel-gateway/2.0",
        },
      },
    },
  });
  assert.equal(serverlessOnly.reason, "local_gateway_wrong_scope");

  const declared = resolve({
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({ scope: "serverless_cs" }),
  });
  assert.equal(declared.reason, "local_gateway_wrong_scope");
});

test("missing or serverless CS last_version cannot prove local ability", () => {
  const missingVersion = resolve({
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({ lastVersion: null }),
  });
  assert.equal(missingVersion.reason, "local_gateway_ability_unproven");

  const vercelVersion = resolve({
    runtimeStatusAvailable: true,
    runtimeStatus: gatewayStatus({ lastVersion: "sellerpilot-vercel-gateway/2.0" }),
  });
  assert.equal(vercelVersion.reason, "local_gateway_ability_unproven");
});

test("runtime status unavailability fails closed and does not invent readiness", () => {
  const blocked = resolve({
    runtimeStatusAvailable: false,
    runtimeStatus: gatewayStatus({}),
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "local_gateway_status_unavailable");
});
