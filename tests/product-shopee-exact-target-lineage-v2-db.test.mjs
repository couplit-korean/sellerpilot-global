import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { exactShopeeCachedTargetForActiveCredential } from "../lib/product-registration/shopee/target-lineage-readiness.ts";

const migration = await readFile(new URL(
  "../supabase/migrations/20260909193500_shopee_exact_target_lineage_v2.sql",
  import.meta.url,
), "utf8");
const cacheReceiptMigration = await readFile(new URL(
  "../supabase/migrations/20260909204000_shopee_exact_target_cache_receipt_v3.sql",
  import.meta.url,
), "utf8");
const route = await readFile(new URL("../app/api/admin/channel-targets/route.ts", import.meta.url), "utf8");
const targetClient = await readFile(new URL("../app/channel-target-client.ts", import.meta.url), "utf8");
const publishWorkbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");
const categoryWorkbench = await readFile(new URL("../app/category-classification-workbench.tsx", import.meta.url), "utf8");
const serverlessExecutor = await readFile(new URL("../lib/channels/commerce-provider.ts", import.meta.url), "utf8");
const scriptExecutor = await readFile(new URL("../scripts/commerce-gateway-job.mjs", import.meta.url), "utf8");
const shopeeRefreshMigration = await readFile(new URL(
  "../supabase/migrations/20260821110000_harden_oauth_rotation_and_cleanup_lints.sql",
  import.meta.url,
), "utf8");
const gatewayRefreshMigration = await readFile(new URL(
  "../supabase/migrations/20260825104500_prepare_gateway_credential_refresh.sql",
  import.meta.url,
), "utf8");

const owner = "00000000-0000-4000-8000-000000006101";
const oldCredential = "00000000-0000-4000-8000-000000006102";
const nextCredential = "00000000-0000-4000-8000-000000006103";
const oldVault = "00000000-0000-4000-8000-000000006104";
const nextVault = "00000000-0000-4000-8000-000000006105";
const targetId = "1719148844";
const providerSubject = "shopee:main:4940266";

function targetSecret({
  shopId = targetId,
  subject = providerSubject,
  expiresAt = new Date(Date.now() + 60 * 60_000).toISOString(),
  includeIdentityVersion = true,
} = {}) {
  return {
    ...(includeIdentityVersion ? { provider_account_identity_version: "v1" } : {}),
    provider_account_subject: subject,
    shopee_targets: [{
      type: "shop",
      id: shopId,
      access_token_expires_at: expiresAt,
    }],
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role unrelated;
    create schema auth; create schema sellerpilot_private; create schema vault;
    create function auth.uid() returns uuid language sql stable set search_path=''
      as $$ select nullif(pg_catalog.current_setting('test.uid', true), '')::uuid $$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      created_by uuid not null,
      channel text not null,
      environment text not null,
      version integer not null,
      status text not null,
      vault_secret_id uuid not null,
      expires_at timestamptz
    );
    create table vault.decrypted_secrets(id uuid primary key, decrypted_secret text not null);
    create table sellerpilot_private.channel_market_targets(
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,
      environment text not null,
      target_id text not null,
      display_name text not null,
      market_code text not null,
      locale text not null,
      language text not null,
      currency text not null,
      remote_status text not null,
      verified_at timestamptz not null,
      updated_at timestamptz not null,
      unique(owner_id, channel, environment, market_code, target_id)
    );
    create function public.sellerpilot_is_admin() returns boolean language sql stable
    security definer set search_path='' as $$
      select exists(select 1 from sellerpilot_private.admin_users a where a.user_id=auth.uid())
    $$;
    create function public.sellerpilot_list_channel_market_targets(text) returns text
    language sql stable as $$ select 'v1-preserved'::text $$;
    insert into sellerpilot_private.admin_users values ('${owner}');
  `);
  await db.query(
    "insert into sellerpilot_private.channel_credentials values($1,$2,'shopee','production',80,'active',$3,null)",
    [oldCredential, owner, oldVault],
  );
  await db.query("insert into vault.decrypted_secrets values($1,$2)", [oldVault, JSON.stringify(targetSecret())]);
  await db.exec(migration);
  await db.exec(cacheReceiptMigration);
  return db;
}

async function store(db, {
  credentialId = oldCredential,
  credentialVersion = 80,
  shopId = targetId,
  displayName = "gjrxn.sg",
  marketCode = "SG",
  locale = "en-SG",
  language = "English",
  currency = "SGD",
  subject = providerSubject,
  actorId = owner,
} = {}) {
  await db.exec("set role service_role");
  try {
    return (await db.query(`select public.sellerpilot_service_upsert_shopee_market_target_v2(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,'NORMAL',$10,clock_timestamp()
    ) receipt`, [actorId, credentialId, credentialVersion, shopId, displayName,
      marketCode, locale, language, currency, subject])).rows[0].receipt;
  } finally {
    await db.exec("reset role");
  }
}

test("route binds the exact SG request to the actual v2 RPC signatures", async () => {
  const db = await fixture();
  try {
    assert.match(route, /sellerpilot_list_channel_market_targets_v2/u);
    assert.match(route, /sellerpilot_get_active_credential_secret_v2/u);
    assert.match(route, /request: \{ shopId: parsed\.data\.targetId \}/u);
    assert.match(route, /p_expected_credential_id: binding\.credentialId/u);
    assert.match(route, /p_expected_credential_version: after\.version/u);
    assert.match(route, /activeCredentialVersion: envelope\.version/u);
    assert.match(route, /sellerpilot_service_upsert_shopee_market_target_v2/u);
    assert.match(route, /shopeeShopDiscoveryEvidenceFromGatewayResult/u);
    assert.doesNotMatch(route, /providerReadSucceeded:\s*true/u);
    assert.doesNotMatch(route, /signedRequestBoundToTarget:\s*true/u);
    assert.doesNotMatch(route, /for \(const targetId of targetIds\)/u);

    const signatures = (await db.query(`select oid::regprocedure::text signature
      from pg_proc where proname in (
        'sellerpilot_get_active_credential_secret_v2',
        'sellerpilot_list_channel_market_targets_v2',
        'sellerpilot_service_upsert_shopee_market_target_v2'
      ) order by proname`)).rows.map((row) => row.signature);
    assert.deepEqual(signatures, [
      "sellerpilot_get_active_credential_secret_v2(text,text)",
      "sellerpilot_list_channel_market_targets_v2(text)",
      "sellerpilot_service_upsert_shopee_market_target_v2(uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamp with time zone)",
    ]);
  } finally { await db.close(); }
});

test("the v3 cache read preserves the stored version instead of relabeling it from the credential join", async () => {
  const db = await fixture();
  try {
    await store(db);
    await db.query("update sellerpilot_private.channel_credentials set version=81 where id=$1", [oldCredential]);
    await db.query("select set_config('test.uid',$1,false)", [owner]);
    await db.exec("set role authenticated");
    let row = (await db.query("select * from public.sellerpilot_list_channel_market_targets_v2('shopee')")).rows[0];
    await db.exec("reset role");
    assert.equal(row.credential_version, 80);
    assert.deepEqual(exactShopeeCachedTargetForActiveCredential({
      cachedTargets: [{
        targetId: row.target_id,
        displayName: row.display_name,
        marketCode: row.market_code,
        locale: row.locale,
        language: row.language,
        currency: row.currency,
        status: row.remote_status,
        verifiedAt: row.verified_at,
        credentialId: row.credential_id,
        credentialVersion: row.credential_version,
      }],
      activeCredentialId: oldCredential,
      activeCredentialVersion: 81,
      activeCredentialSecret: targetSecret(),
      targetId,
      marketCode: "SG",
    }), { status: "blocked", reason: "SHOPEE_TARGET_CACHE_VERSION_MISMATCH" });

    const receipt = await store(db, { credentialVersion: 81 });
    assert.equal(receipt.credentialVersion, 81);
    await db.exec("set role authenticated");
    row = (await db.query("select * from public.sellerpilot_list_channel_market_targets_v2('shopee')")).rows[0];
    await db.exec("reset role");
    assert.equal(row.credential_version, 81);
  } finally { await db.close(); }
});

test("both Shopee consumers pass the selected target through the exact SG client without coercing other markets", () => {
  assert.match(targetClient, /channel !== "shopee" \|\| marketCode !== "SG"\) return null/u);
  assert.match(targetClient, /query\.set\("targetId", exactTarget\.targetId\)/u);
  assert.match(targetClient, /query\.set\("marketCode", exactTarget\.marketCode\)/u);
  assert.match(targetClient, /shopeeCredentialIdForExactSync/u);
  assert.match(targetClient, /exactShopeeTargetResponseIsBound/u);
  for (const consumer of [publishWorkbench, categoryWorkbench]) {
    assert.match(consumer, /selectedTarget: selectedShopeeTarget/u);
    assert.match(consumer, /exactShopeeTargetFromPayload\(exactPayload, selectedShopeeTarget\)/u);
    assert.match(consumer, /selectedTarget: (?:resolvedTarget|nextTarget)/u);
  }
});

test("both gateway executors bind a successful shop-info read to request.shopId", () => {
  for (const executor of [serverlessExecutor, scriptExecutor]) {
    assert.match(executor, /job\.request\??\.?shopId/u);
    assert.match(executor, /path: "\/api\/v2\/shop\/get_shop_info"/u);
    assert.match(executor, /assertShopeeShopProfileTarget\(remote\.data, shopId, \{ acceptSignedRequestBinding: true \}\)/u);
  }
});

test("the supported Shopee refresh path creates a new credential id and increments its version", () => {
  const shopeeStart = shopeeRefreshMigration.indexOf("create or replace function public.sellerpilot_service_refresh_shopee(");
  const shopeeEnd = shopeeRefreshMigration.indexOf("create or replace function public.sellerpilot_service_refresh_lazada(", shopeeStart);
  const shopeeRefresh = shopeeRefreshMigration.slice(shopeeStart, shopeeEnd);
  assert.ok(shopeeStart >= 0 && shopeeEnd > shopeeStart);
  assert.match(shopeeRefresh, /v_id uuid := gen_random_uuid\(\)/u);
  assert.match(shopeeRefresh, /coalesce\(max\(c\.version\), 0\) \+ 1 into v_version/u);
  assert.match(shopeeRefresh, /set status = 'revoked'/u);
  assert.match(shopeeRefresh, /insert into sellerpilot_private\.channel_credentials/u);
  assert.match(shopeeRefresh, /return v_id/u);

  const prepareStart = gatewayRefreshMigration.indexOf("create function public.sellerpilot_service_prepare_gateway_credential_refresh(");
  const prepareRefresh = gatewayRefreshMigration.slice(prepareStart);
  assert.ok(prepareStart >= 0);
  assert.match(prepareRefresh, /v_refreshed_credential_id := case v_job\.channel/u);
  assert.match(prepareRefresh, /when 'shopee' then public\.sellerpilot_service_refresh_shopee/u);
  assert.match(prepareRefresh, /set credential_id = v_refreshed_credential_id/u);
});

test("one exact SG target stores and reads with credential id and version while v1 stays untouched", async () => {
  const db = await fixture();
  try {
    const receipt = await store(db);
    assert.equal(receipt.contractVersion, 2);
    assert.equal(receipt.credentialId, oldCredential);
    assert.equal(receipt.credentialVersion, 80);
    assert.equal(receipt.targetId, targetId);
    assert.equal(receipt.marketCode, "SG");

    await db.query("select set_config('test.uid',$1,false)", [owner]);
    await db.exec("set role authenticated");
    const rows = (await db.query("select * from public.sellerpilot_list_channel_market_targets_v2('shopee')")).rows;
    await db.exec("reset role");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].credential_id, oldCredential);
    assert.equal(rows[0].credential_version, 80);
    assert.equal(rows[0].target_id, targetId);
    assert.equal((await db.query("select public.sellerpilot_list_channel_market_targets('shopee') value")).rows[0].value, "v1-preserved");
  } finally { await db.close(); }
});

test("active credential snapshot v2 exposes the version needed by the route fence", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    const snapshot = (await db.query(
      "select public.sellerpilot_get_active_credential_secret_v2('shopee','production') value",
    )).rows[0].value;
    await db.exec("reset role");
    assert.equal(snapshot.contract_version, 2);
    assert.equal(snapshot.credential_id, oldCredential);
    assert.equal(snapshot.credential_version, 80);
    assert.equal(snapshot.secret_payload.provider_account_subject, providerSubject);
  } finally { await db.close(); }
});

test("stale credential and rotation races fail atomically; the fresh version succeeds", async () => {
  const db = await fixture();
  try {
    await db.query("update sellerpilot_private.channel_credentials set status='grace' where id=$1", [oldCredential]);
    await db.query(
      "insert into sellerpilot_private.channel_credentials values($1,$2,'shopee','production',81,'active',$3,null)",
      [nextCredential, owner, nextVault],
    );
    await db.query("insert into vault.decrypted_secrets values($1,$2)", [nextVault, JSON.stringify(targetSecret())]);
    await assert.rejects(store(db), /SHOPEE_EXACT_TARGET_CREDENTIAL_CHANGED/u);
    const receipt = await store(db, { credentialId: nextCredential, credentialVersion: 81 });
    assert.equal(receipt.credentialId, nextCredential);
    assert.equal(receipt.credentialVersion, 81);
  } finally { await db.close(); }
});

test("wrong shop, provider identity, stale access and missing metadata fail before persistence", async () => {
  const cases = [
    [{ shopId: "999999999" }, /SHOPEE_EXACT_TARGET_NOT_AUTHORIZED/u],
    [{ subject: "shopee:main:9999999" }, /SHOPEE_EXACT_TARGET_IDENTITY_MISMATCH/u],
    [{ displayName: "" }, /SHOPEE_EXACT_TARGET_METADATA_INVALID/u],
    [{ locale: "en-MY" }, /SHOPEE_EXACT_TARGET_METADATA_INVALID/u],
  ];
  for (const [input, expected] of cases) {
    const db = await fixture();
    try {
      await assert.rejects(store(db, input), expected);
      assert.equal((await db.query("select count(*)::int count from sellerpilot_private.channel_market_targets")).rows[0].count, 0);
    } finally { await db.close(); }
  }

  for (const [label, payload] of [
    ["stale access", targetSecret({ expiresAt: new Date(Date.now() + 60_000).toISOString() })],
    ["missing identity version", targetSecret({ includeIdentityVersion: false })],
  ]) {
    const db = await fixture();
    try {
      await db.query("update vault.decrypted_secrets set decrypted_secret=$1", [JSON.stringify(payload)]);
      await assert.rejects(store(db), /SHOPEE_EXACT_TARGET_(?:ACCESS_NOT_FRESH|IDENTITY_MISMATCH)/u, label);
      assert.equal((await db.query("select count(*)::int count from sellerpilot_private.channel_market_targets")).rows[0].count, 0);
    } finally { await db.close(); }
  }
});

test("v2 secret/store RPCs are service-only and v2 read is authenticated-only", async () => {
  const db = await fixture();
  try {
    const storeSignature = "public.sellerpilot_service_upsert_shopee_market_target_v2(uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz)";
    const unsafeStoreSignature = "public.sellerpilot_60909204000_upsert_shopee_target_v2_unsafe(uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz)";
    const secretSignature = "public.sellerpilot_get_active_credential_secret_v2(text,text)";
    const listSignature = "public.sellerpilot_list_channel_market_targets_v2(text)";
    for (const role of ["anon", "authenticated", "service_role", "unrelated"]) {
      const acl = (await db.query(`select
        has_function_privilege($1,$2,'EXECUTE') store,
        has_function_privilege($1,$3,'EXECUTE') unsafe_store,
        has_function_privilege($1,$4,'EXECUTE') secret,
        has_function_privilege($1,$5,'EXECUTE') list`,
      [role, storeSignature, unsafeStoreSignature, secretSignature, listSignature])).rows[0];
      assert.equal(acl.store, role === "service_role");
      assert.equal(acl.unsafe_store, false);
      assert.equal(acl.secret, role === "service_role");
      assert.equal(acl.list, role === "authenticated");
    }
    for (const signature of [storeSignature, unsafeStoreSignature, secretSignature, listSignature]) {
      const metadata = (await db.query(
        "select prosecdef,proconfig from pg_proc where oid=$1::regprocedure",
        [signature],
      )).rows[0];
      assert.equal(metadata.prosecdef, true);
      assert.deepEqual(metadata.proconfig, ["search_path=\"\""]);
    }
  } finally { await db.close(); }
});
