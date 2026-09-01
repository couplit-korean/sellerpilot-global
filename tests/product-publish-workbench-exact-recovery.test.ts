import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildChannelArguments,
  buildDraftMap,
  exactExternalActionWorkbenchRecoveryCandidate,
  inspectWorkbenchListingDraft,
} from "../app/product-publish-workbench";
import { coupangExactQaRecoveryIdentity } from "../lib/channels/coupang-exact-qa-recovery";
import {
  ebayExactExistingQaClientBuyerCopySupplied,
  ebayExactExistingQaRecoveryIdentity,
} from "../lib/channels/ebay-exact-existing-qa-recovery";
import { elevenstExactExistingPublicationIdentity } from "../lib/channels/elevenst-exact-existing-identity";
import { lazadaExactExistingPublicationIdentity } from "../lib/channels/lazada-exact-existing-identity";
import { prepareListingUpdateArguments } from "../lib/channels/listing-update";

type PublishContext = Parameters<typeof buildChannelArguments>[1];
type WorkbenchListing = PublishContext["listings"][number];

const detailSections = [
  ["overview", "detail-overview"],
  ["feature", "detail-feature"],
  ["howto", "detail-use"],
  ["spec", "detail-dimensions"],
  ["routine", "detail-routine"],
  ["contents", "detail-contents"],
  ["care", "detail-care"],
  ["proof", "detail-package"],
] as const;

function exactListing(
  channel: WorkbenchListing["channel"],
  identity: { listingId: string; remoteId?: string; publicListingId?: string; sellerProductId?: string },
  overrides: Partial<WorkbenchListing> = {},
): WorkbenchListing {
  return {
    id: identity.listingId,
    channel,
    market: channel === "ebay" ? "US" : channel === "lazada" ? "MY" : "KR",
    targetId: channel === "ebay" ? "EBAY_US" : channel === "lazada" ? "MY" : "",
    remoteId: identity.remoteId ?? identity.publicListingId ?? identity.sellerProductId ?? null,
    marketplaceSku: channel === "ebay"
      ? ebayExactExistingQaRecoveryIdentity.marketplaceSku
      : channel === "elevenst"
        ? elevenstExactExistingPublicationIdentity.sellerSku
        : null,
    status: "failed",
    lastError: "provider verification required",
    failureClass: "external_action",
    publishedAt: null,
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
    providerStatus: null,
    ...overrides,
  };
}

function exactEbayContext(): PublishContext {
  const classification = {
    displayName: "Cable organizer clips",
    verificationStatus: "verified" as const,
    evidence: "Seller-confirmed package and product photographs.",
    isHealthFunctionalFood: false,
  };
  return {
    contentMode: "ai_generated",
    product: {
      id: ebayExactExistingQaRecoveryIdentity.productId,
      externalCode: ebayExactExistingQaRecoveryIdentity.centralSku,
      sku: ebayExactExistingQaRecoveryIdentity.centralSku,
      name: "부착형 케이블 정리 클립 6개 세트",
      description: "판매자가 확인한 케이블 정리 클립 상품 설명입니다.",
      sourceUrl: null,
      status: "draft",
      classification,
    },
    classification,
    manualFields: {
      productName: "부착형 케이블 정리 클립 6개 세트",
      description: "판매자가 확인한 케이블 정리 클립 상품 설명입니다.",
      sellerSku: ebayExactExistingQaRecoveryIdentity.centralSku,
      categoryHint: "Cable organizer clips",
      brandName: "No Brand",
      manufacturer: "Generic OEM",
      countryOfOrigin: "China",
      material: "Silicone",
      packageContents: "6개 세트",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 5_000,
      currency: "KRW",
      stock: 1,
      weightKg: 0.1,
      packageLengthCm: 10,
      packageWidthCm: 8,
      packageHeightCm: 2,
    },
    imageSpecs: [],
    assignments: [{
      channel: "ebay",
      market: "US",
      categoryId: "67858",
      categoryPath: ["Business & Industrial", "Cable Ties & Organizers"],
      providedAttributes: { Material: "Silicone" },
      status: "confirmed",
      confirmedAt: "2026-08-31T00:00:00.000Z",
    }],
    listings: [exactListing("ebay", {
      listingId: ebayExactExistingQaRecoveryIdentity.listingId,
      remoteId: ebayExactExistingQaRecoveryIdentity.publicListingId,
    })],
    sourceImages: [{
      path: "owner/job/input/normalized/0.jpg",
      url: "https://cdn.example.com/source.jpg",
    }],
    generatedImages: [
      "square",
      "hero",
      ...detailSections.map(([, role]) => role),
    ].map((id, index) => ({
      id,
      path: `owner/job/generated/${id}.jpg`,
      url: `https://cdn.example.com/generated-${index}-${id}.jpg`,
    })),
    localizedListings: [{
      channel: "ebay",
      market: "US",
      locale: "en-US",
      title: "buchakhyeong keibeul jeongri keulrip 6gae seteu - Pre-purchase review",
      shortDescription: "Legacy romanized review copy.",
      description: "Legacy romanized review copy must never replace the current provider text.",
      keywords: ["cable organizer"],
      thumbnailAltText: "Cable organizer clips",
      classification,
      detailSections: detailSections.map(([type, imageAsset], index) => ({
        type,
        buyerQuestion: `Product detail question ${index + 1}`,
        evidence: `Seller-confirmed source ${index + 1}`,
        heading: `Cable organizer detail ${index + 1}`,
        body: `Seller-confirmed product detail ${index + 1}.`,
        imageAsset,
        imageAltText: `Cable organizer detail image ${index + 1}`,
      })),
    }],
  };
}

function nonEbayExactContext(
  channel: "coupang" | "elevenst" | "lazada",
  title: string,
  description: string,
): PublishContext {
  const context = exactEbayContext();
  const identity = channel === "coupang"
    ? coupangExactQaRecoveryIdentity
    : channel === "elevenst"
      ? elevenstExactExistingPublicationIdentity
      : lazadaExactExistingPublicationIdentity;
  const market = channel === "lazada" ? "MY" : "KR";
  const locale = channel === "lazada" ? "ms-MY" : "ko-KR";
  const categoryId = channel === "coupang"
    ? String(coupangExactQaRecoveryIdentity.displayCategoryCode)
    : channel === "elevenst"
      ? elevenstExactExistingPublicationIdentity.categoryId
      : "10100205";
  context.assignments = [{
    channel,
    market,
    categoryId,
    categoryPath: ["Exact QA", "Cable organizer clips"],
    providedAttributes: {},
    status: "confirmed",
    confirmedAt: "2026-08-31T00:00:00.000Z",
  }];
  context.listings = [exactListing(channel, identity)];
  context.localizedListings = [{
    channel,
    market,
    locale,
    title,
    shortDescription: description,
    description,
    keywords: [title],
    thumbnailAltText: title,
    classification: context.classification,
    detailSections: detailSections.map(([type, imageAsset], index) => ({
      type,
      buyerQuestion: `${title} ${index + 1}`,
      evidence: `${description} ${index + 1}`,
      heading: `${title} ${index + 1}`,
      body: `${description} ${index + 1}`,
      imageAsset,
      imageAltText: `${title} ${index + 1}`,
    })),
  }];
  return context;
}

test("workbench recognizes only the fixed external-action tuples for exact recovery", () => {
  const candidates = [
    ["ebay", ebayExactExistingQaRecoveryIdentity, ebayExactExistingQaRecoveryIdentity.productId],
    ["coupang", coupangExactQaRecoveryIdentity, coupangExactQaRecoveryIdentity.productId],
    ["elevenst", elevenstExactExistingPublicationIdentity, elevenstExactExistingPublicationIdentity.productId],
    ["lazada", lazadaExactExistingPublicationIdentity, lazadaExactExistingPublicationIdentity.productId],
  ] as const;

  for (const [channel, identity, productId] of candidates) {
    const listing = exactListing(channel, identity);
    assert.equal(exactExternalActionWorkbenchRecoveryCandidate(productId, channel, listing), true, channel);
    assert.equal(exactExternalActionWorkbenchRecoveryCandidate("wrong-product", channel, listing), false, `${channel} product`);
    assert.equal(exactExternalActionWorkbenchRecoveryCandidate(productId, channel, {
      ...listing,
      remoteId: "wrong-remote",
    }), false, `${channel} remote`);
    assert.equal(exactExternalActionWorkbenchRecoveryCandidate(productId, channel, {
      ...listing,
      remoteVisibility: "live",
    }), false, `${channel} visibility`);
  }

  assert.equal(exactExternalActionWorkbenchRecoveryCandidate(
    ebayExactExistingQaRecoveryIdentity.productId,
    "ebay",
    exactListing("ebay", {
      listingId: "11111111-1111-4111-8111-111111111111",
      remoteId: ebayExactExistingQaRecoveryIdentity.publicListingId,
    }),
  ), false);
});

test("exact eBay workbench draft transports only images and commerce values before server binding", () => {
  const context = exactEbayContext();
  const target = {
    targetId: "EBAY_US",
    displayName: "United States",
    marketCode: "US",
    locale: "en-US",
    language: "English",
    currency: "USD",
  };
  const draft = buildChannelArguments(
    "ebay",
    context,
    5_000,
    1,
    target,
    { weight: 0.1, length: 10, width: 8, height: 2 },
    12.9,
  ) as Record<string, unknown>;
  const drafts = buildDraftMap(
    context,
    5_000,
    1,
    { ebay: target },
    { weight: 0.1, length: 10, width: 8, height: 2 },
    12.9,
  );
  const requirements = inspectWorkbenchListingDraft("ebay", draft, "listing.update", {
    productId: context.product.id,
    listing: context.listings[0],
  });
  const prepared = prepareListingUpdateArguments(
    "ebay",
    draft,
    { ...context.listings[0], listingId: context.listings[0].id },
  );

  assert.notEqual(drafts.ebay, "{}", "legacy localized copy must not erase the exact draft");
  assert.equal(ebayExactExistingQaClientBuyerCopySupplied(draft), false);
  assert.equal(ebayExactExistingQaClientBuyerCopySupplied(prepared), false);
  assert.deepEqual(
    requirements.filter((item) => ["title", "description"].includes(item.key)).map((item) => item.status),
    ["runtime", "runtime"],
  );
  assert.deepEqual(requirements.filter((item) => item.status === "manual"), []);
  assert.equal(
    ((draft.sellerpilotAssets as Record<string, unknown>).detailImageUrls as unknown[]).length,
    8,
  );
  assert.equal(
    Object.hasOwn(
      (draft.inventoryItem as { product: Record<string, unknown> }).product,
      "title",
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(draft.offer as Record<string, unknown>, "listingDescription"),
    false,
  );
  assert.deepEqual(
    ((prepared.inventoryItem as Record<string, unknown>).product as Record<string, unknown>),
    {},
    "browser image URLs are removed before the server-owned exact binding is added",
  );
});

test("near-match eBay rows keep normal localized buyer copy and never enter provider-copy mode", () => {
  const context = exactEbayContext();
  context.listings[0] = {
    ...context.listings[0],
    remoteId: "800551945443",
  };
  context.localizedListings[0] = {
    ...context.localizedListings[0],
    title: "Adhesive Cable Organizer Clips Set of 6",
    shortDescription: "Six adhesive clips keep charging cables organized.",
    description: "Six adhesive cable organizer clips keep charging cords tidy and within easy reach.",
  };
  const draft = buildChannelArguments(
    "ebay",
    context,
    5_000,
    1,
    {
      targetId: "EBAY_US",
      displayName: "United States",
      marketCode: "US",
      locale: "en-US",
      language: "English",
      currency: "USD",
    },
    { weight: 0.1, length: 10, width: 8, height: 2 },
    12.9,
  ) as Record<string, unknown>;
  const product = (draft.inventoryItem as { product: Record<string, unknown> }).product;

  assert.equal(exactExternalActionWorkbenchRecoveryCandidate(
    context.product.id,
    "ebay",
    context.listings[0],
  ), false);
  assert.equal(product.title, "Adhesive Cable Organizer Clips Set of 6");
  assert.match(String(product.description), /charging cords tidy/u);
  assert.equal(ebayExactExistingQaClientBuyerCopySupplied(draft), true);
});

test("Coupang, 11st, and Lazada exact drafts preserve their reviewed localized copy", () => {
  const coupangTitle = "부착형 케이블 정리 클립 6개 세트";
  const coupangDescription = "책상 위 충전 케이블을 정돈하는 부착형 클립 여섯 개 구성입니다.";
  const coupang = buildChannelArguments(
    "coupang",
    nonEbayExactContext("coupang", coupangTitle, coupangDescription),
    5_000,
    1,
    undefined,
    { weight: 0.1, length: 10, width: 8, height: 2 },
    12.9,
  ) as { body: { sellerProductName: string; items: Array<{ contents: Array<{ contentDetails: Array<{ content: string }> }> }> } };
  assert.equal(coupang.body.sellerProductName, coupangTitle);
  assert.match(coupang.body.items[0].contents[0].contentDetails[0].content, /충전 케이블을 정돈/u);

  const elevenstTitle = "부착형 케이블 정리 클립 6개 세트";
  const elevenstDescription = "케이블을 깔끔하게 정리할 수 있는 부착형 클립 여섯 개 세트입니다.";
  const elevenst = buildChannelArguments(
    "elevenst",
    nonEbayExactContext("elevenst", elevenstTitle, elevenstDescription),
    5_000,
    1,
    undefined,
    { weight: 0.1, length: 10, width: 8, height: 2 },
    12.9,
  ) as { product: { prdNm: string; htmlDetail: string } };
  assert.equal(elevenst.product.prdNm, elevenstTitle);
  assert.match(elevenst.product.htmlDetail, /케이블을 깔끔하게 정리/u);

  const lazadaTitle = "Set 6 Klip Pengurusan Kabel Pelekat";
  const lazadaDescription = "Enam klip pelekat membantu memastikan kabel di meja sentiasa kemas dan mudah dicapai.";
  const lazadaContext = nonEbayExactContext("lazada", lazadaTitle, lazadaDescription);
  const lazada = buildChannelArguments(
    "lazada",
    lazadaContext,
    5_000,
    1,
    {
      targetId: "MY",
      displayName: "Malaysia",
      marketCode: "MY",
      locale: "ms-MY",
      language: "Bahasa Melayu",
      currency: "MYR",
    },
    { weight: 0.1, length: 10, width: 8, height: 2 },
    12.9,
    {
      krwPerMyr: 350,
      fetchedAt: "2026-08-31T00:00:00.000Z",
      asOf: "2026-08-31T00:00:00.000Z",
      source: "Verified test rate",
      sourceUrl: "https://example.com/rate",
      frequency: "minute-market",
    },
  ) as { request: { Request: { Product: { Attributes: { name: string; description: string } } } } };
  assert.equal(lazada.request.Request.Product.Attributes.name, lazadaTitle);
  assert.match(lazada.request.Request.Product.Attributes.description, /kabel di meja sentiasa kemas/u);
});

test("workbench recovery recognition preserves Lazada OAuth seller lineage and live-state fences", async () => {
  const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const providerRuntime = await readFile(new URL("../lib/channels/provider-listing-runtime.ts", import.meta.url), "utf8");
  const workbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(route, /lazadaExactExistingPublicationCandidate/);
  assert.match(route, /lazada_exact_existing_central_contract_required/);
  assert.match(route, /sellerpilotExpectedSellerId: parsed\.data\.targetId/);
  assert.match(providerRuntime, /path: "\/seller\/get"/);
  assert.match(providerRuntime, /requiredVisibility: "live"/);
  assert.match(providerRuntime, /assertLazadaExactExistingUpdateArguments\(input\.arguments\)/);
  assert.equal(
    (workbench.match(/exactExternalActionWorkbenchRecoveryCandidate\(/gu) ?? []).length,
    6,
    "one definition plus draft, preflight, execute, bulk, and card callers must share the same exact fence",
  );
});
