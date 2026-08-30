import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260828145500_persist_elevenst_listing_update_snapshots.sql",
  import.meta.url,
);

const credentialId = "10000000-0000-4000-8000-000000000001";
const listingId = "20000000-0000-4000-8000-000000000001";
const jobId = "30000000-0000-4000-8000-000000000001";
const sellerKey = "a".repeat(64);
const qaRemoteId = "9573255804";
const fullProduct = {
  selMthdCd: "01",
  dispCtgrNo: "1341821",
  prdTypCd: "01",
  prdNm: "부착형 케이블 정리 클립 6개 세트",
  brand: "No Brand",
  rmaterialTypCd: "04",
  orgnTypCd: "03",
  orgnNmVal: "중국",
  sellerPrdCd: "QA-001",
  suplDtyfrPrdClfCd: "01",
  forAbrdBuyClf: "01",
  prdStatCd: "01",
  minorSelCnYn: "Y",
  prdImage01: "https://example.com/product.jpg",
  htmlDetail: "<p>QA 등록 검증용 상품입니다.</p>",
  ProductCertGroup: [
    { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
    { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
    { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
    { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
  ],
  selPrdClfCd: "3y:110",
  aplBgnDy: "2026/08/30",
  aplEndDy: "2029/08/29",
  selPrc: "5000",
  prdSelQty: "1",
  dlvCnAreaCd: "01",
  dlvWyCd: "01",
  dlvCstInstBasiCd: "01",
  bndlDlvCnYn: "Y",
  dlvCstPayTypCd: "03",
  rtngdDlvCst: "0",
  exchDlvCst: "0",
  asDetail: "11번가 판매자 문의 이용",
  rtngExchDetail: "11번가 반품·교환 정책 확인",
  ProductNotification: {
    type: "891045",
    item: [
      { code: "11800", name: "부착형 케이블 정리 클립 6개 세트" },
      { code: "11905", name: "No Brand" },
      { code: "23760413", name: "11번가 판매자 문의 이용" },
      { code: "23759100", name: "중국" },
      { code: "23756033", name: "해당사항 없음" },
    ],
  },
};

test("11st successful create and update preserve a seller-bound full Product snapshot", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_credentials (
        id uuid primary key,
        channel text not null,
        status text not null,
        expires_at timestamptz,
        seller_account_key text,
        seller_account_key_source text,
        seller_account_verified_at timestamptz
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key,
        channel_key text not null,
        remote_id text,
        seller_account_key text
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        listing_id uuid,
        credential_id uuid not null,
        channel text not null,
        operation text not null,
        status text not null,
        request_payload jsonb not null,
        response_payload jsonb,
        seller_account_key text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        completed_at timestamptz
      );
    `);
    await db.query(
      `insert into sellerpilot_private.channel_credentials (
         id, channel, status, seller_account_key, seller_account_key_source,
         seller_account_verified_at
       ) values ($1, 'elevenst', 'active', $2, 'credential_incarnation_v1', now())`,
      [credentialId, sellerKey],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         id, channel_key, remote_id, seller_account_key
       ) values ($1, 'elevenst', $2, $3)`,
      [listingId, qaRemoteId, sellerKey],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, listing_id, credential_id, channel, operation, status,
         request_payload, seller_account_key
       ) values (
         $1, $2, $3, 'elevenst', 'listing.create', 'queued',
         jsonb_build_object('arguments', jsonb_build_object('product', $4::jsonb)),
         $5
       )`,
      [jobId, listingId, credentialId, JSON.stringify(fullProduct), sellerKey],
    );

    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = jsonb_build_object(
                'ok', true, 'channel', 'elevenst', 'operation', 'listing.create',
                'remoteId', $2::text
              ),
              completed_at = now(), updated_at = now()
        where id = $1`,
      [jobId, qaRemoteId],
    );
    assert.deepEqual(
      (await db.query(
        `select remote_id, source_operation, revision,
                product_payload->>'prdNm' as product_name,
                product_payload->>'selPrc' as price
           from sellerpilot_private.elevenst_listing_snapshots
          where listing_id = $1`,
        [listingId],
      )).rows,
      [{
        remote_id: qaRemoteId,
        source_operation: "listing.create",
        revision: 1,
        product_name: fullProduct.prdNm,
        price: fullProduct.selPrc,
      }],
    );

    await db.exec("select set_config('request.jwt.claim.role', 'service_role', false)");
    const snapshot = (await db.query(
      "select public.sellerpilot_service_get_elevenst_listing_snapshot($1, $2, $3) as snapshot",
      [listingId, credentialId, qaRemoteId],
    )).rows[0].snapshot;
    assert.equal(snapshot.remoteId, qaRemoteId);
    assert.equal(snapshot.revision, 1);
    assert.deepEqual(snapshot.product, fullProduct);
    assert.equal(snapshot.product.dispCtgrNo, "1341821");
    assert.equal(
      (await db.query(
        "select public.sellerpilot_service_get_elevenst_listing_snapshot($1, $2, '999999999') as snapshot",
        [listingId, credentialId],
      )).rows[0].snapshot,
      null,
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'queued', response_payload = null,
              request_payload = jsonb_build_object(
                'arguments', jsonb_build_object(
                  'product', jsonb_set($2::jsonb, '{dispCtgrNo}', '"1341822"'::jsonb)
                )
              ),
              completed_at = null, updated_at = now()
        where id = $1`,
      [jobId, JSON.stringify(fullProduct)],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = jsonb_build_object(
                'ok', true, 'channel', 'elevenst', 'operation', 'listing.create',
                'remoteId', $2::text
              ),
              completed_at = now(), updated_at = now()
        where id = $1`,
      [jobId, qaRemoteId],
    );
    const afterWrongCategory = (await db.query(
      `select revision, product_payload->>'dispCtgrNo' as category_id
         from sellerpilot_private.elevenst_listing_snapshots
        where listing_id = $1`,
      [listingId],
    )).rows[0];
    assert.deepEqual(afterWrongCategory, { revision: 1, category_id: "1341821" });
  } finally {
    await db.close();
  }
});
