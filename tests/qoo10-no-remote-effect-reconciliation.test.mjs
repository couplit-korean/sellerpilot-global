import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901083000_reconcile_exact_qoo10_uncertain_no_remote_effect.sql",
  import.meta.url,
);
const legacyPayloadMigrationUrl = new URL(
  "../supabase/migrations/20260901084000_bind_qoo10_no_effect_legacy_fac9_payload.sql",
  import.meta.url,
);
const LEGACY_SOURCE_JOB_ID = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
const REMOTE_ID = "1217336970";
const SELLER_SKU = "QA-20260823-CC-001";
const TITLE = "貼り付け式ケーブル整理クリップ6個セット";
const IMAGE_URLS = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/qoo10-no-effect-${index + 1}.jpg`,
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

function fixture() {
  const detailHtml = `<section lang="ja-JP"><p>${"商品説明".repeat(30)}</p>${IMAGE_URLS
    .map((url) => `<img src="${url}">`)
    .join("")}</section>`;
  return {
    ItemNo: REMOTE_ID,
    ItemCode: REMOTE_ID,
    ItemStatus: "S1",
    Status: "S1",
    SellerCode: SELLER_SKU,
    ItemTitle: TITLE,
    RetailPrice: "1871.0000",
    SellPrice: "1871.0000",
    ItemPrice: "1871.0000",
    ItemQty: "1",
    Qty: "1",
    ImageUrl: "https://gd.image-qoo10.jp/li/963/402/8461402963.g.jpg",
    StandardImage: "https://gd.image-qoo10.jp/li/963/402/8461402963.g.jpg",
    ItemDetail: detailHtml,
    Description: detailHtml,
  };
}

function legacyArguments() {
  return {
    params: {
      ItemCode: REMOTE_ID,
      SecondSubCat: "320000542",
      ProductionPlaceType: "2",
      ProductionPlace: "CN",
      RetailPrice: "1871",
      ShippingNo: "806971",
      AdultYN: "N",
    },
    sellerpilotQoo10RollbackUpdateRecovery: {
      status: "allowed",
      contract: "qoo10_create_rollback_confirmation_v1",
      listingId: "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
      remoteId: REMOTE_ID,
      providerStatus: "S1",
      sourceJobId: "73000000-0000-4000-8000-000000000001",
      expectedState: {
        categoryCode: "320000542",
        retailPriceJpy: 1871,
        sellPriceJpy: 1871,
        quantity: 1,
        shippingNo: "806971",
        biContentsNo: 8461402963,
      },
    },
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
  };
}

async function scalar(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0]?.value;
}

async function snapshotDatabase() {
  const db = new PGlite();
  await db.exec(String.raw`
    create schema sellerpilot_private;
    create schema extensions;
    create function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable as $$
      select case when lower(algorithm)='sha256'
        then sha256(convert_to(value,'UTF8'))
        else convert_to(md5(value||algorithm),'UTF8') end
    $$;
    create function sellerpilot_private.qoo10_exact_detail_image_urls(value text)
    returns jsonb language sql immutable as $$
      select coalesce(
        jsonb_agg(to_jsonb(found.match[1]) order by found.ordinality),
        '[]'::jsonb
      )
      from regexp_matches(
        coalesce(value,''),
        '<img[^>]+src="([^"]+)"',
        'g'
      ) with ordinality as found(match,ordinality)
    $$;
  `);
  const migration = await readFile(migrationUrl, "utf8");
  for (const signature of [
    "create function sellerpilot_private.qoo10_exact_no_effect_items(",
    "create function sellerpilot_private.qoo10_exact_no_effect_alias_value(",
    "create function sellerpilot_private.qoo10_exact_no_effect_snapshot(",
    "create function sellerpilot_private.qoo10_exact_no_effect_snapshots_identical(",
  ]) await db.exec(extractFunction(migration, signature));
  const legacyPayloadMigration = await readFile(legacyPayloadMigrationUrl, "utf8");
  for (const signature of [
    "create or replace function sellerpilot_private.qoo10_exact_no_effect_alias_value(",
    "create or replace function sellerpilot_private.qoo10_exact_no_effect_snapshot(",
  ]) await db.exec(extractFunction(legacyPayloadMigration, signature));
  return db;
}

test("exact Qoo10 no-effect snapshot binds every required material field", async () => {
  const db = await snapshotDatabase();
  try {
    const snapshot = await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_no_effect_snapshot($1::jsonb) value",
      [JSON.stringify(fixture())],
    );
    assert.equal(snapshot.remoteId, REMOTE_ID);
    assert.equal(snapshot.title, TITLE);
    assert.equal(snapshot.sellerSku, SELLER_SKU);
    assert.equal(snapshot.providerStatus, "S1");
    assert.equal(Number(snapshot.retailPriceJpy), 1871);
    assert.equal(Number(snapshot.sellPriceJpy), 1871);
    assert.equal(Number(snapshot.quantity), 1);
    assert.match(snapshot.representativeImageSha256, /^[a-f0-9]{64}$/u);
    assert.match(snapshot.detailHtmlSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(snapshot.detailImageUrls, IMAGE_URLS);
    assert.match(snapshot.detailImagesSha256, /^[a-f0-9]{64}$/u);
    assert.match(snapshot.snapshotSha256, /^[a-f0-9]{64}$/u);
  } finally {
    await db.close();
  }
});

test("partial changes in title, SKU, status, price, stock, representative, HTML, or images all fail closed", async () => {
  const db = await snapshotDatabase();
  try {
    const prewrite = fixture();
    const changes = [
      ["title", (item) => { item.ItemTitle = "別の商品"; }],
      ["seller SKU", (item) => { item.SellerCode = "OTHER-SKU"; }],
      ["status", (item) => { item.ItemStatus = "S2"; item.Status = "S2"; }],
      ["retail price", (item) => { item.RetailPrice = "1872.0000"; }],
      ["sell price", (item) => { item.SellPrice = "1872.0000"; item.ItemPrice = "1872.0000"; }],
      ["stock", (item) => { item.ItemQty = "2"; item.Qty = "2"; }],
      ["representative", (item) => {
        item.ImageUrl = "https://gd.image-qoo10.jp/li/964/402/8461402964.g.jpg";
        item.StandardImage = item.ImageUrl;
      }],
      ["detail HTML", (item) => { item.ItemDetail = item.ItemDetail.replace("商品説明", "別説明"); item.Description = item.ItemDetail; }],
      ["ordered detail images", (item) => {
        item.ItemDetail = item.ItemDetail.replace(IMAGE_URLS[7], "https://cdn.example.test/drift.jpg");
        item.Description = item.ItemDetail;
      }],
    ];
    for (const [name, mutate] of changes) {
      const current = structuredClone(prewrite);
      mutate(current);
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.qoo10_exact_no_effect_snapshots_identical($1::jsonb,$2::jsonb) value",
          [JSON.stringify(prewrite), JSON.stringify(current)],
        ),
        false,
        name,
      );
    }
  } finally {
    await db.close();
  }
});

test("legacy prewrite content is accepted only when current raw title and HTML are byte-identical", async () => {
  const db = await snapshotDatabase();
  try {
    const prewrite = fixture();
    prewrite.ItemTitle = "buchakhyeong keibeul jeongri keullip 6gaeset";
    const identical = structuredClone(prewrite);
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.qoo10_exact_no_effect_snapshots_identical($1::jsonb,$2::jsonb) value",
        [JSON.stringify(prewrite), JSON.stringify(identical)],
      ),
      true,
    );

    for (const [name, mutate] of [
      ["title trailing whitespace", (item) => { item.ItemTitle += " "; }],
      ["detail HTML trailing whitespace", (item) => {
        item.ItemDetail += " ";
        item.Description = item.ItemDetail;
      }],
    ]) {
      const changed = structuredClone(prewrite);
      mutate(changed);
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.qoo10_exact_no_effect_snapshots_identical($1::jsonb,$2::jsonb) value",
          [JSON.stringify(prewrite), JSON.stringify(changed)],
        ),
        false,
        name,
      );
    }
  } finally {
    await db.close();
  }
});

test("missing, partial, duplicate, and contradictory readback evidence all fail closed", async () => {
  const db = await snapshotDatabase();
  try {
    const complete = fixture();
    const variants = [];
    for (const [field, keys] of [
      ["title", ["ItemTitle"]],
      ["seller SKU", ["SellerCode"]],
      ["status", ["ItemStatus", "Status"]],
      ["retail price", ["RetailPrice"]],
      ["sell price", ["SellPrice", "ItemPrice"]],
      ["stock", ["ItemQty", "Qty"]],
      ["representative", ["ImageUrl", "StandardImage"]],
      ["detail HTML", ["ItemDetail", "Description"]],
    ]) {
      const value = structuredClone(complete);
      for (const key of keys) delete value[key];
      variants.push([`missing ${field}`, value]);
    }
    variants.push(["partial object", { ItemNo: REMOTE_ID, ItemTitle: TITLE }]);
    variants.push(["duplicate exact items", [complete, structuredClone(complete)]]);
    variants.push(["contradictory price alias", { ...complete, ItemPrice: "1872.0000" }]);
    variants.push(["contradictory representative alias", {
      ...complete,
      StandardImage: "https://gd.image-qoo10.jp/li/964/402/8461402964.g.jpg",
    }]);
    variants.push(["seven detail images", {
      ...complete,
      ItemDetail: complete.ItemDetail.replace(`<img src="${IMAGE_URLS[7]}">`, ""),
      Description: complete.Description.replace(`<img src="${IMAGE_URLS[7]}">`, ""),
    }]);
    for (const [name, current] of variants) {
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.qoo10_exact_no_effect_snapshots_identical($1::jsonb,$2::jsonb) value",
          [JSON.stringify(complete), JSON.stringify(current)],
        ),
        false,
        name,
      );
    }
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.qoo10_exact_no_effect_snapshots_identical(null,$1::jsonb) value",
        [JSON.stringify(complete)],
      ),
      false,
    );
  } finally {
    await db.close();
  }
});

test("reconciliation mutates no ledger state before exact snapshot equality and gates both downstream permits", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const exact of [
    "ddccde35-9c58-4856-b673-d7aa27ce4220",
    "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
    "2b49d081-5188-4a75-9555-e0a6438e8a2b",
    "1217336970",
    "QA-20260823-CC-001",
  ]) assert.match(sql, new RegExp(exact, "u"));
  const reconcile = extractFunction(
    sql,
    "create function public.sellerpilot_service_reconcile_exact_qoo10_no_remote_effect(",
  );
  const equality = reconcile.indexOf("qoo10_exact_no_effect_snapshots_identical");
  const ledgerInsert = reconcile.indexOf(
    "insert into sellerpilot_private.qoo10_exact_no_effect_reconciliations",
  );
  const sourceUpdate = reconcile.indexOf(
    "update sellerpilot_private.channel_gateway_jobs source",
  );
  assert.ok(equality >= 0 && ledgerInsert > equality && sourceUpdate > ledgerInsert);
  assert.match(reconcile, /v_prewrite is null or v_current is null/u);
  assert.match(reconcile, /current readback differs from prewrite snapshot/u);
  assert.match(reconcile, /status='failed'/u);
  assert.match(reconcile, /resolution','no_remote_effect'/u);
  assert.match(reconcile, /provider_call_replayed',false/u);
  assert.match(reconcile, /later mutation prevents no-effect attribution/u);
  assert.match(sql, /sellerpilot_service_arm_exact_qoo10_localization_update[\s\S]*qoo10_exact_no_effect_reconciliations/u);
  assert.match(sql, /sellerpilot_service_enqueue_exact_qoo10_localization_activation[\s\S]*qoo10_exact_no_effect_reconciliations/u);
  assert.match(sql, /activationStillRequiresFreshS1Verifier',true/u);
  assert.doesNotMatch(reconcile, /insert into sellerpilot_private\.channel_gateway_jobs/u);
});

test("legacy fac9 SQL validator binds the known pre-v2 payload while v2-only fields fail closed", async () => {
  const db = new PGlite();
  try {
    await db.exec(String.raw`
      create schema sellerpilot_private;
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select decode(
          case when value::jsonb ? 'arguments'
            then 'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
            else 'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
          end,
          'hex'
        )
      $$;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        request_payload jsonb not null,
        response_payload jsonb not null
      );
    `);
    const migration = await readFile(legacyPayloadMigrationUrl, "utf8");
    await db.exec(extractFunction(
      migration,
      "create or replace function\nsellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(",
    ));
    const insertSource = async (argumentsValue) => {
      await db.query(String.raw`
        insert into sellerpilot_private.channel_gateway_jobs (
          id,request_payload,response_payload
        ) values (
          $1,
          jsonb_build_object(
            'arguments',$2::jsonb,
            'padding',repeat('x',23555-pg_catalog.octet_length(
              jsonb_build_object('arguments',$2::jsonb,'padding','')::text
            ))
          ),
          jsonb_build_object(
            'padding',repeat('x',16669-pg_catalog.octet_length(
              jsonb_build_object('padding','')::text
            ))
          )
        )
        on conflict (id) do update set
          request_payload=excluded.request_payload,
          response_payload=excluded.response_payload
      `, [LEGACY_SOURCE_JOB_ID, JSON.stringify(argumentsValue)]);
    };
    const valid = legacyArguments();
    await insertSource(valid);
    assert.equal(await scalar(
      db,
      "select sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid($1,$2::jsonb,$3) value",
      [LEGACY_SOURCE_JOB_ID, JSON.stringify(valid), "b".repeat(40)],
    ), true);

    for (const mutate of [
      (value) => { value.params.ItemPrice = "1871"; },
      (value) => { value.params.ItemQty = "1"; },
      (value) => { value.sellerpilotQoo10RollbackUpdateRecovery.expectedState.quantity = 2; },
    ]) {
      const invalid = structuredClone(valid);
      mutate(invalid);
      await insertSource(invalid);
      assert.equal(await scalar(
        db,
        "select sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid($1,$2::jsonb,$3) value",
        [LEGACY_SOURCE_JOB_ID, JSON.stringify(invalid), "b".repeat(40)],
      ), false);
    }
  } finally {
    await db.close();
  }
});
