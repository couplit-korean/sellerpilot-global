import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OUT_OF_SCOPE_COMPETITOR_MIGRATIONS = new Set([
  "20260831131500_retire_pre_v3_competitor_search_queue.sql",
  "20260831132000_competitor_identity_lineage_fence.sql",
]);

const ADMIN_ID = "60000000-0000-4000-8000-000000000001";
const TOKEN_ID = "60000000-0000-4000-8000-000000000002";
const TOKEN_HASH = "7".repeat(64);
const SHOPEE_ADOPTION_MIGRATION =
  "20260901171500_adopt_exact_shopee_sg_existing_item.sql";
const LAZADA_ADOPTION_MIGRATION =
  "20260901173000_adopt_exact_lazada_live_listing.sql";
const ADOPTION_COMPLETION_MERGE_MIGRATION =
  "20260901173100_merge_shopee_lazada_exact_adoption_completion.sql";
const TEMU_EXISTING_ADOPTION_MIGRATION =
  "20260901173200_exact_temu_existing_active_adoption.sql";
const TEMU_CREDENTIAL_CERTIFICATION_MIGRATION =
  "20260901173300_certify_exact_temu_existing_adoption_credential.sql";

const supabaseCompatibilityLayer = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  secret text not null,
  name text,
  description text,
  created_at timestamptz not null default now()
);
create or replace function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default ''
)
returns uuid
language plpgsql
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into vault.secrets (id, secret, name, description)
  values (v_id, new_secret, new_name, new_description);
  return v_id;
end;
$$;
create or replace view vault.decrypted_secrets as
select id, secret as decrypted_secret from vault.secrets;
create or replace function vault.delete_secret(secret_id uuid)
returns void
language sql
as $$ delete from vault.secrets where id = secret_id $$;
create or replace function vault.update_secret(
  secret_id uuid,
  new_secret text default null,
  new_name text default null,
  new_description text default null
)
returns void
language sql
as $$
  update vault.secrets
     set secret = coalesce(new_secret, secret),
         name = coalesce(new_name, name),
         description = coalesce(new_description, description)
   where id = secret_id
$$;

create schema if not exists net;
create table if not exists net.http_request_queue (
  id bigint generated always as identity primary key,
  url text not null,
  body jsonb,
  params jsonb,
  headers jsonb,
  timeout_milliseconds integer
);
create table if not exists net._http_response (
  id bigint primary key,
  status_code integer,
  content_type text,
  headers jsonb,
  content text,
  timed_out boolean,
  error_msg text,
  created timestamptz not null default now()
);
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type":"application/json"}'::jsonb,
  timeout_milliseconds integer default 1000
)
returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  insert into net.http_request_queue (
    url, body, params, headers, timeout_milliseconds
  ) values (
    $1, $2, $3, $4, $5
  ) returning id into v_id;
  return v_id;
end;
$$;

create schema if not exists cron;
create table if not exists cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null unique,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create table if not exists cron.job_run_details (
  runid bigint generated always as identity primary key,
  jobid bigint not null,
  end_time timestamptz
);
create or replace function cron.schedule(
  job_name text,
  job_schedule text,
  job_command text
)
returns bigint
language plpgsql
as $$
declare v_job_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (job_name, job_schedule, job_command)
  on conflict (jobname) do update
    set schedule = excluded.schedule,
        command = excluded.command
  returning jobid into v_job_id;
  return v_job_id;
end;
$$;
create or replace function cron.alter_job(
  job_id bigint,
  schedule text default null,
  command text default null,
  database text default null,
  username text default null,
  active boolean default null
)
returns void
language sql
as $$
  update cron.job
     set schedule = coalesce($2, cron.job.schedule),
         command = coalesce($3, cron.job.command),
         active = coalesce($6, cron.job.active)
   where jobid = $1
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(path text)
returns text[]
language sql
immutable
as $$ select string_to_array(path, '/') $$;

create schema if not exists extensions;
create or replace function extensions.digest(value text, algorithm text)
returns bytea
language sql
immutable
as $$
  select case when lower(algorithm) = 'sha256'
    then sha256(convert_to(value, 'UTF8'))
    else convert_to(md5(value || algorithm), 'UTF8') end
$$;
`;

function withoutUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "")
    .replace(/^create extension if not exists pg_cron with schema pg_catalog;\s*$/gim, "")
    .replace(/^create extension if not exists pg_net with schema extensions;\s*$/gim, "");
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(supabaseCompatibilityLayer);
  const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
  const names = (await readdir(migrationUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(names.includes(LAZADA_ADOPTION_MIGRATION));
  for (const name of names) {
    if (OUT_OF_SCOPE_COMPETITOR_MIGRATIONS.has(name)) continue;
    const sql = await readFile(new URL(name, migrationUrl), "utf8");
    await db.exec(withoutUnavailableExtensions(sql));
  }
  return db;
}

async function createDatabaseInProductionAdoptionOrder() {
  const db = new PGlite();
  await db.exec(supabaseCompatibilityLayer);
  const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
  const names = (await readdir(migrationUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const deferred = new Set([
    SHOPEE_ADOPTION_MIGRATION,
    ADOPTION_COMPLETION_MERGE_MIGRATION,
    TEMU_EXISTING_ADOPTION_MIGRATION,
    TEMU_CREDENTIAL_CERTIFICATION_MIGRATION,
  ]);
  for (const name of names) {
    if (OUT_OF_SCOPE_COMPETITOR_MIGRATIONS.has(name) || deferred.has(name)) continue;
    const sql = await readFile(new URL(name, migrationUrl), "utf8");
    await db.exec(withoutUnavailableExtensions(sql));
  }
  for (const name of [
    SHOPEE_ADOPTION_MIGRATION,
    ADOPTION_COMPLETION_MERGE_MIGRATION,
    TEMU_EXISTING_ADOPTION_MIGRATION,
    TEMU_CREDENTIAL_CERTIFICATION_MIGRATION,
  ]) {
    const sql = await readFile(new URL(name, migrationUrl), "utf8");
    await db.exec(withoutUnavailableExtensions(sql));
  }
  return db;
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function scalarAsRole(db, role, sql, params = []) {
  if (!["anon", "authenticated", "service_role"].includes(role)) {
    throw new Error(`unsupported test role: ${role}`);
  }
  await db.exec(`set role ${role}`);
  try {
    return await scalar(db, sql, params);
  } finally {
    await db.exec("reset role");
  }
}

async function setClaims(db, role = "service_role", userId = ADMIN_ID) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
}

function uuid(index) {
  return `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function providerSubject(channel, suffix) {
  if (channel === "shopee") return `shopee:shop:${100000 + suffix}`;
  if (channel === "lazada") return `lazada:v1:${"A".repeat(54)}${suffix}`;
  if (channel === "ebay") return `ebay:eias:TEST-EIAS-${suffix}-ACCOUNT-PROOF`;
  return null;
}

function currentSecret(channel, suffix, subject = providerSubject(channel, suffix)) {
  if (channel === "qoo10") return { certification_key: `static-key-${suffix}` };
  return {
    access_token: `access-token-${suffix}`,
    refresh_token: `refresh-token-${suffix}`,
    provider_account_identity_version: "v1",
    provider_account_subject: subject,
    ...(channel === "shopee" ? {
      partner_id: "123456",
      partner_key: "0123456789abcdef",
      shop_id: String(100000 + suffix),
    } : {}),
    ...(channel === "lazada" ? { app_key: "app", app_secret: "secret" } : {}),
    ...(channel === "ebay" ? { client_id: "client", client_secret: "secret" } : {}),
  };
}

async function insertCredential(db, {
  id,
  channel,
  version,
  status,
  secret,
}) {
  const vaultId = await scalar(
    db,
    "select vault.create_secret($1, $2, 'test-only provider lineage fixture')",
    [JSON.stringify(secret), `lineage-${channel}-${version}-${id}`],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials(
       id, channel, environment, version, vault_secret_id, fingerprint,
       status, expires_at, created_by
     ) values ($1,$2,'production',$3,$4,$5,$6,now() + interval '30 days',$7)`,
    [id, channel, version, vaultId, `FP${String(version).padStart(10, "0")}`, status, ADMIN_ID],
  );
  return id;
}

async function seedListing(db, {
  index,
  channel,
  market = "US",
  targetId = "",
  marketplaceSku = null,
  includeTarget = true,
  currentSubject,
  listingId: requestedListingId,
  productId: requestedProductId,
  productSku,
  remoteId: requestedRemoteId,
  attemptRemoteId: requestedAttemptRemoteId,
  targetLocale = "en-US",
  targetLanguage = "English",
  targetCurrency = "USD",
}) {
  const historicalCredentialId = uuid(1000 + (index * 10));
  const currentCredentialId = uuid(1001 + (index * 10));
  const attemptId = uuid(2000 + index);
  const productId = requestedProductId ?? uuid(3000 + index);
  const listingId = requestedListingId ?? uuid(4000 + index);
  const remoteId = requestedRemoteId ?? `REMOTE-${channel.toUpperCase()}-${index}`;

  await insertCredential(db, {
    id: historicalCredentialId,
    channel,
    version: (index * 2) - 1,
    status: "grace",
    secret: channel === "qoo10"
      ? { certification_key: `historical-${index}` }
      : { access_token: `legacy-${index}` },
  });
  await insertCredential(db, {
    id: currentCredentialId,
    channel,
    version: index * 2,
    status: "active",
    secret: currentSecret(channel, index, currentSubject),
  });

  await db.query(
    `insert into sellerpilot_private.products(
       id, owner_id, external_code, sku, name, status, demo
     ) values ($1,$2,$3,$4,$5,'active',false)`,
    [productId, ADMIN_ID, `EXT-${index}`, productSku ?? `SKU-${index}`, `Lineage product ${index}`],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
       id, owner_id, credential_id, channel, operation, idempotency_key,
       request_fingerprint, status, remote_id, completed_at
     ) values ($1,$2,$3,$4,'listing.create',$5,$6,'succeeded',$7,now())`,
    [
      attemptId,
      ADMIN_ID,
      historicalCredentialId,
      channel,
      `legacy-listing-${index}`,
      String((index % 9) + 1).repeat(64),
      requestedAttemptRemoteId ?? remoteId,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings(
       id, owner_id, product_id, channel_key, remote_id, status,
       currency, price, operation_attempt_id, market, target_id,
       marketplace_sku, seller_account_key
     ) values ($1,$2,$3,$4,$5,'published','USD',10,$6,$7,$8,$9,null)`,
    [listingId, ADMIN_ID, productId, channel, remoteId, attemptId, market, targetId, marketplaceSku],
  );

  if (includeTarget && ["shopee", "lazada"].includes(channel)) {
    await db.query(
      `insert into sellerpilot_private.channel_market_targets(
         owner_id, credential_id, channel, environment, target_id,
         display_name, market_code, locale, language, currency, remote_status
       ) values ($1,$2,$3,'production',$4,'Verified target',$5,$6,$7,$8,'ACTIVE')`,
      [
        ADMIN_ID,
        currentCredentialId,
        channel,
        targetId,
        market,
        targetLocale,
        targetLanguage,
        targetCurrency,
      ],
    );
  }

  const sellerAccountKey = await scalar(
    db,
    "select seller_account_key from sellerpilot_private.channel_credentials where id = $1",
    [currentCredentialId],
  );
  return {
    listingId,
    attemptId,
    currentCredentialId,
    historicalCredentialId,
    sellerAccountKey,
    channel,
    market,
    targetId,
    remoteId,
    marketplaceSku,
    productId,
  };
}

async function prepare(db, listingId) {
  return scalar(
    db,
    "select public.sellerpilot_service_prepare_listing_lineage_verification($1)",
    [listingId],
  );
}

async function enqueue(db, listing) {
  return scalar(
    db,
    "select public.sellerpilot_service_enqueue_listing_lineage_verification($1,$2)",
    [listing.listingId, listing.currentCredentialId],
  );
}

async function claim(db) {
  return scalar(
    db,
    "select public.sellerpilot_claim_serverless_gateway_job($1, 'lineage-test/1.0')",
    [TOKEN_HASH],
  );
}

function successEvidence(listing, extra = {}) {
  return {
    ok: true,
    channel: listing.channel,
    operation: "listing.lineage.verify",
    evidenceVersion: "provider_listing_readback_v1",
    expectedRemoteId: listing.remoteId,
    verifiedRemoteId: listing.remoteId,
    market: listing.market,
    targetId: listing.targetId,
    verification: "exact_provider_readback",
    ...extra,
  };
}

async function complete(db, claimValue, status, payload = null) {
  return scalar(
    db,
    `select public.sellerpilot_complete_listing_lineage_verification(
      $1,$2,$3,$4,$5::jsonb,null
    )`,
    [
      TOKEN_HASH,
      claimValue.id,
      claimValue.claim_token,
      status,
      payload === null ? null : JSON.stringify(payload),
    ],
  );
}

async function completeAsService(db, claimValue, status, payload = null) {
  return scalarAsRole(
    db,
    "service_role",
    `select public.sellerpilot_complete_listing_lineage_verification(
      $1,$2,$3,$4,$5::jsonb,null
    )`,
    [
      TOKEN_HASH,
      claimValue.id,
      claimValue.claim_token,
      status,
      payload === null ? null : JSON.stringify(payload),
    ],
  );
}

test("provider readback rebind is exact, immutable, atomic, and serialized", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into auth.users(id,email) values($1,'lineage@example.test')", [ADMIN_ID]);
    await db.query(
      "insert into sellerpilot_private.admin_users(user_id,display_name) values($1,'Lineage Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens(
         id,label,token_hash,fingerprint,scope,status,expires_at,created_by
       ) values($1,'Lineage worker',$2,'ABCDEF000001','serverless_cs','active',now() + interval '1 day',$3)`,
      [TOKEN_ID, TOKEN_HASH, ADMIN_ID],
    );

    for (const signature of [
      "public.sellerpilot_service_prepare_listing_lineage_verification(uuid)",
      "public.sellerpilot_service_enqueue_listing_lineage_verification(uuid,uuid)",
      "public.sellerpilot_service_prepare_exact_lazada_live_adoption(uuid)",
      "public.sellerpilot_service_enqueue_exact_lazada_live_adoption(uuid,uuid)",
      "public.sellerpilot_complete_listing_lineage_verification(text,uuid,uuid,text,jsonb,text)",
    ]) {
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege('authenticated',$1,'EXECUTE')",
          [signature],
        ),
        false,
      );
      assert.equal(
        await scalar(db, "select has_function_privilege('anon',$1,'EXECUTE')", [signature]),
        false,
      );
    }
    assert.equal(
      await scalar(
        db,
        `select has_function_privilege(
          'service_role','public.sellerpilot_11840_claim_gateway_unsafe(text,text)','EXECUTE'
        )`,
      ),
      false,
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          db,
          `select has_function_privilege(
            $1,'sellerpilot_private.failed_ebay_lineage_discovery_allowed(uuid)','EXECUTE'
          )`,
          [role],
        ),
        false,
        `${role} must not call the private failed-listing exception directly`,
      );
      assert.equal(
        await scalar(
          db,
          `select has_function_privilege(
            $1,
            'sellerpilot_private.exact_lazada_live_adoption_allowed(uuid,text,jsonb)',
            'EXECUTE'
          )`,
          [role],
        ),
        false,
        `${role} must not call the private exact Lazada adoption predicate directly`,
      );
    }
    assert.equal(
      await scalar(
        db,
        `select has_table_privilege(
          'service_role',
          'sellerpilot_private.provider_listing_lineage_attestations',
          'INSERT'
        )`,
      ),
      false,
    );

    await setClaims(db, "");
    await assert.rejects(
      scalarAsRole(
        db,
        "authenticated",
        "select public.sellerpilot_service_prepare_listing_lineage_verification($1)",
        [uuid(9999)],
      ),
      /permission denied for function sellerpilot_service_prepare_listing_lineage_verification/,
    );

    const qoo10 = await seedListing(db, { index: 1, channel: "qoo10", market: "JP" });
    const qoo10Prepare = await scalarAsRole(
      db,
      "service_role",
      "select public.sellerpilot_service_prepare_listing_lineage_verification($1)",
      [qoo10.listingId],
    );
    assert.equal(qoo10Prepare.status, "ready");
    assert.equal(qoo10Prepare.credential_id, qoo10.currentCredentialId);
    const qoo10Enqueue = await scalarAsRole(
      db,
      "service_role",
      "select public.sellerpilot_service_enqueue_listing_lineage_verification($1,$2)",
      [qoo10.listingId, qoo10.currentCredentialId],
    );
    await setClaims(db);
    assert.deepEqual(qoo10Enqueue, {
      status: "queued",
      job_id: qoo10Enqueue.job_id,
      listing_id: qoo10.listingId,
      reused: false,
    });
    const duplicate = await enqueue(db, qoo10);
    assert.equal(duplicate.job_id, qoo10Enqueue.job_id);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.status, "queued");

    const racing = await Promise.allSettled([
      db.query(
        `insert into sellerpilot_private.channel_gateway_jobs(
           id,credential_id,listing_id,channel,operation,environment,
           request_payload,status,created_by,seller_account_key
         ) values($1,$2,$3,'qoo10','listing.lineage.verify','production',
           '{"sellerpilotLineageVersion":"provider_listing_readback_v1","arguments":{"expectedRemoteId":"forged","market":"JP","targetId":""}}'::jsonb,
           'queued',$4,$5)`,
        [uuid(9001), qoo10.currentCredentialId, qoo10.listingId, ADMIN_ID, qoo10.sellerAccountKey],
      ),
      enqueue(db, qoo10),
    ]);
    assert.equal(racing.filter((item) => item.status === "rejected").length, 1);
    assert.equal(racing.filter((item) => item.status === "fulfilled").length, 1);

    const qoo10Claim = await claim(db);
    assert.equal(qoo10Claim.operation, "listing.lineage.verify");
    assert.deepEqual(qoo10Claim.request, {
      sellerpilotLineageVersion: "provider_listing_readback_v1",
      arguments: {
        expectedRemoteId: qoo10.remoteId,
        market: "JP",
        targetId: "",
      },
    });

    await db.exec(`
      create function sellerpilot_private.test_abort_lineage_audit()
      returns trigger language plpgsql as $$
      begin
        if new.action = 'listing_lineage_provider_verified' then
          raise exception 'test rollback';
        end if;
        return new;
      end;
      $$;
      create trigger test_abort_lineage_audit
      before insert on sellerpilot_private.operation_audit
      for each row execute function sellerpilot_private.test_abort_lineage_audit();
    `);
    await assert.rejects(
      complete(db, qoo10Claim, "succeeded", successEvidence(qoo10)),
      /test rollback/,
    );
    assert.equal(
      await scalar(db, "select seller_account_key from sellerpilot_private.product_listings where id=$1", [qoo10.listingId]),
      null,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.provider_listing_lineage_attestations where listing_id=$1", [qoo10.listingId]),
      0,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [qoo10Claim.id]),
      "running",
    );
    await db.exec("drop trigger test_abort_lineage_audit on sellerpilot_private.operation_audit; drop function sellerpilot_private.test_abort_lineage_audit();");

    await setClaims(db, "");
    const qoo10Bound = await completeAsService(
      db,
      qoo10Claim,
      "succeeded",
      successEvidence(qoo10),
    );
    await setClaims(db);
    assert.equal(qoo10Bound.status, "bound");
    assert.equal(
      await scalar(db, "select seller_account_key from sellerpilot_private.product_listings where id=$1", [qoo10.listingId]),
      qoo10.sellerAccountKey,
    );
    const qoo10Attestation = (await db.query(
      `select channel,environment,expected_remote_id,verified_remote_id,
              marketplace_sku,provider_resource_id,evidence_version
         from sellerpilot_private.provider_listing_lineage_attestations
        where listing_id=$1`,
      [qoo10.listingId],
    )).rows[0];
    assert.deepEqual(qoo10Attestation, {
      channel: "qoo10",
      environment: "production",
      expected_remote_id: qoo10.remoteId,
      verified_remote_id: qoo10.remoteId,
      marketplace_sku: null,
      provider_resource_id: null,
      evidence_version: "provider_listing_readback_v1",
    });
    assert.equal((await complete(db, qoo10Claim, "succeeded", successEvidence(qoo10))).reused, true);
    await assert.rejects(
      db.query(
        `insert into sellerpilot_private.provider_listing_lineage_attestations(
           listing_id,credential_id,gateway_job_id,seller_account_key,
           channel,environment,expected_remote_id,verified_remote_id,
           market,target_id,evidence_version,evidence_digest,
           completion_claim_token_hash,verified_at
         ) values($1,$2,$3,$4,'qoo10','production',$5,$5,'JP','',
           'provider_listing_readback_v1',$6,$7,now())`,
        [
          qoo10.listingId,
          qoo10.currentCredentialId,
          qoo10Claim.id,
          qoo10.sellerAccountKey,
          qoo10.remoteId,
          "a".repeat(64),
          "b".repeat(64),
        ],
      ),
      /requires verified completion/,
    );

    const lazada = await seedListing(db, {
      index: 2,
      channel: "lazada",
      market: "MY",
      targetId: "lazada-my",
    });
    assert.equal((await prepare(db, lazada.listingId)).status, "ready");
    await enqueue(db, lazada);
    const lazadaClaim = await claim(db);
    await assert.rejects(
      complete(db, lazadaClaim, "succeeded", {
        ...successEvidence(lazada),
        verifiedRemoteId: "FORGED-REMOTE",
      }),
      /evidence mismatch/,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [lazadaClaim.id]),
      "running",
    );
    assert.equal(await complete(db, lazadaClaim, "succeeded", successEvidence(lazada)).then((value) => value.status), "bound");
    await db.query(
      "update sellerpilot_private.channel_credentials set status='grace' where id=$1",
      [lazada.currentCredentialId],
    );

    const exactLazada = await seedListing(db, {
      index: 20,
      channel: "lazada",
      market: "MY",
      targetId: "200100300",
      listingId: "42021335-9793-4834-8cd5-b73169fd1f48",
      productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
      productSku: "QA-20260823-CC-001",
      remoteId: "14976038919",
      targetLocale: "ms-MY",
      targetLanguage: "Bahasa Melayu",
      targetCurrency: "MYR",
    });
    await db.query(
      `update sellerpilot_private.product_listings
          set status='failed', failure_class='external_action',
              requested_publication_intent='live',
              remote_visibility='unknown', provider_status=null,
              published_at=null
        where id=$1`,
      [exactLazada.listingId],
    );
    const exactPreparation = await scalar(
      db,
      "select public.sellerpilot_service_prepare_exact_lazada_live_adoption($1)",
      [exactLazada.listingId],
    );
    assert.deepEqual(exactPreparation, {
      status: "ready",
      listing_id: exactLazada.listingId,
      credential_id: exactLazada.currentCredentialId,
      channel: "lazada",
      market: "MY",
      target_id: exactLazada.targetId,
    });
    const exactEnqueued = await scalar(
      db,
      "select public.sellerpilot_service_enqueue_exact_lazada_live_adoption($1,$2)",
      [exactLazada.listingId, exactLazada.currentCredentialId],
    );
    assert.equal(exactEnqueued.status, "queued");
    const exactLazadaClaim = await claim(db);
    assert.equal(
      exactLazadaClaim.request.sellerpilotExactLazadaLiveAdoption,
      "exact_lazada_live_adoption_v1",
    );
    assert.deepEqual(exactLazadaClaim.request.arguments, {
      expectedRemoteId: "14976038919",
      market: "MY",
      targetId: exactLazada.targetId,
      country: "my",
      marketplaceSku: "QA-20260823-CC-001-MY",
    });
    const exactBound = await complete(
      db,
      exactLazadaClaim,
      "succeeded",
      successEvidence(exactLazada),
    );
    assert.equal(exactBound.status, "bound");
    const exactPostAdoption = (await db.query(
      `select status, failure_class, requested_publication_intent,
              remote_visibility, provider_status, published_at,
              seller_account_key
         from sellerpilot_private.product_listings
        where id=$1`,
      [exactLazada.listingId],
    )).rows[0];
    assert.equal(exactPostAdoption.status, "failed");
    assert.equal(exactPostAdoption.failure_class, "external_action");
    assert.equal(exactPostAdoption.requested_publication_intent, "live");
    assert.equal(exactPostAdoption.remote_visibility, "unknown");
    assert.equal(exactPostAdoption.provider_status, null);
    assert.equal(exactPostAdoption.published_at, null);
    assert.equal(exactPostAdoption.seller_account_key, exactLazada.sellerAccountKey);
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_validate_listing_write_lineage(
          $1,$2,$3,'lazada','listing.update','MY',$4
        )`,
        [
          exactLazada.listingId,
          exactLazada.currentCredentialId,
          exactLazada.productId,
          exactLazada.targetId,
        ],
      ),
      "allowed",
    );
    await db.query(
      "update sellerpilot_private.channel_credentials set status='grace' where id=$1",
      [exactLazada.currentCredentialId],
    );

    const ebay = await seedListing(db, {
      index: 3,
      channel: "ebay",
      market: "US",
      marketplaceSku: "EBAY-SKU-3",
    });
    await enqueue(db, ebay);
    const ebayClaim = await claim(db);
    assert.equal(ebayClaim.request.arguments.marketplaceSku, "EBAY-SKU-3");
    const ebayBound = await complete(db, ebayClaim, "succeeded", successEvidence(ebay, {
      marketplaceSku: "EBAY-SKU-3",
      providerResourceId: "OFFER-3",
    }));
    assert.equal(ebayBound.status, "bound");
    const ebayAttestation = (await db.query(
      `select marketplace_sku,provider_resource_id
         from sellerpilot_private.provider_listing_lineage_attestations
        where listing_id=$1`,
      [ebay.listingId],
    )).rows[0];
    assert.deepEqual(ebayAttestation, {
      marketplace_sku: "EBAY-SKU-3",
      provider_resource_id: "OFFER-3",
    });
    await assert.rejects(
      db.query(
        "update sellerpilot_private.provider_listing_lineage_attestations set provider_resource_id='FORGED' where listing_id=$1",
        [ebay.listingId],
      ),
      /attestation is immutable/,
    );
    await assert.rejects(
      db.query(
        "delete from sellerpilot_private.provider_listing_lineage_attestations where listing_id=$1",
        [ebay.listingId],
      ),
      /attestation is immutable/,
    );
    await db.query(
      "update sellerpilot_private.channel_credentials set status='grace' where id=$1",
      [ebay.currentCredentialId],
    );

    const ebayMissingSku = await seedListing(db, {
      index: 4,
      channel: "ebay",
      market: "US",
      targetId: "EBAY_US",
      marketplaceSku: null,
      listingId: "8b2cbfaf-3854-437d-b381-abfd70291354",
      remoteId: "800551945442",
    });
    await db.query(
      "update sellerpilot_private.product_listings set status='failed' where id=$1",
      [ebayMissingSku.listingId],
    );
    assert.deepEqual((await db.query(
      `select id::text,remote_id,status,requested_publication_intent,
              market,target_id,marketplace_sku,seller_account_key,
              provider_resource_id,remote_resources
         from sellerpilot_private.product_listings where id=$1`,
      [ebayMissingSku.listingId],
    )).rows, [{
      id: "8b2cbfaf-3854-437d-b381-abfd70291354",
      remote_id: "800551945442",
      status: "failed",
      requested_publication_intent: "safe_test",
      market: "US",
      target_id: "EBAY_US",
      marketplace_sku: null,
      seller_account_key: null,
      provider_resource_id: null,
      remote_resources: {},
    }]);
    assert.equal((await prepare(db, ebayMissingSku.listingId)).reason, "listing_not_verifiable");
    await db.query(
      "update sellerpilot_private.product_listings set requested_publication_intent='live' where id=$1",
      [ebayMissingSku.listingId],
    );
    assert.deepEqual((await db.query(
      `select id::text,remote_id,status,requested_publication_intent,
              market,target_id,marketplace_sku,seller_account_key,
              provider_resource_id,remote_resources
         from sellerpilot_private.product_listings where id=$1`,
      [ebayMissingSku.listingId],
    )).rows, [{
      id: "8b2cbfaf-3854-437d-b381-abfd70291354",
      remote_id: "800551945442",
      status: "failed",
      requested_publication_intent: "live",
      market: "US",
      target_id: "EBAY_US",
      marketplace_sku: null,
      seller_account_key: null,
      provider_resource_id: null,
      remote_resources: {},
    }]);
    assert.equal((await prepare(db, ebayMissingSku.listingId)).status, "ready");
    await assert.rejects(
      db.query(
        "update sellerpilot_private.product_listings set seller_account_key=$1 where id=$2",
        [ebayMissingSku.sellerAccountKey, ebayMissingSku.listingId],
      ),
      /(?:verified listing create completion|required|exact terminal listing gateway job)/,
    );
    const ebayRecoveredEnqueue = await enqueue(db, ebayMissingSku);
    assert.equal(ebayRecoveredEnqueue.status, "queued");
    const ebayRecoveredClaim = await claim(db);
    assert.equal(ebayRecoveredClaim.request.arguments.discoveryMode, "ebay_listing_id_v1");
    assert.equal(ebayRecoveredClaim.request.arguments.marketplaceSku, undefined);
    assert.equal(ebayRecoveredClaim.request.arguments.providerResourceId, undefined);
    await assert.rejects(
      complete(db, ebayRecoveredClaim, "succeeded", successEvidence(ebayMissingSku, {
        marketplaceSku: "EBAY-RECOVERED-4",
        providerResourceId: "",
      })),
      /normalized ebay provider listing evidence mismatch/,
    );
    assert.equal(
      await scalar(db, "select provider_resource_id from sellerpilot_private.product_listings where id=$1", [ebayMissingSku.listingId]),
      null,
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set remote_resources=jsonb_build_object('resources',jsonb_build_object(
            'offerId','STALE-OFFER','listingId',remote_id,'sku','STALE-SKU',
            'marketplaceId',target_id
          ))
        where id=$1`,
      [ebayMissingSku.listingId],
    );
    await assert.rejects(
      complete(db, ebayRecoveredClaim, "succeeded", successEvidence(ebayMissingSku, {
        marketplaceSku: "EBAY-RECOVERED-4",
        providerResourceId: "OFFER-4",
      })),
      /verified ebay remote resources must preserve immutable identity/,
    );
    await db.query(
      "update sellerpilot_private.product_listings set remote_resources='{}'::jsonb where id=$1",
      [ebayMissingSku.listingId],
    );
    assert.equal((await complete(db, ebayRecoveredClaim, "succeeded", successEvidence(ebayMissingSku, {
      marketplaceSku: "EBAY-RECOVERED-4",
      providerResourceId: "OFFER-4",
    }))).status, "bound");
    assert.equal(
      await scalar(db, "select marketplace_sku from sellerpilot_private.product_listings where id=$1", [ebayMissingSku.listingId]),
      "EBAY-RECOVERED-4",
    );
    assert.equal(
      await scalar(db, "select provider_resource_id from sellerpilot_private.product_listings where id=$1", [ebayMissingSku.listingId]),
      "OFFER-4",
    );
    assert.equal(
      await scalar(db, "select seller_account_key from sellerpilot_private.product_listings where id=$1", [ebayMissingSku.listingId]),
      ebayMissingSku.sellerAccountKey,
    );
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_get_ebay_listing_update_identity($1,$2,$3,$4,$5)",
        [
          ebayMissingSku.listingId,
          ebayMissingSku.currentCredentialId,
          uuid(3004),
          "US",
          "EBAY_US",
        ],
      ),
      {
        status: "allowed",
        contract: "ebay_listing_identity_v1",
        offerId: "OFFER-4",
        sku: "EBAY-RECOVERED-4",
        listingId: ebayMissingSku.remoteId,
        marketplaceId: "EBAY_US",
      },
    );
    for (const [credentialId, targetId] of [
      [ebayMissingSku.historicalCredentialId, "EBAY_US"],
      [ebayMissingSku.currentCredentialId, "EBAY_GB"],
    ]) {
      assert.deepEqual(
        await scalar(
          db,
          "select public.sellerpilot_service_get_ebay_listing_update_identity($1,$2,$3,$4,$5)",
          [ebayMissingSku.listingId, credentialId, uuid(3004), "US", targetId],
        ),
        { status: "identity_unverified" },
        "a different credential lineage or marketplace must not resolve the tuple",
      );
    }
    await assert.rejects(
      db.query(
        "update sellerpilot_private.product_listings set provider_resource_id='FORGED' where id=$1",
        [ebayMissingSku.listingId],
      ),
      /immutable ebay listing identity cannot change/,
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.product_listings
            set remote_resources=jsonb_build_object('resources',jsonb_build_object(
              'offerId','OTHER','listingId',remote_id,'sku',marketplace_sku,
              'marketplaceId',target_id
            ))
          where id=$1`,
        [ebayMissingSku.listingId],
      ),
      /verified ebay remote resources must preserve immutable identity/,
    );
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_get_ebay_listing_update_identity($1,$2,$3,$4,$5)",
        [
          ebayMissingSku.listingId,
          ebayMissingSku.currentCredentialId,
          uuid(3999),
          "US",
          "EBAY_US",
        ],
      ),
      { status: "identity_unverified" },
    );
    await db.query(
      "update sellerpilot_private.channel_credentials set status='grace' where id=$1",
      [ebayMissingSku.currentCredentialId],
    );

    const failedEbayWrongCreateEvidence = await seedListing(db, {
      index: 10,
      channel: "ebay",
      market: "US",
      targetId: "EBAY_US",
      marketplaceSku: null,
      remoteId: "800551945443",
      attemptRemoteId: "800551945440",
    });
    await db.query(
      `update sellerpilot_private.product_listings
          set status='failed',requested_publication_intent='live'
        where id=$1`,
      [failedEbayWrongCreateEvidence.listingId],
    );
    assert.equal(
      (await prepare(db, failedEbayWrongCreateEvidence.listingId)).reason,
      "listing_not_verifiable",
    );
    await db.query(
      "update sellerpilot_private.channel_credentials set status='grace' where id=$1",
      [failedEbayWrongCreateEvidence.currentCredentialId],
    );

    const failedShopee = await seedListing(db, {
      index: 9,
      channel: "shopee",
      market: "SG",
      targetId: "100009",
    });
    await db.query(
      `update sellerpilot_private.product_listings
          set status='failed',requested_publication_intent='live'
        where id=$1`,
      [failedShopee.listingId],
    );
    assert.equal((await prepare(db, failedShopee.listingId)).reason, "listing_not_verifiable");
    await db.query(
      "update sellerpilot_private.channel_credentials set status='grace' where id=$1",
      [failedShopee.currentCredentialId],
    );

    const shopeeMissingTarget = await seedListing(db, {
      index: 5,
      channel: "shopee",
      market: "SG",
      targetId: "100005",
      includeTarget: false,
    });
    assert.equal((await prepare(db, shopeeMissingTarget.listingId)).reason, "credential_target_mismatch");
    await db.query(
      "update sellerpilot_private.channel_credentials set status='grace' where id=$1",
      [shopeeMissingTarget.currentCredentialId],
    );

    // Shopee provider reads are deliberately handed off to the attested
    // serverless fixed-egress claimant. Model that released runtime contract
    // here instead of letting this legacy fixture bypass the handoff through
    // the generic gateway claimant.
    await db.query(
      "update sellerpilot_private.serverless_static_egress_policy set enabled=true where channel='shopee'",
    );
    await db.query(
      "select set_config('request.headers', $1, false)",
      [JSON.stringify({ "x-sellerpilot-static-egress-channels": "shopee" })],
    );

    const shopeeRetry = await seedListing(db, {
      index: 6,
      channel: "shopee",
      market: "SG",
      targetId: "100006",
    });
    await enqueue(db, shopeeRetry);
    const retryClaim = await claim(db);
    const retryResult = await complete(db, retryClaim, "retryable");
    assert.equal(retryResult.status, "queued");
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.provider_listing_lineage_attestations where listing_id=$1", [shopeeRetry.listingId]),
      0,
    );
    const retryClaimTwo = await claim(db);
    assert.equal(retryClaimTwo.id, retryClaim.id);
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_complete_channel_gateway_job(
          $1,$2,$3,'failed',null,'generic completion must be fenced'
        )`,
        [TOKEN_HASH, retryClaimTwo.id, retryClaimTwo.claim_token],
      ),
      /dedicated lineage verification completion required/,
    );
    const manualResult = await complete(db, retryClaimTwo, "failed", {
      ok: false,
      channel: "shopee",
      operation: "listing.lineage.verify",
      evidenceVersion: "provider_listing_readback_v1",
      reason: "provider_not_found",
    });
    assert.equal(manualResult.status, "manual_required");
    assert.equal(
      await scalar(db, "select seller_account_key from sellerpilot_private.product_listings where id=$1", [shopeeRetry.listingId]),
      null,
    );
    await db.query(
      "update sellerpilot_private.channel_credentials set status='grace' where id=$1",
      [shopeeRetry.currentCredentialId],
    );

    const shopeePrepared = await seedListing(db, {
      index: 7,
      channel: "shopee",
      market: "SG",
      targetId: "100007",
    });
    await enqueue(db, shopeePrepared);
    const preparedClaim = await claim(db);
    const refreshedCredentialId = uuid(1072);
    const wrongCredentialId = uuid(1073);
    await insertCredential(db, {
      id: wrongCredentialId,
      channel: "shopee",
      version: 16,
      status: "grace",
      secret: currentSecret("shopee", 17),
    });
    await assert.rejects(
      db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set credential_id=$1,prepared_credential_id=$1,
                credential_refresh_fingerprint=$2,
                credential_refresh_prepared_at=now()
          where id=$3`,
        [wrongCredentialId, "6".repeat(64), preparedClaim.id],
      ),
      /(?:seller account reassignment blocked|credential refresh mismatch)/,
    );
    await db.query(
      "update sellerpilot_private.channel_credentials set status='grace' where id=$1",
      [shopeePrepared.currentCredentialId],
    );
    await insertCredential(db, {
      id: refreshedCredentialId,
      channel: "shopee",
      version: 15,
      status: "active",
      secret: currentSecret("shopee", 7),
    });
    await db.query(
      `update sellerpilot_private.channel_market_targets
          set credential_id=$1,verified_at=now(),updated_at=now()
        where owner_id=$2 and channel='shopee' and environment='production'
          and market_code='SG' and target_id='100007'`,
      [refreshedCredentialId, ADMIN_ID],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set credential_id=$1,prepared_credential_id=$1,
              credential_refresh_fingerprint=$2,
              credential_refresh_prepared_at=now()
        where id=$3`,
      [refreshedCredentialId, "8".repeat(64), preparedClaim.id],
    );
    assert.equal(
      await scalar(db, "select seller_account_key from sellerpilot_private.channel_credentials where id=$1", [refreshedCredentialId]),
      shopeePrepared.sellerAccountKey,
    );
    assert.equal(
      (await complete(db, preparedClaim, "succeeded", successEvidence(shopeePrepared))).status,
      "bound",
    );
    assert.equal(
      await scalar(db, "select credential_id::text from sellerpilot_private.provider_listing_lineage_attestations where listing_id=$1", [shopeePrepared.listingId]),
      refreshedCredentialId,
    );

    const lazadaRefreshUnknown = await seedListing(db, {
      index: 8,
      channel: "lazada",
      market: "MY",
      targetId: "lazada-my-8",
    });
    await enqueue(db, lazadaRefreshUnknown);
    const uncertainClaim = await claim(db);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set credential_refresh_in_flight=true,
              credential_refresh_started_at=now()
        where id=$1`,
      [uncertainClaim.id],
    );
    const uncertain = await complete(db, uncertainClaim, "retryable");
    assert.equal(uncertain.status, "manual_required");
    assert.equal(uncertain.reason, "credential_refresh_reconciliation_required");
    assert.deepEqual((await db.query(
      `select status,credential_refresh_in_flight,
              credential_refresh_started_at is not null as has_started
         from sellerpilot_private.channel_gateway_jobs where id=$1`,
      [uncertainClaim.id],
    )).rows, [{
      status: "reconciliation_required",
      credential_refresh_in_flight: true,
      has_started: true,
    }]);
    assert.deepEqual(await prepare(db, lazadaRefreshUnknown.listingId), {
      status: "manual_required",
      listing_id: lazadaRefreshUnknown.listingId,
      channel: "lazada",
      market: "MY",
      reason: "verification_job_conflict",
    });
    assert.equal((await enqueue(db, lazadaRefreshUnknown)).status, "manual_required");
  } finally {
    await db.close();
  }
});

test("production Lazada-then-Shopee order converges without replacing the independent credential guard", async () => {
  const db = await createDatabaseInProductionAdoptionOrder();
  try {
    const publicCompletion = await scalar(
      db,
      `select pg_catalog.pg_get_functiondef(
        'public.sellerpilot_complete_listing_lineage_verification(text,uuid,uuid,text,jsonb,text)'::regprocedure
      )`,
    );
    const predecessorCompletion = await scalar(
      db,
      `select pg_catalog.pg_get_functiondef(
        'public.sellerpilot_09011715_complete_lineage_before_shopee_adoption(text,uuid,uuid,text,jsonb,text)'::regprocedure
      )`,
    );
    const mergeMigration = await readFile(
      new URL(
        `../supabase/migrations/${ADOPTION_COMPLETION_MERGE_MIGRATION}`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(publicCompletion, /sellerpilot_shopee_sg_existing_adoption_v1/u);
    assert.match(publicCompletion, /53717126190/u);
    assert.match(
      publicCompletion,
      /sellerpilot_09011715_complete_lineage_before_shopee_adoption/u,
    );
    assert.match(
      predecessorCompletion,
      /exact_lazada_live_adoption_allowed/u,
    );
    assert.equal(
      (predecessorCompletion.match(/exact_lazada_live_adoption_allowed/g) ?? []).length,
      1,
    );
    assert.doesNotMatch(
      mergeMigration,
      /(?:create|replace)\s+function\s+sellerpilot_private\.guard_credential_seller_lineage/iu,
      "the completion merger must not replace the independent Temu credential guard",
    );
    assert.equal(
      await scalar(
        db,
        `select sellerpilot_private.exact_lazada_live_adoption_allowed(
          gen_random_uuid(), 'lazada',
          '{"sellerpilotExactLazadaLiveAdoption":"exact_lazada_live_adoption_v1","sellerpilotLineageVersion":"provider_listing_readback_v1","arguments":{"expectedRemoteId":"14976038919","market":"MY","country":"my","marketplaceSku":"QA-20260823-CC-001-MY","targetId":"200100300"}}'::jsonb
        )`,
      ),
      false,
      "the exact marker alone must never admit an unrelated listing",
    );
  } finally {
    await db.close();
  }
});
