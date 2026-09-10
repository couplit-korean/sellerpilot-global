import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("./inquiry-reply-migration-dynamic.test.mjs", import.meta.url);
const fixtureSource = await readFile(fixtureUrl, "utf8");
const fixtureEnd = fixtureSource.indexOf('test("Smartstore product');
assert.ok(fixtureEnd > 0);
const fixtureModule = fixtureSource.slice(0, fixtureEnd)
  .replace(
    'from "@electric-sql/pglite"',
    `from ${JSON.stringify(import.meta.resolve("@electric-sql/pglite"))}`,
  )
  .replaceAll("import.meta.url", JSON.stringify(fixtureUrl.href));
const fixture = await import(`data:text/javascript;base64,${Buffer.from(
  `${fixtureModule}\nexport { createDatabase, seedAdminAndCredential, setClaims, scalar, ADMIN_ID };\n`,
).toString("base64")}`);

const migration = await readFile(new URL(
  "../supabase/migrations/20260910022500_elevenst_new_product_server_sources.sql",
  import.meta.url,
), "utf8");
const PRODUCT_ID = "10000000-0000-4000-8000-000000000071";
const OTHER_PRODUCT_ID = "10000000-0000-4000-8000-000000000072";
const PRODUCT_UPDATED_AT = "2026-09-10T02:10:00.000Z";

async function sourceRead(db, kind, productId, credentialId, version, ownerId = fixture.ADMIN_ID, categoryId = "1346631") {
  return fixture.scalar(db, `select public.sellerpilot_service_elevenst_new_product_source(
    $1,$2,$3,$4,$5,$6
  )`, [kind, ownerId, productId, categoryId, credentialId, version]);
}

function manifest() {
  return {
    contract: "sellerpilot_detail_image_manifest_v1",
    algorithm: "sha256",
    digest: "8".repeat(64),
    images: Array.from({ length: 8 }, (_, index) => ({ index: index + 1 })),
  };
}

test("11st service-only source RPC binds exact owner, product, revision, approval and active credential", async () => {
  const db = await fixture.createDatabase();
  try {
    await fixture.seedAdminAndCredential(db);
    const credentialId = await fixture.scalar(db, `select public.sellerpilot_rotate_credential(
      'elevenst','production',$1::jsonb,now()+interval '180 days',90,30,7
    )`, [JSON.stringify({ api_key: "A".repeat(32), seller_id: "seller-010" })]);
    const credentialVersion = await fixture.scalar(db,
      "select version from sellerpilot_private.channel_credentials where id=$1",
      [credentialId]);

    await db.query(`insert into sellerpilot_private.products(
      id,owner_id,external_code,sku,name,status,on_hand,reserved,reorder_point,
      detail_page_data,detail_page_version,detail_page_approved_version,
      detail_page_image_manifest,detail_page_updated_at,updated_at
    ) values
      ($1,$3,'elevenst-source-010','SERVER-FOOD-010','서버 승인 가공식품','active',1,0,0,
       '{"root":{}}'::jsonb,11,11,$4::jsonb,$5::timestamptz,$5::timestamptz),
      ($2,$3,'elevenst-source-other','SERVER-FOOD-OTHER','다른 가공식품','active',1,0,0,
       '{"root":{}}'::jsonb,11,11,$4::jsonb,$5::timestamptz,$5::timestamptz)`, [
      PRODUCT_ID,
      OTHER_PRODUCT_ID,
      fixture.ADMIN_ID,
      JSON.stringify(manifest()),
      PRODUCT_UPDATED_AT,
    ]);

    await db.exec(migration);
    const providerProduct = {
      dispCtgrNo: "1346631",
      prdNm: "서버 승인 가공식품",
      sellerPrdCd: "SERVER-FOOD-010",
      selPrc: "3190",
      prdSelQty: "1",
    };
    await db.query(`insert into sellerpilot_private.elevenst_new_product_server_sources(
      owner_id,product_id,category_id,credential_id,credential_version,
      product_updated_at,product_revision,product_approval_revision,
      approved_price_krw,approved_inventory_quantity,provider_product,
      provider_product_sha256,notices,seller_receipt,availability_receipt,
      policy_source,policy_source_revision,policy_approval_revision,approved_at,created_by
    ) values(
      $1,$2,'1346631',$3,$4,$5,11,11,3190,1,$6::jsonb,$7,
      $8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,12,13,
      clock_timestamp()-interval '1 minute',$1
    )`, [
      fixture.ADMIN_ID,
      PRODUCT_ID,
      credentialId,
      credentialVersion,
      PRODUCT_UPDATED_AT,
      JSON.stringify(providerProduct),
      "7".repeat(64),
      JSON.stringify(Array.from({ length: 10 }, (_, index) => ({ code: String(index + 1) }))),
      JSON.stringify({ seller: "verified" }),
      JSON.stringify({ status: "available" }),
      JSON.stringify({
        contract: "untrusted-row-value",
        current: false,
        ownerId: "10000000-0000-4000-8000-000000000099",
        shipping: { shippingFeeKrw: 3000 },
      }),
    ]);

    await fixture.setClaims(db, "service_role");
    const bindingAudit = (await db.query(`select
      p.owner_id=$1::uuid owner_ok,p.demo,p.status,p.updated_at,
      p.detail_page_version,p.detail_page_approved_version,p.name,p.sku,p.on_hand,
      c.created_by=$1::uuid credential_owner_ok,c.channel,c.environment,c.status credential_status,
      c.version,c.expires_at,
      s.product_updated_at=s.product_updated_at source_time_self,
      s.product_updated_at=p.updated_at source_time_ok,s.status source_status,
      s.approved_at<=clock_timestamp() approved_now,
      s.provider_product->>'prdNm'=p.name name_ok,
      s.provider_product->>'sellerPrdCd'=p.sku sku_ok,
      (s.provider_product->>'prdSelQty')::integer=p.on_hand inventory_ok
    from sellerpilot_private.products p
    join sellerpilot_private.elevenst_new_product_server_sources s on s.product_id=p.id
    join sellerpilot_private.channel_credentials c on c.id=s.credential_id
    where p.id=$2`, [fixture.ADMIN_ID, PRODUCT_ID])).rows;
    assert.equal(bindingAudit.length, 1, JSON.stringify(bindingAudit));
    const kinds = ["product", "credential", "notices", "seller", "availability", "policy"];
    const values = await Promise.all(kinds.map((kind) =>
      sourceRead(db, kind, PRODUCT_ID, credentialId, credentialVersion)));
    assert.equal(values.every((value) => value?.current === true), true,
      JSON.stringify({ values, bindingAudit }));
    assert.equal(values[0].productId, PRODUCT_ID);
    assert.equal(values[0].revision, 11);
    assert.equal(values[0].approvalRevision, 11);
    assert.deepEqual(values[0].providerProduct, providerProduct);
    assert.equal(values[1].credentialId, credentialId);
    assert.equal(values[1].credentialVersion, credentialVersion);
    assert.equal(values[2].notices.length, 10);
    assert.equal(values[5].sourceRevision, 12);
    assert.equal(values[5].approvalRevision, 13);
    assert.equal(values[5].ownerId, fixture.ADMIN_ID);
    assert.equal(values[5].contract, "sellerpilot_elevenst_new_product_policy_source_v1");
    assert.equal(values[5].shipping.shippingFeeKrw, 3000);

    assert.equal(await sourceRead(db, "unknown", PRODUCT_ID, credentialId, credentialVersion), null);
    assert.equal(await sourceRead(db, "product", OTHER_PRODUCT_ID, credentialId, credentialVersion), null);
    assert.equal(await sourceRead(db, "product", PRODUCT_ID, credentialId, credentialVersion + 1), null);
    assert.equal(await sourceRead(db, "product", PRODUCT_ID, credentialId, credentialVersion, fixture.ADMIN_ID, "9999999"), null);
    assert.equal(await sourceRead(db, "product", PRODUCT_ID, credentialId, credentialVersion,
      "10000000-0000-4000-8000-000000000099"), null);

    await db.query("update sellerpilot_private.products set updated_at=updated_at+interval '1 second' where id=$1", [PRODUCT_ID]);
    assert.equal(await sourceRead(db, "product", PRODUCT_ID, credentialId, credentialVersion), null,
      "a product bookkeeping revision change must stale the approved source");
    await db.query("update sellerpilot_private.products set updated_at=$2 where id=$1", [PRODUCT_ID, PRODUCT_UPDATED_AT]);
    assert.equal((await sourceRead(db, "product", PRODUCT_ID, credentialId, credentialVersion))?.current, true);

    await db.query(`update sellerpilot_private.channel_credentials
      set status='grace' where id=$1`, [credentialId]);
    assert.equal(await sourceRead(db, "product", PRODUCT_ID, credentialId, credentialVersion), null,
      "a non-active credential must stale every source kind");
    await db.query(`update sellerpilot_private.channel_credentials
      set status='active' where id=$1`, [credentialId]);
    assert.equal((await sourceRead(db, "product", PRODUCT_ID, credentialId, credentialVersion))?.current, true);

    await db.query(`update sellerpilot_private.products
      set detail_page_data='{"root":{"revision":12}}'::jsonb,
          detail_page_version=12,detail_page_approved_version=12,
          detail_page_image_manifest=$2::jsonb,
          detail_page_updated_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=$1`, [PRODUCT_ID, JSON.stringify(manifest())]);
    assert.equal(await sourceRead(db, "product", PRODUCT_ID, credentialId, credentialVersion), null,
      "a new approved product/detail revision must stale the old source");

    assert.equal(await fixture.scalar(db, `select has_function_privilege(
      'service_role','public.sellerpilot_service_elevenst_new_product_source(text,uuid,uuid,text,uuid,integer)','EXECUTE'
    )`), true);
    assert.equal(await fixture.scalar(db, `select has_function_privilege(
      'authenticated','public.sellerpilot_service_elevenst_new_product_source(text,uuid,uuid,text,uuid,integer)','EXECUTE'
    )`), false);
    assert.equal(await fixture.scalar(db, `select has_table_privilege(
      'service_role','sellerpilot_private.elevenst_new_product_server_sources','SELECT'
    )`), false);

    await assert.rejects(db.query(`update sellerpilot_private.elevenst_new_product_server_sources
      set approved_price_krw=3200 where product_id=$1`, [PRODUCT_ID]),
    /ELEVENST_NEW_PRODUCT_SOURCE_IMMUTABLE/u);
    await assert.rejects(db.query(`delete from sellerpilot_private.elevenst_new_product_server_sources
      where product_id=$1`, [PRODUCT_ID]), /ELEVENST_NEW_PRODUCT_SOURCE_DELETE_FORBIDDEN/u);
    await db.query(`update sellerpilot_private.elevenst_new_product_server_sources
      set status='retired' where product_id=$1`, [PRODUCT_ID]);
    assert.equal(await sourceRead(db, "product", PRODUCT_ID, credentialId, credentialVersion), null);
  } finally {
    await db.close();
  }
});
