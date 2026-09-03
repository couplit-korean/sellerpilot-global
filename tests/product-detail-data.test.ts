import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { productDetailDataBodySchema, productDetailDataQuerySchema } from "../app/api/admin/product-detail-data/route";

const validProductId = "123e4567-e89b-42d3-a456-426614174000";

const migrationSql = readFileSync(
  new URL("../supabase/migrations/20260903120000_product_detail_data.sql", import.meta.url),
  "utf8",
);

test("product-detail-data query schema requires a product UUID", () => {
  assert.equal(productDetailDataQuerySchema.safeParse({ productId: validProductId }).success, true);
  assert.equal(productDetailDataQuerySchema.safeParse({ productId: "not-a-uuid" }).success, false);
  assert.equal(productDetailDataQuerySchema.safeParse({}).success, false);
});

test("product-detail-data body schema accepts a Puck document with a content array", () => {
  const valid = productDetailDataBodySchema.safeParse({
    productId: validProductId,
    detailData: {
      root: {},
      content: [{ type: "HeroBlock", props: { id: "ai-hero", title: "테스트 상세" } }],
      zones: {},
    },
  });
  assert.equal(valid.success, true);
  if (valid.success) assert.equal(valid.data.detailData.content.length, 1);
});

test("product-detail-data body schema rejects malformed documents", () => {
  assert.equal(productDetailDataBodySchema.safeParse({ productId: validProductId }).success, false);
  assert.equal(
    productDetailDataBodySchema.safeParse({ productId: validProductId, detailData: { root: {}, content: "not-an-array" } }).success,
    false,
  );
  assert.equal(
    productDetailDataBodySchema.safeParse({ productId: "invalid", detailData: { root: {}, content: [] } }).success,
    false,
  );
});

test("product_detail_data migration creates the private table with ownership and RLS", () => {
  assert.match(migrationSql, /create table if not exists sellerpilot_private\.product_detail_data/);
  assert.match(migrationSql, /owner_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(migrationSql, /product_id uuid not null references sellerpilot_private\.products\(id\) on delete cascade/);
  assert.match(migrationSql, /detail_data jsonb not null/);
  assert.match(migrationSql, /updated_at timestamptz not null default now\(\)/);
  assert.match(migrationSql, /unique \(owner_id, product_id\)/);
  assert.match(migrationSql, /alter table sellerpilot_private\.product_detail_data enable row level security/);
  assert.match(migrationSql, /revoke all on sellerpilot_private\.product_detail_data from public, anon, authenticated/);
});

test("product_detail_data migration exposes admin-guarded RPCs with audit", () => {
  assert.match(migrationSql, /sellerpilot_get_product_detail_data\(p_product_id uuid\)/);
  assert.match(migrationSql, /sellerpilot_upsert_product_detail_data\(/);
  assert.match(migrationSql, /sellerpilot_is_admin\(\)/);
  assert.match(migrationSql, /grant execute on function public\.sellerpilot_get_product_detail_data\(uuid\)\s+to authenticated/);
  assert.match(migrationSql, /grant execute on function public\.sellerpilot_upsert_product_detail_data\(uuid, jsonb\)\s+to authenticated/);
  assert.match(migrationSql, /insert into sellerpilot_private\.operation_audit/);
});
