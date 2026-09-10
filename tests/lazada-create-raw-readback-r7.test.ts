import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLazadaExactSellerSkuSet,
  assertLazadaMyCreateCurrentSource,
  assertLazadaMyCreateGetRecoveryReceipt,
  assertLazadaMyCreateOfficialEvidence,
  lazadaMyCreateCurrentStateContract,
  lazadaMyCreateGetRecoveryReceiptContract,
  lazadaMyCreateOfficialEvidenceContract,
  lazadaMyCreateOfficialEvidenceFromBytes,
  lazadaUtf8Sha256,
  type LazadaMyCreateCurrentSourceSnapshot,
} from "../lib/product-registration/lazada/my-create-raw-readback";

const ITEM_ID = "987654321";
const SKU_A = "SP-MY-A";
const SKU_B = "SP-MY-B";
const NAME = "SellerPilot Storage Organizer";
const DESCRIPTION = "Verified English description for the MY listing.";
const IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://my-live.slatic.net/p/r7-${index + 1}.jpg`,
);

function currentSource(
  overrides: Partial<LazadaMyCreateCurrentSourceSnapshot> = {},
): LazadaMyCreateCurrentSourceSnapshot {
  return {
    contract: lazadaMyCreateCurrentStateContract,
    productId: "71111111-1111-4111-8111-111111111111",
    productStatus: "draft",
    productDemo: false,
    productOnHand: 3,
    productUpdatedAt: "2026-09-10T00:00:00.000Z",
    listingStatus: "draft",
    listingRemoteId: null,
    listingUpdatedAt: "2026-09-10T00:00:00.000Z",
    credentialId: "61111111-1111-4111-8111-111111111111",
    credentialStatus: "active",
    credentialVersion: 1,
    ...overrides,
  };
}

function postResponse(skuList: Array<{ seller_sku: string; sku_id: string }>) {
  return JSON.stringify({
    code: "0",
    data: { item_id: ITEM_ID, sku_list: skuList },
  });
}

function itemGetResponse(input: {
  images?: string[];
  name?: string;
  description?: string;
  locale?: string;
  status?: string;
  skus?: Array<Record<string, unknown>>;
} = {}) {
  return JSON.stringify({
    code: "0",
    data: {
      item_id: ITEM_ID,
      primary_category: "10100205",
      status: input.status ?? "inactive",
      locale: input.locale ?? "ms-MY",
      images: input.images ?? IMAGES,
      attributes: {
        name: input.name ?? NAME,
        description: input.description ?? DESCRIPTION,
      },
      skus: input.skus ?? [
        { SellerSku: SKU_B, SkuId: "2", Status: "inactive" },
        { SellerSku: SKU_A, SkuId: "1", Status: "inactive" },
      ],
    },
  });
}

function officialEvidence(input: {
  skuList?: Array<{ seller_sku: string; sku_id: string }>;
  itemGet?: string;
  imageRaw?: string;
  contentRaw?: string;
  localeRaw?: string;
} = {}) {
  const itemGet = input.itemGet ?? itemGetResponse();
  return lazadaMyCreateOfficialEvidenceFromBytes({
    postRequest: {
      method: "POST",
      path: "/product/create",
      body: { sellerSkus: [SKU_A, SKU_B] },
    },
    postResponseBytes: postResponse(input.skuList ?? [
      { seller_sku: SKU_B, sku_id: "2" },
      { seller_sku: SKU_A, sku_id: "1" },
    ]),
    itemGetRequest: {
      method: "GET",
      path: "/product/item/get",
      params: { item_id: ITEM_ID },
    },
    itemGetResponseBytes: itemGet,
    imageRaw: input.imageRaw ?? JSON.stringify(IMAGES),
    contentRaw: input.contentRaw ?? `${NAME}\n${DESCRIPTION}`,
    localeRaw: input.localeRaw ?? "ms-MY",
  });
}

test("review69: CreateProduct without officialEvidence cannot complete", () => {
  assert.throws(
    () => assertLazadaMyCreateOfficialEvidence({
      evidence: {
        itemId: ITEM_ID,
        sku_list: [{ seller_sku: SKU_A, sku_id: "1" }],
      },
      expectedSellerSkus: [SKU_A],
      expectedLocale: "ms-MY",
      expectedImageUrls: IMAGES,
      expectedName: NAME,
      expectedDescription: DESCRIPTION,
    }),
    /LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED/u,
  );
});

test("review69: created SKU comparison is an exact set and ignores order", () => {
  const bound = assertLazadaMyCreateOfficialEvidence({
    evidence: officialEvidence(),
    expectedSellerSkus: [SKU_A, SKU_B],
    expectedLocale: "ms-MY",
    expectedImageUrls: IMAGES,
    expectedName: NAME,
    expectedDescription: DESCRIPTION,
  });
  assert.equal(bound.itemId, ITEM_ID);
  assert.deepEqual(
    [...bound.skuIdentities].sort((left, right) =>
      left.sellerSku.localeCompare(right.sellerSku)),
    [
      { sellerSku: SKU_A, skuId: "1" },
      { sellerSku: SKU_B, skuId: "2" },
    ],
  );

  assert.throws(
    () => assertLazadaExactSellerSkuSet({
      expected: [SKU_A, SKU_B],
      observed: [
        { sellerSku: SKU_A, skuId: "1" },
        { sellerSku: "OTHER", skuId: "2" },
      ],
    }),
    /LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID/u,
  );
});

test("review69: shape-only item readback plus fabricated status cannot complete", () => {
  const shapeOnly = JSON.stringify({
    code: "0",
    data: {
      item_id: ITEM_ID,
      status: "inactive",
      skus: [
        { SellerSku: SKU_A, SkuId: "1", Status: "inactive" },
        { SellerSku: SKU_B, SkuId: "2", Status: "inactive" },
      ],
    },
    remoteState: { verified: true },
    providerStatus: "inactive",
  });
  assert.throws(
    () => assertLazadaMyCreateOfficialEvidence({
      evidence: {
        ...officialEvidence({ itemGet: shapeOnly }),
        imageRaw: JSON.stringify(IMAGES),
        contentRaw: `${NAME}\n${DESCRIPTION}`,
        localeRaw: "ms-MY",
        remoteState: { verified: true },
        providerStatus: "FABRICATED-INACTIVE",
      },
      expectedSellerSkus: [SKU_A, SKU_B],
      expectedLocale: "ms-MY",
      expectedImageUrls: IMAGES,
      expectedName: NAME,
      expectedDescription: DESCRIPTION,
    }),
    /LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE/u,
  );
});

test("review69: current source CAS detects status/demo/stock and listing drift when updated_at is unchanged", () => {
  const claimed = currentSource();
  assert.equal(
    assertLazadaMyCreateCurrentSource({
      claimed,
      current: currentSource(),
    }).productStatus,
    "draft",
  );

  for (const drift of [
    currentSource({ productStatus: "archived" }),
    currentSource({ productDemo: true }),
    currentSource({ productOnHand: 0 }),
    currentSource({ listingStatus: "queued" }),
    currentSource({ listingRemoteId: ITEM_ID }),
  ]) {
    assert.equal(drift.productUpdatedAt, claimed.productUpdatedAt);
    assert.equal(drift.listingUpdatedAt, claimed.listingUpdatedAt);
    assert.throws(
      () => assertLazadaMyCreateCurrentSource({ claimed, current: drift }),
      /LAZADA_MY_CREATE_CURRENT_SOURCE_DRIFT/u,
    );
  }
});

test("review69: GET-only recovery cannot synthesize a CreateProduct response from /products/get", () => {
  const productsGet = JSON.stringify({
    code: "0",
    data: {
      total_products: 1,
      products: [{ item_id: ITEM_ID, skus: [{ SellerSku: SKU_A, SkuId: "1" }] }],
    },
  });
  const requestBytes = JSON.stringify({
    method: "GET",
    path: "/products/get",
    params: { filter: "all" },
  });
  assert.throws(
    () => assertLazadaMyCreateGetRecoveryReceipt({
      receipt: {
        contract: lazadaMyCreateGetRecoveryReceiptContract,
        receiptKind: "post_create",
        method: "GET",
        path: "/products/get",
        requestBytes,
        responseBytes: productsGet,
        requestSha256: lazadaUtf8Sha256(requestBytes),
        responseSha256: lazadaUtf8Sha256(productsGet),
        synthesizedCreateResponse: {
          item_id: ITEM_ID,
          sku_list: [{ seller_sku: SKU_A, sku_id: "1" }],
        },
        imageRaw: JSON.stringify(IMAGES),
        contentRaw: `${NAME}\n${DESCRIPTION}`,
        localeRaw: "ms-MY",
      },
      expectedSellerSkus: [SKU_A],
      expectedLocale: "ms-MY",
      expectedImageUrls: IMAGES,
      expectedName: NAME,
      expectedDescription: DESCRIPTION,
    }),
    /LAZADA_MY_CREATE_GET_RECOVERY_RECEIPT_REQUIRED|LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE/u,
  );

  const itemRequest = JSON.stringify({
    method: "GET",
    path: "/product/item/get",
    params: { item_id: ITEM_ID },
  });
  const itemBytes = itemGetResponse({
    skus: [{ SellerSku: SKU_A, SkuId: "1", Status: "inactive" }],
  });
  const recovered = assertLazadaMyCreateGetRecoveryReceipt({
    receipt: {
      contract: lazadaMyCreateGetRecoveryReceiptContract,
      receiptKind: "get_recovery",
      method: "GET",
      path: "/product/item/get",
      requestBytes: itemRequest,
      responseBytes: itemBytes,
      requestSha256: lazadaUtf8Sha256(itemRequest),
      responseSha256: lazadaUtf8Sha256(itemBytes),
      imageRaw: JSON.stringify(IMAGES),
      contentRaw: `${NAME}\n${DESCRIPTION}`,
      localeRaw: "ms-MY",
    },
    expectedSellerSkus: [SKU_A],
    expectedLocale: "ms-MY",
    expectedImageUrls: IMAGES,
    expectedName: NAME,
    expectedDescription: DESCRIPTION,
  });
  assert.equal(recovered.receiptKind, "get_recovery");
  assert.equal(recovered.path, "/product/item/get");
  assert.equal(recovered.contract, lazadaMyCreateGetRecoveryReceiptContract);
  assert.equal(recovered.itemId, ITEM_ID);
});

test("r7 official evidence binds raw POST and GET bytes by sha256", () => {
  const evidence = officialEvidence();
  assert.equal(evidence.contract, lazadaMyCreateOfficialEvidenceContract);
  assert.equal(evidence.receiptKind, "post_create");
  assert.equal(evidence.postRequestSha256, lazadaUtf8Sha256(evidence.postRequestBytes));
  assert.equal(evidence.postResponseSha256, lazadaUtf8Sha256(evidence.postResponseBytes));
  assert.equal(evidence.itemGetRequestSha256, lazadaUtf8Sha256(evidence.itemGetRequestBytes));
  assert.throws(
    () => assertLazadaMyCreateOfficialEvidence({
      evidence: { ...evidence, postResponseSha256: "0".repeat(64) },
      expectedSellerSkus: [SKU_A, SKU_B],
      expectedLocale: "ms-MY",
      expectedImageUrls: IMAGES,
      expectedName: NAME,
      expectedDescription: DESCRIPTION,
    }),
    /LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED/u,
  );
});
