import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildChannelArguments } from "../app/product-publish-workbench";
import {
  bindCoupangExactQaRecoveryArguments,
  bindCoupangExactQaUpdateItemIdentity,
  coupangExactQaRecoveryIdentity,
} from "../lib/channels/coupang-exact-qa-recovery";
import { prepareListingUpdateArguments } from "../lib/channels/listing-update";

const closedGateMigrationUrl = new URL(
  "../supabase/migrations/20260901080000_allow_exact_existing_updates_through_closed_gate.sql",
  import.meta.url,
);
const sanitizedContractMigrationUrl = new URL(
  "../supabase/migrations/20260901090000_fix_coupang_exact_sanitized_enqueue_contract.sql",
  import.meta.url,
);
const channelOperationsRouteUrl = new URL(
  "../app/api/admin/channel-operations/route.ts",
  import.meta.url,
);
const releaseSha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const credentialId = "20000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000002";
const sellerAccountKey = "c".repeat(64);

function extractFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

function extractTaggedDo(source: string, tag: string) {
  const marker = `$${tag}$`;
  const start = source.indexOf(`do ${marker}`);
  assert.notEqual(start, -1, `${tag} must exist`);
  const end = source.indexOf(`${marker};`, start + marker.length);
  assert.notEqual(end, -1, `${tag} end must exist`);
  return source.slice(start, end + marker.length + 1);
}

function workbenchContext(): Parameters<typeof buildChannelArguments>[1] {
  const classification = {
    displayName: "케이블 정리 클립",
    verificationStatus: "verified" as const,
    evidence: "판매자 확인 QA 자료",
    isHealthFunctionalFood: false,
  };
  const detailRoles = [
    "detail-overview",
    "detail-feature",
    "detail-use",
    "detail-dimensions",
    "detail-routine",
    "detail-contents",
    "detail-care",
    "detail-package",
  ];
  return {
    contentMode: "ai_generated",
    product: {
      id: coupangExactQaRecoveryIdentity.productId,
      externalCode: coupangExactQaRecoveryIdentity.sellerSku,
      sku: coupangExactQaRecoveryIdentity.sellerSku,
      name: coupangExactQaRecoveryIdentity.sellerProductName,
      description: "책상 위 충전 케이블을 정돈하는 부착형 클립 여섯 개 구성입니다.",
      sourceUrl: null,
      status: "draft",
      classification,
    },
    classification,
    manualFields: {
      productName: coupangExactQaRecoveryIdentity.sellerProductName,
      description: "책상 위 충전 케이블을 정돈하는 부착형 클립 여섯 개 구성입니다.",
      sellerSku: coupangExactQaRecoveryIdentity.sellerSku,
      categoryHint: "케이블 정리소품",
      brandName: coupangExactQaRecoveryIdentity.brand,
      manufacturer: coupangExactQaRecoveryIdentity.manufacturer,
      countryOfOrigin: coupangExactQaRecoveryIdentity.countryOfOriginName,
      material: "실리콘",
      packageContents: "6개 세트",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: coupangExactQaRecoveryIdentity.priceKrw,
      currency: coupangExactQaRecoveryIdentity.currency,
      stock: coupangExactQaRecoveryIdentity.stock,
      weightKg: 0.1,
      packageLengthCm: 10,
      packageWidthCm: 8,
      packageHeightCm: 2,
    },
    imageSpecs: [],
    assignments: [{
      channel: "coupang",
      market: "KR",
      categoryId: String(coupangExactQaRecoveryIdentity.displayCategoryCode),
      categoryPath: ["케이블 정리소품"],
      providedAttributes: {},
      status: "confirmed",
      confirmedAt: "2026-09-01T00:00:00.000Z",
    }],
    listings: [{
      id: coupangExactQaRecoveryIdentity.listingId,
      channel: "coupang",
      market: "KR",
      targetId: "KR",
      remoteId: coupangExactQaRecoveryIdentity.sellerProductId,
      marketplaceSku: null,
      status: "failed",
      lastError: "pre-gateway failure",
      failureClass: "external_action",
      publishedAt: null,
      requestedPublicationIntent: "live",
      remoteVisibility: "unknown",
      providerStatus: null,
    }],
    sourceImages: [{
      path: "owner/job/input/normalized/0.jpg",
      url: "https://cdn.example.com/source.jpg",
    }],
    generatedImages: ["square", "hero", ...detailRoles].map((id, index) => ({
      id,
      path: `owner/job/generated/${id}.jpg`,
      url: `https://cdn.example.com/generated-${index}-${id}.jpg`,
    })),
    localizedListings: [{
      channel: "coupang",
      market: "KR",
      locale: "ko-KR",
      title: coupangExactQaRecoveryIdentity.sellerProductName,
      shortDescription: "케이블을 깔끔하게 정리하는 여섯 개 세트입니다.",
      description: "책상 위 충전 케이블을 정돈하는 부착형 클립 여섯 개 구성입니다.",
      keywords: ["케이블 정리"],
      thumbnailAltText: "케이블 정리 클립",
      classification,
      detailSections: detailRoles.map((imageAsset, index) => ({
        type: "feature",
        buyerQuestion: `질문 ${index + 1}`,
        evidence: `근거 ${index + 1}`,
        heading: `상세 ${index + 1}`,
        body: `상품 상세 설명 ${index + 1}`,
        imageAsset,
        imageAltText: `상세 이미지 ${index + 1}`,
      })),
    }],
  };
}

test("Workbench draft reaches the exact DB enqueue only after server vendorItemId binding", async () => {
  const route = await readFile(channelOperationsRouteUrl, "utf8");
  const identityRpc = route.indexOf(
    '"sellerpilot_service_get_coupang_exact_qa_recovery_identity"',
  );
  const serverBinding = route.indexOf(
    "bindCoupangExactQaUpdateItemIdentity(effectiveArguments)",
  );
  const requestFingerprintBinding = route.indexOf(
    'const requestFingerprint = createHash("sha256")',
  );
  assert.ok(identityRpc >= 0 && identityRpc < serverBinding);
  assert.ok(serverBinding < requestFingerprintBinding);

  const context = workbenchContext();
  const listing = context.listings[0]!;
  const draft = buildChannelArguments(
    "coupang",
    context,
    coupangExactQaRecoveryIdentity.priceKrw,
    coupangExactQaRecoveryIdentity.stock,
    undefined,
    { weight: 0.1, length: 10, width: 8, height: 2 },
    12.9,
  );
  const prepared = prepareListingUpdateArguments("coupang", draft, {
    ...listing,
    listingId: listing.id,
  });
  const preparedItem = ((prepared.body as Record<string, unknown>).items as Array<Record<string, unknown>>)[0]!;
  assert.equal(preparedItem.sellerpilotItemMatchId, coupangExactQaRecoveryIdentity.sellerSku);

  const serverBound = bindCoupangExactQaUpdateItemIdentity(
    bindCoupangExactQaRecoveryArguments(prepared, "listing.update"),
  );
  const transportBinding = {
    contract: "sellerpilot_publication_asset_binding_v1",
    providerImageSurface: "detail_content",
    approvedDetailImages: Array.from({ length: 8 }, (_, index) => ({ index })),
    providerTransportImages: Array.from({ length: 8 }, (_, index) => ({ index })),
  };
  const finalArguments = {
    ...serverBound,
    sellerpilotPublicationAssetBinding: transportBinding,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: fingerprint,
  };
  const finalItem = ((finalArguments.body as Record<string, unknown>).items as Array<Record<string, unknown>>)[0]!;
  assert.equal(finalItem.sellerpilotItemMatchId, coupangExactQaRecoveryIdentity.vendorItemId);
  for (const forbidden of ["externalVendorSku", "originalPrice", "salePrice", "maximumBuyCount"]) {
    assert.equal(Object.hasOwn(finalItem, forbidden), false, forbidden);
  }

  const [closedGateMigration, sanitizedContractMigration] = await Promise.all([
    readFile(closedGateMigrationUrl, "utf8"),
    readFile(sanitizedContractMigrationUrl, "utf8"),
  ]);
  const db = new PGlite();
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
        id uuid primary key, owner_id uuid not null, credential_id uuid not null,
        channel text not null, operation text not null, status text not null,
        seller_account_key text not null, request_fingerprint text not null
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key default gen_random_uuid(), attempt_id uuid not null,
        listing_id uuid not null, credential_id uuid not null,
        channel text not null, operation text not null, environment text not null,
        status text not null, attempt_count integer not null,
        seller_account_key text not null, request_fingerprint text not null,
        request_payload jsonb not null, worker_token_id uuid, claim_token uuid,
        lease_expires_at timestamptz, started_at timestamptz,
        completed_at timestamptz, response_payload jsonb,
        provider_mutation_started_at timestamptz, error_message text,
        updated_at timestamptz not null default clock_timestamp()
      );
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key, channel text not null, listing_id uuid not null,
        product_id uuid not null, credential_id uuid not null, owner_id uuid not null,
        market text not null, target_id text not null, remote_id text not null,
        seller_sku text not null, provider_resource_id text, currency text not null,
        price numeric not null, stock integer not null, seller_account_key text not null,
        credential_version integer not null, credential_fingerprint text not null,
        credential_account_source text not null, credential_verified_at timestamptz not null,
        credential_expires_at timestamptz, credential_last_checked_at timestamptz,
        credential_last_check_status text, snapshot_revision bigint,
        snapshot_payload_sha256 text, snapshot_source_job_id uuid,
        release_sha text not null, request_fingerprint text not null,
        armed_at timestamptz not null, expires_at timestamptz not null,
        update_job_id uuid, update_attempt_id uuid, arguments_sha256 text,
        arguments_bytes integer, request_payload_sha256 text,
        request_payload_bytes integer, bound_at timestamptz,
        bound_worker_token_id uuid, bound_claim_token uuid,
        consumed_at timestamptz, invalidated_at timestamptz,
        invalidation_reason text
      );
    `);
    await db.exec(extractFunction(
      closedGateMigration,
      "create function sellerpilot_private.exact_existing_update_arguments_valid(",
    ));
    await db.exec(extractTaggedDo(
      sanitizedContractMigration,
      "patch_coupang_exact_sanitized_enqueue_contract",
    ));
    await db.exec(`
      create function sellerpilot_private.exact_existing_update_lineage_is_current(
        value uuid
      ) returns boolean language sql stable as $$
        select exists (
          select 1 from sellerpilot_private.exact_existing_update_permits
           where permit_id=value and invalidated_at is null
             and expires_at > statement_timestamp()
        )
      $$;
    `);
    await db.exec(extractFunction(
      closedGateMigration,
      "create function sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(",
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
          status,attempt_count,seller_account_key,request_fingerprint,request_payload
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
      closedGateMigration,
      "create function public.sellerpilot_service_enqueue_listing_gateway_job(",
    ));
    await db.query(`
      insert into sellerpilot_private.channel_operation_attempts(
        id,owner_id,credential_id,channel,operation,status,
        seller_account_key,request_fingerprint
      ) values ($1,$2,$3,'coupang','listing.update','running',$4,$5)
    `, [attemptId, ownerId, credentialId, sellerAccountKey, fingerprint]);
    await db.query(`
      insert into sellerpilot_private.exact_existing_update_permits(
        permit_id,channel,listing_id,product_id,credential_id,owner_id,market,
        target_id,remote_id,seller_sku,provider_resource_id,currency,price,stock,
        seller_account_key,credential_version,credential_fingerprint,
        credential_account_source,credential_verified_at,release_sha,
        request_fingerprint,armed_at,expires_at
      ) values(
        '20000000-0000-4000-8000-000000000006','coupang',$1,$2,$3,$4,
        'KR','KR','16356981734','QA-20260823-CC-001','95962393877','KRW',5000,1,
        $5,1,'ABCDEF123456','credential_incarnation_v1',clock_timestamp(),$6,$7,
        clock_timestamp(),clock_timestamp()+interval '5 minutes'
      )
    `, [
      coupangExactQaRecoveryIdentity.listingId,
      coupangExactQaRecoveryIdentity.productId,
      credentialId,
      ownerId,
      sellerAccountKey,
      releaseSha,
      fingerprint,
    ]);
    const payload = { arguments: finalArguments };
    const validator = await db.query(`
      select sellerpilot_private.exact_existing_update_arguments_valid(
        'coupang',$1::jsonb,$2,$3,1
      ) value
    `, [JSON.stringify(finalArguments), releaseSha, fingerprint]);
    assert.equal(validator.rows[0]?.value, true);
    const enqueued = await db.query(`
      select public.sellerpilot_service_enqueue_listing_gateway_job(
        $1,$2,$3,'coupang','listing.update',$4::jsonb
      ) value
    `, [
      coupangExactQaRecoveryIdentity.listingId,
      credentialId,
      attemptId,
      JSON.stringify(payload),
    ]);
    assert.equal(enqueued.rows[0]?.value.status, "queued");
    const job = (await db.query(`
      select status,
             request_payload#>>'{arguments,body,items,0,sellerpilotItemMatchId}' item_match_id
        from sellerpilot_private.channel_gateway_jobs
    `)).rows[0];
    assert.deepEqual(job, { status: "queued", item_match_id: "95962393877" });
  } finally {
    await db.close();
  }
});
