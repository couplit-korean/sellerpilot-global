import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260905012000_recover_exact_elevenst_cookie_create_get_only.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const IDS = Object.freeze({
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  product: "1ed4acfc-7603-48ec-a638-241131e59358",
  listing: "61b343f8-2e61-42a8-8a45-750f8b834edc",
  attempt: "d1300c6b-410e-47be-a93f-0e2ba7d4bbf6",
  sourceJob: "b9faa28e-a73f-4457-bb34-d643cf9a9a74",
  credential: "b2dd0ff7-4420-495f-aead-a45857fb3bfe",
});
const SELLER_KEY = "e".repeat(64);

test("cookie 11st GET recovery migration never POSTs, never rewrites the source job, and never live-binds", () => {
  assert.match(migration, /b9faa28e-a73f-4457-bb34-d643cf9a9a74/);
  assert.match(migration, /AUTO-780720401E2D4E4EA45F/);
  assert.match(migration, /9598600918/);
  assert.match(migration, /1ed4acfc-7603-48ec-a638-241131e59358/);
  assert.match(migration, /61b343f8-2e61-42a8-8a45-750f8b834edc/);
  assert.match(migration, /sellerpilot\.elevenst_cookie_create_get_bind/);
  assert.match(migration, /pg_catalog\.substr\(v_definition, 1, v_at - 1\)/);
  assert.match(migration, /source job receipt is immutable/);
  assert.doesNotMatch(migration, /prodservices\/product/);
  assert.doesNotMatch(migration, /insert into sellerpilot_private\.channel_gateway_jobs/);
  assert.doesNotMatch(migration, /update sellerpilot_private\.channel_gateway_jobs/);
  assert.doesNotMatch(
    migration,
    /update sellerpilot_private\.product_listings[\s\S]*where listing\.id = 'aaaaaaaa/u,
  );
});

async function database() {
  const db = new PGlite();
  await db.exec(String.raw`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema sellerpilot_private;
    create table auth.users (id uuid primary key);
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null,
      sku text not null
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      remote_id text,
      marketplace_sku text,
      market text,
      target_id text,
      status text not null,
      failure_class text,
      requested_publication_intent text not null,
      remote_visibility text not null,
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      published_at timestamptz,
      last_verified_at timestamptz,
      operation_attempt_id uuid,
      seller_account_key text,
      last_error text,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      credential_id uuid not null,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      status text not null,
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb,
      provider_mutation_started_at timestamptz
    );
    create table sellerpilot_private.operation_audit (
      id bigint generated always as identity primary key,
      owner_id uuid not null,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      safe_detail jsonb not null
    );
    create function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger
    language plpgsql
    set search_path = ''
    as $$
begin
  if nullif(current_setting('sellerpilot.coupang_exact_rep_apply', true), '') is not null then
    return new;
  end if;
  return new;
end;
    $$;
    create trigger guard_product_listing_seller_lineage
    before update on sellerpilot_private.product_listings
    for each row execute function
      sellerpilot_private.guard_product_listing_seller_lineage();
  `);
  await db.query("insert into auth.users (id) values ($1)", [IDS.owner]);
  await db.query(
    "insert into sellerpilot_private.products (id,owner_id,sku) values ($1,$2,'AUTO-780720401E2D4E4EA45F')",
    [IDS.product, IDS.owner],
  );
  await db.query(
    "insert into sellerpilot_private.channel_credentials (id,channel) values ($1,'elevenst')",
    [IDS.credential],
  );
  await db.query(
    "insert into sellerpilot_private.channel_operation_attempts (id,owner_id) values ($1,$2)",
    [IDS.attempt, IDS.owner],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,remote_id,marketplace_sku,market,
       target_id,status,failure_class,requested_publication_intent,
       remote_visibility,operation_attempt_id,seller_account_key
     ) values ($1,$2,$3,'elevenst',null,null,'','',
       'failed','external_action','live','unknown',$4,$5)`,
    [IDS.listing, IDS.owner, IDS.product, IDS.attempt, SELLER_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       status,request_payload,response_payload,provider_mutation_started_at
     ) values ($1,$2,$3,$4,'elevenst','listing.create','production',
       'reconciliation_required',
       $5::jsonb,null,clock_timestamp())`,
    [
      IDS.sourceJob,
      IDS.credential,
      IDS.attempt,
      IDS.listing,
      JSON.stringify({ arguments: { product: { sellerPrdCd: "AUTO-780720401E2D4E4EA45F" } } }),
    ],
  );
  return db;
}

test("migration does not bind live; RPC bind is exact, GET-receipt only, and leaves the source job untouched", async () => {
  const db = await database();
  try {
    await db.exec(migration);
    const guardDef = (await db.query(
      `select pg_catalog.pg_get_functiondef(
         'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
       ) as def`,
    )).rows[0].def;
    const cookieAt = guardDef.indexOf("elevenst_cookie_create_get_bind");
    const liveFirstGucAt = guardDef.indexOf("coupang_exact_rep_apply");
    assert.ok(cookieAt > 0 && liveFirstGucAt > cookieAt);
    const before = (await db.query(
      "select remote_id,marketplace_sku,status from sellerpilot_private.product_listings where id=$1",
      [IDS.listing],
    )).rows[0];
    assert.equal(before.remote_id, null);
    assert.equal(before.marketplace_sku, null);
    assert.equal(before.status, "failed");

    await db.exec("select set_config('request.jwt.claim.role','service_role', false)");
    const current = (await db.query(
      "select sellerpilot_private.elevenst_cookie_create_jobs_are_current() as current",
    )).rows[0].current;
    assert.equal(current, true);

    await assert.rejects(
      () => db.query(
        `select public.sellerpilot_service_record_elevenst_cookie_create_observation(
           $1,'1111111111','AUTO-780720401E2D4E4EA45F',200,200,true,true,null)`,
        [IDS.product],
      ),
      /not current|check/i,
    );

    const observationId = (await db.query(
      `select public.sellerpilot_service_record_elevenst_cookie_create_observation(
         $1,'9598600918','AUTO-780720401E2D4E4EA45F',200,200,true,true,'103') as id`,
      [IDS.product],
    )).rows[0].id;
    const bound = (await db.query(
      "select public.sellerpilot_service_bind_elevenst_cookie_create_observation($1) as ok",
      [observationId],
    )).rows[0].ok;
    assert.equal(bound, true);

    const listing = (await db.query(
      `select remote_id,marketplace_sku,status,failure_class,remote_visibility,
              last_verified_at,remote_resources
         from sellerpilot_private.product_listings where id=$1`,
      [IDS.listing],
    )).rows[0];
    assert.equal(listing.remote_id, "9598600918");
    assert.equal(listing.marketplace_sku, "AUTO-780720401E2D4E4EA45F");
    assert.equal(listing.status, "failed");
    assert.equal(listing.failure_class, "external_action");
    assert.equal(listing.remote_visibility, "unknown");
    assert.ok(listing.last_verified_at);
    assert.equal(listing.remote_resources.contract, "elevenst_cookie_create_get_only_v1");
    assert.equal(listing.remote_resources.verification.sourceJobRewritten, false);

    const job = (await db.query(
      "select status,response_payload from sellerpilot_private.channel_gateway_jobs where id=$1",
      [IDS.sourceJob],
    )).rows[0];
    assert.equal(job.status, "reconciliation_required");
    assert.equal(job.response_payload, null);

    await assert.rejects(
      () => db.query(
        "update sellerpilot_private.channel_gateway_jobs set status='succeeded' where id=$1",
        [IDS.sourceJob],
      ),
      /immutable/,
    );
  } finally {
    await db.close();
  }
});
