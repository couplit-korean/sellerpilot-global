import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isLocalGatewayRecoveryAllowedTuple,
  LOCAL_GATEWAY_RECOVERY_CLAIM_MODE,
  LOCAL_GATEWAY_RECOVERY_LANE_ENABLED,
  LOCAL_GATEWAY_RECOVERY_LANE_GUC,
  LOCAL_GATEWAY_RECOVERY_RPC_NAME,
  LOCAL_GATEWAY_RECOVERY_SMARTSTORE_OPERATIONS,
  parseChannelGatewayClaimMode,
} from "../lib/channels/local-gateway-recovery-lane";
import { SHOPEE_OAUTH_OPERATION } from "../lib/channels/shopee-oauth-executor-readiness";
import { SMARTSTORE_LOCAL_READ_OPERATIONS } from "../lib/channels/smartstore-local-read-routing";

const claimRouteUrl = new URL("../app/api/channel-gateway/worker/claim/route.ts", import.meta.url);
const workerUrl = new URL("../scripts/ai-cli-worker.mjs", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/20260905015000_scope_local_gateway_recovery_lane.sql",
  import.meta.url,
);
const routing14800Url = new URL(
  "../supabase/migrations/20260905014800_route_smartstore_reads_to_local_gateway.sql",
  import.meta.url,
);

test("local recovery allowed tuple is Shopee oauth.exchange or Smartstore supported reads only", () => {
  assert.equal(SHOPEE_OAUTH_OPERATION, "oauth.exchange");
  assert.deepEqual(
    [...LOCAL_GATEWAY_RECOVERY_SMARTSTORE_OPERATIONS],
    [...SMARTSTORE_LOCAL_READ_OPERATIONS],
  );
  assert.equal(isLocalGatewayRecoveryAllowedTuple("shopee", "oauth.exchange"), true);
  for (const operation of SMARTSTORE_LOCAL_READ_OPERATIONS) {
    assert.equal(isLocalGatewayRecoveryAllowedTuple("smartstore", operation), true);
  }
  for (const operation of [
    "diagnostic.test",
    "categories.list",
    "categories.suggest",
    "listing.create",
  ]) {
    assert.equal(isLocalGatewayRecoveryAllowedTuple("shopee", operation), false);
  }
  for (const channel of ["coupang", "qoo10", "ebay", "elevenst", "temu", "lazada"]) {
    assert.equal(isLocalGatewayRecoveryAllowedTuple(channel, "diagnostic.test"), false);
    assert.equal(isLocalGatewayRecoveryAllowedTuple(channel, "inquiries.list"), false);
    assert.equal(isLocalGatewayRecoveryAllowedTuple(channel, "orders.list"), false);
    assert.equal(isLocalGatewayRecoveryAllowedTuple(channel, "oauth.exchange"), false);
  }
  assert.equal(isLocalGatewayRecoveryAllowedTuple("smartstore", "listing.create"), false);
  assert.equal(isLocalGatewayRecoveryAllowedTuple("smartstore", "orders.list"), false);
});

test("claim mode absence keeps default, local_recovery is exact, unknown is invalid", () => {
  assert.equal(parseChannelGatewayClaimMode(undefined), "default");
  assert.equal(parseChannelGatewayClaimMode(LOCAL_GATEWAY_RECOVERY_CLAIM_MODE), "local_recovery");
  assert.equal(parseChannelGatewayClaimMode("gateway"), "invalid");
  assert.equal(parseChannelGatewayClaimMode(""), "invalid");
  assert.equal(parseChannelGatewayClaimMode(null), "invalid");
  assert.equal(LOCAL_GATEWAY_RECOVERY_RPC_NAME.length < 63, true);
  assert.equal(LOCAL_GATEWAY_RECOVERY_LANE_GUC, "sellerpilot.local_gateway_recovery_lane");
  assert.equal(LOCAL_GATEWAY_RECOVERY_LANE_ENABLED, "enabled");
});

test("claim route picks scoped RPC only for local_recovery and rejects unknown mode with 400", async () => {
  const source = await readFile(claimRouteUrl, "utf8");
  const invalidMode = source.indexOf('claimMode === "invalid"');
  const rpcPick = source.indexOf("const claimRpcName = claimMode === \"local_recovery\"");
  const originalRpc = source.indexOf("serviceClient.rpc(claimRpcName");
  const unexpectedTuple = source.indexOf(
    "isLocalGatewayRecoveryAllowedTuple(parsed.data.channel, parsed.data.operation)",
  );
  const priceUpdate = source.indexOf('parsed.data.operation === "price.update"');

  assert.ok(invalidMode >= 0 && invalidMode < rpcPick);
  assert.match(source.slice(invalidMode, rpcPick), /status: 400/);
  assert.ok(rpcPick > invalidMode && originalRpc > rpcPick);
  assert.match(source.slice(rpcPick, originalRpc), /LOCAL_GATEWAY_RECOVERY_RPC_NAME/);
  assert.match(source.slice(rpcPick, originalRpc), /sellerpilot_claim_channel_gateway_job/);
  assert.ok(unexpectedTuple > originalRpc && priceUpdate > unexpectedTuple);
  assert.match(source.slice(unexpectedTuple, priceUpdate), /status: 409/);
  assert.doesNotMatch(
    source.slice(unexpectedTuple, priceUpdate),
    /sellerpilot_service_complete_gateway_transaction/,
  );
});

test("CLI local-recovery flag is gateway-only, sends mode, and stops unexpected claims before provider", async () => {
  const source = await readFile(workerUrl, "utf8");
  const flag = source.indexOf('process.argv.includes("--local-recovery-only")');
  const gated = source.indexOf("localRecoveryOnly && !gatewayOnly");
  const scheduler = source.indexOf("const schedulerWorkerToken = (aiOnly || localRecoveryOnly)");
  const claimBody = source.indexOf("localRecoveryOnly ? { mode: LOCAL_GATEWAY_RECOVERY_CLAIM_MODE }");
  const unexpected409 = source.indexOf("localRecoveryOnly && gatewayResponse.status === 409");
  const tupleFence = source.indexOf("isLocalGatewayRecoveryAllowedTuple(claimedChannel, claimedOperation)");
  const processJob = source.indexOf("await processGatewayJob(gatewayJob)");

  assert.ok(flag >= 0 && gated > flag && scheduler > gated);
  assert.match(source.slice(gated, scheduler), /only valid with --gateway-only/);
  assert.ok(claimBody > scheduler);
  assert.ok(unexpected409 > claimBody);
  assert.ok(tupleFence > unexpected409);
  assert.ok(processJob > tupleFence);
  assert.match(source.slice(unexpected409, tupleFence), /stopping = true/);
  assert.match(source.slice(unexpected409, tupleFence), /process\.exitCode = 1/);
  assert.doesNotMatch(source.slice(unexpected409, processJob), /processGatewayJob/);
  assert.doesNotMatch(source.slice(unexpected409, processJob), /\/api\/channel-gateway\/worker\/complete/);
  assert.match(source, /sellerpilot-cli-worker\/1\.60/);
  assert.doesNotMatch(source.slice(flag, processJob), /gateway:worker:once/);
});

test("15000 reuses original claim and does not rewrite 14800, 183000, or queued source rows", async () => {
  const [migration, routing14800] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(routing14800Url, "utf8"),
  ]);
  assert.match(migration, /sellerpilot_claim_local_gateway_recovery_job/);
  assert.match(migration, /sellerpilot\.local_gateway_recovery_lane/);
  assert.match(migration, /public\.sellerpilot_claim_channel_gateway_job/);
  assert.match(migration, /grant execute on function public\.sellerpilot_claim_local_gateway_recovery_job\(text, text\)/);
  assert.match(migration, /to service_role/);
  assert.match(
    migration,
    /revoke all on function public\.sellerpilot_claim_local_gateway_recovery_job\(text, text\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(migration, /sellerpilot_183000/);
  assert.doesNotMatch(migration, /gateway:worker:once/);
  assert.doesNotMatch(migration, /update sellerpilot_private\.channel_gateway_jobs/i);
  assert.doesNotMatch(migration, /20260905014800/);
  assert.doesNotMatch(routing14800, /local_gateway_recovery_lane/);
  assert.doesNotMatch(routing14800, /sellerpilot_claim_local_gateway_recovery_job/);
});
