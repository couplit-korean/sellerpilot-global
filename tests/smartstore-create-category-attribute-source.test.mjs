import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const {
  buildSmartstoreCategoryProductAttributes,
  smartstoreCategoryAttributeAssignmentDigest,
  smartstoreCategoryAttributeOfficialReadbackDigest,
  smartstoreProductAttributesDigest,
} = await import("../lib/channels/smartstore-category-attribute-mapping.ts");

const [
  localFence,
  serverlessFence,
  categorySourceMigration,
  categorySourceHardeningMigration,
] = await Promise.all([
  readFile(new URL(
    "../supabase/migrations/20260910010000_fence_smartstore_create_source_revision.sql",
    import.meta.url,
  ), "utf8"),
  readFile(new URL(
    "../supabase/migrations/20260910014000_fence_smartstore_serverless_create_source_revision.sql",
    import.meta.url,
  ), "utf8"),
  readFile(new URL(
    "../supabase/migrations/20260910031000_smartstore_create_category_attribute_source.sql",
    import.meta.url,
  ), "utf8"),
  readFile(new URL(
    "../supabase/migrations/20260910035500_smartstore_create_category_source_hardening.sql",
    import.meta.url,
  ), "utf8"),
]);

const ids = {
  owner: "31000000-0000-4000-8000-000000000001",
  otherOwner: "31000000-0000-4000-8000-000000000002",
  product: "31000000-0000-4000-8000-000000000003",
  aiJob: "31000000-0000-4000-8000-000000000004",
  credential: "31000000-0000-4000-8000-000000000005",
  otherCredential: "31000000-0000-4000-8000-000000000006",
  assignment: "31000000-0000-4000-8000-000000000007",
  attempt: "31000000-0000-4000-8000-000000000008",
  listing: "31000000-0000-4000-8000-000000000009",
  job: "31000000-0000-4000-8000-000000000010",
  claim: "31000000-0000-4000-8000-000000000011",
};
const productUpdatedAt = "2026-09-10T00:00:00.123456+00:00";
const assignmentUpdatedAt = "2026-09-10T00:01:00.654321+00:00";
const detailDigest = "a".repeat(64);
const sellerAccountKey = "b".repeat(64);
const categoryId = "50022679";

const emptyOfficial = {
  category: {
    id: categoryId,
    name: "생활용품",
    last: true,
    exceptionalCategories: [],
    certificationInfos: [],
  },
  attributes: [],
  attributeValues: [],
  attributeValueUnits: [],
};

const completeOfficial = {
  category: { id: categoryId, name: "생활용품", last: true },
  attributes: [
    {
      attributeSeq: 100,
      attributeName: "크기",
      attributeClassificationType: "RANGE",
      attributeType: "PRIMARY",
      unitUsable: true,
      representativeUnitCode: "A00001",
      attributeValueMaxMatchingCount: 1,
    },
    {
      attributeSeq: 200,
      attributeName: "색상",
      attributeClassificationType: "SINGLE_SELECT",
      attributeType: "PRIMARY",
      unitUsable: false,
      attributeValueMaxMatchingCount: 1,
    },
    {
      attributeSeq: 300,
      attributeName: "재질",
      attributeClassificationType: "MULTI_SELECT",
      attributeType: "OPTIONAL",
      unitUsable: false,
      attributeValueMaxMatchingCount: 2,
    },
  ],
  attributeValues: [
    {
      attributeSeq: 100,
      attributeValueSeq: 1001,
      minAttributeValue: "1",
      maxAttributeValue: "10",
      minAttributeValueUnitCode: "A00001",
      maxAttributeValueUnitCode: "A00001",
    },
    { attributeSeq: 200, attributeValueSeq: 2001, minAttributeValue: "빨강" },
    { attributeSeq: 200, attributeValueSeq: 2002, minAttributeValue: "파랑" },
    { attributeSeq: 300, attributeValueSeq: 3001, minAttributeValue: "면" },
    { attributeSeq: 300, attributeValueSeq: 3002, minAttributeValue: "마" },
    { attributeSeq: 300, attributeValueSeq: 3003, minAttributeValue: "울" },
  ],
  attributeValueUnits: [{ id: "A00001", unitCodeName: "cm" }],
};

const completeProviderAttributes = [
  {
    attributeSeq: 100,
    attributeValueSeq: 1001,
    attributeRealValue: "5",
    attributeRealValueUnitCode: "A00001",
  },
  { attributeSeq: 200, attributeValueSeq: 2001 },
  { attributeSeq: 300, attributeValueSeq: 3001 },
  { attributeSeq: 300, attributeValueSeq: 3002 },
];

async function createDatabase({ applyHardening = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create extension if not exists pgcrypto;
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.ai_cli_jobs(
      id uuid primary key,
      request_payload jsonb not null
    );
    create table sellerpilot_private.products(
      id uuid primary key,
      owner_id uuid not null,
      ai_job_id uuid,
      sku text not null,
      status text not null,
      demo boolean not null default false,
      updated_at timestamptz not null,
      detail_page_version bigint not null,
      detail_page_approved_version bigint not null,
      detail_page_image_manifest jsonb
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      last_check_status text,
      version integer not null,
      fingerprint text not null,
      seller_account_key text,
      seller_account_key_source text
    );
    create table sellerpilot_private.product_category_assignments(
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid,
      source_ref text not null,
      product_name text not null,
      channel text not null,
      environment text not null,
      market text not null,
      category_id text not null,
      category_path text[] not null,
      is_leaf boolean not null,
      confidence numeric not null,
      classification_source text not null,
      required_attributes jsonb not null,
      provided_attributes jsonb not null,
      missing_required_attributes jsonb not null,
      official_metadata jsonb not null,
      status text not null,
      official_verified_at timestamptz,
      confirmed_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      remote_id text,
      seller_account_key text
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      operation_attempt_id uuid,
      seller_account_key text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      credential_id uuid not null,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb,
      status text not null,
      claim_token uuid,
      seller_account_key text,
      created_by uuid not null,
      provider_mutation_started_at timestamptz,
      completed_at timestamptz,
      response_payload jsonb
    );
    create function sellerpilot_private.request_has_unambiguous_service_role_claim()
    returns boolean language sql stable as $$ select true $$;
    create function public.sellerpilot_service_begin_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer as $$
    begin
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at=clock_timestamp()
       where id=p_job_id and claim_token=p_claim_token
         and status='running' and provider_mutation_started_at is null;
      return found;
    end $$;

    insert into sellerpilot_private.admin_users values ('${ids.owner}');
    insert into sellerpilot_private.ai_cli_jobs values (
      '${ids.aiJob}', '{"manual_fields":{"sellerSku":"SMART-011"}}'
    );
    insert into sellerpilot_private.products values (
      '${ids.product}','${ids.owner}','${ids.aiJob}','SMART-011','ready',false,
      '${productUpdatedAt}',3,3,'{"digest":"${detailDigest}"}'
    );
    insert into sellerpilot_private.channel_credentials values (
      '${ids.credential}','smartstore','production','active',
      '2099-01-01T00:00:00Z','passed',7,'ABCDEF123456',
      '${sellerAccountKey}','provider_certified_v1'
    );
    insert into sellerpilot_private.channel_credentials values (
      '${ids.otherCredential}','smartstore','sandbox','active',
      '2099-01-01T00:00:00Z','passed',1,'654321FEDCBA',
      '${"c".repeat(64)}','credential_incarnation_v1'
    );
    insert into sellerpilot_private.product_category_assignments values (
      '${ids.assignment}','${ids.owner}','${ids.product}','smart-011',
      '상품','smartstore','production','KR','${categoryId}',array['생활용품'],
      true,1,'official_tree_search','[]','{}','[]','{"verifiedBy":"channel_api"}',
      'confirmed','2026-09-10T00:00:30Z','2026-09-10T00:00:45Z',
      '2026-09-10T00:00:00Z','${assignmentUpdatedAt}'
    );
    insert into sellerpilot_private.channel_operation_attempts values (
      '${ids.attempt}','${ids.owner}','${ids.credential}','smartstore',
      'listing.create','running',null,'${sellerAccountKey}'
    );
    insert into sellerpilot_private.product_listings values (
      '${ids.listing}','${ids.owner}','${ids.product}','smartstore',
      '${ids.attempt}',null
    );
    insert into sellerpilot_private.channel_gateway_jobs values (
      '${ids.job}','${ids.credential}','${ids.attempt}','${ids.listing}',
      'smartstore','listing.create','production',
      jsonb_build_object('arguments',jsonb_build_object(
        'sellerpilotSmartstoreCreateSource',jsonb_build_object(
          'contract','smartstore_listing_create_source_v1',
          'productId','${ids.product}',
          'ownerId','${ids.owner}',
          'productUpdatedAt','${productUpdatedAt}',
          'detailPageVersion',3,
          'approvedDetailPageVersion',3,
          'approvedManifestDigest','${detailDigest}',
          'sellerManagementCode','SMART-011',
          'credentialId','${ids.credential}',
          'credentialVersion',7,
          'credentialFingerprint','ABCDEF123456'
        ),
        'body',jsonb_build_object('originProduct',jsonb_build_object(
          'leafCategoryId','${categoryId}',
          'detailAttribute',jsonb_build_object(
            'sellerCodeInfo',jsonb_build_object(
              'sellerManagementCode','SMART-011'
            )
          )
        ))
      )),
      'running','${ids.claim}','${sellerAccountKey}','${ids.owner}',null,null,null
    );
  `);
  await db.exec(localFence);
  await db.exec(`
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer as $$
    begin
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at=clock_timestamp()
       where id=p_job_id and claim_token=p_claim_token
         and status='running' and provider_mutation_started_at is null;
      return found;
    end $$;
  `);
  await db.exec(serverlessFence);
  await db.exec(categorySourceMigration);
  if (applyHardening) await db.exec(categorySourceHardeningMigration);
  return db;
}

async function storeCompleteSelections(db) {
  await db.query(`
    update sellerpilot_private.product_category_assignments
       set provided_attributes=$1::jsonb
     where id=$2
  `, [JSON.stringify({
    "100": {
      attributeValueSeq: 1001,
      attributeRealValue: "5",
      attributeRealValueUnitCode: "A00001",
    },
    "200": 2001,
    "300": [3001, 3002],
  }), ids.assignment]);
}

async function appendSource(db, overrides = {}) {
  const values = {
    owner: ids.owner,
    product: ids.product,
    productUpdatedAt,
    credential: ids.credential,
    credentialVersion: 7,
    sellerAccountKey,
    detailRevision: 3,
    detailDigest,
    assignment: ids.assignment,
    assignmentUpdatedAt,
    providerAttributes: [],
    official: emptyOfficial,
    ...overrides,
  };
  const result = await db.query(`
    select public.sellerpilot_service_append_smartstore_create_category_source(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb
    ) source
  `, [
    values.owner,
    values.product,
    values.productUpdatedAt,
    values.credential,
    values.credentialVersion,
    values.sellerAccountKey,
    values.detailRevision,
    values.detailDigest,
    values.assignment,
    values.assignmentUpdatedAt,
    JSON.stringify(values.providerAttributes),
    JSON.stringify(values.official),
  ]);
  return result.rows[0].source;
}

async function snapshot(db) {
  const result = await db.query(`
    select public.sellerpilot_service_smartstore_create_source_snapshot(
      $1,$2,$3
    ) snapshot
  `, [ids.owner, ids.product, ids.credential]);
  return result.rows[0].snapshot;
}

async function bindJob(db) {
  const source = await snapshot(db);
  const mapping = buildSmartstoreCategoryProductAttributes({
    assignment: source.categoryAttributeSource.assignment,
    officialReadback: source.categoryAttributeSource.officialReadback,
  });
  assert.equal(mapping.ok, true);
  const request = (await db.query(
    "select request_payload from sellerpilot_private.channel_gateway_jobs where id=$1",
    [ids.job],
  )).rows[0].request_payload;
  request.arguments.sellerpilotSmartstoreCategoryAttributeMapping = mapping;
  request.arguments.body.originProduct.detailAttribute.productAttributes =
    mapping.productAttributes;
  await db.query(
    "update sellerpilot_private.channel_gateway_jobs set request_payload=$1 where id=$2",
    [request, ids.job],
  );
  return { source, mapping };
}

async function begin(db, worker) {
  const rpc = worker === "local"
    ? "sellerpilot_service_begin_gateway_provider_mutation"
    : "sellerpilot_service_begin_serverless_gateway_provider_mutation";
  const result = await db.query(
    `select public.${rpc}('token',$1,$2) started`,
    [ids.job, ids.claim],
  );
  return result.rows[0].started;
}

test("actual SQL snapshot emits server digests and exact replay is idempotent", async () => {
  const db = await createDatabase();
  try {
    const first = await appendSource(db);
    assert.equal(first.replayed, false);
    assert.equal(first.assignmentRevision, 1);
    const source = await snapshot(db);
    assert.equal(
      source.categoryAttributeSource.contract,
      "smartstore_listing_create_category_source_v1",
    );
    assert.ok(Date.parse(source.categoryAttributeSource.collectedAt));
    assert.ok(
      Date.parse(source.categoryAttributeSource.expiresAt)
        > Date.parse(source.categoryAttributeSource.collectedAt),
    );
    const assignment = source.categoryAttributeSource.assignment;
    const official = source.categoryAttributeSource.officialReadback;
    assert.equal(
      assignment.digest,
      smartstoreCategoryAttributeAssignmentDigest({
        ...assignment,
        digest: undefined,
      }),
    );
    const { digest: ignoredDigest, ...officialWithoutDigest } = official;
    assert.ok(ignoredDigest);
    assert.equal(
      official.digest,
      smartstoreCategoryAttributeOfficialReadbackDigest(officialWithoutDigest),
    );
    const replay = await appendSource(db);
    assert.equal(replay.replayed, true);
    assert.equal(replay.sourceId, first.sourceId);
    const count = await db.query(`select count(*)::integer count
      from sellerpilot_private.smartstore_create_category_attribute_sources`);
    assert.equal(count.rows[0].count, 1);
  } finally {
    await db.close();
  }
});

test("actual SQL rejects every malformed nested receipt before revision lookup", async () => {
  const db = await createDatabase();
  try {
    await storeCompleteSelections(db);
    const malformed = [
      {
        label: "category extra untyped field",
        official: {
          ...completeOfficial,
          category: { ...completeOfficial.category, poison: { nested: true } },
        },
      },
      {
        label: "attribute scalar",
        official: { ...completeOfficial, attributes: [7] },
      },
      {
        label: "attribute extra field",
        official: {
          ...completeOfficial,
          attributes: completeOfficial.attributes.map((item, index) =>
            index === 0 ? { ...item, injected: true } : item),
        },
      },
      {
        label: "attribute missing required nested field",
        official: {
          ...completeOfficial,
          attributes: completeOfficial.attributes.map((item, index) => {
            if (index !== 0) return item;
            const { attributeName: ignored, ...missing } = item;
            assert.ok(ignored);
            return missing;
          }),
        },
      },
      {
        label: "duplicate attribute ID",
        official: {
          ...completeOfficial,
          attributes: [
            ...completeOfficial.attributes,
            { ...completeOfficial.attributes[0] },
          ],
        },
      },
      {
        label: "cross-category value",
        official: {
          ...completeOfficial,
          attributeValues: [
            ...completeOfficial.attributeValues,
            { attributeSeq: 999, attributeValueSeq: 9991, minAttributeValue: "x" },
          ],
        },
      },
      {
        label: "duplicate value ID across attributes",
        official: {
          ...completeOfficial,
          attributeValues: completeOfficial.attributeValues.map((item, index) =>
            index === 1 ? { ...item, attributeValueSeq: 1001 } : item),
        },
      },
      {
        label: "value missing required nested field",
        official: {
          ...completeOfficial,
          attributeValues: completeOfficial.attributeValues.map((item, index) => {
            if (index !== 1) return item;
            const { minAttributeValue: ignored, ...missing } = item;
            assert.ok(ignored);
            return missing;
          }),
        },
      },
      {
        label: "duplicate unit",
        official: {
          ...completeOfficial,
          attributeValueUnits: [
            ...completeOfficial.attributeValueUnits,
            { ...completeOfficial.attributeValueUnits[0] },
          ],
        },
      },
      {
        label: "unit missing required nested field",
        official: {
          ...completeOfficial,
          attributeValueUnits: [{ id: "A00001" }],
        },
      },
      {
        label: "unknown official range unit",
        official: {
          ...completeOfficial,
          attributeValues: completeOfficial.attributeValues.map((item, index) =>
            index === 0
              ? { ...item, maxAttributeValueUnitCode: "A99999" }
              : item),
        },
      },
      {
        label: "provider unknown value",
        providerAttributes: completeProviderAttributes.map((item, index) =>
          index === 1 ? { ...item, attributeValueSeq: 9999 } : item),
      },
      {
        label: "provider duplicate pair",
        providerAttributes: [
          ...completeProviderAttributes,
          { ...completeProviderAttributes[1] },
        ],
      },
      {
        label: "select real value",
        providerAttributes: completeProviderAttributes.map((item, index) =>
          index === 1 ? { ...item, attributeRealValue: "1" } : item),
      },
      {
        label: "range out of bounds",
        providerAttributes: completeProviderAttributes.map((item, index) =>
          index === 0 ? { ...item, attributeRealValue: "11" } : item),
      },
      {
        label: "required PRIMARY missing",
        providerAttributes: completeProviderAttributes.filter(
          (item) => item.attributeSeq !== 200,
        ),
      },
      {
        label: "multi cardinality exceeded",
        providerAttributes: [
          ...completeProviderAttributes,
          { attributeSeq: 300, attributeValueSeq: 3003 },
        ],
      },
    ];
    for (const candidate of malformed) {
      await assert.rejects(
        appendSource(db, {
          providerAttributes:
            candidate.providerAttributes ?? completeProviderAttributes,
          official: candidate.official ?? completeOfficial,
        }),
        /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_PAYLOAD_INVALID/,
        candidate.label,
      );
      const rows = await db.query(`select count(*)::integer count
        from sellerpilot_private.smartstore_create_category_attribute_sources`);
      assert.equal(rows.rows[0].count, 0, `${candidate.label} poisoned ledger`);
    }

    const valid = await appendSource(db, {
      providerAttributes: completeProviderAttributes,
      official: completeOfficial,
    });
    assert.equal(valid.replayed, false);
    assert.equal(valid.assignmentRevision, 1,
      "invalid attempts must not reserve a revision");
  } finally {
    await db.close();
  }
});

test("PostgreSQL C UTF-8 and TypeScript canonical digests match for BMP/emoji order", async () => {
  const db = await createDatabase();
  try {
    const records = [{ "\uE000": 1, "😀": 2 }, { marker: "😀\uE000" }];
    const sql = await db.query(`select
      sellerpilot_private.smartstore_category_source_hash(
        sellerpilot_private.smartstore_category_source_sorted_records($1::jsonb)
      ) digest`, [JSON.stringify(records)]);
    assert.equal(sql.rows[0].digest, smartstoreProductAttributesDigest(records));
  } finally {
    await db.close();
  }
});

test("private ledger is RLS/ACL protected, append-only, one-current and retire-safe", async () => {
  const db = await createDatabase();
  try {
    const first = await appendSource(db);
    const privilege = await db.query(`
      select
        has_table_privilege('authenticated',
          'sellerpilot_private.smartstore_create_category_attribute_sources',
          'select') authenticated_table,
        has_table_privilege('service_role',
          'sellerpilot_private.smartstore_create_category_attribute_sources',
          'select') service_table,
        has_function_privilege('authenticated',
          'public.sellerpilot_service_append_smartstore_create_category_source(uuid,uuid,timestamptz,uuid,integer,text,bigint,text,uuid,timestamptz,jsonb,jsonb)',
          'execute') authenticated_append,
        has_function_privilege('service_role',
          'public.sellerpilot_service_append_smartstore_create_category_source(uuid,uuid,timestamptz,uuid,integer,text,bigint,text,uuid,timestamptz,jsonb,jsonb)',
          'execute') service_append,
        has_function_privilege('authenticated',
          'public.sellerpilot_service_read_smartstore_create_category_source(uuid,uuid,uuid)',
          'execute') authenticated_read,
        has_function_privilege('authenticated',
          'public.sellerpilot_service_retire_smartstore_create_category_source(uuid,text,text,text)',
          'execute') authenticated_retire,
        (select relrowsecurity from pg_catalog.pg_class
          where oid='sellerpilot_private.smartstore_create_category_attribute_sources'::regclass
        ) rls
    `);
    assert.deepEqual(privilege.rows[0], {
      authenticated_table: false,
      service_table: false,
      authenticated_append: false,
      service_append: true,
      authenticated_read: false,
      authenticated_retire: false,
      rls: true,
    });
    await assert.rejects(
      db.exec(`update sellerpilot_private.smartstore_create_category_attribute_sources
        set assignment_revision=99`),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_APPEND_ONLY/,
    );
    await assert.rejects(
      db.exec("delete from sellerpilot_private.smartstore_create_category_attribute_sources"),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_APPEND_ONLY/,
    );

    await db.exec(`update sellerpilot_private.product_category_assignments
      set official_metadata='{"verifiedBy":"channel_api","revision":2}',
          updated_at=updated_at+interval '1 microsecond'`);
    const second = await appendSource(db, {
      assignmentUpdatedAt: "2026-09-10T00:01:00.654322+00:00",
    });
    assert.equal(second.assignmentRevision, 2);
    const currents = await db.query(`select
      count(*) filter(where retired_at is null)::integer current_count,
      count(*)::integer total_count
      from sellerpilot_private.smartstore_create_category_attribute_sources`);
    assert.deepEqual(currents.rows[0], { current_count: 1, total_count: 2 });

    const retired = await db.query(`
      select public.sellerpilot_service_retire_smartstore_create_category_source(
        $1,$2,$3,'operator_retired'
      ) retired
    `, [second.sourceId, second.assignmentDigest, second.officialReadbackDigest]);
    assert.equal(retired.rows[0].retired, true);
    const replayRetire = await db.query(`
      select public.sellerpilot_service_retire_smartstore_create_category_source(
        $1,$2,$3,'operator_retired'
      ) retired
    `, [second.sourceId, second.assignmentDigest, second.officialReadbackDigest]);
    assert.equal(replayRetire.rows[0].retired, false);
    await assert.rejects(
      appendSource(db, {
        assignmentUpdatedAt: "2026-09-10T00:01:00.654322+00:00",
      }),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_RETIRED_REPLAY/,
    );
    assert.notEqual(first.sourceId, second.sourceId);
  } finally {
    await db.close();
  }
});

test("service writer rejects NULL, stale and cross-owner/credential/category data while official drift advances revision", async () => {
  const db = await createDatabase();
  try {
    await assert.rejects(
      appendSource(db, { providerAttributes: null }),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_NULL_OR_SHAPE_INVALID/,
    );
    await assert.rejects(
      appendSource(db, {
        productUpdatedAt: "2026-09-10T00:00:00.123455+00:00",
      }),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_PRODUCT_STALE/,
    );
    await assert.rejects(
      appendSource(db, { owner: ids.otherOwner }),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_PRODUCT_STALE/,
    );
    await assert.rejects(
      appendSource(db, { credential: ids.otherCredential }),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_CREDENTIAL_STALE/,
    );
    await assert.rejects(
      appendSource(db, {
        assignmentUpdatedAt: "2026-09-10T00:01:00.654320+00:00",
      }),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_ASSIGNMENT_STALE/,
    );
    await assert.rejects(
      appendSource(db, {
        official: {
          ...emptyOfficial,
          category: { id: "50000000", name: "다른 카테고리", last: true },
        },
      }),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_CROSS_CATEGORY/,
    );
    const first = await appendSource(db);
    const replacement = await appendSource(db, {
      official: {
        ...emptyOfficial,
        category: { ...emptyOfficial.category, name: "변경된 공식명" },
      },
    });
    assert.equal(replacement.assignmentRevision, first.assignmentRevision + 1);
    const rows = await db.query(`select id,retired_reason
      from sellerpilot_private.smartstore_create_category_attribute_sources
      order by assignment_revision`);
    assert.equal(rows.rows[0].retired_reason, "superseded");
    assert.equal(rows.rows[1].retired_reason, null);
  } finally {
    await db.close();
  }
});

test("SQL compiles provider attributes only from the exact stored assignment", async () => {
  const db = await createDatabase();
  try {
    await assert.rejects(
      appendSource(db, {
        providerAttributes: completeProviderAttributes,
        official: completeOfficial,
      }),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_STORED_SELECTION_MISMATCH/,
    );
    await storeCompleteSelections(db);
    const appended = await appendSource(db, {
      providerAttributes: completeProviderAttributes,
      official: completeOfficial,
    });
    assert.equal(appended.replayed, false);
    const reorderedReplay = await appendSource(db, {
      providerAttributes: [...completeProviderAttributes].reverse(),
      official: {
        ...completeOfficial,
        attributes: [...completeOfficial.attributes].reverse(),
        attributeValues: [...completeOfficial.attributeValues].reverse(),
        attributeValueUnits: [...completeOfficial.attributeValueUnits].reverse(),
      },
    });
    assert.equal(reorderedReplay.replayed, true);
    assert.equal(reorderedReplay.sourceId, appended.sourceId);
    const { mapping } = await bindJob(db);
    assert.deepEqual(mapping.productAttributes, completeProviderAttributes);
    await db.query(`select
      public.sellerpilot_service_retire_smartstore_create_category_source(
        $1,$2,$3,'source_invalidated'
      )`, [
      appended.sourceId,
      appended.assignmentDigest,
      appended.officialReadbackDigest,
    ]);
    await assert.rejects(
      appendSource(db, {
        providerAttributes: [...completeProviderAttributes].reverse(),
        official: {
          ...completeOfficial,
          attributes: [...completeOfficial.attributes].reverse(),
          attributeValues: [...completeOfficial.attributeValues].reverse(),
          attributeValueUnits: [...completeOfficial.attributeValueUnits].reverse(),
        },
      }),
      /SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_RETIRED_REPLAY/,
    );
  } finally {
    await db.close();
  }
});

test("exact-one confirmed assignment is a database invariant and final CAS rejects expiry", async () => {
  const db = await createDatabase();
  try {
    await assert.rejects(
      db.exec(`insert into sellerpilot_private.product_category_assignments
        select '${ids.otherCredential}',owner_id,product_id,'racing-assignment',
          product_name,channel,environment,market,'50000000',
          array['경쟁'],true,confidence,classification_source,
          required_attributes,provided_attributes,missing_required_attributes,
          official_metadata,status,official_verified_at,confirmed_at,
          created_at,updated_at + interval '1 microsecond'
        from sellerpilot_private.product_category_assignments
        where id='${ids.assignment}'`),
      /smartstore_one_confirmed_production_kr_leaf_assignment_idx/,
    );

    await db.exec(`alter table
      sellerpilot_private.smartstore_create_category_attribute_sources
      alter column expires_at set default
        (clock_timestamp() + interval '1 second')`);
    const first = await appendSource(db);
    await bindJob(db);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.equal(await begin(db, "local"), false);
    assert.equal(await begin(db, "serverless"), false);
    const notStarted = await db.query(`select
      provider_mutation_started_at is null not_started
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [ids.job]);
    assert.equal(notStarted.rows[0].not_started, true);
    await db.exec(`alter table
      sellerpilot_private.smartstore_create_category_attribute_sources
      alter column expires_at set default
        (clock_timestamp() + interval '15 minutes')`);
    const refreshed = await appendSource(db);
    assert.equal(refreshed.assignmentRevision, first.assignmentRevision + 1);
    const source = await snapshot(db);
    assert.equal(
      source.categoryAttributeSource.assignment.revision,
      refreshed.assignmentRevision,
    );
    await bindJob(db);
    assert.equal(await begin(db, "serverless"), true);
  } finally {
    await db.close();
  }
});

test("hardening migration fails atomically when preexisting assignments violate exact-one", async () => {
  const db = await createDatabase({ applyHardening: false });
  try {
    await db.exec(`insert into sellerpilot_private.product_category_assignments
      select '${ids.otherCredential}',owner_id,product_id,'preexisting-duplicate',
        product_name,channel,environment,market,'50000000',
        array['경쟁'],true,confidence,classification_source,
        required_attributes,provided_attributes,missing_required_attributes,
        official_metadata,status,official_verified_at,confirmed_at,
        created_at,updated_at + interval '1 microsecond'
      from sellerpilot_private.product_category_assignments
      where id='${ids.assignment}'`);
    await assert.rejects(
      db.exec(categorySourceHardeningMigration),
      /smartstore_one_confirmed_production_kr_leaf_assignment_idx/,
    );
    await db.exec("rollback");
    const column = await db.query(`select count(*)::integer count
      from information_schema.columns
      where table_schema='sellerpilot_private'
        and table_name='smartstore_create_category_attribute_sources'
        and column_name='expires_at'`);
    assert.equal(column.rows[0].count, 0, "failed migration must roll back");
  } finally {
    await db.close();
  }
});

test("append and final CAS definitions share advisory and row lock order", async () => {
  const db = await createDatabase();
  try {
    const definitions = await db.query(`select
      pg_get_functiondef(
        'public.sellerpilot_service_append_smartstore_create_category_source(uuid,uuid,timestamptz,uuid,integer,text,bigint,text,uuid,timestamptz,jsonb,jsonb)'::regprocedure
      ) append_definition,
      pg_get_functiondef(
        'sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)'::regprocedure
      ) fence_definition`);
    const appendDefinition = definitions.rows[0].append_definition;
    const fenceDefinition = definitions.rows[0].fence_definition;
    for (const definition of [appendDefinition, fenceDefinition]) {
      assert.match(definition, /pg_advisory_xact_lock\(193674993, 910035500\)/);
    }
    assert.ok(
      appendDefinition.indexOf("from sellerpilot_private.products candidate")
        < appendDefinition.indexOf("from sellerpilot_private.channel_credentials candidate"),
    );
    assert.ok(
      appendDefinition.indexOf("from sellerpilot_private.channel_credentials candidate")
        < appendDefinition.indexOf("from sellerpilot_private.product_category_assignments candidate"),
    );
    assert.ok(
      appendDefinition.indexOf("from sellerpilot_private.product_category_assignments candidate")
        < appendDefinition.indexOf("from sellerpilot_private.smartstore_create_category_attribute_sources source"),
    );
    assert.ok(
      fenceDefinition.indexOf("from sellerpilot_private.products product")
        < fenceDefinition.indexOf("from sellerpilot_private.channel_credentials credential"),
    );
    assert.ok(
      fenceDefinition.indexOf("from sellerpilot_private.channel_credentials credential")
        < fenceDefinition.indexOf("from sellerpilot_private.product_category_assignments assignment"),
    );
    assert.ok(
      fenceDefinition.indexOf("from sellerpilot_private.product_category_assignments assignment")
        < fenceDefinition.lastIndexOf("for update of job, source"),
    );
  } finally {
    await db.close();
  }
});

test("local and serverless begin compare current mapping/body and DB rows before provider start", async () => {
  for (const worker of ["local", "serverless"]) {
    const exactDb = await createDatabase();
    try {
      await appendSource(exactDb);
      await bindJob(exactDb);
      assert.equal(await begin(exactDb, worker), true, `${worker} exact begin`);
      assert.equal(await begin(exactDb, worker), false, `${worker} replay`);
    } finally {
      await exactDb.close();
    }

    const mappingDriftDb = await createDatabase();
    try {
      await appendSource(mappingDriftDb);
      await bindJob(mappingDriftDb);
      await mappingDriftDb.exec(`update sellerpilot_private.channel_gateway_jobs
        set request_payload=jsonb_set(request_payload,
          '{arguments,sellerpilotSmartstoreCategoryAttributeMapping,assignmentDigest}',
          to_jsonb('${"d".repeat(64)}'::text))`);
      assert.equal(await begin(mappingDriftDb, worker), false, `${worker} mapping drift`);
      const started = await mappingDriftDb.query(`select
        provider_mutation_started_at is not null started
        from sellerpilot_private.channel_gateway_jobs where id=$1`, [ids.job]);
      assert.equal(started.rows[0].started, false);
    } finally {
      await mappingDriftDb.close();
    }

    const dbDriftDb = await createDatabase();
    try {
      await appendSource(dbDriftDb);
      await bindJob(dbDriftDb);
      await dbDriftDb.exec(`update sellerpilot_private.products
        set updated_at=updated_at+interval '1 microsecond'`);
      assert.equal(await begin(dbDriftDb, worker), false, `${worker} product microsecond drift`);
      await dbDriftDb.exec(`update sellerpilot_private.products
        set updated_at='${productUpdatedAt}',
            detail_page_image_manifest='{"digest":"${"e".repeat(64)}"}'`);
      assert.equal(await begin(dbDriftDb, worker), false, `${worker} approval drift`);
      await dbDriftDb.exec(`update sellerpilot_private.products
        set detail_page_image_manifest='{"digest":"${detailDigest}"}';
        update sellerpilot_private.product_category_assignments
          set updated_at=updated_at+interval '1 microsecond'`);
      assert.equal(await begin(dbDriftDb, worker), false, `${worker} assignment drift`);
      await dbDriftDb.exec(`update sellerpilot_private.product_category_assignments
        set updated_at='${assignmentUpdatedAt}';
        update sellerpilot_private.channel_credentials set version=8
        where id='${ids.credential}'`);
      assert.equal(await begin(dbDriftDb, worker), false, `${worker} credential drift`);
    } finally {
      await dbDriftDb.close();
    }
  }
});
