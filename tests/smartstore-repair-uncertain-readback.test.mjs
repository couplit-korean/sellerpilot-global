import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRepairDatabase, createBaseline, enqueueRepair, completeRepair, beginMutation, legacyReadback, repairEvidence } from './smartstore-existing-content-repair-migration.test.mjs';
import { claim, complete, ids, job } from './smartstore-adoption-gateway-migration.test.mjs';
const recovery = await readFile(new URL('../supabase/migrations/20260907175100_smartstore_content_repair_reconciliation_recovery.sql', import.meta.url),'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260907175200_smartstore_repair_uncertain_official_readback.sql', import.meta.url),'utf8');
async function call(db,name) { return (await db.query(`select public.${name}($1,$2) result`,[ids.owner,ids.product])).rows[0].result; }
const enqueueCapture = db => call(db,'sellerpilot_service_enqueue_smartstore_repair_result_readback');
const status = db => call(db,'sellerpilot_service_get_smartstore_repair_result_readback');
async function preserved(db) {
 return (await db.query(`select jsonb_build_object(
  'jobs',(select jsonb_agg(to_jsonb(j) order by id) from sellerpilot_private.channel_gateway_jobs j where operation in ('listing.create','listing.update')),
  'listing',(select to_jsonb(l) from sellerpilot_private.product_listings l where id=$1),
  'permits',(select jsonb_agg(to_jsonb(p) order by id) from sellerpilot_private.smartstore_existing_content_repair_permits p),
  'completions',(select jsonb_agg(to_jsonb(c) order by job_id) from sellerpilot_private.smartstore_existing_content_repair_completion_receipts c)
 ) value`,[ids.listing])).rows[0].value;
}
async function setup() {
 const db=await createRepairDatabase();
 try {
  await createBaseline(db); await enqueueRepair(db);
  const first=await claim(db,'recovery'); assert.equal(await beginMutation(db,first),true);
  await completeRepair(db,first,'reconciliation_required',null,'FIRST_UNCERTAIN');
  await db.exec(recovery);
  await call(db,'sellerpilot_service_enqueue_smartstore_repair_recheck');
  const read=await claim(db,'recovery'); const unchanged=legacyReadback(); unchanged.observedAt=new Date().toISOString();
  await complete(db,read,'succeeded',unchanged);
  const receipt=await call(db,'sellerpilot_service_enqueue_smartstore_repair_recheck'); assert.equal(receipt.status,'verified');
  await enqueueRepair(db); const successor=await claim(db,'recovery'); assert.equal(await beginMutation(db,successor),true);
  await completeRepair(db,successor,'reconciliation_required',null,'COMPLETION_PAYLOAD_REJECTED');
  const proof=await repairEvidence(db,receipt.afterBaselineId);
  await db.exec(migration);
  return {db,successor,proof};
 } catch(error) { await db.close(); throw error; }
}
test('uncertain successor captures one fresh official result without changing mutation or listing records',async()=>{
 const {db,successor,proof}=await setup();
 try {
  const before=await preserved(db);
  const queued=await enqueueCapture(db); assert.equal(queued.status,'queued'); assert.equal(queued.repairJobId,successor.id);
  const repeated=await enqueueCapture(db); assert.equal(repeated.readbackJobId,queued.readbackJobId);
  const claimed=await claim(db,'recovery'); assert.equal(claimed.id,queued.readbackJobId);
  const evidence=proof.postwriteReadback; evidence.observedAt=new Date().toISOString();
  const result=await complete(db,claimed,'succeeded',evidence);
  assert.equal(result.status,'reconciliation_required'); assert.equal(result.reason,'UNCERTAIN_REPAIR_READBACK_CAPTURED');
  const captured=await status(db); assert.equal(captured.status,'captured'); assert.equal(captured.contentVerified,false); assert.equal(captured.normalUpdateEligible,false);
  const raw=(await db.query('select official_readback from sellerpilot_private.smartstore_repair_uncertain_readback_receipts')).rows;
  assert.equal(raw.length,1); assert.deepEqual(raw[0].official_readback,evidence);
  assert.equal((await job(db,claimed.id)).provider_mutation_started_at,null);
  assert.deepEqual(await preserved(db),before);
  const replay=await complete(db,claimed,'succeeded',evidence); assert.equal(replay.reused,true);
  const changed=structuredClone(evidence); changed.observedAt=new Date(Date.now()+1).toISOString();
  assert.equal((await complete(db,claimed,'succeeded',changed)).reason,'COMPLETION_REPLAY_MISMATCH');
  assert.notEqual((await enqueueRepair(db)).status,'queued');
  await assert.rejects(db.exec('update sellerpilot_private.smartstore_repair_uncertain_readback_receipts set official_readback=official_readback'),/IMMUTABLE/u);
  const acl=(await db.query(`select has_function_privilege('service_role','public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)','EXECUTE') service,has_function_privilege('anon','public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)','EXECUTE') anon,has_function_privilege('authenticated','public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)','EXECUTE') authenticated`)).rows[0];
  assert.deepEqual(acl,{service:true,anon:false,authenticated:false});
 } finally { await db.close(); }
});
test('stale and different-product official results cannot create a captured receipt',async()=>{
 for (const kind of ['stale','identity']) {
  const {db,proof}=await setup();
  try {
   const before=await preserved(db); await enqueueCapture(db); const claimed=await claim(db,'recovery');
   const evidence=proof.postwriteReadback; evidence.observedAt=kind==='stale'?'2020-01-01T00:00:00Z':new Date().toISOString();
   if(kind==='identity') evidence.searchReadback.response.contents[0].channelProducts[0].sellerManagementCode='OTHER-SKU';
   const result=await complete(db,claimed,'succeeded',evidence); assert.equal(result.reason,'UNCERTAIN_REPAIR_READBACK_INVALID');
   assert.equal((await db.query('select count(*)::int n from sellerpilot_private.smartstore_repair_uncertain_readback_receipts')).rows[0].n,0);
   assert.deepEqual(await preserved(db),before);
  } finally { await db.close(); }
 }
});
test('capture rejects oversize data and wrong caller and allows a failed read-only completion',async()=>{
 const {db,proof}=await setup();
 try {
  const before=await preserved(db);
  await assert.rejects(db.query('select public.sellerpilot_service_enqueue_smartstore_repair_result_readback($1,$2)',[ids.credentialOwner,ids.product]),/ACCESS_DENIED/u);
  await enqueueCapture(db); const claimed=await claim(db,'recovery');
  await assert.rejects(complete(db,claimed,'succeeded',{...proof.postwriteReadback,overflow:'x'.repeat(2097153)}),/COMPLETION_INVALID/u);
  const failed=await complete(db,claimed,'failed',null,'READBACK_NETWORK_FAILED'); assert.equal(failed.status,'failed');
  assert.deepEqual(await preserved(db),before);
  assert.equal((await job(db,claimed.id)).provider_mutation_started_at,null);
 } finally { await db.close(); }
});
