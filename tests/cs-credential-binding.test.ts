import assert from "node:assert/strict";
import test from "node:test";
import { csCredentialBindingEvidence } from "../lib/channels/cs-credential-binding";

test("CS binding fingerprints the app, token, and every target without retaining secrets", () => {
  const evidence = csCredentialBindingEvidence({
    channel: "shopee",
    operation: "inquiries.list",
    credential: {
      partner_id: 123,
      partner_key: "never-store-this",
      account_id: "merchant-7",
      shop_ids: ["shop-2", "shop-1"],
      country: "sg",
    },
    request: { arguments: { shopId: "shop-1" } },
  });
  assert.ok(evidence);
  assert.equal(evidence.country, "SG");
  assert.equal(evidence.targetFingerprints.length, 3);
  assert.match(evidence.appFingerprint, /^[a-f0-9]{64}$/u);
  assert.match(evidence.tokenFingerprint, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(evidence), /never-store-this|merchant-7|shop-1/u);
});

test("CS binding is absent when the app, token, or target cannot be proved", () => {
  assert.equal(csCredentialBindingEvidence({ channel: "temu", operation: "inquiries.list", credential: {}, request: {} }), null);
  assert.equal(csCredentialBindingEvidence({ channel: "coupang", operation: "orders.list", credential: { access_key: "x" }, request: {} }), null);
});
