import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const before=await readFile(new URL('./fixtures/async-channel-diagnostics-before.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260912214500_persist_async_channel_diagnostics.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const db=new PGlite();await db.exec(`create schema sellerpilot_private;
 create table sellerpilot_private.ai_cli_worker_tokens(id uuid,token_hash text,scope text,status text,expires_at timestamptz);
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,credential_id uuid,channel text,operation text,status text,worker_token_id uuid,claim_token uuid,lease_expires_at timestamptz,created_at timestamptz default now());
 create table sellerpilot_private.gateway_completion_receipts(job_id uuid,claim_token uuid,worker_token_id uuid,completion_fingerprint text,continuation_job_id uuid);
 create table sellerpilot_private.test_diagnostics(credential_id uuid,status text,message text);
 create function sellerpilot_private.worker_token_may_complete_gateway_job(text,uuid,uuid) returns boolean language sql as $$select $1='valid'$$;
 create function sellerpilot_private.gateway_completion_fingerprint(text,jsonb,text,jsonb,jsonb,jsonb,jsonb) returns text language sql as $$select md5(concat_ws('|',$1,$2::text,$3,$4::text,$5::text,$6::text,$7::text))$$;
 create function public.sellerpilot_record_credential_test(uuid,text,text) returns void language sql as $$insert into sellerpilot_private.test_diagnostics values($1,$2,$3)$$;
 -- Completion dependency models only the terminal state CAS, and is deliberately
 -- allowed to fail so rollback of the preceding diagnostic write is exercised.
 create function public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text) returns boolean language plpgsql as $$begin
 if $5->>'forceCompletionFailure'='true' then return false;end if;
 update sellerpilot_private.channel_gateway_jobs set status=$4 where id=$2 and claim_token=$3 and status='running';return found;end$$;
 insert into sellerpilot_private.ai_cli_worker_tokens values('${id(1)}','valid','gateway','active',now()+interval '1 hour');
 insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,operation,status,worker_token_id,claim_token,lease_expires_at) values('${id(2)}','${id(3)}','temu','diagnostic.test','running','${id(1)}','${id(4)}',now()+interval '10 minutes');`);
 await db.exec(before);return db;
}
async function complete(db,{token='valid',claim=id(4),status='passed',extra={},mismatch=false}={}){
 const diagnostic={status,message:'verified provider read'};
 return (await db.query(`select public.sellerpilot_056700_complete_gateway_before_qoo10_s1_activation($1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,$5::jsonb) result`,[token,id(2),claim,JSON.stringify({channel:'temu',operation:'diagnostic.test',ok:status==='passed',diagnostic,...extra}),JSON.stringify(mismatch?{status:'failed',message:'other'}:diagnostic)])).rows[0].result;
}
async function records(db){return (await db.query('select * from sellerpilot_private.test_diagnostics')).rows;}
test('actual live preimage omits non-refresh diagnostic; fix records once with atomic replay',async()=>{
 const old=await fixture();try{await complete(old);assert.equal((await records(old)).length,0);}finally{await old.close();}
 for(const status of ['passed','failed','manual']){const db=await fixture();try{
 await db.exec(migration);assert.equal((await complete(db,{status})).status,'completed');
 assert.equal((await records(db))[0].status,status);await complete(db,{status});assert.equal((await records(db)).length,1);
 }finally{await db.close();}}
});
test('invalid token, claim and mismatching evidence cannot record; terminal failure rolls recording back',async()=>{
 const db=await fixture();try{await db.exec(migration);
 await assert.rejects(complete(db,{token:'invalid'}),/invalid atomic/);
 assert.equal((await complete(db,{claim:id(9)})).status,'ownership_lost');
 await assert.rejects(complete(db,{mismatch:true}),/does not match response/);
 await assert.rejects(complete(db,{extra:{forceCompletionFailure:true}}),/claim changed/);
 assert.equal((await records(db)).length,0);
 }finally{await db.close();}
});
test('older completion cannot overwrite newer requested diagnostic',async()=>{
 const db=await fixture();try{await db.exec(migration);await db.exec(`insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,operation,status,created_at) values('${id(5)}','${id(3)}','diagnostic.test','queued',now()+interval '1 minute')`);
 await complete(db);assert.equal((await records(db)).length,0);
 }finally{await db.close();}
});
test('changed production definition stops migration',async()=>{
 const db=await fixture();try{await db.exec(migration);await assert.rejects(db.exec(migration),/ASYNC_DIAGNOSTIC_PREIMAGE_CHANGED/);await db.exec('rollback');}finally{await db.close();}
});
