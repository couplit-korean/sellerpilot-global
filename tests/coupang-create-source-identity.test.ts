import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bindCoupangCreateSourceIdentity } from "../lib/channels/coupang-create-source-identity";

const context = { product: { sku: "OLD-SKU" }, manualFields: { sellerSku: "CP-RED-M" } };
const draft = () => ({ body: { items: [{ externalVendorSku: "CP-RED-M" }] } });

test("Coupang compilation receives the current server SKU and preserves a suffix-like base", () => {
  const input = draft();
  assert.equal(bindCoupangCreateSourceIdentity(input, context).sellerpilotCoupangBaseSku, "CP-RED-M");
  assert.equal(Object.hasOwn(input, "sellerpilotCoupangBaseSku"), false);
  const options = {
    sellerpilotCoupangBaseSku: "CP-RED-M",
    facts: { coupangOptionRows: [{ skuSuffix: "RED-M" }, { skuSuffix: "BLUE" }] },
    body: { items: [{ externalVendorSku: "CP-RED-M-BLUE" }, { externalVendorSku: "CP-RED-M-RED-M" }] },
  };
  assert.deepEqual(bindCoupangCreateSourceIdentity(options, context), options);
});

test("Coupang cannot bind another product, a forged base, or an ambiguous item set", () => {
  for (const value of [
    { ...draft(), sellerpilotCoupangBaseSku: "OTHER" },
    { ...draft(), sellerpilotCoupangBaseSku: null },
    { body: { items: [{ externalVendorSku: "OLD-SKU" }] } },
    { body: { items: [{ externalVendorSku: "CP-RED-M" }, { externalVendorSku: "CP-RED-M" }] } },
    { body: { items: [null] } },
    { ...draft(), facts: { coupangOptionRows: true } },
    { facts: { coupangOptionRows: [{ skuSuffix: "RED" }] }, body: { items: [{ externalVendorSku: "OTHER-RED" }] } },
  ]) assert.throws(() => bindCoupangCreateSourceIdentity(value, context), /COUPANG_CREATE_SOURCE_IDENTITY_MISMATCH/u);
  assert.throws(() => bindCoupangCreateSourceIdentity(draft(), {}), /COUPANG_CREATE_SOURCE_IDENTITY_MISMATCH/u);
});

test("the admin enqueue route binds Coupang identity using its verified server publish context", () => {
  const route = readFileSync(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  assert.match(route, /channel === "coupang" && operation === "listing.create"[\s\S]*?bindCoupangCreateSourceIdentity\(effectiveArguments, verifiedPublishContext\)/u);
  assert.ok(route.indexOf("bindCoupangCreateSourceIdentity(effectiveArguments") < route.indexOf("const effectivePublicationIntent"));
});
