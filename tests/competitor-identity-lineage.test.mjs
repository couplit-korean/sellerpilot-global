import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831132000_competitor_identity_lineage_fence.sql",
  import.meta.url,
);
const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";
const AI_JOB_A = "20000000-0000-4000-8000-000000000001";
const AI_JOB_B = "20000000-0000-4000-8000-000000000002";
const CREDENTIAL_ID = "30000000-0000-4000-8000-000000000001";
const OLD_CLAIM_TOKEN = "40000000-0000-4000-8000-000000000001";
const OLD_GATEWAY_JOB_ID = "50000000-0000-4000-8000-000000000001";
const PROVIDERS = JSON.stringify([
  {
    provider: "elevenst_product_search",
    status: "searched",
    count: 0,
    marketplaces: ["elevenst"],
  },
]);

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function expectDatabaseError(work, pattern) {
  await assert.rejects(work, (error) => pattern.test(String(error?.message ?? error)));
}

async function claimProduct(db) {
  const result = await db.query(
    "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].product_id, PRODUCT_ID);
  return result.rows[0];
}

async function activeClaimState(db) {
  return scalar(
    db,
    `select to_jsonb(state) from (
       select claim_token, identity_fingerprint, gateway_job_id,
              gateway_periodic_key, latest_providers, providers_fetched_at
         from sellerpilot_private.competitor_price_refresh_claims
        where product_id = $1
     ) state`,
    [PRODUCT_ID],
  );
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
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
    create table sellerpilot_private.ai_cli_jobs (
      id uuid primary key,
      result_payload jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.products (
      id uuid primary key,
      name text not null,
      product_facts jsonb not null default '{}'::jsonb,
      competitor_query text not null default '',
      competitor_monitor_enabled boolean not null default true,
      competitor_checked_at timestamptz,
      ai_job_id uuid,
      status text not null default 'draft',
      demo boolean not null default false,
      supplier_name text not null default '',
      comparison_memo text not null default '',
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      status text not null,
      environment text not null,
      expires_at timestamptz,
      created_by uuid not null
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      credential_id uuid not null,
      attempt_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null,
      response_payload jsonb,
      status text not null default 'queued',
      completed_at timestamptz,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      created_by uuid not null
    );
    create table sellerpilot_private.competitor_price_refresh_claims (
      product_id uuid primary key references sellerpilot_private.products(id),
      claim_token uuid,
      claimed_at timestamptz,
      lease_expires_at timestamptz,
      last_attempted_at timestamptz,
      gateway_job_id uuid,
      gateway_periodic_key text,
      latest_providers jsonb not null default '[]'::jsonb,
      providers_fetched_at timestamptz
    );
    create table sellerpilot_private.competitor_price_observations (
      id uuid primary key default gen_random_uuid(),
      product_id uuid not null references sellerpilot_private.products(id),
      provider text not null,
      matcher_version text,
      checked_at timestamptz not null default clock_timestamp()
    );

    create or replace function sellerpilot_private.competitor_identity_from_product(
      p_name text,
      p_product_facts jsonb
    )
    returns jsonb language sql immutable
    as $$
      select jsonb_build_object(
        'productName', coalesce(p_name, ''),
        'facts', coalesce(p_product_facts, '{}'::jsonb)
      )
    $$;
    create or replace function sellerpilot_private.valid_competitor_provider_snapshot(
      p_providers jsonb
    )
    returns boolean language sql immutable
    as $$ select jsonb_typeof(p_providers) = 'array' $$;
    create or replace function sellerpilot_private.valid_competitor_v3_item(
      p_item jsonb
    )
    returns boolean language sql immutable
    as $$ select jsonb_typeof(p_item) = 'object' $$;
    create or replace function sellerpilot_private.record_competitor_prices(
      p_product_id uuid,
      p_items jsonb,
      p_allow_v3 boolean
    )
    returns integer language plpgsql security definer set search_path = ''
    as $$
    declare
      item jsonb;
    begin
      for item in select value from jsonb_array_elements(p_items) loop
        insert into sellerpilot_private.competitor_price_observations(
          product_id, provider, matcher_version
        ) values (
          p_product_id, item->>'provider', item->>'matcherVersion'
        );
      end loop;
      update sellerpilot_private.products
         set competitor_checked_at = clock_timestamp()
       where id = p_product_id;
      return jsonb_array_length(p_items);
    end;
    $$;

    insert into sellerpilot_private.ai_cli_jobs(id, result_payload) values
      ('${AI_JOB_A}', '{"localizedListings":[{"title":"Product A international"}]}'::jsonb),
      ('${AI_JOB_B}', '{"localizedListings":[{"title":"Product B international"}]}'::jsonb);
    insert into sellerpilot_private.products(
      id, name, product_facts, competitor_query, competitor_monitor_enabled,
      competitor_checked_at, ai_job_id
    ) values (
      '${PRODUCT_ID}', 'Product A', '{"brand":"Acme","size":"500g"}'::jsonb,
      'Product A 500g', true, clock_timestamp(), '${AI_JOB_A}'
    );
    insert into sellerpilot_private.channel_credentials(
      id, channel, status, environment, expires_at, created_by
    ) values (
      '${CREDENTIAL_ID}', 'elevenst', 'active', 'production',
      clock_timestamp() + interval '1 day', gen_random_uuid()
    );
    insert into sellerpilot_private.channel_gateway_jobs(
      id, credential_id, channel, operation, environment, request_payload,
      status, created_by
    ) values (
      '${OLD_GATEWAY_JOB_ID}', '${CREDENTIAL_ID}', 'elevenst',
      'competitor.search', 'production',
      '{"periodicKey":"competitor:v1:old"}'::jsonb, 'queued', gen_random_uuid()
    );
    insert into sellerpilot_private.competitor_price_refresh_claims(
      product_id, claim_token, claimed_at, lease_expires_at, last_attempted_at,
      gateway_job_id, gateway_periodic_key, latest_providers, providers_fetched_at
    ) values (
      '${PRODUCT_ID}', '${OLD_CLAIM_TOKEN}', clock_timestamp(),
      clock_timestamp() + interval '90 seconds', clock_timestamp(),
      '${OLD_GATEWAY_JOB_ID}', 'competitor:v1:old', '${PROVIDERS}'::jsonb,
      clock_timestamp()
    );
    insert into sellerpilot_private.competitor_price_observations(
      product_id, provider, matcher_version
    ) values
      ('${PRODUCT_ID}', 'elevenst_product_search', 'strict-2026-08-31-v3'),
      ('${PRODUCT_ID}', 'manual', 'strict-2026-08-28-v2');
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  return db;
}

test("competitor claims stay bound to current product identity and edits revoke stale work", async () => {
  const db = await createDatabase();
  try {
    const rolloutState = await activeClaimState(db);
    assert.deepEqual(rolloutState, {
      claim_token: null,
      identity_fingerprint: null,
      gateway_job_id: null,
      gateway_periodic_key: null,
      latest_providers: [],
      providers_fetched_at: null,
    });
    assert.equal(
      await scalar(db, "select competitor_checked_at is null from sellerpilot_private.products where id=$1", [PRODUCT_ID]),
      true,
    );
    assert.deepEqual(
      (await db.query(
        "select provider, matcher_version from sellerpilot_private.competitor_price_observations where product_id=$1 order by provider",
        [PRODUCT_ID],
      )).rows,
      [{ provider: "manual", matcher_version: "strict-2026-08-28-v2" }],
      "rollout must delete only uncertified v3 projections",
    );

    await expectDatabaseError(
      () => db.query(
        "update sellerpilot_private.competitor_price_refresh_claims set claim_token=gen_random_uuid() where product_id=$1",
        [PRODUCT_ID],
      ),
      /identity_fingerprint_check/,
    );
    await expectDatabaseError(
      () => db.query(
        "update sellerpilot_private.competitor_price_refresh_claims set identity_fingerprint=$2 where product_id=$1",
        [PRODUCT_ID, "a".repeat(64)],
      ),
      /identity_fingerprint_check/,
    );

    const claim = await claimProduct(db);
    assert.match(claim.claim_token, /^[0-9a-f-]{36}$/i);
    assert.match(
      await scalar(
        db,
        "select identity_fingerprint from sellerpilot_private.competitor_price_refresh_claims where product_id=$1",
        [PRODUCT_ID],
      ),
      /^[0-9a-f]{64}$/,
    );

    const stateBeforeNotes = await activeClaimState(db);
    await db.query(
      "update sellerpilot_private.products set supplier_name='Supplier B', comparison_memo='Price note B' where id=$1",
      [PRODUCT_ID],
    );
    assert.deepEqual(await activeClaimState(db), stateBeforeNotes);

    await expectDatabaseError(
      () => db.query(
        "select public.sellerpilot_enqueue_competitor_search_job($1,'Different product','[]'::jsonb,30,$2,$3)",
        [CREDENTIAL_ID, PRODUCT_ID, claim.claim_token],
      ),
      /competitor search input changed/,
    );
    assert.equal(
      await scalar(db, "select gateway_job_id is null from sellerpilot_private.competitor_price_refresh_claims where product_id=$1", [PRODUCT_ID]),
      true,
    );
    const gatewayJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_competitor_search_job($1,$4,$5::jsonb,30,$2,$3)",
      [CREDENTIAL_ID, PRODUCT_ID, claim.claim_token, claim.query, JSON.stringify(claim.aliases)],
    );
    assert.match(gatewayJobId, /^[0-9a-f-]{36}$/i);

    await db.query(
      `insert into sellerpilot_private.competitor_price_observations(
         product_id,provider,matcher_version
       ) values ($1,'elevenst_product_search','strict-2026-08-31-v3')`,
      [PRODUCT_ID],
    );
    await db.query(
      `update sellerpilot_private.competitor_price_refresh_claims
          set latest_providers=$2::jsonb,providers_fetched_at=clock_timestamp()
        where product_id=$1`,
      [PRODUCT_ID, PROVIDERS],
    );
    await db.query(
      "update sellerpilot_private.products set name='Product A revised',competitor_checked_at=clock_timestamp() where id=$1",
      [PRODUCT_ID],
    );
    assert.deepEqual(await activeClaimState(db), {
      claim_token: null,
      identity_fingerprint: null,
      gateway_job_id: null,
      gateway_periodic_key: null,
      latest_providers: [],
      providers_fetched_at: null,
    });
    assert.equal(
      await scalar(db, "select competitor_checked_at is null from sellerpilot_private.products where id=$1", [PRODUCT_ID]),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.competitor_price_observations where product_id=$1 and matcher_version='strict-2026-08-31-v3'",
        [PRODUCT_ID],
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_competitor_price_refresh($1,$2,'[]'::jsonb,$3::jsonb)",
        [PRODUCT_ID, claim.claim_token, PROVIDERS],
      ),
      -1,
    );

    const freshClaim = await claimProduct(db);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_competitor_price_refresh($1,$2,'[]'::jsonb,$3::jsonb)",
        [PRODUCT_ID, freshClaim.claim_token, PROVIDERS],
      ),
      0,
    );
    const completedState = await activeClaimState(db);
    assert.equal(completedState.claim_token, null);
    assert.equal(completedState.identity_fingerprint, null);
    assert.deepEqual(completedState.latest_providers, JSON.parse(PROVIDERS));

    await db.query("update sellerpilot_private.products set competitor_checked_at=null where id=$1", [PRODUCT_ID]);
    const releaseClaim = await claimProduct(db);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_competitor_price_refresh($1,$2)",
        [PRODUCT_ID, releaseClaim.claim_token],
      ),
      true,
    );
    assert.equal((await activeClaimState(db)).identity_fingerprint, null);

    const invalidations = [
      ["competitor query", "update sellerpilot_private.products set competitor_query='Product A revised exact' where id=$1"],
      ["localized aliases", `update sellerpilot_private.products set ai_job_id='${AI_JOB_B}' where id=$1`],
      ["product facts", "update sellerpilot_private.products set product_facts='{\"brand\":\"Acme\",\"size\":\"1kg\"}'::jsonb where id=$1"],
      ["monitoring", "update sellerpilot_private.products set competitor_monitor_enabled=false where id=$1"],
      ["archive", "update sellerpilot_private.products set status='archived' where id=$1"],
    ];
    for (const [label, updateSql] of invalidations) {
      await db.query(
        "update sellerpilot_private.products set status='draft',competitor_monitor_enabled=true,competitor_checked_at=null where id=$1",
        [PRODUCT_ID],
      );
      const editClaim = await claimProduct(db);
      assert.match(editClaim.claim_token, /^[0-9a-f-]{36}$/i);
      await db.query(updateSql, [PRODUCT_ID]);
      assert.equal(
        (await activeClaimState(db)).claim_token,
        null,
        `${label} must revoke the active claim`,
      );
    }

    await db.query(
      "update sellerpilot_private.products set status='draft',competitor_monitor_enabled=true,competitor_checked_at=null where id=$1",
      [PRODUCT_ID],
    );
    const aliasEditClaim = await claimProduct(db);
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set result_payload='{\"localizedListings\":[{\"title\":\"Alias changed normally\"}]}'::jsonb where id=(select ai_job_id from sellerpilot_private.products where id=$1)",
      [PRODUCT_ID],
    );
    assert.match(aliasEditClaim.claim_token, /^[0-9a-f-]{36}$/i);
    assert.equal((await activeClaimState(db)).claim_token, null);

    await db.query(
      "update sellerpilot_private.products set competitor_checked_at=null where id=$1",
      [PRODUCT_ID],
    );
    const defenseClaim = await claimProduct(db);
    await db.exec("set session_replication_role=replica");
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set result_payload='{\"localizedListings\":[{\"title\":\"Alias changed after claim\"}]}'::jsonb where id=(select ai_job_id from sellerpilot_private.products where id=$1)",
      [PRODUCT_ID],
    );
    await db.exec("set session_replication_role=origin");
    await expectDatabaseError(
      () => db.query(
        "select public.sellerpilot_enqueue_competitor_search_job($1,$4,$5::jsonb,30,$2,$3)",
        [CREDENTIAL_ID, PRODUCT_ID, defenseClaim.claim_token, defenseClaim.query, JSON.stringify(defenseClaim.aliases)],
      ),
      /competitor search input changed/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_competitor_price_refresh($1,$2,'[]'::jsonb,$3::jsonb)",
        [PRODUCT_ID, defenseClaim.claim_token, PROVIDERS],
      ),
      -1,
      "completion must independently reject an alias race even when the product trigger did not run",
    );
    assert.equal((await activeClaimState(db)).claim_token, null);
    assert.equal((await activeClaimState(db)).identity_fingerprint, null);
  } finally {
    await db.close();
  }
});
