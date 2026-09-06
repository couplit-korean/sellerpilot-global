import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const baseUrl = new URL(
  "../supabase/migrations/20260905003000_recover_exact_qoo10_shipping_normalization_s1.sql",
  import.meta.url,
);
const followUpUrl = new URL(
  "../supabase/migrations/20260905003100_accept_qoo10_shipping_s1_failed_ok_readback.sql",
  import.meta.url,
);

const REMOTE_ID = "1217536689";

function functionDefinition(sql, signature) {
  const start = sql.indexOf(`create function ${signature}`);
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${signature}`);
  return sql.slice(start, end + 4);
}

function replaceDefinition(sql, signature) {
  const start = sql.indexOf(`create or replace function ${signature}`);
  assert.notEqual(start, -1, `missing replace ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated replace ${signature}`);
  return sql.slice(start, end + 4);
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

test("follow-up SQL replaces named_remote_item without rewriting 03000 history", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const base = await readFile(baseUrl, "utf8");
  assert.match(followUp, /20260905003000/);
  assert.match(followUp, /Do not rewrite that applied history/);
  assert.match(followUp, /create or replace function sellerpilot_private.qoo10_shipping_s1_named_remote_item/);
  assert.doesNotMatch(followUp, /v_step->>'ok' is distinct from 'true'/);
  assert.match(followUp, /ResultCode/);
  assert.doesNotMatch(base, /20260905003100/);
});

test("extractor accepts live ok=false ResultCode 0 array readbacks with 806971", async () => {
  const base = await readFile(baseUrl, "utf8");
  const followUp = await readFile(followUpUrl, "utf8");
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
      await db.exec(functionDefinition(base, name));
    }
    await db.exec(replaceDefinition(
      followUp,
      "sellerpilot_private.qoo10_shipping_s1_named_remote_item",
    ));

    const itemS2 = { ItemCode: REMOTE_ID, ItemStatus: "S2", ShippingNo: "806971" };
    const itemS1 = { ItemCode: REMOTE_ID, ItemStatus: "S1", ShippingNo: "806971" };
    const createRequest = { arguments: { params: { ShippingNo: "0", ItemCode: REMOTE_ID } } };
    const updateRequest = {
      arguments: {
        params: { ShippingNo: "0", ItemCode: REMOTE_ID },
        sellerpilotQoo10RollbackUpdateRecovery: { expectedState: { shippingNo: "0" } },
      },
    };
    const createResponse = {
      steps: [
        { name: "SetNewGoods", ok: true, status: 200, data: { ResultCode: 0, ResultObject: { GdNo: REMOTE_ID } } },
        { name: "EditGoodsContents", ok: true, status: 200, data: { ResultCode: 0 } },
        {
          name: "GetItemDetailInfo-publication-readback",
          ok: false,
          status: 200,
          data: {
            ResultCode: 0,
            ResultObject: [itemS2],
            sellerpilotPublicationChecks: baseChecks,
            providerStatus: "S2",
          },
        },
      ],
    };
    const updateResponse = {
      steps: [
        { name: "UpdateGoods", ok: true, status: 200, data: { ResultCode: 0 } },
        { name: "EditGoodsContents", ok: true, status: 200, data: { ResultCode: 0 } },
        {
          name: "qoo10-rollback-pre-activation-readback",
          ok: false,
          status: 200,
          data: {
            ResultCode: 0,
            ResultObject: [itemS1],
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
    assert.equal(extracted.rows[0].value.observedShippingNo, "806971");
    assert.equal(extracted.rows[0].value.createObservedShippingNo, "806971");
    assert.equal(extracted.rows[0].value.updateObservedShippingNo, "806971");

    const badCode = structuredClone(updateResponse);
    badCode.steps[2].data.ResultCode = "1";
    assert.equal(
      (await db.query(
        `select sellerpilot_private.qoo10_shipping_s1_source_observation_extract(
           $1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value`,
        [
          JSON.stringify(createRequest),
          JSON.stringify(createResponse),
          JSON.stringify(updateRequest),
          JSON.stringify(badCode),
        ],
      )).rows[0].value,
      null,
      "ResultCode 0 is still required on the named GET",
    );
  } finally {
    await db.close();
  }
});
