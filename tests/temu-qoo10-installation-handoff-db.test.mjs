import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { PGlite } = await import(
  process.env.PGLITE_MODULE ?? "@electric-sql/pglite"
);

const FAC9 = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
const ATTEMPT = "4402cc76-295b-4e17-8c07-d5d0e9967ce9";
const LISTING = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const PRODUCT = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const CREDENTIAL = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const OWNER = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const CREATED_BY = "21eb1892-0894-4f9f-b414-4c9464182dd6";
const SELLER_KEY = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
const FINGERPRINT = "76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799";
const REQUEST_SHA = "c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d";
const RESPONSE_SHA = "b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768";
const FENCE_ERROR = /listing mutation jobs must be terminal before Temu publication release installation/;

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260831133000_expand_verified_publication_to_temu.sql",
    import.meta.url,
  ),
  "utf8",
);
const installationFence = migration.match(
  /do \$temu_publication_installation_fence\$[\s\S]*?\$temu_publication_installation_fence\$;/,
)?.[0];
assert.ok(installationFence, "Temu installation fence must be extractable");

const compatibilitySql = String.raw`
create schema sellerpilot_private;
create schema extensions;

create or replace function extensions.digest(value text, algorithm text)
returns bytea language sql immutable as $$
  select case when lower(algorithm) = 'sha256'
    then sha256(convert_to(value, 'UTF8'))
    else convert_to(md5(value || algorithm), 'UTF8') end
$$;

create table sellerpilot_private.test_qoo10_source_current (
  singleton boolean primary key default true,
  is_current boolean not null
);
insert into sellerpilot_private.test_qoo10_source_current values (true, true);

create table sellerpilot_private.channel_credentials (
  id uuid primary key,
  channel text,
  environment text,
  status text,
  seller_account_key text,
  created_by uuid
);
create table sellerpilot_private.channel_operation_attempts (
  id uuid primary key,
  owner_id uuid,
  credential_id uuid,
  channel text,
  operation text,
  status text,
  http_status integer,
  remote_id text,
  started_at timestamptz,
  completed_at timestamptz,
  gateway_write_required boolean,
  pre_gateway_retryable boolean,
  seller_account_key text
);
create table sellerpilot_private.products (
  id uuid primary key,
  owner_id uuid,
  status text,
  demo boolean
);
create table sellerpilot_private.product_listings (
  id uuid primary key,
  owner_id uuid,
  product_id uuid,
  channel_key text,
  market text,
  target_id text,
  operation_attempt_id uuid,
  status text,
  failure_class text,
  remote_visibility text,
  requested_publication_intent text,
  remote_id text,
  provider_status text,
  seller_account_key text,
  marketplace_sku text,
  updated_at timestamptz
);
create table sellerpilot_private.channel_gateway_jobs (
  id uuid primary key,
  attempt_id uuid,
  listing_id uuid,
  credential_id uuid,
  created_by uuid,
  channel text,
  operation text,
  environment text,
  status text,
  attempt_count integer,
  request_payload jsonb,
  response_payload jsonb,
  request_fingerprint text,
  seller_account_key text,
  error_message text,
  worker_token_id uuid,
  claim_token uuid,
  lease_expires_at timestamptz,
  write_resource_kind text,
  write_resource_key text,
  started_at timestamptz,
  provider_mutation_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
create table sellerpilot_private.gateway_completion_receipts (
  job_id uuid primary key
);
create table sellerpilot_private.listing_mutation_release_gate (
  singleton boolean primary key,
  is_open boolean,
  opened_at timestamptz,
  opened_release_sha text,
  opened_channel text,
  updated_at timestamptz
);

create function sellerpilot_private.qoo10_exact_s1_source_is_current()
returns boolean language sql stable as $$
  select is_current
    from sellerpilot_private.test_qoo10_source_current
   where singleton
$$;
create function sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(uuid)
returns boolean language sql stable as $$ select false $$;
`;

const fixtureSql = String.raw`
insert into sellerpilot_private.channel_credentials values (
  '${CREDENTIAL}', 'qoo10', 'production', 'active', '${SELLER_KEY}', '${CREATED_BY}'
);
insert into sellerpilot_private.channel_operation_attempts values (
  '${ATTEMPT}', '${OWNER}', '${CREDENTIAL}', 'qoo10', 'listing.update',
  'manual_required', 409, '1217336970',
  '2026-08-30 22:38:33.731944+00', '2026-08-30 23:40:12.844179+00',
  true, false, '${SELLER_KEY}'
);
insert into sellerpilot_private.products values (
  '${PRODUCT}', '${OWNER}', 'ready', false
);
insert into sellerpilot_private.product_listings values (
  '${LISTING}', '${OWNER}', '${PRODUCT}', 'qoo10', 'JP', '', '${ATTEMPT}',
  'failed', 'external_action', 'unknown', 'live', '1217336970', null,
  '${SELLER_KEY}', null, '2026-08-30 23:40:12.971653+00'
);
insert into sellerpilot_private.channel_gateway_jobs values (
  '${FAC9}', '${ATTEMPT}', '${LISTING}', '${CREDENTIAL}', '${CREATED_BY}',
  'qoo10', 'listing.update', 'production', 'reconciliation_required', 1,
  '{"arguments":{"params":{"ItemCode":"1217336970"}}}'::jsonb,
  '{"steps":[],"remoteId":"1217336970"}'::jsonb,
  '${FINGERPRINT}', '${SELLER_KEY}', 'manual reconciliation required',
  null, null, null, null, null,
  '2026-08-30 23:40:03.366985+00',
  '2026-08-30 23:40:04.536552+00',
  '2026-08-30 23:40:12.844179+00',
  '2026-08-30 22:38:33+00', '2026-08-30 23:40:12.844179+00'
);
insert into sellerpilot_private.gateway_completion_receipts values ('${FAC9}');
insert into sellerpilot_private.listing_mutation_release_gate values (
  true, false, null, null, null, '2026-08-30 23:41:00+00'
);
`;

async function setup() {
  const db = new PGlite();
  await db.exec(compatibilitySql);
  await db.exec(fixtureSql);
  const { rows: [payload] } = await db.query(`
    select pg_catalog.octet_length(request_payload::text) request_bytes,
           encode(extensions.digest(request_payload::text, 'sha256'), 'hex') request_sha,
           pg_catalog.octet_length(response_payload::text) response_bytes,
           encode(extensions.digest(response_payload::text, 'sha256'), 'hex') response_sha
      from sellerpilot_private.channel_gateway_jobs
     where id='${FAC9}'::uuid
  `);
  const executableFence = installationFence
    .replace("23555", String(payload.request_bytes))
    .replace(REQUEST_SHA, payload.request_sha)
    .replace("16669", String(payload.response_bytes))
    .replace(RESPONSE_SHA, payload.response_sha);
  return { db, executableFence };
}

async function jobSnapshot(db) {
  const { rows } = await db.query(`
    select to_jsonb(job) snapshot
      from sellerpilot_private.channel_gateway_jobs job
     where id='${FAC9}'::uuid
  `);
  return rows[0]?.snapshot;
}

test("Temu installation hands off only the immutable exact Qoo10 source", async () => {
  const { db, executableFence } = await setup();
  try {
    const before = await jobSnapshot(db);
    await db.exec(executableFence);
    assert.deepEqual(await jobSnapshot(db), before, "fac9 must remain byte-for-byte unchanged");
    const { rows: [gate] } = await db.query(`
      select is_open, opened_at, opened_release_sha, opened_channel
        from sellerpilot_private.listing_mutation_release_gate
       where singleton
    `);
    assert.deepEqual(gate, {
      is_open: false,
      opened_at: null,
      opened_release_sha: null,
      opened_channel: null,
    });
    const { rows: [source] } = await db.query(`
      select status, provider_mutation_started_at
        from sellerpilot_private.channel_gateway_jobs
       where id='${FAC9}'::uuid
    `);
    assert.equal(source.status, "reconciliation_required");
    assert.ok(source.provider_mutation_started_at);
  } finally {
    await db.close();
  }
});

const negativeCases = [
  [
    "source-current helper is false",
    `update sellerpilot_private.test_qoo10_source_current set is_current=false`,
  ],
  [
    "release gate is open",
    `update sellerpilot_private.listing_mutation_release_gate
        set is_open=true, opened_at=clock_timestamp(), opened_release_sha='${"a".repeat(40)}'`,
  ],
  [
    "remote listing identity drifts",
    `update sellerpilot_private.product_listings set remote_id='1217336971'`,
  ],
  [
    "credential identity drifts",
    `update sellerpilot_private.channel_gateway_jobs
        set credential_id='11111111-1111-4111-8111-111111111111'`,
  ],
  [
    "seller account becomes null",
    `update sellerpilot_private.channel_gateway_jobs set seller_account_key=null`,
  ],
  [
    "request fingerprint becomes null",
    `update sellerpilot_private.channel_gateway_jobs set request_fingerprint=null`,
  ],
  [
    "request payload drifts",
    `update sellerpilot_private.channel_gateway_jobs
        set request_payload=jsonb_set(request_payload,'{arguments,params,ItemCode}','"1217336971"')`,
  ],
  [
    "provider response contains an activation step",
    `update sellerpilot_private.channel_gateway_jobs
        set response_payload='{"steps":[{"name":"EditGoodsStatus"}]}'::jsonb`,
  ],
  [
    "completion receipt is absent",
    `delete from sellerpilot_private.gateway_completion_receipts`,
  ],
  [
    "source status is queued instead of reconciliation-required",
    `update sellerpilot_private.channel_gateway_jobs set status='queued'`,
  ],
  [
    "another unresolved listing mutation exists",
    `insert into sellerpilot_private.channel_gateway_jobs (
       id, operation, status, request_payload, created_at, updated_at
     ) values (
       '22222222-2222-4222-8222-222222222222', 'listing.activate', 'queued',
       '{}'::jsonb, clock_timestamp(), clock_timestamp()
     )`,
  ],
];

for (const [name, driftSql] of negativeCases) {
  test(`Temu installation rejects when ${name}`, async () => {
    const { db, executableFence } = await setup();
    try {
      await db.exec(driftSql);
      await assert.rejects(db.exec(executableFence), FENCE_ERROR);
      assert.equal(
        (await db.query(`select is_open from sellerpilot_private.listing_mutation_release_gate where singleton`)).rows[0].is_open,
        name === "release gate is open",
      );
    } finally {
      await db.close();
    }
  });
}
