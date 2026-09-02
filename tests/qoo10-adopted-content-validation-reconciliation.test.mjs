import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260902090000_reconcile_qoo10_adopted_content_validation.sql",
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

function extractStatement(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const end = source.indexOf(";", start);
  assert.notEqual(end, -1);
  return source.slice(start, end + 1);
}

test("forward reconciliation is exact, evidence-only, and creates no provider job", async () => {
  const source = await readFile(migrationUrl, "utf8");
  for (const value of [
    "089c2075-9a60-4c4e-9b02-d1c39474b618",
    "2f481a12-23c2-48cd-aea7-6e5f72dac1c7",
    "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
    "ddccde35-9c58-4856-b673-d7aa27ce4220",
    "2b49d081-5188-4a75-9555-e0a6438e8a2b",
    "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    "4402cc76-295b-4e17-8c07-d5d0e9967ce9",
    "334631fe-0095-4ea8-a20a-16971f6ca71a",
    "9a830c5a9ce9157a7fa976d949aca11e16026c6b65c2eec263a3041d24c2ead6",
    "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62",
    "qoo10_adopted_content_validation_reconciliations",
    "qoo10_adopted_content_validation_restore_allowed",
    "sellerpilot.qoo10_adopted_content_validation_restore",
  ]) assert.ok(source.includes(value), value);

  assert.match(source, /attempt\.http_status = 422[\s\S]*attempt\.remote_id is null[\s\S]*attempt\.gateway_write_required[\s\S]*attempt\.pre_gateway_retryable/u);
  assert.match(source, /permit\.update_job_id is null[\s\S]*permit\.update_attempt_id is null[\s\S]*permit\.bound_at is null[\s\S]*permit\.consumed_at is null/u);
  assert.match(source, /not exists \([\s\S]*channel_gateway_jobs job[\s\S]*job\.attempt_id = v_attempt_id/u);
  assert.match(source, /not exists \([\s\S]*marketplace_normalized_asset_refs ref[\s\S]*ref\.attempt_id = v_attempt_id/u);
  assert.match(source, /set operation_attempt_id = v_source_attempt_id,[\s\S]*status = 'published',[\s\S]*failure_class = null,[\s\S]*last_error = null/u);
  assert.match(source, /enable row level security;[\s\S]*revoke all on table[\s\S]*from public, anon, authenticated, service_role;/u);
  assert.match(source, /create trigger block_qoo10_adopted_content_validation_reconciliation_change[\s\S]*before update or delete[\s\S]*block_qoo10_adopted_content_validation_reconciliation_change\(\)/u);
  assert.doesNotMatch(source, /insert into sellerpilot_private\.channel_gateway_jobs/iu);
  assert.doesNotMatch(source, /insert into sellerpilot_private\.channel_operation_attempts/iu);
  assert.doesNotMatch(source, /fetch\s*\(|qapi|sendcommand|EditGoodsContents|UpdateGoods|EditGoodsStatus/iu);
});

test("listing restore helper accepts only the proved 422 no-write transition", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const attemptId = "089c2075-9a60-4c4e-9b02-d1c39474b618";
  const permitId = "2f481a12-23c2-48cd-aea7-6e5f72dac1c7";
  const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
  const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
  const credentialId = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
  const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
  const sourceJobId = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
  const sourceAttemptId = "4402cc76-295b-4e17-8c07-d5d0e9967ce9";
  const aiJobId = "334631fe-0095-4ea8-a20a-16971f6ca71a";
  const fingerprint = "9a830c5a9ce9157a7fa976d949aca11e16026c6b65c2eec263a3041d24c2ead6";
  const observation = "bf50afc32b165c4e69675eeaad4870fd6c82305aaddb4010efc9bd36629690b6";
  const manifest = "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62";
  const snapshot = "13f0c61d2cfceda134fe5dd1cc0d5c97da14b05616c177a69e394dbeaef1b3fc";
  const sellerAccount = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
  const failureMessage = "채널용 상세페이지 전용 이미지 8장이 모두 생성·검증되지 않아 실제 채널 등록을 차단했습니다. AI 상세 제작을 다시 실행해 주세요.";
  const observedAt = "2026-09-01T13:19:14Z";
  const reconciledAt = "2026-09-02T00:10:00Z";
  try {
    await db.exec("create schema sellerpilot_private");
    await db.exec(`
      create table sellerpilot_private.qoo10_adopted_content_validation_reconciliations(
        attempt_id uuid, permit_id uuid, listing_id uuid, product_id uuid,
        credential_id uuid, owner_id uuid, source_job_id uuid,
        source_attempt_id uuid, ai_job_id uuid, remote_id text,
        release_sha text, request_fingerprint text,
        approved_manifest_digest text, observation_sha256 text,
        prewrite_snapshot_sha256 text, http_status integer,
        gateway_job_count integer, normalized_asset_ref_count integer,
        provider_mutation_started boolean, provider_call_replayed boolean,
        reconciled_at timestamptz
      );
      create table sellerpilot_private.channel_operation_attempts(
        id uuid, owner_id uuid, credential_id uuid, channel text,
        operation text, status text, http_status integer, remote_id text,
        safe_message text, gateway_write_required boolean,
        pre_gateway_retryable boolean, request_fingerprint text
      );
      create table sellerpilot_private.qoo10_exact_localization_update_permits(
        permit_id uuid, listing_id uuid, product_id uuid, credential_id uuid,
        owner_id uuid, remote_id text, release_sha text,
        request_fingerprint text, prewrite_snapshot_sha256 text,
        update_job_id uuid, update_attempt_id uuid, bound_at timestamptz,
        consumed_at timestamptz, invalidated_at timestamptz,
        invalidation_reason text
      );
      create table sellerpilot_private.qoo10_exact_already_live_adoptions(
        source_job_id uuid, source_attempt_id uuid, listing_id uuid,
        product_id uuid, credential_id uuid, owner_id uuid, remote_id text,
        observation_sha256 text, provider_status text,
        remote_visibility text, purchase_available boolean,
        provider_call_replayed boolean, external_write_count integer,
        observed_at timestamptz
      );
      create table sellerpilot_private.products(
        id uuid, owner_id uuid, ai_job_id uuid, sku text, on_hand integer,
        demo boolean, status text, detail_page_version integer,
        detail_page_approved_version integer, detail_page_image_manifest jsonb
      );
      create table sellerpilot_private.channel_credentials(
        id uuid, created_by uuid, channel text, environment text,
        status text, seller_account_key text
      );
      create table sellerpilot_private.channel_gateway_jobs(
        id uuid, attempt_id uuid, listing_id uuid, operation text, status text
      );
      create table sellerpilot_private.marketplace_normalized_asset_refs(
        attempt_id uuid
      );
    `);
    await db.exec(extractFunction(
      source,
      "create function\n  sellerpilot_private.block_qoo10_adopted_content_validation_reconciliation_change()",
    ));
    await db.exec(extractStatement(
      source,
      "create trigger block_qoo10_adopted_content_validation_reconciliation_change",
    ));
    await db.exec(extractFunction(
      source,
      "create function\n  sellerpilot_private.qoo10_adopted_content_validation_restore_allowed(",
    ));
    await db.exec(`
      insert into sellerpilot_private.qoo10_adopted_content_validation_reconciliations
      values(
        '${attemptId}','${permitId}','${listingId}','${productId}',
        '${credentialId}','${ownerId}','${sourceJobId}','${sourceAttemptId}',
        '${aiJobId}','1217336970',
        'bb9d4980e18e209d25e988f0e6830e543a554ab1','${fingerprint}',
        '${manifest}','${observation}','${snapshot}',422,0,0,false,false,
        '${reconciledAt}'
      );
      insert into sellerpilot_private.channel_operation_attempts values(
        '${attemptId}','${ownerId}','${credentialId}','qoo10','listing.update',
        'failed',422,null,'${failureMessage}',true,true,'${fingerprint}'
      );
      insert into sellerpilot_private.qoo10_exact_localization_update_permits
      values(
        '${permitId}','${listingId}','${productId}','${credentialId}',
        '${ownerId}','1217336970',
        'bb9d4980e18e209d25e988f0e6830e543a554ab1','${fingerprint}',
        '${snapshot}',null,null,null,null,'${reconciledAt}','expired_before_job'
      );
      insert into sellerpilot_private.qoo10_exact_already_live_adoptions
      values(
        '${sourceJobId}','${sourceAttemptId}','${listingId}','${productId}',
        '${credentialId}','${ownerId}','1217336970','${observation}',
        'S2','live',true,false,0,'${observedAt}'
      );
      insert into sellerpilot_private.products values(
        '${productId}','${ownerId}','${aiJobId}','QA-20260823-CC-001',1,
        false,'active',1,1,
        jsonb_build_object(
          'contract','sellerpilot_detail_image_manifest_v2',
          'digest','${manifest}',
          'images',jsonb_build_array(1,2,3,4,5,6,7,8)
        )
      );
      insert into sellerpilot_private.channel_credentials values(
        '${credentialId}','${ownerId}','qoo10','production','active',
        '${sellerAccount}'
      );
    `);

    const oldListing = {
      id: listingId,
      owner_id: ownerId,
      product_id: productId,
      channel_key: "qoo10",
      market: "JP",
      target_id: "",
      remote_id: "1217336970",
      operation_attempt_id: attemptId,
      status: "failed",
      failure_class: "retryable",
      requested_publication_intent: "live",
      remote_visibility: "live",
      provider_status: "S2",
      currency: "JPY",
      price: 1871,
      seller_account_key: sellerAccount,
      last_error: failureMessage,
      published_at: observedAt,
      last_verified_at: observedAt,
      remote_resources: {
        resources: { itemCode: "1217336970" },
        verification: { evidenceSha256: observation },
      },
      updated_at: "2026-09-01T23:39:15.785137Z",
    };
    const nextListing = {
      ...oldListing,
      operation_attempt_id: sourceAttemptId,
      status: "published",
      failure_class: null,
      last_error: null,
      updated_at: reconciledAt,
    };
    const validate = (oldValue, newValue) => db.query(
      "select sellerpilot_private.qoo10_adopted_content_validation_restore_allowed($1::jsonb,$2::jsonb,$3) value",
      [JSON.stringify(oldValue), JSON.stringify(newValue), attemptId],
    );

    assert.equal((await validate(oldListing, nextListing)).rows[0].value, true);
    assert.equal((await validate(
      { ...oldListing, provider_status: "S1" },
      nextListing,
    )).rows[0].value, false);
    assert.equal((await validate(
      oldListing,
      { ...nextListing, operation_attempt_id: attemptId },
    )).rows[0].value, false);
    await db.exec(`
      insert into sellerpilot_private.channel_gateway_jobs values(
        '00000000-0000-4000-8000-000000000001','${attemptId}',
        '${listingId}','listing.update','failed'
      )
    `);
    assert.equal((await validate(oldListing, nextListing)).rows[0].value, false);

    await assert.rejects(
      db.exec(`
        update sellerpilot_private.qoo10_adopted_content_validation_reconciliations
           set http_status = 500
         where attempt_id = '${attemptId}'
      `),
      /evidence is immutable/u,
    );
    await assert.rejects(
      db.exec(`
        delete from sellerpilot_private.qoo10_adopted_content_validation_reconciliations
         where attempt_id = '${attemptId}'
      `),
      /evidence is immutable/u,
    );
    const immutableRows = await db.query(`
      select http_status
        from sellerpilot_private.qoo10_adopted_content_validation_reconciliations
       where attempt_id = '${attemptId}'
    `);
    assert.deepEqual(immutableRows.rows, [{ http_status: 422 }]);
  } finally {
    await db.close();
  }
});
