import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = async (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const sources = {
  atomic: await migration("20260826090400_atomic_gateway_completion_side_effects.sql"),
  serverless: await migration("20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql"),
  nonCsIntegrity: await migration("20260828210000_non_cs_release_integrity.sql"),
  shopeeAllowed: await migration("20260907200000_enable_shopee_comment_cs.sql"),
  delivery: await migration("20260831033000_add_cs_message_delivery_ledger.sql"),
  observation: await migration("20260907232000_add_cs_reply_remote_observation.sql"),
  latestCompletion: await migration("20260908153341_cs_qoo10_reply_s3_actual_completion.sql"),
};
const readback = await readFile(new URL(
  "../supabase/migrations/20260909131448_cs_shopee_reply_readback.sql",
  import.meta.url,
), "utf8");

const owner = "00000000-0000-4000-8000-000000059001";
const credential = "00000000-0000-4000-8000-000000059002";
const otherCredential = "00000000-0000-4000-8000-000000059003";
const ticket = "00000000-0000-4000-8000-000000059004";
const sourceJob = "00000000-0000-4000-8000-000000059005";
const worker = "00000000-0000-4000-8000-000000059006";
const unrelatedWorker = "00000000-0000-4000-8000-000000059007";
const gatewayWorker = "00000000-0000-4000-8000-000000059008";
const expiredWorker = "00000000-0000-4000-8000-000000059009";
const sourceClaim = "00000000-0000-4000-8000-000000059010";
const tokenHash = "e".repeat(64);
const unrelatedTokenHash = "b".repeat(64);
const gatewayTokenHash = "c".repeat(64);
const expiredTokenHash = "d".repeat(64);
const sellerAccountKey = "9".repeat(64);
const otherSellerAccountKey = "8".repeat(64);
const inboundKey = `shopee:${"a".repeat(64)}`;
const newerInboundKey = `shopee:${"7".repeat(64)}`;
const reply = "exact reply";
const replyFingerprint = createHash("sha256").update(reply).digest("hex");
const shopId = "1002";
const commentId = "7002";
const itemId = "8002";
const completionSignature = "text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb";
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

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

function taggedDoStatement(source, tag) {
  const startMarker = `do $${tag}$`;
  const endMarker = `$${tag}$;`;
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing canonical DO ${tag}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `missing canonical DO end ${tag}`);
  return source.slice(start, end + endMarker.length);
}

async function asRole(db, role, callback) {
  await db.exec(`set role ${role}`);
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
  }
}

async function installActualCompletion(db) {
  const run = async (label, sql) => {
    try { await db.exec(sql); } catch (error) { throw new Error(`${label}: ${error.message}`, { cause: error }); }
  };
  await run("gateway fingerprint", functionStatement(sources.atomic,
    "sellerpilot_private.gateway_completion_fingerprint"));
  await run("gateway context", functionStatement(sources.atomic,
    "public.sellerpilot_service_gateway_completion_context"));
  await run("gateway completion", functionStatement(sources.atomic,
    "public.sellerpilot_service_complete_gateway_transaction"));
  await run("initial serverless ownership", functionStatement(sources.serverless,
    "sellerpilot_private.worker_token_may_complete_gateway_job", "first"));
  await run("serverless gateway rewrite", taggedDoStatement(sources.serverless, "migration"));
  await run("current Shopee operation matrix", functionStatement(sources.shopeeAllowed,
    "sellerpilot_private.serverless_gateway_job_allowed"));
  await run("current exact completion ownership", functionStatement(sources.nonCsIntegrity,
    "sellerpilot_private.worker_token_may_complete_gateway_job"));
  await run("latest serverless completion entrypoint", functionStatement(sources.latestCompletion,
    "public.sellerpilot_service_complete_serverless_cs_transaction"));
  assert.equal((await db.query(`select count(*)::int n from unnest(array[
    to_regprocedure('sellerpilot_private.gateway_completion_fingerprint(text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'),
    to_regprocedure('public.sellerpilot_service_complete_gateway_transaction(${completionSignature})'),
    to_regprocedure('sellerpilot_private.worker_token_may_complete_gateway_job(text,uuid,uuid)'),
    to_regprocedure('public.sellerpilot_service_complete_serverless_cs_transaction(${completionSignature})')
  ]) function_id where function_id is not null`)).rows[0].n, 4);
}

async function installActualDeliveryAndObservation(db) {
  await db.exec(functionStatement(sources.delivery,
    "sellerpilot_private.sync_inquiry_reply_delivery_ledger"));
  await db.exec(`create trigger sync_inquiry_reply_delivery_ledger
    after insert or update of status,response_payload,error_message
    on sellerpilot_private.channel_gateway_jobs for each row execute function
    sellerpilot_private.sync_inquiry_reply_delivery_ledger()`);
  await db.exec(functionStatement(sources.observation,
    "sellerpilot_private.track_reply_acceptance_verification"));
  await db.exec(`create trigger track_reply_acceptance_verification
    before insert or update of status on sellerpilot_private.support_reply_deliveries
    for each row execute function sellerpilot_private.track_reply_acceptance_verification()`);
  await db.exec(functionStatement(sources.observation,
    "public.sellerpilot_service_observe_inquiry_replies_v1"));
}

function providerReplyResponse() {
  return {
    ok: true,
    channel: "shopee",
    operation: "inquiries.reply",
    safeMessage: "synthetic provider acceptance",
    steps: [{ name: "inquiries", ok: true, status: 200, data: {
      sellerpilotReplyAcceptance: {
        contract: "sellerpilot-reply-acceptance/1",
        level: "provider_accepted",
        channel: "shopee",
        kind: "product_review",
      },
    } }],
  };
}

function providerReadResponse() {
  return {
    ok: true,
    channel: "shopee",
    operation: "inquiries.list",
    safeMessage: "synthetic bounded read",
    steps: [{ name: "inquiries", ok: true, status: 200, data: {
      sellerpilotProviderContext: { shopId },
      response: { item_comment_list: [], more: false, next_cursor: "" },
    } }],
  };
}

async function completeGateway(db, {
  token = tokenHash, jobId, claim, response, inquiries = null, status = "succeeded",
}) {
  return asRole(db, "service_role", async () => (await db.query(
    `select public.sellerpilot_service_complete_serverless_cs_transaction(
      $1,$2,$3,$4,$5::jsonb,null,null,null,$6::jsonb,null
    ) result`, [token, jobId, claim, status, JSON.stringify(response),
      inquiries === null ? null : JSON.stringify(inquiries)],
  )).rows[0].result);
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null references auth.users(id),channel text not null,
      environment text not null,status text not null,expires_at timestamptz,seller_account_key text not null
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,scope text not null,status text not null,
      expires_at timestamptz not null,last_seen_at timestamptz,last_version text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),credential_id uuid not null
        references sellerpilot_private.channel_credentials(id),attempt_id uuid,listing_id uuid,
      channel text not null,operation text not null,environment text not null,
      request_payload jsonb not null default '{}'::jsonb,response_payload jsonb,error_message text,
      status text not null default 'queued',created_by uuid not null references auth.users(id),
      seller_account_key text not null,claim_token uuid,worker_token_id uuid
        references sellerpilot_private.ai_cli_worker_tokens(id),lease_expires_at timestamptz,
      provider_mutation_started_at timestamptz,rate_not_before timestamptz,
      attempt_count integer not null default 0,
      created_at timestamptz not null default clock_timestamp(),started_at timestamptz,
      completed_at timestamptz,updated_at timestamptz not null default clock_timestamp()
    );
    create unique index channel_gateway_jobs_continuation_once_idx
      on sellerpilot_private.channel_gateway_jobs((request_payload->>'continuationOf'))
      where nullif(request_payload->>'continuationOf','') is not null;
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
      claim_token uuid not null,worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id),
      completion_fingerprint text not null,continuation_job_id uuid references sellerpilot_private.channel_gateway_jobs(id),
      created_at timestamptz not null default clock_timestamp(),unique(job_id,claim_token)
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key,owner_id uuid not null references auth.users(id),channel_key text not null,
      source_credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      demo boolean not null default false,external_ticket_id text not null,reply_context jsonb not null,
      latest_inbound_key text,seller_account_key text not null,status text not null default 'waiting',
      provider_status text not null default 'waiting',provider_status_updated_at timestamptz,
      reply_delivery_status text not null default 'never',reply_delivery_error text,resolved_at timestamptz,
      last_delivery_job_id uuid references sellerpilot_private.channel_gateway_jobs(id),
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid not null references sellerpilot_private.support_tickets(id),
      owner_id uuid not null references auth.users(id),channel_key text not null,inbound_key text not null,
      remote_message_id text,sender_role text not null,body text not null,provider_context jsonb not null default '{}',
      received_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),unique(owner_id,channel_key,inbound_key)
    );
    create table sellerpilot_private.support_reply_deliveries(
      id uuid primary key default gen_random_uuid(),ticket_id uuid not null references sellerpilot_private.support_tickets(id),
      owner_id uuid not null references auth.users(id),gateway_job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id),
      channel_key text not null,status text not null,reply_fingerprint text not null,provider_request_id text,
      provider_message_id text,safe_message text,reconciliation_reason text,acknowledged_at timestamptz,
      acknowledged_by uuid,acknowledgement_reason text,queued_at timestamptz not null,started_at timestamptz,
      completed_at timestamptz,created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),verification_status text not null default 'unverified',
      verification_contract text,provider_accepted_at timestamptz,remote_observed_at timestamptz,
      observed_message_id uuid references sellerpilot_private.support_inbound_messages(id)
    );
    create function sellerpilot_private.worker_token_has_scope(text,text,boolean default true)
      returns boolean language sql stable set search_path='' as $$select false$$;
    create function public.sellerpilot_service_prepare_gateway_credential_refresh(
      text,uuid,uuid,jsonb,timestamptz default null,boolean default false,boolean default false
    ) returns jsonb language sql as $$select null::jsonb$$;
    create function public.sellerpilot_record_credential_test(uuid,text,text)
      returns boolean language sql as $$select true$$;
    create function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
      returns integer language sql as $$select 0$$;
    create function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      returns integer language sql as $$select jsonb_array_length($3)$$;
    create function public.sellerpilot_service_mark_channel_sync(uuid,text,text,text,text)
      returns boolean language sql as $$select true$$;
    create function public.sellerpilot_service_record_lazada_im_bootstrap_result(uuid,uuid,boolean)
      returns boolean language sql as $$select true$$;
    create function public.sellerpilot_complete_channel_gateway_job(
      p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
      p_response_payload jsonb default null,p_error_message text default null
    ) returns boolean language plpgsql security definer set search_path='' as $$
    begin
      update sellerpilot_private.channel_gateway_jobs job
         set status=p_status,response_payload=p_response_payload,error_message=p_error_message,
             lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
        from sellerpilot_private.ai_cli_worker_tokens token
       where job.id=p_job_id and job.status='running' and job.claim_token=p_claim_token
         and job.lease_expires_at>clock_timestamp() and token.id=job.worker_token_id
         and token.token_hash=p_token_hash and token.status='active'
         and token.expires_at>clock_timestamp();
      return found;
    end $$;
    insert into auth.users values('${owner}');
    insert into sellerpilot_private.channel_credentials values
      ('${credential}','${owner}','shopee','production','active',null,'${sellerAccountKey}'),
      ('${otherCredential}','${owner}','shopee','production','active',null,'${otherSellerAccountKey}');
    insert into sellerpilot_private.ai_cli_worker_tokens values
      ('${worker}','${tokenHash}','serverless_cs','active',clock_timestamp()+interval '1 day',null,null),
      ('${unrelatedWorker}','${unrelatedTokenHash}','serverless_cs','active',clock_timestamp()+interval '1 day',null,null),
      ('${gatewayWorker}','${gatewayTokenHash}','gateway','active',clock_timestamp()+interval '1 day',null,null),
      ('${expiredWorker}','${expiredTokenHash}','serverless_cs','active',clock_timestamp()-interval '1 day',null,null);
    insert into sellerpilot_private.support_tickets(
      id,owner_id,channel_key,source_credential_id,demo,external_ticket_id,reply_context,
      latest_inbound_key,seller_account_key
    ) values('${ticket}','${owner}','shopee','${credential}',false,
      'shopee:${shopId}:${commentId}',
      '{"shopId":"${shopId}","commentId":"${commentId}","itemId":"${itemId}"}',
      '${inboundKey}','${sellerAccountKey}');
    insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,status,created_by,seller_account_key,
      claim_token,worker_token_id,lease_expires_at,provider_mutation_started_at,attempt_count,started_at
    ) values('${sourceJob}','${credential}','shopee','inquiries.reply','production',
      '{"arguments":{"shopId":"${shopId}","commentId":"${commentId}","itemId":"${itemId}","reply":"${reply}"},"sellerpilotTicketId":"${ticket}","sellerpilotInboundKey":"${inboundKey}","sellerpilotReplyFingerprint":"${replyFingerprint}"}',
      'running','${owner}','${sellerAccountKey}','${sourceClaim}','${worker}',
      clock_timestamp()+interval '1 hour',clock_timestamp(),1,clock_timestamp());
  `);
  await installActualCompletion(db);
  await installActualDeliveryAndObservation(db);
  await db.exec(readback);
  const completed = await completeGateway(db, {
    jobId: sourceJob, claim: sourceClaim, response: providerReplyResponse(),
  });
  assert.equal(completed.status, "completed");
  const delivery = (await db.query(
    "select id from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1",
    [sourceJob],
  )).rows[0]?.id;
  assert.ok(delivery);
  return { db, delivery };
}

async function attempt(state, number) {
  return (await state.db.query(`select * from sellerpilot_private.shopee_reply_readback_attempts
    where delivery_id=$1 and attempt=$2`, [state.delivery, number])).rows[0];
}

async function claimRead(state, number, { workerId = worker, claim = uuid(59010 + number) } = {}) {
  const row = await attempt(state, number);
  await state.db.query(`update sellerpilot_private.channel_gateway_jobs
    set status='running',claim_token=$1,worker_token_id=$2,lease_expires_at=clock_timestamp()+interval '1 hour',
        attempt_count=attempt_count+1,started_at=coalesce(started_at,clock_timestamp()) where id=$3`,
  [claim, workerId, row.readback_job_id]);
  return { ...row, claim };
}

async function finishRead(state, number) {
  const row = await claimRead(state, number);
  const completed = await completeGateway(state.db, {
    jobId: row.readback_job_id, claim: row.claim, response: providerReadResponse(), inquiries: [],
  });
  assert.equal(completed.status, "completed");
  return row;
}

async function recordReadback(state, row, outcome, token = tokenHash) {
  return asRole(state.db, "service_role", async () => (await state.db.query(
    `select public.sellerpilot_service_record_shopee_reply_readback_v1(
      $1,$2,$3,$4,$5::jsonb) result`,
    [token, row.readback_job_id, row.claim, state.delivery, JSON.stringify(outcome)],
  )).rows[0].result);
}

function outcome(number, state, reason, observed = false) {
  return { state, reason, attempt: number, matchingSellerReplies: observed ? 1 : 0,
    replyContentObserved: observed, automaticResendAllowed: false };
}

test("actual serverless completion creates one provider-accepted delivery and one exact read-only job", async () => {
  const state = await fixture();
  try {
    const deliveryRow = (await state.db.query(
      "select * from sellerpilot_private.support_reply_deliveries where id=$1", [state.delivery])).rows[0];
    assert.equal(deliveryRow.status, "succeeded");
    assert.equal(deliveryRow.verification_status, "provider_accepted");
    const first = await attempt(state, 1);
    const job = (await state.db.query("select * from sellerpilot_private.channel_gateway_jobs where id=$1",
      [first.readback_job_id])).rows[0];
    assert.equal(job.operation, "inquiries.list");
    assert.equal(job.credential_id, credential);
    assert.equal(job.created_by, owner);
    assert.equal(job.seller_account_key, sellerAccountKey);
    assert.equal(job.request_payload.arguments.shopId, shopId);
    assert.equal(job.request_payload.arguments.commentId, commentId);
    assert.equal(job.request_payload.arguments.itemId, itemId);
    assert.equal(job.request_payload.sellerpilotShopeeReplyReadback.expectedInboundKey, inboundKey);
    assert.equal(job.request_payload.sellerpilotShopeeReplyReadback.expectedReplyFingerprint, replyFingerprint);
    assert.equal((await state.db.query(
      "select count(*)::int n from sellerpilot_private.gateway_completion_receipts where job_id=$1",
      [sourceJob])).rows[0].n, 1);

    const replay = await completeGateway(state.db, {
      jobId: sourceJob, claim: sourceClaim, response: providerReplyResponse(),
    });
    assert.equal(replay.status, "completed");
    assert.equal(replay.replayed, true);
    assert.equal((await state.db.query(
      "select count(*)::int n from sellerpilot_private.support_reply_deliveries")).rows[0].n, 1);
    assert.equal((await state.db.query(
      "select count(*)::int n from sellerpilot_private.shopee_reply_readback_attempts")).rows[0].n, 1);
  } finally { await state.db.close(); }
});

test("serverless_cs receipt is accepted only for its exact live claim, token, credential and account", async () => {
  const state = await fixture();
  try {
    const first = await attempt(state, 1);
    const claim = uuid(59101);
    await state.db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',claim_token=$1,
      worker_token_id=$2,lease_expires_at=clock_timestamp()+interval '1 hour' where id=$3`,
    [claim, worker, first.readback_job_id]);
    for (const [label, token, claimValue] of [
      ["unrelated serverless token", unrelatedTokenHash, claim],
      ["wrong claim", tokenHash, uuid(59102)],
    ]) {
      const rejected = await completeGateway(state.db, {
        token, jobId: first.readback_job_id, claim: claimValue, response: providerReadResponse(), inquiries: [],
      });
      assert.equal(rejected.status, "ownership_lost", label);
    }
    await state.db.query("update sellerpilot_private.channel_gateway_jobs set worker_token_id=$1 where id=$2",
      [expiredWorker, first.readback_job_id]);
    const expired = await completeGateway(state.db, {
      token: expiredTokenHash, jobId: first.readback_job_id, claim,
      response: providerReadResponse(), inquiries: [],
    });
    assert.equal(expired.status, "ownership_lost");
    await state.db.query("update sellerpilot_private.channel_gateway_jobs set worker_token_id=$1 where id=$2",
      [worker, first.readback_job_id]);
    const completed = await completeGateway(state.db, {
      jobId: first.readback_job_id, claim, response: providerReadResponse(), inquiries: [],
    });
    assert.equal(completed.status, "completed");
    first.claim = claim;

    await assert.rejects(recordReadback(state, first,
      outcome(1, "delayed", "exact_reply_not_yet_observed"), unrelatedTokenHash),
    /SHOPEE_REPLY_READBACK_LINEAGE_INVALID/u);
    await assert.rejects(recordReadback(state, first,
      outcome(1, "delayed", "exact_reply_not_yet_observed"), gatewayTokenHash),
    /SHOPEE_REPLY_READBACK_LINEAGE_INVALID/u);
    const rejectAfterMutation = async (query, parameters) => {
      await state.db.exec("begin");
      try {
        await state.db.query(query, parameters);
        await state.db.exec("set role service_role");
        await assert.rejects(state.db.query(
          `select public.sellerpilot_service_record_shopee_reply_readback_v1(
            $1,$2,$3,$4,$5::jsonb) result`,
          [tokenHash, first.readback_job_id, first.claim, state.delivery,
            JSON.stringify(outcome(1, "delayed", "exact_reply_not_yet_observed"))],
        ), /SHOPEE_REPLY_READBACK_LINEAGE_INVALID/u);
      } finally {
        await state.db.exec("rollback");
        await state.db.exec("reset role");
      }
    };
    await rejectAfterMutation(
      "update sellerpilot_private.channel_gateway_jobs set seller_account_key=$1 where id=$2",
      [otherSellerAccountKey, first.readback_job_id],
    );
    await rejectAfterMutation(
      "update sellerpilot_private.channel_gateway_jobs set credential_id=$1 where id=$2",
      [otherCredential, first.readback_job_id],
    );
    await rejectAfterMutation(
      "update sellerpilot_private.channel_credentials set expires_at=clock_timestamp()-interval '1 day' where id=$1",
      [credential],
    );

    const accepted = await recordReadback(state, first,
      outcome(1, "delayed", "exact_reply_not_yet_observed"));
    assert.equal(accepted.state, "delayed");
    assert.ok(accepted.nextJobId);
  } finally { await state.db.close(); }
});

test("an intervening customer generation preserves accepted delivery and cannot cause automatic resend", async () => {
  const state = await fixture();
  try {
    await state.db.query(`insert into sellerpilot_private.support_inbound_messages(
      ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,received_at
    ) values($1,$2,'shopee',$3,'new-customer-message','customer','new customer review',clock_timestamp())`,
    [ticket, owner, newerInboundKey]);
    await state.db.query(`update sellerpilot_private.support_tickets set latest_inbound_key=$1,
      status='waiting',provider_status='waiting',reply_delivery_status='never',resolved_at=null where id=$2`,
    [newerInboundKey, ticket]);
    const first = await finishRead(state, 1);
    const observedAt = new Date().toISOString();
    const observation = [{
      contract: "sellerpilot-reply-observation/1",
      externalTicketId: `shopee:${shopId}:${commentId}`,
      inboundKey: `shopee:${"6".repeat(64)}`,
      remoteMessageId: "seller-echo-7002",
      body: reply,
      replyFingerprint,
      occurredAt: observedAt,
      binding: { shopId, commentId, itemId },
    }];
    const observed = await asRole(state.db, "service_role", async () => (await state.db.query(
      `select public.sellerpilot_service_observe_inquiry_replies_v1($1,'shopee',$2::jsonb) result`,
      [credential, JSON.stringify(observation)],
    )).rows[0].result);
    assert.equal(observed.matched, 1);
    const recorded = await recordReadback(state, first,
      outcome(1, "observed", "exact_reply_observed", true));
    assert.equal(recorded.state, "observed");
    assert.equal(recorded.automaticResendAllowed, false);
    const deliveryRow = (await state.db.query(`select status,verification_status,reply_fingerprint
      from sellerpilot_private.support_reply_deliveries where id=$1`, [state.delivery])).rows[0];
    assert.deepEqual(deliveryRow, {
      status: "succeeded", verification_status: "remote_observed", reply_fingerprint: replyFingerprint,
    });
    const ticketRow = (await state.db.query(`select status,latest_inbound_key,reply_delivery_status,
      resolved_at from sellerpilot_private.support_tickets where id=$1`, [ticket])).rows[0];
    assert.equal(ticketRow.status, "waiting");
    assert.equal(ticketRow.latest_inbound_key, newerInboundKey);
    assert.equal(ticketRow.reply_delivery_status, "never");
    assert.equal(ticketRow.resolved_at, null);
    const attemptRow = await attempt(state, 1);
    assert.equal(attemptRow.expected_inbound_key, inboundKey);
    assert.equal(attemptRow.expected_reply_fingerprint, replyFingerprint);
    assert.equal(attemptRow.shop_id, shopId);
    assert.equal(attemptRow.comment_id, commentId);
    assert.equal(attemptRow.item_id, itemId);
    assert.equal((await state.db.query(`select count(*)::int n from sellerpilot_private.channel_gateway_jobs
      where operation='inquiries.reply'`)).rows[0].n, 1);
  } finally { await state.db.close(); }
});

test("actual read completions remain bounded to three attempts without another reply", async () => {
  const state = await fixture();
  try {
    for (let number = 1; number <= 3; number += 1) {
      const row = await finishRead(state, number);
      const stateName = number < 3 ? "delayed" : "missing";
      const reason = number < 3 ? "exact_reply_not_yet_observed" : "exact_reply_missing_after_bound";
      const result = await recordReadback(state, row, outcome(number, stateName, reason));
      assert.equal(result.state, stateName);
      assert.equal(result.automaticResendAllowed, false);
      assert.equal(Boolean(result.nextJobId), number < 3);
    }
    assert.equal((await state.db.query(
      "select count(*)::int n from sellerpilot_private.shopee_reply_readback_attempts")).rows[0].n, 3);
    assert.equal((await state.db.query(`select count(*)::int n from sellerpilot_private.gateway_completion_receipts
      receipt join sellerpilot_private.channel_gateway_jobs job on job.id=receipt.job_id
      where job.operation='inquiries.list'`)).rows[0].n, 3);
    assert.equal((await state.db.query(`select count(*)::int n from sellerpilot_private.channel_gateway_jobs
      where operation='inquiries.reply'`)).rows[0].n, 1);
    assert.equal((await state.db.query(`select verification_status from
      sellerpilot_private.support_reply_deliveries where id=$1`, [state.delivery])).rows[0].verification_status,
    "provider_accepted");
  } finally { await state.db.close(); }
});


test("completed readback replay still requires exact authorization and immutable outcome", async () => {
  const state = await fixture();
  try {
    const row = await finishRead(state, 1);
    const original = outcome(1, "delayed", "exact_reply_not_yet_observed");
    const first = await recordReadback(state, row, original);
    await assert.rejects(recordReadback(state, row, original, unrelatedTokenHash),
      /SHOPEE_REPLY_READBACK_LINEAGE_INVALID/);
    await assert.rejects(recordReadback(state, { ...row, claim: uuid(59999) }, original),
      /SHOPEE_REPLY_READBACK_LINEAGE_INVALID/);
    await assert.rejects(recordReadback(state, row,
      outcome(1, "mismatch", "reply_body_mismatch")), /SHOPEE_REPLY_READBACK_REPLAY_MISMATCH/);
    const replay = await recordReadback(state, row, original);
    assert.equal(replay.nextJobId, first.nextJobId);
    assert.equal((await state.db.query("select count(*)::int n from sellerpilot_private.shopee_reply_readback_attempts")).rows[0].n, 2);
  } finally { await state.db.close(); }
});

test("readback rejects null or wrong JSON types before creating another attempt", async () => {
  const state = await fixture();
  try {
    const row = await finishRead(state, 1);
    const original = outcome(1, "delayed", "exact_reply_not_yet_observed");
    for (const field of Object.keys(original)) {
      await assert.rejects(recordReadback(state, row, { ...original, [field]: null }),
        /SHOPEE_REPLY_READBACK_ARGUMENT_INVALID/, field);
    }
    for (const changed of [{ attempt: "1" }, { matchingSellerReplies: "0" },
      { matchingSellerReplies: 1.5 }, { replyContentObserved: "false" }, { automaticResendAllowed: "false" }]) {
      await assert.rejects(recordReadback(state, row, { ...original, ...changed }),
        /SHOPEE_REPLY_READBACK_ARGUMENT_INVALID/);
    }
    assert.equal((await state.db.query("select count(*)::int n from sellerpilot_private.shopee_reply_readback_attempts")).rows[0].n, 1);
  } finally { await state.db.close(); }
});
