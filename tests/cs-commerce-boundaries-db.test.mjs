import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const migration=await readFile(new URL("../supabase/migrations/20260908001000_harden_cs_commerce_boundaries.sql",import.meta.url),"utf8");
const owner="00000000-0000-4000-8000-000000001001",credential="00000000-0000-4000-8000-000000001002",ticket="00000000-0000-4000-8000-000000001003",order="00000000-0000-4000-8000-000000001004";
async function fixture(){const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema extensions;
 create function extensions.digest(value text,algorithm text)returns bytea language sql immutable as $$select decode(md5(value)||md5(value||algorithm),'hex')$$;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}');
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.sellerpilot_is_admin()returns boolean language sql stable security definer as $$select auth.uid()='${owner}'::uuid$$;
 create schema sellerpilot_private;
 create table sellerpilot_private.channel_credentials(id uuid primary key,created_by uuid,channel text);
 create table sellerpilot_private.commerce_orders(id uuid primary key,owner_id uuid,channel_key text,external_order_id text,demo boolean default false,unique(owner_id,channel_key,external_order_id));
 create table sellerpilot_private.support_tickets(id uuid primary key,owner_id uuid,channel_key text,external_order_reference text,source_credential_id uuid,order_id uuid references sellerpilot_private.commerce_orders(id) on delete set null,demo boolean default false);
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key default gen_random_uuid(),operation text,request_payload jsonb);
 insert into sellerpilot_private.channel_credentials values('${credential}','${owner}','coupang');
 insert into sellerpilot_private.commerce_orders values('${order}','${owner}','coupang','ORDER-77',false);
 insert into sellerpilot_private.support_tickets values('${ticket}','${owner}','coupang','ORDER-77','${credential}',null,false);
 `);await db.exec(migration);return db;}
test("CS order linkage requires exact owner, channel, external id, and credential",async()=>{const db=await fixture();try{
 assert.equal((await db.query("select order_id from sellerpilot_private.support_tickets where id=$1",[ticket])).rows[0].order_id,order);
 await db.exec("update sellerpilot_private.support_tickets set external_order_reference='PRODUCT-77'");
 const row=(await db.query("select ticket.order_id,binding.status from sellerpilot_private.support_tickets ticket join sellerpilot_private.cs_order_bindings binding on binding.ticket_id=ticket.id")).rows[0];
 assert.equal(row.order_id,null);assert.equal(row.status,"unmatched");
 await assert.rejects(db.query("update sellerpilot_private.support_tickets set order_id=$1",[order]),/CS_ORDER_BINDING_NOT_EXACT/);
}finally{await db.close();}});
test("an order arriving after the inquiry binds exactly and CS lineage cannot create commerce writes",async()=>{const db=await fixture();try{
 await db.exec("delete from sellerpilot_private.commerce_orders;update sellerpilot_private.support_tickets set external_order_reference='LATE-1'");
 assert.equal((await db.query("select status from sellerpilot_private.cs_order_bindings")).rows[0].status,"unmatched");
 await db.exec(`insert into sellerpilot_private.commerce_orders values('${order}','${owner}','coupang','LATE-1',false)`);
 assert.equal((await db.query("select order_id from sellerpilot_private.support_tickets")).rows[0].order_id,order);
 await assert.rejects(db.query("insert into sellerpilot_private.channel_gateway_jobs(operation,request_payload)values('shipment.confirm',$1::jsonb)",[JSON.stringify({sellerpilotTicketId:ticket})]),/CS_LINEAGE_COMMERCE_MUTATION_FORBIDDEN/);
 await db.query("insert into sellerpilot_private.channel_gateway_jobs(operation,request_payload)values('inquiries.reply',$1::jsonb)",[JSON.stringify({sellerpilotTicketId:ticket})]);
}finally{await db.close();}});

for (const [name, mutation, expectedStatus] of [
 ["order reference", "update sellerpilot_private.commerce_orders set external_order_id='CHANGED'", "unmatched"],
 ["order owner", "update sellerpilot_private.commerce_orders set owner_id='00000000-0000-4000-8000-000000009999'", "unmatched"],
 ["order channel", "update sellerpilot_private.commerce_orders set channel_key='ebay'", "unmatched"],
 ["order demo", "update sellerpilot_private.commerce_orders set demo=true", "unmatched"],
 ["order deletion", "delete from sellerpilot_private.commerce_orders", "unmatched"],
 ["credential channel", "update sellerpilot_private.channel_credentials set channel='ebay'", "unverified_credential"],
 ["credential owner", "update sellerpilot_private.channel_credentials set created_by='00000000-0000-4000-8000-000000009999'", "unverified_credential"],
 ["credential deletion", "delete from sellerpilot_private.channel_credentials", "unverified_credential"],
 ["NULL credential", "update sellerpilot_private.support_tickets set source_credential_id=null", "unverified_credential"],
]) {
 test(`${name} invalidation removes the old exact order binding`, async () => {
  const db=await fixture();
  try {
   await db.exec(mutation);
   const row=(await db.query(`select ticket.order_id, binding.status, binding.order_id as bound_order
    from sellerpilot_private.support_tickets ticket join sellerpilot_private.cs_order_bindings binding on binding.ticket_id=ticket.id`)).rows[0];
   assert.equal(row.order_id,null); assert.equal(row.bound_order,null); assert.equal(row.status,expectedStatus);
  } finally {await db.close();}
 });
}

test("order identity update reconciles both old and newly matching tickets",async()=>{
 const db=await fixture();
 try{
  await db.exec(`insert into sellerpilot_private.support_tickets values('00000000-0000-4000-8000-000000001005','${owner}','coupang','NEXT','${credential}',null,false)`);
  await db.exec("update sellerpilot_private.commerce_orders set external_order_id='NEXT'");
  const rows=(await db.query("select ticket.external_order_reference,ticket.order_id,binding.status from sellerpilot_private.support_tickets ticket join sellerpilot_private.cs_order_bindings binding on binding.ticket_id=ticket.id order by ticket.id")).rows;
  assert.equal(rows[0].order_id,null);assert.equal(rows[0].status,'unmatched');
  assert.equal(rows[1].order_id,order);assert.equal(rows[1].status,'exact');
  await db.exec("update sellerpilot_private.commerce_orders set external_order_id='ORDER-77'");
  assert.equal((await db.query("select order_id from sellerpilot_private.support_tickets where id=$1",[ticket])).rows[0].order_id,order);
 }finally{await db.close();}
});
