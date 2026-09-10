import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("./cs-history-channel-db.test.mjs", import.meta.url);
const fixtureSource = await readFile(fixtureUrl, "utf8");
const fixtureEnd = fixtureSource.indexOf("test('Smartstore history");
assert.ok(fixtureEnd > 0);
const fixtureModule = fixtureSource.slice(0, fixtureEnd)
  .replace(
    "from '@electric-sql/pglite'",
    `from ${JSON.stringify(import.meta.resolve("@electric-sql/pglite"))}`,
  )
  .replaceAll("import.meta.url", JSON.stringify(fixtureUrl.href));
const fixtureHelpers = await import(`data:text/javascript;base64,${Buffer.from(
  `${fixtureModule}\nexport { fixture, owner, coupang };\n`,
).toString("base64")}`);

const checkpointMigration = await readFile(new URL(
  "../supabase/migrations/20260908141312_cs_coupang_history_checkpoint.sql",
  import.meta.url,
), "utf8");
const proposal = await readFile(new URL(
  "../supabase/migrations/20260909114626_cs_coupang_history_none_all_compat.sql",
  import.meta.url,
), "utf8");

async function canonicalFixture() {
  const db = await fixtureHelpers.fixture();
  await db.exec(checkpointMigration);
  await db.exec(`
    update sellerpilot_private.serverless_static_egress_policy
       set enabled=true where channel='coupang';
    insert into sellerpilot_private.channel_credentials(id,channel,created_by)
      values ('${fixtureHelpers.coupang}','coupang','${fixtureHelpers.owner}');
  `);
  return db;
}

async function start(db, endDate) {
  return (await db.query(
    "select public.sellerpilot_start_inquiry_history_backfill_v4(array['coupang'],30,$1::date) result",
    [endDate],
  )).rows[0].result;
}

async function checkpoint(db, runId, actor = fixtureHelpers.owner) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.exec("set role authenticated");
  try {
    return (await db.query(
      "select public.sellerpilot_get_coupang_history_checkpoint_v1($1) result",
      [runId],
    )).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

async function setRunJobs(db, runId, status) {
  await db.query(`update sellerpilot_private.channel_gateway_jobs
    set status=$2,completed_at=case when $2='succeeded' then clock_timestamp() else null end
    where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1`, [runId, status]);
}

test("canonical enqueue, after-sales extension, retry, and checkpoint use five non-overlapping scopes", async () => {
  const db = await canonicalFixture();
  try {
    const legacy = await start(db, "2024-02-29");
    assert.equal(legacy.expectedInitialJobs, 40);
    assert.equal(legacy.totalJobs, 40);

    await db.exec(proposal);
    await setRunJobs(db, legacy.runId, "succeeded");
    const legacyCheckpoint = await checkpoint(db, legacy.runId);
    assert.equal(legacyCheckpoint.expectedInitialJobs, 40);
    assert.equal(legacyCheckpoint.totalJobs, 40);
    assert.equal(legacyCheckpoint.canAdvance, true);

    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set status='failed',attempt_count=1,completed_at=clock_timestamp()
      where id=(select id from sellerpilot_private.channel_gateway_jobs
        where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1 limit 1)`, [legacy.runId]);
    await db.query("select sellerpilot_private.refresh_inquiry_history_backfill_run($1)", [legacy.runId]);
    const legacyRetry = await start(db, "2024-02-29");
    assert.equal(legacyRetry.runId, legacy.runId);
    assert.equal(legacyRetry.totalJobs, 40);
    assert.equal(legacyRetry.expectedInitialJobs, 40);
    assert.equal(legacyRetry.retriedJobs, 1);
    assert.equal(legacyRetry.queuedJobs, 1);

    const current = await start(db, "2024-01-30");
    assert.equal(current.expectedInitialJobs, 25);
    assert.equal(current.totalJobs, 25);
    const scopes = (await db.query(`select
        request_payload#>>'{arguments,kind}' kind,
        request_payload#>>'{arguments,query,partnerCounselingStatus}' partner_status,
        count(*)::int count
      from sellerpilot_private.channel_gateway_jobs
      where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1
      group by 1,2 order by 1,2`, [current.runId])).rows;
    assert.deepEqual(scopes, [
      { kind: "call-center", partner_status: "NONE", count: 5 },
      { kind: "cancel_request", partner_status: null, count: 5 },
      { kind: "exchange_request", partner_status: null, count: 5 },
      { kind: "product", partner_status: null, count: 5 },
      { kind: "return_request", partner_status: null, count: 5 },
    ]);

    await setRunJobs(db, current.runId, "succeeded");
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set status='failed',attempt_count=1,completed_at=clock_timestamp()
      where id=(select id from sellerpilot_private.channel_gateway_jobs
        where request_payload#>>'{arguments,sellerpilotHistoryRunId}'=$1 limit 1)`, [current.runId]);
    await db.query("select sellerpilot_private.refresh_inquiry_history_backfill_run($1)", [current.runId]);
    const retried = await start(db, "2024-01-30");
    assert.equal(retried.runId, current.runId);
    assert.equal(retried.reused, true);
    assert.equal(retried.retriedJobs, 1);
    assert.equal(retried.queuedJobs, 1);

    await setRunJobs(db, current.runId, "succeeded");
    const continuation = (await db.query(`select public.sellerpilot_service_enqueue_periodic_sync(
      'coupang','inquiries.list',jsonb_build_object(
        'periodicKey','inquiries:history:continuation:test',
        'arguments',jsonb_build_object('sellerpilotHistoryRunId',$1::text,'continuationOf','page-2')
      ),60
    ) result`, [current.runId])).rows[0].result;
    assert.equal(continuation.status, "queued");
    await setRunJobs(db, current.runId, "succeeded");
    const currentCheckpoint = await checkpoint(db, current.runId);
    assert.equal(currentCheckpoint.expectedInitialJobs, 25);
    assert.equal(currentCheckpoint.totalJobs, 26);
    assert.equal(currentCheckpoint.succeededJobs, 26);
    assert.equal(currentCheckpoint.canAdvance, true);
    assert.equal(currentCheckpoint.nextEndDate, "2023-12-31");
  } finally {
    await db.close();
  }
});

test("canonical ACLs stay admin-only and malformed scope counts fail closed", async () => {
  const db = await canonicalFixture();
  try {
    await db.exec(proposal);
    const current = await start(db, "2024-01-30");
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)','EXECUTE') allowed",
        [role],
      )).rows[0].allowed, false);
      assert.equal((await db.query(
        "select has_function_privilege($1,'sellerpilot_private.enqueue_inquiry_history_backfill_item(uuid,text,text,jsonb)','EXECUTE') allowed",
        [role],
      )).rows[0].allowed, false);
    }
    assert.equal((await db.query(
      "select has_function_privilege('authenticated','public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)','EXECUTE') allowed",
    )).rows[0].allowed, true);
    await assert.rejects(
      checkpoint(db, current.runId, "00000000-0000-4000-8000-000000000099"),
      /administrator access required/u,
    );
    await db.query(`update sellerpilot_private.inquiry_history_backfill_runs
      set expected_initial_jobs=30 where id=$1`, [current.runId]);
    await assert.rejects(
      checkpoint(db, current.runId),
      /COUPANG_HISTORY_CHECKPOINT_SCOPE_INVALID/u,
    );
  } finally {
    await db.close();
  }
});
