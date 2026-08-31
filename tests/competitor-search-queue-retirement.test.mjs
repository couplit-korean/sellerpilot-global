import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831131500_retire_pre_v3_competitor_search_queue.sql",
  import.meta.url,
);
const productionCountDeclaration =
  "c_expected_count constant integer := 19;";
const productionDigest =
  "cf636a14eb69f3260e1eb24077da87bd8f7d479d1e467303e51535955b3c3ed4";
const productionAggregateDigests = {
  fullRows: "a02c9210ce1be866bf721835b948ca09649505772f5c2783856d9c56001a8c82",
  requestPayloads: "06a78b54eaa1a1782a5a1fa7b11b78eb781bedc7e34c570621ce0aa135734d9e",
  linkages: "6a3e43d2c15c6f72f9919a10785170aa004e156ede2060c311ab1fb5e0309565",
};
const generatedRetirementError =
  "COMPETITOR_SEARCH_RETIRED_BEFORE_IDENTITY_V3";
const productionPostimageHashes = {
  validV3: "00e53e6b85ade85504c1096d10c39e07facb872870bb654a72a44ff04ae0a784",
  recordV3: "c68a53700e658c8c630aeeda624f848140fd879d5f0aeb2f6e6a94e5775d80b5",
  review: "dfe1cfa9e4a4222efbc8cca749393b224d1b9397c08dc570d7fe545052d01222",
  appendOnly: "8b6072ac2402977ae7425e3f73e96a95c4147fca4894a8ce596ca80129ffce27",
};
const fixturePostimageHashes = {
  validV3: "cdc237fb3e77052763eb990338c319a0d251dd08c15c21ed3fa4e706c7f470af",
  recordV3: "7238bd4e6efde044ba2387de7138d6ec83a01d1ed4342ab4e6dbfc6d58b30c4f",
  review: "f31eb86b295d47e4aa193ce528cf2abaffbc7c5dfa1e39a7f0068badf920cb81",
  appendOnly: "9197b5b3127ff18bd6bcaf9d100370ffea27a9b42e3acf143febdfefce38458c",
};

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "20000000-0000-4000-8000-000000000001";
const JOB_A = "30000000-0000-4000-8000-000000000001";
const JOB_B = "30000000-0000-4000-8000-000000000002";
const HISTORICAL_JOB = "30000000-0000-4000-8000-000000000003";
const UNRELATED_JOB = "30000000-0000-4000-8000-000000000004";
const PRODUCT_ID = "40000000-0000-4000-8000-000000000001";

function queueDigest(rows) {
  const manifest = [...rows]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((row) => `${row.id}:${row.status}:${row.periodicKey ?? ""}`)
    .join(",");
  return createHash("sha256").update(manifest).digest("hex");
}

async function canonicalQueueDigests(db) {
  return (await db.query(`
    select
      encode(extensions.digest(coalesce(string_agg(
        target.id::text || ':' || target.row_sha,
        ',' order by target.id
      ), ''), 'sha256'), 'hex') as "fullRows",
      encode(extensions.digest(coalesce(string_agg(
        target.id::text || ':' || target.request_sha,
        ',' order by target.id
      ), ''), 'sha256'), 'hex') as "requestPayloads",
      encode(extensions.digest(coalesce(string_agg(
        target.id::text || ':' || target.link_count::text || ':' ||
          target.linkage_sha,
        ',' order by target.id
      ), ''), 'sha256'), 'hex') as linkages
    from (
      select
        job.id,
        encode(extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex') row_sha,
        encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex') request_sha,
        coalesce(linkage.link_count, 0) link_count,
        coalesce(linkage.linkage_sha,
          encode(extensions.digest('', 'sha256'), 'hex')) linkage_sha
      from sellerpilot_private.channel_gateway_jobs job
      cross join lateral (
        select count(*) link_count,
               encode(extensions.digest(coalesce(string_agg(
                 claim.product_id::text || ':' ||
                   coalesce(claim.gateway_periodic_key, ''),
                 ',' order by claim.product_id
               ), ''), 'sha256'), 'hex') linkage_sha
          from sellerpilot_private.competitor_price_refresh_claims claim
         where claim.gateway_job_id = job.id
      ) linkage
      where job.channel='elevenst'
        and job.operation='competitor.search'
        and job.status in ('queued','running')
    ) target
  `)).rows[0];
}

async function migrationForSyntheticPreimage(db, source, rows) {
  const digest = queueDigest(rows);
  const aggregateDigests = await canonicalQueueDigests(db);
  const countMatches = source.match(
    new RegExp(productionCountDeclaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
  );
  const digestMatches = source.match(new RegExp(productionDigest, "g"));
  assert.equal(countMatches?.length, 1, "production count must have one declaration");
  assert.ok(
    (digestMatches?.length ?? 0) >= 1,
    "production digest must remain pinned in the migration",
  );
  let migrated = source
    .replace(
      productionCountDeclaration,
      `c_expected_count constant integer := ${rows.length};`,
    )
    .replaceAll(productionDigest, digest);
  for (const [key, productionValue] of Object.entries(productionAggregateDigests)) {
    assert.equal(
      migrated.split(productionValue).length - 1,
      1,
      `${key} production aggregate digest must have one declaration`,
    );
    migrated = migrated.replace(productionValue, aggregateDigests[key]);
  }
  for (const key of Object.keys(productionPostimageHashes)) {
    assert.equal(
      migrated.split(productionPostimageHashes[key]).length - 1,
      1,
      `${key} production postimage must have one declaration`,
    );
    migrated = migrated.replace(
      productionPostimageHashes[key],
      fixturePostimageHashes[key],
    );
  }
  return migrated;
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create schema extensions;
    create or replace function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable
    as $$
      select case when lower(algorithm) = 'sha256'
        then sha256(convert_to(value, 'UTF8'))
        else convert_to(md5(value || algorithm), 'UTF8')
      end
    $$;

    create schema sellerpilot_private;
    create schema supabase_migrations;
    create or replace function sellerpilot_private.valid_competitor_v3_item(p_item jsonb)
    returns boolean language sql immutable set search_path = ''
    as $$ select jsonb_typeof(p_item) = 'object' $$;
    create or replace function sellerpilot_private.record_competitor_prices(
      p_product_id uuid, p_prices jsonb, p_allow_v3 boolean
    ) returns integer language sql set search_path = ''
    as $$ select 0 $$;
    create or replace function public.sellerpilot_review_competitor_match(
      p_observation_id uuid, p_expected_fingerprint text,
      p_expected_checked_at timestamptz, p_expected_latest_review_id uuid,
      p_decision text, p_reason_codes jsonb, p_note text, p_request_id uuid
    ) returns jsonb language sql set search_path = ''
    as $$ select '{}'::jsonb $$;
    create or replace function sellerpilot_private.reject_competitor_match_review_mutation()
    returns trigger language plpgsql set search_path = ''
    as $$ begin raise exception 'append-only'; end $$;
    create table supabase_migrations.schema_migrations (
      version text primary key,
      statements text[] not null default '{}'::text[],
      name text
    );
    insert into supabase_migrations.schema_migrations (
      version, statements, name
    ) values
      ('20260831130000', '{}'::text[], 'competitor_price_v3'),
      ('20260831131000', '{}'::text[], 'competitor_match_review_ledger');

    create table sellerpilot_private.competitor_match_review_events (
      id uuid primary key
    );
    alter table sellerpilot_private.competitor_match_review_events enable row level security;
    create trigger competitor_match_review_events_append_only
    before update or delete on sellerpilot_private.competitor_match_review_events
    for each row execute function sellerpilot_private.reject_competitor_match_review_mutation();
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      credential_id uuid not null,
      attempt_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb,
      status text not null default 'queued'
        check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      error_message text,
      worker_token_id uuid,
      attempt_count integer not null default 0,
      lease_expires_at timestamptz,
      created_by uuid not null,
      created_at timestamptz not null default clock_timestamp(),
      started_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz not null default clock_timestamp(),
      claim_token uuid,
      provider_mutation_started_at timestamptz
    );
    create table sellerpilot_private.competitor_price_refresh_claims (
      product_id uuid primary key,
      claim_token uuid,
      claimed_at timestamptz,
      lease_expires_at timestamptz,
      last_attempted_at timestamptz,
      gateway_job_id uuid,
      gateway_periodic_key text
    );
    create table sellerpilot_private.operation_audit (
      id bigint generated always as identity primary key,
      owner_id uuid,
      action text not null,
      entity_type text not null,
      entity_id text,
      safe_detail jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null default clock_timestamp()
    );
  `);
  return db;
}

async function insertJob(db, {
  id,
  status = "queued",
  periodicKey = null,
  error = null,
  attemptId = null,
  workerTokenId = null,
  claimToken = null,
  leaseExpiresAt = null,
  responsePayload = null,
  providerStartedAt = null,
  attemptCount = 0,
  startedAt = null,
  channel = "elevenst",
  operation = "competitor.search",
}) {
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id, credential_id, attempt_id, channel, operation, environment,
       request_payload, response_payload, status, error_message,
       worker_token_id, attempt_count, lease_expires_at, created_by,
       started_at, claim_token, provider_mutation_started_at
     ) values (
       $1, $2, $3, $4, $5, 'production',
       jsonb_build_object('primary', 'QA product', 'periodicKey', $6::text),
       $7::jsonb, $8, $9, $10, $11, $12::timestamptz, $13,
       $14::timestamptz, $15, $16::timestamptz
     )`,
    [
      id,
      CREDENTIAL_ID,
      attemptId,
      channel,
      operation,
      periodicKey,
      responsePayload === null ? null : JSON.stringify(responsePayload),
      status,
      error,
      workerTokenId,
      attemptCount,
      leaseExpiresAt,
      OWNER_ID,
      startedAt,
      claimToken,
      providerStartedAt,
    ],
  );
}

test("production queue contract is pinned and an empty clean replay is a no-op", async () => {
  const source = await readFile(migrationUrl, "utf8");
  assert.match(source, /c_expected_count constant integer := 19;/);
  assert.match(source, new RegExp(productionDigest));
  for (const hash of Object.values(productionAggregateDigests)) {
    assert.match(source, new RegExp(hash));
  }
  assert.match(source, /status in \('queued', 'running'\)/);
  assert.match(source, /job\.attempt_id is null/);
  assert.match(source, /job\.error_message is null/);
  assert.ok(
    (source.match(/job\.error_message is null/g)?.length ?? 0) >= 3,
    "safe count, snapshot, and update must all reject prior error evidence",
  );
  assert.match(source, /error_message = c_retirement_error/);
  assert.doesNotMatch(source, /previousErrorPreserved/);
  for (const hash of Object.values(productionPostimageHashes)) {
    assert.match(source, new RegExp(hash));
  }
  assert.doesNotMatch(source, /delete\s+from\s+sellerpilot_private\.channel_gateway_jobs/i);

  const db = await createDatabase();
  try {
    await db.exec(source);
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.operation_audit"),
      0,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.channel_gateway_jobs"),
      0,
    );
  } finally {
    await db.close();
  }
});

test("a certified synthetic preimage is retired without rewriting source or retry evidence", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const active = [
    { id: JOB_A, status: "queued", periodicKey: "competitor:v1:aaa" },
    { id: JOB_B, status: "queued", periodicKey: "competitor:v1:bbb" },
  ];
  const db = await createDatabase();
  try {
    await insertJob(db, {
      ...active[0],
    });
    await insertJob(db, active[1]);
    await insertJob(db, {
      id: HISTORICAL_JOB,
      status: "succeeded",
      periodicKey: "competitor:v1:historical",
      responsePayload: { ok: true, items: [] },
      attemptCount: 1,
      startedAt: "2026-08-29T00:00:00Z",
    });
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set completed_at = clock_timestamp()
        where id = $1`,
      [HISTORICAL_JOB],
    );
    await insertJob(db, {
      id: UNRELATED_JOB,
      status: "queued",
      periodicKey: "not-a-competitor-key",
      channel: "qoo10",
      operation: "orders.list",
    });
    await db.query(
      `insert into sellerpilot_private.competitor_price_refresh_claims (
         product_id, gateway_job_id, gateway_periodic_key, last_attempted_at
       ) values ($1, $2, $3, clock_timestamp())`,
      [PRODUCT_ID, JOB_A, active[0].periodicKey],
    );

    const before = (await db.query(
      `select id, credential_id, attempt_id, channel, operation, environment,
              request_payload, response_payload, error_message, worker_token_id,
              attempt_count, lease_expires_at, created_by, created_at, started_at,
              claim_token, provider_mutation_started_at
         from sellerpilot_private.channel_gateway_jobs
        order by id`,
    )).rows;

    const expectedAggregateDigests = await canonicalQueueDigests(db);
    await db.exec(await migrationForSyntheticPreimage(db, source, active));

    const after = (await db.query(
      `select id, credential_id, attempt_id, channel, operation, environment,
              request_payload, response_payload, error_message, worker_token_id,
              attempt_count, lease_expires_at, created_by, created_at, started_at,
              claim_token, provider_mutation_started_at,
              status, completed_at, updated_at
         from sellerpilot_private.channel_gateway_jobs
        order by id`,
    )).rows;
    assert.equal(after.length, before.length, "retirement must not delete jobs");

    for (const previous of before) {
      const current = after.find((row) => row.id === previous.id);
      assert.ok(current);
      for (const [key, value] of Object.entries(previous)) {
        if (key === "error_message") continue;
        assert.deepEqual(current[key], value, `${previous.id} changed ${key}`);
      }
    }

    const retiredA = after.find((row) => row.id === JOB_A);
    const retiredB = after.find((row) => row.id === JOB_B);
    assert.equal(retiredA.status, "cancelled");
    assert.equal(retiredA.error_message, generatedRetirementError);
    assert.equal(retiredA.attempt_count, 0);
    assert.equal(retiredA.started_at, null);
    assert.equal(retiredB.status, "cancelled");
    assert.equal(retiredB.error_message, generatedRetirementError);
    assert.equal(retiredB.attempt_count, 0);
    assert.equal(retiredB.started_at, null);
    assert.equal(
      new Date(retiredA.completed_at).toISOString(),
      new Date(retiredA.updated_at).toISOString(),
    );
    assert.equal(
      new Date(retiredB.completed_at).toISOString(),
      new Date(retiredB.updated_at).toISOString(),
    );

    const audits = (await db.query(
      `select entity_id, safe_detail
         from sellerpilot_private.operation_audit
        order by entity_id`,
    )).rows;
    assert.equal(audits.length, 2);
    assert.deepEqual(audits.map((row) => row.entity_id), [JOB_A, JOB_B]);
    assert.equal(audits[0].safe_detail.contract,
      "competitor_search_pre_v3_queue_retirement_v1");
    assert.equal(audits[0].safe_detail.queueDigest, queueDigest(active));
    assert.equal(audits[0].safe_detail.queueFullRowsDigest, expectedAggregateDigests.fullRows);
    assert.equal(audits[0].safe_detail.queueRequestPayloadsDigest, expectedAggregateDigests.requestPayloads);
    assert.equal(audits[0].safe_detail.queueLinkagesDigest, expectedAggregateDigests.linkages);
    assert.equal(audits[0].safe_detail.queueTargetCount, 2);
    assert.deepEqual(audits[0].safe_detail.linkedProductIds, [PRODUCT_ID]);
    assert.equal(audits[0].safe_detail.linkCount, 1);
    assert.deepEqual(audits[1].safe_detail.linkedProductIds, []);
    assert.equal(audits[1].safe_detail.linkCount, 0);
    assert.equal("previousErrorPreserved" in audits[1].safe_detail, false);

    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.competitor_price_refresh_claims",
      ),
      1,
      "claim linkage is retained for the next migration",
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.channel_gateway_jobs
          where channel='elevenst' and operation='competitor.search'
            and status in ('queued','running')`,
      ),
      0,
    );
  } finally {
    await db.close();
  }
});

test("the complete 19-row queue shape retires atomically with aggregate evidence", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const active = Array.from({ length: 19 }, (_, index) => ({
    id: `31000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    status: "queued",
    periodicKey: `competitor:v1:full-shape-${String(index + 1).padStart(2, "0")}`,
  }));
  const db = await createDatabase();
  try {
    for (const [index, row] of active.entries()) {
      await insertJob(db, row);
      if (index % 2 === 0) {
        await db.query(
          `insert into sellerpilot_private.competitor_price_refresh_claims (
             product_id, gateway_job_id, gateway_periodic_key, last_attempted_at
           ) values ($1, $2, $3, clock_timestamp())`,
          [
            `41000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            row.id,
            row.periodicKey,
          ],
        );
      }
    }
    const expectedDigests = await canonicalQueueDigests(db);
    await db.exec(await migrationForSyntheticPreimage(db, source, active));
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.channel_gateway_jobs
          where channel='elevenst' and operation='competitor.search'
            and status='cancelled' and error_message=$1`,
        [generatedRetirementError],
      ),
      19,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action='competitor_search_queue_retired_before_identity_v3'
            and safe_detail->>'queueFullRowsDigest'=$1
            and safe_detail->>'queueRequestPayloadsDigest'=$2
            and safe_detail->>'queueLinkagesDigest'=$3`,
        [expectedDigests.fullRows, expectedDigests.requestPayloads, expectedDigests.linkages],
      ),
      19,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.competitor_price_refresh_claims"),
      10,
      "the following identity-fence migration still owns claim-link cleanup",
    );
  } finally {
    await db.close();
  }
});

test("full-row, request-payload, and linkage drift fail before retirement", async () => {
  const source = await readFile(migrationUrl, "utf8");
  for (const drift of ["request", "linkage"]) {
    const active = [{
      id: JOB_A,
      status: "queued",
      periodicKey: `competitor:v1:${drift}-aggregate-drift`,
    }];
    const db = await createDatabase();
    try {
      await insertJob(db, active[0]);
      const certified = await migrationForSyntheticPreimage(db, source, active);
      if (drift === "request") {
        await db.query(
          `update sellerpilot_private.channel_gateway_jobs
              set request_payload = request_payload || '{"hiddenDrift":true}'::jsonb
            where id=$1`,
          [JOB_A],
        );
      } else {
        await db.query(
          `insert into sellerpilot_private.competitor_price_refresh_claims (
             product_id, gateway_job_id, gateway_periodic_key
           ) values ($1,$2,$3)`,
          [PRODUCT_ID, JOB_A, active[0].periodicKey],
        );
      }
      await assert.rejects(
        db.exec(certified),
        /full evidence mismatch/,
      );
      await db.exec("rollback");
      assert.equal(
        await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [JOB_A]),
        "queued",
      );
    } finally {
      await db.close();
    }
  }
});

test("v3 predecessor function or review-ledger guard drift fails before retirement", async () => {
  const source = await readFile(migrationUrl, "utf8");
  for (const drift of ["function", "rls"]) {
    const active = [{
      id: JOB_A,
      status: "queued",
      periodicKey: `competitor:v1:${drift}-postimage-drift`,
    }];
    const db = await createDatabase();
    try {
      await insertJob(db, active[0]);
      const certified = await migrationForSyntheticPreimage(db, source, active);
      if (drift === "function") {
        await db.exec(`
          create or replace function sellerpilot_private.valid_competitor_v3_item(p_item jsonb)
          returns boolean language sql immutable set search_path = ''
          as $$ select false $$
        `);
      } else {
        await db.exec(
          "alter table sellerpilot_private.competitor_match_review_events disable row level security",
        );
      }
      await assert.rejects(
        db.exec(certified),
        /competitor v3 predecessor postimage drifted/,
      );
      await db.exec("rollback");
      assert.equal(
        await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [JOB_A]),
        "queued",
      );
    } finally {
      await db.close();
    }
  }
});

test("any unexpected non-empty active set fails closed", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const db = await createDatabase();
  try {
    await insertJob(db, {
      id: JOB_A,
      status: "queued",
      periodicKey: "competitor:v1:unexpected",
    });
    await assert.rejects(
      db.exec(source),
      /competitor search retirement target drifted/,
    );
    await db.exec("rollback");
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [JOB_A],
      ),
      "queued",
    );
  } finally {
    await db.close();
  }
});

test("an empty target on a used database is not accepted as a clean replay", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const db = await createDatabase();
  try {
    await insertJob(db, {
      id: HISTORICAL_JOB,
      status: "succeeded",
      periodicKey: "competitor:v1:historical",
      responsePayload: { ok: true, items: [] },
      attemptCount: 1,
      startedAt: "2026-08-29T00:00:00Z",
    });
    await assert.rejects(
      db.exec(source),
      /target absent on non-empty database/,
    );
    await db.exec("rollback");
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [HISTORICAL_JOB]),
      "succeeded",
    );
  } finally {
    await db.close();
  }
});

test("a queued row with prior error evidence aborts without mutation", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const active = [{
    id: JOB_A,
    status: "queued",
    periodicKey: "competitor:v1:error-drift",
  }];
  const db = await createDatabase();
  try {
    await insertJob(db, {
      ...active[0],
      error: "PREVIOUS_RETRY_ERROR",
    });
    await assert.rejects(
      db.exec(await migrationForSyntheticPreimage(db, source, active)),
      /contains a non-retirable active row/,
    );
    await db.exec("rollback");
    assert.deepEqual(
      (await db.query(
        "select status,error_message,completed_at from sellerpilot_private.channel_gateway_jobs where id=$1",
        [JOB_A],
      )).rows,
      [{ status: "queued", error_message: "PREVIOUS_RETRY_ERROR", completed_at: null }],
    );
  } finally {
    await db.close();
  }
});

test("migration history must contain only the exact v3 predecessors", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const db = await createDatabase();
  try {
    await db.query(
      "delete from supabase_migrations.schema_migrations where version='20260831131000'",
    );
    await assert.rejects(
      db.exec(source),
      /competitor queue retirement migration history drifted/,
    );
  } finally {
    await db.close();
  }
});

test("running, claimed, provider-touched, or lineage-bound active rows abort before retirement", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const unsafeCases = [
    { status: "running" },
    { workerTokenId: "50000000-0000-4000-8000-000000000001" },
    { claimToken: "60000000-0000-4000-8000-000000000001" },
    { leaseExpiresAt: "2099-01-01T00:00:00Z" },
    { providerStartedAt: "2026-08-31T00:00:00Z" },
    { responsePayload: { ok: true, items: [] } },
  ];

  for (const [index, unsafe] of unsafeCases.entries()) {
    const db = await createDatabase();
    try {
      await insertJob(db, {
        id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        periodicKey: `competitor:v1:unsafe-${index}`,
        ...unsafe,
      });
      await assert.rejects(
        db.exec(source),
        /active or provider-touched competitor search prevents queue retirement/,
      );
    } finally {
      await db.close();
    }
  }

  for (const [index, attempted] of [
    { attemptCount: 1 },
    { startedAt: "2026-08-31T00:00:00Z" },
  ].entries()) {
    const db = await createDatabase();
    const row = {
      id: `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      status: "queued",
      periodicKey: `competitor:v1:attempted-${index}`,
    };
    try {
      await insertJob(db, { ...row, ...attempted });
      await assert.rejects(
        db.exec(await migrationForSyntheticPreimage(db, source, [row])),
        /competitor search retirement contains a non-retirable active row/,
      );
    } finally {
      await db.close();
    }
  }

  const db = await createDatabase();
  const lineageBound = [{
    id: JOB_A,
    status: "queued",
    periodicKey: "competitor:v1:lineage-bound",
  }];
  try {
    await insertJob(db, {
      ...lineageBound[0],
      attemptId: "80000000-0000-4000-8000-000000000001",
    });
    await assert.rejects(
      db.exec(await migrationForSyntheticPreimage(db, source, lineageBound)),
      /competitor search retirement contains a non-retirable active row/,
    );
  } finally {
    await db.close();
  }
});
