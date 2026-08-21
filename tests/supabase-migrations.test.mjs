import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ADMIN_ID = "d0f39ad6-e4af-4b7e-965d-9e0a324f2fab";
const SECOND_ADMIN_ID = "1173e28d-9b03-46cc-a207-b68a780e95c7";
const NON_ADMIN_ID = "9753c228-73b7-4e1f-8cad-b6635c32ba7f";
const JOB_ID = "b231a1ac-7c2f-48bc-b2e4-8ad6db2902b7";
const CANCEL_JOB_ID = "95303cb5-f3ba-49b6-9bd4-7c5e558f0b14";
const RESEARCH_JOB_ID = "e659cfbc-0f80-44a5-94e8-f011ec53e67f";
const SHARED_PRODUCT_ID = "4a346497-84c8-4ccd-bf14-8f06f990a2f7";
const TOKEN_HASH = "a".repeat(64);

const supabaseCompatibilityLayer = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  secret text not null,
  name text,
  description text,
  created_at timestamptz not null default now()
);
create or replace function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default ''
)
returns uuid
language plpgsql
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into vault.secrets (id, secret, name, description)
  values (v_id, new_secret, new_name, new_description);
  return v_id;
end;
$$;
create or replace view vault.decrypted_secrets as
select id, secret as decrypted_secret from vault.secrets;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(path text)
returns text[]
language sql
immutable
as $$ select string_to_array(path, '/') $$;

create schema if not exists extensions;
create or replace function extensions.digest(value text, algorithm text)
returns bytea
language sql
immutable
as $$ select convert_to(md5(value || algorithm), 'UTF8') $$;
`;

function withoutUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "");
}

async function setClaims(db, role = "authenticated") {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ADMIN_ID]);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

test("Supabase migrations apply in order and core RPC flows persist safely", async () => {
  const db = new PGlite();
  try {
    await db.exec(supabaseCompatibilityLayer);

    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.deepEqual(migrationNames, [
      "20260816060000_channel_credentials_and_roles.sql",
      "20260816065848_sellerpilot_ai_cli_jobs.sql",
      "20260816103854_ai_operations_controls.sql",
      "20260816104732_operations_core.sql",
      "20260816110000_lazada_token_refresh.sql",
      "20260816120321_expand_channel_connectors.sql",
      "20260816133601_add_shopee_connector.sql",
      "20260816145605_channel_category_catalog.sql",
      "20260817001500_live_operations_snapshot.sql",
      "20260817003000_fix_pgcrypto_schema.sql",
      "20260817004500_product_publish_workflow.sql",
      "20260817045529_fix_service_role_rpc_guards.sql",
      "20260817054039_channel_gateway_queue.sql",
      "20260817060625_channel_target_discovery.sql",
      "20260817061531_localized_market_listings.sql",
      "20260817061650_channel_market_targets.sql",
      "20260817062221_market_listing_ledger.sql",
      "20260817184000_channel_oauth_state_store.sql",
      "20260817184500_fix_oauth_state_service_guards.sql",
      "20260817190000_require_product_intake_fields.sql",
      "20260817191500_allow_admin_oauth_state_for_global_credentials.sql",
      "20260817203000_route_coupang_through_local_gateway.sql",
      "20260817213000_add_temu_and_route_naver.sql",
      "20260818040000_filter_published_listing_badges.sql",
      "20260818041000_share_channel_targets_across_admins.sql",
      "20260818043000_keep_stopped_products_relistable.sql",
      "20260818170000_reject_blocked_categories.sql",
      "20260818171500_personal_data_retention.sql",
      "20260819110000_category_learning_history.sql",
      "20260819150000_inventory_sync_ledger.sql",
      "20260819170000_preserve_failed_listing_remote_id.sql",
      "20260819203000_list_published_product_destinations.sql",
      "20260820050000_channel_order_sync.sql",
      "20260820053500_channel_inquiry_sync.sql",
      "20260820090000_product_research_cli.sql",
      "20260820132000_backfill_channel_sync_counts.sql",
      "20260820143000_share_operations_workspace_across_admins.sql",
      "20260820144500_add_elevenst_margin_scenarios.sql",
      "20260820152000_android_push_notifications.sql",
      "20260820170000_periodic_channel_sync.sql",
      "20260820173000_worker_periodic_sync_auth.sql",
      "20260820180000_activate_elevenst_credentials.sql",
      "20260821100000_order_fulfillment_workflow.sql",
      "20260821101500_operations_accuracy_inventory_ui.sql",
      "20260821102500_order_product_linking.sql",
      "20260821103000_support_reply_cli.sql",
      "20260821103500_shared_inventory_workflow.sql",
      "20260821104500_shared_listing_completion.sql",
      "20260821105500_order_amount_listing_fallback.sql",
      "20260821106000_fix_ai_prune_job_id_ambiguity.sql",
      "20260821110000_harden_oauth_rotation_and_cleanup_lints.sql",
      "20260821113000_scope_push_deliveries_to_owner.sql",
      "20260821123000_enable_elevenst_order_sync.sql",
      "20260821133000_marketplace_links_cancellations_and_stock_accuracy.sql",
      "20260821134500_public_listing_health.sql",
      "20260821141500_preserve_terminal_order_state.sql",
    ]);
    for (const name of migrationNames) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
    }

    const serviceOnlyFunctions = [
      "public.sellerpilot_decrypt_credential(uuid)",
      "public.sellerpilot_record_credential_test(uuid,text,text)",
      "public.sellerpilot_get_active_credential_secret(text,text)",
      "public.sellerpilot_service_refresh_lazada(uuid,jsonb,timestamp with time zone)",
      "public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamp with time zone)",
      "public.sellerpilot_service_refresh_shopee(uuid,jsonb,timestamp with time zone)",
      "public.sellerpilot_service_complete_channel_operation(uuid,text,integer,text,text)",
      "public.sellerpilot_claim_ai_job(text,text)",
      "public.sellerpilot_complete_ai_job(text,uuid,text,jsonb,text)",
      "public.sellerpilot_prune_ai_jobs(timestamp with time zone,integer)",
      "public.sellerpilot_touch_ai_job(text,uuid,text)",
      "public.sellerpilot_service_complete_product_listing(uuid,uuid,text,boolean,text,text)",
      "public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)",
      "public.sellerpilot_claim_channel_gateway_job(text,text)",
      "public.sellerpilot_complete_channel_gateway_job(text,uuid,text,jsonb,text)",
      "public.sellerpilot_get_channel_gateway_job(uuid)",
      "public.sellerpilot_service_upsert_channel_market_target(uuid,uuid,text,text,text,text,text,text,text,text)",
      "public.sellerpilot_service_store_channel_oauth_state(uuid,uuid,text,text)",
      "public.sellerpilot_service_claim_channel_oauth_state(uuid,text,text)",
      "public.sellerpilot_service_reject_category_assignment(uuid,text,text,text)",
      "public.sellerpilot_prune_personal_data(timestamp with time zone)",
      "public.sellerpilot_service_mark_channel_sync(uuid,text,text,text,text)",
      "public.sellerpilot_service_ingest_orders(uuid,text,jsonb)",
      "public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)",
      "public.sellerpilot_service_complete_inventory_sync_item(uuid,uuid,uuid,boolean,integer,text)",
      "public.sellerpilot_service_claim_push_deliveries(integer)",
      "public.sellerpilot_service_finish_push_delivery(uuid,text,text)",
      "public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)",
      "public.sellerpilot_service_validate_worker_token(text,text)",
    ];
    for (const signature of serviceOnlyFunctions) {
      assert.equal(
        await scalar(db, "select has_function_privilege('authenticated', $1, 'EXECUTE')", [signature]),
        false,
      );
      assert.equal(
        await scalar(db, "select has_function_privilege('service_role', $1, 'EXECUTE')", [signature]),
        true,
      );
      const definition = await scalar(db, "select pg_get_functiondef($1::regprocedure)", [signature]);
      assert.doesNotMatch(definition, /request\.jwt\.claim\.role/);
    }

    await db.query("insert into auth.users (id, email) values ($1, 'admin@example.test')", [ADMIN_ID]);
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Migration Test Admin')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into auth.users (id, email) values ($1, 'second-admin@example.test'), ($2, 'non-admin@example.test')",
      [SECOND_ADMIN_ID, NON_ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Second Migration Test Admin')",
      [SECOND_ADMIN_ID],
    );
    await setClaims(db);
    assert.equal(await scalar(db, "select public.sellerpilot_is_admin()"), true);

    const credentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'qoo10', 'production', '{"certification_key":"test-only"}'::jsonb,
        now() + interval '30 days', 90, 30, 7
      )`,
    );
    assert.match(credentialId, /^[0-9a-f-]{36}$/i);
    const credentialRows = await db.query("select * from public.sellerpilot_list_credentials()");
    assert.equal(credentialRows.rows.length, 1);
    assert.equal(credentialRows.rows[0].channel, "qoo10");
    assert.equal("vault_secret_id" in credentialRows.rows[0], false);

    await setClaims(db, "service_role");
    const secret = await scalar(
      db,
      "select public.sellerpilot_get_active_credential_secret('qoo10', 'production')",
    );
    assert.equal(secret.secret_payload.certification_key, "test-only");
    const periodicQueued = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'qoo10', 'orders.list',
        '{"periodicKey":"orders","arguments":{"params":{"ShippingStat":"1"}}}'::jsonb,
        5
      )`,
    );
    assert.equal(periodicQueued.status, "queued");
    const periodicDeduplicated = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'qoo10', 'orders.list',
        '{"periodicKey":"orders","arguments":{"params":{"ShippingStat":"2"}}}'::jsonb,
        5
      )`,
    );
    assert.equal(periodicDeduplicated.status, "already_pending");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [periodicQueued.jobId],
    );
    await db.query(
      "select public.sellerpilot_record_credential_test($1, 'passed', 'read-only diagnostic passed')",
      [credentialId],
    );

    const lazadaCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'lazada', 'production',
        '{"app_key":"test-app","app_secret":"test-secret","access_token":"old-access-token","refresh_token":"old-refresh-token"}'::jsonb,
        now() + interval '180 days', 30, 14, 0
      )`,
    );
    await setClaims(db, "service_role");
    await db.query(
      "select public.sellerpilot_record_credential_test($1, 'passed', 'OAuth rotation regression diagnostic')",
      [lazadaCredentialId],
    );
    const lazadaPeriodicQueued = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'lazada', 'orders.list',
        '{"periodicKey":"oauth-rotation-regression","arguments":{}}'::jsonb,
        5
      )`,
    );
    assert.equal(lazadaPeriodicQueued.status, "queued");
    const refreshedCredentialId = await scalar(
      db,
      `select public.sellerpilot_service_refresh_lazada(
        $1,
        '{"app_key":"test-app","app_secret":"test-secret","access_token":"new-access-token","refresh_token":"new-refresh-token"}'::jsonb,
        now() + interval '180 days'
      )`,
      [lazadaCredentialId],
    );
    assert.notEqual(refreshedCredentialId, lazadaCredentialId);
    assert.equal(
      await scalar(
        db,
        "select last_check_status from sellerpilot_private.channel_credentials where id = $1",
        [refreshedCredentialId],
      ),
      "passed",
    );
    assert.equal(
      await scalar(
        db,
        "select credential_id from sellerpilot_private.channel_gateway_jobs where id = $1",
        [lazadaPeriodicQueued.jobId],
      ),
      refreshedCredentialId,
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [lazadaPeriodicQueued.jobId],
    );
    const refreshedSecret = await scalar(
      db,
      "select public.sellerpilot_get_active_credential_secret('lazada', 'production')",
    );
    assert.equal(refreshedSecret.secret_payload.access_token, "new-access-token");

    const oauthStateHash = "c".repeat(64);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_store_channel_oauth_state($1, $2, 'lazada', $3)",
        [SECOND_ADMIN_ID, refreshedCredentialId, oauthStateHash],
      ),
      true,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_store_channel_oauth_state($1, $2, 'lazada', $3)",
        [NON_ADMIN_ID, refreshedCredentialId, "d".repeat(64)],
      ),
      /invalid oauth state request/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_claim_channel_oauth_state($1, 'lazada', $2)",
        [ADMIN_ID, oauthStateHash],
      ),
      null,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_claim_channel_oauth_state($1, 'lazada', $2)",
        [SECOND_ADMIN_ID, oauthStateHash],
      ),
      refreshedCredentialId,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_claim_channel_oauth_state($1, 'lazada', $2)",
        [SECOND_ADMIN_ID, oauthStateHash],
      ),
      null,
    );

    await setClaims(db);
    for (const channel of ["coupang", "smartstore", "ebay", "temu"]) {
      const id = await scalar(
        db,
        "select public.sellerpilot_rotate_credential($1, 'production', $2::jsonb, now() + interval '180 days', 90, 30, 0)",
        [channel, JSON.stringify({ key: `${channel}-test-key`, access_token: "old-access-token", refresh_token: "old-refresh-token", client_id: "test-client", client_secret: "test-secret" })],
      );
      assert.match(id, /^[0-9a-f-]{36}$/i);
    }
    await setClaims(db, "service_role");
    const ebayActive = await scalar(db, "select public.sellerpilot_get_active_credential_secret('ebay', 'production')");
    const refreshedEbayId = await scalar(
      db,
      `select public.sellerpilot_service_refresh_ebay(
        $1,
        '{"client_id":"test-client","client_secret":"test-secret","access_token":"new-ebay-access-token","refresh_token":"old-refresh-token"}'::jsonb,
        now() + interval '180 days'
      )`,
      [ebayActive.credential_id],
    );
    assert.notEqual(refreshedEbayId, ebayActive.credential_id);
    const refreshedEbay = await scalar(db, "select public.sellerpilot_get_active_credential_secret('ebay', 'production')");
    assert.equal(refreshedEbay.secret_payload.access_token, "new-ebay-access-token");

    await setClaims(db);
    const operationFingerprint = "b".repeat(64);
    const claimedOperation = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'orders.list', 'orders-20260816-page-0001', $2)",
      [credentialId, operationFingerprint],
    );
    assert.equal(claimedOperation.duplicate, false);
    assert.equal(claimedOperation.status, "running");
    const duplicateOperation = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'orders.list', 'orders-20260816-page-0001', $2)",
      [credentialId, operationFingerprint],
    );
    assert.equal(duplicateOperation.duplicate, true);
    assert.equal(duplicateOperation.attempt_id, claimedOperation.attempt_id);
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_channel_operation($1, 'succeeded', 200, 'remote-1', 'read completed')",
        [claimedOperation.attempt_id],
      ),
      true,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_operation_attempts where id = $1", [claimedOperation.attempt_id]),
      "succeeded",
    );

    await setClaims(db);
    await db.query(
      "select public.sellerpilot_issue_ai_worker_token('test worker', $1, 'AAAAAAAAAAAA', now() + interval '30 days')",
      [TOKEN_HASH],
    );
    const shopeeCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'shopee', 'production',
        '{"partner_id":"2031489","partner_key":"test-partner-key-long","shop_id":"123456789","access_token":"test-access-token","refresh_token":"test-refresh-token"}'::jsonb,
        now() + interval '365 days', 90, 30, 0
      )`,
    );
    const shopeeAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'shopee', 'categories.list', 'shopee-categories-migration-0001', $2)",
      [shopeeCredentialId, "d".repeat(64)],
    );
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_validate_worker_token($1, 'migration-test/1.9')", [TOKEN_HASH]),
      true,
    );
    const gatewayJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_channel_gateway_job($1, $2, 'shopee', 'categories.list', '{\"arguments\":{\"shopId\":\"123456789\"}}'::jsonb)",
      [shopeeCredentialId, shopeeAttempt.attempt_id],
    );
    const gatewayClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/1.2')",
      [TOKEN_HASH],
    );
    assert.equal(gatewayClaim.id, gatewayJobId);
    assert.equal(gatewayClaim.credential.partner_key, "test-partner-key-long");
    const gatewayResponse = {
      ok: true,
      channel: "shopee",
      operation: "categories.list",
      steps: [{ name: "categories", ok: true, status: 200, data: { response: { category_list: [] } } }],
      safeMessage: "Shopee category read completed.",
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_channel_gateway_job($1, $2, 'succeeded', $3::jsonb, null)",
        [TOKEN_HASH, gatewayJobId, JSON.stringify(gatewayResponse)],
      ),
      true,
    );
    const gatewaySnapshot = await scalar(db, "select public.sellerpilot_get_channel_gateway_job($1)", [gatewayJobId]);
    assert.equal(gatewaySnapshot.status, "succeeded");
    assert.equal(gatewaySnapshot.response.operation, "categories.list");
    await setClaims(db);
    const requiredManualFields = {
      researchInput: "https://example.test/product/1 흰색 도자기 머그컵 상세정보",
      productName: "AI 생성 테스트 상품",
      sellerSku: "AI-REQUIRED-001",
      categoryHint: "도자기 머그컵",
      brandName: "No Brand",
      manufacturer: "테스트 공급처",
      countryOfOrigin: "대한민국",
      material: "도자기 100%",
      packageContents: "머그컵 1개",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 12900,
      currency: "KRW",
      stock: 2,
      weightKg: 0.35,
      packageLengthCm: 12,
      packageWidthCm: 12,
      packageHeightCm: 10,
      description: "실제 사진과 입력값을 교차검증하는 흰색 도자기 머그컵입니다.",
      productUrl: "https://example.test/product/1",
      imageRightsConfirmed: true,
      productFactsConfirmed: true,
    };
    const requestPayload = {
      image_paths: [`${ADMIN_ID}/${JOB_ID}/input/hero.jpg`],
      image_specs: [{ name: "hero.jpg", role: "main", originalWidth: 1200, originalHeight: 1200, width: 1200, height: 1200, bytes: 120000, mediaType: "image/jpeg", fit: "contain" }],
      manual_fields: requiredManualFields,
      description: "실제 상품 분석 테스트",
      product_url: "https://example.test/product/1",
      research_input: requiredManualFields.researchInput,
    };
    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [JOB_ID, JSON.stringify(requestPayload)],
    );

    await setClaims(db, "service_role");
    const claimed = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/1.0')",
      [TOKEN_HASH],
    );
    assert.equal(claimed.id, JOB_ID);
    assert.equal(
      await scalar(db, "select public.sellerpilot_touch_ai_job($1, $2, 'migration-test/1.0')", [TOKEN_HASH, JOB_ID]),
      "running",
    );
    const resultPayload = {
      title: "AI 생성 테스트 상품",
      detail_copy: "상품 사실정보를 반영한 테스트 결과",
      asset_storage_paths: {
        hero: `${ADMIN_ID}/${JOB_ID}/generated/hero.png`,
        square: `${ADMIN_ID}/${JOB_ID}/generated/square.png`,
        portrait: `${ADMIN_ID}/${JOB_ID}/generated/portrait.png`,
        wide: `${ADMIN_ID}/${JOB_ID}/generated/wide.png`,
      },
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, 'succeeded', $3::jsonb, null)",
        [TOKEN_HASH, JOB_ID, JSON.stringify(resultPayload)],
      ),
      true,
    );

    await setClaims(db);
    const aiProductId = await scalar(
      db,
      "select public.sellerpilot_create_product_from_ai_v2($1)",
      [JOB_ID],
    );
    assert.match(aiProductId, /^[0-9a-f-]{36}$/i);
    assert.equal(await scalar(db, "select sku from sellerpilot_private.products where id = $1", [aiProductId]), "AI-REQUIRED-001");
    await assert.rejects(
      db.query(
        `select public.sellerpilot_save_product_category_assignment(
          $1, 'ai-job-category-test', 'AI 생성 테스트 상품', 'coupang', 'production', 'KR',
          '63955', array['생활용품','세제','표백제','분말형'], true, 0.98,
          'channel_recommendation',
          '[{"id":"quantity","name":"수량","required":true}]'::jsonb,
          '{}'::jsonb, '{"verifiedBy":"channel_api"}'::jsonb, true
        )`,
        [aiProductId],
      ),
      /category confirmation requires an active leaf and every required attribute/,
    );
    const categoryAssignmentId = await scalar(
      db,
      `select public.sellerpilot_save_product_category_assignment(
        $1, 'ai-job-category-test', 'AI 생성 테스트 상품', 'coupang', 'production', 'KR',
        '63955', array['생활용품','세제','표백제','분말형'], true, 0.98,
        'channel_recommendation',
        '[{"id":"quantity","name":"수량","required":true}]'::jsonb,
        '{"quantity":"1개"}'::jsonb, '{"verifiedBy":"channel_api"}'::jsonb, true
      )`,
      [aiProductId],
    );
    assert.match(categoryAssignmentId, /^[0-9a-f-]{36}$/i);
    const categoryAssignments = await db.query("select * from public.sellerpilot_list_product_category_assignments('ai-job-category-test')");
    assert.equal(categoryAssignments.rows.length, 1);
    assert.equal(categoryAssignments.rows[0].status, "confirmed");
    assert.deepEqual(categoryAssignments.rows[0].missing_required_attributes, []);
    const publishContext = await scalar(db, "select public.sellerpilot_get_product_publish_context($1)", [aiProductId]);
    assert.equal(publishContext.product.id, aiProductId);
    assert.equal(publishContext.manualFields.sellerSku, "AI-REQUIRED-001");
    assert.equal(publishContext.imageSpecs[0].width, 1200);
    assert.equal(publishContext.assignments.length, 1);
    const coupangCredentialId = await scalar(
      db,
      "select id from public.sellerpilot_list_credentials() where channel = 'coupang' and status = 'active' limit 1",
    );
    const preparedListingId = await scalar(
      db,
      "select public.sellerpilot_prepare_product_listing($1, 'coupang', 'listing.create', 'KRW', 25000)",
      [aiProductId],
    );
    assert.match(preparedListingId, /^[0-9a-f-]{36}$/i);
    const listingAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'listing.create', 'listing-ai-product-coupang-0001', $2)",
      [coupangCredentialId, "c".repeat(64)],
    );
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_channel_operation($1, 'succeeded', 200, 'remote-product-1', 'listing completed')",
        [listingAttempt.attempt_id],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_product_listing($1, $2, 'listing.create', true, 'remote-product-1', 'listing completed')",
        [preparedListingId, listingAttempt.attempt_id],
      ),
      true,
    );
    await setClaims(db);
    await assert.rejects(
      db.query("select public.sellerpilot_seed_demo_operations()"),
      /demo data is disabled/,
    );

    const pushSubscriptionId = await scalar(
      db,
      "select public.sellerpilot_upsert_push_subscription($1, $2, $3, 'Android Migration Test', '테스트 Android')",
      ["https://push.example.test/subscriptions/admin-device", "p".repeat(88), "a".repeat(24)],
    );
    assert.match(pushSubscriptionId, /^[0-9a-f-]{36}$/i);
    const pushSubscription = await scalar(
      db,
      "select public.sellerpilot_get_push_subscription($1)",
      ["https://push.example.test/subscriptions/admin-device"],
    );
    assert.equal(pushSubscription.id, pushSubscriptionId);
    assert.equal(pushSubscription.enabled, true);

    await db.query(
      `insert into sellerpilot_private.commerce_orders (
        owner_id, external_order_id, channel_key, customer_name, product_id, product_name,
        quantity, amount, currency, amount_krw, status, ordered_at, demo
      ) values ($1, 'REAL-ORDER-1', 'qoo10', '실고객', $2, 'AI 생성 테스트 상품', 1, 32000, 'KRW', 32000, 'paid', now(), false)`,
      [ADMIN_ID, aiProductId],
    );
    await db.query(
      `insert into sellerpilot_private.support_tickets (
        owner_id, external_ticket_id, channel_key, customer_name, subject, message,
        status, priority, received_at, demo
      ) values ($1, 'REAL-TICKET-1', 'qoo10', '실고객', '실제 문의', '배송 상태 확인', 'waiting', 2, now(), false)`,
      [ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.products (
        id, owner_id, external_code, sku, name, description, status,
        on_hand, reserved, reorder_point, cost_krw, demo
      ) values ($1, $2, 'SHARED-PRODUCT-1', 'SHARED-SKU-1', '다른 관리자 생성 상품',
        '승인된 관리자 전체 공유 검증', 'active', 20, 0, 5, 12000, false)`,
      [SHARED_PRODUCT_ID, SECOND_ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.commerce_orders (
        owner_id, external_order_id, channel_key, customer_name, product_id, product_name,
        quantity, amount, currency, amount_krw, status, ordered_at, demo
      ) values ($1, 'SHARED-ORDER-1', 'qoo10', '공유고객', $2,
        '다른 관리자 생성 상품', 1, 21000, 'KRW', 21000, 'paid', now() + interval '1 second', false)`,
      [SECOND_ADMIN_ID, SHARED_PRODUCT_ID],
    );
    await db.query(
      `insert into sellerpilot_private.support_tickets (
        owner_id, external_ticket_id, channel_key, customer_name, subject, message,
        status, priority, received_at, demo
      ) values ($1, 'SHARED-TICKET-1', 'qoo10', '공유고객', '공유 문의',
        '다른 관리자가 수집한 문의', 'waiting', 1, now() + interval '1 second', false)`,
      [SECOND_ADMIN_ID],
    );

    await setClaims(db, "service_role");
    const cancelledOrder = JSON.stringify([{
      externalOrderId: "REAL-ORDER-1",
      customerName: "실고객",
      productName: "AI 생성 테스트 상품",
      quantity: 1,
      amount: 0,
      amountKrw: 0,
      currency: "KRW",
      status: "cancelled",
      orderedAt: new Date().toISOString(),
    }]);
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_ingest_orders($1, 'qoo10', $2::jsonb)", [credentialId, cancelledOrder]),
      1,
    );
    const stalePaidOrder = JSON.stringify([{
      externalOrderId: "REAL-ORDER-1",
      customerName: "마켓 구매자",
      productName: "주문 상품",
      quantity: 1,
      amount: 0,
      amountKrw: 0,
      currency: "KRW",
      status: "paid",
      orderedAt: new Date().toISOString(),
    }]);
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_ingest_orders($1, 'qoo10', $2::jsonb)", [credentialId, stalePaidOrder]),
      1,
    );
    const terminalOrder = (await db.query(
      "select id, status, product_name, amount_krw from sellerpilot_private.commerce_orders where owner_id=$1 and channel_key='qoo10' and external_order_id='REAL-ORDER-1'",
      [ADMIN_ID],
    )).rows[0];
    assert.equal(terminalOrder.status, "cancelled");
    assert.equal(terminalOrder.product_name, "AI 생성 테스트 상품");
    assert.equal(terminalOrder.amount_krw, "32000.00");
    await db.query(
      "delete from sellerpilot_private.push_notification_outbox where event_key=$1",
      [`order:${terminalOrder.id}:status:cancelled`],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_ingest_orders($1, 'qoo10', '[]'::jsonb)", [credentialId]),
      0,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', '[]'::jsonb)", [credentialId]),
      0,
    );
    assert.equal(
      await scalar(db, "select imported_count from sellerpilot_private.channel_sync_state where owner_id = $1 and channel_key = 'qoo10' and data_type = 'orders'", [ADMIN_ID]),
      1,
    );
    assert.equal(
      await scalar(db, "select imported_count from sellerpilot_private.channel_sync_state where owner_id = $1 and channel_key = 'qoo10' and data_type = 'inquiries'", [ADMIN_ID]),
      1,
    );
    await setClaims(db);

    const snapshot = await scalar(db, "select public.sellerpilot_get_operations_snapshot()");
    assert.equal(snapshot.products.length, 2);
    assert.equal(snapshot.orders.length, 2);
    assert.equal(snapshot.tickets.length, 2);
    assert.equal(snapshot.products.every((product) => product.demo === false), true);
    assert.equal(snapshot.orders.every((order) => order.demo === false), true);
    assert.equal(snapshot.tickets.every((ticket) => ticket.demo === false), true);
    assert.equal(snapshot.summary.orderCount, 2);
    assert.equal(snapshot.summary.paidOrderCount, 1);
    assert.equal(snapshot.summary.sold30d, 1);
    assert.equal(snapshot.summary.openTicketCount, 2);
    assert.equal(snapshot.channelMetrics.find((channel) => channel.channelKey === "qoo10").credentialStatus, "active");
    const aiProduct = snapshot.products.find((product) => product.id === aiProductId);
    assert.equal(aiProduct.demo, false);
    assert.equal(aiProduct.status, "low_stock");
    assert.equal(aiProduct.reorderPoint, 10);
    assert.deepEqual(aiProduct.listingChannels, ["C"]);
    assert.equal(aiProduct.aiHeroPath, resultPayload.asset_storage_paths.hero);
    assert.equal(snapshot.products.some((product) => product.id === SHARED_PRODUCT_ID), true);
    const sharedPublishContext = await scalar(db, "select public.sellerpilot_get_product_publish_context($1)", [SHARED_PRODUCT_ID]);
    assert.equal(sharedPublishContext.product.id, SHARED_PRODUCT_ID);
    assert.equal(sharedPublishContext.ownerId, SECOND_ADMIN_ID);

    const sharedCategoryAssignmentId = await scalar(
      db,
      `select public.sellerpilot_save_product_category_assignment(
        $1, 'shared-product-category-test', '다른 관리자 생성 상품', 'qoo10', 'production', 'JP',
        '320000001', array['생활','테스트'], true, 1,
        'seller_selected', '[]'::jsonb, '{}'::jsonb, '{"verifiedBy":"test"}'::jsonb, true
      )`,
      [SHARED_PRODUCT_ID],
    );
    assert.match(sharedCategoryAssignmentId, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(db, "select owner_id from sellerpilot_private.product_category_assignments where id = $1", [sharedCategoryAssignmentId]),
      SECOND_ADMIN_ID,
    );
    const sharedListingId = await scalar(
      db,
      "select public.sellerpilot_prepare_product_listing($1, 'qoo10', 'listing.create', 'JPY', 1800)",
      [SHARED_PRODUCT_ID],
    );
    assert.match(sharedListingId, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(db, "select owner_id from sellerpilot_private.product_listings where id = $1", [sharedListingId]),
      SECOND_ADMIN_ID,
    );

    const sharedOperation = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'orders.list', 'shared-operation-key-0001', $2)",
      [credentialId, "d".repeat(64)],
    );
    assert.equal(sharedOperation.duplicate, false);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [SECOND_ADMIN_ID]);
    const duplicateSharedOperation = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'orders.list', 'shared-operation-key-0001', $2)",
      [credentialId, "d".repeat(64)],
    );
    assert.equal(duplicateSharedOperation.duplicate, true);
    assert.equal(duplicateSharedOperation.attempt_id, sharedOperation.attempt_id);
    await setClaims(db);

    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_research', $2::jsonb)",
      [RESEARCH_JOB_ID, JSON.stringify({ research_input: "https://example.test/product/1 또는 흰색 도자기 머그컵 설명" })],
    );
    assert.equal(await scalar(db, "select kind from sellerpilot_private.ai_cli_jobs where id = $1", [RESEARCH_JOB_ID]), "product_research");

    const firstOrderId = snapshot.orders.find((order) => order.externalOrderId === "SHARED-ORDER-1").id;
    const firstTicketId = snapshot.tickets.find((ticket) => ticket.externalTicketId === "SHARED-TICKET-1").id;
    assert.equal(
      await scalar(db, "select public.sellerpilot_update_order_status($1, 'ready_to_ship')", [firstOrderId]),
      true,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.push_notification_outbox where event_key = $1", [`order:${firstOrderId}:status:ready_to_ship`]),
      1,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.push_notification_deliveries where subscription_id = $1", [pushSubscriptionId]),
      1,
    );
    await setClaims(db, "service_role");
    const claimedPush = await db.query("select * from public.sellerpilot_service_claim_push_deliveries(10)");
    assert.equal(claimedPush.rows.length, 1);
    assert.equal(claimedPush.rows.every((delivery) => delivery.endpoint === "https://push.example.test/subscriptions/admin-device"), true);
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_finish_push_delivery($1, 'sent', null)", [claimedPush.rows[0].delivery_id]),
      true,
    );
    await setClaims(db);
    assert.equal(
      await scalar(db, "select public.sellerpilot_update_ticket($1, 'resolved', '답변 저장 검증')", [firstTicketId]),
      true,
    );
    const marginScenarioId = await scalar(
        db,
        "select public.sellerpilot_save_margin_scenario('마진 검증', 'qoo10', '{\"cost\":10000}'::jsonb, '{\"margin\":22.5}'::jsonb)",
    );
    assert.match(marginScenarioId, /^[0-9a-f-]{36}$/i);
    const marginScenarios = await scalar(db, "select public.sellerpilot_list_margin_scenarios(5)");
    assert.equal(marginScenarios.length, 1);
    assert.equal(marginScenarios[0].channelKey, "qoo10");
    assert.equal(await scalar(db, "select public.sellerpilot_delete_margin_scenario($1)", [marginScenarioId]), true);
    const elevenstMarginScenarioId = await scalar(
      db,
      "select public.sellerpilot_save_margin_scenario('11번가 마진 검증', 'elevenst', '{\"cost\":12000}'::jsonb, '{\"margin\":20}'::jsonb)",
    );
    assert.match(elevenstMarginScenarioId, /^[0-9a-f-]{36}$/i);
    assert.equal(await scalar(db, "select public.sellerpilot_delete_margin_scenario($1)", [elevenstMarginScenarioId]), true);

    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [CANCEL_JOB_ID, JSON.stringify(requestPayload)],
    );
    assert.equal(await scalar(db, "select public.sellerpilot_cancel_ai_job($1)", [CANCEL_JOB_ID]), true);
    assert.equal(await scalar(db, "select public.sellerpilot_retry_ai_job($1)", [CANCEL_JOB_ID]), true);
    const jobs = await db.query("select * from public.sellerpilot_list_ai_jobs(10)");
    assert.equal(jobs.rows.length, 3);
    assert.equal(jobs.rows.some((job) => job.status === "succeeded" && job.has_hero), true);
    assert.equal(jobs.rows.some((job) => job.kind === "product_research"), true);
  } finally {
    await db.close();
  }
});
