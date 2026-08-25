import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WORKER_AUTH_BACKOFF_MS,
  WORKER_TRANSIENT_BACKOFF_MS,
  workerClaimBackoffMs,
} from "../scripts/worker-claim-backoff.mjs";

test("worker claim backoff distinguishes authentication and transient failures", () => {
  assert.equal(WORKER_AUTH_BACKOFF_MS, 5 * 60_000);
  assert.equal(WORKER_TRANSIENT_BACKOFF_MS, 60_000);
  assert.equal(workerClaimBackoffMs(401), WORKER_AUTH_BACKOFF_MS);
  assert.equal(workerClaimBackoffMs(503), WORKER_TRANSIENT_BACKOFF_MS);
  assert.equal(workerClaimBackoffMs(500), 0);
});

test("AI worker claim applies the shared backoff without reducing the daemon delay to ten seconds", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");

  assert.match(worker, /let aiClaimBackoffUntil = 0/);
  assert.match(worker, /const backoffMs = workerClaimBackoffMs\(response\.status\)/);
  assert.match(worker, /workerAuthBackoffUntil = aiClaimBackoffUntil/);
  assert.match(worker, /Date\.now\(\) < aiClaimBackoffUntil/);
});

test("AI claim route bounds Supabase RPCs and preserves 401 versus 503 semantics", async () => {
  const route = await readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8");

  assert.match(route, /global: \{ fetch: createBoundedSupabaseFetch\(\) \}/);
  assert.match(route, /const status = workerRpcErrorStatus\(error\)/);
  assert.match(route, /workerRpcErrorMessage\(status\)/);
  assert.match(route, /if \(!workerToken\.startsWith\("spw_"\) \|\| workerToken\.length < 24\)[\s\S]*?status: 401/);
  assert.match(route, /if \(!supabaseUrl \|\| !secretKey\)[\s\S]*?workerRpcErrorMessage\(503\)[\s\S]*?status: 503/);
  assert.doesNotMatch(route, /if \(error\) return NextResponse\.json\([^\n]+status: 401/);
  assert.doesNotMatch(route, /!workerToken\.startsWith\("spw_"\) \|\| !supabaseUrl \|\| !secretKey/);
});

test("AI claim route compensates every post-claim preparation failure", async () => {
  const route = await readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8");

  assert.match(route, /sellerpilot_service_release_ai_job_claim/);
  assert.match(route, /p_retry_after_seconds: 60/);
  assert.match(route, /sellerpilot_complete_ai_job/);
  assert.match(route, /p_status: "failed"/);
  assert.match(route, /catch \(preparationError\)[\s\S]*?safeReason: "claim_preparation_exception"/);
  assert.equal(route.match(/return preparationFailure\(\{/g)?.length, 8);
  assert.match(route, /safeReason: "source_image_signing_incomplete"/);
  assert.match(route, /safeReason: "comparison_image_signing_incomplete"/);
  assert.ok(
    route.indexOf('safeReason: "invalid_asset_regeneration_payload"')
      < route.indexOf(".createSignedUrls(paths, 10 * 60)"),
    "deterministic invalid asset payload must fail before any storage preparation",
  );
  assert.match(route, /if \(!compensated\)[\s\S]*?status: 503/);
});

test("AI claim preparation compensation has an independent terminal failure budget", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260825103015_compensate_unprepared_ai_worker_claims.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /preparation_failure_count integer not null default 0/);
  assert.match(migration, /check \(preparation_failure_count between 0 and 3\)/);
  assert.match(migration, /preparation_failure_count = least\(j\.preparation_failure_count \+ 1, 3\)/);
  assert.match(migration, /status = case when j\.preparation_failure_count \+ 1 >= 3 then 'failed' else 'queued' end/);
  assert.match(migration, /completed_at = case when j\.preparation_failure_count \+ 1 >= 3 then now\(\) else null end/);
  assert.match(migration, /case when v_terminal then 'job_failed' else 'job_retried' end/);
  assert.match(migration, /'preparation_failure_count', v_preparation_failure_count/);
});
