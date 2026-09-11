import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeShopeeChannelTargets,
  sameShopeeShopIdentity,
  shopeeIdentityChannelTargets,
  shopeeShopIdentities,
  shopeeShopIdentityForShop,
  shopeeShopIdentityFromVerifiedProfile,
  withShopeeShopIdentity,
} from "../lib/channels/shopee-shop-identity";

const verifiedAt = "2026-09-12T00:00:00.000Z";

test("derives the SG identity from the verified provider profile only", () => {
  const identity = shopeeShopIdentityFromVerifiedProfile({
    profile: { region: "SG", shop_name: "LOTTE", status: "NORMAL" },
    shopId: "123456789",
    verifiedAt,
  });
  assert.deepEqual(identity, {
    shopId: "123456789",
    marketCode: "SG",
    locale: "en-SG",
    language: "English",
    currency: "SGD",
    displayName: "LOTTE",
    verifiedAt,
  });
});

test("reads the profile from the nested provider response", () => {
  const identity = shopeeShopIdentityFromVerifiedProfile({
    profile: { response: { region: "my", shop_name: "Kedai" } },
    shopId: 987654321,
    verifiedAt,
  });
  assert.equal(identity?.marketCode, "MY");
  assert.equal(identity?.locale, "ms-MY");
  assert.equal(identity?.currency, "MYR");
});

test("stays blocked when the provider did not return a supported market or name", () => {
  assert.equal(shopeeShopIdentityFromVerifiedProfile({
    profile: { region: "US", shop_name: "Unsupported" },
    shopId: "123456789",
    verifiedAt,
  }), null);
  assert.equal(shopeeShopIdentityFromVerifiedProfile({
    profile: { region: "SG" },
    shopId: "123456789",
    verifiedAt,
  }), null);
  assert.equal(shopeeShopIdentityFromVerifiedProfile({
    profile: { region: "SG", shop_name: "LOTTE" },
    shopId: "0",
    verifiedAt,
  }), null);
  assert.equal(shopeeShopIdentityFromVerifiedProfile({
    profile: { region: "SG", shop_name: "LOTTE" },
    shopId: "123456789",
    verifiedAt: "not-a-date",
  }), null);
});

test("round-trips the identity on the credential payload without touching other keys", () => {
  const identity = shopeeShopIdentityFromVerifiedProfile({
    profile: { region: "SG", shop_name: "LOTTE" },
    shopId: "123456789",
    verifiedAt,
  });
  assert.ok(identity);
  const payload = withShopeeShopIdentity({
    access_token: "access-token-value",
    shopee_targets: [{ type: "shop", id: "123456789", access_token: "a", refresh_token: "b" }],
  }, identity);
  assert.equal((payload.shopee_targets as unknown[]).length, 1);
  assert.equal(payload.access_token, "access-token-value");
  assert.deepEqual(shopeeShopIdentityForShop(payload, "123456789"), identity);
  assert.equal(shopeeShopIdentityForShop(payload, "999999999"), null);
  assert.equal(shopeeShopIdentities(payload).length, 1);
  assert.ok(sameShopeeShopIdentity(shopeeShopIdentityForShop(payload, "123456789"), identity));

  const second = shopeeShopIdentityFromVerifiedProfile({
    profile: { region: "MY", shop_name: "Kedai" },
    shopId: "555555555",
    verifiedAt,
  });
  assert.ok(second);
  const widened = withShopeeShopIdentity(payload, second);
  assert.equal(shopeeShopIdentities(widened).length, 2);
  assert.deepEqual(shopeeShopIdentityForShop(widened, "123456789"), identity);
});

test("rejects a payload identity that disagrees with its own market", () => {
  const tampered = {
    shopee_shop_identities: {
      "123456789": {
        market_code: "SG",
        locale: "ms-MY",
        language: "English",
        currency: "SGD",
        display_name: "LOTTE",
        verified_at: verifiedAt,
      },
    },
  };
  assert.equal(shopeeShopIdentityForShop(tampered, "123456789"), null);
  assert.deepEqual(shopeeShopIdentities(tampered), []);
  assert.deepEqual(shopeeIdentityChannelTargets({
    secret: tampered,
    credentialId: "11111111-1111-4111-8111-111111111111",
    credentialVersion: 7,
  }), []);
});

test("binds payload identity targets to the active credential and prefers them when merging", () => {
  const identity = shopeeShopIdentityFromVerifiedProfile({
    profile: { region: "SG", shop_name: "LOTTE" },
    shopId: "123456789",
    verifiedAt,
  });
  assert.ok(identity);
  const payload = withShopeeShopIdentity({ access_token: "access-token-value" }, identity);
  const identityTargets = shopeeIdentityChannelTargets({
    secret: payload,
    credentialId: "11111111-1111-4111-8111-111111111111",
    credentialVersion: 4,
  });
  assert.deepEqual(identityTargets, [{
    targetId: "123456789",
    displayName: "LOTTE",
    marketCode: "SG",
    locale: "en-SG",
    language: "English",
    currency: "SGD",
    verifiedAt,
    credentialId: "11111111-1111-4111-8111-111111111111",
    credentialVersion: 4,
  }]);

  const merged = mergeShopeeChannelTargets(
    [
      { targetId: "123456789", displayName: "stale", marketCode: "SG", locale: "en-SG", language: "English", currency: "SGD" },
      { targetId: "222222222", displayName: "KL", marketCode: "MY", locale: "ms-MY", language: "Bahasa Melayu", currency: "MYR" },
    ],
    identityTargets,
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((target) => target.targetId === "123456789")?.displayName, "LOTTE");
  assert.equal(merged.find((target) => target.targetId === "123456789")?.credentialVersion, 4);
  assert.equal(merged.find((target) => target.targetId === "222222222")?.credentialId, undefined);
});
