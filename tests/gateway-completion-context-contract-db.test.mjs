import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const before=await readFile(new URL('./fixtures/gateway-completion-context-before.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260912205436_restore_gateway_completion_request_contract.sql',import.meta.url),'utf8');
const id='00000000-0000-4000-8000-000000000001',claim='00000000-0000-4000-8000-000000000002';
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema sellerpilot_private;
 create table sellerpilot_private.channel_gateway_jobs(id uuid,channel text,operation text,request_payload jsonb,started_at timestamptz,environment text);
 create table sellerpilot_private.coupang_exact_live_invalid_completion_captures(verifier_job_id uuid,claim_token uuid);
 -- Boundary fixture: authentication and replay ownership stay in the existing
 -- wrapper chain. This fixture does not replace tests of that chain itself.
 create function public.sellerpilot_gateway_completion_context_before_coupang_exact_invalid_capture(text,uuid,uuid)
 returns jsonb language sql as $$select case when $1 in ('valid','replay') and $3='${claim}'::uuid then
 jsonb_build_object('id',$2,'channel','elevenst','operation','inquiries.list','status',case when $1='replay' then 'completed_replay' else 'running' end,'existingEvidence','retained') else null end$$;
 insert into sellerpilot_private.channel_gateway_jobs values('${id}','elevenst','inquiries.list','{"arguments":{"page":3,"source":"product_qna"}}','2026-09-12T20:00:00Z','production');`);
 await db.exec(before);return db;
}
const context=async(db,token='valid',job=id,claimToken=claim)=>(await db.query('select public.sellerpilot_service_gateway_completion_context($1,$2,$3) result',[token,job,claimToken])).rows[0].result;

test('live response lacks request; migration restores exact request and retains validated replay evidence',async()=>{
 const db=await fixture();try{
  assert.equal((await context(db)).request,undefined);
  await db.exec(migration);
  for(const token of ['valid','replay']){
   const result=await context(db,token);
   assert.deepEqual(result.request,{arguments:{page:3,source:'product_qna'}});
   assert.equal(result.existingEvidence,'retained');
   assert.equal(result.status,token==='replay'?'completed_replay':'running');
   assert.equal(result.environment,'production');
  }
 }finally{await db.close();}
});
test('invalid token/claim cannot receive request; authenticated context cannot be enriched from a different job',async()=>{
 const db=await fixture();try{
  await db.exec(migration);
  assert.equal(await context(db,'invalid'),null);
  assert.equal(await context(db,'valid',id,id),null);
  await assert.rejects(context(db,'valid','00000000-0000-4000-8000-000000000099'),/GATEWAY_CONTEXT_JOB_MISMATCH/);
  const acl=(await db.query(`select has_function_privilege('anon','public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)','execute') a,
  has_function_privilege('authenticated','public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)','execute') b,
  has_function_privilege('service_role','public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)','execute') c`)).rows[0];
  assert.deepEqual(acl,{a:false,b:false,c:true});
 }finally{await db.close();}
});
test('migration stops instead of overwriting a changed live definition',async()=>{
 const db=await fixture();try{await db.exec(migration);await assert.rejects(db.exec(migration),/GATEWAY_COMPLETION_CONTEXT_PREIMAGE_CHANGED/);await db.exec('rollback');}finally{await db.close();}
});
