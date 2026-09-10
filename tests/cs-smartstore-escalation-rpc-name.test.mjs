import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const oldName = "sellerpilot_service_escalate_stale_smartstore_reply_acceptance_v1";
const installedName = oldName.slice(0, 63);
const newName = "sellerpilot_service_escalate_smartstore_reply_v1";
const original = await readFile(new URL("../supabase/migrations/20260909152145_cs_smartstore_exact_reply_readback.sql", import.meta.url), "utf8");
const functionSql = original.slice(original.indexOf("create function public." + oldName),
  original.indexOf("create or replace function public.sellerpilot_get_inquiry_reply_delivery("));
const aliasSql = await readFile(new URL("../supabase/migrations/20260910094100_cs_smartstore_reply_escalation_rpc_name.sql", import.meta.url), "utf8");

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.support_reply_deliveries(
      id integer primary key, channel_key text,verification_status text,
      provider_accepted_at timestamptz,verification_contract text,reconciliation_reason text,
      smartstore_readback_state text,smartstore_readback_reason text,
      smartstore_readback_checked_at timestamptz,smartstore_automatic_resend_allowed boolean,
      updated_at timestamptz);
    create table sellerpilot_private.smartstore_reply_readback_links_v1(
      delivery_id integer primary key,ticket_id integer,expected_inbound_key text,state text,
      reason text,checked_at timestamptz,automatic_resend_allowed boolean,updated_at timestamptz);
    create table sellerpilot_private.support_tickets(id integer primary key,latest_inbound_key text,
      status text,provider_status text,provider_status_updated_at timestamptz,resolved_at timestamptz,
      reply_delivery_status text,reply_delivery_error text,updated_at timestamptz);
  `);
  await db.exec(functionSql);
  return db;
}

test("exact short PostgREST name preserves installed canonical escalation behavior and service ACL", async () => {
  const db = await fixture();
  try {
    assert.equal(Buffer.byteLength(oldName), 65);
    assert.ok(Buffer.byteLength(newName) <= 63);
    const before = await db.query("select oid,proname from pg_proc where proname::text=$1", [installedName]);
    assert.equal(before.rows.length,1);
    assert.equal((await db.query("select oid from pg_proc where proname::text=$1",[oldName])).rows.length,0);
    await db.exec(aliasSql);
    const after = await db.query("select oid,proname from pg_proc where proname::text=$1", [installedName]);
    assert.deepEqual(after.rows,before.rows);
    assert.equal((await db.query("select proname from pg_proc where proname::text=$1",[newName])).rows[0].proname,newName);
    await db.exec(`
      insert into sellerpilot_private.support_reply_deliveries(id,channel_key,verification_status,provider_accepted_at)
      values(1,'smartstore','provider_accepted',now()-interval '16 minutes'),
            (2,'smartstore','provider_accepted',now()-interval '1 minute'),
            (3,'other','provider_accepted',now()-interval '20 minutes');
      insert into sellerpilot_private.smartstore_reply_readback_links_v1(delivery_id,ticket_id,expected_inbound_key,state)
      values(1,1,'inbound-1','pending'),(2,2,'inbound-2','pending'),(3,3,'inbound-3','pending');
      insert into sellerpilot_private.support_tickets(id,latest_inbound_key,status)
      values(1,'inbound-1','resolved'),(2,'inbound-2','resolved'),(3,'inbound-3','resolved');
      set role service_role;
    `);
    const first=(await db.query(`select public.${newName}(1) result`)).rows[0].result;
    assert.deepEqual(first,{contract:"sellerpilot-smartstore-stale-reply-escalation/1",escalated:1,automaticResendAllowed:false});
    assert.equal((await db.query(`select public.${newName}() result`)).rows[0].result.escalated,0);
    await assert.rejects(db.query(`select public.${newName}(0)`),/SMARTSTORE_STALE_REPLY_LIMIT_INVALID/u);
    await db.exec("reset role");
    const states=(await db.query("select id,verification_status,smartstore_automatic_resend_allowed from sellerpilot_private.support_reply_deliveries order by id")).rows;
    assert.equal(states[0].verification_status,"reconciliation_required");
    assert.equal(states[0].smartstore_automatic_resend_allowed,false);
    assert.equal(states[1].verification_status,"provider_accepted");
    assert.equal(states[2].verification_status,"provider_accepted");
    assert.equal((await db.query("select status from sellerpilot_private.support_tickets where id=1")).rows[0].status,"in_progress");
    for (const role of ["anon","authenticated"]) {
      await db.exec("set role "+role);
      await assert.rejects(db.query(`select public.${newName}(1)`),/permission denied/u);
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});

test("short alias refuses a missing implementation",async()=>{
 const db=new PGlite();
 try{
   await db.exec("create role anon;create role authenticated;create role service_role;");
   await assert.rejects(db.exec(aliasSql),/SMARTSTORE_STALE_REPLY_RPC_PREIMAGE_MISSING/u);
 }finally{await db.close();}
});
