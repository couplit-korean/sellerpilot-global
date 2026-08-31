import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831056700_recover_exact_qoo10_s1_activation.sql",
  import.meta.url,
);

function functionDefinition(sql, signature) {
  const start = sql.indexOf(`create function ${signature}`);
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${signature}`);
  return sql.slice(start, end + 4);
}

async function scalar(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return result.rows[0]?.value;
}

const detailImageUrls = Array.from(
  { length: 8 },
  (_, index) => `https://example.invalid/detail-${index + 1}.jpg?slot=${index + 1}&role=detail`,
);

const sourceArguments = {
  publicationExpectedFingerprint: "a".repeat(64),
  params: {
    ItemTitle: "貼り付け式ケーブル整理クリップ6個セット",
    Keyword: "貼り付け式ケーブル整理クリップ6個セット,No Brand,購入前確認",
    ProductionPlaceType: "2",
    ProductionPlace: "CN",
    AdultYN: "N",
    SellerCode: "",
    PromotionName: "",
    IndustrialCode: "",
    ItemDescription: `<section lang="ja">exact detail${detailImageUrls
      .map((url) => `<img src="${url.replaceAll("&", "&amp;")}">`)
      .join("")}</section>`,
  },
  sellerpilotQoo10RollbackUpdateRecovery: {
    expectedState: {
      categoryCode: "320000542",
      retailPriceJpy: "1871",
      sellPriceJpy: "1871",
      quantity: "1",
      shippingNo: "806971",
      biContentsNo: "8461402963",
    },
  },
};

function exactItem(overrides = {}) {
  return {
    ItemCode: "1217336970",
    ItemStatus: "S2",
    ItemTitle: sourceArguments.params.ItemTitle,
    Keyword: "No Brand,購入前確認",
    SecondSubCat: "320000542",
    RetailPrice: "1871.0000",
    ItemPrice: "1871.0000",
    ItemQty: "1",
    ShippingNo: "806971",
    BIContentsNo: "8461402963",
    ImageUrl: "https://gd.image-qoo10.jp/li/963/402/8461402963.jpg",
    ItemDetail: sourceArguments.params.ItemDescription,
    ProductionPlaceType: "2",
    ProductionPlace: "CN",
    AdultYN: "N",
    ...overrides,
  };
}

function exactResponse(item = exactItem(), stepData = {}) {
  const imageDigest = "b".repeat(64);
  return {
    ok: true,
    channel: "qoo10",
    operation: "listing.activate",
    remoteId: "1217336970",
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationFulfilled: true,
    steps: [{
      name: "qoo10-s1-activation-post-readback",
      ok: true,
      status: 200,
      data: { ResultCode: 0, ResultObject: item, ...stepData },
    }],
    remoteState: {
      verified: true,
      visibility: "live",
      providerStatus: "S2",
      locale: "ja-JP",
      fingerprint: "a".repeat(64),
      imageCount: 8,
      evidence: {
        identityVerified: true,
        statusVerified: true,
        localeVerified: true,
        fingerprintVerified: true,
        imageCountVerified: true,
        titleVerified: true,
        descriptionVerified: true,
        languageContentVerified: true,
        detailImageCountVerified: true,
        contentDigestVerified: true,
        representativeImageVerified: true,
        providerBodyDetailImagesVerified: true,
        sourceImageDigest: imageDigest,
        remoteImageDigest: imageDigest,
      },
    },
  };
}

test("Qoo10 exact S1 SQL verifier accepts only observed prefix removal and zero-fraction JPY", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec("create schema sellerpilot_private;");
    await db.exec(`
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm) = 'sha256'
          then sha256(convert_to(value, 'UTF8'))
          else convert_to(md5(value || algorithm), 'UTF8') end
      $$;
    `);
    for (const name of [
      "sellerpilot_private.qoo10_exact_remote_items",
      "sellerpilot_private.qoo10_exact_aliases_consistent",
      "sellerpilot_private.qoo10_exact_representative_image_matches",
      "sellerpilot_private.qoo10_exact_keyword_matches",
      "sellerpilot_private.qoo10_exact_hex_codepoint",
      "sellerpilot_private.qoo10_exact_decode_html",
      "sellerpilot_private.qoo10_exact_detail_image_urls",
      "sellerpilot_private.qoo10_exact_item_matches_source",
      "sellerpilot_private.qoo10_exact_response_state_valid",
      "sellerpilot_private.qoo10_exact_activation_keyword_binding_valid",
      "sellerpilot_private.qoo10_exact_activation_expectation_valid",
    ]) {
      await db.exec(functionDefinition(sql, name));
    }

    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_keyword_matches($1,$2,$3) value",
      [
        sourceArguments.params.ItemTitle,
        sourceArguments.params.Keyword,
        "No Brand,購入前確認",
      ],
    ), true);
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_keyword_matches($1,$2,$3) value",
      [sourceArguments.params.ItemTitle, sourceArguments.params.Keyword, sourceArguments.params.Keyword],
    ), true);
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_keyword_matches($1,$2,$3) value",
      [
        sourceArguments.params.ItemTitle,
        `No Brand,${sourceArguments.params.ItemTitle},購入前確認`,
        "No Brand,購入前確認",
      ],
    ), false, "a title removed from the middle is not the observed normalization");
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_keyword_matches($1,$2,$3) value",
      [
        sourceArguments.params.ItemTitle,
        sourceArguments.params.Keyword,
        "No Brand, 購入前確認",
      ],
    ), false, "comma whitespace is byte-significant");
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_keyword_matches($1,$2,$3) value",
      [
        sourceArguments.params.ItemTitle,
        `${sourceArguments.params.ItemTitle},No Brand,,購入前確認`,
        "No Brand,,購入前確認",
      ],
    ), false, "empty middle terms cannot pass exact title-prefix removal");
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_keyword_matches($1,$2,$3) value",
      [
        sourceArguments.params.ItemTitle,
        `${sourceArguments.params.ItemTitle},No Brand, 購入前確認`,
        "No Brand, 購入前確認",
      ],
    ), false, "unchanged surrounding whitespace is not canonical evidence");
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_keyword_matches($1,$2,$3) value",
      [sourceArguments.params.ItemTitle, "No Brand,,購入前確認", "No Brand,,購入前確認"],
    ), false, "an exact malformed keyword string is still rejected");
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_keyword_matches($1,$2,$3) value",
      [sourceArguments.params.ItemTitle, `${sourceArguments.params.ItemTitle},`, ""],
    ), false, "a title-only prefix cannot normalize to an empty provider keyword");
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_keyword_matches($1,$2,$3) value",
      [sourceArguments.params.ItemTitle, "", ""],
    ), false, "empty source and provider keywords are not evidence");
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_representative_image_matches(
        $1,$2
      ) value`,
      [exactItem().ImageUrl, exactItem().BIContentsNo],
    ), true, "representative URL is bound to the BI content id");
    for (const aliases of [
      ["ItemCode", "ItemNo", "GdNo"],
      ["ItemStatus", "Status"],
      ["Keyword", "Keywords"],
      ["ItemDetail", "ItemDescription", "Description"],
      ["SellPrice", "ItemPrice"],
      ["ItemQty", "Qty", "StockQty"],
    ]) {
      assert.equal(await scalar(
        db,
        `select sellerpilot_private.qoo10_exact_aliases_consistent(
          $1::jsonb,$2::text[]
        ) value`,
        [JSON.stringify(exactItem()), aliases],
      ), true, `${aliases.join("/")} aliases are consistent`);
    }
    const rawChecks = await scalar(
      db,
      `with value as (select $1::jsonb item,$2::jsonb source)
       select jsonb_build_object(
         'detailRaw',item->>'ItemDetail'=source#>>'{params,ItemDescription}',
         'detailImages',sellerpilot_private.qoo10_exact_detail_image_urls(item->>'ItemDetail')
           =sellerpilot_private.qoo10_exact_detail_image_urls(source#>>'{params,ItemDescription}'),
         'category',item->>'SecondSubCat'=source#>>'{sellerpilotQoo10RollbackUpdateRecovery,expectedState,categoryCode}',
         'retail',(item->>'RetailPrice')::numeric=(source#>>'{sellerpilotQoo10RollbackUpdateRecovery,expectedState,retailPriceJpy}')::numeric,
         'sell',(item->>'ItemPrice')::numeric=(source#>>'{sellerpilotQoo10RollbackUpdateRecovery,expectedState,sellPriceJpy}')::numeric,
         'quantity',(item->>'ItemQty')::numeric=(source#>>'{sellerpilotQoo10RollbackUpdateRecovery,expectedState,quantity}')::numeric,
         'shipping',item->>'ShippingNo'=source#>>'{sellerpilotQoo10RollbackUpdateRecovery,expectedState,shippingNo}',
         'originType',item->>'ProductionPlaceType'=source#>>'{params,ProductionPlaceType}',
         'origin',item->>'ProductionPlace'=source#>>'{params,ProductionPlace}',
         'adult',item->>'AdultYN'=source#>>'{params,AdultYN}'
       ) value from value`,
      [JSON.stringify(exactItem()), JSON.stringify(sourceArguments)],
    );
    assert.deepEqual(
      rawChecks,
      Object.fromEntries(Object.keys(rawChecks).map((key) => [key, true])),
      "every scalar and HTML source comparison is exact",
    );

    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_item_matches_source(
        $1::jsonb,$2::jsonb,'S2'
      ) value`,
      [JSON.stringify(exactItem()), JSON.stringify(sourceArguments)],
    ), true, "the exact raw item fixture matches every source-bound field");

    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_response_state_valid(
        $1::jsonb,'listing.activate','qoo10-s1-activation-post-readback',
        'S2','live',$2::jsonb
      ) value`,
      [JSON.stringify(exactResponse()), JSON.stringify(sourceArguments)],
    ), true);
    const quantityAliasOnly = exactItem();
    delete quantityAliasOnly.ItemQty;
    quantityAliasOnly.StockQty = "1";
    const originAliasOnly = exactItem();
    delete originAliasOnly.ProductionPlace;
    originAliasOnly.OriginCode = "CN";
    const adultAliasOnly = exactItem();
    delete adultAliasOnly.AdultYN;
    adultAliasOnly.AdultFlag = "N";
    for (const [label, aliasItem] of [
      ["StockQty", quantityAliasOnly],
      ["OriginCode", originAliasOnly],
      ["AdultFlag", adultAliasOnly],
    ]) {
      assert.equal(await scalar(
        db,
        `select sellerpilot_private.qoo10_exact_response_state_valid(
          $1::jsonb,'listing.activate','qoo10-s1-activation-post-readback',
          'S2','live',$2::jsonb
        ) value`,
        [JSON.stringify(exactResponse(aliasItem)), JSON.stringify(sourceArguments)],
      ), true, `${label} is accepted as the sole runtime-supported alias`);
    }
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_response_state_valid(
        $1::jsonb,'listing.activate','qoo10-s1-activation-post-readback',
        'S2','live',$2::jsonb
      ) value`,
      [JSON.stringify(exactResponse(exactItem({ ItemQty: "1.0" }))), JSON.stringify(sourceArguments)],
    ), false, "quantity remains a strict integer representation");
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_response_state_valid(
        $1::jsonb,'listing.activate','qoo10-s1-activation-post-readback',
        'S2','live',$2::jsonb
      ) value`,
      [JSON.stringify(exactResponse(exactItem({ ItemPrice: "1871.10" }))), JSON.stringify(sourceArguments)],
    ), false, "non-zero JPY fractions fail closed");
    for (const [label, drift] of [
      ["identity alias", { ItemNo: "1217336971" }],
      ["status alias", { Status: "S1" }],
      ["title", { ItemTitle: `${sourceArguments.params.ItemTitle} drift` }],
      ["keyword alias", { Keywords: "No Brand,別の値" }],
      ["promotion alias", { PromotionName: "", PromotionNm: "drift" }],
      ["industrial alias", { IndustrialCode: "", barcode: "drift" }],
      ["detail alias", { ItemDescription: "<p>drift</p>" }],
      ["sell-price alias", { SellPrice: "1872", ItemPrice: "1871.0000" }],
      ["quantity alias", { Qty: "2" }],
      ["BI content alias", { BIContentsNo: "8461402963", BiContentsNo: "8461402964" }],
      ["origin alias", { OriginCode: "US" }],
      ["adult alias", { AdultFlag: "Y" }],
    ]) {
      assert.equal(await scalar(
        db,
        `select sellerpilot_private.qoo10_exact_response_state_valid(
          $1::jsonb,'listing.activate','qoo10-s1-activation-post-readback',
          'S2','live',$2::jsonb
        ) value`,
        [JSON.stringify(exactResponse(exactItem(drift))), JSON.stringify(sourceArguments)],
      ), false, `${label} drift fails closed`);
    }
    const missingResultCode = exactResponse();
    delete missingResultCode.steps[0].data.ResultCode;
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_response_state_valid(
        $1::jsonb,'listing.activate','qoo10-s1-activation-post-readback',
        'S2','live',$2::jsonb
      ) value`,
      [JSON.stringify(missingResultCode), JSON.stringify(sourceArguments)],
    ), false, "HTTP 200 without an owned ResultCode is not accepted");

    const expectation = {
      expectedState: {
        categoryCode: "320000542",
        retailPriceJpy: 1871,
        sellPriceJpy: 1871,
        quantity: 1,
        shippingNo: "806971",
        biContentsNo: 8461402963,
        originType: "2",
        originCode: "CN",
        adultYn: "N",
      },
      expectedTitle: sourceArguments.params.ItemTitle,
      expectedKeyword: "No Brand,購入前確認",
      expectedPromotionName: "",
      expectedIndustrialCode: "",
      expectedDetailHtmlSha256: createHash("sha256")
        .update(sourceArguments.params.ItemDescription)
        .digest("hex"),
      expectedDetailImageUrls: detailImageUrls,
    };
    assert.deepEqual(
      await scalar(
        db,
        `select sellerpilot_private.qoo10_exact_detail_image_urls($1)::json value`,
        [sourceArguments.params.ItemDescription],
      ),
      detailImageUrls,
      "SQL extracts the same decoded ordered source HTML URLs as the runtime",
    );
    assert.deepEqual(
      await scalar(
        db,
        `select sellerpilot_private.qoo10_exact_detail_image_urls($1)::json value`,
        [`<img src="${detailImageUrls[0]
          .replaceAll("&", "&#x26;")}"><img src='${detailImageUrls[1]
          .replaceAll("&", "&#38;")}'>`],
      ),
      detailImageUrls.slice(0, 2),
      "numeric HTML entities decode exactly once before ordered URL extraction",
    );
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_activation_expectation_valid(
        $1::jsonb,$2::jsonb
      ) value`,
      [JSON.stringify(expectation), JSON.stringify(sourceArguments)],
    ), true);
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_activation_expectation_valid(
        $1::jsonb,$2::jsonb
      ) value`,
      [
        JSON.stringify({
          ...expectation,
          expectedState: { ...expectation.expectedState, quantity: "1" },
        }),
        JSON.stringify(sourceArguments),
      ],
    ), false, "activation marker numeric fields must remain JSON numbers");
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_activation_expectation_valid(
        $1::jsonb,$2::jsonb
      ) value`,
      [
        JSON.stringify({ ...expectation, untrusted: true }),
        JSON.stringify(sourceArguments),
      ],
    ), false, "unexpected marker keys fail closed");

    const activationRequest = {
      arguments: {
        sellerpilotQoo10S1Activation: expectation,
      },
    };
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_activation_keyword_binding_valid(
        $1::jsonb,$2::jsonb,$3::jsonb,
        'qoo10-s1-activation-post-readback'
      ) value`,
      [
        JSON.stringify(exactResponse()),
        JSON.stringify(activationRequest),
        JSON.stringify(expectation),
      ],
    ), true, "post-readback keyword is bound to marker and immutable observation");
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_activation_keyword_binding_valid(
        $1::jsonb,$2::jsonb,$3::jsonb,
        'qoo10-s1-activation-post-readback'
      ) value`,
      [
        JSON.stringify(exactResponse(exactItem({
          Keyword: sourceArguments.params.Keyword,
        }))),
        JSON.stringify(activationRequest),
        JSON.stringify(expectation),
      ],
    ), false, "post-readback cannot drift back to the source title-prefixed keyword");
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_activation_keyword_binding_valid(
        $1::jsonb,$2::jsonb,$3::jsonb,
        'qoo10-s1-activation-post-readback'
      ) value`,
      [
        JSON.stringify(exactResponse()),
        JSON.stringify({
          arguments: {
            sellerpilotQoo10S1Activation: {
              ...expectation,
              expectedKeyword: sourceArguments.params.Keyword,
            },
          },
        }),
        JSON.stringify(expectation),
      ],
    ), false, "activation marker cannot widen the observed normalized keyword");
  } finally {
    await db.close();
  }
});

test("Qoo10 S1 activation migration keeps a two-stage, one-shot provider fence", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /operation = 'listing\.publication\.verify'/);
  assert.match(sql, /operation = 'listing\.activate'/);
  assert.match(sql, /expires_at <= armed_at \+ interval '2 minutes'/);
  assert.match(sql, /bound_claim_token uuid/);
  assert.match(sql, /consumed_at timestamptz/);
  assert.match(sql, /qoo10-s1-activation-post-readback/);
  assert.match(sql, /sellerpilotReconciliationRequired/);
  assert.match(
    sql,
    /where run\.source_job_id = p_source_job_id[\s\S]{0,250}job\.status in \('queued','running'\)/,
    "only a queued or running verifier is reused",
  );
  assert.doesNotMatch(
    sql,
    /where run\.source_job_id = p_source_job_id[\s\S]{0,250}job\.status in \([^)]*succeeded/,
    "a completed verifier does not prevent a fresh verifier run after TTL expiry",
  );
  assert.match(
    sql,
    /or exists \(\s*select 1 from sellerpilot_private\.qoo10_exact_s1_activation_permits\s*where invalidated_at is null/,
    "a fresh verifier may be rerun only after an unclaimed expired permit is invalidated",
  );
  assert.match(
    sql,
    /jsonb_array_length\(v_job\.response_payload->'steps'\) = 2[\s\S]{0,500}qoo10-s1-activation-post-readback/,
    "terminal success requires the exact ordered write/readback pair",
  );
  const providerPermitDefinition = functionDefinition(
    sql,
    "sellerpilot_private.exact_qoo10_s1_activation_provider_allowed",
  );
  assert.match(providerPermitDefinition, /job\.provider_mutation_started_at is null/);
  assert.match(providerPermitDefinition, /permit\.consumed_at is null/);
  assert.doesNotMatch(
    providerPermitDefinition,
    /provider_mutation_started_at is not null/,
    "a consumed provider boundary can never be reused for a second POST",
  );
  assert.doesNotMatch(
    sql.slice(sql.indexOf("sellerpilot_service_enqueue_exact_qoo10_s1_activation")),
    /method[^\n]{0,80}(?:UpdateGoods|EditGoodsContents)/,
  );
  assert.match(
    sql,
    /'qoo10-s1-activate:' \|\| v_run\.source_job_id::text \|\| ':' \|\|\s*v_run\.verifier_job_id::text/,
    "a new observation gets a distinct activation attempt identity after safe preclaim expiry",
  );
  const currentSourceDefinition = functionDefinition(
    sql,
    "sellerpilot_private.qoo10_exact_s1_source_is_current",
  );
  assert.match(
    currentSourceDefinition,
    /later_job\.listing_id = job\.listing_id[\s\S]*later_job\.operation in \([\s\S]*'listing\.create','listing\.update','listing\.stop'[\s\S]*later_job\.created_at > job\.created_at/,
    "a later listing intent makes the fixed S1 source stale",
  );
  assert.match(
    currentSourceDefinition,
    /active_job\.listing_id = job\.listing_id[\s\S]*active_job\.operation in \([\s\S]*'listing\.create','listing\.update','listing\.stop'[\s\S]*active_job\.status in \([\s\S]*'queued','running','reconciliation_required'[\s\S]*active_job\.id <> job\.id/,
    "another active or uncertain listing mutation blocks recovery",
  );
  for (const claimFunction of [
    "sellerpilot_claim_channel_gateway_job",
    "sellerpilot_claim_serverless_gateway_job",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `${claimFunction}\\(text,text\\)[\\s\\S]{0,1200}`
          + "expire_exact_qoo10_s1_activation_preclaim",
      ),
      `${claimFunction} clears only never-claimed expired activation work before selection`,
    );
  }
  const expiryDefinition = functionDefinition(
    sql,
    "sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim",
  );
  const emptyFastPath = expiryDefinition.indexOf("if not exists (");
  const recoveryLock = expiryDefinition.indexOf(
    "perform pg_catalog.pg_advisory_xact_lock(193674993,821065042)",
  );
  assert.ok(emptyFastPath >= 0 && recoveryLock > emptyFastPath);
  assert.match(
    expiryDefinition.slice(emptyFastPath, recoveryLock),
    /permit\.invalidated_at is null[\s\S]*permit\.expires_at <= statement_timestamp\(\)[\s\S]*job\.status = 'queued'[\s\S]*job\.operation = 'listing\.activate'[\s\S]*return 0/,
    "ordinary claims return before the global recovery lock unless an exact expired activation is safely terminalizable",
  );
});

test("activation claim and provider boundary bind once while expired preclaim work terminalizes without a call", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const workerId = "20000000-0000-4000-8000-000000000001";
  const otherWorkerId = "20000000-0000-4000-8000-000000000002";
  const claimId = "20000000-0000-4000-8000-000000000003";
  const wrongClaimId = "20000000-0000-4000-8000-000000000004";
  const verifierId = "20000000-0000-4000-8000-000000000005";
  const jobId = "20000000-0000-4000-8000-000000000006";
  const attemptId = "20000000-0000-4000-8000-000000000007";
  const expiredVerifierId = "20000000-0000-4000-8000-000000000008";
  const expiredJobId = "20000000-0000-4000-8000-000000000009";
  const expiredAttemptId = "20000000-0000-4000-8000-000000000010";
  const credentialId = "20000000-0000-4000-8000-000000000011";
  const wrongCredentialId = "20000000-0000-4000-8000-000000000012";
  const listingId = "20000000-0000-4000-8000-000000000013";
  const sellerAccountKey = "e".repeat(64);
  const writeResourceKey = "f".repeat(64);
  const verifierSha = "c".repeat(64);
  const releaseSha = "d".repeat(40);
  const requestFor = (boundVerifierId) => ({
    arguments: {
      remoteId: "1217336970",
      sellerpilotQoo10S1Activation: {
        verifierJobId: boundVerifierId,
        verifierResponseSha256: verifierSha,
      },
    },
  });
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm) = 'sha256'
          then sha256(convert_to(value, 'UTF8'))
          else convert_to(md5(value || algorithm), 'UTF8') end
      $$;
      create table sellerpilot_private.ai_cli_worker_tokens (id uuid primary key);
      create table sellerpilot_private.qoo10_exact_s1_verifier_runs (
        verifier_job_id uuid primary key,
        release_sha text not null
      );
      create table sellerpilot_private.qoo10_exact_s1_observations (
        verifier_job_id uuid primary key,
        verifier_response_sha256 text not null
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key,
        status text not null,
        operation text not null,
        http_status integer,
        safe_message text,
        completed_at timestamptz
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        credential_id uuid not null,
        attempt_id uuid not null,
        listing_id uuid not null,
        operation text not null,
        channel text not null,
        environment text not null,
        status text not null,
        seller_account_key text not null,
        worker_token_id uuid,
        claim_token uuid,
        attempt_count integer not null default 0,
        lease_expires_at timestamptz,
        completed_at timestamptz,
        response_payload jsonb,
        provider_mutation_started_at timestamptz,
        request_fingerprint text not null,
        request_payload jsonb not null,
        write_resource_kind text not null,
        write_resource_key text not null,
        started_at timestamptz,
        error_message text,
        updated_at timestamptz not null default clock_timestamp()
      );
      create table sellerpilot_private.qoo10_exact_s1_activation_permits (
        activation_job_id uuid primary key,
        activation_attempt_id uuid not null,
        verifier_job_id uuid not null,
        credential_id uuid not null,
        listing_id uuid not null,
        seller_account_key text not null,
        write_resource_key text not null,
        release_sha text not null,
        activation_request_sha256 text not null,
        activation_request_bytes integer not null,
        expires_at timestamptz not null,
        bound_at timestamptz,
        bound_worker_token_id uuid,
        bound_claim_token uuid,
        consumed_at timestamptz,
        invalidated_at timestamptz,
        invalidation_reason text
      );
      create table sellerpilot_private.provider_calls (
        job_id uuid primary key,
        calls integer not null
      );
      create function sellerpilot_private.qoo10_exact_s1_release_is_current(value text)
      returns boolean language sql stable as $$ select value='${releaseSha}' $$;
      create function sellerpilot_private.qoo10_exact_s1_source_is_current()
      returns boolean language sql stable as $$ select true $$;
      create function public.sellerpilot_056700_begin_gateway_before_qoo10_s1_activation(
        token_hash text,p_job_id uuid,p_claim_token uuid
      ) returns boolean language plpgsql as $$
      declare changed integer;
      begin
        update sellerpilot_private.channel_gateway_jobs job
           set provider_mutation_started_at=clock_timestamp()
         where job.id=p_job_id and job.status='running'
           and job.claim_token=p_claim_token
           and job.provider_mutation_started_at is null;
        get diagnostics changed=row_count;
        if changed=1 then
          insert into sellerpilot_private.provider_calls values (p_job_id,1)
          on conflict (job_id) do update set calls=
            sellerpilot_private.provider_calls.calls+1;
        end if;
        return changed=1;
      end;
      $$;
    `);
    for (const name of [
      "sellerpilot_private.bind_exact_qoo10_s1_activation_claim",
      "sellerpilot_private.exact_qoo10_s1_activation_provider_allowed",
      "sellerpilot_private.consume_exact_qoo10_s1_activation_provider",
      "sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim",
      "public.sellerpilot_service_begin_gateway_provider_mutation",
    ]) {
      await db.exec(functionDefinition(sql, name));
    }
    await db.query(
      "insert into sellerpilot_private.ai_cli_worker_tokens values ($1),($2)",
      [workerId, otherWorkerId],
    );
    const insertFenceCase = async ({
      caseVerifierId,
      caseJobId,
      caseAttemptId,
      expiresAt,
    }) => {
      const request = requestFor(caseVerifierId);
      await db.query(
        "insert into sellerpilot_private.qoo10_exact_s1_verifier_runs values ($1,$2)",
        [caseVerifierId, releaseSha],
      );
      await db.query(
        "insert into sellerpilot_private.qoo10_exact_s1_observations values ($1,$2)",
        [caseVerifierId, verifierSha],
      );
      await db.query(
        `insert into sellerpilot_private.channel_operation_attempts(id,status,operation)
         values ($1,'running','listing.activate')`,
        [caseAttemptId],
      );
      await db.query(
        `insert into sellerpilot_private.channel_gateway_jobs(
           id,credential_id,attempt_id,listing_id,operation,channel,environment,
           status,seller_account_key,request_fingerprint,request_payload,
           write_resource_kind,write_resource_key
         ) values ($1,$2,$3,$4,'listing.activate','qoo10','production','queued',
                   $5,'pending',$6::jsonb,'listing_mutation',$7)`,
        [
          caseJobId,
          credentialId,
          caseAttemptId,
          listingId,
          sellerAccountKey,
          JSON.stringify(request),
          writeResourceKey,
        ],
      );
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set request_fingerprint=encode(
              extensions.digest(request_payload::text,'sha256'),'hex'
            ) where id=$1`,
        [caseJobId],
      );
      await db.query(
        `insert into sellerpilot_private.qoo10_exact_s1_activation_permits(
           activation_job_id,activation_attempt_id,verifier_job_id,release_sha,
           credential_id,listing_id,seller_account_key,write_resource_key,
           activation_request_sha256,activation_request_bytes,expires_at
         ) select id,$2,$3,$4,credential_id,listing_id,seller_account_key,
                  write_resource_key,request_fingerprint,
                  octet_length(request_payload::text),$5::timestamptz
             from sellerpilot_private.channel_gateway_jobs where id=$1`,
        [
          caseJobId,
          caseAttemptId,
          caseVerifierId,
          releaseSha,
          expiresAt,
        ],
      );
    };
    await insertFenceCase({
      caseVerifierId: verifierId,
      caseJobId: jobId,
      caseAttemptId: attemptId,
      expiresAt: "2099-01-01T00:00:00Z",
    });
    const oldJob = await scalar(
      db,
      "select to_jsonb(job) value from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [jobId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='running',worker_token_id=$2,claim_token=$3,
              attempt_count=1,lease_expires_at=clock_timestamp()+interval '5 minutes',
              started_at=clock_timestamp()
        where id=$1`,
      [jobId, workerId, claimId],
    );
    const claimedJob = await scalar(
      db,
      "select to_jsonb(job) value from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [jobId],
    );
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
        $1::jsonb,$2::jsonb
      ) value`,
      [
        JSON.stringify(oldJob),
        JSON.stringify({ ...claimedJob, credential_id: wrongCredentialId }),
      ],
    ), false, "a credential mutation cannot bind during queued-to-running claim");
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
        $1::jsonb,$2::jsonb
      ) value`,
      [
        JSON.stringify(oldJob),
        JSON.stringify({ ...claimedJob, seller_account_key: "0".repeat(64) }),
      ],
    ), false, "a seller-account mutation cannot bind during claim");
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
        $1::jsonb,$2::jsonb
      ) value`,
      [JSON.stringify(oldJob), JSON.stringify(claimedJob)],
    ), true, "the exact queued-to-running transition binds once");
    assert.equal(await scalar(
      db,
      `select sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
        $1::jsonb,$2::jsonb
      ) value`,
      [JSON.stringify(oldJob), JSON.stringify(claimedJob)],
    ), false, "the same claim cannot bind twice");
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.exact_qoo10_s1_activation_provider_allowed($1,$2) value",
      [jobId, wrongClaimId],
    ), false, "a wrong claim token cannot cross the provider fence");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set worker_token_id=$2 where id=$1",
      [jobId, otherWorkerId],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.exact_qoo10_s1_activation_provider_allowed($1,$2) value",
      [jobId, claimId],
    ), false, "a worker mismatch cannot cross the provider fence");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set worker_token_id=$2 where id=$1",
      [jobId, workerId],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set credential_id=$2 where id=$1",
      [jobId, wrongCredentialId],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.exact_qoo10_s1_activation_provider_allowed($1,$2) value",
      [jobId, claimId],
    ), false, "a credential mismatch cannot cross the provider fence");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set credential_id=$2 where id=$1",
      [jobId, credentialId],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set seller_account_key=$2 where id=$1",
      [jobId, "0".repeat(64)],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.exact_qoo10_s1_activation_provider_allowed($1,$2) value",
      [jobId, claimId],
    ), false, "a seller-account mismatch cannot cross the provider fence");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set seller_account_key=$2 where id=$1",
      [jobId, sellerAccountKey],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set request_payload=jsonb_set(request_payload,'{arguments,remoteId}','"tampered"')
        where id=$1`,
      [jobId],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.exact_qoo10_s1_activation_provider_allowed($1,$2) value",
      [jobId, claimId],
    ), false, "request payload drift cannot cross the provider fence");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set request_payload=$2::jsonb where id=$1",
      [jobId, JSON.stringify(requestFor(verifierId))],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.exact_qoo10_s1_activation_provider_allowed($1,$2) value",
      [jobId, claimId],
    ), true);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_begin_gateway_provider_mutation('token',$1,$2) value",
      [jobId, claimId],
    ), true, "the exact provider boundary is crossed once");
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_begin_gateway_provider_mutation('token',$1,$2) value",
      [jobId, claimId],
    ), false, "the consumed permit cannot cross a second provider boundary");
    assert.deepEqual(
      (await db.query(
        `select permit.consumed_at is not null as consumed,
                job.provider_mutation_started_at is not null as started,
                calls.calls
           from sellerpilot_private.qoo10_exact_s1_activation_permits permit
           join sellerpilot_private.channel_gateway_jobs job
             on job.id=permit.activation_job_id
           left join sellerpilot_private.provider_calls calls on calls.job_id=job.id
          where job.id=$1`,
        [jobId],
      )).rows,
      [{ consumed: true, started: true, calls: 1 }],
    );

    await insertFenceCase({
      caseVerifierId: expiredVerifierId,
      caseJobId: expiredJobId,
      caseAttemptId: expiredAttemptId,
      expiresAt: "2000-01-01T00:00:00Z",
    });
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim() value",
    ), 1);
    assert.deepEqual(
      (await db.query(
        `select job.status,job.provider_mutation_started_at is null as never_started,
                attempt.status as attempt_status,attempt.http_status,
                permit.invalidated_at is not null as invalidated,
                permit.invalidation_reason,permit.consumed_at is null as never_consumed
           from sellerpilot_private.qoo10_exact_s1_activation_permits permit
           join sellerpilot_private.channel_gateway_jobs job
             on job.id=permit.activation_job_id
           join sellerpilot_private.channel_operation_attempts attempt
             on attempt.id=permit.activation_attempt_id
          where job.id=$1`,
        [expiredJobId],
      )).rows,
      [{
        status: "failed",
        never_started: true,
        attempt_status: "failed",
        http_status: 409,
        invalidated: true,
        invalidation_reason: "expired_before_claim",
        never_consumed: true,
      }],
      "expired work terminalizes only before claim/provider mutation",
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer value from sellerpilot_private.provider_calls where job_id=$1",
        [expiredJobId],
      ),
      0,
    );
  } finally {
    await db.close();
  }
});

test("expired preclaim activation can reverify and enqueue a distinct second permit without a provider write", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const sourceJobId = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
  const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
  const credentialId = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
  const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
  const createdBy = "21eb1892-0894-4f9f-b414-4c9464182dd6";
  const sellerAccountKey = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
  const oldVerifierId = "25000000-0000-4000-8000-000000000001";
  const oldAttemptId = "25000000-0000-4000-8000-000000000002";
  const oldJobId = "25000000-0000-4000-8000-000000000003";
  const freshVerifierId = "25000000-0000-4000-8000-000000000004";
  const releaseSha = "a".repeat(40);
  const expectation = {
    expectedState: {
      categoryCode: "320000542",
      retailPriceJpy: 1871,
      sellPriceJpy: 1871,
      quantity: 1,
      shippingNo: "806971",
      biContentsNo: 8461402963,
      originType: "2",
      originCode: "CN",
      adultYn: "N",
    },
    expectedTitle: sourceArguments.params.ItemTitle,
    expectedKeyword: "No Brand,購入前確認",
    expectedPromotionName: "",
    expectedIndustrialCode: "",
    expectedDetailHtmlSha256: createHash("sha256")
      .update(sourceArguments.params.ItemDescription)
      .digest("hex"),
    expectedDetailImageUrls: detailImageUrls,
  };
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm)='sha256'
          then sha256(convert_to(value,'UTF8'))
          else convert_to(md5(value || algorithm),'UTF8') end
      $$;
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key,
        owner_id uuid not null,
        credential_id uuid not null,
        channel text not null,
        operation text not null,
        idempotency_key text not null,
        request_fingerprint text not null,
        status text not null,
        started_at timestamptz,
        seller_account_key text not null,
        gateway_write_required boolean not null,
        pre_gateway_retryable boolean not null,
        http_status integer,
        safe_message text,
        completed_at timestamptz,
        unique(channel,operation,idempotency_key)
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        credential_id uuid not null,
        attempt_id uuid,
        listing_id uuid,
        channel text not null,
        operation text not null,
        environment text not null,
        request_payload jsonb not null,
        status text not null,
        seller_account_key text,
        request_fingerprint text,
        write_resource_kind text,
        write_resource_key text,
        created_by uuid not null,
        created_at timestamptz not null default clock_timestamp(),
        updated_at timestamptz not null default clock_timestamp(),
        worker_token_id uuid,
        claim_token uuid,
        attempt_count integer not null default 0,
        started_at timestamptz,
        lease_expires_at timestamptz,
        provider_mutation_started_at timestamptz,
        response_payload jsonb,
        completed_at timestamptz,
        error_message text
      );
      create table sellerpilot_private.qoo10_exact_s1_verifier_runs (
        verifier_job_id uuid primary key,
        source_job_id uuid not null,
        listing_id uuid not null,
        credential_id uuid not null,
        owner_id uuid not null,
        remote_id text not null,
        seller_account_key text not null,
        release_sha text not null
      );
      create table sellerpilot_private.qoo10_exact_s1_observations (
        verifier_job_id uuid primary key,
        release_sha text not null,
        verifier_response_sha256 text not null,
        activation_expectation jsonb not null,
        verifier_completed_at timestamptz not null
      );
      create table sellerpilot_private.qoo10_exact_s1_activation_permits (
        activation_job_id uuid primary key,
        activation_attempt_id uuid not null unique,
        verifier_job_id uuid not null unique,
        source_job_id uuid not null,
        listing_id uuid not null,
        credential_id uuid not null,
        owner_id uuid not null,
        remote_id text not null,
        seller_account_key text not null,
        release_sha text not null,
        activation_request_sha256 text not null,
        activation_request_bytes integer not null,
        write_resource_key text not null,
        contract text not null,
        armed_at timestamptz not null,
        expires_at timestamptz not null,
        bound_at timestamptz,
        bound_worker_token_id uuid,
        bound_claim_token uuid,
        consumed_at timestamptz,
        invalidated_at timestamptz,
        invalidation_reason text
      );
      create unique index one_active_retry_source
        on sellerpilot_private.qoo10_exact_s1_activation_permits(source_job_id)
        where invalidated_at is null;
      create unique index one_active_retry_listing
        on sellerpilot_private.qoo10_exact_s1_activation_permits(listing_id)
        where invalidated_at is null;
      create function sellerpilot_private.qoo10_exact_s1_release_is_current(value text)
      returns boolean language sql stable as $$ select value='${releaseSha}' $$;
      create function sellerpilot_private.qoo10_exact_s1_source_is_current()
      returns boolean language sql stable as $$ select true $$;
    `);
    for (const name of [
      "sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim",
      "public.sellerpilot_service_enqueue_exact_qoo10_s1_activation",
    ]) {
      await db.exec(functionDefinition(sql, name));
    }
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,status,seller_account_key,request_fingerprint,created_by
       ) values ($1,$2,null,$3,'qoo10','listing.update','production',$4::jsonb,
                 'reconciliation_required',$5,$6,$7)`,
      [
        sourceJobId,
        credentialId,
        listingId,
        JSON.stringify({ arguments: sourceArguments }),
        sellerAccountKey,
        "9".repeat(64),
        createdBy,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts(
         id,owner_id,credential_id,channel,operation,idempotency_key,
         request_fingerprint,status,started_at,seller_account_key,
         gateway_write_required,pre_gateway_retryable
       ) values ($1,$2,$3,'qoo10','listing.activate',$4,$5,'running',
                 clock_timestamp()-interval '5 minutes',$6,true,false)`,
      [
        oldAttemptId,
        ownerId,
        credentialId,
        `qoo10-s1-activate:${sourceJobId}:${oldVerifierId}`,
        "8".repeat(64),
        sellerAccountKey,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,status,seller_account_key,request_fingerprint,
         write_resource_kind,write_resource_key,created_by,created_at,updated_at
       ) values ($1,$2,$3,$4,'qoo10','listing.activate','production','{}'::jsonb,
                 'queued',$5,$6,'listing_mutation',$7,$8,
                 clock_timestamp()-interval '5 minutes',clock_timestamp())`,
      [
        oldJobId,
        credentialId,
        oldAttemptId,
        listingId,
        sellerAccountKey,
        "8".repeat(64),
        "7".repeat(64),
        createdBy,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.qoo10_exact_s1_activation_permits(
         activation_job_id,activation_attempt_id,verifier_job_id,source_job_id,
         listing_id,credential_id,owner_id,remote_id,seller_account_key,release_sha,
         activation_request_sha256,activation_request_bytes,write_resource_key,
         contract,armed_at,expires_at
       ) values ($1,$2,$3,$4,$5,$6,$7,'1217336970',$8,$9,$10,100,$11,
                 'qoo10_exact_s1_activation_permit_v1',
                 clock_timestamp()-interval '5 minutes',
                 clock_timestamp()-interval '3 minutes')`,
      [
        oldJobId,
        oldAttemptId,
        oldVerifierId,
        sourceJobId,
        listingId,
        credentialId,
        ownerId,
        sellerAccountKey,
        releaseSha,
        "8".repeat(64),
        "7".repeat(64),
      ],
    );
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim() value",
    ), 1);

    await db.query(
      `insert into sellerpilot_private.qoo10_exact_s1_verifier_runs values
       ($1,$2,$3,$4,$5,'1217336970',$6,$7)`,
      [
        freshVerifierId,
        sourceJobId,
        listingId,
        credentialId,
        ownerId,
        sellerAccountKey,
        releaseSha,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.qoo10_exact_s1_observations values
       ($1,$2,$3,$4::jsonb,clock_timestamp())`,
      [freshVerifierId, releaseSha, "6".repeat(64), JSON.stringify(expectation)],
    );
    const second = await scalar(
      db,
      "select public.sellerpilot_service_enqueue_exact_qoo10_s1_activation($1,$2) value",
      [freshVerifierId, releaseSha],
    );
    assert.equal(second.verifierJobId, freshVerifierId);
    assert.notEqual(second.activationJobId, oldJobId);
    assert.deepEqual(
      (await db.query(
        `select attempt.idempotency_key,job.status,
                job.provider_mutation_started_at is null as never_started,
                permit.invalidated_at is null as active
           from sellerpilot_private.channel_operation_attempts attempt
           join sellerpilot_private.channel_gateway_jobs job on job.attempt_id=attempt.id
           join sellerpilot_private.qoo10_exact_s1_activation_permits permit
             on permit.activation_job_id=job.id
          where job.operation='listing.activate'
          order by attempt.idempotency_key`,
      )).rows,
      [
        {
          idempotency_key: `qoo10-s1-activate:${sourceJobId}:${freshVerifierId}`,
          status: "queued",
          never_started: true,
          active: true,
        },
        {
          idempotency_key: `qoo10-s1-activate:${sourceJobId}:${oldVerifierId}`,
          status: "failed",
          never_started: true,
          active: false,
        },
      ].sort((left, right) => left.idempotency_key.localeCompare(right.idempotency_key)),
      "fresh verifier identity avoids the old idempotency key while both jobs remain zero-write",
    );
  } finally {
    await db.close();
  }
});

test("exact S2 outcome is the only path that projects the listing from failed/unknown to published/live", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const activationJobId = "30000000-0000-4000-8000-000000000001";
  const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
  const sellerAccountKey = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
  const verifiedAt = "2026-08-31T00:00:05.000Z";
  const response = {
    ok: true,
    remoteId: "1217336970",
    remoteState: {
      verified: true,
      providerStatus: "S2",
      visibility: "live",
      verifiedAt,
      locale: "ja-JP",
      fingerprint: "a".repeat(64),
      imageCount: 8,
      resources: { itemCode: "1217336970" },
      evidence: { exactContentVerified: true },
    },
  };
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm) = 'sha256'
          then sha256(convert_to(value, 'UTF8'))
          else convert_to(md5(value || algorithm), 'UTF8') end
      $$;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        listing_id uuid not null,
        status text not null,
        channel text not null,
        operation text not null,
        response_payload jsonb not null,
        seller_account_key text not null,
        provider_mutation_started_at timestamptz not null,
        completed_at timestamptz not null
      );
      create table sellerpilot_private.qoo10_exact_s1_activation_outcomes (
        activation_job_id uuid primary key,
        listing_id uuid not null,
        remote_id text not null,
        terminal_status text not null,
        provider_status text,
        remote_visibility text,
        activation_response_sha256 text
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key,
        owner_id uuid not null,
        product_id uuid not null,
        channel_key text not null,
        market text not null,
        target_id text not null,
        remote_id text,
        status text not null,
        failure_class text,
        remote_visibility text not null,
        requested_publication_intent text not null,
        seller_account_key text not null,
        provider_status text,
        remote_resources jsonb not null default '{}'::jsonb,
        remote_created_at timestamptz,
        published_at timestamptz,
        last_verified_at timestamptz,
        last_error text,
        updated_at timestamptz not null
      );
    `);
    await db.exec(functionDefinition(
      sql,
      "sellerpilot_private.qoo10_exact_s1_activation_listing_update_allowed",
    ));
    await db.exec(functionDefinition(
      sql,
      "sellerpilot_private.apply_exact_qoo10_s1_activation_listing",
    ));
    await db.exec(`
      create function sellerpilot_private.guard_product_listing_seller_lineage()
      returns trigger language plpgsql set search_path = '' as $$
      begin
        if nullif(current_setting('sellerpilot.qoo10_s1_activation_apply', true), '') is not null
           and sellerpilot_private.qoo10_exact_s1_activation_listing_update_allowed(
             to_jsonb(old),to_jsonb(new),
             current_setting('sellerpilot.qoo10_s1_activation_apply', true)
           ) then return new; end if;
        raise exception 'listing update is fenced';
      end;
      $$;
      create trigger guard_product_listing_seller_lineage
      before update on sellerpilot_private.product_listings
      for each row execute function sellerpilot_private.guard_product_listing_seller_lineage();
    `);
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs values (
        $1,$2,'succeeded','qoo10','listing.activate',$3::jsonb,$4,
        '2026-08-31 00:00:03+00','2026-08-31 00:00:06+00'
      )`,
      [activationJobId, listingId, JSON.stringify(response), sellerAccountKey],
    );
    await db.query(
      `insert into sellerpilot_private.qoo10_exact_s1_activation_outcomes
       select $1,$2,'1217336970','succeeded','S2','live',
              encode(extensions.digest($3::jsonb::text,'sha256'),'hex')`,
      [activationJobId, listingId, JSON.stringify(response)],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings values (
        $1,'768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
        'ddccde35-9c58-4856-b673-d7aa27ce4220','qoo10','JP','',
        '1217336970','failed','external_action','unknown','live',$2,
        null,'{}'::jsonb,null,null,null,'prior manual review',
        '2026-08-30 23:40:12.971653+00'
      )`,
      [listingId, sellerAccountKey],
    );
    await assert.rejects(
      db.query(
        "update sellerpilot_private.product_listings set status='published' where id=$1",
        [listingId],
      ),
      /listing update is fenced/,
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.apply_exact_qoo10_s1_activation_listing($1) value",
        [activationJobId],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select status,remote_visibility,provider_status,failure_class,last_error,
                last_verified_at::text as last_verified_at,
                remote_resources#>>'{verification,locale}' as locale,
                remote_resources#>>'{verification,imageCount}' as image_count
           from sellerpilot_private.product_listings where id=$1`,
        [listingId],
      )).rows,
      [{
        status: "published",
        remote_visibility: "live",
        provider_status: "S2",
        failure_class: null,
        last_error: null,
        last_verified_at: "2026-08-31 00:00:05+00",
        locale: "ja-JP",
        image_count: "8",
      }],
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.apply_exact_qoo10_s1_activation_listing($1) value",
        [activationJobId],
      ),
      false,
      "the one-time failed/unknown preimage cannot be projected twice",
    );
  } finally {
    await db.close();
  }
});

test("activation completion derives explicit reject and safely terminalizes pre/post provider uncertainty", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const sourceJobId = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
  const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
  const workerId = "40000000-0000-4000-8000-000000000001";
  const claimId = "40000000-0000-4000-8000-000000000002";
  const explicitJobId = "40000000-0000-4000-8000-000000000011";
  const preProviderJobId = "40000000-0000-4000-8000-000000000012";
  const uncertainJobId = "40000000-0000-4000-8000-000000000013";
  const keywordDriftJobId = "40000000-0000-4000-8000-000000000014";
  const leadingZeroJobId = "40000000-0000-4000-8000-000000000015";
  const explicitResponse = {
    ok: false,
    steps: [
      {
        name: "qoo10-s1-activation",
        ok: false,
        status: 200,
        data: { ResultCode: -99, sellerpilotNoWriteConfirmed: true },
      },
      {
        name: "qoo10-s1-activation-post-readback",
        ok: true,
        status: 200,
        data: {
          ResultCode: 0,
          ResultObject: exactItem({ ItemStatus: "S1" }),
        },
      },
    ],
    remoteState: {
      providerStatus: "S1",
      visibility: "non_public",
      verifiedAt: "2026-08-31T00:00:05Z",
    },
  };
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm) = 'sha256'
          then sha256(convert_to(value, 'UTF8'))
          else convert_to(md5(value || algorithm), 'UTF8') end
      $$;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        status text not null,
        completed_at timestamptz,
        provider_mutation_started_at timestamptz,
        response_payload jsonb,
        request_payload jsonb not null default '{"arguments":{}}'::jsonb
      );
      create table sellerpilot_private.qoo10_exact_s1_activation_permits (
        activation_job_id uuid primary key,
        source_job_id uuid not null,
        verifier_job_id uuid not null,
        listing_id uuid not null,
        remote_id text not null,
        consumed_at timestamptz,
        bound_claim_token uuid not null,
        bound_worker_token_id uuid not null,
        invalidated_at timestamptz
      );
      create table sellerpilot_private.qoo10_exact_s1_observations (
        verifier_job_id uuid primary key,
        activation_expectation jsonb not null
      );
      create table sellerpilot_private.gateway_completion_receipts (
        job_id uuid not null,
        claim_token uuid not null,
        worker_token_id uuid not null
      );
      create table sellerpilot_private.qoo10_exact_s1_activation_outcomes (
        activation_job_id uuid primary key,
        source_job_id uuid not null,
        verifier_job_id uuid not null,
        listing_id uuid not null,
        remote_id text not null,
        terminal_status text not null,
        activation_response_sha256 text,
        activation_response_bytes integer,
        provider_status text,
        remote_visibility text,
        verified_at timestamptz,
        completed_at timestamptz not null,
        contract text not null
      );
      create table sellerpilot_private.projection_calls (job_id uuid primary key);
      create function sellerpilot_private.qoo10_exact_s1_source_is_current()
      returns boolean language sql stable as $$ select true $$;
      create function sellerpilot_private.qoo10_exact_response_state_valid(
        response jsonb, operation text, step_name text, expected_status text,
        expected_visibility text, source_arguments jsonb
      ) returns boolean language sql immutable as $$
        select response->>'ok' = 'true'
          and response#>>'{remoteState,providerStatus}' = expected_status
          and response#>>'{remoteState,visibility}' = expected_visibility
      $$;
      create function sellerpilot_private.apply_exact_qoo10_s1_activation_listing(job_id uuid)
      returns boolean language plpgsql as $$
      begin
        insert into sellerpilot_private.projection_calls values (job_id);
        return true;
      end;
      $$;
    `);
    for (const name of [
      "sellerpilot_private.qoo10_exact_remote_items",
      "sellerpilot_private.qoo10_exact_aliases_consistent",
      "sellerpilot_private.qoo10_exact_activation_keyword_binding_valid",
    ]) {
      await db.exec(functionDefinition(sql, name));
    }
    await db.exec(functionDefinition(
      sql,
      "sellerpilot_private.record_exact_qoo10_s1_activation_outcome",
    ));
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(id,status,request_payload)
       values ($1,'reconciliation_required',$2::jsonb)`,
      [sourceJobId, JSON.stringify({ arguments: sourceArguments })],
    );
    const insertCase = async ({
      jobId,
      status,
      started,
      consumed,
      response,
      markerKeyword = "No Brand,購入前確認",
    }) => {
      const verifierId = crypto.randomUUID();
      await db.query(
        `insert into sellerpilot_private.channel_gateway_jobs
         (id,status,completed_at,provider_mutation_started_at,response_payload,
          request_payload)
         values ($1,$2,'2026-08-31 00:00:06+00',$3::timestamptz,$4::jsonb,
                 $5::jsonb)`,
        [
          jobId,
          status,
          started,
          response === null ? null : JSON.stringify(response),
          JSON.stringify({
            arguments: {
              sellerpilotQoo10S1Activation: {
                expectedKeyword: markerKeyword,
              },
            },
          }),
        ],
      );
      await db.query(
        `insert into sellerpilot_private.qoo10_exact_s1_observations
         values ($1,$2::jsonb)`,
        [verifierId, JSON.stringify({ expectedKeyword: "No Brand,購入前確認" })],
      );
      await db.query(
        `insert into sellerpilot_private.qoo10_exact_s1_activation_permits values
         ($1,$2,$3,$4,'1217336970',$5::timestamptz,$6,$7)`,
        [
          jobId,
          sourceJobId,
          verifierId,
          listingId,
          consumed,
          claimId,
          workerId,
        ],
      );
      await db.query(
        "insert into sellerpilot_private.gateway_completion_receipts values ($1,$2,$3)",
        [jobId, claimId, workerId],
      );
      return scalar(
        db,
        "select sellerpilot_private.record_exact_qoo10_s1_activation_outcome($1) value",
        [jobId],
      );
    };
    assert.equal(await insertCase({
      jobId: explicitJobId,
      status: "succeeded",
      started: "2026-08-31 00:00:03+00",
      consumed: "2026-08-31 00:00:03+00",
      response: explicitResponse,
    }), true);
    assert.equal(await insertCase({
      jobId: preProviderJobId,
      status: "failed",
      started: null,
      consumed: null,
      response: null,
    }), true);
    const keywordDriftResponse = structuredClone(explicitResponse);
    keywordDriftResponse.steps[1].data.ResultObject.Keyword =
      sourceArguments.params.Keyword;
    await assert.rejects(
      insertCase({
        jobId: keywordDriftJobId,
        status: "succeeded",
        started: "2026-08-31 00:00:03+00",
        consumed: "2026-08-31 00:00:03+00",
        response: keywordDriftResponse,
      }),
      /exact Qoo10 activation terminal evidence invalid/,
      "source-prefix keyword drift cannot terminalize as an explicit reject",
    );
    const leadingZeroResponse = structuredClone(explicitResponse);
    leadingZeroResponse.steps[0].data.ResultCode = "01";
    await assert.rejects(
      insertCase({
        jobId: leadingZeroJobId,
        status: "succeeded",
        started: "2026-08-31 00:00:03+00",
        consumed: "2026-08-31 00:00:03+00",
        response: leadingZeroResponse,
      }),
      /exact Qoo10 activation terminal evidence invalid/,
      "leading-zero ResultCode cannot prove a canonical explicit rejection",
    );
    assert.equal(await insertCase({
      jobId: uncertainJobId,
      status: "reconciliation_required",
      started: "2026-08-31 00:00:03+00",
      consumed: "2026-08-31 00:00:03+00",
      response: null,
    }), true);
    assert.deepEqual(
      (await db.query(
        `select activation_job_id::text as job_id,terminal_status
           from sellerpilot_private.qoo10_exact_s1_activation_outcomes
          order by activation_job_id`,
      )).rows,
      [
        { job_id: explicitJobId, terminal_status: "failed" },
        { job_id: preProviderJobId, terminal_status: "failed" },
        { job_id: uncertainJobId, terminal_status: "reconciliation_required" },
      ],
    );
    assert.equal(
      await scalar(db, "select count(*)::integer value from sellerpilot_private.projection_calls"),
      0,
      "no failed or uncertain terminal path may promote the listing",
    );
  } finally {
    await db.close();
  }
});
