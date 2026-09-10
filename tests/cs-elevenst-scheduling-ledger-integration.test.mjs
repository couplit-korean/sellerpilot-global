import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { executeChannelOperation } from "../lib/channels/operations.ts";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync.ts";
import { buildElevenstCsReadObservation } from "../lib/cs/channels/elevenst/read-observation.ts";

const identity = {
  contract: "sellerpilot-elevenst-cs-account-identity/1",
  credentialId: "33333333-3333-4333-8333-333333333333",
  sellerId: "couplit",
  sellerName: "커플릿",
  environment: "production",
  version: 1,
  verifiedAt: "2026-09-09T09:59:00.000Z",
};
import { registerHooks } from "node:module";
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return {shortCircuit:true,url:"data:text/javascript,export default {}"};
  return nextResolve(specifier,context);
}});
const schedule = await import("../lib/cs/operations/schedule.ts");
const coverage = await import("../lib/channels/inquiry-coverage.ts");
const sync = await import("../lib/channels/sync-arguments.ts");
const currentSchedulerEnqueues = (...args) => schedule.serverlessCsCurrentInquiryEnqueues(...args).filter(x => x.channel === "elevenst");
const repairSchedulerEnqueues = (...args) => schedule.serverlessCsRepairInquiryEnqueues(...args).filter(x => x.channel === "elevenst");
const inquiryHistorySyncRequests = (...args) => sync.inquiryHistorySyncRequests("elevenst",...args);
const inquiryCoverageEvidence = (...args) => coverage.inquiryCoverageEvidence("elevenst",...args);

const canonicalMigration = new URL(
  "../supabase/migrations/20260908140411_cs_elevenst_read_state_alimi_ledger.sql",
  import.meta.url,
);
const owner = "11111111-1111-4111-8111-111111111111";
const credential = "33333333-3333-4333-8333-333333333333";
const alternateCredential = "44444444-4444-4444-8444-444444444444";
const wrongChannelCredential = "55555555-5555-4555-8555-555555555555";
const sellerAccountKey = "a".repeat(64);

const validAlimiXml = `<?xml version="1.0" encoding="UTF-8"?>
<alimi><result_code>0</result_code><alimListInfo>
  <emerNtceSeq>5590778</emerNtceSeq><emerCtntSeq>1</emerCtntSeq>
  <emerTypeCd>01</emerTypeCd><emerNtceCrntCd>04</emerNtceCrntCd>
  <emerNtceClfNo1>10</emerNtceClfNo1><emerNtceSubject>배송 확인 요청</emerNtceSubject>
  <emerCtnt>확인이 필요합니다.</emerCtnt><createDt>20260908</createDt><createTm>12:30:30</createTm>
  <emerReplyDt>20260909</emerReplyDt><ordNo>202609080001</ordNo><ordPrdSeq>1</ordPrdSeq>
</alimListInfo></alimi>`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema extensions;
    create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable set search_path=''
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
      as $$select false$$;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable set search_path=''
      as $$select sha256(convert_to(value,'UTF8'))$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,created_by uuid,status text,
      seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz,
      expires_at timestamptz,version integer default 1,created_at timestamptz default now()
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key default gen_random_uuid(),owner_id uuid,external_ticket_id text,channel_key text,
      customer_name text,subject text,message text,status text,priority integer,received_at timestamptz,
      resolved_at timestamptz,demo boolean default false,updated_at timestamptz default now(),
      source_credential_id uuid,channel_account_id uuid,seller_account_key text,
      reply_context jsonb default '{}'::jsonb,provider_status text default 'unknown',
      provider_status_updated_at timestamptz,latest_inbound_key text,
      provider_context jsonb default '{}'::jsonb,external_order_reference text,
      ticket_kind text default 'conversation',unique(owner_id,channel_key,external_ticket_id)
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,
      inbound_key text,remote_message_id text,sender_role text,body text,provider_context jsonb,
      received_at timestamptz,updated_at timestamptz default now(),unique(owner_id,channel_key,inbound_key)
    );
    create function public.sellerpilot_service_ingest_inquiries(
      p_credential_id uuid,p_channel text,p_inquiries jsonb
    ) returns integer language plpgsql security definer set search_path='' as $$
    begin
      if false then raise exception 'ELEVENST_PRODUCT_QNA_CONTEXT_INVALID'; end if;
      return jsonb_array_length(p_inquiries);
    end$$;
    revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      from public,anon,authenticated,service_role;
    grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      to service_role;
    insert into sellerpilot_private.channel_credentials(
      id,channel,environment,created_by,status,seller_account_key,
      seller_account_key_source,seller_account_verified_at,expires_at,version,created_at
    ) values
      ('${credential}','elevenst','production','${owner}','active','${sellerAccountKey}',
       'credential_incarnation_v1',now(),now()+interval '30 days',2,now()-interval '1 minute'),
      ('${alternateCredential}','elevenst','production','${owner}','active','${"b".repeat(64)}',
       'credential_incarnation_v1',now(),now()+interval '30 days',1,now()-interval '2 minutes'),
      ('${wrongChannelCredential}','shopee','production','${owner}','active','${"c".repeat(64)}',
       'credential_incarnation_v1',now(),now()+interval '30 days',1,now()-interval '3 minutes');
  `);
  await db.exec(await readFile(canonicalMigration, "utf8"));
  return db;
}

async function asService(db, callback) {
  await db.exec("set role service_role");
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
  }
}

async function ingestAndRecord(db, credentialId, built) {
  return asService(db, async () => {
    if (built.observation.accepted) {
      await db.query(
        "select public.sellerpilot_service_ingest_inquiries($1,'elevenst',$2::jsonb)",
        [credentialId, JSON.stringify(built.inquiries)],
      );
    }
    return (await db.query(
      "select public.sellerpilot_service_record_elevenst_cs_read_v1($1,$2::jsonb,$3::jsonb) result",
      [credentialId, JSON.stringify(built.observation), JSON.stringify(built.inquiries)],
    )).rows[0].result;
  });
}

async function executeAlimi(arguments_, response) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    return await executeChannelOperation({
      channel: "elevenst",
      operation: "inquiries.list",
      payload: { api_key: "test-only-elevenst-key" },
      arguments: arguments_,
      environment: "production",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("CONT-03 current/history scheduler drives a successful Alimi read through coverage and ledger", async () => {
  const now = new Date("2026-09-09T10:00:00.000Z");
  assert.deepEqual(currentSchedulerEnqueues(now, []), []);
  const current = currentSchedulerEnqueues(now, ["elevenst"]);
  assert.equal(current.length, 2);
  assert.deepEqual(current.map((item) => item.payload.periodicKey), [
    "inquiries:product_qna:all",
    "inquiries:urgent_alimi:all",
  ]);
  const urgent = current[1].payload;
  assert.deepEqual(urgent.arguments, {
    kind: "urgent_alimi",
    startDate: "20260811",
    endDate: "20260909",
  });

  const history = repairSchedulerEnqueues(now, ["elevenst"]);
  assert.equal(history.length, 6);
  assert.equal(history.filter((item) => item.payload.arguments.kind === "product_qna").length, 5);
  assert.deepEqual(history.at(-1).payload, {
    periodicKey: "inquiries:history:2026-08-11:2026-09-09:urgent_alimi:all",
    arguments: urgent.arguments,
  });
  assert.deepEqual(repairSchedulerEnqueues(new Date("2026-09-09T10:05:00.000Z"), ["elevenst"]), []);

  const operation = await executeAlimi(
    urgent.arguments,
    new Response(validAlimiXml, { status: 200, headers: { "content-type": "application/xml" } }),
  );
  const inquiries = normalizeChannelInquiries("elevenst", operation, "2026-09-09T10:00:30.000Z");
  const coverage = inquiryCoverageEvidence(operation, inquiries);
  assert.equal(coverage.providerRowCount, 1);
  assert.equal(coverage.projectedEventCount, 1);
  assert.equal(coverage.observationDigests.length, 1);
  const built = buildElevenstCsReadObservation({
    identity,
    result: operation,
    arguments: urgent.arguments,
    checkedAt: "2026-09-09T10:00:30.000Z",
    normalizedInquiries: inquiries,
  });
  assert.equal(built.observation.accepted, true);

  const db = await fixture();
  try {
    const recorded = await ingestAndRecord(db, credential, built);
    assert.deepEqual(
      { accepted: recorded.accepted, providerRows: recorded.providerRows, storedRows: recorded.storedRows },
      { accepted: true, providerRows: 1, storedRows: 1 },
    );
    const ticket = (await db.query(`select owner_id::text,source_credential_id::text,
      seller_account_key,provider_context->>'kind' kind
      from sellerpilot_private.support_tickets where external_ticket_id='elevenst:alimi:5590778'`)).rows[0];
    assert.deepEqual(ticket, {
      owner_id: owner,
      source_credential_id: credential,
      seller_account_key: sellerAccountKey,
      kind: "urgent_inquiry",
    });
    await assert.rejects(
      ingestAndRecord(db, alternateCredential, built),
      /ELEVENST_ALIMI_ACCOUNT_BOUNDARY_MISMATCH/u,
    );
    await assert.rejects(
      ingestAndRecord(db, wrongChannelCredential, built),
      /ELEVENST_ALIMI_ACTIVE_LINEAGE_REQUIRED/u,
    );
  } finally {
    await db.close();
  }
});

test("CONT-03 history bounds and failed provider reads remain fail-closed and observable", async () => {
  const now = new Date("2026-09-09T10:00:00.000Z");
  assert.equal(inquiryHistorySyncRequests(now, 7).length, 2);
  assert.equal(inquiryHistorySyncRequests(now, 30).length, 6);
  for (const days of [6, 31, 30.5]) {
    assert.throws(() => inquiryHistorySyncRequests(now, days), /INQUIRY_HISTORY_RANGE_INVALID/u);
  }
  await assert.rejects(
    executeAlimi(
      { kind: "urgent_alimi", startDate: "20260810", endDate: "20260909" },
      new Response(validAlimiXml, { status: 200 }),
    ),
    /ELEVENST_ALIMI_RANGE_INVALID/u,
  );

  const arguments_ = repairSchedulerEnqueues(now, ["elevenst"]).at(-1).payload.arguments;
  const failed = await executeAlimi(
    arguments_,
    new Response("<alimi/>", { status: 503, headers: { "content-type": "application/xml" } }),
  );
  assert.equal(failed.ok, false);
  assert.throws(
    () => normalizeChannelInquiries("elevenst", failed, "2026-09-09T10:01:00.000Z"),
    /INQUIRY_RESULT_INVALID:elevenst/u,
  );
  assert.throws(() => inquiryCoverageEvidence(failed, []), /INQUIRY_COVERAGE_RESULT_INVALID/u);
  const built = buildElevenstCsReadObservation({
    identity,
    result: failed,
    arguments: arguments_,
    checkedAt: "2026-09-09T10:01:00.000Z",
    normalizedInquiries: [],
  });
  assert.equal(built.observation.accepted, false);
  assert.equal(built.observation.providerRows, 0);

  const db = await fixture();
  try {
    const recorded = await ingestAndRecord(db, credential, built);
    assert.equal(recorded.accepted, false);
    assert.equal(recorded.providerRows, 0);
    assert.equal((await db.query(`select count(*)::int count
      from sellerpilot_private.support_tickets`)).rows[0].count, 0);
    assert.equal((await db.query(`select count(*)::int count
      from sellerpilot_private.elevenst_cs_read_observations
      where surface='urgent_alimi' and not accepted`)).rows[0].count, 1);
  } finally {
    await db.close();
  }
});
