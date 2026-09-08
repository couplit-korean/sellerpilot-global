import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { ebayCaseDisputeGatewayPlan } from "../lib/channels/cs/ebay/case-dispute-gateway.ts";
import { executeChannelOperation } from "../lib/channels/operations.ts";

const ledgerSql = await readFile(new URL(
  "../docs/cs-parallel/proposals/ebay/ebay-case-dispute-history-ledger.sql",
  import.meta.url,
), "utf8");
const collectionSql = await readFile(new URL(
  "../docs/cs-parallel/proposals/ebay/ebay-case-dispute-durable-collection-v2.sql",
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
      '${tokenId}','worker-hash','active',now()+interval '1 day'
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
    create function public.sellerpilot_service_enqueue_periodic_sync(
      p_channel text,p_operation text,p_request_payload jsonb,p_minutes integer
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare v_id uuid; v_credential sellerpilot_private.channel_credentials%rowtype;
    begin
      select * into v_credential from sellerpilot_private.channel_credentials
       where channel=p_channel and environment='production' and status='active'
       order by version desc limit 1;
      select id into v_id from sellerpilot_private.channel_gateway_jobs
       where credential_id=v_credential.id and channel=p_channel and operation=p_operation
         and request_payload->>'periodicKey'=p_request_payload->>'periodicKey'
         and seller_account_key=v_credential.seller_account_key
         and status in ('queued','running') limit 1;
      if v_id is not null then return jsonb_build_object('status','already_pending','jobId',v_id); end if;
      insert into sellerpilot_private.channel_gateway_jobs(
        credential_id,channel,operation,environment,request_payload,status,seller_account_key
      ) values(v_credential.id,p_channel,p_operation,v_credential.environment,p_request_payload,'queued',v_credential.seller_account_key)
      returning id into v_id;
      return jsonb_build_object('status','queued','jobId',v_id);
    end$$;
  `);
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
    ["worker-hash", job.id, claim, JSON.stringify(step.data),
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
    const scope = await db.query(`select initial_completed_at from sellerpilot_private.ebay_case_dispute_collection_scopes
      where credential_id=$1 and resource_kind='resolution_case'`, [credential]);
    assert.equal(scope.rows[0].initial_completed_at, null);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("recording rejects wrong job binding, seller, credential, lease, parent, and orphan child", async () => {
  const cases = ["kind", "resource", "anchor", "seller", "credential", "lease", "parent", "orphan"];
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
      if (scenario === "seller") await db.query("update sellerpilot_private.channel_gateway_jobs set seller_account_key=$2 where id=$1", [job.id, "b".repeat(64)]);
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
