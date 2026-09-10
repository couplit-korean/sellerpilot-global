import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260910045000_lazada_create_raw_readback_and_current_state_hardening_r7.sql",
  import.meta.url,
);
const PRODUCT_ID = "71111111-1111-4111-8111-111111111111";
const LISTING_ID = "81111111-1111-4111-8111-111111111111";
const JOB_ID = "91111111-1111-4111-8111-111111111111";
const STAMP = "2026-09-10T00:00:00.000Z";

function sha(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema sellerpilot_private;
    create table sellerpilot_private.products (
      id uuid primary key,
      status text not null,
      demo boolean not null,
      on_hand integer not null,
      updated_at timestamptz not null
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      product_id uuid not null,
      channel_key text not null,
      status text not null,
      remote_id text,
      updated_at timestamptz not null
    );
    insert into sellerpilot_private.products
      (id, status, demo, on_hand, updated_at)
      values ('${PRODUCT_ID}', 'draft', false, 3, '${STAMP}');
    insert into sellerpilot_private.product_listings
      (id, product_id, channel_key, status, remote_id, updated_at)
      values ('${LISTING_ID}', '${PRODUCT_ID}', 'lazada', 'draft', null, '${STAMP}');
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  return db;
}

test("Lazada r7 identifiers stay under 63 bytes and keep POST vs GET receipts apart", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const names = [
    "sellerpilot_lzd_store_post_rcpt_r7",
    "sellerpilot_lzd_store_get_rcpt_r7",
    "sellerpilot_lzd_cas_current_src_r7",
    "lazada_create_raw_receipts_r7",
  ];
  for (const name of names) {
    assert.ok(name.length <= 63, name);
    assert.match(sql, new RegExp(name, "u"));
  }
  assert.match(sql, /receipt_kind in \('post_create', 'get_recovery'\)/u);
  assert.match(sql, /http_path <> '\/products\/get'/u);
});

test("Lazada r7 CAS detects product and listing drift when updated_at is unchanged", async () => {
  const db = await fixture();
  const ok = await db.query(
    `select public.sellerpilot_lzd_cas_current_src_r7(
      $1::uuid, $2::uuid, $3::timestamptz, 'draft', false, 3,
      $3::timestamptz, 'draft', null) as ok`,
    [PRODUCT_ID, LISTING_ID, STAMP],
  );
  assert.equal(ok.rows[0].ok, true);

  await db.query(
    `update sellerpilot_private.products
        set status = 'archived', demo = true, on_hand = 0
      where id = $1`,
    [PRODUCT_ID],
  );
  await assert.rejects(
    () => db.query(
      `select public.sellerpilot_lzd_cas_current_src_r7(
        $1::uuid, $2::uuid, $3::timestamptz, 'draft', false, 3,
        $3::timestamptz, 'draft', null)`,
      [PRODUCT_ID, LISTING_ID, STAMP],
    ),
    /LAZADA_MY_CREATE_CURRENT_SOURCE_DRIFT/u,
  );

  await db.query(
    `update sellerpilot_private.products
        set status = 'draft', demo = false, on_hand = 3
      where id = $1`,
    [PRODUCT_ID],
  );
  await db.query(
    `update sellerpilot_private.product_listings
        set status = 'queued', remote_id = '987654321'
      where id = $1`,
    [LISTING_ID],
  );
  await assert.rejects(
    () => db.query(
      `select public.sellerpilot_lzd_cas_current_src_r7(
        $1::uuid, $2::uuid, $3::timestamptz, 'draft', false, 3,
        $3::timestamptz, 'draft', null)`,
      [PRODUCT_ID, LISTING_ID, STAMP],
    ),
    /LAZADA_MY_CREATE_CURRENT_SOURCE_DRIFT/u,
  );
});

test("Lazada r7 GET-only recovery cannot store a synthesized CreateProduct from /products/get", async () => {
  const db = await fixture();
  const requestBytes = JSON.stringify({ method: "GET", path: "/products/get" });
  const responseBytes = JSON.stringify({
    code: "0",
    data: {
      sku_list: [{ seller_sku: "SP-MY-A", sku_id: "1" }],
      item_id: "987654321",
    },
  });
  await assert.rejects(
    () => db.query(
      `select public.sellerpilot_lzd_store_get_rcpt_r7(
        $1::uuid, 'GET', '/products/get', $2, $3, $4, $5)`,
      [JOB_ID, requestBytes, responseBytes, sha(requestBytes), sha(responseBytes)],
    ),
    /LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE/u,
  );
  await assert.rejects(
    () => db.query(
      `select public.sellerpilot_lzd_store_post_rcpt_r7(
        $1::uuid, 'GET', '/product/create', $2, $3, $4, $5)`,
      [JOB_ID, requestBytes, responseBytes, sha(requestBytes), sha(responseBytes)],
    ),
    /LAZADA_MY_CREATE_POST_RECEIPT_REQUIRED/u,
  );

  const postRequest = JSON.stringify({ method: "POST", path: "/product/create" });
  const postResponse = JSON.stringify({
    code: "0",
    data: { item_id: "987654321", sku_list: [{ seller_sku: "SP-MY-A", sku_id: "1" }] },
  });
  const stored = await db.query(
    `select public.sellerpilot_lzd_store_post_rcpt_r7(
      $1::uuid, 'POST', '/product/create', $2, $3, $4, $5) as id`,
    [JOB_ID, postRequest, postResponse, sha(postRequest), sha(postResponse)],
  );
  assert.ok(stored.rows[0].id);

  const itemRequest = JSON.stringify({
    method: "GET",
    path: "/product/item/get",
    params: { item_id: "987654321" },
  });
  const itemResponse = JSON.stringify({
    code: "0",
    data: { item_id: "987654321", skus: [{ SellerSku: "SP-MY-A", SkuId: "1" }] },
  });
  const recovered = await db.query(
    `select public.sellerpilot_lzd_store_get_rcpt_r7(
      $1::uuid, 'GET', '/product/item/get', $2, $3, $4, $5) as id`,
    [JOB_ID, itemRequest, itemResponse, sha(itemRequest), sha(itemResponse)],
  );
  assert.ok(recovered.rows[0].id);

  const kinds = await db.query(
    `select receipt_kind, http_method, http_path
       from sellerpilot_private.lazada_create_raw_receipts_r7
      order by receipt_kind`,
  );
  assert.deepEqual(kinds.rows, [
    { receipt_kind: "get_recovery", http_method: "GET", http_path: "/product/item/get" },
    { receipt_kind: "post_create", http_method: "POST", http_path: "/product/create" },
  ]);
});
