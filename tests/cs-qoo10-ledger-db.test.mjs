import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    return nextResolve(specifier, context);
  },
});

const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync.ts");
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const CREDENTIAL = "00000000-0000-4000-8000-000000000003";

function operation(name, data) {
  return {
    ok: true,
    channel: "qoo10",
    operation: "inquiries.list",
    safeMessage: "local fixture",
    steps: [{ name, ok: true, status: 200, data }],
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable
      as $$select auth.uid()='${OWNER}'::uuid$$;
    create table sellerpilot_private.qoo10_cs_fixture_ledger(
      credential_id uuid not null,
      inbound_key text not null,
      external_ticket_id text not null,
      remote_message_id text not null,
      payload jsonb not null,
      primary key(credential_id,inbound_key)
    );
    create function public.qoo10_cs_admin_projection()
    returns table(external_ticket_id text,remote_message_id text,provider_status text,ticket_kind text)
    language plpgsql security definer set search_path=''
    as $$begin
      if not public.sellerpilot_is_admin() then raise exception 'administrator required'; end if;
      return query select l.external_ticket_id,l.remote_message_id,
        l.payload->>'providerStatus',l.payload->>'ticketKind'
      from sellerpilot_private.qoo10_cs_fixture_ledger l order by l.external_ticket_id,l.remote_message_id;
    end$$;
    select set_config('request.jwt.claim.sub','${OWNER}',false);
  `);
  return db;
}

test("Qoo10 provider fixtures normalize, deduplicate in an isolated ledger, and require admin projection", async () => {
  const db = await fixture();
  try {
    const inquiry = normalizeChannelInquiries("qoo10", operation("GetInquiryMessage", {
      ResultCode: 0,
      ResultObject: [{
        INQ_TYPE: "ITEM", QUESTION_NO: "100", SEQ_NO: "101", STATUS: "S1",
        INQ_DT: "20260908100000", CONTENTS: "fixture question", CUST_NM: "masked-customer",
      }],
    }), "2026-09-08T10:00:00.000Z");
    const claim = normalizeChannelInquiries("qoo10", operation("GetClaimInfo_V3", {
      ResultCode: 0,
      sellerpilotInquiryKind: "claim",
      ResultObject: [{
        claimStatus: "4", requestDate: "20260908110000", orderNo: "901234567890",
        reason: "fixture return", receiver: "must-not-persist", pickupAddress: "must-not-persist",
        buyer: "must-not-persist", buyerMobile: "must-not-persist",
      }],
    }), "2026-09-08T10:00:00.000Z");
    for (const row of [...inquiry, ...claim, ...inquiry]) {
      await db.query(`insert into sellerpilot_private.qoo10_cs_fixture_ledger
        (credential_id,inbound_key,external_ticket_id,remote_message_id,payload)
        values($1,$2,$3,$4,$5::jsonb) on conflict(credential_id,inbound_key) do update set payload=excluded.payload`, [
        CREDENTIAL, row.inboundKey, row.externalTicketId, row.remoteMessageId, JSON.stringify(row),
      ]);
    }
    const persisted = (await db.query("select payload from sellerpilot_private.qoo10_cs_fixture_ledger order by external_ticket_id")).rows;
    assert.equal(persisted.length, 2);
    assert.doesNotMatch(JSON.stringify(persisted), /must-not-persist|pickupAddress|buyerMobile/u);
    const projected = (await db.query("select * from public.qoo10_cs_admin_projection()"));
    assert.equal(projected.rows.length, 2);
    assert.deepEqual(projected.rows.map((row) => row.ticket_kind).sort(), ["after_sales", "conversation"]);
    await db.exec(`select set_config('request.jwt.claim.sub','${OTHER}',false)`);
    await assert.rejects(db.query("select * from public.qoo10_cs_admin_projection()"), /administrator required/u);
  } finally {
    await db.close();
  }
});
