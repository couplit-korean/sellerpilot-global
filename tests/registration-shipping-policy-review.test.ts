import assert from "node:assert/strict";
import test from "node:test";
import { applyRegistrationPatches, channelRegistrationFields, registrationPatches, setRegistrationValue } from "../lib/channel-registration-form";
import { listingShippingRequirements } from "../lib/channels/listing-shipping";

test("eBay required shipping policy review is editable and survives draft restoration", () => {
  const path = ["sellerpilotAssets", "shipping", "policyReview"];
  const base = { sellerpilotAssets: { shipping: { policyReview: "", shippingFeeKrw: 0 } }, offer: { listingPolicies: { fulfillmentPolicyId: "fixture-policy" } } };
  const requirements = listingShippingRequirements("ebay", base, "listing.create");
  assert.ok(channelRegistrationFields("ebay", base, requirements).some(field => JSON.stringify(field.path) === JSON.stringify(path)));
  const edited = setRegistrationValue(base, path, "확인");
  const patches = registrationPatches(base, edited);
  assert.ok(patches.some(patch => JSON.stringify(patch.path) === JSON.stringify(path)));
  const restored = applyRegistrationPatches(base, patches);
  const review = listingShippingRequirements("ebay", restored, "listing.create").find(item => JSON.stringify(item.manualPath) === JSON.stringify(path));
  assert.ok(review);
  assert.notEqual(review.status, "manual");
});
