import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { qoo10InquirySourceReadSchema } from "../lib/cs/channels/qoo10/source-capability";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { runWithProviderReadOnlyTransport } = await import("../lib/channels/protocols");
const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync");
const { executeChannelInquiries } = await import("../lib/cs/channels/qoo10/adapter");
const migration = await readFile(new URL(
  "../supabase/migrations/20260910050000_cs_qoo10_source_capability_status.sql",
  import.meta.url,
), "utf8");

const adminId = "00000000-0000-4000-8000-00000000f001";
const ownerA = "00000000-0000-4000-8000-00000000f002";
const ownerB = "00000000-0000-4000-8000-00000000f003";
const credentialA = "00000000-0000-4000-8000-00000000f004";
const rotatedA = "00000000-0000-4000-8000-00000000f005";
const credentialB = "00000000-0000-4000-8000-00000000f006";
const sellerA = "a".repeat(64);
const sellerB = "b".repeat(64);

test("official Qoo10 inquiry adapter calls GetInquiryMessage and reaches the account-scoped normalizer", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({
      ResultCode: 0,
      ResultObject: [{
        INQ_TYPE: "ITEM",
        QUESTION_NO: "700",
        SEQ_NO: "701",
        STATUS: "S1",
        INQ_DT: "20260910090000",
        CONTENTS: "local source capability fixture",
        CUST_NM: "masked-customer",
      }],
    });
  };
  try {
    const execution = await runWithProviderReadOnlyTransport(() => executeChannelInquiries({
      channel: "qoo10",
      operation: "inquiries.list",
      payload: { api_key: "local-fixture-key" },
      arguments: {
        params: {
          search_start_dt: "20260910000000",
          search_end_dt: "20260910235959",
          proc_status: "S1",
        },
      },
    }));
    assert.match(requestUrl, /CSCenter\.GetInquiryMessage/u);
    assert.deepEqual(requestBody, {
      returnType: "json",
      search_start_dt: "20260910000000",
      search_end_dt: "20260910235959",
      proc_status: "S1",
    });
    const normalized = normalizeChannelInquiries(
      "qoo10",
      {
        ok: true,
        channel: "qoo10",
        operation: "inquiries.list",
        safeMessage: "local fixture",
        steps: execution.steps,
      },
      "2026-09-10T00:05:00.000Z",
      {
        qoo10Identity: {
          account: {
            ownerId: ownerA,
            sellerAccountKey: sellerA,
            environment: "production",
          },
          sourceCredentialId: credentialA,
        },
      },
    );
    assert.equal(normalized.length, 1);
    assert.match(normalized[0]!.externalTicketId, /^qoo10:conversation:[a-f0-9]{64}$/u);
    assert.match(normalized[0]!.inboundKey, /^qoo10:inbound:[a-f0-9]{64}$/u);
    assert.equal(normalized[0]!.providerContext.inquiryType, "ITEM");
    assert.equal(normalized[0]!.replyContext.sequenceNo, "701");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$
      select auth.uid()='${adminId}'::uuid
    $$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text not null,environment text not null,
      created_by uuid not null,seller_account_key text,
      seller_account_key_source text not null,
      seller_account_verified_at timestamptz,status text not null,
      expires_at timestamptz
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key,owner_id uuid not null,channel_key text not null,
      seller_account_key text,received_at timestamptz not null,demo boolean not null,
      ticket_kind text not null,external_ticket_id text not null,provider_status text not null
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key,ticket_id uuid not null references sellerpilot_private.support_tickets(id),
      owner_id uuid not null,channel_key text not null,sender_role text not null,
      received_at timestamptz not null
    );
    create table sellerpilot_private.qoo10_history_windows(
      id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      source text not null,completion_state text not null,completion_reason text,
      provider_status integer,provider_row_count integer,calendar_date date not null,
      updated_at timestamptz not null
    );
    revoke all on sellerpilot_private.support_tickets
      from public,anon,authenticated,service_role;
    revoke all on sellerpilot_private.support_inbound_messages
      from public,anon,authenticated,service_role;
    revoke all on sellerpilot_private.qoo10_history_windows
      from public,anon,authenticated,service_role;
  `);
  await db.exec(migration);
  await db.query(`insert into sellerpilot_private.channel_credentials values
    ($1,'qoo10','production',$4,$6,'provider_certified_v1',clock_timestamp(),'active',clock_timestamp()+interval '1 day'),
    ($2,'qoo10','production',$4,$6,'provider_certified_v1',clock_timestamp(),'active',clock_timestamp()+interval '1 day'),
    ($3,'qoo10','production',$5,$7,'credential_incarnation_v1',clock_timestamp(),'active',clock_timestamp()+interval '1 day')`, [
    credentialA, rotatedA, credentialB, ownerA, ownerB, sellerA, sellerB,
  ]);
  return db;
}

async function asAdmin(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [adminId]);
  await db.exec("set role authenticated");
}

test("read-only source RPC projects canonical inquiry rows and history across one seller-account rotation", async () => {
  const db = await fixture();
  try {
    const ticketA = "00000000-0000-4000-8000-00000000f011";
    const ticketB = "00000000-0000-4000-8000-00000000f012";
    await db.query(`insert into sellerpilot_private.support_tickets values
      ($1,$3,'qoo10',$5,'2026-09-10T00:00:00Z',false,'conversation',$7,'waiting'),
      ($2,$4,'qoo10',$6,'2026-09-10T00:01:00Z',false,'conversation',$8,'answered')`, [
      ticketA,
      ticketB,
      ownerA,
      ownerB,
      sellerA,
      sellerB,
      `qoo10:conversation:${"1".repeat(64)}`,
      `qoo10:conversation:${"2".repeat(64)}`,
    ]);
    await db.query(`insert into sellerpilot_private.support_inbound_messages values
      (gen_random_uuid(),$1,$3,'qoo10','customer','2026-09-10T00:00:00Z'),
      (gen_random_uuid(),$1,$3,'qoo10','customer','2026-09-10T00:02:00Z'),
      (gen_random_uuid(),$2,$4,'qoo10','customer','2026-09-10T00:01:00Z')`, [
      ticketA, ticketB, ownerA, ownerB,
    ]);
    await db.query(`insert into sellerpilot_private.qoo10_history_windows values
      (gen_random_uuid(),$1,'qapi_inquiry','complete','provider_success_empty',200,0,'2026-09-09','2026-09-10T00:03:00Z'),
      (gen_random_uuid(),$2,'qapi_inquiry','complete','provider_total_reconciled',200,2,'2026-09-10','2026-09-10T00:04:00Z'),
      (gen_random_uuid(),$3,'qapi_inquiry','gap','provider_total_mismatch',200,2,'2026-09-10','2026-09-10T00:05:00Z')`, [
      credentialA, rotatedA, credentialB,
    ]);
    await asAdmin(db);
    const first = qoo10InquirySourceReadSchema.parse((await db.query(
      "select public.sellerpilot_read_qoo10_inquiry_source_v1($1) result",
      [rotatedA],
    )).rows[0]!.result);
    assert.equal(first.scopeState, "account_scoped");
    assert.equal(first.canonical.ticketCount, 1);
    assert.equal(first.canonical.inboundMessageCount, 2);
    assert.equal(first.canonical.waitingTicketCount, 1);
    assert.equal(first.history.windowCount, 2);
    assert.equal(first.history.completeWindowCount, 2);
    assert.equal(first.history.verifiedZeroWindowCount, 1);
    assert.equal(first.history.positiveCompleteWindowCount, 1);

    const second = qoo10InquirySourceReadSchema.parse((await db.query(
      "select public.sellerpilot_read_qoo10_inquiry_source_v1($1) result",
      [credentialB],
    )).rows[0]!.result);
    assert.equal(second.canonical.ticketCount, 1);
    assert.equal(second.canonical.inboundMessageCount, 1);
    assert.equal(second.history.windowCount, 1);
    assert.equal(second.history.gapWindowCount, 1);

    await db.exec("reset role");
    await db.query(
      "update sellerpilot_private.channel_credentials set status='revoked' where id=$1",
      [rotatedA],
    );
    await asAdmin(db);
    const unavailable = qoo10InquirySourceReadSchema.parse((await db.query(
      "select public.sellerpilot_read_qoo10_inquiry_source_v1($1) result",
      [rotatedA],
    )).rows[0]!.result);
    assert.equal(unavailable.scopeState, "credential_unavailable");
    assert.equal(unavailable.canonical.ticketCount, 0);
    assert.equal(unavailable.history.windowCount, 0);

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ownerA]);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.sellerpilot_read_qoo10_inquiry_source_v1($1)", [credentialA]),
      /administrator required/u,
    );
    await assert.rejects(
      db.query("select * from sellerpilot_private.support_tickets"),
      /permission denied/u,
    );
  } finally {
    await db.close();
  }
});
