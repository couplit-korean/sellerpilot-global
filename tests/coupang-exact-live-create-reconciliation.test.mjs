import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260907191500_reconcile_exact_coupang_live_create_get_only.sql",
  import.meta.url,
), "utf8");
const sharedAdminLineageMigration = await readFile(new URL(
  "../supabase/migrations/20260907194500_fix_exact_coupang_shared_admin_lineage.sql",
  import.meta.url,
), "utf8");

const exact = {
  sourceJob: "25adf712-1e9a-432b-8b0d-09cf35a826c5",
  sourceAttempt: "d771421b-f408-4f75-addd-03879393fab8",
  listing: "fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4",
  remote: "16375780938",
};

test("exact Coupang reconciliation is one GET-only publication verifier lane", () => {
  for (const value of Object.values(exact)) assert.match(migration, new RegExp(value));
  assert.match(migration, /sellerpilot_service_enqueue_exact_coupang_live_verifier/);
  assert.match(migration, /sellerpilot_complete_before_coupang_exact_live/);
  assert.match(migration, /result->>'status' in\('completed','completed_replay'\)/);
  assert.match(migration, /'coupang','listing\.publication\.verify','production'/);
  assert.match(migration, /'sellerpilotReadOnly',true/);
  assert.match(migration, /j\.attempt_id is null/);
  assert.match(migration, /j\.provider_mutation_started_at is null/);
  assert.match(migration, /j\.write_resource_kind is null/);
  assert.match(migration, /j\.write_resource_key is null/);
  assert.doesNotMatch(migration, /\/v2\/providers\/seller_api/);
  assert.doesNotMatch(migration, /method[^\n]*(?:POST|PUT|PATCH|DELETE)/i);
  const gatewayInserts = migration.match(/insert into sellerpilot_private\.channel_gateway_jobs/g) ?? [];
  assert.equal(gatewayInserts.length, 1);
});

test("source hydration and resolution require exact official identity, sale, content and images", () => {
  assert.match(migration, /sellerpilot_service_listing_publication_verification_source/);
  assert.match(migration, /seller-product-publication-readback/);
  assert.match(migration, /seller-product-publication-reverification/);
  assert.match(migration, /vendor-item-publication-reverification/);
  assert.match(migration, /\{data,data,sellerProductId\}'='16375780938'/);
  assert.match(migration, /\{data,data,onSale\}'='true'/);
  assert.match(migration, /\{evidence,detailImageCounts\}/);
  assert.match(migration, /x<>'8'::jsonb/);
  for (const field of [
    "contentVerified", "titleVerified", "descriptionVerified",
    "languageContentVerified", "approvedManifestDigestVerified",
    "sourceIdentityVerified", "contentDigestVerified",
  ]) assert.match(migration, new RegExp(field));
  assert.match(migration, /LISTING_PUBLICATION_CONTENT_VERIFIED/);
});

test("resolution preserves the terminal source and writes an immutable GET receipt", () => {
  assert.match(migration, /exact Coupang source evidence is immutable/);
  assert.match(migration, /exact Coupang reconciliation evidence is immutable/);
  assert.match(migration, /provider_mutation_performed boolean not null default false check\(not provider_mutation_performed\)/);
  assert.match(migration, /'providerMutationPerformed',false/);
  assert.match(migration, /coupang_exact_live_get_reconciled/);
  assert.match(migration, /listing_mutation_reconciliation_resolved_before_coupang_exact_live/);
  assert.doesNotMatch(migration, /update sellerpilot_private\.channel_gateway_jobs\s+(?:as\s+)?(?:source|job)?\s*set/i);
  assert.doesNotMatch(migration, /update sellerpilot_private\.channel_operation_attempts/i);
});

test("shared-admin repair binds credential owner separately from listing owner", () => {
  assert.match(sharedAdminLineageMigration, /attempt\.owner_id <> job\.created_by/);
  assert.match(sharedAdminLineageMigration, /credential\.created_by = job\.created_by/);
  assert.match(sharedAdminLineageMigration, /listing\.owner_id = attempt\.owner_id/);
  assert.match(sharedAdminLineageMigration, /a\.owner_id <> j\.created_by/);
  assert.match(sharedAdminLineageMigration, /credential\.created_by = j\.created_by/);
  assert.match(sharedAdminLineageMigration, /v_source_rows not in \(0, 3\)/);
  assert.match(sharedAdminLineageMigration, /listing_mutation_reconciliation_resolved/);
  assert.match(sharedAdminLineageMigration, /coupang_provider_assigned_vendor_items_v1/);
  assert.match(sharedAdminLineageMigration, /jsonb_array_length\(readback#>'\{data,data,items\}'\) = 1/);
  assert.doesNotMatch(sharedAdminLineageMigration, /insert into sellerpilot_private\.channel_gateway_jobs/i);
  assert.doesNotMatch(sharedAdminLineageMigration, /update sellerpilot_private\.(?:channel_gateway_jobs|channel_operation_attempts|product_listings)/i);
  assert.doesNotMatch(sharedAdminLineageMigration, /method[^\n]*(?:POST|PUT|PATCH|DELETE)/i);
});

async function fixture(options = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(String.raw`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid,channel text,environment text,status text,
      seller_account_key text,expires_at timestamptz
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,owner_id uuid,credential_id uuid,channel text,operation text,
      status text,remote_id text,request_fingerprint text,seller_account_key text
    );
    create table sellerpilot_private.products(id uuid primary key);
    create table sellerpilot_private.product_listings(
      id uuid primary key,owner_id uuid,product_id uuid,channel_key text,remote_id text,
      status text,failure_class text,remote_visibility text,provider_status text,
      remote_resources jsonb default '{}'::jsonb,published_at timestamptz,
      last_verified_at timestamptz,last_error text,updated_at timestamptz,market text,
      target_id text,requested_publication_intent text,operation_attempt_id uuid,
      seller_account_key text,marketplace_sku text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,attempt_id uuid,listing_id uuid,channel text,
      operation text,environment text,request_payload jsonb,response_payload jsonb,status text,
      seller_account_key text,request_fingerprint text,created_by uuid,created_at timestamptz,
      updated_at timestamptz,provider_mutation_started_at timestamptz,
      write_resource_kind text,write_resource_key text,claim_token uuid
    );
    create table sellerpilot_private.operation_audit(
      id bigint generated always as identity primary key,owner_id uuid,action text,
      entity_type text,entity_id text,safe_detail jsonb
    );
    create function sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean)
    returns boolean language sql as 'select true';
    create function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger language plpgsql as 'begin raise exception ''base listing guard denied'';end';
    create trigger guard_product_listing_seller_lineage before update
    on sellerpilot_private.product_listings for each row execute function
    sellerpilot_private.guard_product_listing_seller_lineage();
    create function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
    returns boolean language sql as 'select false';
    create function public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)
    returns jsonb language sql as 'select jsonb_build_object(''legacy'',true)';
    create function public.sellerpilot_service_complete_gateway_transaction(
      p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
      p_response_payload jsonb default null,p_error_message text default null,
      p_credential_refresh jsonb default null,p_normalized_orders jsonb default null,
      p_normalized_inquiries jsonb default null,p_diagnostic jsonb default null
    ) returns jsonb language plpgsql as $complete$
    declare current_status text;current_claim uuid;
    begin
      select status,claim_token into current_status,current_claim
        from sellerpilot_private.channel_gateway_jobs where id=p_job_id for update;
      if current_status='succeeded' then
        return jsonb_build_object('status','completed_replay','replayed',true);
      end if;
      if current_status<>'running' or current_claim is distinct from p_claim_token then
        raise exception 'gateway completion ownership required';
      end if;
      update sellerpilot_private.channel_gateway_jobs
         set status=p_status,response_payload=p_response_payload,updated_at=clock_timestamp()
       where id=p_job_id;
      return jsonb_build_object('status','completed','replayed',false);
    end$complete$;
  `);

  const owner = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
  const credentialOwner = "21eb1892-0894-4f9f-b414-4c9464182dd6";
  const credential = "32de2968-d4b7-4fda-a84b-16a7ce0257cc";
  const product = "1ed4acfc-7603-48ec-a638-241131e59358";
  const fingerprint = "a".repeat(64);
  const images = Array.from({ length: 8 }, (_, index) => ({
    role: `detail-${index + 1}`,
    approvedObjectPath: `results/${owner}/claims/${exact.sourceAttempt}/detail-${index + 1}.png`,
    approvedSourceSha256: String(index + 1).padStart(64, "0"),
    publicUrl: `https://demo.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${String(index + 1).padStart(2, "0")}/${String(index + 1).padStart(64, "0")}.jpg`,
    objectPath: `normalized/${String(index + 1).padStart(2, "0")}/${String(index + 1).padStart(64, "0")}.jpg`,
    contentSha256: String(index + 1).padStart(64, "0"),
  }));
  const item = {
    contents: [{ contentDetails: [
      ...images.map((image) => ({ detailType: "IMAGE", content: image.publicUrl })),
      { detailType: "TEXT", content: "검증 상품 상세 설명" },
    ] }],
  };
  const sourceResponse = {
    remoteId: exact.remote,
    steps: [{
      name: "listing-approval-readback", status: 200,
      data: { code: "SUCCESS", data: { sellerProductId: exact.remote, items: [item] } },
    }],
  };
  const sourceRequest = { arguments: {
    publicationIntent: "live", publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR", publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: fingerprint,
    body: { items: [{
      externalVendorSku: "AUTO-780720401E2D4E4EA45F", salePrice: 3190,
      maximumBuyCount: 1,
    }] },
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      approvedDetailPageVersion: 1, approvedManifestDigest: "b".repeat(64),
      approvedDetailImages: images, providerImageSurface: "detail_content",
      providerTransportImages: images.map(({ approvedObjectPath, approvedSourceSha256, ...image }) => image),
    },
  } };
  if (!options.omitExactSource) {
    await db.query(`insert into sellerpilot_private.channel_credentials(
      id,created_by,channel,environment,status,seller_account_key
    ) values($1,$2,'coupang','production',$3,$4)`,
    [credential, credentialOwner, options.credentialStatus ?? "active",
      options.credentialSellerAccountKey ?? "c".repeat(64)]);
    await db.query(`insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,status,remote_id,request_fingerprint,
      seller_account_key
    ) values($1,$2,$3,'coupang','listing.create',$4,$5,$6,$7)`,
    [exact.sourceAttempt, owner, credential, options.attemptStatus ?? "manual_required",
      exact.remote, fingerprint, "c".repeat(64)]);
    await db.query("insert into sellerpilot_private.products values($1)", [product]);
    await db.query(`insert into sellerpilot_private.product_listings(
      id,owner_id,product_id,channel_key,status,failure_class,remote_visibility,
      remote_resources,updated_at,market,target_id,requested_publication_intent,
      operation_attempt_id,seller_account_key,marketplace_sku,remote_id
    ) values($1,$2,$3,'coupang','failed','external_action','unknown','{}',clock_timestamp(),
      'KR','', 'live',$4,null,null,$5)`,
    [exact.listing, owner, product, exact.sourceAttempt, exact.remote]);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,
      request_payload,response_payload,status,seller_account_key,request_fingerprint,
      created_by,created_at,updated_at,provider_mutation_started_at
    ) values($1,$2,$3,$4,'coupang','listing.create','production',$5,$6,
      'reconciliation_required',$7,$8,$9,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
    [exact.sourceJob, credential, exact.sourceAttempt, exact.listing, sourceRequest,
      sourceResponse, "c".repeat(64), fingerprint, options.jobCreator ?? credentialOwner]);
  }
  await db.exec(migration);
  try {
    await db.exec(sharedAdminLineageMigration);
  } catch (error) {
    await db.close();
    throw error;
  }
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  return { db, fingerprint, owner, credentialOwner };
}

test("PGlite applies and reapplies the repair when the exact production tuple is absent", async () => {
  const { db } = await fixture({ omitExactSource: true });
  try {
    await db.exec(sharedAdminLineageMigration);
    assert.equal((await db.query(
      "select sellerpilot_private.coupang_exact_live_source_current() current",
    )).rows[0].current, false);
  } finally {
    await db.close();
  }
});

test("PGlite rejects an inactive or mismatched credential owner before enqueue", async () => {
  await assert.rejects(
    fixture({ credentialStatus: "revoked" }),
    /shared-admin lineage is unavailable/,
  );
  await assert.rejects(
    fixture({ jobCreator: "5f668657-d4bd-4c32-a9e9-1d4c211db26f" }),
    /shared-admin lineage is unavailable/,
  );
  await assert.rejects(
    fixture({ credentialSellerAccountKey: "d".repeat(64) }),
    /shared-admin lineage is unavailable/,
  );
});

async function preparedVerifier(db, fingerprint) {
  const verifier = (await db.query(
    "select public.sellerpilot_service_enqueue_exact_coupang_live_verifier() id",
  )).rows[0].id;
  const claim = "a19d0ce2-9049-409f-bfaf-77713f6f7bb1";
  await db.query(
    "update sellerpilot_private.channel_gateway_jobs set status='running',claim_token=$2 where id=$1",
    [verifier, claim],
  );
  const hydrated = (await db.query(
    "select public.sellerpilot_service_listing_publication_verification_source('token',$1,$2) source",
    [verifier, claim],
  )).rows[0].source;
  const sellerRoot = structuredClone(hydrated.sourceResponsePayload.steps.at(-1).data.data);
  sellerRoot.status = "APPROVED";
  sellerRoot.statusName = "승인완료";
  sellerRoot.items[0].vendorItemId = "90000000001";
  sellerRoot.items[0].salePrice = 3190;
  return {
    verifier,
    hydrated,
    success: {
      ok: true, remoteId: exact.remote, publicationFulfilled: true,
      remoteState: {
        visibility: "live", verified: true, locale: "ko-KR", fingerprint,
        imageCount: 8, verifiedAt: new Date().toISOString(),
        providerStatus: "APPROVED|requested=false|onSale=true",
        resources: { sellerProductId: exact.remote, vendorItemIds: ["90000000001"] },
        evidence: {
          vendorItemOnSale: [true], detailImageCounts: [8], sourceJobId: exact.sourceJob,
          contentVerified: true, titleVerified: true, descriptionVerified: true,
          languageContentVerified: true, approvedManifestDigestVerified: true,
          sourceIdentityVerified: true, contentDigestVerified: true,
        },
      },
      steps: [
        { name: "seller-product-publication-reverification", ok: true, status: 200,
          data: { code: "SUCCESS", data: sellerRoot } },
        { name: "vendor-item-publication-reverification", ok: true, status: 200,
          data: { code: "SUCCESS", sellerpilotVendorItemId: "90000000001",
            data: { onSale: true, amountInStock: 1, salePrice: 3190 } } },
        { name: "publication-content-verification", ok: true, status: 200,
          data: { sellerpilotVerification: "LISTING_PUBLICATION_CONTENT_VERIFIED" } },
      ],
    },
  };
}

test("PGlite executes enqueue, hydration, immutable evidence, resolution and replay", async () => {
  const { db, fingerprint, owner, credentialOwner } = await fixture();
  try {
    const [firstEnqueue, concurrentEnqueue] = await Promise.all([
      db.query("select public.sellerpilot_service_enqueue_exact_coupang_live_verifier() id"),
      db.query("select public.sellerpilot_service_enqueue_exact_coupang_live_verifier() id"),
    ]);
    const verifier = firstEnqueue.rows[0].id;
    assert.equal(concurrentEnqueue.rows[0].id, verifier);
    const sourceBefore = (await db.query(`
      select to_jsonb(job) source_job,to_jsonb(attempt) source_attempt
        from sellerpilot_private.channel_gateway_jobs job
        join sellerpilot_private.channel_operation_attempts attempt
          on attempt.id=$2
       where job.id=$1
    `, [exact.sourceJob, exact.sourceAttempt])).rows[0];
    const job = (await db.query(
      "select operation,status,attempt_id,provider_mutation_started_at,write_resource_kind,write_resource_key,created_by from sellerpilot_private.channel_gateway_jobs where id=$1",
      [verifier],
    )).rows[0];
    assert.deepEqual(job, {
      operation: "listing.publication.verify", status: "queued", attempt_id: null,
      provider_mutation_started_at: null, write_resource_kind: null,
      write_resource_key: null,
      created_by: credentialOwner,
    });
    assert.notEqual(owner, credentialOwner);
    const claim = "a19d0ce2-9049-409f-bfaf-77713f6f7bb1";
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='running',claim_token=$2 where id=$1", [verifier, claim]);
    const hydrated = (await db.query(
      "select public.sellerpilot_service_listing_publication_verification_source('token',$1,$2) source",
      [verifier, claim],
    )).rows[0].source;
    assert.equal(hydrated.sourceJobId, exact.sourceJob);
    assert.equal(hydrated.expectedRemoteId, exact.remote);
    assert.equal(hydrated.sourceResponsePayload.steps.at(-1).name, "seller-product-publication-readback");
    assert.equal(hydrated.sourceResponsePayload.remoteState.evidence.publicationAssetBinding.contract,
      "sellerpilot_provider_asset_binding_v1");
    assert.deepEqual(hydrated.sourceResponsePayload.remoteState.resources.vendorItemIds, []);
    assert.deepEqual(
      hydrated.sourceResponsePayload.remoteState.evidence.providerAssignedDescendantIdentityBinding,
      {
        contract: "coupang_provider_assigned_vendor_items_v1",
        sourceJobId: exact.sourceJob,
        sellerProductId: exact.remote,
      },
    );
    assert.equal((await db.query(
      `select has_function_privilege('service_role',
       'public.sellerpilot_verification_source_before_coupang_exact_live(text,uuid,uuid)',
       'EXECUTE') allowed`,
    )).rows[0].allowed, false);
    assert.equal((await db.query(
      `select has_function_privilege('service_role',
       'public.sellerpilot_complete_before_coupang_exact_live(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)',
       'EXECUTE') allowed`,
    )).rows[0].allowed, false);

    const verifiedAt = new Date().toISOString();
    const evidence = {
      vendorItemOnSale: [true], detailImageCounts: [8], sourceJobId: exact.sourceJob,
      contentVerified: true, titleVerified: true, descriptionVerified: true,
      languageContentVerified: true, approvedManifestDigestVerified: true,
      sourceIdentityVerified: true, contentDigestVerified: true,
    };
    const sellerRoot = structuredClone(hydrated.sourceResponsePayload.steps.at(-1).data.data);
    sellerRoot.status = "APPROVED";
    sellerRoot.statusName = "승인완료";
    sellerRoot.items[0].vendorItemId = "90000000001";
    sellerRoot.items[0].salePrice = 3190;
    const success = {
      ok: true, remoteId: exact.remote, publicationFulfilled: true,
      remoteState: {
        visibility: "live", verified: true, locale: "ko-KR", fingerprint,
        imageCount: 8, verifiedAt, providerStatus: "APPROVED|requested=false|onSale=true",
        resources: { sellerProductId: exact.remote, vendorItemIds: ["90000000001"] }, evidence,
      },
      steps: [
        { name: "seller-product-publication-reverification", ok: true, status: 200,
          data: { code: "SUCCESS", data: sellerRoot } },
        { name: "vendor-item-publication-reverification", ok: true, status: 200,
          data: { code: "SUCCESS", sellerpilotVendorItemId: "90000000001", data: { onSale: true, amountInStock: 1, salePrice: 3190 } } },
        { name: "publication-content-verification", ok: true, status: 200,
          data: { sellerpilotVerification: "LISTING_PUBLICATION_CONTENT_VERIFIED" } },
      ],
    };
    const completed = (await db.query(
      "select public.sellerpilot_service_complete_gateway_transaction('token',$1,$2,'succeeded',$3) result",
      [verifier, claim, success],
    )).rows[0].result;
    assert.equal(completed.status, "completed");
    const replay = (await db.query(
      "select public.sellerpilot_service_complete_gateway_transaction('token',$1,$2,'succeeded',$3) result",
      [verifier, claim, success],
    )).rows[0].result;
    assert.equal(replay.status, "completed_replay");
    const listing = (await db.query(
      "select remote_id,status,remote_visibility,remote_resources from sellerpilot_private.product_listings where id=$1",
      [exact.listing],
    )).rows[0];
    assert.equal(listing.remote_id, exact.remote);
    assert.equal(listing.status, "published");
    assert.equal(listing.remote_visibility, "live");
    assert.equal(listing.remote_resources.providerMutationPerformed, false);
    assert.equal((await db.query("select count(*)::int count from sellerpilot_private.coupang_exact_live_verify_receipts")).rows[0].count, 1);
    assert.equal((await db.query("select sellerpilot_private.listing_mutation_reconciliation_resolved($1) ok", [exact.sourceJob])).rows[0].ok, true);
    const sourceAfter = (await db.query(`
      select to_jsonb(job) source_job,to_jsonb(attempt) source_attempt
        from sellerpilot_private.channel_gateway_jobs job
        join sellerpilot_private.channel_operation_attempts attempt
          on attempt.id=$2
       where job.id=$1
    `, [exact.sourceJob, exact.sourceAttempt])).rows[0];
    assert.deepEqual(sourceAfter, sourceBefore);
    await db.exec(sharedAdminLineageMigration);
    await db.query("select set_config('sellerpilot.coupang_exact_live_reconcile',$1,false)", [verifier]);
    await assert.rejects(db.query(
      "update sellerpilot_private.product_listings set remote_resources='{\"arbitrary\":true}' where id=$1",
      [exact.listing],
    ), /invalid exact Coupang listing projection|base listing guard denied/);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set response_payload=$2 where id=$1",
      [verifier, { ...success, replayTamper: true }],
    );
    await assert.rejects(db.query(
      "select public.sellerpilot_service_complete_gateway_transaction('token',$1,$2,'succeeded',$3)",
      [verifier, claim, success],
    ), /replay drifted/);
    assert.equal((await db.query(
      "select sellerpilot_private.listing_mutation_reconciliation_resolved($1) ok", [exact.sourceJob],
    )).rows[0].ok, false);
    await assert.rejects(db.query(
      "update sellerpilot_private.channel_gateway_jobs set status='succeeded' where id=$1", [exact.sourceJob],
    ), /immutable/);
    await assert.rejects(db.query(
      "delete from sellerpilot_private.channel_operation_attempts where id=$1", [exact.sourceAttempt],
    ), /immutable/);
  } finally {
    await db.close();
  }
});

async function expectRejectedCompletion(mutate) {
  const { db, fingerprint } = await fixture();
  try {
    const { verifier, success } = await preparedVerifier(db, fingerprint);
    const invalid = structuredClone(success);
    mutate(invalid);
    await assert.rejects(db.query(
      "select public.sellerpilot_service_complete_gateway_transaction('token',$1,$2,'succeeded',$3)",
      [verifier, "a19d0ce2-9049-409f-bfaf-77713f6f7bb1", invalid],
    ), /verification incomplete/);
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.coupang_exact_live_verify_receipts",
    )).rows[0].count, 0);
    assert.deepEqual((await db.query(
      "select status,remote_visibility from sellerpilot_private.product_listings where id=$1",
      [exact.listing],
    )).rows[0], { status: "failed", remote_visibility: "unknown" });
    assert.equal((await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [verifier],
    )).rows[0].status, "running");
  } finally {
    await db.close();
  }
}

test("PGlite rejects a vendor step ID outside the canonical remote vendor set", async () => {
  await expectRejectedCompletion((value) => {
    value.steps[1].data.sellerpilotVendorItemId = "90000000002";
  });
});

test("PGlite rejects empty vendor/onSale/detail-count evidence", async () => {
  await expectRejectedCompletion((value) => {
    value.remoteState.resources.vendorItemIds = [];
    value.remoteState.evidence.vendorItemOnSale = [];
    value.remoteState.evidence.detailImageCounts = [];
    value.steps.splice(1, 1);
  });
});

test("PGlite rejects pending and rejected raw seller-product states", async () => {
  for (const state of [
    { status: "APPROVAL_REQUESTED", statusName: "승인대기중" },
    { status: "REJECTED", statusName: "승인반려" },
  ]) {
    await expectRejectedCompletion((value) => {
      value.steps[0].data.data.status = state.status;
      value.steps[0].data.data.statusName = state.statusName;
    });
  }
});

test("PGlite rejects quantity/price drift and a non-current source attempt", async () => {
  await expectRejectedCompletion((value) => {
    value.steps[1].data.data.amountInStock = 2;
    value.steps[1].data.data.salePrice = 3290;
  });
  await expectRejectedCompletion((value) => {
    delete value.steps[1].data.data.salePrice;
  });
  await assert.rejects(
    fixture({ attemptStatus: "failed" }),
    /shared-admin source predicate remains false/,
  );
});
