import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL(
  '../supabase/migrations/20260907150000_verify_smartstore_manual_adoption_for_normal_update.sql',
  import.meta.url,
), 'utf8');
const coupangGateMigration = await readFile(new URL(
  '../supabase/migrations/20260907112000_coupang_scoped_publication_gate.sql',
  import.meta.url,
), 'utf8');
const globalCounterMigration = await readFile(new URL(
  '../supabase/migrations/20260906070000_evidence_based_global_publication_gate_counters.sql',
  import.meta.url,
), 'utf8');
const smartstoreScopedGateMigration = await readFile(new URL(
  '../supabase/migrations/20260907151000_smartstore_scoped_publication_gate.sql',
  import.meta.url,
), 'utf8');

function extractDefinition(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing SQL definition: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing SQL terminator: ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

const currentGateStatusDefinition = extractDefinition(
  coupangGateMigration,
  'create or replace function public.sellerpilot_service_listing_mutation_release_gate_status()',
  '\n$$;',
);
const currentGlobalSetterDefinition = extractDefinition(
  globalCounterMigration,
  'CREATE OR REPLACE FUNCTION public.sellerpilot_service_set_listing_mutation_release_gate(p_open boolean, p_release_sha text)',
  '\n$function$;',
);

const owner = '10000000-0000-4000-8000-000000000001';
const product = '20000000-0000-4000-8000-000000000002';
const listing = '30000000-0000-4000-8000-000000000003';
const sourceJob = '40000000-0000-4000-8000-000000000004';
const sourceAttempt = '50000000-0000-4000-8000-000000000005';
const credential = '60000000-0000-4000-8000-000000000006';
const importId = '70000000-0000-4000-8000-000000000007';
const manager = '11000000-0000-4000-8000-000000000011';
const account = 'a'.repeat(64);
const contentSha = 'b'.repeat(64);
const sku = 'AUTO-GENERIC-SMARTSTORE-001';
const originNo = '13688607602';
const channelNo = '13749310594';
const pixels = Array.from({ length: 8 }, (_, index) => `${index + 1}`.repeat(64));
const imageUrls = Array.from(
  { length: 8 }, (_, index) => `https://shop-phinf.pstatic.net/detail/${index + 1}.png`,
);
const sourceImageUrls = Array.from(
  { length: 8 }, (_, index) => `https://source.example/${index + 1}.png?sig=source&expires=1`,
);
const detailHtmlFor = (urls) => `<section class="approved-detail"><p>승인된 상품 설명</p>${
  urls.map((url) => `<img src="${url}" alt="detail">`).join('')}</section>`;
const detailHtml = detailHtmlFor(imageUrls);
const sourceDetailHtml = detailHtmlFor(
  sourceImageUrls.map((url) => url.replaceAll('&', '&amp;')),
);
const sourceSha256s = ['1', '2', '3', '4', '5', '6', 'a', 'b']
  .map((character) => character.repeat(64));
const assets = sourceSha256s.map((sourceSha256, index) => ({
  role: `detail-${index + 1}`,
  storagePath: `approved/detail-${index + 1}.png`,
  sourceSha256,
}));
const manifestDigest = createHash('sha256').update(assets.map((asset) =>
  `${asset.role}\t${asset.storagePath}\t${asset.sourceSha256}`).join('\n')).digest('hex');
const reviewedDocument = { title: '롯샌 파인애플 315g' };
const documentSha = createHash('sha256').update(JSON.stringify(reviewedDocument)).digest('hex');
const exportContent = { title: '상세', html: '<p>상세</p>', plain: '상세', sections: [] };
const exportSha = '7'.repeat(64);

const sourceRequest = {
  arguments: {
    publicationIntent: 'live',
    imageUrls: [
      sourceImageUrls[3],
      'https://source.example/representative.png?sig=source',
      ...sourceImageUrls.filter((_, index) => index !== 3),
    ],
    sellerpilotExternalDetail: {
      importId,
      productId: product,
      ownerId: owner,
      requestSha256: '9'.repeat(64),
      version: '2',
      channel: 'smartstore',
      locale: 'ko-KR',
      language: 'ko',
      documentSha256: documentSha,
      allLocaleDocumentSha256: { ko: documentSha, ja: documentSha, en: documentSha },
      ...exportContent,
      exportSha256: exportSha,
      imageSha256s: sourceSha256s,
      pixelSha256s: pixels,
    },
    publicationExpectedLocale: 'ko-KR',
    publicationExpectedFingerprint: 'd'.repeat(64),
    body: {
      originProduct: {
        name: '롯샌 파인애플 315g',
        salePrice: 3190,
        stockQuantity: 10,
        statusType: 'SALE',
        detailContent: sourceDetailHtml,
        detailAttribute: { sellerCodeInfo: { sellerManagementCode: sku } },
      },
      smartstoreChannelProduct: {
        channelProductName: '롯샌 파인애플 315g',
        channelProductDisplayStatusType: 'ON',
      },
    },
  },
};

function readback() {
  return {
    contract: 'smartstore_official_manual_adoption_readback_v1',
    source: 'smartstore_official_api_readback_v1',
    observedAt: new Date(Date.now() - 30_000).toISOString(),
    providerMutationPerformed: false,
    searchReadback: {
      method: 'POST',
      path: '/v1/products/search',
      httpStatus: 200,
      request: {
        searchKeywordType: 'SELLER_CODE', sellerManagementCode: sku,
        page: 1, size: 50, orderType: 'NO',
      },
      response: {
        page: 1,
        size: 50,
        totalElements: 1,
        totalPages: 1,
        first: true,
        last: true,
        contents: [{
          originProductNo: originNo,
          channelProducts: [{
            channelProductNo: channelNo,
            sellerManagementCode: sku,
          }],
        }],
      },
    },
    originReadback: {
      method: 'GET',
      path: `/v2/products/origin-products/${originNo}`,
      httpStatus: 200,
      request: null,
      response: {
        originProductNo: originNo,
        smartstoreChannelProductNo: channelNo,
        originProduct: {
          originProductNo: originNo,
          name: '롯샌 파인애플 315g',
          salePrice: 3190,
          stockQuantity: 10,
          statusType: 'SALE',
          detailContent: detailHtml,
          detailAttribute: { sellerCodeInfo: { sellerManagementCode: sku } },
        },
        smartstoreChannelProduct: { channelProductNo: channelNo },
      },
    },
    channelReadback: {
      method: 'GET',
      path: `/v2/products/channel-products/${channelNo}`,
      httpStatus: 200,
      request: null,
      response: {
        originProductNo: originNo,
        smartstoreChannelProductNo: channelNo,
        smartstoreChannelProduct: {
          channelProductNo: channelNo,
          originProductNo: originNo,
          channelProductName: '롯샌 파인애플 315g',
          channelProductDisplayStatusType: 'ON',
        },
      },
    },
    detailImageUrls: imageUrls,
    detailImagePixelSha256s: pixels,
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    insert into auth.users values ('${owner}'),('${manager}');
    insert into sellerpilot_private.admin_users values ('${owner}'),('${manager}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$
      select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())
    $$;
    create function sellerpilot_private.request_has_unambiguous_service_role_claim()
    returns boolean language sql stable as $$
      select current_setting('request.jwt.claim.role',true)='service_role'
    $$;
    create function sellerpilot_private.external_detail_hash(jsonb)
    returns text language sql immutable strict as $$
      select encode(sha256(convert_to($1::text,'UTF8')),'hex')
    $$;

    create table sellerpilot_private.products(
      id uuid primary key, owner_id uuid not null, sku text not null,
      status text not null, demo boolean not null,
      external_detail_import_id uuid, on_hand integer not null
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, created_by uuid not null, channel text not null,
      environment text not null, status text not null, version integer not null,
      expires_at timestamptz, seller_account_key text,
      seller_account_key_source text, last_check_status text,
      last_checked_at timestamptz
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key, owner_id uuid not null, credential_id uuid,
      channel text, operation text, status text, http_status integer,
      remote_id text, pre_gateway_retryable boolean,
      request_fingerprint text, seller_account_key text,
      completed_at timestamptz
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key, owner_id uuid not null, product_id uuid not null,
      channel_key text not null, market text not null default '',
      target_id text not null default '', status text not null,
      failure_class text, remote_visibility text not null,
      remote_id text, marketplace_sku text, published_at timestamptz,
      provider_status text, operation_attempt_id uuid,
      requested_publication_intent text not null,
      seller_account_key text, remote_resources jsonb not null default '{}'::jsonb,
      price numeric not null default 0, last_error text,
      last_verified_at timestamptz, public_url text,
      public_page_status text not null default 'unverified',
      public_page_checked_at timestamptz, remote_created_at timestamptz,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, credential_id uuid, attempt_id uuid,
      listing_id uuid, channel text not null, operation text not null,
      environment text not null, request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb, status text not null,
      error_message text, attempt_count integer not null default 0,
      provider_mutation_started_at timestamptz, completed_at timestamptz,
      request_fingerprint text, seller_account_key text, created_by uuid,
      created_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.external_detail_imports(
      id uuid primary key, product_id uuid not null, owner_id uuid not null,
      request_sha256 text not null, payload jsonb not null, receipts jsonb not null,
      approved_product_updated_at timestamptz, approved_detail_version bigint not null
    );
    create table sellerpilot_private.external_detail_approval_revisions(
      import_id uuid not null, revision bigint not null, product_id uuid not null,
      owner_id uuid not null, content_sha256 text not null, content_snapshot jsonb not null,
      primary key(import_id,revision), unique(import_id,revision,content_sha256)
    );

    create function sellerpilot_private.external_detail_approval_revision_is_current(uuid,bigint,text)
    returns boolean language sql stable as $$
      select exists(select 1 from sellerpilot_private.external_detail_approval_revisions
        where import_id=$1 and revision=$2 and content_sha256=$3)
    $$;
    create function sellerpilot_private.external_detail_source_manifest(uuid)
    returns jsonb language sql stable as $$
      select case when exists(select 1 from sellerpilot_private.channel_gateway_jobs where id=$1)
        then jsonb_build_object('contract','sellerpilot_detail_image_manifest_v2','digest','${manifestDigest}')
        else null end
    $$;
    create function sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(uuid)
    returns boolean language sql stable as $$ select false $$;
    create function sellerpilot_private.temu_safe_test_source_reconciliation_resolved(uuid)
    returns boolean language sql stable as $$ select false $$;
    create function sellerpilot_private.unstarted_listing_create_reconciliation_resolved(uuid)
    returns boolean language sql stable as $$ select false $$;
    create function sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(uuid)
    returns boolean language sql stable as $$ select false $$;
    create function sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)
    returns boolean language sql immutable as $$ select false $$;
    create function sellerpilot_private.qoo10_shipping_s1_activation_job_matches(sellerpilot_private.channel_gateway_jobs)
    returns boolean language sql immutable as $$ select false $$;
    create function sellerpilot_private.qoo10_exact_s1_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)
    returns boolean language sql immutable as $$ select false $$;

    create table sellerpilot_private.listing_mutation_release_gate(
      singleton boolean primary key, is_open boolean not null,
      opened_at timestamptz, opened_release_sha text, opened_channel text,
      updated_at timestamptz not null default clock_timestamp()
    );
    insert into sellerpilot_private.listing_mutation_release_gate(singleton,is_open)
      values(true,false);
    create table sellerpilot_private.listing_publication_adapter_release(
      channel text primary key, adapter_ready boolean not null,
      contract_version text, release_sha text
    );
    create table sellerpilot_private.listing_publication_rechecker_release(
      singleton boolean primary key, rechecker_ready boolean not null,
      release_sha text
    );
    create table sellerpilot_private.listing_publication_reviews(
      listing_id uuid, channel text, status text
    );
    create function sellerpilot_private.listing_publication_review_is_current(uuid)
    returns boolean language sql stable as $$ select false $$;
    create function public.sellerpilot_301100_listing_gate_status_pre_publication_review()
    returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create function sellerpilot_private.attested_listing_publication_release_sha()
    returns text language sql stable as $$ select null::text $$;
    create function sellerpilot_private.attested_listing_publication_release_sha(text)
    returns text language sql stable as $$ select null::text $$;
    create function sellerpilot_private.active_serverless_runtime_release_sha()
    returns text language sql stable as $$ select null::text $$;
    create function sellerpilot_private.listing_publication_review_violation_count()
    returns integer language sql stable as $$ select 0 $$;
    create function sellerpilot_private.listing_publication_review_violation_count(text)
    returns integer language sql stable as $$ select 0 $$;
    create function sellerpilot_private.listing_mutation_release_gate_is_effective()
    returns boolean language sql stable as $$ select false $$;
    create function sellerpilot_private.listing_mutation_release_gate_is_effective(text)
    returns boolean language sql stable as $$ select false $$;

    create function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger language plpgsql as $$
    begin
      return new;
    end $$;
    create trigger guard_product_listing_seller_lineage
    before update on sellerpilot_private.product_listings
    for each row execute function sellerpilot_private.guard_product_listing_seller_lineage();

    create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
      on sellerpilot_private.channel_gateway_jobs(listing_id,
        (case when sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(channel_gateway_jobs)
          then 'qoo10_exact_s1_verifier_v1' else 'default' end))
      where listing_id is not null
        and operation in ('listing.create','listing.update','listing.stop','listing.activate',
          'price.update','inventory.update','listing.lineage.verify','listing.publication.verify')
        and status in ('queued','running','reconciliation_required');

    create function public.sellerpilot_11820_enqueue_listing_unsafe(
      p_listing_id uuid,p_credential_id uuid,p_attempt_id uuid,
      p_channel text,p_operation text,p_request_payload jsonb
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare existing_id uuid; inserted_id uuid:=gen_random_uuid(); account_key text;
    begin
      select j.id into existing_id
      from sellerpilot_private.channel_gateway_jobs j
     where j.status in ('queued', 'running', 'reconciliation_required')
     and j.operation in ('listing.create', 'listing.update', 'listing.stop')
       and j.listing_id=p_listing_id
     limit 1;
      if existing_id is not null then return jsonb_build_object('status','reconciliation_required','job_id',existing_id); end if;
      select seller_account_key into account_key from sellerpilot_private.channel_credentials where id=p_credential_id;
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,attempt_id,listing_id,channel,operation,environment,
        request_payload,status,seller_account_key,created_by
      ) select inserted_id,p_credential_id,p_attempt_id,p_listing_id,p_channel,p_operation,
        'production',p_request_payload,'queued',account_key,owner_id
        from sellerpilot_private.channel_operation_attempts where id=p_attempt_id;
      return jsonb_build_object('status','queued','job_id',inserted_id);
    end $$;

    ${currentGateStatusDefinition}
    ${currentGlobalSetterDefinition}

    insert into sellerpilot_private.products values(
      '${product}','${owner}','${sku}','active',false,'${importId}',10
    );
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${manager}','smartstore','production','active',3,null,
      '${account}','credential_incarnation_v1','failed',clock_timestamp()-interval '1 day'
    );
    insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,status,http_status,remote_id,
      pre_gateway_retryable,request_fingerprint,seller_account_key,completed_at
    ) values(
      '${sourceAttempt}','${owner}','${credential}','smartstore','listing.create',
      'manual_required',409,null,false,'${'d'.repeat(64)}','${account}',clock_timestamp()-interval '1 hour'
    );
    insert into sellerpilot_private.product_listings(
      id,owner_id,product_id,channel_key,status,failure_class,remote_visibility,
      requested_publication_intent,seller_account_key,operation_attempt_id,price
    ) values(
      '${listing}','${owner}','${product}','smartstore','failed','external_action',
      'unknown','live',null,'${sourceAttempt}',3190
    );
    insert into sellerpilot_private.external_detail_imports values(
      '${importId}','${product}','${owner}',
      '${'9'.repeat(64)}',
      '${JSON.stringify({
        assets,
        reviewedCopy: {
          ko: { documentSha256: documentSha, document: reviewedDocument },
          ja: { documentSha256: documentSha, document: reviewedDocument },
          en: { documentSha256: documentSha, document: reviewedDocument },
        },
      })}',
      '${JSON.stringify(pixels.map((decodedRgbaSha256) => ({ decodedRgbaSha256 })))}'
      ,clock_timestamp()-interval '1 day',2
    );
    insert into sellerpilot_private.external_detail_approval_revisions values(
      '${importId}',1,'${product}','${owner}','${contentSha}',
      '${JSON.stringify({ product: { name: '롯샌 파인애플 315g' } })}'
    );
  `);
  const fixtureRequest = structuredClone(sourceRequest);
  fixtureRequest.arguments.sellerpilotExternalDetail.exportSha256 = (await db.query(
    'select sellerpilot_private.external_detail_hash($1::jsonb) value',
    [JSON.stringify(exportContent)],
  )).rows[0].value;
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,
      request_payload,response_payload,status,attempt_count,provider_mutation_started_at,
      completed_at,request_fingerprint,seller_account_key,created_by
    ) values($1,$2,$3,$4,'smartstore','listing.create','production',$5,$6,
      'reconciliation_required',1,clock_timestamp()-interval '1 hour',
      clock_timestamp()-interval '59 minutes',$7,$8,$9)`, [
    sourceJob, credential, sourceAttempt, listing,
    JSON.stringify(fixtureRequest), JSON.stringify({ ok: false }),
    'd'.repeat(64), account, manager,
  ]);
  await db.exec(`
    select set_config('request.jwt.claim.role','service_role',false);
    select set_config('request.jwt.claim.sub','${owner}',false);
  `);
  await db.exec(migration);
  return db;
}

async function prepare(db) {
  return (await db.query(
    'select public.sellerpilot_service_prepare_smartstore_manual_adoption($1,$2) result',
    [owner, product],
  )).rows[0].result;
}

async function commit(db, evidence = readback()) {
  return (await db.query(`select public.sellerpilot_service_commit_smartstore_manual_adoption(
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb
    ) result`, [
    owner, product, sourceJob, credential, 1, contentSha, manifestDigest,
    JSON.stringify(evidence),
  ])).rows[0].result;
}

async function snapshot(db, table, id) {
  return (await db.query(
    `select to_jsonb(row_value) value from sellerpilot_private.${table} row_value where id=$1`,
    [id],
  )).rows[0].value;
}

test('official readback atomically binds existing remote while preserving uncertain CREATE lineage', async () => {
  const db = await fixture();
  try {
    const beforeJob = await snapshot(db, 'channel_gateway_jobs', sourceJob);
    const beforeAttempt = await snapshot(db, 'channel_operation_attempts', sourceAttempt);
    const context = await prepare(db);
    assert.equal(context.contract, 'smartstore_manual_adoption_prepare_v1');
    assert.equal(context.status, 'ready');
    assert.equal(context.sourceJobId, sourceJob);
    assert.equal(context.credentialId, credential);
    assert.equal(context.normalUpdateEligible, false);
    assert.equal((await db.query(
      'select public.sellerpilot_service_listing_mutation_release_gate_status() value',
    )).rows[0].value.reconciliationRequired, 1);

    const result = await commit(db);
    assert.equal(result.status, 'verified');
    assert.equal(result.provenance, 'manual_adoption_verified');
    assert.equal(result.remoteCreationOriginAsserted, false);
    assert.equal(result.apiCreateSucceeded, false);
    assert.equal(result.providerMutationPerformed, false);
    assert.equal(result.contentVerified, true);
    assert.equal(result.normalUpdateEligible, true);
    assert.equal(result.normalUpdateEligibilityScope, 'database_linkage_only');
    assert.equal(result.publicationGateOpenAsserted, false);
    assert.deepEqual(await snapshot(db, 'channel_gateway_jobs', sourceJob), beforeJob);
    assert.deepEqual(await snapshot(db, 'channel_operation_attempts', sourceAttempt), beforeAttempt);

    const adopted = await snapshot(db, 'product_listings', listing);
    assert.equal(adopted.status, 'published');
    assert.equal(adopted.remote_id, originNo);
    assert.equal(adopted.marketplace_sku, sku);
    assert.equal(adopted.remote_visibility, 'live');
    assert.equal(adopted.provider_status, 'SALE|ON');
    assert.equal(adopted.failure_class, null);
    assert.equal(adopted.remote_resources.resources.smartstoreChannelProductNo, channelNo);
    assert.equal(adopted.remote_resources.verification.apiCreateSucceeded, false);

    const again = await prepare(db);
    assert.equal(again.status, 'already_verified');
    assert.equal(again.receiptId, result.receiptId);
    assert.equal(again.attestationId, result.attestationId);
    assert.equal(again.normalUpdateEligible, true);
    assert.equal((await db.query(
      'select sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved($1) value',
      [sourceJob],
    )).rows[0].value, true);
    assert.equal((await db.query(
      'select public.sellerpilot_service_listing_mutation_release_gate_status() value',
    )).rows[0].value.reconciliationRequired, 0);
    assert.equal((await db.query(
      'select public.sellerpilot_service_set_listing_mutation_release_gate(false,null) value',
    )).rows[0].value.reconciliationRequired, 0);
    for (const signature of [
      'public.sellerpilot_service_listing_mutation_release_gate_status()',
      'public.sellerpilot_service_set_listing_mutation_release_gate(boolean,text)',
    ]) {
      const definition = (await db.query(
        'select pg_get_functiondef($1::regprocedure) value', [signature],
      )).rows[0].value;
      assert.match(definition, /listing_mutation_reconciliation_resolved/);
    }
    await db.exec(smartstoreScopedGateMigration);
    const scopedStatus = (await db.query(
      'select public.sellerpilot_service_listing_mutation_release_gate_status() value',
    )).rows[0].value;
    assert.equal(scopedStatus.reconciliationRequired, 0);
    assert.equal(scopedStatus.smartstoreReconciliationRequired, 0);

    await db.query(`update sellerpilot_private.product_listings
      set status='published', price=3290, remote_resources=$2::jsonb,
          updated_at=clock_timestamp(), last_verified_at=clock_timestamp()
      where id=$1`, [listing, JSON.stringify({
      resources: { originProductNo: originNo, smartstoreChannelProductNo: channelNo },
      verification: { contract: 'sellerpilot_provider_publication_v1' },
    })]);
    assert.equal((await db.query(
      'select sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved($1) value',
      [sourceJob],
    )).rows[0].value, true);
  } finally {
    await db.close();
  }
});

test('normal update requires the exact immutable adoption marker and keeps old reconciliation', async () => {
  const db = await fixture();
  try {
    const forgedAttempt = '81000000-0000-4000-8000-000000000081';
    await db.query(`insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,status,seller_account_key
    ) values($1,$2,$3,'smartstore','listing.update','running',$4)`, [
      forgedAttempt, owner, credential, account,
    ]);
    await assert.rejects(() => db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,request_payload,
      status,seller_account_key,created_by
    ) values(gen_random_uuid(),$1,$2,$3,'smartstore','listing.update','production',$4,'queued',$5,$6)`, [
      credential, forgedAttempt, listing, JSON.stringify({
        arguments: {
          sellerpilotSmartstoreManualAdoption: {
            contract: 'smartstore_manual_adoption_verified_v1', status: 'verified',
          },
        },
      }), account, owner,
    ]), /UPDATE_ATTESTATION_REQUIRED/);

    const adoption = await commit(db);
    const updateAttempt = '80000000-0000-4000-8000-000000000008';
    await db.query(`insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,status,seller_account_key
    ) values($1,$2,$3,'smartstore','listing.update','running',$4)`, [
      updateAttempt, owner, credential, account,
    ]);
    const marker = {
      arguments: {
        sellerpilotSmartstoreManualAdoption: {
          contract: 'smartstore_manual_adoption_verified_v1', status: 'verified',
          attestationId: adoption.attestationId, receiptId: adoption.receiptId,
          sourceJobId: sourceJob, listingId: listing,
          originProductNo: originNo, channelProductNo: channelNo, sellerSku: sku,
          approvalRevision: 1, contentSha256: contentSha,
          manifestDigest,
        },
      },
    };
    const queued = (await db.query(`select public.sellerpilot_11820_enqueue_listing_unsafe(
      $1,$2,$3,'smartstore','listing.update',$4::jsonb
    ) result`, [listing, credential, updateAttempt, JSON.stringify(marker)])).rows[0].result;
    assert.equal(queued.status, 'queued');
    assert.notEqual(queued.job_id, sourceJob);
    assert.equal((await snapshot(db, 'channel_gateway_jobs', sourceJob)).status, 'reconciliation_required');

    const fakeAttempt = '90000000-0000-4000-8000-000000000009';
    await db.query(`insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,status,seller_account_key
    ) values($1,$2,$3,'smartstore','listing.update','running',$4)`, [
      fakeAttempt, owner, credential, account,
    ]);
    const bad = structuredClone(marker);
    bad.arguments.sellerpilotSmartstoreManualAdoption.manifestDigest = 'e'.repeat(64);
    await assert.rejects(() => db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,request_payload,
      status,seller_account_key,created_by
    ) values(gen_random_uuid(),$1,$2,$3,'smartstore','listing.update','production',$4,'queued',$5,$6)`, [
      credential, fakeAttempt, listing, JSON.stringify(bad), account, owner,
    ]), /UPDATE_ATTESTATION_REQUIRED/);
  } finally {
    await db.close();
  }
});

test('incomplete search or mismatched pixels change no receipt, attestation, listing, job, or attempt', async () => {
  const db = await fixture();
  try {
    const beforeListing = await snapshot(db, 'product_listings', listing);
    const beforeJob = await snapshot(db, 'channel_gateway_jobs', sourceJob);
    const beforeAttempt = await snapshot(db, 'channel_operation_attempts', sourceAttempt);
    const incompleteSearch = readback();
    incompleteSearch.searchReadback.response.totalPages = 0;
    await assert.rejects(() => commit(db, incompleteSearch), /SEARCH_RESPONSE_INCOMPLETE/);
    assert.equal(Number((await db.query(
      'select count(*) n from sellerpilot_private.smartstore_manual_adoption_receipts',
    )).rows[0].n), 0);
    assert.equal(Number((await db.query(
      'select count(*) n from sellerpilot_private.smartstore_manual_adoption_attestations',
    )).rows[0].n), 0);

    const ambiguousSearch = readback();
    ambiguousSearch.searchReadback.response.contents[0].channelProducts.push({
      channelProductNo: '13749310595', sellerManagementCode: sku,
    });
    await assert.rejects(() => commit(db, ambiguousSearch), /SEARCH_IDENTITY_AMBIGUOUS/);

    const changedCopy = readback();
    changedCopy.originReadback.response.originProduct.detailContent =
      detailHtml.replace('승인된 상품 설명', '변조된 상품 설명');
    await assert.rejects(() => commit(db, changedCopy), /DETAIL_CONTENT_MISMATCH/);
    const changedTag = readback();
    changedTag.originReadback.response.originProduct.detailContent =
      detailHtml.replace('<section class="approved-detail">', '<div class="approved-detail">')
        .replace('</section>', '</div>');
    await assert.rejects(() => commit(db, changedTag), /DETAIL_CONTENT_MISMATCH/);
    const extraImage = readback();
    extraImage.originReadback.response.originProduct.detailContent =
      detailHtml.replace(
        '</section>', '<img src="https://shop-phinf.pstatic.net/detail/extra.png"></section>',
      );
    await assert.rejects(() => commit(db, extraImage), /DETAIL_IMAGES_INVALID/);

    const evidence = readback();
    evidence.detailImagePixelSha256s[7] = 'f'.repeat(64);
    await assert.rejects(() => commit(db, evidence), /PIXEL_BINDING_MISMATCH/);
    assert.equal(Number((await db.query(
      'select count(*) n from sellerpilot_private.smartstore_manual_adoption_receipts',
    )).rows[0].n), 0);
    assert.equal(Number((await db.query(
      'select count(*) n from sellerpilot_private.smartstore_manual_adoption_attestations',
    )).rows[0].n), 0);
    assert.deepEqual(await snapshot(db, 'product_listings', listing), beforeListing);
    assert.deepEqual(await snapshot(db, 'channel_gateway_jobs', sourceJob), beforeJob);
    assert.deepEqual(await snapshot(db, 'channel_operation_attempts', sourceAttempt), beforeAttempt);
  } finally {
    await db.close();
  }
});

test('legacy CREATE price and stock must still match current local sale terms', async () => {
  const db = await fixture();
  try {
    await db.query(
      'update sellerpilot_private.product_listings set price=3290 where id=$1',
      [listing],
    );
    await db.query(
      'update sellerpilot_private.products set on_hand=11 where id=$1',
      [product],
    );
    const context = await prepare(db);
    assert.equal(context.status, 'blocked');
    assert.equal(context.reason, 'SOURCE_TUPLE_OR_APPROVAL_NOT_CURRENT');
    await assert.rejects(() => commit(db), /SOURCE_TUPLE_OR_APPROVAL_DRIFT/);
    assert.equal(Number((await db.query(
      'select count(*) n from sellerpilot_private.smartstore_manual_adoption_receipts',
    )).rows[0].n), 0);
    assert.equal(Number((await db.query(
      'select count(*) n from sellerpilot_private.smartstore_manual_adoption_attestations',
    )).rows[0].n), 0);
  } finally {
    await db.close();
  }
});

test('image URL occurrences outside img src are not hidden by canonicalization', async () => {
  const db = await fixture();
  try {
    const sourceWithAnchor = sourceDetailHtml.replace(
      '</section>', `<a href="${sourceImageUrls[0]}">source</a></section>`,
    );
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set request_payload=jsonb_set(
        request_payload,'{arguments,body,originProduct,detailContent}',to_jsonb($2::text)
      ) where id=$1`, [sourceJob, sourceWithAnchor]);
    const evidence = readback();
    evidence.originReadback.response.originProduct.detailContent = detailHtml.replace(
      '</section>', `<a href="${imageUrls[0]}">source</a></section>`,
    );
    await assert.rejects(() => commit(db, evidence), /DETAIL_CONTENT_MISMATCH/);
    assert.equal(Number((await db.query(
      'select count(*) n from sellerpilot_private.smartstore_manual_adoption_attestations',
    )).rows[0].n), 0);
  } finally {
    await db.close();
  }
});

test('verified source job, attempt, and remote identity remain immutable', async () => {
  const db = await fixture();
  try {
    await commit(db);
    await assert.rejects(() => db.exec(
      `update sellerpilot_private.channel_gateway_jobs set error_message='changed' where id='${sourceJob}'`,
    ), /SOURCE_LEDGER_IMMUTABLE/);
    await assert.rejects(() => db.exec(
      `update sellerpilot_private.channel_operation_attempts set http_status=500 where id='${sourceAttempt}'`,
    ), /SOURCE_LEDGER_IMMUTABLE/);
    await assert.rejects(() => db.exec(
      `update sellerpilot_private.product_listings set remote_id='999' where id='${listing}'`,
    ), /IDENTITY_IMMUTABLE/);
  } finally {
    await db.close();
  }
});
