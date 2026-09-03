import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  activeLazadaSellerIdForMarket,
  activeProductionLazadaCredentialEnvelope,
  activeProductionLazadaCredentialId,
  lineageBoundLazadaTargets,
} from "../lib/channels/lazada-target-lineage";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";

const credentialId = "22222222-2222-4222-8222-222222222222";
const account = {
  account_platform: "seller_center",
  country_user_info: [
    { country: "my", seller_id: "2001", user_id: "3001", short_code: "my-shop" },
    { country: "sg", seller_id: "2002", user_id: "3002", short_code: "sg-shop" },
  ],
};
const activeSecret = withLazadaProviderAccountIdentity({
  app_key: "app-key",
  access_token: "vault-only",
}, account).payload;

function target(marketCode: "MY" | "SG", sellerId: string, verifiedAt: string) {
  return {
    targetId: sellerId,
    displayName: `${marketCode} seller`,
    marketCode,
    locale: marketCode === "MY" ? "ms-MY" : "en-SG",
    language: marketCode === "MY" ? "Bahasa Melayu" : "English",
    currency: marketCode === "MY" ? "MYR" : "SGD",
    verifiedAt,
  };
}

test("only the active production Lazada credential can select targets", () => {
  assert.equal(activeProductionLazadaCredentialId([
    { id: "sandbox", channel: "lazada", environment: "sandbox", status: "active" },
    { id: "revoked", channel: "lazada", environment: "production", status: "revoked" },
    { id: credentialId, channel: "lazada", environment: "production", status: "active" },
  ]), credentialId);
  assert.equal(activeProductionLazadaCredentialId([
    { id: "sandbox", channel: "lazada", environment: "sandbox", status: "active" },
  ]), "");
});

test("active Lazada envelope requires exact credential id and an attested account identity", () => {
  assert.deepEqual(activeProductionLazadaCredentialEnvelope({
    credential_id: credentialId,
    secret_payload: activeSecret,
  }), { credentialId, secretPayload: activeSecret });
  assert.equal(activeProductionLazadaCredentialEnvelope({ credential_id: credentialId }), null);
  assert.equal(activeProductionLazadaCredentialEnvelope({
    credential_id: credentialId,
    secret_payload: { ...activeSecret, country_user_info: [{ country: "my", seller_id: "9999", user_id: "9999" }] },
  }), null);
  assert.equal(activeProductionLazadaCredentialEnvelope({
    credential_id: credentialId,
    secret_payload: account,
  }), null);
});

test("cached Lazada targets must cover the exact countries and seller ids of the active account", () => {
  const activeTargets = [
    target("MY", "2001", "2026-08-29T01:00:00.000Z"),
    target("SG", "2002", "2026-08-29T01:00:01.000Z"),
  ];
  const staleTargets = [
    target("MY", "9001", "2026-08-29T02:00:00.000Z"),
    target("SG", "9002", "2026-08-29T02:00:01.000Z"),
  ];

  assert.deepEqual(
    lineageBoundLazadaTargets([...staleTargets, ...activeTargets], activeSecret).map((row) => row.targetId),
    ["2001", "2002"],
  );
  assert.deepEqual(lineageBoundLazadaTargets(staleTargets, activeSecret), []);
  assert.deepEqual(lineageBoundLazadaTargets(activeTargets.slice(0, 1), activeSecret), []);
  assert.deepEqual(lineageBoundLazadaTargets(activeTargets, { ...activeSecret, provider_account_subject: "lazada:v1:invalid" }), []);
  assert.equal(activeLazadaSellerIdForMarket(activeSecret, "MY"), "2001");
  assert.equal(activeLazadaSellerIdForMarket(activeSecret, "ph"), "");
  assert.equal(activeLazadaSellerIdForMarket(account, "MY"), "");
});

test("channel target route validates current Lazada production lineage before cache return and cache store", async () => {
  const source = await readFile(new URL("../app/api/admin/channel-targets/route.ts", import.meta.url), "utf8");
  const gatewaySource = await readFile(new URL("../lib/channels/gateway.ts", import.meta.url), "utf8");
  const getSource = source.slice(source.indexOf("export async function GET"), source.indexOf("function remoteProfile"));
  const validationIndex = getSource.indexOf('{ p_channel: "lazada", p_environment: "production" }');
  const cacheReturnIndex = getSource.indexOf("lineageBoundLazadaTargetForMarket(");
  assert.ok(validationIndex >= 0 && cacheReturnIndex > validationIndex);
  assert.match(source, /p_channel: "lazada", p_environment: "production"/);
  assert.match(source, /lazadaEnvelope\.credentialId !== credential\.id/);
  assert.match(source, /currentCredentialId !== activeLazadaCredentialId/);
  assert.match(source, /latestCredentialId !== activeLazadaCredentialId/);
  assert.match(source, /remoteTargetId !== expectedSellerId/);
  assert.match(source, /parsed\.data\.credentialId !== credential\.id/);
  assert.match(gatewaySource, /sellerpilot_enqueue_lazada_target_sync/);
  assert.match(source, /code: lazadaTargetSyncRequiredCode/);
  assert.match(source, /code: lazadaMyTargetMismatchCode/);
  assert.doesNotMatch(source, /channel\.data === "lazada" && cachedTargetsComplete/);
});
