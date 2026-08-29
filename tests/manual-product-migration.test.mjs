import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER_A = "10000000-0000-4000-8000-000000000001";
const OWNER_B = "10000000-0000-4000-8000-000000000002";
const MANUAL_JOB = "20000000-0000-4000-8000-000000000001";
const AI_JOB = "20000000-0000-4000-8000-000000000002";
const migrationUrl = new URL(
  "../supabase/migrations/20260829080000_create_manual_mvp_products.sql",
  import.meta.url,
);

const fixtureSql = String.raw`
create role anon noinherit;
create role authenticated noinherit;
create role service_role noinherit;

create schema auth;
create schema sellerpilot_private;
create schema storage;

create table auth.users (id uuid primary key);
insert into auth.users(id) values ('${OWNER_A}'), ('${OWNER_B}');

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;

create function public.sellerpilot_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() in ('${OWNER_A}'::uuid, '${OWNER_B}'::uuid)
$$;

create table sellerpilot_private.ai_cli_worker_tokens (
  id uuid primary key,
  label text not null,
  fingerprint text not null,
  scope text not null,
  status text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  last_version text,
  created_at timestamptz not null default clock_timestamp()
);

create table sellerpilot_private.ai_cli_jobs (
  id uuid primary key,
  kind text not null,
  status text not null default 'queued',
  request_payload jsonb not null,
  result_payload jsonb,
  error_message text,
  attempt_count integer not null default 0,
  preparation_failure_count integer not null default 0,
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
  claim_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint ai_cli_jobs_kind_check check (
    kind in ('product_studio', 'product_research', 'support_reply', 'product_asset_regeneration')
  )
);

create table sellerpilot_private.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  external_code text not null,
  sku text not null,
  name text not null,
  description text not null default '',
  source_url text,
  image_url text,
  ai_job_id uuid references sellerpilot_private.ai_cli_jobs(id),
  status text not null default 'draft',
  on_hand integer not null default 0,
  reserved integer not null default 0,
  reorder_point integer not null default 10,
  cost_krw numeric(14,2) not null default 0,
  product_facts jsonb not null default '{}'::jsonb,
  demo boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(owner_id, external_code),
  unique(owner_id, sku),
  unique(owner_id, ai_job_id)
);

create table sellerpilot_private.operation_audit (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  safe_detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);

create table storage.objects (
  bucket_id text not null,
  name text not null,
  primary key(bucket_id, name)
);

create function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'product', jsonb_build_object('id', product.id, 'name', product.name),
    'manualFields', product.product_facts,
    'sourceImagePaths', job.request_payload->'image_paths',
    'generatedImagePaths', coalesce(job.result_payload->'asset_storage_paths', '{}'::jsonb)
  )
    from sellerpilot_private.products product
    left join sellerpilot_private.ai_cli_jobs job on job.id = product.ai_job_id
   where product.id = p_product_id
     and not product.demo
     and product.status <> 'archived'
     and auth.uid() is not null
     and public.sellerpilot_is_admin()
$$;

grant execute on function public.sellerpilot_get_product_publish_context(uuid)
  to authenticated;
`;

function manualPayload(jobId = MANUAL_JOB, overrides = {}) {
  const manualFields = {
    researchInput: "공급처 확인 완료 수동 등록 상품",
    productName: "수동 등록 테스트 상품",
    sellerSku: "MANUAL-SKU-001",
    categoryHint: "생활용품",
    brandName: "No Brand",
    manufacturer: "테스트 공급처",
    countryOfOrigin: "대한민국",
    material: "스테인리스 스틸",
    packageContents: "본품 1개와 설명서 1부",
    condition: "NEW",
    gtinStatus: "NO_GTIN",
    gtin: "",
    sellingPrice: 29000,
    currency: "KRW",
    stock: 17,
    weightKg: 0.8,
    packageLengthCm: 20,
    packageWidthCm: 15,
    packageHeightCm: 10,
    shippingFeeKrw: 3000,
    shippingRule: "제주 추가 배송비는 채널 정책에 따름",
    packagingRule: "완충 포장",
    description: "공급처와 실물을 확인하여 판매자가 직접 입력한 수동 등록 테스트 상품입니다.",
    productUrl: "https://example.com/manual-product",
    imageRightsConfirmed: true,
    productFactsConfirmed: true,
    ...(overrides.manualFields ?? {}),
  };
  const normalized = `${OWNER_A}/${jobId}/input/001.jpg`;
  const original = `${OWNER_A}/${jobId}/original/001.source`;
  return {
    description: manualFields.description,
    product_url: manualFields.productUrl,
    research_input: manualFields.researchInput,
    competitor_context: {
      query: "수동 등록 테스트 상품",
      providerStatuses: [],
      candidates: [],
    },
    image_paths: [normalized],
    image_specs: [{
      name: "manual-product.jpg",
      role: "main",
      originalWidth: 1600,
      originalHeight: 1200,
      width: 1200,
      height: 1200,
      bytes: 200000,
      mediaType: "image/jpeg",
      fit: "contain",
      originalName: "manual-product.png",
      originalBytes: 400000,
      originalMediaType: "image/png",
      originalPath: original,
    }],
    ...overrides,
    manual_fields: manualFields,
  };
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function setActor(db, actorId) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId]);
  await db.exec("set role authenticated");
}

async function createFixture() {
  const db = new PGlite();
  await db.exec(fixtureSql);
  const migration = await readFile(migrationUrl, "utf8");
  await db.exec(migration);
  await db.query(
    `insert into storage.objects(bucket_id, name) values
       ('sellerpilot-ai', $1), ('sellerpilot-ai', $2)`,
    [
      `${OWNER_A}/${MANUAL_JOB}/input/001.jpg`,
      `${OWNER_A}/${MANUAL_JOB}/original/001.source`,
    ],
  );
  await setActor(db, OWNER_A);
  return db;
}

test("manual product RPC is strict, owner-bound, idempotent, audited, and excluded from AI throughput", async () => {
  const db = await createFixture();
  try {
    const payload = manualPayload();
    const productId = await scalar(
      db,
      "select public.sellerpilot_create_manual_product_v1($1, $2::jsonb)",
      [MANUAL_JOB, JSON.stringify(payload)],
    );
    assert.match(productId, /^[0-9a-f-]{36}$/i);

    await db.exec("reset role");
    const job = (await db.query(
      `select kind, status, result_payload, error_message, attempt_count,
              preparation_failure_count, worker_token_id, claim_token,
              lease_expires_at, started_at, completed_at, created_by
         from sellerpilot_private.ai_cli_jobs where id = $1`,
      [MANUAL_JOB],
    )).rows[0];
    assert.equal(job.kind, "manual_product");
    assert.equal(job.status, "succeeded");
    assert.deepEqual(job.result_payload, { mode: "manual_mvp" });
    assert.equal(job.error_message, null);
    assert.equal(job.attempt_count, 0);
    assert.equal(job.preparation_failure_count, 0);
    assert.equal(job.worker_token_id, null);
    assert.equal(job.claim_token, null);
    assert.equal(job.lease_expires_at, null);
    assert.equal(job.started_at, null);
    assert.ok(job.completed_at);
    assert.equal(job.created_by, OWNER_A);

    const product = (await db.query(
      `select owner_id, status, on_hand, sku, ai_job_id, product_facts, demo
         from sellerpilot_private.products where id = $1`,
      [productId],
    )).rows[0];
    assert.equal(product.owner_id, OWNER_A);
    assert.equal(product.status, "draft");
    assert.equal(product.on_hand, 17);
    assert.equal(product.sku, "MANUAL-SKU-001");
    assert.equal(product.ai_job_id, MANUAL_JOB);
    assert.deepEqual(product.product_facts, payload.manual_fields);
    assert.equal(product.demo, false);

    await setActor(db, OWNER_A);
    const replayId = await scalar(
      db,
      "select public.sellerpilot_create_manual_product_v1($1, $2::jsonb)",
      [MANUAL_JOB, JSON.stringify(payload)],
    );
    assert.equal(replayId, productId);
    await db.exec("reset role");
    assert.equal(await scalar(db, "select count(*) from sellerpilot_private.products"), 1);
    assert.equal(await scalar(
      db,
      "select count(*) from sellerpilot_private.operation_audit where action='manual_product_created'",
    ), 1);

    await setActor(db, OWNER_A);
    const context = await scalar(
      db,
      "select public.sellerpilot_get_product_publish_context($1)",
      [productId],
    );
    assert.equal(context.contentMode, "manual_mvp");
    assert.deepEqual(context.generatedImagePaths, {});

    const runtime = await scalar(db, "select public.sellerpilot_ai_runtime_status()");
    assert.equal(Number(runtime.queued), 0);
    assert.equal(Number(runtime.running), 0);
    assert.equal(Number(runtime.succeeded_today), 0);
    assert.equal(Number(runtime.failed_today), 0);

    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_create_manual_product_v1($1, $2::jsonb)",
        [MANUAL_JOB, JSON.stringify(manualPayload(MANUAL_JOB, { description: "changed" }))],
      ),
      /idempotency mismatch/i,
    );

    await setActor(db, OWNER_B);
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_create_manual_product_v1($1, $2::jsonb)",
        [MANUAL_JOB, JSON.stringify(payload)],
      ),
      /another owner/i,
    );
  } finally {
    await db.close();
  }
});

test("manual product migration rejects unknown or missing evidence and labels only exact AI lineage", async () => {
  const db = await createFixture();
  try {
    const noStorageJob = "20000000-0000-4000-8000-000000000003";
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_create_manual_product_v1($1, $2::jsonb)",
        [noStorageJob, JSON.stringify(manualPayload(noStorageJob))],
      ),
      /image object not found/i,
    );
    await db.exec("reset role");
    assert.equal(await scalar(
      db,
      "select count(*) from sellerpilot_private.ai_cli_jobs where id=$1",
      [noStorageJob],
    ), 0);
    await setActor(db, OWNER_A);

    const unknown = manualPayload();
    unknown.manual_fields.unexpected = true;
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_create_manual_product_v1($1, $2::jsonb)",
        [MANUAL_JOB, JSON.stringify(unknown)],
      ),
      /invalid manual product fields/i,
    );

    await db.exec("reset role");
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, result_payload, created_by,
         completed_at
       ) values ($1, 'product_studio', 'succeeded', '{}'::jsonb,
         '{"mode":"cli","asset_storage_paths":{"hero":"private/hero.jpg"}}'::jsonb,
         $2, clock_timestamp())`,
      [AI_JOB, OWNER_A],
    );
    const aiProductId = await scalar(
      db,
      `insert into sellerpilot_private.products (
         owner_id, external_code, sku, name, ai_job_id, status, product_facts
       ) values ($1, 'SP-AI-TEST', 'AI-SKU-001', 'AI product', $2, 'draft', '{}'::jsonb)
       returning id`,
      [OWNER_A, AI_JOB],
    );
    await setActor(db, OWNER_A);
    const context = await scalar(
      db,
      "select public.sellerpilot_get_product_publish_context($1)",
      [aiProductId],
    );
    assert.equal(context.contentMode, "ai_generated");

    const runtime = await scalar(db, "select public.sellerpilot_ai_runtime_status()");
    assert.equal(Number(runtime.succeeded_today), 1);

    await db.exec("reset role");
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set result_payload='{}'::jsonb where id=$1",
      [AI_JOB],
    );
    await setActor(db, OWNER_A);
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_get_product_publish_context($1)",
        [aiProductId],
      ),
      /PRODUCT_CONTENT_LINEAGE_UNVERIFIED/,
    );

    await db.exec("reset role");
    await assert.rejects(
      db.query(
        "insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload,created_by) values ($1,'unknown','{}',$2)",
        ["20000000-0000-4000-8000-000000000004", OWNER_A],
      ),
      /ai_cli_jobs_kind_check/i,
    );
  } finally {
    await db.close();
  }
});

test("manual product RPC exposes only the authenticated admin surface", async () => {
  const db = await createFixture();
  try {
    await db.exec("reset role");
    const privileges = (await db.query(`
      select
        has_function_privilege('anon', 'public.sellerpilot_create_manual_product_v1(uuid,jsonb)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.sellerpilot_create_manual_product_v1(uuid,jsonb)', 'execute') as authenticated,
        has_function_privilege('service_role', 'public.sellerpilot_create_manual_product_v1(uuid,jsonb)', 'execute') as service_role,
        has_function_privilege('anon', 'public.sellerpilot_get_product_publish_context(uuid)', 'execute') as context_anon,
        has_function_privilege('authenticated', 'public.sellerpilot_get_product_publish_context(uuid)', 'execute') as context_authenticated
    `)).rows[0];
    assert.deepEqual(privileges, {
      anon: false,
      authenticated: true,
      service_role: false,
      context_anon: false,
      context_authenticated: true,
    });

    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role authenticated");
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_create_manual_product_v1($1, $2::jsonb)",
        [MANUAL_JOB, JSON.stringify(manualPayload())],
      ),
      /administrator access required/i,
    );
  } finally {
    await db.close();
  }
});

test("manual product migration keeps security-definer and forward-only fences explicit", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /add constraint ai_cli_jobs_kind_check[\s\S]*'manual_product'[\s\S]*not valid;/);
  assert.match(migration, /validate constraint ai_cli_jobs_kind_check/);
  assert.match(migration, /sellerpilot_create_manual_product_v1[\s\S]*returns uuid[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /status, request_payload, result_payload[\s\S]*'manual_product', 'succeeded'[\s\S]*'\{"mode":"manual_mvp"\}'::jsonb/);
  assert.match(migration, /sellerpilot_ai_runtime_status[\s\S]*kind <> 'manual_product'/);
  assert.match(migration, /rename to sellerpilot_get_product_publish_context_pre_content_mode/);
  assert.match(migration, /'manual_mvp'[\s\S]*'ai_generated'[\s\S]*PRODUCT_CONTENT_LINEAGE_UNVERIFIED/);
  assert.doesNotMatch(migration, /insert into sellerpilot_private\.ai_cli_audit/i);
});
