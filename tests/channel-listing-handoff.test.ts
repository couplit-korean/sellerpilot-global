import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LISTING_HANDOFF_FIELD_KEYS,
  LISTING_HANDOFF_GET_RPC,
  LISTING_HANDOFF_PUT_RPC,
  applyEbayListingHandoff,
  currentMarketListingHandoff,
  ebayListingHandoffFromDraft,
  expectedEbayMarketplaceId,
  listingHandoffApiPath,
  listingHandoffPersistenceStatus,
  listingHandoffRpcResult,
  listingHandoffStatusLabel,
  parseListingHandoffQuery,
  parseListingHandoffSave,
} from "../lib/channel-listing-handoff";
import {
  buildChannelArguments,
  buildDraftMap,
  buildSynchronizedDraftMap,
  workbenchExternalPublicationReady,
  workbenchStudioPublicationBlocked,
} from "../app/product-publish-workbench";
import { inspectListingDraft } from "../lib/channels/listing-preflight";

const productId = "1ed4acfc-7603-48ec-a638-241131e59358";
const migrationUrl = new URL(
  "../supabase/migrations/20260905014900_persist_operator_listing_handoffs.sql",
  import.meta.url,
);
const routeUrl = new URL("../app/api/admin/product-listing-handoff/route.ts", import.meta.url);
const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);

const operatorHandoff = {
  marketplaceId: "EBAY_US",
  fulfillmentPolicyId: "fulfillment-operator",
  paymentPolicyId: "payment-operator",
  returnPolicyId: "return-operator",
  merchantLocationKey: "warehouse-operator",
};

function ebayTarget() {
  return {
    targetId: "EBAY_US",
    displayName: "United States",
    marketCode: "US",
    locale: "en-US",
    language: "English",
    currency: "USD",
  };
}

function publishContext() {
  return {
    contentMode: "ai_generated" as const,
    product: {
      id: productId,
      externalCode: "COOKIE-001",
      sku: "AUTO-780720401E2D4E4EA45F",
      name: "롯데 롯샌 파스퇴르 순우유맛 315g (6봉입)",
      description: "판매자가 확인한 쿠키 설명입니다.",
      sourceUrl: null,
      status: "draft",
    },
    manualFields: {
      productName: "Lotte cookies",
      description: "Confirmed cookie description.",
      sellerSku: "AUTO-780720401E2D4E4EA45F",
      categoryHint: "Cookies",
      brandName: "LOTTE",
      manufacturer: "Lotte",
      countryOfOrigin: "대한민국",
      material: "밀가루",
      packageContents: "상품 1개",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 12_000,
      currency: "KRW",
      stock: 3,
      weightKg: 0.4,
      packageLengthCm: 20,
      packageWidthCm: 12,
      packageHeightCm: 8,
    },
    imageSpecs: [],
    assignments: [{
      channel: "ebay" as const,
      market: "US",
      categoryId: "20473",
      categoryPath: ["Food", "Cookies & Biscuits"],
      providedAttributes: {
        Brand: "LOTTE",
        Product: "Cookie & Biscuit",
      },
      status: "confirmed" as const,
      confirmedAt: "2026-09-05T00:00:00.000Z",
    }, {
      channel: "coupang" as const,
      market: "KR",
      categoryId: "12345",
      categoryPath: ["식품", "과자"],
      providedAttributes: {},
      status: "confirmed" as const,
      confirmedAt: "2026-09-05T00:00:00.000Z",
    }, {
      channel: "elevenst" as const,
      market: "KR",
      categoryId: "1341821",
      categoryPath: ["생활잡화", "정리소품"],
      providedAttributes: {},
      status: "confirmed" as const,
      confirmedAt: "2026-09-05T00:00:00.000Z",
    }],
    listings: [],
    sourceImages: [{ path: "source/cookie.jpg", url: "https://cdn.example.com/cookie.jpg" }],
    generatedImages: [
      ...["square", "hero", "portrait", "wide"].map((id) => ({
        id,
        path: `generated/${id}.jpg`,
        url: `https://cdn.example.com/${id}.jpg`,
      })),
      ...[
        "detail-overview", "detail-feature", "detail-use", "detail-package",
        "detail-routine", "detail-dimensions", "detail-contents", "detail-care",
      ].map((id) => ({
        id,
        path: `generated/${id}.jpg`,
        url: `https://cdn.example.com/${id}.jpg`,
      })),
    ],
    localizedListings: [],
    detailData: null,
  };
}

test("explicit listing handoff schema keeps five trimmed fields and rejects extras", () => {
  assert.deepEqual([...LISTING_HANDOFF_FIELD_KEYS], [
    "marketplaceId",
    "fulfillmentPolicyId",
    "paymentPolicyId",
    "returnPolicyId",
    "merchantLocationKey",
  ]);
  assert.equal(parseListingHandoffQuery({
    productId,
    channel: "ebay",
    environment: "production",
    market: "US",
  }).success, true);
  assert.equal(parseListingHandoffSave({
    productId,
    channel: "ebay",
    environment: "production",
    market: "US",
    ...operatorHandoff,
  }).success, true);
  assert.equal(parseListingHandoffSave({
    productId,
    channel: "ebay",
    environment: "production",
    market: "US",
    ...operatorHandoff,
    ownerId: "11111111-1111-4111-8111-111111111111",
  }).success, false);
  assert.equal(parseListingHandoffSave({
    productId,
    channel: "ebay",
    environment: "production",
    market: "US",
    ...operatorHandoff,
    fulfillmentPolicyId: "SERVER_MANAGED",
  }).success, false);
  assert.equal(parseListingHandoffSave({
    productId,
    channel: "ebay",
    environment: "production",
    market: "GB",
    ...operatorHandoff,
  }).success, false);
  assert.equal(expectedEbayMarketplaceId("US"), "EBAY_US");
});

test("handoff helpers apply only the exact current market and never invent unique GET defaults", () => {
  const usHandoff = { ...operatorHandoff, channel: "ebay" as const, market: "US" };
  assert.deepEqual(
    currentMarketListingHandoff(usHandoff, { channel: "ebay", market: "US", marketplaceId: "EBAY_US" }),
    operatorHandoff,
  );
  assert.equal(
    currentMarketListingHandoff(usHandoff, { channel: "ebay", market: "GB", marketplaceId: "EBAY_GB" }),
    null,
  );
  const applied = applyEbayListingHandoff({
    offer: {
      marketplaceId: "EBAY_US",
      listingPolicies: {
        fulfillmentPolicyId: "SERVER_MANAGED",
        paymentPolicyId: "SERVER_MANAGED",
        returnPolicyId: "SERVER_MANAGED",
      },
      merchantLocationKey: "SERVER_MANAGED",
    },
  }, operatorHandoff);
  assert.equal(
    (applied.offer as { listingPolicies: { fulfillmentPolicyId: string } }).listingPolicies.fulfillmentPolicyId,
    "fulfillment-operator",
  );
  assert.equal(listingHandoffPersistenceStatus(null, null), "unsaved");
  assert.equal(listingHandoffPersistenceStatus(operatorHandoff, operatorHandoff), "saved");
  assert.equal(listingHandoffPersistenceStatus(operatorHandoff, null, "rpc missing"), "error");
  assert.equal(listingHandoffStatusLabel("saved"), "저장됨");
  assert.equal(listingHandoffStatusLabel("unsaved"), "미저장");
  assert.equal(listingHandoffStatusLabel("error"), "오류");
  assert.equal(
    listingHandoffApiPath({
      productId,
      channel: "ebay",
      environment: "production",
      market: "US",
    }).includes("product-listing-handoff"),
    true,
  );
  assert.equal(listingHandoffRpcResult(null), null);
  assert.equal(listingHandoffRpcResult({
    productId,
    channel: "ebay",
    environment: "production",
    market: "US",
    ...operatorHandoff,
    updatedAt: "2026-09-05T01:49:00.000Z",
  })?.merchantLocationKey, "warehouse-operator");
});

test("buildChannelArguments hydrates eBay policies from the current market handoff only", () => {
  const context = publishContext();
  const unconfigured = buildChannelArguments(
    "ebay",
    context,
    12_000,
    3,
    ebayTarget(),
    { weight: 0.4, length: 20, width: 12, height: 8 },
    9.9,
  ) as {
    offer: {
      marketplaceId: string;
      listingPolicies: Record<string, string>;
      merchantLocationKey: string;
    };
    inventoryItem: { product: { aspects: Record<string, string[]> } };
  };
  assert.equal(unconfigured.offer.listingPolicies.fulfillmentPolicyId, "SERVER_MANAGED");
  assert.equal(unconfigured.offer.merchantLocationKey, "SERVER_MANAGED");
  assert.equal(JSON.stringify(unconfigured).includes("287802829015"), false);
  assert.equal(JSON.stringify(unconfigured).includes("sellerpilot-seoul"), false);
  assert.deepEqual(unconfigured.inventoryItem.product.aspects.Brand, ["LOTTE"]);
  assert.deepEqual(unconfigured.inventoryItem.product.aspects.Product, ["Cookie & Biscuit"]);

  const configured = buildChannelArguments(
    "ebay",
    context,
    12_000,
    3,
    ebayTarget(),
    { weight: 0.4, length: 20, width: 12, height: 8 },
    9.9,
    null,
    {
      productId,
      channel: "ebay",
      environment: "production",
      market: "US",
      ...operatorHandoff,
    },
  ) as { offer: { listingPolicies: Record<string, string>; merchantLocationKey: string } };
  assert.equal(configured.offer.listingPolicies.paymentPolicyId, "payment-operator");
  assert.equal(configured.offer.merchantLocationKey, "warehouse-operator");

  const ignoredOtherMarket = buildChannelArguments(
    "ebay",
    context,
    12_000,
    3,
    ebayTarget(),
    { weight: 0.4, length: 20, width: 12, height: 8 },
    9.9,
    null,
    {
      productId,
      channel: "ebay",
      environment: "production",
      market: "GB",
      marketplaceId: "EBAY_GB",
      fulfillmentPolicyId: "gb-fulfillment",
      paymentPolicyId: "gb-payment",
      returnPolicyId: "gb-return",
      merchantLocationKey: "london",
    },
  ) as { offer: { listingPolicies: Record<string, string> } };
  assert.equal(ignoredOtherMarket.offer.listingPolicies.fulfillmentPolicyId, "SERVER_MANAGED");
});

test("category-style draft rebuild keeps a saved eBay handoff and Coupang omits vendorId", () => {
  const context = publishContext();
  const stored = {
    productId,
    channel: "ebay" as const,
    environment: "production" as const,
    market: "US",
    ...operatorHandoff,
  };
  const drafts = buildDraftMap(
    context,
    12_000,
    3,
    { ebay: ebayTarget() },
    { weight: 0.4, length: 20, width: 12, height: 8 },
    9.9,
    null,
    { ebay: stored },
  );
  const rebuilt = buildSynchronizedDraftMap(
    context,
    drafts,
    13_000,
    3,
    { ebay: ebayTarget() },
    { weight: 0.4, length: 20, width: 12, height: 8 },
    9.9,
    null,
    { ebay: stored },
  );
  const ebayDraft = JSON.parse(rebuilt.ebay ?? "{}") as {
    offer: { listingPolicies: Record<string, string>; merchantLocationKey: string };
  };
  assert.equal(ebayDraft.offer.listingPolicies.returnPolicyId, "return-operator");
  assert.equal(ebayDraft.offer.merchantLocationKey, "warehouse-operator");
  assert.equal(
    ebayListingHandoffFromDraft(ebayDraft, { market: "US", marketplaceId: "EBAY_US" })?.fulfillmentPolicyId,
    "fulfillment-operator",
  );

  const coupang = buildChannelArguments(
    "coupang",
    context,
    12_000,
    3,
    undefined,
    { weight: 0.4, length: 20, width: 12, height: 8 },
    9.9,
  ) as { body: Record<string, unknown> };
  assert.equal(Object.hasOwn(coupang.body, "vendorId"), false);
  assert.equal(JSON.stringify(coupang.body).includes("SERVER_MANAGED"), false);

  const elevenst = buildChannelArguments(
    "elevenst",
    context,
    12_000,
    3,
    undefined,
    { weight: 0.4, length: 20, width: 12, height: 8 },
    9.9,
  ) as { product: { ProductNotification: { type: string; item: Array<{ code: string; name: string }> } } };
  assert.equal(elevenst.product.ProductNotification.type, "891045");
  const foodContext = publishContext();
  foodContext.assignments[2] = {
    ...foodContext.assignments[2]!,
    categoryId: "1346631",
    providedAttributes: {},
  };
  const foodDraft = buildChannelArguments(
    "elevenst",
    foodContext,
    12_000,
    3,
    undefined,
    { weight: 0.4, length: 20, width: 12, height: 8 },
    9.9,
  ) as Record<string, unknown>;
  const foodRequirements = inspectListingDraft("elevenst", foodDraft, "listing.create");
  assert.equal(foodRequirements.some((item) => item.key.startsWith("food-notice-") && item.status === "manual"), true);
});

test("listing handoff migration is a service-only sibling table with short RPC names", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table if not exists sellerpilot_private\.product_channel_listing_handoff/);
  assert.match(sql, /constraint listing_handoff_scope_key\s+unique \(owner_id, product_id, channel, environment, market\)/);
  assert.match(sql, /revoke all on sellerpilot_private\.product_channel_listing_handoff\s+from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.sellerpilot_get_listing_handoff\(uuid, text, text, text\)\s+to service_role/);
  assert.match(sql, /grant execute on function public\.sellerpilot_put_listing_handoff\(uuid, text, text, text, jsonb\)\s+to service_role/);
  assert.doesNotMatch(sql, /grant execute on function public\.sellerpilot_get_listing_handoff[\s\S]*to (?:public|anon|authenticated)/);
  assert.match(sql, /p_handoff \?& array\[/);
  assert.match(sql, /v_key_count is distinct from 5/);
  assert.doesNotMatch(sql, /insert into sellerpilot_private\.product_listings/);
  assert.doesNotMatch(sql, /287802829015|sellerpilot-seoul|fulfillment287802829015/);
  assert.ok(LISTING_HANDOFF_GET_RPC.length <= 63);
  assert.ok(LISTING_HANDOFF_PUT_RPC.length <= 63);
  assert.match(sql, new RegExp(`function public\\.${LISTING_HANDOFF_GET_RPC}\\(`));
  assert.match(sql, new RegExp(`function public\\.${LISTING_HANDOFF_PUT_RPC}\\(`));
});

test("admin listing-handoff route reads and writes only the explicit service RPCs", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /export async function GET\(request: Request\)/);
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.equal((route.match(/authenticateAdminRequest\(request\)/g) ?? []).length, 2);
  assert.match(route, /admin\.serviceClient\.rpc\(LISTING_HANDOFF_GET_RPC/);
  assert.match(route, /admin\.serviceClient\.rpc\(LISTING_HANDOFF_PUT_RPC/);
  assert.match(route, /listingHandoffSaveSchema\.safeParse/);
  assert.match(route, /PGRST202/);
  assert.doesNotMatch(route, /userClient\.from\(/);
  assert.doesNotMatch(route, /product_listings/);
  assert.doesNotMatch(route, /fulfillment_policy\?marketplace_id/);
  assert.doesNotMatch(route, /PUT.*inventory|POST.*offer|sell\/inventory\/v1/);
  assert.doesNotMatch(route, /287802829015|sellerpilot-seoul/);
});

test("workbench persists eBay policies with explicit 정책 저장 and keeps first-stage facts", async () => {
  const source = await readFile(workbenchUrl, "utf8");
  assert.match(source, /정책 저장/);
  assert.match(source, /listingHandoffStatusLabel\(ebayHandoffStatus\)/);
  assert.match(source, /fetchStoredListingHandoff/);
  assert.match(source, /saveStoredListingHandoff/);
  assert.match(source, /buildDraftMap\([\s\S]*\{ ebay: nextEbayHandoff \}/);
  assert.match(source, /currentMarketListingHandoff\(listingHandoff/);
  assert.match(source, /displayProductName: title\.slice\(0, 100\),\s*saleStartedAt: ""/s);
  assert.doesNotMatch(source, /vendorId: "SERVER_MANAGED"/);
  assert.doesNotMatch(source, /287802829015|287802924015|287803006015|sellerpilot-seoul/);
  assert.match(source, /normalizeEbayAspects/);
  assert.match(source, /elevenstProcessedFoodNotificationFields/);
  assert.match(source, /공통정보 확인 · 채널별 자동 등록/);
  assert.match(source, /국내 기준 판매가 KRW/);
  assert.doesNotMatch(source, /sell\/inventory\/v1\/inventory_item/);
  assert.doesNotMatch(source, /\/offer"/);
});

test("absent studioQuality is not a publication block and is not quality verified", () => {
  assert.equal(workbenchStudioPublicationBlocked(undefined), false);
  assert.equal(workbenchStudioPublicationBlocked({}), false);
  assert.equal(workbenchStudioPublicationBlocked({ studioQuality: undefined }), false);
  assert.equal(workbenchStudioPublicationBlocked({
    studioQuality: { blockedForPublication: false },
  }), false);
  assert.equal(workbenchStudioPublicationBlocked({
    studioQuality: { blockedForPublication: true },
  }), true);
});

test("approved external detail is not treated as a Studio success conversion", () => {
  const signedImages = Array.from({ length: 8 }, (_, index) => ({
    path: `external-detail/owner/product/import/${index}.png`,
    url: `https://signed.example/${index}.png`,
  }));
  assert.equal(workbenchStudioPublicationBlocked({
    contentMode: "external_generated",
    studioQuality: { blockedForPublication: true },
  }), false);
  assert.equal(workbenchExternalPublicationReady({
    contentMode: "external_generated",
    externalDetailImport: { status: "approved", signedImages },
  }), true);
  assert.equal(workbenchExternalPublicationReady({
    contentMode: "external_generated",
    externalDetailImport: { status: "verified", signedImages },
  }), false);
  assert.equal(workbenchExternalPublicationReady({
    contentMode: "ai_generated",
    externalDetailImport: { status: "approved", signedImages },
  }), false);
  assert.equal(workbenchExternalPublicationReady({
    contentMode: "external_generated",
    externalDetailImport: { status: "approved", signedImages: signedImages.slice(0, 7) },
  }), false);
});
