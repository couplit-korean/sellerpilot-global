import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const durableProposal = await readFile(new URL(
  "../supabase/migrations/20260908140414_cs_temu_durable_detail_retry.sql",
  import.meta.url,
), "utf8");
const replayProposal = await readFile(new URL(
  "../supabase/migrations/20260908140416_cs_temu_detail_retry_replay.sql",
  import.meta.url,
), "utf8");

const tokenId = "00000000-0000-4000-8000-00000000b001";
const credentialId = "00000000-0000-4000-8000-00000000b002";
const jobId = "00000000-0000-4000-8000-00000000b003";
const firstClaim = "00000000-0000-4000-8000-00000000b004";

function summary(index) {
  return {
    parentAfterSalesSn: `AFTER-${index}`,
    parentOrderSn: `ORDER-${index}`,
    afterSalesStatusGroup: 1,
    operateExpireTimeMs: null,
    availableOperateList: [1, "VIEW"],
    returnDeliveryType: null,
    parentAfterSalesStatus: 1,
    updateAt: 1_788_000_000,
    afterSalesType: 2,
    createAt: 1_787_000_000,
  };
}

const fullQueue = [1, 2, 3, 4].map(summary);

function baseArguments(overrides = {}) {
  return {
    kind: "after_sales",
    includeDetails: true,
    pageNo: 1,
    pageSize: 200,
    afterSalesStatusGroup: 1,
    updateAtStart: 1_787_000_000,
    updateAtEnd: 1_788_000_000,
    sellerpilotHistoryRunId: "00000000-0000-4000-8000-00000000b005",
    ...overrides,
  };
}

function retryArguments(retryCount, replay, remainder, overrides = {}) {
  return baseArguments({
    retryReplayQueue: replay,
    detailQueue: remainder,
    sellerpilotTemuDetailRetryCount: retryCount,
    ...overrides,
  });
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema extensions;
    create function extensions.digest(text, text)
      returns bytea language sql immutable
      as $$select sha256(convert_to($1, 'UTF8'))$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,
      token_hash text not null,
      scope text not null,
      status text not null,
      expires_at timestamptz not null
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      channel text not null,
      status text not null,
      expires_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      credential_id uuid references sellerpilot_private.channel_credentials(id),
      channel text not null,
      operation text not null,
      request_payload jsonb not null,
      status text not null,
      worker_token_id uuid,
      claim_token uuid,
      lease_expires_at timestamptz,
      provider_mutation_started_at timestamptz,
      rate_not_before timestamptz,
      attempt_count integer not null default 0,
      error_message text,
      completed_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create function public.sellerpilot_is_admin()
      returns boolean language sql stable as $$select true$$;
    insert into sellerpilot_private.ai_cli_worker_tokens
      values ('${tokenId}', 'token-hash', 'gateway', 'active', now() + interval '1 day');
    insert into sellerpilot_private.channel_credentials
      values ('${credentialId}', 'temu', 'active', now() + interval '1 day');
  `);
  await db.exec(durableProposal);
  await db.exec(replayProposal);
  return db;
}

async function insertRunning(db, argumentsValue = baseArguments(), claim = firstClaim) {
  await db.query(`
    insert into sellerpilot_private.channel_gateway_jobs(
      id, credential_id, channel, operation, request_payload, status,
      worker_token_id, claim_token, lease_expires_at, attempt_count
    ) values ($1, $2, 'temu', 'inquiries.list', jsonb_build_object(
      'periodicKey', 'inquiries:history:2026-09-08:after_sales',
      'arguments', $3::jsonb
    ), 'running', $4, $5, now() + interval '10 minutes', 2)
  `, [jobId, credentialId, JSON.stringify(argumentsValue), tokenId, claim]);
}

async function requeue(db, {
  claim = firstClaim,
  argumentsValue = retryArguments(1, fullQueue.slice(0, 2), fullQueue.slice(2)),
  retryCount = 1,
  retryAfterSeconds = 5,
  deferredCount = 2,
  replayCount = 2,
  providerStatus = 503,
  tokenHash = "token-hash",
} = {}) {
  return (await db.query(`
    select public.sellerpilot_service_requeue_temu_after_sales_detail_v2(
      $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9
    ) result
  `, [
    tokenHash,
    jobId,
    claim,
    JSON.stringify(argumentsValue),
    retryCount,
    retryAfterSeconds,
    deferredCount,
    replayCount,
    providerStatus,
  ])).rows[0].result;
}

async function claimAgain(db, claim) {
  await db.query(`
    update sellerpilot_private.channel_gateway_jobs
       set status = 'running', worker_token_id = $2, claim_token = $3,
           lease_expires_at = now() + interval '10 minutes', rate_not_before = null
     where id = $1
  `, [jobId, tokenId, claim]);
}

async function assertRunningAndUnledgered(db, claim = firstClaim) {
  const job = (await db.query(
    "select status, claim_token from sellerpilot_private.channel_gateway_jobs where id = $1",
    [jobId],
  )).rows[0];
  assert.equal(job.status, "running");
  assert.equal(job.claim_token, claim);
  assert.equal((await db.query(
    "select count(*)::int count from sellerpilot_private.temu_after_sales_detail_retry_ledger",
  )).rows[0].count, 0);
}

test("committed response-loss replay returns the same receipt without consuming a retry", async () => {
  const db = await fixture();
  try {
    await insertRunning(db);
    const expected = {
      contract: "temu-after-sales-detail-retry-v2",
      status: "deferred",
      retryCount: 1,
      retryAfterSeconds: 5,
      deferredCount: 2,
      replayCount: 2,
      failureCode: "TEMU_AFTER_SALES_DETAIL_READ_FAILED",
    };
    const first = await requeue(db);
    assert.deepEqual(first, { ...expected, replayed: false });

    // Models a committed DB call whose HTTP response was lost. PGlite has one
    // backend, so this proves state-race idempotency, not a multi-session lock race.
    const replayed = await requeue(db);
    assert.deepEqual(replayed, { ...expected, replayed: true });
    assert.equal((await db.query(`
      select count(*)::int count
        from sellerpilot_private.temu_after_sales_detail_retry_ledger
       where job_id = $1
    `, [jobId])).rows[0].count, 1);
    const job = (await db.query(`
      select status, attempt_count,
             request_payload#>>'{arguments,sellerpilotTemuDetailRetryCount}' retry_count
        from sellerpilot_private.channel_gateway_jobs where id = $1
    `, [jobId])).rows[0];
    assert.deepEqual(job, { status: "queued", attempt_count: 2, retry_count: "1" });

    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set rate_not_before = rate_not_before + interval '1 second'
       where id = $1
    `, [jobId]);
    await assert.rejects(requeue(db), /ownership lost or Temu detail retry replay conflict/);
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.temu_after_sales_detail_retry_ledger",
    )).rows[0].count, 1);
  } finally { await db.close(); }
});

test("wrong claims, expired leases and revoked or expired credentials fail closed", async () => {
  const scenarios = [
    {
      prepare: async () => {},
      call: { claim: "00000000-0000-4000-8000-00000000b099" },
      pattern: /ownership lost or Temu detail retry replay conflict/,
    },
    {
      prepare: async (db) => db.query(
        "update sellerpilot_private.channel_gateway_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
        [jobId],
      ),
      pattern: /ownership lost or Temu detail retry replay conflict/,
    },
    {
      prepare: async (db) => db.query(
        "update sellerpilot_private.channel_credentials set status = 'revoked' where id = $1",
        [credentialId],
      ),
      pattern: /credential no longer active/,
    },
    {
      prepare: async (db) => db.query(
        "update sellerpilot_private.channel_credentials set expires_at = now() - interval '1 second' where id = $1",
        [credentialId],
      ),
      pattern: /credential no longer active/,
    },
  ];
  for (const scenario of scenarios) {
    const db = await fixture();
    try {
      await insertRunning(db);
      await scenario.prepare(db);
      await assert.rejects(requeue(db, scenario.call), scenario.pattern);
      await assertRunningAndUnledgered(db);
    } finally { await db.close(); }
  }
});

test("retries preserve the full replay plus remainder lineage and exhaust exactly at three", async () => {
  const db = await fixture();
  try {
    await insertRunning(db);
    const claims = [
      firstClaim,
      "00000000-0000-4000-8000-00000000b006",
      "00000000-0000-4000-8000-00000000b007",
    ];
    const partitions = [
      [fullQueue.slice(0, 2), fullQueue.slice(2)],
      [fullQueue.slice(0, 3), fullQueue.slice(3)],
      [fullQueue.slice(0, 1), fullQueue.slice(1)],
    ];
    for (let retryCount = 1; retryCount <= 3; retryCount += 1) {
      if (retryCount > 1) await claimAgain(db, claims[retryCount - 1]);
      const [replay, remainder] = partitions[retryCount - 1];
      const receipt = await requeue(db, {
        claim: claims[retryCount - 1],
        argumentsValue: retryArguments(retryCount, replay, remainder),
        retryCount,
        retryAfterSeconds: 5 * 2 ** (retryCount - 1),
        deferredCount: remainder.length,
        replayCount: replay.length,
      });
      assert.equal(receipt.replayed, false);
      assert.equal(receipt.replayCount + receipt.deferredCount, fullQueue.length);
    }

    assert.deepEqual((await db.query(`
      select retry_count, replay_count, deferred_count, outcome,
             extract(epoch from (next_attempt_at - observed_at))::int retry_after
        from sellerpilot_private.temu_after_sales_detail_retry_ledger
       where job_id = $1 order by retry_count
    `, [jobId])).rows, [
      { retry_count: 1, replay_count: 2, deferred_count: 2, outcome: "retry_failed", retry_after: 5 },
      { retry_count: 2, replay_count: 3, deferred_count: 1, outcome: "retry_failed", retry_after: 10 },
      { retry_count: 3, replay_count: 1, deferred_count: 3, outcome: "scheduled", retry_after: 20 },
    ]);

    const finalClaim = "00000000-0000-4000-8000-00000000b008";
    await claimAgain(db, finalClaim);
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set status = 'failed', error_message = 'TEMU_AFTER_SALES_DETAIL_RETRY_EXHAUSTED'
       where id = $1
    `, [jobId]);
    assert.equal((await db.query(`
      select outcome from sellerpilot_private.temu_after_sales_detail_retry_ledger
       where job_id = $1 and retry_count = 3
    `, [jobId])).rows[0].outcome, "retry_exhausted");
    await assert.rejects(requeue(db, {
      claim: finalClaim,
      argumentsValue: retryArguments(4, [], fullQueue),
      retryCount: 4,
      retryAfterSeconds: 40,
      deferredCount: 4,
      replayCount: 0,
    }), /invalid Temu detail retry descriptor/);
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.temu_after_sales_detail_retry_ledger",
    )).rows[0].count, 3);
  } finally { await db.close(); }
});

test("a later retry cannot drop or change a previously successful identity", async () => {
  for (const changedQueue of [
    fullQueue.slice(1),
    [summary(1), { ...summary(2), parentOrderSn: "ORDER-CHANGED" }, summary(3), summary(4)],
  ]) {
    const db = await fixture();
    try {
      await insertRunning(db);
      await requeue(db);
      const secondClaim = "00000000-0000-4000-8000-00000000b009";
      await claimAgain(db, secondClaim);
      await assert.rejects(requeue(db, {
        claim: secondClaim,
        argumentsValue: retryArguments(2, changedQueue.slice(0, 1), changedQueue.slice(1)),
        retryCount: 2,
        retryAfterSeconds: 10,
        deferredCount: changedQueue.length - 1,
        replayCount: 1,
      }), /queue lineage changed/);
      assert.equal((await db.query(
        "select count(*)::int count from sellerpilot_private.temu_after_sales_detail_retry_ledger",
      )).rows[0].count, 1);
    } finally { await db.close(); }
  }
});

test("retry status projection is authenticated-admin only and contains no customer IDs", async () => {
  const db = await fixture();
  try {
    await insertRunning(db);
    await requeue(db);
    const row = (await db.query(
      "select * from public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2($1)",
      [jobId],
    )).rows[0];
    assert.equal(row.job_id, jobId);
    assert.equal(row.retry_count, 1);
    assert.equal(row.replay_count, 2);
    assert.equal(row.deferred_count, 2);
    assert.doesNotMatch(JSON.stringify(row), /AFTER-|ORDER-/);
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(`
        select has_function_privilege(
          $1,
          'public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(uuid)',
          'EXECUTE'
        ) ok
      `, [role])).rows[0].ok, false);
    }
    assert.equal((await db.query(`
      select has_function_privilege(
        'authenticated',
        'public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(uuid)',
        'EXECUTE'
      ) ok
    `)).rows[0].ok, true);
    assert.equal((await db.query(`
      select has_table_privilege(
        'service_role',
        'sellerpilot_private.temu_after_sales_detail_retry_ledger',
        'SELECT'
      ) ok
    `)).rows[0].ok, false);
  } finally { await db.close(); }
});
