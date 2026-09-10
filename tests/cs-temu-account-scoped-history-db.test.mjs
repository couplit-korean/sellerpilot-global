import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260909134540_temu_account_scoped_history_metadata.sql",
  import.meta.url,
), "utf8");
const administrator = "00000000-0000-4000-8000-00000000d401";
const outsider = "00000000-0000-4000-8000-00000000d402";
const ownerA = "00000000-0000-4000-8000-00000000d403";
const ownerB = "00000000-0000-4000-8000-00000000d404";
const credentialA = "00000000-0000-4000-8000-00000000d405";
const credentialB = "00000000-0000-4000-8000-00000000d406";
const inactiveCredential = "00000000-0000-4000-8000-00000000d407";
const sellerA = "a".repeat(64);
const sellerB = "b".repeat(64);
const jobA = "00000000-0000-4000-8000-00000000d411";
const legacyJobA = "00000000-0000-4000-8000-00000000d412";
const jobB = "00000000-0000-4000-8000-00000000d413";
const mismatchedJob = "00000000-0000-4000-8000-00000000d414";
const nonTemuJob = "00000000-0000-4000-8000-00000000d415";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid()returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key,display_name text);
    create function public.sellerpilot_is_admin()returns boolean language sql stable security definer as $$
      select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())
    $$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,status text,expires_at timestamptz,
      fingerprint text,version integer,seller_account_key text,seller_account_key_source text,
      seller_account_verified_at timestamptz,created_by uuid
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,channel text,operation text,environment text,
      seller_account_key text,created_by uuid,request_payload jsonb default '{}'::jsonb
    );
    create table sellerpilot_private.cs_history_scans(
      id uuid primary key,root_job_id uuid,owner_id uuid,credential_id uuid,channel text,
      environment text,scope_key text,ticket_kind text,status text,range_start_at timestamptz,
      range_end_at timestamptz,timezone_name text,page_count integer,provider_row_count integer,
      projected_event_count integer,observed_unique_count integer,repeated_observation_count integer,
      excluded_count integer,unprocessed_count integer,missing_ranges jsonb,started_at timestamptz,
      scan_completed_at timestamptz,reconciled_at timestamptz,updated_at timestamptz
    );
    create table sellerpilot_private.cs_history_scan_gaps(
      job_id uuid primary key,owner_id uuid,credential_id uuid,channel text,environment text,
      scope_key text,terminal_status text,first_observed_at timestamptz,last_observed_at timestamptz,
      resolved_at timestamptz
    );
    create table sellerpilot_private.temu_after_sales_detail_retry_ledger(
      job_id uuid,retry_count smallint,deferred_count smallint,replay_count smallint,
      provider_status smallint,failure_code text,observed_at timestamptz,next_attempt_at timestamptz,
      outcome text,resolved_at timestamptz
    );
    create function public.sellerpilot_read_cs_history_coverage_v1()returns jsonb
      language sql stable security definer as $$select '{"contract":"legacy"}'::jsonb$$;
    create function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(uuid default null)
      returns table(job_id uuid,retry_count smallint,deferred_count smallint,replay_count smallint,
        provider_status smallint,failure_code text,observed_at timestamptz,next_attempt_at timestamptz,
        outcome text,resolved_at timestamptz)
      language sql stable security definer as $$select null::uuid,null::smallint,null::smallint,
        null::smallint,null::smallint,null::text,null::timestamptz,null::timestamptz,
        null::text,null::timestamptz where false$$;
    grant execute on function public.sellerpilot_read_cs_history_coverage_v1()to authenticated;
    grant execute on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(uuid)to authenticated;
    insert into auth.users values('${administrator}'),('${outsider}'),('${ownerA}'),('${ownerB}');
    insert into sellerpilot_private.admin_users values('${administrator}','shared admin');
    insert into sellerpilot_private.channel_credentials values
      ('${credentialA}','temu','production','active',now()+interval'1 day','fingerprint-a',1,
       '${sellerA}','provider_certified_v1',now(),'${ownerA}'),
      ('${credentialB}','temu','production','active',now()+interval'1 day','fingerprint-b',1,
       '${sellerB}','provider_certified_v1',now(),'${ownerB}'),
      ('${inactiveCredential}','temu','production','revoked',now()+interval'1 day','fingerprint-c',1,
       '${"c".repeat(64)}','provider_certified_v1',now(),'${ownerA}');
    insert into sellerpilot_private.channel_gateway_jobs values
      ('${jobA}','${credentialA}','temu','inquiries.list','production','${sellerA}','${ownerA}','{}'),
      ('${legacyJobA}','${credentialA}','temu','inquiries.list','production',null,'${ownerA}','{}'),
      ('${jobB}','${credentialB}','temu','inquiries.list','production','${sellerB}','${ownerB}','{}'),
      ('${mismatchedJob}','${credentialA}','temu','inquiries.list','production','${sellerB}','${ownerA}','{}'),
      ('${nonTemuJob}','${credentialA}','qoo10','inquiries.list','production',null,'${ownerA}','{}');
  `);
  for (const [index, [job, credential, owner, channel]] of [
    [jobA, credentialA, ownerA, "temu"],
    [legacyJobA, credentialA, ownerA, "temu"],
    [jobB, credentialB, ownerB, "temu"],
    [mismatchedJob, credentialA, ownerA, "temu"],
    [nonTemuJob, credentialA, ownerA, "qoo10"],
  ].entries()) {
    await db.query(`insert into sellerpilot_private.cs_history_scans values(
      $1,$2,$3,$4,$5,'production',$6,'after_sales','completed',now()-interval'1 day',now(),
      'Asia/Seoul',1,1,1,1,0,0,0,'[]',now()-interval'1 day',now(),now(),now()+$7*interval'1 second'
    )`, [`00000000-0000-4000-8000-${String(0xd420 + index).padStart(12, "0")}`, job, owner, credential,
      channel, `scope-${index}`, index]);
  }
  for (const [job, retry] of [[jobA, 1], [legacyJobA, 2], [jobB, 1], [mismatchedJob, 1]]) {
    await db.query(`insert into sellerpilot_private.temu_after_sales_detail_retry_ledger values(
      $1,$2,1,0,503,'TEMU_AFTER_SALES_DETAIL_READ_FAILED',now(),now()+interval'5 seconds','scheduled',null
    )`, [job, retry]);
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [administrator]);
  await db.exec(migration);
  return db;
}

async function value(db, sql, parameters = []) {
  return (await db.query(sql, parameters)).rows[0]?.result;
}

test("shared administrator selects either active provider-certified account without becoming its owner", async () => {
  const db = await fixture();
  try {
    await db.exec("set role authenticated");
    const accounts = await value(db, "select public.sellerpilot_list_temu_cs_accounts_v1() result");
    assert.deepEqual(accounts.accounts.map(row => row.credentialId).sort(), [credentialA, credentialB].sort());
    assert.equal(accounts.accounts.some(row => row.credentialId === inactiveCredential), false);
    assert.equal(accounts.accounts.every(row => !row.label.includes(row.credentialId)), true);
    assert.notEqual(administrator, ownerA);
    assert.notEqual(administrator, ownerB);
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("two accounts isolate persisted coverage while same-account legacy rows remain visible", async () => {
  const db = await fixture();
  try {
    await db.exec("set role authenticated");
    const a = await value(db, "select public.sellerpilot_read_cs_history_coverage_v2($1) result", [credentialA]);
    assert.equal(a.credentialId, credentialA);
    assert.deepEqual(a.coverage.scans.map(row => row.scopeKey).sort(), ["scope-0", "scope-1"]);
    assert.deepEqual(a.bindingSummary, { exactSellerRows: 1, legacyCredentialRows: 1 });
    const b = await value(db, "select public.sellerpilot_read_cs_history_coverage_v2($1) result", [credentialB]);
    assert.deepEqual(b.coverage.scans.map(row => row.scopeKey), ["scope-2"]);
    assert.equal(JSON.stringify(a).includes("scope-2"), false);
    assert.equal(JSON.stringify(a).includes("scope-3"), false);
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("retry metadata is credential and seller bound, rejects cross-bound job IDs, and labels legacy rows", async () => {
  const db = await fixture();
  try {
    await db.exec("set role authenticated");
    const a = await value(db,
      "select public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3($1,null) result", [credentialA]);
    assert.deepEqual(a.retries.map(row => [row.jobId, row.accountBinding]).sort(), [
      [jobA, "credential_seller_exact"], [legacyJobA, "legacy_credential_owner"],
    ].sort());
    await assert.rejects(db.query(
      "select public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3($1,$2)",
      [credentialA, jobB],
    ), /TEMU_RETRY_JOB_SCOPE_MISMATCH/);
    await assert.rejects(db.query(
      "select public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3($1,null)",
      [inactiveCredential],
    ), /TEMU_RETRY_ACCOUNT_SELECTION_INVALID/);
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("legacy unscoped readers cannot expose Temu metadata and non-admin calls fail", async () => {
  const db = await fixture();
  try {
    await db.exec("set role authenticated");
    const legacyCoverage = await value(db, "select public.sellerpilot_read_cs_history_coverage_v1() result");
    assert.deepEqual(legacyCoverage.scans.map(row => row.channel), ["qoo10"]);
    assert.equal((await db.query(`select has_function_privilege(
      'authenticated','public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(uuid)','EXECUTE')ok`
    )).rows[0].ok, false);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select public.sellerpilot_list_temu_cs_accounts_v1()"), /administrator required/);
    await assert.rejects(db.query(
      "select public.sellerpilot_read_cs_history_coverage_v2($1)", [credentialA],
    ), /administrator required/);
    await assert.rejects(db.query(
      "select public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3($1,null)", [credentialA],
    ), /administrator required/);
    await db.exec("reset role");
  } finally { await db.close(); }
});
