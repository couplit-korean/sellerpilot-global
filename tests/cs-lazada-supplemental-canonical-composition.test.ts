import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const integratedRoot = process.env.SELLERPILOT_INTEGRATED_ROOT?.trim();
const root = integratedRoot || resolve(import.meta.dirname, "..");
const migrationRoot = resolve(root, "supabase/migrations");
const baseCredentialSql = await readFile(resolve(
  migrationRoot, "20260816060000_channel_credentials_and_roles.sql",
), "utf8");
const sellerLineageSql = await readFile(resolve(
  migrationRoot, "20260825111800_bind_listing_seller_accounts.sql",
), "utf8");
const bindingSql = await readFile(resolve(
  migrationRoot, "20260908000000_add_cs_credential_capability_bindings.sql",
), "utf8");
const multiAccountSql = await readFile(resolve(
  migrationRoot, "20260909124048_cs_lazada_multi_account_scope.sql",
), "utf8");
const supplementalSql = await readFile(resolve(
  migrationRoot, "20260909165423_cs_lazada_supplemental_read_ledger.sql",
), "utf8");

function exactFragment(source: string, pattern: RegExp, label: string) {
  const match = source.match(pattern)?.[0];
  assert.ok(match, `missing canonical fragment: ${label}`);
  return match;
}

const adminTable = exactFragment(baseCredentialSql,
  /create table if not exists sellerpilot_private\.admin_users \([\s\S]*?\n\);/u, "admin_users");
const credentialTable = exactFragment(baseCredentialSql,
  /create table if not exists sellerpilot_private\.channel_credentials \([\s\S]*?\n\);/u,
  "channel_credentials");
const originalCredentialIndex = exactFragment(baseCredentialSql,
  /create unique index if not exists channel_credentials_one_active_idx[\s\S]*?;/u,
  "original credential uniqueness");
const isAdminFunction = exactFragment(baseCredentialSql,
  /create or replace function public\.sellerpilot_is_admin\(\)[\s\S]*?\$\$;/u,
  "sellerpilot_is_admin");
const sellerAccountColumns = exactFragment(sellerLineageSql,
  new RegExp(String.raw`alter\stable\ssellerpilot_private\.channel_credentials\n\s{2}add\scolumn[\s\S]*?;`, "u"),
  "seller account columns");
const sellerAccountConstraint = exactFragment(sellerLineageSql,
  new RegExp(String.raw`alter\stable\ssellerpilot_private\.channel_credentials\n\s{2}drop\sconstraint[\s\S]*?\n\s{2}\);`, "u"),
  "seller account constraint");
const sellerAccountNotNull = exactFragment(sellerLineageSql,
  new RegExp(String.raw`alter\stable\ssellerpilot_private\.channel_credentials\n\s{2}alter\scolumn\sseller_account_key_source\sset\snot\snull;`, "u"),
  "seller account source not null");
const bindingTable = exactFragment(bindingSql,
  /create table sellerpilot_private\.cs_credential_capability_bindings\([\s\S]*?\n\);/u,
  "credential capability bindings");
const bindingIndex = exactFragment(bindingSql,
  /create index cs_credential_capability_bindings_health_idx[\s\S]*?;/u,
  "binding health index");
const bindingAcl = exactFragment(bindingSql,
  /alter table sellerpilot_private\.cs_credential_capability_bindings enable row level security;\nrevoke all on sellerpilot_private\.cs_credential_capability_bindings from public,anon,authenticated,service_role;/u,
  "binding ACL");
const multiAccountIndexes = exactFragment(multiAccountSql,
  /drop index if exists sellerpilot_private\.channel_credentials_one_active_idx;[\s\S]*?seller_account_key is null;/u,
  "Lazada multi-account indexes");

test("supplemental dependencies map to current canonical schema and ACL sources", () => {
  assert.match(credentialTable, /created_by uuid not null references auth\.users\(id\)/u);
  assert.match(sellerAccountColumns, /seller_account_key_source text/u);
  assert.match(sellerAccountConstraint, /provider_certified_v1/u);
  assert.match(bindingTable, /operation text not null check\(operation in\('inquiries\.list','inquiries\.reply'\)\)/u);
  assert.match(bindingTable, /verified_job_id uuid not null/u);
  assert.match(bindingAcl, /revoke all[\s\S]*authenticated,service_role/u);
  assert.match(multiAccountIndexes, /channel_credentials_one_active_lazada_account_idx/u);
  assert.match(supplementalSql, /binding\.operation='inquiries\.list'/u);
  assert.match(supplementalSql, /credential\.seller_account_key_source='provider_certified_v1'/u);
  assert.match(supplementalSql,
    /on conflict\(credential_id,country,surface,resource_key,event_key\) do nothing;[\s\S]*?perform 1[\s\S]*?LAZADA_SUPPLEMENTAL_EVENT_KEY_CONFLICT/u);
  assert.doesNotMatch(supplementalSql, /app_fingerprint|token_fingerprint|target_fingerprint/iu);
});

test("current credential, binding, ACL and multi-account DDL composes with supplemental ingest and read", async () => {
  const db = new PGlite();
  const owner = "00000000-0000-4000-8000-000000001301";
  const admin = "00000000-0000-4000-8000-000000001302";
  const outsider = "00000000-0000-4000-8000-000000001303";
  const myCredential = "00000000-0000-4000-8000-000000001304";
  const sgCredential = "00000000-0000-4000-8000-000000001305";
  const pendingCredential = "00000000-0000-4000-8000-000000001306";
  const myJob = "00000000-0000-4000-8000-000000001307";
  const sgJob = "00000000-0000-4000-8000-000000001308";
  const eventKey = "a".repeat(64);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema sellerpilot_private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      ${adminTable}
      ${credentialTable}
      ${originalCredentialIndex}
      ${sellerAccountColumns}
      ${sellerAccountConstraint}
      ${sellerAccountNotNull}
      create table sellerpilot_private.channel_gateway_jobs(id uuid primary key);
      ${bindingTable}
      ${bindingIndex}
      ${bindingAcl}
      ${isAdminFunction}
      ${multiAccountIndexes}
    `);
    await db.exec(supplementalSql);
    await db.query("insert into auth.users values($1),($2),($3)", [owner, admin, outsider]);
    await db.query("insert into sellerpilot_private.admin_users(user_id,display_name) values($1,'관리자')", [admin]);
    await db.query(`insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,fingerprint,created_by,
      seller_account_key,seller_account_key_source,seller_account_verified_at
    ) values
      ($1,'lazada','production',1,$4,'MY-CREDENTIAL',$3,$6,'provider_certified_v1',clock_timestamp()),
      ($2,'lazada','production',2,$5,'SG-CREDENTIAL',$3,$7,'provider_certified_v1',clock_timestamp()),
      ($8,'lazada','sandbox',3,$9,'PENDING-CREDENTIAL',$10,null,'legacy_unattested',null)`, [
      myCredential, sgCredential, owner,
      "00000000-0000-4000-8000-000000001311", "00000000-0000-4000-8000-000000001312",
      "b".repeat(64), "c".repeat(64), pendingCredential,
      "00000000-0000-4000-8000-000000001313", outsider,
    ]);
    await db.query("insert into sellerpilot_private.channel_gateway_jobs values($1),($2)", [myJob, sgJob]);
    await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings(
      credential_id,channel,operation,country,app_fingerprint,token_fingerprint,target_fingerprint,
      status,verified_job_id,verified_at,expires_at
    ) values
      ($1,'lazada','inquiries.list','MY',$5,$6,$7,'active',$3,clock_timestamp(),clock_timestamp()+interval '1 day'),
      ($2,'lazada','inquiries.list','SG',$5,$6,$8,'active',$4,clock_timestamp(),clock_timestamp()+interval '1 day')`, [
      myCredential, sgCredential, myJob, sgJob,
      "d".repeat(64), "e".repeat(64), "f".repeat(64), "9".repeat(64),
    ]);
    const storedEvent = (credentialId: string, country: string, resourceKey: string) => [{
      credentialId,
      country,
      surface: "product_review",
      sourcePath: "/review/seller/list",
      resourceKey,
      eventKey,
      status: "published",
      title: "상품 리뷰 · 평점 5",
      body: "canonical composition",
      externalOrderId: null,
      externalItemId: "ITEM-1",
      rating: 5,
      occurredAt: "2026-09-09T09:00:00.000Z",
      observedAt: "2026-09-09T09:01:00.000Z",
      providerContext: { reviewId: resourceKey, itemId: "ITEM-1" },
    }];
    await db.exec("set role service_role");
    await db.query(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb)`, [
      myCredential, JSON.stringify(storedEvent(myCredential, "MY", "REVIEW-MY")),
    ]);
    await db.query(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'SG','product_review','/review/seller/list',$2::jsonb)`, [
      sgCredential, JSON.stringify(storedEvent(sgCredential, "SG", "REVIEW-SG")),
    ]);
    await assert.rejects(db.query(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'SG','product_review','/review/seller/list',$2::jsonb)`, [
      myCredential, JSON.stringify(storedEvent(myCredential, "SG", "WRONG-BINDING")),
    ]), /LAZADA_SUPPLEMENTAL_COUNTRY_BINDING_REQUIRED/);
    await assert.rejects(db.query(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb)`, [
      pendingCredential, JSON.stringify(storedEvent(pendingCredential, "MY", "PENDING")),
    ]), /LAZADA_SUPPLEMENTAL_CREDENTIAL_UNBOUND/);
    await assert.rejects(db.query(
      "select count(*) from sellerpilot_private.cs_credential_capability_bindings",
    ), /permission denied/);
    await assert.rejects(db.query(
      "select count(*) from sellerpilot_private.lazada_supplemental_cs_events",
    ), /permission denied/);
    await db.exec("reset role");

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    const first = (await db.query(`select public.sellerpilot_read_lazada_supplemental_cs_v1(
      null,null,null,null,null,1) value`)).rows[0]?.value;
    const cursor = first.nextCursor;
    assert.equal(first.events.length, 1);
    assert.ok(cursor);
    const second = (await db.query(`select public.sellerpilot_read_lazada_supplemental_cs_v1(
      null,$1,$2,$3,$4,1) value`, [
      cursor.occurredAt, cursor.eventKey, cursor.credentialId, cursor.country,
    ])).rows[0]?.value;
    assert.deepEqual(new Set([first.events[0].country, second.events[0].country]), new Set(["MY", "SG"]));
    await assert.rejects(db.query(
      "select count(*) from sellerpilot_private.lazada_supplemental_cs_events",
    ), /permission denied/);
    await db.exec("reset role");

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query(
      "select public.sellerpilot_read_lazada_supplemental_cs_v1(null,null,null,null,null,50)",
    ), /administrator access required/);
  } finally {
    await db.close();
  }
});
