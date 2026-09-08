import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  ebayCaseDisputeGatewayPlan,
  ebayCaseDisputeNativeIdDigest,
} from "../lib/channels/cs/ebay/case-dispute-gateway.ts";

const ledgerSql = await readFile(
  process.env.SELLERPILOT_EBAY_HISTORY_LEDGER_SQL ?? new URL(
    "../docs/cs-parallel/proposals/ebay/ebay-case-dispute-history-ledger.sql",
    import.meta.url,
  ),
  "utf8",
);
const collectionSql = await readFile(new URL(
  "../docs/cs-parallel/proposals/ebay/ebay-case-dispute-durable-collection.sql",
  import.meta.url,
), "utf8");

const owner = "41000000-0000-4000-8000-000000000001";
const credential = "51000000-0000-4000-8000-000000000001";
const tokenId = "61000000-0000-4000-8000-000000000001";
const claimToken = "71000000-0000-4000-8000-000000000001";
const sellerKey = "a".repeat(64);

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
      if v_id is not null then
        return jsonb_build_object('status','already_pending','jobId',v_id);
      end if;
      insert into sellerpilot_private.channel_gateway_jobs(
        credential_id,channel,operation,environment,request_payload,status,seller_account_key
      ) values(
        v_credential.id,p_channel,p_operation,v_credential.environment,p_request_payload,'queued',v_credential.seller_account_key
      ) returning id into v_id;
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

test("durable scheduler enqueues one initial lineage plus payment and defers overlap until backfill completion", async () => {
  const db = await database();
  try {
    const plan = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z"));
    await assert.rejects(serviceRpc(db,
      "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1($1::jsonb) result",
      [JSON.stringify({ ...plan, jobs: [plan.jobs[0], plan.jobs[0], plan.jobs[2]] })],
    ), /EBAY_CASE_DISPUTE_COLLECTION_JOB_SET_INVALID/);
    await assert.rejects(serviceRpc(db,
      "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1($1::jsonb) result",
      [JSON.stringify({ ...plan, jobs: [{ ...plan.jobs[0], periodicKey: "ebay-cdh:i:wrong" }, ...plan.jobs.slice(1)] })],
    ), /EBAY_CASE_DISPUTE_COLLECTION_JOB_INVALID|EBAY_CASE_DISPUTE_COLLECTION_PERIODIC_KEY_INVALID/);
    const first = await serviceRpc(db,
      "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1($1::jsonb) result",
      [JSON.stringify(plan)],
    );
    assert.deepEqual({ attempted: first.attempted, queued: first.queued, pending: first.pending,
      scopeBlocked: first.scopeBlocked, deferred: first.deferred },
    { attempted: 3, queued: 2, pending: 0, scopeBlocked: 0, deferred: 1 });
    const jobs = await db.query("select request_payload#>>'{arguments,collectionKind}' kind from sellerpilot_private.channel_gateway_jobs order by kind");
    assert.deepEqual(jobs.rows.map(row => row.kind), ["initial_backfill", "periodic_summary"]);

    const second = await serviceRpc(db,
      "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1($1::jsonb) result",
      [JSON.stringify(plan)],
    );
    assert.deepEqual({ queued: second.queued, pending: second.pending, deferred: second.deferred },
      { queued: 0, pending: 1, deferred: 2 });

    const root = (await db.query(
      "select id,request_payload from sellerpilot_private.channel_gateway_jobs where request_payload#>>'{arguments,collectionKind}'='initial_backfill'",
    )).rows[0];
    const finalWindow = plan.jobs[0].arguments.windowQueue.at(-1);
    const finalArguments = {
      ...plan.jobs[0].arguments,
      startTime: finalWindow.startTime,
      endTime: finalWindow.endTime,
      windowQueue: [],
      pageNumber: 1,
    };
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      credential_id,channel,operation,environment,request_payload,response_payload,status,seller_account_key,completed_at
    ) values($1,'ebay','inquiries.list','production',$2::jsonb,$3::jsonb,'succeeded',$4,now())`, [
      credential,
      JSON.stringify({ periodicKey: root.request_payload.periodicKey, continuationOf: root.id, arguments: finalArguments }),
      JSON.stringify({ ok: true, operation: "inquiries.list" }),
      sellerKey,
    ]);
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='succeeded',response_payload=$2::jsonb where id=$1", [
      root.id, JSON.stringify({ ok: true, operation: "inquiries.list", continuation: { arguments: finalArguments } }),
    ]);
    const nextPlan = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T14:00:00.000Z"));
    const afterCompletion = await serviceRpc(db,
      "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1($1::jsonb) result",
      [JSON.stringify(nextPlan)],
    );
    assert.equal(afterCompletion.queued, 2, "recent overlap and the next payment summary are queued");
    assert.equal(afterCompletion.deferred, 1, "the completed initial backfill is not recreated");
    const completed = await db.query("select initial_completed_at is not null completed from sellerpilot_private.ebay_case_dispute_collection_scopes where credential_id=$1 and resource_kind='resolution_case'", [credential]);
    assert.equal(completed.rows[0].completed, true);
  } finally {
    await db.close();
  }
});

test("claim-fenced readable page is idempotent and rejects a duplicate native ID on another continuation page", async () => {
  const db = await database();
  try {
    const plan = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z"));
    await serviceRpc(db,
      "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1($1::jsonb) result",
      [JSON.stringify(plan)],
    );
    const payment = (await db.query("select id,request_payload from sellerpilot_private.channel_gateway_jobs where request_payload#>>'{arguments,resourceKind}'='payment_dispute'")).rows[0];
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$2,claim_token=$3,lease_expires_at=now()+interval '5 minutes' where id=$1", [payment.id, tokenId, claimToken]);
    const page = {
      contract: "sellerpilot-ebay-case-dispute-gateway-page/1",
      resourceKind: "payment_dispute",
      collectionKind: "periodic_summary",
      page: {
        availability: "readable", httpStatus: 200, total: 1, offset: 0, nextOffset: null,
        entries: [{
          paymentDisputeId: "db-dispute-1", orderId: "db-order-1", status: "ACTION_NEEDED",
          reason: "ITEM_NOT_RECOGNIZED", openDate: "2026-09-01T00:00:00.000Z",
          respondByDate: null, closedDate: null, amount: { value: "10.00", currency: "USD" },
        }],
      },
    };
    const pageWithoutTotal = Object.fromEntries(
      Object.entries(page.page).filter(([key]) => key !== "total"),
    );
    await assert.rejects(serviceRpc(db,
      "select public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1($1,$2,$3,$4::jsonb) result",
      ["worker-hash", payment.id, claimToken, JSON.stringify({ ...page, page: pageWithoutTotal })],
    ), /EBAY_CASE_DISPUTE_GATEWAY_PAGE_SHAPE_INVALID/);
    const first = await serviceRpc(db,
      "select public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1($1,$2,$3,$4::jsonb) result",
      ["worker-hash", payment.id, claimToken, JSON.stringify(page)],
    );
    assert.equal(first.status, "recorded");
    assert.equal(first.insertedCount, 1);
    const seen = await db.query("select native_id_sha256 from sellerpilot_private.ebay_case_dispute_collection_seen");
    assert.equal(seen.rows[0].native_id_sha256,
      ebayCaseDisputeNativeIdDigest(sellerKey, "payment_dispute", "db-dispute-1"));
    const replay = await serviceRpc(db,
      "select public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1($1,$2,$3,$4::jsonb) result",
      ["worker-hash", payment.id, claimToken, JSON.stringify(page)],
    );
    assert.equal(replay.insertedCount, 0);

    const continuationId = "81000000-0000-4000-8000-000000000001";
    const continuationClaim = "91000000-0000-4000-8000-000000000001";
    const continuationArguments = { ...payment.request_payload.arguments, pageNumber: 2 };
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,status,worker_token_id,
      claim_token,lease_expires_at,seller_account_key
    ) values($1,$2,'ebay','inquiries.list','production',$3::jsonb,'running',$4,$5,now()+interval '5 minutes',$6)`, [
      continuationId, credential,
      JSON.stringify({ periodicKey: payment.request_payload.periodicKey, continuationOf: payment.id, arguments: continuationArguments }),
      tokenId, continuationClaim, sellerKey,
    ]);
    const duplicatePage = { ...page, page: { ...page.page, offset: 25 } };
    await assert.rejects(serviceRpc(db,
      "select public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1($1,$2,$3,$4::jsonb) result",
      ["worker-hash", continuationId, continuationClaim, JSON.stringify(duplicatePage)],
    ), /EBAY_CASE_DISPUTE_GATEWAY_DUPLICATE_NATIVE_ID/);
  } finally {
    await db.close();
  }
});

test("a resolution 403 cancels only untouched resolution jobs while payment remains active", async () => {
  const db = await database();
  try {
    const plan = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z"));
    await serviceRpc(db,
      "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1($1::jsonb) result",
      [JSON.stringify(plan)],
    );
    const resolution = (await db.query("select id,request_payload from sellerpilot_private.channel_gateway_jobs where request_payload#>>'{arguments,resourceKind}'='resolution_case'")).rows[0];
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$2,claim_token=$3,lease_expires_at=now()+interval '5 minutes' where id=$1", [resolution.id, tokenId, claimToken]);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      credential_id,channel,operation,environment,request_payload,status,seller_account_key
    ) values($1,'ebay','inquiries.list','production',$2::jsonb,'queued',$3)`, [
      credential,
      JSON.stringify({ ...resolution.request_payload, periodicKey: "ebay-cdh:r:20260908130000000",
        arguments: { ...plan.jobs[1].arguments } }), sellerKey,
    ]);
    const blockedPage = {
      contract: "sellerpilot-ebay-case-dispute-gateway-page/1",
      resourceKind: "resolution_case",
      collectionKind: "initial_backfill",
      page: {
        availability: "authorization_required", httpStatus: 403, entries: [], total: null,
        offset: 0, nextOffset: null,
        startTime: resolution.request_payload.arguments.startTime,
        endTime: resolution.request_payload.arguments.endTime,
      },
    };
    const blocked = await serviceRpc(db,
      "select public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1($1,$2,$3,$4::jsonb) result",
      ["worker-hash", resolution.id, claimToken, JSON.stringify(blockedPage)],
    );
    assert.equal(blocked.status, "authorization_blocked");
    const statuses = await db.query("select request_payload#>>'{arguments,resourceKind}' resource,status from sellerpilot_private.channel_gateway_jobs order by resource,status");
    assert.ok(statuses.rows.some(row => row.resource === "resolution_case" && row.status === "cancelled"));
    assert.ok(statuses.rows.some(row => row.resource === "payment_dispute" && row.status === "queued"));
    const scopes = await db.query("select resource_kind,availability from sellerpilot_private.ebay_case_dispute_collection_scopes order by resource_kind");
    assert.deepEqual(scopes.rows, [
      { resource_kind: "payment_dispute", availability: "active" },
      { resource_kind: "resolution_case", availability: "authorization_required" },
    ]);
    const next = await serviceRpc(db,
      "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1($1::jsonb) result",
      [JSON.stringify(ebayCaseDisputeGatewayPlan(new Date("2026-09-08T14:00:00.000Z")))],
    );
    assert.equal(next.scopeBlocked, 2, "both resolution roots are suppressed by only the resolution scope");
    assert.equal(next.queued, 1, "the next payment summary remains schedulable");

    const rotatedSellerKey = "b".repeat(64);
    await db.query("update sellerpilot_private.channel_credentials set version=2,seller_account_key=$2,seller_account_verified_at=now() where id=$1", [credential, rotatedSellerKey]);
    const afterRotation = await serviceRpc(db,
      "select public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1($1::jsonb) result",
      [JSON.stringify(ebayCaseDisputeGatewayPlan(new Date("2026-09-08T15:00:00.000Z")))],
    );
    assert.equal(afterRotation.queued, 2, "credential version change starts a fresh initial lineage and payment scope");
    assert.equal(afterRotation.scopeBlocked, 0);
    const resetScope = await db.query("select availability,credential_version,seller_account_key from sellerpilot_private.ebay_case_dispute_collection_scopes where credential_id=$1 and resource_kind='resolution_case'", [credential]);
    assert.deepEqual(resetScope.rows[0], {
      availability: "active", credential_version: 2, seller_account_key: rotatedSellerKey,
    });
  } finally {
    await db.close();
  }
});

test("collection functions are service-role only and reject an unfenced claim", async () => {
  const db = await database();
  try {
    const privileges = await db.query(`select
      has_function_privilege('service_role','public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1(jsonb)','EXECUTE') service_enqueue,
      has_function_privilege('authenticated','public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1(jsonb)','EXECUTE') user_enqueue,
      has_function_privilege('service_role','public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1(text,uuid,uuid,jsonb)','EXECUTE') service_record,
      has_function_privilege('authenticated','public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1(text,uuid,uuid,jsonb)','EXECUTE') user_record`);
    assert.deepEqual(privileges.rows[0], {
      service_enqueue: true, user_enqueue: false, service_record: true, user_record: false,
    });
    await assert.rejects(serviceRpc(db,
      "select public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1($1,$2,$3,$4::jsonb) result",
      ["worker-hash", "11000000-0000-4000-8000-000000000001", claimToken, JSON.stringify({})],
    ));
  } finally {
    await db.close();
  }
});
