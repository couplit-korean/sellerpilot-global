import assert from "node:assert/strict";
import test from "node:test";
import { applyRegistrationPatches, channelRegistrationFields, registrationPatches, setRegistrationValue } from "../lib/channel-registration-form";
import { assertListingShippingReady, listingShippingRequirements } from "../lib/channels/listing-shipping";

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

test("recognized zero source fee is editable, saved and restored without rewriting native or overseas policy fees", () => {
  const path = ["sellerpilotAssets", "shipping", "shippingFeeKrw"];
  const base = { sellerpilotAssets: { shipping: { policyReview: "확인", shippingFeeKrw: 0 } }, offer: { listingPolicies: { fulfillmentPolicyId: "existing-overseas-policy" } } };
  const field = channelRegistrationFields("ebay", base, listingShippingRequirements("ebay", base, "listing.create")).find(field => JSON.stringify(field.path) === JSON.stringify(path));
  assert.equal(field?.inputType, "number");
  assert.equal(field?.value, 0);
  const edited = setRegistrationValue(base, path, 3000);
  const patches = registrationPatches(base, edited);
  assert.deepEqual(patches, [{ path, value: 3000 }]);
  const restored = applyRegistrationPatches(base, JSON.parse(JSON.stringify(patches)));
  assert.equal((restored.sellerpilotAssets as typeof base.sellerpilotAssets).shipping.shippingFeeKrw, 3000);
  assert.deepEqual(restored.offer, base.offer);
  assert.deepEqual(applyRegistrationPatches(base, [{path:["sellerpilotAssets"],value:{shipping:{shippingFeeKrw:3000}}}]),base);
  assert.deepEqual(applyRegistrationPatches(base, [{path:["sellerpilotAssets","shipping","unapprovedSource"],value:"fake"}]),base);
});

test("11st free-to-paid UI reveals absent native fee and keeps source/native parity after save", () => {
  const base = { sellerpilotAssets: { shipping: { policyReview: "확인", shippingFeeKrw: 0 } }, product: { dlvCstInstBasiCd: "01", dlvCstPayTypCd: "03" } };
  const inspect = (value: Record<string,unknown>) => channelRegistrationFields("elevenst", value, listingShippingRequirements("elevenst", value, "listing.create"));
  assert.deepEqual(inspect(base).find(field=>field.path.at(-1)==="dlvCstInstBasiCd")?.options,["01","02"]);
  assert.equal(inspect(base).some(field=>field.path.at(-1)==="dlvCst1"),false);
  let edited = setRegistrationValue(base,["product","dlvCstInstBasiCd"],"02");
  const native = inspect(edited).find(field=>field.path.at(-1)==="dlvCst1");
  assert.equal(native?.required,true);
  assert.ok(native?.issue);
  assert.equal(native?.inputType,undefined); // 11st XML contract requires a string.
  edited = setRegistrationValue(edited,["product","dlvCst1"],"3000");
  assert.throws(()=>assertListingShippingReady("elevenst",edited,"listing.create"),/shipping-supported-fee/);
  edited = setRegistrationValue(edited,["sellerpilotAssets","shipping","shippingFeeKrw"],3000);
  const restored = applyRegistrationPatches(base,JSON.parse(JSON.stringify(registrationPatches(base,edited))));
  assert.doesNotThrow(()=>assertListingShippingReady("elevenst",restored,"listing.create"));
  const mismatch = setRegistrationValue(restored,["product","dlvCst1"],"0");
  assert.throws(()=>assertListingShippingReady("elevenst",mismatch,"listing.create"),/shipping-supported-fee/);
  const missing = setRegistrationValue(restored,["sellerpilotAssets","shipping","shippingFeeKrw"],null);
  assert.throws(()=>assertListingShippingReady("elevenst",missing,"listing.create"),/shipping-source-fee/);
});
