import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isSmartstoreLocalReadOperation,
  localGatewayReadHeartbeatFreshnessMs,
  resolveLocalGatewayReadReady,
  SMARTSTORE_LOCAL_READ_OPERATIONS,
} from "../lib/channels/smartstore-local-read-routing";

const nowMs = Date.parse("2026-09-05T07:00:00.000Z");
const routeUrl = new URL("../app/api/admin/channel-operations/route.ts", import.meta.url);
const csReplyUrl = new URL("../app/api/admin/cs/reply/route.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/20260905014800_route_smartstore_reads_to_local_gateway.sql",
  import.meta.url,
);

function gatewayStatus(
  lastSeenAt: string | null,
  lastVersion: string | null = "sellerpilot-cli-worker/1.60",
) {
  return {
    workers: {
      gateway: {
        label: "must-not-leak",
        fingerprint: "SECRET-FINGERPRINT",
        last_seen_at: lastSeenAt,
        last_version: lastVersion,
      },
      ai: {
        label: "ai-must-not-count",
        last_seen_at: new Date(nowMs - 1_000).toISOString(),
        last_version: "sellerpilot-cli-worker/1.60",
      },
    },
  };
}

test("smartstore local-read tuple is exclusive and does not include writes", () => {
  assert.deepEqual([...SMARTSTORE_LOCAL_READ_OPERATIONS], [
    "diagnostic.test",
    "categories.list",
    "categories.suggest",
    "categories.attributes",
    "categories.validate",
    "inquiries.list",
    "listing.publication.verify",
  ]);
  for (const operation of SMARTSTORE_LOCAL_READ_OPERATIONS) {
    assert.equal(isSmartstoreLocalReadOperation(operation), true);
  }
  for (const operation of [
    "orders.list",
    "orders.get",
    "inquiries.reply",
    "listing.create",
    "listing.update",
    "listing.stop",
    "inventory.update",
    "shipment.acknowledge",
    "shipment.confirm",
  ]) {
    assert.equal(isSmartstoreLocalReadOperation(operation), false);
  }
});

test("local gateway read-ready requires a fresh scope=gateway heartbeat, not AI or a historical GET", () => {
  assert.ok(localGatewayReadHeartbeatFreshnessMs > 61_000);
  const ready = resolveLocalGatewayReadReady(
    gatewayStatus(new Date(nowMs - 5_000).toISOString()),
    { nowMs },
  );
  assert.equal(ready.available, true);
  assert.equal(ready.reason, "ready");
  assert.doesNotMatch(JSON.stringify(ready), /must-not-leak|SECRET-FINGERPRINT|112\.172\.127\.206/);

  assert.equal(resolveLocalGatewayReadReady(
    gatewayStatus(new Date(nowMs - localGatewayReadHeartbeatFreshnessMs).toISOString()),
    { nowMs },
  ).reason, "heartbeat_stale");
  assert.equal(resolveLocalGatewayReadReady(gatewayStatus(null), { nowMs }).reason, "heartbeat_missing");
  assert.equal(resolveLocalGatewayReadReady({
    workers: {
      ai: { last_seen_at: new Date(nowMs - 1_000).toISOString() },
    },
  }, { nowMs }).reason, "worker_missing");
  assert.equal(resolveLocalGatewayReadReady(null, { nowMs, statusAvailable: false }).reason, "status_unavailable");
});

test("local gateway read-ready rejects missing/empty and serverless last_version", () => {
  const fresh = new Date(nowMs - 5_000).toISOString();
  assert.equal(
    resolveLocalGatewayReadReady(gatewayStatus(fresh, null), { nowMs }).reason,
    "ability_unproven",
  );
  assert.equal(
    resolveLocalGatewayReadReady(gatewayStatus(fresh, ""), { nowMs }).reason,
    "ability_unproven",
  );
  assert.equal(
    resolveLocalGatewayReadReady(
      gatewayStatus(fresh, "sellerpilot-vercel-gateway/drain"),
      { nowMs },
    ).reason,
    "ability_unproven",
  );
});

test("admin channel-operations only opens the Smartstore static-egress exception for local reads", async () => {
  const [route, csReply, migration] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(csReplyUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);
  assert.match(route, /isSmartstoreLocalReadOperation\(operation\)/);
  assert.match(route, /sellerpilot_ai_runtime_status/);
  assert.match(route, /LOCAL_GATEWAY_WORKER_REQUIRED/);
  assert.match(route, /else if \(channel === "smartstore"\)/);
  assert.match(route, /mode: "static_egress_required"/);
  assert.doesNotMatch(route, /gateway:worker:once/);
  assert.doesNotMatch(route, /Static IP/);
  assert.equal(csReply.includes("smartstore-local-read-routing"), false);
  assert.match(migration, /job\.channel is distinct from 'smartstore'/);
  assert.match(migration, /qoo10_shipping_s1_verifier_job_matches/);
  assert.match(migration, /42804/);
  assert.doesNotMatch(migration, /gateway:worker:once/);
  assert.doesNotMatch(migration, /serverless_static_egress_policy/);
  // Validate the shipped routing migration itself; an unrelated, untracked
  // operator recovery draft must not be a prerequisite for a clean checkout.
  assert.doesNotMatch(migration, /update\s+sellerpilot_private\.channel_gateway_jobs\b/i);
  assert.doesNotMatch(migration, /credential_refresh_in_flight\s*=/i);
});
