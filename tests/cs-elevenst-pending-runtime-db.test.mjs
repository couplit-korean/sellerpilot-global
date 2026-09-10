import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const cont08Url = new URL("supabase/migrations/20260909133643_cs_elevenst_account_lifecycle.sql", root);
const cont09Url = new URL("supabase/migrations/20260909133703_cs_elevenst_pending_diagnostic.sql", root);

const admin = "11111111-1111-4111-8111-111111111111";
const pendingA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const pendingWrongAccount = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const activeOther = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const vaultA = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const vaultWrong = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const vaultOther = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const workerId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const workerHash = "e".repeat(64);

function functionDefinition(source, qualifiedName) {
  const marker = `create function ${qualifiedName}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${qualifiedName} definition missing`);
  const end = source.indexOf("\n$$;", source.indexOf("as $$", start));
  assert.notEqual(end, -1, `${qualifiedName} definition unterminated`);
  return source.slice(start, end + 4);
}

async function asRole(db, role, query, params = []) {
  await db.exec(`set role ${role}`);
  try {
    if (role === "authenticated") {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    }
    return await db.query(query, params);
  } finally {
    await db.exec("reset role");
  }
}

async function fixture() {
  const [cont08, cont09] = await Promise.all([
    readFile(cont08Url, "utf8"),
    readFile(cont09Url, "utf8"),
  ]);
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema vault;
    create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${admin}');
    create function auth.uid() returns uuid language sql stable set search_path=''
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key, display_name text);
    insert into sellerpilot_private.admin_users values ('${admin}','Admin');
    create function public.sellerpilot_is_admin() returns boolean
      language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
    create table vault.secrets(id uuid primary key, secret text not null);
    create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      channel text not null,
      environment text not null,
      version integer not null,
      vault_secret_id uuid not null,
      fingerprint text not null,
      status text not null check(status in ('pending','active','grace','revoked','invalid')),
      expires_at timestamptz,
      rotation_interval_days integer not null default 90,
      warning_days integer not null default 30,
      grace_ends_at timestamptz,
      last_rotated_at timestamptz not null default now(),
      last_checked_at timestamptz,
      last_check_status text,
      last_check_message text,
      created_by uuid not null references auth.users(id),
      created_at timestamptz not null default now(),
      seller_account_key text,
      seller_account_key_source text,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.elevenst_credential_identity_claims(
      credential_id uuid primary key references sellerpilot_private.channel_credentials(id),
      environment text not null,
      seller_id_digest text not null,
      seller_account_key text not null,
      lifecycle_state text not null,
      identity_evidence text not null default 'admin_claim_v1',
      access_checked_at timestamptz,
      activated_at timestamptz,
      replaced_credential_id uuid,
      created_by uuid not null references auth.users(id),
      created_at timestamptz not null default now()
    );
    create table sellerpilot_private.credential_audit(
      id bigint generated always as identity primary key,
      credential_id uuid,
      channel text not null,
      environment text not null,
      action text not null,
      actor_user_id uuid,
      safe_detail jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null default now()
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,
      token_hash text not null,
      status text not null,
      expires_at timestamptz not null,
      last_seen_at timestamptz,
      last_version text,
      scope text[] not null
    );
    create function sellerpilot_private.worker_token_has_scope(p_hash text,p_scope text,p_require_active boolean)
      returns boolean language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.ai_cli_worker_tokens
        where token_hash=p_hash and p_scope=any(scope)
          and (not p_require_active or (status='active' and expires_at>clock_timestamp())))$$;
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      credential_id uuid,
      attempt_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb,
      status text not null,
      error_message text,
      worker_token_id uuid,
      claim_token uuid,
      attempt_count integer not null default 0,
      lease_expires_at timestamptz,
      created_by uuid,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz not null default now(),
      provider_mutation_started_at timestamptz
    );
    insert into vault.secrets values
      ('${vaultA}','{"api_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","seller_id":"claimed-a"}'),
      ('${vaultWrong}','{"api_key":"CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC","seller_id":"claimed-wrong"}'),
      ('${vaultOther}','{"api_key":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","seller_id":"other-active"}');
    insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,fingerprint,status,created_by,
      seller_account_key,seller_account_key_source,seller_account_verified_at
    ) values
      ('${pendingA}','elevenst','production',1,'${vaultA}','AAAA00000001','pending','${admin}','${"1".repeat(64)}','credential_incarnation_v1',now()),
      ('${pendingWrongAccount}','elevenst','production',2,'${vaultWrong}','AAAA00000002','pending','${admin}','${"2".repeat(64)}','credential_incarnation_v1',now()),
      ('${activeOther}','elevenst','production',3,'${vaultOther}','BBBB00000003','active','${admin}','${"3".repeat(64)}','credential_incarnation_v1',now());
    insert into sellerpilot_private.elevenst_credential_identity_claims(
      credential_id,environment,seller_id_digest,seller_account_key,lifecycle_state,created_by
    ) values
      ('${pendingA}','production','${"a".repeat(64)}','${"1".repeat(64)}','pending','${admin}'),
      ('${pendingWrongAccount}','production','${"c".repeat(64)}','${"9".repeat(64)}','pending','${admin}'),
      ('${activeOther}','production','${"b".repeat(64)}','${"3".repeat(64)}','active','${admin}');
    insert into sellerpilot_private.ai_cli_worker_tokens(id,token_hash,status,expires_at,scope)
      values('${workerId}','${workerHash}','active',now()+interval '1 day',array['gateway']);
    revoke all on schema sellerpilot_private from public,anon,authenticated;
  `);
  await db.exec(functionDefinition(cont08, "public.sellerpilot_activate_elevenst_credential_v1"));
  await db.exec("revoke all on function public.sellerpilot_activate_elevenst_credential_v1(uuid) from public,anon; grant execute on function public.sellerpilot_activate_elevenst_credential_v1(uuid) to authenticated;");
  const lineage=await readFile(new URL('supabase/migrations/20260825111800_bind_listing_seller_accounts.sql',root),'utf8');
  const start=lineage.indexOf('create or replace function sellerpilot_private.guard_gateway_job_seller_lineage()');
  const end=lineage.indexOf('\n$$;',start)+4;
  await db.exec('alter table sellerpilot_private.channel_gateway_jobs add column listing_id uuid, add column seller_account_key text');
  await db.exec(lineage.slice(start,end));
  await db.exec('create trigger guard_gateway_job_seller_lineage before insert or update on sellerpilot_private.channel_gateway_jobs for each row execute function sellerpilot_private.guard_gateway_job_seller_lineage()');
  await db.exec(cont09);
  return db;
}

test("CONT-09 canonical RPCs gate pending access, complete exact fixed-egress evidence, and activate only that account", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      asRole(db, "authenticated", "select public.sellerpilot_activate_elevenst_credential_v1($1)", [pendingA]),
      /ELEVENST_RECENT_EXACT_ACCESS_TEST_REQUIRED/u,
    );
    await assert.rejects(
      asRole(db, "authenticated", "select public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1($1)", [activeOther]),
      /ELEVENST_PENDING_CREDENTIAL_REQUIRED/u,
    );
    await assert.rejects(
      asRole(db, "authenticated", "select public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1($1)", [pendingWrongAccount]),
      /ELEVENST_PENDING_CREDENTIAL_REQUIRED/u,
    );

    const first = (await asRole(db, "authenticated", "select public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1($1) id", [pendingA])).rows[0].id;
    const duplicate = (await asRole(db, "authenticated", "select public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1($1) id", [pendingA])).rows[0].id;
    assert.equal(duplicate, first);

    const wrongClaim = await asRole(db, "service_role", "select public.sellerpilot_claim_elevenst_pending_diagnostic_v1($1,'cont09-test',$2) value", [workerHash, "ffffffff-ffff-4fff-8fff-ffffffffffff"]);
    assert.equal(wrongClaim.rows[0].value, null);
    const claim = (await asRole(db, "service_role", "select public.sellerpilot_claim_elevenst_pending_diagnostic_v1($1,'cont09-test',null) value", [workerHash])).rows[0].value;
    assert.equal(claim.id, first);
    assert.equal(claim.credential_id, pendingA);
    assert.equal(claim.request.identityEvidence, "admin_claim_v1");
    assert.deepEqual(claim.credential, { api_key: "A".repeat(32), seller_id: "claimed-a" });

    await assert.rejects(
      asRole(db, "service_role", "select public.sellerpilot_complete_elevenst_pending_diagnostic_v1($1,$2,$3,$4::jsonb)", [workerHash, first, "ffffffff-ffff-4fff-8fff-ffffffffffff", JSON.stringify({ status: "passed", message: "access passed" })]),
      /ELEVENST_PENDING_DIAGNOSTIC_COMPLETION_MISMATCH/u,
    );
    const diagnostic = {
      status: "passed",
      message: "11번가 ProductSearch 접근은 통과했지만 계정 ID를 되돌려주지 않습니다.",
    };
    const receipt = (await asRole(db, "service_role", "select public.sellerpilot_complete_elevenst_pending_diagnostic_v1($1,$2,$3,$4::jsonb) value", [workerHash, first, claim.claim_token, JSON.stringify(diagnostic)])).rows[0].value;
    assert.deepEqual(receipt, {
      status: "completed",
      jobId: first,
      credentialId: pendingA,
      diagnosticStatus: "passed",
      identityEvidence: "admin_claim_v1",
    });

    const activated = (await asRole(db, "authenticated", "select public.sellerpilot_activate_elevenst_credential_v1($1) id", [pendingA])).rows[0].id;
    assert.equal(activated, pendingA);
    const rows = (await db.query("select id,status,last_check_status from sellerpilot_private.channel_credentials order by version")).rows;
    assert.deepEqual(rows, [
      { id: pendingA, status: "active", last_check_status: "passed" },
      { id: pendingWrongAccount, status: "pending", last_check_status: null },
      { id: activeOther, status: "active", last_check_status: null },
    ]);
    const evidence = (await db.query("select safe_detail,response_payload from sellerpilot_private.credential_audit audit left join sellerpilot_private.channel_gateway_jobs job on job.credential_id=audit.credential_id where audit.credential_id=$1 order by audit.id", [pendingA])).rows;
    assert.equal(evidence[0].safe_detail.identityEvidence, "admin_claim_v1");
    assert.equal(evidence[0].response_payload.identityEvidence, "admin_claim_v1");
    assert.doesNotMatch(JSON.stringify(evidence), /provider[_ -]?certified/u);
  } finally {
    await db.close();
  }
});

test('central: immutable pending diagnostic receipt replays after activation and rejects changed evidence', async () => {
 const db=await fixture();
 try {
  const id=(await asRole(db,'authenticated','select public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1($1) id',[pendingA])).rows[0].id;
  const claim=(await asRole(db,'service_role',"select public.sellerpilot_claim_elevenst_pending_diagnostic_v1($1,'probe',$2) value",[workerHash,id])).rows[0].value;
  const diagnostic={status:'passed',message:'local access fixture'};
  const complete=(value=diagnostic)=>asRole(db,'service_role','select public.sellerpilot_complete_elevenst_pending_diagnostic_v1($1,$2,$3,$4::jsonb) value',[workerHash,id,claim.claim_token,JSON.stringify(value)]);
  const first=(await complete()).rows[0].value;
  await asRole(db,'authenticated','select public.sellerpilot_activate_elevenst_credential_v1($1)',[pendingA]);
  assert.deepEqual((await complete()).rows[0].value,first);
  await assert.rejects(complete({...diagnostic,message:'changed'}),/MISMATCH/);
  assert.equal((await db.query("select count(*)::int n from sellerpilot_private.credential_audit where action='tested'")).rows[0].n,1);
 } finally {await db.close();}
});

test('central: expired read-only diagnostic claim recovers with a new claim and stops after three attempts',async()=>{
 const db=await fixture();
 try {
  const id=(await asRole(db,'authenticated','select public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1($1) id',[pendingA])).rows[0].id;
  let prior=null;
  for(let attempt=1;attempt<=3;attempt++){
   const claim=(await asRole(db,'service_role',"select public.sellerpilot_claim_elevenst_pending_diagnostic_v1($1,'probe',$2) value",[workerHash,id])).rows[0].value;
   assert.ok(claim); assert.equal(claim.attempt_count,attempt); assert.notEqual(claim.claim_token,prior);prior=claim.claim_token;
   await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[id]);
  }
  assert.equal((await asRole(db,'service_role',"select public.sellerpilot_claim_elevenst_pending_diagnostic_v1($1,'probe',$2) value",[workerHash,id])).rows[0].value,null);
  assert.equal((await db.query('select status from sellerpilot_private.channel_gateway_jobs where id=$1',[id])).rows[0].status,'failed');
 } finally {await db.close();}
});
