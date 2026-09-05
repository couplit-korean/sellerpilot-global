import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export default {}" } : nextResolve(specifier, context);
} });
const { prepareMarketplaceListingArguments } = await import("../lib/channels/provider-listing-runtime");
const { executeChannelOperation } = await import("../lib/channels/operations");
const { qoo10ExactLocalizationRecoveryIdentity: identity, qoo10ExactLocalizationUpdateArgument, qoo10ExactLocalizationUpdateContract } = await import("../lib/channels/qoo10-exact-localization-identity");

const remoteId = "1234567890";
const detail = Array.from({ length: 8 }, (_, index) => `<img src="https://images.example.com/${index + 1}.jpg">`).join("");
function argumentsValue(shippingNo: unknown = "0") {
  return { params: { ItemCode: remoteId, SellerCode: "SHIPPING-SKU", ShippingNo: shippingNo, ItemTitle: "수정 상품", ItemDescription: detail } };
}
async function prepare(args: Record<string, unknown>, mutations: string[]) {
  return prepareMarketplaceListingArguments({
    channel: "qoo10", operation: "listing.update", credential: { api_key: "test-key" }, arguments: args,
    environment: "production", signal: new AbortController().signal,
    hooks: { assertLeaseHealthy: async () => {}, beginProviderMutation: async () => { mutations.push("mutation"); } },
  });
}

test("ordinary Qoo10 content update reads and preserves the existing paid group before UpdateGoods", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body));
    calls.push({ method, body });
    return Response.json({ ResultCode: 0, ResultObject: method === "ItemsLookup.GetItemDetailInfo"
      ? { ItemCode: remoteId, SellerCode: "SHIPPING-SKU", ShippingNo: "806971", ItemTitle: "수정 상품", ItemDetail: detail }
      : { ItemCode: remoteId } });
  };
  try {
    const source = argumentsValue();
    const before = JSON.stringify(source);
    const mutations: string[] = [];
    const prepared = await prepare(source, mutations);
    assert.equal((prepared.arguments.params as Record<string, unknown>).ShippingNo, "806971");
    assert.deepEqual(mutations, []);
    assert.equal(JSON.stringify(source), before);
    const outcome = await executeChannelOperation({ channel: "qoo10", operation: "listing.update", payload: { api_key: "test-key" }, arguments: prepared.arguments, environment: "production" });
    assert.equal(outcome.ok, true);
    assert.equal(calls[0].method, "ItemsLookup.GetItemDetailInfo");
    assert.equal(calls[0].body.ItemCode, remoteId);
    const write = calls.find((call) => call.method === "ItemsBasic.UpdateGoods");
    assert.ok(write);
    assert.equal(write.body.ShippingNo, "806971");
  } finally { globalThis.fetch = originalFetch; }
});

test("missing, ambiguous or failed Qoo10 shipping readback performs zero provider writes", async () => {
  const originalFetch = globalThis.fetch;
  const item = { ItemCode: remoteId, SellerCode: "SHIPPING-SKU", ShippingNo: "806971" };
  const scenarios = [
    { ResultCode: -9999, ResultObject: item },
    { ResultCode: null, ResultObject: item },
    { ResultCode: 0, ResultObject: { ...item, ShippingNo: undefined } },
    { ResultCode: 0, ResultObject: { ...item, ShippingNo: null } },
    { ResultCode: 0, ResultObject: { ...item, ItemCode: "9999999999" } },
    { ResultCode: 0, ResultObject: { ...item, ItemNo: "9999999999" } },
    { ResultCode: 0, ResultObject: { ...item, DeliveryGroupNo: "0" } },
    { ResultCode: 0, ResultObject: { ...item, SellerCode: "OTHER-SKU" } },
    { ResultCode: 0, ResultObject: [item, item] },
    { ResultCode: 0, ResultObject: item, httpStatus: 503 },
  ];
  try {
    for (const scenario of scenarios) {
      const calls: string[] = [];
      const mutations: string[] = [];
      globalThis.fetch = async (input) => {
        const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
        calls.push(method);
        return Response.json(scenario, { status: scenario.httpStatus ?? 200 });
      };
      await assert.rejects(prepare(argumentsValue("SERVER_MANAGED"), mutations), /QOO10_UPDATE_SHIPPING_UNVERIFIED/);
      assert.deepEqual(calls, ["ItemsLookup.GetItemDetailInfo"]);
      assert.deepEqual(mutations, []);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("only a readback-proven zero shipping selector can remain zero in ordinary updates", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ResultCode: "0", ResultObject: { ItemCode: remoteId, SellerCode: "SHIPPING-SKU", ShippingNo: 0 } });
  try {
    const result = await prepare(argumentsValue(undefined), []);
    assert.equal((result.arguments.params as Record<string, unknown>).ShippingNo, "0");
  } finally { globalThis.fetch = originalFetch; }
});

test("exact recovery shipping contract remains byte-for-byte unchanged without an extra provider read", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => { calls.push(String(input)); throw new Error("unexpected provider request"); };
  try {
    const source = {
      ...argumentsValue(identity.shippingNo),
      [qoo10ExactLocalizationUpdateArgument]: {
        status: "allowed", contract: qoo10ExactLocalizationUpdateContract, productId: identity.productId,
        listingId: identity.listingId, credentialId: identity.credentialId, remoteId: identity.remoteId,
        sellerSku: identity.sellerSku, releaseSha: "a".repeat(40),
      },
    };
    const before = JSON.stringify(source);
    const result = await prepare(source, []);
    assert.equal(JSON.stringify(result.arguments), before);
    assert.deepEqual(calls, []);
    await assert.rejects(prepare({ ...argumentsValue(), [qoo10ExactLocalizationUpdateArgument]: {} }, []), /QOO10_UPDATE_SHIPPING_UNVERIFIED/);
    assert.deepEqual(calls, []);
  } finally { globalThis.fetch = originalFetch; }
});
