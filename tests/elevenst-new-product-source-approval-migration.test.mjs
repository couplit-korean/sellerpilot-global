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

const sourceMigration = await readFile(new URL(
  "../supabase/migrations/20260910022500_elevenst_new_product_server_sources.sql",
  import.meta.url,
), "utf8");
const approvalMigration = await readFile(new URL(
  "../supabase/migrations/20260910030000_elevenst_new_product_source_approval.sql",
  import.meta.url,
), "utf8");

const PRODUCT_ID = "10000000-0000-4000-8000-000000000081";
const AI_JOB_ID = "10000000-0000-4000-8000-000000000082";
const ASSIGNMENT_ID = "10000000-0000-4000-8000-000000000083";
const APPROVAL_REQUEST_ID = "10000000-0000-4000-8000-000000000084";
const CLAIM_ID = "10000000-0000-4000-8000-000000000085";
const PRODUCT_UPDATED_AT = "2026-09-10T03:00:00.000Z";
const DETAIL_DIGEST = "8".repeat(64);

function draftData(credentialId) {
  const key = JSON.stringify(["elevenst", "KR", "11st", credentialId]);
  return {
    common: {
      fields: {
        productName: "서버 승인 가공식품",
        brandName: "롯데",
        countryOfOrigin: "대한민국",
      },
      price: 3190,
      quantity: 1,
    },
    channels: {
      [key]: { categoryId: "1346631", patches: [] },
    },
  };
}

function approvalPayload(context, credentialId, approvalRequestId = APPROVAL_REQUEST_ID) {
  const noticeCodes = [
    "176400445", "176398001", "42154823", "23757260", "23757095",
    "176312674", "23756754", "23757245", "42155152", "23757000",
  ];
  return {
    contract: "sellerpilot_elevenst_new_product_source_approval_v1",
    approvalRequestId,
    actorId: fixture.ADMIN_ID,
    ownerId: fixture.ADMIN_ID,
    productId: PRODUCT_ID,
    categoryId: "1346631",
    credentialId,
    credentialVersion: context.credentialVersion,
    productUpdatedAt: context.productUpdatedAt,
    productRevision: context.productRevision,
    productApprovalRevision: context.productApprovalRevision,
    draftVersion: context.draftVersion,
    detailManifestDigest: context.detailManifestDigest,
    providerProduct: {
      dispCtgrNo: "1346631",
      prdNm: context.productName,
      sellerPrdCd: context.sellerProductCode,
      selPrc: String(context.approvedPriceKrw),
      prdSelQty: String(context.approvedQuantity),
      brand: context.brand,
      orgnNmVal: context.countryOfOrigin,
      prdStatCd: context.conditionCode,
    },
    providerProductSha256: "7".repeat(64),
    notices: noticeCodes.map((code, index) => ({
      code,
      value: `승인값 ${index + 1}`,
    })),
    sellerReceipt: {
      credentialId,
      credentialVersion: context.credentialVersion,
      sellerIdSha256: "6".repeat(64),
      sellerOfficeAccountSha256: "6".repeat(64),
    },
    availabilityReceipt: { state: "available" },
    policySource: {
      shipping: {
        shippingFeeKrw: 3000,
        deliveryCostBasisCode: "02",
        paymentTypeCode: "03",
      },
      content: {
        productImageUrls: Array.from({ length: 4 }, (_, index) =>
          `https://signed.example.test/product-${index + 1}.jpg`),
        detailImageUrls: Array.from({ length: 8 }, (_, index) =>
          `https://signed.example.test/detail-${index + 1}.jpg`),
      },
    },
    policySourceRevision: context.draftVersion,
    policyApprovalRevision: context.draftVersion,
  };
}

async function context(db, credentialId) {
  return fixture.scalar(db, `select public.sellerpilot_service_elevenst_new_product_approval_context(
    $1,$2,$3,'KR','11st'
  )`, [fixture.ADMIN_ID, PRODUCT_ID, credentialId]);
}

async function approve(db, credentialId, payload, requestId = APPROVAL_REQUEST_ID) {
  return fixture.scalar(db, `select public.sellerpilot_service_approve_elevenst_new_product_source(
    $1,$2,$3,$4,'KR','11st',$5::jsonb
  )`, [fixture.ADMIN_ID, requestId, PRODUCT_ID, credentialId, JSON.stringify(payload)]);
}

async function database() {
  const db = await fixture.createDatabase();
  await fixture.seedAdminAndCredential(db);
  await db.exec(`
    create table sellerpilot_private.product_registration_drafts (
      id bigint generated always as identity primary key,
      owner_id uuid not null references auth.users(id),
      draft_id uuid not null,
      kind text not null,
      product_id uuid references sellerpilot_private.products(id),
      version bigint not null,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(owner_id, kind, draft_id)
    );
    create function sellerpilot_private.request_has_unambiguous_service_role_claim()
    returns boolean language sql stable set search_path='' as $$
      select coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
    $$;
  `);
  const credentialId = await fixture.scalar(db, `select public.sellerpilot_rotate_credential(
    'elevenst','production',$1::jsonb,now()+interval '180 days',90,30,7
  )`, [JSON.stringify({ api_key: "A".repeat(32), seller_id: "seller-011-secret" })]);
  const productImagePaths = Array.from({ length: 4 }, (_, index) =>
    `${fixture.ADMIN_ID}/source-${index + 1}.jpg`);
  const studioAssetPaths = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
    `asset_${index + 1}`,
    `results/${AI_JOB_ID}/claims/${CLAIM_ID}/asset-${index + 1}.png`,
  ]));
  const studioAssetDigests = Object.fromEntries(Object.keys(studioAssetPaths).map((key) => [
    key,
    "9".repeat(64),
  ]));
  const detailImages = Array.from({ length: 8 }, (_, index) => ({
    role: `detail_${index + 1}`,
    path: `results/${AI_JOB_ID}/detail-${index + 1}.jpg`,
  }));
  await db.query(`insert into sellerpilot_private.ai_cli_jobs(
    id,kind,status,request_payload,result_payload,created_by,
    created_at,completed_at,updated_at
  ) values(
    $1,'product_studio','succeeded',$2::jsonb,$3::jsonb,$4,
    clock_timestamp(),clock_timestamp(),clock_timestamp()
  )`, [
    AI_JOB_ID,
    JSON.stringify({ image_paths: productImagePaths }),
    JSON.stringify({
      asset_storage_paths: studioAssetPaths,
      asset_storage_sha256s: studioAssetDigests,
    }),
    fixture.ADMIN_ID,
  ]);
  await db.query(`insert into sellerpilot_private.products(
    id,owner_id,external_code,sku,name,status,on_hand,reserved,reorder_point,
    ai_job_id,detail_page_data,detail_page_version,detail_page_approved_version,
    detail_page_image_manifest,detail_page_updated_at,updated_at
  ) values(
    $1,$2,'elevenst-approval-011','SERVER-FOOD-011','서버 승인 가공식품',
    'active',1,0,0,$3,'{"root":{}}'::jsonb,11,11,$4::jsonb,$5,$5
  )`, [
    PRODUCT_ID,
    fixture.ADMIN_ID,
    AI_JOB_ID,
    JSON.stringify({ contract: "sellerpilot_detail_image_manifest_v1", digest: DETAIL_DIGEST, images: detailImages }),
    PRODUCT_UPDATED_AT,
  ]);
  await db.query(`insert into sellerpilot_private.product_category_assignments(
    id,owner_id,product_id,source_ref,product_name,channel,environment,market,
    category_id,category_path,confidence,provided_attributes,status,confirmed_at,required_attributes,official_metadata,
    missing_required_attributes,official_verified_at,is_leaf,classification_source
  ) values(
    $1,$2,$3,'elevenst-approval-011','서버 승인 가공식품',
    'elevenst','production','KR','1346631',array['식품','가공식품'],1,
    '{}'::jsonb,'confirmed',clock_timestamp(),'[]'::jsonb,'{}'::jsonb,
    '[]'::jsonb,clock_timestamp(),true,'official_tree_search'
  )`, [ASSIGNMENT_ID, fixture.ADMIN_ID, PRODUCT_ID]);
  await db.query(`insert into sellerpilot_private.product_registration_drafts(
    owner_id,draft_id,kind,product_id,version,data
  ) values($1,$2,'publish',$2,12,$3::jsonb)`, [
    fixture.ADMIN_ID,
    PRODUCT_ID,
    JSON.stringify(draftData(credentialId)),
  ]);
  await db.exec(sourceMigration);
  await db.exec(approvalMigration);
  await fixture.setClaims(db, "service_role");
  return { db, credentialId };
}

test("11st approval RPC derives current context, writes once, and retires append-only", async () => {
  const { db, credentialId } = await database();
  try {
    const current = await context(db, credentialId);
    assert.equal(current.contract, "sellerpilot_elevenst_new_product_approval_context_v1");
    assert.equal(current.ownerId, fixture.ADMIN_ID);
    assert.equal(current.productId, PRODUCT_ID);
    assert.equal(current.credentialId, credentialId);
    assert.equal(current.credentialVersion > 0, true);
    assert.equal(current.draftVersion, 12);
    assert.equal(current.approvedPriceKrw, 3190);
    assert.equal(current.inventoryQuantity, 1);
    assert.equal(current.productImagePaths.length, 4);
    assert.equal(current.detailImagePaths.length, 8);
    assert.equal(JSON.stringify(current).includes("seller-011-secret"), false);
    assert.equal(JSON.stringify(current).includes("A".repeat(32)), false);

    const payload = approvalPayload(current, credentialId);
    const saved = await approve(db, credentialId, payload);
    assert.equal(saved.status, "approved");
    assert.match(saved.sourceId, /^[0-9a-f-]{36}$/u);
    assert.match(saved.approvalPayloadSha256, /^[a-f0-9]{64}$/u);
    const same = await approve(db, credentialId, payload);
    assert.equal(same.status, "existing");
    assert.equal(same.sourceId, saved.sourceId);
    assert.equal(Number(await fixture.scalar(db,
      "select count(*) from sellerpilot_private.elevenst_new_product_server_sources",
    )), 1);
    assert.equal(Number(await fixture.scalar(db,
      "select count(*) from sellerpilot_private.elevenst_new_product_source_approvals",
    )), 1);

    assert.equal(await fixture.scalar(db, `select public.sellerpilot_service_retire_elevenst_new_product_source(
      $1,$2,'승인 입력 변경으로 폐기'
    )`, [fixture.ADMIN_ID, saved.sourceId]), true);
    assert.equal(await fixture.scalar(db, `select public.sellerpilot_service_elevenst_new_product_source(
      'product',$1,$2,'1346631',$3,$4
    )`, [fixture.ADMIN_ID, PRODUCT_ID, credentialId, current.credentialVersion]), null);
    assert.equal(Number(await fixture.scalar(db,
      "select count(*) from sellerpilot_private.elevenst_new_product_source_retirements",
    )), 1);
  } finally {
    await db.close();
  }
});

test("11st approval RPC rejects forged identity, revision, duplicate request and non-service access", async () => {
  const { db, credentialId } = await database();
  try {
    const current = await context(db, credentialId);
    const payload = approvalPayload(current, credentialId);
    await assert.rejects(
      approve(db, credentialId, { ...payload, ownerId: "10000000-0000-4000-8000-000000000099" }),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID/u,
    );
    await assert.rejects(
      approve(db, credentialId, { ...payload, credentialVersion: current.credentialVersion + 1 }),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID/u,
    );
    await assert.rejects(
      approve(db, credentialId, { ...payload, productRevision: current.productRevision + 1 }),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID/u,
    );
    const missingVersion = structuredClone(payload);
    delete missingVersion.credentialVersion;
    await assert.rejects(
      approve(db, credentialId, missingVersion),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID/u,
    );
    const reorderedNotices = structuredClone(payload);
    [reorderedNotices.notices[0], reorderedNotices.notices[1]] = [
      reorderedNotices.notices[1], reorderedNotices.notices[0],
    ];
    await assert.rejects(
      approve(db, credentialId, reorderedNotices),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID/u,
    );
    const missingImages = structuredClone(payload);
    delete missingImages.policySource.content.productImageUrls;
    await assert.rejects(
      approve(db, credentialId, missingImages),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID/u,
    );
    await assert.rejects(
      approve(db, credentialId, { ...payload, policySourceRevision: current.draftVersion + 1 }),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID/u,
    );

    const saved = await approve(db, credentialId, payload);
    const conflictPayload = { ...payload, providerProductSha256: "5".repeat(64) };
    await assert.rejects(
      approve(db, credentialId, conflictPayload),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_REQUEST_CONFLICT/u,
    );
    assert.equal(saved.status, "approved");

    await fixture.setClaims(db, "authenticated");
    await assert.rejects(context(db, credentialId),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_ACCESS_DENIED/u);
    assert.equal(await fixture.scalar(db, `select has_function_privilege(
      'authenticated',
      'public.sellerpilot_service_approve_elevenst_new_product_source(uuid,uuid,uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )`), false);
    assert.equal(await fixture.scalar(db, `select has_table_privilege(
      'service_role',
      'sellerpilot_private.elevenst_new_product_source_approvals',
      'SELECT'
    )`), false);
  } finally {
    await db.close();
  }
});

test("11st approval context fails closed for stale draft, inventory, category and detail state", async () => {
  const mutations = [
    "update sellerpilot_private.products set on_hand=2",
    "update sellerpilot_private.product_category_assignments set status='pending'",
    "update sellerpilot_private.products set detail_page_version=12,updated_at=clock_timestamp()",
  ];
  for (const mutation of mutations) {
    const { db, credentialId } = await database();
    try {
      const before = await context(db, credentialId);
      assert.ok(before);
      await db.exec(mutation);
      assert.equal(await context(db, credentialId), null, mutation);
    } finally {
      await db.close();
    }
  }

  const { db, credentialId } = await database();
  try {
    const before = await context(db, credentialId);
    const stalePayload = approvalPayload(before, credentialId);
    await db.exec("update sellerpilot_private.product_registration_drafts set version=13");
    assert.equal((await context(db, credentialId)).draftVersion, 13);
    await assert.rejects(
      approve(db, credentialId, stalePayload),
      /ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID/u,
    );
  } finally {
    await db.close();
  }
});
