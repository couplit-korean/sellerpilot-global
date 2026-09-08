import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { z } from 'zod';
import { PGlite } from '@electric-sql/pglite';
import * as contract from '../lib/cs/draft-contract.ts';
import { runCsDraftJob } from '../scripts/cs-draft-worker.mjs';
const token='spw_local_fixture_identity_1234567890';
const hash=createHash('sha256').update(token).digest('hex');
const adminId='00000000-0000-4000-8000-000000000001',ticketId='00000000-0000-4000-8000-000000000002',jobId='00000000-0000-4000-8000-000000000003';
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema sellerpilot_private;
 create table auth.users(id uuid primary key);insert into auth.users values('${adminId}');
 create function auth.uid() returns uuid language sql as $$select '${adminId}'::uuid$$;
 create function public.sellerpilot_is_admin() returns boolean language sql as $$select true$$;
 create table sellerpilot_private.support_tickets(id uuid primary key,owner_id uuid,latest_inbound_key text,channel_key text,subject text,message text,demo boolean);
 insert into sellerpilot_private.support_tickets values('${ticketId}','${adminId}','inbound1','elevenst','배송 문의','상품 배송 상태를 확인해 주세요.',false);
 create function sellerpilot_private.worker_token_has_scope(h text,s text,a boolean) returns boolean language sql as $$select h='${hash}' and s='ai'$$;
 create function sellerpilot_private.lazada_im_ticket_projection_state_v1(uuid,timestamptz) returns text language sql as $$select 'normal'::text$$;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20260908172414_isolate_cs_reply_draft_queue.sql',import.meta.url),'utf8'));
 const rpc=role=>async(name,args)=>{
  assert.match(name,/^sellerpilot_(?:create|get|cancel|claim|touch|complete)_cs_reply_draft$/);
  assert.ok(Object.keys(args).every(key=>/^p_[a-z_]+$/.test(key)));
  await db.exec(`reset role;set role ${role}`);
  try{const values=Object.values(args);const result=await db.query(`select public.${name}(${Object.keys(args).map((key,i)=>`${key} => $${i+1}`).join(',')}) value`,values);return {data:result.rows[0].value,error:null};}
  catch(error){return {data:null,error:{message:error.message,code:error.code}};}
 };
 function load(kind){
  const path=kind==='admin'?'../app/api/admin/cs/drafts/route.ts':'../app/api/cs/worker/drafts/route.ts';
  const compiled=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};vm.runInNewContext(compiled,{exports,Request,Response,URL,process:{env:{SUPABASE_SECRET_KEY:'fixture-local-only'}},require(name){
   if(name==='next/server')return {NextResponse:Response};if(name==='zod')return {z};if(name==='node:crypto')return {createHash};
   if(name==='@supabase/supabase-js')return {createClient:()=>({rpc:rpc('service_role')})};
   if(name.endsWith('/admin-api'))return {authenticateAdminRequest:async()=>({userClient:{rpc:rpc('authenticated')}}),isAdminApiError:()=>false};
   if(name.endsWith('/cs/draft-contract'))return contract;
   if(name.endsWith('/supabase/config'))return {supabaseUrl:'https://fixture.invalid'};
   if(name.endsWith('/worker-rpc'))return {createBoundedSupabaseFetch:()=>()=>{throw new Error('No external transport expected');},workerRpcErrorStatus:error=>error.code==='42501'?401:503};
   throw new Error(`Unexpected dependency ${name}`);
  }});
  return exports;
 }
 // The production route configures a bounded fetch; it must never invoke it in
 // this DB fixture. Return the trap itself rather than executing it at setup.
 return {db,load};
}
const request=(body,worker=false)=>new Request('https://fixture.invalid/api/cs',{method:'POST',headers:worker?{authorization:`Bearer ${token}`}:{},body:JSON.stringify(body)});
test('Actual CS admin API -> isolated SQL queue -> actual worker API -> draft runner -> SQL completion -> admin readback',async()=>{
 const {db,load}=await fixture();try{
  const admin=load('admin'),worker=load('worker');
  const queued=await admin.POST(request({jobId,ticketId,expectedInboundKey:'inbound1',targetLocale:'ko-KR'}));assert.equal(queued.status,202);
  const workerRpc=async body=>{const response=await worker.POST(request(body,true));assert.equal(response.status,200,await response.clone().text());return response.json();};
  const claim=await workerRpc({action:'claim'});assert.equal(claim.id,jobId);assert.equal(claim.request.order,null);
  const result={mode:'support-reply',targetLocale:'ko-KR',draft:'문의해 주셔서 감사합니다. 배송 상태를 확인한 뒤 안내드리겠습니다.',sourceSummary:'문의 원문',cautions:[]};
  assert.deepEqual(await runCsDraftJob(claim,{rpc:workerRpc,generate:async()=>result}),{status:'completed'});
  const read=await admin.GET(new Request(`https://fixture.invalid/api/admin/cs/drafts?id=${jobId}`));assert.equal(read.status,200);assert.equal((await read.json()).result.draft,result.draft);
  const replay=await workerRpc({action:'complete',jobId,claimToken:claim.claim_token,status:'succeeded',result});assert.equal(replay.status,'replayed');
  const bad=await worker.POST(request({action:'complete',jobId,claimToken:claim.claim_token,status:'succeeded',result:{mode:'studio'}},true));assert.equal(bad.status,400);
 }finally{await db.close();}
});
