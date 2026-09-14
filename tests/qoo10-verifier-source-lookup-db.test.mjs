import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const historical=await readFile(new URL('../supabase/migrations/20260831144000_generalize_qoo10_exact_localization_s1_activation.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260914154000_bound_qoo10_verifier_source_lookup.sql',import.meta.url),'utf8');
const matcher=historical.slice(historical.indexOf('create or replace function sellerpilot_private.qoo10_exact_s1_verifier_job_matches('),historical.indexOf('create or replace function sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()'));
const guard=historical.slice(historical.indexOf('create or replace function sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()'),historical.indexOf('drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;'));
const listing='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc';
const source='fac9c5c4-940d-4600-88f3-8f97a069dfbf';
const verifier='10000000-0000-4000-8000-000000000001';
const ebay='10000000-0000-4000-8000-000000000002';
const payload={periodicKey:`qoo10-exact-s1:${source}`,arguments:{publicationReviewSourceJobId:source,sellerpilotReadOnly:true,sellerpilotQoo10ExactS1Recovery:'qoo10_exact_s1_verifier_v1',publicationReviewId:listing,remoteId:'1217336970',publicationExpectedLocale:'ja-JP'}};
async function setup(){
 const db=new PGlite();
 await db.exec(`create schema sellerpilot_private;
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,listing_id uuid,channel text,operation text,credential_id uuid,seller_account_key text,request_fingerprint text,request_payload jsonb,status text);
 create function sellerpilot_private.qoo10_exact_s1_legacy_source_is_current() returns boolean language sql as $$select true$$;
 create function sellerpilot_private.qoo10_exact_localization_v2_source_is_current(uuid,text) returns boolean language sql as $$select false$$;
 ${matcher}${guard}`);
 // Assert real historical bodies still have the deployed preimages; no fixture
 // replacement of the matcher or trigger is used.
 await db.exec(migration);
 await db.query(`insert into sellerpilot_private.channel_gateway_jobs values($1,$2,'qoo10','listing.update',null,null,null,'{}','reconciliation_required'),($3,null,'ebay','inquiries.list',null,null,null,'{}','queued')`,[source,listing,ebay]);
 await db.query(`insert into sellerpilot_private.channel_gateway_jobs values($1,$2,'qoo10','listing.publication.verify','2b49d081-5188-4a75-9555-e0a6438e8a2b','2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46',$3,$4,'queued')`,[verifier,listing,'a'.repeat(64),payload]);
 await db.exec(`create trigger verifier_guard before insert or update or delete on sellerpilot_private.channel_gateway_jobs for each row execute function sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap();`);
 return db;
}
test('unrelated eBay credential rebind succeeds; active verifier still locks full source UPDATE and DELETE',async()=>{
 const db=await setup();try{
  await db.query(`update sellerpilot_private.channel_gateway_jobs set credential_id='20000000-0000-4000-8000-000000000001' where id=$1`,[ebay]);
  await assert.rejects(db.query(`update sellerpilot_private.channel_gateway_jobs set credential_id='20000000-0000-4000-8000-000000000001' where id=$1`,[source]),/source is locked/);
  await assert.rejects(db.query(`delete from sellerpilot_private.channel_gateway_jobs where id=$1`,[source]),/source is locked/);
 }finally{await db.close();}
});
test('overlapping listing work and invalid verifier source remain rejected',async()=>{
 const db=await setup();try{
  await assert.rejects(db.query(`insert into sellerpilot_private.channel_gateway_jobs(id,listing_id,channel,operation,status,request_payload) values('20000000-0000-4000-8000-000000000002',$1,'qoo10','price.update','queued','{}')`,[listing]),/overlaps the exact Qoo10/);
  await assert.rejects(db.query(`update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(jsonb_set(request_payload,'{arguments,publicationReviewSourceJobId}','"30000000-0000-4000-8000-000000000001"'),'{periodicKey}','"qoo10-exact-s1:30000000-0000-4000-8000-000000000001"') where id=$1`,[verifier]),/overlap is not current/);
 }finally{await db.close();}
});
test('patched body differs only by the three logically implied candidate predicates',async()=>{
 const db=await setup();try{
  const result=await db.query(`select prosrc from pg_proc where oid='sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()'::regprocedure`);
  const original=guard.match(/as \$\$([\s\S]*?)\$\$;/)[1];
  const before='     where verifier.id is distinct from old.id';
  const after="     where verifier.listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid\n       and verifier.channel = 'qoo10'\n       and verifier.operation = 'listing.publication.verify'\n       and verifier.id is distinct from old.id";
  assert.equal(result.rows[0].prosrc,original.replace(before,after));
  for(const field of ['listing_id','channel','operation']){
   const altered=await db.query(`select sellerpilot_private.qoo10_exact_s1_verifier_job_matches(jsonb_populate_record(null::sellerpilot_private.channel_gateway_jobs,to_jsonb(j)||jsonb_build_object($1::text,null))) as matches from sellerpilot_private.channel_gateway_jobs j where id=$2`,[field,verifier]);
   assert.equal(altered.rows[0].matches,false);
  }
 }finally{await db.close();}
});
test('deployment fails closed when a reviewed matcher preimage changes',async()=>{
 const db=await setup();try{
  await assert.rejects(db.exec(migration),/QOO10_VERIFIER_SOURCE_LOOKUP_PREIMAGE_DRIFT/);
  await db.exec('rollback');
 }finally{await db.close();}
});
