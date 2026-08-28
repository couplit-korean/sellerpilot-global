import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("saved product detail renders persisted provider truth instead of forcing ready", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /competitorProviders:\s*CompetitorProviderDisplayStatus\[\]/);
  assert.match(page, /competitorProvidersFetchedAt:\s*string \| null/);
  assert.match(page, /parseCompetitorProviderSnapshot\(nextCommerceOperations\.competitorProviders\)/);
  assert.match(page, /savedCompetitorPriceState\(\s*commerceOperations\.competitorProviders,\s*commerceOperations\.competitorProvidersFetchedAt/);
  assert.match(page, /<CompetitorPriceSlots items=\{commerceOperations\.competitorPrices\} providers=\{commerceOperations\.competitorProviders\} state=\{competitorProviderSnapshotState\}/);
  assert.match(page, /competitorMarketplaceProviderState\(group\.marketplace, providers\)/);
  assert.match(page, /item\.preserved === true \? " · 이전 확인값" : ""/);
  assert.match(page, /providerState === "partial" \|\| group\.providerState === "unavailable"/);
  assert.doesNotMatch(page, /<CompetitorPriceSlots items=\{commerceOperations\.competitorPrices\} state="ready"/);
});
