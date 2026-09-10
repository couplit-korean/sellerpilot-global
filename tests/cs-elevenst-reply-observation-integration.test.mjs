import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync.ts";
import { inquiryReplyObservations } from "../lib/channels/reply-verification.ts";

const sourceMigration = await readFile(new URL(
  "../supabase/migrations/20260907232000_add_cs_reply_remote_observation.sql",
  import.meta.url,
), "utf8");
const observationFunctionSql = await readFile(new URL(
  "../supabase/migrations/20260909112157_cs_elevenst_exact_reply_observation.sql",
  import.meta.url,
), "utf8");

const ownerA = "00000000-0000-4000-8000-000000006001";
const ownerB = "00000000-0000-4000-8000-000000006002";
const credentialA = "00000000-0000-4000-8000-000000006011";
const credentialB = "00000000-0000-4000-8000-000000006012";
const ticketA = "00000000-0000-4000-8000-000000006021";
const ticketB = "00000000-0000-4000-8000-000000006022";
const jobA = "00000000-0000-4000-8000-000000006031";
const deliveryA = "00000000-0000-4000-8000-000000006041";
const inboundA = `elevenst:${"a".repeat(64)}`;
const answer = "확인 후 오늘 출고하겠습니다.";
const fingerprint = (value) => createHash("sha256").update(value.trim()).digest("hex");

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values ('${ownerA}'),('${ownerB}');
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer
      set search_path='' as $$select auth.uid() in ('${ownerA}'::uuid,'${ownerB}'::uuid)$$;
    create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, created_by uuid, channel text, status text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, credential_id uuid, channel text, operation text, status text,
      request_payload jsonb, response_payload jsonb, provider_mutation_started_at timestamptz
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key, owner_id uuid, channel_key text, source_credential_id uuid,
      demo boolean default false, external_ticket_id text, external_order_reference text,
      reply_context jsonb default '{}', latest_inbound_key text, status text default 'waiting',
      provider_status text default 'waiting', provider_status_updated_at timestamptz,
      reply_delivery_status text default 'never', reply_delivery_error text,
      resolved_at timestamptz, last_delivery_job_id uuid, updated_at timestamptz default now()
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(), ticket_id uuid, owner_id uuid,
      channel_key text, inbound_key text, remote_message_id text, sender_role text,
      body text, provider_context jsonb default '{}', received_at timestamptz,
      created_at timestamptz default now(), updated_at timestamptz default now(),
      unique(owner_id,channel_key,inbound_key)
    );
    create table sellerpilot_private.support_reply_deliveries(
      id uuid primary key, ticket_id uuid, owner_id uuid, gateway_job_id uuid,
      channel_key text, status text, reply_fingerprint text,
      provider_request_id text, provider_message_id text, safe_message text,
      reconciliation_reason text, acknowledged_at timestamptz, acknowledged_by uuid,
      acknowledgement_reason text, queued_at timestamptz, started_at timestamptz,
      completed_at timestamptz, created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    insert into sellerpilot_private.channel_credentials values
      ('${credentialA}','${ownerA}','elevenst','active'),
      ('${credentialB}','${ownerB}','elevenst','active');
    insert into sellerpilot_private.support_tickets(
      id,owner_id,channel_key,source_credential_id,external_ticket_id,reply_context,
      latest_inbound_key,last_delivery_job_id
    ) values
      ('${ticketA}','${ownerA}','elevenst','${credentialA}','elevenst:81234567',
       '{"brdInfoNo":"81234567","prdNo":"13749310594"}','${inboundA}','${jobA}'),
      ('${ticketB}','${ownerB}','elevenst','${credentialB}','elevenst:81234567',
       '{"brdInfoNo":"81234567","prdNo":"13749310594"}',
       'elevenst:${"b".repeat(64)}',null);
    insert into sellerpilot_private.channel_gateway_jobs values(
      '${jobA}','${credentialA}','elevenst','inquiries.reply','succeeded',
      '{"sellerpilotTicketId":"${ticketA}","sellerpilotInboundKey":"${inboundA}","arguments":{"brdInfoNo":"81234567","prdNo":"13749310594","reply":"${answer}"}}',
      '{"ok":true}',now()-interval '2 minutes'
    );
    insert into sellerpilot_private.support_reply_deliveries(
      id,ticket_id,owner_id,gateway_job_id,channel_key,status,reply_fingerprint,queued_at,completed_at
    ) values(
      '${deliveryA}','${ticketA}','${ownerA}','${jobA}','elevenst','succeeded',
      '${fingerprint(answer)}',now()-interval '2 minutes',now()-interval '119 seconds'
    );
  `);
  await db.exec(sourceMigration);
  await db.exec(observationFunctionSql);
  return db;
}

function observation(overrides = {}) {
  return [{
    contract: "sellerpilot-reply-observation/1",
    externalTicketId: "elevenst:81234567",
    inboundKey: `elevenst:${"c".repeat(64)}`,
    remoteMessageId: "qna:81234567:answer:20260909102030",
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    body: answer,
    replyFingerprint: fingerprint(answer),
    binding: { kind: "product_qna", brdInfoNo: "81234567", prdNo: "13749310594" },
    ...overrides,
  }];
}

async function observe(db, credential = credentialA, value = observation()) {
  return (await db.query(
    "select public.sellerpilot_service_observe_inquiry_replies_v1($1,'elevenst',$2) result",
    [credential, JSON.stringify(value)],
  )).rows[0].result;
}

async function verificationStatus(db) {
  return (await db.query(
    "select verification_status from sellerpilot_private.support_reply_deliveries where id=$1",
    [deliveryA],
  )).rows[0].verification_status;
}

test("exact 11st board, product, job generation and reply fingerprint become remote-observed", async () => {
  const db = await fixture();
  try {
    assert.deepEqual(await observe(db), {
      contract: "sellerpilot-reply-observation-result/1",
      received: 1,
      stored: 1,
      matched: 1,
      unmatched: 0,
      ambiguous: 0,
    });
    assert.equal(await verificationStatus(db), "remote_observed");
    const row = (await db.query(
      "select provider_message_id,verification_contract from sellerpilot_private.support_reply_deliveries where id=$1",
      [deliveryA],
    )).rows[0];
    assert.deepEqual(row, {
      provider_message_id: "qna:81234567:answer:20260909102030",
      verification_contract: "sellerpilot-reply-observation/1",
    });
  } finally {
    await db.close();
  }
});

const mismatchCases = [
  {name: "wrong reply job credential",prepare: db => db.exec(`update sellerpilot_private.channel_gateway_jobs set credential_id='${credentialB}' where id='${jobA}'`)},
  {name: "wrong observation kind",value: observation({binding:{kind:"urgent_alimi",brdInfoNo:"81234567",prdNo:"13749310594"}})},
  {
    name: "wrong job binding",
    prepare: (db) => db.exec(`update sellerpilot_private.channel_gateway_jobs set
      request_payload=jsonb_set(request_payload,'{sellerpilotTicketId}','"00000000-0000-4000-8000-000000006099"')`),
  },
  {
    name: "wrong owner",
    prepare: (db) => db.exec(`update sellerpilot_private.support_tickets set owner_id='${ownerB}' where id='${ticketA}'`),
  },
  {
    name: "wrong credential",
    credential: credentialB,
  },
  {
    name: "wrong question generation hash",
    prepare: (db) => db.exec(`update sellerpilot_private.channel_gateway_jobs set
      request_payload=jsonb_set(request_payload,'{sellerpilotInboundKey}','"elevenst:${"d".repeat(64)}"')`),
  },
  {
    name: "wrong reply hash",
    prepare: (db) => db.exec(`update sellerpilot_private.support_reply_deliveries set
      reply_fingerprint='${fingerprint("different answer")}' where id='${deliveryA}'`),
  },
  {
    name: "wrong product binding",
    value: observation({
      inboundKey: `elevenst:${"e".repeat(64)}`,
      binding: { kind: "product_qna", brdInfoNo: "81234567", prdNo: "99999999" },
    }),
  },
];

for (const mismatch of mismatchCases) {
  test(`11st reply observation rejects ${mismatch.name}`, async () => {
    const db = await fixture();
    try {
      await mismatch.prepare?.(db);
      const result = await observe(db, mismatch.credential, mismatch.value);
      assert.equal(result.matched, 0);
      assert.equal(result.unmatched, 1);
      assert.equal(await verificationStatus(db), "provider_accepted");
    } finally {
      await db.close();
    }
  });
}

test("11st observation SECURITY DEFINER RPC remains service-role only", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)','EXECUTE') allowed",
        [role],
      )).rows[0].allowed, false);
    }
    assert.equal((await db.query(
      "select has_function_privilege('service_role','public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)','EXECUTE') allowed",
    )).rows[0].allowed, true);
  } finally {
    await db.close();
  }
});


test("actual Elevenst normalizer and observation contract reach canonical RPC; date-only answers remain unverified", async () => {
  const db = await fixture();
  try {
    const korea = new Date(Date.now() - 60_000 + 9 * 3_600_000).toISOString().slice(0,19).replace("T"," ");
    const row = {answerCont:answer,answerDt:korea,answerYn:"Y",brdInfoClfNo:"13749310594",
      brdInfoCont:"배송 문의",brdInfoNo:"81234567",brdInfoSbjct:"배송 문의",buyYn:"Y",
      createDt:korea,dispYn:"Y",qnaDtlsCd:"02"};
    const result = answerDt => ({ok:true,channel:"elevenst",operation:"inquiries.list",safeMessage:"fixture",
      steps:[{name:"inquiries",ok:true,status:200,data:{accepted:true,sellerpilotInquiryKind:"product_qna",
        sellerpilotElevenstProductQnaParseContract:"sellerpilot-elevenst-product-qna-parser/1",
        productQnas:[{...row,answerDt}]}}]});
    const dateOnly = inquiryReplyObservations("elevenst",normalizeChannelInquiries("elevenst",result(korea.slice(0,10)),new Date().toISOString()));
    assert.deepEqual(dateOnly,[]);
    const exact = inquiryReplyObservations("elevenst",normalizeChannelInquiries("elevenst",result(korea),new Date().toISOString()));
    assert.equal(exact.length,1);
    assert.equal((await observe(db,credentialA,exact)).matched,1);
    assert.equal(await verificationStatus(db),"remote_observed");
  } finally {await db.close();}
});
