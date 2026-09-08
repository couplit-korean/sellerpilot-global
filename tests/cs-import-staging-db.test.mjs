import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const migration=await readFile(new URL("../supabase/migrations/20260908002000_add_cs_import_staging.sql",import.meta.url),"utf8");
const owner="00000000-0000-4000-8000-000000001101",credential="00000000-0000-4000-8000-000000001102",actor="00000000-0000-4000-8000-000000001103",outsider="00000000-0000-4000-8000-000000001104",account="a".repeat(64),source="b".repeat(64);
async function fixture(){const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema extensions;
 create function extensions.digest(value text,algorithm text)returns bytea language sql immutable as $$select decode(md5(value)||md5(value||algorithm),'hex')$$;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${actor}'),('${outsider}');
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.sellerpilot_is_admin()returns boolean language sql stable security definer as $$select auth.uid()=any(array['${owner}'::uuid,'${actor}'::uuid])$$;
 create schema sellerpilot_private;
 create table sellerpilot_private.channel_credentials(id uuid primary key,created_by uuid,channel text,status text,seller_account_key text,seller_account_key_source text);
 create table sellerpilot_private.support_tickets(id uuid primary key default gen_random_uuid(),owner_id uuid,external_ticket_id text,channel_key text,customer_name text,subject text,message text,status text,priority integer,received_at timestamptz,resolved_at timestamptz,demo boolean,updated_at timestamptz,source_credential_id uuid,seller_account_key text,reply_context jsonb,provider_context jsonb,provider_status text,latest_inbound_key text,external_order_reference text,ticket_kind text,order_id uuid,unique(owner_id,channel_key,external_ticket_id));
 create table sellerpilot_private.support_inbound_messages(id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,inbound_key text,remote_message_id text,sender_role text,body text,provider_context jsonb,received_at timestamptz,unique(owner_id,channel_key,inbound_key));
 insert into sellerpilot_private.channel_credentials values('${credential}','${owner}','qoo10','active','${account}','provider_certified_v1');
 `);await db.exec(migration);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);return db;}
const row=(rowNumber,rowDigest,sourceRecordId=null)=>({rowNumber,rowDigest,sourceRecordId,externalTicketId:sourceRecordId?"T-1":null,remoteMessageId:sourceRecordId,customerName:"buyer",subject:"same",message:"same",status:"waiting",priority:3,receivedAt:"2026-09-01T00:00:00.000Z",senderRole:"customer",ticketKind:"conversation",externalOrderReference:null,providerContext:{}});
async function begin(db,digest=source,count=2){return(await db.query("select public.sellerpilot_begin_cs_import_v1($1,'qoo10','normalized_json_v1',$2,$3,'history.json',$4) result",[credential,digest,account,count])).rows[0].result;}
test("preview and cancel preserve every existing ticket",async()=>{const db=await fixture();try{
 await db.exec(`insert into sellerpilot_private.support_tickets(owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,priority,received_at,demo,updated_at)values('${owner}','existing','qoo10','x','x','x','waiting',3,now(),false,now())`);
 const batch=await begin(db);await db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb)",[batch.batchId,source,JSON.stringify([row(1,"c".repeat(64)),row(2,"d".repeat(64))])]);
 const cancelled=(await db.query("select public.sellerpilot_cancel_cs_import_v1($1) result",[batch.batchId])).rows[0].result;
 assert.equal(cancelled.existingDataChanged,false);assert.equal((await db.query("select count(*)::int count from sellerpilot_private.support_tickets")).rows[0].count,1);
}finally{await db.close();}});
test("commit imports ID-less twins separately and exact source reuse creates no duplicate",async()=>{const db=await fixture();try{
 const batch=await begin(db);const staged=(await db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb) result",[batch.batchId,source,JSON.stringify([row(1,"c".repeat(64)),row(2,"d".repeat(64))])])).rows[0].result;
 assert.equal(staged.status,"preview_ready");const committed=(await db.query("select public.sellerpilot_commit_cs_import_v1($1) result",[batch.batchId])).rows[0].result;
 assert.equal(committed.importedRowCount,2);assert.equal((await db.query("select count(*)::int count from sellerpilot_private.support_tickets")).rows[0].count,2);
 const reused=await begin(db);assert.equal(reused.batchId,batch.batchId);assert.equal(reused.status,"committed");
 assert.equal((await db.query("select count(*)::int count from sellerpilot_private.support_inbound_messages")).rows[0].count,2);
}finally{await db.close();}});
test("source account mismatch is rejected before staging",async()=>{const db=await fixture();try{
 await assert.rejects(db.query("select public.sellerpilot_begin_cs_import_v1($1,'qoo10','normalized_json_v1',$2,$3,'bad.json',1)",[credential,source,"e".repeat(64)]),/CS_IMPORT_ACCOUNT_MISMATCH/);
}finally{await db.close();}});
test("a shared administrator imports through the credential owner's immutable lineage",async()=>{const db=await fixture();try{
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
 const batch=await begin(db,source,1);
 assert.equal((await db.query("select owner_id from sellerpilot_private.cs_import_batches where id=$1",[batch.batchId])).rows[0].owner_id,owner);
 await db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb)",[batch.batchId,source,JSON.stringify([row(1,"c".repeat(64),"provider-1")])]);
 await db.query("select public.sellerpilot_commit_cs_import_v1($1)",[batch.batchId]);
 assert.equal((await db.query("select owner_id from sellerpilot_private.support_tickets limit 1")).rows[0].owner_id,owner);
}finally{await db.close();}});
test("a non-administrator cannot access a shared import batch",async()=>{const db=await fixture();try{
 const batch=await begin(db,source,1);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[outsider]);
 await assert.rejects(db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb)",[batch.batchId,source,JSON.stringify([row(1,"c".repeat(64))])]),/administrator access required/);
 await assert.rejects(db.query("select public.sellerpilot_cancel_cs_import_v1($1)",[batch.batchId]),/administrator access required/);
}finally{await db.close();}});
test("preview pages show actual rows and change to duplicate after commit",async()=>{const db=await fixture();try{
 const batch=await begin(db);await db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb)",[batch.batchId,source,JSON.stringify([row(1,"c".repeat(64),"provider-1"),row(2,"d".repeat(64),null)])]);
 const first=(await db.query("select public.sellerpilot_get_cs_import_preview_v1($1,0,1) result",[batch.batchId])).rows[0].result;
 assert.equal(first.rows.length,1);assert.equal(first.rows[0].rowNumber,1);assert.equal(first.rows[0].outcome,"new_ticket");assert.equal(first.nextAfterRowNumber,1);
 const second=(await db.query("select public.sellerpilot_get_cs_import_preview_v1($1,$2,1) result",[batch.batchId,first.nextAfterRowNumber])).rows[0].result;
 assert.equal(second.rows[0].rowNumber,2);assert.equal(second.nextAfterRowNumber,null);
 await db.query("select public.sellerpilot_commit_cs_import_v1($1)",[batch.batchId]);
 const committed=(await db.query("select public.sellerpilot_get_cs_import_preview_v1($1,0,2) result",[batch.batchId])).rows[0].result;
 assert.ok(committed.rows.every(item=>item.outcome==="duplicate_message"));
 const retried=(await db.query("select public.sellerpilot_commit_cs_import_v1($1) result",[batch.batchId])).rows[0].result;
 assert.equal(retried.status,"committed");assert.equal(retried.importedRowCount,2);
}finally{await db.close();}});
test("cancel is idempotent and never changes existing tickets",async()=>{const db=await fixture();try{
 const batch=await begin(db,source,1);const first=(await db.query("select public.sellerpilot_cancel_cs_import_v1($1) result",[batch.batchId])).rows[0].result;
 const second=(await db.query("select public.sellerpilot_cancel_cs_import_v1($1) result",[batch.batchId])).rows[0].result;
 assert.deepEqual(second,first);assert.equal((await db.query("select count(*)::int count from sellerpilot_private.support_tickets")).rows[0].count,0);
}finally{await db.close();}});
test("provider message dedupe is isolated by seller account",async()=>{const db=await fixture();try{
 const secondCredential="00000000-0000-4000-8000-000000001105",secondAccount="e".repeat(64);
 await db.query("insert into sellerpilot_private.channel_credentials values($1,$2,'qoo10','active',$3,'provider_certified_v1')",[secondCredential,owner,secondAccount]);
 const first=await begin(db,source,1);await db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb)",[first.batchId,source,JSON.stringify([row(1,"c".repeat(64),"provider-1")])]);await db.query("select public.sellerpilot_commit_cs_import_v1($1)",[first.batchId]);
 const next=(await db.query("select public.sellerpilot_begin_cs_import_v1($1,'qoo10','normalized_json_v1',$2,$3,'second.json',1) result",[secondCredential,"f".repeat(64),secondAccount])).rows[0].result;
 await db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb)",[next.batchId,"f".repeat(64),JSON.stringify([row(1,"c".repeat(64),"provider-1")])]);await db.query("select public.sellerpilot_commit_cs_import_v1($1)",[next.batchId]);
 assert.equal((await db.query("select count(*)::int count from sellerpilot_private.support_inbound_messages")).rows[0].count,2);
}finally{await db.close();}});
test("stage rejects a chunk from a different source digest",async()=>{const db=await fixture();try{
 const batch=await begin(db,source,1);
 await assert.rejects(db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb)",[batch.batchId,"9".repeat(64),JSON.stringify([row(1,"c".repeat(64))])]),/CS_IMPORT_SOURCE_REUSE_MISMATCH/);
 assert.equal((await db.query("select staged_row_count from sellerpilot_private.cs_import_batches where id=$1",[batch.batchId])).rows[0].staged_row_count,0);
}finally{await db.close();}});
test("a 501-row commit is durable across bounded calls and cannot be cancelled halfway",async()=>{const db=await fixture();try{
 const digest="8".repeat(64);const batch=await begin(db,digest,501);
 const rows=Array.from({length:501},(_,index)=>row(index+1,(index+1).toString(16).padStart(64,"0"),`provider-${index+1}`));
 await db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb)",[batch.batchId,digest,JSON.stringify(rows.slice(0,500))]);
 await db.query("select public.sellerpilot_stage_cs_import_rows_v1($1,$2,$3::jsonb)",[batch.batchId,digest,JSON.stringify(rows.slice(500))]);
 const first=(await db.query("select public.sellerpilot_commit_cs_import_v1($1) result",[batch.batchId])).rows[0].result;
 assert.equal(first.status,"committing");assert.equal(first.importedRowCount,500);assert.equal(first.remainingRowCount,1);assert.equal(first.processedThisCall,500);
 await assert.rejects(db.query("select public.sellerpilot_cancel_cs_import_v1($1)",[batch.batchId]),/CS_IMPORT_CANCEL_NOT_ALLOWED/);
 const second=(await db.query("select public.sellerpilot_commit_cs_import_v1($1) result",[batch.batchId])).rows[0].result;
 assert.equal(second.status,"committed");assert.equal(second.importedRowCount,501);assert.equal(second.remainingRowCount,0);assert.equal(second.processedThisCall,1);
 const retry=(await db.query("select public.sellerpilot_commit_cs_import_v1($1) result",[batch.batchId])).rows[0].result;
 assert.equal(retry.status,"committed");assert.equal(retry.importedRowCount,501);assert.equal(retry.processedThisCall,0);
 assert.equal((await db.query("select count(*)::int count from sellerpilot_private.support_inbound_messages")).rows[0].count,501);
}finally{await db.close();}});
