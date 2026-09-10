import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const proposal = await readFile(new URL(
  "../supabase/migrations/20260908140414_cs_temu_durable_detail_retry.sql",
  import.meta.url,
), "utf8");

const tokenId = "00000000-0000-4000-8000-00000000a001";
const jobId = "00000000-0000-4000-8000-00000000a002";
const firstClaim = "00000000-0000-4000-8000-00000000a003";

function summary(serial = "AFTER-1", order = "ORDER-1") {
  return {
    parentAfterSalesSn: serial,
    parentOrderSn: order,
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

function baseArguments(overrides = {}) {
  return {
    kind: "after_sales",
    includeDetails: true,
    pageNo: 1,
    pageSize: 200,
    afterSalesStatusGroup: 1,
    updateAtStart: 1_787_000_000,
    updateAtEnd: 1_788_000_000,
    sellerpilotHistoryRunId: "00000000-0000-4000-8000-00000000a004",
    ...overrides,
  };
}

function retryArguments(retryCount, queue = [summary()], overrides = {}) {
  return baseArguments({
    detailQueue: queue,
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
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
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
  `);
  await db.exec(proposal);
  return db;
}

async function insertRunning(db, argumentsValue = baseArguments(), claim = firstClaim) {
  await db.query(`
    insert into sellerpilot_private.channel_gateway_jobs(
      id, channel, operation, request_payload, status, worker_token_id,
      claim_token, lease_expires_at, attempt_count
    ) values ($1, 'temu', 'inquiries.list', jsonb_build_object(
      'periodicKey', 'inquiries:history:2026-09-08:after_sales',
      'arguments', $2::jsonb
    ), 'running', $3, $4, now() + interval '10 minutes', 2)
  `, [jobId, JSON.stringify(argumentsValue), tokenId, claim]);
}

async function requeue(db, {
  claim = firstClaim,
  argumentsValue = retryArguments(1),
  retryCount = 1,
  retryAfterSeconds = 5,
  deferredCount = 1,
  providerStatus = 503,
  tokenHash = "token-hash",
} = {}) {
  return (await db.query(`
    select public.sellerpilot_service_requeue_temu_after_sales_detail_v1(
      $1, $2, $3, $4::jsonb, $5, $6, $7, $8
    ) result
  `, [
    tokenHash,
    jobId,
    claim,
    JSON.stringify(argumentsValue),
    retryCount,
    retryAfterSeconds,
    deferredCount,
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

test("Temu 503 detail remainder is atomically ledgered and requeued without a success state", async () => {
  const db = await fixture();
  try {
    await insertRunning(db);
    const receipt = await requeue(db);
    assert.deepEqual(receipt, {
      contract: "temu-after-sales-detail-retry-v1",
      status: "deferred",
      retryCount: 1,
      retryAfterSeconds: 5,
      deferredCount: 1,
      failureCode: "TEMU_AFTER_SALES_DETAIL_READ_FAILED",
    });
    const job = (await db.query(`
      select status, worker_token_id, claim_token, attempt_count, rate_not_before,
             error_message, request_payload#>>'{arguments,sellerpilotTemuDetailRetryCount}' retry_count
        from sellerpilot_private.channel_gateway_jobs where id = $1
    `, [jobId])).rows[0];
    assert.equal(job.status, "queued");
    assert.equal(job.worker_token_id, null);
    assert.equal(job.claim_token, null);
    assert.equal(job.attempt_count, 2);
    assert.ok(job.rate_not_before);
    assert.equal(job.error_message, "TEMU_AFTER_SALES_DETAIL_RETRY_SCHEDULED");
    assert.equal(job.retry_count, "1");

    const ledger = (await db.query(`
      select retry_count, deferred_count, provider_status, outcome,
             extract(epoch from (next_attempt_at - observed_at))::int retry_after
        from sellerpilot_private.temu_after_sales_detail_retry_ledger
       where job_id = $1
    `, [jobId])).rows[0];
    assert.deepEqual(ledger, {
      retry_count: 1,
      deferred_count: 1,
      provider_status: 503,
      outcome: "scheduled",
      retry_after: 5,
    });
  } finally { await db.close(); }
});

test("Temu retry RPC rejects 401/403, wrong ownership, PII keys and history-scope drift", async () => {
  for (const scenario of [
    { providerStatus: 401, pattern: /invalid Temu detail retry descriptor/ },
    { providerStatus: 403, pattern: /invalid Temu detail retry descriptor/ },
    { tokenHash: "wrong-token", pattern: /invalid worker token/ },
    { argumentsValue: retryArguments(1, [summary()], { updateAtStart: 1_786_999_999 }), pattern: /scope changed/ },
    { argumentsValue: retryArguments(1, [{ ...summary(), phone: "do-not-store" }]), pattern: /scope changed|invalid Temu detail retry queue/ },
  ]) {
    const db = await fixture();
    try {
      await insertRunning(db);
      await assert.rejects(requeue(db, scenario), scenario.pattern);
      const job = (await db.query(
        "select status, claim_token from sellerpilot_private.channel_gateway_jobs where id = $1",
        [jobId],
      )).rows[0];
      assert.equal(job.status, "running");
      assert.equal(job.claim_token, firstClaim);
      assert.equal((await db.query(
        "select count(*)::int count from sellerpilot_private.temu_after_sales_detail_retry_ledger",
      )).rows[0].count, 0);
    } finally { await db.close(); }
  }
});

test("Temu detail retry backoff is exactly 5/10/20 seconds and the third failure is terminal", async () => {
  const db = await fixture();
  try {
    await insertRunning(db);
    const claims = [
      firstClaim,
      "00000000-0000-4000-8000-00000000a005",
      "00000000-0000-4000-8000-00000000a006",
    ];
    for (let retryCount = 1; retryCount <= 3; retryCount += 1) {
      if (retryCount > 1) await claimAgain(db, claims[retryCount - 1]);
      const retryAfterSeconds = 5 * 2 ** (retryCount - 1);
      const receipt = await requeue(db, {
        claim: claims[retryCount - 1],
        argumentsValue: retryArguments(retryCount),
        retryCount,
        retryAfterSeconds,
      });
      assert.equal(receipt.retryAfterSeconds, retryAfterSeconds);
    }
    assert.deepEqual((await db.query(`
      select retry_count, outcome,
             extract(epoch from (next_attempt_at - observed_at))::int retry_after
        from sellerpilot_private.temu_after_sales_detail_retry_ledger
       where job_id = $1 order by retry_count
    `, [jobId])).rows, [
      { retry_count: 1, outcome: "retry_failed", retry_after: 5 },
      { retry_count: 2, outcome: "retry_failed", retry_after: 10 },
      { retry_count: 3, outcome: "scheduled", retry_after: 20 },
    ]);

    const finalClaim = "00000000-0000-4000-8000-00000000a007";
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
      argumentsValue: retryArguments(4),
      retryCount: 4,
      retryAfterSeconds: 40,
    }), /ownership lost|invalid Temu detail retry descriptor/);
  } finally { await db.close(); }
});

test("Temu retry state UI projection is admin-only and exposes no after-sales or order IDs", async () => {
  const db = await fixture();
  try {
    await insertRunning(db);
    await requeue(db);
    const row = (await db.query(
      "select * from public.sellerpilot_admin_temu_after_sales_detail_retry_status_v1($1)",
      [jobId],
    )).rows[0];
    assert.equal(row.job_id, jobId);
    assert.equal(row.retry_count, 1);
    assert.equal(row.provider_status, 503);
    assert.equal(row.outcome, "scheduled");
    assert.doesNotMatch(JSON.stringify(row), /AFTER-1|ORDER-1/);
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(`
        select has_function_privilege(
          $1,
          'public.sellerpilot_admin_temu_after_sales_detail_retry_status_v1(uuid)',
          'EXECUTE'
        ) ok
      `, [role])).rows[0].ok, false);
    }
    assert.equal((await db.query(`
      select has_table_privilege(
        'service_role',
        'sellerpilot_private.temu_after_sales_detail_retry_ledger',
        'SELECT'
      ) ok
    `)).rows[0].ok, false);
  } finally { await db.close(); }
});
