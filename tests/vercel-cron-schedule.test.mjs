import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function methodSource(source, method, nextMethod) {
  const start = source.indexOf(`export async function ${method}`);
  const next = nextMethod ? source.indexOf(`export async function ${nextMethod}`, start + 1) : -1;
  const end = next > start ? next : source.length;
  assert.ok(start >= 0, `${method} handler is missing`);
  assert.ok(end > start, `${method} handler boundary is missing`);
  return source.slice(start, end);
}

function assertFailClosedCronGet(source, label) {
  const get = methodSource(source, "GET", "POST");
  const authorization = get.indexOf("internalScheduleAuthorization(");
  const missingSecret = get.indexOf('authorization === "missing"');
  const unauthorized = get.indexOf('authorization !== "authorized"');
  const mode = get.indexOf("internalScheduleRequestMode(request)");
  const invalidMode = get.indexOf('requestedMode === "invalid"');
  const canary = get.indexOf('requestedMode === "canary"');
  assert.ok(authorization >= 0, `${label} must use shared constant-time schedule auth`);
  assert.ok(missingSecret > authorization, `${label} must reject a missing CRON_SECRET`);
  assert.ok(unauthorized > missingSecret, `${label} must reject the wrong bearer`);
  assert.ok(mode > unauthorized, `${label} must authenticate before parsing execution mode`);
  assert.ok(invalidMode > mode, `${label} must reject unknown execution modes`);
  assert.ok(canary > invalidMode, `${label} must fail closed before a no-work canary`);
  assert.match(get, /authorization === "missing"[\s\S]{0,240}status: 503/);
  assert.match(get, /authorization !== "authorized"[\s\S]{0,240}status: 401/);
  assert.match(get, /requestedMode === "invalid"[\s\S]{0,180}status: 400/);
  assert.match(get, /requestedMode === "canary"[\s\S]{0,180}internalScheduleCanaryPayload\(\)/);
}

test("Vercel has no cron because Supabase owns every schedule", async () => {
  const config = JSON.parse(await readFile(new URL("vercel.json", root), "utf8"));
  assert.equal(Object.hasOwn(config, "crons"), false);
});

test("Supabase-scheduled GET routes accept only HMAC-derived auth and canary without work", async () => {
  const [productRoute, productRuntime, productResearch, channelSync, competitorPrices, kakao, maintenance, auth] = await Promise.all([
    readFile(new URL("app/api/internal/product-research/route.ts", root), "utf8"),
    readFile(new URL("lib/server-product-research-runtime.ts", root), "utf8"),
    readFile(new URL("lib/server-product-research.ts", root), "utf8"),
    readFile(new URL("app/api/internal/channel-sync/route.ts", root), "utf8"),
    readFile(new URL("app/api/internal/competitor-prices/route.ts", root), "utf8"),
    readFile(new URL("app/api/internal/kakao-notifications/route.ts", root), "utf8"),
    readFile(new URL("app/api/internal/maintenance/route.ts", root), "utf8"),
    readFile(new URL("lib/internal-scheduler-auth.ts", root), "utf8"),
  ]);

  assert.match(productRoute, /runServerProductRecoverySchedule/);
  assert.match(productRuntime, /cronSecret: process\.env\.CRON_SECRET/);
  assert.match(productRuntime, /releaseId: process\.env\.SELLERPILOT_RELEASE_SHA/);
  assert.match(productRuntime, /vercelGitCommitSha: process\.env\.VERCEL_GIT_COMMIT_SHA/);
  assert.match(productRuntime, /requireActiveRuntime: true/);
  assert.match(productRuntime, /internalScheduleAuthorization\(/);
  assert.match(productRuntime, /internalScheduleRequestMode\(request\)/);
  assert.match(productRuntime, /internalScheduleCanaryPayload\(\{/);
  assert.match(productRuntime, /runtimeStatusMatchesCurrentRelease\(runtime\.data,/);
  assert.match(productResearch, /internalScheduleAuthorization\([\s\S]{0,240}authorization === "missing"[\s\S]{0,240}503/);
  assert.match(productResearch, /authorization !== "authorized"[\s\S]{0,220}401/);
  assert.match(productResearch, /requestedMode === "invalid"[\s\S]{0,180}400/);
  assert.match(productResearch, /requestedMode === "canary"[\s\S]{0,320}internalScheduleCanaryPayload\(\{/);
  assert.match(productResearch, /runtimeStatusMatchesCurrentRelease\(runtimeStatus\.data,[\s\S]{0,220}dependencies\.vercelGitCommitSha/);
  assertFailClosedCronGet(channelSync, "channel sync");
  assertFailClosedCronGet(competitorPrices, "competitor prices");
  assertFailClosedCronGet(kakao, "Kakao notifications");
  assertFailClosedCronGet(maintenance, "maintenance");
  for (const route of [channelSync, competitorPrices, kakao, maintenance]) {
    assert.match(route, /sellerpilot_service_serverless_cs_wakeup_status/);
    assert.match(route, /runtimeStatusMatchesCurrentRelease\(runtimeStatus\)/);
  }
  assert.match(auth, /createHmac\("sha256", normalized\)/);
  assert.match(auth, /sellerpilot:channel-gateway-drain:wake:v1/);
  assert.match(auth, /timingSafeEqual\(actual, expected\)/);
  assert.doesNotMatch(auth, /rawMatch/);
  assert.doesNotMatch(auth, /vault|SUPABASE_SECRET_KEY/);
  assert.match(auth, /sellerpilotReleaseSha[\s\S]*vercelGitCommitSha/);
  assert.match(auth, /normalizedSellerpilotRelease !== normalizedVercelRelease/);
  assert.match(auth, /activeRelease === identity\.release/);
});

test("Supabase installs staggered internal schedules paused behind one canary activation", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/20260828210000_non_cs_release_integrity.sql", root),
    "utf8",
  );
  const schedules = [
    ["sellerpilot-product-research-v1", "*/5 * * * *", "product_research"],
    ["sellerpilot-channel-sync-v1", "1-59/5 * * * *", "channel_sync"],
    ["sellerpilot-competitor-prices-v1", "3-59/5 * * * *", "competitor_prices"],
    ["sellerpilot-kakao-notifications-v1", "4-59/5 * * * *", "kakao_notifications"],
    ["sellerpilot-maintenance-v1", "17 18 * * *", "maintenance"],
  ];
  for (const [name, schedule, route] of schedules) {
    assert.match(migration, new RegExp(`'${name}',\\s*'${schedule.replaceAll("*", "\\*").replaceAll("/", "\\/")}'`));
    assert.match(migration, new RegExp(`schedule_internal_route\\('${route}'\\)`));
  }
  assert.match(migration, /sellerpilot_serverless_cs_wake_v1/);
  assert.match(migration, /select net\.http_get\([\s\S]*timeout_milliseconds := 285000/);
  assert.match(migration, /select cron\.alter_job\(job_id := job\.jobid, active := false\)[\s\S]{0,320}sellerpilot-kakao-notifications-v1/);
  assert.match(migration, /v_configured_count <> 6/);
  assert.match(migration, /v_active_count = 6/);
  assert.match(migration, /unsafePendingMutations/);
  assert.match(migration, /gateway_job_requires_reconciliation/);
  assert.match(migration, /credential_refresh_in_flight[\s\S]*credential_refresh_recovery_vault_id[\s\S]*provider_mutation_started_at/);
  assert.match(migration, /sellerpilot_service_begin_serverless_runtime_canary\(\s*p_release_id text/);
  assert.match(migration, /sellerpilot_service_activate_serverless_runtime\(\s*p_canary_receipt_id uuid,\s*p_release_id text/);
  const localClaimant = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_claim_product_ai_job"),
    migration.indexOf("revoke all on function\n  public.sellerpilot_claim_product_ai_job"),
  );
  assert.match(localClaimant, /product_studio/);
  assert.doesNotMatch(localClaimant, /product_research/);
  assert.match(migration, /response\.status_code in \(401, 403, 404, 405, 410\) then 'permanent_failure'/);
  assert.match(migration, /wake_rate_limited'[\s\S]*interval '5 minutes'/);
  assert.doesNotMatch(migration, /vault\.create_secret\([\s\S]{0,180}CRON_SECRET/i);
});

test("long-running sync and maintenance routes preserve a finalization reserve", async () => {
  const [channelSync, maintenance, pushNotifications] = await Promise.all([
    readFile(new URL("app/api/internal/channel-sync/route.ts", root), "utf8"),
    readFile(new URL("app/api/internal/maintenance/route.ts", root), "utf8"),
    readFile(new URL("lib/push-notifications.ts", root), "utf8"),
  ]);

  assert.match(channelSync, /export const maxDuration = 300/);
  assert.match(channelSync, /produces at most 17 idempotent order enqueue RPCs/);
  assert.doesNotMatch(channelSync, /inquirySyncRequests|periodicInquiryRequests|blockedInquiryResults/);
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
