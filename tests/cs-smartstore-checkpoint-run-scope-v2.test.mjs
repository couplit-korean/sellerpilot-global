import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { z } from "zod";

const operator = "00000000-0000-4000-8000-000000000700";
const seller = "00000000-0000-4000-8000-000000000701";
const credential = "00000000-0000-4000-8000-000000000702";
const runA = "00000000-0000-4000-8000-000000000703";
const runB = "00000000-0000-4000-8000-000000000704";
const orphanRun = "00000000-0000-4000-8000-000000000705";
const runC = "00000000-0000-4000-8000-000000000706";
const fromDate = "2024-08-01";
const throughDate = "2024-08-01";
const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

const checkpointV1Sql = await readFile(new URL(
  "../supabase/migrations/20260908140405_cs_smartstore_history_checkpoint.sql",
  import.meta.url,
), "utf8");
const checkpointV2Sql = await readFile(new URL(
  "../supabase/migrations/20260908142530_cs_smartstore_checkpoint_run_scope_v2.sql",
  import.meta.url,
), "utf8");

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    insert into sellerpilot_private.admin_users values('${operator}');
    create function public.sellerpilot_is_admin() returns boolean
      language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;

    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid,channel text,environment text,status text,
      expires_at timestamptz,seller_account_key text,seller_account_key_source text,
      seller_account_verified_at timestamptz,version integer,created_at timestamptz
    );
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${seller}','smartstore','production','active',null,
      'seller-a','credential_incarnation_v1',now(),1,now()
    );
    create table sellerpilot_private.inquiry_history_backfill_runs(
      id uuid primary key,request_key text not null unique,owner_id uuid not null,
      initiated_by uuid,history_days integer not null,range_start date not null,
      range_end date not null,status text not null,expected_initial_jobs integer not null,
      total_jobs integer not null,queued_jobs integer not null,running_jobs integer not null,
      succeeded_jobs integer not null,failed_jobs integer not null,completed_at timestamptz,
      channels text[] not null,credential_ids jsonb not null
    );
    create table sellerpilot_private.cs_history_scans(
      id bigint generated always as identity primary key,owner_id uuid not null,
      credential_id uuid not null,channel text not null,environment text not null,
      scope_key text,ticket_kind text not null,status text not null,
      scan_completed_at timestamptz,reconciled_at timestamptz,unprocessed_count integer,
      range_start_at timestamptz,range_end_at timestamptz
    );
    revoke all on sellerpilot_private.channel_credentials,
      sellerpilot_private.inquiry_history_backfill_runs,
      sellerpilot_private.cs_history_scans from public,anon,authenticated,service_role;
    select set_config('request.jwt.claim.sub','${operator}',false);
  `);
  await db.exec(checkpointV1Sql);
  await db.exec(checkpointV2Sql);
  return db;
}

async function checkpoint(db, version = 2, floor = fromDate, through = throughDate) {
  // V1 remains only as a privileged regression reproducer after V2 retires its
  // API grant. Actual application reads must use V2.
  if (version === 1) await db.exec("reset role");
  try { return (await db.query(
    `select public.sellerpilot_next_smartstore_history_window_v${version}($1,$2,$3,'production') result`,
    [floor, through, credential],
  )).rows[0].result;
  } finally { if (version === 1) await db.exec("set role authenticated"); }
}

async function insertRun(db, {
  id,
  status = "succeeded",
  credentialIds = { smartstore: credential },
  totalJobs = 2,
  succeededJobs = totalJobs,
  rangeStart = fromDate,
  rangeEnd = throughDate,
} = {}) {
  const historyDays = Math.round((Date.parse(`${rangeEnd}T00:00:00Z`)
    - Date.parse(`${rangeStart}T00:00:00Z`)) / 86_400_000) + 1;
  await db.query(`
    insert into sellerpilot_private.inquiry_history_backfill_runs(
      id,request_key,owner_id,initiated_by,history_days,range_start,range_end,status,
      expected_initial_jobs,total_jobs,queued_jobs,running_jobs,succeeded_jobs,failed_jobs,
      completed_at,channels,credential_ids
    ) values($1,$2,$3,$4,$5,$6,$7,$8,2,$9,
      case when $8='queued' then $9 else 0 end,0,$10,0,
      case when $8='succeeded' then now() else null end,array['smartstore']::text[],$11)
  `, [id, id.replaceAll("-", "").padEnd(64, "0").slice(0, 64), seller, operator,
    historyDays, rangeStart, rangeEnd, status, totalJobs, succeededJobs, credentialIds]);
}

async function insertScan(db, {
  runId,
  kind,
  status = "completed",
  reconciled = true,
  unprocessedCount = 0,
  scopeKey,
  rangeStart = fromDate,
  rangeEnd = throughDate,
} = {}) {
  const scope = scopeKey === undefined
    ? `inquiries:history:${runId}:smartstore:${kind}:${rangeStart}:${rangeEnd}`
    : scopeKey;
  await db.query(`
    insert into sellerpilot_private.cs_history_scans(
      owner_id,credential_id,channel,environment,scope_key,ticket_kind,status,
      scan_completed_at,reconciled_at,unprocessed_count,range_start_at,range_end_at
    ) values($1,$2,'smartstore','production',$3,$4,$5,
      case when $5 in('completed','reconciliation_required') then now() else null end,
      case when $6 then now() else null end,$7,$8,$9)
  `, [seller, credential, scope, kind, status, reconciled, unprocessedCount,
    `${rangeStart}T00:00:00+09:00`, `${rangeEnd}T23:59:59+09:00`]);
}

test("frozen v1 reproduces orphan-scan completion while v2 requires a real run", async () => {
  const db = await fixture();
  try {
    await db.exec("set role authenticated");
    assert.equal((await checkpoint(db, 1)).complete, false);
    assert.equal((await checkpoint(db, 2)).complete, false);
    await db.exec("reset role");
    await insertScan(db, { runId: orphanRun, kind: "product" });
    await insertScan(db, { runId: orphanRun, kind: "customer" });
    await db.exec("set role authenticated");
    assert.equal((await checkpoint(db, 1)).complete, true);
    const corrected = await checkpoint(db, 2);
    assert.equal(corrected.complete, false);
    assert.equal(corrected.completedWindowCount, 0);
    assert.equal(corrected.nextWindow.fromDate, fromDate);
  } finally {
    await db.close();
  }
});

test("v2 rejects queued runs and missing credential scope even when both scans look complete", async () => {
  const db = await fixture();
  try {
    await insertRun(db, {
      id: runA,
      status: "queued",
      credentialIds: {},
      totalJobs: 2,
      succeededJobs: 0,
    });
    await insertScan(db, { runId: runA, kind: "product" });
    await insertScan(db, { runId: runA, kind: "customer" });
    await db.exec("set role authenticated");
    assert.equal((await checkpoint(db, 1)).complete, true);
    assert.equal((await checkpoint(db)).complete, false);
    await db.exec("reset role");
    await db.exec(`update sellerpilot_private.inquiry_history_backfill_runs set
      status='succeeded',queued_jobs=0,succeeded_jobs=2,completed_at=now()
      where id='${runA}'`);
    await db.exec("set role authenticated");
    assert.equal((await checkpoint(db, 1)).complete, true);
    assert.equal((await checkpoint(db)).complete, false);
    await db.exec("reset role");
    await db.query(`update sellerpilot_private.inquiry_history_backfill_runs
      set credential_ids=jsonb_build_object('smartstore',$1::text) where id=$2`, [credential, runA]);
    await db.exec("set role authenticated");
    assert.equal((await checkpoint(db)).complete, true);
  } finally {
    await db.close();
  }
});

test("v2 never pairs product and customer scans from different runs", async () => {
  const db = await fixture();
  try {
    await insertRun(db, { id: runA });
    await insertRun(db, { id: runB, totalJobs: 4, succeededJobs: 4 });
    await insertScan(db, { runId: runA, kind: "product" });
    await insertScan(db, { runId: runB, kind: "customer" });
    await db.exec("set role authenticated");
    assert.equal((await checkpoint(db, 1)).complete, true);
    assert.equal((await checkpoint(db, 2)).complete, false);
  } finally {
    await db.close();
  }
});

test("v2 requires both kinds reconciled, zero-unprocessed, and in the same succeeded run", async () => {
  const db = await fixture();
  try {
    await insertRun(db, { id: runA, totalJobs: 4, succeededJobs: 4 });
    await insertScan(db, { runId: runA, kind: "product" });
    await insertScan(db, {
      runId: runA,
      kind: "customer",
      status: "reconciliation_required",
      reconciled: false,
      unprocessedCount: null,
    });
    await db.exec("set role authenticated");
    assert.equal((await checkpoint(db, 1)).complete, false);
    assert.equal((await checkpoint(db)).complete, false);
    await db.exec("reset role");
    await db.exec(`update sellerpilot_private.cs_history_scans set
      status='completed',reconciled_at=now(),unprocessed_count=0
      where scope_key like '%:customer:%'`);
    await db.exec("set role authenticated");
    const corrected = await checkpoint(db);
    assert.equal(corrected.contract, "sellerpilot-smartstore-history-checkpoint/2");
    assert.equal(corrected.complete, true);
    assert.equal(corrected.completedWindowCount, 1);
    assert.equal(corrected.nextWindow, null);
  } finally {
    await db.close();
  }
});

test("v2 binds completion to exact window boundaries when checkpoint scope changes", async () => {
  const db = await fixture();
  try {
    const latestStart = "2024-01-31";
    const latestEnd = "2024-02-29";
    await insertRun(db, { id: runC, rangeStart: latestStart, rangeEnd: latestEnd });
    await insertScan(db, { runId: runC, kind: "product", rangeStart: latestStart, rangeEnd: latestEnd });
    await insertScan(db, { runId: runC, kind: "customer", rangeStart: latestStart, rangeEnd: latestEnd });
    await db.exec("set role authenticated");
    const original = await checkpoint(db, 2, "2024-01-01", latestEnd);
    assert.deepEqual([
      original.totalWindowCount,
      original.completedWindowCount,
      original.nextWindow.fromDate,
      original.nextWindow.throughDate,
    ], [2, 1, "2024-01-01", "2024-01-30"]);
    const shifted = await checkpoint(db, 2, "2024-01-01", "2024-02-28");
    assert.deepEqual([
      shifted.totalWindowCount,
      shifted.completedWindowCount,
      shifted.nextWindow.fromDate,
      shifted.nextWindow.throughDate,
    ], [2, 0, "2024-01-30", "2024-02-28"]);
  } finally {
    await db.close();
  }
});

test("v2 rejects missing verified seller credential scope and preserves exact ACL", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.sellerpilot_next_smartstore_history_window_v1(date,date,uuid,text)','execute') allowed",
        [role],
      )).rows[0].allowed, false);
    }
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.sellerpilot_next_smartstore_history_window_v2(date,date,uuid,text)','execute') allowed",
        [role],
      )).rows[0].allowed, false);
    }
    await db.exec(`update sellerpilot_private.channel_credentials
      set seller_account_verified_at=null where id='${credential}';set role authenticated`);
    await assert.rejects(checkpoint(db), /SMARTSTORE_HISTORY_CHECKPOINT_CREDENTIAL_INVALID/);
    await assert.rejects(
      db.query("select * from sellerpilot_private.inquiry_history_backfill_runs"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("005 plus 007 route patches parse without diagnostics and call checkpoint v2", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "sellerpilot-smartstore-checkpoint-v2-"));
  const isolatedClone = path.join(temporaryRoot, "repository");
  try {
    await execFileAsync("git", ["clone", "--quiet", "--shared", "--no-checkout", repositoryRoot, isolatedClone]);
    for (const patchName of [
      "smartstore-005-common-integration.patch",
      "smartstore-007-frozen-005-syntax-repair.patch",
      "smartstore-007-common-integration.patch",
    ]) {
      await execFileAsync("git", ["apply", path.join(
        repositoryRoot,
        "docs/cs-parallel/proposals/smartstore",
        patchName,
      )], { cwd: isolatedClone });
    }
    const route = await readFile(path.join(
      isolatedClone,
      "app/api/admin/cs/channels/smartstore/history-resume-v5/route.ts",
    ), "utf8");
    const compiled = ts.transpileModule(route, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: "history-resume-v5/route.ts",
      reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics?.length ?? 0, 0);
    assert.match(route, /sellerpilot-smartstore-history-checkpoint\/2/);
    assert.match(route, /sellerpilot_next_smartstore_history_window_v2/);
    assert.match(route, /same_succeeded_run_both_product_and_customer_completed_reconciled_zero_unprocessed/);
    assert.equal(route.trimEnd().endsWith("}"), true);
    const exportsObject = {};
    const calls = [];
    const sandbox = vm.createContext({
      exports: exportsObject,
      Request,
      Response,
      URL,
      Date,
      require(name) {
        if (name === "zod") return { z };
        if (name === "next/server") return { NextResponse: Response };
        if (name.endsWith("/admin-api")) return {
          authenticateAdminRequest: async () => ({
            userClient: { rpc: async (rpcName, args) => {
              calls.push({ name: rpcName, args });
              if (rpcName === "sellerpilot_list_credentials") return {
                data: [{ id: credential, channel: "smartstore", environment: "production", status: "active" }],
                error: null,
              };
              if (rpcName === "sellerpilot_next_smartstore_history_window_v2") return {
                data: {
                  contract: "sellerpilot-smartstore-history-checkpoint/2",
                  checkedAt: "2026-09-08T00:00:00Z",
                  environment: "production",
                  totalWindowCount: 1,
                  completedWindowCount: 0,
                  remainingWindowCount: 1,
                  complete: false,
                  nextWindow: {
                    key: "smartstore:history:v2:2024-08-01:2024-08-01",
                    fromDate,
                    throughDate,
                    productItemKey: `product:${fromDate}:${throughDate}`,
                    customerItemKey: `customer:${fromDate}:${throughDate}`,
                  },
                  advanceRule: "same_succeeded_run_both_product_and_customer_completed_reconciled_zero_unprocessed",
                },
                error: null,
              };
              throw new Error(`unexpected rpc ${rpcName}`);
            } },
          }),
          isAdminApiError: value => value instanceof Response,
        };
        throw new Error(`unexpected import ${name}`);
      },
    });
    vm.runInContext(compiled.outputText, sandbox);
    const response = await exportsObject.GET(new Request(
      `https://sellerpilot.test/api/admin/cs/channels/smartstore/history-resume-v5?floorDate=${fromDate}&throughDate=${throughDate}`,
    ));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map(call => call.name), [
      "sellerpilot_list_credentials",
      "sellerpilot_next_smartstore_history_window_v2",
    ]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
