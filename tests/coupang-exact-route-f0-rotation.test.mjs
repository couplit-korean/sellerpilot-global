import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908052500_rotate_exact_coupang_routes_to_f0.sql",
  import.meta.url,
), "utf8");

const readPriorRelease = "a81b2c7981ce4d8d2ebd996864f39d501749a484";
const writePriorRelease = "77f970877f755910321c882f379e8b406d552502";
const release = "f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca";
const egress = "92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01";
const sellerKey = "e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd";
const workerVersion = `sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}`;

const id = Object.freeze({
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  credentialOwner: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  workerOwner: "7f448e38-f86f-4749-bc5f-cecf6d0723e5",
  credential: "32de2968-d4b7-4fda-a84b-16a7ce0257cc",
  worker: "02955cb4-fa9f-466b-824f-b61f06276190",
  attributes: "fd27ffd0-59d3-45af-9315-e435a14d27cb",
  validate: "01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8",
  create: "73e07b05-b3bd-47e4-be92-062d537150e9",
  disabledCreate: "b23cb3cd-5a04-4000-8218-a914d2b22461",
  unrelatedRoute: "81000000-0000-4000-8000-000000000001",
  unrelatedCredential: "81000000-0000-4000-8000-000000000002",
  runningJob: "81000000-0000-4000-8000-000000000003",
  unrelatedJob: "81000000-0000-4000-8000-000000000004",
  listing: "81000000-0000-4000-8000-000000000005",
});

const exactRoutes = Object.freeze([
  [id.attributes, "categories.attributes", readPriorRelease],
  [id.validate, "categories.validate", readPriorRelease],
  [id.create, "listing.create", writePriorRelease],
]);

async function scalar(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0] ?? {})[0];
}

async function snapshot(db, relation, orderBy = "id") {
  return (await db.query(
    `select coalesce(jsonb_agg(to_jsonb(row_value) order by ${orderBy}), '[]'::jsonb) snapshot
       from ${relation} row_value`,
  )).rows[0].snapshot;
}

async function database({ gateOpen = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(String.raw`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema sellerpilot_private;

    create table sellerpilot_private.runtime_fixture(
      singleton boolean primary key default true,
      active_release text not null,
      coupang_gate_open boolean not null
    );
    insert into sellerpilot_private.runtime_fixture
      values(true, '${release}', ${gateOpen});

    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,
      token_hash text not null,
      scope text not null,
      status text not null,
      expires_at timestamptz not null,
      last_seen_at timestamptz,
      last_version text,
      created_by uuid not null
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      last_check_status text,
      seller_account_key text,
      seller_account_key_source text,
      created_by uuid not null
    );
    create table sellerpilot_private.local_channel_executor_routes(
      id uuid primary key,
      owner_id uuid not null,
      channel text not null,
      operation text not null,
      credential_id uuid not null,
      seller_account_key text not null,
      worker_token_id uuid not null,
      release_sha text not null,
      egress_ip_sha256 text not null,
      approved_by uuid not null,
      approved_at timestamptz not null,
      expires_at timestamptz not null,
      enabled boolean not null,
      check (
        expires_at > approved_at
        and expires_at <= approved_at + interval '90 days'
      )
    );
    create unique index local_channel_executor_one_active_route_idx
      on sellerpilot_private.local_channel_executor_routes(
        owner_id, channel, operation, credential_id
      ) where enabled;
    create table sellerpilot_private.serverless_static_egress_policy(
      channel text primary key,
      enabled boolean not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      channel text not null,
      operation text not null,
      status text not null,
      worker_token_id uuid,
      payload jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,
      channel_key text not null,
      remote_id text,
      status text not null
    );

    create function sellerpilot_private.active_serverless_runtime_release_sha()
    returns text language sql stable set search_path = '' as $$
      select active_release
        from sellerpilot_private.runtime_fixture
       where singleton
    $$;
    create function sellerpilot_private.listing_mutation_release_gate_is_effective(
      p_channel text
    ) returns boolean language sql stable set search_path = '' as $$
      select p_channel = 'coupang' and coupang_gate_open
        from sellerpilot_private.runtime_fixture
       where singleton
    $$;
    create function sellerpilot_private.local_channel_executor_access(
      p_channel text, p_operation text
    ) returns text language sql immutable set search_path = '' as $$
      select case
        when p_channel = 'coupang'
          and p_operation in ('categories.attributes','categories.validate')
          then 'read'
        when p_channel = 'coupang' and p_operation = 'listing.create'
          then 'write'
        else null
      end
    $$;
    create function sellerpilot_private.local_channel_executor_route_is_current(
      p_owner_id uuid,
      p_channel text,
      p_operation text,
      p_credential_id uuid,
      p_worker_token_id uuid,
      p_release_sha text,
      p_egress_ip_sha256 text,
      p_worker_version text
    ) returns boolean language sql stable security definer set search_path = '' as $$
      select
        sellerpilot_private.local_channel_executor_access(
          p_channel,p_operation
        ) is not null
        and p_worker_version = 'sellerpilot-cli-worker/1.61+' || p_release_sha
          || '.' || left(p_egress_ip_sha256,11)
        and sellerpilot_private.active_serverless_runtime_release_sha()
          = p_release_sha
        and (
          sellerpilot_private.local_channel_executor_access(
            p_channel,p_operation
          ) = 'read'
          or sellerpilot_private.listing_mutation_release_gate_is_effective(
            p_channel
          )
        )
        and exists (
          select 1
            from sellerpilot_private.local_channel_executor_routes route
            join sellerpilot_private.channel_credentials credential
              on credential.id = route.credential_id
             and credential.id = p_credential_id
             and credential.channel = route.channel
             and credential.environment = 'production'
             and credential.status = 'active'
             and (credential.expires_at is null
               or credential.expires_at > clock_timestamp())
             and credential.last_check_status = 'passed'
             and credential.seller_account_key = route.seller_account_key
             and credential.seller_account_key_source in (
               'provider_certified_v1','credential_incarnation_v1'
             )
            join sellerpilot_private.ai_cli_worker_tokens token
              on token.id = route.worker_token_id
             and token.id = p_worker_token_id
             and token.scope = 'gateway'
             and token.status = 'active'
             and token.expires_at > clock_timestamp()
             and token.last_seen_at >= clock_timestamp() - interval '3 minutes'
             and token.last_version = p_worker_version
           where route.owner_id = p_owner_id
             and route.channel = p_channel
             and route.operation = p_operation
             and route.release_sha = p_release_sha
             and route.egress_ip_sha256 = p_egress_ip_sha256
             and route.enabled
             and route.approved_at <= clock_timestamp()
             and route.expires_at > clock_timestamp()
             and exists (
               select 1 from sellerpilot_private.admin_users admin
                where admin.user_id = route.owner_id
             )
             and exists (
               select 1 from sellerpilot_private.admin_users admin
                where admin.user_id = route.approved_by
             )
             and exists (
               select 1 from sellerpilot_private.admin_users admin
                where admin.user_id = credential.created_by
             )
             and exists (
               select 1 from sellerpilot_private.admin_users admin
                where admin.user_id = token.created_by
             )
             and exists (
               select 1
                 from sellerpilot_private.serverless_static_egress_policy policy
                where policy.channel = p_channel
                  and policy.enabled is false
             )
        )
    $$;

    insert into sellerpilot_private.admin_users(user_id) values
      ('${id.owner}'), ('${id.credentialOwner}'), ('${id.workerOwner}');
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${id.worker}', '${"a".repeat(64)}', 'gateway', 'active',
      clock_timestamp() + interval '1 day', clock_timestamp(),
      '${workerVersion}', '${id.workerOwner}'
    );
    insert into sellerpilot_private.channel_credentials values
      ('${id.credential}', 'coupang', 'production', 'active',
       clock_timestamp() + interval '1 day', 'passed', '${sellerKey}',
       'provider_certified_v1', '${id.credentialOwner}'),
      ('${id.unrelatedCredential}', 'smartstore', 'production', 'active',
       clock_timestamp() + interval '1 day', 'passed', '${"b".repeat(64)}',
       'provider_certified_v1', '${id.credentialOwner}');
    insert into sellerpilot_private.serverless_static_egress_policy
      values ('coupang', false), ('smartstore', false);
  `);

  for (const [routeId, operation, priorRelease] of exactRoutes) {
    await db.query(
      `insert into sellerpilot_private.local_channel_executor_routes values(
        $1,$2,'coupang',$3,$4,$5,$6,$7,$8,$9,
        clock_timestamp()-interval '2 days',
        case
          when $3 in ('categories.attributes','categories.validate')
            then clock_timestamp()-interval '1 hour'
          else clock_timestamp()+interval '3 hours'
        end,true
      )`,
      [routeId, id.owner, operation, id.credential, sellerKey, id.worker,
        priorRelease, egress, id.credentialOwner],
    );
  }
  await db.query(
    `insert into sellerpilot_private.local_channel_executor_routes values(
      $1,$2,'coupang','listing.create',$3,$4,$5,$6,$7,$8,
      clock_timestamp()-interval '2 hours',
      clock_timestamp()+interval '2 days',false
    )`,
    [id.disabledCreate, id.owner, id.credential, sellerKey, id.worker,
      readPriorRelease, egress, id.credentialOwner],
  );
  await db.query(
    `insert into sellerpilot_private.local_channel_executor_routes values(
      $1,$2,'smartstore','listing.create',$3,$4,$5,$6,$7,$8,
      clock_timestamp()-interval '2 hours',
      clock_timestamp()+interval '2 days',true
    )`,
    [id.unrelatedRoute, id.owner, id.unrelatedCredential, "b".repeat(64),
      id.worker, readPriorRelease, egress, id.credentialOwner],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs values
      ($1,'smartstore','orders.list','queued',null,'{"keep":true}')`,
    [id.unrelatedJob],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings values(
      $1,'coupang','16375780938','failed'
    )`,
    [id.listing],
  );
  return db;
}

function withoutRelease(row, { allowExpiry = false } = {}) {
  const clone = { ...row };
  delete clone.release_sha;
  if (allowExpiry) delete clone.expires_at;
  return clone;
}

async function routeIsCurrent(db, operation) {
  return scalar(db, `
    select sellerpilot_private.local_channel_executor_route_is_current(
      $1,'coupang',$2,$3,$4,$5,$6,$7
    ) current
  `, [id.owner, operation, id.credential, id.worker, release, egress,
    workerVersion]);
}

test("migration changes only three releases and two expired read expiries", () => {
  assert.match(migration, /fd27ffd0-59d3-45af-9315-e435a14d27cb/u);
  assert.match(migration, /01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8/u);
  assert.match(migration, /73e07b05-b3bd-47e4-be92-062d537150e9/u);
  assert.match(migration, /b23cb3cd-5a04-4000-8218-a914d2b22461/u);
  assert.match(migration, /a81b2c7981ce4d8d2ebd996864f39d501749a484/u);
  assert.match(migration, /77f970877f755910321c882f379e8b406d552502/u);
  assert.match(migration, /set release_sha = 'f0b9af0/u);
  assert.match(migration,
    /expires_at = case[\s\S]*greatest\(route\.expires_at, read_routes_refreshed_until\)/u);
  assert.match(migration, /COUPANG_EXACT_ROUTE_F0_PREIMAGE_DRIFT/u);
  assert.match(migration, /prior_release_by_route/u);
  assert.match(migration, /gate_effective_at_rotation/u);
  assert.match(migration, /provider_mutation_performed/u);
  assert.doesNotMatch(migration,
    /(?:update|insert into|delete from)\s+sellerpilot_private\.channel_gateway_jobs/iu);
  assert.doesNotMatch(migration,
    /(?:update|insert into|delete from)\s+sellerpilot_private\.product_listings/iu);
  assert.doesNotMatch(migration,
    /sellerpilot_service_(?:enqueue|set_listing_channel_mutation_release_gate)/u);
});

test("closed-gate rotation renews only expired reads and gates write current", async () => {
  const db = await database();
  try {
    const routesBefore = await snapshot(
      db, "sellerpilot_private.local_channel_executor_routes", "operation, id",
    );
    const jobsBefore = await snapshot(
      db, "sellerpilot_private.channel_gateway_jobs", "id",
    );
    const listingsBefore = await snapshot(
      db, "sellerpilot_private.product_listings", "id",
    );
    const workerBefore = await snapshot(
      db, "sellerpilot_private.ai_cli_worker_tokens", "id",
    );
    const beforeApplyMs = Date.now();

    await db.exec(migration);

    const routesAfter = await snapshot(
      db, "sellerpilot_private.local_channel_executor_routes", "operation, id",
    );
    assert.equal(routesAfter.length, routesBefore.length);
    for (let index = 0; index < routesBefore.length; index += 1) {
      const before = routesBefore[index];
      const after = routesAfter[index];
      const isReadTarget = [id.attributes, id.validate].includes(before.id);
      assert.deepEqual(
        withoutRelease(after, { allowExpiry: isReadTarget }),
        withoutRelease(before, { allowExpiry: isReadTarget }),
      );
      assert.equal(
        exactRoutes.some(([routeId]) => routeId === before.id)
          ? after.release_sha
          : before.release_sha,
        exactRoutes.some(([routeId]) => routeId === before.id)
          ? release
          : before.release_sha,
      );
      if (isReadTarget) {
        assert.ok(new Date(before.expires_at).getTime() < beforeApplyMs);
        assert.ok(new Date(after.expires_at).getTime() >= beforeApplyMs + 59 * 60_000);
        assert.ok(new Date(after.expires_at).getTime() <= Date.now() + 61 * 60_000);
      }
    }
    const attributesAfter = routesAfter.find((route) => route.id === id.attributes);
    const validateAfter = routesAfter.find((route) => route.id === id.validate);
    const createBefore = routesBefore.find((route) => route.id === id.create);
    const createAfter = routesAfter.find((route) => route.id === id.create);
    assert.equal(attributesAfter.expires_at, validateAfter.expires_at);
    assert.equal(createAfter.expires_at, createBefore.expires_at);
    assert.equal(createAfter.approved_at, createBefore.approved_at);
    const disabledBefore = routesBefore.find(
      (route) => route.id === id.disabledCreate,
    );
    const disabledAfter = routesAfter.find(
      (route) => route.id === id.disabledCreate,
    );
    assert.deepEqual(disabledAfter, disabledBefore);
    assert.equal(disabledAfter.enabled, false);
    assert.equal(disabledAfter.release_sha, readPriorRelease);
    assert.deepEqual(await snapshot(
      db, "sellerpilot_private.channel_gateway_jobs", "id",
    ), jobsBefore);
    assert.deepEqual(await snapshot(
      db, "sellerpilot_private.product_listings", "id",
    ), listingsBefore);
    assert.deepEqual(await snapshot(
      db, "sellerpilot_private.ai_cli_worker_tokens", "id",
    ), workerBefore);

    assert.equal(await routeIsCurrent(db, "categories.attributes"), true);
    assert.equal(await routeIsCurrent(db, "categories.validate"), true);
    assert.equal(await routeIsCurrent(db, "listing.create"), false);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_route_f0_rotations"), 1);
    const receipt = (await db.query(`
      select prior_release_by_route,active_release_sha,worker_token_id,
             egress_ip_sha256,gate_effective_at_rotation,
             provider_mutation_performed,contract,
             rotated_at,read_routes_refreshed_until,
             jsonb_array_length(prior_routes) prior_count,
             jsonb_array_length(rotated_routes) rotated_count
        from sellerpilot_private.coupang_exact_route_f0_rotations
    `)).rows[0];
    const rotatedAt = receipt.rotated_at;
    const readRoutesRefreshedUntil = receipt.read_routes_refreshed_until;
    delete receipt.rotated_at;
    delete receipt.read_routes_refreshed_until;
    assert.deepEqual(receipt, {
      prior_release_by_route: {
        [id.attributes]: readPriorRelease,
        [id.validate]: readPriorRelease,
        [id.create]: writePriorRelease,
      },
      active_release_sha: release,
      worker_token_id: id.worker,
      egress_ip_sha256: egress,
      gate_effective_at_rotation: false,
      provider_mutation_performed: false,
      contract: "coupang_exact_route_f0_rotation_v1",
      prior_count: 3,
      rotated_count: 3,
    });
    assert.equal(
      new Date(readRoutesRefreshedUntil).getTime() - new Date(rotatedAt).getTime(),
      60 * 60_000,
    );

    await assert.rejects(
      db.exec("update sellerpilot_private.coupang_exact_route_f0_rotations set rotated_at=clock_timestamp()"),
      /COUPANG_EXACT_ROUTE_F0_ROTATION_IMMUTABLE/u,
    );
    await db.exec(
      "update sellerpilot_private.runtime_fixture set coupang_gate_open=true where singleton",
    );
    assert.equal(await routeIsCurrent(db, "listing.create"), true);

    await assert.rejects(
      db.exec(migration),
      /COUPANG_EXACT_ROUTE_F0_PREIMAGE_DRIFT/u,
    );
  } finally {
    await db.close();
  }
});

test("open-gate rotation preserves gate state and makes all three routes current", async () => {
  const db = await database({ gateOpen: true });
  try {
    await db.exec(migration);
    for (const [, operation] of exactRoutes) {
      assert.equal(await routeIsCurrent(db, operation), true, operation);
    }
    assert.equal(await scalar(db,
      "select gate_effective_at_rotation from sellerpilot_private.coupang_exact_route_f0_rotations"), true);
    assert.equal(await scalar(db,
      "select coupang_gate_open from sellerpilot_private.runtime_fixture where singleton"), true);
  } finally {
    await db.close();
  }
});

test("runtime, worker, route identity, prior release, and drain drift fail closed", async () => {
  const cases = [
    ["runtime", `update sellerpilot_private.runtime_fixture set active_release='${readPriorRelease}'`, /RUNTIME_NOT_ACTIVE/u],
    ["worker", "update sellerpilot_private.ai_cli_worker_tokens set last_version='sellerpilot-cli-worker/1.61+wrong'", /WORKER_PREIMAGE_DRIFT/u],
    ["owner", `update sellerpilot_private.local_channel_executor_routes set owner_id='${id.credentialOwner}' where id='${id.attributes}'`, /PREIMAGE_DRIFT/u],
    ["release", `update sellerpilot_private.local_channel_executor_routes set release_sha='${release}' where id='${id.validate}'`, /PREIMAGE_DRIFT/u],
    ["disabled predecessor", `update sellerpilot_private.local_channel_executor_routes set release_sha='${writePriorRelease}' where id='${id.disabledCreate}'`, /PREIMAGE_DRIFT/u],
    ["approval ceiling", `update sellerpilot_private.local_channel_executor_routes set approved_at=clock_timestamp()-interval '90 days' where id='${id.attributes}'`, /APPROVAL_WINDOW_DRIFT/u],
    ["drain", `insert into sellerpilot_private.channel_gateway_jobs values('${id.runningJob}','coupang','categories.validate','running','${id.worker}','{}')`, /WORKER_NOT_DRAINED/u],
  ];
  for (const [name, mutation, error] of cases) {
    const db = await database();
    try {
      const routesBefore = await snapshot(
        db, "sellerpilot_private.local_channel_executor_routes", "operation, id",
      );
      const jobsBefore = await snapshot(
        db, "sellerpilot_private.channel_gateway_jobs", "id",
      );
      await db.exec(mutation);
      const mutatedRoutes = await snapshot(
        db, "sellerpilot_private.local_channel_executor_routes", "operation, id",
      );
      const mutatedJobs = await snapshot(
        db, "sellerpilot_private.channel_gateway_jobs", "id",
      );
      await assert.rejects(db.exec(migration), error, name);
      await db.exec("rollback");
      assert.deepEqual(await snapshot(
        db, "sellerpilot_private.local_channel_executor_routes", "operation, id",
      ), mutatedRoutes, name);
      assert.deepEqual(await snapshot(
        db, "sellerpilot_private.channel_gateway_jobs", "id",
      ), mutatedJobs, name);
      assert.equal(await scalar(db,
        "select to_regclass('sellerpilot_private.coupang_exact_route_f0_rotations') is null"), true, name);
      assert.notDeepEqual(routesBefore, [], name);
      assert.notDeepEqual(jobsBefore, [], name);
    } finally {
      await db.close();
    }
  }
});
