import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function methodSource(source, method, nextMethod) {
  const start = source.indexOf(`export async function ${method}`);
  const end = nextMethod ? source.indexOf(`export async function ${nextMethod}`, start + 1) : source.length;
  assert.ok(start >= 0, `${method} handler is missing`);
  assert.ok(end > start, `${method} handler boundary is missing`);
  return source.slice(start, end);
}

function assertFailClosedCronGet(source, label) {
  const get = methodSource(source, "GET", "POST");
  const missingSecret = get.indexOf("if (!cronSecret)");
  const authorization = get.indexOf("Bearer ${cronSecret}");
  assert.ok(missingSecret >= 0, `${label} must reject a missing CRON_SECRET`);
  assert.ok(authorization > missingSecret, `${label} must reject missing configuration before caller auth`);
  assert.match(get, /if \(!cronSecret\)[\s\S]{0,240}status: 503/);
  assert.match(get, /Bearer \$\{cronSecret\}[\s\S]{0,240}status: 401/);
}

test("Vercel Pro cron schedules are staggered, bounded, and preserve daily maintenance", async () => {
  const config = JSON.parse(await readFile(new URL("vercel.json", root), "utf8"));
  assert.deepEqual(config.crons, [
    { path: "/api/internal/maintenance", schedule: "17 18 * * *" },
    { path: "/api/internal/product-research", schedule: "*/5 * * * *" },
    { path: "/api/internal/channel-sync", schedule: "1-59/5 * * * *" },
    { path: "/api/internal/competitor-prices", schedule: "3-59/5 * * * *" },
  ]);
  assert.equal(new Set(config.crons.map(({ path }) => path)).size, config.crons.length);

  const minuteResidues = config.crons
    .filter(({ path }) => path !== "/api/internal/maintenance")
    .map(({ schedule }) => {
      const minuteField = schedule.split(" ")[0];
      if (minuteField === "*/5") return 0;
      const match = /^(\d+)-59\/5$/.exec(minuteField);
      assert.ok(match, `unsupported bounded five-minute schedule: ${schedule}`);
      return Number(match[1]);
    });
  assert.deepEqual(minuteResidues, [0, 1, 3]);
  assert.equal(new Set(minuteResidues).size, minuteResidues.length);
});

test("every newly scheduled GET route validates the Vercel CRON_SECRET before work", async () => {
  const [productRoute, productRuntime, productResearch, channelSync, competitorPrices] = await Promise.all([
    readFile(new URL("app/api/internal/product-research/route.ts", root), "utf8"),
    readFile(new URL("lib/server-product-research-runtime.ts", root), "utf8"),
    readFile(new URL("lib/server-product-research.ts", root), "utf8"),
    readFile(new URL("app/api/internal/channel-sync/route.ts", root), "utf8"),
    readFile(new URL("app/api/internal/competitor-prices/route.ts", root), "utf8"),
  ]);

  assert.match(productRoute, /runServerProductResearchCron/);
  assert.match(productRuntime, /cronSecret: process\.env\.CRON_SECRET/);
  assert.match(productResearch, /if \(!cronSecret\)[\s\S]{0,220}503/);
  assert.match(productResearch, /request\.headers\.get\("authorization"\) !== `Bearer \$\{cronSecret\}`[\s\S]{0,220}401/);
  assertFailClosedCronGet(channelSync, "channel sync");
  assertFailClosedCronGet(competitorPrices, "competitor prices");
});

test("long-running sync and maintenance routes preserve a finalization reserve", async () => {
  const [channelSync, maintenance, pushNotifications] = await Promise.all([
    readFile(new URL("app/api/internal/channel-sync/route.ts", root), "utf8"),
    readFile(new URL("app/api/internal/maintenance/route.ts", root), "utf8"),
    readFile(new URL("lib/push-notifications.ts", root), "utf8"),
  ]);

  assert.match(channelSync, /export const maxDuration = 300/);
  assert.match(channelSync, /At most 25 idempotent enqueue RPCs are produced/);
  assert.match(channelSync, /PERIODIC_SYNC_ENQUEUE_CONCURRENCY = 5/);
  assert.match(channelSync, /CHANNEL_SYNC_WORK_BUDGET_MS = 240_000/);
  assert.match(channelSync, /deadlineRemaining\(workDeadline\) < CHANNEL_SYNC_RPC_START_RESERVE_MS/);
  assert.match(channelSync, /deadlineRemaining\(workDeadline\) < CHANNEL_SYNC_PUSH_START_RESERVE_MS/);
  assert.match(channelSync, /deadlineMs: workDeadline/);
  assert.match(channelSync, /finalizationReserveMs: CHANNEL_SYNC_PUSH_FINALIZATION_RESERVE_MS/);

  assert.match(maintenance, /export const maxDuration = 300/);
  assert.match(maintenance, /MAINTENANCE_WORK_BUDGET_MS = 240_000/);
  assert.match(maintenance, /Promise\.all\(\[\s*expireStaleAiJobs\(serviceClient\),\s*reapStaleGatewayJobs\(serviceClient\),\s*reapStalePushDeliveries\(serviceClient\),/);
  assert.match(maintenance, /maintenanceHasBudget\(maintenanceDeadline, MAINTENANCE_STORAGE_STAGE_RESERVE_MS\)/);
  assert.match(maintenance, /MAINTENANCE_PUSH_START_RESERVE_MS/);
  assert.match(maintenance, /deadlineMs: maintenanceDeadline/);
  assert.match(maintenance, /finalizationReserveMs: MAINTENANCE_PUSH_FINALIZATION_RESERVE_MS/);
  assert.match(maintenance, /deferred: pushDeferred \|\| push\.deferred > 0/);

  assert.match(pushNotifications, /const PUSH_SEND_TIMEOUT_MS = 15_000/);
  assert.match(pushNotifications, /const PUSH_MAX_BATCH_SIZE = 25/);
  assert.match(pushNotifications, /webpush\.generateRequestDetails/);
  assert.match(pushNotifications, /timeout: timeoutMs/);
  assert.match(pushNotifications, /const timeoutController = new AbortController\(\)/);
  assert.match(pushNotifications, /const timeoutTimer = setTimeout\(\(\) => \{\s*timeoutController\.abort\(new Error\("push_send_timeout"\)\)/);
  assert.match(pushNotifications, /AbortSignal\.any\(\[options\.signal, timeoutController\.signal\]\)/);
  assert.match(pushNotifications, /finally \{\s*clearTimeout\(timeoutTimer\)/);
  assert.match(pushNotifications, /validatePublicReferenceUrl\(request\.endpoint\)/);
  assert.match(pushNotifications, /resolved\.some\(\(record\) => !isPublicReferenceAddress\(record\.address\)\)/);
  assert.match(pushNotifications, /hostname: target\.address/);
  assert.match(pushNotifications, /servername: isIP\(hostname\) \? undefined : hostname/);
  assert.match(pushNotifications, /requestStarted[\s\S]{0,180}reconciliation_required/);
  assert.match(pushNotifications, /deadlineMs - Date\.now\(\) \+ PUSH_CLAIM_DEADLINE_GRACE_MS/);
  assert.match(pushNotifications, /p_lease_seconds: claimLeaseSeconds/);
  assert.match(pushNotifications, /sellerpilot_service_begin_push_delivery/);
  assert.match(pushNotifications, /p_claim_token: delivery\.claim_token/);
  assert.match(pushNotifications, /status: "failed", message: "push delivery deferred before external send"/);
  const begin = pushNotifications.indexOf('sellerpilot_service_begin_push_delivery');
  const send = pushNotifications.indexOf('const result = await sendPushNotification', begin);
  const finish = pushNotifications.indexOf('await finish(delivery, result)', send);
  assert.ok(begin >= 0 && send > begin && finish > send);
});
