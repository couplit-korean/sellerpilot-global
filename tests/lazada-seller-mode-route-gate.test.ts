import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { lazadaMySellerModeEvidenceFromGatewayResult } from "../lib/product-registration/lazada/listing-create-context";

function gatewayResult(input: {
  sellerId?: string;
  marketplaceEaseMode?: unknown;
  rootOk?: boolean;
  stepOk?: boolean;
  status?: number;
}) {
  return {
    ok: input.rootOk ?? true,
    channel: "lazada",
    operation: "shops.get",
    steps: [{
      name: "seller-info",
      ok: input.stepOk ?? true,
      status: input.status ?? 200,
      data: {
        code: "0",
        data: {
          seller_id: input.sellerId ?? "200100300",
          ...(input.marketplaceEaseMode === undefined
            ? {}
            : { marketplaceEaseMode: input.marketplaceEaseMode }),
        },
      },
    }],
  };
}

test("Lazada MY route wires the strict seller gateway gate before create context and gateway execution", async () => {
  const source = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const sellerGate = source.indexOf("lazadaMySellerModeEvidenceFromGatewayResult({");
  const contextBuild = source.indexOf("const createContext = buildLazadaMyListingCreateContext({");
  const gatewayExecution = source.indexOf("const gatewayExecution = await executeViaChannelGateway({");
  assert.ok(sellerGate >= 0);
  assert.ok(contextBuild > sellerGate);
  assert.ok(gatewayExecution > contextBuild);
});

test("seller mismatch, failed gateway step and missing official mode produce zero CREATE continuations", () => {
  let createProductCalls = 0;
  const followRouteCreatePath = (result: unknown) => {
    const evidence = lazadaMySellerModeEvidenceFromGatewayResult({
      result,
      expectedSellerId: "200100300",
      verifiedAt: "2026-09-09T00:00:00.000Z",
    });
    if (!evidence) return false;
    createProductCalls += 1;
    return true;
  };
  for (const result of [
    gatewayResult({ sellerId: "999", marketplaceEaseMode: false }),
    gatewayResult({ marketplaceEaseMode: false, stepOk: false }),
    gatewayResult({}),
  ]) {
    assert.equal(followRouteCreatePath(result), false);
  }
  assert.equal(createProductCalls, 0);
});

test("only documented marketplaceEaseMode Boolean values authorize route continuation", () => {
  for (const [value, expected] of [
    [true, "marketplace_ease"],
    ["true", "marketplace_ease"],
    [false, "standard"],
    ["false", "standard"],
  ] as const) {
    assert.equal(lazadaMySellerModeEvidenceFromGatewayResult({
      result: gatewayResult({ marketplaceEaseMode: value }),
      expectedSellerId: "200100300",
      verifiedAt: "2026-09-09T00:00:00.000Z",
    })?.sellerMode, expected);
  }
  for (const value of [1, 0, "ease", "regular", "marketplace_ease", "TRUE", " false "]) {
    assert.equal(lazadaMySellerModeEvidenceFromGatewayResult({
      result: gatewayResult({ marketplaceEaseMode: value }),
      expectedSellerId: "200100300",
      verifiedAt: "2026-09-09T00:00:00.000Z",
    }), null);
  }
});
