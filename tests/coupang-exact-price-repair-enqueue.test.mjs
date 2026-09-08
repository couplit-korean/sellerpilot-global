import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908053000_enqueue_exact_coupang_price_repair.sql",
  import.meta.url,
), "utf8");
const draftlessCorrection = await readFile(new URL(
  "../supabase/migrations/20260908054500_rebind_exact_coupang_price_repair_without_publish_draft.sql",
  import.meta.url,
), "utf8");
const nullListingLineageCorrection = await readFile(new URL(
  "../supabase/migrations/20260908055000_allow_exact_coupang_price_repair_from_null_listing_lineage.sql",
  import.meta.url,
), "utf8");

const id = Object.freeze({
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  actor: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  product: "1ed4acfc-7603-48ec-a638-241131e59358",
  draft: "2e868857-5868-4665-8304-978b431f7f00",
  credential: "32de2968-d4b7-4fda-a84b-16a7ce0257cc",
  sourceAttempt: "d771421b-f408-4f75-addd-03879393fab8",
  sourceJob: "25adf712-1e9a-432b-8b0d-09cf35a826c5",
  verifier: "86d2cb63-d382-4cc9-8153-654cf7ccec80",
  listing: "fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4",
  worker: "02955cb4-fa9f-466b-824f-b61f06276190",
  route: "11111111-1111-4111-8111-111111111111",
  claim: "22222222-2222-4222-8222-222222222222",
  secondClaim: "33333333-3333-4333-8333-333333333333",
});
const sellerKey =
  "e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd";
const sourceFingerprint =
  "f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d";
const egress =
  "92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01";
const release = "b".repeat(40);
const workerVersion = `sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}`;
const tokenHash = "a".repeat(64);

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function database({ listingSellerKey = sellerKey, marketplaceSku =
  "AUTO-780720401E2D4E4EA45F" } = {}) {
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
    create table sellerpilot_private.products(
      id uuid primary key,owner_id uuid not null,sku text not null,
      on_hand integer not null,demo boolean not null,status text not null
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null,channel text not null,
      environment text not null,status text not null,version integer not null,
      fingerprint text not null,seller_account_key text,
      seller_account_key_source text,seller_account_verified_at timestamptz,
      expires_at timestamptz,last_checked_at timestamptz,
      last_check_status text
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,owner_id uuid not null,credential_id uuid not null,
      channel text not null,operation text not null,idempotency_key text,
      request_fingerprint text,status text not null,remote_id text,
      gateway_write_required boolean not null default false,
      pre_gateway_retryable boolean not null default false,
      seller_account_key text,created_at timestamptz default clock_timestamp(),
      started_at timestamptz,completed_at timestamptz
    );
    create unique index channel_operation_attempts_idempotency
      on sellerpilot_private.channel_operation_attempts(
        channel,operation,idempotency_key
      );
    create table sellerpilot_private.product_listings(
      id uuid primary key,owner_id uuid not null,product_id uuid not null,
      operation_attempt_id uuid,channel_key text not null,market text,
      target_id text,seller_account_key text,marketplace_sku text,
      remote_id text,status text not null,failure_class text,
      requested_publication_intent text,remote_visibility text,
      provider_status text,remote_resources jsonb,public_url text,
      published_at timestamptz,last_verified_at timestamptz,last_error text,
      currency text,price numeric,updated_at timestamptz not null
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,created_by uuid not null,token_hash text not null,
      scope text not null,status text not null,expires_at timestamptz not null,
      last_seen_at timestamptz,last_version text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,attempt_id uuid,listing_id uuid,
      channel text not null,operation text not null,environment text not null,
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb,status text not null default 'queued',
      error_message text,worker_token_id uuid,claim_token uuid,
      attempt_count integer not null default 0,lease_expires_at timestamptz,
      created_by uuid,created_at timestamptz default clock_timestamp(),
      started_at timestamptz,completed_at timestamptz,
      updated_at timestamptz default clock_timestamp(),
      seller_account_key text,request_fingerprint text,
      write_resource_kind text,write_resource_key text,
      provider_mutation_started_at timestamptz,
      credential_refresh_in_flight boolean not null default false,
      credential_refresh_recovery_vault_id uuid,prepared_credential_id uuid,
      oauth_exchange_completed boolean not null default false
    );
    create table sellerpilot_private.product_registration_drafts(
      id bigint generated always as identity primary key,owner_id uuid not null,
      draft_id uuid not null,kind text not null,product_id uuid,version bigint,
      data jsonb not null,created_at timestamptz default clock_timestamp(),
      updated_at timestamptz default clock_timestamp()
    );
    create table sellerpilot_private.local_channel_executor_routes(
      id uuid primary key,owner_id uuid not null,channel text not null,
      operation text not null,credential_id uuid not null,
      seller_account_key text not null,worker_token_id uuid not null,
      release_sha text not null,egress_ip_sha256 text not null,
      approved_by uuid not null,approved_at timestamptz not null,
      expires_at timestamptz not null,enabled boolean not null
    );
    create table sellerpilot_private.coupang_exact_live_price_drift_adjudications(
      verifier_job_id uuid primary key,source_job_id uuid unique,
      source_attempt_id uuid,listing_id uuid,remote_id text,
      vendor_item_ids jsonb,source_price integer,observed_price integer,
      observed_stock integer,provider_live_verified boolean,
      exact_content_verified boolean,buyer_visible_verified boolean,
      provider_mutation_performed boolean,adjudication_sha256 text,
      decision text,contract text
    );
    create table sellerpilot_private.coupang_exact_live_verify_receipts(
      verifier_job_id uuid primary key
    );
    create table sellerpilot_private.operation_audit(
      id bigint generated always as identity primary key,owner_id uuid,
      action text,entity_type text,entity_id text,safe_detail jsonb,
      occurred_at timestamptz default clock_timestamp()
    );
    create table sellerpilot_private.listing_mutation_release_gate(
      singleton boolean primary key,is_open boolean,opened_channel text,
      opened_release_sha text
    );

    create function sellerpilot_private.active_serverless_runtime_release_sha()
    returns text language sql stable set search_path='' as
      'select current_setting(''fixture.release'',true)';
    create function sellerpilot_private.listing_mutation_release_gate_is_effective(
      p_channel text
    )returns boolean language sql stable set search_path='' as $$
      select coalesce(exists(select 1
        from sellerpilot_private.listing_mutation_release_gate gate
        where gate.singleton and gate.is_open
          and gate.opened_channel=p_channel
          and gate.opened_release_sha=
            sellerpilot_private.active_serverless_runtime_release_sha()),false)
    $$;
    create function
    sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
      p_job uuid
    )returns boolean language sql stable set search_path='' as $$
      select coalesce(exists(select 1
        from sellerpilot_private.coupang_exact_live_price_drift_adjudications a
        where a.source_job_id=p_job
          and a.decision='provider_live_price_drift'),false)
    $$;
    create function sellerpilot_private.local_channel_executor_route_is_current(
      p_owner uuid,p_channel text,p_operation text,p_credential uuid,
      p_worker uuid,p_release text,p_egress text,p_version text
    )returns boolean language sql stable set search_path='' as $$
      select coalesce(exists(select 1
        from sellerpilot_private.local_channel_executor_routes route
        where route.owner_id=p_owner and route.channel=p_channel
          and route.operation=p_operation and route.credential_id=p_credential
          and route.worker_token_id=p_worker and route.release_sha=p_release
          and route.egress_ip_sha256=p_egress and route.enabled
          and route.expires_at>clock_timestamp()
          and p_version='sellerpilot-cli-worker/1.61+'||p_release||'.'||left(p_egress,11)
      ),false)
    $$;
    create function sellerpilot_private.local_channel_executor_job_allowed(
      uuid,uuid,uuid,text,text,text
    )returns boolean language sql stable set search_path='' as 'select false';
    create function sellerpilot_private.coupang_exact_live_verifier_job_matches(
      job sellerpilot_private.channel_gateway_jobs
    )returns boolean language sql immutable strict set search_path='' as $$
      select job.id='86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
        and job.operation='listing.publication.verify'
    $$;
    create function sellerpilot_private.guard_gateway_job_seller_lineage()
    returns trigger language plpgsql set search_path='' as $$
    declare
      v_credential_key text;
      v_listing record;
      v_requested_remote_id text;
      v_expected_remote_id text;
    begin
      if tg_op = 'INSERT' then
        select credential.seller_account_key into v_credential_key
          from sellerpilot_private.channel_credentials credential
         where credential.id = new.credential_id
           and credential.channel = new.channel;
        if not found then
          raise exception 'gateway credential lineage unavailable';
        end if;
        new.seller_account_key := v_credential_key;
      end if;
      if tg_op = 'INSERT' and new.listing_id is not null then
        select listing.id,listing.channel_key,listing.remote_id,
               listing.seller_account_key
          into v_listing
          from sellerpilot_private.product_listings listing
         where listing.id = new.listing_id;
        if not found or v_listing.channel_key <> new.channel then
          raise exception 'gateway listing lineage mismatch';
        end if;
      if new.operation in ('price.update', 'inventory.update') and (
        v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) then
          raise exception 'gateway listing seller account mismatch';
        end if;
      end if;
      if tg_op='INSERT' and new.operation in ('price.update','inventory.update') then
        v_requested_remote_id:=coalesce(
          new.request_payload#>>'{arguments,vendorItemId}',
          new.request_payload#>>'{arguments,sellerProductId}'
        );
        select listing.remote_id into v_expected_remote_id
          from sellerpilot_private.product_listings listing
          where listing.id=new.listing_id;
        if nullif(trim(coalesce(v_requested_remote_id, '')), '') is null
           or trim(v_requested_remote_id) <> coalesce(v_expected_remote_id, '') then
          raise exception 'gateway listing remote identity mismatch';
        end if;
      end if;
      return new;
    end
    $$;
    create trigger guard_gateway_job_seller_lineage
      before insert or update on sellerpilot_private.channel_gateway_jobs
      for each row execute function
        sellerpilot_private.guard_gateway_job_seller_lineage();
    create function public.sellerpilot_service_begin_gateway_provider_mutation(
      p_hash text,p_job uuid,p_claim uuid
    )returns boolean language plpgsql security definer set search_path='' as $$
    declare started boolean;
    begin
      update sellerpilot_private.channel_gateway_jobs job
         set provider_mutation_started_at=coalesce(
           job.provider_mutation_started_at,clock_timestamp()
         ),updated_at=clock_timestamp()
       where job.id=p_job and job.status='running'
         and job.claim_token=p_claim and job.lease_expires_at>clock_timestamp()
         and exists(select 1 from sellerpilot_private.ai_cli_worker_tokens token
           where token.id=job.worker_token_id and token.token_hash=p_hash
             and token.scope='gateway' and token.status='active'
             and token.expires_at>clock_timestamp())
      returning true into started;
      return coalesce(started,false);
    end
    $$;
  `);

  await db.query("insert into auth.users values($1),($2)", [id.owner, id.actor]);
  await db.query("insert into sellerpilot_private.admin_users values($1),($2)", [id.owner, id.actor]);
  await db.query(
    `insert into sellerpilot_private.products values($1,$2,$3,1,false,'active')`,
    [id.product, id.owner, "AUTO-780720401E2D4E4EA45F"],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials values(
      $1,$2,'coupang','production','active',7,'ABCDEF123456',$3,
      'credential_incarnation_v1',clock_timestamp()-interval '1 day',
      null,clock_timestamp()-interval '1 minute','passed')`,
    [id.credential, id.actor, sellerKey],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts(
      id,owner_id,credential_id,channel,operation,idempotency_key,
      request_fingerprint,status,remote_id,gateway_write_required,
      pre_gateway_retryable,seller_account_key,started_at
    )values($1,$2,$3,'coupang','listing.create','source-create',$4,
      'manual_required','16375780938',true,false,$5,clock_timestamp())`,
    [id.sourceAttempt, id.owner, id.credential, sourceFingerprint, sellerKey],
  );
  const remoteResources = {
    contract: "coupang_provider_live_price_drift_v1",
    resources: {
      sellerProductId: "16375780938",
      vendorItemIds: ["96027942778"],
    },
    verification: {
      sourcePrice: 3190,
      observedPrice: 6000,
      observedStock: 1,
      decision: "provider_live_price_drift",
    },
  };
  await db.query(
    `insert into sellerpilot_private.product_listings(
      id,owner_id,product_id,operation_attempt_id,channel_key,market,target_id,
      seller_account_key,marketplace_sku,remote_id,status,failure_class,
      requested_publication_intent,remote_visibility,provider_status,
      remote_resources,currency,price,updated_at
    )values($1,$2,$3,$4,'coupang','','',$5,$6,'16375780938','failed',
      'external_action','live','live','APPROVED|requested=false|onSale=true',
      $7::jsonb,'KRW',3190,clock_timestamp())`,
    [id.listing, id.owner, id.product, id.sourceAttempt, listingSellerKey,
      marketplaceSku, JSON.stringify(remoteResources)],
  );
  await db.query(
    `insert into sellerpilot_private.ai_cli_worker_tokens values(
      $1,$2,$3,'gateway','active',clock_timestamp()+interval '1 day',
      clock_timestamp(),$4)`,
    [id.worker, id.actor, tokenHash, workerVersion],
  );
  await db.query(
    `insert into sellerpilot_private.product_registration_drafts(
      owner_id,draft_id,kind,product_id,version,data
    )values($1,$2,'publish',$3,13,'{"channel":"coupang","price":3190}')`,
    [id.owner, id.draft, id.product],
  );
  await db.query(
    `insert into sellerpilot_private.local_channel_executor_routes values(
      $1,$2,'coupang','categories.attributes',$3,$4,$5,$6,$7,$2,
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',true)`,
    [id.route, id.owner, id.credential, sellerKey, id.worker, release, egress],
  );
  await db.query(
    `insert into sellerpilot_private.listing_mutation_release_gate
      values(true,true,'coupang',$1)`, [release],
  );
  await db.exec(`set fixture.release='${release}'`);
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,
      request_payload,response_payload,status,seller_account_key,
      request_fingerprint,created_by,provider_mutation_started_at
    )values($1,$2,$3,$4,'coupang','listing.create','production',$5::jsonb,
      '{"remoteId":"16375780938"}'::jsonb,'reconciliation_required',$6,$7,$8,
      clock_timestamp())`,
    [id.sourceJob, id.credential, id.sourceAttempt, id.listing,
      JSON.stringify({ arguments: { body: { items: [{ salePrice: 3190 }] } } }),
      sellerKey, sourceFingerprint, id.actor],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,listing_id,channel,operation,environment,
      request_payload,response_payload,status,seller_account_key,
      request_fingerprint,created_by
    )values($1,$2,$3,'coupang','listing.publication.verify','production','{}',
      $4::jsonb,'reconciliation_required',$5,$6,$7)`,
    [id.verifier, id.credential, id.listing,
      JSON.stringify({ steps: [{}, { data: { data: { salePrice: 6000 } } }] }),
      sellerKey, sourceFingerprint, id.actor],
  );
  await db.query(
    `insert into sellerpilot_private.coupang_exact_live_price_drift_adjudications
      values($1,$2,$3,$4,'16375780938','["96027942778"]',3190,6000,1,
      true,false,false,false,$5,'provider_live_price_drift',
      'coupang_exact_live_price_drift_adjudication_v1')`,
    [id.verifier, id.sourceJob, id.sourceAttempt, id.listing, "c".repeat(64)],
  );
  await db.exec(`
    create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
      on sellerpilot_private.channel_gateway_jobs(
        listing_id,
        (case when sellerpilot_private.coupang_exact_live_verifier_job_matches(
          channel_gateway_jobs
        ) then 'coupang_exact_live_get_only_v1' else 'default' end)
      ) where listing_id is not null
        and operation in('listing.create','listing.update','listing.stop',
          'listing.activate','price.update','inventory.update',
          'listing.lineage.verify','listing.publication.verify')
        and status in('queued','running','reconciliation_required')
  `);
  await db.exec(migration);
  await db.exec("set request.jwt.claim.role='service_role'");
  return db;
}

async function prepareDraftlessFixture(db) {
  await db.query(
    `delete from sellerpilot_private.product_registration_drafts
      where owner_id=$1 and kind='publish' and draft_id=$2`,
    [id.owner, id.draft],
  );
  await db.query(
    `insert into sellerpilot_private.product_registration_drafts(
       owner_id,draft_id,kind,product_id,version,data
     ) values($1,$2,'intake',$3,1,'{"channel":"coupang"}'::jsonb)`,
    [id.owner, id.draft, id.product],
  );
  await db.exec(`
    alter table sellerpilot_private.coupang_exact_live_price_drift_adjudications
      add column provider_call_replayed boolean not null default false,
      add column source_job_sha256 text,
      add column source_attempt_sha256 text,
      add column verifier_job_sha256 text,
      add column listing_after_snapshot jsonb,
      add column listing_after_sha256 text,
      add column adjudication_evidence jsonb;
    update sellerpilot_private.coupang_exact_live_price_drift_adjudications a
       set source_job_sha256=(select encode(extensions.digest(
             to_jsonb(job)::text,'sha256'),'hex')
             from sellerpilot_private.channel_gateway_jobs job
            where job.id=a.source_job_id),
           source_attempt_sha256=(select encode(extensions.digest(
             to_jsonb(attempt)::text,'sha256'),'hex')
             from sellerpilot_private.channel_operation_attempts attempt
            where attempt.id=a.source_attempt_id),
           verifier_job_sha256=(select encode(extensions.digest(
             to_jsonb(job)::text,'sha256'),'hex')
             from sellerpilot_private.channel_gateway_jobs job
            where job.id=a.verifier_job_id),
           listing_after_snapshot=(select to_jsonb(listing)
             from sellerpilot_private.product_listings listing
            where listing.id=a.listing_id),
           listing_after_sha256=(select encode(extensions.digest(
             to_jsonb(listing)::text,'sha256'),'hex')
             from sellerpilot_private.product_listings listing
            where listing.id=a.listing_id),
           adjudication_evidence=jsonb_build_object(
             'contract','coupang_exact_live_price_drift_adjudication_v1',
             'sourceJobId',a.source_job_id,
             'listingId',a.listing_id,
             'decision','provider_live_price_drift'
           );
    update sellerpilot_private.coupang_exact_live_price_drift_adjudications
       set adjudication_sha256=encode(extensions.digest(
         adjudication_evidence::text,'sha256'),'hex');
  `);
}

async function applyDraftlessCorrection(db) {
  await prepareDraftlessFixture(db);
  await db.exec(draftlessCorrection);
}

async function applyNullListingLineageCorrection(db) {
  await prepareDraftlessFixture(db);
  await db.exec(draftlessCorrection);
  await db.exec(nullListingLineageCorrection);
}

test("migration is an exact price-only lane and contains no production call", () => {
  assert.match(migration, /operation = 'price\.update'/u);
  assert.match(migration, /vendorItemId','96027942778'/u);
  assert.match(migration, /'price',3190/u);
  assert.match(migration, /forceSalePriceUpdate',true/u);
  assert.match(migration, /coupang_exact_price_repair_permit_v1/u);
  assert.match(migration, /listing_mutation_release_gate_is_effective\(\s*'coupang'/u);
  assert.match(migration, /02955cb4-fa9f-466b-824f-b61f06276190/u);
  assert.match(migration, /92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01/u);
  assert.doesNotMatch(migration, /select\s+public\.sellerpilot_service_enqueue_exact_coupang_price_repair/u);
  assert.doesNotMatch(migration, /update\s+sellerpilot_private\.channel_gateway_jobs\s+set\s+status\s*=\s*'queued'/iu);
  assert.doesNotMatch(migration, /vendorItemIds,0\}'\s*=\s*and/u);
});

test("NULL-listing correction preserves the listing and contains no production call", () => {
  assert.match(nullListingLineageCorrection,
    /listing\.seller_account_key is null/u);
  assert.match(nullListingLineageCorrection,
    /candidate\.seller_account_key = credential\.seller_account_key/u);
  assert.match(nullListingLineageCorrection,
    /source_attempt\.seller_account_key = permit\.seller_account_key/u);
  assert.doesNotMatch(nullListingLineageCorrection,
    /update\s+sellerpilot_private\.product_listings[\s\S]*seller_account_key/iu);
  assert.doesNotMatch(nullListingLineageCorrection,
    /select\s+public\.sellerpilot_service_enqueue_exact_coupang_price_repair/iu);
});

test("rollback leaves no repair and committed replay reuses exactly one job", async () => {
  const db = await database();
  try {
    const retainedBefore = (await db.query(
      `select jsonb_agg(to_jsonb(job) order by job.id) snapshot
         from sellerpilot_private.channel_gateway_jobs job
        where job.id in ($1,$2)`,
      [id.sourceJob, id.verifier],
    )).rows[0].snapshot;
    const sourceAttemptBefore = (await db.query(
      `select to_jsonb(attempt) snapshot
         from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id=$1`,
      [id.sourceAttempt],
    )).rows[0].snapshot;
    await db.exec("begin");
    const provisional = await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    );
    assert.equal(provisional.rows[0].result.status, "queued");
    assert.equal(provisional.rows[0].result.reused, false);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_price_repair_permits"), 1);
    await db.exec("rollback");
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_price_repair_permits"), 0);

    const first = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    const replay = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(first.reused, false);
    assert.equal(replay.reused, true);
    assert.equal(replay.jobId, first.jobId);
    assert.equal(replay.attemptId, first.attemptId);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_price_repair_permits"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='price.update'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_operation_attempts where operation='price.update'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='listing.create'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='listing.publication.verify'"), 1);

    const job = (await db.query(
      `select request_payload,status,write_resource_kind,write_resource_key,
              request_fingerprint
         from sellerpilot_private.channel_gateway_jobs where id=$1`,
      [first.jobId],
    )).rows[0];
    assert.equal(job.status, "queued");
    assert.equal(job.write_resource_kind, "listing_mutation");
    assert.equal(job.request_payload.arguments.vendorItemId, "96027942778");
    assert.equal(job.request_payload.arguments.sellerProductId, "16375780938");
    assert.equal(job.request_payload.arguments.price, 3190);
    assert.equal(job.request_payload.arguments.forceSalePriceUpdate, true);
    assert.match(job.request_fingerprint, /^[a-f0-9]{64}$/u);
    assert.equal(
      job.write_resource_key,
      createHash("sha256")
        .update(`coupang\0listing_mutation\0${id.listing}`)
        .digest("hex"),
    );
    assert.deepEqual((await db.query(
      `select jsonb_agg(to_jsonb(job) order by job.id) snapshot
         from sellerpilot_private.channel_gateway_jobs job
        where job.id in ($1,$2)`,
      [id.sourceJob, id.verifier],
    )).rows[0].snapshot, retainedBefore);
    assert.deepEqual((await db.query(
      `select to_jsonb(attempt) snapshot
         from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id=$1`,
      [id.sourceAttempt],
    )).rows[0].snapshot, sourceAttemptBefore);
  } finally {
    await db.close();
  }
});

test("exact claim binds one worker and provider start consumes the permit", async () => {
  const db = await database();
  try {
    const enqueued = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(enqueued.providerMutationStarted, false);
    assert.equal(enqueued.permitConsumed, false);
    assert.equal(enqueued.providerMutationPerformed, false);
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release, egress]), true);

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs set
        status='running',worker_token_id=$2,claim_token=$3,attempt_count=1,
        started_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '5 minutes'
       where id=$1`,
      [enqueued.jobId, id.worker, id.claim],
    );
    const bound = (await db.query(
      `select bound_worker_token_id,bound_claim_token,bound_at,consumed_at
         from sellerpilot_private.coupang_exact_price_repair_permits`,
    )).rows[0];
    assert.equal(bound.bound_worker_token_id, id.worker);
    assert.equal(bound.bound_claim_token, id.claim);
    assert.ok(bound.bound_at);
    assert.equal(bound.consumed_at, null);

    await db.exec(
      `update sellerpilot_private.product_registration_drafts
          set data='{"channel":"coupang","price":6000}'::jsonb`,
    );
    assert.equal(await scalar(db,
      "select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3)",
      [tokenHash, enqueued.jobId, id.claim]), false);
    await db.exec(
      `update sellerpilot_private.product_registration_drafts
          set data='{"channel":"coupang","price":3190}'::jsonb`,
    );
    assert.equal(await scalar(db,
      "select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3)",
      [tokenHash, enqueued.jobId, id.claim]), true);
    assert.ok(await scalar(db,
      "select consumed_at from sellerpilot_private.coupang_exact_price_repair_permits"));
    assert.ok(await scalar(db,
      "select provider_mutation_started_at from sellerpilot_private.channel_gateway_jobs where id=$1",
      [enqueued.jobId]));
    assert.equal(await scalar(db,
      "select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3)",
      [tokenHash, enqueued.jobId, id.claim]), false);

    const startedReplay = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(startedReplay.providerMutationStarted, true);
    assert.equal(startedReplay.permitConsumed, true);
    assert.equal(startedReplay.providerMutationPerformed, false);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set lease_expires_at=clock_timestamp()-interval '1 second'
        where id=$1`,
      [enqueued.jobId],
    );
    const postStartExpiredLeaseReplay = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(postStartExpiredLeaseReplay.rearmed, false);
    assert.equal(postStartExpiredLeaseReplay.status, "running");
    assert.equal(postStartExpiredLeaseReplay.providerMutationStarted, true);
    assert.equal(postStartExpiredLeaseReplay.permitConsumed, true);
    assert.equal(postStartExpiredLeaseReplay.providerMutationPerformed, false);

    const exactResponse = {
      ok: true,
      channel: "coupang",
      operation: "price.update",
      remoteId: "96027942778",
      steps: [
        { name: "price", ok: true, status: 200, data: {} },
        {
          name: "price-readback",
          ok: true,
          status: 200,
          data: {
            sellerpilotVendorItemId: "96027942778",
            sellerpilotRequestedPrice: 3190,
            sellerpilotObservedPrice: 3190,
            sellerpilotCurrency: "KRW",
            sellerpilotVerification: "COUPANG_VENDOR_ITEM_PRICE_VERIFIED",
          },
        },
      ],
    };
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='succeeded',response_payload=$2::jsonb,
              completed_at=clock_timestamp()
        where id=$1`,
      [enqueued.jobId, JSON.stringify(exactResponse)],
    );
    const succeededReplay = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(succeededReplay.providerMutationStarted, true);
    assert.equal(succeededReplay.permitConsumed, true);
    assert.equal(succeededReplay.providerMutationPerformed, true);

    exactResponse.steps[1].data.sellerpilotObservedPrice = 6000;
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set response_payload=$2::jsonb where id=$1`,
      [enqueued.jobId, JSON.stringify(exactResponse)],
    );
    const mismatchedReplay = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(mismatchedReplay.providerMutationPerformed, false);

    await assert.rejects(
      db.query(
        `update sellerpilot_private.coupang_exact_price_repair_permits
            set desired_price=6000`,
      ),
      /COUPANG_EXACT_PRICE_REPAIR_PERMIT_IDENTITY_IMMUTABLE/u,
    );
  } finally {
    await db.close();
  }
});

test("one pre-provider lease loss rearms the same job once and never creates a duplicate", async () => {
  const db = await database();
  try {
    const retainedBefore = (await db.query(
      `select jsonb_agg(to_jsonb(job) order by job.id) snapshot
         from sellerpilot_private.channel_gateway_jobs job
        where job.id in ($1,$2)`,
      [id.sourceJob, id.verifier],
    )).rows[0].snapshot;
    const enqueued = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs set
        status='running',worker_token_id=$2,claim_token=$3,attempt_count=1,
        started_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '5 minutes'
       where id=$1`,
      [enqueued.jobId, id.worker, id.claim],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set lease_expires_at=clock_timestamp()-interval '1 second'
        where id=$1`,
      [enqueued.jobId],
    );

    const recovered = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(recovered.jobId, enqueued.jobId);
    assert.equal(recovered.attemptId, enqueued.attemptId);
    assert.equal(recovered.status, "queued");
    assert.equal(recovered.reused, true);
    assert.equal(recovered.rearmed, true);
    assert.equal(recovered.recoveryReason, "claim_lease_expired_before_provider");
    assert.equal(recovered.providerMutationStarted, false);
    assert.equal(recovered.permitConsumed, false);
    assert.equal(recovered.providerMutationPerformed, false);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='price.update'"), 1);
    assert.deepEqual((await db.query(
      `select jsonb_agg(to_jsonb(job) order by job.id) snapshot
         from sellerpilot_private.channel_gateway_jobs job
        where job.id in ($1,$2)`,
      [id.sourceJob, id.verifier],
    )).rows[0].snapshot, retainedBefore);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_operation_attempts where operation='price.update'"), 1);
    assert.equal(await scalar(db,
      `select count(*)::integer from sellerpilot_private.operation_audit
        where action='coupang_exact_price_repair_rearmed'
          and safe_detail->>'providerMutationPerformed'='false'`), 1);
    const recoveredPermit = (await db.query(
      `select claim_count,recovery_count,recovered_at,bound_at,consumed_at
         from sellerpilot_private.coupang_exact_price_repair_permits`,
    )).rows[0];
    assert.equal(recoveredPermit.claim_count, 1);
    assert.equal(recoveredPermit.recovery_count, 1);
    assert.ok(recoveredPermit.recovered_at);
    assert.equal(recoveredPermit.bound_at, null);
    assert.equal(recoveredPermit.consumed_at, null);
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release, egress]), true);

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs set
        status='running',worker_token_id=$2,claim_token=$3,
        attempt_count=attempt_count+1,started_at=clock_timestamp(),
        lease_expires_at=clock_timestamp()+interval '5 minutes'
       where id=$1`,
      [enqueued.jobId, id.worker, id.secondClaim],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set lease_expires_at=clock_timestamp()-interval '1 second'
        where id=$1`,
      [enqueued.jobId],
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1)",
        [release],
      ),
      /COUPANG_EXACT_PRICE_REPAIR_RECOVERY_EXHAUSTED/u,
    );
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='price.update'"), 1);
  } finally {
    await db.close();
  }
});

test("an expired pristine permit receives one bounded renewal on the same queued job", async () => {
  const db = await database();
  try {
    const enqueued = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    await db.exec(
      "alter table sellerpilot_private.coupang_exact_price_repair_permits disable trigger guard_coupang_exact_price_repair_permit",
    );
    await db.exec(
      `update sellerpilot_private.coupang_exact_price_repair_permits
          set armed_at=clock_timestamp()-interval '2 hours',
              expires_at=clock_timestamp()-interval '1 hour'`,
    );
    await db.exec(
      "alter table sellerpilot_private.coupang_exact_price_repair_permits enable trigger guard_coupang_exact_price_repair_permit",
    );
    const renewed = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(renewed.jobId, enqueued.jobId);
    assert.equal(renewed.status, "queued");
    assert.equal(renewed.rearmed, true);
    assert.equal(renewed.recoveryReason, "permit_expired_before_claim");
    const permit = (await db.query(
      `select claim_count,recovery_count,recovered_at,expires_at
         from sellerpilot_private.coupang_exact_price_repair_permits`,
    )).rows[0];
    assert.equal(permit.claim_count, 0);
    assert.equal(permit.recovery_count, 1);
    assert.ok(permit.recovered_at);
    assert.ok(new Date(permit.expires_at).getTime() > Date.now());
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release, egress]), true);
  } finally {
    await db.close();
  }
});

test("release, egress, gate and direct duplicate drift fail closed", async () => {
  const db = await database();
  try {
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1)",
        ["d".repeat(40)],
      ),
      /COUPANG_EXACT_PRICE_REPAIR_PREIMAGE_REJECTED/u,
    );
    await db.exec("update sellerpilot_private.listing_mutation_release_gate set is_open=false");
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1)",
        [release],
      ),
      /COUPANG_EXACT_PRICE_REPAIR_PREIMAGE_REJECTED/u,
    );
    await db.exec("update sellerpilot_private.listing_mutation_release_gate set is_open=true");
    const enqueued = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release,
        "9".repeat(64)]), false);
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.actor, workerVersion, release,
        egress]), false);
    await db.exec(
      "update sellerpilot_private.channel_credentials set version=version+1",
    );
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release,
        egress]), false);
    await db.exec(
      "update sellerpilot_private.channel_credentials set version=version-1",
    );
    await db.exec(
      `update sellerpilot_private.product_registration_drafts
          set data='{"channel":"coupang","price":6000}'::jsonb`,
    );
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release,
        egress]), false);
    const original = (await db.query(
      "select * from sellerpilot_private.channel_gateway_jobs where id=$1",
      [enqueued.jobId],
    )).rows[0];
    await assert.rejects(
      db.query(
        `insert into sellerpilot_private.channel_gateway_jobs(
          id,credential_id,attempt_id,listing_id,channel,operation,environment,
          request_payload,status,seller_account_key,request_fingerprint,created_by,
          write_resource_kind,write_resource_key
        )values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [original.credential_id, original.attempt_id, original.listing_id,
          original.channel, original.operation, original.environment,
          original.request_payload, original.status, original.seller_account_key,
          original.request_fingerprint, original.created_by,
          original.write_resource_kind, original.write_resource_key],
      ),
      /COUPANG_EXACT_PRICE_REPAIR_JOB_LINEAGE_INVALID/u,
    );
  } finally {
    await db.close();
  }
});

test("credential, seller, draft, product and worker drift reject enqueue", async () => {
  const db = await database();
  const expectPreimage = async (mutate, restore) => {
    await db.exec(mutate);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1)",
        [release],
      ),
      /COUPANG_EXACT_PRICE_REPAIR_PREIMAGE_REJECTED/u,
    );
    await db.exec(restore);
  };
  try {
    await expectPreimage(
      "update sellerpilot_private.channel_credentials set status='inactive'",
      "update sellerpilot_private.channel_credentials set status='active'",
    );
    await expectPreimage(
      "update sellerpilot_private.product_listings set price=3191",
      "update sellerpilot_private.product_listings set price=3190",
    );
    await expectPreimage(
      "update sellerpilot_private.product_registration_drafts set version=14",
      "update sellerpilot_private.product_registration_drafts set version=13",
    );
    await expectPreimage(
      "update sellerpilot_private.products set sku='DRIFTED'",
      "update sellerpilot_private.products set sku='AUTO-780720401E2D4E4EA45F'",
    );
    await expectPreimage(
      "update sellerpilot_private.ai_cli_worker_tokens set last_version='drifted'",
      `update sellerpilot_private.ai_cli_worker_tokens set last_version='${workerVersion}'`,
    );
    await expectPreimage(
      "update sellerpilot_private.local_channel_executor_routes set enabled=false",
      "update sellerpilot_private.local_channel_executor_routes set enabled=true",
    );
  } finally {
    await db.close();
  }
});

test("draftless correction binds one repair to immutable 0515 row evidence", async () => {
  const db = await database();
  try {
    const retainedBefore = (await db.query(
      `select jsonb_agg(to_jsonb(job) order by job.id) snapshot
         from sellerpilot_private.channel_gateway_jobs job
        where job.id in ($1,$2)`,
      [id.sourceJob, id.verifier],
    )).rows[0].snapshot;
    await applyDraftlessCorrection(db);

    assert.equal(await scalar(db,
      `select count(*)::integer from information_schema.columns
        where table_schema='sellerpilot_private'
          and table_name='coupang_exact_price_repair_permits'
          and column_name in ('draft_id','draft_version','draft_data_sha256')`), 0);
    assert.equal(await scalar(db,
      `select count(*)::integer from information_schema.columns
        where table_schema='sellerpilot_private'
          and table_name='coupang_exact_price_repair_permits'
          and column_name in ('source_job_row_sha256','source_attempt_row_sha256',
            'verifier_job_row_sha256','listing_adjudicated_sha256')`), 4);
    assert.equal(await scalar(db,
      `select count(*)::integer
         from sellerpilot_private.product_registration_drafts
        where draft_id=$1 and kind='publish'`, [id.draft]), 0);
    assert.equal(await scalar(db,
      `select count(*)::integer
         from sellerpilot_private.product_registration_drafts
        where draft_id=$1 and kind='intake' and version=1`, [id.draft]), 1);

    const first = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    const replay = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(first.status, "queued");
    assert.equal(first.reused, false);
    assert.equal(replay.reused, true);
    assert.equal(replay.jobId, first.jobId);
    assert.equal(replay.attemptId, first.attemptId);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='price.update'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_operation_attempts where operation='price.update'"), 1);

    const marker = (await db.query(
      `select request_payload#>'{arguments,sellerpilotCoupangExactPriceRepair}' marker
         from sellerpilot_private.channel_gateway_jobs where id=$1`,
      [first.jobId],
    )).rows[0].marker;
    assert.equal(Object.hasOwn(marker, "draftId"), false);
    assert.equal(Object.hasOwn(marker, "draftVersion"), false);
    assert.match(marker.sourceJobRowSha256, /^[a-f0-9]{64}$/u);
    assert.match(marker.sourceAttemptRowSha256, /^[a-f0-9]{64}$/u);
    assert.match(marker.verifierJobRowSha256, /^[a-f0-9]{64}$/u);
    assert.match(marker.listingAdjudicatedSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual((await db.query(
      `select jsonb_agg(to_jsonb(job) order by job.id) snapshot
         from sellerpilot_private.channel_gateway_jobs job
        where job.id in ($1,$2)`,
      [id.sourceJob, id.verifier],
    )).rows[0].snapshot, retainedBefore);

    const permitEvidence = (await db.query(
      `select p.source_job_row_sha256=a.source_job_sha256 source_ok,
              p.source_attempt_row_sha256=a.source_attempt_sha256 attempt_ok,
              p.verifier_job_row_sha256=a.verifier_job_sha256 verifier_ok,
              p.listing_adjudicated_sha256=a.listing_after_sha256 listing_ok
         from sellerpilot_private.coupang_exact_price_repair_permits p
         join sellerpilot_private.coupang_exact_live_price_drift_adjudications a
           on a.source_job_id=p.source_job_id`,
    )).rows[0];
    assert.deepEqual(permitEvidence, {
      source_ok: true,
      attempt_ok: true,
      verifier_ok: true,
      listing_ok: true,
    });
  } finally {
    await db.close();
  }
});

test("draftless evidence drift blocks the exact job before provider claim", async () => {
  const db = await database();
  try {
    await applyDraftlessCorrection(db);
    const enqueued = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release, egress]), true);

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set error_message='SOURCE_ROW_DRIFT'
        where id=$1`,
      [id.sourceJob],
    );
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release, egress]), false);
    assert.equal(await scalar(db,
      "select provider_mutation_started_at from sellerpilot_private.channel_gateway_jobs where id=$1",
      [enqueued.jobId]), null);
    assert.equal(await scalar(db,
      "select consumed_at from sellerpilot_private.coupang_exact_price_repair_permits"), null);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='listing.create'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='listing.publication.verify'"), 1);
  } finally {
    await db.close();
  }
});

test("NULL listing uses the verified credential lineage only for the exact repair", async () => {
  const db = await database({ listingSellerKey: null, marketplaceSku: null });
  try {
    await prepareDraftlessFixture(db);
    await db.exec(draftlessCorrection);

    const genericInsert = (operation) => db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,listing_id,channel,operation,environment,
        request_payload,status,request_fingerprint,created_by
      ) values(
        gen_random_uuid(),$1,$2,'coupang',$3,'production',
        '{"arguments":{"vendorItemId":"96027942778"}}'::jsonb,
        'queued',$4,$5
      )`,
      [id.credential, id.listing, operation, "9".repeat(64), id.actor],
    );
    await assert.rejects(genericInsert("price.update"),
      /gateway listing seller account mismatch/u);

    const immutableBefore = (await db.query(
      `select jsonb_build_object(
        'listing',(select to_jsonb(row) from sellerpilot_private.product_listings row
          where row.id=$1),
        'sourceJob',(select to_jsonb(row) from sellerpilot_private.channel_gateway_jobs row
          where row.id=$2),
        'sourceAttempt',(select to_jsonb(row) from sellerpilot_private.channel_operation_attempts row
          where row.id=$3),
        'verifier',(select to_jsonb(row) from sellerpilot_private.channel_gateway_jobs row
          where row.id=$4),
        'adjudication',(select to_jsonb(row)
          from sellerpilot_private.coupang_exact_live_price_drift_adjudications row
          where row.source_job_id=$2)
      ) snapshot`,
      [id.listing, id.sourceJob, id.sourceAttempt, id.verifier],
    )).rows[0].snapshot;

    await db.exec(nullListingLineageCorrection);
    await assert.rejects(genericInsert("price.update"),
      /gateway listing seller account mismatch/u);
    await assert.rejects(genericInsert("inventory.update"),
      /gateway listing seller account mismatch/u);

    const first = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    const replay = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(first.status, "queued");
    assert.equal(first.reused, false);
    assert.equal(replay.reused, true);
    assert.equal(replay.jobId, first.jobId);
    assert.equal(replay.attemptId, first.attemptId);

    const keys = (await db.query(
      `select listing.seller_account_key listing_key,
              credential.seller_account_key credential_key,
              route.seller_account_key route_key,
              source_job.seller_account_key source_job_key,
              source_attempt.seller_account_key source_attempt_key,
              repair_job.seller_account_key repair_job_key,
              repair_attempt.seller_account_key repair_attempt_key,
              permit.seller_account_key permit_key,
              repair_job.provider_mutation_started_at,
              permit.consumed_at
         from sellerpilot_private.coupang_exact_price_repair_permits permit
         join sellerpilot_private.product_listings listing
           on listing.id=permit.listing_id
         join sellerpilot_private.channel_credentials credential
           on credential.id=permit.credential_id
         join sellerpilot_private.local_channel_executor_routes route
           on route.id=permit.source_route_id
         join sellerpilot_private.channel_gateway_jobs source_job
           on source_job.id=permit.source_job_id
         join sellerpilot_private.channel_operation_attempts source_attempt
           on source_attempt.id=permit.source_attempt_id
         join sellerpilot_private.channel_gateway_jobs repair_job
           on repair_job.id=permit.repair_job_id
         join sellerpilot_private.channel_operation_attempts repair_attempt
           on repair_attempt.id=permit.repair_attempt_id`,
    )).rows[0];
    assert.equal(keys.listing_key, null);
    for (const name of [
      "credential_key", "route_key", "source_job_key", "source_attempt_key",
      "repair_job_key", "repair_attempt_key", "permit_key",
    ]) assert.equal(keys[name], sellerKey);
    assert.equal(keys.provider_mutation_started_at, null);
    assert.equal(keys.consumed_at, null);

    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where operation='price.update'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.channel_operation_attempts where operation='price.update'"), 1);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_price_repair_permits"), 1);
    const immutableAfter = (await db.query(
      `select jsonb_build_object(
        'listing',(select to_jsonb(row) from sellerpilot_private.product_listings row
          where row.id=$1),
        'sourceJob',(select to_jsonb(row) from sellerpilot_private.channel_gateway_jobs row
          where row.id=$2),
        'sourceAttempt',(select to_jsonb(row) from sellerpilot_private.channel_operation_attempts row
          where row.id=$3),
        'verifier',(select to_jsonb(row) from sellerpilot_private.channel_gateway_jobs row
          where row.id=$4),
        'adjudication',(select to_jsonb(row)
          from sellerpilot_private.coupang_exact_live_price_drift_adjudications row
          where row.source_job_id=$2)
      ) snapshot`,
      [id.listing, id.sourceJob, id.sourceAttempt, id.verifier],
    )).rows[0].snapshot;
    assert.deepEqual(immutableAfter, immutableBefore);
    assert.equal(await scalar(db,
      `select to_jsonb(listing)=adjudication.listing_after_snapshot
          and encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')=
            adjudication.listing_after_sha256
         from sellerpilot_private.product_listings listing
         join sellerpilot_private.coupang_exact_live_price_drift_adjudications adjudication
           on adjudication.listing_id=listing.id
        where listing.id=$1`, [id.listing]), true);
    assert.equal(await scalar(db,
      `select sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(job)
         from sellerpilot_private.channel_gateway_jobs job where job.id=$1`,
      [first.jobId]), false);
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(await scalar(db,
        `select has_function_privilege($1,
          'sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(sellerpilot_private.channel_gateway_jobs)',
          'EXECUTE')`, [role]), false);
    }

    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [first.jobId, id.credential, id.worker, workerVersion, release, egress]), true);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs set
        status='running',worker_token_id=$2,claim_token=$3,attempt_count=1,
        started_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '5 minutes'
       where id=$1`,
      [first.jobId, id.worker, id.claim],
    );
    assert.equal(await scalar(db,
      "select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3)",
      [tokenHash, first.jobId, id.claim]), true);
    assert.ok(await scalar(db,
      "select consumed_at from sellerpilot_private.coupang_exact_price_repair_permits"));
    assert.ok(await scalar(db,
      "select provider_mutation_started_at from sellerpilot_private.channel_gateway_jobs where id=$1",
      [first.jobId]));
  } finally {
    await db.close();
  }
});

test("NULL listing evidence drift blocks provider claim", async () => {
  const db = await database({ listingSellerKey: null, marketplaceSku: null });
  try {
    await applyNullListingLineageCorrection(db);
    const enqueued = (await db.query(
      "select public.sellerpilot_service_enqueue_exact_coupang_price_repair($1) result",
      [release],
    )).rows[0].result;
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release, egress]), true);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set error_message='SOURCE_DRIFT' where id=$1",
      [id.sourceJob],
    );
    assert.equal(await scalar(db,
      `select sellerpilot_private.local_channel_executor_job_allowed(
        $1,$2,$3,$4,$5,$6)`,
      [enqueued.jobId, id.credential, id.worker, workerVersion, release, egress]), false);
    assert.equal(await scalar(db,
      "select provider_mutation_started_at from sellerpilot_private.channel_gateway_jobs where id=$1",
      [enqueued.jobId]), null);
    assert.equal(await scalar(db,
      "select consumed_at from sellerpilot_private.coupang_exact_price_repair_permits"), null);
  } finally {
    await db.close();
  }
});

test("empty permit fast path never evaluates the exact snapshot branch", async () => {
  const db = await database();
  try {
    await applyDraftlessCorrection(db);
    assert.equal(await scalar(db,
      "select count(*)::integer from sellerpilot_private.coupang_exact_price_repair_permits"), 0);
    await db.exec(`
      create or replace function
      sellerpilot_private.coupang_exact_price_repair_local_claim_allowed(
        p_job_id uuid,p_credential_id uuid,p_worker_token_id uuid,
        p_worker_version text,p_release_sha text,p_egress_ip_sha256 text
      ) returns boolean language plpgsql stable security definer
      set search_path='' as $$
      begin
        raise exception 'EXPENSIVE_EXACT_BRANCH_WAS_EVALUATED';
      end
      $$;
    `);
    const result = await db.query(`
      select count(*)::integer allowed
        from generate_series(1,2000) candidate(i)
       where sellerpilot_private.local_channel_executor_job_allowed(
         ('00000000-0000-4000-8000-' || lpad(candidate.i::text,12,'0'))::uuid,
         '${id.credential}'::uuid,'${id.worker}'::uuid,
         '${workerVersion}','${release}','${egress}'
       )
    `);
    assert.equal(result.rows[0].allowed, 0);
  } finally {
    await db.close();
  }
});
