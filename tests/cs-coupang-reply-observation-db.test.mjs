import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260907232000_add_cs_reply_remote_observation.sql",
  import.meta.url,
), "utf8");
const ownerA = "00000000-0000-4000-8000-000000004001";
const ownerB = "00000000-0000-4000-8000-000000004002";
const credentialA = "00000000-0000-4000-8000-000000004011";
const credentialB = "00000000-0000-4000-8000-000000004012";
const ticketA = "00000000-0000-4000-8000-000000004021";
const ticketB = "00000000-0000-4000-8000-000000004022";
const jobA = "00000000-0000-4000-8000-000000004031";
const deliveryA = "00000000-0000-4000-8000-000000004041";
const inboundA = `coupang:${"a".repeat(64)}`;
const fingerprint = (value) => createHash("sha256").update(value.trim()).digest("hex");

async function fixture({ ambiguous = false } = {}) {
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
      id uuid primary key, channel text, operation text, status text,
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
      ('${credentialA}','${ownerA}','coupang','active'),
      ('${credentialB}','${ownerB}','coupang','active');
    insert into sellerpilot_private.support_tickets(
      id,owner_id,channel_key,source_credential_id,external_ticket_id,external_order_reference,
      reply_context,latest_inbound_key,last_delivery_job_id
    ) values
      ('${ticketA}','${ownerA}','coupang','${credentialA}','call-center:3101','ORDER-77',
       '{"kind":"call-center","inquiryId":"3101","parentAnswerId":"4103"}','${inboundA}','${jobA}'),
      ('${ticketB}','${ownerB}','coupang','${credentialB}','call-center:3101','ORDER-77',
       '{"kind":"call-center","inquiryId":"3101","parentAnswerId":"4103"}',
       'coupang:${"b".repeat(64)}',null);
    insert into sellerpilot_private.channel_gateway_jobs values(
      '${jobA}','coupang','inquiries.reply','succeeded',
      '{"sellerpilotTicketId":"${ticketA}","sellerpilotInboundKey":"${inboundA}","arguments":{"kind":"call-center","inquiryId":"3101","parentAnswerId":"4103","reply":"exact answer"}}',
      '{"ok":true}',now()-interval '2 minutes'
    );
    insert into sellerpilot_private.support_reply_deliveries(
      id,ticket_id,owner_id,gateway_job_id,channel_key,status,reply_fingerprint,queued_at,completed_at
    ) values(
      '${deliveryA}','${ticketA}','${ownerA}','${jobA}','coupang','succeeded',
      '${fingerprint("exact answer")}',now()-interval '2 minutes',now()-interval '119 seconds'
    );
  `);
  if (ambiguous) {
    await db.exec(`
      insert into sellerpilot_private.channel_gateway_jobs values(
        '00000000-0000-4000-8000-000000004032','coupang','inquiries.reply','succeeded',
        '{"sellerpilotTicketId":"${ticketA}","sellerpilotInboundKey":"${inboundA}","arguments":{"kind":"call-center","inquiryId":"3101","parentAnswerId":"4103","reply":"exact answer"}}',
        '{"ok":true}',now()-interval '90 seconds'
      );
      insert into sellerpilot_private.support_reply_deliveries(
        id,ticket_id,owner_id,gateway_job_id,channel_key,status,reply_fingerprint,queued_at,completed_at
      ) values(
        '00000000-0000-4000-8000-000000004042','${ticketA}','${ownerA}',
        '00000000-0000-4000-8000-000000004032','coupang','succeeded',
        '${fingerprint("exact answer")}',now()-interval '90 seconds',now()-interval '89 seconds'
      );
    `);
  }
  await db.exec(migration);
  return db;
}

function observation(overrides = {}) {
  return [{
    contract: "sellerpilot-reply-observation/1",
    externalTicketId: "call-center:3101",
    inboundKey: `coupang:${"c".repeat(64)}`,
    remoteMessageId: "4104",
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    body: "exact answer",
    replyFingerprint: fingerprint("exact answer"),
    binding: { kind: "call-center", inquiryId: "3101", parentAnswerId: "4103", answerId: "4104" },
    ...overrides,
  }];
}

async function observe(db, credential, value = observation()) {
  return (await db.query(
    "select public.sellerpilot_service_observe_inquiry_replies_v1($1,'coupang',$2) result",
    [credential, JSON.stringify(value)],
  )).rows[0].result;
}

test("exact Coupang inquiry, parent and body become remote-observed", async () => {
  const db = await fixture();
  try {
    const result = await observe(db, credentialA);
    assert.deepEqual(result, {
      contract: "sellerpilot-reply-observation-result/1",
      received: 1, stored: 1, matched: 1, unmatched: 0, ambiguous: 0,
    });
    const deliveryRow = (await db.query(
      "select verification_status,provider_message_id from sellerpilot_private.support_reply_deliveries",
    )).rows[0];
    assert.deepEqual(deliveryRow, { verification_status: "remote_observed", provider_message_id: "4104" });
  } finally {
    await db.close();
  }
});

test("wrong parent and same order under another credential remain unmatched", async () => {
  const db = await fixture();
  try {
    let result = await observe(db, credentialA, observation({
      remoteMessageId: "wrong-parent",
      inboundKey: `coupang:${"d".repeat(64)}`,
      binding: { kind: "call-center", inquiryId: "3101", parentAnswerId: "4999" },
    }));
    assert.equal(result.matched, 0);
    assert.equal(result.unmatched, 1);
    result = await observe(db, credentialB, observation({
      remoteMessageId: "other-vendor",
      inboundKey: `coupang:${"e".repeat(64)}`,
    }));
    assert.equal(result.matched, 0);
    assert.equal(result.unmatched, 1);
    assert.equal((await db.query(
      "select verification_status from sellerpilot_private.support_reply_deliveries where id=$1",
      [deliveryA],
    )).rows[0].verification_status, "provider_accepted");
  } finally {
    await db.close();
  }
});

test("late old-generation echo verifies its delivery without resolving a new re-inquiry", async () => {
  const db = await fixture();
  try {
    await db.exec(`update sellerpilot_private.support_tickets set
      latest_inbound_key='coupang:${"f".repeat(64)}',status='waiting',provider_status='waiting'
      where id='${ticketA}'`);
    const result = await observe(db, credentialA);
    assert.equal(result.matched, 1);
    assert.equal((await db.query(
      "select verification_status from sellerpilot_private.support_reply_deliveries where id=$1",
      [deliveryA],
    )).rows[0].verification_status, "remote_observed");
    const ticketRow = (await db.query(
      "select status,provider_status from sellerpilot_private.support_tickets where id=$1",
      [ticketA],
    )).rows[0];
    assert.deepEqual(ticketRow, { status: "waiting", provider_status: "waiting" });
  } finally {
    await db.close();
  }
});

test("multiple candidate deliveries are ambiguous and never auto-closed", async () => {
  const db = await fixture({ ambiguous: true });
  try {
    const result = await observe(db, credentialA);
    assert.equal(result.matched, 0);
    assert.equal(result.ambiguous, 1);
    assert.deepEqual((await db.query(
      "select distinct verification_status from sellerpilot_private.support_reply_deliveries",
    )).rows, [{ verification_status: "provider_accepted" }]);
  } finally {
    await db.close();
  }
});

