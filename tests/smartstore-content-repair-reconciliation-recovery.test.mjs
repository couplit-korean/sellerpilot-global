import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createRepairDatabase, createBaseline, enqueueRepair, completeRepair,
  beginMutation, legacyReadback, repairEvidence,
} from './smartstore-existing-content-repair-migration.test.mjs';
import { claim, complete, ids, job } from './smartstore-adoption-gateway-migration.test.mjs';

const recoveryMigration = await readFile(new URL(
  '../supabase/migrations/20260907175100_smartstore_content_repair_reconciliation_recovery.sql',
  import.meta.url,
), 'utf8');

async function recheck(db) {
  return (await db.query(`select
    public.sellerpilot_service_enqueue_smartstore_repair_recheck($1,$2) result`,
  [ids.owner, ids.product])).rows[0].result;
}

async function preserved(db, priorJobId) {
  return (await db.query(`select jsonb_build_object(
    'source',(select to_jsonb(j) from sellerpilot_private.channel_gateway_jobs j where id=$1),
    'prior',(select to_jsonb(j) from sellerpilot_private.channel_gateway_jobs j where id=$2),
    'permit',(select to_jsonb(p) from sellerpilot_private.smartstore_existing_content_repair_permits p where repair_job_id=$2),
    'completion',(select to_jsonb(r) from sellerpilot_private.smartstore_existing_content_repair_completion_receipts r where job_id=$2)
  ) value`, [ids.sourceJob, priorJobId])).rows[0].value;
}

async function uncertainRepair(db) {
  const baseline = await createBaseline(db);
  const queued = await enqueueRepair(db);
  const claimed = await claim(db, 'recovery');
  assert.equal(claimed.id, queued.jobId);
  assert.equal(await beginMutation(db, claimed), true);
  const result = await completeRepair(db, claimed, 'reconciliation_required', null,
    'SMARTSTORE_CONTENT_REPAIR_SECOND_BOUNDARY_REJECTED');
  assert.equal(result.status, 'reconciliation_required');
  return { baseline, queued, claimed };
}

async function freshReadback(db, modify = () => {}) {
  const queued = await recheck(db);
  assert.equal(queued.status, 'queued');
  const again = await recheck(db);
  assert.equal(again.readbackJobId, queued.readbackJobId);
  assert.equal(again.reused, true);
  const claimed = await claim(db, 'recovery');
  assert.equal(claimed.id, queued.readbackJobId);
  const evidence = legacyReadback();
  evidence.observedAt = new Date().toISOString();
  modify(evidence);
  const result = await complete(db, claimed, 'succeeded', evidence);
  return { queued, claimed, evidence, result, status: await recheck(db) };
}

test('recovery requires a fresh official unchanged-product receipt and admits one successor through the real claim guards', async () => {
  const db = await createRepairDatabase();
  try {
    const { queued: prior } = await uncertainRepair(db);
    const before = await preserved(db, prior.jobId);
    await db.exec(recoveryMigration);
    assert.equal((await enqueueRepair(db)).status, 'reconciliation_required');
    const checked = await freshReadback(db);
    assert.equal(checked.status.status, 'verified');
    assert.equal(checked.status.reason, 'REMOTE_PRODUCT_STATE_UNCHANGED');
    assert.ok(checked.status.receiptId);
    assert.equal((await job(db, checked.claimed.id)).provider_mutation_started_at, null);
    assert.deepEqual(await preserved(db, prior.jobId), before);

    const successor = await enqueueRepair(db);
    assert.equal(successor.status, 'queued');
    assert.notEqual(successor.jobId, prior.jobId);
    assert.equal((await enqueueRepair(db)).jobId, successor.jobId);
    const successorJob = await job(db, successor.jobId);
    assert.equal(successorJob.request_payload.sellerpilotSmartstoreRepairRecoveryReceiptId,
      checked.status.receiptId);
    const claimed = await claim(db, 'recovery');
    assert.equal(claimed.id, successor.jobId);
    assert.equal(await beginMutation(db, claimed), true);
    const proof = await repairEvidence(db, checked.status.afterBaselineId);
    const finished = await completeRepair(db, claimed, 'succeeded', proof.evidence);
    assert.equal(finished.status, 'verification_queued');
    assert.ok(finished.verificationJobId);
    const repeat = await enqueueRepair(db);
    assert.notEqual(repeat.status, 'queued');
    const verifier = await claim(db, 'recovery');
    assert.equal(verifier.id, finished.verificationJobId);
    assert.equal((await complete(db, verifier, 'succeeded', proof.postwriteReadback)).status, 'verified');
    assert.deepEqual(await preserved(db, prior.jobId), before);
    assert.equal((await db.query(`select count(*)::int n from
      sellerpilot_private.channel_gateway_jobs where operation='listing.update'`)).rows[0].n, 2);
  } finally { await db.close(); }
});

test('price or product-content change in the fresh official readback cannot authorize a successor', async () => {
  for (const field of ['salePrice', 'name']) {
    const db = await createRepairDatabase();
    try {
      const { queued: prior } = await uncertainRepair(db);
      const before = await preserved(db, prior.jobId);
      await db.exec(recoveryMigration);
      const readback = freshReadback(db, (evidence) => {
        for (const name of ['originReadback', 'channelReadback']) {
          evidence[name].response.originProduct[field] = field === 'salePrice' ? 4000 : 'changed';
        }
      });
      if (field === 'salePrice') {
        await assert.rejects(readback, /SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_REMOTE_DRIFT/u);
      } else {
        assert.equal((await readback).status.status, 'blocked');
      }
      assert.equal((await recheck(db)).receiptId, null);
      assert.notEqual((await enqueueRepair(db)).status, 'queued');
      assert.deepEqual(await preserved(db, prior.jobId), before);
      assert.equal((await db.query(`select count(*)::int n from
        sellerpilot_private.smartstore_content_repair_no_product_effect_receipts`)).rows[0].n, 0);
    } finally { await db.close(); }
  }
});

test('recovery evidence is immutable and the recheck RPC is service-only', async () => {
  const db = await createRepairDatabase();
  try {
    const { queued: prior } = await uncertainRepair(db);
    await db.exec(recoveryMigration);
    const checked = await freshReadback(db);
    assert.equal(checked.status.status, 'verified');
    await assert.rejects(db.query(`update
      sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
      set product_body_unchanged=false where id=$1`, [checked.status.receiptId]));
    await assert.rejects(db.query(`delete from
      sellerpilot_private.smartstore_content_repair_reconciliation_readbacks
      where prior_repair_job_id=$1`, [prior.jobId]));
    const privileges = (await db.query(`select
      has_function_privilege('anon','public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)','EXECUTE') anon,
      has_function_privilege('authenticated','public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)','EXECUTE') authenticated,
      has_function_privilege('service_role','public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)','EXECUTE') service`)).rows[0];
    assert.deepEqual(privileges, { anon: false, authenticated: false, service: true });
  } finally { await db.close(); }
});

test('an official response observed before the failed write cannot mint recovery permission', async () => {
  const db = await createRepairDatabase();
  try {
    const { queued: prior } = await uncertainRepair(db);
    const before = await preserved(db, prior.jobId);
    await db.exec(recoveryMigration);
    const checked = await freshReadback(db, (evidence) => {
      evidence.observedAt = new Date(Date.now() - 60_000).toISOString();
    });
    assert.notEqual(checked.status.status, 'verified');
    assert.equal(checked.status.receiptId, null);
    assert.notEqual((await enqueueRepair(db)).status, 'queued');
    assert.deepEqual(await preserved(db, prior.jobId), before);
    assert.equal((await db.query(`select count(*)::int n from
      sellerpilot_private.smartstore_content_repair_no_product_effect_receipts`)).rows[0].n, 0);
  } finally { await db.close(); }
});
