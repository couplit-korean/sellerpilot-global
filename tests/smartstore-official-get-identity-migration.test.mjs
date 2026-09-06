import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260907171000_smartstore_official_get_identity.sql",
  import.meta.url,
), "utf8");

const sellerSku = "AUTO-GENERIC-SMARTSTORE-001";
const originProductNo = "13688607602";
const channelProductNo = "13749310594";
const detailUrls = Array.from(
  { length: 8 },
  (_, index) => `https://shop-phinf.pstatic.net/detail/${index + 1}.png`,
);

function originProduct() {
  return {
    name: "롯샌 파인애플 315g",
    salePrice: 3190,
    stockQuantity: 10,
    statusType: "SALE",
    detailContent: `<section>${detailUrls.map((url) => `<img src="${url}">`).join("")}</section>`,
    detailAttribute: {
      sellerCodeInfo: { sellerManagementCode: sellerSku },
    },
    images: {
      representativeImage: {
        url: "https://shop-phinf.pstatic.net/main/representative.png",
      },
      optionalImages: detailUrls.map((url) => ({ url })),
    },
  };
}

function officialReadback() {
  const product = originProduct();
  return {
    searchReadback: {
      path: "/v1/products/search",
      response: {
        page: 1,
        size: 50,
        totalElements: 1,
        totalPages: 1,
        first: true,
        last: true,
        contents: [{
          originProductNo,
          channelProducts: [{
            channelProductNo,
            originProductNo,
            sellerManagementCode: sellerSku,
          }],
        }],
      },
    },
    originReadback: {
      path: `/v2/products/origin-products/${originProductNo}`,
      response: {
        originProduct: structuredClone(product),
        smartstoreChannelProduct: {
          channelProductName: product.name,
          channelProductDisplayStatusType: "ON",
        },
      },
    },
    channelReadback: {
      path: `/v2/products/channel-products/${channelProductNo}`,
      response: {
        originProduct: structuredClone(product),
        smartstoreChannelProduct: {
          channelProductName: product.name,
          channelProductDisplayStatusType: "ON",
        },
      },
    },
  };
}

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema sellerpilot_private;

    create function public.sellerpilot_service_commit_smartstore_manual_adoption(
      p_actor uuid,
      p_product_id uuid,
      p_source_job_id uuid,
      p_credential_id uuid,
      p_expected_approval_revision bigint,
      p_expected_content_sha256 text,
      p_expected_manifest_digest text,
      p_readback jsonb
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    set timezone = 'UTC'
    as $$
    declare
      origin_response jsonb;
      origin_product jsonb;
      embedded_channel jsonb;
      channel_response jsonb;
      channel_product jsonb;
      search_response jsonb;
      origin_no text;
      channel_no text;
      seller_sku text := '${sellerSku}';
    begin
      search_response := p_readback#>'{searchReadback,response}';
      origin_response := p_readback#>'{originReadback,response}';
      origin_product := origin_response->'originProduct';
      embedded_channel := origin_response->'smartstoreChannelProduct';
      channel_response := p_readback#>'{channelReadback,response}';
      channel_product := channel_response->'smartstoreChannelProduct';
  origin_no := trim(coalesce(origin_response->>'originProductNo',origin_product->>'originProductNo',''));
  channel_no := trim(coalesce(
    origin_response->>'smartstoreChannelProductNo',embedded_channel->>'channelProductNo',''
  ));
  if origin_no !~ '^[0-9]+$' or channel_no !~ '^[0-9]+$'
     or p_readback#>>'{originReadback,path}'
       is distinct from '/v2/products/origin-products/' || origin_no
     or p_readback#>>'{channelReadback,path}'
       is distinct from '/v2/products/channel-products/' || channel_no
     or coalesce(channel_product->>'channelProductNo',channel_product->>'smartstoreChannelProductNo')
       is distinct from channel_no
     or coalesce(channel_product->>'originProductNo',channel_response->>'originProductNo')
       is distinct from origin_no
     or origin_product->>'statusType' <> 'SALE'
     or channel_product->>'channelProductDisplayStatusType' <> 'ON'
     or origin_product#>>'{detailAttribute,sellerCodeInfo,sellerManagementCode}'
       is distinct from seller_sku then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_IDENTITY_INVALID';
  end if;
      if false then
        raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH';
        raise exception 'SMARTSTORE_MANUAL_ADOPTION_DETAIL_IMAGES_INVALID';
      end if;
      return jsonb_build_object(
        'originProductNo',origin_no,
        'channelProductNo',channel_no
      );
    end;
    $$;
    revoke all on function public.sellerpilot_service_commit_smartstore_manual_adoption(
      uuid,uuid,uuid,uuid,bigint,text,text,jsonb
    ) from public,anon,authenticated,service_role;
    grant execute on function public.sellerpilot_service_commit_smartstore_manual_adoption(
      uuid,uuid,uuid,uuid,bigint,text,text,jsonb
    ) to service_role;
  `);
  await db.exec(migration);
  return db;
}

async function commit(db, readback) {
  return (await db.query(`
    select public.sellerpilot_service_commit_smartstore_manual_adoption(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000004',
      1,repeat('a',64),repeat('b',64),$1::jsonb
    ) result
  `, [JSON.stringify(readback)])).rows[0].result;
}

test("171000 accepts official v2 GET bodies without undocumented ID echoes", async () => {
  const db = await database();
  try {
    const result = await commit(db, officialReadback());
    assert.deepEqual(result, { originProductNo, channelProductNo });

    const definition = (await db.query(`
      select pg_get_functiondef(
        'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'::regprocedure
      ) value
    `)).rows[0].value;
    assert.match(definition, /smartstore_manual_adoption_official_identity/u);
    assert.doesNotMatch(
      definition,
      /origin_no := trim\(coalesce\(origin_response->>'originProductNo'/u,
    );

    const acl = await db.query(`
      select
        has_function_privilege('service_role',$1,'EXECUTE') service_allowed,
        has_function_privilege('anon',$1,'EXECUTE') anon_allowed,
        has_function_privilege('authenticated',$1,'EXECUTE') authenticated_allowed
    `, [
      "public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)",
    ]);
    assert.equal(acl.rows[0].service_allowed, true);
    assert.equal(acl.rows[0].anon_allowed, false);
    assert.equal(acl.rows[0].authenticated_allowed, false);
  } finally {
    await db.close();
  }
});

test("171000 rejects every supplied conflicting GET ID echo", async () => {
  const db = await database();
  try {
    const mutations = [
      (value) => { value.originReadback.response.originProductNo = "99999999999"; },
      (value) => { value.originReadback.response.originProduct.originProductNo = null; },
      (value) => { value.originReadback.response.smartstoreChannelProductNo = "99999999999"; },
      (value) => { value.originReadback.response.smartstoreChannelProduct.channelProductNo = "99999999999"; },
      (value) => { value.originReadback.response.smartstoreChannelProduct.originProductNo = "99999999999"; },
      (value) => { value.channelReadback.response.channelProductNo = "99999999999"; },
      (value) => { value.channelReadback.response.smartstoreChannelProduct.channelProductNo = "99999999999"; },
      (value) => { value.channelReadback.response.originProductNo = "99999999999"; },
      (value) => { value.channelReadback.response.originProduct.originProductNo = "99999999999"; },
    ];
    for (const mutate of mutations) {
      const readback = officialReadback();
      mutate(readback);
      await assert.rejects(
        commit(db, readback),
        /SMARTSTORE_MANUAL_ADOPTION_REMOTE_IDENTITY_INVALID/u,
      );
    }

    const matchingEchoes = officialReadback();
    matchingEchoes.originReadback.response.originProductNo = originProductNo;
    matchingEchoes.originReadback.response.smartstoreChannelProductNo = channelProductNo;
    matchingEchoes.channelReadback.response.originProductNo = originProductNo;
    matchingEchoes.channelReadback.response.smartstoreChannelProductNo = channelProductNo;
    assert.deepEqual(await commit(db, matchingEchoes), {
      originProductNo,
      channelProductNo,
    });
  } finally {
    await db.close();
  }
});

test("171000 keeps search, GET path, live status, SKU, and cross-body content guards", async () => {
  const db = await database();
  try {
    const cases = [
      ...[
        "page", "size", "totalElements", "totalPages", "first", "last",
      ].map((key) => [
        (value) => { delete value.searchReadback.response[key]; },
        /SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INVALID/u,
      ]),
      [(value) => {
        value.searchReadback.response.contents[0].channelProducts.push({
          channelProductNo: "13749310595",
          sellerManagementCode: sellerSku,
        });
      }, /SMARTSTORE_MANUAL_ADOPTION_SEARCH_IDENTITY_AMBIGUOUS/u],
      [(value) => {
        value.searchReadback.response.contents[0].originProductNo = "0";
      }, /SMARTSTORE_MANUAL_ADOPTION_SEARCH_IDENTITY_AMBIGUOUS/u],
      [(value) => {
        value.searchReadback.response.contents[0].channelProducts[0].channelProductNo =
          "123456789012345678901";
      }, /SMARTSTORE_MANUAL_ADOPTION_SEARCH_IDENTITY_AMBIGUOUS/u],
      [(value) => {
        value.searchReadback.response.contents[0].channelProducts[0].originProductNo =
          "99999999999";
      }, /SMARTSTORE_MANUAL_ADOPTION_SEARCH_IDENTITY_AMBIGUOUS/u],
      [(value) => {
        const channel = value.searchReadback.response.contents[0].channelProducts[0];
        delete channel.channelProductNo;
        channel.smartstoreChannelProductNo = channelProductNo;
      }, /SMARTSTORE_MANUAL_ADOPTION_SEARCH_IDENTITY_AMBIGUOUS/u],
      [(value) => { value.originReadback.path += "-wrong"; }, /REMOTE_IDENTITY_INVALID/u],
      [(value) => { delete value.originReadback.response.originProduct; }, /REMOTE_IDENTITY_INVALID/u],
      [(value) => { delete value.channelReadback.response.originProduct; }, /REMOTE_IDENTITY_INVALID/u],
      [(value) => {
        delete value.channelReadback.response.smartstoreChannelProduct;
      }, /REMOTE_IDENTITY_INVALID/u],
      [(value) => { value.originReadback.response.originProduct.statusType = "OUTOFSTOCK"; }, /REMOTE_IDENTITY_INVALID/u],
      [(value) => {
        value.channelReadback.response.originProduct.detailAttribute
          .sellerCodeInfo.sellerManagementCode = "OTHER-SKU";
      }, /REMOTE_IDENTITY_INVALID/u],
      [(value) => {
        value.channelReadback.response.smartstoreChannelProduct
          .channelProductDisplayStatusType = "SUSPENSION";
      }, /REMOTE_IDENTITY_INVALID/u],
      [(value) => { value.channelReadback.response.originProduct.name = "다른 상품"; }, /REMOTE_CONTENT_MISMATCH/u],
      [(value) => {
        value.channelReadback.response.originProduct.images.optionalImages[7].url =
          "https://shop-phinf.pstatic.net/detail/other.png";
      }, /REMOTE_CONTENT_MISMATCH/u],
      [(value) => {
        delete value.channelReadback.response.originProduct.images.optionalImages;
      }, /REMOTE_CONTENT_MISMATCH/u],
    ];
    for (const [mutate, error] of cases) {
      const readback = officialReadback();
      mutate(readback);
      await assert.rejects(commit(db, readback), error);
    }
  } finally {
    await db.close();
  }
});
