import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  claim,
  complete,
  ids,
  job,
  workerVersion,
} from './smartstore-adoption-gateway-migration.test.mjs';
import { createUncertainRepairDatabase } from './smartstore-repair-uncertain-readback.test.mjs';

const migration = await readFile(new URL(
  '../supabase/migrations/20260910020000_smartstore_get_successor_completion.sql',
  import.meta.url,
), 'utf8');

const migrations = async (name) => readFile(new URL(
  `../supabase/migrations/${name}`,
  import.meta.url,
), 'utf8');

async function callTwo(db, name, actor = ids.owner, product = ids.product) {
  return (await db.query(
    `select public.${name}($1,$2) result`,
    [actor, product],
  )).rows[0].result;
}

async function enqueueSuccessor(db, lineage, actor = ids.owner) {
  return (await db.query(`
    select public.sellerpilot_service_enqueue_smartstore_get_successor(
      $1,$2,$3,$4
    ) result
  `, [actor, ids.product, lineage.recheck_id, lineage.readback_job_id]))
    .rows[0].result;
}

function freshReadback(proof) {
  const value = structuredClone(proof.postwriteReadback);
  value.observedAt = new Date().toISOString();
  return value;
}

async function priorEvidence(db, lineage) {
  return (await db.query(`select jsonb_build_object(
    'recheck',(select to_jsonb(value) from sellerpilot_private.smartstore_repair_adoption_rechecks value where id=$1),
    'job',(select to_jsonb(value) from sellerpilot_private.channel_gateway_jobs value where id=$2),
    'completion',(select to_jsonb(value) from sellerpilot_private.smartstore_repair_adoption_recheck_completions value where recheck_id=$1),
    'sourceJob',(select to_jsonb(value) from sellerpilot_private.channel_gateway_jobs value where id=$3),
    'sourceAttempt',(select to_jsonb(value) from sellerpilot_private.channel_operation_attempts value where id=$4)
  ) value`, [
    lineage.recheck_id,
    lineage.readback_job_id,
    lineage.source_job_id,
    lineage.source_attempt_id,
  ])).rows[0].value;
}

async function setupRejectedRecheck() {
  const { db, successor: repairJob, proof } = await createUncertainRepairDatabase();
  try {
    const captureQueued = await callTwo(
      db,
      'sellerpilot_service_enqueue_smartstore_repair_result_readback',
    );
    const capturedJob = await claim(db, 'recovery');
    assert.equal(capturedJob.id, captureQueued.readbackJobId);
    const capturedEvidence = freshReadback(proof);
    const captured = await complete(db, capturedJob, 'succeeded', capturedEvidence);
    assert.equal(captured.reason, 'UNCERTAIN_REPAIR_READBACK_CAPTURED');

    await db.exec(await migrations('20260907151000_smartstore_scoped_publication_gate.sql'));
    await db.exec(await migrations('20260907175300_smartstore_content_verifier_naver_canonicalization.sql'));
    await db.exec(await migrations('20260907175400_smartstore_repair_adoption_recheck.sql'));

    const queued = await callTwo(
      db,
      'sellerpilot_service_enqueue_smartstore_adoption_recheck',
    );
    const claimed = await claim(db, 'recovery');
    assert.equal(claimed.id, queued.jobId);

    const rejectedEvidence = freshReadback(proof);
    rejectedEvidence.originReadback.response.originProduct.originProductNo = null;
    const rejected = await complete(db, claimed, 'succeeded', rejectedEvidence);
    assert.equal(rejected.status, 'reconciliation_required');
    assert.equal(rejected.reason, 'ADOPTION_RECHECK_COMMIT_REJECTED');

    const lineage = (await db.query(`
      select recheck.id recheck_id,recheck.readback_job_id,
             recheck.source_job_id,recheck.source_attempt_id
        from sellerpilot_private.smartstore_repair_adoption_rechecks recheck
       where recheck.readback_job_id=$1
    `, [claimed.id])).rows[0];
    assert.ok(lineage?.recheck_id);
    assert.equal(
      (await job(db, lineage.readback_job_id)).provider_mutation_started_at,
      null,
    );

    await db.exec(`
      alter table sellerpilot_private.channel_credentials
        add column fingerprint text;
      update sellerpilot_private.channel_credentials
         set fingerprint='ABCDEF123456';
    `);
    await db.exec(migration);
    return { db, repairJob, proof, capturedJob, lineage };
  } catch (error) {
    await db.close();
    throw error;
  }
}

test('007 blocks a stale successor from falling through the generic matcher before claim', async () => {
  const { db, lineage } = await setupRejectedRecheck();
  try {
    const queued = await enqueueSuccessor(db, lineage);
    assert.equal(queued.status, 'queued');
    const before = (await db.query(`
      select
        sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(
          jsonb_populate_record(
            null::sellerpilot_private.channel_gateway_jobs,
            to_jsonb(job) || jsonb_build_object(
              'request_payload',job.request_payload
                - 'sellerpilotSmartstoreGetSuccessorId'
            )
          )
        ) generic_match,
        sellerpilot_private.smartstore_get_successor_job_matches(job) exact_match,
        sellerpilot_private.smartstore_get_successor_job_shape_matches(job) shape_match,
        job.request_payload->>'sellerpilotSmartstoreGetSuccessorId'
          = successor.id::text marker_match,
        successor.operator_id=job.created_by operator_match,
        successor.listing_id=job.listing_id listing_match,
        successor.credential_id=job.credential_id credential_match,
        successor.seller_account_key=job.seller_account_key account_match,
        sellerpilot_private.external_detail_hash(job.request_payload)
          = successor.readback_request_sha256 request_snapshot,
        sellerpilot_private.smartstore_manual_adoption_readback_job_matches(job) fenced_match,
        sellerpilot_private.smartstore_get_successor_is_current(successor.id) current,
        sellerpilot_private.smartstore_repair_adoption_recheck_is_current(
          successor.prior_recheck_id
        ) prior_current,
        sellerpilot_private.external_detail_hash(to_jsonb(prior_recheck))
          = successor.prior_recheck_snapshot_sha256 prior_recheck_snapshot,
        sellerpilot_private.external_detail_hash(to_jsonb(prior_job))
          = successor.prior_job_snapshot_sha256 prior_job_snapshot,
        sellerpilot_private.external_detail_hash(to_jsonb(prior_completion))
          = successor.prior_completion_snapshot_sha256 prior_completion_snapshot,
        sellerpilot_private.external_detail_hash(to_jsonb(source_job))
          = successor.source_job_snapshot_sha256 source_job_snapshot,
        sellerpilot_private.external_detail_hash(to_jsonb(source_attempt))
          = successor.source_attempt_snapshot_sha256 source_attempt_snapshot,
        sellerpilot_private.external_detail_hash(to_jsonb(listing))
          = successor.source_listing_snapshot_sha256 listing_snapshot,
        sellerpilot_private.external_detail_hash(
          public.sellerpilot_service_prepare_smartstore_manual_adoption(
            successor.owner_id,successor.product_id
          )
        ) = successor.preparation_sha256 preparation_snapshot
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.smartstore_get_successors successor
        on successor.readback_job_id=job.id
      join sellerpilot_private.smartstore_repair_adoption_rechecks prior_recheck
        on prior_recheck.id=successor.prior_recheck_id
      join sellerpilot_private.channel_gateway_jobs prior_job
        on prior_job.id=successor.prior_readback_job_id
      join sellerpilot_private.smartstore_repair_adoption_recheck_completions prior_completion
        on prior_completion.recheck_id=prior_recheck.id
      join sellerpilot_private.channel_gateway_jobs source_job
        on source_job.id=successor.source_job_id
      join sellerpilot_private.channel_operation_attempts source_attempt
        on source_attempt.id=successor.source_attempt_id
      join sellerpilot_private.product_listings listing
        on listing.id=successor.listing_id
      where job.id=$1
    `, [queued.jobId])).rows[0];
    assert.deepEqual(before, {
      generic_match: true,
      exact_match: true,
      shape_match: true,
      marker_match: true,
      operator_match: true,
      listing_match: true,
      credential_match: true,
      account_match: true,
      request_snapshot: true,
      fenced_match: true,
      current: true,
      prior_current: true,
      prior_recheck_snapshot: true,
      prior_job_snapshot: true,
      prior_completion_snapshot: true,
      source_job_snapshot: true,
      source_attempt_snapshot: true,
      listing_snapshot: true,
      preparation_snapshot: true,
    });

    for (const drift of [
      `update sellerpilot_private.channel_credentials
          set version=version+1 where id='${ids.credential}'`,
      `update sellerpilot_private.channel_credentials
          set seller_account_key=repeat('d',64) where id='${ids.credential}'`,
      `update sellerpilot_private.external_detail_imports
          set approved_detail_version=approved_detail_version+1
        where id=(select external_detail_import_id
                    from sellerpilot_private.products where id='${ids.product}')`,
    ]) {
      await db.exec('begin');
      try {
        await db.exec(drift);
      const drifted = (await db.query(`
        select
          sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(
            jsonb_populate_record(
              null::sellerpilot_private.channel_gateway_jobs,
              to_jsonb(job) || jsonb_build_object(
                'request_payload',job.request_payload
                  - 'sellerpilotSmartstoreGetSuccessorId'
              )
            )
          ) generic_match,
          sellerpilot_private.smartstore_manual_adoption_readback_job_matches(job) fenced_match,
          sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
            job.id,job.credential_id,$2,$3
          ) claim_allowed
        from sellerpilot_private.channel_gateway_jobs job
        where job.id=$1
      `, [queued.jobId, ids.worker, workerVersion])).rows[0];
      assert.equal(drifted.generic_match, true);
      assert.equal(drifted.fenced_match, false);
      assert.equal(drifted.claim_allowed, false);
      } finally {
        await db.exec('rollback');
      }
    }
    assert.equal((await job(db, queued.jobId)).attempt_count, 0);
  } finally {
    await db.close();
  }
});

test('007 links one fresh official GET, keeps raw evidence immutable, and performs zero PUTs', async () => {
  const { db, repairJob, proof, capturedJob, lineage } = await setupRejectedRecheck();
  try {
    const oldEvidence = await priorEvidence(db, lineage);
    const queued = await enqueueSuccessor(db, lineage);
    const repeated = await enqueueSuccessor(db, lineage);
    assert.equal(repeated.reused, true);
    assert.equal(repeated.jobId, queued.jobId);

    const claimed = await claim(db, 'recovery');
    assert.equal(claimed.id, queued.jobId);
    assert.equal(await claim(db, 'recovery'), null);
    const raw = freshReadback(proof);
    assert.equal(raw.originReadback.response.originProductNo, undefined);
    assert.equal(raw.originReadback.response.smartstoreChannelProductNo, undefined);
    assert.equal(raw.channelReadback.response.originProductNo, undefined);
    assert.equal(raw.channelReadback.response.smartstoreChannelProductNo, undefined);

    const result = await complete(db, claimed, 'succeeded', raw);
    assert.equal(result.status, 'verified', JSON.stringify(result));
    assert.equal(result.providerMutationPerformed, false);
    assert.ok(result.receiptId);
    assert.ok(result.attestationId);

    const receipt = (await db.query(`
      select * from sellerpilot_private.smartstore_get_successor_receipts
       where successor_id=$1
    `, [queued.successorId])).rows[0];
    assert.deepEqual(receipt.raw_official_readback, raw);
    assert.notEqual(
      receipt.raw_official_readback_sha256,
      receipt.derived_commit_readback_sha256,
    );
    assert.equal(receipt.provider_mutation_performed, false);
    await assert.rejects(
      db.query(`update sellerpilot_private.smartstore_get_successor_receipts
                   set reason=reason where successor_id=$1`, [queued.successorId]),
      /SMARTSTORE_GET_SUCCESSOR_EVIDENCE_IMMUTABLE/u,
    );

    assert.deepEqual(await priorEvidence(db, lineage), oldEvidence);
    assert.equal((await job(db, lineage.readback_job_id)).status, 'reconciliation_required');
    assert.equal((await job(db, lineage.readback_job_id)).provider_mutation_started_at, null);
    assert.equal((await job(db, capturedJob.id)).status, 'reconciliation_required');
    assert.equal((await job(db, repairJob.id)).status, 'reconciliation_required');
    assert.equal((await job(db, queued.jobId)).provider_mutation_started_at, null);

    const status = await callTwo(
      db,
      'sellerpilot_service_get_smartstore_content_repair_status',
    );
    assert.equal(status.status, 'verified');
    assert.equal(status.reason, 'FRESH_OFFICIAL_GET_VERIFIED');
    assert.equal(status.normalUpdateEligible, true);
    assert.equal(status.providerMutationPerformed, false);

    const mutationRows = (await db.query(`
      select operation,provider_mutation_started_at
        from sellerpilot_private.channel_gateway_jobs
       where id=$1 or operation='listing.update'
       order by id
    `, [queued.jobId])).rows;
    assert.equal(
      mutationRows.filter((row) => row.operation === 'listing.lineage.verify').length,
      1,
    );
    assert.equal(
      mutationRows.every((row) => row.operation !== 'listing.lineage.verify'
        || row.provider_mutation_started_at === null),
      true,
    );

    const replay = await complete(db, claimed, 'succeeded', raw);
    assert.equal(replay.reused, true);
    assert.equal(replay.status, 'verified');
    const changed = structuredClone(raw);
    changed.observedAt = new Date(Date.now() + 1).toISOString();
    assert.equal(
      (await complete(db, claimed, 'succeeded', changed)).reason,
      'COMPLETION_REPLAY_MISMATCH',
    );
  } finally {
    await db.close();
  }
});

test('007 fails closed on identity ambiguity, NULL aliases, retry attempts, and owner/admin confusion', async () => {
  for (const mutate of [
    (value) => { value.channelReadback.response.channelProductNo = '99999999999'; },
    (value) => { value.originReadback.response.originProductNo = null; },
    (value) => {
      value.searchReadback.response.contents[0].channelProducts.push({
        channelProductNo: '13749310594',
        sellerManagementCode: 'AUTO-GENERIC-SMARTSTORE-001',
      });
    },
  ]) {
    const { db, lineage, proof } = await setupRejectedRecheck();
    try {
      const queued = await enqueueSuccessor(db, lineage);
      const claimed = await claim(db, 'recovery');
      assert.equal(claimed.id, queued.jobId);
      const invalid = freshReadback(proof);
      mutate(invalid);
      const result = await complete(db, claimed, 'succeeded', invalid);
      assert.equal(result.status, 'reconciliation_required');
      assert.equal(result.reason, 'FRESH_OFFICIAL_GET_INVALID');
      const receipt = (await db.query(`
        select * from sellerpilot_private.smartstore_get_successor_receipts
         where successor_id=$1
      `, [queued.successorId])).rows[0];
      assert.deepEqual(receipt.raw_official_readback, invalid);
      assert.equal(receipt.derived_commit_readback_sha256, null);
    } finally {
      await db.close();
    }
  }

  const { db, lineage } = await setupRejectedRecheck();
  try {
    await assert.rejects(
      enqueueSuccessor(db, lineage, ids.manager),
      /SMARTSTORE_GET_SUCCESSOR_ACCESS_DENIED/u,
    );
    const queued = await enqueueSuccessor(db, lineage);
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set attempt_count=1,updated_at=clock_timestamp()-interval '1 minute'
       where id=$1
    `, [queued.jobId]);
    assert.equal(await claim(db, 'recovery'), null);

    const acl = (await db.query(`select
      has_function_privilege(
        'service_role',
        'public.sellerpilot_service_enqueue_smartstore_get_successor(uuid,uuid,uuid,uuid)',
        'EXECUTE'
      ) service_allowed,
      has_function_privilege(
        'anon',
        'public.sellerpilot_service_enqueue_smartstore_get_successor(uuid,uuid,uuid,uuid)',
        'EXECUTE'
      ) anon_allowed,
      has_function_privilege(
        'authenticated',
        'public.sellerpilot_service_enqueue_smartstore_get_successor(uuid,uuid,uuid,uuid)',
        'EXECUTE'
      ) authenticated_allowed,
      has_table_privilege(
        'service_role',
        'sellerpilot_private.smartstore_get_successor_receipts',
        'SELECT'
      ) service_table_select,
      has_function_privilege(
        'service_role',
        'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)',
        'EXECUTE'
      ) service_complete,
      has_function_privilege(
        'service_role',
        'sellerpilot_private.smartstore_get_successor_is_current(uuid)',
        'EXECUTE'
      ) private_current
    `)).rows[0];
    assert.deepEqual(acl, {
      service_allowed: true,
      anon_allowed: false,
      authenticated_allowed: false,
      service_table_select: false,
      service_complete: true,
      private_current: false,
    });
    const rls = (await db.query(`
      select bool_and(relrowsecurity) enabled,
             (select count(*)::int
                from pg_catalog.pg_policy policy
               where policy.polrelid in (
                 'sellerpilot_private.smartstore_get_successors'::regclass,
                 'sellerpilot_private.smartstore_get_successor_receipts'::regclass
               )) policies
        from pg_catalog.pg_class
       where oid in (
         'sellerpilot_private.smartstore_get_successors'::regclass,
         'sellerpilot_private.smartstore_get_successor_receipts'::regclass
       )
    `)).rows[0];
    assert.deepEqual(rls, { enabled: true, policies: 0 });
  } finally {
    await db.close();
  }
});

test('007 migration installation creates no successor job or evidence row', async () => {
  const { db } = await setupRejectedRecheck();
  try {
    const counts = (await db.query(`select
      (select count(*)::int from sellerpilot_private.smartstore_get_successors) successors,
      (select count(*)::int from sellerpilot_private.smartstore_get_successor_receipts) receipts
    `)).rows[0];
    assert.deepEqual(counts, { successors: 0, receipts: 0 });
  } finally {
    await db.close();
  }
});
