import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { ebayCaseDisputeGatewayPlan } from "../lib/channels/cs/ebay/case-dispute-gateway.ts";
import { executeChannelOperation } from "../lib/channels/operations.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const ledgerSql = await readFile(new URL(
  "../supabase/migrations/20260908135249_ebay_case_dispute_history_ledger.sql",
  import.meta.url,
), "utf8");
const collectionSql = await readFile(new URL(
  "../supabase/migrations/20260909124944_cs_ebay_case_dispute_durable_collection_v2.sql",
  import.meta.url,
), "utf8");

const owner = "41000000-0000-4000-8000-000000000001";
const credential = "51000000-0000-4000-8000-000000000001";
const tokenId = "61000000-0000-4000-8000-000000000001";
const claimToken = "71000000-0000-4000-8000-000000000001";
const sellerKey = "a".repeat(64);
const payload = {
  access_token: "fixture-token",
  marketplace_id: "EBAY_US",
  ebay_user_id: "fixture-seller",
  provider_account_identity_version: "v1",
  provider_account_subject: "ebay:eias:fixtureSellerEiasToken01",
};

function resolutionCaseRow(index) {
  return {
    caseId: `case-durable-${index}`,
    caseStatusEnum: "OPEN",
    itemId: `item-${index}`,
    transactionId: `transaction-${index}`,
    creationDate: { value: "2026-09-08T12:00:00.000Z" },
    lastModifiedDate: { value: "2026-09-08T12:30:00.000Z" },
    respondByDate: null,
    claimAmount: { value: "10.00", currency: "USD" },
    seller: "fixture-seller",
  };
}


const sources = Object.fromEntries(await Promise.all(Object.entries({
 atomic:"20260826090400_atomic_gateway_completion_side_effects.sql",
 serverless:"20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql",
 terminal:"20260825104500_prepare_gateway_credential_refresh.sql",
 replyFence:"20260825111757_harden_inquiry_reply_delivery_fence.sql",
 latestCompletion:"20260908153341_cs_qoo10_reply_s3_actual_completion.sql"
}).map(async ([key,file]) => [key,await readFile(new URL("../supabase/migrations/"+file,import.meta.url),"utf8")])));
function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]{}\\]/gu, "\\$&");
}

function functionStatement(source, qualifiedName, occurrence = "last") {
  const pattern = new RegExp(`create(?: or replace)? function ${escapeRegExp(qualifiedName)}\\s*\\(`, "giu");
  const starts = [...source.matchAll(pattern)].map((match) => match.index);
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

async function installCanonicalHistoryCompletion(db) {
  const run = async (label, sql) => {
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`${label}: ${error.message}`, { cause: error });
    }
  };

  await run("reply mutation classifier", functionStatement(
    sources.replyFence,
    "sellerpilot_private.gateway_external_write_observed",
  ));
  await run("canonical terminal", functionStatement(
    sources.terminal,
    "public.sellerpilot_complete_channel_gateway_job",
  ));
  await run("atomic completion fingerprint", functionStatement(
    sources.atomic,
    "sellerpilot_private.gateway_completion_fingerprint",
  ));
  await run("atomic completion context", functionStatement(
    sources.atomic,
    "public.sellerpilot_service_gateway_completion_context",
  ));
  await run("atomic gateway completion", functionStatement(
    sources.atomic,
    "public.sellerpilot_service_complete_gateway_transaction",
  ));
  await run("serverless ownership", functionStatement(
    sources.serverless,
    "sellerpilot_private.worker_token_may_complete_gateway_job",
    "first",
  ));
  await run("serverless canonical token rewrite", taggedDoStatement(sources.serverless, "migration"));

  await run(
    "rename current gateway completion beneath latest canonical wrapper",
    `alter function public.sellerpilot_service_complete_gateway_transaction(
      text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
    ) rename to sellerpilot_145336_complete_before_qoo10_reply_s3`,
  );
  await run("latest canonical gateway completion", functionStatement(
    sources.latestCompletion,
    "public.sellerpilot_service_complete_gateway_transaction",
  ));
  await run("latest canonical serverless completion", functionStatement(
    sources.latestCompletion,
    "public.sellerpilot_service_complete_serverless_cs_transaction",
  ));

}
async function canonicalFunction(file, name) {
 const source=await readFile(new URL("../supabase/migrations/"+file,import.meta.url),"utf8");
 const escaped=name.replaceAll(".","\\.");
 const match=new RegExp("create (?:or replace )?function "+escaped+"\\([\\s\\S]*?as "+"(\\$[a-zA-Z_0-9]*\\$)","i").exec(source);
 if(!match) throw new Error("missing canonical function "+name);
 const end=source.indexOf(match[1]+";",match.index+match[0].length);
 if(end<0) throw new Error("missing function delimiter");
 return source.slice(match.index,end+match[1].length+1);
}
async function installCanonicalEnqueue(db) {
 await db.exec(`
  alter table sellerpilot_private.channel_gateway_jobs
    add column attempt_id uuid,add column listing_id uuid,add column created_by uuid,
    add column started_at timestamptz,add column provider_mutation_started_at timestamptz,
    add column created_at timestamptz default clock_timestamp();
  alter table sellerpilot_private.channel_gateway_jobs alter column status set default 'queued';
  create table sellerpilot_private.channel_sync_state(owner_id uuid,channel_key text,data_type text,
    status text,imported_count integer,last_started_at timestamptz,last_error text,updated_at timestamptz,
    unique(owner_id,channel_key,data_type));
  create table sellerpilot_private.operation_audit(owner_id uuid,action text,entity_type text,entity_id text,safe_detail jsonb);
  create table sellerpilot_private.serverless_static_egress_policy(channel text,enabled boolean);
 `);
 const name="public.sellerpilot_service_enqueue_periodic_sync";
 const layers=[
 ["20260821123000_enable_elevenst_order_sync.sql",null],
 ["20260826090800_suppress_legacy_shopee_order_sync.sql","sellerpilot_enqueue_periodic_sync_without_identity_gate"],
 ["20260828200500_gate_serverless_static_egress.sql","sellerpilot_20260828_enqueue_periodic_sync_before_static_egress_gate"],
 ["20260831040000_rebind_ebay_periodic_inquiry_reads.sql","sellerpilot_310400_enqueue_periodic_sync_unsafe"],
 ["20260901120000_restore_smartstore_static_egress_fence.sql","sellerpilot_310450_enqueue_periodic_sync_unsafe"]
 ];
 for(const [file,predecessor] of layers){
  if(predecessor) await db.exec(`alter function ${name}(text,text,jsonb,integer) rename to ${predecessor};`);
  await db.exec(await canonicalFunction(file,name));
 }
 await db.exec(await canonicalFunction("20260825111800_bind_listing_seller_accounts.sql","sellerpilot_private.guard_gateway_job_seller_lineage"));
 await db.exec(`create trigger guard_gateway_job_seller_lineage before insert or update on sellerpilot_private.channel_gateway_jobs for each row execute function sellerpilot_private.guard_gateway_job_seller_lineage();`);
}

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}');
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select false$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, created_by uuid references auth.users(id), channel text,
      environment text, version integer, status text, expires_at timestamptz,
      created_at timestamptz default now(), seller_account_key text,
      seller_account_key_source text, seller_account_verified_at timestamptz
    );
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${owner}','ebay','production',1,'active',null,now(),
      '${sellerKey}','provider_certified_v1',now()
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key, token_hash text, status text, expires_at timestamptz
    );
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${tokenId}','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','active',now()+interval '1 day'
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),
      credential_id uuid references sellerpilot_private.channel_credentials(id),
      channel text, operation text, environment text, request_payload jsonb,
      response_payload jsonb, status text, worker_token_id uuid,
      claim_token uuid, lease_expires_at timestamptz, seller_account_key text,
      attempt_count integer default 0, completed_at timestamptz,
      updated_at timestamptz default now(), error_message text
    );
    create unique index continuation_once on sellerpilot_private.channel_gateway_jobs((request_payload->>'continuationOf'))
      where nullif(request_payload->>'continuationOf','') is not null;
  `);
  await installCanonicalEnqueue(db);
  await db.exec(`
 alter table sellerpilot_private.channel_gateway_jobs add column credential_refresh_in_flight boolean not null default false,
  add column oauth_request_vault_id uuid,add column oauth_exchange_completed boolean not null default false;
 alter table sellerpilot_private.ai_cli_worker_tokens add column scope text not null default 'serverless_cs',
  add column last_seen_at timestamptz,add column last_version text;
 alter table sellerpilot_private.channel_credentials add column vault_secret_id uuid;
 create schema vault;create table vault.secrets(id uuid primary key,secret text);
 create table sellerpilot_private.gateway_completion_receipts(job_id uuid primary key,claim_token uuid not null,
  worker_token_id uuid not null,completion_fingerprint text not null,continuation_job_id uuid,
  created_at timestamptz default clock_timestamp(),unique(job_id,claim_token));
 `);
 await db.exec(`alter table sellerpilot_private.channel_sync_state add column last_succeeded_at timestamptz;
 create table sellerpilot_private.support_tickets(owner_id uuid,channel_key text,demo boolean);`);
 await db.exec(await canonicalFunction("20260820053500_channel_inquiry_sync.sql","public.sellerpilot_service_ingest_inquiries"));
 await installCanonicalHistoryCompletion(db);
 await db.exec(await canonicalFunction("20260820050000_channel_order_sync.sql","public.sellerpilot_service_mark_channel_sync"));
  await db.exec(ledgerSql);
  await db.exec(collectionSql);
  return db;
}

async function serviceRpc(db, sql, values = []) {
  await db.exec("set role service_role");
  try {
    return (await db.query(sql, values)).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

async function enqueue(db, now) {
  const plan = ebayCaseDisputeGatewayPlan(now);
  const receipt = await serviceRpc(db,
    "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v2($1::jsonb) result",
    [JSON.stringify(plan)],
  );
  return { plan, receipt };
}

async function claim(db, jobId, claim = claimToken) {
  await db.query(`update sellerpilot_private.channel_gateway_jobs set
    status='running',worker_token_id=$2,claim_token=$3,lease_expires_at=now()+interval '5 minutes',
    attempt_count=attempt_count+1 where id=$1`, [jobId, tokenId, claim]);
}

async function recordPage(db, job, result, claim = claimToken) {
  const step = result.steps[0];
  return serviceRpc(db,
    "select public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v2($1,$2,$3,$4::jsonb,$5::jsonb) result",
    ["ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", job.id, claim, JSON.stringify(step.data),
      result.continuation ? JSON.stringify(result.continuation.arguments) : null],
  );
}

async function genericComplete(db, job, result) {
  await db.query(`update sellerpilot_private.channel_gateway_jobs set
    status='succeeded',response_payload=$2::jsonb,completed_at=now(),worker_token_id=null,
    claim_token=null,lease_expires_at=null where id=$1`, [job.id, JSON.stringify(result)]);
  if (!result.continuation) return null;
  return (await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    credential_id,channel,operation,environment,request_payload,status,seller_account_key
  ) values($1,'ebay','inquiries.list','production',$2::jsonb,'queued',$3) returning id,request_payload`, [
    credential,
    JSON.stringify({
      periodicKey: `continuation:${job.id}:${result.continuation.arguments.sellerpilotPaginationDepth}`,
      continuationOf: job.id,
      arguments: result.continuation.arguments,
    }),
    sellerKey,
  ])).rows[0];
}

async function queuedJob(db, collectionKind) {
  return (await db.query(`select id,request_payload from sellerpilot_private.channel_gateway_jobs
    where status='queued' and request_payload#>>'{arguments,collectionKind}'=$1 order by updated_at,id limit 1`,
  [collectionKind])).rows[0];
}

async function executeResolution(arguments_) {
  return executeChannelOperation({
    channel: "ebay", operation: "inquiries.list", environment: "production", payload, arguments: arguments_,
  });
}

test("normal root-to-terminal chain records every 18-month window before completion", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    globalThis.fetch = async () => {
      providerCalls += 1;
      return Response.json({ members: [], paginationOutput: { limit: 25, offset: 0, totalEntries: 0 }, totalNumberOfCases: 0 });
    };
    const { plan } = await enqueue(db, new Date("2026-09-08T13:00:00.000Z"));
    let job = await queuedJob(db, "initial_backfill");
    let pages = 0;
    while (job) {
      await claim(db, job.id);
      const result = await executeResolution(job.request_payload.arguments);
      assert.equal(result.ok, true);
      await recordPage(db, job, result);
      pages += 1;
      job = await genericComplete(db, job, result);
    }
    assert.equal(pages, plan.jobs[0].arguments.windowQueue.length + 1);
    assert.equal(providerCalls, pages);
    const beforeCheck = await db.query(`select initial_completed_at from sellerpilot_private.ebay_case_dispute_collection_scopes
      where credential_id=$1 and resource_kind='resolution_case'`, [credential]);
    assert.equal(beforeCheck.rows[0].initial_completed_at, null,
      "terminal provider success is not collection completion until the scheduler verifies the stored chain");
    const after = await enqueue(db, new Date("2026-09-08T14:00:00.000Z"));
    assert.equal(after.receipt.queued, 2, "recent overlap and the next payment root are now eligible");
    const scope = await db.query(`select initial_completed_at is not null complete from sellerpilot_private.ebay_case_dispute_collection_scopes
      where credential_id=$1 and resource_kind='resolution_case'`, [credential]);
    assert.equal(scope.rows[0].complete, true);
    const observed = await db.query("select count(*)::integer count from sellerpilot_private.ebay_case_dispute_collection_pages");
    assert.equal(observed.rows[0].count, pages);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("an unfinished last-window provider page and a failed child never complete; the next plan restarts safely", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      const request = new URL(String(url));
      const offset = Number(request.searchParams.get("offset"));
      const isLastWindow = request.searchParams.get("case_creation_date_range_to")
        === "2026-09-08T13:00:00.000Z";
      if (!isLastWindow) return Response.json({
        members: [], paginationOutput: { limit: 25, offset, totalEntries: 0 }, totalNumberOfCases: 0,
      });
      assert.equal(offset, 0, "the deliberately failed final-window continuation is never fetched");
      return Response.json({
        members: Array.from({ length: 25 }, (_, index) => resolutionCaseRow(index)),
        paginationOutput: { limit: 25, offset, totalEntries: 26 }, totalNumberOfCases: 26,
      });
    };
    const { plan, receipt } = await enqueue(db, new Date("2026-09-08T13:00:00.000Z"));
    assert.equal(receipt.queued, 2);
    let job = await queuedJob(db, "initial_backfill");
    const initialRootId = job.id;
    let completedWindowPages = 0;
    while (job.request_payload.arguments.windowQueue.length > 0) {
      await claim(db, job.id);
      const page = await executeResolution(job.request_payload.arguments);
      await recordPage(db, job, page);
      job = await genericComplete(db, job, page);
      completedWindowPages += 1;
    }
    assert.equal(completedWindowPages, plan.jobs[0].arguments.windowQueue.length);
    await claim(db, job.id);
    const finalWindowFirstPage = await executeResolution(job.request_payload.arguments);
    assert.equal(finalWindowFirstPage.steps[0].data.page.nextOffset, 25);
    assert.ok(finalWindowFirstPage.continuation, "the last window still requires one provider page");
    await recordPage(db, job, finalWindowFirstPage);
    const child = await genericComplete(db, job, finalWindowFirstPage);
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='failed',completed_at=now() where id=$1", [child.id]);
    const resumed = await enqueue(db, new Date("2026-09-08T14:00:00.000Z"));
    assert.equal(resumed.receipt.queued, 2, "a fresh initial root and payment root are queued; overlap remains deferred");
    assert.equal(resumed.receipt.deferred, 1);
    const restartedRoot = await queuedJob(db, "initial_backfill");
    assert.notEqual(restartedRoot.id, initialRootId);
    assert.equal(restartedRoot.request_payload.arguments.collectionAnchor, "2026-09-08T14:00:00.000Z");
    assert.equal(restartedRoot.request_payload.arguments.pageNumber, 1);
    assert.equal(restartedRoot.request_payload.arguments.startTime, resumed.plan.jobs[0].arguments.startTime);
    const restartedBinding = await db.query(`select credential_id,seller_account_key
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [restartedRoot.id]);
    assert.equal(restartedBinding.rows[0].credential_id, credential);
    assert.equal(restartedBinding.rows[0].seller_account_key, sellerKey);
    const scope = await db.query(`select initial_completed_at from sellerpilot_private.ebay_case_dispute_collection_scopes
      where credential_id=$1 and resource_kind='resolution_case'`, [credential]);
    assert.equal(scope.rows[0].initial_completed_at, null);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("recording rejects wrong job binding, account, seller, credential, lease, parent, and orphan child", async () => {
  const cases = ["kind", "resource", "anchor", "account", "seller", "credential", "lease", "parent", "orphan"];
  for (const scenario of cases) {
    const db = await database();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({
        paymentDisputeSummaries: [], limit: 25, offset: 0, total: 0,
      });
      await enqueue(db, new Date("2026-09-08T13:00:00.000Z"));
      const job = await queuedJob(db, "periodic_summary");
      await claim(db, job.id);
      const result = await executeChannelOperation({
        channel: "ebay", operation: "inquiries.list", environment: "production", payload,
        arguments: job.request_payload.arguments,
      });
      if (scenario === "kind") await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,kind}','\"conversation\"') where id=$1", [job.id]);
      if (scenario === "resource") await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,resourceKind}','\"resolution_case\"') where id=$1", [job.id]);
      if (scenario === "anchor") await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,collectionAnchor}','\"2026-09-08T12:00:00.000Z\"') where id=$1", [job.id]);
      if (scenario === "account") {
        const otherCredential = "51000000-0000-4000-8000-000000000002";
        await db.query(`insert into sellerpilot_private.channel_credentials values(
          $1,$2,'ebay','production',1,'active',null,now(),$3,'provider_certified_v1',now()
        )`, [otherCredential, owner, sellerKey]);
        await db.query("update sellerpilot_private.channel_gateway_jobs set credential_id=$2 where id=$1", [job.id, otherCredential]);
      }
      if (scenario === "seller") {
        await assert.rejects(db.query("update sellerpilot_private.channel_gateway_jobs set seller_account_key=$2 where id=$1", [job.id, "b".repeat(64)]), /gateway job lineage is immutable/);
        assert.equal((await db.query("select seller_account_key from sellerpilot_private.channel_gateway_jobs where id=$1",[job.id])).rows[0].seller_account_key,sellerKey);
        continue;
      }
      if (scenario === "credential") await db.query("update sellerpilot_private.channel_credentials set version=2 where id=$1", [credential]);
      if (scenario === "lease") await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [job.id]);
      if (scenario === "parent" || scenario === "orphan") {
        const synthetic = (await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
          credential_id,channel,operation,environment,request_payload,status,worker_token_id,claim_token,
          lease_expires_at,seller_account_key,attempt_count
        ) values($1,'ebay','inquiries.list','production',$2::jsonb,'running',$3,$4,now()+interval '5 minutes',$5,1)
        returning id,request_payload`, [credential, JSON.stringify({
          ...(scenario === "parent" ? { continuationOf: "81000000-0000-4000-8000-000000000001" } : {}),
          arguments: { ...job.request_payload.arguments, collectionRootJobId: job.id },
        }), tokenId, claimToken, sellerKey])).rows[0];
        job.id = synthetic.id;
      }
      await assert.rejects(recordPage(db, job, result));
    } finally {
      globalThis.fetch = originalFetch;
      await db.close();
    }
  }
});

test("duplicate plan enqueue keeps one pending root per exact account and plan key", async () => {
  const db = await database();
  try {
    const now = new Date("2026-09-08T13:00:00.000Z");
    const first = await enqueue(db, now);
    assert.deepEqual({
      attempted: first.receipt.attempted,
      queued: first.receipt.queued,
      pending: first.receipt.pending,
      deferred: first.receipt.deferred,
    }, { attempted: 3, queued: 2, pending: 0, deferred: 1 });
    const second = await enqueue(db, now);
    assert.deepEqual({
      attempted: second.receipt.attempted,
      queued: second.receipt.queued,
      pending: second.receipt.pending,
      deferred: second.receipt.deferred,
    }, { attempted: 3, queued: 0, pending: 1, deferred: 2 });
    const roots = await db.query(`select id,credential_id,seller_account_key,
        request_payload#>>'{arguments,collectionRootJobId}' root_id,
        request_payload#>>'{arguments,collectionPlanKey}' plan_key
      from sellerpilot_private.channel_gateway_jobs
      where request_payload#>>'{arguments,kind}'='case_dispute_history'
      order by request_payload#>>'{arguments,collectionKind}'`);
    assert.equal(roots.rows.length, 2);
    for (const root of roots.rows) {
      assert.equal(root.credential_id, credential);
      assert.equal(root.seller_account_key, sellerKey);
      assert.equal(root.root_id, root.id);
      assert.ok(first.plan.jobs.some(job => job.periodicKey === root.plan_key));
    }
  } finally {
    await db.close();
  }
});

test("recording binds exact resolution window and cursor before accepting a terminal page", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      const request = new URL(String(url));
      const offset = Number(request.searchParams.get("offset"));
      return Response.json({
        members: [], paginationOutput: { limit: 25, offset, totalEntries: 0 }, totalNumberOfCases: 0,
      });
    };
    await enqueue(db, new Date("2026-09-08T13:00:00.000Z"));
    const job = await queuedJob(db, "initial_backfill");
    await claim(db, job.id);
    const result = await executeResolution(job.request_payload.arguments);
    assert.ok(result.continuation, "the first empty window advances to the next exact window");

    const wrongWindow = structuredClone(result);
    wrongWindow.steps[0].data.page.startTime = "2025-03-08T13:00:00.001Z";
    await assert.rejects(recordPage(db, job, wrongWindow), /RANGE_MISMATCH/);

    const wrongCursor = structuredClone(result);
    wrongCursor.steps[0].data.page.offset = 25;
    await assert.rejects(recordPage(db, job, wrongCursor), /CURSOR_INVALID/);

    const wrongContinuation = structuredClone(result);
    wrongContinuation.continuation.arguments.pageNumber = 2;
    await assert.rejects(recordPage(db, job, wrongContinuation), /CONTINUATION_INVALID/);

    const receipt = await recordPage(db, job, result);
    assert.equal(receipt.status, "recorded");
    const page = await db.query(`select start_time,end_time,page_number,provider_has_next,
        has_continuation,remaining_window_count
      from sellerpilot_private.ebay_case_dispute_collection_pages where job_id=$1`, [job.id]);
    assert.equal(page.rows[0].start_time.toISOString(), job.request_payload.arguments.startTime);
    assert.equal(page.rows[0].end_time.toISOString(), job.request_payload.arguments.endTime);
    assert.equal(page.rows[0].page_number, 1);
    assert.equal(page.rows[0].provider_has_next, false);
    assert.equal(page.rows[0].has_continuation, true);
    assert.equal(page.rows[0].remaining_window_count, job.request_payload.arguments.windowQueue.length);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("an exact terminal Payment Dispute page is replay-safe and cannot grow a continuation", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      const request = new URL(String(url));
      const offset = Number(request.searchParams.get("offset"));
      return Response.json({ paymentDisputeSummaries: [], limit: 25, offset, total: 0 });
    };
    await enqueue(db, new Date("2026-09-08T13:00:00.000Z"));
    const job = await queuedJob(db, "periodic_summary");
    await claim(db, job.id);
    const result = await executeChannelOperation({
      channel: "ebay", operation: "inquiries.list", environment: "production", payload,
      arguments: job.request_payload.arguments,
    });
    assert.equal(result.ok, true);
    assert.equal(result.continuation, undefined);
    const first = await recordPage(db, job, result);
    const replay = await recordPage(db, job, result);
    assert.deepEqual(replay, first);
    const page = await db.query(`select provider_has_next,has_continuation,next_arguments_sha256
      from sellerpilot_private.ebay_case_dispute_collection_pages where job_id=$1`, [job.id]);
    assert.equal(page.rows[0].provider_has_next, false);
    assert.equal(page.rows[0].has_continuation, false);
    assert.equal(page.rows[0].next_arguments_sha256, null);
    const records = await db.query("select count(*)::integer count from sellerpilot_private.ebay_case_dispute_collection_pages where job_id=$1", [job.id]);
    assert.equal(records.rows[0].count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("the SQL claim fence rejects a repeated common cursor digest", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({
      members: [], paginationOutput: { limit: 25, offset: 0, totalEntries: 0 }, totalNumberOfCases: 0,
    });
    await enqueue(db, new Date("2026-09-08T13:00:00.000Z"));
    const root = await queuedJob(db, "initial_backfill");
    await claim(db, root.id);
    const first = await executeResolution(root.request_payload.arguments);
    await recordPage(db, root, first);
    const child = await genericComplete(db, root, first);
    await claim(db, child.id);
    const second = await executeResolution(child.request_payload.arguments);
    const repeated = structuredClone(second);
    const currentTrail = child.request_payload.arguments.sellerpilotPaginationTrail;
    repeated.continuation.arguments.sellerpilotPaginationTrail = [...currentTrail, currentTrail[0]];
    await assert.rejects(recordPage(db, child, repeated), /CONTINUATION_STATE_INVALID/);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("a synthetic succeeded child without an exact page ledger cannot satisfy initial completion", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({
      members: [], paginationOutput: { limit: 25, offset: 0, totalEntries: 0 }, totalNumberOfCases: 0,
    });
    await enqueue(db, new Date("2026-09-08T13:00:00.000Z"));
    const root = await queuedJob(db, "initial_backfill");
    await claim(db, root.id);
    const first = await executeResolution(root.request_payload.arguments);
    await recordPage(db, root, first);
    const skippedChild = await genericComplete(db, root, first);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set
      status='succeeded',response_payload=$2::jsonb,completed_at=now()
      where id=$1`, [skippedChild.id, JSON.stringify({
      ok: true, channel: "ebay", operation: "inquiries.list",
      steps: [{ name: "ebay-case-dispute-history-page", ok: true, status: 200, data: {
        contract: "sellerpilot-ebay-case-dispute-gateway-page/1",
        resourceKind: "resolution_case", collectionKind: "initial_backfill",
        page: { availability: "readable", httpStatus: 200, entries: [], total: 0,
          offset: 0, nextOffset: null,
          startTime: skippedChild.request_payload.arguments.startTime,
          endTime: skippedChild.request_payload.arguments.endTime },
      } }],
    })]);
    const resumed = await enqueue(db, new Date("2026-09-08T14:00:00.000Z"));
    assert.equal(resumed.receipt.queued, 2);
    assert.equal(resumed.receipt.deferred, 1);
    const scope = await db.query(`select initial_completed_at from sellerpilot_private.ebay_case_dispute_collection_scopes
      where credential_id=$1 and resource_kind='resolution_case'`, [credential]);
    assert.equal(scope.rows[0].initial_completed_at, null);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("more than 128 exact Payment Dispute continuations remain valid without an ancestry walk cap", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url) => {
      const offset = Number(new URL(String(url)).searchParams.get("offset"));
      calls += 1;
      return Response.json({
        paymentDisputeSummaries: [], limit: 25, offset,
        ...(calls < 130 ? {
          next: `https://api.ebay.com/sell/fulfillment/v1/payment_dispute_summary?limit=25&offset=${offset + 25}`,
        } : {}),
      });
    };
    await enqueue(db, new Date("2026-09-08T13:00:00.000Z"));
    let job = await queuedJob(db, "periodic_summary");
    while (job) {
      await claim(db, job.id);
      const result = await executeChannelOperation({
        channel: "ebay", operation: "inquiries.list", environment: "production", payload,
        arguments: job.request_payload.arguments,
      });
      await recordPage(db, job, result);
      job = await genericComplete(db, job, result);
    }
    assert.equal(calls, 130);
    const pages = await db.query("select count(*)::integer count from sellerpilot_private.ebay_case_dispute_collection_pages");
    assert.equal(pages.rows[0].count, 130);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("initial resolution completion verifies an exact lineage longer than 128 pages", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  let firstWindowCalls = 0;
  try {
    const { plan } = await enqueue(db, new Date("2026-09-08T13:00:00.000Z"));
    const firstWindowStart = plan.jobs[0].arguments.startTime;
    globalThis.fetch = async url => {
      const request = new URL(String(url));
      const offset = Number(request.searchParams.get("offset"));
      if (request.searchParams.get("case_creation_date_range_from") === firstWindowStart) {
        firstWindowCalls += 1;
        return Response.json({
          members: [], paginationOutput: { limit: 25, offset, totalEntries: 3226 }, totalNumberOfCases: 3226,
        });
      }
      return Response.json({
        members: [], paginationOutput: { limit: 25, offset, totalEntries: 0 }, totalNumberOfCases: 0,
      });
    };
    let job = await queuedJob(db, "initial_backfill");
    let pages = 0;
    while (job) {
      await claim(db, job.id);
      const result = await executeResolution(job.request_payload.arguments);
      await recordPage(db, job, result);
      job = await genericComplete(db, job, result);
      pages += 1;
    }
    assert.equal(firstWindowCalls, 130);
    assert.ok(pages > 128);
    await enqueue(db, new Date("2026-09-08T14:00:00.000Z"));
    const scope = await db.query(`select initial_completed_at is not null complete
      from sellerpilot_private.ebay_case_dispute_collection_scopes
      where credential_id=$1 and resource_kind='resolution_case'`, [credential]);
    assert.equal(scope.rows[0].complete, true);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("actual CS schedule and gateway entrypoints persist and resume an exact Payment Dispute cursor", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  const { enqueueCurrentInquirySyncs } = await import("../lib/cs/operations/schedule.ts");
  const { runOneServerlessCsGatewayJob } = await import("../lib/channels/serverless-gateway.ts");
  const { executeServerlessGatewayProviderJob } = await import("../lib/channels/serverless-gateway-provider.ts");
  let nextClaimJobId = null;
  const providerOffsets = [];
  let rpcFailure = null;
  const rpcCalls = [];
  let providerResult = null;
  const executeProvider = async input => {
    providerResult = await executeServerlessGatewayProviderJob(input);
    return providerResult;
  };
  try {
    const rpc = async (name, args = {}) => {
      rpcCalls.push(name);
      if (name === "sellerpilot_service_enqueue_periodic_sync" || name === "sellerpilot_service_enqueue_lazada_inquiry_fanout") {
        return { data: { status: "not_connected" }, error: null };
      }
      if (name === "sellerpilot_service_enqueue_ebay_case_dispute_collection_v2") {
        const data = await serviceRpc(db,
          "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v2($1::jsonb) result",
          [JSON.stringify(args.p_plan)],
        );
        return { data, error: null };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        if (!nextClaimJobId) return { data: null, error: null };
        const job = (await db.query(`select id,credential_id,channel,operation,environment,request_payload
          from sellerpilot_private.channel_gateway_jobs where id=$1`, [nextClaimJobId])).rows[0];
        await claim(db, job.id);
        nextClaimJobId = null;
        return { data: {
          id: job.id,
          claim_token: claimToken,
          credential_id: job.credential_id,
          channel: job.channel,
          operation: job.operation,
          environment: job.environment,
          request: job.request_payload,
          credential: payload,
          attempt_count: 1,
        }, error: null };
      }
      if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") return { data: {
        contract: "sellerpilot-provider-rate-budget/1", status: "reserved", retryAfterSeconds: 0,
      }, error: null };
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_serverless_cs_completion_context") return { data: {
        status: "running", channel: "ebay", operation: "inquiries.list",
        normalization_timestamp: "2026-09-08T13:01:00.000Z",
      }, error: null };
      if (name === "sellerpilot_service_record_ebay_case_dispute_gateway_page_v2") {
        try {
          const data = await serviceRpc(db,
            "select public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v2($1,$2,$3,$4::jsonb,$5::jsonb) result",
            [args.p_token_hash, args.p_job_id, args.p_claim_token,
              JSON.stringify(args.p_page), args.p_continuation_arguments === null
                ? null : JSON.stringify(args.p_continuation_arguments)],
          );
          return { data, error: null };
        } catch (error) {
          rpcFailure = error;
          return { data: null, error: { code: error instanceof Error ? error.message : "record failed" } };
        }
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        try {
        assert.deepEqual(args.p_normalized_inquiries,[]);
        const completed = await db.transaction(async tx => (await tx.query(`select public.sellerpilot_service_complete_serverless_cs_transaction($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb) result`,[
          args.p_token_hash,args.p_job_id,args.p_claim_token,args.p_status,JSON.stringify(args.p_response_payload),args.p_error_message??null,
          args.p_credential_refresh??null,args.p_normalized_orders??null,args.p_normalized_inquiries??null,args.p_diagnostic??null
        ])).rows[0].result).catch(error => {rpcFailure={message:error.message,where:error.where};throw error;});
        if(completed.status!=="completed") rpcFailure={completed};
        assert.equal(completed.status,"completed",JSON.stringify(completed));
        nextClaimJobId=completed.continuationJobId??null;
        return {data:completed,error:null};
        } catch(error) {rpcFailure={message:error.message,stack:error.stack,where:error.where};throw error;}
      }
      if (name === "sellerpilot_service_record_cs_credential_binding_v1") return { data: {
        contract: "sellerpilot-cs-credential-binding/1", status: "recorded",
      }, error: null };
      return { data: null, error: { code: `unexpected:${name}` } };
    };

    const scheduled = await enqueueCurrentInquirySyncs({
      rpc,
      now: () => new Date("2026-09-08T13:00:00.000Z"),
    });
    assert.equal(scheduled.failed, 0);
    assert.equal(scheduled.queued, 1, "the durable plan is one successful scheduler offer");
    const root = await queuedJob(db, "periodic_summary");
    nextClaimJobId = root.id;

    globalThis.fetch = async url => {
      const request = new URL(String(url));
      const offset = Number(request.searchParams.get("offset"));
      providerOffsets.push(offset);
      return Response.json({
        paymentDisputeSummaries: [], limit: 25, offset,
        ...(offset === 0 ? {
          next: "https://api.ebay.com/sell/fulfillment/v1/payment_dispute_summary?limit=25&offset=25",
        } : {}),
      });
    };

    const first = await runOneServerlessCsGatewayJob({ rpc, executeProvider, heartbeatIntervalMs: 60_000 }, "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const firstBody = await first.json();
    assert.equal(first.status, 200, JSON.stringify({
      firstBody,
      rpcCalls,
      providerResult,
      rpcFailure: rpcFailure instanceof Error ? rpcFailure.message : rpcFailure,
    }));
    assert.equal(firstBody.status, "succeeded");
    assert.ok(nextClaimJobId, "generic CS completion persisted the exact child cursor");

    const second = await runOneServerlessCsGatewayJob({ rpc, executeProvider, heartbeatIntervalMs: 60_000 }, "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.status, "succeeded");
    assert.equal(nextClaimJobId, null);
    assert.deepEqual(providerOffsets, [0, 25]);

    const pages = await db.query(`select page_number,provider_has_next,has_continuation,parent_job_id
      from sellerpilot_private.ebay_case_dispute_collection_pages
      where resource_kind='payment_dispute' order by page_number`);
    assert.equal(pages.rows.length, 2);
    assert.deepEqual(pages.rows.map(row => row.page_number), [1, 2]);
    assert.deepEqual(pages.rows.map(row => row.provider_has_next), [true, false]);
    assert.deepEqual(pages.rows.map(row => row.has_continuation), [true, false]);
    assert.equal(pages.rows[0].parent_job_id, null);
    assert.equal(typeof pages.rows[1].parent_job_id, "string");
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});
