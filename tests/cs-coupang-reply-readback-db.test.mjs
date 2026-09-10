import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const patch = await readFile(new URL(
  "../supabase/migrations/20260908143355_cs_coupang_reply_readback.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000001001";
const credential = "00000000-0000-4000-8000-000000001002";
const ticket = "00000000-0000-4000-8000-000000001003";
const sourceJob = "00000000-0000-4000-8000-000000001004";
const otherOwner = "00000000-0000-4000-8000-000000001005";
const otherCredential = "00000000-0000-4000-8000-000000001006";
const inboundKey = `coupang:${"a".repeat(64)}`;
const fingerprint = "b".repeat(64);
const sellerKey = "c".repeat(64);

function acceptedResponse(kind = "call-center") {
  return {
    ok: true,
    steps: [{ data: { sellerpilotReplyAcceptance: {
      contract: "sellerpilot-reply-acceptance/1",
      level: "provider_accepted",
      channel: "coupang",
      kind,
      bindingDigest: "d".repeat(64),
    } } }],
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, created_by uuid not null, channel text not null,
      environment text not null, status text not null, seller_account_key text,
      seller_account_key_source text, seller_account_verified_at timestamptz,
      expires_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(), credential_id uuid not null,
      attempt_id uuid, channel text not null, operation text not null,
      environment text not null, request_payload jsonb not null,
      response_payload jsonb, status text not null default 'queued',
      seller_account_key text, created_by uuid not null,
      error_message text, started_at timestamptz, completed_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key, owner_id uuid not null, channel_key text not null,
      source_credential_id uuid, external_ticket_id text not null,
      seller_account_key text, latest_inbound_key text, last_delivery_job_id uuid,
      provider_status text, provider_status_updated_at timestamptz,
      status text not null default 'open', updated_at timestamptz not null default now(),
      demo boolean not null default false
    );
    create table sellerpilot_private.support_reply_deliveries(
      id uuid primary key default gen_random_uuid(), ticket_id uuid not null,
      owner_id uuid not null, gateway_job_id uuid not null unique,
      channel_key text not null, status text not null,
      verification_status text not null default 'unverified',
      verification_contract text, provider_accepted_at timestamptz,
      reply_fingerprint text not null, provider_request_id text,
      provider_message_id text, safe_message text, reconciliation_reason text,
      queued_at timestamptz not null, started_at timestamptz,
      completed_at timestamptz, updated_at timestamptz not null default now()
    );
    insert into auth.users values ('${owner}'),('${otherOwner}');
    insert into sellerpilot_private.channel_credentials values
      ('${credential}','${owner}','coupang','production','active','${sellerKey}',
       'provider_certified_v1',clock_timestamp(),clock_timestamp()+interval '1 day'),
      ('${otherCredential}','${owner}','coupang','production','active','${"e".repeat(64)}',
       'provider_certified_v1',clock_timestamp(),clock_timestamp()+interval '1 day');
    insert into sellerpilot_private.support_tickets values(
      '${ticket}','${owner}','coupang','${credential}','call-center:3101','${sellerKey}',
      '${inboundKey}',null,'awaiting_response',null,'open',clock_timestamp(),false
    );

    create function sellerpilot_private.track_reply_acceptance_verification()
    returns trigger language plpgsql security definer set search_path='' as $$
    begin
      if new.verification_status='remote_observed' then return new; end if;
      if new.status='succeeded' then
        new.verification_status:='provider_accepted';
        new.verification_contract:='sellerpilot-reply-acceptance/1';
        new.provider_accepted_at:=coalesce(new.provider_accepted_at,new.completed_at,clock_timestamp());
      elsif new.status='reconciliation_required' then
        new.verification_status:='reconciliation_required';
      elsif new.status in('failed','cancelled') then
        new.verification_status:='failed';
      else
        new.verification_status:='unverified';
      end if;
      return new;
    end $$;
    create trigger track_reply_acceptance_verification
    before insert or update of status on sellerpilot_private.support_reply_deliveries
    for each row execute function sellerpilot_private.track_reply_acceptance_verification();

    create function sellerpilot_private.sync_inquiry_reply_delivery_ledger()
    returns trigger language plpgsql security definer set search_path='' as $$
    declare
      v_ticket_id uuid; v_owner_id uuid; v_reply_fingerprint text;
      v_delivery_status text; v_reconciliation_reason text;
    begin
      if new.operation<>'inquiries.reply' then return new; end if;
      begin v_ticket_id:=nullif(new.request_payload->>'sellerpilotTicketId','')::uuid;
      exception when others then return new; end;
      v_reply_fingerprint:=nullif(new.request_payload->>'sellerpilotReplyFingerprint','');
      if v_ticket_id is null or v_reply_fingerprint!~'^[0-9a-f]{64}$' then return new; end if;
      select t.owner_id into v_owner_id from sellerpilot_private.support_tickets t
       where t.id=v_ticket_id and t.channel_key=new.channel and not t.demo;
      if v_owner_id is null then return new; end if;
      v_delivery_status:=case
        when new.status='succeeded' and new.response_payload@>'{"ok":true}'::jsonb then 'succeeded'
        when new.status='succeeded' and new.response_payload@>'{"ok":false}'::jsonb then 'failed'
        when new.status='succeeded' then 'reconciliation_required'
        else new.status end;
      v_reconciliation_reason:=case when v_delivery_status='reconciliation_required'
        then left(coalesce(nullif(trim(new.error_message),''),'Provider outcome requires reconciliation.'),500)
        else null end;
      insert into sellerpilot_private.support_reply_deliveries(
        ticket_id,owner_id,gateway_job_id,channel_key,status,reply_fingerprint,
        provider_request_id,provider_message_id,safe_message,reconciliation_reason,
        queued_at,started_at,completed_at,updated_at
      ) values(
        v_ticket_id,v_owner_id,new.id,new.channel,v_delivery_status,v_reply_fingerprint,
        nullif(new.response_payload#>>'{steps,0,requestId}',''),
        left(nullif(trim(new.response_payload->>'remoteId'),''),240),
        left(nullif(trim(new.response_payload->>'safeMessage'),''),1000),
        v_reconciliation_reason,new.created_at,new.started_at,new.completed_at,clock_timestamp()
      ) on conflict(gateway_job_id) do update set
        status=excluded.status,
        provider_request_id=coalesce(excluded.provider_request_id,sellerpilot_private.support_reply_deliveries.provider_request_id),
        provider_message_id=coalesce(excluded.provider_message_id,sellerpilot_private.support_reply_deliveries.provider_message_id),
        safe_message=coalesce(excluded.safe_message,sellerpilot_private.support_reply_deliveries.safe_message),
        reconciliation_reason=excluded.reconciliation_reason,
        started_at=coalesce(excluded.started_at,sellerpilot_private.support_reply_deliveries.started_at),
        completed_at=excluded.completed_at,updated_at=clock_timestamp();
      update sellerpilot_private.support_tickets set
        last_delivery_job_id=new.id,
        provider_status=case when v_delivery_status='succeeded' then 'answered' else provider_status end,
        provider_status_updated_at=case when v_delivery_status='succeeded' then clock_timestamp() else provider_status_updated_at end
       where id=v_ticket_id and latest_inbound_key=new.request_payload->>'sellerpilotInboundKey';
      return new;
    end $$;
    create trigger sync_inquiry_reply_delivery_ledger
    after insert or update of status,response_payload,error_message
    on sellerpilot_private.channel_gateway_jobs for each row
    execute function sellerpilot_private.sync_inquiry_reply_delivery_ledger();
  `);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,response_payload,
    status,seller_account_key,created_by
  ) values ($1,$2,'coupang','inquiries.reply','production',$3::jsonb,null,
    'running',$4,$5)`, [
    sourceJob,
    credential,
    JSON.stringify({
      arguments: { kind: "call-center", inquiryId: "3101", parentAnswerId: "4103", reply: "fixture" },
      sellerpilotTicketId: ticket,
      sellerpilotInboundKey: inboundKey,
      sellerpilotReplyFingerprint: fingerprint,
    }),
    sellerKey,
    owner,
  ]);
  await db.exec(patch);
  return db;
}

async function completeReply(db, response = acceptedResponse()) {
  await db.query(`update sellerpilot_private.channel_gateway_jobs set
    response_payload=$2::jsonb,status='succeeded',completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=$1`, [sourceJob, JSON.stringify(response)]);
}

test("common completion stores acceptance, updates delivery, and atomically creates one exact child", async () => {
  const db = await fixture();
  try {
    await completeReply(db);
    const source = (await db.query(
      "select status,response_payload from sellerpilot_private.channel_gateway_jobs where id=$1",
      [sourceJob],
    )).rows[0];
    assert.equal(source.status, "succeeded");
    assert.deepEqual(source.response_payload, acceptedResponse());
    assert.equal(
      source.response_payload.steps[0].data.sellerpilotReplyAcceptance.contract,
      "sellerpilot-reply-acceptance/1",
    );
    const deliveryRow = (await db.query(
      "select status,verification_status,reply_fingerprint from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1",
      [sourceJob],
    )).rows[0];
    assert.deepEqual(deliveryRow, {
      status: "succeeded",
      verification_status: "provider_accepted",
      reply_fingerprint: fingerprint,
    });
    const child = (await db.query(`select * from sellerpilot_private.channel_gateway_jobs
      where operation='inquiries.list'`)).rows[0];
    assert.ok(child);
    assert.equal(child.credential_id, credential);
    assert.equal(child.environment, "production");
    assert.equal(child.seller_account_key, sellerKey);
    assert.deepEqual(child.request_payload.arguments, { kind: "call-center-detail", inquiryId: "3101" });
    assert.equal(child.request_payload.sellerpilotReplyReadback.sourceJobId, sourceJob);
    assert.equal(child.request_payload.sellerpilotReplyReadback.expectedInboundKey, inboundKey);
    assert.equal(child.request_payload.sellerpilotReplyReadback.expectedParentAnswerId, "4103");
    assert.equal(child.request_payload.sellerpilotReplyReadback.expectedReplyFingerprint, fingerprint);
    assert.equal(JSON.stringify(child.request_payload).includes("fixture"), false);
    const link = (await db.query("select * from sellerpilot_private.coupang_reply_readback_links")).rows[0];
    assert.equal(link.source_job_id, sourceJob);
    assert.equal(link.child_job_id, child.id);
  } finally {
    await db.close();
  }
});

test("duplicate ACK and failed readback never create or resend another reply", async () => {
  const db = await fixture();
  try {
    await completeReply(db);
    await completeReply(db);
    assert.deepEqual((await db.query(`select operation,count(*)::int n
      from sellerpilot_private.channel_gateway_jobs group by operation order by operation`)).rows, [
      { operation: "inquiries.list", n: 1 },
      { operation: "inquiries.reply", n: 1 },
    ]);
    await db.exec("update sellerpilot_private.channel_gateway_jobs set status='failed' where operation='inquiries.list'");
    await completeReply(db);
    assert.deepEqual((await db.query(`select operation,count(*)::int n
      from sellerpilot_private.channel_gateway_jobs group by operation order by operation`)).rows, [
      { operation: "inquiries.list", n: 1 },
      { operation: "inquiries.reply", n: 1 },
    ]);
  } finally {
    await db.close();
  }
});

test("product replies stay untouched and invalid call-center acceptance rolls back", async () => {
  const db = await fixture();
  try {
    await db.query(`update sellerpilot_private.channel_gateway_jobs set
      request_payload=jsonb_set(request_payload,'{arguments,kind}','"product"'::jsonb)
      where id=$1`, [sourceJob]);
    await completeReply(db, acceptedResponse("product"));
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.coupang_reply_readback_links")).rows[0].n, 0);
  } finally {
    await db.close();
  }

  const invalidDb = await fixture();
  try {
    await assert.rejects(completeReply(invalidDb, { ok: true }), /COUPANG_REPLY_READBACK_SOURCE_INVALID/u);
    assert.equal((await invalidDb.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [sourceJob],
    )).rows[0].status, "running");
    assert.equal((await invalidDb.query(
      "select status from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1", [sourceJob],
    )).rows[0].status, "running");
    assert.equal((await invalidDb.query(
      "select count(*)::int n from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'",
    )).rows[0].n, 0);
  } finally {
    await invalidDb.close();
  }
});

test("NULL request kind cannot borrow a call-center acceptance marker", async () => {
  const db = await fixture();
  try {
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set request_payload=request_payload#-'{arguments,kind}' where id=$1`, [sourceJob]);
    await assert.rejects(completeReply(db), /COUPANG_REPLY_READBACK_SOURCE_INVALID/u);
    assert.equal((await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [sourceJob],
    )).rows[0].status, "running");
    assert.equal((await db.query(
      "select count(*)::int n from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'",
    )).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("ticket credential, seller key, environment and owner mismatches all fail closed", async () => {
  const cases = [
    ["ticket credential", "update sellerpilot_private.support_tickets set source_credential_id=$1 where id=$2", [otherCredential, ticket]],
    ["source seller key NULL", "update sellerpilot_private.channel_gateway_jobs set seller_account_key=null where id=$1", [sourceJob]],
    ["ticket seller key NULL", "update sellerpilot_private.support_tickets set seller_account_key=null where id=$1", [ticket]],
    ["credential seller key", "update sellerpilot_private.channel_credentials set seller_account_key=repeat('e',64) where id=$1", [credential]],
    ["environment", "update sellerpilot_private.channel_gateway_jobs set environment='sandbox' where id=$1", [sourceJob]],
    ["source owner", "update sellerpilot_private.channel_gateway_jobs set created_by=$1 where id=$2", [otherOwner, sourceJob]],
    ["ticket owner", "update sellerpilot_private.support_tickets set owner_id=$1 where id=$2", [otherOwner, ticket]],
  ];
  for (const [label, mutation, values] of cases) {
    const db = await fixture();
    try {
      await db.query(mutation, values);
      await assert.rejects(completeReply(db), /COUPANG_REPLY_READBACK_CREDENTIAL_INVALID/u, label);
      assert.equal((await db.query(
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [sourceJob],
      )).rows[0].status, "running", label);
      assert.equal((await db.query(
        "select count(*)::int n from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'",
      )).rows[0].n, 0, label);
    } finally {
      await db.close();
    }
  }
});

test("NULL seller keys on both source and ticket cannot enqueue a readback", async () => {
  const db = await fixture();
  try {
    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs set seller_account_key=null where id='${sourceJob}';
      update sellerpilot_private.support_tickets set seller_account_key=null where id='${ticket}';
    `);
    await assert.rejects(completeReply(db), /COUPANG_REPLY_READBACK_CREDENTIAL_INVALID/u);
    assert.equal((await db.query(
      "select count(*)::int n from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'",
    )).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("readback link table remains inaccessible to API roles", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal((await db.query(
        "select has_table_privilege($1,'sellerpilot_private.coupang_reply_readback_links','SELECT') allowed",
        [role],
      )).rows[0].allowed, false);
    }
  } finally {
    await db.close();
  }
});
