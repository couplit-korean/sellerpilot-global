import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const routeUrl = new URL(
  "../app/api/admin/channel-operations/route.ts",
  import.meta.url,
);
const migrationUrl = new URL(
  "../supabase/migrations/20260902100500_reconcile_qoo10_adopted_image_binding_pre_gateway_failure.sql",
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

test("the exact adopted request is content-bound before the server loads its manifest", async () => {
  const route = await readFile(routeUrl, "utf8");
  const staticTuple = route.indexOf("const exactQoo10AdoptedContentUpdateRequest =");
  const contentBound = route.indexOf("const contentBoundListingOperation =");
  const publishContext = route.indexOf('"sellerpilot_get_product_publish_context"');
  const serverContentSource = route.indexOf(
    "? bindQoo10ExactAdoptedCommerceArguments(parsed.data.arguments)",
  );
  const manifestLoad = route.indexOf(
    "const approvedDetail = approvedProductDetailManifestFromPublishContext(publishContext)",
  );
  const manifestBind = route.indexOf(
    "effectiveArguments = bindMarketplaceArgumentsToApprovedDetailManifest(",
  );
  const identityRpc = route.indexOf(
    '"sellerpilot_service_get_qoo10_adopted_localization_identity"',
  );

  assert.ok(staticTuple >= 0 && contentBound > staticTuple);
  assert.ok(publishContext > contentBound);
  assert.ok(serverContentSource > publishContext && manifestLoad > serverContentSource);
  assert.ok(identityRpc > manifestLoad && manifestBind > identityRpc);
  assert.match(
    route.slice(staticTuple, contentBound),
    /channel === "qoo10"[\s\S]*operation === "listing\.update"[\s\S]*productId === qoo10ExactLocalizationRecoveryIdentity\.productId[\s\S]*resourceListingId === qoo10ExactLocalizationRecoveryIdentity\.listingId[\s\S]*credentialId === qoo10ExactLocalizationRecoveryIdentity\.credentialId[\s\S]*market === qoo10ExactLocalizationRecoveryIdentity\.market[\s\S]*targetId === qoo10ExactLocalizationRecoveryIdentity\.targetId/u,
  );
  assert.match(
    route.slice(contentBound, publishContext),
    /\|\| exactQoo10AdoptedContentUpdateRequest/u,
  );
});

test("an exact adopted pre-gateway failure preserves the already-live listing projection", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(
    route,
    /const preserveExactPreGatewayListing = preGatewayRetryable[\s\S]{0,220}boundQoo10RollbackUpdateRecovery[\s\S]{0,160}boundQoo10AdoptedLocalizationIdentity[\s\S]{0,420}if \(!preserveExactPreGatewayListing\) \{[\s\S]{0,120}completeListing/u,
  );
});

test("100500 is an exact provider-zero forward reconciliation", async () => {
  const source = await readFile(migrationUrl, "utf8");
  for (const value of [
    "696ac221-e336-44d9-b09a-7aeb81f9a2bb",
    "95b73b76-e52d-4599-8277-8f6673111c3d",
    "8146717494316e317a35ab414ff19b0f5e6f47ee968d892df9ba967692a0d569",
    "6a2a2c6807d77a92a84be87436b8caf537da578e",
    "MARKETPLACE_DETAIL_IMAGE_REQUIRED",
    "qoo10_adopted_image_binding_reconciliations",
    "qoo10_adopted_image_binding_restore_allowed",
    "sellerpilot.qoo10_adopted_image_binding_restore",
  ]) assert.ok(source.includes(value), value);

  assert.match(source, /attempt\.http_status = 422[\s\S]*attempt\.remote_id is null[\s\S]*attempt\.gateway_write_required[\s\S]*attempt\.pre_gateway_retryable/u);
  assert.match(source, /permit\.update_job_id is null[\s\S]*permit\.update_attempt_id is null[\s\S]*permit\.bound_at is null[\s\S]*permit\.consumed_at is null/u);
  assert.match(source, /not exists \([\s\S]*channel_gateway_jobs job[\s\S]*job\.attempt_id = v_attempt_id/u);
  assert.match(source, /not exists \([\s\S]*marketplace_normalized_asset_refs ref[\s\S]*ref\.attempt_id = v_attempt_id/u);
  assert.match(source, /source\.created_by =\s*'21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid/u);
  assert.match(source, /source\.status = 'failed'/u);
  assert.match(source, /credential\.created_by = source\.created_by/u);
  assert.match(source, /listing\.owner_id = v_owner_id[\s\S]*product\.ai_job_id/u);
  assert.match(source, /attempt\.owner_id = v_owner_id/u);
  assert.match(source, /permit\.owner_id = v_owner_id/u);
  assert.match(source, /receipt\.owner_id = v_owner_id/u);
  assert.match(source, /credential\.seller_account_verified_at is not null[\s\S]*credential\.last_check_status = 'passed'[\s\S]*credential\.expires_at > statement_timestamp\(\)/u);
  assert.match(source, /set operation_attempt_id = v_source_attempt_id,[\s\S]*status = 'published',[\s\S]*failure_class = null,[\s\S]*last_error = null/u);
  assert.match(source, /create trigger block_qoo10_adopted_image_binding_reconciliation_change[\s\S]*before update or delete/u);
  assert.doesNotMatch(source, /insert into sellerpilot_private\.channel_gateway_jobs/iu);
  assert.doesNotMatch(source, /insert into sellerpilot_private\.channel_operation_attempts/iu);
  assert.doesNotMatch(source, /fetch\s*\(|qapi|sendcommand|EditGoodsContents|UpdateGoods|EditGoodsStatus/iu);
});

test("the complete forward migration is a clean no-op on a historical schema prefix", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema sellerpilot_private;
    `);
    await db.exec(source);
    const result = await db.query(`
      select
        pg_catalog.to_regclass(
          'sellerpilot_private.qoo10_adopted_image_binding_reconciliations'
        ) is not null as ledger_exists,
        pg_catalog.to_regprocedure(
          'sellerpilot_private.qoo10_adopted_image_binding_restore_allowed(jsonb,jsonb,text)'
        ) is not null as helper_exists,
        (
          select count(*)::integer
            from sellerpilot_private.qoo10_adopted_image_binding_reconciliations
        ) as evidence_count
    `);
    assert.deepEqual(result.rows, [{
      ledger_exists: true,
      helper_exists: true,
      evidence_count: 0,
    }]);
  } finally {
    await db.close();
  }
});

test("the image-binding restore helper fails closed outside the exact provider-zero tuple", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const attemptId = "696ac221-e336-44d9-b09a-7aeb81f9a2bb";
  const permitId = "95b73b76-e52d-4599-8277-8f6673111c3d";
  const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
  const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
  const credentialId = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
  const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
  const sourceCreator = "21eb1892-0894-4f9f-b414-4c9464182dd6";
  const sourceJobId = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
  const sourceAttemptId = "4402cc76-295b-4e17-8c07-d5d0e9967ce9";
  const aiJobId = "334631fe-0095-4ea8-a20a-16971f6ca71a";
  const fingerprint = "8146717494316e317a35ab414ff19b0f5e6f47ee968d892df9ba967692a0d569";
  const manifest = "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62";
  const observation = "bf50afc32b165c4e69675eeaad4870fd6c82305aaddb4010efc9bd36629690b6";
  const snapshot = "13f0c61d2cfceda134fe5dd1cc0d5c97da14b05616c177a69e394dbeaef1b3fc";
  const sellerAccount = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
  const failureMessage = "채널용 상세페이지 전용 이미지 8장이 모두 생성·검증되지 않아 실제 채널 등록을 차단했습니다. AI 상세 제작을 다시 실행해 주세요.";
  const observedAt = "2026-09-01T13:19:14Z";
  const reconciledAt = "2026-09-02T01:30:00Z";
  try {
    await db.exec("create schema sellerpilot_private");
    await db.exec(`
      create table sellerpilot_private.qoo10_adopted_image_binding_reconciliations(
        attempt_id uuid,permit_id uuid,listing_id uuid,product_id uuid,
        credential_id uuid,owner_id uuid,source_job_id uuid,
        source_attempt_id uuid,ai_job_id uuid,remote_id text,release_sha text,
        request_fingerprint text,approved_manifest_digest text,
        observation_sha256 text,prewrite_snapshot_sha256 text,
        failure_code text,http_status integer,gateway_job_count integer,
        normalized_asset_ref_count integer,provider_mutation_started boolean,
        provider_call_replayed boolean,reconciled_at timestamptz
      );
      create table sellerpilot_private.channel_operation_attempts(
        id uuid,owner_id uuid,credential_id uuid,channel text,operation text,
        status text,http_status integer,remote_id text,safe_message text,
        gateway_write_required boolean,pre_gateway_retryable boolean,
        request_fingerprint text
      );
      create table sellerpilot_private.qoo10_exact_localization_update_permits(
        permit_id uuid,listing_id uuid,product_id uuid,credential_id uuid,
        owner_id uuid,remote_id text,release_sha text,request_fingerprint text,
        prewrite_snapshot_sha256 text,lineage_contract text,
        adoption_source_job_id uuid,adoption_observation_sha256 text,
        update_job_id uuid,update_attempt_id uuid,bound_at timestamptz,
        consumed_at timestamptz,invalidated_at timestamptz,
        invalidation_reason text
      );
      create table sellerpilot_private.qoo10_exact_already_live_adoptions(
        source_job_id uuid,source_attempt_id uuid,listing_id uuid,
        product_id uuid,credential_id uuid,owner_id uuid,remote_id text,
        observation_sha256 text,provider_status text,remote_visibility text,
        purchase_available boolean,provider_call_replayed boolean,
        external_write_count integer,observed_at timestamptz
      );
      create table sellerpilot_private.products(
        id uuid,owner_id uuid,ai_job_id uuid,sku text,on_hand integer,
        demo boolean,status text,detail_page_version integer,
        detail_page_approved_version integer,detail_page_image_manifest jsonb
      );
      create table sellerpilot_private.channel_credentials(
        id uuid,created_by uuid,channel text,environment text,status text,
        seller_account_key text,seller_account_key_source text,
        seller_account_verified_at timestamptz,last_checked_at timestamptz,
        last_check_status text,expires_at timestamptz
      );
      create table sellerpilot_private.channel_gateway_jobs(
        id uuid,attempt_id uuid,listing_id uuid,credential_id uuid,
        created_by uuid,channel text,operation text,status text,
        seller_account_key text
      );
      create table sellerpilot_private.marketplace_normalized_asset_refs(
        attempt_id uuid
      );
    `);
    await db.exec(extractFunction(
      source,
      "create function\n  sellerpilot_private.block_qoo10_adopted_image_binding_reconciliation_change()",
    ));
    await db.exec(extractStatement(
      source,
      "create trigger block_qoo10_adopted_image_binding_reconciliation_change",
    ));
    await db.exec(extractFunction(
      source,
      "create function\n  sellerpilot_private.qoo10_adopted_image_binding_restore_allowed(",
    ));
    await db.exec(`
      insert into sellerpilot_private.qoo10_adopted_image_binding_reconciliations
      values(
        '${attemptId}','${permitId}','${listingId}','${productId}',
        '${credentialId}','${ownerId}','${sourceJobId}','${sourceAttemptId}',
        '${aiJobId}','1217336970',
        '6a2a2c6807d77a92a84be87436b8caf537da578e','${fingerprint}',
        '${manifest}','${observation}','${snapshot}',
        'MARKETPLACE_DETAIL_IMAGE_REQUIRED',422,0,0,false,false,
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
        '6a2a2c6807d77a92a84be87436b8caf537da578e','${fingerprint}',
        '${snapshot}','qoo10_exact_already_live_adoption_v1','${sourceJobId}',
        '${observation}',null,null,null,null,'${reconciledAt}',
        'expired_before_job'
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
          'algorithm','sha256','digest','${manifest}',
          'images',jsonb_build_array(1,2,3,4,5,6,7,8)
        )
      );
      insert into sellerpilot_private.channel_credentials values(
        '${credentialId}','${sourceCreator}','qoo10','production','active',
        '${sellerAccount}','credential_incarnation_v1',
        '2026-08-25T11:40:32Z','2026-08-20T08:36:14Z','passed',
        '2027-08-20T14:59:59Z'
      );
      insert into sellerpilot_private.channel_gateway_jobs values(
        '${sourceJobId}','${sourceAttemptId}','${listingId}','${credentialId}',
        '${sourceCreator}','qoo10','listing.update','failed','${sellerAccount}'
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
      updated_at: "2026-09-02T01:20:00Z",
    };
    const nextListing = {
      ...oldListing,
      operation_attempt_id: sourceAttemptId,
      status: "published",
      failure_class: null,
      last_error: null,
      updated_at: reconciledAt,
    };
    const validate = () => db.query(
      "select sellerpilot_private.qoo10_adopted_image_binding_restore_allowed($1::jsonb,$2::jsonb,$3) value",
      [JSON.stringify(oldListing), JSON.stringify(nextListing), attemptId],
    );

    assert.equal((await validate()).rows[0].value, true);
    await db.exec(`update sellerpilot_private.channel_gateway_jobs set status='queued' where id='${sourceJobId}'`);
    assert.equal((await validate()).rows[0].value, false);
    await db.exec(`update sellerpilot_private.channel_gateway_jobs set status='failed' where id='${sourceJobId}'`);
    await db.exec(`update sellerpilot_private.channel_credentials set expires_at='2020-01-01Z' where id='${credentialId}'`);
    assert.equal((await validate()).rows[0].value, false);
    await db.exec(`update sellerpilot_private.channel_credentials set expires_at='2027-08-20T14:59:59Z' where id='${credentialId}'`);
    await db.exec(`update sellerpilot_private.products set owner_id='00000000-0000-4000-8000-000000000002' where id='${productId}'`);
    assert.equal((await validate()).rows[0].value, false);
    await db.exec(`update sellerpilot_private.products set owner_id='${ownerId}' where id='${productId}'`);
    await db.exec(`update sellerpilot_private.channel_gateway_jobs set created_by='00000000-0000-4000-8000-000000000003' where id='${sourceJobId}'`);
    assert.equal((await validate()).rows[0].value, false);
    await db.exec(`update sellerpilot_private.channel_gateway_jobs set created_by='${sourceCreator}' where id='${sourceJobId}'`);
    await db.exec(`
      insert into sellerpilot_private.channel_gateway_jobs values(
        '00000000-0000-4000-8000-000000000001','${attemptId}',
        '${listingId}','${credentialId}','${sourceCreator}','qoo10',
        'listing.update','failed','${sellerAccount}'
      )
    `);
    assert.equal((await validate()).rows[0].value, false);
    await assert.rejects(
      db.exec(`update sellerpilot_private.qoo10_adopted_image_binding_reconciliations set http_status=500 where attempt_id='${attemptId}'`),
      /evidence is immutable/u,
    );
  } finally {
    await db.close();
  }
});
