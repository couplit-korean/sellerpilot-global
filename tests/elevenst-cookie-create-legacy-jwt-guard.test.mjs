import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const historyUrl = new URL(
  "../supabase/migrations/20260905012000_recover_exact_elevenst_cookie_create_get_only.sql",
  import.meta.url,
);
const followUpUrl = new URL(
  "../supabase/migrations/20260905012100_remove_elevenst_cookie_create_legacy_jwt_guards.sql",
  import.meta.url,
);

const IDS = Object.freeze({
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  product: "1ed4acfc-7603-48ec-a638-241131e59358",
  listing: "61b343f8-2e61-42a8-8a45-750f8b834edc",
  attempt: "d1300c6b-410e-47be-a93f-0e2ba7d4bbf6",
  sourceJob: "b9faa28e-a73f-4457-bb34-d643cf9a9a74",
  credential: "b2dd0ff7-4420-495f-aead-a45857fb3bfe",
});
const SELLER_KEY = "e".repeat(64);

const STATUS_JWT = [
  "coalesce(current_setting('request.jwt.claim.role', true), '')",
  "       is distinct from 'service_role'",
  "     or ",
].join("\n");
const RECORD_JWT = [
  "  if coalesce(current_setting('request.jwt.claim.role', true), '')",
  "       is distinct from 'service_role'",
  "  then",
  "    raise exception 'exact 11st cookie create observation denied'",
  "      using errcode = '42501';",
  "  end if;",
  "",
].join("\n");
const BIND_JWT = [
  "  if coalesce(current_setting('request.jwt.claim.role', true), '')",
  "       is distinct from 'service_role'",
  "  then",
  "    raise exception 'exact 11st cookie create bind denied'",
  "      using errcode = '42501';",
  "  end if;",
  "",
].join("\n");

function hits(haystack, needle) {
  return haystack.split(needle).length - 1;
}

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

test("follow-up SQL patches only the three 11st RPCs and does not rewrite 12000", async () => {
  const history = await readFile(historyUrl, "utf8");
  const followUp = await readFile(followUpUrl, "utf8");
  assert.match(followUp, /20260905012000/);
  assert.match(followUp, /Do not rewrite that applied history/);
  assert.doesNotMatch(history, /20260905012100/);
  assert.equal(hits(history, STATUS_JWT), 1);
  assert.equal(hits(history, RECORD_JWT), 1);
  assert.equal(hits(history, BIND_JWT), 1);
  assert.equal(hits(followUp, STATUS_JWT), 1);
  assert.equal(hits(followUp, RECORD_JWT), 1);
  assert.equal(hits(followUp, BIND_JWT), 1);
  assert.match(followUp, /v_hits is distinct from 1/);
  assert.match(
    followUp,
    /sellerpilot_service_get_elevenst_cookie_create_recovery_status\(uuid\)/,
  );
  assert.match(
    followUp,
    /sellerpilot_service_record_elevenst_cookie_create_observation\(uuid,text,text,integer,integer,boolean,boolean,text\)/,
  );
  assert.match(
    followUp,
    /sellerpilot_service_bind_elevenst_cookie_create_observation\(uuid\)/,
  );
  assert.match(followUp, /grant execute on function/);
  assert.match(followUp, /from public, anon, authenticated/);
  assert.doesNotMatch(followUp, /prodservices\/product/);
  assert.doesNotMatch(followUp, /insert into sellerpilot_private\.channel_gateway_jobs/);
  assert.doesNotMatch(followUp, /update sellerpilot_private\.channel_gateway_jobs/);
  assert.doesNotMatch(followUp, /update sellerpilot_private\.product_listings/);
  assert.doesNotMatch(followUp, /pg_get_functiondef\('sellerpilot_private\.guard_product_listing_seller_lineage/);
});

test("follow-up removes jwt GUC checks and keeps the exact product fence without a live bind", async () => {
  const history = await readFile(historyUrl, "utf8");
  const followUp = await readFile(followUpUrl, "utf8");
  const db = await database();
  try {
    await db.exec(history);
    await assert.rejects(
      () => db.query(
        "select public.sellerpilot_service_get_elevenst_cookie_create_recovery_status($1)",
        [IDS.product],
      ),
      /denied|42501/i,
    );
    await db.exec(followUp);
    const defs = (await db.query(`
      select p.proname,
             pg_catalog.pg_get_functiondef(p.oid) as def
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'sellerpilot_service_get_elevenst_cookie_create_recovery_status',
           'sellerpilot_service_record_elevenst_cookie_create_observation',
           'sellerpilot_service_bind_elevenst_cookie_create_observation'
         )
    `)).rows;
    assert.equal(defs.length, 3);
    for (const row of defs) {
      assert.equal(row.def.includes("request.jwt.claim.role"), false, row.proname);
    }
    const statusDef = defs.find((row) =>
      row.proname === "sellerpilot_service_get_elevenst_cookie_create_recovery_status"
    ).def;
    assert.match(statusDef, /1ed4acfc-7603-48ec-a638-241131e59358/);

    const status = (await db.query(
      "select public.sellerpilot_service_get_elevenst_cookie_create_recovery_status($1) as value",
      [IDS.product],
    )).rows[0].value;
    assert.equal(status.current, true);
    assert.equal(status.listingId, IDS.listing);
    assert.equal(status.bound, false);
    assert.equal(status.sourceJobRewritten, false);
    await assert.rejects(
      () => db.query(
        "select public.sellerpilot_service_get_elevenst_cookie_create_recovery_status($1)",
        ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      ),
      /denied|42501/i,
    );

    const listing = (await db.query(
      "select remote_id,marketplace_sku,status from sellerpilot_private.product_listings where id=$1",
      [IDS.listing],
    )).rows[0];
    assert.equal(listing.remote_id, null);
    assert.equal(listing.marketplace_sku, null);
    assert.equal(listing.status, "failed");
    const job = (await db.query(
      "select status,response_payload from sellerpilot_private.channel_gateway_jobs where id=$1",
      [IDS.sourceJob],
    )).rows[0];
    assert.equal(job.status, "reconciliation_required");
    assert.equal(job.response_payload, null);

    const grants = (await db.query(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec,
             has_function_privilege('authenticated', p.oid, 'execute') as authed_exec,
             has_function_privilege('service_role', p.oid, 'execute') as service_exec
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'sellerpilot_service_get_elevenst_cookie_create_recovery_status',
           'sellerpilot_service_record_elevenst_cookie_create_observation',
           'sellerpilot_service_bind_elevenst_cookie_create_observation'
         )
    `)).rows;
    assert.equal(grants.length, 3);
    for (const row of grants) {
      assert.equal(row.anon_exec, false, row.proname);
      assert.equal(row.authed_exec, false, row.proname);
      assert.equal(row.service_exec, true, row.proname);
    }
  } finally {
    await db.close();
  }
});
