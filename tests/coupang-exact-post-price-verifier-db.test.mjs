import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908061500_enqueue_exact_coupang_post_price_publication_verifier.sql",
  import.meta.url,
), "utf8");
const routeMigration = await readFile(new URL(
  "../supabase/migrations/20260908062500_bind_exact_coupang_post_price_verifier_route.sql",
  import.meta.url,
), "utf8");

const ids = Object.freeze({
  sellerOwner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  credentialOwner: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  sourceJob: "25adf712-1e9a-432b-8b0d-09cf35a826c5",
  sourceAttempt: "d771421b-f408-4f75-addd-03879393fab8",
  oldVerifier: "86d2cb63-d382-4cc9-8153-654cf7ccec80",
  listing: "fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4",
  credential: "32de2968-d4b7-4fda-a84b-16a7ce0257cc",
  worker: "02955cb4-fa9f-466b-824f-b61f06276190",
  route: "11111111-1111-4111-8111-111111111111",
  predecessorRoute: "73e07b05-b3bd-47e4-be92-062d537150e9",
  repairJob: "36fcb808-a2f1-42b7-a6c9-264d884f25fb",
  repairAttempt: "05508966-7665-4873-a89b-89fda8ea8a25",
  repairClaim: "22222222-2222-4222-8222-222222222222",
});
const sellerKey =
  "e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd";
const sourceFingerprint =
  "f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d";
const release = "b".repeat(40);
const egress =
  "92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01";
const tokenHash = "a".repeat(64);
const workerVersion = `sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}`;
const predecessorDigests = Object.freeze([
  [
    "sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)",
    "d8918fbe0051ad2a00a83df463f7dda31980a98bca14786fca7d359363e96b85",
  ],
  [
    "public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)",
    "9c4f70b305305ef649812746c6fb1e5af0b813b3518c70960106cf5d9c3ac2e2",
  ],
  [
    "public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)",
    "61979aed80b64d9a9ad8ec79945790df51d209b3d0f102d21716f38fe96e8035",
  ],
  [
    "public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)",
    "d4d4acff0257923b7d6c74fd05a13cf4a09e5c388bb9165a3d64ba9dc9b77130",
  ],
  [
    "sellerpilot_private.guard_product_listing_seller_lineage()",
    "b2775958aa6083a99a10065e01033cedec63344434d80091a2c5d3cc95ef5f59",
  ],
]);
const renderedMigrations = new WeakMap();
const renderedRouteMigrations = new WeakMap();

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function renderMigrationForFixture(db) {
  let rendered = migration;
  for (const [procedureName, productionDigest] of predecessorDigests) {
    assert.ok(migration.includes(productionDigest), procedureName);
    const fixtureDigest = await scalar(
      db,
      `select encode(extensions.digest(
         pg_catalog.pg_get_functiondef($1::regprocedure),'sha256'
       ),'hex')`,
      [procedureName],
    );
    assert.notEqual(fixtureDigest, productionDigest, procedureName);
    rendered = rendered.replaceAll(productionDigest, fixtureDigest);
  }
  return rendered;
}

function sourcePayload() {
  const images = Array.from({ length: 8 }, (_, index) => ({
    role: `detail-${index + 1}`,
    publicUrl: `https://cdn.example.test/detail-${index + 1}.jpg`,
  }));
  return {
    arguments: {
      sellerpilotPublicationAssetBinding: {
        contract: "sellerpilot_provider_asset_binding_v1",
        approvedManifestDigest: "c".repeat(64),
        approvedDetailPageVersion: 13,
        approvedDetailImages: images,
        providerTransportImages: images,
      },
    },
  };
}

function sourceResponse() {
  return {
    ok: true,
    channel: "coupang",
    operation: "listing.create",
    remoteId: "16375780938",
    steps: [{
      name: "listing-approval-readback",
      ok: true,
      status: 200,
      data: {
        code: "SUCCESS",
        data: {
          sellerProductId: "16375780938",
          requested: false,
          statusName: "승인완료",
          items: [{ vendorItemId: "96027942778" }],
        },
      },
    }],
  };
}

function repairResponse() {
  return {
    ok: true,
    channel: "coupang",
    operation: "price.update",
    remoteId: "96027942778",
    steps: [
      { name: "price", ok: true, status: 200, data: { code: "SUCCESS" } },
      {
        name: "price-readback",
        ok: true,
        status: 200,
        data: {
          code: "SUCCESS",
          data: { salePrice: 3190 },
          sellerpilotVendorItemId: "96027942778",
          sellerpilotRequestedPrice: 3190,
          sellerpilotObservedPrice: 3190,
          sellerpilotCurrency: "KRW",
          sellerpilotVerification: "COUPANG_VENDOR_ITEM_PRICE_VERIFIED",
        },
      },
    ],
  };
}

function completionResponse(priceRepairResponseSha256) {
  const verifiedAt = "2026-09-08T06:30:00.000Z";
  return {
    ok: true,
    channel: "coupang",
    operation: "listing.publication.verify",
    remoteId: "16375780938",
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationFulfilled: true,
    steps: [
      {
        name: "seller-product-publication-reverification",
        ok: true,
        status: 200,
        data: {
          code: "SUCCESS",
          data: {
            sellerProductId: "16375780938",
            productId: "9725220700",
            requested: false,
            statusName: "승인완료",
            items: [{
              itemId: "29102903416",
              productId: "9725220700",
              vendorItemId: "96027942778",
            }],
          },
        },
      },
      {
        name: "vendor-item-publication-reverification",
        ok: true,
        status: 200,
        data: {
          code: "SUCCESS",
          data: {
            sellerItemId: "96027942778",
            onSale: true,
            amountInStock: 1,
            salePrice: 3190,
          },
          sellerpilotVendorItemId: "96027942778",
          sellerpilotObservedSellerItemId: "96027942778",
          sellerpilotObservedPrice: 3190,
          sellerpilotObservedStock: 1,
          sellerpilotCurrency: "KRW",
          sellerpilotVerification:
            "COUPANG_POST_PRICE_PUBLICATION_PRICE_VERIFIED",
        },
      },
      {
        name: "publication-content-verification",
        ok: true,
        status: 200,
        data: {
          sellerpilotVerification: "LISTING_PUBLICATION_CONTENT_VERIFIED",
          sourceJobId: ids.sourceJob,
          sourceOperation: "listing.create",
          titleVerified: true,
          descriptionVerified: true,
          languageContentVerified: true,
          detailImageCountVerified: true,
          approvedManifestDigestVerified: true,
          sourceIdentityVerified: true,
          contentDigestVerified: true,
          sourceDetailImageCount: 8,
          sourceReadbackDetailImageCount: 8,
          remoteDetailImageCount: 8,
        },
      },
      {
        name: "post-price-publication-verification",
        ok: true,
        status: 200,
        data: {
          sellerpilotVerification: "COUPANG_POST_PRICE_PUBLICATION_VERIFIED",
          providerMutationPerformed: false,
          buyerVisibleVerified: false,
          observedPrice: 3190,
          observedStock: 1,
          currency: "KRW",
          sellerRequested: false,
          productId: "9725220700",
          itemId: "29102903416",
          expectedProductId: "9725220700",
          expectedItemId: "29102903416",
          publicUrl:
            "https://www.coupang.com/vp/products/9725220700?vendorItemId=96027942778",
        },
      },
    ],
    remoteState: {
      verified: true,
      visibility: "live",
      locale: "ko-KR",
      fingerprint: sourceFingerprint,
      imageCount: 8,
      providerStatus: "APPROVED|requested=false|onSale=true",
      verifiedAt,
      resources: {
        productId: "9725220700",
        sellerProductId: "16375780938",
        vendorItemIds: ["96027942778"],
        itemId: "29102903416",
      },
      evidence: {
        verificationScope: "provider_publication_after_price_repair",
        priceRepairJobId: ids.repairJob,
        priceRepairAttemptId: ids.repairAttempt,
        priceRepairResponseSha256,
        priceRepairOfficialReadbackVerified: true,
        postPricePublicationReadbackVerified: true,
        sourceJobId: ids.sourceJob,
        sourceOperation: "listing.create",
        contentVerified: true,
        observedPrice: 3190,
        observedStock: 1,
        currency: "KRW",
        providerPublicUrl:
          "https://www.coupang.com/vp/products/9725220700?vendorItemId=96027942778",
        providerMutationPerformed: false,
        buyerVisibleVerified: false,
      },
    },
  };
}

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(String.raw`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema sellerpilot_private;

    create table auth.users(id uuid primary key);
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      created_by uuid not null,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      last_check_status text,
      seller_account_key text,
      seller_account_key_source text not null default 'provider_certified_v1'
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      remote_id text,
      request_fingerprint text,
      idempotency_key text,
      started_at timestamptz,
      completed_at timestamptz
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid,
      operation_attempt_id uuid,
      channel_key text not null,
      market text,
      target_id text,
      seller_account_key text,
      marketplace_sku text,
      remote_id text,
      status text not null,
      failure_class text,
      requested_publication_intent text,
      remote_visibility text,
      provider_status text,
      remote_resources jsonb,
      public_url text,
      published_at timestamptz,
      last_verified_at timestamptz,
      last_error text,
      currency text,
      price numeric,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,
      created_by uuid not null,
      token_hash text not null,
      scope text not null,
      status text not null,
      expires_at timestamptz not null,
      last_seen_at timestamptz,
      last_version text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      credential_id uuid,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb,
      status text not null default 'queued',
      error_message text,
      worker_token_id uuid,
      claim_token uuid,
      attempt_count integer not null default 0,
      lease_expires_at timestamptz,
      created_by uuid,
      created_at timestamptz not null default clock_timestamp(),
      started_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz not null default clock_timestamp(),
      seller_account_key text,
      request_fingerprint text,
      write_resource_kind text,
      write_resource_key text,
      provider_mutation_started_at timestamptz,
      oauth_provider_call_started_at timestamptz
    );
    create table sellerpilot_private.local_channel_executor_routes(
      id uuid primary key,
      owner_id uuid not null,
      channel text not null,
      operation text not null,
      credential_id uuid not null,
      seller_account_key text not null,
      worker_token_id uuid not null,
      release_sha text not null,
      egress_ip_sha256 text not null,
      approved_by uuid not null,
      approved_at timestamptz not null,
      expires_at timestamptz not null,
      enabled boolean not null,
      created_at timestamptz not null default clock_timestamp(),
      constraint local_channel_executor_routes_operation_check check (
        (channel = 'coupang' and operation in (
          'categories.attributes','categories.validate','listing.create'
        ))
        or (channel = 'smartstore' and operation in (
          'listing.create','listing.update'
        ))
      )
    );
    create table sellerpilot_private.serverless_static_egress_policy(
      channel text primary key,
      enabled boolean not null
    );
    create table sellerpilot_private.operation_audit(
      id bigint generated always as identity primary key,
      owner_id uuid,
      action text,
      entity_type text,
      entity_id text,
      safe_detail jsonb,
      occurred_at timestamptz default clock_timestamp()
    );
    create table sellerpilot_private.coupang_exact_price_repair_permits(
      permit_id uuid primary key default gen_random_uuid(),
      source_job_id uuid not null,
      source_attempt_id uuid not null,
      verifier_job_id uuid not null,
      listing_id uuid not null,
      credential_id uuid not null,
      seller_owner_id uuid not null,
      seller_account_key text not null,
      seller_product_id text not null,
      vendor_item_id text not null,
      desired_price integer not null,
      currency text not null,
      egress_ip_sha256 text not null,
      repair_attempt_id uuid not null unique,
      repair_job_id uuid not null unique,
      bound_at timestamptz,
      bound_worker_token_id uuid,
      bound_claim_token uuid,
      consumed_at timestamptz,
      contract text not null
    );

    create function sellerpilot_private.active_serverless_runtime_release_sha()
    returns text language sql stable set search_path = '' as
      $$ select current_setting('fixture.release', true) $$;

    create function sellerpilot_private.listing_mutation_release_gate_is_effective(
      p_channel text
    ) returns boolean language sql stable set search_path = '' as
      $$ select false $$;

    create function public.sellerpilot_service_listing_mutation_release_gate_status()
    returns jsonb language sql stable security definer set search_path = '' as
      $$ select '{"open":false,"effectiveOpen":false}'::jsonb $$;

    create function sellerpilot_private.local_channel_executor_access(
      p_channel text, p_operation text
    ) returns text language sql immutable set search_path = '' as $function$
     select case
     when p_channel = 'coupang' and p_operation in ('categories.attributes','categories.validate') then 'read'
     when p_operation = 'listing.create' and p_channel in ('coupang','smartstore') then 'write'
     when p_channel = 'smartstore' and p_operation = 'listing.update' then 'write'
     else null
     end
    $function$;
    revoke all on function
      sellerpilot_private.local_channel_executor_access(text,text)
      from public, anon, authenticated, service_role;

    create function sellerpilot_private.local_channel_executor_route_is_current(
      p_owner uuid, p_channel text, p_operation text, p_credential uuid,
      p_worker uuid, p_release text, p_egress text, p_version text
    ) returns boolean language sql stable set search_path = '' as $$
      select exists (
        select 1 from sellerpilot_private.local_channel_executor_routes route
         where route.owner_id = p_owner
           and route.channel = p_channel
           and route.operation = p_operation
           and route.credential_id = p_credential
           and route.worker_token_id = p_worker
           and route.release_sha = p_release
           and route.egress_ip_sha256 = p_egress
           and route.enabled
           and route.expires_at > clock_timestamp()
           and p_version = 'sellerpilot-cli-worker/1.61+'
             || p_release || '.' || left(p_egress, 11)
      )
    $$;

    create function sellerpilot_private.local_channel_executor_job_allowed(
      uuid, uuid, uuid, text, text, text
    ) returns boolean language sql stable set search_path = '' as
      $$ select false $$;

    create function sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
      p_job_id uuid
    ) returns boolean language sql stable set search_path = '' as $$
      select p_job_id = '${ids.sourceJob}'::uuid
    $$;

    create function sellerpilot_private.coupang_exact_live_asset_digest(
      p_binding jsonb
    ) returns text language sql immutable set search_path = '' as $$
      select encode(extensions.digest(p_binding::text, 'sha256'), 'hex')
    $$;

    create function sellerpilot_private.coupang_exact_live_json_array(
      p_value jsonb
    ) returns text language sql immutable set search_path = '' as $$
      select coalesce(p_value::text, '[]')
    $$;

    create function sellerpilot_private.coupang_exact_price_repair_succeeded(
      job sellerpilot_private.channel_gateway_jobs
    ) returns boolean language sql immutable strict set search_path = '' as $$
      select job.id = '${ids.repairJob}'::uuid
        and job.operation = 'price.update'
        and job.status = 'succeeded'
        and job.provider_mutation_started_at is not null
        and job.completed_at is not null
        and job.error_message is null
        and job.response_payload#>'{ok}' = 'true'::jsonb
        and job.response_payload#>>'{channel}' = 'coupang'
        and job.response_payload#>>'{operation}' = 'price.update'
        and job.response_payload#>>'{remoteId}' = '96027942778'
        and jsonb_array_length(job.response_payload->'steps') = 2
        and job.response_payload#>>'{steps,0,name}' = 'price'
        and job.response_payload#>'{steps,0,ok}' = 'true'::jsonb
        and job.response_payload#>>'{steps,1,name}' = 'price-readback'
        and job.response_payload#>'{steps,1,ok}' = 'true'::jsonb
        and job.response_payload#>>'{steps,1,data,sellerpilotVendorItemId}' =
          '96027942778'
        and job.response_payload#>'{steps,1,data,sellerpilotRequestedPrice}' =
          '3190'::jsonb
        and job.response_payload#>'{steps,1,data,sellerpilotObservedPrice}' =
          '3190'::jsonb
        and job.response_payload#>>'{steps,1,data,sellerpilotCurrency}' = 'KRW'
        and job.response_payload#>>'{steps,1,data,sellerpilotVerification}' =
          'COUPANG_VENDOR_ITEM_PRICE_VERIFIED'
    $$;

    create function public.sellerpilot_service_listing_publication_verification_source(
      text, uuid, uuid
    ) returns jsonb language sql security definer set search_path = '' as
      $$ select null::jsonb $$;

    create function public.sellerpilot_claim_local_channel_executor_job(
      p_token_hash text,
      p_worker_version text,
      p_release_sha text,
      p_egress_ip_sha256 text
    ) returns jsonb language plpgsql security definer set search_path = '' as $$
    declare
      selected_job sellerpilot_private.channel_gateway_jobs%rowtype;
      selected_worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
      new_claim uuid := gen_random_uuid();
    begin
      select * into selected_worker
        from sellerpilot_private.ai_cli_worker_tokens worker
       where worker.token_hash = p_token_hash
         and worker.scope = 'gateway'
         and worker.status = 'active'
         and worker.expires_at > clock_timestamp();
      if selected_worker.id is null then return null; end if;
      select * into selected_job
        from sellerpilot_private.channel_gateway_jobs job
       where job.status = 'queued'
         and sellerpilot_private.local_channel_executor_job_allowed(
           job.id, job.credential_id, selected_worker.id, p_worker_version,
           p_release_sha, p_egress_ip_sha256
         )
       order by job.created_at, job.id
       limit 1
       for update skip locked;
      if selected_job.id is null then return null; end if;
      update sellerpilot_private.channel_gateway_jobs job
         set status = 'running', worker_token_id = selected_worker.id,
             claim_token = new_claim, attempt_count = job.attempt_count + 1,
             started_at = clock_timestamp(), updated_at = clock_timestamp(),
             lease_expires_at = clock_timestamp() + interval '5 minutes'
       where job.id = selected_job.id;
      return jsonb_build_object(
        'id', selected_job.id,
        'claim_token', new_claim,
        'credential_id', selected_job.credential_id,
        'channel', selected_job.channel,
        'operation', selected_job.operation,
        'environment', selected_job.environment,
        'request', selected_job.request_payload
      );
    end
    $$;

    create function public.sellerpilot_service_complete_gateway_transaction(
      p_token_hash text,
      p_job_id uuid,
      p_claim_token uuid,
      p_status text,
      p_response_payload jsonb default null,
      p_error_message text default null,
      p_credential_refresh jsonb default null,
      p_normalized_orders jsonb default null,
      p_normalized_inquiries jsonb default null,
      p_diagnostic jsonb default null
    ) returns jsonb language plpgsql security definer set search_path = '' as $$
    declare
      current_job sellerpilot_private.channel_gateway_jobs%rowtype;
    begin
      select * into current_job
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = p_job_id for update;
      if current_job.status = p_status
         and current_job.response_payload = p_response_payload
         and current_job.completed_at is not null then
        return jsonb_build_object('status', 'completed_replay', 'jobId', p_job_id);
      end if;
      if current_job.status <> 'running'
         or current_job.claim_token is distinct from p_claim_token
         or current_job.lease_expires_at <= clock_timestamp()
         or not exists (
           select 1 from sellerpilot_private.ai_cli_worker_tokens worker
            where worker.id = current_job.worker_token_id
              and worker.token_hash = p_token_hash
         ) then
        return jsonb_build_object('status', 'rejected', 'jobId', p_job_id);
      end if;
      update sellerpilot_private.channel_gateway_jobs
         set status = p_status,
             response_payload = p_response_payload,
             error_message = p_error_message,
             completed_at = clock_timestamp(),
             lease_expires_at = null,
             updated_at = clock_timestamp()
       where id = p_job_id;
      return jsonb_build_object('status', 'completed', 'jobId', p_job_id);
    end
    $$;

    create function sellerpilot_private.guard_product_listing_seller_lineage()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if new.id is distinct from old.id
         or new.owner_id is distinct from old.owner_id
         or new.product_id is distinct from old.product_id
         or new.channel_key is distinct from old.channel_key then
        raise exception 'invalid listing identity change';
      end if;
      return new;
    end
    $$;
    create trigger guard_product_listing_seller_lineage
      before update on sellerpilot_private.product_listings
      for each row execute function
        sellerpilot_private.guard_product_listing_seller_lineage();
  `);

  await db.query("insert into auth.users values($1),($2)", [
    ids.sellerOwner,
    ids.credentialOwner,
  ]);
  await db.query(
    "insert into sellerpilot_private.admin_users values($1),($2)",
    [ids.sellerOwner, ids.credentialOwner],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials(
      id,created_by,channel,environment,status,expires_at,
      last_check_status,seller_account_key
    ) values(
      $1,$2,'coupang','production','active',clock_timestamp()+interval '1 day',
      'passed',$3
    )`,
    [ids.credential, ids.credentialOwner, sellerKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,status,remote_id,
      request_fingerprint,idempotency_key,started_at,completed_at
    ) values
      ($1,$3,$4,'coupang','listing.create','manual_required','16375780938',
       $5,'source-create',clock_timestamp()-interval '2 hours',null),
      ($2,$3,$4,'coupang','price.update','succeeded','96027942778',
       $6,'price-repair',clock_timestamp()-interval '30 minutes',
       clock_timestamp()-interval '20 minutes')`,
    [
      ids.sourceAttempt,
      ids.repairAttempt,
      ids.sellerOwner,
      ids.credential,
      sourceFingerprint,
      "d".repeat(64),
    ],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings(
      id,owner_id,channel_key,market,target_id,seller_account_key,
      marketplace_sku,remote_id,status,failure_class,
      requested_publication_intent,remote_visibility,provider_status,
      remote_resources,currency,price,updated_at
    ) values(
      $1,$2,'coupang','','',$3,'AUTO-780720401E2D4E4EA45F',
      '16375780938','failed','external_action','live','live',
      'APPROVED|requested=false|onSale=true',
      '{"resources":{"sellerProductId":"16375780938","vendorItemIds":["96027942778"]}}',
      'KRW',3190,clock_timestamp()-interval '1 hour'
    )`,
    [ids.listing, ids.sellerOwner, sellerKey],
  );
  await db.query(
    `insert into sellerpilot_private.ai_cli_worker_tokens values(
      $1,$2,$3,'gateway','active',clock_timestamp()+interval '1 day',
      clock_timestamp(),$4
    )`,
    [ids.worker, ids.credentialOwner, tokenHash, workerVersion],
  );
  await db.query(
    `insert into sellerpilot_private.local_channel_executor_routes(
      id,owner_id,channel,operation,credential_id,seller_account_key,
      worker_token_id,release_sha,egress_ip_sha256,approved_by,
      approved_at,expires_at,enabled
    ) values(
      $1,$2,'coupang','categories.attributes',$3,$4,$5,$6,$7,$8,
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',true
    ),(
      $9,$2,'coupang','listing.create',$3,$4,$5,
      'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca',$7,$2,
      clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 hour',true
    )`,
    [
      ids.route,
      ids.sellerOwner,
      ids.credential,
      sellerKey,
      ids.worker,
      release,
      egress,
      ids.sellerOwner,
      ids.predecessorRoute,
    ],
  );
  await db.exec("insert into sellerpilot_private.serverless_static_egress_policy values('coupang',false)");
  await db.exec(`set fixture.release='${release}'`);
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,
      request_payload,response_payload,status,created_by,seller_account_key,
      request_fingerprint,attempt_count,provider_mutation_started_at,
      started_at,completed_at
    ) values
      ($1,$4,$5,$6,'coupang','listing.create','production',$7::jsonb,
       $8::jsonb,'reconciliation_required',$9,$10,$11,1,
       clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours',
       clock_timestamp()-interval '1 hour'),
      ($2,$4,null,$6,'coupang','listing.publication.verify','production','{}',
       '{}','reconciliation_required',$9,$10,$11,4,null,
       clock_timestamp()-interval '90 minutes',clock_timestamp()-interval '1 hour'),
      ($3,$4,$12,$6,'coupang','price.update','production',$13::jsonb,
       $14::jsonb,'succeeded',$9,$10,$15,2,
       clock_timestamp()-interval '25 minutes',clock_timestamp()-interval '30 minutes',
       clock_timestamp()-interval '20 minutes')`,
    [
      ids.sourceJob,
      ids.oldVerifier,
      ids.repairJob,
      ids.credential,
      ids.sourceAttempt,
      ids.listing,
      JSON.stringify(sourcePayload()),
      JSON.stringify(sourceResponse()),
      ids.credentialOwner,
      sellerKey,
      sourceFingerprint,
      ids.repairAttempt,
      JSON.stringify({
        arguments: {
          sellerProductId: "16375780938",
          vendorItemId: "96027942778",
          price: 3190,
          currency: "KRW",
          forceSalePriceUpdate: true,
        },
      }),
      JSON.stringify(repairResponse()),
      "d".repeat(64),
    ],
  );
  await db.query(
    `insert into sellerpilot_private.coupang_exact_price_repair_permits(
      source_job_id,source_attempt_id,verifier_job_id,listing_id,credential_id,
      seller_owner_id,seller_account_key,seller_product_id,vendor_item_id,
      desired_price,currency,egress_ip_sha256,repair_attempt_id,repair_job_id,
      bound_at,bound_worker_token_id,bound_claim_token,consumed_at,contract
    ) values(
      $1,$2,$3,$4,$5,$6,$7,'16375780938','96027942778',3190,'KRW',$8,
      $9,$10,clock_timestamp()-interval '25 minutes',$11,$12,
      clock_timestamp()-interval '24 minutes','coupang_exact_price_repair_permit_v1'
    )`,
    [
      ids.sourceJob,
      ids.sourceAttempt,
      ids.oldVerifier,
      ids.listing,
      ids.credential,
      ids.sellerOwner,
      sellerKey,
      egress,
      ids.repairAttempt,
      ids.repairJob,
      ids.worker,
      ids.repairClaim,
    ],
  );
  await db.exec("set request.jwt.claim.role='service_role'");
  const renderedMigration = await renderMigrationForFixture(db);
  await db.exec(renderedMigration);
  renderedMigrations.set(db, renderedMigration);
  const fixtureAccessDigest = await scalar(
    db,
    `select encode(extensions.digest(
       pg_catalog.pg_get_functiondef(
         'sellerpilot_private.local_channel_executor_access(text,text)'::regprocedure
       ),'sha256'
     ),'hex')`,
  );
  const renderedRouteMigration = routeMigration.replaceAll(
    "835e89f37898c7ef411a7831c80ec5d481cc3719ac7a822af0d177be9258743a",
    fixtureAccessDigest,
  );
  await db.exec(renderedRouteMigration);
  renderedRouteMigrations.set(db, renderedRouteMigration);
  const bound = (await db.query(
    "select public.sellerpilot_service_bind_exact_coupang_post_price_route($1) result",
    [release],
  )).rows[0].result;
  assert.equal(bound.status, "ready");
  assert.equal(bound.reused, false);
  assert.equal(bound.providerMutationPerformed, false);
  assert.equal(bound.gatewayJobCreated, false);
  return db;
}

async function enqueueAndClaim(db) {
  const enqueued = (await db.query(
    "select public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier($1) result",
    [release],
  )).rows[0].result;
  const claimed = (await db.query(
    "select public.sellerpilot_claim_local_channel_executor_job($1,$2,$3,$4) result",
    [tokenHash, workerVersion, release, egress],
  )).rows[0].result;
  assert.equal(claimed.id, enqueued.jobId);
  return { enqueued, claimed };
}

test("migration applies to an exact successful price-repair preimage and reapply is rejected without changing state", async () => {
  const db = await database();
  try {
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_post_price_verify_runs"), 0);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_post_price_verify_receipts"), 0);
    await assert.rejects(
      db.exec(renderedMigrations.get(db)),
      /(?:already exists|COUPANG_POST_PRICE_(?:LISTING_GUARD_ALREADY_PATCHED|VERIFIER_PREDECESSOR_DRIFT))/u,
    );
    await db.exec("rollback");
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_post_price_verify_runs"), 0);
  } finally {
    await db.close();
  }
});

test("direct publication route binds once as read-only without creating a gateway job", async () => {
  const db = await database();
  try {
    assert.equal(await scalar(db,
      "select sellerpilot_private.local_channel_executor_access('coupang','listing.publication.verify')"),
    "read");
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.local_channel_executor_routes where channel='coupang' and operation='listing.publication.verify'"),
    1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_post_price_route_bindings"),
    1);
    assert.equal(await scalar(db,
      `select count(*)::integer from sellerpilot_private.channel_gateway_jobs job
        where coalesce((job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangPostPriceVerification',false)`),
    0);
    const replay = (await db.query(
      "select public.sellerpilot_service_bind_exact_coupang_post_price_route($1) result",
      [release],
    )).rows[0].result;
    assert.equal(replay.reused, true);
    assert.equal(replay.providerMutationPerformed, false);
    assert.equal(replay.gatewayJobCreated, false);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.local_channel_executor_routes where operation='listing.publication.verify'"),
    1);
    await assert.rejects(
      db.exec(renderedRouteMigrations.get(db)),
      /COUPANG_POST_PRICE_ROUTE_(?:ACCESS_PREIMAGE_DRIFT|INSTALL_PREIMAGE_REJECTED|CONSTRAINT_PREIMAGE_DRIFT)/u,
    );
    await db.exec("rollback");
    await assert.rejects(
      db.exec("update sellerpilot_private.coupang_exact_post_price_route_bindings set expires_at=expires_at+interval '1 minute'"),
      /COUPANG_POST_PRICE_ROUTE_BINDING_IMMUTABLE/u,
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});

test("enqueue and replay create one fresh GET-only verifier without reusing source jobs", async () => {
  const db = await database();
  try {
    const before = (await db.query(
      `select id,status,attempt_count,worker_token_id,claim_token,
              provider_mutation_started_at,request_payload,response_payload
         from sellerpilot_private.channel_gateway_jobs
        where id in ($1,$2,$3) order by id`,
      [ids.sourceJob, ids.oldVerifier, ids.repairJob],
    )).rows;
    const first = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier($1) result",
      [release],
    )).rows[0].result;
    const replay = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier($1) result",
      [release],
    )).rows[0].result;
    assert.equal(first.status, "queued");
    assert.equal(first.reused, false);
    assert.equal(first.providerMutationStarted, false);
    assert.equal(first.providerMutationPerformed, false);
    assert.equal(first.releaseSha, release);
    assert.equal(replay.reused, true);
    assert.equal(replay.jobId, first.jobId);
    assert.equal(replay.releaseSha, release);
    assert.equal(await scalar(db,
      "select release_sha from sellerpilot_private.coupang_exact_post_price_verify_runs where verifier_job_id=$1",
      [first.jobId]), release);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier($1)",
        ["e".repeat(40)],
      ),
      /COUPANG_POST_PRICE_VERIFIER_(?:REPLAY_DRIFT|RELEASE_MISMATCH)/u,
    );
    assert.deepEqual((await db.query(
      `select id,status,attempt_count,worker_token_id,claim_token,
              provider_mutation_started_at,request_payload,response_payload
         from sellerpilot_private.channel_gateway_jobs
        where id in ($1,$2,$3) order by id`,
      [ids.sourceJob, ids.oldVerifier, ids.repairJob],
    )).rows, before);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='listing.create'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='price.update'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_post_price_verify_runs"), 1);

    const { rows: [proof] } = await db.query(`
      select job.id,job.listing_id,job.attempt_id,job.status,
             job.provider_mutation_started_at,job.oauth_provider_call_started_at,
             job.write_resource_kind,job.write_resource_key,
             job.request_payload#>>'{arguments,publicationReviewSourceJobId}' source_id,
             run.source_job_id,run.source_attempt_id,run.price_repair_job_id,
             run.price_repair_attempt_id,
             run.source_job_sha256 = encode(extensions.digest(to_jsonb(source_job)::text,'sha256'),'hex') source_job_hash_ok,
             run.source_attempt_sha256 = encode(extensions.digest(to_jsonb(source_attempt)::text,'sha256'),'hex') source_attempt_hash_ok,
             run.price_repair_job_sha256 = encode(extensions.digest(to_jsonb(repair_job)::text,'sha256'),'hex') repair_job_hash_ok,
             run.price_repair_attempt_sha256 = encode(extensions.digest(to_jsonb(repair_attempt)::text,'sha256'),'hex') repair_attempt_hash_ok,
             run.price_repair_permit_sha256 = encode(extensions.digest(to_jsonb(permit)::text,'sha256'),'hex') permit_hash_ok,
             sellerpilot_private.coupang_exact_post_price_source_current(job.id) source_current
        from sellerpilot_private.coupang_exact_post_price_verify_runs run
        join sellerpilot_private.channel_gateway_jobs job on job.id=run.verifier_job_id
        join sellerpilot_private.channel_gateway_jobs source_job on source_job.id=run.source_job_id
        join sellerpilot_private.channel_operation_attempts source_attempt on source_attempt.id=run.source_attempt_id
        join sellerpilot_private.channel_gateway_jobs repair_job on repair_job.id=run.price_repair_job_id
        join sellerpilot_private.channel_operation_attempts repair_attempt on repair_attempt.id=run.price_repair_attempt_id
        join sellerpilot_private.coupang_exact_price_repair_permits permit on permit.repair_job_id=run.price_repair_job_id
    `);
    assert.equal(proof.id, first.jobId);
    assert.equal(proof.listing_id, null);
    assert.equal(proof.attempt_id, null);
    assert.equal(proof.status, "queued");
    assert.equal(proof.provider_mutation_started_at, null);
    assert.equal(proof.oauth_provider_call_started_at, null);
    assert.equal(proof.write_resource_kind, null);
    assert.equal(proof.write_resource_key, null);
    assert.equal(proof.source_id, ids.sourceJob);
    assert.equal(proof.source_job_id, ids.sourceJob);
    assert.equal(proof.source_attempt_id, ids.sourceAttempt);
    assert.equal(proof.price_repair_job_id, ids.repairJob);
    assert.equal(proof.price_repair_attempt_id, ids.repairAttempt);
    assert.equal(proof.source_job_hash_ok, true);
    assert.equal(proof.source_attempt_hash_ok, true);
    assert.equal(proof.repair_job_hash_ok, true);
    assert.equal(proof.repair_attempt_hash_ok, true);
    assert.equal(proof.permit_hash_ok, true);
    assert.equal(proof.source_current, true);
  } finally {
    await db.close();
  }
});

test("claim hydrates immutable CREATE evidence and successful GET-only completion writes one receipt and projection", async () => {
  const db = await database();
  try {
    const { enqueued, claimed } = await enqueueAndClaim(db);
    assert.equal(claimed.id, enqueued.jobId);
    assert.equal(claimed.operation, "listing.publication.verify");
    assert.equal(claimed.request.arguments.sellerpilotReadOnly, true);
    assert.equal(claimed.request.arguments.sellerpilotPublicationSource.sourceJobId,
      ids.sourceJob);
    assert.equal(claimed.request.arguments.sellerpilotPublicationSource.sourceOperation,
      "listing.create");
    assert.equal(claimed.request.arguments.sellerpilotPublicationSource.sourceResponsePayload.remoteId,
      "16375780938");
    assert.equal(await scalar(db,
      "select provider_mutation_started_at is null from sellerpilot_private.channel_gateway_jobs where id=$1",
      [enqueued.jobId]), true);

    const priceRepairResponseSha256 = await scalar(db,
      "select encode(extensions.digest(response_payload::text,'sha256'),'hex') from sellerpilot_private.channel_gateway_jobs where id=$1",
      [ids.repairJob]);
    const response = completionResponse(priceRepairResponseSha256);
    const completed = (await db.query(
      `select public.sellerpilot_service_complete_gateway_transaction(
        $1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,null
      ) result`,
      [tokenHash, enqueued.jobId, claimed.claim_token, JSON.stringify(response)],
    )).rows[0].result;
    assert.equal(completed.status, "completed");
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_post_price_verify_receipts where verifier_job_id=$1",
      [enqueued.jobId]), 1);
    const { rows: [receipt] } = await db.query(
      `select provider_live_verified,buyer_visible_verified,
              provider_mutation_performed,observed_price,observed_stock,
              currency,public_url,claim_attempt_count
         from sellerpilot_private.coupang_exact_post_price_verify_receipts
        where verifier_job_id=$1`,
      [enqueued.jobId],
    );
    assert.equal(receipt.provider_live_verified, true);
    assert.equal(receipt.buyer_visible_verified, false);
    assert.equal(receipt.provider_mutation_performed, false);
    assert.equal(receipt.observed_price, 3190);
    assert.equal(receipt.observed_stock, 1);
    assert.equal(receipt.currency, "KRW");
    assert.equal(receipt.claim_attempt_count, 1);
    assert.equal(receipt.public_url,
      "https://www.coupang.com/vp/products/9725220700?vendorItemId=96027942778");

    const { rows: [listing] } = await db.query(
      `select status,failure_class,remote_visibility,provider_status,
              marketplace_sku,remote_id,price,currency,public_url
         from sellerpilot_private.product_listings where id=$1`,
      [ids.listing],
    );
    assert.equal(listing.status, "published");
    assert.equal(listing.failure_class, null);
    assert.equal(listing.remote_visibility, "live");
    assert.equal(listing.provider_status,
      "APPROVED|requested=false|onSale=true");
    assert.equal(listing.marketplace_sku, "AUTO-780720401E2D4E4EA45F");
    assert.equal(listing.remote_id, "16375780938");
    assert.equal(Number(listing.price), 3190);
    assert.equal(listing.currency, "KRW");
    assert.equal(listing.public_url, receipt.public_url);
    const { rows: [postimage] } = await db.query(`
      select receipt.listing_after_snapshot = to_jsonb(listing) snapshot_ok,
             receipt.listing_after_sha256 = encode(
               extensions.digest(to_jsonb(listing)::text,'sha256'),'hex'
             ) hash_ok
        from sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
        join sellerpilot_private.product_listings listing
          on listing.id=receipt.listing_id
       where receipt.verifier_job_id=$1
    `, [enqueued.jobId]);
    assert.equal(postimage.snapshot_ok, true);
    assert.equal(postimage.hash_ok, true);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where id=$1 and provider_mutation_started_at is not null",
      [enqueued.jobId]), 0);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='listing.create'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='price.update'"), 1);
  } finally {
    await db.close();
  }
});

test("completion rejects missing or mismatched provider product, item, vendor and URL identity", async () => {
  const cases = [
    ["seller productId", (response) => {
      response.steps[0].data.data.productId = "0";
    }],
    ["seller itemId", (response) => {
      response.steps[0].data.data.items[0].itemId = "0";
    }],
    ["seller item productId", (response) => {
      delete response.steps[0].data.data.items[0].productId;
    }],
    ["vendor sellerItemId", (response) => {
      response.steps[1].data.data.sellerItemId = "0";
    }],
    ["state productId", (response) => {
      response.remoteState.resources.productId = "0";
    }],
    ["state itemId", (response) => {
      delete response.remoteState.resources.itemId;
    }],
    ["verification publicUrl", (response) => {
      response.steps[3].data.publicUrl =
        "https://www.coupang.com/vp/products/0?vendorItemId=96027942778";
    }],
    ["state providerPublicUrl", (response) => {
      response.remoteState.evidence.providerPublicUrl =
        "https://www.coupang.com/vp/products/9725220700?vendorItemId=0";
    }],
  ];
  for (const [label, mutate] of cases) {
    const db = await database();
    try {
      const { enqueued, claimed } = await enqueueAndClaim(db);
      const priceRepairResponseSha256 = await scalar(db,
        "select encode(extensions.digest(response_payload::text,'sha256'),'hex') from sellerpilot_private.channel_gateway_jobs where id=$1",
        [ids.repairJob]);
      const response = completionResponse(priceRepairResponseSha256);
      mutate(response);
      await assert.rejects(
        db.query(
          `select public.sellerpilot_service_complete_gateway_transaction(
            $1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,null
          )`,
          [tokenHash, enqueued.jobId, claimed.claim_token, JSON.stringify(response)],
        ),
        /COUPANG_POST_PRICE_GET_VERIFICATION_INCOMPLETE/u,
        label,
      );
      assert.equal(await scalar(db,
        "select count(*)::integer from sellerpilot_private.coupang_exact_post_price_verify_receipts where verifier_job_id=$1",
        [enqueued.jobId]), 0, label);
      assert.equal(await scalar(db,
        "select status from sellerpilot_private.product_listings where id=$1",
        [ids.listing]), "failed", label);
    } finally {
      await db.close();
    }
  }
});

test("successful listing postimage snapshot and digest reject later projection drift", async () => {
  const db = await database();
  try {
    const { enqueued, claimed } = await enqueueAndClaim(db);
    const priceRepairResponseSha256 = await scalar(db,
      "select encode(extensions.digest(response_payload::text,'sha256'),'hex') from sellerpilot_private.channel_gateway_jobs where id=$1",
      [ids.repairJob]);
    const response = completionResponse(priceRepairResponseSha256);
    await db.query(
      `select public.sellerpilot_service_complete_gateway_transaction(
        $1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,null
      )`,
      [tokenHash, enqueued.jobId, claimed.claim_token, JSON.stringify(response)],
    );
    await db.query(
      "update sellerpilot_private.product_listings set updated_at=updated_at+interval '1 second' where id=$1",
      [ids.listing],
    );
    assert.equal(await scalar(db,
      "select sellerpilot_private.coupang_exact_post_price_source_current($1)",
      [enqueued.jobId]), false);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier($1)",
        [release],
      ),
      /COUPANG_POST_PRICE_VERIFIER_REPLAY_DRIFT/u,
    );
  } finally {
    await db.close();
  }
});

test("source, attempt, permit and verifier request drift are rejected", async () => {
  for (const drift of [
    `update sellerpilot_private.channel_gateway_jobs set response_payload=response_payload||'{"drift":true}'::jsonb where id='${ids.sourceJob}'`,
    `update sellerpilot_private.channel_operation_attempts set idempotency_key='drifted' where id='${ids.sourceAttempt}'`,
    `update sellerpilot_private.coupang_exact_price_repair_permits set consumed_at=clock_timestamp() where repair_job_id='${ids.repairJob}'`,
  ]) {
    const db = await database();
    try {
      const first = (await db.query(
        "select public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier($1) result",
        [release],
      )).rows[0].result;
      await db.exec(drift);
      assert.equal(await scalar(db,
        "select sellerpilot_private.coupang_exact_post_price_source_current($1)",
        [first.jobId]), false);
      await assert.rejects(
        db.query(
          "select public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier($1)",
          [release],
        ),
        /COUPANG_POST_PRICE_VERIFIER_REPLAY_DRIFT/u,
      );
    } finally {
      await db.close();
    }
  }

  const db = await database();
  try {
    const first = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier($1) result",
      [release],
    )).rows[0].result;
    await assert.rejects(
      db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set request_payload=jsonb_set(request_payload,'{arguments,remoteId}','"0"')
          where id=$1`,
        [first.jobId],
      ),
      /COUPANG_POST_PRICE_VERIFIER_LINEAGE_INVALID/u,
    );
  } finally {
    await db.close();
  }
});
