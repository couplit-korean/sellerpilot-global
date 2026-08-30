import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830205000_restore_verified_listing_intent_after_effective_gate.sql",
  import.meta.url,
);
const contractMigrationUrl = new URL(
  "../supabase/migrations/20260830100000_verified_remote_publication_ledger.sql",
  import.meta.url,
);

const CREDENTIAL_ID = "00000000-0000-4000-8000-000000000001";
const LISTING_CHANNELS = [
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "smartstore",
  "ebay",
  "temu",
];

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} must exist`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(end > start, `${signature} must have a complete body`);
  return source.slice(start, end + "\n$$;".length);
}

function verifiedPayload({
  operation = "listing.create",
  fingerprint,
  intent = "live",
  locale = "ja-JP",
}) {
  return {
    arguments: {
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: locale,
      publicationExpectedFingerprint: fingerprint,
      publicationExpectedImageCount: operation === "listing.stop" ? 0 : 8,
      ...(operation === "listing.stop" ? {} : { publicationIntent: intent }),
    },
  };
}

async function setupDatabase() {
  const [migration, contractMigration] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(contractMigrationUrl, "utf8"),
  ]);
  const db = new PGlite();
  await db.exec(`
    create schema sellerpilot_private;

    create table sellerpilot_private.test_enqueue_runtime (
      singleton boolean primary key default true check (singleton),
      gate_effective boolean not null default true,
      create_status text not null default 'queued',
      create_reused boolean not null default false,
      create_existing_listing_id uuid,
      create_lineage text not null default 'exact',
      existing_job_status text not null default 'queued',
      existing_lineage text not null default 'exact',
      existing_prebound boolean not null default false
    );
    insert into sellerpilot_private.test_enqueue_runtime(singleton) values (true);

    create table sellerpilot_private.product_listings (
      id uuid primary key,
      channel_key text not null,
      requested_publication_intent text not null default 'safe_test',
      operation_attempt_id uuid,
      remote_visibility text not null default 'unknown',
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      remote_created_at timestamptz,
      published_at timestamptz,
      last_verified_at timestamptz,
      updated_at timestamptz not null default clock_timestamp()
    );

    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      request_fingerprint text not null
    );

    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      status text not null,
      request_payload jsonb not null,
      request_fingerprint text,
      updated_at timestamptz not null default clock_timestamp()
    );

    create table sellerpilot_private.test_enqueue_predecessor_calls (
      id bigint generated always as identity primary key,
      kind text not null,
      channel text not null,
      operation text not null,
      request_payload jsonb not null,
      request_fingerprint text
    );

    create function sellerpilot_private.listing_mutation_release_gate_is_effective()
    returns boolean
    language sql
    stable
    set search_path = ''
    as $$
      select runtime.gate_effective
        from sellerpilot_private.test_enqueue_runtime runtime
       where runtime.singleton
    $$;

    create function public.sellerpilot_300950_reserve_listing_before_release_gate(
      p_product_id uuid,
      p_credential_id uuid,
      p_attempt_id uuid,
      p_channel text,
      p_market text,
      p_target_id text,
      p_currency text,
      p_price numeric,
      p_request_fingerprint text,
      p_request_payload jsonb
    ) returns jsonb
    language plpgsql
    set search_path = ''
    as $$
    declare
      v_runtime sellerpilot_private.test_enqueue_runtime%rowtype;
      v_job_channel text;
      v_listing_id uuid;
    begin
      select * into strict v_runtime
        from sellerpilot_private.test_enqueue_runtime runtime
       where runtime.singleton;
      insert into sellerpilot_private.test_enqueue_predecessor_calls(
        kind,channel,operation,request_payload,request_fingerprint
      ) values (
        'create',p_channel,'listing.create',p_request_payload,p_request_fingerprint
      );
      if v_runtime.create_status <> 'queued' then
        return jsonb_build_object('status', v_runtime.create_status);
      end if;
      v_listing_id := coalesce(v_runtime.create_existing_listing_id, p_attempt_id);
      if v_runtime.create_existing_listing_id is null then
        insert into sellerpilot_private.product_listings(
          id,channel_key,requested_publication_intent,operation_attempt_id
        ) values (
          v_listing_id,p_channel,'safe_test',p_attempt_id
        );
      else
        update sellerpilot_private.product_listings
           set operation_attempt_id=p_attempt_id,
               updated_at=clock_timestamp()
         where id=v_listing_id and channel_key=p_channel;
        if not found then raise exception 'fixture existing listing missing'; end if;
      end if;
      v_job_channel := case
        when v_runtime.create_lineage = 'wrong_channel' then 'wrong-channel'
        else p_channel
      end;
      insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,listing_id,channel,operation,status,request_payload,
        request_fingerprint
      ) values (
        p_product_id,p_attempt_id,v_listing_id,v_job_channel,'listing.create',
        'queued',p_request_payload,p_request_fingerprint
      );
      return jsonb_build_object(
        'status','queued',
        'reused',v_runtime.create_reused,
        'job_id',p_product_id,
        'listing_id',v_listing_id,
        'attempt_id',p_attempt_id
      );
    end;
    $$;

    create function public.sellerpilot_300950_enqueue_listing_before_release_gate(
      p_listing_id uuid,
      p_credential_id uuid,
      p_attempt_id uuid,
      p_channel text,
      p_operation text,
      p_request_payload jsonb
    ) returns jsonb
    language plpgsql
    set search_path = ''
    as $$
    declare
      v_runtime sellerpilot_private.test_enqueue_runtime%rowtype;
      v_channel text;
      v_fingerprint text;
    begin
      select * into strict v_runtime
        from sellerpilot_private.test_enqueue_runtime runtime
       where runtime.singleton;
      insert into sellerpilot_private.test_enqueue_predecessor_calls(
        kind,channel,operation,request_payload,request_fingerprint
      ) values (
        'existing',p_channel,p_operation,p_request_payload,
        p_request_payload#>>'{arguments,publicationExpectedFingerprint}'
      );
      v_channel := case
        when v_runtime.existing_lineage = 'wrong_channel' then 'wrong-channel'
        else p_channel
      end;
      v_fingerprint := case
        when v_runtime.existing_prebound
          then p_request_payload#>>'{arguments,publicationExpectedFingerprint}'
        else null
      end;
      insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,listing_id,channel,operation,status,request_payload,
        request_fingerprint
      ) values (
        p_attempt_id,p_attempt_id,p_listing_id,v_channel,p_operation,
        v_runtime.existing_job_status,p_request_payload,v_fingerprint
      );
      return jsonb_build_object('status','queued','job_id',p_attempt_id);
    end;
    $$;
  `);
  await db.exec(extractFunction(
    contractMigration,
    "create function sellerpilot_private.assert_verified_listing_enqueue_contract",
  ));
  await db.exec(extractFunction(
    migration,
    "create or replace function public.sellerpilot_service_reserve_and_enqueue_listing_create",
  ));
  await db.exec(extractFunction(
    migration,
    "create or replace function public.sellerpilot_service_enqueue_listing_gateway_job",
  ));
  return db;
}

async function callCreate(db, {
  productId,
  attemptId,
  channel,
  fingerprint,
  payload,
}) {
  return db.query(
    `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
       $1,$2,$3,$4,'JP','seller-target','JPY',1000,$5,$6::jsonb
     ) as result`,
    [
      productId,
      CREDENTIAL_ID,
      attemptId,
      channel,
      fingerprint,
      JSON.stringify(payload),
    ],
  ).then((result) => result.rows[0].result);
}

async function callExisting(db, {
  listingId,
  attemptId,
  channel,
  operation,
  payload,
}) {
  return db.query(
    `select public.sellerpilot_service_enqueue_listing_gateway_job(
       $1,$2,$3,$4,$5,$6::jsonb
     ) as result`,
    [listingId, CREDENTIAL_ID, attemptId, channel, operation, JSON.stringify(payload)],
  ).then((result) => result.rows[0].result);
}

test("forward migration restores both verified wrappers after the effective gate", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /create or replace function public\.sellerpilot_service_reserve_and_enqueue_listing_create/);
  assert.match(migration, /create or replace function public\.sellerpilot_service_enqueue_listing_gateway_job/);
  assert.match(migration, /listing_mutation_release_gate_is_effective\(\)[\s\S]*assert_verified_listing_enqueue_contract\([\s\S]*sellerpilot_300950_reserve_listing_before_release_gate/);
  assert.match(migration, /job\.request_payload = p_request_payload[\s\S]*job\.request_fingerprint = p_request_fingerprint/);
  assert.match(migration, /requested_publication_intent = v_intent[\s\S]*listing\.operation_attempt_id = p_attempt_id[\s\S]*listing\.channel_key = p_channel/);
  assert.match(migration, /select attempt\.request_fingerprint[\s\S]*listing_mutation_release_gate_is_effective|listing_mutation_release_gate_is_effective\(\)[\s\S]*select attempt\.request_fingerprint/);
  assert.match(migration, /listing update publication intent mismatch/);
  assert.match(migration, /sellerpilot_300950_enqueue_listing_before_release_gate/);
  assert.match(migration, /set request_fingerprint = v_request_fingerprint/);
  assert.match(migration, /from public, anon, authenticated;[\s\S]*to service_role;/);
  assert.doesNotMatch(migration, /alter function public\.sellerpilot_service_/);
});

test("new live listing reservations persist live intent for every gateway listing channel", async (t) => {
  const db = await setupDatabase();
  t.after(() => db.close());

  for (const [index, channel] of LISTING_CHANNELS.entries()) {
    const productId = uuid(100 + index);
    const attemptId = uuid(200 + index);
    const fingerprint = ((index + 1) % 16).toString(16).repeat(64);
    const result = await callCreate(db, {
      productId,
      attemptId,
      channel,
      fingerprint,
      payload: verifiedPayload({ fingerprint }),
    });
    assert.equal(result.status, "queued", channel);
    const ledger = await db.query(
      `select channel_key,requested_publication_intent,remote_visibility
         from sellerpilot_private.product_listings where id=$1`,
      [attemptId],
    ).then((query) => query.rows[0]);
    assert.deepEqual(ledger, {
      channel_key: channel,
      requested_publication_intent: "live",
      remote_visibility: "unknown",
    });
  }

  const safeProductId = uuid(190);
  const safeAttemptId = uuid(290);
  const safeFingerprint = "f".repeat(64);
  await callCreate(db, {
    productId: safeProductId,
    attemptId: safeAttemptId,
    channel: "qoo10",
    fingerprint: safeFingerprint,
    payload: verifiedPayload({ fingerprint: safeFingerprint, intent: "safe_test" }),
  });
  assert.equal(await db.query(
    `select requested_publication_intent
       from sellerpilot_private.product_listings where id=$1`,
    [safeAttemptId],
  ).then((query) => query.rows[0].requested_publication_intent), "safe_test");
});

test("a retry after the legacy Qoo10 failure creates a new live generation on the same listing", async (t) => {
  const db = await setupDatabase();
  t.after(() => db.close());
  const listingId = uuid(291);
  const oldAttemptId = uuid(292);
  const oldJobId = uuid(293);
  const newAttemptId = uuid(294);
  const newJobId = uuid(295);
  const oldFingerprint = "1".repeat(64);
  const liveFingerprint = "2".repeat(64);

  await db.query(
    `insert into sellerpilot_private.product_listings(
       id,channel_key,requested_publication_intent,operation_attempt_id,
       provider_status,remote_resources
     ) values ($1,'qoo10','safe_test',$2,'failed','{}'::jsonb)`,
    [listingId, oldAttemptId],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
       id,attempt_id,listing_id,channel,operation,status,request_payload,
       request_fingerprint
     ) values (
       $1,$2,$3,'qoo10','listing.create','failed',$4::jsonb,$5
     )`,
    [
      oldJobId,
      oldAttemptId,
      listingId,
      JSON.stringify(verifiedPayload({ fingerprint: oldFingerprint, intent: "safe_test" })),
      oldFingerprint,
    ],
  );
  await db.query(
    `update sellerpilot_private.test_enqueue_runtime
        set create_existing_listing_id=$1,create_reused=false`,
    [listingId],
  );

  const result = await callCreate(db, {
    productId: newJobId,
    attemptId: newAttemptId,
    channel: "qoo10",
    fingerprint: liveFingerprint,
    payload: verifiedPayload({ fingerprint: liveFingerprint, intent: "live" }),
  });
  assert.equal(result.status, "queued");
  assert.equal(result.reused, false);
  assert.equal(result.listing_id, listingId);

  const ledger = await db.query(
    `select requested_publication_intent,operation_attempt_id,provider_status,
            remote_resources
       from sellerpilot_private.product_listings where id=$1`,
    [listingId],
  ).then((query) => query.rows[0]);
  assert.deepEqual(ledger, {
    requested_publication_intent: "live",
    operation_attempt_id: newAttemptId,
    provider_status: null,
    remote_resources: {},
  });
  const jobs = await db.query(
    `select id,attempt_id,status,request_fingerprint,
            request_payload#>>'{arguments,publicationIntent}' as publication_intent
       from sellerpilot_private.channel_gateway_jobs
      where listing_id=$1 order by id`,
    [listingId],
  ).then((query) => query.rows);
  assert.deepEqual(jobs, [
    {
      id: oldJobId,
      attempt_id: oldAttemptId,
      status: "failed",
      request_fingerprint: oldFingerprint,
      publication_intent: "safe_test",
    },
    {
      id: newJobId,
      attempt_id: newAttemptId,
      status: "queued",
      request_fingerprint: liveFingerprint,
      publication_intent: "live",
    },
  ]);
});

test("create wrapper fails closed before delegation and rejects forged queued lineage", async (t) => {
  const db = await setupDatabase();
  t.after(() => db.close());
  const productId = uuid(301);
  const attemptId = uuid(302);
  const fingerprint = "a".repeat(64);
  const payload = verifiedPayload({ fingerprint });

  await db.exec(`
    update sellerpilot_private.test_enqueue_runtime set gate_effective=false;
  `);
  await assert.rejects(callCreate(db, {
    productId,
    attemptId,
    channel: "qoo10",
    fingerprint,
    payload,
  }), /LISTING_MUTATION_RELEASE_GATE_CLOSED/);

  await db.exec(`
    update sellerpilot_private.test_enqueue_runtime set gate_effective=true;
  `);
  const invalidPayload = structuredClone(payload);
  delete invalidPayload.arguments.publicationStateContract;
  await assert.rejects(callCreate(db, {
    productId,
    attemptId,
    channel: "qoo10",
    fingerprint,
    payload: invalidPayload,
  }), /invalid verified listing publication contract/);

  assert.equal(await db.query(
    "select count(*)::integer as count from sellerpilot_private.test_enqueue_predecessor_calls",
  ).then((query) => query.rows[0].count), 0);

  await db.exec(`
    update sellerpilot_private.test_enqueue_runtime set create_lineage='wrong_channel';
  `);
  await assert.rejects(callCreate(db, {
    productId,
    attemptId,
    channel: "qoo10",
    fingerprint,
    payload,
  }), /reserved publication job lineage mismatch/);
  assert.equal(await db.query(
    "select count(*)::integer as count from sellerpilot_private.product_listings",
  ).then((query) => query.rows[0].count), 0, "failed exact-lineage checks roll back the reservation");
});

test("reused and non-queued create results preserve predecessor semantics", async (t) => {
  const db = await setupDatabase();
  t.after(() => db.close());
  const fingerprint = "b".repeat(64);

  await db.exec(`
    update sellerpilot_private.test_enqueue_runtime set create_reused=true;
  `);
  const reusedAttemptId = uuid(402);
  const reused = await callCreate(db, {
    productId: uuid(401),
    attemptId: reusedAttemptId,
    channel: "qoo10",
    fingerprint,
    payload: verifiedPayload({ fingerprint }),
  });
  assert.equal(reused.reused, true);
  assert.equal(await db.query(
    `select requested_publication_intent
       from sellerpilot_private.product_listings where id=$1`,
    [reusedAttemptId],
  ).then((query) => query.rows[0].requested_publication_intent), "safe_test");

  await db.exec(`
    update sellerpilot_private.test_enqueue_runtime
       set create_reused=false,create_status='remote_exists';
  `);
  const remoteExists = await callCreate(db, {
    productId: uuid(403),
    attemptId: uuid(404),
    channel: "ebay",
    fingerprint,
    payload: verifiedPayload({ fingerprint }),
  });
  assert.equal(remoteExists.status, "remote_exists");
});

test("listing.update inherits persisted intent and binds the running attempt fingerprint", async (t) => {
  const db = await setupDatabase();
  t.after(() => db.close());
  const listingId = uuid(501);
  const attemptId = uuid(502);
  const fingerprint = "c".repeat(64);
  await db.query(
    `insert into sellerpilot_private.product_listings(
       id,channel_key,requested_publication_intent
     ) values ($1,'qoo10','live')`,
    [listingId],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
       id,credential_id,channel,operation,status,request_fingerprint
     ) values ($1,$2,'qoo10','listing.update','running',$3)`,
    [attemptId, CREDENTIAL_ID, fingerprint],
  );
  const payload = verifiedPayload({
    operation: "listing.update",
    fingerprint,
  });
  delete payload.arguments.publicationIntent;

  const result = await callExisting(db, {
    listingId,
    attemptId,
    channel: "qoo10",
    operation: "listing.update",
    payload,
  });
  assert.equal(result.status, "queued");
  const job = await db.query(
    `select request_payload,request_fingerprint
       from sellerpilot_private.channel_gateway_jobs where id=$1`,
    [attemptId],
  ).then((query) => query.rows[0]);
  assert.equal(job.request_payload.arguments.publicationIntent, "live");
  assert.equal(job.request_fingerprint, fingerprint);

  const mismatchAttemptId = uuid(503);
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
       id,credential_id,channel,operation,status,request_fingerprint
     ) values ($1,$2,'qoo10','listing.update','running',$3)`,
    [mismatchAttemptId, CREDENTIAL_ID, fingerprint],
  );
  await assert.rejects(callExisting(db, {
    listingId,
    attemptId: mismatchAttemptId,
    channel: "qoo10",
    operation: "listing.update",
    payload: verifiedPayload({
      operation: "listing.update",
      fingerprint,
      intent: "safe_test",
    }),
  }), /listing update publication intent mismatch/);
});

test("listing.stop keeps intent out of the payload and exact-binds queued or running jobs", async (t) => {
  const db = await setupDatabase();
  t.after(() => db.close());
  const listingId = uuid(601);
  const queuedAttemptId = uuid(602);
  const queuedFingerprint = "d".repeat(64);
  await db.query(
    `insert into sellerpilot_private.product_listings(
       id,channel_key,requested_publication_intent
     ) values ($1,'ebay','live')`,
    [listingId],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
       id,credential_id,channel,operation,status,request_fingerprint
     ) values ($1,$2,'ebay','listing.stop','running',$3)`,
    [queuedAttemptId, CREDENTIAL_ID, queuedFingerprint],
  );
  await callExisting(db, {
    listingId,
    attemptId: queuedAttemptId,
    channel: "ebay",
    operation: "listing.stop",
    payload: verifiedPayload({ operation: "listing.stop", fingerprint: queuedFingerprint }),
  });
  const queuedJob = await db.query(
    `select request_payload,request_fingerprint
       from sellerpilot_private.channel_gateway_jobs where id=$1`,
    [queuedAttemptId],
  ).then((query) => query.rows[0]);
  assert.equal(Object.hasOwn(queuedJob.request_payload.arguments, "publicationIntent"), false);
  assert.equal(queuedJob.request_fingerprint, queuedFingerprint);

  await db.exec(`
    update sellerpilot_private.test_enqueue_runtime
       set existing_job_status='running',existing_prebound=true;
  `);
  const runningAttemptId = uuid(603);
  const runningFingerprint = "e".repeat(64);
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
       id,credential_id,channel,operation,status,request_fingerprint
     ) values ($1,$2,'ebay','listing.stop','running',$3)`,
    [runningAttemptId, CREDENTIAL_ID, runningFingerprint],
  );
  const running = await callExisting(db, {
    listingId,
    attemptId: runningAttemptId,
    channel: "ebay",
    operation: "listing.stop",
    payload: verifiedPayload({ operation: "listing.stop", fingerprint: runningFingerprint }),
  });
  assert.equal(running.status, "queued");
  assert.equal(await db.query(
    "select request_fingerprint from sellerpilot_private.channel_gateway_jobs where id=$1",
    [runningAttemptId],
  ).then((query) => query.rows[0].request_fingerprint), runningFingerprint);
});

test("existing listing writes fail closed at the effective gate and roll back forged job lineage", async (t) => {
  const db = await setupDatabase();
  t.after(() => db.close());
  const listingId = uuid(701);
  const attemptId = uuid(702);
  const fingerprint = "9".repeat(64);
  await db.query(
    `insert into sellerpilot_private.product_listings(
       id,channel_key,requested_publication_intent
     ) values ($1,'qoo10','safe_test')`,
    [listingId],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
       id,credential_id,channel,operation,status,request_fingerprint
     ) values ($1,$2,'qoo10','listing.update','running',$3)`,
    [attemptId, CREDENTIAL_ID, fingerprint],
  );
  const payload = verifiedPayload({
    operation: "listing.update",
    fingerprint,
    intent: "safe_test",
  });
  delete payload.arguments.publicationIntent;

  await db.exec(`
    update sellerpilot_private.test_enqueue_runtime set gate_effective=false;
  `);
  await assert.rejects(callExisting(db, {
    listingId,
    attemptId,
    channel: "qoo10",
    operation: "listing.update",
    payload,
  }), /LISTING_MUTATION_RELEASE_GATE_CLOSED/);

  await db.exec(`
    update sellerpilot_private.test_enqueue_runtime
       set gate_effective=true,existing_lineage='wrong_channel';
  `);
  await assert.rejects(callExisting(db, {
    listingId,
    attemptId,
    channel: "qoo10",
    operation: "listing.update",
    payload,
  }), /verified publication job lineage mismatch/);
  assert.equal(await db.query(
    "select count(*)::integer as count from sellerpilot_private.channel_gateway_jobs",
  ).then((query) => query.rows[0].count), 0);
  assert.equal(await db.query(
    "select count(*)::integer as count from sellerpilot_private.test_enqueue_predecessor_calls",
  ).then((query) => query.rows[0].count), 0);
});
