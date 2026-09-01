import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901173400_adopt_exact_qoo10_already_live_readback.sql",
  import.meta.url,
);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

const validObservation = {
  contract: "qoo10_seller_center_already_live_readback_v1",
  profileName: "CHANGHEE",
  remoteId: "1217336970",
  sellerSku: "QA-20260823-CC-001",
  title: "貼り付け式ケーブル整理クリップ6個セット",
  promotionName: "販売者が確認した入力だけに基づく商品案内",
  providerStatus: "S2",
  sellerStatus: "selling",
  sellerStatusLabel: "판매중",
  nextSellerActionLabel: "판매중지로 변경",
  purchaseAvailable: true,
  cartActionLabel: "カートに入れる",
  currency: "JPY",
  priceJpy: 1871,
  quantity: 1,
  shippingNo: "806971",
  shippingFeeJpy: 0,
  shippingCompany: "TracX Logis",
  representativeImageCount: 1,
  additionalImageCount: 0,
  detailImageCount: 8,
  detailUniqueImageCount: 8,
  detailLocale: "ja-JP",
  detailJapanese: true,
  detailContainsRomanizedTitle: true,
  detailContainsKrwPrice: true,
  sellerCenterObserved: true,
  publicPageObserved: true,
  publicUrl: "https://www.qoo10.jp/g/1217336970",
  observedAt: "2026-09-01T10:45:00Z",
};

test("already-live validator accepts only the exact fresh-readback shape", async () => {
  const db = new PGlite();
  const migration = await readFile(migrationUrl, "utf8");
  try {
    await db.exec("create schema sellerpilot_private");
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.qoo10_exact_already_live_observation_valid(",
    ));
    const valid = await db.query(
      "select sellerpilot_private.qoo10_exact_already_live_observation_valid($1::jsonb) value",
      [JSON.stringify(validObservation)],
    );
    assert.equal(valid.rows[0].value, true);

    const mutations = [
      ["wrong profile", { profileName: "JEONGHUN" }],
      ["wrong item", { remoteId: "1217336971" }],
      ["not selling", { sellerStatus: "stopped" }],
      ["not purchasable", { purchaseAvailable: false }],
      ["wrong price", { priceJpy: 1872 }],
      ["wrong shipping", { shippingNo: "other" }],
      ["missing detail image", { detailImageCount: 7 }],
      ["claims clean localization", { detailContainsKrwPrice: false }],
      ["wrong public URL", { publicUrl: "https://example.test" }],
      ["extra key", { untrusted: true }],
    ];
    for (const [label, patch] of mutations) {
      const result = await db.query(
        "select sellerpilot_private.qoo10_exact_already_live_observation_valid($1::jsonb) value",
        [JSON.stringify({ ...validObservation, ...patch })],
      );
      assert.equal(result.rows[0].value, false, label);
    }
  } finally {
    await db.close();
  }
});

test("already-live adoption is a separate exact internal-only ledger path", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  for (const exactValue of [
    "1217336970",
    "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
    "ddccde35-9c58-4856-b673-d7aa27ce4220",
    "2b49d081-5188-4a75-9555-e0a6438e8a2b",
    "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
    "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    "4402cc76-295b-4e17-8c07-d5d0e9967ce9",
    "qoo10_seller_center_already_live_readback_v1",
    "qoo10_exact_already_live_adoptions",
    "sellerpilot_service_adopt_exact_qoo10_already_live",
  ]) assert.ok(migration.includes(exactValue), exactValue);

  assert.match(
    migration,
    /v_observed_at < clock_timestamp\(\) - interval '15 minutes'[\s\S]*v_observed_at > clock_timestamp\(\) \+ interval '1 minute'/u,
  );
  assert.match(
    migration,
    /qoo10_exact_partial_manual_later_jobs_valid\([\s\S]*v_active_later_jobs <> 0[\s\S]*v_active_permits <> 0[\s\S]*v_same_remote_listings <> 1/u,
  );
  assert.match(
    migration,
    /exists \([\s\S]*qoo10_exact_partial_manual_reconciliations[\s\S]*exists \([\s\S]*qoo10_exact_manual_activation_outcomes/u,
  );
  assert.match(
    migration,
    /status = 'published'[\s\S]*remote_visibility = 'live'[\s\S]*provider_status = 'S2'[\s\S]*failure_class = null/u,
  );
  assert.match(
    migration,
    /providerCallReplayed', false[\s\S]*providerWritePerformedByRpc', false[\s\S]*gatewayJobCreated', false[\s\S]*externalWriteCount', 0/u,
  );
  assert.match(
    migration,
    /revoke all on function[\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute on function[\s\S]*to service_role;/u,
  );
  assert.match(
    migration,
    /sellerpilot\.qoo10_already_live_adoption[\s\S]*qoo10_exact_already_live_listing_update_allowed/u,
  );
  assert.match(
    migration,
    /sellerpilot\.qoo10_already_live_adopt_source[\s\S]*qoo10_exact_already_live_adoptions/u,
  );

  const rpc = extractFunction(
    migration,
    "create function public.sellerpilot_service_adopt_exact_qoo10_already_live(",
  );
  assert.doesNotMatch(
    rpc,
    /fetch\s*\(|qapi|sendcommand|sellerpilot_claim_channel_operation/iu,
  );
  assert.doesNotMatch(rpc, /insert into sellerpilot_private\.channel_gateway_jobs/iu);
  assert.doesNotMatch(rpc, /insert into sellerpilot_private\.channel_operation_attempts/iu);
  assert.doesNotMatch(rpc, /sellerpilot_service_reconcile_exact_qoo10_partial_manual/iu);
  assert.doesNotMatch(rpc, /sellerpilot_service_finalize_exact_qoo10_manual_activation/iu);
});

test("already-live RPC atomically adopts the exact tuple without creating a provider job", async () => {
  const db = new PGlite();
  const migration = await readFile(migrationUrl, "utf8");
  const sourceJobId = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
  const sourceAttemptId = "4402cc76-295b-4e17-8c07-d5d0e9967ce9";
  const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
  const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
  const credentialId = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
  const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
  const creatorId = "21eb1892-0894-4f9f-b414-4c9464182dd6";
  const sellerAccount =
    "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
  const release = "a".repeat(40);
  const observation = {
    ...validObservation,
    observedAt: new Date().toISOString(),
  };
  try {
    await db.exec(`
      create schema auth;
      create schema extensions;
      create schema sellerpilot_private;
      create table auth.users(id uuid primary key);
      insert into auth.users values('${ownerId}'),('${creatorId}');

      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case octet_length(value)
          when 23555 then decode(
            'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d',
            'hex'
          )
          when 16669 then decode(
            'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768',
            'hex'
          )
          else decode(repeat('0',64),'hex')
        end
      $$;
      create function sellerpilot_private.qoo10_exact_s1_release_is_current(
        value text
      ) returns boolean language sql stable as $$
        select value='${release}'
      $$;
      create function
        sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(
          job_id uuid, arguments jsonb, release_sha text
        ) returns boolean language sql stable as $$ select true $$;
      create function
        sellerpilot_private.qoo10_exact_partial_manual_later_jobs(job_id uuid)
      returns jsonb language sql stable as $$
        select '[
          {"jobId":"00000000-0000-0000-0000-000000000001","operation":"listing.activate","status":"failed","attemptCount":0,"providerMutationStarted":false,"completed":true},
          {"jobId":"00000000-0000-0000-0000-000000000002","operation":"listing.activate","status":"failed","attemptCount":0,"providerMutationStarted":false,"completed":true},
          {"jobId":"00000000-0000-0000-0000-000000000003","operation":"listing.activate","status":"failed","attemptCount":1,"providerMutationStarted":false,"completed":true}
        ]'::jsonb
      $$;
      create function
        sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid(
          job_id uuid, later_jobs jsonb
        ) returns boolean language sql stable as $$
          select later_jobs is not distinct from
            sellerpilot_private.qoo10_exact_partial_manual_later_jobs(job_id)
        $$;

      create table sellerpilot_private.products(
        id uuid primary key, owner_id uuid, sku text, on_hand integer,
        demo boolean, status text
      );
      create table sellerpilot_private.channel_credentials(
        id uuid primary key, created_by uuid, channel text, environment text,
        status text, seller_account_key text, seller_account_key_source text,
        seller_account_verified_at timestamptz, last_checked_at timestamptz,
        last_check_status text, expires_at timestamptz
      );
      create table sellerpilot_private.channel_operation_attempts(
        id uuid primary key, owner_id uuid, credential_id uuid, channel text,
        operation text, status text, remote_id text, request_fingerprint text,
        gateway_write_required boolean, pre_gateway_retryable boolean,
        http_status integer, safe_message text
      );
      create table sellerpilot_private.channel_gateway_jobs(
        id uuid primary key, attempt_id uuid, listing_id uuid,
        credential_id uuid, created_by uuid, channel text, operation text,
        environment text, status text, seller_account_key text,
        attempt_count integer, provider_mutation_started_at timestamptz,
        completed_at timestamptz, request_payload jsonb,
        response_payload jsonb, request_fingerprint text,
        error_message text, created_at timestamptz, updated_at timestamptz
      );
      create table sellerpilot_private.product_listings(
        id uuid primary key, owner_id uuid, product_id uuid, channel_key text,
        market text, target_id text, operation_attempt_id uuid, status text,
        failure_class text, remote_visibility text, provider_status text,
        remote_id text, requested_publication_intent text, currency text,
        price numeric, published_at timestamptz, last_verified_at timestamptz,
        seller_account_key text, marketplace_sku text,
        remote_resources jsonb, last_error text, updated_at timestamptz
      );
      create table
        sellerpilot_private.qoo10_exact_localization_update_permits(
          listing_id uuid, invalidated_at timestamptz, expires_at timestamptz
        );
      create table
        sellerpilot_private.qoo10_exact_partial_manual_reconciliations(
          source_job_id uuid
        );
      create table sellerpilot_private.qoo10_exact_manual_activation_outcomes(
        source_job_id uuid
      );
      create table sellerpilot_private.qoo10_exact_no_effect_reconciliations(
        source_job_id uuid
      );
      create table sellerpilot_private.qoo10_exact_already_live_adoptions(
        source_job_id uuid primary key, source_attempt_id uuid,
        listing_id uuid, product_id uuid, credential_id uuid, owner_id uuid,
        remote_id text, seller_account_key text, observation jsonb,
        observation_sha256 text, later_jobs jsonb, later_jobs_sha256 text,
        observed_at timestamptz, provider_status text,
        remote_visibility text, purchase_available boolean,
        provider_call_replayed boolean, external_write_count integer,
        recorded_at timestamptz default clock_timestamp()
      );
      create table sellerpilot_private.operation_audit(
        owner_id uuid, action text, entity_type text, entity_id text,
        safe_detail jsonb
      );
    `);
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.qoo10_exact_already_live_observation_valid(",
    ));
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.qoo10_exact_already_live_resources(",
    ));
    await db.exec(extractFunction(
      migration,
      "create function public.sellerpilot_service_adopt_exact_qoo10_already_live(",
    ));
    await db.exec(`
      insert into sellerpilot_private.products values(
        '${productId}','${ownerId}','QA-20260823-CC-001',1,false,'active'
      );
      insert into sellerpilot_private.channel_credentials values(
        '${credentialId}','${ownerId}','qoo10','production','active',
        '${sellerAccount}','credential_incarnation_v1',
        statement_timestamp()-interval '1 day',
        statement_timestamp()-interval '1 minute','passed',
        statement_timestamp()+interval '1 year'
      );
      insert into sellerpilot_private.channel_operation_attempts values(
        '${sourceAttemptId}','${ownerId}','${credentialId}','qoo10',
        'listing.update','manual_required','1217336970','${"b".repeat(64)}',
        true,false,409,'manual required'
      );
      insert into sellerpilot_private.product_listings values(
        '${listingId}','${ownerId}','${productId}','qoo10','JP','',
        '${sourceAttemptId}','failed','external_action','unknown',null,
        '1217336970','live','JPY',1871,null,null,'${sellerAccount}',
        'QA-20260823-CC-001','{}'::jsonb,'uncertain',statement_timestamp()
      );
      insert into sellerpilot_private.channel_gateway_jobs(
        id,attempt_id,listing_id,credential_id,created_by,channel,operation,
        environment,status,seller_account_key,attempt_count,
        provider_mutation_started_at,completed_at,request_payload,
        response_payload,request_fingerprint,error_message,created_at,updated_at
      ) values(
        '${sourceJobId}','${sourceAttemptId}','${listingId}','${credentialId}',
        '${creatorId}','qoo10','listing.update','production',
        'reconciliation_required','${sellerAccount}',1,
        statement_timestamp()-interval '30 minutes',
        statement_timestamp()-interval '20 minutes',
        jsonb_build_object(
          'arguments',repeat('x',23555-octet_length(
            jsonb_build_object('arguments','')::text
          ))
        ),
        jsonb_build_object(
          'pad',repeat('y',16669-octet_length(
            jsonb_build_object('pad','')::text
          ))
        ),
        '${"b".repeat(64)}','uncertain',
        statement_timestamp()-interval '40 minutes',statement_timestamp()
      );
    `);
    const byteLengths = await db.query(`
      select octet_length(request_payload::text) request_bytes,
             octet_length(response_payload::text) response_bytes
        from sellerpilot_private.channel_gateway_jobs
       where id='${sourceJobId}'
    `);
    assert.equal(byteLengths.rows[0].request_bytes, 23555);
    assert.equal(byteLengths.rows[0].response_bytes, 16669);
    const beforeCounts = await db.query(`
      select
        (select count(*)::integer from sellerpilot_private.channel_gateway_jobs)
          job_count,
        (select count(*)::integer
           from sellerpilot_private.channel_operation_attempts) attempt_count
    `);

    const first = await db.query(
      "select public.sellerpilot_service_adopt_exact_qoo10_already_live($1,$2,$3::jsonb) value",
      [sourceJobId, release, JSON.stringify(observation)],
    );
    assert.equal(first.rows[0].value.contract, "qoo10_already_live_adoption_v1");
    assert.equal(first.rows[0].value.externalWriteCount, 0);
    assert.equal(first.rows[0].value.providerCallReplayed, false);
    assert.equal(first.rows[0].value.reused, false);

    const projection = await db.query(`
      select status,remote_visibility,provider_status,failure_class,last_error,
             remote_resources#>>'{verification,contract}' contract,
             remote_resources#>>'{verification,knownLocalizationIssues,romanizedTitlePresent}' romanized,
             remote_resources#>>'{verification,knownLocalizationIssues,krwPricePresent}' krw
        from sellerpilot_private.product_listings
       where id='${listingId}'
    `);
    assert.deepEqual(projection.rows[0], {
      status: "published",
      remote_visibility: "live",
      provider_status: "S2",
      failure_class: null,
      last_error: null,
      contract: "qoo10_seller_center_already_live_readback_v1",
      romanized: "true",
      krw: "true",
    });
    const retired = await db.query(`
      select
        (select status from sellerpilot_private.channel_gateway_jobs
          where id='${sourceJobId}') job_status,
        (select status from sellerpilot_private.channel_operation_attempts
          where id='${sourceAttemptId}') attempt_status,
        (select count(*)::integer
           from sellerpilot_private.qoo10_exact_already_live_adoptions)
          receipt_count,
        (select count(*)::integer from sellerpilot_private.operation_audit)
          audit_count,
        (select count(*)::integer from sellerpilot_private.channel_gateway_jobs)
          job_count,
        (select count(*)::integer
           from sellerpilot_private.channel_operation_attempts) attempt_count
    `);
    assert.deepEqual(retired.rows[0], {
      job_status: "failed",
      attempt_status: "failed",
      receipt_count: 1,
      audit_count: 1,
      job_count: beforeCounts.rows[0].job_count,
      attempt_count: beforeCounts.rows[0].attempt_count,
    });

    const second = await db.query(
      "select public.sellerpilot_service_adopt_exact_qoo10_already_live($1,$2,$3::jsonb) value",
      [sourceJobId, release, JSON.stringify(observation)],
    );
    assert.equal(second.rows[0].value.reused, true);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_adopt_exact_qoo10_already_live($1,$2,$3::jsonb)",
        [sourceJobId, release, JSON.stringify({ ...observation, priceJpy: 1872 })],
      ),
      /already-live adoption identity invalid/u,
    );
  } finally {
    await db.close();
  }
});

test("already-live migration stays forward of the deployed adoption chain", async () => {
  const migrationNames = (await readdir(new URL(
    "../supabase/migrations/",
    import.meta.url,
  ))).filter((name) => name.endsWith(".sql")).sort();
  const expectedOrder = [
    "20260901171500_adopt_exact_shopee_sg_existing_item.sql",
    "20260901173000_adopt_exact_lazada_live_listing.sql",
    "20260901173100_merge_shopee_lazada_exact_adoption_completion.sql",
    "20260901173200_exact_temu_existing_active_adoption.sql",
    "20260901173300_certify_exact_temu_existing_adoption_credential.sql",
    "20260901173400_adopt_exact_qoo10_already_live_readback.sql",
  ];
  assert.deepEqual(
    expectedOrder.map((name) => migrationNames.indexOf(name)),
    [...expectedOrder].map((_, index) => (
      migrationNames.indexOf(expectedOrder[0]) + index
    )),
  );
});

test("current failed/unknown route remains blocked until the adoption RPC succeeds", async () => {
  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const unresolved = route.indexOf(
    'mode: "qoo10_exact_partial_manual_reconciliation_required"',
  );
  const permit = route.indexOf(
    '"sellerpilot_service_arm_exact_qoo10_localization_update"',
  );
  const claim = route.indexOf(
    'userClient.rpc("sellerpilot_claim_channel_operation"',
  );
  assert.ok(unresolved >= 0);
  assert.ok(permit > unresolved);
  assert.ok(claim > permit);
  assert.match(
    route,
    /판매자센터 readback과 부분 반영 reconciliation을 완료하기 전에는 같은 상품 수정을 다시 전송하지 않습니다/u,
  );
});
