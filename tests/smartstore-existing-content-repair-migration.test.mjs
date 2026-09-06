import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  claim,
  complete,
  createDatabase,
  enqueue,
  ids,
  job,
  tokenHash,
  workerVersion,
} from './smartstore-adoption-gateway-migration.test.mjs';

const statusNameMigration = await readFile(new URL(
  '../supabase/migrations/20260907170000_smartstore_readback_status_rpc_name.sql',
  import.meta.url,
), 'utf8');
const officialIdentityMigration = await readFile(new URL(
  '../supabase/migrations/20260907171000_smartstore_official_get_identity.sql',
  import.meta.url,
), 'utf8');
const repairMigration = await readFile(new URL(
  '../supabase/migrations/20260907174000_smartstore_existing_remote_content_repair.sql',
  import.meta.url,
), 'utf8');
const sellerLineageMigration = await readFile(new URL(
  '../supabase/migrations/20260825111800_bind_listing_seller_accounts.sql',
  import.meta.url,
), 'utf8');

function extractDefinition(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing SQL definition: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing SQL terminator: ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

const originalSellerLineageDefinition = extractDefinition(
  sellerLineageMigration,
  'create or replace function sellerpilot_private.guard_gateway_job_seller_lineage()',
  '\n$$;',
);
const sellerLineagePreimage = `      if new.operation in ('listing.update', 'listing.stop') and (
        v_listing.operation_attempt_id is distinct from new.attempt_id
        or v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) then`;
const sellerLineagePostimage = `      if new.operation in ('listing.update', 'listing.stop') and (
        v_listing.operation_attempt_id is distinct from new.attempt_id
        or v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) and not sellerpilot_private.temu_containment_seller_lineage_allowed(
        to_jsonb(new),to_jsonb(v_listing)
      ) then`;
assert.ok(originalSellerLineageDefinition.includes(sellerLineagePreimage));
const currentSellerLineageDefinition = originalSellerLineageDefinition.replace(
  sellerLineagePreimage,
  sellerLineagePostimage,
);

const sellerSku = 'AUTO-GENERIC-SMARTSTORE-001';
const originProductNo = '13688607602';
const channelProductNo = '13749310594';
const sellerAccountKey = 'c'.repeat(64);
const approvedContentSha256 = 'b'.repeat(64);
const approvedSourceSha256s = ['1', '2', '3', '4', '5', '6', 'a', 'b']
  .map((character) => character.repeat(64));
const normalizedContentSha256s = Array.from(
  { length: 9 },
  (_, index) => (index + 16).toString(16).padStart(64, '0'),
);
const normalizedUrls = normalizedContentSha256s.map((digest) =>
  `https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/`+
  `sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`);
const representativeUrl = normalizedUrls[0];
const approvedDetailUrls = normalizedUrls.slice(1);
const transportPixelsByUrl = new Map(approvedDetailUrls.map((url, index) => [
  url,
  createHash('sha256').update(`transport-${index}`).digest('hex'),
]));
const providerDetailUrls = Array.from(
  { length: 8 },
  (_, index) => `https://shop-phinf.pstatic.net/detail/verified-${index + 1}.jpg`,
);
const providerRepresentativeUrl = 'https://shop-phinf.pstatic.net/representative/verified.jpg';

function detailHtml(urls, title = '승인된 상품 설명') {
  return `<section class="approved-detail"><p>${title}</p>${
    urls.map((url) => `<img src="${url}" alt="detail">`).join('')}</section>`;
}

function exactAssetBinding() {
  const approvedDetailImages = approvedDetailUrls.map((publicUrl, index) => ({
    role: `detail-${index + 1}`,
    approvedObjectPath: `approved/detail-${index + 1}.png`,
    approvedSourceSha256: approvedSourceSha256s[index],
    sourceObjectPath: `approved/detail-${index + 1}.png`,
    sourceSha256: approvedSourceSha256s[index],
    publicUrl,
    objectPath: `normalized/${normalizedContentSha256s[index + 1].slice(0, 2)}/${normalizedContentSha256s[index + 1]}.jpg`,
    contentSha256: normalizedContentSha256s[index + 1],
  }));
  return {
    contract: 'sellerpilot_publication_asset_binding_v1',
    approvedDetailPageVersion: 2,
    approvedManifestDigest: null,
    approvedDetailImages,
    providerImageSurface: 'gallery',
    providerTransportImages: [{
      role: 'gallery-representative',
      approvedObjectPath: 'approved/representative.png',
      approvedSourceSha256: '9'.repeat(64),
      sourceObjectPath: 'approved/representative.png',
      sourceSha256: '9'.repeat(64),
      publicUrl: representativeUrl,
      objectPath: `normalized/${normalizedContentSha256s[0].slice(0, 2)}/${normalizedContentSha256s[0]}.jpg`,
      contentSha256: normalizedContentSha256s[0],
    }, ...approvedDetailImages],
  };
}

function legacyReadback({ arbitraryUrl = false } = {}) {
  const remoteUrls = [
    approvedDetailUrls[0], approvedDetailUrls[2], approvedDetailUrls[1],
    ...approvedDetailUrls.slice(3),
  ];
  if (arbitraryUrl) remoteUrls[4] = 'https://untrusted.example/detail-5.jpg';
  const remotePixels = remoteUrls.map((url, index) =>
    transportPixelsByUrl.get(url) ?? `${index + 1}`.repeat(64));
  const images = {
    representativeImage: { url: 'http://shop1.phinf.naver.net/legacy-representative.jpg' },
    optionalImages: approvedDetailUrls.slice(0, 2).map((url) => ({ url })),
  };
  const originProduct = {
    name: '기존 판매자센터 상품명',
    salePrice: 3190,
    stockQuantity: 1,
    statusType: 'SALE',
    detailContent: detailHtml(remoteUrls),
    detailAttribute: { sellerCodeInfo: { sellerManagementCode: sellerSku } },
    images,
  };
  return {
    contract: 'smartstore_official_manual_adoption_readback_v1',
    source: 'smartstore_official_api_readback_v1',
    observedAt: new Date(Date.now() - 10_000).toISOString(),
    providerMutationPerformed: false,
    searchReadback: {
      method: 'POST', path: '/v1/products/search', httpStatus: 200,
      request: {
        searchKeywordType: 'SELLER_CODE', sellerManagementCode: sellerSku,
        page: 1, size: 50, orderType: 'NO',
      },
      response: {
        page: 1, size: 50, totalElements: 1, totalPages: 1,
        first: true, last: true,
        contents: [{
          originProductNo,
          channelProducts: [{
            originProductNo,
            channelProductNo,
            sellerManagementCode: sellerSku,
          }],
        }],
      },
    },
    originReadback: {
      method: 'GET', path: `/v2/products/origin-products/${originProductNo}`,
      httpStatus: 200, request: null,
      response: {
        originProduct: structuredClone(originProduct),
        smartstoreChannelProduct: {},
      },
    },
    channelReadback: {
      method: 'GET', path: `/v2/products/channel-products/${channelProductNo}`,
      httpStatus: 200, request: null,
      response: {
        originProduct: structuredClone(originProduct),
        smartstoreChannelProduct: {
          channelProductName: '기존 판매자센터 상품명',
          channelProductDisplayStatusType: 'ON',
        },
      },
    },
    detailImageUrls: remoteUrls,
    detailImagePixelSha256s: remotePixels,
  };
}

function providerReadback(transmissionPixels) {
  const images = {
    representativeImage: { url: providerRepresentativeUrl },
    optionalImages: providerDetailUrls.map((url) => ({ url })),
  };
  const originProduct = {
    name: '롯샌 파인애플 315g',
    salePrice: 3190,
    stockQuantity: 1,
    statusType: 'SALE',
    detailContent: detailHtml(providerDetailUrls),
    detailAttribute: { sellerCodeInfo: { sellerManagementCode: sellerSku } },
    images,
  };
  return {
    contract: 'smartstore_official_manual_adoption_readback_v1',
    source: 'smartstore_official_api_readback_v1',
    observedAt: new Date().toISOString(),
    providerMutationPerformed: false,
    searchReadback: {
      method: 'POST', path: '/v1/products/search', httpStatus: 200,
      request: {
        searchKeywordType: 'SELLER_CODE', sellerManagementCode: sellerSku,
        page: 1, size: 50, orderType: 'NO',
      },
      response: {
        page: 1, size: 50, totalElements: 1, totalPages: 1,
        first: true, last: true,
        contents: [{
          originProductNo,
          channelProducts: [{
            originProductNo,
            channelProductNo,
            sellerManagementCode: sellerSku,
          }],
        }],
      },
    },
    originReadback: {
      method: 'GET', path: `/v2/products/origin-products/${originProductNo}`,
      httpStatus: 200, request: null,
      response: { originProduct: structuredClone(originProduct), smartstoreChannelProduct: {} },
    },
    channelReadback: {
      method: 'GET', path: `/v2/products/channel-products/${channelProductNo}`,
      httpStatus: 200, request: null,
      response: {
        originProduct: structuredClone(originProduct),
        smartstoreChannelProduct: {
          channelProductName: '롯샌 파인애플 315g',
          channelProductDisplayStatusType: 'ON',
        },
      },
    },
    detailImageUrls: providerDetailUrls,
    detailImagePixelSha256s: transmissionPixels,
  };
}

async function createRepairDatabase() {
  const db = await createDatabase();
  await db.exec(`
    alter table sellerpilot_private.channel_gateway_jobs add column started_at timestamptz;
    create table sellerpilot_private.marketplace_normalized_assets(
      object_path text primary key, content_sha256 text not null,
      status text not null, uploaded_at timestamptz
    );
    create table sellerpilot_private.marketplace_normalized_asset_refs(
      object_path text not null, attempt_id uuid not null, owner_id uuid,
      product_id uuid, channel text, market text, target_id text,
      upload_confirmed_at timestamptz, canonical_public_url text,
      source_object_path text, source_content_sha256 text
    );
    create table sellerpilot_private.channel_market_targets(
      credential_id uuid, channel text, market_code text, target_id text
    );

    create or replace function sellerpilot_private.external_detail_asset_binding_is_current(
      p_binding jsonb,p_manifest jsonb,p_version bigint,p_attempt uuid
    ) returns boolean language sql stable security definer set search_path='' as $$
      select p_binding->>'contract'='sellerpilot_publication_asset_binding_v1'
        and p_binding->>'providerImageSurface'='gallery'
        and p_binding->>'approvedManifestDigest'=p_manifest->>'digest'
        and p_binding->>'approvedDetailPageVersion'=p_version::text
        and jsonb_array_length(p_binding->'approvedDetailImages')=8
        and jsonb_array_length(p_binding->'providerTransportImages')=9
        and p_binding#>>'{providerTransportImages,0,role}'='gallery-representative'
        and p_binding->'approvedDetailImages'=(
          select jsonb_agg(value order by ordinal)
          from jsonb_array_elements(p_binding->'providerTransportImages')
            with ordinality image(value,ordinal)
          where ordinal>1
        )
        and not exists (
          select 1 from jsonb_array_elements(p_binding->'providerTransportImages') image(value)
          where not exists (
            select 1 from sellerpilot_private.marketplace_normalized_asset_refs ref
            join sellerpilot_private.marketplace_normalized_assets asset
              on asset.object_path=ref.object_path
            where ref.attempt_id=p_attempt
              and ref.object_path=image.value->>'objectPath'
              and ref.canonical_public_url=image.value->>'publicUrl'
              and ref.source_object_path=image.value->>'approvedObjectPath'
              and ref.source_content_sha256=image.value->>'approvedSourceSha256'
              and ref.upload_confirmed_at is not null
              and asset.content_sha256=image.value->>'contentSha256'
              and asset.status='available'
          )
        )
    $$;

    create function sellerpilot_private.temu_containment_seller_lineage_allowed(jsonb,jsonb)
    returns boolean language sql stable as $$ select false $$;
    ${currentSellerLineageDefinition}
    create trigger guard_gateway_job_seller_lineage before insert or update
      on sellerpilot_private.channel_gateway_jobs for each row
      execute function sellerpilot_private.guard_gateway_job_seller_lineage();

    create function sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(jsonb,jsonb)
    returns boolean language sql volatile as $$ select false $$;
    create function sellerpilot_private.block_closed_listing_mutation_claim()
    returns trigger language plpgsql security definer set search_path='' as $$
    begin
      if old.status='queued' and new.status='running'
         and new.operation='listing.update'
         and not (
           false
       or sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )
         ) then raise exception 'listing mutation release gate is closed'; end if;
      return new;
    end $$;
    create trigger block_closed_listing_mutation_claim before update
      on sellerpilot_private.channel_gateway_jobs for each row
      execute function sellerpilot_private.block_closed_listing_mutation_claim();

    create function public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path='' as $$
    begin
      update sellerpilot_private.channel_gateway_jobs
      set provider_mutation_started_at=clock_timestamp()
      where id=p_job_id and status='running' and claim_token=p_claim_token
        and worker_token_id=(select id from sellerpilot_private.ai_cli_worker_tokens
          where token_hash=p_token_hash);
      return found;
    end $$;
    create function public.sellerpilot_service_begin_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language sql security definer set search_path='' as $$
      select public.sellerpilot_300950_begin_gateway_mutation_before_release_gate($1,$2,$3)
    $$;
    create function public.sellerpilot_service_gateway_completion_context(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object('jobId',job.id)
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.ai_cli_worker_tokens token on token.id=job.worker_token_id
      where token.token_hash=p_token_hash and job.id=p_job_id and job.claim_token=p_claim_token
    $$;

    do $$ declare definition text; begin
      definition:=pg_catalog.pg_get_functiondef(
        'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
      );
      execute pg_catalog.replace(
        definition,
        'set status=''running'',worker_token_id=v_token_id',
        'set status=''running'',started_at=clock_timestamp(),worker_token_id=v_token_id'
      );
    end $$;

    update sellerpilot_private.products set on_hand=1 where id='${ids.product}';
  `);

  const manifest = (await db.query(
    'select sellerpilot_private.smartstore_current_approved_manifest($1) value',
    [ids.import],
  )).rows[0].value;
  const binding = exactAssetBinding();
  binding.approvedManifestDigest = manifest.digest;
  const source = await job(db, ids.sourceJob);
  const request = structuredClone(source.request_payload);
  request.arguments.imageUrls = [representativeUrl, ...approvedDetailUrls];
  request.arguments.sellerpilotPublicationAssetBinding = binding;
  request.arguments.body.originProduct.stockQuantity = 1;
  request.arguments.body.originProduct.name = '롯샌 파인애플 315g';
  request.arguments.body.originProduct.detailContent = detailHtml(approvedDetailUrls);
  request.arguments.body.originProduct.images = {
    representativeImage: { url: representativeUrl },
    optionalImages: approvedDetailUrls.map((url) => ({ url })),
  };
  request.arguments.body.smartstoreChannelProduct.channelProductName = '롯샌 파인애플 315g';
  await db.query('update sellerpilot_private.channel_gateway_jobs set request_payload=$2 where id=$1', [
    ids.sourceJob, JSON.stringify(request),
  ]);
  const assetRows = binding.providerTransportImages;
  for (const row of assetRows) {
    await db.query(`insert into sellerpilot_private.marketplace_normalized_assets(
      object_path,content_sha256,status,uploaded_at
    ) values($1,$2,'available',clock_timestamp())`, [row.objectPath, row.contentSha256]);
    await db.query(`insert into sellerpilot_private.marketplace_normalized_asset_refs(
      object_path,attempt_id,owner_id,product_id,channel,market,target_id,
      upload_confirmed_at,canonical_public_url,source_object_path,source_content_sha256
    ) values($1,$2,$3,$4,'smartstore','','',clock_timestamp(),$5,$6,$7)`, [
      row.objectPath, ids.sourceAttempt, ids.owner, ids.product, row.publicUrl,
      row.approvedObjectPath, row.approvedSourceSha256,
    ]);
  }
  await db.exec(statusNameMigration);
  await db.exec(officialIdentityMigration);
  await db.exec(repairMigration);
  return db;
}

async function createBaseline(db, options) {
  const queued = await enqueue(db);
  const claimed = await claim(db, 'recovery');
  assert.equal(claimed.id, queued.jobId);
  const result = await complete(db, claimed, 'succeeded', legacyReadback(options));
  return { queued, claimed, result };
}

async function repairStatus(db) {
  return (await db.query(
    'select public.sellerpilot_service_get_smartstore_content_repair_status($1,$2) result',
    [ids.owner, ids.product],
  )).rows[0].result;
}

async function enqueueRepair(db) {
  return (await db.query(
    'select public.sellerpilot_service_enqueue_smartstore_content_repair($1,$2) result',
    [ids.owner, ids.product],
  )).rows[0].result;
}

async function completeRepair(db, claimed, completionStatus, evidence = null, error = null) {
  return (await db.query(`select public.sellerpilot_complete_smartstore_content_repair(
      $1,$2,$3,$4,$5::jsonb,$6
    ) result`, [
    tokenHash, claimed.id, claimed.claimToken, completionStatus,
    evidence === null ? null : JSON.stringify(evidence), error,
  ])).rows[0].result;
}

async function beginMutation(db, claimed) {
  return (await db.query(
    'select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3) value',
    [tokenHash, claimed.id, claimed.claimToken],
  )).rows[0].value;
}

async function repairEvidence(db, baselineId) {
  const baseline = (await db.query(`select *
    from sellerpilot_private.smartstore_existing_remote_repair_baselines where id=$1`,
  [baselineId])).rows[0];
  const transmissionPixels = baseline.approved_transport_images
    .map((image) => image.decodedRgbaSha256);
  const postwriteReadback = providerReadback(transmissionPixels);
  const responseHashes = (await db.query(`select
    sellerpilot_private.external_detail_hash($1::jsonb) origin_hash,
    sellerpilot_private.external_detail_hash($2::jsonb) channel_hash`, [
    JSON.stringify(postwriteReadback.originReadback.response),
    JSON.stringify(postwriteReadback.channelReadback.response),
  ])).rows[0];
  const approvedTransmissionImages = baseline.approved_transport_images.map((image, index) => ({
    index,
    url: image.url,
    contentSha256: image.contentSha256,
    decodedRgbaSha256: image.decodedRgbaSha256,
    width: 860,
    height: 860,
  }));
  return {
    postwriteReadback,
    evidence: {
      contract: 'smartstore_existing_content_repair_result_v1',
      source: 'smartstore_official_content_repair_v1',
      observedAt: postwriteReadback.observedAt,
      providerMutationPerformed: true,
      originProductNo,
      channelProductNo,
      baselineBodySha256: baseline.baseline_body_sha256,
      prewriteProtectedBodySha256: baseline.protected_body_sha256,
      postwriteProtectedBodySha256: baseline.protected_body_sha256,
      prewriteOriginResponseSha256: baseline.origin_response_sha256,
      prewriteChannelResponseSha256: baseline.channel_response_sha256,
      postwriteOriginResponseSha256: responseHashes.origin_hash,
      postwriteChannelResponseSha256: responseHashes.channel_hash,
      approvedTransmissionImages,
      postwriteReadback,
    },
  };
}

async function reachStrictVerification(db) {
  const { result: baseline } = await createBaseline(db);
  const queued = await enqueueRepair(db);
  const claimed = await claim(db, 'recovery');
  assert.equal(claimed.id, queued.jobId);
  assert.equal(await beginMutation(db, claimed), true);
  const { evidence, postwriteReadback } = await repairEvidence(db, baseline.baselineId);
  const repaired = await completeRepair(db, claimed, 'succeeded', evidence);
  assert.equal(repaired.status, 'verification_queued');
  return { baseline, queued, claimed, repaired, evidence, postwriteReadback };
}

test('identity-only mismatch records an immutable repair baseline for reordered approved URLs', async () => {
  const db = await createRepairDatabase();
  try {
    const sourceBefore = await job(db, ids.sourceJob);
    const listingBefore = (await db.query(
      'select to_jsonb(value) snapshot from sellerpilot_private.product_listings value where id=$1',
      [ids.listing],
    )).rows[0].snapshot;
    const { result } = await createBaseline(db);
    assert.equal(result.status, 'repair_required');
    assert.match(result.baselineId, /^[0-9a-f-]{36}$/u);
    assert.equal(result.contentVerified, undefined);
    const baseline = (await db.query(`select source_detail_image_urls,remote_detail_image_urls,
      approved_transport_images from sellerpilot_private.smartstore_existing_remote_repair_baselines
      where id=$1`, [result.baselineId])).rows[0];
    assert.deepEqual(baseline.source_detail_image_urls, approvedDetailUrls);
    assert.notDeepEqual(baseline.remote_detail_image_urls, approvedDetailUrls);
    assert.deepEqual(
      baseline.approved_transport_images.map((image) => image.url),
      approvedDetailUrls,
    );
    assert.deepEqual(
      baseline.approved_transport_images.map((image) => image.decodedRgbaSha256),
      approvedDetailUrls.map((url) => transportPixelsByUrl.get(url)),
    );
    assert.deepEqual(await job(db, ids.sourceJob), sourceBefore);
    assert.deepEqual((await db.query(
      'select to_jsonb(value) snapshot from sellerpilot_private.product_listings value where id=$1',
      [ids.listing],
    )).rows[0].snapshot, listingBefore);
    await assert.rejects(
      db.query('update sellerpilot_private.smartstore_existing_remote_repair_baselines set mismatch_code=mismatch_code where id=$1', [result.baselineId]),
      /SMARTSTORE_EXISTING_CONTENT_REPAIR_EVIDENCE_IMMUTABLE/u,
    );
  } finally {
    await db.close();
  }
});

test('baseline rejects an arbitrary detail URL even when official identity still matches', async () => {
  const db = await createRepairDatabase();
  try {
    await assert.rejects(createBaseline(db, { arbitraryUrl: true }),
      /SMARTSTORE_EXISTING_CONTENT_REPAIR_SOURCE_IMAGE_SET_INVALID/u);
    assert.equal((await db.query(
      'select count(*)::int count from sellerpilot_private.smartstore_existing_remote_repair_baselines',
    )).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test('repair enqueue passes the real seller-lineage guard, dedupes, and replaces only an expired queued permit', async () => {
  const db = await createRepairDatabase();
  try {
    await createBaseline(db);
    const first = await enqueueRepair(db);
    assert.equal(first.status, 'queued');
    const firstRow = await job(db, first.jobId);
    assert.equal(firstRow.attempt_id, null);
    assert.equal(firstRow.request_payload.arguments.sellerpilotSmartstoreExistingContentRepair.contract,
      'smartstore_existing_content_repair_job_v1');
    assert.equal((await enqueueRepair(db)).jobId, first.jobId);

    const forged = structuredClone(firstRow.request_payload);
    forged.arguments.sellerpilotSmartstoreExistingContentRepair.contentSha256 = 'f'.repeat(64);
    await assert.rejects(db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,request_payload,
      status,seller_account_key,created_by
    ) values(gen_random_uuid(),$1,null,$2,'smartstore','listing.update','production',$3,
      'failed',$4,$5)`, [
      ids.credential, ids.listing, JSON.stringify(forged), sellerAccountKey, ids.manager,
    ]), /SMARTSTORE_EXISTING_CONTENT_REPAIR_MARKER_INVALID|gateway listing seller account mismatch/u);

    await db.query(`update sellerpilot_private.smartstore_existing_content_repair_permits
      set expires_at=clock_timestamp()-interval '1 second' where repair_job_id=$1`, [first.jobId]);
    const expired = await repairStatus(db);
    assert.equal(expired.status, 'blocked');
    assert.equal(expired.reason, 'REPAIR_JOB_EXPIRED');
    const replacement = await enqueueRepair(db);
    assert.equal(replacement.status, 'queued');
    assert.notEqual(replacement.jobId, first.jobId);
    assert.equal((await job(db, first.jobId)).status, 'failed');
    assert.equal((await enqueueRepair(db)).jobId, replacement.jobId);
  } finally {
    await db.close();
  }
});

test('closed-gate exact claim, permit consumption, successful proof, and strict verifier finish atomically', async () => {
  const db = await createRepairDatabase();
  try {
    const { result: baselineResult } = await createBaseline(db);
    const queued = await enqueueRepair(db);
    await db.exec(`insert into sellerpilot_private.ai_cli_worker_tokens values(
      '90000000-0000-4000-8000-000000000009','${'9'.repeat(64)}','gateway','active',
      clock_timestamp()+interval '1 day',clock_timestamp(),'${workerVersion}','${ids.manager}'
    )`);
    assert.equal((await db.query(
      'select public.sellerpilot_claim_local_gateway_recovery_job($1,$2) result',
      ['9'.repeat(64), workerVersion],
    )).rows[0].result, null, 'only the worker that recorded the baseline may claim repair');
    assert.equal(await claim(db, 'recovery', workerVersion.replace(/[0-9a-f]{40}/u, '7'.repeat(40))), null);
    const claimed = await claim(db, 'recovery');
    assert.equal(claimed.id, queued.jobId);
    assert.equal((await repairStatus(db)).status, 'running');
    assert.equal(await beginMutation(db, claimed), true);
    assert.equal(await beginMutation(db, claimed), false);

    const { evidence, postwriteReadback } = await repairEvidence(
      db, baselineResult.baselineId,
    );
    const valid = (await db.query(
      'select sellerpilot_private.smartstore_existing_content_repair_result_valid($1,$2::jsonb) value',
      [claimed.id, JSON.stringify(evidence)],
    )).rows[0].value;
    if (!valid) console.error({ baseline, evidence });
    await db.exec(`
      select set_config('sellerpilot.smartstore_content_repair_terminal_job','caller-terminal',false);
      select set_config('sellerpilot.provider_listing_lineage_rebind','caller-lineage',false);
    `);
    const repaired = await completeRepair(db, claimed, 'succeeded', evidence);
    assert.equal(repaired.status, 'verification_queued');
    const gucs = (await db.query(`select
      current_setting('sellerpilot.smartstore_content_repair_terminal_job',true) terminal,
      current_setting('sellerpilot.provider_listing_lineage_rebind',true) lineage`)).rows[0];
    assert.deepEqual(gucs, { terminal: 'caller-terminal', lineage: 'caller-lineage' });
    assert.match(repaired.verificationJobId, /^[0-9a-f-]{36}$/u);
    assert.equal((await enqueueRepair(db)).jobId, queued.jobId,
      'POST after a provider write must not enqueue a second PUT');
    assert.equal((await db.query(`select count(*)::int count
      from sellerpilot_private.channel_gateway_jobs where operation='listing.update'`)).rows[0].count, 1);

    const verifier = await claim(db, 'recovery');
    assert.equal(verifier.id, repaired.verificationJobId);
    const whileVerifying = await enqueueRepair(db);
    assert.equal(whileVerifying.status, 'verification_running');
    assert.equal(whileVerifying.jobId, queued.jobId);
    assert.equal((await db.query(`select count(*)::int count
      from sellerpilot_private.channel_gateway_jobs where operation='listing.update'`)).rows[0].count, 1);
    const verified = await complete(db, verifier, 'succeeded', postwriteReadback);
    assert.equal(verified.status, 'verified');
    assert.equal((await repairStatus(db)).status, 'verified');
    const listing = (await db.query(`select status,remote_id,remote_visibility,failure_class,
      price from sellerpilot_private.product_listings where id=$1`, [ids.listing])).rows[0];
    assert.deepEqual(listing, {
      status: 'published', remote_id: originProductNo, remote_visibility: 'live',
      failure_class: null, price: '3190',
    });
    assert.equal((await job(db, ids.sourceJob)).status, 'reconciliation_required');
    const replay = await completeRepair(db, claimed, 'succeeded', evidence);
    assert.equal(replay.status, 'verification_queued');
    assert.equal(replay.reused, true);
    const changed = structuredClone(evidence);
    changed.observedAt = new Date().toISOString();
    const conflict = await completeRepair(db, claimed, 'succeeded', changed);
    assert.equal(conflict.status, 'reconciliation_required');
    assert.equal(conflict.reused, true);
  } finally {
    await db.close();
  }
});

test('failed or uncertain strict verifier never authorizes a second provider PUT', async () => {
  for (const verifierOutcome of ['failed', 'reconciliation_required']) {
    const db = await createRepairDatabase();
    try {
      const flow = await reachStrictVerification(db);
      const verifier = await claim(db, 'recovery');
      assert.equal(verifier.id, flow.repaired.verificationJobId);
      if (verifierOutcome === 'failed') {
        const failed = await complete(db, verifier, 'failed', null, 'STRICT_READBACK_FAILED');
        assert.equal(failed.status, 'failed');
      } else {
        await db.query('update sellerpilot_private.channel_gateway_jobs set attempt_count=6 where id=$1', [
          verifier.id,
        ]);
        const uncertain = await complete(db, verifier, 'retryable', null, 'STRICT_READBACK_UNCERTAIN');
        assert.equal(uncertain.status, 'reconciliation_required');
      }
      const next = await enqueueRepair(db);
      assert.equal(next.jobId, flow.queued.jobId);
      assert.equal(next.verificationJobId, verifier.id);
      assert.equal(next.status, verifierOutcome === 'failed'
        ? 'blocked'
        : 'verification_reconciliation_required');
      assert.equal((await db.query(`select count(*)::int count
        from sellerpilot_private.channel_gateway_jobs where operation='listing.update'`)).rows[0].count, 1);
    } finally {
      await db.close();
    }
  }
});

test('completion distinguishes safe pre-mutation failure from uncertain post-mutation failure', async () => {
  const before = await createRepairDatabase();
  try {
    await createBaseline(before);
    const queued = await enqueueRepair(before);
    const claimed = await claim(before, 'recovery');
    const failed = await completeRepair(before, claimed, 'failed', null, 'NAVER_AUTH_FAILED');
    assert.equal(failed.status, 'failed');
    assert.equal((await job(before, queued.jobId)).status, 'failed');
  } finally {
    await before.close();
  }

  const after = await createRepairDatabase();
  try {
    await createBaseline(after);
    const queued = await enqueueRepair(after);
    const claimed = await claim(after, 'recovery');
    assert.equal(await beginMutation(after, claimed), true);
    await assert.rejects(
      completeRepair(after, claimed, 'failed', null, 'NAVER_AUTH_FAILED'),
      /SMARTSTORE_EXISTING_CONTENT_REPAIR_FAILED_AFTER_MUTATION/u,
    );
    const uncertain = await completeRepair(
      after, claimed, 'reconciliation_required', null, 'READBACK_UNCERTAIN',
    );
    assert.equal(uncertain.status, 'reconciliation_required');
    assert.equal((await job(after, queued.jobId)).status, 'reconciliation_required');
    assert.equal((await enqueueRepair(after)).status, 'reconciliation_required');
  } finally {
    await after.close();
  }
});

test('repair RPC identifiers stay within PostgreSQL NAMEDATALEN and private ledgers remain service-only', async () => {
  const db = await createRepairDatabase();
  try {
    const names = (await db.query(`select proname
      from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace
      where nspname='public' and proname like '%smartstore%content%repair%'`)).rows;
    assert.ok(names.length >= 3);
    for (const { proname } of names) assert.ok(Buffer.byteLength(proname) < 64, proname);
    const privileges = (await db.query(`select relname,relrowsecurity,
      has_table_privilege('anon',format('%I.%I',nspname,relname),'SELECT') anon_select,
      has_table_privilege('authenticated',format('%I.%I',nspname,relname),'SELECT') authenticated_select
      from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace
      where nspname='sellerpilot_private' and relkind='r'
        and relname like 'smartstore_existing_%'`)).rows;
    assert.equal(privileges.length, 3);
    for (const row of privileges) {
      assert.equal(row.relrowsecurity, true);
      assert.equal(row.anon_select, false);
      assert.equal(row.authenticated_select, false);
    }
    assert.doesNotMatch(repairMigration, /66147e5d|0d2c492e|13688607602|13749310594/u);
  } finally {
    await db.close();
  }
});
