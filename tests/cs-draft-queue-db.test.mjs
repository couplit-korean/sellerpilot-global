import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration = await readFile(new URL('../supabase/migrations/20260908172414_isolate_cs_reply_draft_queue.sql',import.meta.url),'utf8');
const A='00000000-0000-4000-8000-000000000001', B='00000000-0000-4000-8000-000000000002';
const T='00000000-0000-4000-8000-000000000101', J='00000000-0000-4000-8000-000000000201';
const hash='a'.repeat(64);
async function fixture(legacy = false) {
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema sellerpilot_private;
 create table auth.users(id uuid primary key); insert into auth.users values('${A}'),('${B}');
 create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
 create function public.sellerpilot_is_admin() returns boolean language sql stable as 'select auth.uid() in (''${A}''::uuid,''${B}''::uuid)';
 create table sellerpilot_private.support_tickets(id uuid primary key,owner_id uuid,latest_inbound_key text,channel_key text,subject text,message text,demo boolean default false);
 insert into sellerpilot_private.support_tickets values('${T}','${A}','generation1','elevenst','Fixture subject','Fixture customer question',false);
 create table sellerpilot_private.worker_identity(token_hash text,scope text,status text,expires_at timestamptz);
 insert into sellerpilot_private.worker_identity values('${hash}','ai','active',now()+interval '1 day'),('${'b'.repeat(64)}','gateway','active',now()+interval '1 day');
 create function sellerpilot_private.worker_token_has_scope(h text,s text,a boolean) returns boolean language sql stable as
 'select exists(select 1 from sellerpilot_private.worker_identity where token_hash=h and scope=s and status=''active'' and expires_at>clock_timestamp())';
 create function sellerpilot_private.lazada_im_ticket_projection_state_v1(uuid,timestamptz) returns text language sql stable as $$select 'recalled'::text$$;
 `);
 if (legacy) await db.exec(`create table sellerpilot_private.ai_cli_jobs(id uuid primary key,created_by uuid,kind text,status text,request_payload jsonb,result_payload jsonb,error_message text,created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz,lease_expires_at timestamptz);
 insert into sellerpilot_private.ai_cli_jobs(id,created_by,kind,status,request_payload,lease_expires_at) values
 ('${J}','${A}','support_reply','running','{"ticket_id":"${T}","sellerpilotInboundKey":"generation1","target_locale":"ko-KR","tone":"polite","order":{"product":"must not copy"}}',now()+interval '1 hour'),
 ('00000000-0000-4000-8000-000000000203','${A}','studio','running','{}',now()+interval '1 hour');`);
 await db.exec(migration);
 return db;
}
const enqueue=(db,id=J,key='generation1')=>db.query('select public.sellerpilot_create_cs_reply_draft($1,$2,$3,$4,$5) value',[id,T,key,'ko-KR','polite']);
async function claim(db) { await db.exec('reset role; set role service_role'); return (await db.query('select public.sellerpilot_claim_cs_reply_draft($1) value',[hash])).rows[0].value; }
const result={mode:'support-reply',targetLocale:'ko-KR',draft:'문의해 주셔서 감사합니다. 내용을 확인하겠습니다.',sourceSummary:'Fixture evidence',cautions:[]};
const complete=(db,c,status='succeeded',value=result)=>db.query('select public.sellerpilot_complete_cs_reply_draft($1,$2,$3,$4,$5,$6) value',[hash,c.id,c.claim_token,status,value,status==='failed'?'fixture failure':null]);
test('CS-only DB queue executes with shared admin, own claim, immutable replay, and no product tables',async()=>{
 const db=await fixture();try{
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${B}'`);
  await enqueue(db); await enqueue(db);
  await assert.rejects(enqueue(db,J,'other'),/INQUIRY_CONTEXT_STALE/);
  const c=await claim(db); assert.equal(c.id,J);assert.equal(c.request.order,null);assert.equal(c.request.sellerpilotInboundKey,'generation1');
  assert.equal((await complete(db,c)).rows[0].value,'completed');
  assert.equal((await complete(db,c)).rows[0].value,'replayed');
  await assert.rejects(complete(db,c,'succeeded',{...result,draft:'다른 초안으로 바꾸면 원장 대조에 실패해야 합니다.'}),/REPLAY_MISMATCH/);
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${A}'`);
  const read=(await db.query('select public.sellerpilot_get_cs_reply_draft($1) value',[J])).rows[0].value;
  assert.equal(read.status,'succeeded'); assert.equal(read.result.draft,result.draft);assert.equal('worker_token_hash' in read,false);
  await assert.rejects(db.query('select * from sellerpilot_private.cs_reply_draft_jobs'),/permission denied/);
 }finally{await db.close();}
});
test('Expired claims, revoked tokens, changed customer generation and cancellation cannot save drafts',async()=>{
 const db=await fixture();try{
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${B}'`);await enqueue(db);const first=await claim(db);
  await db.exec(`reset role; update sellerpilot_private.cs_reply_draft_jobs set lease_expires_at=now()-interval '1 second' where id='${J}'`);
  const second=await claim(db);assert.notEqual(first.claim_token,second.claim_token);assert.equal(second.attempt_count,2);
  assert.equal((await complete(db,first)).rows[0].value,'lease_lost');
  await db.exec(`reset role; update sellerpilot_private.support_tickets set latest_inbound_key='generation2' where id='${T}';set role service_role`);
  assert.equal((await complete(db,second)).rows[0].value,'stale');
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${B}'`);
  const next='00000000-0000-4000-8000-000000000202';await enqueue(db,next,'generation2');const third=await claim(db);
  await db.exec(`reset role; set role authenticated`);assert.equal((await db.query('select public.sellerpilot_cancel_cs_reply_draft($1) value',[next])).rows[0].value,true);
  await db.exec('reset role; set role service_role');assert.equal((await complete(db,third)).rows[0].value,'lease_lost');
  await assert.rejects(db.query('select public.sellerpilot_claim_cs_reply_draft($1)',['b'.repeat(64)]),/authentication required/);
  await db.exec(`reset role; update sellerpilot_private.worker_identity set status='revoked';set role service_role`);
  await assert.rejects(db.query('select public.sellerpilot_touch_cs_reply_draft($1,$2,$3)',[hash,third.id,third.claim_token]),/authentication required/);
 }finally{await db.close();}
});
test('CS draft queue rejects unauthorized admins and recalled Lazada messages',async()=>{
 const db=await fixture();try{
  await db.exec('set role anon');await assert.rejects(enqueue(db),/permission denied/);
  await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'");await assert.rejects(enqueue(db),/administrator access required/);
  await db.exec(`reset role;update sellerpilot_private.support_tickets set channel_key='lazada';set role authenticated;set request.jwt.claim.sub='${B}'`);
  await assert.rejects(enqueue(db),/LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
 }finally{await db.close();}
});

test('Migration adopts existing CS jobs and revokes only their old leases without changing a running product job',async()=>{
 const db=await fixture(true);try{
  const old=(await db.query('select id,status,lease_expires_at from sellerpilot_private.ai_cli_jobs order by id')).rows;
  assert.equal(old[0].status,'cancelled');assert.equal(old[0].lease_expires_at,null);assert.equal(old[1].status,'running');assert.ok(old[1].lease_expires_at);
  const adopted=(await db.query('select * from sellerpilot_private.cs_reply_draft_jobs')).rows;
  assert.equal(adopted.length,1);assert.equal(adopted[0].status,'queued');assert.equal(adopted[0].request_payload.order,null);
  const claimed=await claim(db);assert.equal(claimed.id,J);assert.equal(claimed.request.sellerpilotInboundKey,'generation1');
 }finally{await db.close();}
});
