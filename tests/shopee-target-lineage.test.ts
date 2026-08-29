import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  activeProductionShopeeCredentialEnvelope,
  activeProductionShopeeCredentialId,
  lineageBoundShopeeTargets,
} from "../lib/channels/shopee-target-lineage";
import { shopeeMarkets } from "../lib/channels/markets";

const credentialId = "11111111-1111-4111-8111-111111111111";

function targetRows(prefix: string) {
  return shopeeMarkets.map((market, index) => ({
    targetId: `${prefix}-${index + 1}`,
    displayName: `${market.code} shop`,
    marketCode: market.code,
    locale: market.locale,
    language: market.language,
    currency: market.currency,
    verifiedAt: new Date(1_700_000_000_000 + index).toISOString(),
  }));
}

test("only the active production Shopee credential can select targets", () => {
  assert.equal(activeProductionShopeeCredentialId([
    { id: "sandbox", channel: "shopee", environment: "sandbox", status: "active" },
    { id: "revoked", channel: "shopee", environment: "production", status: "revoked" },
    { id: credentialId, channel: "shopee", environment: "production", status: "active" },
  ]), credentialId);
  assert.equal(activeProductionShopeeCredentialId([
    { id: "sandbox", channel: "shopee", environment: "sandbox", status: "active" },
  ]), "");
});

test("active credential envelope requires both exact lineage id and decrypted object", () => {
  assert.deepEqual(activeProductionShopeeCredentialEnvelope({
    credential_id: credentialId,
    secret_payload: { shop_id: "active-1" },
  }), { credentialId, secretPayload: { shop_id: "active-1" } });
  assert.equal(activeProductionShopeeCredentialEnvelope({ credential_id: credentialId }), null);
  assert.equal(activeProductionShopeeCredentialEnvelope({ credential_id: credentialId, secret_payload: "secret" }), null);
});

test("cached Shopee targets are returned only when every market belongs to the active account", () => {
  const activeTargets = targetRows("active");
  const staleTargets = targetRows("stale").map((target) => ({
    ...target,
    verifiedAt: new Date(Date.parse(target.verifiedAt ?? "") + 60_000).toISOString(),
  }));
  const secret = {
    shopee_targets: activeTargets.map((target) => ({ type: "shop", id: target.targetId })),
  };

  assert.deepEqual(
    lineageBoundShopeeTargets([...activeTargets, ...staleTargets], secret).map((target) => target.targetId),
    activeTargets.map((target) => target.targetId),
  );
  assert.deepEqual(lineageBoundShopeeTargets(staleTargets, secret), []);
  assert.deepEqual(lineageBoundShopeeTargets(activeTargets.slice(0, -1), secret), []);
  assert.deepEqual(lineageBoundShopeeTargets(activeTargets, {}), []);
});

test("channel target route validates active production lineage before returning a Shopee cache", async () => {
  const source = await readFile(new URL("../app/api/admin/channel-targets/route.ts", import.meta.url), "utf8");
  const validationIndex = source.indexOf("sellerpilot_get_active_credential_secret");
  const cacheReturnIndex = source.indexOf("if (lineageBoundTargets.length === shopeeMarkets.length)");
  assert.ok(validationIndex >= 0 && cacheReturnIndex > validationIndex);
  assert.match(source, /p_channel: "shopee", p_environment: "production"/);
  assert.match(source, /envelope\.credentialId !== credential\.id/);
  assert.match(source, /lineageBoundShopeeTargets\(normalizedCachedTargets, activeShopeeSecret\)/);
  assert.doesNotMatch(source, /supportedShopeeTargets\(normalizedCachedTargets\)/);
});
