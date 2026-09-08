import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908051500_adjudicate_exact_coupang_live_divergence.sql",
  import.meta.url,
), "utf8");
const captureMigration = await readFile(new URL(
  "../supabase/migrations/20260908050000_capture_exact_coupang_invalid_completion.sql",
  import.meta.url,
), "utf8");

const productionResponseSha =
  "1f3c77508fef248047f30ee6e6e2f976242596c0575df5a79b725f9c520499f7";
const captureMigrationSha =
  "4fb9dba920a9473f7b07df2a54b4a70405e19d0b64ff854aa32a26c676387abb";
const id = {
  verifier: "86d2cb63-d382-4cc9-8153-654cf7ccec80",
  source: "25adf712-1e9a-432b-8b0d-09cf35a826c5",
  attempt: "d771421b-f408-4f75-addd-03879393fab8",
  listing: "fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4",
  credential: "32de2968-d4b7-4fda-a84b-16a7ce0257cc",
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  credentialOwner: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  worker: "02955cb4-fa9f-466b-824f-b61f06276190",
  claim: "6eb48202-e6e3-4b3a-a280-af5805fc404a",
};
const sellerKey = "c".repeat(64);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function remoteImages() {
  return Array.from({ length: 8 }, (_, index) => {
    const digest = String(index + 1).repeat(64);
    return `vendor_inventory/${digest.slice(0, 4)}/${digest.slice(4)}.jpg`;
  });
}

function imageContents(images) {
  return [{
    contentDetails: [
      ...images.map((content) => ({ detailType: "IMAGE", content })),
      { detailType: "TEXT", content: "원격 상세 설명" },
    ],
  }];
}

function payloads(options = {}) {
  const sourceImages = remoteImages();
  const capturedImages = options.reverseImages
    ? [...sourceImages].reverse()
    : [...sourceImages];
  const sourceResponse = {
    ok: false,
    remoteId: "16375780938",
    steps: [{
      name: "listing-approval-readback",
      ok: true,
      status: 200,
      data: {
        code: "SUCCESS",
        data: {
          sellerProductId: "16375780938",
          items: [{ contents: imageContents(sourceImages) }],
        },
      },
    }],
  };
  const response = {
    ok: false,
    channel: "coupang",
    operation: "listing.publication.verify",
    remoteId: "16375780938",
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    safeMessage: "원격 게시 상태 검증값을 확인하지 못했습니다.",
    steps: [{
      name: "seller-product-publication-reverification",
      ok: true,
      status: 200,
      data: {
        code: "SUCCESS",
        data: {
          sellerProductId: "16375780938",
          status: options.sellerStatus ?? "APPROVED",
          requested: options.sellerRequested ?? false,
          items: [{
            vendorItemId: options.vendorItemId ?? "96027942778",
            contents: imageContents(capturedImages),
          }],
        },
      },
    }, {
      name: "vendor-item-publication-reverification",
      ok: true,
      status: 200,
      data: {
        code: "SUCCESS",
        sellerpilotVendorItemId: options.vendorItemId ?? "96027942778",
        data: {
          onSale: options.onSale ?? true,
          amountInStock: options.stock ?? 1,
          salePrice: options.observedPrice ?? 6000,
        },
      },
    }, {
      name: "publication-content-verification",
      ok: false,
      status: 422,
      data: {
        sellerpilotVerification: "LISTING_PUBLICATION_CONTENT_UNVERIFIED",
        sourceJobId: id.source,
        sourceOperation: "listing.create",
        sourceFingerprintVerified: true,
        titleVerified: true,
        descriptionVerified: true,
        titleLanguageVerified: true,
        descriptionLanguageVerified: true,
        languageContentVerified: true,
        detailImageCountVerified: false,
        approvedManifestDigestVerified: true,
        sourceIdentityVerified: true,
        contentDigestVerified: false,
        sourceDetailImageCount: 8,
        sourceReadbackDetailImageCount: 8,
        remoteDetailImageCount: 8,
        sourceContentDigest: "1".repeat(64),
        remoteContentDigest: "2".repeat(64),
        sourceImageDigest: "3".repeat(64),
        remoteImageDigest: "4".repeat(64),
        remoteProjectionDigest: "2".repeat(64),
        providerImageSurface: "detail_content",
        providerImageContract: "approved_detail_content_exact_8",
        representativeImageVerified: true,
        providerBodyDetailImagesVerified: true,
        mismatchFields: ["detailImages", "contentDigest"],
      },
    }],
  };
  return { sourceImages, sourceResponse, response };
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function database(options = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(String.raw`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema sellerpilot_private;

    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      created_by uuid not null,
      channel text not null,
      environment text not null,
      status text not null,
      seller_account_key text,
      expires_at timestamptz
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      remote_id text,
      request_fingerprint text,
      seller_account_key text
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      operation_attempt_id uuid,
      channel_key text not null,
      market text not null default '',
      target_id text not null default '',
      seller_account_key text,
      marketplace_sku text,
      remote_id text,
      status text not null,
      failure_class text,
      requested_publication_intent text not null,
      remote_visibility text not null,
      provider_status text,
      remote_resources jsonb not null default '{}'::jsonb,
      public_url text,
      published_at timestamptz,
      last_verified_at timestamptz,
      last_error text,
      updated_at timestamptz not null
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
      response_payload jsonb,
      status text not null,
      seller_account_key text,
      request_fingerprint text,
      created_by uuid,
      created_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz,
      error_message text,
      worker_token_id uuid,
      claim_token uuid,
      lease_expires_at timestamptz,
      provider_mutation_started_at timestamptz,
      oauth_provider_call_started_at timestamptz,
      write_resource_kind text,
      write_resource_key text
    );
    create table sellerpilot_private.coupang_exact_live_verify_runs (
      verifier_job_id uuid primary key,
      source_job_id uuid not null unique,
      source_attempt_id uuid not null,
      listing_id uuid not null,
      remote_id text not null,
      source_job_sha256 text not null,
      source_attempt_sha256 text not null,
      source_listing_sha256 text not null,
      queued_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.coupang_exact_live_verify_receipts (
      verifier_job_id uuid primary key
    );
    create table sellerpilot_private.gateway_completion_receipts (
      job_id uuid primary key
    );
    create table sellerpilot_private.listing_publication_reviews (
      listing_id uuid primary key,
      status text not null
    );
    create table sellerpilot_private.coupang_exact_live_invalid_completion_captures (
      verifier_job_id uuid primary key,
      source_job_id uuid not null unique,
      source_attempt_id uuid not null,
      listing_id uuid not null unique,
      worker_token_id uuid not null,
      claim_token uuid not null,
      response_payload jsonb not null,
      response_sha256 text not null,
      original_completion_fingerprint text not null,
      claimed_job_snapshot jsonb not null,
      claimed_job_sha256 text not null,
      listing_snapshot jsonb not null,
      listing_sha256 text not null,
      publication_review_snapshot jsonb,
      publication_review_sha256 text,
      completed_job_snapshot jsonb not null,
      completed_job_sha256 text not null,
      validation_sqlstate text not null,
      validation_message text not null,
      adjudication text not null,
      contract text not null,
      provider_mutation_performed boolean not null,
      buyer_visible_verified boolean not null,
      captured_at timestamptz not null
    );
    create table sellerpilot_private.operation_audit (
      id bigint generated always as identity primary key,
      owner_id uuid,
      action text,
      entity_type text,
      entity_id text,
      safe_detail jsonb
    );
    create table sellerpilot_private.listing_mutation_release_gate (
      singleton boolean primary key default true check (singleton),
      is_open boolean not null default false,
      opened_channel text,
      updated_at timestamptz not null default clock_timestamp()
    );
    insert into sellerpilot_private.listing_mutation_release_gate(singleton)
    values (true);

    create table sellerpilot_private.globally_resolved_jobs(job_id uuid primary key);
    create function sellerpilot_private.listing_mutation_reconciliation_resolved(
      p_job_id uuid
    ) returns boolean language sql stable security definer set search_path = '' as $$
      select exists(
        select 1 from sellerpilot_private.globally_resolved_jobs resolved
         where resolved.job_id = p_job_id
      )
    $$;
    revoke all on function
      sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
      from public, anon, authenticated, service_role;

    create function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      raise exception 'base listing guard denied';
    end
    $$;
    create trigger guard_product_listing_seller_lineage
    before update on sellerpilot_private.product_listings
    for each row execute function
      sellerpilot_private.guard_product_listing_seller_lineage();

    create function public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()
    returns jsonb language sql stable security definer set search_path = '' as $$
      select jsonb_build_object(
        'open', gate.is_open,
        'openedChannel', gate.opened_channel,
        'coupangReconciliationRequired', (
          select count(*)::integer
            from sellerpilot_private.channel_gateway_jobs job
           where job.channel = 'coupang'
             and job.operation in (
               'listing.create', 'listing.update', 'listing.stop'
             )
             and job.status = 'reconciliation_required'
             and not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)
        ),
        'coupangEffectiveOpen', false
      ) || jsonb_build_object(
        'reconciliationRequired', (
          select count(*)::integer
            from sellerpilot_private.channel_gateway_jobs job
           where job.operation in (
             'listing.create', 'listing.update', 'listing.stop'
           )
             and job.status = 'reconciliation_required'
             and not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)
        )
      )
      from sellerpilot_private.listing_mutation_release_gate gate
      where gate.singleton
    $$;

    create function public.sellerpilot_service_listing_mutation_release_gate_status()
    returns jsonb language sql stable security definer set search_path = '' as $$
      select public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()
        || jsonb_build_object(
          'reconciliationRequired', (
            select count(*)::integer
              from sellerpilot_private.channel_gateway_jobs job
             where job.operation in (
               'listing.create', 'listing.update', 'listing.stop'
             )
               and job.status = 'reconciliation_required'
               and not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)
          )
        )
    $$;

    create function public.sellerpilot_service_set_listing_channel_mutation_release_gate(
      p_channel text,
      p_open boolean,
      p_release_sha text
    ) returns jsonb language plpgsql security definer set search_path = '' as $$
    declare
      v_reconciliation_required integer;
    begin
      select count(*) filter (
               where job.status = 'reconciliation_required'
                 and case p_channel
                   when 'qoo10' then
                     not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)
                   when 'coupang' then
                     not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)
                   when 'smartstore' then
                     not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)
                   else true
                 end
             )::integer
        into v_reconciliation_required
        from sellerpilot_private.channel_gateway_jobs job
       where job.channel = p_channel
         and job.operation in ('listing.create', 'listing.update', 'listing.stop');
      if p_open and v_reconciliation_required <> 0 then
        raise exception 'scoped listing mutation reconciliations must be resolved'
          using errcode = '55000';
      end if;
      update sellerpilot_private.listing_mutation_release_gate gate
         set is_open = p_open,
             opened_channel = case when p_open then p_channel else null end,
             updated_at = clock_timestamp()
       where gate.singleton;
      return public.sellerpilot_service_listing_mutation_release_gate_status();
    end
    $$;
  `);

  if (!options.seed) return { db, response: null };

  const { sourceResponse, response } = payloads(options);
  const sourceRequest = {
    arguments: {
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedImageCount: 8,
      body: { items: [{ salePrice: options.sourcePrice ?? 3190 }] },
    },
  };

  await db.query(`
    insert into sellerpilot_private.channel_credentials
      (id,created_by,channel,environment,status,seller_account_key)
    values($1,$2,'coupang','production','active',$3)
  `, [id.credential, id.credentialOwner, sellerKey]);
  await db.query(`
    insert into sellerpilot_private.channel_operation_attempts
      (id,owner_id,credential_id,channel,operation,status,remote_id,
       request_fingerprint,seller_account_key)
    values($1,$2,$3,'coupang','listing.create','manual_required',
      '16375780938',$4,$5)
  `, [id.attempt, id.owner, id.credential, "a".repeat(64), sellerKey]);
  await db.query(`
    insert into sellerpilot_private.product_listings
      (id,owner_id,product_id,operation_attempt_id,channel_key,market,target_id,
       remote_id,status,failure_class,requested_publication_intent,
       remote_visibility,remote_resources,public_url,published_at,updated_at)
    values($1,$2,$3,$4,'coupang','','','16375780938','failed',
      'external_action','live','unknown','{}'::jsonb,$5,$6,$7)
  `, [
    id.listing,
    id.owner,
    "1ed4acfc-7603-48ec-a638-241131e59358",
    id.attempt,
    "https://www.coupang.com/vp/products/16375780938",
    "2026-09-07T16:00:00.000Z",
    "2026-09-07T17:00:00.000Z",
  ]);
  await db.query(`
    insert into sellerpilot_private.channel_gateway_jobs
      (id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,status,seller_account_key,
       request_fingerprint,created_by,created_at,started_at,completed_at,updated_at,
       provider_mutation_started_at)
    values($1,$2,$3,$4,'coupang','listing.create','production',$5,$6,
      'reconciliation_required',$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    id.source, id.credential, id.attempt, id.listing,
    sourceRequest, sourceResponse, sellerKey, "a".repeat(64), id.credentialOwner,
    "2026-09-07T15:00:00.000Z", "2026-09-07T15:10:00.000Z",
    "2026-09-07T15:20:00.000Z", "2026-09-07T15:20:00.000Z",
    "2026-09-07T15:11:00.000Z",
  ]);
  await db.query(`
    insert into sellerpilot_private.channel_gateway_jobs
      (id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,status,seller_account_key,
       request_fingerprint,created_by,created_at,started_at,completed_at,updated_at)
    values($1,$2,null,$3,'coupang','listing.publication.verify','production',
      '{"arguments":{"sellerpilotReadOnly":true}}'::jsonb,$4,
      'reconciliation_required',$5,$6,$7,$8,$9,$10,$10)
  `, [
    id.verifier, id.credential, id.listing, response, sellerKey,
    "a".repeat(64), id.credentialOwner,
    "2026-09-07T20:06:14.564185Z", "2026-09-07T20:10:00.000Z",
    "2026-09-07T20:10:15.000Z",
  ]);

  const hashes = (await db.query(`
    select
      (select encode(extensions.digest(to_jsonb(job)::text,'sha256'),'hex')
         from sellerpilot_private.channel_gateway_jobs job where id=$1) source_sha,
      (select encode(extensions.digest(to_jsonb(attempt)::text,'sha256'),'hex')
         from sellerpilot_private.channel_operation_attempts attempt where id=$2) attempt_sha,
      (select encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
         from sellerpilot_private.product_listings listing where id=$3) listing_sha,
      (select encode(extensions.digest(to_jsonb(job)::text,'sha256'),'hex')
         from sellerpilot_private.channel_gateway_jobs job where id=$4) verifier_sha
  `, [id.source, id.attempt, id.listing, id.verifier])).rows[0];
  await db.query(`
    insert into sellerpilot_private.coupang_exact_live_verify_runs
      (verifier_job_id,source_job_id,source_attempt_id,listing_id,remote_id,
       source_job_sha256,source_attempt_sha256,source_listing_sha256)
    values($1,$2,$3,$4,'16375780938',$5,$6,$7)
  `, [
    id.verifier, id.source, id.attempt, id.listing,
    hashes.source_sha, hashes.attempt_sha, hashes.listing_sha,
  ]);
  const responseSha = await scalar(
    db,
    "select encode(extensions.digest($1::jsonb::text,'sha256'),'hex')",
    [response],
  );
  const claimedSnapshot = { status: "running", claimToken: id.claim };
  const claimedSha = await scalar(
    db,
    "select encode(extensions.digest($1::jsonb::text,'sha256'),'hex')",
    [claimedSnapshot],
  );
  const listingSnapshot = await scalar(
    db,
    "select to_jsonb(listing) from sellerpilot_private.product_listings listing where id=$1",
    [id.listing],
  );
  const verifierSnapshot = await scalar(
    db,
    "select to_jsonb(job) from sellerpilot_private.channel_gateway_jobs job where id=$1",
    [id.verifier],
  );
  await db.query(`
    insert into sellerpilot_private.coupang_exact_live_invalid_completion_captures
      (verifier_job_id,source_job_id,source_attempt_id,listing_id,worker_token_id,
       claim_token,response_payload,response_sha256,original_completion_fingerprint,
       claimed_job_snapshot,claimed_job_sha256,listing_snapshot,listing_sha256,
       publication_review_snapshot,publication_review_sha256,
       completed_job_snapshot,completed_job_sha256,validation_sqlstate,
       validation_message,adjudication,contract,provider_mutation_performed,
       buyer_visible_verified,captured_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
      null,null,$14,$15,'55000','exact Coupang GET verification incomplete',
      'unresolved','coupang_exact_live_invalid_completion_capture_v1',false,false,$16)
  `, [
    id.verifier, id.source, id.attempt, id.listing, id.worker, id.claim,
    response, responseSha, "f".repeat(64), claimedSnapshot, claimedSha,
    listingSnapshot, hashes.listing_sha, verifierSnapshot, hashes.verifier_sha,
    "2026-09-07T20:10:16.000Z",
  ]);
  if (options.exactReceipt) {
    await db.query(
      "insert into sellerpilot_private.coupang_exact_live_verify_receipts(verifier_job_id) values($1)",
      [id.verifier],
    );
  }
  if (options.genericReceipt) {
    await db.query(
      "insert into sellerpilot_private.gateway_completion_receipts(job_id) values($1)",
      [id.verifier],
    );
  }
  return { db, response, responseSha };
}

function renderedMigration(responseSha) {
  return migration.replaceAll(productionResponseSha, responseSha);
}

test("migration pins the capture artifact and cannot create positive evidence or open a gate", () => {
  assert.equal(sha256(captureMigration), captureMigrationSha);
  assert.ok(migration.includes(captureMigrationSha));
  assert.ok(migration.includes(productionResponseSha));
  assert.match(migration, /decision = 'provider_live_price_drift'/);
  assert.match(migration, /source_price = 3190/);
  assert.match(migration, /observed_price = 6000/);
  assert.match(migration, /source_images <> captured_images/);
  assert.match(migration, /\^vendor_inventory\//);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.(?:coupang_exact_live_verify_receipts|gateway_completion_receipts)/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.(?:channel_gateway_jobs|channel_operation_attempts|coupang_exact_live_invalid_completion_captures|coupang_exact_live_verify_runs)/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.listing_mutation_release_gate/iu,
  );
  assert.doesNotMatch(migration, /attest_adapter|attest_rechecker/iu);
});

test("fresh database is an exact replayable no-op", async () => {
  const { db } = await database({ seed: false });
  try {
    await db.exec(migration);
    await db.exec(migration);
    assert.equal(await scalar(
      db,
      "select count(*)::int from sellerpilot_private.coupang_exact_live_price_drift_adjudications",
    ), 0);
    assert.deepEqual((await db.query(
      "select is_open,opened_channel from sellerpilot_private.listing_mutation_release_gate",
    )).rows, [{ is_open: false, opened_channel: null }]);
  } finally {
    await db.close();
  }
});

test("adjudicates only provider-live price drift and preserves every immutable lineage row", async () => {
  const { db, responseSha } = await database({ seed: true });
  try {
    const immutableBefore = await db.query(`
      select 'source' kind,to_jsonb(job) row
        from sellerpilot_private.channel_gateway_jobs job where id=$1
      union all select 'verifier',to_jsonb(job)
        from sellerpilot_private.channel_gateway_jobs job where id=$2
      union all select 'attempt',to_jsonb(attempt)
        from sellerpilot_private.channel_operation_attempts attempt where id=$3
      union all select 'capture',to_jsonb(capture)
        from sellerpilot_private.coupang_exact_live_invalid_completion_captures capture
        where verifier_job_id=$2
      union all select 'run',to_jsonb(run)
        from sellerpilot_private.coupang_exact_live_verify_runs run
        where verifier_job_id=$2
      order by kind
    `, [id.source, id.verifier, id.attempt]);
    const listingBefore = await scalar(
      db,
      "select to_jsonb(listing) from sellerpilot_private.product_listings listing where id=$1",
      [id.listing],
    );
    const gateBefore = await scalar(
      db,
      "select to_jsonb(gate) from sellerpilot_private.listing_mutation_release_gate gate",
    );
    const globalResolverBefore = await scalar(
      db,
      "select pg_catalog.pg_get_functiondef('sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::regprocedure)",
    );

    const rendered = renderedMigration(responseSha);
    await db.exec(rendered);

    const immutableAfter = await db.query(`
      select 'source' kind,to_jsonb(job) row
        from sellerpilot_private.channel_gateway_jobs job where id=$1
      union all select 'verifier',to_jsonb(job)
        from sellerpilot_private.channel_gateway_jobs job where id=$2
      union all select 'attempt',to_jsonb(attempt)
        from sellerpilot_private.channel_operation_attempts attempt where id=$3
      union all select 'capture',to_jsonb(capture)
        from sellerpilot_private.coupang_exact_live_invalid_completion_captures capture
        where verifier_job_id=$2
      union all select 'run',to_jsonb(run)
        from sellerpilot_private.coupang_exact_live_verify_runs run
        where verifier_job_id=$2
      order by kind
    `, [id.source, id.verifier, id.attempt]);
    assert.deepEqual(immutableAfter.rows, immutableBefore.rows);
    assert.deepEqual(await scalar(
      db,
      "select to_jsonb(gate) from sellerpilot_private.listing_mutation_release_gate gate",
    ), gateBefore);
    assert.equal(await scalar(
      db,
      "select pg_catalog.pg_get_functiondef('sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::regprocedure)",
    ), globalResolverBefore);

    const listing = await scalar(
      db,
      "select to_jsonb(listing) from sellerpilot_private.product_listings listing where id=$1",
      [id.listing],
    );
    assert.equal(listing.status, "failed");
    assert.equal(listing.failure_class, "external_action");
    assert.equal(listing.remote_visibility, "live");
    assert.equal(listing.provider_status, "APPROVED|requested=false|onSale=true");
    assert.equal(listing.remote_resources.contract, "coupang_provider_live_price_drift_v1");
    assert.deepEqual(listing.remote_resources.resources.vendorItemIds, ["96027942778"]);
    assert.equal(listing.remote_resources.verification.sourcePrice, 3190);
    assert.equal(listing.remote_resources.verification.observedPrice, 6000);
    assert.equal(listing.remote_resources.verification.exactContentVerified, false);
    assert.equal(listing.public_url, listingBefore.public_url);
    assert.equal(listing.published_at, listingBefore.published_at);

    const adjudication = await scalar(
      db,
      "select to_jsonb(a) from sellerpilot_private.coupang_exact_live_price_drift_adjudications a",
    );
    assert.equal(adjudication.decision, "provider_live_price_drift");
    assert.equal(adjudication.capture_response_sha256, responseSha);
    assert.deepEqual(adjudication.source_remote_detail_images, remoteImages());
    assert.deepEqual(adjudication.captured_remote_detail_images, remoteImages());
    assert.equal(adjudication.ordered_remote_images_match, true);
    assert.equal(adjudication.exact_content_verified, false);
    assert.equal(adjudication.buyer_visible_verified, false);
    assert.equal(adjudication.provider_mutation_performed, false);
    assert.equal(await scalar(
      db,
      "select encode(extensions.digest(adjudication_evidence::text,'sha256'),'hex')=adjudication_sha256 from sellerpilot_private.coupang_exact_live_price_drift_adjudications",
    ), true);
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved($1)",
      [id.source],
    ), true);
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.listing_mutation_reconciliation_resolved($1)",
      [id.source],
    ), false);

    const status = await scalar(
      db,
      "select public.sellerpilot_service_listing_mutation_release_gate_status()",
    );
    assert.equal(status.coupangReconciliationRequired, 0);
    assert.equal(status.reconciliationRequired, 1);
    assert.equal(await scalar(
      db,
      "select count(*)::int from sellerpilot_private.coupang_exact_live_verify_receipts",
    ), 0);
    assert.equal(await scalar(
      db,
      "select count(*)::int from sellerpilot_private.gateway_completion_receipts",
    ), 0);
    assert.equal(await scalar(
      db,
      "select count(*)::int from sellerpilot_private.operation_audit where action='coupang_exact_live_price_drift_adjudicated'",
    ), 1);
    assert.equal(await scalar(
      db,
      "select has_table_privilege('service_role','sellerpilot_private.coupang_exact_live_price_drift_adjudications','SELECT')",
    ), false);
    assert.equal(await scalar(
      db,
      "select has_function_privilege('service_role','sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(uuid)','EXECUTE')",
    ), false);
    await assert.rejects(
      db.query("update sellerpilot_private.coupang_exact_live_price_drift_adjudications set observed_price=6001"),
      /IMMUTABLE/,
    );
    await assert.rejects(
      db.query("delete from sellerpilot_private.coupang_exact_live_price_drift_adjudications"),
      /IMMUTABLE/,
    );

    await db.exec(rendered);
    assert.equal(await scalar(
      db,
      "select count(*)::int from sellerpilot_private.coupang_exact_live_price_drift_adjudications",
    ), 1);
    assert.equal(await scalar(
      db,
      "select count(*)::int from sellerpilot_private.operation_audit where action='coupang_exact_live_price_drift_adjudicated'",
    ), 1);

    const opened = await scalar(
      db,
      "select public.sellerpilot_service_set_listing_channel_mutation_release_gate('coupang',true,$1)",
      ["a".repeat(40)],
    );
    assert.equal(opened.open, true);
    assert.equal(opened.openedChannel, "coupang");
    assert.equal(opened.reconciliationRequired, 1);
  } finally {
    await db.close();
  }
});

test("semantic drift and partial production state fail closed", async () => {
  for (const options of [
    { seed: true, observedPrice: 5999 },
    { seed: true, reverseImages: true },
    { seed: true, sourcePrice: 3200 },
    { seed: true, vendorItemId: "96027942779" },
    { seed: true, onSale: false },
    { seed: true, stock: 2 },
    { seed: true, sellerRequested: true },
    { seed: true, sellerStatus: "IN_REVIEW" },
    { seed: true, exactReceipt: true },
    { seed: true, genericReceipt: true },
  ]) {
    const { db, responseSha } = await database(options);
    try {
      await assert.rejects(
        db.exec(renderedMigration(responseSha)),
        /COUPANG_EXACT_PRICE_DRIFT_PREIMAGE_REJECTED/,
      );
      await db.exec("rollback");
      assert.equal(await scalar(
        db,
        "select to_regclass('sellerpilot_private.coupang_exact_live_price_drift_adjudications') is null",
      ), true);
      assert.equal(await scalar(
        db,
        "select remote_visibility from sellerpilot_private.product_listings where id=$1",
        [id.listing],
      ), "unknown");
    } finally {
      await db.close();
    }
  }

  const { db } = await database({ seed: false });
  try {
    await db.query(`
      insert into sellerpilot_private.product_listings
        (id,owner_id,product_id,channel_key,requested_publication_intent,
         remote_visibility,status,updated_at)
      values($1,$2,$3,'coupang','live','unknown','failed',clock_timestamp())
    `, [id.listing, id.owner, "1ed4acfc-7603-48ec-a638-241131e59358"]);
    await assert.rejects(
      db.exec(migration),
      /COUPANG_EXACT_PRICE_DRIFT_PARTIAL_PREIMAGE/,
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});
