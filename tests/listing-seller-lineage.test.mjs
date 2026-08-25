import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260825111800_bind_listing_seller_accounts.sql", import.meta.url);
const atomicMigrationUrl = new URL("../supabase/migrations/20260825111820_serialize_gateway_ledger_transactions.sql", import.meta.url);
const routeUrl = new URL("../app/api/admin/channel-operations/route.ts", import.meta.url);
const gatewayUrl = new URL("../lib/channels/gateway.ts", import.meta.url);
const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);

test("seller account lineage is checked before a listing attempt can mutate the ledger", async () => {
  const [migration, atomicMigration, route, gateway, workbench] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(atomicMigrationUrl, "utf8"),
    readFile(routeUrl, "utf8"),
    readFile(gatewayUrl, "utf8"),
    readFile(workbenchUrl, "utf8"),
  ]);

  assert.match(migration, /channel_credentials[\s\S]*seller_account_key/);
  assert.match(migration, /product_listings_one_operation_attempt_idx/);
  assert.match(migration, /guard_attempt_seller_lineage/);
  assert.match(migration, /guard_gateway_job_seller_lineage/);
  assert.match(migration, /guard_product_listing_seller_lineage/);
  assert.match(migration, /sellerpilot_service_validate_listing_write_lineage/);
  assert.match(migration, /legacy_listing_unbound/);
  assert.match(migration, /seller_account_mismatch/);
  assert.match(migration, /gateway_listing_create_readback_verified/);
  assert.match(migration, /old\.seller_account_key is not null[\s\S]*immutable/);
  assert.doesNotMatch(migration, /api[_ ]?key[\s\S]{0,80}(?:digest|seller_account_key)/i);
  assert.doesNotMatch(migration, /access[_ ]?token[\s\S]{0,80}(?:digest|seller_account_key)/i);

  const lineageCheckOffset = route.indexOf("sellerpilot_service_validate_listing_write_lineage");
  const claimOffset = route.indexOf("sellerpilot_claim_channel_operation");
  const prepareOffset = route.indexOf("sellerpilot_prepare_product_market_listing");
  const gatewayOffset = route.indexOf("executeViaChannelGateway");
  assert.ok(lineageCheckOffset > 0);
  assert.ok(claimOffset > lineageCheckOffset);
  assert.equal(prepareOffset, -1);
  assert.ok(gatewayOffset > 0);
  assert.match(route, /operation === "listing\.update" \|\| operation === "listing\.stop"/);
  assert.match(route, /!parsed\.data\.resourceListingId/);
  assert.match(route, /String\(listing\.market \?\? ""\) === parsed\.data\.market/);
  assert.match(route, /String\(listing\.targetId \?\? ""\) === parsed\.data\.targetId/);
  assert.match(route, /lineageStatus === "seller_account_mismatch"/);
  assert.doesNotMatch(route, /sellerAccountKey/);

  assert.match(route, /listingCreate: operation === "listing\.create"[\s\S]*productId: parsed\.data\.productId/);
  assert.match(route, /currency: effectiveCurrency \?\? "KRW"[\s\S]*price: effectivePrice \?\? 0[\s\S]*requestFingerprint/);
  assert.match(route, /if \(gatewayExecution\.listingId\) listingId = gatewayExecution\.listingId/);
  assert.match(route, /ChannelGatewayInProgressError[\s\S]*listingId: errorListingId[\s\S]*status: 202/);
  assert.match(route, /ChannelGatewayListingAlreadyPublishedError[\s\S]*listingId: error\.listingId[\s\S]*status: 409/);
  assert.match(route, /ChannelGatewayListingBlockedError[\s\S]*listingId: error\.listingId[\s\S]*status: 409/);

  assert.match(gateway, /sellerpilot_service_reserve_and_enqueue_listing_create/);
  assert.match(gateway, /p_request_fingerprint: input\.listingCreate\.requestFingerprint/);
  assert.match(gateway, /effectiveListingId = enqueue\.listing_id/);
  assert.match(gateway, /return \{ result, listingId: effectiveListingId \?\? undefined \}/);
  assert.match(gateway, /ChannelGatewayListingAlreadyPublishedError\(effectiveListingId, effectiveAttemptId\)/);
  assert.match(gateway, /ChannelGatewayListingBlockedError\(effectiveListingId, effectiveAttemptId\)/);

  assert.match(atomicMigration, /attempt\.operation = 'listing\.create'/);
  assert.match(atomicMigration, /attempt\.request_fingerprint = p_request_fingerprint/);
  assert.match(atomicMigration, /set operation_attempt_id = p_attempt_id/);
  assert.match(atomicMigration, /attempt_id,[\s\S]*listing_id,[\s\S]*request_fingerprint/);
  assert.match(atomicMigration, /p_attempt_id,[\s\S]*v_listing\.id,[\s\S]*p_request_fingerprint/);
  assert.match(atomicMigration, /revoke all on function public\.sellerpilot_prepare_product_market_listing[\s\S]*authenticated, service_role/);
  assert.match(atomicMigration, /revoke all on function public\.sellerpilot_prepare_product_listing[\s\S]*authenticated, service_role/);
  assert.match(atomicMigration, /sellerpilot_service_reserve_and_enqueue_listing_create[\s\S]*from public, anon, authenticated;[\s\S]*to service_role/);

  assert.match(workbench, /operation: "listing\.stop"[\s\S]{0,260}resourceListingId: listing\.id/);
});
