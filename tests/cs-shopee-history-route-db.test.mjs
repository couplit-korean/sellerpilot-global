import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { shopeeHistoryResumeFixture } from "./fixtures/cs/shopee/history-resume.ts";

const sql = await readFile(new URL(
  "../supabase/migrations/20260908142023_cs_shopee_history_ledger.sql",
  import.meta.url,
), "utf8");
const startSql = await readFile(new URL(
  "../supabase/migrations/20260908142028_cs_shopee_history_start.sql",
  import.meta.url,
), "utf8");
const invariantSql = await readFile(new URL(
  "../supabase/migrations/20260908145331_cs_shopee_history_request_invariants.sql",
  import.meta.url,
), "utf8");
const dateIntentSql = await readFile(new URL(
  "../supabase/migrations/20260908151735_cs_shopee_history_date_intent_cutoff.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000007001";
const credential = "00000000-0000-4000-8000-000000007002";
const worker = "00000000-0000-4000-8000-000000007003";
const planJob = "00000000-0000-4000-8000-000000007004";
const planClaim = "00000000-0000-4000-8000-000000007005";
const accessToken = "synthetic-isolated-admin-access-token";
const publishableKey = "synthetic-isolated-publishable-key";
const serviceKey = "synthetic-isolated-service-key";
const tokenHash = "synthetic-route-worker-token";
const runId = "shopee-history-route-test-run-1";
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema vault;
    create schema auth; create table auth.users(id uuid primary key,email text not null);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer as
      $$select auth.uid()='${owner}'::uuid$$;
    grant execute on function public.sellerpilot_is_admin() to authenticated;
    create schema extensions;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users(id));
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null references auth.users(id),channel text not null,
      environment text not null,version integer not null,status text not null,vault_secret_id uuid
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,status text not null,expires_at timestamptz not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,operation text not null,environment text not null,request_payload jsonb not null,
      status text not null,created_by uuid not null references auth.users(id),claim_token uuid,
      worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),lease_expires_at timestamptz
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
      id uuid primary key default gen_random_uuid(),ticket_id uuid not null references sellerpilot_private.support_tickets(id),
      owner_id uuid not null references auth.users(id),channel_key text not null,inbound_key text not null,
      remote_message_id text,provider_context jsonb not null default '{}'::jsonb
    );
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create table sellerpilot_private.channel_market_targets(
      id uuid primary key default gen_random_uuid(),owner_id uuid not null,credential_id uuid not null,
      channel text not null,environment text not null,target_id text not null,market_code text not null,
      verified_at timestamptz not null default now(),
      unique(owner_id,channel,environment,market_code,target_id)
    );
    insert into auth.users values('${owner}','isolated-admin@example.invalid');
    insert into sellerpilot_private.admin_users values('${owner}');
    insert into sellerpilot_private.channel_credentials values('${credential}','${owner}','shopee','production',7,'active',null);
    insert into sellerpilot_private.ai_cli_worker_tokens values('${worker}','${tokenHash}','active',now()+interval '1 day');
    insert into sellerpilot_private.channel_gateway_jobs values(
      '${planJob}','${credential}','shopee','inquiries.list','production','{}','running','${owner}',
      '${planClaim}','${worker}',now()+interval '1 hour'
    );
    create function public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)
    returns uuid language plpgsql security definer set search_path='' as $$
    declare next_id uuid:=gen_random_uuid();
    begin
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,channel,operation,environment,request_payload,status,created_by
      ) select next_id,$1,$3,$4,credential.environment,$5,'queued',credential.created_by
          from sellerpilot_private.channel_credentials credential where credential.id=$1;
      return next_id;
    end $$;
  `);
  await db.exec(sql);
  await db.exec(startSql);
  const shopIds = ["1719148844", "1758392145", "1758392144", "1758392135",
    "1758392139", "1758392137", "1758392161", "1758392178"];
  const countries = ["SG", "TW", "TH", "MY", "VN", "PH", "BR", "MX"];
  const vaultId = uuid(7006);
  const targets = shopIds.map((id) => ({ type: "shop", id,
    access_token: `synthetic-access-${id}`, refresh_token: `synthetic-refresh-${id}`,
    access_token_expires_at: "2026-09-01T00:00:00.000Z",
    refresh_token_expires_at: "2026-10-01T00:00:00.000Z" }));
  await db.query("insert into vault.decrypted_secrets values($1,$2)", [vaultId, JSON.stringify({ shopee_targets: targets })]);
  await db.query("update sellerpilot_private.channel_credentials set vault_secret_id=$1 where id=$2", [vaultId, credential]);
  for (let index = 0; index < shopIds.length; index += 1) {
    await db.query(`insert into sellerpilot_private.channel_market_targets(
      owner_id,credential_id,channel,environment,target_id,market_code
    ) values($1,$2,'shopee','production',$3,$4)`, [owner, credential, shopIds[index], countries[index]]);
  }
  await db.exec(invariantSql);
  await db.exec(dateIntentSql);
  await db.query(`select public.sellerpilot_service_plan_cs_shopee_history_v1(
    $1,$2,$3,$4,$5::jsonb
  )`, [tokenHash, planJob, planClaim, runId, JSON.stringify(shopeeHistoryResumeFixture.plannedScopes)]);
  const uniqueEvents = shopeeHistoryResumeFixture.events.filter((event, index, all) =>
    all.findIndex((candidate) => candidate.eventKey === event.eventKey) === index);
  for (let index = 0; index < uniqueEvents.length; index += 1) {
    const event = uniqueEvents[index];
    const jobId = uuid(7100 + index);
    const claim = uuid(7200 + index);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,status,created_by
    ) values($1,$2,'shopee','inquiries.list','production',$3,$4,$5)`, [
      jobId, credential, { arguments: {
        sellerpilotShopeeHistoryRunId: runId,
        sellerpilotShopeeScopeKey: event.scopeKey,
        sellerpilotShopeeHistorySequence: event.sequence,
        sellerpilotShopeeInputCheckpointDigest: event.type === "page"
          ? event.inputCheckpointDigest : event.checkpointDigest,
        shopId: event.shopId, kind: event.kind,
      } }, event.type === "page" ? "succeeded" : "failed", owner,
    ]);
    await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)",
      [jobId, claim, worker]);
    await db.query(`select public.sellerpilot_service_record_cs_shopee_history_event_v1(
      $1,$2,$3,$4,$5::jsonb
    )`, [tokenHash, jobId, claim, runId, JSON.stringify(event)]);
  }
  return db;
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
  const serializedQuery = (callback) => {
    const next = serial.then(callback);
    serial = next.catch(() => undefined);
    return next;
  };
  const authenticatedQuery = (callback) => serializedQuery(async () => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      await db.exec("set role authenticated");
      try { return await callback(); } finally { await db.exec("reset role"); }
    });
  const server = http.createServer(async (request, response) => {
    const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/u, "");
    const serviceRequest = request.headers.apikey === serviceKey && token === serviceKey;
    if (serviceRequest && request.method === "POST"
        && request.url === "/rest/v1/rpc/sellerpilot_service_start_cs_shopee_history_v2") {
      try {
        const body = await requestBody(request);
        const result = (await db.query(`select public.sellerpilot_service_start_cs_shopee_history_v2(
          $1,$2,$3::date,$4::date
        ) result`, [body.p_owner_id, body.p_request_key, body.p_from_date, body.p_to_date])).rows[0].result;
        json(response, 200, body.p_request_key === uuid(7996)
          ? { ...result, historyRunId: `shopee-history-${"f".repeat(32)}` } : result);
      } catch {
        json(response, 500, { message: "isolated database failure" });
      }
      return;
    }
    if (request.headers.apikey !== publishableKey || token !== accessToken) {
      json(response, 401, { code: "invalid_jwt", message: "invalid isolated token" });
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/auth/v1/user") {
        const user = await serializedQuery(async () => (await db.query(
          "select id,email from auth.users where id=$1", [owner])).rows[0]);
        json(response, 200, {
          id: user.id, email: user.email, aud: "authenticated", role: "authenticated",
          app_metadata: {}, user_metadata: {}, created_at: "2026-09-08T00:00:00.000Z",
        });
        return;
      }
      if (request.method === "POST" && request.url === "/rest/v1/rpc/sellerpilot_is_admin") {
        const result = await authenticatedQuery(async () => (await db.query(
          "select public.sellerpilot_is_admin() result")).rows[0].result);
        json(response, 200, result);
        return;
      }
      if (request.method === "POST"
          && request.url === "/rest/v1/rpc/sellerpilot_read_cs_shopee_history_events_v1") {
        const result = await authenticatedQuery(async () => (await db.query(
          "select public.sellerpilot_read_cs_shopee_history_events_v1() result")).rows[0].result);
        json(response, 200, result);
        return;
      }
      json(response, 404, { message: "isolated route not found" });
    } catch {
      json(response, 500, { message: "isolated database failure" });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("real route authenticates an isolated test account and reads the PGlite ledger", async () => {
  const db = await fixture();
  const isolated = await startIsolatedSupabase(db);
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secret: process.env.SUPABASE_SECRET_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = isolated.url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  process.env.SUPABASE_SECRET_KEY = serviceKey;
  try {
    const { GET, POST } = await import("../app/api/admin/cs/channels/shopee/history-progress/route.ts");
    const response = await GET(new Request("http://sellerpilot.invalid/api/admin/cs/channels/shopee/history-progress", {
      headers: { authorization: `Bearer ${accessToken}` },
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(body.contract, "sellerpilot-shopee-history-read/1");
    assert.equal(body.historyRunId, runId);
    assert.equal(body.progress.shopKinds.find((item) => item.country === "SG"
      && item.kind === "product_review").status, "complete");
    assert.equal(body.progress.shopKinds.find((item) => item.country === "TW"
      && item.kind === "product_review").status, "authorization_required");

    const jobsBefore = (await db.query(
      "select count(*)::int n from sellerpilot_private.channel_gateway_jobs where status='queued'",
    )).rows[0].n;
    const invalidCalendar = await POST(new Request(
      "http://sellerpilot.invalid/api/admin/cs/channels/shopee/history-progress", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ requestKey: uuid(7998), fromDate: "2024-02-01", toDate: "2024-02-30" }),
      },
    ));
    assert.equal(invalidCalendar.status, 400);
    assert.equal((await db.query(
      "select count(*)::int n from sellerpilot_private.channel_gateway_jobs where status='queued'",
    )).rows[0].n, jobsBefore);

    const kstDate = (milliseconds) => new Date(milliseconds + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    const toDate = kstDate(Date.now() - 86_400_000);
    const fromDate = kstDate(Date.now() - 17 * 86_400_000);
    const startedResponse = await POST(new Request("http://sellerpilot.invalid/api/admin/cs/channels/shopee/history-progress", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ requestKey: uuid(7999), fromDate, toDate }),
    }));
    const started = await startedResponse.json();
    assert.equal(startedResponse.status, 202, JSON.stringify(started));
    assert.equal(started.shopCount, 8);
    assert.equal(started.reviewScopeCount, 8);
    assert.equal(started.returnScopeCount, 16);
    assert.equal(started.queuedJobCount, 24);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs where status='queued'")).rows[0].n, 24);

    const today = kstDate(Date.now());
    const yesterday = kstDate(Date.now() - 86_400_000);
    const todayResponse = await POST(new Request(
      "http://sellerpilot.invalid/api/admin/cs/channels/shopee/history-progress", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ requestKey: uuid(7997), fromDate: yesterday, toDate: today }),
      },
    ));
    const todayBody = await todayResponse.json();
    assert.equal(todayResponse.status, 202, JSON.stringify(todayBody));
    assert.equal(todayBody.queuedJobCount, 16);
    const todayReplayResponse = await POST(new Request(
      "http://sellerpilot.invalid/api/admin/cs/channels/shopee/history-progress", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ requestKey: uuid(7997), fromDate: yesterday, toDate: today }),
      },
    ));
    const todayReplayBody = await todayReplayResponse.json();
    assert.equal(todayReplayResponse.status, 200, JSON.stringify(todayReplayBody));
    assert.equal(todayReplayBody.status, "reused");
    assert.equal(todayReplayBody.queuedJobCount, 0);

    const mismatchedRun = await POST(new Request(
      "http://sellerpilot.invalid/api/admin/cs/channels/shopee/history-progress", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ requestKey: uuid(7996), fromDate: yesterday, toDate: today }),
      },
    ));
    assert.equal(mismatchedRun.status, 502);

    const rejected = await GET(new Request("http://sellerpilot.invalid/api/admin/cs/channels/shopee/history-progress", {
      headers: { authorization: "Bearer synthetic-invalid-token" },
    }));
    assert.equal(rejected.status, 401);
  } finally {
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_URL", previous.url);
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", previous.publishable);
    restoreEnvironment("SUPABASE_SECRET_KEY", previous.secret);
    await new Promise((resolve) => isolated.server.close(resolve));
    await db.close();
  }
});
