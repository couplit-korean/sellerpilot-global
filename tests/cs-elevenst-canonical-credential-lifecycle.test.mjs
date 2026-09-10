import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const baseMigration = new URL("supabase/migrations/20260816060000_channel_credentials_and_roles.sql", root);
const latestControlPlane = new URL("supabase/migrations/20260822153000_tracx_logistics_tracking.sql", root);
const latestLineage = new URL("supabase/migrations/20260830054851_certify_provider_identity_on_service_refresh.sql", root);
const proposal = new URL("supabase/migrations/20260909133643_cs_elevenst_account_lifecycle.sql", root);

const adminA = "11111111-1111-4111-8111-111111111111";
const adminB = "22222222-2222-4222-8222-222222222222";
const nonAdmin = "99999999-9999-4999-8999-999999999999";
const sellerA = { api_key: "A".repeat(32), seller_id: "CouplitSeller" };
const sellerB = { api_key: "B".repeat(32), seller_id: "SecondShop" };

function functionDefinition(source, qualifiedName) {
  const start = source.indexOf(`create or replace function ${qualifiedName}(`);
  assert.notEqual(start, -1, `${qualifiedName} canonical definition missing`);
  const end = source.indexOf("\n$$;", source.indexOf("as $$", start));
  assert.notEqual(end, -1, `${qualifiedName} canonical definition unterminated`);
  return source.slice(start, end + 4);
}

async function fixture() {
  const [base, controlPlane, lineage, candidate] = await Promise.all([
    readFile(baseMigration, "utf8"),
    readFile(latestControlPlane, "utf8"),
    readFile(latestLineage, "utf8"),
    readFile(proposal, "utf8"),
  ]);
  assert.match(base, /create unique index if not exists channel_credentials_one_active_idx\s+on sellerpilot_private\.channel_credentials \(channel, environment\)\s+where status = 'active';/u);
  assert.match(controlPlane, /where c\.channel = p_channel and c\.environment = p_environment and c\.status = 'active'\s+for update;/u);
  assert.match(controlPlane, /where c\.channel = p_channel and c\.environment = p_environment and c\.status = 'active'[\s\S]*?limit 1;/u);
  assert.match(lineage, /select sellerpilot_private\.new_seller_account_key\(\),\s+'credential_incarnation_v1'/u);

  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema extensions;
    create schema vault;
    create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    insert into auth.users(id) values
      ('${adminA}'),('${adminB}'),('${nonAdmin}');
    create function auth.uid() returns uuid language sql stable set search_path=''
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.digest(value text, algorithm text) returns bytea
      language sql immutable set search_path=''
      as $$select sha256(convert_to(value,'UTF8'))$$;
    create function extensions.digest(value bytea, algorithm text) returns bytea
      language sql immutable set search_path=''
      as $$select sha256(value)$$;
    create table vault.secrets(
      id uuid primary key, secret text not null, name text, description text
    );
    create view vault.decrypted_secrets as
      select id,secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(value text,name text,description text)
      returns uuid language plpgsql security definer set search_path=''
      as $$declare v_id uuid:=gen_random_uuid(); begin
        insert into vault.secrets values(v_id,value,name,description); return v_id;
      end$$;
    create table sellerpilot_private.admin_users(
      user_id uuid primary key references auth.users(id),
      display_name text not null,created_at timestamptz not null default now()
    );
    insert into sellerpilot_private.admin_users(user_id,display_name)
      values('${adminA}','Admin A'),('${adminB}','Admin B');
    create table sellerpilot_private.channel_credentials (
      id uuid primary key default gen_random_uuid(),
      channel text not null check (channel in ('qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu','tracx')),
      environment text not null default 'production' check (environment in ('sandbox','production')),
      version integer not null check (version > 0),
      vault_secret_id uuid not null,
      fingerprint text not null,
      status text not null default 'active' check (status in ('active','grace','revoked','invalid')),
      expires_at timestamptz,
      rotation_interval_days integer not null default 90 check (rotation_interval_days between 1 and 365),
      warning_days integer not null default 30 check (warning_days between 1 and 180),
      grace_ends_at timestamptz,
      last_rotated_at timestamptz not null default now(),
      last_checked_at timestamptz,
      last_check_status text check (last_check_status is null or last_check_status in ('passed','failed','manual')),
      last_check_message text,
      created_by uuid not null references auth.users(id),
      created_at timestamptz not null default now(),
      seller_account_key text,
      seller_account_key_source text not null default 'legacy_unattested',
      seller_account_verified_at timestamptz,
      unique(channel,environment,version),
      constraint channel_credentials_seller_account_key_check check (
        (seller_account_key is null and seller_account_key_source='legacy_unattested' and seller_account_verified_at is null)
        or (seller_account_key ~ '^[a-f0-9]{64}$' and seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1') and seller_account_verified_at is not null)
      )
    );
    create unique index channel_credentials_one_active_idx
      on sellerpilot_private.channel_credentials(channel,environment)
      where status='active';
    create table sellerpilot_private.credential_audit(
      id bigint generated always as identity primary key,
      credential_id uuid references sellerpilot_private.channel_credentials(id) on delete set null,
      channel text not null,environment text not null,
      action text not null check(action in ('created','rotated','schedule_updated','tested','revoked','restored')),
      actor_user_id uuid references auth.users(id) on delete set null,
      safe_detail jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null default now()
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,prepared_credential_id uuid,credential_id uuid,
      worker_token_id uuid,claim_token uuid,status text,lease_expires_at timestamptz,
      credential_refresh_prepared_at timestamptz,channel text,operation text,
      completed_at timestamptz,response_payload jsonb
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text,status text,expires_at timestamptz
    );
  `);
  await db.exec(functionDefinition(base, "public.sellerpilot_is_admin"));
  await db.exec(functionDefinition(base, "public.sellerpilot_list_credentials"));
  await db.exec(functionDefinition(controlPlane, "public.sellerpilot_rotate_credential"));
  await db.exec(functionDefinition(base, "public.sellerpilot_decrypt_credential"));
  await db.exec(functionDefinition(base, "public.sellerpilot_record_credential_test"));
  await db.exec(functionDefinition(controlPlane, "public.sellerpilot_get_active_credential_secret"));
  await db.exec(functionDefinition(lineage, "sellerpilot_private.credential_lineage_attestation_marker_matches"));
  return { db, candidate, lineage };
}

async function finishFixtureSetup(db, lineage) {
  // new_seller_account_key was introduced by the lineage migration, not base.
  await db.exec(functionDefinition(await readFile(new URL("supabase/migrations/20260825111800_bind_listing_seller_accounts.sql", root), "utf8"), "sellerpilot_private.new_seller_account_key"));
  await db.exec(functionDefinition(lineage, "sellerpilot_private.credential_seller_account_lineage"));
  await db.exec(functionDefinition(lineage, "sellerpilot_private.guard_credential_seller_lineage"));
  await db.exec(`
    create trigger guard_credential_seller_lineage
      before insert or update on sellerpilot_private.channel_credentials
      for each row execute function sellerpilot_private.guard_credential_seller_lineage();
    revoke all on schema sellerpilot_private from public,anon,authenticated;
    revoke all on function public.sellerpilot_decrypt_credential(uuid) from public,anon,authenticated;
    grant execute on function public.sellerpilot_decrypt_credential(uuid) to service_role;
    revoke all on function public.sellerpilot_record_credential_test(uuid,text,text) from public,anon,authenticated;
    grant execute on function public.sellerpilot_record_credential_test(uuid,text,text) to service_role;
    revoke all on function public.sellerpilot_rotate_credential(text,text,jsonb,timestamptz,integer,integer,integer) from public,anon;
    grant execute on function public.sellerpilot_rotate_credential(text,text,jsonb,timestamptz,integer,integer,integer) to authenticated;
    revoke all on function public.sellerpilot_get_active_credential_secret(text,text) from public,anon,authenticated;
    grant execute on function public.sellerpilot_get_active_credential_secret(text,text) to service_role;
    revoke all on function public.sellerpilot_list_credentials() from public,anon;
    grant execute on function public.sellerpilot_list_credentials() to authenticated;
  `);
}

async function asUser(db, userId, query, params = []) {
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    return await db.query(query, params);
  } finally {
    await db.exec("reset role");
  }
}

async function asService(db, query, params = []) {
  await db.exec("set role service_role");
  try {
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
    return await db.query(query, params);
  } finally {
    await db.exec("reset role");
  }
}

async function canonicalCreate(db, userId, channel, payload) {
  return (await asUser(db, userId,
    "select public.sellerpilot_rotate_credential($1,'production',$2::jsonb,null,90,30,0) id",
    [channel, JSON.stringify(payload)])).rows[0].id;
}

test("CONT-08 canonical control plane really rotates the only 11st active slot", async () => {
  const { db, lineage } = await fixture();
  try {
    await finishFixtureSetup(db, lineage);
    const first = await canonicalCreate(db, adminA, "elevenst", sellerA);
    const second = await canonicalCreate(db, adminA, "elevenst", { ...sellerB, api_key: "C".repeat(32) });
    const rows = (await db.query("select id,status,version from sellerpilot_private.channel_credentials where channel='elevenst' order by version")).rows;
    assert.deepEqual(rows.map(({ id, status }) => ({ id, status })), [
      { id: first, status: "revoked" },
      { id: second, status: "active" },
    ]);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_credentials where channel='elevenst' and status='active'")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test("CONT-08 proposal creates pending, activates two identities, blocks duplicate seller, and rotates exact lineage", async () => {
  const { db, candidate, lineage } = await fixture();
  try {
    await finishFixtureSetup(db, lineage);
    const originalA = await canonicalCreate(db, adminA, "elevenst", sellerA);
    const lazada = await readFile(new URL('supabase/migrations/20260909124048_cs_lazada_multi_account_scope.sql',root),'utf8');
    await db.exec(lazada.slice(lazada.indexOf('drop index if exists sellerpilot_private.channel_credentials_one_active_idx;'),lazada.indexOf('create function public.sellerpilot_list_active_lazada_credentials')));
    await db.exec(candidate);

    await assert.rejects(
      asUser(db, adminA, "select public.sellerpilot_rotate_credential('elevenst','production',$1::jsonb,null,90,30,0)", [JSON.stringify(sellerB)]),
      /ELEVENST_EXACT_CREDENTIAL_FLOW_REQUIRED/u,
    );
    await assert.rejects(
      asService(db, "select public.sellerpilot_get_active_credential_secret('elevenst','production')"),
      /ELEVENST_EXACT_CREDENTIAL_ID_REQUIRED/u,
    );

    const pendingB = (await asUser(db, adminB,
      "select public.sellerpilot_create_elevenst_credential_pending_v1('production',$1::jsonb,null,90,30) id",
      [JSON.stringify(sellerB)])).rows[0].id;
    const pending = (await db.query("select credential.status,claim.lifecycle_state,claim.access_checked_at from sellerpilot_private.channel_credentials credential join sellerpilot_private.elevenst_credential_identity_claims claim on claim.credential_id=credential.id where credential.id=$1", [pendingB])).rows[0];
    assert.deepEqual(pending, { status: "pending", lifecycle_state: "pending", access_checked_at: null });
    await assert.rejects(
      asUser(db, adminB, "select public.sellerpilot_activate_elevenst_credential_v1($1)", [pendingB]),
      /ELEVENST_RECENT_EXACT_ACCESS_TEST_REQUIRED/u,
    );
    const diagnostic = (await asService(db,
      "select public.sellerpilot_service_get_elevenst_pending_diagnostic_secret_v1($1) result",
      [pendingB])).rows[0].result;
    assert.equal(diagnostic.credential_id, pendingB);
    assert.deepEqual(diagnostic.secret_payload, sellerB);
    await asService(db,
      "select public.sellerpilot_record_credential_test($1,'passed','exact fixture access read passed')",
      [pendingB]);
    await asUser(db, adminA,
      "select public.sellerpilot_activate_elevenst_credential_v1($1)", [pendingB]);

    const active = (await db.query("select id,created_by,seller_account_key from sellerpilot_private.channel_credentials where channel='elevenst' and status='active' order by version")).rows;
    assert.equal(active.length, 2);
    assert.deepEqual(active.map((row) => row.id), [originalA, pendingB]);
    assert.notEqual(active[0].seller_account_key, active[1].seller_account_key);

    await assert.rejects(
      asUser(db, adminB,
        "select public.sellerpilot_create_elevenst_credential_pending_v1('production',$1::jsonb,null,90,30)",
        [JSON.stringify({ api_key: "D".repeat(32), seller_id: "couplitseller" })]),
      /duplicate key value violates unique constraint "elevenst_credential_identity_live_claim_idx"/u,
    );

    const rotatedA = (await asUser(db, adminB,
      "select public.sellerpilot_rotate_elevenst_credential_v1($1,$2::jsonb,null,90,30,7) id",
      [originalA, JSON.stringify({ api_key: "E".repeat(32) })])).rows[0].id;
    const lifecycle = (await db.query("select credential.id,credential.status,credential.created_by,credential.seller_account_key,claim.lifecycle_state,claim.replaced_credential_id from sellerpilot_private.channel_credentials credential join sellerpilot_private.elevenst_credential_identity_claims claim on claim.credential_id=credential.id where credential.id in ($1,$2,$3) order by credential.version", [originalA, pendingB, rotatedA])).rows;
    assert.equal(lifecycle.find((row) => row.id === originalA).status, "grace");
    assert.equal(lifecycle.find((row) => row.id === originalA).lifecycle_state, "grace");
    assert.equal(lifecycle.find((row) => row.id === rotatedA).status, "active");
    assert.equal(lifecycle.find((row) => row.id === rotatedA).replaced_credential_id, originalA);
    assert.equal(lifecycle.find((row) => row.id === rotatedA).seller_account_key, lifecycle.find((row) => row.id === originalA).seller_account_key);
    assert.equal(lifecycle.find((row) => row.id === rotatedA).created_by, adminA);
    assert.equal(lifecycle.find((row) => row.id === pendingB).status, "active");

    const secretA = (await asService(db,
      "select public.sellerpilot_decrypt_credential($1) secret", [rotatedA])).rows[0].secret;
    const secretB = (await asService(db,
      "select public.sellerpilot_decrypt_credential($1) secret", [pendingB])).rows[0].secret;
    assert.deepEqual(secretA, { api_key: "E".repeat(32), seller_id: sellerA.seller_id });
    assert.deepEqual(secretB, sellerB);

    const shared = (await asUser(db, adminB,
      "select id,status from public.sellerpilot_list_credentials() where channel='elevenst' order by version")).rows;
    assert.equal(shared.length, 3);
    assert.equal(shared.filter((row) => row.status === "active").length, 2);
    const audit = (await db.query("select action,actor_user_id,safe_detail from sellerpilot_private.credential_audit where credential_id=$1 order by id desc limit 1", [rotatedA])).rows[0];
    assert.equal(audit.action, "rotated");
    assert.equal(audit.actor_user_id, adminB);
    assert.equal(audit.safe_detail.previousCredentialId, originalA);
  } finally {
    await db.close();
  }
});

test("CONT-08 non-admin is denied and the canonical one-active rule remains for other channels", async () => {
  const { db, candidate, lineage } = await fixture();
  try {
    await finishFixtureSetup(db, lineage);
    const lazada = await readFile(new URL('supabase/migrations/20260909124048_cs_lazada_multi_account_scope.sql',root),'utf8');
    await db.exec(lazada.slice(lazada.indexOf('drop index if exists sellerpilot_private.channel_credentials_one_active_idx;'),lazada.indexOf('create function public.sellerpilot_list_active_lazada_credentials')));
    await db.exec(candidate);
    await assert.rejects(
      asUser(db, nonAdmin,
        "select public.sellerpilot_create_elevenst_credential_pending_v1('production',$1::jsonb,null,90,30)",
        [JSON.stringify(sellerA)]),
      /administrator access required/u,
    );
    const first = await canonicalCreate(db, adminA, "qoo10", { api_key: "q1" });
    const second = await canonicalCreate(db, adminB, "qoo10", { api_key: "q2" });
    const qoo10 = (await db.query("select id,status from sellerpilot_private.channel_credentials where channel='qoo10' order by version")).rows;
    assert.deepEqual(qoo10, [{ id: first, status: "revoked" }, { id: second, status: "active" }]);
    const indexDefs = (await db.query("select indexname,indexdef from pg_indexes where schemaname='sellerpilot_private' and indexname like 'channel_credentials_%active%' order by indexname")).rows;
    assert.match(indexDefs.find((row) => row.indexname === "channel_credentials_one_active_non_lazada_elevenst_idx").indexdef, /lazada.*elevenst/u);
    assert.match(indexDefs.find((row) => row.indexname === "channel_credentials_elevenst_active_account_idx").indexdef, /seller_account_key/u);
    const acl = (await db.query(`select
      has_function_privilege('anon','public.sellerpilot_create_elevenst_credential_pending_v1(text,jsonb,timestamptz,integer,integer)','EXECUTE') create_anon,
      has_function_privilege('authenticated','public.sellerpilot_create_elevenst_credential_pending_v1(text,jsonb,timestamptz,integer,integer)','EXECUTE') create_admin,
      has_function_privilege('authenticated','public.sellerpilot_service_get_elevenst_pending_diagnostic_secret_v1(uuid)','EXECUTE') diagnostic_admin,
      has_function_privilege('service_role','public.sellerpilot_service_get_elevenst_pending_diagnostic_secret_v1(uuid)','EXECUTE') diagnostic_service,
      has_function_privilege('authenticated','public.sellerpilot_rotate_credential_before_elevenst_multi_account(text,text,jsonb,timestamptz,integer,integer,integer)','EXECUTE') unsafe_admin`)).rows[0];
    assert.deepEqual(acl, {
      create_anon: false,
      create_admin: true,
      diagnostic_admin: false,
      diagnostic_service: true,
      unsafe_admin: false,
    });
  } finally {
    await db.close();
  }
});

test("CONT-08 proposal refuses to overwrite a centrally combined active-index predicate", async () => {
  const { db, candidate, lineage } = await fixture();
  try {
    await finishFixtureSetup(db, lineage);
    await db.exec("drop index sellerpilot_private.channel_credentials_one_active_idx; create unique index channel_credentials_one_active_idx on sellerpilot_private.channel_credentials(channel,environment) where status='active' and channel<>'smartstore'");
    await assert.rejects(db.exec(candidate), /ELEVENST_ACTIVE_INDEX_CENTRAL_MERGE_REQUIRED/u);
    await db.exec("rollback");
    const definition = (await db.query("select indexdef from pg_indexes where schemaname='sellerpilot_private' and indexname='channel_credentials_one_active_idx'")).rows[0].indexdef;
    assert.match(definition, /channel <> 'smartstore'/u);
    assert.doesNotMatch(definition, /elevenst/u);
  } finally {
    await db.close();
  }
});
