import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260907175300_smartstore_content_verifier_naver_canonicalization.sql",
  import.meta.url,
), "utf8");

const setup = String.raw`
create role anon;
create role authenticated;
create role service_role;
create schema sellerpilot_private;
create table sellerpilot_private.channel_gateway_jobs(request_payload jsonb);
create table sellerpilot_private.product_listings(price numeric);
create table sellerpilot_private.products(on_hand integer);

create function sellerpilot_private.smartstore_repair_html_image_urls(p_html text)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(match[1]) order by ordinal),'[]'::jsonb)
  from pg_catalog.regexp_matches(
    p_html,'<img[^>]*[[:space:]]src=["''](https://[^"'']+)["'']','gi'
  ) with ordinality matches(match,ordinal)
$$;

create function sellerpilot_private.smartstore_repair_detail_html_matches(
  p_source_html text,p_remote_html text
)
returns boolean language sql immutable set search_path='' as $$
  select p_source_html is not distinct from p_remote_html
$$;

create function public.sellerpilot_service_commit_smartstore_manual_adoption(
  p_actor uuid,p_product_id uuid,p_source_job_id uuid,p_credential_id uuid,
  p_expected_approval_revision bigint,p_expected_content_sha256 text,
  p_expected_manifest_digest text,p_readback jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
  origin_product jsonb;
  expected_origin_name text;
  expected_channel_name text;
  origin_name text;
  channel_name text;
  detail_html text;
  source_detail_html text;
  normalized_source_detail_html text;
  normalized_remote_detail_html text;
  image_token text;
  image_index integer;
begin
  expected_origin_name := p_readback#>>'{approved,originName}';
  expected_channel_name := p_readback#>>'{approved,channelName}';
  origin_name := p_readback#>>'{remote,originName}';
  channel_name := p_readback#>>'{remote,channelName}';
  detail_html := p_readback#>>'{remote,html}';
  source_detail_html := p_readback#>>'{approved,html}';
  source_job.request_payload := jsonb_build_object(
    'arguments',jsonb_build_object('body',jsonb_build_object(
      'originProduct',jsonb_build_object('name',p_readback#>>'{approved,originName}')
    ))
  );
  listing.price := 3190;
  product.on_hand := 1;
  origin_product := jsonb_build_object(
    'salePrice',p_readback#>'{remote,salePrice}',
    'stockQuantity',p_readback#>'{remote,stockQuantity}'
  );
  if coalesce(expected_origin_name,'') = ''
     or origin_name is distinct from expected_origin_name
     or source_job.request_payload#>>'{arguments,body,originProduct,name}'
       is distinct from expected_origin_name
     or coalesce(expected_channel_name,'') = ''
     or expected_channel_name is distinct from expected_origin_name
     or channel_name is distinct from expected_channel_name
     or jsonb_typeof(origin_product->'salePrice') <> 'number'
     or (origin_product->>'salePrice')::numeric is distinct from listing.price
     or jsonb_typeof(origin_product->'stockQuantity') <> 'number'
     or (origin_product->>'stockQuantity')::numeric is distinct from product.on_hand::numeric
     or coalesce(detail_html,'') = ''
     or coalesce(source_detail_html,'') = '' then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH';
  end if;

  normalized_source_detail_html := source_detail_html;
  normalized_remote_detail_html := detail_html;
  for image_index in 0..7 loop
    image_token := '__SELLERPILOT_DETAIL_IMAGE_' || (image_index + 1)::text || '__';
    if position(image_token in normalized_source_detail_html) > 0
       or position(image_token in normalized_remote_detail_html) > 0 then
      raise exception 'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_TOKEN_COLLISION';
    end if;
    normalized_source_detail_html := regexp_replace(
      normalized_source_detail_html,
      '(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1' || image_token || E'\\2',
      'i'
    );
    normalized_remote_detail_html := regexp_replace(
      normalized_remote_detail_html,
      '(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1' || image_token || E'\\2',
      'i'
    );
  end loop;
  if normalized_remote_detail_html is distinct from normalized_source_detail_html then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_MISMATCH';
  end if;
  if p_readback#>'{remote,pixels}' is distinct from p_readback#>'{approved,pixels}' then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_PIXEL_BINDING_MISMATCH';
  end if;
  return jsonb_build_object('ok',true);
end;
$$;
`;

const sourceUrls = Array.from({ length: 8 }, (_, index) => `https://source.example/${index}.jpg`);
const remoteUrls = Array.from({ length: 8 }, (_, index) => `https://shop-phinf.pstatic.net/${index}.jpg`);
const pixels = Array.from({ length: 8 }, (_, index) => `${index + 1}`.repeat(64));
const imageRoles = [
  "detail-overview",
  "detail-use",
  "detail-contents",
  "detail-routine",
  "detail-material",
  "detail-feature",
  "detail-storage",
  "detail-package",
];

function sourceHtml(overrides = {}) {
  const text = overrides.text ?? "315g &times; 6봉 &middot; 승인 문구";
  const rootAttributes = overrides.rootAttributes
    ?? 'data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14"';
  const unknownComment = overrides.unknownComment ?? "";
  const urls = overrides.urls ?? sourceUrls;
  return `<div ${rootAttributes}>${imageRoles.map((role, index) =>
    `<section data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="${role}"><p>${index === 0 ? text : `승인 섹션 ${index}`}</p>${index === 0 ? unknownComment : ""}<img src="${urls[index]}" alt="승인 ${index}"></section>`,
  ).join("")}<section data-sellerpilot-puck-block="story"><p>원재료는 포장 확인</p></section><p data-sellerpilot-puck-evidence="true">근거</p></div>`;
}

function remoteHtml(overrides = {}) {
  const text = overrides.text ?? "315g × 6봉 · 승인 문구";
  const rootComment = overrides.rootComment
    ?? '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14") -->';
  const storyComment = overrides.storyComment
    ?? '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-block="story") -->';
  const evidenceComment = '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-evidence="true") -->';
  const unknownComment = overrides.unknownComment ?? "";
  const urls = overrides.urls ?? remoteUrls;
  return `${rootComment}<div>${imageRoles.map((role, index) => {
    const blockComment = index === 0 && overrides.blockComment
      ? overrides.blockComment
      : `<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="${role}") -->`;
    return `${blockComment}<section><p>${index === 0 ? text : `승인 섹션 ${index}`}</p>${index === 0 ? unknownComment : ""}<img src="${urls[index]}" alt="승인 ${index}"></section>`;
  }).join("")}${storyComment}<section><p>원재료는 포장 확인</p></section>${evidenceComment}<p>근거</p></div>`;
}

function readback(overrides = {}) {
  return {
    approved: {
      originName: "파스퇴르 순우유맛으로 채우는 간식 시간",
      channelName: "롯데 롯샌 파스퇴르 순우유맛 315g (6봉입)",
      html: sourceHtml(),
      pixels,
    },
    remote: {
      originName: "파스퇴르 순우유맛으로 채우는 간식 시간",
      channelName: "롯데 롯샌 파스퇴르 순우유맛 315g (6봉입)",
      html: remoteHtml(),
      pixels,
      salePrice: 3190,
      stockQuantity: 1,
    },
    ...overrides,
  };
}

async function database() {
  const db = new PGlite();
  await db.exec(setup);
  await db.exec(migration);
  return db;
}

async function contentCheck(db, value) {
  return db.query(`select public.sellerpilot_service_commit_smartstore_manual_adoption(
    null,null,null,null,null,null,null,$1::jsonb
  ) result`, [JSON.stringify(value)]);
}

test("exact Naver attribute comments and named entities preserve approved content", async () => {
  const db = await database();
  try {
    assert.equal((await db.query(
      "select sellerpilot_private.smartstore_repair_detail_html_matches($1,$2) matched",
      [sourceHtml(), remoteHtml()],
    )).rows[0].matched, true);
    assert.equal((await contentCheck(db, readback())).rows[0].result.ok, true);
  } finally {
    await db.close();
  }
});

test("origin and channel names are independently bound to different approved values", async () => {
  const db = await database();
  try {
    assert.equal((await contentCheck(db, readback())).rows[0].result.ok, true);
    const changedOrigin = readback();
    changedOrigin.remote.originName = "승인되지 않은 원상품명";
    await assert.rejects(contentCheck(db, changedOrigin), /SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH/u);

    const changed = readback();
    changed.remote.channelName = "승인되지 않은 채널 상품명";
    await assert.rejects(contentCheck(db, changed), /SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH/u);
  } finally {
    await db.close();
  }
});

test("text, price, stock, and image pixel order remain exact", async () => {
  const db = await database();
  try {
    const changedText = readback();
    changedText.remote.html = remoteHtml({ text: "315g × 6봉 · 변조 문구" });
    await assert.rejects(contentCheck(db, changedText), /DETAIL_CONTENT_MISMATCH/u);

    const changedPrice = readback();
    changedPrice.remote.salePrice = 5000;
    await assert.rejects(contentCheck(db, changedPrice), /REMOTE_CONTENT_MISMATCH/u);

    const changedStock = readback();
    changedStock.remote.stockQuantity = 2;
    await assert.rejects(contentCheck(db, changedStock), /REMOTE_CONTENT_MISMATCH/u);

    const changedOrder = readback();
    changedOrder.remote.pixels = [...pixels];
    [changedOrder.remote.pixels[1], changedOrder.remote.pixels[2]] = [
      changedOrder.remote.pixels[2], changedOrder.remote.pixels[1],
    ];
    await assert.rejects(contentCheck(db, changedOrder), /PIXEL_BINDING_MISMATCH/u);
  } finally {
    await db.close();
  }
});

test("unknown attributes and comments cannot be canonicalized away", async () => {
  const db = await database();
  try {
    assert.equal((await db.query(
      "select sellerpilot_private.smartstore_repair_detail_html_matches($1,$2) matched",
      [sourceHtml(), remoteHtml({
        rootComment: '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-unknown="true") -->',
      })],
    )).rows[0].matched, false);
    assert.equal((await db.query(
      "select sellerpilot_private.smartstore_repair_detail_html_matches($1,$2) matched",
      [sourceHtml(), remoteHtml({ unknownComment: "<!-- arbitrary provider comment -->" })],
    )).rows[0].matched, false);
    assert.equal((await db.query(
      "select sellerpilot_private.smartstore_repair_detail_html_matches($1,$2) matched",
      [sourceHtml(), remoteHtml({
        blockComment: '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-block="other" data-sellerpilot-image-role="detail-overview") -->',
      })],
    )).rows[0].matched, false);
    assert.equal((await db.query(
      "select sellerpilot_private.smartstore_repair_detail_html_matches($1,$2) matched",
      [sourceHtml(), remoteHtml({
        rootComment: '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-detail="true") -->',
      })],
    )).rows[0].matched, false);
    assert.equal((await db.query(
      "select sellerpilot_private.smartstore_repair_detail_html_matches($1,$2) matched",
      [sourceHtml(), remoteHtml({
        rootComment: '<!-- Not Allowed Attribute Filtered (  data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14") -->',
      })],
    )).rows[0].matched, false);
  } finally {
    await db.close();
  }
});

test("unknown SellerPilot source attributes and changed image structure fail closed", async () => {
  const db = await database();
  try {
    assert.equal((await db.query(
      "select sellerpilot_private.smartstore_repair_detail_html_matches($1,$2) matched",
      [sourceHtml({ rootAttributes: 'data-sellerpilot-unknown="true"' }), remoteHtml()],
    )).rows[0].matched, false);
    assert.equal((await db.query(
      "select sellerpilot_private.smartstore_repair_detail_html_matches($1,$2) matched",
      [sourceHtml({ text: '승인 문구 data-sellerpilot-puck-evidence="true"' }), remoteHtml()],
    )).rows[0].matched, false);
    assert.equal((await db.query(
      "select sellerpilot_private.smartstore_repair_detail_html_matches($1,$2) matched",
      [sourceHtml(), remoteHtml({ urls: remoteUrls.slice(0, 7) })],
    )).rows[0].matched, false);
  } finally {
    await db.close();
  }
});
