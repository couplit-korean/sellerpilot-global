import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../supabase/migrations/20260908044000_enable_ebay_commerce_message_cs.sql", import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000008301";
const credential = "00000000-0000-4000-8000-000000008302";
const sellerAccountKey = "a".repeat(64);
const oldReplyJob = "00000000-0000-4000-8000-000000008399";
const digest = value => createHash("sha256").update(value).digest("hex");

function conversationRow({
  conversationId = "conversation-native-1",
  messageId = "message-native-1",
  senderRole = "customer",
  receivedAt = "2026-09-08T01:00:00.000Z",
  message = "original customer text",
} = {}) {
  const conversationType = senderRole === "system" ? "FROM_EBAY" : "FROM_MEMBERS";
  const externalTicketId = `ebay:conversation:${digest(`ebay-conversation-v1\u001f${conversationId}`)}`;
  const remoteMessageId = `conversation:${digest(`ebay-conversation-message-v1\u001f${conversationId}\u001f${messageId}`)}`;
  const inboundKey = `ebay:${digest(`v2\u001febay\u001f${externalTicketId}\u001f${remoteMessageId}`)}`;
  const replySupported = senderRole === "customer";
  const providerContext = {
    kind: "conversation", conversationId, conversationType, conversationStatus: "ACTIVE",
    messageId, senderUsername: senderRole === "customer" ? "buyer" : senderRole === "seller" ? "seller" : "eBay",
    recipientUsername: senderRole === "customer" ? "seller" : senderRole === "seller" ? "buyer" : "seller",
    read: false, replySupported,
  };
  return {
    externalTicketId, customerName: "buyer", subject: "title", message,
    status: replySupported ? "waiting" : "resolved", priority: 3, receivedAt,
    remoteMessageId, senderRole, inboundKey,
    providerStatus: replySupported ? "waiting" : "answered",
    providerContext,
    replyContext: replySupported
      ? { kind: "conversation", conversationId, conversationType, messageId, replySupported: true }
      : providerContext,
    ticketKind: "conversation",
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable
      as $$select sha256(convert_to(value,'UTF8'))$$;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}');
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,created_by uuid,status text,
      seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz,
      expires_at timestamptz,version integer default 1,created_at timestamptz default now()
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key default gen_random_uuid(),owner_id uuid,external_ticket_id text,channel_key text,
      customer_name text,subject text,message text,status text,priority integer,received_at timestamptz,
      resolved_at timestamptz,demo boolean default false,updated_at timestamptz,source_credential_id uuid,
      seller_account_key text,reply_context jsonb default '{}'::jsonb,provider_status text default 'unknown',
      provider_status_updated_at timestamptz,latest_inbound_key text,provider_context jsonb default '{}'::jsonb,
      channel_account_id uuid,ticket_kind text default 'conversation',reply_draft text,
      reply_delivery_status text default 'never',reply_delivery_error text,reply_gateway_job_id uuid,
      reply_operation_attempt_id uuid,last_delivery_job_id uuid,
      unique(owner_id,channel_key,external_ticket_id)
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,
      inbound_key text,remote_message_id text,sender_role text,body text,provider_context jsonb,
      received_at timestamptz,updated_at timestamptz,unique(owner_id,channel_key,inbound_key)
    );
    create table sellerpilot_private.channel_sync_state(
      owner_id uuid,channel_key text,data_type text,status text,imported_count integer,last_started_at timestamptz,
      last_succeeded_at timestamptz,last_error text,updated_at timestamptz,unique(owner_id,channel_key,data_type)
    );
    create table sellerpilot_private.operation_audit(
      id uuid primary key default gen_random_uuid(),owner_id uuid,action text,entity_type text,safe_detail jsonb
    );
    create table sellerpilot_private.support_ticket_deletions(
      id uuid primary key default gen_random_uuid(),owner_id uuid,channel_key text,
      external_ticket_fingerprint text,deleted_through_at timestamptz
    );
    create table sellerpilot_private.support_message_deletions(
      deletion_id uuid,inbound_key_fingerprint text,remote_message_fingerprint text
    );
    create function sellerpilot_private.support_deletion_fingerprint(p_owner uuid,p_channel text,p_value text)
      returns text language sql immutable set search_path='' as $$
        select encode(extensions.digest(jsonb_build_array(p_owner,p_channel,p_value)::text,'sha256'),'hex')
      $$;
    create table sellerpilot_private.support_reply_attempts(
      id uuid primary key default gen_random_uuid(),ticket_id uuid,status text,reply_fingerprint text,created_at timestamptz default now()
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),credential_id uuid,attempt_id uuid,channel text,operation text,
      environment text,request_payload jsonb,status text default 'queued',response_payload jsonb default '{}'::jsonb,
      created_by uuid,seller_account_key text,created_at timestamptz default now()
    );
    create function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) returns integer
      language sql security definer set search_path='' as $$select 17$$;
    create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb) returns uuid
      language sql security definer set search_path='' as $$select '${oldReplyJob}'::uuid$$;
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','ebay','production','${owner}','active','${sellerAccountKey}',
      'provider_certified_v1',now(),now()+interval '30 days',1,now()
    );
  `);
  await db.exec(migration);
  return db;
}

test("Commerce Message ingestion preserves all roles, deterministic identity and current generation", async () => {
  const db = await fixture();
  try {
    const customer = conversationRow();
    assert.equal((await db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'ebay',$2::jsonb) result",
      [credential, JSON.stringify([customer])],
    )).rows[0].result, 1);
    await db.query("select public.sellerpilot_service_ingest_inquiries($1,'ebay',$2::jsonb)", [credential, JSON.stringify([customer])]);
    assert.equal((await db.query("select count(*)::int count from sellerpilot_private.support_inbound_messages")).rows[0].count, 1);

    const seller = conversationRow({ messageId: "message-native-2", senderRole: "seller", receivedAt: "2026-09-08T01:01:00Z", message: "seller answer" });
    await db.query("select public.sellerpilot_service_ingest_inquiries($1,'ebay',$2::jsonb)", [credential, JSON.stringify([seller])]);
    let ticket = (await db.query("select * from sellerpilot_private.support_tickets where external_ticket_id=$1", [customer.externalTicketId])).rows[0];
    assert.equal(ticket.status, "resolved");
    assert.equal(ticket.provider_status, "answered");
    assert.deepEqual(ticket.reply_context, {});

    const newest = conversationRow({ messageId: "message-native-3", receivedAt: "2026-09-08T01:02:00Z", message: "new customer question" });
    await db.query("select public.sellerpilot_service_ingest_inquiries($1,'ebay',$2::jsonb)", [credential, JSON.stringify([newest])]);
    ticket = (await db.query("select * from sellerpilot_private.support_tickets where external_ticket_id=$1", [customer.externalTicketId])).rows[0];
    assert.equal(ticket.status, "waiting");
    assert.equal(ticket.latest_inbound_key, newest.inboundKey);
    assert.equal(ticket.reply_context.messageId, "message-native-3");
    assert.deepEqual((await db.query(
      "select sender_role,body from sellerpilot_private.support_inbound_messages order by received_at",
    )).rows, [
      { sender_role: "customer", body: "original customer text" },
      { sender_role: "seller", body: "seller answer" },
      { sender_role: "customer", body: "new customer question" },
    ]);

    await assert.rejects(
      db.query("select public.sellerpilot_service_ingest_inquiries($1,'ebay',$2::jsonb)", [credential, JSON.stringify([{ ...newest, message: "changed" }])]),
      /EBAY_CONVERSATION_MESSAGE_CONFLICT/,
    );
    assert.equal((await db.query("select public.sellerpilot_service_ingest_inquiries($1,'qoo10','[]'::jsonb) result", [credential])).rows[0].result, 17);
  } finally { await db.close(); }
});

test("Commerce Message reply enqueue is bound to the latest customer message and deduplicated", async () => {
  const db = await fixture();
  try {
    const row = conversationRow();
    await db.query("select public.sellerpilot_service_ingest_inquiries($1,'ebay',$2::jsonb)", [credential, JSON.stringify([row])]);
    const ticketId = (await db.query("select id from sellerpilot_private.support_tickets where external_ticket_id=$1", [row.externalTicketId])).rows[0].id;
    const request = {
      arguments: { kind: "conversation", conversationId: "conversation-native-1", conversationType: "FROM_MEMBERS", reply: "safe reply" },
      sellerpilotExpectedInboundKey: row.inboundKey,
    };
    const first = (await db.query(
      "select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1,'ebay','safe reply',$2::jsonb) id",
      [ticketId, JSON.stringify(request)],
    )).rows[0].id;
    const second = (await db.query(
      "select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1,'ebay','safe reply',$2::jsonb) id",
      [ticketId, JSON.stringify(request)],
    )).rows[0].id;
    assert.equal(second, first);
    const job = (await db.query("select * from sellerpilot_private.channel_gateway_jobs where id=$1", [first])).rows[0];
    assert.deepEqual(job.request_payload.arguments, request.arguments);
    assert.equal(job.request_payload.sellerpilotInboundKey, row.inboundKey);
    assert.equal(job.seller_account_key, sellerAccountKey);
    await assert.rejects(
      db.query("select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1,'ebay','other',$2::jsonb)", [ticketId, JSON.stringify({ ...request, arguments: { ...request.arguments, reply: "other" } })]),
      /INQUIRY_REPLY_CONFLICT/,
    );
    assert.equal((await db.query(
      "select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1,'ebay','legacy',$2::jsonb) id",
      [ticketId, JSON.stringify({ arguments: { reply: "legacy" } })],
    )).rows[0].id, oldReplyJob);
  } finally { await db.close(); }
});

test("deleted eBay history stays deleted while a newer message can recreate the conversation", async () => {
  const db = await fixture();
  try {
    const old = conversationRow({ conversationId: "deleted-conversation", receivedAt: "2026-09-01T00:00:00Z" });
    await db.query(`insert into sellerpilot_private.support_ticket_deletions(
      owner_id,channel_key,external_ticket_fingerprint,deleted_through_at
    )values($1,'ebay',sellerpilot_private.support_deletion_fingerprint($1,'ebay',$2),'2026-09-02T00:00:00Z')`, [owner, old.externalTicketId]);
    assert.equal((await db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'ebay',$2::jsonb) result",
      [credential, JSON.stringify([old])],
    )).rows[0].result, 0);
    const newer = conversationRow({ conversationId: "deleted-conversation", messageId: "new-after-delete", receivedAt: "2026-09-03T00:00:00Z" });
    assert.equal((await db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'ebay',$2::jsonb) result",
      [credential, JSON.stringify([newer])],
    )).rows[0].result, 1);
  } finally { await db.close(); }
});
