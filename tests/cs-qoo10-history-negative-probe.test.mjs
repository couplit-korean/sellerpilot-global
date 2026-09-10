import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { qoo10HistoryGatewayCompletion } from "../lib/channels/cs/qoo10/history-gateway.ts";
import { qoo10HistoryExecutionRequests } from "../lib/channels/cs/qoo10/history-runtime.ts";

const migration = await readFile(new URL(
  "../supabase/migrations/20260909153334_cs_qoo10_history_window_ledger.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000000001";
const credential = "00000000-0000-4000-8000-000000000002";
const worker = "00000000-0000-4000-8000-000000000003";
const job = "00000000-0000-4000-8000-000000000004";
const claim = "00000000-0000-4000-8000-000000000005";
const tokenHash = "a".repeat(64);
const sellerAccountKey = "b".repeat(64);

function providerResult() {
  return {
    ok: true,
    channel: "qoo10",
    operation: "inquiries.list",
    steps: [{
      name: "GetInquiryMessage",
      ok: true,
      status: 200,
      data: { ResultCode: 0, ResultObject: [], TotalCount: 5 },
    }],
    safeMessage: "fixture only",
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions;
    create function extensions.digest(value text, algorithm text) returns bytea
      language sql immutable as $$
        select case when lower(algorithm)='sha256' then sha256(convert_to(value,'UTF8'))
          else convert_to(md5(value || algorithm),'UTF8') end
      $$;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,seller_account_key text not null
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,status text not null,
      expires_at timestamptz not null,scope text not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      attempt_id uuid,channel text not null,operation text not null,environment text not null,
      request_payload jsonb not null,response_payload jsonb,status text not null default 'queued',
      created_by uuid not null,seller_account_key text not null,
      created_at timestamptz not null default now()
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
      claim_token uuid not null,worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id)
    );
  `);
  await db.exec(migration);
  const request = qoo10HistoryExecutionRequests("2026-09-09", "2026-09-09")[0];
  await db.query("insert into sellerpilot_private.channel_credentials values($1,$2)", [credential, sellerAccountKey]);
  await db.query("insert into sellerpilot_private.ai_cli_worker_tokens values($1,$2,'active',clock_timestamp()+interval '1 hour','gateway')", [worker, tokenHash]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,response_payload,status,
    created_by,seller_account_key
  ) values($1,$2,'qoo10','inquiries.list','production',$3,$4,'succeeded',$5,$6)`, [
    job, credential, JSON.stringify(request), JSON.stringify(providerResult()), owner, sellerAccountKey,
  ]);
  await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)", [job, claim, worker]);
  return { db, request };
}

test("Qoo10 history RPC stores one body-free parent and enqueues each refinement once", async () => {
  const { db, request } = await fixture();
  try {
    const completion = qoo10HistoryGatewayCompletion({
      arguments: request.arguments,
      result: providerResult(),
    });
    assert.ok(completion);
    assert.equal(completion.state, "refining");
    const record = () => db.query(`select public.sellerpilot_service_record_qoo10_history_window_v1(
      $1,$2,$3,$4::jsonb
    ) result`, [tokenHash, job, claim, JSON.stringify(completion)]);
    const first = (await record()).rows[0].result;
    assert.equal(first.status, "recorded");
    assert.equal(first.refinementCount, 24);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.qoo10_history_windows")).rows[0].n, 25);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs")).rows[0].n, 25);
    const second = (await record()).rows[0].result;
    assert.equal(second.status, "duplicate");
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.qoo10_history_windows")).rows[0].n, 25);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs")).rows[0].n, 25);
    const root = (await db.query("select completion_state,completion_reason,provider_row_count,provider_total,refinement_count from sellerpilot_private.qoo10_history_windows where job_id=$1", [job])).rows[0];
    assert.deepEqual(root, {
      completion_state: "refining",
      completion_reason: "provider_total_mismatch",
      provider_row_count: 0,
      provider_total: null,
      refinement_count: 24,
    });
    const child = (await db.query("select request_payload from sellerpilot_private.channel_gateway_jobs where id<>$1 order by request_payload->>'periodicKey' limit 1", [job])).rows[0].request_payload;
    assert.equal(child.arguments.sellerpilotHistoryWindow.parentWindowKey, request.periodicKey);
    assert.deepEqual(Object.keys(child.arguments).sort(), ["params", "sellerpilotHistoryWindow"]);
    assert.doesNotMatch(JSON.stringify(child), /contents|customer|buyer|address|phone/iu);
  } finally {
    await db.close();
  }
});

test("Qoo10 history ledger is not directly readable and only service_role can execute its writer", async () => {
  const { db } = await fixture();
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const access = (await db.query(
        "select has_table_privilege($1,'sellerpilot_private.qoo10_history_windows','SELECT') direct, has_function_privilege($1,'public.sellerpilot_service_record_qoo10_history_window_v1(text,uuid,uuid,jsonb)','EXECUTE') writer",
        [role],
      )).rows[0];
      assert.equal(access.direct, false);
      assert.equal(access.writer, role === "service_role");
    }
  } finally {
    await db.close();
  }
});

for (const kind of ['changed-replay', 'missing-contract']) {
 test('central negative probe: '+kind, async () => {
  const {db,request}=await fixture();
  try {
   const completion=structuredClone(qoo10HistoryGatewayCompletion({arguments:request.arguments,result:providerResult()}));
   const record=()=>db.query('select public.sellerpilot_service_record_qoo10_history_window_v1($1,$2,$3,$4::jsonb) result',[tokenHash,job,claim,JSON.stringify(completion)]);
   if(kind==='changed-replay') {await record(); completion.coverage.providerTotal=999;}
   else delete completion.contractVersion;
   await assert.rejects(record, /QOO10_HISTORY_COMPLETION_INVALID|REPLAY|MISMATCH/);
  } finally {await db.close();}
 });
}
