import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260907023000_product_registration_drafts.sql",
  import.meta.url,
);
const OWNER_A = "10000000-0000-4000-8000-000000000001";
const OWNER_B = "10000000-0000-4000-8000-000000000002";
const DRAFT_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_A = "30000000-0000-4000-8000-000000000001";
const PRODUCT_A_2 = "30000000-0000-4000-8000-000000000002";
const PRODUCT_B = "30000000-0000-4000-8000-000000000003";

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create table auth.users (id uuid primary key);
    create table sellerpilot_private.products (
      id uuid primary key,
      owner_id uuid not null references auth.users(id) on delete cascade,
      status text not null default 'draft',
      updated_at timestamptz not null default now()
    );
    insert into auth.users (id) values
      ('${OWNER_A}'), ('${OWNER_B}');
    insert into sellerpilot_private.products (id, owner_id) values
      ('${PRODUCT_A}', '${OWNER_A}'),
      ('${PRODUCT_A_2}', '${OWNER_A}'),
      ('${PRODUCT_B}', '${OWNER_B}');
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  return db;
}

async function asService(db) {
  await db.exec("set role service_role");
  await db.exec("select set_config('request.jwt.claim.role', 'service_role', false)");
}

async function resetRole(db) {
  await db.exec("reset role");
  await db.exec("select set_config('request.jwt.claim.role', '', false)");
}

async function put(db, {
  ownerId = OWNER_A,
  draftId = DRAFT_ID,
  kind = "intake",
  productId = null,
  expectedVersion = 0,
  data = {},
} = {}) {
  return scalar(
    db,
    `select public.sellerpilot_service_put_product_registration_draft(
       $1::uuid, $2::uuid, $3::text, $4::uuid, $5::bigint, $6::jsonb
     ) as draft`,
    [ownerId, draftId, kind, productId, expectedVersion, JSON.stringify(data)],
  );
}

test("migration exposes only owner-bound service RPCs and never mutates a product ledger", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /unique \(owner_id, kind, draft_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on sellerpilot_private\.product_registration_drafts[\s\S]*service_role/);
  assert.match(migration, /grant execute on function public\.sellerpilot_service_get_product_registration_draft[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.sellerpilot_service_put_product_registration_draft[\s\S]*to service_role/);
  assert.doesNotMatch(
    migration,
    /(?:insert\s+into|update|delete\s+from)\s+sellerpilot_private\.products\b/i,
  );

  const db = await fixture();
  try {
    await db.exec("set role authenticated");
    await db.exec("select set_config('request.jwt.claim.role', 'authenticated', false)");
    await assert.rejects(
      put(db),
      /permission denied|PRODUCT_REGISTRATION_DRAFT_ACCESS_DENIED/i,
    );
    await resetRole(db);
    await assert.rejects(
      put(db),
      /PRODUCT_REGISTRATION_DRAFT_ACCESS_DENIED/,
    );
    await asService(db);
    await assert.rejects(
      db.query("select * from sellerpilot_private.product_registration_drafts"),
      /permission denied/i,
    );
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_get_product_registration_draft($1, $2, 'intake') is null",
      [OWNER_A, DRAFT_ID],
    ), true);
  } finally {
    await resetRole(db).catch(() => {});
    await db.close();
  }
});

test("create, exact CAS, owner isolation, and one-time product binding hold", async () => {
  const db = await fixture();
  try {
    const productBefore = await db.query(
      "select id, owner_id, status, updated_at from sellerpilot_private.products order by id",
    );
    await asService(db);

    const created = await put(db, {
      data: { productName: "", images: [{ previewUrl: "local-only" }] },
    });
    assert.equal(created.version, 1);
    assert.equal(created.productId, null);
    assert.deepEqual(created.data, {
      productName: "",
      images: [{ previewUrl: "local-only" }],
    });

    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_get_product_registration_draft($1, $2, 'intake') is null",
      [OWNER_B, DRAFT_ID],
    ), true);
    const read = await scalar(
      db,
      "select public.sellerpilot_service_get_product_registration_draft($1, $2, 'intake')",
      [OWNER_A, DRAFT_ID],
    );
    assert.equal(read.draftId, DRAFT_ID);
    assert.equal(read.version, 1);

    await assert.rejects(
      put(db, { expectedVersion: 0, data: { stale: true } }),
      /PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT/,
    );
    await db.exec("rollback").catch(() => {});
    await asService(db);

    const attached = await put(db, {
      productId: PRODUCT_A,
      expectedVersion: 1,
      data: { common: {}, channels: {} },
    });
    assert.equal(attached.version, 2);
    assert.equal(attached.productId, PRODUCT_A);

    const preserved = await put(db, {
      productId: null,
      expectedVersion: 2,
      data: { common: { name: "draft" } },
    });
    assert.equal(preserved.version, 3);
    assert.equal(preserved.productId, PRODUCT_A);

    await assert.rejects(
      put(db, {
        productId: PRODUCT_A_2,
        expectedVersion: 3,
        data: {},
      }),
      /PRODUCT_REGISTRATION_DRAFT_PRODUCT_REBIND_FORBIDDEN/,
    );
    await db.exec("rollback").catch(() => {});
    await asService(db);
    await assert.rejects(
      put(db, {
        draftId: "20000000-0000-4000-8000-000000000002",
        productId: PRODUCT_B,
        data: {},
      }),
      /PRODUCT_REGISTRATION_DRAFT_PRODUCT_NOT_OWNED/,
    );
    await db.exec("rollback").catch(() => {});
    await resetRole(db);

    const productAfter = await db.query(
      "select id, owner_id, status, updated_at from sellerpilot_private.products order by id",
    );
    assert.deepEqual(productAfter.rows, productBefore.rows);
  } finally {
    await resetRole(db).catch(() => {});
    await db.close();
  }
});

test("database repeats JSON safety checks and serializes duplicate creates", async () => {
  const db = await fixture();
  try {
    await asService(db);
    await assert.rejects(
      put(db, { data: JSON.parse('{"__proto__":{"polluted":true}}') }),
      /PRODUCT_REGISTRATION_DRAFT_DATA_INVALID/,
    );
    await db.exec("rollback").catch(() => {});
    await asService(db);

    let tooDeep = {};
    for (let index = 0; index < 17; index += 1) tooDeep = { child: tooDeep };
    await assert.rejects(
      put(db, { data: tooDeep }),
      /PRODUCT_REGISTRATION_DRAFT_DATA_INVALID/,
    );
    await db.exec("rollback").catch(() => {});
    await asService(db);

    const results = await Promise.allSettled([
      put(db, { data: { writer: 1 } }),
      put(db, { data: { writer: 2 } }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const stored = await scalar(
      db,
      "select public.sellerpilot_service_get_product_registration_draft($1, $2, 'intake')",
      [OWNER_A, DRAFT_ID],
    );
    assert.equal(stored.version, 1);
    assert.ok(stored.data.writer === 1 || stored.data.writer === 2);
  } finally {
    await resetRole(db).catch(() => {});
    await db.close();
  }
});
