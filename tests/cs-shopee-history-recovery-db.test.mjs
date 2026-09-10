import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { withShopeeHistoryContinuation } from "../lib/channels/cs/shopee/history-event-evidence.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const migration = async (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const sources = {
  enqueueCore: await migration("20260825110000_enable_channel_inquiry_replies.sql"),
  dedicatedReply: await migration("20260825111810_harden_inquiry_reply_account_lineage.sql"),
  serialized: await migration("20260825111820_serialize_gateway_ledger_transactions.sql"),
  lazadaRefresh: await migration("20260830183000_allow_fresh_lazada_oauth_past_safe_refresh_reconciliation.sql"),
  lazadaOauth: await migration("20260830204000_allow_fresh_lazada_oauth_past_oauth_reconciliation.sql"),
  ledger: await migration("20260908142023_cs_shopee_history_ledger.sql"),
  start: await migration("20260908142028_cs_shopee_history_start.sql"),
  invariants: await migration("20260908145331_cs_shopee_history_request_invariants.sql"),
};
const recovery = await readFile(new URL(
  "../supabase/migrations/20260909130916_cs_shopee_history_recovery.sql",
  import.meta.url,
), "utf8");

const owner = "00000000-0000-4000-8000-000000019001";
const actor = "00000000-0000-4000-8000-000000019002";
const outsider = "00000000-0000-4000-8000-000000019003";
const credential = "00000000-0000-4000-8000-000000019004";
const worker = "00000000-0000-4000-8000-000000019005";
const vaultId = "00000000-0000-4000-8000-000000019006";
const actorCredential = "00000000-0000-4000-8000-000000019007";
const actorVaultId = "00000000-0000-4000-8000-000000019008";
const shopId = "1719148844";
const tokenHash = "synthetic-canonical-history-worker-token";
const accessToken = "synthetic-shared-admin-access-token";
const publishableKey = "synthetic-isolated-publishable-key";
const serviceKey = "synthetic-isolated-service-key";
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function functionStatement(source, qualifiedName, occurrence = "last") {
  const pattern = new RegExp(`create(?: or replace)? function ${escapeRegExp(qualifiedName)}\\s*\\(`, "giu");
  const starts = [...source.matchAll(pattern)].map(match => match.index);
  assert.ok(starts.length, `missing canonical function ${qualifiedName}`);
  const start = occurrence === "first" ? starts[0] : starts.at(-1);
  const tail = source.slice(start);
  const delimiterMatch = tail.match(/\bas\s+(\$[A-Za-z0-9_]*\$)/iu);
  assert.ok(delimiterMatch?.index !== undefined, `missing body delimiter for ${qualifiedName}`);
  const delimiter = delimiterMatch[1];
  const bodyStart = delimiterMatch.index + delimiterMatch[0].length;
  const bodyEnd = tail.indexOf(`${delimiter};`, bodyStart);
  assert.ok(bodyEnd >= 0, `missing body end for ${qualifiedName}`);
  return tail.slice(0, bodyEnd + delimiter.length + 1);
}

async function asRole(db, role, callback) {
  await db.exec(`set role ${role}`);
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
  }
}

async function installCanonicalEnqueue(db) {
  const signature = "(uuid,uuid,text,text,jsonb)";
  await db.exec(functionStatement(sources.enqueueCore, "public.sellerpilot_enqueue_channel_gateway_job"));
  await db.exec(`alter function public.sellerpilot_enqueue_channel_gateway_job${signature}
    rename to sellerpilot_enqueue_channel_gateway_job_pre_dedicated_reply`);
  await db.exec(functionStatement(sources.dedicatedReply, "public.sellerpilot_enqueue_channel_gateway_job"));
  await db.exec(`alter function public.sellerpilot_enqueue_channel_gateway_job${signature}
    rename to sellerpilot_11820_enqueue_channel_unsafe`);
  await db.exec(functionStatement(sources.serialized, "public.sellerpilot_enqueue_channel_gateway_job"));
  await db.exec(`alter function public.sellerpilot_enqueue_channel_gateway_job${signature}
    rename to sellerpilot_183000_enqueue_channel_gateway_unsafe`);
  await db.exec(functionStatement(sources.lazadaRefresh, "public.sellerpilot_enqueue_channel_gateway_job"));
  await db.exec(`alter function public.sellerpilot_enqueue_channel_gateway_job${signature}
    rename to sellerpilot_204000_enqueue_channel_gateway_unsafe`);
  await db.exec(functionStatement(sources.lazadaOauth, "public.sellerpilot_enqueue_channel_gateway_job"));
  await db.exec(`revoke all on function public.sellerpilot_enqueue_channel_gateway_job${signature}
    from public,anon,authenticated; grant execute on function
    public.sellerpilot_enqueue_channel_gateway_job${signature} to service_role`);
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; create schema vault; create schema sellerpilot_private;
    create table auth.users(id uuid primary key,email text not null);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable
      as $$select sha256($1)$$;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users(id));
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer
      set search_path='' as $$select exists(select 1 from sellerpilot_private.admin_users
        where user_id=auth.uid())$$;
    grant execute on function public.sellerpilot_is_admin() to authenticated;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null references auth.users(id),channel text not null,
      environment text not null,version integer not null,status text not null,expires_at timestamptz,
      vault_secret_id uuid,seller_account_key text,seller_account_key_source text,
      seller_account_verified_at timestamptz,created_at timestamptz default now()
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,credential_id uuid,channel text,operation text,status text
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,status text not null,expires_at timestamptz not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),credential_id uuid not null
        references sellerpilot_private.channel_credentials(id),attempt_id uuid,listing_id uuid,
      channel text not null,operation text not null,environment text not null,
      request_payload jsonb not null default '{}'::jsonb,response_payload jsonb,error_message text,
      status text not null default 'queued',created_by uuid not null references auth.users(id),
      oauth_request_vault_id uuid,oauth_request_fingerprint text,oauth_source_credential_id uuid,
      seller_account_key text,claim_token uuid,worker_token_id uuid
        references sellerpilot_private.ai_cli_worker_tokens(id),lease_expires_at timestamptz,
      attempt_count integer not null default 0,created_at timestamptz not null default clock_timestamp(),
      started_at timestamptz,completed_at timestamptz,updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
      claim_token uuid not null,worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id)
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key,owner_id uuid not null references auth.users(id),channel_key text not null,
      external_ticket_id text not null,demo boolean not null default false,ticket_kind text not null,
      reply_context jsonb not null default '{}'::jsonb,provider_context jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid not null
        references sellerpilot_private.support_tickets(id),owner_id uuid not null references auth.users(id),
      channel_key text not null,inbound_key text not null,remote_message_id text,
      provider_context jsonb not null default '{}'::jsonb
    );
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create table sellerpilot_private.channel_market_targets(
      id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,environment text not null,target_id text not null,market_code text not null,
      verified_at timestamptz not null default now(),
      unique(owner_id,channel,environment,market_code,target_id)
    );
    create function vault.create_secret(text,text,text) returns uuid language sql
      as $$select gen_random_uuid()$$;
    create function sellerpilot_private.discard_stale_unclaimed_lazada_oauth(uuid,text)
      returns boolean language sql as $$select false$$;
    insert into auth.users values
      ('${owner}','credential-owner@example.invalid'),
      ('${actor}','shared-admin@example.invalid'),
      ('${outsider}','outsider@example.invalid');
    insert into sellerpilot_private.admin_users values('${owner}'),('${actor}');
    insert into sellerpilot_private.channel_credentials(
      id,created_by,channel,environment,version,status,vault_secret_id
    ) values('${credential}','${owner}','shopee','production',9,'active','${vaultId}');
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${worker}','${tokenHash}','active',clock_timestamp()+interval '1 day');
    insert into vault.decrypted_secrets values('${vaultId}',
      '{"shopee_targets":[{"type":"shop","id":"${shopId}","access_token":"synthetic-access","refresh_token":"synthetic-refresh"}]}');
    insert into sellerpilot_private.channel_market_targets(
      owner_id,credential_id,channel,environment,target_id,market_code
    ) values('${owner}','${credential}','shopee','production','${shopId}','SG');
  `);
  await installCanonicalEnqueue(db);
  await db.exec(sources.ledger);
  await db.exec(sources.start);
  await db.exec(sources.invariants);
  await db.exec(recovery);

  const startKey = uuid(19100);
  const now = Math.floor(Date.now() / 1000);
  const started = await asRole(db, "service_role", async () => (await db.query(
    `select public.sellerpilot_service_start_cs_shopee_history_v1($1,$2,$3,$4) result`,
    [owner, startKey, now - 86_400, now - 1],
  )).rows[0].result);
  assert.equal(started.queuedJobCount, 2);
  const runId = started.historyRunId;
  const scopeKey = `shopee:${shopId}:product_review:cursor-corpus`;
  const initial = (await db.query(`select * from sellerpilot_private.channel_gateway_jobs
    where request_payload#>>'{arguments,sellerpilotShopeeHistoryRunId}'=$1
      and request_payload#>>'{arguments,sellerpilotShopeeScopeKey}'=$2`, [runId, scopeKey])).rows[0];
  assert.ok(initial);
  assert.equal(initial.created_by, owner);

  const firstClaim = uuid(19101);
  await db.query(`update sellerpilot_private.channel_gateway_jobs set status='succeeded',
    claim_token=$1,worker_token_id=$2,lease_expires_at=clock_timestamp()+interval '1 minute' where id=$3`,
  [firstClaim, worker, initial.id]);
  await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)",
    [initial.id, firstClaim, worker]);
  const nextArguments = withShopeeHistoryContinuation(initial.request_payload.arguments, {
    ...initial.request_payload.arguments, cursor: "opaque+/cursor==",
    sellerpilotPaginationDepth: 1, sellerpilotPaginationEpoch: 0,
    sellerpilotPaginationTrail: ["a".repeat(64)],
  });
  const checkpoint = nextArguments.sellerpilotShopeeInputCheckpointDigest;
  const recordDigest = "d".repeat(64);
  const pageEvent = {
    type: "page", eventKey: initial.id, sequence: 1, scopeKey, shopId, kind: "product_review",
    inputCheckpointDigest: null, pageDigest: "e".repeat(64),
    remoteRecordDigests: [recordDigest], normalizedRecordDigests: [],
    isolatedRecordDigests: [], excludedRecordDigests: [recordDigest],
    projectedEventDigests: [], nextCheckpoint: {
      kind: "product_review", checkpointDigest: checkpoint,
      cursorDigest: digest(nextArguments.cursor), paginationEpoch: 0, paginationDepth: 1,
    },
  };
  await asRole(db, "service_role", () => db.query(
    `select public.sellerpilot_service_record_cs_shopee_history_event_v1($1,$2,$3,$4,$5) result`,
    [tokenHash, initial.id, firstClaim, runId, pageEvent],
  ));

  const failedJobId = await asRole(db, "service_role", async () => (await db.query(
    `select public.sellerpilot_enqueue_channel_gateway_job($1,null,'shopee','inquiries.list',$2) id`,
    [credential, { periodicKey: `inquiries:history:continuation:${initial.id}`, arguments: nextArguments }],
  )).rows[0].id);
  await failAndRecord(db, { id: failedJobId, arguments: nextArguments, runId, scopeKey }, 19102);
  return { db, runId, scopeKey, failedJobId, failedArguments: nextArguments, checkpoint };
}

async function failAndRecord(db, job, claimSerial) {
  const claim = uuid(claimSerial);
  await db.query(`update sellerpilot_private.channel_gateway_jobs set status='failed',
    claim_token=$1,worker_token_id=$2,lease_expires_at=clock_timestamp()+interval '1 minute'
    where id=$3`, [claim, worker, job.id]);
  await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)",
    [job.id, claim, worker]);
  const event = {
    type: "interruption", eventKey: job.id,
    sequence: job.arguments.sellerpilotShopeeHistorySequence,
    scopeKey: job.scopeKey, shopId, kind: "product_review",
    checkpointDigest: job.arguments.sellerpilotShopeeInputCheckpointDigest,
    reason: "failed", errorCode: "SYNTHETIC_PROVIDER_FAILURE",
  };
  await asRole(db, "service_role", () => db.query(
    `select public.sellerpilot_service_record_cs_shopee_history_event_v1($1,$2,$3,$4,$5) result`,
    [tokenHash, job.id, claim, job.runId, event],
  ));
}

async function resumeRpc(db, requestKey, runId, scopeKey, actorId = actor) {
  return asRole(db, "service_role", async () => (await db.query(
    `select public.sellerpilot_service_resume_cs_shopee_history_v1($1,$2,$3,$4) result`,
    [actorId, requestKey, runId, scopeKey],
  )).rows[0].result);
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function startIsolatedSupabase(db) {
  let serial = Promise.resolve();
  const serialized = callback => {
    const next = serial.then(callback);
    serial = next.catch(() => undefined);
    return next;
  };
  const server = http.createServer(async (request, response) => {
    const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/u, "");
    const serviceRequest = request.headers.apikey === serviceKey && token === serviceKey;
    if (serviceRequest && request.method === "POST"
        && request.url === "/rest/v1/rpc/sellerpilot_service_resume_cs_shopee_history_v1") {
      try {
        const body = await requestBody(request);
        const result = await serialized(() => resumeRpc(db, body.p_request_key,
          body.p_history_run_id, body.p_scope_key, body.p_actor_id));
        json(response, 200, result);
      } catch (error) {
        json(response, 409, { message: String(error?.message ?? error) });
      }
      return;
    }
    if (request.headers.apikey !== publishableKey || token !== accessToken) {
      json(response, 401, { code: "invalid_jwt", message: "invalid isolated token" });
      return;
    }
    if (request.method === "GET" && request.url === "/auth/v1/user") {
      json(response, 200, { id: actor, email: "shared-admin@example.invalid", aud: "authenticated",
        role: "authenticated", app_metadata: {}, user_metadata: {},
        created_at: "2026-09-09T00:00:00.000Z" });
      return;
    }
    if (request.method === "POST" && request.url === "/rest/v1/rpc/sellerpilot_is_admin") {
      const result = await serialized(async () => {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
        return asRole(db, "authenticated", async () => (await db.query(
          "select public.sellerpilot_is_admin() result")).rows[0].result);
      });
      json(response, 200, result);
      return;
    }
    json(response, 404, { message: "isolated route not found" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("shared admin route uses service role and canonical enqueue while preserving credential owner lineage", async () => {
  const state = await fixture();
  const api = await startIsolatedSupabase(state.db);
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secret: process.env.SUPABASE_SECRET_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = api.url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  process.env.SUPABASE_SECRET_KEY = serviceKey;
  try {
    const { POST } = await import("../app/api/admin/cs/channels/shopee/history-resume/route.ts");
    const requestKey = uuid(19201);
    const call = () => POST(new Request("http://sellerpilot.invalid/api/admin/cs/channels/shopee/history-resume", {
      method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ requestKey, historyRunId: state.runId, scopeKey: state.scopeKey }),
    }));
    const response = await call();
    const result = await response.json();
    assert.equal(response.status, 202, JSON.stringify(result));
    assert.equal(result.recoveryAttempt, 1);
    const job = (await state.db.query(
      "select * from sellerpilot_private.channel_gateway_jobs where id=$1", [result.recoveryJobId])).rows[0];
    assert.equal(job.created_by, owner);
    assert.equal(job.created_by === actor, false);
    assert.equal(job.credential_id, credential);
    assert.equal(job.request_payload.arguments.shopId, shopId);
    assert.equal(job.request_payload.arguments.cursor, state.failedArguments.cursor);
    assert.equal(job.request_payload.arguments.sellerpilotShopeeInputCheckpointDigest, state.checkpoint);
    assert.equal(job.request_payload.arguments.sellerpilotShopeeHistorySequence, 3);
    const audit = (await state.db.query(
      "select * from sellerpilot_private.cs_shopee_history_recovery_requests where recovery_job_id=$1",
      [job.id])).rows[0];
    assert.equal(audit.actor_id, actor);
    assert.equal(audit.owner_id, owner);

    const replay = await call();
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).recoveryJobId, result.recoveryJobId);
    assert.equal((await state.db.query(`select count(*)::int n from sellerpilot_private.channel_gateway_jobs
      where request_payload#>>'{arguments,sellerpilotShopeeHistoryRecoveryContract}'=
        'sellerpilot-shopee-history-recovery/1'`)).rows[0].n, 1);

    const chain = (await state.db.query(`select count(*)::int n from unnest(array[
      to_regprocedure('public.sellerpilot_enqueue_channel_gateway_job_pre_dedicated_reply(uuid,uuid,text,text,jsonb)'),
      to_regprocedure('public.sellerpilot_11820_enqueue_channel_unsafe(uuid,uuid,text,text,jsonb)'),
      to_regprocedure('public.sellerpilot_183000_enqueue_channel_gateway_unsafe(uuid,uuid,text,text,jsonb)'),
      to_regprocedure('public.sellerpilot_204000_enqueue_channel_gateway_unsafe(uuid,uuid,text,text,jsonb)'),
      to_regprocedure('public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)')
    ]) function_id where function_id is not null`)).rows[0].n;
    assert.equal(chain, 5);
  } finally {
    restore("NEXT_PUBLIC_SUPABASE_URL", previous.url);
    restore("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", previous.publishable);
    restore("SUPABASE_SECRET_KEY", previous.secret);
    await new Promise(resolve => api.server.close(resolve));
    await state.db.close();
  }
});

test("actual ledger and recovery RPC reject shop, cursor, non-admin actor and direct non-service calls", async () => {
  const state = await fixture();
  try {
    await state.db.query(`update sellerpilot_private.channel_gateway_jobs
      set request_payload=jsonb_set(request_payload,'{arguments,shopId}','"1758392145"')
      where id=$1`, [state.failedJobId]);
    await assert.rejects(resumeRpc(state.db, uuid(19202), state.runId, state.scopeKey),
      /SHOPEE_HISTORY_RECOVERY_JOB_MISMATCH/u);
    await state.db.query(`update sellerpilot_private.channel_gateway_jobs
      set request_payload=jsonb_set(jsonb_set(request_payload,'{arguments,shopId}',to_jsonb($2::text)),
        '{arguments,cursor}','"drifted-cursor"') where id=$1`, [state.failedJobId, shopId]);
    await assert.rejects(resumeRpc(state.db, uuid(19203), state.runId, state.scopeKey),
      /SHOPEE_HISTORY_RECOVERY_CHECKPOINT_MISMATCH/u);
    await assert.rejects(resumeRpc(state.db, uuid(19204), state.runId, state.scopeKey, outsider),
      /SHOPEE_HISTORY_RECOVERY_INVALID/u);
    await state.db.query(`update sellerpilot_private.channel_gateway_jobs
      set request_payload=jsonb_set(request_payload,'{arguments,cursor}',to_jsonb($2::text))
      where id=$1`, [state.failedJobId, state.failedArguments.cursor]);
    await assert.rejects(state.db.query(
      `select public.sellerpilot_service_resume_cs_shopee_history_v1($1,$2,$3,$4)`,
      [actor, uuid(19205), state.runId, state.scopeKey]),
    /SHOPEE_HISTORY_RECOVERY_INVALID/u);
    assert.equal((await state.db.query(`select count(*)::int n from sellerpilot_private.channel_gateway_jobs
      where request_payload#>>'{arguments,sellerpilotShopeeHistoryRecoveryContract}'=
        'sellerpilot-shopee-history-recovery/1'`)).rows[0].n, 0);
  } finally { await state.db.close(); }
});

test("shared admin resume fails closed when run and scope do not identify exactly one account", async () => {
  const state = await fixture();
  try {
    await state.db.query(`insert into sellerpilot_private.channel_credentials(
      id,created_by,channel,environment,version,status,vault_secret_id
    ) values($1,$2,'shopee','production',1,'active',$3)`,
    [actorCredential, actor, actorVaultId]);
    await state.db.query(`insert into vault.decrypted_secrets values($1,$2)`, [actorVaultId,
      JSON.stringify({ shopee_targets: [{ type: "shop", id: shopId,
        access_token: "synthetic-actor-access", refresh_token: "synthetic-actor-refresh" }] })]);
    await state.db.query(`insert into sellerpilot_private.channel_market_targets(
      owner_id,credential_id,channel,environment,target_id,market_code
    ) values($1,$2,'shopee','production',$3,'SG')`, [actor, actorCredential, shopId]);
    await state.db.query(`insert into sellerpilot_private.cs_shopee_history_scopes(
      owner_id,credential_id,history_run_id,scope_key,scope_digest,shop_id,country,kind,coverage,scope_payload
    ) select $1,$2,history_run_id,scope_key,scope_digest,shop_id,country,kind,coverage,scope_payload
        from sellerpilot_private.cs_shopee_history_scopes
       where owner_id=$3 and history_run_id=$4 and scope_key=$5`,
    [actor, actorCredential, owner, state.runId, state.scopeKey]);

    await assert.rejects(resumeRpc(state.db, uuid(19206), state.runId, state.scopeKey),
      /SHOPEE_HISTORY_RECOVERY_SCOPE_AMBIGUOUS/u);
    assert.equal((await state.db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_history_recovery_requests`)).rows[0].n, 0);
  } finally { await state.db.close(); }
});

test("actual canonical queue and history events enforce dedupe, active-job fence and three retries", async () => {
  const state = await fixture();
  try {
    let result = await resumeRpc(state.db, uuid(19210), state.runId, state.scopeKey);
    await assert.rejects(resumeRpc(state.db, uuid(19211), state.runId, state.scopeKey),
      /SHOPEE_HISTORY_RECOVERY_ACTIVE_JOB_EXISTS/u);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      assert.equal(result.recoveryAttempt, attempt);
      const job = (await state.db.query(
        "select request_payload from sellerpilot_private.channel_gateway_jobs where id=$1",
        [result.recoveryJobId])).rows[0];
      await failAndRecord(state.db, { id: result.recoveryJobId,
        arguments: job.request_payload.arguments, runId: state.runId, scopeKey: state.scopeKey },
      19220 + attempt);
      if (attempt < 3) {
        result = await resumeRpc(state.db, uuid(19210 + attempt), state.runId, state.scopeKey);
      }
    }
    await assert.rejects(resumeRpc(state.db, uuid(19219), state.runId, state.scopeKey),
      /SHOPEE_HISTORY_RECOVERY_ATTEMPTS_EXHAUSTED/u);
    assert.equal((await state.db.query(`select count(*)::int n from sellerpilot_private.channel_gateway_jobs
      where request_payload#>>'{arguments,sellerpilotShopeeHistoryRecoveryContract}'=
        'sellerpilot-shopee-history-recovery/1'`)).rows[0].n, 3);
    assert.equal((await state.db.query(`select count(*)::int n from
      sellerpilot_private.cs_shopee_history_events event join
      sellerpilot_private.channel_gateway_jobs job on job.id=event.job_id
      where job.request_payload#>>'{arguments,sellerpilotShopeeHistoryRecoveryContract}'=
        'sellerpilot-shopee-history-recovery/1'`)).rows[0].n, 3);
  } finally { await state.db.close(); }
});
