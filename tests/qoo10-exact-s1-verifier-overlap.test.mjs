import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831056800_allow_exact_qoo10_s1_verifier_overlap.sql",
  import.meta.url,
);

const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const sourceId = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
const credentialId = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const sellerAccountKey = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
const requestFingerprint = "76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799";

function exactVerifierRequest(overrides = {}) {
  return {
    periodicKey: `qoo10-exact-s1:${sourceId}`,
    arguments: {
      sellerpilotReadOnly: true,
      sellerpilotQoo10ExactS1Recovery: "qoo10_exact_s1_verifier_v1",
      publicationReviewSourceJobId: sourceId,
      publicationReviewId: listingId,
      remoteId: "1217336970",
      publicationExpectedLocale: "ja-JP",
      ...overrides,
    },
  };
}

async function insertJob(db, {
  id,
  channel = "qoo10",
  operation,
  status = "queued",
  requestPayload = {},
  credential = credentialId,
  accountKey = sellerAccountKey,
  fingerprint = requestFingerprint,
}) {
  return db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,listing_id,channel,operation,status,request_payload,
       credential_id,seller_account_key,request_fingerprint
     ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
    [
      id,
      listingId,
      channel,
      operation,
      status,
      JSON.stringify(requestPayload),
      credential,
      accountKey,
      fingerprint,
    ],
  );
}

test("exact Qoo10 S1 read-only verifier alone may overlap its reconciliation source", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role noinherit;
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        listing_id uuid,
        channel text not null,
        operation text not null,
        status text not null,
        request_payload jsonb not null default '{}'::jsonb,
        credential_id uuid,
        seller_account_key text,
        request_fingerprint text
      );
      create table sellerpilot_private.qoo10_exact_s1_verifier_runs (
        verifier_job_id uuid primary key
      );
      create function public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(
        source_job_id uuid,
        release_sha text
      ) returns jsonb language sql as $$
        select jsonb_build_object('sourceJobId',source_job_id,'releaseSha',release_sha)
      $$;
      create function sellerpilot_private.qoo10_exact_s1_source_is_current()
      returns boolean language sql stable as $$
        select exists (
          select 1
            from sellerpilot_private.channel_gateway_jobs job
           where job.id = '${sourceId}'::uuid
             and job.listing_id = '${listingId}'::uuid
             and job.channel = 'qoo10'
             and job.operation = 'listing.update'
             and job.status = 'reconciliation_required'
        )
      $$;
      create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
        on sellerpilot_private.channel_gateway_jobs (listing_id)
        where listing_id is not null
          and operation in (
            'listing.create','listing.update','listing.stop',
            'price.update','inventory.update',
            'listing.lineage.verify','listing.publication.verify'
          )
          and status in ('queued','running','reconciliation_required');
    `);

    await insertJob(db, {
      id: sourceId,
      operation: "listing.update",
      status: "reconciliation_required",
    });
    await assert.rejects(
      insertJob(db, {
        id: "20000000-0000-4000-8000-000000000001",
        operation: "listing.publication.verify",
        requestPayload: exactVerifierRequest(),
      }),
      /duplicate key value violates unique constraint/,
      "the deployed one-column index reproduces the production enqueue failure",
    );

    await db.exec(migration);

    await insertJob(db, {
      id: "20000000-0000-4000-8000-000000000002",
      operation: "listing.publication.verify",
      requestPayload: exactVerifierRequest(),
    });

    await assert.rejects(
      insertJob(db, {
        id: "20000000-0000-4000-8000-000000000003",
        operation: "listing.publication.verify",
        requestPayload: exactVerifierRequest(),
      }),
      /exact Qoo10 S1 verifier overlap is not current|duplicate key value violates unique constraint/,
      "only one marked exact verifier may be active",
    );
    await assert.rejects(
      insertJob(db, {
        id: "20000000-0000-4000-8000-000000000004",
        operation: "listing.publication.verify",
      }),
      /listing work overlaps the exact Qoo10 S1 verifier|duplicate key value violates unique constraint/,
      "an ordinary publication verifier remains serialized against the source",
    );
    await assert.rejects(
      insertJob(db, {
        id: "20000000-0000-4000-8000-000000000005",
        operation: "listing.update",
      }),
      /listing work overlaps the exact Qoo10 S1 verifier|duplicate key value violates unique constraint/,
      "a listing mutation remains serialized against the source",
    );
    await assert.rejects(
      insertJob(db, {
        id: "20000000-0000-4000-8000-000000000006",
        channel: "smartstore",
        operation: "listing.publication.verify",
        requestPayload: exactVerifierRequest(),
      }),
      /listing work overlaps the exact Qoo10 S1 verifier|duplicate key value violates unique constraint/,
      "the marker cannot exempt another channel",
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status = 'failed'
          where id = $1`,
        [sourceId],
      ),
      /exact Qoo10 S1 source is locked by its verifier/,
      "the reconciliation source cannot disappear under an active verifier",
    );

    const rows = await db.query(
      `select id,operation,status
         from sellerpilot_private.channel_gateway_jobs
        order by id`,
    );
    assert.equal(rows.rows.length, 2);
    assert.match(
      (await db.query(
        `select pg_get_indexdef(
           'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass
         ) definition`,
      )).rows[0].definition,
      /sellerpilotQoo10ExactS1Recovery/,
    );

    const guardDefinition = (await db.query(
      `select pg_get_functiondef(
         'sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()'::regprocedure
       ) definition`,
    )).rows[0].definition;
    const sourceLock = guardDefinition.indexOf("for update");
    const fullSourceRevalidation = guardDefinition.indexOf(
      "qoo10_exact_s1_source_is_current()",
      sourceLock,
    );
    assert.ok(sourceLock >= 0, "the verifier path must lock the exact source row");
    assert.ok(
      fullSourceRevalidation > sourceLock,
      "the full exact-source contract must be revalidated after the row lock",
    );

    // Serialized outcome A: if the source mutation wins first, the exact
    // verifier must observe the post-mutation source and fail closed.
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded'
        where id = $1`,
      ["20000000-0000-4000-8000-000000000002"],
    );
    await db.query(
      "delete from sellerpilot_private.channel_gateway_jobs where id = $1",
      [sourceId],
    );
    await insertJob(db, {
      id: "20000000-0000-4000-8000-000000000007",
      operation: "listing.update",
    });
    await assert.rejects(
      insertJob(db, {
        id: "20000000-0000-4000-8000-000000000008",
        operation: "listing.publication.verify",
        requestPayload: exactVerifierRequest(),
      }),
      /exact Qoo10 S1 verifier overlap is not current/,
      "an exact-looking verifier cannot create a second lane without its source",
    );

    // Serialized outcome B was exercised above: when the verifier wins first,
    // the source mutation is rejected with the immutable-source guard.  PGlite
    // exposes one backend, so the row-lock ordering itself is asserted from
    // pg_get_functiondef while both possible committed outcomes are executed.
  } finally {
    await db.close();
  }
});

test("overlap migration is schema-only and cannot enqueue or wake work", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(
    migration,
    /select\s+public[.]sellerpilot_service_enqueue_exact_qoo10_s1_verifier\s*\(/i,
  );
  assert.doesNotMatch(migration, /schedule_serverless_cs_wakeup\s*\(/i);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private[.]channel_gateway_jobs/i,
  );
});
