import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260901173200_exact_temu_existing_active_adoption.sql",
  import.meta.url,
);
const routeUrl = new URL(
  "../app/api/admin/products/[id]/temu-existing-adoption/route.ts",
  import.meta.url,
);
const certificationMigrationUrl = new URL(
  "../supabase/migrations/20260901173300_certify_exact_temu_existing_adoption_credential.sql",
  import.meta.url,
);

test("Temu existing ACTIVE adoption is exact, two-phase, and provider-read-only", async () => {
  const [migration, certificationMigration, route] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(certificationMigrationUrl, "utf8"),
    readFile(routeUrl, "utf8"),
  ]);

  assert.match(migration, /20260901173200/u);
  assert.match(migration, /608570473054515/u);
  assert.match(migration, /123896921649274/u);
  assert.match(migration, /ddccde35-9c58-4856-b673-d7aa27ce4220/u);
  assert.match(migration, /QA-20260823-CC-001/u);
  assert.match(migration, /seller_account_key_source = 'provider_certified_v1'/u);
  assert.match(migration, /serverless_static_egress_allowed\('temu'\)/u);
  assert.match(migration, /'sellerpilotReadOnly', true/u);
  assert.match(migration, /'listing\.publication\.verify'/u);
  assert.match(migration, /interval '15 minutes'/u);
  assert.match(migration, /gateway_completion_receipts[\s\S]*v_review\.job_id/u);
  assert.match(migration, /extensions\.digest\(\(v_observation - 'digest'\)::text, 'sha256'\)/u);
  assert.match(migration, /'providerWritePerformed', false/u);
  assert.match(migration, /jsonb_array_length\(v_observation->'representativeImages'\) is distinct from 1/u);
  assert.match(migration, /jsonb_array_length\(v_observation->'detailImages'\) is distinct from 8/u);
  assert.match(migration, /v_observation->>'locale' is distinct from 'ko-KR'/u);
  assert.match(migration, /v_observation->>'currency' is distinct from 'KRW'/u);
  assert.match(migration, /v_observation->>'visibility' is distinct from 'live'/u);

  assert.match(certificationMigration, /20260901173300/u);
  assert.match(certificationMigration, /access-token-info/u);
  assert.match(certificationMigration, /temu:mall:/u);
  assert.match(certificationMigration, /credential_incarnation_v1/u);
  assert.match(certificationMigration, /provider_certified_v1/u);
  assert.match(certificationMigration, /credentialRotated', false/u);
  assert.match(certificationMigration, /vaultSecretChanged', false/u);
  assert.match(certificationMigration, /provider_mutation_started_at is not null/u);
  assert.match(certificationMigration, /gateway_completion_receipts/u);
  assert.match(certificationMigration, /interval '15 minutes'/u);
  assert.match(certificationMigration, /accessToken\|access_token\|app_secret\|code/u);
  assert.match(certificationMigration, /serverless_gateway_job_allowed\(text,text\)/u);
  assert.match(certificationMigration, /sellerpilot_shopee_sg_existing_adoption_v1/u);
  assert.match(certificationMigration, /exact_lazada_live_adoption_allowed/u);
  assert.match(certificationMigration, /temu_exact_credential_lineage/u);

  assert.match(route, /z\.literal\("observe"\)/u);
  assert.match(route, /z\.literal\("certifyCredential"\)/u);
  assert.match(route, /z\.literal\("commitCredentialCertification"\)/u);
  assert.match(route, /confirmCredentialBinding: z\.literal\(true\)/u);
  assert.match(route, /sellerpilot_service_enqueue_temu_exact_credential_certification/u);
  assert.match(route, /sellerpilot_service_commit_temu_exact_credential_certification/u);
  assert.match(route, /confirmReadOnly: z\.literal\(true\)/u);
  assert.match(route, /z\.literal\("commit"\)/u);
  assert.match(route, /observationDigest: z\.string\(\)\.regex/u);
  assert.match(route, /confirmBinding: z\.literal\(true\)/u);
  assert.match(route, /sellerpilot_service_enqueue_temu_exact_existing_adoption/u);
  assert.match(route, /sellerpilot_service_commit_temu_exact_existing_adoption/u);
  assert.match(route, /providerWritePerformed: false/u);
});
