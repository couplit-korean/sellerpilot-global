import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { projectShopeeHistoryProgress } from "../lib/channels/cs/shopee/history-progress.ts";
import { planShopeeReviewHistory } from "../lib/channels/cs/shopee/history-plan.ts";
import { shopeeHistoryEvidenceReadSchema } from "../lib/cs/channels/shopee/history-events.ts";
import {
  shopeeReturnInboundKey,
  shopeeReturnLegacyRemoteMessageId,
} from "../lib/channels/cs/shopee/detail-revision-reconciliation.ts";
import { shopeeHistoryResumeFixture } from "./fixtures/cs/shopee/history-resume.ts";

const sql = await readFile(new URL("../supabase/migrations/20260908142023_cs_shopee_history_ledger.sql", import.meta.url), "utf8");
const startSql = await readFile(new URL("../supabase/migrations/20260908142028_cs_shopee_history_start.sql", import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000002001";
const credential = "00000000-0000-4000-8000-000000002002";
const worker = "00000000-0000-4000-8000-000000002003";
const planJob = "00000000-0000-4000-8000-000000002004";
const planClaim = "00000000-0000-4000-8000-000000002005";
const runId = "shopee-history-test-run-1";
const tokenHash = "synthetic-worker-token";
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const thReviewScope = planShopeeReviewHistory([{ country: "TH", shopId: "1758392144" }])[0];
const plannedScopes = [...shopeeHistoryResumeFixture.plannedScopes, thReviewScope];
const thUnauthorizedEvent = {
  type: "interruption",
  eventKey: "th-review-401-authorization",
  sequence: 1,
  scopeKey: thReviewScope.scopeKey,
  shopId: thReviewScope.shopId,
  kind: thReviewScope.kind,
  checkpointDigest: null,
  reason: "authorization_required",
  errorCode: "SHOPEE_401_ACCESS_TOKEN_EXPIRED",
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer as
      $$select auth.uid()='${owner}'::uuid$$;
    create schema extensions; create schema vault;
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
      verified_at timestamptz not null default now()
    );
    insert into auth.users values('${owner}');
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
  return db;
}

async function plan(db) {
  return (await db.query(`select public.sellerpilot_service_plan_cs_shopee_history_v1(
    $1,$2,$3,$4,$5::jsonb
  ) result`, [tokenHash, planJob, planClaim, runId,
    JSON.stringify(plannedScopes)])).rows[0].result;
}

async function addCompletedJob(db, event, number) {
  const id = uuid(2100 + number);
  const claim = uuid(3100 + number);
  const status = event.type === "page" ? "succeeded" : "failed";
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,status,created_by
  ) values($1,$2,'shopee','inquiries.list','production',$3,$4,$5)`, [
    id, credential, {
      arguments: {
        sellerpilotShopeeScopeKey: event.scopeKey,
        shopId: event.shopId,
        kind: event.kind,
      },
    }, status, owner,
  ]);
  await db.query("insert into sellerpilot_private.gateway_completion_receipts values($1,$2,$3)",
    [id, claim, worker]);
  return { id, claim };
}

async function record(db, event, job) {
  return (await db.query(`select public.sellerpilot_service_record_cs_shopee_history_event_v1(
    $1,$2,$3,$4,$5::jsonb
  ) result`, [tokenHash, job.id, job.claim, runId, JSON.stringify(event)])).rows[0].result;
}

test("authenticated test account reads isolated shop-kind progress after real PGlite writes", async () => {
  const db = await fixture();
  try {
    const firstPlan = await plan(db);
    assert.equal(firstPlan.insertedCount, plannedScopes.length);
    const secondPlan = await plan(db);
    assert.equal(secondPlan.reusedCount, plannedScopes.length);

    const events = shopeeHistoryResumeFixture.events.filter((event, index, all) =>
      all.findIndex((candidate) => candidate.eventKey === event.eventKey) === index)
      .concat(thUnauthorizedEvent);
    const jobs = new Map();
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const job = await addCompletedJob(db, event, index);
      jobs.set(event.eventKey, job);
      assert.equal((await record(db, event, job)).status, "recorded");
    }
    const firstEvent = events[0];
    assert.equal((await record(db, firstEvent, jobs.get(firstEvent.eventKey))).status, "duplicate");
    await assert.rejects(record(db, { ...firstEvent, pageDigest: "f".repeat(64) },
      jobs.get(firstEvent.eventKey)), /SHOPEE_HISTORY_EVENT_REUSE_MISMATCH/u);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    const raw = (await db.query("select public.sellerpilot_read_cs_shopee_history_events_v1() result")).rows[0].result;
    const evidence = shopeeHistoryEvidenceReadSchema.parse(raw);
    const progress = projectShopeeHistoryProgress(evidence.plannedScopes, evidence.observedEvents);
    assert.equal(progress.shopKinds.find((item) => item.country === "SG" && item.kind === "product_review").status, "complete");
    assert.equal(progress.shopKinds.find((item) => item.country === "TW" && item.kind === "product_review").status, "authorization_required");
    assert.equal(progress.shopKinds.find((item) => item.country === "MY" && item.kind === "product_review").status, "authorization_required");
    assert.equal(progress.shopKinds.find((item) => item.country === "TH" && item.kind === "product_review").status, "authorization_required");
    await assert.rejects(db.query("select * from sellerpilot_private.cs_shopee_history_scopes"), /permission denied/u);
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("history and revision RPC ACLs expose owner read only and service writes only", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const privileges = (await db.query(`select
        has_table_privilege($1,'sellerpilot_private.cs_shopee_history_scopes','SELECT') direct,
        has_function_privilege($1,'public.sellerpilot_read_cs_shopee_history_events_v1()','EXECUTE') reader,
        has_function_privilege($1,'public.sellerpilot_service_plan_cs_shopee_history_v1(text,uuid,uuid,text,jsonb)','EXECUTE') writer,
        has_function_privilege($1,'public.sellerpilot_service_reconcile_shopee_return_revision_v1(uuid,text,text,text,text,text,text,text)','EXECUTE') reconciler`, [role])).rows[0];
      assert.equal(privileges.direct, false);
      assert.equal(privileges.reader, role === "authenticated");
      assert.equal(privileges.writer, role === "service_role");
      assert.equal(privileges.reconciler, role === "service_role");
    }
  } finally { await db.close(); }
});

test("detailRevision reconciliation preserves the ticket ID, appends once, and quarantines unattested legacy", async () => {
  const db = await fixture();
  try {
    const shopId = "1719148844";
    const returnSn = "RETURN_1";
    const externalTicketId = `shopee:return:${shopId}:${returnSn}`;
    const ticketId = uuid(5001);
    const legacyRemote = shopeeReturnLegacyRemoteMessageId(shopId, returnSn, {
      reason: "NOT_RECEIPT", textReason: "synthetic", status: "REQUESTED", negotiationStatus: "",
      nativeMedia: { images: [], buyer_videos: [] },
    });
    await db.query(`insert into sellerpilot_private.support_tickets(
      id,owner_id,channel_key,external_ticket_id,ticket_kind,reply_context,provider_context
    ) values($1,$2,'shopee',$3,'after_sales','{}','{"replySupported":false}')`,
    [ticketId, owner, externalTicketId]);
    await db.query(`insert into sellerpilot_private.support_inbound_messages(
      ticket_id,owner_id,channel_key,inbound_key,remote_message_id,provider_context
    ) values($1,$2,'shopee',$3,$4,'{}')`,
    [ticketId, owner, shopeeReturnInboundKey(externalTicketId, legacyRemote), legacyRemote]);
    const currentRemote = `${shopId}:${returnSn}:${"a".repeat(64)}`;
    const currentInbound = shopeeReturnInboundKey(externalTicketId, currentRemote);
    const args = [credential, externalTicketId, shopId, returnSn, currentRemote,
      currentInbound, "b".repeat(64), legacyRemote];
    const first = (await db.query(`select public.sellerpilot_service_reconcile_shopee_return_revision_v1(
      $1,$2,$3,$4,$5,$6,$7,$8
    ) result`, args)).rows[0].result;
    assert.equal(first.decision, "append_revision");
    assert.equal(first.reason, "legacy_remote_revision_attested");
    assert.equal(first.externalTicketId, externalTicketId);
    assert.equal(first.replySupported, false);
    await db.query(`insert into sellerpilot_private.support_inbound_messages(
      ticket_id,owner_id,channel_key,inbound_key,remote_message_id,provider_context
    ) values($1,$2,'shopee',$3,$4,$5)`, [ticketId, owner, currentInbound, currentRemote,
      { detailRevision: "b".repeat(64) }]);
    const duplicate = (await db.query(`select public.sellerpilot_service_reconcile_shopee_return_revision_v1(
      $1,$2,$3,$4,$5,$6,$7,$8
    ) result`, args)).rows[0].result;
    assert.equal(duplicate.decision, "duplicate");

    const otherReturn = "RETURN_2";
    const otherExternal = `shopee:return:${shopId}:${otherReturn}`;
    const otherTicket = uuid(5002);
    const otherLegacy = `${shopId}:${otherReturn}:${"c".repeat(64)}`;
    await db.query(`insert into sellerpilot_private.support_tickets(
      id,owner_id,channel_key,external_ticket_id,ticket_kind,reply_context,provider_context
    ) values($1,$2,'shopee',$3,'after_sales','{}','{"replySupported":false}')`,
    [otherTicket, owner, otherExternal]);
    await db.query(`insert into sellerpilot_private.support_inbound_messages(
      ticket_id,owner_id,channel_key,inbound_key,remote_message_id,provider_context
    ) values($1,$2,'shopee',$3,$4,'{}')`,
    [otherTicket, owner, shopeeReturnInboundKey(otherExternal, otherLegacy), otherLegacy]);
    const incoming = `${shopId}:${otherReturn}:${"d".repeat(64)}`;
    const unresolved = (await db.query(`select public.sellerpilot_service_reconcile_shopee_return_revision_v1(
      $1,$2,$3,$4,$5,$6,$7,$8
    ) result`, [credential, otherExternal, shopId, otherReturn, incoming,
      shopeeReturnInboundKey(otherExternal, incoming), "e".repeat(64), null])).rows[0].result;
    assert.equal(unresolved.decision, "reconciliation_required");
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_return_revision_reconciliations")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("history start creates isolated review and 15-day return jobs for all eight verified shops", async () => {
  const db = await fixture();
  try {
    const countries = ["SG", "TW", "TH", "MY", "VN", "PH", "BR", "MX"];
    const shopIds = ["1719148844", "1758392145", "1758392144", "1758392135",
      "1758392139", "1758392137", "1758392161", "1758392178"];
    const vaultId = uuid(8801);
    const targets = shopIds.map((id) => ({
      type: "shop", id, access_token: `synthetic-access-${id}`,
      refresh_token: `synthetic-refresh-${id}`,
      access_token_expires_at: "2026-09-01T00:00:00.000Z",
      refresh_token_expires_at: "2026-10-01T00:00:00.000Z",
    }));
    await db.query("insert into vault.decrypted_secrets values($1,$2)", [vaultId, JSON.stringify({ shopee_targets: targets })]);
    await db.query("update sellerpilot_private.channel_credentials set vault_secret_id=$1 where id=$2", [vaultId, credential]);
    for (let index = 0; index < shopIds.length; index += 1) {
      await db.query(`insert into sellerpilot_private.channel_market_targets(
        owner_id,credential_id,channel,environment,target_id,market_code
      ) values($1,$2,'shopee','production',$3,$4)`, [owner, credential, shopIds[index], countries[index]]);
    }
    const requestKey = uuid(8802);
    const to = Math.floor(Date.now() / 1000) - 60;
    const from = to - 16 * 86_400;
    const first = (await db.query(`select public.sellerpilot_service_start_cs_shopee_history_v1(
      $1,$2,$3,$4
    ) result`, [owner, requestKey, from, to])).rows[0].result;
    assert.equal(first.status, "queued");
    assert.equal(first.shopCount, 8);
    assert.equal(first.reviewScopeCount, 8);
    assert.equal(first.returnScopeCount, 16);
    assert.equal(first.queuedJobCount, 24);
    const jobs = (await db.query(`select request_payload from sellerpilot_private.channel_gateway_jobs
      where status='queued' order by request_payload#>>'{arguments,shopId}',request_payload#>>'{arguments,kind}'`)).rows;
    assert.equal(jobs.length, 24);
    assert.deepEqual([...new Set(jobs.map((row) => row.request_payload.arguments.shopId))].sort(), [...shopIds].sort());
    assert.ok(jobs.every((row) => row.request_payload.arguments.sellerpilotShopeeHistorySequence === 1
      && row.request_payload.arguments.sellerpilotShopeeInputCheckpointDigest === null));
    const replay = (await db.query(`select public.sellerpilot_service_start_cs_shopee_history_v1(
      $1,$2,$3,$4
    ) result`, [owner, requestKey, from, to])).rows[0].result;
    assert.equal(replay.status, "reused");
    assert.equal(replay.queuedJobCount, 0);
    assert.equal(replay.reusedScopeCount, 24);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs where status='queued'")).rows[0].n, 24);
  } finally { await db.close(); }
});
