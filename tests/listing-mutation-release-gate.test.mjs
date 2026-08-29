import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830095000_close_listing_mutations_until_adapters_ready.sql",
  import.meta.url,
);

const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";
const RESERVED_PRODUCT_ID = "10000000-0000-4000-8000-000000000002";
const CREDENTIAL_ID = "20000000-0000-4000-8000-000000000001";
const CREATE_ATTEMPT_ID = "30000000-0000-4000-8000-000000000001";
const UPDATE_ATTEMPT_ID = "30000000-0000-4000-8000-000000000002";
const READ_JOB_ID = "30000000-0000-4000-8000-000000000003";
const FINGERPRINT = "a".repeat(64);

async function setupBase({ activeJob = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema sellerpilot_private;

    create table sellerpilot_private.product_listings (
      id uuid primary key,
      status text not null
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      listing_id uuid,
      operation text not null,
      status text not null
    );

    create function public.sellerpilot_service_reserve_and_enqueue_listing_create(
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
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      insert into sellerpilot_private.product_listings (id, status)
      values (p_product_id, 'reserved');
      insert into sellerpilot_private.channel_gateway_jobs (
        id, listing_id, operation, status
      ) values (p_attempt_id, p_product_id, 'listing.create', 'queued');
      return jsonb_build_object('source', 'reserve-predecessor');
    end;
    $$;

    create function public.sellerpilot_service_enqueue_listing_gateway_job(
      p_listing_id uuid,
      p_credential_id uuid,
      p_attempt_id uuid,
      p_channel text,
      p_operation text,
      p_request_payload jsonb
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      update sellerpilot_private.product_listings
         set status = 'enqueued-' || p_operation
       where id = p_listing_id;
      insert into sellerpilot_private.channel_gateway_jobs (
        id, listing_id, operation, status
      ) values (p_attempt_id, p_listing_id, p_operation, 'queued');
      return jsonb_build_object('source', 'enqueue-predecessor');
    end;
    $$;

    create function public.sellerpilot_service_begin_gateway_provider_mutation(
      p_token_hash text,
      p_job_id uuid,
      p_claim_token uuid
    )
    returns boolean
    language sql
    security definer
    set search_path = ''
    as $$ select true $$;

    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,
      p_job_id uuid,
      p_claim_token uuid
    )
    returns boolean
    language sql
    security definer
    set search_path = ''
    as $$ select true $$;
  `);
  await db.query(
    "insert into sellerpilot_private.product_listings(id,status) values ($1,'unchanged')",
    [PRODUCT_ID],
  );
  if (activeJob) {
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
         id,listing_id,operation,status
       ) values ($1,$2,'listing.update','running')`,
      [UPDATE_ATTEMPT_ID, PRODUCT_ID],
    );
  }
  return db;
}

async function callReserve(db) {
  return db.query(
    `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
       $1,$2,$3,'coupang','KR','',$4,1000,$5,'{}'::jsonb
     ) as result`,
    [RESERVED_PRODUCT_ID, CREDENTIAL_ID, CREATE_ATTEMPT_ID, "KRW", FINGERPRINT],
  );
}

async function callEnqueue(db) {
  return db.query(
    `select public.sellerpilot_service_enqueue_listing_gateway_job(
       $1,$2,$3,'coupang','listing.update','{}'::jsonb
     ) as result`,
    [PRODUCT_ID, CREDENTIAL_ID, UPDATE_ATTEMPT_ID],
  );
}

test("listing mutation release gate migration is ordered and service-role only", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.ok(
    migrationUrl.pathname.split("/").at(-1) < "20260830100000_verified_remote_publication_ledger.sql",
    "the closed gate must install before the verified publication ledger",
  );
  assert.match(migration, /is_open boolean not null default false/i);
  assert.match(
    migration,
    /job\.status in \('queued', 'running'\)[\s\S]*release-gate installation/i,
  );
  assert.match(
    migration,
    /sellerpilot_service_set_listing_mutation_release_gate\(boolean\)[\s\S]*to service_role/i,
  );
  assert.match(
    migration,
    /sellerpilot_service_reserve_and_enqueue_listing_create[\s\S]*LISTING_MUTATION_RELEASE_GATE_CLOSED/i,
  );
  assert.match(
    migration,
    /sellerpilot_service_enqueue_listing_gateway_job[\s\S]*LISTING_MUTATION_RELEASE_GATE_CLOSED/i,
  );
  assert.match(
    migration,
    /create trigger block_closed_listing_mutation_claim[\s\S]*before update of status[\s\S]*channel_gateway_jobs/i,
  );
  assert.match(
    migration,
    /old\.status = 'queued'[\s\S]*new\.status = 'running'[\s\S]*LISTING_MUTATION_RELEASE_GATE_CLOSED/i,
  );
  assert.match(
    migration,
    /sellerpilot_service_begin_gateway_provider_mutation[\s\S]*v_operation in \('listing\.create', 'listing\.update', 'listing\.stop'\)[\s\S]*gate\.is_open/i,
  );
  assert.match(
    migration,
    /sellerpilot_service_begin_serverless_gateway_provider_mutation[\s\S]*v_operation in \('listing\.create', 'listing\.update', 'listing\.stop'\)[\s\S]*gate\.is_open/i,
  );
  assert.match(migration, /sellerpilot_300950_reserve_listing_before_release_gate/);
  assert.match(migration, /sellerpilot_300950_enqueue_listing_before_release_gate/);
});

test("migration aborts when a queued or running listing mutation exists", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = await setupBase({ activeJob: true });
  await assert.rejects(
    db.exec(migration),
    /listing mutation jobs must drain before release-gate installation/i,
  );
  await db.close();
});

test("closed gate rejects create/update before listing or job side effects", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = await setupBase();
  await db.exec(migration);

  const initialStatus = await db.query(
    "select public.sellerpilot_service_listing_mutation_release_gate_status() as value",
  );
  assert.deepEqual(initialStatus.rows[0].value, {
    contract: "verified_publication_release_gate_v1",
    open: false,
    state: "closed",
    openedAt: null,
    updatedAt: initialStatus.rows[0].value.updatedAt,
    queuedOrRunning: 0,
    reconciliationRequired: 0,
  });

  await assert.rejects(callReserve(db), /LISTING_MUTATION_RELEASE_GATE_CLOSED/);
  await assert.rejects(callEnqueue(db), /LISTING_MUTATION_RELEASE_GATE_CLOSED/);

  const sideEffects = await db.query(`
    select
      (select count(*)::integer
         from sellerpilot_private.product_listings) as listing_count,
      (select status
         from sellerpilot_private.product_listings
        where id = '${PRODUCT_ID}') as listing_status,
      (select count(*)::integer
         from sellerpilot_private.channel_gateway_jobs) as job_count
  `);
  assert.deepEqual(sideEffects.rows[0], {
    listing_count: 1,
    listing_status: "unchanged",
    job_count: 0,
  });

  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
       id,listing_id,operation,status
     ) values ($1,$2,'listing.update','queued')`,
    [UPDATE_ATTEMPT_ID, PRODUCT_ID],
  );
  await assert.rejects(
    db.query(
      "update sellerpilot_private.channel_gateway_jobs set status='running' where id=$1",
      [UPDATE_ATTEMPT_ID],
    ),
    /LISTING_MUTATION_RELEASE_GATE_CLOSED/,
  );
  assert.equal(
    (await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [UPDATE_ATTEMPT_ID],
    )).rows[0].status,
    "queued",
  );

  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
       id,listing_id,operation,status
     ) values ($1,$2,'orders.list','queued')`,
    [READ_JOB_ID, PRODUCT_ID],
  );
  await db.query(
    "update sellerpilot_private.channel_gateway_jobs set status='running' where id=$1",
    [READ_JOB_ID],
  );
  assert.equal(
    (await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [READ_JOB_ID],
    )).rows[0].status,
    "running",
  );

  const privileges = await db.query(`
    select
      has_function_privilege(
        'anon',
        'public.sellerpilot_service_listing_mutation_release_gate_status()',
        'EXECUTE'
      ) as anon_status,
      has_function_privilege(
        'authenticated',
        'public.sellerpilot_service_set_listing_mutation_release_gate(boolean)',
        'EXECUTE'
      ) as authenticated_setter,
      has_function_privilege(
        'service_role',
        'public.sellerpilot_service_listing_mutation_release_gate_status()',
        'EXECUTE'
      ) as service_status,
      has_function_privilege(
        'service_role',
        'public.sellerpilot_service_set_listing_mutation_release_gate(boolean)',
        'EXECUTE'
      ) as service_setter
  `);
  assert.deepEqual(privileges.rows[0], {
    anon_status: false,
    authenticated_setter: false,
    service_status: true,
    service_setter: true,
  });
  await db.close();
});

test("gate activation refuses active mutations and open gate delegates unchanged", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = await setupBase();
  await db.exec(migration);

  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
       id,listing_id,operation,status
     ) values ($1,$2,'listing.stop','queued')`,
    [CREATE_ATTEMPT_ID, PRODUCT_ID],
  );
  await assert.rejects(
    db.query(
      "select public.sellerpilot_service_set_listing_mutation_release_gate(true)",
    ),
    /listing mutation jobs must drain before release-gate activation/i,
  );
  const stillClosed = await db.query(
    "select is_open from sellerpilot_private.listing_mutation_release_gate",
  );
  assert.equal(stillClosed.rows[0].is_open, false);

  await db.query("delete from sellerpilot_private.channel_gateway_jobs");
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
       id,listing_id,operation,status
     ) values ($1,$2,'listing.update','reconciliation_required')`,
    [CREATE_ATTEMPT_ID, PRODUCT_ID],
  );
  await assert.rejects(
    db.query(
      "select public.sellerpilot_service_set_listing_mutation_release_gate(true)",
    ),
    /listing mutation reconciliations must be resolved before release-gate activation/i,
  );
  await db.query("delete from sellerpilot_private.channel_gateway_jobs");
  const opened = await db.query(
    "select public.sellerpilot_service_set_listing_mutation_release_gate(true) as value",
  );
  assert.equal(opened.rows[0].value.open, true);
  assert.equal(opened.rows[0].value.state, "open");
  assert.equal(opened.rows[0].value.queuedOrRunning, 0);

  const reserved = await callReserve(db);
  assert.equal(reserved.rows[0].result.source, "reserve-predecessor");
  const reserveEffects = await db.query(`
    select
      (select status from sellerpilot_private.product_listings
        where id = '${RESERVED_PRODUCT_ID}') as listing_status,
      (select operation from sellerpilot_private.channel_gateway_jobs
        where id = '${CREATE_ATTEMPT_ID}') as job_operation
  `);
  assert.deepEqual(reserveEffects.rows[0], {
    listing_status: "reserved",
    job_operation: "listing.create",
  });

  await db.query(
    "delete from sellerpilot_private.channel_gateway_jobs where id=$1",
    [CREATE_ATTEMPT_ID],
  );
  const enqueued = await callEnqueue(db);
  assert.equal(enqueued.rows[0].result.source, "enqueue-predecessor");
  const enqueueEffects = await db.query(`
    select
      (select status from sellerpilot_private.product_listings
        where id = '${PRODUCT_ID}') as listing_status,
      (select operation from sellerpilot_private.channel_gateway_jobs
        where id = '${UPDATE_ATTEMPT_ID}') as job_operation
  `);
  assert.deepEqual(enqueueEffects.rows[0], {
    listing_status: "enqueued-listing.update",
    job_operation: "listing.update",
  });
  await db.query(
    "update sellerpilot_private.channel_gateway_jobs set status='running' where id=$1",
    [UPDATE_ATTEMPT_ID],
  );
  assert.equal(
    (await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [UPDATE_ATTEMPT_ID],
    )).rows[0].status,
    "running",
  );
  await db.close();
});

test("closing the gate after claim blocks both worker mutation boundaries", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = await setupBase();
  await db.exec(migration);
  await db.query(
    "select public.sellerpilot_service_set_listing_mutation_release_gate(true)",
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
       id,listing_id,operation,status
     ) values ($1,$2,'listing.create','running')`,
    [CREATE_ATTEMPT_ID, PRODUCT_ID],
  );

  const tokenHash = "b".repeat(64);
  assert.equal(
    (await db.query(
      "select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3) as value",
      [tokenHash, CREATE_ATTEMPT_ID, CREATE_ATTEMPT_ID],
    )).rows[0].value,
    true,
  );
  assert.equal(
    (await db.query(
      "select public.sellerpilot_service_begin_serverless_gateway_provider_mutation($1,$2,$3) as value",
      [tokenHash, CREATE_ATTEMPT_ID, CREATE_ATTEMPT_ID],
    )).rows[0].value,
    true,
  );

  await db.query(
    "select public.sellerpilot_service_set_listing_mutation_release_gate(false)",
  );
  for (const functionName of [
    "sellerpilot_service_begin_gateway_provider_mutation",
    "sellerpilot_service_begin_serverless_gateway_provider_mutation",
  ]) {
    assert.equal(
      (await db.query(
        `select public.${functionName}($1,$2,$3) as value`,
        [tokenHash, CREATE_ATTEMPT_ID, CREATE_ATTEMPT_ID],
      )).rows[0].value,
      false,
      functionName,
    );
  }

  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
       id,listing_id,operation,status
     ) values ($1,$2,'orders.list','running')`,
    [READ_JOB_ID, PRODUCT_ID],
  );
  assert.equal(
    (await db.query(
      "select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3) as value",
      [tokenHash, READ_JOB_ID, READ_JOB_ID],
    )).rows[0].value,
    true,
    "non-listing provider work remains available while the listing gate is closed",
  );
  await db.close();
});
