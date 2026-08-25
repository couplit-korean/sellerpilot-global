import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("publish context exposes preserved publication evidence for failed update retries", async () => {
  const [migration, workbench, route] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260825084500_product_listing_published_identity.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /jsonb_build_object\('publishedAt', listing\.published_at\)/);
  assert.match(workbench, /listingWriteOperation\(listing\)/);
  assert.match(route, /listingWriteOperation\(\{[\s\S]*publishedAt:/);
  assert.match(route, /listingLedgerRemoteIdentity\(channel, operation, listing\)/);
  assert.match(route, /ledgerRemoteIdentity === requestedRemoteId/);
});
