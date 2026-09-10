import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { attachEbayCreateClaimIncarnation } from "../lib/channels/ebay-create-claim";
import {
  assertEbayCreateApproval,
  buildEbayCreateApproval,
  ebayCreateProviderRequestBodies,
  ebayCreateProviderRequestBodiesSha256,
} from "../lib/channels/ebay-create-preflight";
import { ebayCreateCredentialRefreshIncarnationFromResponse } from "../lib/channels/ebay-credential-refresh-receipt";
import { ebayOfficialPublicationFingerprintVerified } from "../lib/channels/ebay-publication-fingerprint";
import {
  assertEbayPublicationReconciliationBinding,
  EBAY_PUBLICATION_RECONCILIATION_CONTRACT,
} from "../lib/channels/ebay-publication-reconciliation";
import type { ExecuteInput } from "../lib/product-registration/execution-shared";

const sku = "sellerpilot-ebay-r5";
const fingerprint = "f".repeat(64);
const storedEias = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";

function revisionArgs() {
  const sourceDigests = ["a", "b", "c", "d", "e", "f", "1", "2"].map((value) => value.repeat(64));
  const contentDigests = ["3", "4", "5", "6", "7", "8", "9", "0"].map((value) => value.repeat(64));
  const urls = contentDigests.map((digest) =>
    `https://fixture.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`);
  const description = `<p>Approved English description.</p>${urls.map((url) => `<img src="${url}">`).join("")}`;
  const input: Record<string, unknown> = {
    sku,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "en-US",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    inventoryItem: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: 2 } },
      product: {
        title: "Approved English title",
        description,
        imageUrls: ["https://cdn.example.com/representative.jpg", ...urls],
        aspects: { Brand: ["LOTTE"] },
      },
    },
    offer: {
      sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      categoryId: "20473",
      listingDescription: description,
      availableQuantity: 2,
      pricingSummary: { price: { value: "19.25", currency: "USD" } },
      merchantLocationKey: "sellerpilot-seoul",
      listingPolicies: {
        fulfillmentPolicyId: "f1",
        paymentPolicyId: "p1",
        returnPolicyId: "r1",
      },
    },
    sellerpilotExternalDetail: {
      contract: "sellerpilot_external_detail_channel_v1",
      productId: "1ed4acfc-7603-48ec-a638-241131e59358",
      importId: "08acb37f-7ed0-40b0-8fb3-4a217a7ac912",
      version: 3,
      approvalRevision: 17,
      contentSha256: "a".repeat(64),
      requestSha256: "b".repeat(64),
      documentSha256: "c".repeat(64),
      imageSha256s: sourceDigests,
      channel: "ebay",
      market: "US",
      locale: "en-US",
      language: "en",
      title: "Approved English title",
      html: description,
    },
    sellerpilotEbayCreateLedgerSnapshot: {
      contract: "sellerpilot_ebay_create_ledger_snapshot_v1",
      productUpdatedAt: "2026-09-10T00:00:00.000Z",
      productSku: sku,
      availableQuantity: 2,
      priceUsd: "19.25",
      draftId: "1ed4acfc-7603-48ec-a638-241131e59358",
      draftVersion: 7,
      draftUpdatedAt: "2026-09-10T00:00:01.000Z",
      draftDataSha256: "4".repeat(64),
    },
    sellerpilotEbayCategoryAssignment: {
      contract: "sellerpilot_ebay_category_assignment_v1",
      id: "00000000-0000-4000-8000-000000000140",
      categoryId: "20473",
      market: "US",
      environment: "production",
      confirmedAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:01.000Z",
    },
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      approvedDetailPageVersion: 3,
      approvedManifestDigest: "d".repeat(64),
      providerImageSurface: "detail_content",
      approvedDetailImages: urls.map((publicUrl, index) => ({
        role: `detail-${index + 1}`,
        approvedObjectPath: `external-detail/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000004/${sourceDigests[index]}.png`,
        approvedSourceSha256: sourceDigests[index],
        publicUrl,
        objectPath: `normalized/${contentDigests[index].slice(0, 2)}/${contentDigests[index]}.jpg`,
        contentSha256: contentDigests[index],
      })),
      providerTransportImages: urls.map((publicUrl, index) => ({
        role: `detail-${index + 1}`,
        publicUrl,
        objectPath: `normalized/${contentDigests[index].slice(0, 2)}/${contentDigests[index]}.jpg`,
        contentSha256: contentDigests[index],
      })),
    },
  };
  input.sellerpilotEbayCreateApproval = buildEbayCreateApproval(input);
  return input;
}

test("r5 HOLD: local OAuth refresh rejects an undefined response instead of dereferencing it", async () => {
  await assert.rejects(
    () => ebayCreateCredentialRefreshIncarnationFromResponse(undefined, true),
    /RECEIPT_REJECTED/u,
  );
  await assert.rejects(
    () => ebayCreateCredentialRefreshIncarnationFromResponse(null, true),
    /RECEIPT_REJECTED/u,
  );
});

test("r5 HOLD: local claim wrapper passes other-channel jobs whose attempt_id is null", () => {
  const lazada = {
    channel: "lazada",
    operation: "listing.create",
    attempt_id: null,
    credential_id: "00000000-0000-4000-8000-000000000201",
  };
  assert.equal(attachEbayCreateClaimIncarnation(lazada), lazada);
  assert.equal(attachEbayCreateClaimIncarnation(null), null);
  assert.throws(
    () => attachEbayCreateClaimIncarnation({
      channel: "ebay",
      operation: "listing.create",
      attempt_id: null,
    }),
    /CLAIM_INCARNATION_UNAVAILABLE/u,
  );
});

test("r5 HOLD: HTTP claim inspects eBay create incarnation without wrapping claim RPC", async () => {
  const [worker, claimRoute] = await Promise.all([
    readFile(new URL("../scripts/channel-gateway-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/channel-gateway/worker/claim/route.ts", import.meta.url), "utf8"),
  ]);
  const jsonAt = worker.indexOf("await gatewayResponse.json()");
  const attachAt = worker.indexOf("attachEbayCreateClaimIncarnation(await gatewayResponse.json())");
  const processAt = worker.indexOf("processGatewayJob(gatewayJob, reserve)", jsonAt);
  assert.match(worker, /import \{ attachEbayCreateClaimIncarnation \} from "\.\.\/lib\/channels\/ebay-create-claim\.ts"/u);
  assert.ok(jsonAt >= 0 && attachAt >= 0 && processAt > attachAt);
  assert.doesNotMatch(claimRoute, /attachEbayCreateClaimIncarnation/u);
  assert.match(claimRoute, /sellerpilot_claim_channel_gateway_job/u);
});

test("r5 HOLD: canonical object hash is not the Inventory/Offer/Publish transport digest", () => {
  const input = revisionArgs();
  const bodies = ebayCreateProviderRequestBodies(input);
  const digests = ebayCreateProviderRequestBodiesSha256(input);
  const canonicalInventory = createHash("sha256")
    .update(JSON.stringify(input.inventoryItem), "utf8")
    .digest("hex");
  assert.equal(bodies.publish, "");
  assert.equal(digests.publish, createHash("sha256").update("", "utf8").digest("hex"));
  assert.equal(digests.inventory, createHash("sha256").update(bodies.inventory, "utf8").digest("hex"));
  assert.equal(digests.offer, createHash("sha256").update(bodies.offer, "utf8").digest("hex"));
  const reordered = structuredClone(input);
  reordered.inventoryItem = {
    product: (input.inventoryItem as Record<string, unknown>).product,
    condition: "NEW",
    availability: (input.inventoryItem as Record<string, unknown>).availability,
  };
  assert.notEqual(
    ebayCreateProviderRequestBodiesSha256(reordered).inventory,
    digests.inventory,
  );
  assert.equal(
    JSON.stringify(Object.keys(input.inventoryItem as object).sort()),
    JSON.stringify(Object.keys(reordered.inventoryItem as object).sort()),
  );
  assert.notEqual(canonicalInventory, digests.publish);
});

test("r5 HOLD: admin approval binds current stock and USD and rejects nested object inequality", () => {
  const input = revisionArgs();
  const approval = buildEbayCreateApproval(input);
  assert.ok(approval);
  assert.equal(approval.inventoryQuantity, 2);
  assert.equal(approval.priceUsd, "19.25");
  assert.equal(approval.ledgerSnapshot.availableQuantity, 2);
  assert.equal(approval.ledgerSnapshot.priceUsd, "19.25");
  const drifted = structuredClone(input);
  (drifted.sellerpilotEbayCreateApproval as Record<string, unknown>).ledgerSnapshot = {
    ...(approval.ledgerSnapshot as object),
    availableQuantity: 9,
    priceUsd: "1.00",
  };
  assert.throws(
    () => assertEbayCreateApproval(drifted),
    /EBAY_CREATE_APPROVAL_REVISION_INVALID/u,
  );
});

test("r5 HOLD: publication fingerprint does not self-validate from the expected digest alone", () => {
  const input = revisionArgs();
  const offer = input.offer;
  const inventoryItem = input.inventoryItem;
  assert.equal(
    ebayOfficialPublicationFingerprintVerified({
      expectedFingerprint: fingerprint,
      expectedArguments: null,
      offer,
      inventoryItem,
    }),
    false,
  );
  assert.equal(
    ebayOfficialPublicationFingerprintVerified({
      expectedFingerprint: fingerprint,
      expectedArguments: input,
      offer,
      inventoryItem,
    }),
    true,
  );
  assert.equal(
    ebayOfficialPublicationFingerprintVerified({
      expectedFingerprint: fingerprint,
      expectedArguments: input,
      offer: { ...(offer as object), availableQuantity: 99 },
      inventoryItem,
    }),
    false,
  );
});

test("r5 HOLD: CREATE response loss without offerId can still bind GET-only recovery", () => {
  const input: ExecuteInput = {
    channel: "ebay",
    operation: "listing.create",
    payload: { access_token: "token" },
    arguments: {
      sku,
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedFingerprint: fingerprint,
      offer: { marketplaceId: "EBAY_US", format: "FIXED_PRICE" },
    },
    environment: "production",
  };
  const binding = {
    contract: EBAY_PUBLICATION_RECONCILIATION_CONTRACT,
    sourceJobId: "00000000-0000-4000-8000-000000000901",
    attemptId: "00000000-0000-4000-8000-000000000902",
    credentialId: "00000000-0000-4000-8000-000000000903",
    sku,
    marketplaceId: "EBAY_US" as const,
    offerId: null,
    lastStage: "offer" as const,
    requestFingerprint: fingerprint,
  };
  assert.deepEqual(assertEbayPublicationReconciliationBinding(input, binding).offerId, null);
});

test("r5 HOLD: reserved 40000 does not wrap the public gateway claim and CAS current stock/USD", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260910040000_ebay_create_execution_recovery_hardening.sql", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(sql, /sellerpilot_40000_claim_gateway_before_ebay|alter function public\.sellerpilot_claim_channel_gateway_job/u);
  assert.match(sql, /EBAY_CREATE_STAGE_COMMERCE_STALE/u);
  assert.match(sql, /d\.data#>>'\{common,globalBaseUsdPrice\}'/u);
  assert.match(sql, /greatest\(p\.on_hand-p\.reserved-p\.safety_stock,0\)/u);
  assert.match(sql, /ebay_create_credential_rebind_receipts/u);
  assert.match(sql, /reject_ebay_create_stage_receipt_mutation/u);
  assert.match(sql, /offerId',\(select o\.provider_resource_id/u);
  const names = [...sql.matchAll(/\b(?:function|procedure)\s+(?:public|sellerpilot_private)\.([A-Za-z0-9_]+)/giu)]
    .map((match) => match[1]);
  for (const name of names) {
    assert.ok(name.length <= 63, name);
  }
});
