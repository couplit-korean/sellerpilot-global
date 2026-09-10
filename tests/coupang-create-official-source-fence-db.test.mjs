import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sourceRevisionMigration = await readFile(new URL(
  "../supabase/migrations/20260910021500_fence_coupang_create_source_revision.sql",
  import.meta.url,
), "utf8");
const officialSourceMigration = await readFile(new URL(
  "../supabase/migrations/20260910025500_fence_coupang_create_official_sources.sql",
  import.meta.url,
), "utf8");
const officialSourceR7Migration = await readFile(new URL(
  "../supabase/migrations/20260910031500_fence_coupang_create_official_sources_r7.sql",
  import.meta.url,
), "utf8");
const officialSourceR8Migration = await readFile(new URL(
  "../supabase/migrations/20260910032500_fence_coupang_create_official_sources_r8.sql",
  import.meta.url,
), "utf8");
const exactProviderBodyR12Migration = await readFile(new URL(
  "../supabase/migrations/20260910041500_coupang_create_exact_provider_body_r12.sql",
  import.meta.url,
), "utf8");

const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  product: "20000000-0000-4000-8000-000000000001",
  credential: "30000000-0000-4000-8000-000000000001",
  assignment: "40000000-0000-4000-8000-000000000001",
  attempt: "50000000-0000-4000-8000-000000000001",
  listing: "60000000-0000-4000-8000-000000000001",
  job: "70000000-0000-4000-8000-000000000001",
  token: "71000000-0000-4000-8000-000000000001",
};
const manifestDigest = "b".repeat(64);
const requestFingerprint = "e".repeat(64);
const sellerAccountKey = "f".repeat(64);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) =>
      Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function argumentsValue() {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    sellerpilotAssets: { shipping: { shippingRule: "2 days", shippingFeeKrw: 3000 } },
    publicationExpectedFingerprint: requestFingerprint,
    body: {
      displayCategoryCode: 59631,
      sellerProductName: "신규 상품",
      displayProductName: "신규 상품",
      brand: "테스트",
      outboundShippingPlaceCode: 12345,
      deliveryMethod: "SEQUENCIAL",
      deliveryCompanyCode: "HANJIN",
      deliveryChargeType: "NOT_FREE",
      deliveryCharge: 3000,
      freeShipOverAmount: 0,
      deliveryChargeOnReturn: 0,
      remoteAreaDeliverable: "N",
      unionDeliveryType: "UNION_DELIVERY",
      returnCenterCode: "RETURN-1",
      returnCharge: 4500,
      returnChargeName: "반품지",
      companyContactNumber: "0212345678",
      returnZipCode: "06236",
      returnAddress: "서울특별시 강남구",
      returnAddressDetail: "1층",
      vendorUserId: "wing-user",
      requested: false,
      saleStartedAt: "2026-09-10T00:00:00",
      saleEndedAt: "2099-01-01T23:59:59",
      items: [{
        itemName: "신규 상품 빨강",
        externalVendorSku: "NEW-SKU-RED",
        barcode: "",
        emptyBarcode: true,
        emptyBarcodeReason: "바코드 없음",
        modelNo: "MODEL-RED",
        salePrice: 12900,
        originalPrice: 15900,
        maximumBuyCount: 9,
        maximumBuyForPerson: 9,
        unitCount: 1,
        outboundShippingTimeDay: 2,
        attributes: [{ attributeTypeName: "색상", attributeValueName: "빨강" }],
        notices: [{
          noticeCategoryName: "기타 재화",
          noticeCategoryDetailName: "품명",
          content: "신규 상품",
        }],
        certifications: [],
      }],
    },
  };
}

function officialSnapshotPayload(categoryName = "생활용품", unicodeKeys = false) {
  const observedAt = new Date().toISOString();
  const normalizedReads = {
    categoryMetadata: {
      categoryName,
      attributes: [{
        attributeTypeName: "색상",
        required: "MANDATORY",
        exposed: "EXPOSED",
      }],
      noticeCategories: [{
        noticeCategoryName: "기타 재화",
        noticeCategoryDetailNames: [{
          noticeCategoryDetailName: "품명",
          required: "MANDATORY",
        }],
      }],
      certifications: [],
      ...(unicodeKeys ? { "\uE000": "bmp-private-use", "😀": "supplementary" } : {}),
    },
    categoryStatus: true,
    outboundShippingPlaces: { content: [{
      usable: true,
      outboundShippingPlaceCode: 12345,
      placeAddresses: [{ countryCode: "KR", addressType: "ROADNAME" }],
    }] },
    returnCenters: { content: [{
      usable: true,
      returnCenterCode: "RETURN-1",
      deliverCode: "HANJIN",
      returnFee02kg: 4500,
      placeAddresses: [{ countryCode: "KR", addressType: "ROADNAME" }],
    }] },
  };
  const core = {
    contract: "sellerpilot_coupang_create_official_read_evidence_v1",
    displayCategoryCode: 59631,
    environment: "production",
    observedAt,
    categoryMetadataSha256: sha(normalizedReads.categoryMetadata),
    categoryStatusSha256: sha(normalizedReads.categoryStatus),
    outboundShippingPlacesSha256: sha(normalizedReads.outboundShippingPlaces),
    returnCentersSha256: sha(normalizedReads.returnCenters),
  };
  return {
    contract: "sellerpilot_coupang_create_official_read_snapshot_payload_v1",
    officialReadEvidence: { ...core, evidenceSha256: sha(core) },
    normalizedReads,
  };
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create schema extensions;
    create function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable
    as $$select sha256(convert_to(value,'UTF8'))$$;
    create schema sellerpilot_private;
    create schema vault;
    create table vault.decrypted_secrets(id uuid primary key, decrypted_secret text);
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key, token_hash text, scope text, status text,
      expires_at timestamptz
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, channel text, environment text, status text,
      expires_at timestamptz, version integer, fingerprint text,
      vault_secret_id uuid, seller_account_key text, seller_account_key_source text,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.products(
      id uuid primary key, owner_id uuid, demo boolean, status text,
      sku text, name text, on_hand integer, cost_krw numeric,
      product_facts jsonb, updated_at timestamptz,
      detail_page_data jsonb, detail_page_version integer,
      detail_page_approved_version integer, detail_page_image_manifest jsonb,
      detail_page_updated_at timestamptz
    );
    create table sellerpilot_private.product_category_assignments(
      id uuid primary key, owner_id uuid, product_id uuid, channel text,
      environment text, market text, category_id text, category_path text[],
      is_leaf boolean, classification_source text, required_attributes jsonb,
      provided_attributes jsonb, missing_required_attributes jsonb,
      official_metadata jsonb, status text, official_verified_at timestamptz,
      confirmed_at timestamptz, updated_at timestamptz
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key, product_id uuid, owner_id uuid, channel_key text,
      operation_attempt_id uuid, market text, target_id text
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key, owner_id uuid, credential_id uuid, channel text,
      operation text, status text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, credential_id uuid, listing_id uuid, attempt_id uuid,
      created_by uuid, channel text, operation text, environment text,
      provider_mutation_started_at timestamptz, request_payload jsonb,
      request_fingerprint text, status text, claim_token uuid,
      lease_expires_at timestamptz, worker_token_id uuid
    );
    insert into auth.users values ('${ids.owner}');
    insert into sellerpilot_private.admin_users values ('${ids.owner}');
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${ids.token}','token','gateway','active',clock_timestamp()+interval '1 year');
    insert into vault.decrypted_secrets values (
      '35000000-0000-4000-8000-000000000001',
      '{"access_key":"ACCESS","secret_key":"SECRET","vendor_id":"A00000000","requested_by":"wing-user"}');
    insert into sellerpilot_private.channel_credentials values (
      '${ids.credential}','coupang','production','active',
      clock_timestamp()+interval '1 year',7,'ABCDEF123456',
      '35000000-0000-4000-8000-000000000001','${sellerAccountKey}',
      'credential_incarnation_v1',clock_timestamp());
    insert into sellerpilot_private.products values (
      '${ids.product}','${ids.owner}',false,'draft','NEW-SKU','신규 상품',9,8000,
      '{"stock":9,"brandName":"테스트"}',
      '2026-09-10T00:00:00.123456+00:00',
      '{"root":{"props":{"title":"신규 상품"}}}',3,3,
      '{"contract":"sellerpilot_detail_image_manifest_v1","digest":"${manifestDigest}","images":[]}',
      '2026-09-10T00:00:00.123456+00:00');
    insert into sellerpilot_private.product_category_assignments values (
      '${ids.assignment}','${ids.owner}','${ids.product}','coupang','production',
      'KR','59631',array['생활용품'],true,'seller_selected',
      '[{"id":"color","required":true}]','{"color":"빨강"}','[]',
      '{"source":"coupang"}','confirmed','2026-09-10T00:00:00+00:00',
      '2026-09-10T00:00:01+00:00','2026-09-10T00:00:01+00:00');
    insert into sellerpilot_private.product_listings values (
      '${ids.listing}','${ids.product}','${ids.owner}','coupang',
      '${ids.attempt}','KR','A00123456');
    insert into sellerpilot_private.channel_operation_attempts values (
      '${ids.attempt}','${ids.owner}','${ids.credential}',
      'coupang','listing.create','running');
  `);
  await db.exec(sourceRevisionMigration);
  await db.exec(officialSourceMigration);
  await db.exec(officialSourceR7Migration);
  await db.exec(officialSourceR8Migration);
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  return db;
}

async function recordSnapshot(db, args, snapshotPayload) {
  return scalar(db, `select public.sellerpilot_service_record_coupang_create_official_snapshot(
    $1,$2,$3,$4::jsonb,$5::jsonb)`, [ids.owner, ids.product, ids.credential,
    JSON.stringify(args), JSON.stringify(snapshotPayload)]);
}

async function enqueue(db, args, evidence, snapshot) {
  const binding = {
    contract: "sellerpilot_coupang_create_source_revision_v1",
    productId: ids.product,
    productSourceSha256: "a".repeat(64),
    productSource: { sku: "NEW-SKU", name: "신규 상품", onHand: 9, costKrw: 8000 },
    detailPageVersion: 3,
    approvedManifestDigest: manifestDigest,
    officialReadEvidence: evidence,
    officialReadSnapshotId: snapshot.snapshotId,
    officialReadSnapshotDigestSha256: snapshot.snapshotDigestSha256,
    sourceRevisionSha256: "c".repeat(64),
    credentialId: ids.credential,
    credentialVersion: 7,
    credentialFingerprint: "ABCDEF123456",
    credentialEnvironment: "production",
    credentialSellerIdentitySha256: "d".repeat(64),
    market: "KR",
    targetId: "A00123456",
  };
  const queued = structuredClone(args);
  queued.sellerpilotCoupangCreateSourceRevision = binding;
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,listing_id,attempt_id,created_by,channel,operation,environment,
    provider_mutation_started_at,request_payload,request_fingerprint,status,claim_token,lease_expires_at
  ) values(
    $1,$2,$3,$4,$5,'coupang','listing.create','production',null,
    jsonb_build_object('arguments',$6::jsonb),$7,'running',gen_random_uuid(),
    clock_timestamp()+interval '15 minutes')`, [ids.job, ids.credential,
    ids.listing, ids.attempt, ids.owner, JSON.stringify(queued), requestFingerprint]);
  await db.exec(`
    create table provider_mutation_calls(job_id uuid primary key);
    create function public.test_begin_coupang_provider_mutation(p_job uuid)
    returns boolean language plpgsql as $$
    begin
      begin
        update sellerpilot_private.channel_gateway_jobs
           set provider_mutation_started_at=clock_timestamp()
         where id=p_job and provider_mutation_started_at is null;
        if not found then return false; end if;
      exception when check_violation then return false;
      end;
      insert into provider_mutation_calls values(p_job);
      return true;
    end $$;
  `);
}

async function readyFixture() {
  const db = await createDatabase();
  const args = argumentsValue();
  const snapshotPayload = officialSnapshotPayload();
  const evidence = snapshotPayload.officialReadEvidence;
  const snapshot = await recordSnapshot(db, args, snapshotPayload);
  await enqueue(db, args, evidence, snapshot);
  return db;
}

async function insertDuplicateAssignment(db, categoryId = "59631") {
  await db.query(`insert into sellerpilot_private.product_category_assignments
    select '40000000-0000-4000-8000-000000000002', owner_id, product_id,
      channel, environment, market, $1, category_path, is_leaf,
      classification_source, required_attributes, provided_attributes,
      missing_required_attributes, official_metadata, status,
      official_verified_at, confirmed_at, updated_at
    from sellerpilot_private.product_category_assignments
    where id=$2`, [categoryId, ids.assignment]);
}

async function beginMutation(db) {
  return scalar(db, "select public.test_begin_coupang_provider_mutation($1)", [ids.job]);
}
async function calls(db) {
  return Number(await scalar(db, "select count(*) from provider_mutation_calls"));
}

test("one exact durable snapshot crosses the real SQL provider boundary once", async () => {
  const db = await readyFixture();
  try {
    assert.equal(await beginMutation(db), true);
    assert.equal(await calls(db), 1);
  } finally { await db.close(); }
});

test("current product, product_facts, category, detail and credential drift produce zero provider mutations", async () => {
  const changes = [
    "update sellerpilot_private.products set name='변경 상품'",
    "update sellerpilot_private.products set product_facts=jsonb_set(product_facts,'{stock}','8')",
    "update sellerpilot_private.product_category_assignments set provided_attributes='{}'",
    "update sellerpilot_private.products set detail_page_data='{}'",
    "update sellerpilot_private.channel_credentials set fingerprint='ROTATED'",
  ];
  for (const change of changes) {
    const db = await readyFixture();
    try {
      await db.exec(change);
      assert.equal(await beginMutation(db), false, change);
      assert.equal(await calls(db), 0, change);
    } finally { await db.close(); }
  }
});

test("duplicate current category assignment blocks both snapshot recording and provider mutation", async () => {
  const recorderDb = await createDatabase();
  try {
    await insertDuplicateAssignment(recorderDb);
    await assert.rejects(
      recordSnapshot(recorderDb, argumentsValue(), officialSnapshotPayload()),
      /COUPANG_CREATE_OFFICIAL_SOURCE_CATEGORY_INVALID/,
    );
    assert.equal(Number(await scalar(recorderDb,
      "select count(*) from sellerpilot_private.coupang_create_official_source_snapshots")), 0);
  } finally { await recorderDb.close(); }

  const mutationDb = await readyFixture();
  try {
    await insertDuplicateAssignment(mutationDb);
    assert.equal(await beginMutation(mutationDb), false);
    assert.equal(await calls(mutationDb), 0);
  } finally { await mutationDb.close(); }
});

test("official provider evidence or snapshot binding drift produces zero provider mutations", async () => {
  const changes = [
    `update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(
      request_payload,'{arguments,sellerpilotCoupangCreateSourceRevision,officialReadEvidence,categoryMetadataSha256}',
      to_jsonb(repeat('9',64)))`,
    `update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(
      request_payload,'{arguments,sellerpilotCoupangCreateSourceRevision,officialReadSnapshotDigestSha256}',
      to_jsonb(repeat('8',64)))`,
  ];
  for (const change of changes) {
    const db = await readyFixture();
    try {
      await db.exec(change);
      assert.equal(await beginMutation(db), false, change);
      assert.equal(await calls(db), 0, change);
    } finally { await db.close(); }
  }
});

test("missing, expired or non-running claim produces zero provider mutations", async () => {
  const changes = [
    "update sellerpilot_private.channel_gateway_jobs set claim_token=null",
    "update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second'",
    "update sellerpilot_private.channel_gateway_jobs set status='queued'",
  ];
  for (const change of changes) {
    const db = await readyFixture();
    try {
      await db.exec(change);
      assert.equal(await beginMutation(db), false, change);
      assert.equal(await calls(db), 0, change);
    } finally { await db.close(); }
  }
});

test("exact category, options, notices, shipping and return request drift each produce zero provider mutations", async () => {
  const changes = [
    "{arguments,body,displayCategoryCode}",
    "{arguments,body,items,0,salePrice}",
    "{arguments,body,items,0,notices,0,content}",
    "{arguments,body,deliveryCharge}",
    "{arguments,body,returnCharge}",
  ];
  for (const [index, path] of changes.entries()) {
    const db = await readyFixture();
    try {
      await db.query(`update sellerpilot_private.channel_gateway_jobs
        set request_payload=jsonb_set(request_payload,$1::text[],to_jsonb($2::integer))`,
      [path.slice(1, -1).split(","), 70000 + index]);
      assert.equal(await beginMutation(db), false, path);
      assert.equal(await calls(db), 0, path);
    } finally { await db.close(); }
  }
});

test("snapshot recorder is service-only, verifies TS evidence hash, and creates immutable rows", async () => {
  const db = await createDatabase();
  try {
    const args = argumentsValue();
    const snapshotPayload = officialSnapshotPayload();
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
    await assert.rejects(recordSnapshot(db, args, snapshotPayload), /COUPANG_CREATE_OFFICIAL_SOURCE_ACCESS_DENIED/);
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
    const forged = structuredClone(snapshotPayload);
    forged.officialReadEvidence.categoryStatusSha256 = "9".repeat(64);
    await assert.rejects(recordSnapshot(db, args, forged), /COUPANG_CREATE_OFFICIAL_SOURCE_INVALID/);
    const normalizedDrift = structuredClone(snapshotPayload);
    normalizedDrift.normalizedReads.categoryStatus = false;
    await assert.rejects(recordSnapshot(db, args, normalizedDrift), /COUPANG_CREATE_OFFICIAL_SOURCE_INVALID/);
    const snapshot = await recordSnapshot(db, args, snapshotPayload);
    assert.equal(snapshot.contract, "sellerpilot_coupang_create_official_source_snapshot_v1");
    await assert.rejects(db.query(`update sellerpilot_private.coupang_create_official_source_snapshots
      set expires_at=expires_at+interval '1 minute' where id=$1`, [snapshot.snapshotId]),
    /COUPANG_CREATE_OFFICIAL_SOURCE_IMMUTABLE/);
  } finally { await db.close(); }
});


test("sellerProductName, displayProductName and brand drift each produce zero provider mutations", async () => {
  const changes = [
    ["sellerProductName", "변조 상품"],
    ["displayProductName", "변조 노출명"],
    ["brand", "변조브랜드"],
  ];
  for (const [field, value] of changes) {
    const db = await readyFixture();
    try {
      await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,$1::text[],to_jsonb($2::text))",
        [["arguments", "body", field], value]);
      assert.equal(await beginMutation(db), false, field);
      assert.equal(await calls(db), 0, field);
    } finally { await db.close(); }
  }
});

test("forged selected official IDs with fully recomputed evidence are rejected before snapshot", async () => {
  const cases = [
    (payload) => {
      payload.normalizedReads.outboundShippingPlaces.content[0].outboundShippingPlaceCode = 99999;
    },
    (payload) => {
      payload.normalizedReads.returnCenters.content[0].returnCenterCode = "FORGED-RETURN";
    },
    (payload) => {
      payload.normalizedReads.categoryStatus = false;
    },
  ];
  for (const mutate of cases) {
    const db = await createDatabase();
    try {
      const forged = officialSnapshotPayload();
      mutate(forged);
      const reads = forged.normalizedReads;
      const core = {
        ...forged.officialReadEvidence,
        categoryMetadataSha256: sha(reads.categoryMetadata),
        categoryStatusSha256: sha(reads.categoryStatus),
        outboundShippingPlacesSha256: sha(reads.outboundShippingPlaces),
        returnCentersSha256: sha(reads.returnCenters),
      };
      delete core.evidenceSha256;
      forged.officialReadEvidence = { ...core, evidenceSha256: sha(core) };
      await assert.rejects(recordSnapshot(db, argumentsValue(), forged),
        /COUPANG_CREATE_OFFICIAL_SOURCE_SEMANTICS_INVALID/);
      assert.equal(Number(await scalar(db,
        "select count(*) from sellerpilot_private.coupang_create_official_source_snapshots")), 0);
    } finally { await db.close(); }
  }
});

test("mandatory category metadata and item meaning mismatch is rejected before snapshot", async () => {
  const cases = [
    (args) => { args.body.items[0].attributes = []; },
    (args) => { args.body.items[0].notices[0].noticeCategoryDetailName = "제조자"; },
    (args) => { args.body.items[0].salePrice = 0; },
  ];
  for (const mutate of cases) {
    const db = await createDatabase();
    try {
      const args = argumentsValue();
      mutate(args);
      await assert.rejects(recordSnapshot(db, args, officialSnapshotPayload()),
        /COUPANG_CREATE_OFFICIAL_SOURCE_SEMANTICS_INVALID/);
      assert.equal(Number(await scalar(db,
        "select count(*) from sellerpilot_private.coupang_create_official_source_snapshots")), 0);
    } finally { await db.close(); }
  }
});

test("same Vault id secret replacement after snapshot produces zero provider mutations", async () => {
  const db = await readyFixture();
  try {
    await db.query("update vault.decrypted_secrets set decrypted_secret=$1", [
      JSON.stringify({ access_key: "ACCESS", secret_key: "REPLACED", vendor_id: "A00000000" }),
    ]);
    assert.equal(await beginMutation(db), false);
    assert.equal(await calls(db), 0);
  } finally { await db.close(); }
});

test("supplementary Unicode keys round-trip through TS UTF-8 and SQL C canonical order", async () => {
  const db = await createDatabase();
  try {
    const snapshotPayload = officialSnapshotPayload("생활용품", true);
    const snapshot = await recordSnapshot(db, argumentsValue(), snapshotPayload);
    const stored = await db.query(`select official_read_snapshot_payload,
      category_metadata_sha256 from sellerpilot_private.coupang_create_official_source_snapshots
      where id=$1`, [snapshot.snapshotId]);
    assert.deepEqual(stored.rows[0].official_read_snapshot_payload, snapshotPayload);
    assert.equal(stored.rows[0].category_metadata_sha256,
      snapshotPayload.officialReadEvidence.categoryMetadataSha256);
  } finally { await db.close(); }
});

test("r12 full boundary rejects stable-body and all-current-category drift and exposes RPC-only RLS tables", async () => {
  const db = await createDatabase();
  try {
    await db.exec(`create table boundary_calls(scope text not null);
    create function public.sellerpilot_service_begin_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path='' as $$
    begin
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at=pg_catalog.clock_timestamp()
       where id=p_job_id and claim_token=p_claim_token and status='running'
         and lease_expires_at>pg_catalog.clock_timestamp();
      if found then insert into public.boundary_calls values('gateway'); end if;
      return found;
    end $$;
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path='' as $$
    begin
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at=pg_catalog.clock_timestamp()
       where id=p_job_id and claim_token=p_claim_token and status='running'
         and lease_expires_at>pg_catalog.clock_timestamp();
      if found then insert into public.boundary_calls values('serverless_cs'); end if;
      return found;
    end $$;`);
    await db.exec(exactProviderBodyR12Migration);

    const rls = await db.query(`select c.relname,c.relrowsecurity
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='sellerpilot_private' and c.relname in(
        'coupang_create_transmissions','coupang_create_provider_body_seals')
      order by c.relname`);
    assert.equal(rls.rows.length, 2);
    assert.ok(rls.rows.every((row) => row.relrowsecurity === true));
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const table of ["coupang_create_transmissions", "coupang_create_provider_body_seals"]) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          assert.equal(await scalar(db, `select pg_catalog.has_table_privilege(
            $1,$2,$3)`, [role, `sellerpilot_private.${table}`, privilege]), false,
          `${role} unexpectedly has ${privilege} on ${table}`);
        }
      }
    }
    assert.equal(Number(await scalar(db, `select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      cross join lateral pg_catalog.aclexplode(c.relacl) acl
      where n.nspname='sellerpilot_private'
        and c.relname in('coupang_create_transmissions','coupang_create_provider_body_seals')
        and acl.grantee=0`)), 0);
    const publicRoutines = [
      "public.sellerpilot_service_record_coupang_create_transmission(uuid,uuid,uuid,uuid,jsonb)",
      "public.sellerpilot_service_begin_coupang_create_provider_mutation(text,uuid,uuid,jsonb)",
    ];
    for (const routine of publicRoutines) {
      assert.equal(await scalar(db, "select pg_catalog.has_function_privilege('anon',$1,'EXECUTE')", [routine]), false);
      assert.equal(await scalar(db, "select pg_catalog.has_function_privilege('authenticated',$1,'EXECUTE')", [routine]), false);
      assert.equal(await scalar(db, "select pg_catalog.has_function_privilege('service_role',$1,'EXECUTE')", [routine]), true);
    }
    const privateRoutines = [
      "sellerpilot_private.coupang_create_body_without_transport(jsonb)",
      "sellerpilot_private.coupang_create_transport_identity(jsonb)",
      "sellerpilot_private.coupang_create_provider_source_identity(jsonb)",
      "sellerpilot_private.guard_coupang_snapshot_one_category()",
      "sellerpilot_private.reject_coupang_create_boundary_mutation()",
      "sellerpilot_private.guard_coupang_create_official_sources()",
    ];
    for (const routine of privateRoutines) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(await scalar(db, `select pg_catalog.has_function_privilege(
          $1,$2,'EXECUTE')`, [role, routine]), false, `${role} executes ${routine}`);
      }
    }
    assert.equal(Number(await scalar(db, `select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      cross join lateral pg_catalog.aclexplode(p.proacl) acl
      where ((n.nspname='public' and p.proname in(
          'sellerpilot_service_record_coupang_create_transmission',
          'sellerpilot_service_begin_coupang_create_provider_mutation'))
        or (n.nspname='sellerpilot_private' and p.proname in(
          'coupang_create_body_without_transport','coupang_create_transport_identity',
          'coupang_create_provider_source_identity','guard_coupang_snapshot_one_category',
          'reject_coupang_create_boundary_mutation','guard_coupang_create_official_sources')))
        and acl.grantee=0`)), 0);
    const definerFunctions = await db.query(`select n.nspname,p.proname,p.prosecdef,p.proconfig
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where (n.nspname='public' and p.proname in(
          'sellerpilot_service_record_coupang_create_transmission',
          'sellerpilot_service_begin_coupang_create_provider_mutation'))
        or (n.nspname='sellerpilot_private' and p.proname in(
          'guard_coupang_snapshot_one_category',
          'reject_coupang_create_boundary_mutation','guard_coupang_create_official_sources'))`);
    assert.equal(definerFunctions.rows.length, 5);
    for (const routine of definerFunctions.rows) {
      assert.equal(routine.prosecdef, true, routine.proname);
      assert.ok(routine.proconfig?.includes('search_path=""'), routine.proname);
    }

    const sourceArgs = argumentsValue();
    const snapshotPayload = officialSnapshotPayload();
    await insertDuplicateAssignment(db, "59632");
    await assert.rejects(recordSnapshot(db, sourceArgs, snapshotPayload),
      /COUPANG_CREATE_OFFICIAL_SOURCE_CATEGORY_INVALID/);
    assert.equal(Number(await scalar(db,
      "select count(*) from sellerpilot_private.coupang_create_official_source_snapshots")), 0);
    await db.query("delete from sellerpilot_private.product_category_assignments where id=$1",
      ["40000000-0000-4000-8000-000000000002"]);
    const snapshot = await recordSnapshot(db, sourceArgs, snapshotPayload);
    const sourceBinding = {
      contract: "sellerpilot_coupang_create_source_revision_v1",
      productId: ids.product,
      productSourceSha256: "a".repeat(64),
      productSource: { sku: "NEW-SKU", name: "신규 상품", onHand: 9, costKrw: 8000 },
      detailPageVersion: 3,
      approvedManifestDigest: manifestDigest,
      officialReadEvidence: snapshotPayload.officialReadEvidence,
      officialReadSnapshotId: snapshot.snapshotId,
      officialReadSnapshotDigestSha256: snapshot.snapshotDigestSha256,
      sourceRevisionSha256: "c".repeat(64),
      credentialId: ids.credential,
      credentialVersion: 7,
      credentialFingerprint: "ABCDEF123456",
      credentialEnvironment: "production",
      credentialSellerIdentitySha256: "d".repeat(64),
      market: "KR",
      targetId: "A00123456",
    };
    const prepared = structuredClone(sourceArgs);
    prepared.body.items[0].images = [{
      imageOrder: 0, imageType: "REPRESENTATION",
      vendorPath: "https://cdn.example/normalized.jpg",
    }];
    prepared.body.items[0].contents = [{
      contentsType: "IMAGE",
      contentDetails: [{ content: "https://cdn.example/detail.jpg", detailType: "IMAGE" }],
    }];
    prepared.sellerpilotCoupangCreateSourceRevision = sourceBinding;
    prepared.sellerpilotPublicationAssetBinding = {
      contract: "sellerpilot_publication_asset_binding_v1",
      approvedManifestDigest: manifestDigest,
    };
    const transmission = await scalar(db, `select public.sellerpilot_service_record_coupang_create_transmission(
      $1,$2,$3,$4,$5::jsonb)`, [ids.owner,ids.product,ids.credential,ids.attempt,JSON.stringify(prepared)]);
    prepared.sellerpilotCoupangCreateTransmission = transmission;
    const claimToken = "80000000-0000-4000-8000-000000000001";
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,listing_id,attempt_id,created_by,channel,operation,environment,
      provider_mutation_started_at,request_payload,request_fingerprint,status,claim_token,lease_expires_at,
      worker_token_id
    ) values($1,$2,$3,$4,$5,'coupang','listing.create','production',null,
      jsonb_build_object('arguments',$6::jsonb),$7,'running',$8,clock_timestamp()+interval '5 minutes',$9)`,
    [ids.job,ids.credential,ids.listing,ids.attempt,ids.owner,JSON.stringify(prepared),requestFingerprint,claimToken,ids.token]);

    await assert.rejects(db.query(
      "select public.sellerpilot_service_begin_serverless_gateway_provider_mutation($1,$2,$3)",
      ["token",ids.job,claimToken]), /COUPANG_CREATE_PROVIDER_BODY_SEAL_REQUIRED/);
    const providerBody = { ...prepared.body, vendorId: "A00000000" };
    for (const [name, mutate] of [
      ["deliveryCharge", (body) => { body.deliveryCharge = 7777; }],
      ["attribute", (body) => { body.items[0].attributes[0].attributeValueName = "파랑"; }],
      ["notice", (body) => { body.items[0].notices[0].content = "변조 품명"; }],
      ["requested", (body) => { body.requested = true; }],
    ]) {
      const changed = structuredClone(providerBody);
      mutate(changed);
      await assert.rejects(db.query(`select public.sellerpilot_service_begin_coupang_create_provider_mutation(
        $1,$2,$3,$4::jsonb)`, ["token",ids.job,claimToken,JSON.stringify(changed)]),
      /COUPANG_CREATE_PROVIDER_BODY_SOURCE_MISMATCH/, name);
      assert.equal(Number(await scalar(db, `select count(*)
        from sellerpilot_private.coupang_create_provider_body_seals where job_id=$1`, [ids.job])), 0, name);
      assert.equal(await scalar(db, `select provider_mutation_started_at
        from sellerpilot_private.channel_gateway_jobs where id=$1`, [ids.job]), null, name);
    }
    await insertDuplicateAssignment(db, "59632");
    await assert.rejects(db.query(`select public.sellerpilot_service_begin_coupang_create_provider_mutation(
      $1,$2,$3,$4::jsonb)`, ["token",ids.job,claimToken,JSON.stringify(providerBody)]),
    /COUPANG_CREATE_PROVIDER_BODY_SOURCE_MISMATCH/);
    assert.equal(Number(await scalar(db, `select count(*)
      from sellerpilot_private.coupang_create_provider_body_seals where job_id=$1`, [ids.job])), 0);
    assert.equal(await scalar(db, `select provider_mutation_started_at
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [ids.job]), null);
    await db.query("delete from sellerpilot_private.product_category_assignments where id=$1",
      ["40000000-0000-4000-8000-000000000002"]);
    await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope='ai' where id=$1", [ids.token]);
    await assert.rejects(db.query(`select public.sellerpilot_service_begin_coupang_create_provider_mutation(
      $1,$2,$3,$4::jsonb)`, ["token",ids.job,claimToken,JSON.stringify(providerBody)]),
    /COUPANG_CREATE_PROVIDER_MUTATION_NOT_STARTED/);
    assert.equal(Number(await scalar(db, `select count(*)
      from sellerpilot_private.coupang_create_provider_body_seals where job_id=$1`, [ids.job])), 0);
    assert.equal(await scalar(db, `select provider_mutation_started_at
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [ids.job]), null);
    await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope='gateway' where id=$1", [ids.token]);
    assert.equal(await scalar(db, `select public.sellerpilot_service_begin_coupang_create_provider_mutation(
      $1,$2,$3,$4::jsonb)`, ["token",ids.job,claimToken,JSON.stringify(providerBody)]), true);
    assert.deepEqual((await db.query("select scope from public.boundary_calls order by ctid")).rows,
      [{ scope: "gateway" }]);
    const seal = (await db.query(`select provider_body,provider_body_sha256
      from sellerpilot_private.coupang_create_provider_body_seals where job_id=$1`, [ids.job])).rows[0];
    assert.deepEqual(seal.provider_body, providerBody);
    assert.equal(seal.provider_body_sha256, sha(providerBody));
    await assert.rejects(db.query(`update sellerpilot_private.coupang_create_provider_body_seals
      set provider_body=provider_body||'{"brand":"tampered"}'::jsonb where job_id=$1`, [ids.job]),
    /COUPANG_CREATE_BOUNDARY_IMMUTABLE/);
    await db.query("update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=null where id=$1", [ids.job]);
    await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope='serverless_cs' where id=$1", [ids.token]);
    assert.equal(await scalar(db, `select public.sellerpilot_service_begin_coupang_create_provider_mutation(
      $1,$2,$3,$4::jsonb)`, ["token",ids.job,claimToken,JSON.stringify(providerBody)]), true);
    assert.deepEqual((await db.query("select scope from public.boundary_calls order by ctid")).rows,
      [{ scope: "gateway" }, { scope: "serverless_cs" }]);
  } finally { await db.close(); }
});
