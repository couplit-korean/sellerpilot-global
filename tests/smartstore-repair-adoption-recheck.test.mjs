import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createUncertainRepairDatabase } from './smartstore-repair-uncertain-readback.test.mjs';
import { claim, complete, ids, job, workerVersion } from './smartstore-adoption-gateway-migration.test.mjs';
const migrationPath = '../supabase/migrations/20260907175400_smartstore_repair_adoption_recheck.sql';
const migrations = async name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8');
async function call(db,name) { return (await db.query(`select public.${name}($1,$2) result`,[ids.owner,ids.product])).rows[0].result; }
const enqueueCapture = db => call(db,'sellerpilot_service_enqueue_smartstore_repair_result_readback');
const enqueueRecheck = db => call(db,'sellerpilot_service_enqueue_smartstore_adoption_recheck');
const recheckStatus = db => call(db,'sellerpilot_service_get_smartstore_adoption_recheck');
async function preserved(db) {
 return (await db.query(`select jsonb_build_object(
  'jobs',(select jsonb_agg(to_jsonb(j) order by id) from sellerpilot_private.channel_gateway_jobs j where operation in ('listing.create','listing.update')),
  'permits',(select jsonb_agg(to_jsonb(p) order by id) from sellerpilot_private.smartstore_existing_content_repair_permits p),
  'completions',(select jsonb_agg(to_jsonb(c) order by job_id) from sellerpilot_private.smartstore_existing_content_repair_completion_receipts c),
  'capture',(select jsonb_agg(to_jsonb(r) order by id) from sellerpilot_private.smartstore_repair_uncertain_readback_receipts r)
 ) value`)).rows[0].value;
}
async function setup() {
 const {db,successor,proof}=await createUncertainRepairDatabase();
 try {
  const queued=await enqueueCapture(db); const capturedJob=await claim(db,'recovery'); assert.equal(capturedJob.id,queued.readbackJobId);
  const evidence=structuredClone(proof.postwriteReadback); evidence.observedAt=new Date().toISOString();
  const capture=await complete(db,capturedJob,'succeeded',evidence); assert.equal(capture.reason,'UNCERTAIN_REPAIR_READBACK_CAPTURED');
  await db.exec(await migrations('20260907151000_smartstore_scoped_publication_gate.sql'));
  await db.exec(await migrations('20260907175300_smartstore_content_verifier_naver_canonicalization.sql'));
  await db.exec(await readFile(new URL(migrationPath,import.meta.url),'utf8'));
  return {db,successor,proof,capturedJob};
 } catch(error) {await db.close();throw error;}
}

test('one fresh read-only recheck adopts current remote state and resolves both uncertain repairs without rewriting them',async()=>{
 const {db,successor,proof,capturedJob}=await setup();
 try {
  const before=await preserved(db);
  const queued=await enqueueRecheck(db); assert.equal(queued.status,'queued');
  const repeated=await enqueueRecheck(db); assert.equal(repeated.jobId,queued.jobId); assert.equal(repeated.reused,true);
  assert.equal(await claim(db,'recovery',workerVersion.replace('88888888','77777777')),null);
  const claimed=await claim(db,'recovery'); assert.equal(claimed.id,queued.jobId);
  const fresh=structuredClone(proof.postwriteReadback); fresh.observedAt=new Date().toISOString();
  const result=await complete(db,claimed,'succeeded',fresh);
  assert.equal(result.status,'verified',JSON.stringify(result)); assert.ok(result.receiptId); assert.ok(result.attestationId);
  const verified=await recheckStatus(db); assert.equal(verified.status,'verified'); assert.equal(verified.providerMutationPerformed,false); assert.equal(verified.contentVerified,true);
  assert.deepEqual(await preserved(db),before);
  const mutations=(await db.query(`select id,sellerpilot_private.listing_mutation_reconciliation_resolved(id) resolved from sellerpilot_private.channel_gateway_jobs where operation in ('listing.create','listing.update') order by id`)).rows;
  assert.equal(mutations.length,3); assert.equal(mutations.every(row=>row.resolved),true);
  const gate = (await db.query('select public.sellerpilot_service_listing_mutation_release_gate_status() value')).rows[0].value;
  assert.equal(gate.smartstoreReconciliationRequired,0);
  const repairState = await call(db,'sellerpilot_service_get_smartstore_content_repair_status');
  assert.equal(repairState.reason,'POST_REPAIR_REMOTE_STATE_VERIFIED');
  assert.equal(repairState.providerMutationPerformed,false);
  assert.equal(repairState.verificationJobId,claimed.id);
  assert.equal((await job(db,claimed.id)).provider_mutation_started_at,null);
  assert.equal((await job(db,capturedJob.id)).status,'reconciliation_required');
  assert.equal((await job(db,successor.id)).status,'reconciliation_required');
  const listing=(await db.query('select status,remote_id from sellerpilot_private.product_listings where id=$1',[ids.listing])).rows[0];
  assert.equal(listing.remote_id,'13688607602'); assert.notEqual(listing.status,'failed');
  const replay=await complete(db,claimed,'succeeded',fresh); assert.equal(replay.reused,true);
  const different=structuredClone(fresh); different.observedAt=new Date(Date.now()+1).toISOString();
  assert.equal((await complete(db,claimed,'succeeded',different)).reason,'COMPLETION_REPLAY_MISMATCH');
  const afterReplay=await recheckStatus(db); assert.equal(afterReplay.jobId,queued.jobId);
  await assert.rejects(db.exec('update sellerpilot_private.smartstore_repair_adoption_recheck_completions set readback_sha256=readback_sha256'),/IMMUTABLE/u);
 }finally{await db.close();}
});

test('stale or pre-enqueue evidence, changed image order, and protected-field drift cannot adopt or resolve prior mutations',async()=>{
 for(const kind of ['stale','pre_enqueue','pixels','protected_price','protected_delivery']) {
  const {db,proof}=await setup();
  try {
   const before=await preserved(db);
   const preEnqueueObservedAt=kind==='pre_enqueue'
    ? new Date(Date.now()-5_000).toISOString() : null;
   await enqueueRecheck(db); const claimed=await claim(db,'recovery');
   const fresh=structuredClone(proof.postwriteReadback);
   fresh.observedAt=kind==='stale'?'2020-01-01T00:00:00Z'
    : preEnqueueObservedAt ?? new Date().toISOString();
   if(kind==='pixels') [fresh.detailImagePixelSha256s[0],fresh.detailImagePixelSha256s[1]]=[fresh.detailImagePixelSha256s[1],fresh.detailImagePixelSha256s[0]];
   if(kind==='protected_price') for(const key of ['originReadback','channelReadback']) fresh[key].response.originProduct.salePrice=4000;
   if(kind==='protected_delivery') for(const key of ['originReadback','channelReadback']) fresh[key].response.originProduct.deliveryInfo={deliveryType:'CHANGED'};
   const result=await complete(db,claimed,'succeeded',fresh); assert.notEqual(result.status,'verified');
   assert.deepEqual(await preserved(db),before);
   assert.equal((await db.query('select count(*)::int n from sellerpilot_private.smartstore_manual_adoption_attestations')).rows[0].n,0);
   assert.notEqual((await enqueueRecheck(db)).status,'queued');
  }finally{await db.close();}
 }
});

test('failed fresh recheck preserves capture and blocks automatic new verification or provider mutation',async()=>{
 const {db,proof}=await setup();
 try {
  const before=await preserved(db); const queued=await enqueueRecheck(db); const claimed=await claim(db,'recovery');
  const contradictory=structuredClone(proof.postwriteReadback); contradictory.observedAt=new Date().toISOString();
  await assert.rejects(complete(db,claimed,'succeeded',contradictory,'UNEXPECTED_ERROR'),/COMPLETION_INVALID/u);
  await assert.rejects(complete(db,claimed,'succeeded',{...contradictory,overflow:'x'.repeat(2097153)}),/COMPLETION_INVALID/u);
  await complete(db,claimed,'failed',null,'READBACK_NETWORK_FAILED');
  assert.deepEqual(await preserved(db),before);
  const repeated=await enqueueRecheck(db); assert.equal(repeated.jobId,queued.jobId); assert.notEqual(repeated.status,'queued');
  assert.equal((await db.query('select count(*)::int n from sellerpilot_private.smartstore_manual_adoption_attestations')).rows[0].n,0);
 }finally{await db.close();}
});
