import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const source = await readFile(new URL('../supabase/migrations/20260907231000_add_cs_history_coverage_ledger.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-8000-000000000401';
const credential = '00000000-0000-4000-8000-000000000402';
const tokenId = '00000000-0000-4000-8000-000000000403';
const rootJob = '00000000-0000-4000-8000-000000000404';
const childJob = '00000000-0000-4000-8000-000000000405';
const claimRoot = '00000000-0000-4000-8000-000000000406';
const claimChild = '00000000-0000-4000-8000-000000000407';
const digest = value => value.repeat(64);

async function fixture(beforeMigration) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer as $$select auth.uid()='${owner}'::uuid$$;
    create schema extensions; create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(id uuid primary key,created_by uuid not null references auth.users(id));
    create table sellerpilot_private.ai_cli_worker_tokens(id uuid primary key,token_hash text not null,scope text,status text,expires_at timestamptz);
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,operation text not null,environment text not null,request_payload jsonb not null,
      response_payload jsonb,status text not null,created_by uuid not null references auth.users(id),
      started_at timestamptz,created_at timestamptz not null default now(),completed_at timestamptz
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
      claim_token uuid not null,worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id)
    );
  `);
  await db.query('insert into auth.users values($1)', [owner]);
  await db.query('insert into sellerpilot_private.channel_credentials values($1,$2)', [credential, owner]);
  await db.query("insert into sellerpilot_private.ai_cli_worker_tokens values($1,'token-hash','gateway','active',now()+interval '1 day')", [tokenId]);
  if (beforeMigration) await beforeMigration(db);
  await db.exec(source);
  return db;
}

async function insertJob(db, { id, claim, request, response, channel = 'qoo10' }) {
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,response_payload,status,created_by,started_at,completed_at
  ) values($1,$2,$3,'inquiries.list','production',$4,$5,'succeeded',$6,now()-interval '1 minute',now())`,
  [id, credential, channel, request, response, owner]);
  await db.query('insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)', [id, claim, tokenId]);
}

async function recordPage(db, { jobId, claim, rows = 2, projected = 2, digests = [digest('a'), digest('b')], excluded = 0, comparable = true, more = false }) {
  return (await db.query(`select public.sellerpilot_service_record_cs_history_page_v1(
    'token-hash',$1,$2,'sellerpilot-inquiry-coverage/1',$3,$4,$5,$6,$7,$8
  ) result`, [jobId, claim, rows, projected, JSON.stringify(digests), excluded, comparable, more])).rows[0].result;
}

test('multi-page lineage separates rows, projected events, unique observations and repeats', async () => {
  const db = await fixture();
  try {
    const periodicKey = 'inquiries:history:2026-08-01:2026-08-07:product:all';
    await insertJob(db, {
      id: rootJob, claim: claimRoot,
      request: { periodicKey, arguments: { kind: 'product', query: { inquiryStartAt: '2026-08-01', inquiryEndAt: '2026-08-07' } } },
      response: { ok: true, operation: 'inquiries.list', continuation: { reason: 'page_cap_reached', arguments: { query: { pageNum: 2 } } } },
    });
    const first = await recordPage(db, { jobId: rootJob, claim: claimRoot, more: true });
    assert.equal(first.status, 'running');
    await insertJob(db, {
      id: childJob, claim: claimChild,
      request: { periodicKey, continuationOf: rootJob, arguments: { kind: 'product', query: { pageNum: 2 } } },
      response: { ok: true, operation: 'inquiries.list' },
    });
    const second = await recordPage(db, {
      jobId: childJob, claim: claimChild, digests: [digest('b'), digest('c')],
    });
    assert.equal(second.status, 'completed');
    assert.equal(second.pageNumber, 2);
    const scan = (await db.query('select * from sellerpilot_private.cs_history_scans')).rows[0];
    assert.equal(scan.root_job_id, rootJob);
    assert.equal(scan.status, 'completed');
    assert.equal(scan.page_count, 2);
    assert.equal(scan.provider_row_count, 4);
    assert.equal(scan.projected_event_count, 4);
    assert.equal(scan.observed_unique_count, 3);
    assert.equal(scan.repeated_observation_count, 1);
    assert.equal(scan.unprocessed_count, 0);
    assert.equal(scan.timezone_name, 'Asia/Seoul');
    assert.ok(scan.scan_completed_at);
    assert.ok(scan.reconciled_at);
    assert.equal((await recordPage(db, { jobId: childJob, claim: claimChild })).status, 'duplicate');
  } finally { await db.close(); }
});

test('non one-to-one adapters and count mismatches remain reconciliation-required', async () => {
  const db = await fixture();
  try {
    await insertJob(db, {
      id: rootJob, claim: claimRoot, channel: 'shopee',
      request: { periodicKey: 'inquiries:history:shopee:comments', arguments: { kind: 'review' } },
      response: { ok: true, operation: 'inquiries.list' },
    });
    const result = await recordPage(db, { jobId: rootJob, claim: claimRoot, rows: 1, projected: 2, comparable: false });
    assert.equal(result.status, 'reconciliation_required');
    const scan = (await db.query('select status,unprocessed_count,missing_ranges from sellerpilot_private.cs_history_scans')).rows[0];
    assert.equal(scan.status, 'reconciliation_required');
    assert.equal(scan.unprocessed_count, null);
    assert.equal(scan.missing_ranges[0].reason, 'provider_rows_and_projected_events_not_one_to_one');
  } finally { await db.close(); }
});

test('continuation and completion receipts are exact, while ordinary polling is ignored', async () => {
  const db = await fixture();
  try {
    await insertJob(db, {
      id: rootJob, claim: claimRoot,
      request: { periodicKey: 'inquiries:product', arguments: { kind: 'product' } },
      response: { ok: true, operation: 'inquiries.list' },
    });
    assert.equal((await recordPage(db, { jobId: rootJob, claim: claimRoot })).status, 'ignored');
    assert.equal((await db.query('select count(*)::int n from sellerpilot_private.cs_history_scans')).rows[0].n, 0);
    await assert.rejects(recordPage(db, { jobId: rootJob, claim: claimChild }), /CS_HISTORY_COMPLETION_RECEIPT_REQUIRED/);
    await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{periodicKey}','\"inquiries:history:bad\"'),response_payload=response_payload||'{\"continuation\":{}}'::jsonb where id=$1", [rootJob]);
    await assert.rejects(recordPage(db, { jobId: rootJob, claim: claimRoot, more: false }), /CS_HISTORY_CONTINUATION_MISMATCH/);
  } finally { await db.close(); }
});

test('coverage read is administrator-only and underlying evidence has no direct grants', async () => {
  const db = await fixture();
  try {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const access = (await db.query(
        "select has_table_privilege($1,'sellerpilot_private.cs_history_scans','SELECT') direct, has_function_privilege($1,'public.sellerpilot_service_record_cs_history_page_v1(text,uuid,uuid,text,integer,integer,jsonb,integer,boolean,boolean)','EXECUTE') writer, has_function_privilege($1,'public.sellerpilot_read_cs_history_coverage_v1()','EXECUTE') reader",
        [role],
      )).rows[0];
      assert.equal(access.direct, false);
      assert.equal(access.writer, role === 'service_role');
      assert.equal(access.reader, role === 'authenticated');
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    const result = (await db.query('select public.sellerpilot_read_cs_history_coverage_v1() result')).rows[0].result;
    assert.equal(result.contract, 'cs_history_coverage_read_v1');
    assert.deepEqual(result.scans, []);
    assert.deepEqual(result.gaps, []);
    await assert.rejects(db.query('select * from sellerpilot_private.cs_history_scans'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('failed history jobs stay visible as gaps and a later successful scope resolves them', async () => {
  const db = await fixture();
  try {
    const key = 'inquiries:history:2026-07-01:2026-08-04:mailbox';
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,response_payload,status,created_by,completed_at
    ) values($1,$2,'ebay','inquiries.list','production',$3,null,'failed',$4,now())`,
    [rootJob, credential, { periodicKey: key, arguments: { kind: 'mailbox' } }, owner]);
    let gap = (await db.query('select * from sellerpilot_private.cs_history_scan_gaps')).rows[0];
    assert.equal(gap.terminal_status, 'failed');
    assert.equal(gap.resolved_at, null);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,response_payload,status,created_by,completed_at
    ) values($1,$2,'ebay','inquiries.list','production',$3,'{"ok":true}'::jsonb,'succeeded',$4,now())`,
    [childJob, credential, { periodicKey: key, arguments: { kind: 'mailbox' } }, owner]);
    gap = (await db.query('select * from sellerpilot_private.cs_history_scan_gaps')).rows[0];
    assert.ok(gap.resolved_at);
  } finally { await db.close(); }
});

test('migration backfills the previous 35 days and resolves only the same exact scope', async () => {
  const oldJob = '00000000-0000-4000-8000-000000000408';
  const runGap = '00000000-0000-4000-8000-000000000409';
  const runSuccess = '00000000-0000-4000-8000-000000000410';
  const db = await fixture(async fixtureDb => {
    await fixtureDb.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,status,created_by,created_at,completed_at
    ) values
      ($1,$4,'qoo10','inquiries.list','production',$5,'failed',$7,now()-interval '36 days',now()-interval '36 days'),
      ($2,$4,'shopee','inquiries.list','production',$6,'failed',$7,now()-interval '2 days',now()-interval '2 days'),
      ($3,$4,'shopee','inquiries.list','production',$6,'succeeded',$7,now()-interval '1 day',now()-interval '1 day')`, [
      oldJob, runGap, runSuccess, credential,
      { periodicKey: 'inquiries:history:outside-window' },
      { arguments: { sellerpilotHistoryRunId: 'run-35-day-recovery' } },
      owner,
    ]);
  });
  try {
    const gaps = (await db.query('select * from sellerpilot_private.cs_history_scan_gaps order by job_id')).rows;
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].job_id, runGap);
    assert.equal(gaps[0].scope_key, 'inquiries:history-run:run-35-day-recovery');
    assert.ok(gaps[0].resolved_at);
  } finally { await db.close(); }
});
