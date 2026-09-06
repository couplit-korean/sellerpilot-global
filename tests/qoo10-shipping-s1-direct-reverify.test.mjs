import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const historyUrl = new URL(
  "../supabase/migrations/20260905003000_recover_exact_qoo10_shipping_normalization_s1.sql",
  import.meta.url,
);
const followUpUrl = new URL(
  "../supabase/migrations/20260905014200_record_qoo10_shipping_s1_direct_reverify.sql",
  import.meta.url,
);

const VERIFIER_JOB_ID = "457b4481-0a66-4a76-89a0-884087d0c22e";
const CREATE_JOB_ID = "687852dc-36de-4049-b170-bdf7839ccf2f";
const UPDATE_JOB_ID = "089467c1-cadb-4d31-93a8-d5882c46d753";
const CREATE_KEYWORD = "ロッテ,ロッテサンド,韓国お菓子,ミルク味,ビスケット";
const REMOTE_KEYWORD = "ビスケット,ミルク味,韓国お菓子";
const CREATE_PROMOTION = "ミルク味サンドビスケット";
const UPDATE_TITLE = "洋菓子の販売者確認済み商品";
const FINGERPRINT = "ab".repeat(32);
const DETAIL_HTML = Array.from({ length: 8 }, (_, index) => (
  `<img src="https://img.example.test/${index + 1}.jpg">`
)).join("");

function functionDefinition(sql, signature) {
  const start = sql.indexOf(`create function ${signature}`);
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${signature}`);
  return sql.slice(start, end + 4);
}

function retainedItem(overrides = {}) {
  return {
    ItemCode: "1217536689",
    ItemStatus: "S1",
    ShippingNo: "806971",
    ItemTitle: UPDATE_TITLE,
    Keyword: REMOTE_KEYWORD,
    PromotionName: CREATE_PROMOTION,
    AdultYN: "N",
    ProductionPlaceType: "2",
    ProductionPlace: "CN",
    IndustrialCode: "",
    SellerCode: "QA-20260823-CC-001",
    SecondSubCatCd: "320000542",
    RetailPrice: "1871",
    ItemPrice: "1871",
    ItemQty: "1",
    ImageUrl: "https://gd.image-qoo10.jp/li/963/402/8461402963.jpg",
    ItemDetail: DETAIL_HTML,
    ...overrides,
  };
}

function createArguments() {
  return {
    params: {
      Keyword: CREATE_KEYWORD,
      PromotionName: CREATE_PROMOTION,
    },
  };
}

function updateArguments() {
  return {
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: 8,
    sellerpilotQoo10RollbackUpdateRecovery: {
      expectedState: {
        categoryCode: "320000542",
        retailPriceJpy: 1871,
        sellPriceJpy: 1871,
        quantity: 1,
        shippingNo: "0",
        biContentsNo: 8461402963,
      },
    },
    params: {
      ShippingNo: "0",
      ItemTitle: UPDATE_TITLE,
      AdultYN: "N",
      ProductionPlaceType: "2",
      ProductionPlace: "CN",
      IndustrialCode: "",
      SellerCode: "QA-20260823-CC-001",
      ItemDescription: DETAIL_HTML,
    },
  };
}

test("direct reverify SQL does not rewrite 03000, source jobs, or the verifier row", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const history = await readFile(historyUrl, "utf8");
  assert.match(followUp, /20260905003000/);
  assert.match(followUp, /Do not rewrite that applied history/);
  assert.match(followUp, /Do not trust the stale verifier response/);
  assert.match(
    followUp,
    /create function public.sellerpilot_service_record_qoo10_shipping_s1_direct_reverify/,
  );
  assert.match(followUp, /qoo10_shipping_s1_direct_reverify_expectation_valid/);
  assert.match(followUp, /qoo10_exact_aliases_consistent/);
  assert.match(followUp, /qoo10_exact_representative_image_matches/);
  assert.match(followUp, /qoo10_canonical_provider_detail_html/);
  assert.match(followUp, /qoo10_exact_detail_image_urls/);
  assert.match(followUp, /interval '2 minutes'/);
  assert.doesNotMatch(followUp, /v_job\.response_payload/);
  assert.doesNotMatch(
    followUp,
    /(?:^|\n)\s*update sellerpilot_private\.channel_gateway_jobs/i,
  );
  assert.doesNotMatch(
    followUp,
    /update sellerpilot_private.qoo10_shipping_s1_verifier_runs/i,
  );
  assert.doesNotMatch(followUp, /enqueue_qoo10_shipping_s1_verifier/);
  assert.doesNotMatch(followUp, /open_channel_gate/);
  assert.doesNotMatch(followUp, /interval '3 minutes'/);
  assert.doesNotMatch(history, /20260905014200/);
  assert.ok(followUp.includes(VERIFIER_JOB_ID));
  assert.ok(followUp.includes(CREATE_JOB_ID));
  assert.ok(followUp.includes(UPDATE_JOB_ID));
});

test("SQL matcher requires publication-critical GET fields and fails a tampered category", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create function sellerpilot_private.qoo10_exact_aliases_consistent(
        p_item jsonb, p_aliases text[]
      ) returns boolean language sql immutable strict as $$
        select coalesce(
          bool_and(jsonb_typeof(field.value) in ('string','number'))
            and count(distinct field.value#>>'{}') <= 1,
          true
        )
          from jsonb_each(p_item) field
         where lower(field.key) = any (
           select lower(alias) from unnest(p_aliases) alias
         )
      $$;
      create function sellerpilot_private.qoo10_exact_representative_image_matches(
        p_value text, p_content_id text
      ) returns boolean language sql immutable strict as $$
        select p_content_id ~ '^[1-9][0-9]{5,19}$'
          and p_value ~ (
            '^https://gd[.]image-qoo10[.]jp/li/'
            || pg_catalog.right(p_content_id,3) || '/'
            || pg_catalog.substr(
                 p_content_id, pg_catalog.length(p_content_id) - 5, 3
               ) || '/'
            || p_content_id
            || '(?:[.]g(?:_[a-z0-9-]+)*)?[.]jpg$'
          )
      $$;
      create function sellerpilot_private.qoo10_canonical_provider_detail_html(
        p_source text
      ) returns text language sql immutable strict as $$
        select pg_catalog.regexp_replace(
          p_source, '<(/?)h[1-6]([[:space:]/>])', E'<\\1p\\2', 'gi'
        )
      $$;
      create function sellerpilot_private.qoo10_exact_detail_image_urls(
        p_html text
      ) returns jsonb language sql immutable strict as $$
        select coalesce(jsonb_agg(to_jsonb(pg_catalog.btrim(found[1])) order by ord), '[]'::jsonb)
          from pg_catalog.regexp_matches(p_html, 'src="([^"]+)"', 'g')
               with ordinality as x(found, ord)
      $$;
    `);
    await db.exec(functionDefinition(
      followUp,
      "sellerpilot_private.qoo10_shipping_s1_create_keyword_contains_remote",
    ));
    await db.exec(functionDefinition(
      followUp,
      "sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches",
    ));

    const item = retainedItem();
    const createArgs = createArguments();
    const updateArgs = updateArguments();
    const retained = await db.query(
      `select sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches(
         '${JSON.stringify(item)}'::jsonb,
         '${JSON.stringify(createArgs)}'::jsonb,
         '${JSON.stringify(updateArgs)}'::jsonb
       ) as ok`,
    );
    assert.equal(retained.rows[0].ok, true);
    assert.equal(Object.hasOwn(item, "BIContentsNo"), false);

    const tamperedImage = retainedItem({
      ImageUrl: "https://gd.image-qoo10.jp/li/963/402/8461402964.jpg",
    });
    const imageFail = await db.query(
      `select sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches(
         '${JSON.stringify(tamperedImage)}'::jsonb,
         '${JSON.stringify(createArgs)}'::jsonb,
         '${JSON.stringify(updateArgs)}'::jsonb
       ) as ok`,
    );
    assert.equal(imageFail.rows[0].ok, false);

    const tamperedCategory = retainedItem({ SecondSubCatCd: "320000000" });
    const categoryFail = await db.query(
      `select sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches(
         '${JSON.stringify(tamperedCategory)}'::jsonb,
         '${JSON.stringify(createArgs)}'::jsonb,
         '${JSON.stringify(updateArgs)}'::jsonb
       ) as ok`,
    );
    assert.equal(categoryFail.rows[0].ok, false);

    const genericItem = retainedItem({
      Keyword: "洋菓子の販売者確認済み商品,購入前確認",
      PromotionName: "洋菓子の出品情報です。購入前に内容をご確",
    });
    const genericUpdate = await db.query(
      `select sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches(
         '${JSON.stringify(genericItem)}'::jsonb,
         '${JSON.stringify(createArgs)}'::jsonb,
         '${JSON.stringify(updateArgs)}'::jsonb
       ) as ok`,
    );
    assert.equal(genericUpdate.rows[0].ok, false);
  } finally {
    await db.close();
  }
});
