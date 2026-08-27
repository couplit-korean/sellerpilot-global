import assert from "node:assert/strict";
import test from "node:test";
import {
  type ClaimedCompetitorProduct,
  runClaimedCompetitorProductRefresh,
} from "../lib/competitor-refresh-runtime";
import type { CompetitorPriceCandidate, CompetitorProviderStatus } from "../lib/competitor-prices";

const product: ClaimedCompetitorProduct = {
  productId: "019d2a88-ec56-7ce7-933a-2f9cdfa0501f",
  claimToken: "019d2a88-ec56-7ce7-933a-2f9cdfa05020",
  query: "켈로그 첵스초코 570g",
  aliases: ["Kellogg Choco Chex 570g"],
};

const searchedProvider: CompetitorProviderStatus = {
  provider: "ebay_browse",
  status: "searched",
  count: 1,
  marketplaces: ["ebay"],
};

const item: CompetitorPriceCandidate = {
  provider: "ebay_browse",
  externalId: "synthetic-ebay-item",
  title: "Kellogg Choco Chex 570g",
  url: "https://www.ebay.com/itm/synthetic-ebay-item",
  imageUrl: "",
  mallName: "eBay",
  marketplace: "ebay",
  price: 14.99,
  currency: "USD",
};

test("synthetic competitor refresh completes a fenced snapshot with the matcher version", async () => {
  let released = false;
  let completedItems: Array<CompetitorPriceCandidate & { matcherVersion: string }> = [];
  const outcome = await runClaimedCompetitorProductRefresh({
    product,
    unavailableProviders: [],
    matcherVersion: "strict-synthetic-v1",
    search: async () => ({ items: [item], providers: [searchedProvider], available: true, pending: false }),
    release: async () => { released = true; return true; },
    complete: async ({ items }) => { completedItems = items; return items.length; },
  });

  assert.equal(released, false);
  assert.deepEqual(completedItems, [{ ...item, matcherVersion: "strict-synthetic-v1" }]);
  assert.deepEqual(outcome, {
    result: { productId: product.productId, ok: true, pending: false, count: 1, providers: [searchedProvider] },
    infrastructureFailure: false,
    failureStage: null,
  });
});

test("synthetic pending gateway work retains its claim and never writes a partial snapshot", async () => {
  let releaseCalls = 0;
  let completeCalls = 0;
  const pendingProvider: CompetitorProviderStatus = { ...searchedProvider, status: "pending", count: 0 };
  const outcome = await runClaimedCompetitorProductRefresh({
    product,
    unavailableProviders: [],
    matcherVersion: "strict-synthetic-v1",
    search: async () => ({ items: [], providers: [pendingProvider], available: false, pending: true }),
    release: async () => { releaseCalls += 1; return true; },
    complete: async () => { completeCalls += 1; return 0; },
  });

  assert.equal(releaseCalls, 0);
  assert.equal(completeCalls, 0);
  assert.equal(outcome.result.pending, true);
  assert.equal(outcome.infrastructureFailure, false);
});

test("synthetic unavailable search releases the claim without inventing an infrastructure outage", async () => {
  let releaseCalls = 0;
  const unavailableProvider: CompetitorProviderStatus = { ...searchedProvider, status: "failed", count: 0 };
  const outcome = await runClaimedCompetitorProductRefresh({
    product,
    unavailableProviders: [],
    matcherVersion: "strict-synthetic-v1",
    search: async () => ({ items: [], providers: [unavailableProvider], available: false, pending: false }),
    release: async () => { releaseCalls += 1; return true; },
    complete: async () => 0,
  });

  assert.equal(releaseCalls, 1);
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.infrastructureFailure, false);
  assert.equal(outcome.failureStage, null);
});

test("synthetic provider exceptions distinguish a clean release from a claim-release outage", async () => {
  const cleanRelease = await runClaimedCompetitorProductRefresh({
    product,
    unavailableProviders: [],
    matcherVersion: "strict-synthetic-v1",
    search: async () => { throw new Error("synthetic provider failure"); },
    release: async () => true,
    complete: async () => 0,
  });
  const failedRelease = await runClaimedCompetitorProductRefresh({
    product,
    unavailableProviders: [],
    matcherVersion: "strict-synthetic-v1",
    search: async () => { throw new Error("synthetic provider failure"); },
    release: async () => false,
    complete: async () => 0,
  });

  assert.equal(cleanRelease.infrastructureFailure, false);
  assert.equal(cleanRelease.failureStage, "provider_search");
  assert.equal(failedRelease.infrastructureFailure, true);
  assert.equal(failedRelease.failureStage, "claim_release");
});

test("synthetic ambiguous completion keeps the claim fenced for lease recovery", async () => {
  let releaseCalls = 0;
  const outcome = await runClaimedCompetitorProductRefresh({
    product,
    unavailableProviders: [],
    matcherVersion: "strict-synthetic-v1",
    search: async () => ({ items: [item], providers: [searchedProvider], available: true, pending: false }),
    release: async () => { releaseCalls += 1; return true; },
    complete: async () => { throw new Error("synthetic response loss"); },
  });

  assert.equal(releaseCalls, 0);
  assert.equal(outcome.infrastructureFailure, true);
  assert.equal(outcome.failureStage, "snapshot_complete");
});
