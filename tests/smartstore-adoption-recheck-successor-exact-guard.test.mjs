import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  claim,
  complete,
  ids,
  job,
} from './smartstore-adoption-gateway-migration.test.mjs';
import {
  createUncertainRepairDatabase,
} from './smartstore-repair-uncertain-readback.test.mjs';

const readMigration = (name) => readFile(new URL(
  `../supabase/migrations/${name}`,
  import.meta.url,
), 'utf8');

const gateMigration = await readMigration(
  '20260907151000_smartstore_scoped_publication_gate.sql',
);
const canonicalMigration = await readMigration(
  '20260907175300_smartstore_content_verifier_naver_canonicalization.sql',
);
const predecessorMigration = await readMigration(
  '20260907175400_smartstore_repair_adoption_recheck.sql',
);
const successorMigration = await readMigration(
  '20260908084220_smartstore_adoption_recheck_successor_exact_guard.sql',
);

const call = async (db, name) => (await db.query(
  `select public.${name}($1,$2) result`,
  [ids.owner, ids.product],
)).rows[0].result;

async function immutableLineage(db) {
  return (await db.query(`select jsonb_build_object(
    'source',(select to_jsonb(j) from sellerpilot_private.channel_gateway_jobs j
      where j.id=$1),
    'repairs',(select jsonb_agg(to_jsonb(j) order by j.id)
      from sellerpilot_private.channel_gateway_jobs j
      where j.operation='listing.update'),
    'predecessor',(select to_jsonb(j) from sellerpilot_private.channel_gateway_jobs j
      where j.request_payload?'sellerpilotSmartstoreRepairAdoptionRecheckId'),
    'predecessorCompletion',(
      select to_jsonb(c)
      from sellerpilot_private.smartstore_repair_adoption_recheck_completions c
    )
  ) value`, [ids.sourceJob])).rows[0].value;
}

async function setupRejectedPredecessor() {
  const { db, proof } = await createUncertainRepairDatabase();
  try {
    const capture = await call(
      db,
      'sellerpilot_service_enqueue_smartstore_repair_result_readback',
    );
    const capturedJob = await claim(db, 'recovery');
    assert.equal(capturedJob.id, capture.readbackJobId);
    const capturedEvidence = structuredClone(proof.postwriteReadback);
    capturedEvidence.observedAt = new Date().toISOString();
    assert.equal(
      (await complete(db, capturedJob, 'succeeded', capturedEvidence)).reason,
      'UNCERTAIN_REPAIR_READBACK_CAPTURED',
    );
    await db.exec(gateMigration);
    await db.exec(canonicalMigration);
    await db.exec(predecessorMigration);
    const queued = await call(
      db,
      'sellerpilot_service_enqueue_smartstore_adoption_recheck',
    );
    const predecessorJob = await claim(db, 'recovery');
    assert.equal(predecessorJob.id, queued.jobId);
    const stale = structuredClone(proof.postwriteReadback);
    stale.observedAt = '2020-01-01T00:00:00Z';
    const rejected = await complete(db, predecessorJob, 'succeeded', stale);
    assert.equal(rejected.status, 'reconciliation_required');
    assert.equal(rejected.reason, 'ADOPTION_RECHECK_COMMIT_REJECTED');
    return { db, proof, predecessorJob };
  } catch (error) {
    await db.close();
    throw error;
  }
}

test('084220 reproduces and blocks the stale predecessor generic-matcher fallback', async () => {
  const { db, predecessorJob } = await setupRejectedPredecessor();
  try {
    const before = (await db.query(`
      select sellerpilot_private.smartstore_manual_adoption_readback_job_matches(j)
        as matches
      from sellerpilot_private.channel_gateway_jobs j where j.id=$1
    `, [predecessorJob.id])).rows[0].matches;
    assert.equal(before, true, '175400 admits the terminal predecessor structurally');

    await db.exec(successorMigration);

    const after = (await db.query(`
      select
        sellerpilot_private.smartstore_manual_adoption_readback_job_matches(j)
          as generic_matches,
        sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(j)
          as predecessor_shape
      from sellerpilot_private.channel_gateway_jobs j where j.id=$1
    `, [predecessorJob.id])).rows[0];
    assert.equal(after.predecessor_shape, true);
    assert.equal(after.generic_matches, false);
  } finally {
    await db.close();
  }
});

test('084220 exact successor links a fresh official GET without a provider write', async () => {
  const { db, proof, predecessorJob } = await setupRejectedPredecessor();
  try {
    const before = await immutableLineage(db);
    const mutationJobsBefore = (await db.query(`
      select count(*)::int n from sellerpilot_private.channel_gateway_jobs
      where operation in ('listing.create','listing.update')
    `)).rows[0].n;

    await db.exec(successorMigration);
    const queued = await call(
      db,
      'sellerpilot_service_enqueue_smartstore_adoption_successor',
    );
    assert.equal(queued.status, 'queued', JSON.stringify(queued));
    assert.equal(queued.predecessorJobId, predecessorJob.id);
    assert.equal(queued.originProductNo, '13688607602');
    assert.equal(queued.channelProductNo, '13749310594');

    const repeated = await call(
      db,
      'sellerpilot_service_enqueue_smartstore_adoption_successor',
    );
    assert.equal(repeated.reused, true);
    assert.equal(repeated.jobId, queued.jobId);

    const relation = (await db.query(`
      select s.requested_by,s.owner_id,s.product_id,s.listing_id,
        s.credential_id,s.source_job_id,s.source_attempt_id,
        s.origin_product_no,s.channel_product_no,s.seller_account_key,
        s.approval_revision,s.readback_request_sha256,
        j.created_by,
        sellerpilot_private.external_detail_hash(j.request_payload)
          as actual_request_sha256,
        exists(select 1 from sellerpilot_private.admin_users a
          where a.user_id=s.requested_by) as requested_by_admin,
        exists(select 1 from sellerpilot_private.admin_users a
          where a.user_id=j.created_by) as created_by_admin,
        sellerpilot_private.smartstore_adoption_recheck_successor_is_current(s.id)
          as current,
        sellerpilot_private.smartstore_manual_adoption_readback_job_matches(j)
          as structural_match,
        sellerpilot_private.smartstore_adoption_recheck_successor_claim_allowed(
          j.id,$1
        ) as exact_claim
      from sellerpilot_private.smartstore_adoption_recheck_successors s
      join sellerpilot_private.channel_gateway_jobs j on j.id=s.readback_job_id
    `, [ids.worker])).rows[0];
    assert.equal(relation.requested_by, relation.owner_id);
    assert.equal(relation.owner_id, ids.owner);
    assert.equal(relation.product_id, ids.product);
    assert.equal(relation.listing_id, ids.listing);
    assert.equal(relation.credential_id, ids.credential);
    assert.equal(relation.source_job_id, ids.sourceJob);
    assert.equal(relation.source_attempt_id, ids.sourceAttempt);
    assert.equal(relation.origin_product_no, '13688607602');
    assert.equal(relation.channel_product_no, '13749310594');
    assert.notEqual(relation.created_by, relation.owner_id);
    assert.equal(relation.created_by, ids.manager);
    assert.equal(relation.requested_by_admin, true);
    assert.equal(relation.created_by_admin, true);
    assert.match(relation.seller_account_key, /^[a-f0-9]{64}$/u);
    assert.equal(relation.approval_revision, 1);
    assert.equal(
      relation.readback_request_sha256,
      relation.actual_request_sha256,
    );
    assert.equal(relation.current, true);
    assert.equal(relation.structural_match, true);
    assert.equal(relation.exact_claim, true);

    const claimed = await claim(db, 'recovery');
    assert.equal(claimed.id, queued.jobId);
    assert.equal(await claim(db, 'recovery'), null, 'duplicate claim is fenced');
    const fresh = structuredClone(proof.postwriteReadback);
    fresh.observedAt = new Date().toISOString();
    const result = await complete(db, claimed, 'succeeded', fresh);
    assert.equal(result.status, 'verified', JSON.stringify(result));
    assert.ok(result.receiptId);
    assert.ok(result.attestationId);

    const state = await call(
      db,
      'sellerpilot_service_get_smartstore_adoption_recheck',
    );
    assert.equal(state.contract, 'smartstore_adoption_recheck_successor_v1');
    assert.equal(state.status, 'verified');
    assert.equal(state.providerMutationPerformed, false);
    assert.equal(state.contentVerified, true);
    assert.equal(state.normalUpdateEligible, true);

    const reconciliation = (await db.query(`
      select id,operation,
        sellerpilot_private.listing_mutation_reconciliation_resolved(id)
          as resolved
      from sellerpilot_private.channel_gateway_jobs
      where operation in ('listing.create','listing.update')
      order by operation,id
    `)).rows;
    assert.equal(reconciliation.length, 3);
    assert.equal(
      reconciliation.every((candidate) => candidate.resolved),
      true,
      JSON.stringify(reconciliation),
    );

    const repairState = await call(
      db,
      'sellerpilot_service_get_smartstore_content_repair_status',
    );
    assert.equal(repairState.status, 'verified', JSON.stringify(repairState));
    assert.equal(repairState.verificationJobId, queued.jobId);
    assert.equal(repairState.providerMutationPerformed, false);
    assert.equal(repairState.normalUpdateEligible, true);

    await db.exec('begin');
    await db.exec(`
      update sellerpilot_private.channel_credentials
      set status='inactive'
    `);
    const driftedState = await call(
      db,
      'sellerpilot_service_get_smartstore_adoption_recheck',
    );
    assert.equal(driftedState.status, 'blocked');
    assert.equal(driftedState.reason, 'EXACT_SUCCESSOR_VERIFIED_BINDING_DRIFT');
    assert.equal(driftedState.contentVerified, true);
    assert.equal(driftedState.normalUpdateEligible, false);
    const driftedRepairs = (await db.query(`
      select sellerpilot_private.listing_mutation_reconciliation_resolved(id)
        as resolved
      from sellerpilot_private.channel_gateway_jobs
      where operation='listing.update'
    `)).rows;
    assert.equal(driftedRepairs.every((candidate) => !candidate.resolved), true);
    await db.exec('rollback');

    assert.deepEqual(await immutableLineage(db), before);
    const mutationJobsAfter = (await db.query(`
      select count(*)::int n from sellerpilot_private.channel_gateway_jobs
      where operation in ('listing.create','listing.update')
    `)).rows[0].n;
    assert.equal(mutationJobsAfter, mutationJobsBefore, 'new PUT/CREATE job count is zero');
    assert.equal((await job(db, queued.jobId)).provider_mutation_started_at, null);

    const receiptCount = (await db.query(`
      select count(*)::int n
      from sellerpilot_private.smartstore_adoption_recheck_successor_receipts
    `)).rows[0].n;
    assert.equal(receiptCount, 1);
    const replay = await complete(db, claimed, 'succeeded', fresh);
    assert.equal(replay.reused, true);
    const changed = structuredClone(fresh);
    changed.observedAt = new Date(Date.now() + 1).toISOString();
    assert.equal(
      (await complete(db, claimed, 'succeeded', changed)).reason,
      'COMPLETION_REPLAY_MISMATCH',
    );
    assert.equal((await db.query(`
      select count(*)::int n
      from sellerpilot_private.smartstore_adoption_recheck_successor_receipts
    `)).rows[0].n, 1);
    await assert.rejects(
      db.exec(`update sellerpilot_private.smartstore_adoption_recheck_successor_receipts
        set content_verified=content_verified`),
      /EVIDENCE_IMMUTABLE/u,
    );
    await assert.rejects(
      db.exec(`update sellerpilot_private.smartstore_adoption_recheck_successors
        set approval_revision=approval_revision`),
      /EVIDENCE_IMMUTABLE/u,
    );
  } finally {
    await db.close();
  }
});

test('084220 fails closed for owner/admin, NULL predecessor evidence, revision drift, ACL and RLS', async () => {
  const { db } = await setupRejectedPredecessor();
  try {
    await db.exec(successorMigration);
    await db.exec('begin');
    await db.query(
      'delete from sellerpilot_private.admin_users where user_id=$1',
      [ids.owner],
    );
    await assert.rejects(
      call(db, 'sellerpilot_service_enqueue_smartstore_adoption_successor'),
      /ACCESS_DENIED/u,
    );
    await db.exec('rollback');

    const predecessor = (await db.query(`
      select c.readback_sha256,c.adoption_receipt_id,c.attestation_id,
        c.result_status,c.reason
      from sellerpilot_private.smartstore_repair_adoption_recheck_completions c
    `)).rows[0];
    assert.equal(predecessor.result_status, 'reconciliation_required');
    assert.equal(predecessor.reason, 'ADOPTION_RECHECK_COMMIT_REJECTED');
    assert.equal(predecessor.readback_sha256, null);
    assert.equal(predecessor.adoption_receipt_id, null);
    assert.equal(predecessor.attestation_id, null);

    await db.exec('begin');
    await db.exec(`
      update sellerpilot_private.external_detail_approval_revisions
      set revision=revision+1
    `);
    const changed = await call(
      db,
      'sellerpilot_service_enqueue_smartstore_adoption_successor',
    );
    assert.notEqual(changed.status, 'queued');
    await db.exec('rollback');

    const rls = (await db.query(`
      select relname,relrowsecurity
      from pg_class
      where relname in (
        'smartstore_adoption_recheck_successors',
        'smartstore_adoption_recheck_successor_receipts'
      ) order by relname
    `)).rows;
    assert.equal(rls.length, 2);
    assert.equal(rls.every((row) => row.relrowsecurity), true);
    const acl = (await db.query(`select
      has_table_privilege('anon',
        'sellerpilot_private.smartstore_adoption_recheck_successors','SELECT')
        as anon_select,
      has_table_privilege('authenticated',
        'sellerpilot_private.smartstore_adoption_recheck_successors','INSERT')
        as authenticated_insert,
      has_table_privilege('service_role',
        'sellerpilot_private.smartstore_adoption_recheck_successors','SELECT')
        as service_table_select,
      has_function_privilege('service_role',
        'public.sellerpilot_service_enqueue_smartstore_adoption_successor(uuid,uuid)',
        'EXECUTE') as service_execute,
      has_function_privilege('authenticated',
        'public.sellerpilot_service_enqueue_smartstore_adoption_successor(uuid,uuid)',
        'EXECUTE') as authenticated_execute
    `)).rows[0];
    assert.equal(acl.anon_select, false);
    assert.equal(acl.authenticated_insert, false);
    assert.equal(acl.service_table_select, false);
    assert.equal(acl.service_execute, true);
    assert.equal(acl.authenticated_execute, false);
  } finally {
    await db.close();
  }
});
