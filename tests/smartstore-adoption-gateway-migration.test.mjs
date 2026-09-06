import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

const adoptionMigration = await readFile(new URL(
  '../supabase/migrations/20260907150000_verify_smartstore_manual_adoption_for_normal_update.sql',
  import.meta.url,
), 'utf8');
const gatewayMigration = await readFile(new URL(
  '../supabase/migrations/20260907160000_smartstore_adoption_gateway_readback.sql',
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
const providerLineageMigration = await readFile(new URL(
  '../supabase/migrations/20260825111840_provider_listing_readback_rebind.sql',
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
const lineageCompletionGuardDefinition = extractDefinition(
  providerLineageMigration,
  'create or replace function sellerpilot_private.guard_listing_lineage_verification_job_completion()',
  '\n$$;',
);

const ids = {
  owner: '10000000-0000-4000-8000-000000000001',
  manager: '11000000-0000-4000-8000-000000000011',
  product: '20000000-0000-4000-8000-000000000002',
  listing: '30000000-0000-4000-8000-000000000003',
  sourceJob: '40000000-0000-4000-8000-000000000004',
  sourceAttempt: '50000000-0000-4000-8000-000000000005',
  credential: '60000000-0000-4000-8000-000000000006',
  import: '70000000-0000-4000-8000-000000000007',
  worker: '80000000-0000-4000-8000-000000000008',
};
const release = '8'.repeat(40);
const egress = 'a'.repeat(64);
const sellerAccountKey = 'c'.repeat(64);
const contentSha = 'b'.repeat(64);
const requestFingerprint = 'd'.repeat(64);
const tokenHash = 'e'.repeat(64);
const workerVersion = `sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}`;
const sku = 'AUTO-GENERIC-SMARTSTORE-001';
const originNo = '13688607602';
const channelNo = '13749310594';
const pixels = Array.from({ length: 8 }, (_, index) => `${index + 1}`.repeat(64));
const remoteImageUrls = Array.from(
  { length: 8 }, (_, index) => `https://shop-phinf.pstatic.net/detail/${index + 1}.png`,
);
const sourceImageUrls = Array.from(
  { length: 8 }, (_, index) => `https://source.example/${index + 1}.png?sig=source&expires=1`,
);
const detailHtmlFor = (urls) => `<section class="approved-detail"><p>승인된 상품 설명</p>${
  urls.map((url) => `<img src="${url}" alt="detail">`).join('')}</section>`;
const remoteDetailHtml = detailHtmlFor(remoteImageUrls);
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

const sourceRequest = {
  arguments: {
    publicationIntent: 'live',
    imageUrls: [
      sourceImageUrls[3],
      'https://source.example/representative.png?sig=source',
      ...sourceImageUrls.filter((_, index) => index !== 3),
    ],
    sellerpilotExternalDetail: {
      importId: ids.import,
      productId: ids.product,
      ownerId: ids.owner,
      requestSha256: '9'.repeat(64),
      version: '2',
      channel: 'smartstore',
      locale: 'ko-KR',
      language: 'ko',
      documentSha256: documentSha,
      allLocaleDocumentSha256: { ko: documentSha, ja: documentSha, en: documentSha },
      ...exportContent,
      exportSha256: '7'.repeat(64),
      imageSha256s: sourceSha256s,
      pixelSha256s: pixels,
    },
    publicationExpectedLocale: 'ko-KR',
    publicationExpectedFingerprint: requestFingerprint,
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

function officialReadback() {
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
        page: 1, size: 50, totalElements: 1, totalPages: 1,
        first: true, last: true,
        contents: [{
          originProductNo: originNo,
          channelProducts: [{ channelProductNo: channelNo, sellerManagementCode: sku }],
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
          detailContent: remoteDetailHtml,
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
    detailImageUrls: remoteImageUrls,
    detailImagePixelSha256s: pixels,
  };
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    insert into auth.users values ('${ids.owner}'),('${ids.manager}');
    insert into sellerpilot_private.admin_users values ('${ids.owner}'),('${ids.manager}');
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
      last_checked_at timestamptz, seller_account_verified_at timestamptz
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
      response_payload jsonb, status text not null default 'queued',
      error_message text, attempt_count integer not null default 0,
      provider_mutation_started_at timestamptz, completed_at timestamptz,
      request_fingerprint text, seller_account_key text, created_by uuid,
      credential_refresh_in_flight boolean not null default false,
      credential_refresh_recovery_vault_id uuid, prepared_credential_id uuid,
      oauth_exchange_completed boolean not null default false,
      worker_token_id uuid, claim_token uuid, lease_expires_at timestamptz,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp()
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
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key, token_hash text not null, scope text not null,
      status text not null, expires_at timestamptz not null,
      last_seen_at timestamptz, last_version text, created_by uuid
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key, claim_token uuid not null, worker_token_id uuid not null,
      completion_fingerprint text not null, continuation_job_id uuid
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
    create function sellerpilot_private.serverless_gateway_job_allowed(text,text)
    returns boolean language sql stable as $$ select true $$;
    create function sellerpilot_private.active_serverless_runtime_release_sha()
    returns text language sql stable as $$ select '${release}'::text $$;

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
    create function sellerpilot_private.listing_publication_review_violation_count()
    returns integer language sql stable as $$ select 0 $$;
    create function sellerpilot_private.listing_publication_review_violation_count(text)
    returns integer language sql stable as $$ select 0 $$;
    create function sellerpilot_private.listing_mutation_release_gate_is_effective()
    returns boolean language sql stable as $$ select false $$;
    create function sellerpilot_private.listing_mutation_release_gate_is_effective(text)
    returns boolean language sql stable as $$ select false $$;

    ${currentGateStatusDefinition}
    ${currentGlobalSetterDefinition}

    create function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger language plpgsql as $$ begin return new; end $$;
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

    create function public.sellerpilot_11820_claim_gateway_unsafe(
      p_token_hash text,p_worker_version text default null
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare v_token_id uuid; v_job_id uuid; v_claim_token uuid:=gen_random_uuid(); v_result jsonb;
    begin
      select token.id into v_token_id
      from sellerpilot_private.ai_cli_worker_tokens token
      where token.token_hash=p_token_hash and token.scope='gateway'
        and token.status='active' and token.expires_at>clock_timestamp()
        and token.last_version=p_worker_version;
      if v_token_id is null then return null; end if;
      select j.id into v_job_id
      from sellerpilot_private.channel_gateway_jobs j
      join sellerpilot_private.channel_credentials c
        on c.id=j.credential_id and c.status='active'
      where j.status='queued'
        and (
          (
            coalesce(current_setting('sellerpilot.local_gateway_recovery_lane',true),'')
              is distinct from 'enabled'
            and coalesce(current_setting('sellerpilot.local_channel_executor_lane',true),'')
              is distinct from 'enabled'
     and not (
       j.channel = 'smartstore'
       and j.operation not in (
         'diagnostic.test',
         'categories.list',
         'categories.suggest',
         'categories.attributes',
         'categories.validate',
         'inquiries.list',
         'listing.publication.verify'
       )
     )
            and not coalesce((
              j.id='66147e5d-0479-4c51-896e-97e782af99e1'::uuid
              and j.attempt_id='0d2c492e-2025-4717-bb3f-0fd2b886fd4f'::uuid
            ),false)
          )
          or (
            coalesce(current_setting('sellerpilot.local_gateway_recovery_lane',true),'')='enabled'
            and (
              sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(j)
              or sellerpilot_private.qoo10_shipping_s1_activation_job_matches(j)
         or (
           j.channel = 'smartstore'
           and j.operation in (
             'diagnostic.test',
             'categories.list',
             'categories.suggest',
             'categories.attributes',
             'categories.validate',
             'inquiries.list',
             'listing.publication.verify'
           )
         )
            )
          )
        )
      order by j.created_at,j.id for update of j,c skip locked limit 1;
      if v_job_id is null then return null; end if;
      update sellerpilot_private.channel_gateway_jobs
      set status='running',worker_token_id=v_token_id,claim_token=v_claim_token,
          lease_expires_at=clock_timestamp()+interval '5 minutes',
          attempt_count=attempt_count+1,updated_at=clock_timestamp()
      where id=v_job_id;
      select jsonb_build_object(
        'id',job.id,'channel',job.channel,'operation',job.operation,
        'claimToken',job.claim_token,'request',job.request_payload
      ) into v_result from sellerpilot_private.channel_gateway_jobs job where id=v_job_id;
      return v_result;
    end $$;
    create function public.sellerpilot_claim_local_gateway_recovery_job(
      p_token_hash text,p_worker_version text default null
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      perform set_config('sellerpilot.local_gateway_recovery_lane','enabled',true);
      return public.sellerpilot_11820_claim_gateway_unsafe(p_token_hash,p_worker_version);
    end $$;
    create function public.sellerpilot_183000_claim_serverless_gateway_unsafe(
      p_token_hash text,p_worker_version text default null
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare result jsonb;
    begin
      select jsonb_build_object('id',job.id) into result
      from sellerpilot_private.channel_gateway_jobs job
      where job.status='queued'
        and job.channel is distinct from 'smartstore'
      order by job.created_at limit 1;
      return result;
    end $$;

    insert into sellerpilot_private.products values(
      '${ids.product}','${ids.owner}','${sku}','active',false,'${ids.import}',10
    );
    insert into sellerpilot_private.channel_credentials(
      id,created_by,channel,environment,status,version,expires_at,
      seller_account_key,seller_account_key_source,last_check_status,last_checked_at
    ) values(
      '${ids.credential}','${ids.manager}','smartstore','production','active',3,null,
      '${sellerAccountKey}','credential_incarnation_v1','failed',clock_timestamp()-interval '1 day'
    );
    insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,status,http_status,remote_id,
      pre_gateway_retryable,request_fingerprint,seller_account_key,completed_at
    ) values(
      '${ids.sourceAttempt}','${ids.owner}','${ids.credential}','smartstore','listing.create',
      'manual_required',409,null,false,'${requestFingerprint}','${sellerAccountKey}',
      clock_timestamp()-interval '1 hour'
    );
    insert into sellerpilot_private.product_listings(
      id,owner_id,product_id,channel_key,status,failure_class,remote_visibility,
      requested_publication_intent,seller_account_key,operation_attempt_id,price
    ) values(
      '${ids.listing}','${ids.owner}','${ids.product}','smartstore','failed','external_action',
      'unknown','live',null,'${ids.sourceAttempt}',3190
    );
    insert into sellerpilot_private.external_detail_imports values(
      '${ids.import}','${ids.product}','${ids.owner}','${'9'.repeat(64)}',
      '${JSON.stringify({
        assets,
        reviewedCopy: {
          ko: { documentSha256: documentSha, document: reviewedDocument },
          ja: { documentSha256: documentSha, document: reviewedDocument },
          en: { documentSha256: documentSha, document: reviewedDocument },
        },
      })}',
      '${JSON.stringify(pixels.map((decodedRgbaSha256) => ({ decodedRgbaSha256 })))}',
      clock_timestamp()-interval '1 day',2
    );
    insert into sellerpilot_private.external_detail_approval_revisions values(
      '${ids.import}',1,'${ids.product}','${ids.owner}','${contentSha}',
      '${JSON.stringify({ product: { name: '롯샌 파인애플 315g' } })}'
    );
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${ids.worker}','${tokenHash}','gateway','active',clock_timestamp()+interval '1 day',
      clock_timestamp(),'${workerVersion}','${ids.manager}'
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
    ids.sourceJob, ids.credential, ids.sourceAttempt, ids.listing,
    JSON.stringify(fixtureRequest), JSON.stringify({ ok: false }),
    requestFingerprint, sellerAccountKey, ids.manager,
  ]);
  await db.exec(`
    select set_config('request.jwt.claim.role','service_role',false);
    select set_config('request.jwt.claim.sub','${ids.owner}',false);
  `);
  await db.exec(adoptionMigration);
  await db.exec(`
    ${lineageCompletionGuardDefinition}
    create trigger guard_listing_lineage_verification_job_completion
    before update on sellerpilot_private.channel_gateway_jobs
    for each row execute function
      sellerpilot_private.guard_listing_lineage_verification_job_completion();
  `);
  await db.exec(gatewayMigration);
  return db;
}

async function enqueue(db) {
  return (await db.query(
    'select public.sellerpilot_service_enqueue_smartstore_manual_adoption_readback($1,$2) result',
    [ids.owner, ids.product],
  )).rows[0].result;
}

async function status(db) {
  return (await db.query(
    'select public.sellerpilot_service_get_smartstore_manual_adoption_readback_status($1,$2) result',
    [ids.owner, ids.product],
  )).rows[0].result;
}

async function claim(db, mode = 'general', version = workerVersion) {
  const functionName = mode === 'recovery'
    ? 'sellerpilot_claim_local_gateway_recovery_job'
    : 'sellerpilot_11820_claim_gateway_unsafe';
  return (await db.query(
    `select public.${functionName}($1,$2) result`,
    [tokenHash, version],
  )).rows[0].result;
}

async function complete(db, claimed, completionStatus, readback = null, error = null) {
  return (await db.query(`select public.sellerpilot_complete_smartstore_manual_adoption_readback(
      $1,$2,$3,$4,$5::jsonb,$6
    ) result`, [
    tokenHash, claimed.id, claimed.claimToken, completionStatus,
    readback === null ? null : JSON.stringify(readback), error,
  ])).rows[0].result;
}

async function claimAllowed(db, jobId, version = workerVersion) {
  return (await db.query(`select
      sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
        $1,$2,$3,$4
      ) value`, [jobId, ids.credential, ids.worker, version])).rows[0].value;
}

async function job(db, id) {
  return (await db.query(`select id,status,attempt_count,worker_token_id,claim_token,
      lease_expires_at,response_payload,error_message,request_payload,listing_id,
      credential_id,seller_account_key,created_by
    from sellerpilot_private.channel_gateway_jobs where id=$1`, [id])).rows[0];
}

test('enqueue derives one shared-admin marker and reuses every non-terminal job', async () => {
  const db = await createDatabase();
  try {
    const first = await enqueue(db);
    assert.equal(first.status, 'queued');
    assert.equal(first.reused, false);
    assert.match(first.jobId, /^[0-9a-f-]{36}$/u);
    const queued = await job(db, first.jobId);
    assert.equal(queued.created_by, ids.manager);
    assert.equal(queued.credential_id, ids.credential);
    assert.equal(queued.listing_id, ids.listing);
    assert.equal(queued.request_payload.arguments.sellerpilotSmartstoreManualAdoptionReadback.ownerId, ids.owner);
    assert.equal(queued.request_payload.arguments.sellerpilotSmartstoreManualAdoptionReadback.contract,
      'smartstore_manual_adoption_readback_job_v1');
    assert.equal(queued.request_payload.arguments.sellerpilotSmartstoreManualAdoptionReadback.contentSha256,
      contentSha);

    const duplicate = await enqueue(db);
    assert.equal(duplicate.status, 'queued');
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.jobId, first.jobId);
    await assert.rejects(
      db.query(`update sellerpilot_private.channel_gateway_jobs
        set status='failed' where id=$1`, [first.jobId]),
      /dedicated lineage verification completion required/u,
    );
    assert.equal((await job(db, first.jobId)).status, 'queued');
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set status='running',worker_token_id=$2,claim_token=gen_random_uuid(),
          lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1`,
    [first.jobId, ids.worker]);
    assert.equal((await enqueue(db)).jobId, first.jobId);
    await db.exec(`
      select set_config('sellerpilot.provider_listing_lineage_rebind','${first.jobId}',false);
      update sellerpilot_private.channel_gateway_jobs
      set status='reconciliation_required',lease_expires_at=null where id='${first.jobId}';
      select set_config('sellerpilot.provider_listing_lineage_rebind','',false);
    `);
    const reconciliation = await enqueue(db);
    assert.equal(reconciliation.status, 'reconciliation_required');
    assert.equal(reconciliation.jobId, first.jobId);
    assert.equal((await db.query(`select count(*)::int count
      from sellerpilot_private.channel_gateway_jobs
      where operation='listing.lineage.verify'`)).rows[0].count, 1);
    assert.equal((await job(db, ids.sourceJob)).status, 'reconciliation_required');
  } finally {
    await db.close();
  }
});

test('general and recovery claims allow only the exact current marker while the SmartStore mutation gate is closed', async () => {
  for (const mode of ['general', 'recovery']) {
    const db = await createDatabase();
    try {
      const queued = await enqueue(db);
      assert.equal((await db.query(
        'select sellerpilot_private.listing_mutation_release_gate_is_effective($1) value',
        ['smartstore'],
      )).rows[0].value, false);
      assert.equal(await claim(db, mode, `sellerpilot-cli-worker/1.61+${'7'.repeat(40)}.${egress.slice(0, 11)}`), null);
      const claimed = await claim(db, mode);
      assert.equal(claimed.id, queued.jobId);
      assert.equal(claimed.operation, 'listing.lineage.verify');
      assert.equal(claimed.request.arguments.sellerpilotSmartstoreManualAdoptionReadback.productId,
        ids.product);
      const claimedRow = await job(db, queued.jobId);
      assert.equal(claimedRow.status, 'running');
      assert.equal(claimedRow.worker_token_id, ids.worker);
      assert.match(claimedRow.claim_token, /^[0-9a-f-]{36}$/u);
      assert.ok(claimedRow.lease_expires_at);
    } finally {
      await db.close();
    }
  }

  const db = await createDatabase();
  try {
    const queued = await enqueue(db);
    await assert.rejects(() => db.query(`update sellerpilot_private.channel_gateway_jobs
      set request_payload=jsonb_set(request_payload,
        '{arguments,sellerpilotSmartstoreManualAdoptionReadback,contentSha256}',
        to_jsonb($2::text)) where id=$1`, [queued.jobId, 'f'.repeat(64)]),
    /SMARTSTORE_ADOPTION_READBACK_MARKER_INVALID/u);
    assert.equal((await db.query(
      'select public.sellerpilot_183000_claim_serverless_gateway_unsafe($1,$2) result',
      [tokenHash, workerVersion],
    )).rows[0].result, null);
  } finally {
    await db.close();
  }
});

test('readback retries use bounded 5, 10, 20, 40, and 80 second claim backoff', async () => {
  const db = await createDatabase();
  try {
    const queued = await enqueue(db);
    for (const [attemptCount, delaySeconds] of [[1, 5], [2, 10], [3, 20], [4, 40], [5, 80]]) {
      await db.query(`update sellerpilot_private.channel_gateway_jobs
        set status='queued',attempt_count=$2,
            updated_at=clock_timestamp()-($3::text || ' seconds')::interval
        where id=$1`, [queued.jobId, attemptCount, delaySeconds - 1]);
      assert.equal(await claimAllowed(db, queued.jobId), false);
      await db.query(`update sellerpilot_private.channel_gateway_jobs
        set updated_at=clock_timestamp()-($2::text || ' seconds')::interval
        where id=$1`, [queued.jobId, delaySeconds + 1]);
      assert.equal(await claimAllowed(db, queued.jobId), true);
    }

    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set status='queued',attempt_count=0,updated_at=clock_timestamp() where id=$1`, [queued.jobId]);
    const claimed = await claim(db);
    const retry = await complete(
      db, claimed, 'retryable', null,
      'SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE:NAVER_IP_NOT_ALLOWED',
    );
    assert.equal(retry.status, 'queued');
    assert.equal((await job(db, queued.jobId)).status, 'queued');
    assert.equal(await claimAllowed(db, queued.jobId), false);
    const replay = await complete(
      db, claimed, 'retryable', null,
      'SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE:NAVER_IP_NOT_ALLOWED',
    );
    assert.equal(replay.status, 'queued');
    assert.equal(replay.reused, true);

    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set updated_at=clock_timestamp()-interval '6 seconds' where id=$1`, [queued.jobId]);
    const finalClaim = await claim(db);
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set attempt_count=6 where id=$1`, [queued.jobId]);
    const exhausted = await complete(db, finalClaim, 'retryable', null, 'NAVER_IP_NOT_ALLOWED');
    assert.equal(exhausted.status, 'reconciliation_required');
    const reconciled = await job(db, queued.jobId);
    assert.equal(reconciled.status, 'reconciliation_required');
    assert.equal(reconciled.worker_token_id, null);
    assert.equal(reconciled.claim_token, null);
    assert.equal(reconciled.lease_expires_at, null);
  } finally {
    await db.close();
  }
});

test('successful completion commits atomically, stores only safe response data, and replays the same digest', async () => {
  const db = await createDatabase();
  try {
    const queued = await enqueue(db);
    const claimed = await claim(db);
    const sourceBefore = await job(db, ids.sourceJob);
    const evidence = officialReadback();
    await db.exec("select set_config('sellerpilot.provider_listing_lineage_rebind','caller-sentinel',false)");
    const result = await complete(db, claimed, 'succeeded', evidence);
    assert.equal(result.status, 'verified');
    assert.equal(result.reused, false);
    assert.match(result.readbackSha256, /^[a-f0-9]{64}$/u);
    assert.equal((await db.query(
      "select current_setting('sellerpilot.provider_listing_lineage_rebind',true) value",
    )).rows[0].value, 'caller-sentinel');
    const verifiedJob = await job(db, queued.jobId);
    assert.equal(verifiedJob.status, 'succeeded');
    assert.equal(verifiedJob.response_payload.contract,
      'smartstore_manual_adoption_gateway_receipt_v1');
    assert.equal(verifiedJob.response_payload.providerMutationPerformed, false);
    assert.equal('readback' in verifiedJob.response_payload, false);
    assert.doesNotMatch(JSON.stringify(verifiedJob.response_payload), /searchReadback|detailImageUrls/u);
    assert.deepEqual(await job(db, ids.sourceJob), sourceBefore);

    const adopted = (await db.query(`select status,remote_id,remote_visibility,
      provider_status,failure_class,remote_resources
      from sellerpilot_private.product_listings where id=$1`, [ids.listing])).rows[0];
    assert.equal(adopted.status, 'published');
    assert.equal(adopted.remote_id, originNo);
    assert.equal(adopted.remote_visibility, 'live');
    assert.equal(adopted.failure_class, null);
    assert.equal(adopted.remote_resources.resources.smartstoreChannelProductNo, channelNo);
    const polled = await status(db);
    assert.equal(polled.status, 'verified');
    assert.equal(polled.jobId, queued.jobId);
    assert.equal(polled.normalUpdateEligible, true);

    const replay = await complete(db, claimed, 'succeeded', evidence);
    assert.equal(replay.status, 'verified');
    assert.equal(replay.reused, true);
    assert.equal(replay.readbackSha256, result.readbackSha256);
    const changed = officialReadback();
    changed.observedAt = new Date(Date.now() - 20_000).toISOString();
    const mismatch = await complete(db, claimed, 'succeeded', changed);
    assert.equal(mismatch.status, 'reconciliation_required');
    assert.equal(mismatch.reason, 'COMPLETION_REPLAY_MISMATCH');
    assert.equal((await job(db, queued.jobId)).status, 'succeeded');
  } finally {
    await db.close();
  }
});

test('CAS drift becomes terminal reconciliation without partially changing the listing or source ledger', async () => {
  const db = await createDatabase();
  try {
    const queued = await enqueue(db);
    const claimed = await claim(db);
    const listingBefore = (await db.query(
      'select to_jsonb(value) snapshot from sellerpilot_private.product_listings value where id=$1',
      [ids.listing],
    )).rows[0].snapshot;
    const sourceBefore = await job(db, ids.sourceJob);
    await db.query(`update sellerpilot_private.external_detail_approval_revisions
      set content_sha256=$2 where import_id=$1 and revision=1`, [ids.import, 'f'.repeat(64)]);
    const result = await complete(db, claimed, 'succeeded', officialReadback());
    assert.equal(result.status, 'reconciliation_required');
    assert.equal(result.reason, 'SMARTSTORE_ADOPTION_READBACK_CAS_DRIFT');
    assert.equal(result.readbackSha256, null);
    const listingAfter = (await db.query(
      'select to_jsonb(value) snapshot from sellerpilot_private.product_listings value where id=$1',
      [ids.listing],
    )).rows[0].snapshot;
    assert.deepEqual(listingAfter, listingBefore);
    assert.deepEqual(await job(db, ids.sourceJob), sourceBefore);
    const reconciled = await job(db, queued.jobId);
    assert.equal(reconciled.status, 'reconciliation_required');
    assert.equal(reconciled.worker_token_id, null);
    assert.equal(reconciled.claim_token, null);
    assert.equal(reconciled.lease_expires_at, null);
    assert.equal((await db.query(
      'select count(*)::int count from sellerpilot_private.smartstore_adoption_readback_completion_receipts',
    )).rows[0].count, 1);
  } finally {
    await db.close();
  }
});

test('failed completion is terminal until an explicit enqueue creates one new verifier', async () => {
  const db = await createDatabase();
  try {
    const first = await enqueue(db);
    const claimed = await claim(db);
    const failed = await complete(
      db, claimed, 'failed', null, 'private provider response body',
    );
    assert.equal(failed.status, 'failed');
    assert.equal(failed.reason, 'READBACK_FAILED');
    const failedJob = await job(db, first.jobId);
    assert.equal(failedJob.status, 'failed');
    assert.equal(failedJob.error_message, 'SMARTSTORE_ADOPTION_READBACK_FAILED');
    assert.doesNotMatch(JSON.stringify(failedJob.response_payload), /private provider response body/u);
    const polled = await status(db);
    assert.equal(polled.status, 'blocked');
    assert.equal(polled.reason, 'READBACK_FAILED');

    const second = await enqueue(db);
    assert.equal(second.status, 'queued');
    assert.equal(second.reused, false);
    assert.notEqual(second.jobId, first.jobId);
    assert.equal((await job(db, first.jobId)).status, 'failed');
    assert.equal((await enqueue(db)).jobId, second.jobId);
    assert.equal((await db.query(`select count(*)::int count
      from sellerpilot_private.channel_gateway_jobs
      where operation='listing.lineage.verify'`)).rows[0].count, 2);
  } finally {
    await db.close();
  }
});
