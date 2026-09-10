import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL(
  "../supabase/migrations/20260910041500_coupang_create_exact_provider_body_r12.sql",
  import.meta.url,
), "utf8");
const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
const provider = await readFile(new URL("../lib/channels/commerce-provider.ts", import.meta.url), "utf8");
const executor = await readFile(new URL("../lib/product-registration/channels/coupang.ts", import.meta.url), "utf8");

test("Coupang image-prepared transmission is immutable and exact-bound to source and attempt", () => {
  assert.match(route, /sellerpilot_service_record_coupang_create_transmission/);
  assert.match(migration, /create table sellerpilot_private\.coupang_create_transmissions/);
  assert.match(migration, /coupang_create_body_without_transport\(snapshot\.source_provider_body\)[\s\S]*is distinct from[\s\S]*coupang_create_body_without_transport\(body\)/);
  assert.match(migration, /transmission\.transmission_body is distinct from job\.request_payload#>'\{arguments,body\}'/);
  assert.match(migration, /transmission\.publication_asset_binding is distinct from/);
  assert.match(migration, /COUPANG_CREATE_BOUNDARY_IMMUTABLE/);
});

test("Coupang has no generic mutation-boundary path and seals the POST body", () => {
  assert.match(provider, /delayedCoupangCreateBoundary/);
  assert.match(provider, /!delayedCoupangCreateBoundary/);
  assert.match(executor, /begin\(\{ providerBody: body \}\)[\s\S]*method: "POST"[\s\S]*body,/);
  assert.match(migration, /create function public\.sellerpilot_service_begin_coupang_create_provider_mutation/);
  assert.match(migration, /provider_body jsonb not null/);
  assert.match(migration, /provider_body_sha256 text not null/);
  assert.match(migration, /COUPANG_CREATE_PROVIDER_BODY_SEAL_REQUIRED/);
});

test("tampered transmission, secret rotation and final body conflict fail closed", () => {
  for (const marker of [
    "COUPANG_CREATE_TRANSMISSION_MISMATCH",
    "COUPANG_CREATE_PROVIDER_BODY_SOURCE_MISMATCH",
    "COUPANG_CREATE_PROVIDER_BODY_SEAL_CONFLICT",
  ]) assert.match(migration, new RegExp(marker));
  assert.match(migration, /snapshot\.credential_secret_sha256 is distinct from/);
  assert.match(migration, /seal\.provider_body_sha256 is distinct from/);
  assert.match(migration, /sellerpilot_service_begin_serverless_gateway_provider_mutation\([\s\S]*p_token_hash,p_job_id,p_claim_token/);
});
