import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const r6Migration = new URL(
  "../supabase/migrations/20260910044500_elevenst_recovery_observation_and_identifier_hardening_r6.sql",
  import.meta.url,
);
const r5Migration = new URL(
  "../supabase/migrations/20260910043000_elevenst_final_body_recovery_and_lock_order_r4.sql",
  import.meta.url,
);

test("r5 recovery finish still names the synthetic v1 observation that review 69 rejected", async () => {
  const sql = await readFile(r5Migration, "utf8");
  assert.match(sql, /sellerpilot_elevenst_create_get_only_recovery_v1/u);
  assert.doesNotMatch(sql, /requestBytesSha256[\s\S]*responseBodySha256[\s\S]*responseBodyBytes/u);
});

test("r6 recovery finish is exact, current-source bound, atomic, and synthetic-v1 closed", async () => {
  const sql = await readFile(r6Migration, "utf8");
  assert.match(sql, /sellerpilot_elevenst_create_get_only_recovery_v2/u);
  assert.match(sql, /productMismatches'='\[\]'::jsonb/u);
  assert.match(sql, /stockMismatches'='\[\]'::jsonb/u);
  assert.match(sql, /providerReadbackUnavailableFields'='\[\]'::jsonb/u);
  assert.match(sql, /sellerProductCode'<>seller_code/u);
  assert.match(sql, /credentialFingerprint[\s\S]*vaultSecretId[\s\S]*apiKeySha256/u);
  assert.match(sql, /expires_at is null or value\.expires_at>pg_catalog\.clock_timestamp/u);
  assert.match(sql, /sellerpilot_100445_11st_source_readback_pre_cas/u);
  assert.match(sql, /current_source->>'sixKindDigest'<>permit\.six_kind_digest/u);
  assert.match(sql, /get diagnostics changed_rows=row_count/u);
  assert.match(sql, /if changed_rows<>1 then raise exception 'ELEVENST_CREATE_RECOVERY_ATTEMPT_MISMATCH'/u);
  assert.match(sql, /requestBytesSha256[\s\S]*responseBodySha256[\s\S]*responseBodyBytes/u);
  assert.doesNotMatch(sql, /sellerpilot_elevenst_create_get_only_recovery_v1/u);
});

test("r6 GET-only recovery runtime never POSTs and refuses synthetic v1 observations", async () => {
  const [recovery, officialGet] = await Promise.all([
    readFile(new URL("../lib/product-registration/elevenst/create-recovery.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/elevenst-official-get.ts", import.meta.url), "utf8"),
  ]);
  assert.match(recovery, /sellerpilot_elevenst_create_get_only_recovery_v2/u);
  assert.match(recovery, /providerMutationPerformed: false/u);
  assert.match(officialGet, /requestBytesSha256/u);
  assert.match(officialGet, /responseBodySha256/u);
  assert.doesNotMatch(recovery, /method:\s*"(?:POST|PUT)"/u);
  assert.doesNotMatch(recovery, /sellerpilot_elevenst_create_get_only_recovery_v1/u);
});

test("r6 common path binds XML transport hashes and owns recovery claim/finish", async () => {
  const [protocols, gateway, drain, completion, contract, job, worker, route] = await Promise.all([
    readFile(new URL("../lib/channels/protocols.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/serverless-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/elevenst-create-recovery-drain.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/commerce-completion.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/gateway-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/commerce-gateway-job.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/channel-gateway-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/channel-gateway/worker/elevenst-create-recovery/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(protocols, /export function elevenstXmlTransportEvidence/u);
  assert.match(protocols, /transportEvidence/u);
  assert.match(gateway, /drainElevenstCreateRecovery/u);
  assert.match(drain, /sellerpilot_service_claim_elevenst_create_recovery/u);
  assert.match(drain, /sellerpilot_service_finish_elevenst_create_recovery/u);
  assert.match(drain, /sellerpilot_elevenst_create_get_only_recovery_v2/u);
  assert.match(drain, /ELEVENST_CREATE_RECOVERY_SYNTHETIC_OBSERVATION/u);
  assert.doesNotMatch(drain, /sellerpilot_elevenst_create_get_only_recovery_v1/u);
  assert.match(job, /processElevenstCreateRecoveryDrain/u);
  assert.match(job, /drainElevenstCreateRecovery/u);
  assert.match(worker, /processElevenstCreateRecoveryDrain/u);
  assert.match(worker, /skipRegularClaim/u);
  assert.match(route, /ELEVENST_CREATE_RECOVERY_CLAIM_RPC/u);
  assert.match(route, /ELEVENST_CREATE_RECOVERY_FINISH_RPC/u);
  assert.match(route, /assertOfficialRecoveryObservation/u);
  assert.match(completion, /ELEVENST_EXISTING_SELLER_PRODUCT_CODE/u);
  assert.match(contract, /gatewayFreshCreateBlockedByExistingSellerCode/u);
});
