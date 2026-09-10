import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    const dataModule = (source: string) => ({
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(source)}`,
    });
    if (specifier === "next/server") {
      return dataModule("export const NextResponse=globalThis.Response;");
    }
    if (specifier.endsWith("/admin-api")) {
      return dataModule(`
        export const authenticateAdminRequest=(...args)=>globalThis.__smartstoreCollectorAdmin(...args);
        export const isAdminApiError=()=>false;
      `);
    }
    if (specifier.endsWith("/channels/gateway")) {
      return dataModule(`
        export const executeViaChannelGateway=(...args)=>globalThis.__smartstoreCollectorGateway(...args);
      `);
    }
    if (specifier.endsWith("/channels/smartstore-local-read-routing")) {
      return dataModule(`
        export const resolveLocalGatewayReadReady=()=>({available:true,reason:"ready",message:"ready",checkedAt:new Date().toISOString()});
      `);
    }
    return nextResolve(specifier, context);
  },
});

const {
  assertSmartstoreCreateCategorySourceFreshSnapshot,
  parseSmartstoreCreateCategorySourceCollectionContext,
  smartstoreCreateCategoryOfficialReceipt,
  smartstoreCreateProviderAttributes,
} = await import("../lib/server-smartstore-create-category-source-collector");
const {
  smartstoreCategoryAttributeAssignmentContract,
  smartstoreCategoryAttributeAssignmentDigest,
  smartstoreCategoryAttributeOfficialReadbackContract,
  smartstoreCategoryAttributeOfficialReadbackDigest,
} = await import("../lib/channels/smartstore-category-attribute-mapping");

const migration = await readFile(new URL(
  "../supabase/migrations/20260910032000_smartstore_create_category_source_collector_context.sql",
  import.meta.url,
), "utf8");

const ids = {
  owner: "32000000-0000-4000-8000-000000000001",
  otherOwner: "32000000-0000-4000-8000-000000000002",
  product: "32000000-0000-4000-8000-000000000003",
  credential: "32000000-0000-4000-8000-000000000004",
  assignment: "32000000-0000-4000-8000-000000000005",
  secondAssignment: "32000000-0000-4000-8000-000000000006",
};
const productUpdatedAt = "2026-09-10T02:00:00.123456+00:00";
const assignmentUpdatedAt = "2026-09-10T02:01:00.654321+00:00";
const sellerAccountKey = "b".repeat(64);
const detailDigest = "a".repeat(64);
const categoryId = "50022679";

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.products(
      id uuid primary key,
      owner_id uuid not null,
      status text not null,
      demo boolean not null,
      updated_at timestamptz not null,
      detail_page_version bigint,
      detail_page_approved_version bigint,
      detail_page_image_manifest jsonb
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      last_check_status text,
      version integer,
      seller_account_key text,
      seller_account_key_source text
    );
    create table sellerpilot_private.product_category_assignments(
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid,
      source_ref text,
      channel text not null,
      environment text not null,
      market text not null,
      status text not null,
      is_leaf boolean not null,
      official_verified_at timestamptz,
      confirmed_at timestamptz,
      required_attributes jsonb not null,
      provided_attributes jsonb not null,
      missing_required_attributes jsonb not null,
      category_id text not null,
      updated_at timestamptz not null
    );
    create function sellerpilot_private.request_has_unambiguous_service_role_claim()
    returns boolean language sql stable as $$ select true $$;
    create function public.sellerpilot_service_append_smartstore_create_category_source(
      uuid,uuid,timestamptz,uuid,integer,text,bigint,text,uuid,timestamptz,jsonb,jsonb
    ) returns jsonb language sql as $$ select '{}'::jsonb $$;

    insert into sellerpilot_private.products values (
      '${ids.product}','${ids.owner}','ready',false,'${productUpdatedAt}',
      3,3,'{"digest":"${detailDigest}"}'
    );
    insert into sellerpilot_private.channel_credentials values (
      '${ids.credential}','smartstore','production','active',
      '2099-01-01T00:00:00Z','passed',7,'${sellerAccountKey}',
      'provider_certified_v1'
    );
    insert into sellerpilot_private.product_category_assignments values (
      '${ids.assignment}','${ids.owner}','${ids.product}','fixture',
      'smartstore','production','KR','confirmed',true,
      '2026-09-10T02:00:30Z','2026-09-10T02:00:40Z','[]',
      '{"10020580":"10832333"}','[]','${categoryId}',
      '${assignmentUpdatedAt}'
    );
  `);
  await db.exec(migration);
  return db;
}

async function context(db: PGlite, owner = ids.owner) {
  const result = await db.query<{ value: Record<string, unknown> }>(`
    select public.sellerpilot_service_smartstore_create_category_collect_ctx(
      $1,$2,$3
    ) value
  `, [owner, ids.product, ids.credential]);
  return result.rows[0].value;
}

test("actual SQL context is service-only and preserves current exact revisions", async () => {
  const db = await createDatabase();
  try {
    const privileges = await db.query<{ authenticated: boolean; service: boolean }>(`
      select
        has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_smartstore_create_category_collect_ctx(uuid,uuid,uuid)',
          'EXECUTE'
        ) authenticated,
        has_function_privilege(
          'service_role',
          'public.sellerpilot_service_smartstore_create_category_collect_ctx(uuid,uuid,uuid)',
          'EXECUTE'
        ) service
    `);
    assert.deepEqual(privileges.rows[0], {
      authenticated: false,
      service: true,
    });
    await db.exec("set role authenticated");
    await assert.rejects(() => context(db), /permission denied/iu);
    await db.exec("reset role");

    const parsed = parseSmartstoreCreateCategorySourceCollectionContext(
      await context(db),
    );
    assert.equal(parsed.ownerId, ids.owner);
    assert.equal(parsed.productUpdatedAt, productUpdatedAt);
    assert.equal(parsed.assignmentUpdatedAt, assignmentUpdatedAt);
    assert.equal(parsed.credentialVersion, 7);
    assert.equal(parsed.sellerAccountKey, sellerAccountKey);
    assert.equal(parsed.approvedDetailDigest, detailDigest);
    assert.deepEqual(parsed.providedAttributes, { "10020580": "10832333" });

    await assert.rejects(
      () => context(db, ids.otherOwner),
      /SMARTSTORE_CATEGORY_SOURCE_COLLECTION_PRODUCT_NOT_READY/,
    );
    for (const [column, invalid, restore] of [
      ["status", "draft", "confirmed"],
      ["environment", "sandbox", "production"],
      ["market", "JP", "KR"],
    ] as const) {
      await db.query(`update sellerpilot_private.product_category_assignments
        set ${column}=$1 where id=$2`, [invalid, ids.assignment]);
      await assert.rejects(
        () => context(db),
        /SMARTSTORE_CATEGORY_SOURCE_COLLECTION_ASSIGNMENT_AMBIGUOUS/,
      );
      await db.query(`update sellerpilot_private.product_category_assignments
        set ${column}=$1 where id=$2`, [restore, ids.assignment]);
    }
    await db.query(`update sellerpilot_private.product_category_assignments
      set is_leaf=false where id=$1`, [ids.assignment]);
    await assert.rejects(
      () => context(db),
      /SMARTSTORE_CATEGORY_SOURCE_COLLECTION_ASSIGNMENT_AMBIGUOUS/,
    );
    await db.query(`update sellerpilot_private.product_category_assignments
      set is_leaf=true where id=$1`, [ids.assignment]);
    await db.exec(`
      insert into sellerpilot_private.product_category_assignments
      select '${ids.secondAssignment}',owner_id,product_id,'fixture-2',channel,
        environment,market,status,is_leaf,official_verified_at,confirmed_at,
        required_attributes,provided_attributes,missing_required_attributes,
        category_id,updated_at
      from sellerpilot_private.product_category_assignments
      where id='${ids.assignment}'
    `);
    await assert.rejects(
      () => context(db),
      /SMARTSTORE_CATEGORY_SOURCE_COLLECTION_ASSIGNMENT_AMBIGUOUS/,
    );
  } finally {
    await db.close();
  }
});

function gatewayResult(input: { category?: string; includeUnits?: boolean } = {}) {
  const selectedCategory = input.category ?? categoryId;
  return {
    ok: true,
    channel: "smartstore" as const,
    operation: "categories.attributes" as const,
    steps: [
      { name: "category", ok: true, status: 200, data: { id: selectedCategory, last: true } },
      { name: "attributes", ok: true, status: 200, data: { items: [{
        attributeSeq: 10020580,
        attributeName: "품종",
        attributeClassificationType: "SINGLE_SELECT",
        attributeType: "PRIMARY",
        unitUsable: false,
        attributeValueMaxMatchingCount: 1,
      }] } },
      { name: "attribute-values", ok: true, status: 200, data: { items: [{
        attributeSeq: 10020580,
        attributeValueSeq: 10832333,
        minAttributeValue: "설향",
      }] } },
      ...(input.includeUnits === false ? [] : [{
        name: "attribute-value-units",
        ok: true,
        status: 200,
        data: { items: [] },
      }]),
    ],
    safeMessage: "ok",
  };
}

function freshSnapshotFixture(input: {
  sourceContext?: ReturnType<typeof parsedContext>;
  result?: ReturnType<typeof gatewayResult>;
} = {}) {
  const sourceContext = input.sourceContext ?? parsedContext();
  const official = smartstoreCreateCategoryOfficialReceipt(
    input.result ?? gatewayResult(),
    categoryId,
  );
  const providerAttributes = smartstoreCreateProviderAttributes({
    context: sourceContext,
    official,
  });
  const assignmentSource = {
    contract: smartstoreCategoryAttributeAssignmentContract,
    channel: "smartstore" as const,
    operation: "listing.create" as const,
    environment: "production" as const,
    market: "KR" as const,
    status: "confirmed" as const,
    categoryId,
    revision: 1,
    providedAttributes: providerAttributes,
  };
  const assignment = {
    ...assignmentSource,
    digest: smartstoreCategoryAttributeAssignmentDigest(assignmentSource),
  };
  const officialSource = {
    contract: smartstoreCategoryAttributeOfficialReadbackContract,
    categoryId,
    assignmentRevision: 1,
    assignmentDigest: assignment.digest,
    ...official,
  };
  const officialReadback = {
    ...officialSource,
    digest: smartstoreCategoryAttributeOfficialReadbackDigest(officialSource),
  };
  return {
    contract: "smartstore_listing_create_source_snapshot_v1",
    productId: ids.product,
    ownerId: ids.owner,
    productUpdatedAt,
    detailPageVersion: 3,
    approvedDetailPageVersion: 3,
    approvedManifestDigest: detailDigest,
    credentialId: ids.credential,
    credentialVersion: 7,
    categoryAttributeSource: {
      contract: "smartstore_listing_create_category_source_v1",
      collectedAt: "2026-09-10T02:02:00.000000+00:00",
      expiresAt: "2026-09-10T02:17:00.000000+00:00",
      assignment,
      officialReadback,
    },
  };
}

function parsedContext() {
  return parseSmartstoreCreateCategorySourceCollectionContext({
    contract: "smartstore_create_category_source_collection_context_v1",
    ownerId: ids.owner,
    productId: ids.product,
    productUpdatedAt,
    credentialId: ids.credential,
    credentialVersion: 7,
    sellerAccountKey,
    approvedDetailRevision: 3,
    approvedDetailDigest: detailDigest,
    assignmentId: ids.assignment,
    assignmentUpdatedAt,
    categoryId,
    providedAttributes: { "10020580": "10832333" },
  });
}

test("official GET receipt compiles only the DB-stored selection", () => {
  const official = smartstoreCreateCategoryOfficialReceipt(
    gatewayResult(),
    categoryId,
  );
  assert.deepEqual(smartstoreCreateProviderAttributes({
    context: parsedContext(),
    official,
  }), [{ attributeSeq: 10020580, attributeValueSeq: 10832333 }]);
});

test("documented category policy fields are normalized and transport extras are dropped", () => {
  const result = gatewayResult();
  result.steps[0].data = {
    id: categoryId,
    name: " 생활용품 ",
    wholeCategoryName: " 생활 > 생활용품 ",
    last: true,
    exceptionalCategories: ["UNIT_PRICE"],
    certificationInfos: [{
      id: "58",
      name: " 안전확인 ",
      kindTypes: ["KC_CERTIFICATION"],
      providerNote: "must-not-enter-the-ledger",
    }],
    sellerpilotRateLimit: { responseHeaders: { "retry-after": "1" } },
    unknownProviderAddition: "must-not-enter-the-ledger",
  };
  assert.deepEqual(
    smartstoreCreateCategoryOfficialReceipt(result, categoryId).category,
    {
      id: categoryId,
      name: "생활용품",
      wholeCategoryName: "생활 > 생활용품",
      last: true,
      exceptionalCategories: ["UNIT_PRICE"],
      certificationInfos: [{
        id: 58,
        name: "안전확인",
        kindTypes: ["KC_CERTIFICATION"],
      }],
    },
  );

  result.steps[0].data.exceptionalCategories = [false];
  assert.throws(
    () => smartstoreCreateCategoryOfficialReceipt(result, categoryId),
    /OFFICIAL_EXCEPTIONAL_CATEGORIES_INVALID/,
  );
});

test("category drift, missing unit GET, and unknown stored values fail closed", () => {
  assert.throws(
    () => smartstoreCreateCategoryOfficialReceipt(
      gatewayResult({ category: "50000000" }),
      categoryId,
    ),
    /OFFICIAL_CATEGORY_DRIFT/,
  );
  assert.throws(
    () => smartstoreCreateCategoryOfficialReceipt(
      gatewayResult({ includeUnits: false }),
      categoryId,
    ),
    /OFFICIAL_RESULT_INVALID/,
  );
  const contextValue = parsedContext();
  contextValue.providedAttributes = { "10020580": "99999999" };
  assert.throws(
    () => smartstoreCreateProviderAttributes({
      context: contextValue,
      official: smartstoreCreateCategoryOfficialReceipt(
        gatewayResult(),
        categoryId,
      ),
    }),
    /SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY/,
  );
});

test("fresh snapshot binds the exact official bytes even when a tampered digest is recomputed", () => {
  const sourceContext = parsedContext();
  const official = smartstoreCreateCategoryOfficialReceipt(
    gatewayResult(),
    categoryId,
  );
  const providerAttributes = smartstoreCreateProviderAttributes({
    context: sourceContext,
    official,
  });
  const exact = freshSnapshotFixture({ sourceContext });
  assert.doesNotThrow(() => assertSmartstoreCreateCategorySourceFreshSnapshot({
    context: sourceContext,
    freshContext: sourceContext,
    sourceSnapshot: exact,
    official,
    providerAttributes,
  }));

  const tampered = structuredClone(exact);
  const durable = tampered.categoryAttributeSource.officialReadback;
  durable.category = { ...durable.category as Record<string, unknown>, name: "위조" };
  const { digest: ignored, ...tamperedSource } = durable;
  assert.ok(ignored);
  durable.digest = smartstoreCategoryAttributeOfficialReadbackDigest(
    tamperedSource,
  );
  assert.throws(
    () => assertSmartstoreCreateCategorySourceFreshSnapshot({
      context: sourceContext,
      freshContext: sourceContext,
      sourceSnapshot: tampered,
      official,
      providerAttributes,
    }),
    /FRESH_OFFICIAL_MISMATCH/,
  );
});

test("dedicated admin route accepts IDs only, performs the fixed official GET, and appends server facts", async () => {
  const sourceContext = parsedContext();
  const sourceSnapshot = freshSnapshotFixture({ sourceContext });
  let appendArguments: Record<string, unknown> | null = null;
  let gatewayArguments: Record<string, unknown> | null = null;
  let contextReads = 0;
  const serviceClient = {
    async rpc(name: string, args?: Record<string, unknown>) {
      if (name === "sellerpilot_service_smartstore_create_category_collect_ctx") {
        contextReads += 1;
        assert.deepEqual(args, {
          p_owner_id: ids.owner,
          p_product_id: ids.product,
          p_credential_id: ids.credential,
        });
        return { data: sourceContext, error: null };
      }
      if (name === "sellerpilot_service_append_smartstore_create_category_source") {
        appendArguments = args ?? null;
        return { data: { replayed: false }, error: null };
      }
      if (name === "sellerpilot_service_smartstore_create_source_snapshot") {
        assert.deepEqual(args, {
          p_owner_id: ids.owner,
          p_product_id: ids.product,
          p_credential_id: ids.credential,
        });
        return { data: sourceSnapshot, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  (globalThis as typeof globalThis & {
    __smartstoreCollectorAdmin: () => unknown;
    __smartstoreCollectorGateway: (input: Record<string, unknown>) => unknown;
  }).__smartstoreCollectorAdmin = async () => ({
    user: { id: ids.owner },
    userClient: {
      rpc: async (name: string) => {
        assert.equal(name, "sellerpilot_ai_runtime_status");
        return { data: {}, error: null };
      },
    },
    serviceClient,
  });
  (globalThis as typeof globalThis & {
    __smartstoreCollectorGateway: (input: Record<string, unknown>) => unknown;
  }).__smartstoreCollectorGateway = async (input) => {
    gatewayArguments = input;
    return { result: gatewayResult() };
  };

  const { POST } = await import(
    "../app/api/admin/products/[id]/smartstore-create-category-source/route"
  );
  const response = await POST(new Request("https://fixture.invalid", {
    method: "POST",
    headers: { authorization: "Bearer fixture", "content-type": "application/json" },
    body: JSON.stringify({ credentialId: ids.credential }),
  }), { params: Promise.resolve({ id: ids.product }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sourceReady, true);
  assert.deepEqual(gatewayArguments && {
    credentialId: gatewayArguments.credentialId,
    attemptId: gatewayArguments.attemptId,
    channel: gatewayArguments.channel,
    operation: gatewayArguments.operation,
    arguments: gatewayArguments.arguments,
  }, {
    credentialId: ids.credential,
    attemptId: null,
    channel: "smartstore",
    operation: "categories.attributes",
    arguments: {
      categoryId,
      includeAttributeValueUnits: true,
      includeStandardOptions: false,
    },
  });
  assert.equal(contextReads, 2, "context must be read again after append");
  assert.deepEqual(appendArguments?.p_provider_attributes, [
    { attributeSeq: 10020580, attributeValueSeq: 10832333 },
  ]);
  assert.deepEqual(appendArguments?.p_official_readback, {
    category: { id: categoryId, last: true },
    attributes: gatewayResult().steps[1].data.items,
    attributeValues: gatewayResult().steps[2].data.items,
    attributeValueUnits: [],
  });

  const forged = await POST(new Request("https://fixture.invalid", {
    method: "POST",
    headers: { authorization: "Bearer fixture", "content-type": "application/json" },
    body: JSON.stringify({
      credentialId: ids.credential,
      officialReadback: { forged: true },
      digest: "f".repeat(64),
    }),
  }), { params: Promise.resolve({ id: ids.product }) });
  assert.equal(forged.status, 400);
});

test("append response loss uses exact replay and accepts only the exact fresh snapshot", async () => {
  const sourceContext = parsedContext();
  const appendCalls: Record<string, unknown>[] = [];
  let contextReads = 0;
  const serviceClient = {
    async rpc(name: string, args?: Record<string, unknown>) {
      if (name === "sellerpilot_service_smartstore_create_category_collect_ctx") {
        contextReads += 1;
        return { data: sourceContext, error: null };
      }
      if (name === "sellerpilot_service_append_smartstore_create_category_source") {
        appendCalls.push(structuredClone(args ?? {}));
        // Both HTTP responses may be lost after the first transaction commits.
        return { data: null, error: new Error("response lost") };
      }
      if (name === "sellerpilot_service_smartstore_create_source_snapshot") {
        return { data: freshSnapshotFixture({ sourceContext }), error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  (globalThis as typeof globalThis & {
    __smartstoreCollectorAdmin: () => unknown;
    __smartstoreCollectorGateway: () => unknown;
  }).__smartstoreCollectorAdmin = async () => ({
    user: { id: ids.owner },
    userClient: { rpc: async () => ({ data: {}, error: null }) },
    serviceClient,
  });
  (globalThis as typeof globalThis & {
    __smartstoreCollectorGateway: () => unknown;
  }).__smartstoreCollectorGateway = async () => ({ result: gatewayResult() });

  const { POST } = await import(
    "../app/api/admin/products/[id]/smartstore-create-category-source/route"
  );
  const result = await POST(new Request("https://fixture.invalid", {
    method: "POST",
    headers: { authorization: "Bearer fixture", "content-type": "application/json" },
    body: JSON.stringify({ credentialId: ids.credential }),
  }), { params: Promise.resolve({ id: ids.product }) });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    ok: true,
    sourceReady: true,
    replayed: true,
    appendResponseRecovered: true,
    providerMutationPerformed: false,
    officialReadOperation: "categories.attributes",
    message: "현재 확정 카테고리에 결속된 스마트스토어 공식 속성 원본을 저장했습니다.",
  });
  assert.equal(contextReads, 2);
  assert.equal(appendCalls.length, 2);
  assert.deepEqual(appendCalls[1], appendCalls[0], "replay arguments must be exact");
});

test("strict receipt and fresh DB drift fail with zero provider mutation", async () => {
  const { POST } = await import(
    "../app/api/admin/products/[id]/smartstore-create-category-source/route"
  );
  const invoke = () => POST(new Request("https://fixture.invalid", {
    method: "POST",
    headers: { authorization: "Bearer fixture", "content-type": "application/json" },
    body: JSON.stringify({ credentialId: ids.credential }),
  }), { params: Promise.resolve({ id: ids.product }) });

  let appendCalls = 0;
  (globalThis as typeof globalThis & {
    __smartstoreCollectorAdmin: () => unknown;
    __smartstoreCollectorGateway: () => unknown;
  }).__smartstoreCollectorAdmin = async () => ({
    user: { id: ids.owner },
    userClient: { rpc: async () => ({ data: {}, error: null }) },
    serviceClient: {
      rpc: async (name: string) => {
        if (name === "sellerpilot_service_smartstore_create_category_collect_ctx") {
          return { data: parsedContext(), error: null };
        }
        if (name === "sellerpilot_service_append_smartstore_create_category_source") {
          appendCalls += 1;
        }
        return { data: {}, error: null };
      },
    },
  });
  (globalThis as typeof globalThis & {
    __smartstoreCollectorGateway: () => unknown;
  }).__smartstoreCollectorGateway = async () => {
    const result = gatewayResult();
    return {
      result: {
        ...result,
        steps: [...result.steps, {
          name: "unexpected-provider-step",
          ok: true,
          status: 200,
          data: {},
        }],
      },
    };
  };
  const malformed = await invoke();
  assert.equal(malformed.status, 409);
  assert.equal((await malformed.json()).providerMutationPerformed, false);
  assert.equal(appendCalls, 0, "malformed official evidence must not append");

  let contextReads = 0;
  appendCalls = 0;
  (globalThis as typeof globalThis & {
    __smartstoreCollectorAdmin: () => unknown;
  }).__smartstoreCollectorAdmin = async () => ({
    user: { id: ids.owner },
    userClient: { rpc: async () => ({ data: {}, error: null }) },
    serviceClient: {
      rpc: async (name: string) => {
        if (name === "sellerpilot_service_smartstore_create_category_collect_ctx") {
          contextReads += 1;
          const current = parsedContext();
          if (contextReads === 2) {
            current.assignmentUpdatedAt = "2026-09-10T02:01:00.654322+00:00";
          }
          return { data: current, error: null };
        }
        if (name === "sellerpilot_service_append_smartstore_create_category_source") {
          appendCalls += 1;
          return { data: { replayed: false }, error: null };
        }
        if (name === "sellerpilot_service_smartstore_create_source_snapshot") {
          return { data: freshSnapshotFixture(), error: null };
        }
        throw new Error(`unexpected RPC ${name}`);
      },
    },
  });
  (globalThis as typeof globalThis & {
    __smartstoreCollectorGateway: () => unknown;
  }).__smartstoreCollectorGateway = async () => ({ result: gatewayResult() });
  const drifted = await invoke();
  assert.equal(drifted.status, 409);
  assert.equal((await drifted.json()).providerMutationPerformed, false);
  assert.equal(appendCalls, 1);
});
