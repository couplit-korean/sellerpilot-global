import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { csCredentialBindingEvidence } from "../lib/channels/cs-credential-binding";
import { completeCsClaim } from "../lib/cs/operations/complete";
import { executeCsProviderJob } from "../lib/cs/operations/provider";

const atomic = await readFile(new URL(
  "../supabase/migrations/20260826090400_atomic_gateway_completion_side_effects.sql",
  import.meta.url,
), "utf8");
const serverless = await readFile(new URL(
  "../supabase/migrations/20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql",
  import.meta.url,
), "utf8");
const bindingBase = await readFile(new URL(
  "../supabase/migrations/20260908000000_add_cs_credential_capability_bindings.sql",
  import.meta.url,
), "utf8");
const contextBinding = await readFile(new URL(
  "../supabase/migrations/20260909134538_temu_cs_verified_account_binding_context.sql",
  import.meta.url,
), "utf8");
const bindingReplay = await readFile(new URL(
  "../supabase/migrations/20260909134541_temu_cs_binding_persistence_replay.sql",
  import.meta.url,
), "utf8");
const latestOwnership = await readFile(new URL(
  "../supabase/migrations/20260908013000_hydrate_exact_coupang_local_verifier_claim.sql",
  import.meta.url,
), "utf8");
const generalizedOwnership = await readFile(new URL(
  "../supabase/migrations/20260828210000_non_cs_release_integrity.sql",
  import.meta.url,
), "utf8");

const owner = "00000000-0000-4000-8000-00000000e501";
const workerAdministrator = "00000000-0000-4000-8000-00000000e502";
const credentialId = "00000000-0000-4000-8000-00000000e503";
const jobId = "00000000-0000-4000-8000-00000000e504";
const claimToken = "00000000-0000-4000-8000-00000000e505";
const workerTokenId = "00000000-0000-4000-8000-00000000e506";
const tokenHash = "a".repeat(64);
const sellerKey = createHash("sha256")
  .update("temu\u001fproduction\u001ftemu:mall:1024")
  .digest("hex");

function functionStatement(source, name) {
  const starts = [
    `create or replace function ${name}`,
    `create function ${name}`,
  ];
  const start = starts.map(marker => source.indexOf(marker)).find(index => index >= 0);
  assert.notEqual(start, undefined, `missing function ${name}`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return source.slice(start, end + 4);
}

function blockStatement(source, tag) {
  const start = source.indexOf(`do $${tag}$`);
  const endMarker = `$${tag}$;`;
  const end = source.indexOf(endMarker, start + 3);
  assert.ok(start >= 0 && end >= 0, `missing block ${tag}`);
  return source.slice(start, end + endMarker.length);
}

async function value(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0] ?? {})[0];
}

const compatibility = `
  create role anon;create role authenticated;create role service_role;
  create schema auth;create schema sellerpilot_private;create schema extensions;
  create function extensions.digest(text,text)returns bytea language sql immutable
    as $$select sha256(convert_to($1,'UTF8'))$$;
  create table auth.users(id uuid primary key);
  create function auth.uid()returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
  create function public.sellerpilot_is_admin()returns boolean language sql stable as $$select true$$;
  create table sellerpilot_private.ai_cli_worker_tokens(
    id uuid primary key,label text,token_hash text unique,fingerprint text,status text,scope text,
    expires_at timestamptz,last_seen_at timestamptz,last_version text,created_by uuid,created_at timestamptz,
    revoked_at timestamptz,rotation_set_id uuid,activation_expires_at timestamptz,activated_at timestamptz
  );
  create table sellerpilot_private.channel_credentials(
    id uuid primary key,channel text,environment text,status text,expires_at timestamptz,
    fingerprint text,version integer,seller_account_key text,seller_account_key_source text,
    seller_account_verified_at timestamptz,created_by uuid
  );
  create table sellerpilot_private.channel_gateway_jobs(
    id uuid primary key,credential_id uuid references sellerpilot_private.channel_credentials(id),
    attempt_id uuid,channel text,operation text,environment text,request_payload jsonb default'{}',
    response_payload jsonb,status text,error_message text,worker_token_id uuid,
    claim_token uuid,attempt_count integer,lease_expires_at timestamptz,created_at timestamptz,
    started_at timestamptz,completed_at timestamptz,updated_at timestamptz,
    seller_account_key text,created_by uuid
  );
  create table sellerpilot_private.ingested_inquiries(job_id uuid,credential_id uuid,channel text);
  create table sellerpilot_private.sync_marks(credential_id uuid,channel text,kind text,status text);
  create function sellerpilot_private.worker_token_has_scope(text,text,boolean default true)
    returns boolean language sql stable set search_path='' as $$
    select exists(select 1 from sellerpilot_private.ai_cli_worker_tokens
      where token_hash=$1 and scope=$2 and(not $3 or(status='active'and expires_at>clock_timestamp())))
  $$;
  create function sellerpilot_private.serverless_gateway_job_allowed(text,text)
    returns boolean language sql immutable set search_path='' as $$
      select $1='temu'and $2='inquiries.list'
    $$;
  create function sellerpilot_private.coupang_exact_live_local_running_owned(text,uuid,uuid)
    returns boolean language sql stable set search_path='' as $$select false$$;
  create function public.sellerpilot_service_prepare_gateway_credential_refresh(
    text,uuid,uuid,jsonb,timestamptz,boolean,boolean
  )returns jsonb language sql as $$select null::jsonb$$;
  create function public.sellerpilot_record_credential_test(uuid,text,text)
    returns void language sql as $$select$$;
  create function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
    returns void language sql as $$select$$;
  create function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
    returns void language plpgsql as $$
    begin insert into sellerpilot_private.ingested_inquiries values(
      current_setting('fixture.job_id')::uuid,$1,$2);end
  $$;
  create function public.sellerpilot_service_record_lazada_im_bootstrap_result(uuid,uuid,boolean)
    returns void language sql as $$select$$;
  create function public.sellerpilot_service_mark_channel_sync(uuid,text,text,text,text)
    returns void language plpgsql as $$
    begin insert into sellerpilot_private.sync_marks values($1,$2,$3,$4);end
  $$;
  create function public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)
    returns boolean language plpgsql as $$
    begin
      update sellerpilot_private.channel_gateway_jobs job set
        status=$4,response_payload=$5,error_message=$6,worker_token_id=null,claim_token=null,
        lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
      from sellerpilot_private.ai_cli_worker_tokens token
      where job.id=$2 and job.claim_token=$3 and job.status='running'
        and token.id=job.worker_token_id and token.token_hash=$1
        and token.status='active'and token.expires_at>clock_timestamp();
      return found;
    end
  $$;
`;

async function fixture({ installRepair = false } = {}) {
  const db = new PGlite();
  await db.exec(compatibility);
  await db.exec(atomic);
  await db.exec(functionStatement(
    latestOwnership,
    "sellerpilot_private.serverless_cs_job_is_owned",
  ));
  await db.exec(functionStatement(
    generalizedOwnership,
    "sellerpilot_private.worker_token_may_complete_gateway_job",
  ));
  await db.exec(blockStatement(serverless, "migration"));
  await db.exec(functionStatement(
    serverless,
    "public.sellerpilot_service_serverless_cs_completion_context",
  ));
  await db.exec(functionStatement(
    serverless,
    "public.sellerpilot_service_complete_serverless_cs_transaction",
  ));
  await db.exec(bindingBase);
  await db.exec(contextBinding);
  await db.exec(`
    insert into auth.users values('${owner}'),('${workerAdministrator}');
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${workerTokenId}','shared serverless','${tokenHash}','AAAAAAAAAAAA',
      'active','serverless_cs',clock_timestamp()+interval'1 day',null,null,
      '${workerAdministrator}',clock_timestamp(),null,null,null,null
    );
    insert into sellerpilot_private.channel_credentials values(
      '${credentialId}','temu','production','active',clock_timestamp()+interval'1 day',
      'credential-a',1,'${sellerKey}','provider_certified_v1',clock_timestamp(),'${owner}'
    );
    insert into sellerpilot_private.channel_gateway_jobs values(
      '${jobId}','${credentialId}',null,'temu','inquiries.list','production',
      '{"arguments":{"kind":"after_sales"}}',null,'running',null,'${workerTokenId}',
      '${claimToken}',1,clock_timestamp()+interval'10 minutes',clock_timestamp(),
      clock_timestamp(),null,clock_timestamp(),'${sellerKey}','${owner}'
    );
    select set_config('fixture.job_id','${jobId}',false);
  `);
  if (installRepair) await db.exec(bindingReplay);
  return db;
}

function evidence(overrides = {}) {
  return {
    contract: "sellerpilot-cs-credential-binding/1",
    channel: "temu",
    operation: "inquiries.list",
    appFingerprint: "c".repeat(64),
    tokenFingerprint: "d".repeat(64),
    targetFingerprints: [sellerKey],
    country: "UNSCOPED",
    sellerAccountKey: sellerKey,
    ...overrides,
  };
}

async function complete(db, hash = tokenHash, claim = claimToken) {
  return value(db, `select public.sellerpilot_service_complete_serverless_cs_transaction(
    $1,$2,$3,'succeeded',
    '{"ok":true,"channel":"temu","operation":"inquiries.list","steps":[],"safeMessage":"ok"}',
    null,null,null,'[]',null
  ) result`, [hash, jobId, claim]);
}

test("actual canonical completion receipt replays and repairs the previously rejected serverless Temu binding", async () => {
  const db = await fixture();
  try {
    const before = await value(db,
      "select public.sellerpilot_service_serverless_cs_completion_context($1,$2,$3) result",
      [tokenHash, jobId, claimToken]);
    assert.equal(before.status, "running");
    assert.equal(before.credential_binding_context.status, "verified");
    assert.equal(before.credential_binding_context.workerIdentityCompared, false);
    assert.notEqual(owner, workerAdministrator);

    const completed = await complete(db);
    assert.equal(completed.status, "completed");
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.ingested_inquiries"), 1);
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.gateway_completion_receipts"), 1);
    await assert.rejects(db.query(
      "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4)",
      [tokenHash, jobId, claimToken, evidence()],
    ), /invalid worker token/);

    await db.exec(bindingReplay);
    const replayContext = await value(db,
      "select public.sellerpilot_service_serverless_cs_completion_context($1,$2,$3) result",
      [tokenHash, jobId, claimToken]);
    assert.equal(replayContext.status, "completed_replay");
    assert.equal(replayContext.credential_binding_context.status, "verified");

    const replayedCompletion = await complete(db);
    assert.equal(replayedCompletion.status, "completed");
    assert.equal(replayedCompletion.replayed, true);
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.ingested_inquiries"), 1);

    const first = await value(db,
      "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4) result",
      [tokenHash, jobId, claimToken, evidence()]);
    const replay = await value(db,
      "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4) result",
      [tokenHash, jobId, claimToken, evidence()]);
    assert.equal(first.status, "recorded");
    assert.equal(first.replayed, false);
    assert.equal(first.workerIdentityCompared, false);
    assert.equal(replay.replayed, true);
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.cs_credential_capability_bindings"), 1);
  } finally {
    await db.close();
  }
});

test("provider identity step still reaches normalized inquiry storage, completion receipt and binding ledger", async () => {
  const db = await fixture({ installRepair: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    success: true,
    result: {
      mallId: 1024,
      apiScopeList: [
        "bg.open.accesstoken.info.get",
        "bg.aftersales.parentaftersales.list.get",
      ],
    },
  });
  try {
    const context = await value(db,
      "select public.sellerpilot_service_serverless_cs_completion_context($1,$2,$3) result",
      [tokenHash, jobId, claimToken]);
    const credential = {
      app_key: "fixture-app",
      app_secret: "fixture-secret",
      access_token: "fixture-token",
    };
    const job = {
      id: jobId,
      claim_token: claimToken,
      credential_id: credentialId,
      channel: "temu",
      operation: "inquiries.list",
      environment: "production",
      request: { arguments: { kind: "after_sales" } },
      credential,
      attempt_count: 1,
      credential_binding_context: context.credential_binding_context,
    };
    const providerResult = await executeCsProviderJob({
      job,
      signal: new AbortController().signal,
      hooks: {
        beginCredentialMutation: async () => {},
        stageCredentialRefresh: async () => {},
        beginProviderMutation: async () => {},
        assertLeaseHealthy: async () => {},
      },
    }, async () => ({
      ok: true,
      channel: "temu",
      operation: "inquiries.list",
      steps: [{
        name: "inquiries",
        ok: true,
        status: 200,
        data: { result: { data: [] } },
      }],
      safeMessage: "ok",
    }));
    assert.equal(providerResult.steps[0].name, "credential-binding:temu");
    const credentialBinding = csCredentialBindingEvidence({
      channel: "temu",
      operation: "inquiries.list",
      credential,
      request: job.request,
      providerResult,
      credentialBindingContext: context.credential_binding_context,
    });
    assert.ok(credentialBinding);

    const dependencies = {
      rpc: async (name, args) => {
        const signatures = {
          sellerpilot_service_serverless_cs_completion_context: [
            "p_token_hash", "p_job_id", "p_claim_token",
          ],
          sellerpilot_service_complete_serverless_cs_transaction: [
            "p_token_hash", "p_job_id", "p_claim_token", "p_status",
            "p_response_payload", "p_error_message", "p_credential_refresh",
            "p_normalized_orders", "p_normalized_inquiries", "p_diagnostic",
          ],
          sellerpilot_service_record_cs_credential_binding_v1: [
            "p_token_hash", "p_job_id", "p_claim_token", "p_evidence",
          ],
        };
        const keys = signatures[name];
        if (!keys) throw new Error(`unexpected RPC ${name}`);
        const placeholders = keys.map((_, index) => `$${index + 1}`).join(",");
        try {
          const data = await value(db, `select public.${name}(${placeholders}) result`,
            keys.map(key => args[key]));
          return { data, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },
    };
    const completed = await completeCsClaim(
      dependencies,
      tokenHash,
      job,
      { status: "succeeded", result: providerResult, credentialBinding },
    );
    assert.equal(completed, "completed");
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.ingested_inquiries"), 1);
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.gateway_completion_receipts"), 1);
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.cs_credential_capability_bindings"), 1);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("Temu binding repair rejects wrong token, claim, owner, account, environment and inactive credential", async () => {
  const cases = [
    ["wrong token", "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4)",
      ["e".repeat(64), jobId, claimToken, evidence()], /invalid worker token/],
    ["wrong claim", "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4)",
      [tokenHash, jobId, "00000000-0000-4000-8000-00000000e599", evidence()], /invalid worker token/],
    ["owner mismatch", "update sellerpilot_private.channel_gateway_jobs set created_by=$1 where id=$2",
      [workerAdministrator, jobId], /TEMU_CS_BINDING_OWNER_MISMATCH/],
    ["account mismatch", "update sellerpilot_private.channel_gateway_jobs set seller_account_key=$1 where id=$2",
      ["f".repeat(64), jobId], /TEMU_CS_BINDING_ACCOUNT_MISMATCH/],
    ["environment mismatch", "update sellerpilot_private.channel_gateway_jobs set environment='sandbox' where id=$1",
      [jobId], /TEMU_CS_BINDING_JOB_SCOPE_INVALID/],
    ["inactive credential", "update sellerpilot_private.channel_credentials set status='revoked' where id=$1",
      [credentialId], /TEMU_CS_BINDING_CREDENTIAL_INACTIVE/],
  ];
  for (const [name, mutation, parameters, expected] of cases) {
    const db = await fixture();
    try {
      await complete(db);
      await db.exec(bindingReplay);
      if (name === "wrong token" || name === "wrong claim") {
        await assert.rejects(db.query(mutation, parameters), expected, name);
      } else {
        await db.query(mutation, parameters);
        await assert.rejects(db.query(
          "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4)",
          [tokenHash, jobId, claimToken, evidence()],
        ), expected, name);
      }
    } finally {
      await db.close();
    }
  }
});

test("Temu binding evidence rejects every missing or JSON-null identity field", async () => {
  const db = await fixture();
  try {
    await complete(db);
    await db.exec(bindingReplay);
    for (const field of [
      "contract", "channel", "operation", "country", "sellerAccountKey",
      "appFingerprint", "tokenFingerprint", "targetFingerprints",
    ]) {
      for (const mode of ["missing", "null"]) {
        const invalid = evidence();
        if (mode === "missing") delete invalid[field];
        else invalid[field] = null;
        await assert.rejects(db.query(
          "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4::jsonb)",
          [tokenHash, jobId, claimToken, JSON.stringify(invalid)],
        ), /TEMU_CS_BINDING_EVIDENCE_INVALID/, `${field} ${mode}`);
      }
    }
  } finally {
    await db.close();
  }
});

test("an earlier job binding replay cannot overwrite the later verified job", async () => {
  const db = await fixture();
  const laterJob = "00000000-0000-4000-8000-00000000e530";
  const laterClaim = "00000000-0000-4000-8000-00000000e531";
  try {
    await complete(db);
    await db.exec(bindingReplay);
    const first = await value(db,
      "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4::jsonb) result",
      [tokenHash, jobId, claimToken, JSON.stringify(evidence())]);
    assert.equal(first.replayed, false);
    await db.exec(`
      insert into sellerpilot_private.channel_gateway_jobs values(
        '${laterJob}','${credentialId}',null,'temu','inquiries.list','production',
        '{"arguments":{"kind":"after_sales"}}',null,'succeeded',null,null,null,2,null,
        clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),
        '${sellerKey}','${owner}');
      insert into sellerpilot_private.gateway_completion_receipts(
        job_id,claim_token,worker_token_id,completion_fingerprint,created_at
      )values('${laterJob}','${laterClaim}','${workerTokenId}','${"f".repeat(64)}',clock_timestamp());
    `);
    const later = await value(db,
      "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4::jsonb) result",
      [tokenHash, laterJob, laterClaim, JSON.stringify(evidence())]);
    assert.equal(later.replayed, false);
    assert.equal(await value(db,
      "select verified_job_id::text from sellerpilot_private.cs_credential_capability_bindings where status='active'"), laterJob);

    const replayed = await value(db,
      "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4::jsonb) result",
      [tokenHash, jobId, claimToken, JSON.stringify(evidence())]);
    assert.equal(replayed.replayed, true);
    assert.equal(await value(db,
      "select verified_job_id::text from sellerpilot_private.cs_credential_capability_bindings where status='active'"), laterJob);
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.temu_cs_binding_receipts"), 2);
    await assert.rejects(db.query(
      "delete from sellerpilot_private.temu_cs_binding_receipts where job_id=$1",
      [jobId],
    ), /TEMU_CS_BINDING_RECEIPT_IMMUTABLE/);
    await assert.rejects(db.query(
      "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4::jsonb)",
      [tokenHash, jobId, claimToken, JSON.stringify(evidence({ tokenFingerprint: "e".repeat(64) }))],
    ), /TEMU_CS_BINDING_REPLAY_MISMATCH/);
  } finally {
    await db.close();
  }
});

test("non-Temu work retains the canonical gateway-only binding boundary", async () => {
  const db = await fixture({ installRepair: true });
  const gatewayToken = "9".repeat(64);
  const gatewayTokenId = "00000000-0000-4000-8000-00000000e520";
  const otherCredential = "00000000-0000-4000-8000-00000000e521";
  const otherJob = "00000000-0000-4000-8000-00000000e522";
  const otherClaim = "00000000-0000-4000-8000-00000000e523";
  try {
    await db.exec(`
      insert into sellerpilot_private.ai_cli_worker_tokens values(
        '${gatewayTokenId}','gateway','${gatewayToken}','999999999999','active','gateway',
        clock_timestamp()+interval'1 day',null,null,'${workerAdministrator}',clock_timestamp(),
        null,null,null,null);
      insert into sellerpilot_private.channel_credentials values(
        '${otherCredential}','qoo10','production','active',null,'other',1,null,null,null,'${owner}');
      insert into sellerpilot_private.channel_gateway_jobs values(
        '${otherJob}','${otherCredential}',null,'qoo10','inquiries.list','production','{}',null,
        'running',null,'${gatewayTokenId}','${otherClaim}',1,clock_timestamp()+interval'5 minutes',
        clock_timestamp(),clock_timestamp(),null,clock_timestamp(),null,'${owner}');
      select set_config('fixture.job_id','${otherJob}',false);
    `);
    const completed = await value(db, `select public.sellerpilot_service_complete_gateway_transaction(
      $1,$2,$3,'succeeded',
      '{"ok":true,"channel":"qoo10","operation":"inquiries.list","steps":[],"safeMessage":"ok"}',
      null,null,null,'[]',null) result`, [gatewayToken, otherJob, otherClaim]);
    assert.equal(completed.status, "completed");
    const otherEvidence = {
      ...evidence(),
      channel: "qoo10",
      sellerAccountKey: undefined,
      targetFingerprints: ["8".repeat(64)],
    };
    delete otherEvidence.sellerAccountKey;
    const recorded = await value(db,
      "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4) result",
      [gatewayToken, otherJob, otherClaim, otherEvidence]);
    assert.equal(recorded.status, "recorded");
    await assert.rejects(db.query(
      "select public.sellerpilot_service_record_cs_credential_binding_v1($1,$2,$3,$4)",
      [tokenHash, otherJob, otherClaim, otherEvidence],
    ), /invalid worker token/);
  } finally {
    await db.close();
  }
});
