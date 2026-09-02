import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import {
  ebayExactExistingQaRecoveryIdentity,
  ebayExactV101ArgumentsForFingerprint,
  ebayExactV101ContentBaseRequestFingerprint,
  ebayExactV101ContentContract,
  ebayExactV101ContentContractArgument,
  ebayExactV101ContentRequestFingerprint,
} from "../lib/channels/ebay-exact-existing-qa-recovery";
import {
  bindEbayExactRepresentativeFromStorage,
  ebayExactSquareAssetPath,
  type EbayExactRepresentativeStorage,
} from "../lib/server-ebay-exact-representative";
import { validateStoredProductGeneratedAssetPaths } from "../lib/studio-result-assets";

const jobId = "334631fe-0095-4ea8-a20a-16971f6ca71a";
const claimId = "eee7b548-62e7-4175-bd54-deb426da6c06";
const squarePath = `results/${jobId}/claims/${claimId}/thumbnail-square.png`;
const sourceBytes = new Blob(["approved eBay representative"], {
  type: "image/png",
});
const signedUrl =
  `https://sellerpilot.supabase.co/storage/v1/object/sign/sellerpilot-ai/${squarePath}?token=signed`;

function generatedImagePaths() {
  return Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [
    asset.id,
    `results/${jobId}/claims/${claimId}/${asset.file}`,
  ]));
}

function argumentsValue() {
  return {
    sellerpilotAssets: {
      galleryImageUrls: ["https://attacker.invalid/browser-candidate.png"],
      approvedGalleryImagePaths: ["forged/path.png"],
      approvedGalleryImageSha256s: ["f".repeat(64)],
      detailImageUrls: ["https://example.invalid/detail.png"],
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function operationalManifestFingerprintArguments() {
  const prefix =
    "results/334631fe-0095-4ea8-a20a-16971f6ca71a/claims/eee7b548-62e7-4175-bd54-deb426da6c06";
  const roles = [
    "overview", "feature", "use", "package",
    "contents", "routine", "care", "dimensions",
  ];
  const imageRoles = roles.map((role) => `detail-${role}`);
  const detailPaths = imageRoles.map((role) => `${prefix}/${role}.png`);
  const detailSha256s = [
    "936884bd8dce54f40e87fe3f75e4491b4a90ae7b97c4ad045223fbe9afaca486",
    "6fb60c950edfeebdc154f85c22c968ce433455c5c5063a3f494277fc90c64342",
    "e98126961aff9ec9ae61e2bc56b2017861c6871b33a3f4f13a43d2f9bf9a7af8",
    "d9034b19e31fcb664b3297af8c99fc784194d05bd971c8aef8fff1323698cf30",
    "c64ba71c0c911f26b3a458e729945b911bf934ba0c34a6503b50a9993133cfc1",
    "cd8d1dc0b95477461091953f6e750a54ae4e845da1a51f74f04cabc0aab8b86a",
    "196acc5a275bbd250d5a7ca04ac1932bd47a80eb4caef064c719395794a0d218",
    "5f1b7e9a8374e481db44628a4add6f3f27572cd5d5287e160f36b229d9b0a5e6",
  ];
  const productName = "buchakhyeong keibeul jeongri keulrip 6gae seteu";
  const detailFacts = [
    ["overview", "product identity", `${productName}; buchakhyeong keibeul jeongri keulrip.`],
    ["feature", "brand record", "No Brand; Generic OEM."],
    ["howto", "sale contents", `${productName}; NEW.`],
    ["spec", "package dimensions", "15 x 10 x 3 cm / 0.1 kg."],
    ["routine", "price and stock", "5000 KRW; 1."],
    ["contents", "shipping terms", "geomjeongsaek buchakhyeong keibeul jeongri keulrip 6gae; 0 KRW."],
    ["care", "pre-use checks", "geomjeongsaek buchakhyeong keibeul jeongri keulrip 6gae."],
    ["proof", "evidence limits", `QA-20260823-CC-001; ${productName}.`],
  ] as const;
  const sectionImageRoles = [
    "detail-overview", "detail-feature", "detail-use", "detail-dimensions",
    "detail-routine", "detail-contents", "detail-care", "detail-package",
  ];
  const localizedDetailSections = detailFacts.map(([
    type,
    heading,
    fact,
  ], index) => ({
    body: `${heading} is presented only within the seller-confirmed input boundary. Compare the actual product name, package contents, package wording and order terms before purchase. Unseen labels, certifications, benefits and included items are not inferred. Pre-purchase review: ${fact}`,
    type,
    heading,
    evidence: `Only the seller-reviewed input record for ${heading} is used as evidence. ${fact}`,
    imageAsset: sectionImageRoles[index],
    imageAltText: `${productName}: Seller-reviewed product information: ${heading}`,
    buyerQuestion: `How should ${heading} be checked before purchase?`,
  }));
  const detailImageAltTexts = [
    "product identity", "brand record", "sale contents", "evidence limits",
    "shipping terms", "price and stock", "pre-use checks", "package dimensions",
  ].map((heading) => (
    `${productName}: Seller-reviewed product information: ${heading}`
  ));
  return {
    sellerpilotAssets: {
      contentMode: "ai_generated",
      galleryImageUrls: [`sellerpilot-storage://${squarePath}`],
      detailImageUrls: detailPaths.map((path) => `sellerpilot-storage://${path}`),
      detailImageRoles: imageRoles,
      detailImageAltTexts,
      thumbnailAltText: `${productName}: Seller-reviewed product information US`,
      localizedDetailSections,
      classification: {
        evidence: "The seller-reviewed category record is retained, while regulatory and certification status still requires a separate check before publication. buchakhyeong keibeul jeongri keulrip.",
        displayName: "Seller-reviewed classification: buchakhyeong keibeul jeongri keulrip",
        verificationStatus: "verified",
        isHealthFunctionalFood: false,
      },
      detailAssetMode: "dedicated",
      integrationRevision: "marketplace-write-v4-evidence-detail",
      approvedDetailImagePaths: detailPaths,
      approvedDetailImageSha256s: detailSha256s,
      approvedDetailPageVersion: 1,
      detailImageManifestDigest:
        "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62",
      approvedGalleryImagePaths: [squarePath],
      approvedGalleryImageSha256s: [
        "1be297f0103147951dbb3e7167cd87362f9cf12efe5be2dfa26cd0ed9b918753",
      ],
    },
    listingId: "800551945442",
    inventoryItem: {
      availability: { shipToLocationAvailability: { quantity: 1 } },
      condition: "NEW",
      product: {},
    },
    offer: {
      availableQuantity: 1,
      pricingSummary: { price: { value: "12.9", currency: "USD" } },
    },
    sku: "QA-20260823-CC-001-US",
    marketplaceId: "EBAY_US",
    sellerpilotEbayExactExistingQaRecovery: {
      contract: "ebay_exact_existing_qa_recovery_v2",
      phase: "listing.update",
      productId: ebayExactExistingQaRecoveryIdentity.productId,
      listingId: ebayExactExistingQaRecoveryIdentity.listingId,
      sourceAttemptId: ebayExactExistingQaRecoveryIdentity.sourceAttemptId,
      publicListingId: ebayExactExistingQaRecoveryIdentity.publicListingId,
      market: "US",
      marketplaceId: "EBAY_US",
      marketplaceSku: ebayExactExistingQaRecoveryIdentity.marketplaceSku,
      offerId: ebayExactExistingQaRecoveryIdentity.offerId,
      currency: "USD",
      priceUsd: 12.9,
      stock: 1,
      credentialId: "742773ae-e2ce-4b06-99d2-7c6eb541af03",
      sellerAccountKey: ebayExactExistingQaRecoveryIdentity.sellerAccountKey,
      offerIdSource: "immutable_lineage_attestation_v1",
      sellerAccountLineage: "validated_by_service_rpc",
    },
    sellerpilotEbayExactV101ContentContract: ebayExactV101ContentContract,
    sellerpilotEbayExactNoEffectRetry: {
      contract: "ebay_exact_no_effect_retry_v1",
      sourceJobId: "08e8cff9-5d7c-4992-b668-6d932aa5ff10",
      sourceAttemptId: "22457f2e-51d8-43c5-bb03-d2c1bb7fe697",
      sourcePermitId: "c2e9f199-f6a7-425f-8668-7eebd5b08bb4",
      sourceRequestFingerprint:
        "79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc",
      providerErrorId: 25_718,
      providerEffect: "deterministic_rejection_no_effect",
    },
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "en-US",
    publicationExpectedImageCount: 8,
  };
}

function storage(overrides: Partial<EbayExactRepresentativeStorage> = {}) {
  const value: EbayExactRepresentativeStorage = {
    download: async (path) => ({
      data: path === squarePath ? sourceBytes : null,
      error: path === squarePath ? null : new Error("not found"),
    }),
    createSignedUrl: async (path, expiresIn) => ({
      data: path === squarePath && expiresIn === 7_200 ? { signedUrl } : null,
      error: path === squarePath && expiresIn === 7_200
        ? null
        : new Error("not signed"),
    }),
    ...overrides,
  };
  return value;
}

test("the sanitized operational route fixture produces the exact server-bound fingerprints", () => {
  const argumentsValue = operationalManifestFingerprintArguments();
  const fingerprintArguments = ebayExactV101ArgumentsForFingerprint(
    argumentsValue,
  );
  const baseArguments = structuredClone(fingerprintArguments);
  delete baseArguments[ebayExactV101ContentContractArgument];
  const baseRequestFingerprint = createHash("sha256")
    .update(canonicalJson({
      channel: "ebay",
      operation: "listing.update",
      environment: "production",
      productId: ebayExactExistingQaRecoveryIdentity.productId,
      resourceListingId: ebayExactExistingQaRecoveryIdentity.listingId,
      inventoryItemId: null,
      orderId: null,
      shipmentCarrier: null,
      shipmentTracking: null,
      currency: "USD",
      price: 12.9,
      market: "US",
      targetId: "EBAY_US",
      arguments: baseArguments,
    }))
    .digest("hex");
  assert.equal(
    baseRequestFingerprint,
    ebayExactV101ContentBaseRequestFingerprint,
  );

  const requestFingerprint = createHash("sha256")
    .update(canonicalJson({
      baseRequestFingerprint,
      contract: ebayExactV101ContentContract,
    }))
    .digest("hex");
  assert.equal(requestFingerprint, ebayExactV101ContentRequestFingerprint);
});

test("eBay exact representative replaces all client gallery evidence with one server-owned square source", async () => {
  const generated = validateStoredProductGeneratedAssetPaths(generatedImagePaths());
  assert.ok(generated);
  assert.equal(ebayExactSquareAssetPath(generated), squarePath);

  const input = argumentsValue();
  const before = structuredClone(input);
  const result = await bindEbayExactRepresentativeFromStorage({
    argumentsValue: input,
    generatedImagePaths: generatedImagePaths(),
    storage: storage(),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const sourceSha256 = createHash("sha256")
    .update(Buffer.from(await sourceBytes.arrayBuffer()))
    .digest("hex");
  const assets = result.argumentsValue.sellerpilotAssets as Record<string, unknown>;
  assert.deepEqual(assets.galleryImageUrls, [signedUrl]);
  assert.deepEqual(assets.approvedGalleryImagePaths, [squarePath]);
  assert.deepEqual(assets.approvedGalleryImageSha256s, [sourceSha256]);
  assert.deepEqual(assets.detailImageUrls, ["https://example.invalid/detail.png"]);
  assert.deepEqual(input, before, "the browser payload must not be mutated");
});

test("eBay exact representative rejects an invalid ledger before touching Storage", async () => {
  let calls = 0;
  const invalidPaths = generatedImagePaths();
  invalidPaths.square = invalidPaths.square.replace("thumbnail-square.png", "hero.png");
  const result = await bindEbayExactRepresentativeFromStorage({
    argumentsValue: argumentsValue(),
    generatedImagePaths: invalidPaths,
    storage: storage({
      download: async () => {
        calls += 1;
        throw new Error("must not download");
      },
      createSignedUrl: async () => {
        calls += 1;
        throw new Error("must not sign");
      },
    }),
  });
  assert.deepEqual(result, {
    ok: false,
    code: "generated_asset_manifest_invalid",
  });
  assert.equal(calls, 0);
  assert.equal(ebayExactSquareAssetPath([]), null);
});

test("eBay exact representative classifies Storage, size, URL, and argument failures closed", async () => {
  const cases: Array<[
    string,
    EbayExactRepresentativeStorage,
    Record<string, unknown>,
    string,
  ]> = [
    [
      "download",
      storage({
        download: async () => ({ data: null, error: new Error("failed") }),
      }),
      argumentsValue(),
      "storage_download_failed",
    ],
    [
      "download throw",
      storage({ download: () => { throw new Error("failed"); } }),
      argumentsValue(),
      "storage_download_failed",
    ],
    [
      "empty",
      storage({ download: async () => ({ data: new Blob([]), error: null }) }),
      argumentsValue(),
      "storage_download_size_invalid",
    ],
    [
      "size drift",
      storage({
        download: async () => ({
          data: { size: 100, arrayBuffer: async () => new ArrayBuffer(1) },
          error: null,
        }),
      }),
      argumentsValue(),
      "storage_download_size_invalid",
    ],
    [
      "read",
      storage({
        download: async () => ({
          data: {
            size: 2,
            arrayBuffer: async () => { throw new Error("read failed"); },
          },
          error: null,
        }),
      }),
      argumentsValue(),
      "storage_read_failed",
    ],
    [
      "sign",
      storage({
        createSignedUrl: async () => ({ data: null, error: new Error("failed") }),
      }),
      argumentsValue(),
      "storage_signing_failed",
    ],
    [
      "external signed URL",
      storage({
        createSignedUrl: async () => ({
          data: {
            signedUrl: `https://attacker.invalid/storage/v1/object/sign/sellerpilot-ai/${squarePath}?token=signed`,
          },
          error: null,
        }),
      }),
      argumentsValue(),
      "representative_binding_invalid",
    ],
    [
      "wrong signed object",
      storage({
        createSignedUrl: async () => ({
          data: {
            signedUrl: "https://sellerpilot.supabase.co/storage/v1/object/sign/sellerpilot-ai/results/other/thumbnail-square.png?token=signed",
          },
          error: null,
        }),
      }),
      argumentsValue(),
      "representative_binding_invalid",
    ],
    [
      "missing assets",
      storage(),
      {},
      "representative_binding_invalid",
    ],
  ];

  for (const [name, fakeStorage, args, expectedCode] of cases) {
    const result = await bindEbayExactRepresentativeFromStorage({
      argumentsValue: args,
      generatedImagePaths: generatedImagePaths(),
      storage: fakeStorage,
    });
    assert.deepEqual(result, { ok: false, code: expectedCode }, name);
  }
});

test("the eBay route binds the server square after detail approval and before every fingerprint", async () => {
  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const detailBinding = route.indexOf(
    "effectiveArguments = bindMarketplaceArgumentsToApprovedDetailManifest(",
  );
  const representativeBinding = route.indexOf(
    "const representative = await bindEbayExactRepresentativeFromStorage(",
  );
  const manifestFingerprint = route.indexOf(
    "const manifestFingerprintArguments = approvedDetailBinding",
  );
  const exactFingerprint = route.indexOf(
    "fingerprintArguments = ebayExactV101ArgumentsForFingerprint(",
  );

  assert.ok(detailBinding >= 0);
  assert.ok(representativeBinding > detailBinding);
  assert.ok(manifestFingerprint > representativeBinding);
  assert.ok(exactFingerprint > manifestFingerprint);
  assert.match(route, /mode: "ebay_exact_representative_required"/u);
  assert.match(route, /reasonCode: representative\.code/u);
  assert.match(
    route,
    /generatedImagePaths: verifiedPublishContext\?\.generatedImagePaths/u,
  );
});
