import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const migration = await readFile(new URL("../supabase/migrations/20260908170140_isolate_cs_workspace_snapshot.sql", import.meta.url), "utf8");
const ledgerSource = await readFile(new URL("../supabase/migrations/20260831033000_add_cs_message_delivery_ledger.sql", import.meta.url), "utf8");
const start = ledgerSource.indexOf("create or replace function public.sellerpilot_get_cs_workspace_snapshot()");
const ledgerFunction = ledgerSource.slice(start, ledgerSource.indexOf("\n$$;", start) + 4);
const owner = "00000000-0000-4000-8000-000000000001";
const admin = "00000000-0000-4000-8000-000000000002";
const ticket = "00000000-0000-4000-8000-000000000101";
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    create function public.sellerpilot_is_admin() returns boolean language sql stable as
      'select auth.uid() in (''${owner}''::uuid, ''${admin}''::uuid)';
    create table sellerpilot_private.channels(key text primary key, code text);
    create table sellerpilot_private.support_tickets(
      id uuid primary key, owner_id uuid, external_ticket_id text, channel_key text, customer_name text,
      subject text, message text, translated_message text, reply_draft text, status text, priority int,
      received_at timestamptz, updated_at timestamptz, demo boolean default false,
      reply_delivery_status text default 'never', reply_delivery_error text, reply_operation_attempt_id uuid,
      last_delivery_job_id uuid, order_id uuid, external_order_reference text, provider_status text,
      provider_status_updated_at timestamptz, provider_context jsonb, latest_inbound_key text, ticket_kind text
    );
    create table sellerpilot_private.channel_gateway_jobs(id uuid primary key, request_payload jsonb);
    create table sellerpilot_private.support_reply_deliveries(
      id uuid, gateway_job_id uuid, ticket_id uuid, channel_key text, status text, safe_message text,
      reconciliation_reason text, provider_request_id text, provider_message_id text,
      queued_at timestamptz, started_at timestamptz, completed_at timestamptz, updated_at timestamptz, acknowledged_at timestamptz
    );
    create table sellerpilot_private.channel_sync_state(owner_id uuid,channel_key text,data_type text,status text,
      imported_count int,last_started_at timestamptz,last_succeeded_at timestamptz,last_error text,updated_at timestamptz);
    insert into sellerpilot_private.channels values ('elevenst','11');
    insert into sellerpilot_private.support_tickets(id,owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,priority,
      received_at,updated_at,provider_status,provider_context,latest_inbound_key,ticket_kind,external_order_reference)
    values('${ticket}','${owner}','qna:1','elevenst','Fixture customer','Fixture subject','Preserved message','waiting',3,
      now(),now(),'waiting','{}','inbound-1','conversation','remote-order-9');
    insert into sellerpilot_private.channel_sync_state values
      ('${owner}','elevenst','inquiries','passed',1,null,now(),null,now()),
      ('${owner}','elevenst','orders','failed',0,null,null,'commerce intentionally unavailable',now());
  `);
  await db.exec(ledgerFunction);
  await db.exec(migration);
  return db;
}

test("CS snapshot works with no product or order tables and preserves another administrator's seller-owned tickets", async () => {
  const db = await fixture();
  try {
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}';`);
    const value = (await db.query("select public.sellerpilot_get_cs_snapshot() as value")).rows[0].value;
    assert.equal(value.contract, "sellerpilot-cs-snapshot/1");
    assert.equal(value.tickets.length, 1);
    assert.equal(value.tickets[0].id, ticket);
    assert.equal(value.tickets[0].message, "Preserved message");
    assert.equal(value.tickets[0].externalOrderReference, "remote-order-9");
    assert.equal(value.syncStatus.length, 1);
    assert.equal(value.syncStatus[0].data_type, "inquiries");
    assert.equal(JSON.stringify(value).includes("commerce intentionally unavailable"), false);
    await assert.rejects(db.query("select sellerpilot_private.cs_snapshot()"), /permission denied/);
  } finally { await db.close(); }
});

test("CS snapshot rejects unauthenticated and non-administrator sessions", async () => {
  const db = await fixture();
  try {
    await db.exec("set role anon;");
    await assert.rejects(db.query("select public.sellerpilot_get_cs_snapshot()"), /permission denied/);
    await db.exec("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';");
    await assert.rejects(db.query("select public.sellerpilot_get_cs_snapshot()"), /administrator access required/);
    await db.exec("set request.jwt.claim.sub='';");
    await assert.rejects(db.query("select public.sellerpilot_get_cs_snapshot()"), /administrator access required/);
  } finally { await db.close(); }
});
