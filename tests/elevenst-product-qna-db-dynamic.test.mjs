import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908049000_enable_elevenst_product_qna_cs.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000008801";
const credential = "00000000-0000-4000-8000-000000008802";
const sellerAccountKey = "e".repeat(64);
const digest = value => createHash("sha256").update(value).digest("hex");

function segment(start, end) {
  const first = migration.indexOf(start);
  const last = migration.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `migration segment ${start}`);
  return migration.slice(first, last);
}

function inquiryRow(overrides = {}) {
  const brdInfoNo = "81234567";
  const prdNo = "13749310594";
  const externalTicketId = `elevenst:${brdInfoNo}`;
  const remoteMessageId = `qna:${brdInfoNo}:question`;
  return {
    externalTicketId,
    customerName: "11번가 고객",
    subject: "배송 문의",
    message: "언제 출고되나요?",
    status: "waiting",
    providerStatus: "waiting",
    priority: 2,
    receivedAt: "2026-09-08T01:00:00.000Z",
    remoteMessageId,
    senderRole: "customer",
    inboundKey: `elevenst:${digest(`v2\u001felevenst\u001f${externalTicketId}\u001f${remoteMessageId}`)}`,
    ticketKind: "conversation",
    providerContext: {
      kind: "product_qna", brdInfoNo, prdNo, qnaTypeCode: "02", qnaType: "배송",
      buyYn: "Y", dispYn: "Y", answerYn: "N", answerDate: "", orderNo: "",
      orderPaymentDate: "", unsequencedAnswers: [],
    },
    replyContext: { brdInfoNo, prdNo },
    ...overrides,
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create schema sellerpilot_private;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable
      as $$select sha256(convert_to(value,'UTF8'))$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,created_by uuid,status text,
      seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz,
      expires_at timestamptz,version integer default 1,created_at timestamptz default now()
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key default gen_random_uuid(),owner_id uuid,external_ticket_id text,channel_key text,
      customer_name text,subject text,message text,status text,priority integer,received_at timestamptz,
      resolved_at timestamptz,demo boolean default false,updated_at timestamptz default now(),source_credential_id uuid,
      seller_account_key text,reply_context jsonb default '{}'::jsonb,provider_status text default 'unknown',
      provider_status_updated_at timestamptz,latest_inbound_key text,provider_context jsonb default '{}'::jsonb,
      reply_draft text,reply_delivery_status text default 'never',reply_delivery_error text,
      reply_gateway_job_id uuid,reply_operation_attempt_id uuid,
      unique(owner_id,channel_key,external_ticket_id)
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,
      inbound_key text,remote_message_id text,sender_role text,body text,provider_context jsonb,
      received_at timestamptz,updated_at timestamptz default now(),unique(owner_id,channel_key,inbound_key)
    );
    create table sellerpilot_private.support_reply_attempts(
      id uuid primary key default gen_random_uuid(),ticket_id uuid,status text,reply_fingerprint text,
      created_at timestamptz default now()
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),credential_id uuid,attempt_id uuid,channel text,
      operation text,environment text,request_payload jsonb,status text default 'queued',
      response_payload jsonb default '{}'::jsonb,created_by uuid,seller_account_key text,
      created_at timestamptz default now()
    );
    create table sellerpilot_private.serverless_static_egress_policy(channel text primary key,enabled boolean);
    create function sellerpilot_private.serverless_gateway_job_allowed(text,text) returns boolean
      language sql immutable as $$select false$$;
    create function public.sellerpilot_service_ingest_inquiries(p_credential_id uuid,p_channel text,p_inquiries jsonb)
      returns integer language plpgsql security definer set search_path='' as $$
      declare v_owner uuid;v_seller text;v_item jsonb;v_ticket uuid;
      begin
        select created_by,seller_account_key into strict v_owner,v_seller
          from sellerpilot_private.channel_credentials where id=p_credential_id;
        for v_item in select value from jsonb_array_elements(p_inquiries) item(value) loop
          insert into sellerpilot_private.support_tickets(
            owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,priority,
            received_at,source_credential_id,seller_account_key,reply_context,provider_status,
            latest_inbound_key,provider_context
          ) values (
            v_owner,v_item->>'externalTicketId',p_channel,v_item->>'customerName',v_item->>'subject',
            v_item->>'message',v_item->>'status',(v_item->>'priority')::integer,
            (v_item->>'receivedAt')::timestamptz,p_credential_id,v_seller,v_item->'replyContext',
            v_item->>'providerStatus',v_item->>'inboundKey',v_item->'providerContext'
          ) on conflict(owner_id,channel_key,external_ticket_id) do update set
            latest_inbound_key=excluded.latest_inbound_key,provider_context=excluded.provider_context,
            reply_context=excluded.reply_context,provider_status=excluded.provider_status,status=excluded.status
          returning id into v_ticket;
          insert into sellerpilot_private.support_inbound_messages(
            ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,provider_context,received_at
          ) values (
            v_ticket,v_owner,p_channel,v_item->>'inboundKey',v_item->>'remoteMessageId',
            v_item->>'senderRole',v_item->>'message',v_item->'providerContext',(v_item->>'receivedAt')::timestamptz
          ) on conflict(owner_id,channel_key,inbound_key) do nothing;
        end loop;
        return jsonb_array_length(p_inquiries);
      end$$;
    create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb) returns uuid
      language sql security definer set search_path='' as $$select gen_random_uuid()$$;
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','elevenst','production','${owner}','active','${sellerAccountKey}',
      'credential_incarnation_v1',now(),now()+interval '30 days',1,now()
    );
    insert into sellerpilot_private.serverless_static_egress_policy values('elevenst',true);
  `);
  await db.exec(segment(
    "alter function sellerpilot_private.serverless_gateway_job_allowed(text,text)",
    "alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)",
  ));
  await db.exec(segment(
    "alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)",
    "alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)",
  ));
  await db.exec(segment(
    "alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)",
    "alter function sellerpilot_private.enqueue_inquiry_history_backfill_item(uuid,text,text,jsonb)",
  ));
  return db;
}

test("11st normalized Q&A persists with exact account and reply lineage", async () => {
  const db = await fixture();
  try {
    const row = inquiryRow();
    assert.equal((await db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'elevenst',$2::jsonb) result",
      [credential, JSON.stringify([row])],
    )).rows[0].result, 1);
    const ticket = (await db.query(
      "select * from sellerpilot_private.support_tickets where channel_key='elevenst'",
    )).rows[0];
    assert.equal(ticket.source_credential_id, credential);
    assert.equal(ticket.seller_account_key, sellerAccountKey);
    assert.deepEqual(ticket.reply_context, { brdInfoNo: "81234567", prdNo: "13749310594" });
    const request = {
      sellerpilotExpectedInboundKey: row.inboundKey,
      arguments: { brdInfoNo: "81234567", prdNo: "13749310594", reply: "오늘 출고합니다." },
    };
    const first = (await db.query(
      "select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1,'elevenst','오늘 출고합니다.',$2::jsonb) id",
      [ticket.id, JSON.stringify(request)],
    )).rows[0].id;
    const second = (await db.query(
      "select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1,'elevenst','오늘 출고합니다.',$2::jsonb) id",
      [ticket.id, JSON.stringify(request)],
    )).rows[0].id;
    assert.equal(second, first);
    const job = (await db.query("select * from sellerpilot_private.channel_gateway_jobs where id=$1", [first])).rows[0];
    assert.equal(job.channel, "elevenst");
    assert.equal(job.operation, "inquiries.reply");
    assert.equal(job.seller_account_key, sellerAccountKey);
    assert.deepEqual(job.request_payload.arguments, request.arguments);
    assert.equal((await db.query(
      "select sellerpilot_private.serverless_gateway_job_allowed('elevenst','inquiries.list') ok",
    )).rows[0].ok, true);
    assert.equal((await db.query(
      "select sellerpilot_private.serverless_gateway_job_allowed('elevenst','inquiries.reply') ok",
    )).rows[0].ok, true);
  } finally { await db.close(); }
});

test("11st ingestion and replies reject injected provider identity, wrong product and disabled egress", async () => {
  const db = await fixture();
  try {
    await db.exec(`update sellerpilot_private.channel_credentials
      set seller_account_key_source='legacy_unattested' where id='${credential}'`);
    await assert.rejects(db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'elevenst',$2::jsonb)",
      [credential, JSON.stringify([inquiryRow()])],
    ), /INQUIRY_SELLER_LINEAGE_UNATTESTED/);
    await db.exec(`update sellerpilot_private.channel_credentials
      set seller_account_key_source='credential_incarnation_v1' where id='${credential}'`);
    const invalid = inquiryRow();
    invalid.providerContext = { ...invalid.providerContext, memID: "must-not-persist" };
    await assert.rejects(db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'elevenst',$2::jsonb)",
      [credential, JSON.stringify([invalid])],
    ), /ELEVENST_PRODUCT_QNA_CONTEXT_INVALID/);
    const row = inquiryRow();
    await db.query("select public.sellerpilot_service_ingest_inquiries($1,'elevenst',$2::jsonb)", [credential, JSON.stringify([row])]);
    const ticketId = (await db.query("select id from sellerpilot_private.support_tickets")).rows[0].id;
    await assert.rejects(db.query(
      "select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1,'elevenst','답변',$2::jsonb)",
      [ticketId, JSON.stringify({ sellerpilotExpectedInboundKey: row.inboundKey, arguments: {
        brdInfoNo: "81234567", prdNo: "13749310595", reply: "답변",
      } })],
    ), /context mismatch/);
    await db.exec("update sellerpilot_private.serverless_static_egress_policy set enabled=false where channel='elevenst'");
    await assert.rejects(db.query(
      "select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1,'elevenst','답변',$2::jsonb)",
      [ticketId, JSON.stringify({ sellerpilotExpectedInboundKey: row.inboundKey, arguments: {
        brdInfoNo: "81234567", prdNo: "13749310594", reply: "답변",
      } })],
    ), /STATIC_EGRESS_REQUIRED/);
  } finally { await db.close(); }
});
