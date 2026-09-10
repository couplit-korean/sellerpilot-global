import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260910020500_coupang_durable_create_reconciliation.sql",
  import.meta.url,
), "utf8");
const hardeningMigration = await readFile(new URL(
  "../supabase/migrations/20260910042000_complete_coupang_durable_create_reconciliation_r12.sql",
  import.meta.url,
), "utf8");
const backoffMigration = await readFile(new URL(
  "../supabase/migrations/20260910042500_coupang_create_reconciliation_backoff_r12.sql",
  import.meta.url,
), "utf8");

const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  credential: "20000000-0000-4000-8000-000000000001",
  attempt: "30000000-0000-4000-8000-000000000001",
  listing: "40000000-0000-4000-8000-000000000001",
  source: "50000000-0000-4000-8000-000000000001",
  token: "60000000-0000-4000-8000-000000000001",
  secret: "70000000-0000-4000-8000-000000000001",
  product: "90000000-0000-4000-8000-000000000001",
  otherOwner: "a0000000-0000-4000-8000-000000000001",
  officialSnapshot: "a1000000-0000-4000-8000-000000000001",
  transmission: "a2000000-0000-4000-8000-000000000001",
  providerSeal: "a3000000-0000-4000-8000-000000000001",
};
const tokenHash = "b".repeat(64);
const vendorId = "A00012345";
const priorResolvedId = "f0000000-0000-4000-8000-000000000001";

async function scalar(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0])[0];
}

async function setup() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema vault;
    create schema sellerpilot_private;

    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null,
      channel text not null,
      operation text not null,
      credential_id uuid,
      status text not null,
      remote_id text,
      http_status integer,
      safe_message text,
      completed_at timestamptz
    );
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null,
      status text not null default 'draft',
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      operation_attempt_id uuid,
      remote_id text,
      status text not null default 'failed',
      requested_publication_intent text not null default 'live',
      remote_visibility text not null default 'unknown',
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      published_at timestamptz,
      last_verified_at timestamptz,
      last_error text,
      failure_class text,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      seller_account_key text,
      seller_account_key_source text not null,
      version integer not null,
      fingerprint text not null,
      status text not null,
      expires_at timestamptz,
      vault_secret_id uuid not null
    );
    create table vault.decrypted_secrets (
      id uuid primary key,
      decrypted_secret text not null
    );
    create table sellerpilot_private.ai_cli_worker_tokens (
      id uuid primary key,
      token_hash text not null,
      status text not null,
      expires_at timestamptz not null
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      credential_id uuid,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null,
      request_fingerprint text,
      response_payload jsonb,
      status text not null,
      created_by uuid,
      seller_account_key text,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      provider_mutation_started_at timestamptz,
      worker_token_id uuid,
      claim_token uuid,
      lease_expires_at timestamptz,
      error_message text,
      completed_at timestamptz,
      attempt_count integer not null default 0,
      rate_not_before timestamptz
    );
    create table sellerpilot_private.operation_audit (
      owner_id uuid,
      action text not null,
      entity_type text not null,
      entity_id text,
      safe_detail jsonb not null
    );
    create table sellerpilot_private.coupang_create_official_source_snapshots (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      credential_id uuid not null,
      environment text not null,
      snapshot_digest_sha256 text not null,
      source_provider_body jsonb not null,
      credential_vault_secret_id uuid not null,
      credential_secret_sha256 text not null
    );
    create table sellerpilot_private.coupang_create_transmissions (
      id uuid primary key,
      source_snapshot_id uuid not null,
      owner_id uuid not null,
      product_id uuid not null,
      credential_id uuid not null,
      attempt_id uuid not null,
      source_snapshot_digest_sha256 text not null,
      transmission_body jsonb not null,
      transmission_body_sha256 text not null,
      transmission_digest_sha256 text not null
    );
    create table sellerpilot_private.coupang_create_provider_body_seals (
      id uuid primary key,
      transmission_id uuid not null,
      source_snapshot_id uuid not null,
      job_id uuid not null,
      listing_id uuid not null,
      attempt_id uuid not null,
      credential_id uuid not null,
      credential_vault_secret_id uuid not null,
      credential_secret_sha256 text not null,
      provider_body jsonb not null,
      provider_body_sha256 text not null
    );
    create function sellerpilot_private.coupang_create_official_sha256(p_value jsonb)
    returns text language sql immutable strict as $$
      select encode(extensions.digest(
        case
          when p_value = '{"vendor_id":"A00012345"}'::jsonb
            then '{"vendor_id":"A00012345"}'
          else p_value::text
        end,
        'sha256'
      ), 'hex')
    $$;

    create function sellerpilot_private.serverless_gateway_job_allowed(p_channel text, p_operation text)
    returns boolean language sql stable as $$
      select p_channel='qoo10' and p_operation='listing.lineage.verify'
    $$;
    create function sellerpilot_private.listing_mutation_reconciliation_resolved(p_job uuid)
    returns boolean language sql stable as $$
      select p_job='${priorResolvedId}'::uuid
    $$;
    create function public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer default 100)
    returns jsonb language sql security definer as $$
      select jsonb_build_object(
        'retried',2,'failed',3,'reconciliationRequired',4,
        'oauthCompleted',5,'total',5
      )
    $$;
    create function public.sellerpilot_claim_serverless_gateway_job(text,text)
    returns jsonb language sql security definer as $$
      select to_jsonb(job) from sellerpilot_private.channel_gateway_jobs job
       where job.status='queued'
         and coalesce(job.rate_not_before, '-infinity'::timestamptz) <= clock_timestamp()
       order by job.created_at, job.id limit 1
    $$;
  `);
  await db.exec(migration);
  await db.exec(hardeningMigration);
  await db.exec(backoffMigration);
  await db.query(
    "insert into vault.decrypted_secrets(id, decrypted_secret) values ($1, $2)",
    [ids.secret, JSON.stringify({ vendor_id: vendorId })],
  );
  await db.query(`insert into sellerpilot_private.channel_credentials(
      id, channel, environment, seller_account_key, seller_account_key_source,
      version, fingerprint, status, expires_at, vault_secret_id
    ) values ($2, 'coupang', 'production', 'seller-main', 'credential_incarnation_v1',
              7, 'credential-fingerprint-7', 'active',
              clock_timestamp() + interval '1 day', $1)`,
    [ids.secret, ids.credential],
  );
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens(id, token_hash, status, expires_at)
    values ($1, $2, 'active', clock_timestamp() + interval '1 day')`,
    [ids.token, tokenHash],
  );
  await db.query(`insert into sellerpilot_private.channel_operation_attempts(
      id, owner_id, channel, operation, credential_id, status
    ) values ($1, $2, 'coupang', 'listing.create', $3, 'manual_required')`,
    [ids.attempt, ids.owner, ids.credential],
  );
  await db.query(`insert into sellerpilot_private.products(id, owner_id, status)
    values ($1, $2, 'draft')`, [ids.product, ids.owner]);
  await db.query(`insert into sellerpilot_private.product_listings(
      id, owner_id, product_id, channel_key, operation_attempt_id,
      status, requested_publication_intent, failure_class
    ) values ($1, $2, $3, 'coupang', $4, 'failed', 'live', 'external_action')`,
    [ids.listing, ids.owner, ids.product, ids.attempt],
  );
  const sourceBody = {
    items: [
      { externalVendorSku: "SKU-ROOT-RED" },
      { externalVendorSku: "SKU-ROOT-BLUE" },
    ],
  };
  const credentialSecretSha256 = await scalar(db,
    `select sellerpilot_private.coupang_create_official_sha256($1::jsonb)`,
    [JSON.stringify({ vendor_id: vendorId })],
  );
  await db.query(`insert into sellerpilot_private.coupang_create_official_source_snapshots(
      id,owner_id,product_id,credential_id,environment,snapshot_digest_sha256,
      source_provider_body,credential_vault_secret_id,credential_secret_sha256
    ) values ($1,$2,$3,$4,'production',$5,$6::jsonb,$7,$8)`, [
    ids.officialSnapshot, ids.owner, ids.product, ids.credential, "d".repeat(64),
    JSON.stringify(sourceBody), ids.secret, credentialSecretSha256,
  ]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id, credential_id, attempt_id, listing_id, channel, operation,
      environment, request_payload, request_fingerprint, status, created_by, seller_account_key,
      provider_mutation_started_at
    ) values (
      $1, $2, $3, $4, 'coupang', 'listing.create', 'production',
      $5::jsonb, $6, 'running', $7, 'seller-main', null
    )`, [
    ids.source,
    ids.credential,
    ids.attempt,
    ids.listing,
    JSON.stringify({ arguments: {
      sellerpilotCoupangBaseSku: "SKU-ROOT",
      facts: {},
      body: sourceBody,
      sellerpilotCoupangCreateTransmission: {
        contract: "sellerpilot_coupang_create_transmission_v1",
        transmissionId: ids.transmission,
        attemptId: ids.attempt,
        sourceSnapshotId: ids.officialSnapshot,
        sourceSnapshotDigestSha256: "d".repeat(64),
        transmissionBodySha256: "e".repeat(64),
        transmissionDigestSha256: "f".repeat(64),
      },
      publicationStateContract: "verified_remote_state_v1",
      publicationIntent: "live",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: "c".repeat(64),
      publicationExpectedImageCount: 0,
    } }),
    "c".repeat(64),
    ids.owner,
  ]);
  const providerBody = { ...sourceBody, vendorId };
  const providerBodySha256 = await scalar(db,
    `select sellerpilot_private.coupang_create_official_sha256($1::jsonb)`,
    [JSON.stringify(providerBody)],
  );
  await db.query(`insert into sellerpilot_private.coupang_create_transmissions(
      id,source_snapshot_id,owner_id,product_id,credential_id,attempt_id,
      source_snapshot_digest_sha256,transmission_body,transmission_body_sha256,
      transmission_digest_sha256
    ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`, [
    ids.transmission, ids.officialSnapshot, ids.owner, ids.product, ids.credential,
    ids.attempt, "d".repeat(64), JSON.stringify(sourceBody), "e".repeat(64), "f".repeat(64),
  ]);
  await db.query(`insert into sellerpilot_private.coupang_create_provider_body_seals(
      id,transmission_id,source_snapshot_id,job_id,listing_id,attempt_id,credential_id,
      credential_vault_secret_id,credential_secret_sha256,provider_body,provider_body_sha256
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`, [
    ids.providerSeal, ids.transmission, ids.officialSnapshot, ids.source, ids.listing,
    ids.attempt, ids.credential, ids.secret, credentialSecretSha256,
    JSON.stringify(providerBody), providerBodySha256,
  ]);
  await db.query(`update sellerpilot_private.channel_gateway_jobs
    set status='reconciliation_required',provider_mutation_started_at=clock_timestamp()-interval '1 minute'
    where id=$1`, [ids.source]);
  return db;
}

async function enqueue(db) {
  return scalar(
    db,
    "select public.sellerpilot_service_enqueue_coupang_create_reconciliation($1)",
    [ids.source],
  );
}

async function claim(db, verifierJobId, attemptCount = 1) {
  const claimToken = "80000000-0000-4000-8000-000000000001";
  await db.query(`
    update sellerpilot_private.channel_gateway_jobs
       set status = 'running', worker_token_id = $1, claim_token = $2,
           lease_expires_at = clock_timestamp() + interval '5 minutes',
           attempt_count = $3
     where id = $4
  `, [ids.token, claimToken, attemptCount, verifierJobId]);
  return claimToken;
}

async function verifiedPayload(db, verifierJobId, { publication = true } = {}) {
  const args = await scalar(db, `
    select request_payload->'arguments'
      from sellerpilot_private.channel_gateway_jobs where id = $1
  `, [verifierJobId]);
  return {
    reconciliationContract: "coupang_durable_create_reconciliation_v1",
    sourceJobId: ids.source,
    sourceAttemptId: ids.attempt,
    listingId: ids.listing,
    sourceRequestSha256: args.sourceRequestSha256,
    expectedRemoteId: "987654321",
    verifiedRemoteId: "987654321",
    market: "KR",
    targetId: vendorId,
    vendorId,
    sellerSkus: ["SKU-ROOT-RED", "SKU-ROOT-BLUE"],
    sellerProductItemIds: ["3333", "3334"],
    itemBindings: [
      { sellerSku: "SKU-ROOT-RED", sellerProductItemId: "3333" },
      { sellerSku: "SKU-ROOT-BLUE", sellerProductItemId: "3334" },
    ],
    ...(publication ? {
      publicationStateContract: "verified_remote_state_v1",
      publicationIntent: "live",
      publicationFulfilled: true,
      remoteState: {
        verified: true,
        visibility: "live",
        providerStatus: "APPROVED|requested=true|onSale=true,true",
        verifiedAt: new Date().toISOString(),
        evidence: {
          identityVerified: true,
          statusVerified: true,
          localeVerified: true,
          fingerprintVerified: true,
          imageCountVerified: true,
        },
        resources: { sellerProductId: "987654321", vendorItemIds: ["9000", "9001"] },
        locale: "ko-KR",
        fingerprint: "c".repeat(64),
        imageCount: 0,
      },
    } : {}),
  };
}

test("enqueue is source-bound, deduplicated, and keeps the CREATE fenced", async () => {
  const db = await setup();
  try {
    assert.equal(await scalar(db,
      "select count(*)::int from sellerpilot_private.channel_gateway_jobs where operation='listing.lineage.verify'"
    ), 1, "source INSERT must enqueue the GET-only verifier transactionally");
    const first = await enqueue(db);
    const second = await enqueue(db);
    await db.exec(migration);
    await db.exec(hardeningMigration);
    const afterMigrationReplay = await enqueue(db);
    assert.equal(first.status, "queued");
    assert.equal(first.reused, true);
    assert.equal(second.verifier_job_id, first.verifier_job_id);
    assert.equal(second.reused, true);
    assert.equal(afterMigrationReplay.verifier_job_id, first.verifier_job_id);
    assert.equal(await scalar(db,
      "select count(*)::int from sellerpilot_private.channel_gateway_jobs where operation='listing.lineage.verify'"
    ), 1);
    assert.equal(await scalar(db,
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [ids.source]
    ), "reconciliation_required");
    assert.equal(await scalar(db,
      "select sellerpilot_private.serverless_gateway_job_allowed('coupang','listing.lineage.verify')"
    ), true);
    assert.equal(await scalar(db,
      "select sellerpilot_private.serverless_gateway_job_allowed('qoo10','listing.lineage.verify')"
    ), true);
    assert.equal(await scalar(db,
      "select sellerpilot_private.listing_mutation_reconciliation_resolved($1)",
      [priorResolvedId],
    ), true);
  } finally {
    await db.close();
  }
});

test("an identity-only legacy receipt cannot resolve the source mutation", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const sourceSha = await scalar(db, `select encode(extensions.digest(request_payload::text,'sha256'),'hex')
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [ids.source]);
    const secretSha = await scalar(db,
      `select sellerpilot_private.coupang_create_official_sha256(decrypted_secret::jsonb)
         from vault.decrypted_secrets where id=$1`, [ids.secret]);
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set status='succeeded',response_payload='{"identityOnly":true}'::jsonb
      where id=$1`, [queued.verifier_job_id]);
    const responseSha = await scalar(db, `select encode(extensions.digest(response_payload::text,'sha256'),'hex')
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [queued.verifier_job_id]);
    await db.query(`update sellerpilot_private.product_listings
      set remote_id='987654321',status='published',failure_class=null where id=$1`, [ids.listing]);
    await db.query(`update sellerpilot_private.channel_operation_attempts
      set status='succeeded',remote_id='987654321' where id=$1`, [ids.attempt]);
    await db.query(`insert into sellerpilot_private.coupang_create_reconciliation_receipts(
      source_job_id,verifier_job_id,source_attempt_id,listing_id,source_product_id,owner_id,
      credential_id,credential_version,credential_fingerprint,credential_vault_secret_id,
      credential_secret_sha256,official_source_snapshot_id,official_source_snapshot_digest_sha256,
      transmission_id,transmission_digest_sha256,provider_body_seal_id,provider_body_sha256,
      credential_seller_account_key_source,seller_account_key,source_request_sha256,
      verifier_response_sha256,vendor_id,seller_skus,seller_product_id,seller_product_item_ids,
      item_bindings,publication_state,internal_completion_recorded,provider_mutation_performed
    ) values ($1,$2,$3,$4,$5,$6,$7,7,'credential-fingerprint-7',$8,$9,$10,$11,
      $12,$13,$14,$15,'credential_incarnation_v1','seller-main',$16,$17,$18,$19::jsonb,
      '987654321',$20::jsonb,$21::jsonb,null,false,false)`, [
      ids.source, queued.verifier_job_id, ids.attempt, ids.listing, ids.product, ids.owner,
      ids.credential, ids.secret, secretSha, ids.officialSnapshot, "d".repeat(64),
      ids.transmission, "f".repeat(64), ids.providerSeal,
      await scalar(db, "select provider_body_sha256 from sellerpilot_private.coupang_create_provider_body_seals where id=$1", [ids.providerSeal]),
      sourceSha, responseSha, vendorId,
      JSON.stringify(["SKU-ROOT-RED", "SKU-ROOT-BLUE"]),
      JSON.stringify(["3333", "3334"]),
      JSON.stringify([
        { sellerSku: "SKU-ROOT-RED", sellerProductItemId: "3333" },
        { sellerSku: "SKU-ROOT-BLUE", sellerProductItemId: "3334" },
      ]),
    ]);
    assert.equal(await scalar(db,
      "select sellerpilot_private.listing_mutation_reconciliation_resolved($1)", [ids.source]
    ), false);
  } finally {
    await db.close();
  }
});

test("verified GET-only completion converges attempt, listing, product, and UI projection", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const claimToken = await claim(db, queued.verifier_job_id);
    const response = await verifiedPayload(db, queued.verifier_job_id);
    const completed = await scalar(db, `
      select public.sellerpilot_complete_coupang_create_reconciliation(
        $1, $2, $3, 'succeeded', $4::jsonb, null
      )
    `, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]);
    assert.equal(completed.status, "verified");
    assert.equal(completed.internal_completion_recorded, true);
    assert.equal(await scalar(db,
      "select remote_id from sellerpilot_private.product_listings where id=$1", [ids.listing]
    ), "987654321");
    assert.equal(await scalar(db,
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [ids.source]
    ), "reconciliation_required");
    assert.deepEqual((await db.query(
      "select status,http_status,remote_id from sellerpilot_private.channel_operation_attempts where id=$1",
      [ids.attempt],
    )).rows[0], { status: "succeeded", http_status: 200, remote_id: "987654321" });
    assert.deepEqual((await db.query(
      "select status,remote_visibility,failure_class,last_error from sellerpilot_private.product_listings where id=$1",
      [ids.listing],
    )).rows[0], {
      status: "published",
      remote_visibility: "live",
      failure_class: null,
      last_error: null,
    });
    assert.equal(await scalar(db,
      "select status from sellerpilot_private.products where id=$1", [ids.product]
    ), "active");
    assert.equal(await scalar(db,
      "select provider_mutation_performed from sellerpilot_private.coupang_create_reconciliation_receipts where source_job_id=$1",
      [ids.source],
    ), false);
    assert.equal(await scalar(db,
      "select internal_completion_recorded from sellerpilot_private.coupang_create_reconciliation_receipts where source_job_id=$1",
      [ids.source],
    ), true);
    assert.equal(await scalar(db,
      "select sellerpilot_private.listing_mutation_reconciliation_resolved($1)", [ids.source]
    ), true);
    await assert.rejects(
      db.query("delete from sellerpilot_private.coupang_create_reconciliation_receipts where source_job_id=$1", [ids.source]),
      /immutable/u,
    );
  } finally {
    await db.close();
  }
});

test("ambiguous and retryable verifier outcomes never release or rewrite the source CREATE", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    let claimToken = await claim(db, queued.verifier_job_id, 1);
    const retry = await scalar(db, `
      select public.sellerpilot_complete_coupang_create_reconciliation(
        $1, $2, $3, 'retryable', null, 'temporary read failure'
      )
    `, [tokenHash, queued.verifier_job_id, claimToken]);
    assert.equal(retry.status, "queued");
    claimToken = await claim(db, queued.verifier_job_id, 5);
    const failed = await scalar(db, `
      select public.sellerpilot_complete_coupang_create_reconciliation(
        $1, $2, $3, 'failed', null, 'ambiguous provider identity'
      )
    `, [tokenHash, queued.verifier_job_id, claimToken]);
    assert.equal(failed.status, "manual_required");
    assert.equal(await scalar(db,
      "select count(*)::int from sellerpilot_private.coupang_create_reconciliation_receipts"
    ), 0);
    assert.equal(await scalar(db,
      "select sellerpilot_private.listing_mutation_reconciliation_resolved($1)", [ids.source]
    ), false);
    assert.equal(await scalar(db,
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [ids.source]
    ), "reconciliation_required");
  } finally {
    await db.close();
  }
});

test("source request drift is rejected before a recovery receipt can be stored", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const claimToken = await claim(db, queued.verifier_job_id);
    const response = await verifiedPayload(db, queued.verifier_job_id);
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set request_payload = jsonb_set(request_payload, '{arguments,drift}', 'true')
       where id = $1
    `, [ids.source]);
    await assert.rejects(
      scalar(db, `
        select public.sellerpilot_complete_coupang_create_reconciliation(
          $1, $2, $3, 'succeeded', $4::jsonb, null
        )
      `, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]),
      /REQUEST_DRIFT/u,
    );
    assert.equal(await scalar(db,
      "select count(*)::int from sellerpilot_private.coupang_create_reconciliation_receipts"
    ), 0);
  } finally {
    await db.close();
  }
});

test("identity-only recovery queues publication readback without storing an immutable receipt", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const claimToken = await claim(db, queued.verifier_job_id);
    const response = await verifiedPayload(db, queued.verifier_job_id, { publication: false });
    const completed = await scalar(db, `
      select public.sellerpilot_complete_coupang_create_reconciliation(
        $1, $2, $3, 'succeeded', $4::jsonb, null
      )
    `, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]);
    assert.equal(completed.status, "queued");
    assert.equal(await scalar(db,
      "select count(*)::int from sellerpilot_private.coupang_create_reconciliation_receipts"
    ), 0);
    assert.deepEqual((await db.query(
      "select status,remote_id from sellerpilot_private.channel_operation_attempts where id=$1",
      [ids.attempt],
    )).rows[0], { status: "manual_required", remote_id: null });
    assert.deepEqual((await db.query(
      "select status,failure_class,remote_id from sellerpilot_private.product_listings where id=$1",
      [ids.listing],
    )).rows[0], {
      status: "failed",
      failure_class: "external_action",
      remote_id: null,
    });
    assert.equal(await scalar(db,
      "select sellerpilot_private.listing_mutation_reconciliation_resolved($1)", [ids.source]
    ), false);
  } finally {
    await db.close();
  }
});

test("pending publication queues another GET-only attempt without a receipt", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const claimToken = await claim(db, queued.verifier_job_id);
    const response = await verifiedPayload(db, queued.verifier_job_id);
    response.publicationFulfilled = false;
    response.remoteState.visibility = "pending_review";
    response.remoteState.providerStatus = "PENDING|requested=true|onSale=false,false";
    response.retryAfterSeconds = 180;
    const completed = await scalar(db, `select public.sellerpilot_complete_coupang_create_reconciliation(
      $1,$2,$3,'succeeded',$4::jsonb,null
    )`, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]);
    assert.equal(completed.status, "queued");
    assert.equal(completed.retry_after_seconds, 180);
    const deferred = await scalar(db, `select public.sellerpilot_claim_serverless_gateway_job(
      $1,$2
    )->>'id'`, [tokenHash, "coupang"]);
    assert.equal(deferred, null);
    const eligibility = (await db.query(`select rate_not_before > clock_timestamp() as future,
      extract(epoch from (rate_not_before-clock_timestamp()))::int as seconds
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [queued.verifier_job_id])).rows[0];
    assert.equal(eligibility.future, true);
    assert.ok(eligibility.seconds >= 178 && eligibility.seconds <= 180);

    // Advance the durable database eligibility timestamp without waiting in wall time.
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set rate_not_before=rate_not_before-interval '181 seconds' where id=$1`, [queued.verifier_job_id]);
    const eligible = await scalar(db, `select public.sellerpilot_claim_serverless_gateway_job(
      $1,$2
    )->>'id'`, [tokenHash, "coupang"]);
    assert.equal(eligible, queued.verifier_job_id);
    assert.equal(await scalar(db,
      "select count(*)::int from sellerpilot_private.coupang_create_reconciliation_receipts"
    ), 0);
    assert.equal(await scalar(db,
      "select sellerpilot_private.listing_mutation_reconciliation_resolved($1)", [ids.source]
    ), false);
  } finally {
    await db.close();
  }
});

test("retryable reconciliation uses bounded exponential eligibility when Retry-After is absent", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const claimToken = await claim(db, queued.verifier_job_id, 3);
    const completed = await scalar(db, `select public.sellerpilot_complete_coupang_create_reconciliation(
      $1,$2,$3,'retryable',null,'temporary provider read failure'
    )`, [tokenHash, queued.verifier_job_id, claimToken]);
    assert.equal(completed.status, "queued");
    assert.equal(completed.retry_after_seconds, 240);
    assert.equal(await scalar(db, `select count(*)::int from sellerpilot_private.channel_gateway_jobs
      where id=$1 and status='queued' and rate_not_before <= clock_timestamp()`, [queued.verifier_job_id]), 0);
    assert.equal(await scalar(db,
      "select sellerpilot_private.coupang_create_reconciliation_backoff_seconds(1,null)"), 60);
    assert.equal(await scalar(db,
      "select sellerpilot_private.coupang_create_reconciliation_backoff_seconds(5,null)"), 900);
    assert.equal(await scalar(db,
      "select sellerpilot_private.coupang_create_reconciliation_backoff_seconds(1,5)"), 60);
    assert.equal(await scalar(db,
      "select sellerpilot_private.coupang_create_reconciliation_backoff_seconds(1,7200)"), 3600);
  } finally {
    await db.close();
  }
});

test("completion rejects seller SKUs that differ from the immutable source body", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const claimToken = await claim(db, queued.verifier_job_id);
    const response = await verifiedPayload(db, queued.verifier_job_id);
    response.sellerSkus = ["WRONG-RED", "WRONG-BLUE"];
    response.itemBindings = [
      { sellerSku: "WRONG-RED", sellerProductItemId: "3333" },
      { sellerSku: "WRONG-BLUE", sellerProductItemId: "3334" },
    ];
    await assert.rejects(
      scalar(db, `select public.sellerpilot_complete_coupang_create_reconciliation(
        $1,$2,$3,'succeeded',$4::jsonb,null
      )`, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]),
      /RESPONSE_INVALID/u,
    );
    assert.equal(await scalar(db,
      "select count(*)::int from sellerpilot_private.coupang_create_reconciliation_receipts"
    ), 0);
  } finally {
    await db.close();
  }
});

test("completion rejects a same-id Vault secret replacement", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const claimToken = await claim(db, queued.verifier_job_id);
    const response = await verifiedPayload(db, queued.verifier_job_id);
    await db.query(
      "update vault.decrypted_secrets set decrypted_secret=$1 where id=$2",
      [JSON.stringify({ vendor_id: vendorId, secret_key: "rotated" }), ids.secret],
    );
    await assert.rejects(
      scalar(db, `select public.sellerpilot_complete_coupang_create_reconciliation(
        $1,$2,$3,'succeeded',$4::jsonb,null
      )`, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]),
      /CREDENTIAL_SECRET_DRIFT/u,
    );
    assert.equal(await scalar(db,
      "select count(*)::int from sellerpilot_private.coupang_create_reconciliation_receipts"
    ), 0);
  } finally {
    await db.close();
  }
});

test("attempt drift rolls back verifier, receipt, and listing completion atomically", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const claimToken = await claim(db, queued.verifier_job_id);
    const response = await verifiedPayload(db, queued.verifier_job_id);
    await db.query(
      "update sellerpilot_private.channel_operation_attempts set status='failed' where id=$1",
      [ids.attempt],
    );
    await assert.rejects(
      scalar(db, `select public.sellerpilot_complete_coupang_create_reconciliation(
        $1,$2,$3,'succeeded',$4::jsonb,null
      )`, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]),
      /ATTEMPT_DRIFT/u,
    );
    assert.equal(await scalar(db,
      "select count(*)::int from sellerpilot_private.coupang_create_reconciliation_receipts"
    ), 0);
    assert.equal(await scalar(db,
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [queued.verifier_job_id]
    ), "running");
    assert.equal(await scalar(db,
      "select remote_id from sellerpilot_private.product_listings where id=$1", [ids.listing]
    ), null);
  } finally {
    await db.close();
  }
});

test("credential incarnation changes fail closed before receipt storage", async () => {
  for (const mutation of [
    "update sellerpilot_private.channel_credentials set status='revoked' where id=$1",
    "update sellerpilot_private.channel_credentials set expires_at=clock_timestamp()-interval '1 second' where id=$1",
    "update sellerpilot_private.channel_credentials set version=8 where id=$1",
    "update sellerpilot_private.channel_credentials set fingerprint='rotated-fingerprint' where id=$1",
    "update sellerpilot_private.channel_credentials set vault_secret_id='71000000-0000-4000-8000-000000000001' where id=$1",
    "update sellerpilot_private.channel_credentials set environment='sandbox' where id=$1",
    "update sellerpilot_private.channel_credentials set seller_account_key='different-seller' where id=$1",
    "update sellerpilot_private.channel_credentials set seller_account_key_source='provider_certified_v1' where id=$1",
  ]) {
    const db = await setup();
    try {
      const queued = await enqueue(db);
      const claimToken = await claim(db, queued.verifier_job_id);
      const response = await verifiedPayload(db, queued.verifier_job_id);
      await db.query(mutation, [ids.credential]);
      await assert.rejects(
        scalar(db, `select public.sellerpilot_complete_coupang_create_reconciliation(
          $1,$2,$3,'succeeded',$4::jsonb,null
        )`, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]),
        /CREDENTIAL_DRIFT/u,
      );
      assert.equal(await scalar(db,
        "select count(*)::int from sellerpilot_private.coupang_create_reconciliation_receipts"
      ), 0);
    } finally {
      await db.close();
    }
  }
});

test("duplicate sellerProductItemIds are rejected by completion SQL", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    const claimToken = await claim(db, queued.verifier_job_id);
    const response = await verifiedPayload(db, queued.verifier_job_id);
    response.sellerProductItemIds = ["3333", "3333"];
    await assert.rejects(
      scalar(db, `select public.sellerpilot_complete_coupang_create_reconciliation(
        $1,$2,$3,'succeeded',$4::jsonb,null
      )`, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]),
      /IDENTITY_INVALID/u,
    );
  } finally {
    await db.close();
  }
});

test("wrong owner and product lineage are rejected", async () => {
  {
    const db = await setup();
    try {
      await db.query(
        "update sellerpilot_private.channel_operation_attempts set owner_id=$1 where id=$2",
        [ids.otherOwner, ids.attempt],
      );
      await assert.rejects(enqueue(db), /LINEAGE_INVALID/u);
    } finally {
      await db.close();
    }
  }
  {
    const db = await setup();
    try {
      const queued = await enqueue(db);
      const claimToken = await claim(db, queued.verifier_job_id);
      const response = await verifiedPayload(db, queued.verifier_job_id);
      await db.query(
        "update sellerpilot_private.product_listings set owner_id=$1 where id=$2",
        [ids.otherOwner, ids.listing],
      );
      await assert.rejects(
        scalar(db, `select public.sellerpilot_complete_coupang_create_reconciliation(
          $1,$2,$3,'succeeded',$4::jsonb,null
        )`, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]),
        /PRODUCT_LINEAGE_DRIFT/u,
      );
    } finally {
      await db.close();
    }
  }
  for (const mutation of [
    "update sellerpilot_private.product_listings set product_id='91000000-0000-4000-8000-000000000001' where id=$1",
    "update sellerpilot_private.channel_gateway_jobs set listing_id='41000000-0000-4000-8000-000000000001' where id=$1",
    "update sellerpilot_private.channel_gateway_jobs set credential_id='21000000-0000-4000-8000-000000000001' where id=$1",
  ]) {
    const db = await setup();
    try {
      const queued = await enqueue(db);
      const claimToken = await claim(db, queued.verifier_job_id);
      const response = await verifiedPayload(db, queued.verifier_job_id);
      await db.query(mutation, [mutation.includes("product_listings") ? ids.listing : ids.source]);
      await assert.rejects(
        scalar(db, `select public.sellerpilot_complete_coupang_create_reconciliation(
          $1,$2,$3,'succeeded',$4::jsonb,null
        )`, [tokenHash, queued.verifier_job_id, claimToken, JSON.stringify(response)]),
        /(?:PRODUCT_LINEAGE_DRIFT|SOURCE_DRIFT)/u,
      );
    } finally {
      await db.close();
    }
  }
});

test("expired GET-only verifier leases requeue until the bounded attempt limit", async () => {
  const db = await setup();
  try {
    const queued = await enqueue(db);
    await claim(db, queued.verifier_job_id, 2);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [queued.verifier_job_id],
    );
    const retried = await scalar(db,
      "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(10)"
    );
    assert.equal(retried.retried, 3);
    assert.equal(retried.failed, 3);
    assert.equal(retried.reconciliationRequired, 4);
    assert.equal(retried.oauthCompleted, 5);
    assert.equal(await scalar(db,
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [queued.verifier_job_id],
    ), "queued");

    await claim(db, queued.verifier_job_id, 5);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [queued.verifier_job_id],
    );
    const exhausted = await scalar(db,
      "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(10)"
    );
    assert.equal(exhausted.retried, 2);
    assert.equal(exhausted.failed, 4);
    assert.deepEqual((await db.query(
      "select status,error_message from sellerpilot_private.channel_gateway_jobs where id=$1",
      [queued.verifier_job_id],
    )).rows[0], { status: "failed", error_message: "readback_attempts_exhausted" });
    assert.equal(await scalar(db,
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [ids.source],
    ), "reconciliation_required");
  } finally {
    await db.close();
  }
});
