import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260905003000_recover_exact_qoo10_shipping_normalization_s1.sql",
  import.meta.url,
);

const PRODUCT_ID = "1ed4acfc-7603-48ec-a638-241131e59358";
const LISTING_ID = "13858f41-78fd-463f-9390-e8f06e71e538";
const REMOTE_ID = "1217536689";
const CREDENTIAL_ID = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const CREATE_JOB_ID = "687852dc-36de-4049-b170-bdf7839ccf2f";
const UPDATE_JOB_ID = "089467c1-cadb-4d31-93a8-d5882c46d753";
const ATTEMPT_ID = "86054977-b362-4f64-9ecd-24ef18963c6f";
const CREATE_REQ = "afb9623fc3892fc7a387ba46dc3a06c58ed0e7707a634fb5cd6dc50eeb133cec";
const CREATE_RESP = "11c202e9c52146c42094dddf19fae7d494bc66c9c7949ecc0bbc9f528105893a";
const UPDATE_REQ = "e59ea7c11a9e47b1f365e512e2df2c57270395134c94bf9cf0014fb872bc7eb3";
const UPDATE_RESP = "df728f98d58e319bdce5d18e2503a03d78b40cfd923966a0416fb77363fcd6ee";

function functionDefinition(sql, signature) {
  const start = sql.indexOf(`create function ${signature}`);
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${signature}`);
  return sql.slice(start, end + 4);
}

async function migrationSql() {
  return readFile(migrationUrl, "utf8");
}

const baseChecks = {
  identityVerified: true,
  statusVerified: true,
  sellerCodeVerified: true,
  localeVerified: true,
  fingerprintVerified: true,
  imageCountVerified: true,
  sellerAccountIdentityVerified: true,
  categoryVerified: true,
  titleVerified: true,
  priceQuantityVerified: true,
  representativeImageVerified: true,
  detailImageDigestVerified: true,
  shippingVerified: false,
};

const recoveryChecks = {
  ...baseChecks,
  recoveryExpectationVerified: true,
  retailPriceVerified: true,
  sellPriceVerified: true,
  quantityVerified: true,
  confirmedBiCdnImageVerified: true,
  detailImageUrlsVerified: true,
};

test("shipping S1 SQL pins exact IDs, hashes, RPC arg, and standard activation marker", async () => {
  const sql = await migrationSql();
  for (const exact of [
    PRODUCT_ID, LISTING_ID, REMOTE_ID, CREDENTIAL_ID, CREATE_JOB_ID, UPDATE_JOB_ID,
    ATTEMPT_ID, CREATE_REQ, CREATE_RESP, UPDATE_REQ, UPDATE_RESP,
    "Japan · QAPI",
    "p_listing_id uuid",
    "sellerpilot_service_enqueue_qoo10_shipping_s1_verifier",
    "sellerpilotQoo10S1Activation",
    "qoo10_s1_activation_v1",
    "qoo10-exact-s1-recovery-verification",
    "listing_mutation_release_gate_is_effective('qoo10')",
    "remote_visibility = 'unknown'",
    "failed_before_provider",
    "expired_after_claim",
    "guard_qoo10_shipping_s1_activation_claim_bind",
  ]) {
    assert.ok(sql.includes(exact), `missing ${exact}`);
  }

  const verifierFn = sql.slice(
    sql.indexOf("create function public.sellerpilot_service_enqueue_qoo10_shipping_s1_verifier"),
    sql.indexOf("create function sellerpilot_private.qoo10_shipping_s1_activation_expectation_valid"),
  );
  assert.match(verifierFn, /p_listing_id uuid/);
  assert.doesNotMatch(verifierFn, /p_update_job_id/);
  assert.match(verifierFn, /p_listing_id is distinct from '13858f41-78fd-463f-9390-e8f06e71e538'/);
  assert.match(verifierFn, /089467c1-cadb-4d31-93a8-d5882c46d753/);

  const sourceFn = sql.slice(
    sql.indexOf("create function public.sellerpilot_service_listing_publication_verification_source"),
    sql.indexOf("create function sellerpilot_private.qoo10_shipping_s1_activation_listing_update_allowed"),
  );
  assert.match(sourceFn, /'targetId','Japan · QAPI'/);
  assert.doesNotMatch(sourceFn, /createJobId/);
  assert.doesNotMatch(sourceFn, /requestedShippingNo/);
  assert.doesNotMatch(sourceFn, /observedShippingNo/);

  const activateFn = sql.slice(
    sql.indexOf("create function public.sellerpilot_service_enqueue_qoo10_shipping_s1_activation"),
    sql.indexOf("create function sellerpilot_private.qoo10_shipping_s1_verifier_job_matches"),
  );
  assert.match(activateFn, /'\{sellerpilotQoo10S1Activation\}'/);
  assert.match(activateFn, /'contract','qoo10_s1_activation_v1'/);
  assert.match(activateFn, /\{expectedState,shippingNo\}/);
  assert.match(activateFn, /\{params,ShippingNo\}/);
  assert.match(activateFn, /'"806971"'::jsonb/);

  assert.match(
    verifierFn,
    /v_update\.request_payload#>>'\{arguments,publicationExpectedFingerprint\}'/,
  );
  assert.match(
    sourceFn,
    /update_job\.request_payload#>>'\{arguments,publicationExpectedFingerprint\}'/,
  );
  assert.match(sql, /sellerpilot_300950_begin_gateway_mutation_before_release_gate/);
  assert.match(sql, /sellerpilot_11820_claim_gateway_unsafe/);
  assert.match(sql, /qoo10_canonical_provider_detail_html/);
  assert.match(sql, /qoo10-rollback-pre-activation-readback/);
  assert.match(sql, /qoo10_shipping_s1_activation_job_matches/);
  assert.match(
    sql.slice(
      sql.indexOf("create function sellerpilot_private.qoo10_shipping_s1_activation_claim_priority"),
      sql.indexOf("create function sellerpilot_private.qoo10_shipping_s1_activation_claim_expired"),
    ),
    /qoo10_shipping_s1_jobs_are_current\(\)/,
  );
  assert.doesNotMatch(
    sql,
    /create or replace function sellerpilot_private\.qoo10_exact_s1_activation_claim_priority/,
  );
});

test("shipping S1 183000 patch uses compact unique needles and fail-closed hit counts", async () => {
  const sql = await migrationSql();
  const block = sql.slice(
    sql.indexOf("$qoo10_shipping_s1_serverless_claim$"),
    sql.indexOf("$qoo10_shipping_s1_serverless_claim$;"),
  );
  const expireNeedle = "perform public.sellerpilot_service_reap_stale_channel_gateway_jobs(100);";
  const orderNeedle = "when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)";
  const excludeNeedle = "for update of job skip locked";
  assert.match(block, new RegExp(expireNeedle.replace(/[()]/g, "\\$&")));
  assert.match(block, /when sellerpilot_private\.qoo10_exact_s1_activation_claim_priority\(job\.id\)/);
  assert.match(block, /v_expire_hits <> 1 or v_order_hits <> 1 or v_exclude_hits <> 1/);
  assert.doesNotMatch(
    block,
    /v_order_before text := \$body\$ {3}order by\n {5}case/,
  );

  const paddedLive = [
    `${" ".repeat(418)}${expireNeedle}`,
    `${" ".repeat(2530)}case`,
    `${" ".repeat(2537)}${orderNeedle}`,
    `${" ".repeat(2546)}then 0`,
    `${" ".repeat(2664)}${excludeNeedle}`,
  ].join("\n");
  const hits = (haystack, needle) => haystack.split(needle).length - 1;
  assert.equal(hits(paddedLive, expireNeedle), 1);
  assert.equal(hits(paddedLive, orderNeedle), 1);
  assert.equal(hits(paddedLive, excludeNeedle), 1);
  assert.equal(
    hits(paddedLive, [
      "   order by",
      "     case",
      "       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)",
    ].join("\n")),
    0,
    "indented repo order-by needle must not match live pg_get_functiondef padding",
  );
});

test("shipping S1 SQL keeps source jobs immutable and uses fail-closed observation/insert order", async () => {
  const sql = await migrationSql();
  for (const match of sql.matchAll(/\bupdate\s+sellerpilot_private\.channel_gateway_jobs/gi)) {
    const window = sql.slice(match.index, match.index + 900);
    assert.doesNotMatch(window, /687852dc-36de-4049-b170-bdf7839ccf2f/);
    assert.doesNotMatch(window, /089467c1-cadb-4d31-93a8-d5882c46d753/);
  }
  assert.doesNotMatch(sql, /qoo10_listing_create_rollback_confirmations/i);
  assert.doesNotMatch(sql, /20260830222257/);
  assert.doesNotMatch(sql, /20260903150000/);

  const recordFn = sql.slice(
    sql.indexOf("create function sellerpilot_private.record_qoo10_shipping_s1_observation"),
    sql.indexOf("create function public.sellerpilot_service_enqueue_qoo10_shipping_s1_activation"),
  );
  assert.match(recordFn, /qoo10-exact-s1-recovery-verification/);
  assert.doesNotMatch(recordFn, /jsonb_set\(/);
  assert.doesNotMatch(recordFn, /sellerpilotQoo10ShippingS1Expectation/);

  const insertGuard = sql.slice(
    sql.indexOf("$qoo10_shipping_s1_activation_lineage_guard$"),
    sql.indexOf("$qoo10_shipping_s1_activation_lineage_update_guard$"),
  );
  assert.doesNotMatch(insertGuard, /qoo10_shipping_s1_activation_permits permit/);
  assert.match(insertGuard, /sellerpilotQoo10S1Activation,contract/);

  const completeFn = sql.slice(
    sql.indexOf("create function public.sellerpilot_service_complete_gateway_transaction"),
    sql.indexOf("create or replace function sellerpilot_private.qoo10_shipping_s1_source_reconciliation_resolved"),
  );
  assert.match(completeFn, /if not sellerpilot_private.record_qoo10_shipping_s1_observation/);
  assert.match(completeFn, /exact Qoo10 shipping S1 observation was not recorded/);
});

test("shipping S1 SQL uses open-gate bind, consumed one-use, and exact listing preimage", async () => {
  const sql = await migrationSql();
  const releaseFn = sql.slice(
    sql.indexOf("create function sellerpilot_private.qoo10_shipping_s1_release_is_current"),
    sql.indexOf("create function sellerpilot_private.qoo10_shipping_s1_requested_shipping_no"),
  );
  assert.match(releaseFn, /listing_mutation_release_gate_is_effective\('qoo10'\)/);
  assert.doesNotMatch(releaseFn, /qoo10_exact_s1_release_is_current/);
  assert.match(sql, /create trigger guard_qoo10_shipping_s1_activation_claim_bind/);
  assert.match(sql, /qoo10_shipping_s1_one_consumed_listing_permit/);
  assert.match(sql, /invalidation_reason = 'failed_before_provider'/);
  assert.match(sql, /invalidation_reason = 'expired_after_claim'/);
  assert.match(sql, /listing\.remote_visibility = 'unknown'/);
  assert.match(sql, /listing\.provider_status is null/);
  assert.match(sql, /listing\.published_at is null/);
  assert.match(sql, /listing\.last_verified_at is null/);
  assert.match(sql, /86054977-b362-4f64-9ecd-24ef18963c6f/);
});

test("shipping S1 extractor requires named steps, request/confirmation 0, and full checks", async () => {
  const sql = await migrationSql();
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create function sellerpilot_private.qoo10_exact_remote_items(
        p_value jsonb, p_remote_id text
      ) returns setof jsonb language plpgsql immutable as $$
      declare v_child jsonb;
      begin
        if jsonb_typeof(p_value) = 'object' then
          if coalesce(p_value->>'ItemCode', p_value->>'GdNo', '') = p_remote_id then
            return next p_value;
          end if;
          for v_child in select value from jsonb_each(p_value) loop
            return query select * from sellerpilot_private.qoo10_exact_remote_items(v_child, p_remote_id);
          end loop;
        elsif jsonb_typeof(p_value) = 'array' then
          for v_child in select value from jsonb_array_elements(p_value) loop
            return query select * from sellerpilot_private.qoo10_exact_remote_items(v_child, p_remote_id);
          end loop;
        end if;
      end $$;
    `);
    for (const name of [
      "sellerpilot_private.qoo10_shipping_s1_requested_shipping_no",
      "sellerpilot_private.qoo10_shipping_s1_has_activation_step",
      "sellerpilot_private.qoo10_shipping_s1_named_step",
      "sellerpilot_private.qoo10_shipping_s1_step_checks",
      "sellerpilot_private.qoo10_shipping_s1_named_remote_item",
      "sellerpilot_private.qoo10_shipping_s1_readback_item",
      "sellerpilot_private.qoo10_shipping_s1_observed_shipping_no",
      "sellerpilot_private.qoo10_shipping_s1_publication_checks",
      "sellerpilot_private.qoo10_shipping_s1_publication_checks_match",
      "sellerpilot_private.qoo10_shipping_s1_provider_status",
      "sellerpilot_private.qoo10_shipping_s1_single_remote_item",
      "sellerpilot_private.qoo10_shipping_s1_source_observation_extract",
    ]) {
      await db.exec(functionDefinition(sql, name));
    }

    const item = { ItemCode: REMOTE_ID, ItemStatus: "S1", ShippingNo: "806971" };
    const createRequest = { arguments: { params: { ShippingNo: "0", ItemCode: REMOTE_ID } } };
    const updateRequest = {
      arguments: {
        params: { ShippingNo: "0", ItemCode: REMOTE_ID },
        sellerpilotQoo10RollbackUpdateRecovery: { expectedState: { shippingNo: "0" } },
      },
    };
    const createResponse = {
      remoteState: { providerStatus: "S2" },
      steps: [
        { name: "SetNewGoods", ok: true, status: 200, data: { ResultCode: 0, ResultObject: { GdNo: REMOTE_ID } } },
        {
          name: "GetItemDetailInfo",
          ok: true,
          status: 200,
          data: { ResultCode: 0, ResultObject: { ItemCode: REMOTE_ID, ItemStatus: "S2", ShippingNo: "806971" } },
        },
        {
          name: "EditGoodsContents",
          ok: true,
          status: 200,
          data: { ResultCode: 0, ResultObject: item },
        },
      ],
    };
    const updateResponse = {
      remoteState: { providerStatus: "S1" },
      steps: [
        {
          name: "UpdateGoods",
          ok: true,
          status: 200,
          data: {
            ResultCode: 0,
            ResultObject: item,
            sellerpilotPublicationChecks: { shippingVerified: false },
            providerStatus: "S2",
          },
        },
        {
          name: "EditGoodsContents",
          ok: true,
          status: 200,
          data: { ResultCode: 0, ResultObject: item, sellerpilotPublicationChecks: recoveryChecks, providerStatus: "S1" },
        },
        {
          name: "qoo10-rollback-pre-activation-readback",
          ok: true,
          status: 200,
          data: {
            ResultCode: 0,
            ResultObject: item,
            sellerpilotPublicationChecks: recoveryChecks,
            providerStatus: "S1",
          },
        },
      ],
    };

    const extracted = await db.query(
      `select sellerpilot_private.qoo10_shipping_s1_source_observation_extract(
         $1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb
       ) value`,
      [
        JSON.stringify(createRequest),
        JSON.stringify(createResponse),
        JSON.stringify(updateRequest),
        JSON.stringify(updateResponse),
      ],
    );
    assert.equal(extracted.rows[0].value.requestedShippingNo, "0");
    assert.equal(extracted.rows[0].value.confirmationShippingNo, "0");
    assert.equal(extracted.rows[0].value.observedShippingNo, "806971");

    const overlayRequest = structuredClone(updateRequest);
    overlayRequest.arguments.sellerpilotQoo10RollbackUpdateRecovery.expectedState.shippingNo = "806971";
    assert.equal(
      (await db.query(
        `select sellerpilot_private.qoo10_shipping_s1_source_observation_extract(
           $1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value`,
        [
          JSON.stringify(createRequest),
          JSON.stringify(createResponse),
          JSON.stringify(overlayRequest),
          JSON.stringify(updateResponse),
        ],
      )).rows[0].value,
      null,
      "update confirmation shippingNo must stay 0",
    );

    const weakStep = structuredClone(updateResponse);
    weakStep.steps[0].name = "qoo10-updategoods";
    assert.equal(
      (await db.query(
        `select sellerpilot_private.qoo10_shipping_s1_source_observation_extract(
           $1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value`,
        [
          JSON.stringify(createRequest),
          JSON.stringify(createResponse),
          JSON.stringify(updateRequest),
          JSON.stringify(weakStep),
        ],
      )).rows[0].value,
      null,
      "substring step names are not exact UpdateGoods",
    );

    const missingRecovery = structuredClone(updateResponse);
    for (const step of missingRecovery.steps) {
      if (step.data?.sellerpilotPublicationChecks) {
        step.data.sellerpilotPublicationChecks = baseChecks;
      }
    }
    assert.equal(
      (await db.query(
        `select sellerpilot_private.qoo10_shipping_s1_source_observation_extract(
           $1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value`,
        [
          JSON.stringify(createRequest),
          JSON.stringify(createResponse),
          JSON.stringify(updateRequest),
          JSON.stringify(missingRecovery),
        ],
      )).rows[0].value,
      null,
      "update recovery checks are required",
    );

    const createWithoutNamedGet = structuredClone(createResponse);
    createWithoutNamedGet.steps = createWithoutNamedGet.steps.filter(
      (step) => step.name !== "GetItemDetailInfo",
    );
    assert.equal(
      (await db.query(
        `select sellerpilot_private.qoo10_shipping_s1_source_observation_extract(
           $1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value`,
        [
          JSON.stringify(createRequest),
          JSON.stringify(createWithoutNamedGet),
          JSON.stringify(updateRequest),
          JSON.stringify(updateResponse),
        ],
      )).rows[0].value,
      null,
      "create ShippingNo must come from a named GetItemDetailInfo readback",
    );
  } finally {
    await db.close();
  }
});
