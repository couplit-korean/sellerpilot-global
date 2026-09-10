import assert from "node:assert/strict";
import test from "node:test";
import { executeElevenst } from "../lib/product-registration/channels/elevenst";
import { buildInventoryUpdateArguments } from "../lib/channels/inventory-sync";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";

const productNo = "123456789";
const stockNo = "987654321";
const sku = "INVENTORY-SKU";
const identity = `<Product><prdNo>${productNo}</prdNo><sellerPrdCd>${sku}</sellerPrdCd></Product>`;
function stockRow(quantity: string, overrides: { id?: string; product?: string; weight?: string } = {}) {
  return `<ns2:ProductStock><prdNo>${overrides.product ?? productNo}</prdNo><prdStckNo>${overrides.id ?? stockNo}</prdStckNo><stckQty>${quantity}</stckQty><optWght>${overrides.weight ?? "0.25"}</optWght></ns2:ProductStock>`;
}
function stocks(rows: string) { return `<ns2:ProductStocks xmlns:ns2="urn:fixture">${rows}</ns2:ProductStocks>`; }
async function run(input: { quantity?: number; badIdentity?: boolean; before?: string; after?: string; ackId?: string; ackCode?: string }) {
  const original = globalThis.fetch;
  const calls: { url: string; method: string; body: string }[] = [];
  let stockReads = 0;
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") }; calls.push(call);
    if (call.method === "PUT") return new Response(`<ClientMessage><productNo>${input.ackId ?? stockNo}</productNo><resultCode>${input.ackCode ?? "200"}</resultCode></ClientMessage>`, { status: 200 });
    if (call.url.includes("/stck/")) {
      stockReads++;
      return new Response(stockReads === 1 ? input.before ?? stocks(stockRow("0")) : input.after ?? stocks(stockRow(String(input.quantity ?? 1))), { status: 200 });
    }
    return new Response(input.badIdentity ? identity.replace(sku, "OTHER-SKU") : identity, { status: 200 });
  };
  try {
    const result = await executeElevenst({ channel: "elevenst", operation: "inventory.update", environment: "production", payload: { api_key: "fixture-key" }, arguments: { productNo, sellerSku: sku, quantity: input.quantity ?? 1 } });
    return { result, calls };
  } finally { globalThis.fetch = original; }
}
for (const quantity of [0, 1, 999_999]) {
  test(`11st single-stock inventory ${quantity} verifies product and stock IDs and preserves weight`, async () => {
    const { result, calls } = await run({ quantity });
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map(c => c.method), ["GET", "GET", "PUT", "GET"]);
    assert.match(calls[2].url, new RegExp(`/stockqty/${stockNo}$`));
    assert.match(calls[2].body, new RegExp(`<stckQty>${quantity}</stckQty>`));
    assert.match(calls[2].body, /<optWght>0.25<\/optWght>/);
    assert.equal(result.steps.at(-1)?.data.actualQuantity, quantity);
    assert.equal(gatewayJobCompletionStatus("inventory.update", result.ok, result.steps), "succeeded");
  });
}
for (const scenario of [
  { badIdentity: true },
  { before: stocks("") },
  { before: stocks(stockRow("1") + stockRow("1", { id: "2222" })) },
  { before: stocks(stockRow("1", { product: "2222" })) },
  { before: stocks(stockRow("1", { weight: "" })) },
  { before: "<html>login</html>" },
]) {
  test(`11st inventory rejects unbound or ambiguous provider stock before write: ${JSON.stringify(scenario)}`, async () => {
    const { result, calls } = await run(scenario);
    assert.equal(result.ok, false);
    assert.ok(calls.every(c => c.method === "GET"));
  });
}
for (const scenario of [
  { ackId: productNo },
  { ackCode: "500" },
  { after: stocks(stockRow("0")) },
  { after: stocks(stockRow("1", { id: "2222" })) },
  { after: stocks(stockRow("1", { weight: "1.25" })) },
  { after: stocks("") },
]) {
  test(`11st inventory never reports success from an acknowledgement or wrong readback: ${JSON.stringify(scenario)}`, async () => {
    const { result, calls } = await run(scenario);
    assert.equal(result.ok, false);
    assert.equal(calls.filter(c => c.method === "PUT").length, 1);
  });
}
test("11st inventory arguments use the central SKU and never fall through to eBay arguments", () => {
  const input = { channel: "elevenst" as const, remoteId: productNo, quantity: 1, productSku: sku, market: "KR", targetId: "seller", draft: {} };
  assert.deepEqual(buildInventoryUpdateArguments(input), { productNo, sellerSku: sku, quantity: 1 });
  for (const quantity of [-1, 0.5, 1_000_000]) assert.throws(() => buildInventoryUpdateArguments({ ...input, quantity }), /INVENTORY_SYNC_QUANTITY_INVALID/);
  assert.throws(() => buildInventoryUpdateArguments({ ...input, productSku: "" }), /INVENTORY_SYNC_SELLER_SKU_REQUIRED:elevenst/);
});
