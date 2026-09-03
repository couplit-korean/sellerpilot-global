import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901080000_allow_exact_existing_updates_through_closed_gate.sql",
  import.meta.url,
);
const currentCredentialFenceMigrationUrl = new URL(
  "../supabase/migrations/20260901082000_bind_ebay_exact_update_to_current_active_credential.sql",
  import.meta.url,
);
const coupangSanitizedContractMigrationUrl = new URL(
  "../supabase/migrations/20260901090000_fix_coupang_exact_sanitized_enqueue_contract.sql",
  import.meta.url,
);
const routeUrl = new URL(
  "../app/api/admin/channel-operations/route.ts",
  import.meta.url,
);
const releaseSha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

function extractTaggedDo(source, tag) {
  const marker = `$${tag}$`;
  const start = source.indexOf(`do ${marker}`);
  assert.notEqual(start, -1, `${tag} must exist`);
  const end = source.indexOf(`${marker};`, start + marker.length);
  assert.notEqual(end, -1, `${tag} end must exist`);
  return source.slice(start, end + marker.length + 1);
}

function assets() {
  return {
    contract: "sellerpilot_publication_asset_binding_v1",
    providerImageSurface: "detail_content",
    approvedDetailImages: Array.from({ length: 8 }, (_, index) => ({ index })),
    providerTransportImages: Array.from({ length: 8 }, (_, index) => ({ index })),
  };
}

function common(locale) {
  return {
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: locale,
    publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: fingerprint,
    sellerpilotPublicationAssetBinding: assets(),
  };
}

function coupangArguments() {
  return {
    ...common("ko-KR"),
    body: {
      sellerProductId: "16356981734",
      items: [{
        sellerpilotItemMatchId: "95962393877",
        modelNo: "QA-20260823-CC-001",
      }],
    },
    sellerpilotCoupangExactQaRecovery: {
      contract: "coupang_exact_qa_recovery_v1",
      phase: "listing.update",
      productId,
      listingId: "7ffc6e46-3173-4695-9889-5fa1529765f1",
      sellerProductId: "16356981734",
      vendorItemId: "95962393877",
      sellerSku: "QA-20260823-CC-001",
      sellerAccountLineage: "validated_by_service_rpc",
    },
  };
}

function elevenstArguments() {
  return {
    ...common("ko-KR"),
    productNo: "9573255804",
    product: {
      sellerPrdCd: "QA-20260823-CC-001",
      dispCtgrNo: "1341821",
      selPrc: "5000",
      prdSelQty: "1",
      prdImage01: "https://cdn.011st.com/product/9573255804/B.webp",
    },
    productPatch: { selPrc: "5000", prdSelQty: "1" },
    sellerpilotElevenstExactExistingPublication: {
      contract: "elevenst_exact_existing_publication_v1",
      productId,
      listingId: "363f3b81-f364-4f22-af4e-4920199904d0",
      credentialId: "b2dd0ff7-4420-495f-aead-a45857fb3bfe",
      remoteId: "9573255804",
      sellerSku: "QA-20260823-CC-001",
      categoryId: "1341821",
      priceKrw: 5000,
      stock: 1,
      sellerAccountLineage: "validated_by_service_rpc",
      trustedSnapshot: "sellerpilot_service_get_elevenst_listing_snapshot",
    },
  };
}

function ebayArguments() {
  const stock = 7;
  return {
    ...common("en-US"),
    listingId: "800551945442",
    sku: "QA-20260823-CC-001-US",
    marketplaceId: "EBAY_US",
    inventoryItem: {
      condition: "NEW",
      product: { imageUrls: ["https://i.ebayimg.com/images/g/example/s-l1600.jpg"] },
      availability: { shipToLocationAvailability: { quantity: stock } },
    },
    offer: {
      availableQuantity: stock,
      pricingSummary: { price: { currency: "USD", value: 12.9 } },
    },
    sellerpilotEbayExactExistingQaRecovery: {
      contract: "ebay_exact_existing_qa_recovery_v2",
      phase: "listing.update",
      productId,
      listingId: "8b2cbfaf-3854-437d-b381-abfd70291354",
      sourceAttemptId: "07b8ced8-fa77-4c22-a708-2ce1ec4e3c77",
      publicListingId: "800551945442",
      market: "US",
      marketplaceId: "EBAY_US",
      marketplaceSku: "QA-20260823-CC-001-US",
      offerId: "244042196011",
      currency: "USD",
      priceUsd: 12.9,
      stock,
      credentialId: "11111111-2222-4333-8444-555555555555",
      sellerAccountKey:
        "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f",
      offerIdSource: "immutable_lineage_attestation_v1",
      sellerAccountLineage: "validated_by_service_rpc",
    },
  };
}

test("closed-gate permit is exact-only, frozen, and strict one-shot", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /channel text not null[\s\S]*?channel = 'coupang'[\s\S]*?channel = 'elevenst'[\s\S]*?channel = 'ebay'/u);
  assert.match(migration, /credential_version integer not null/u);
  assert.match(migration, /credential_fingerprint text not null/u);
  assert.match(migration, /snapshot_payload_sha256 text/u);
  assert.match(migration, /exact_existing_update_lineage_is_current/u);
  assert.match(migration, /bind_exact_existing_update_claim/u);
  assert.match(migration, /job\.provider_mutation_started_at is null[\s\S]*?permit\.consumed_at is null/u);
  assert.match(migration, /set consumed_at = clock_timestamp\(\)/u);
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.listing_mutation_release_gate/iu,
  );
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.exact_existing_update_permits[\s\S]*?values\s*\([\s\S]*?\);\s*commit/iu,
    "the migration may define the arm RPC but must not synthesize a permit",
  );
  assert.match(
    migration,
    /p_channel in \('coupang', 'elevenst', 'ebay'\)/u,
  );
  assert.match(
    migration,
    /p_operation = 'listing\.update'[\s\S]*?p_channel = 'coupang'[\s\S]*?v_exact_permit_path := found/u,
    "markerless stop and generic operations must continue to the predecessor unless a closed-gate permit is actually bound",
  );
  assert.match(
    migration,
    /if v_exact_permit_path then[\s\S]*?sp_09010800_begin_gateway_before_exact_existing/u,
    "the provider wrapper must preserve the pre-existing open-gate path when no exact permit owns the job",
  );
  assert.match(
    migration,
    /to_jsonb\(new\) - 'consumed_at' is not distinct from[\s\S]*?to_jsonb\(old\) - 'consumed_at'/u,
  );
});

test("channel-specific SQL payload validators reject every near miss and Lazada", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const currentCredentialFenceMigration = await readFile(
    currentCredentialFenceMigrationUrl,
    "utf8",
  );
  const coupangSanitizedContractMigration = await readFile(
    coupangSanitizedContractMigrationUrl,
    "utf8",
  );
  const db = new PGlite();
  try {
    await db.exec("create schema sellerpilot_private");
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.exact_existing_update_arguments_valid(",
    ));
    await db.exec(extractTaggedDo(
      coupangSanitizedContractMigration,
      "patch_coupang_exact_sanitized_enqueue_contract",
    ));
    await db.exec(extractTaggedDo(
      currentCredentialFenceMigration,
      "patch_ebay_exact_argument_credential",
    ));
    const allowed = async (channel, value, stock) => (await db.query(
      `select sellerpilot_private.exact_existing_update_arguments_valid(
         $1,$2::jsonb,$3,$4,$5
       ) value`,
      [channel, JSON.stringify(value), releaseSha, fingerprint, stock],
    )).rows[0].value;

    const fixtures = [
      ["coupang", coupangArguments(), 1],
      ["elevenst", elevenstArguments(), 1],
      ["ebay", ebayArguments(), 7],
    ];
    for (const [channel, value, stock] of fixtures) {
      assert.equal(await allowed(channel, value, stock), true, channel);
      const wrongFingerprint = structuredClone(value);
      wrongFingerprint.publicationExpectedFingerprint = "c".repeat(64);
      assert.equal(await allowed(channel, wrongFingerprint, stock), false);
      const wrongImages = structuredClone(value);
      wrongImages.sellerpilotPublicationAssetBinding.approvedDetailImages.pop();
      assert.equal(await allowed(channel, wrongImages, stock), false);
    }

    const wrongCoupang = coupangArguments();
    wrongCoupang.sellerpilotCoupangExactQaRecovery.phase = "listing.stop";
    assert.equal(await allowed("coupang", wrongCoupang, 1), false);
    const browserCommerceCoupang = coupangArguments();
    browserCommerceCoupang.body.items[0].salePrice = 5000;
    assert.equal(await allowed("coupang", browserCommerceCoupang, 1), false);
    const wrongElevenst = elevenstArguments();
    wrongElevenst.sellerpilotElevenstExactExistingPublication.remoteId = "9573255805";
    assert.equal(await allowed("elevenst", wrongElevenst, 1), false);
    const wrongEbay = ebayArguments();
    wrongEbay.inventoryItem.product.title = "Client supplied copy";
    assert.equal(await allowed("ebay", wrongEbay, 7), false);
    const malformedEbayCredential = ebayArguments();
    malformedEbayCredential.sellerpilotEbayExactExistingQaRecovery.credentialId =
      "not-a-credential";
    assert.equal(await allowed("ebay", malformedEbayCredential, 7), false);
    assert.equal(await allowed("lazada", coupangArguments(), 1), false);
  } finally {
    await db.close();
  }
});

test("forward eBay credential fence keeps the exact remote tuple while removing the expiring token row", async () => {
  const [migration, route] = await Promise.all([
    readFile(currentCredentialFenceMigrationUrl, "utf8"),
    readFile(routeUrl, "utf8"),
  ]);
  assert.match(migration, /ebay_exact_current_credential_is_valid/u);
  assert.match(migration, /status = 'active'/u);
  assert.match(migration, /last_check_status = 'passed'/u);
  assert.match(migration, /seller_account_key_source = 'provider_certified_v1'/u);
  assert.match(migration, /credential\.version = \([\s\S]*?select max\(candidate\.version\)/u);
  assert.match(migration, /and 1 = \([\s\S]*?active_credential\.status = 'active'/u);
  for (const exactValue of [
    "800551945442",
    "244042196011",
    "QA-20260823-CC-001-US",
    "EBAY_US",
  ]) {
    assert.ok(migration.includes(exactValue), exactValue);
  }
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.exact_existing_update_permits/iu,
    "the forward migration must not arm a remote-write permit",
  );
  assert.doesNotMatch(migration, /qoo10/iu, "Qoo10 recovery must stay untouched");
  assert.match(
    route,
    /binding\.credentialId !== parsed\.data\.credentialId/u,
    "the server-owned RPC binding must match the credential selected by the request",
  );
});

test("permit transition trigger forbids hash swaps, delete, and provider replay", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec("create schema sellerpilot_private");
    await db.exec(`
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key,
        identity_value text not null,
        armed_at timestamptz not null,
        expires_at timestamptz not null,
        update_job_id uuid,
        update_attempt_id uuid,
        arguments_sha256 text,
        arguments_bytes integer,
        request_payload_sha256 text,
        request_payload_bytes integer,
        bound_at timestamptz,
        bound_worker_token_id uuid,
        bound_claim_token uuid,
        consumed_at timestamptz,
        invalidated_at timestamptz,
        invalidation_reason text
      )
    `);
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.guard_exact_existing_update_permit_transition(",
    ));
    await db.exec(`
      create trigger guard_exact_existing_update_permit_transition
      before update or delete
      on sellerpilot_private.exact_existing_update_permits
      for each row execute function
        sellerpilot_private.guard_exact_existing_update_permit_transition()
    `);
    const permitId = "10000000-0000-4000-8000-000000000001";
    const jobId = "10000000-0000-4000-8000-000000000002";
    const attemptId = "10000000-0000-4000-8000-000000000003";
    const workerId = "10000000-0000-4000-8000-000000000004";
    const claimId = "10000000-0000-4000-8000-000000000005";
    await db.query(`
      insert into sellerpilot_private.exact_existing_update_permits(
        permit_id,identity_value,armed_at,expires_at
      ) values($1,'exact',statement_timestamp(),statement_timestamp()+interval '5 minutes')
    `, [permitId]);
    await db.query(`
      update sellerpilot_private.exact_existing_update_permits
         set update_job_id=$2, update_attempt_id=$3,
             arguments_sha256=$4, arguments_bytes=101,
             request_payload_sha256=$5, request_payload_bytes=102
       where permit_id=$1
    `, [permitId, jobId, attemptId, "a".repeat(64), "b".repeat(64)]);
    await assert.rejects(
      db.query(`
        update sellerpilot_private.exact_existing_update_permits
           set bound_at=clock_timestamp(), bound_worker_token_id=$2,
               bound_claim_token=$3, arguments_sha256=$4
         where permit_id=$1
      `, [permitId, workerId, claimId, "c".repeat(64)]),
      /permit transition invalid/u,
    );
    await db.query(`
      update sellerpilot_private.exact_existing_update_permits
         set bound_at=clock_timestamp(), bound_worker_token_id=$2,
             bound_claim_token=$3
       where permit_id=$1
    `, [permitId, workerId, claimId]);
    await db.query(`
      update sellerpilot_private.exact_existing_update_permits
         set consumed_at=clock_timestamp()
       where permit_id=$1
    `, [permitId]);
    await assert.rejects(
      db.query(`
        update sellerpilot_private.exact_existing_update_permits
           set consumed_at=clock_timestamp()
         where permit_id=$1
      `, [permitId]),
      /permit transition invalid/u,
    );
    await assert.rejects(
      db.query(
        "delete from sellerpilot_private.exact_existing_update_permits where permit_id=$1",
        [permitId],
      ),
      /cannot be deleted/u,
    );
  } finally {
    await db.close();
  }
});

test("one permit binds one enqueue, first claim, and provider boundary while stop delegates", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const listingId = "7ffc6e46-3173-4695-9889-5fa1529765f1";
  const credentialId = "20000000-0000-4000-8000-000000000001";
  const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
  const attemptId = "20000000-0000-4000-8000-000000000002";
  const stopAttemptId = "20000000-0000-4000-8000-000000000003";
  const workerId = "20000000-0000-4000-8000-000000000004";
  const claimId = "20000000-0000-4000-8000-000000000005";
  const sellerAccountKey = "d".repeat(64);
  const payload = {
    arguments: {
      publicationExpectedFingerprint: fingerprint,
      sellerpilotCoupangExactQaRecovery: {
        contract: "coupang_exact_qa_recovery_v1",
      },
    },
  };
  try {
    await db.exec(`
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm) = 'sha256'
          then sha256(convert_to(value, 'UTF8'))
          else convert_to(md5(value || algorithm), 'UTF8')
        end
      $$;
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key,
        owner_id uuid not null,
        credential_id uuid not null,
        channel text not null,
        operation text not null,
        status text not null,
        seller_account_key text not null,
        request_fingerprint text not null
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key default gen_random_uuid(),
        attempt_id uuid not null,
        listing_id uuid not null,
        credential_id uuid not null,
        channel text not null,
        operation text not null,
        environment text not null,
        status text not null,
        attempt_count integer not null,
        seller_account_key text not null,
        request_fingerprint text not null,
        request_payload jsonb not null,
        worker_token_id uuid,
        claim_token uuid,
        lease_expires_at timestamptz,
        started_at timestamptz,
        completed_at timestamptz,
        response_payload jsonb,
        provider_mutation_started_at timestamptz,
        error_message text,
        updated_at timestamptz not null default clock_timestamp()
      );
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key,
        channel text not null,
        listing_id uuid not null,
        product_id uuid not null,
        credential_id uuid not null,
        owner_id uuid not null,
        market text not null,
        target_id text not null,
        remote_id text not null,
        seller_sku text not null,
        provider_resource_id text,
        currency text not null,
        price numeric not null,
        stock integer not null,
        seller_account_key text not null,
        credential_version integer not null,
        credential_fingerprint text not null,
        credential_account_source text not null,
        credential_verified_at timestamptz not null,
        credential_expires_at timestamptz,
        credential_last_checked_at timestamptz,
        credential_last_check_status text,
        snapshot_revision bigint,
        snapshot_payload_sha256 text,
        snapshot_source_job_id uuid,
        release_sha text not null,
        request_fingerprint text not null,
        armed_at timestamptz not null,
        expires_at timestamptz not null,
        update_job_id uuid,
        update_attempt_id uuid,
        arguments_sha256 text,
        arguments_bytes integer,
        request_payload_sha256 text,
        request_payload_bytes integer,
        bound_at timestamptz,
        bound_worker_token_id uuid,
        bound_claim_token uuid,
        consumed_at timestamptz,
        invalidated_at timestamptz,
        invalidation_reason text
      );
      create function sellerpilot_private.exact_existing_update_lineage_is_current(
        value uuid
      ) returns boolean language sql stable as $$
        select exists (
          select 1 from sellerpilot_private.exact_existing_update_permits
           where permit_id = value and invalidated_at is null
             and expires_at > statement_timestamp()
        )
      $$;
      create function sellerpilot_private.exact_existing_update_arguments_valid(
        requested_channel text, value jsonb, current_release text,
        expected_fingerprint text, expected_stock integer
      ) returns boolean language sql immutable as $$
        select requested_channel = 'coupang'
          and value#>>'{sellerpilotCoupangExactQaRecovery,contract}' =
                'coupang_exact_qa_recovery_v1'
          and value->>'publicationExpectedFingerprint' = expected_fingerprint
          and current_release = '${releaseSha}' and expected_stock = 1
      $$;
    `);
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.guard_exact_existing_update_permit_transition(",
    ));
    await db.exec(`
      create trigger guard_exact_existing_update_permit_transition
      before update or delete
      on sellerpilot_private.exact_existing_update_permits
      for each row execute function
        sellerpilot_private.guard_exact_existing_update_permit_transition()
    `);
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(",
    ));
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.bind_exact_existing_update_claim(",
    ));
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.exact_existing_update_provider_allowed(",
    ));
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.consume_exact_existing_update_provider(",
    ));
    await db.exec(`
      create function public.sp_09010800_enqueue_before_exact_existing_permit(
        p_listing_id uuid, p_credential_id uuid, p_attempt_id uuid,
        p_channel text, p_operation text, p_request_payload jsonb
      ) returns jsonb language plpgsql set search_path='' as $$
      declare v_job_id uuid;
      begin
        insert into sellerpilot_private.channel_gateway_jobs(
          attempt_id,listing_id,credential_id,channel,operation,environment,
          status,attempt_count,seller_account_key,request_fingerprint,
          request_payload
        )
        select p_attempt_id,p_listing_id,p_credential_id,p_channel,p_operation,
               'production','queued',0,attempt.seller_account_key,
               attempt.request_fingerprint,p_request_payload
          from sellerpilot_private.channel_operation_attempts attempt
         where attempt.id=p_attempt_id
        returning id into v_job_id;
        return jsonb_build_object('job_id',v_job_id,'status','queued');
      end;
      $$;
    `);
    await db.exec(extractFunction(
      migration,
      "create function public.sellerpilot_service_enqueue_listing_gateway_job(",
    ));
    await db.query(`
      insert into sellerpilot_private.channel_operation_attempts(
        id,owner_id,credential_id,channel,operation,status,
        seller_account_key,request_fingerprint
      ) values
        ($1,$2,$3,'coupang','listing.update','running',$4,$5),
        ($6,$2,$3,'coupang','listing.stop','running',$4,$5)
    `, [attemptId, ownerId, credentialId, sellerAccountKey, fingerprint, stopAttemptId]);
    await db.query(`
      insert into sellerpilot_private.exact_existing_update_permits(
        permit_id,channel,listing_id,product_id,credential_id,owner_id,market,
        target_id,remote_id,seller_sku,provider_resource_id,currency,price,
        stock,seller_account_key,credential_version,credential_fingerprint,
        credential_account_source,credential_verified_at,release_sha,
        request_fingerprint,armed_at,expires_at
      ) values(
        '20000000-0000-4000-8000-000000000006','coupang',$1,$2,$3,$4,
        'KR','KR','16356981734','QA-20260823-CC-001','95962393877',
        'KRW',5000,1,$5,1,'ABCDEF123456','credential_incarnation_v1',
        clock_timestamp(),$6,$7,clock_timestamp(),
        clock_timestamp()+interval '5 minutes'
      )
    `, [listingId, productId, credentialId, ownerId, sellerAccountKey, releaseSha, fingerprint]);

    const bypass = await db.query(`
      select sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
        $1,$2,$3,'coupang','listing.update',$4::jsonb
      ) value
    `, [listingId, credentialId, attemptId, JSON.stringify(payload)]);
    assert.equal(bypass.rows[0].value, true);
    const enqueued = await db.query(`
      select public.sellerpilot_service_enqueue_listing_gateway_job(
        $1,$2,$3,'coupang','listing.update',$4::jsonb
      ) value
    `, [listingId, credentialId, attemptId, JSON.stringify(payload)]);
    const jobId = enqueued.rows[0].value.job_id;
    const bound = await db.query(`
      select update_job_id,update_attempt_id,arguments_sha256,
             request_payload_sha256
        from sellerpilot_private.exact_existing_update_permits
    `);
    assert.equal(bound.rows[0].update_job_id, jobId);
    assert.equal(bound.rows[0].update_attempt_id, attemptId);
    assert.match(bound.rows[0].arguments_sha256, /^[a-f0-9]{64}$/u);
    assert.match(bound.rows[0].request_payload_sha256, /^[a-f0-9]{64}$/u);

    const claim = await db.query(`
      select sellerpilot_private.bind_exact_existing_update_claim(
        to_jsonb(job),
        to_jsonb(job) || jsonb_build_object(
          'status','running','worker_token_id',$2::uuid,
          'claim_token',$3::uuid,'attempt_count',1,
          'lease_expires_at',clock_timestamp()+interval '10 minutes',
          'started_at',clock_timestamp(),'updated_at',clock_timestamp()
        )
      ) value
        from sellerpilot_private.channel_gateway_jobs job where job.id=$1
    `, [jobId, workerId, claimId]);
    assert.equal(claim.rows[0].value, true);
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set status='running',worker_token_id=$2,claim_token=$3,
             attempt_count=1,lease_expires_at=clock_timestamp()+interval '10 minutes',
             started_at=clock_timestamp(),updated_at=clock_timestamp()
       where id=$1
    `, [jobId, workerId, claimId]);
    const beforeProvider = await db.query(`
      select sellerpilot_private.exact_existing_update_provider_allowed($1,$2) value
    `, [jobId, claimId]);
    assert.equal(beforeProvider.rows[0].value, true);
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at=clock_timestamp() where id=$1
    `, [jobId]);
    const consumed = await db.query(`
      select sellerpilot_private.consume_exact_existing_update_provider($1,$2) value
    `, [jobId, claimId]);
    assert.equal(consumed.rows[0].value, true);
    const replay = await db.query(`
      select sellerpilot_private.consume_exact_existing_update_provider($1,$2) value,
             sellerpilot_private.exact_existing_update_provider_allowed($1,$2) allowed
    `, [jobId, claimId]);
    assert.equal(replay.rows[0].value, false);
    assert.equal(replay.rows[0].allowed, false);

    const delegatedStop = await db.query(`
      select public.sellerpilot_service_enqueue_listing_gateway_job(
        $1,$2,$3,'coupang','listing.stop','{"arguments":{}}'::jsonb
      ) value
    `, [listingId, credentialId, stopAttemptId]);
    assert.equal(delegatedStop.rows[0].value.status, "queued");
    const jobCount = await db.query(
      "select count(*)::integer value from sellerpilot_private.channel_gateway_jobs",
    );
    assert.equal(jobCount.rows[0].value, 2);
  } finally {
    await db.close();
  }
});

test("route arms the exact permit after the final fingerprint and before claim", async () => {
  const route = await readFile(routeUrl, "utf8");
  const fingerprint = route.indexOf('const baseRequestFingerprint = createHash("sha256")');
  const arm = route.indexOf('"sellerpilot_service_arm_coupang_exact_rep"');
  const claim = route.indexOf('"sellerpilot_claim_channel_operation"');
  assert.ok(fingerprint >= 0 && arm > fingerprint && claim > arm);
  assert.match(
    route,
    /"coupang" \| "elevenst" \| "ebay" \| "lazada" \| "temu" \| null/u,
  );
  assert.match(
    route,
    /boundLazadaExactExistingUpdate = binding;\s*boundExactExistingClosedGateUpdateChannel = "lazada";/u,
  );
  assert.match(
    route,
    /boundCoupangExactQaRecoveryPhase = "listing\.update";\s*boundExactExistingClosedGateUpdateChannel = "coupang";/u,
  );
  assert.match(
    route,
    /operation === "listing\.stop"[\s\S]{0,120}boundCoupangExactQaRecoveryPhase = "listing\.stop";/u,
  );
  assert.match(
    route,
    /!channelReleaseGateIsEffective[\s\S]{0,240}!exactExistingUpdatePermitArmed/u,
  );
});
