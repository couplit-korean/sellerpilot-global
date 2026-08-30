import assert from "node:assert/strict";
import test from "node:test";
import {
  planShopeeGlobalImages,
  prepareShopeeGlobalListing,
  type PrepareProviderListingInput,
  type ShopeeGlobalListingRuntimeDependencies,
} from "../lib/channels/provider-listing-runtime";
import type { RemoteResponse, SecretPayload } from "../lib/channels/protocols";

const GLOBAL_CATEGORY_ID = 100123;
const LOCAL_CATEGORY_ID = 200456;
const imageUrls = Array.from({ length: 9 }, (_, index) => `https://assets.example/image-${index + 1}.jpg`);

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  const text = JSON.stringify(data);
  return {
    response: new Response(text, { status, headers: { "content-type": "application/json" } }),
    data,
    text,
  };
}

function categoryResponse(categoryId: number, hasChildren = false) {
  return remote({
    error: "",
    response: {
      category_list: [{
        category_id: categoryId,
        parent_category_id: 100,
        display_category_name: "Cable Clips",
        has_children: hasChildren,
      }],
    },
  });
}

function attributeResponse(categoryId: number, attributeId: number, valueId: number, available = true) {
  return remote({
    error: "",
    response: {
      list: [{
        category_id: categoryId,
        attribute_tree: [{
          attribute_id: attributeId,
          name: `Required ${attributeId}`,
          mandatory: true,
          attribute_value_list: available ? [{ value_id: valueId, name: "Cable organizer" }] : [],
        }],
      }],
    },
  });
}

function limitResponse(galleryMax: number, descriptionMax = 8) {
  return remote({
    error: "",
    response: {
      global_item_image_count_limit: { min_limit: 1, max_limit: galleryMax },
      extended_description_limit: {
        description_image_num_min: 0,
        description_image_num_max: descriptionMax,
      },
    },
  });
}

function localLimitResponse(galleryMax: number, descriptionMax = 8, galleryMin = 1) {
  return remote({
    error: "",
    response: {
      item_image_count_limit: { min_limit: galleryMin, max_limit: galleryMax },
      extended_description_limit: {
        description_image_num_min: 0,
        description_image_num_max: descriptionMax,
      },
    },
  });
}

function input(): PrepareProviderListingInput {
  return {
    channel: "shopee",
    operation: "listing.create",
    credential: {
      partner_id: "1001",
      partner_key: "merchant-key",
      merchant_id: "2001",
      access_token: "merchant-access",
    },
    shopeeShopCredential: {
      partner_id: "1001",
      partner_key: "shop-key",
      shop_id: "3001",
      access_token: "shop-access",
    },
    arguments: {
      globalProduct: true,
      country: "sg",
      imageUrls,
      body: {
        category_id: GLOBAL_CATEGORY_ID,
        global_item_name: "Reusable cable organizer clips",
        description: "Keep charging cables tidy on a desk.",
        attribute_list: [{ attribute_id: 501, attribute_value_list: [{ value_id: 601 }] }],
      },
      publish: {
        shop_id: 3001,
        shop_region: "SG",
        item: {
          category_id: GLOBAL_CATEGORY_ID,
          item_name: "Reusable cable organizer clips",
          item_sku: "QA-CABLE-CLIP-SG",
          description: "Keep charging cables tidy on a desk.",
          // The current workbench copies global selections into the local item.
          // create_publish_task no longer accepts these global attribute IDs.
          attribute_list: [{ attribute_id: 501, attribute_value_list: [{ value_id: 601 }] }],
        },
      },
    },
    environment: "production",
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => undefined,
      beginProviderMutation: async () => undefined,
    },
  };
}

function dependencies(inputValue: {
  events: string[];
  galleryMax?: number;
  descriptionMax?: number;
  localGalleryMax?: number;
  localDescriptionMax?: number;
  localGalleryMin?: number;
  globalHasChildren?: boolean;
  globalAttributeAvailable?: boolean;
  activeLogistics?: boolean;
  localCategoryAvailable?: boolean;
}): ShopeeGlobalListingRuntimeDependencies {
  let uploadIndex = 0;
  return {
    shopRequest: async ({ path, query }) => {
      inputValue.events.push(`shop:${path}?${query?.toString() ?? ""}`);
      if (path.endsWith("get_channel_list")) {
        return remote({
          error: "",
          response: {
            logistics_channel_list: [
              { logistics_channel_id: 8001, enabled: inputValue.activeLogistics ?? true },
              { logistics_channel_id: 8002, enabled: false },
            ],
          },
        });
      }
      if (path.endsWith("category_recommend")) {
        return remote({
          error: "",
          response: { category_id: inputValue.localCategoryAvailable === false ? [] : [LOCAL_CATEGORY_ID] },
        });
      }
      if (path.endsWith("get_category")) return categoryResponse(LOCAL_CATEGORY_ID);
      if (path.endsWith("get_item_limit")) {
        return localLimitResponse(
          inputValue.localGalleryMax ?? inputValue.galleryMax ?? 9,
          inputValue.localDescriptionMax ?? inputValue.descriptionMax ?? 8,
          inputValue.localGalleryMin ?? 1,
        );
      }
      throw new Error(`unexpected shop request: ${path}`);
    },
    merchantRequest: async ({ path, query }) => {
      inputValue.events.push(`merchant:${path}?${query?.toString() ?? ""}`);
      if (path.endsWith("get_category")) {
        return categoryResponse(GLOBAL_CATEGORY_ID, inputValue.globalHasChildren ?? false);
      }
      if (path.endsWith("get_attribute_tree")) {
        return attributeResponse(GLOBAL_CATEGORY_ID, 501, 601, inputValue.globalAttributeAvailable ?? true);
      }
      if (path.endsWith("get_global_item_limit")) {
        return limitResponse(inputValue.galleryMax ?? 9, inputValue.descriptionMax ?? 8);
      }
      throw new Error(`unexpected merchant request: ${path}`);
    },
    uploadImage: async (
      _payload: SecretPayload,
      _environment,
      _imageUrl,
      _signal,
      _hooks,
      scene,
    ) => {
      inputValue.events.push(`upload:${scene}`);
      uploadIndex += 1;
      return `image-${uploadIndex}`;
    },
  };
}

test("Shopee global image planning uses the category-scoped gallery limit and fails closed without an eight-image detail surface", () => {
  assert.deepEqual(planShopeeGlobalImages(limitResponse(9).data, localLimitResponse(9).data), {
    providerImageSurface: "gallery",
    galleryImageCount: 9,
    descriptionImageCount: 0,
  });
  assert.deepEqual(planShopeeGlobalImages(limitResponse(9).data, localLimitResponse(8).data), {
    providerImageSurface: "detail_content",
    galleryImageCount: 8,
    descriptionImageCount: 8,
  });
  assert.throws(
    () => planShopeeGlobalImages(limitResponse(9, 8).data, localLimitResponse(8, 7).data),
    /SHOPEE_EXTENDED_DESCRIPTION_IMAGES_UNAVAILABLE/,
  );
  assert.throws(
    () => planShopeeGlobalImages(limitResponse(12).data, localLimitResponse(12, 8, 10).data),
    /SHOPEE_GLOBAL_ITEM_IMAGE_COUNT_UNSUPPORTED/,
  );
});

test("Shopee SG validates logistics, the global category/attributes, and the recommended local category before uploading representative plus eight details", async () => {
  const events: string[] = [];
  const prepared = await prepareShopeeGlobalListing(input(), dependencies({ events }));
  const firstUpload = events.findIndex((event) => event.startsWith("upload:"));
  assert.equal(firstUpload, 7);
  assert.equal(events.slice(0, firstUpload).every((event) => !event.startsWith("upload:")), true);
  assert.equal(events.some((event) => event.includes(`global_product/get_attribute_tree?category_id_list=${GLOBAL_CATEGORY_ID}`)), true);
  assert.equal(events.some((event) => event.includes("product/category_recommend?item_name=Reusable+cable+organizer+clips")), true);
  assert.equal(events.some((event) => event.includes(`global_product/get_global_item_limit?category_id=${GLOBAL_CATEGORY_ID}`)), true);
  assert.equal(events.some((event) => event.includes(`product/get_item_limit?category_id=${LOCAL_CATEGORY_ID}`)), true);
  assert.equal(events.filter((event) => event === "upload:normal").length, 9);

  const body = prepared.body as Record<string, unknown>;
  const bodyImage = body.image as { image_id_list: string[] };
  assert.equal(bodyImage.image_id_list.length, 9);
  assert.deepEqual(body.attribute_list, [{ attribute_id: 501, attribute_value_list: [{ value_id: 601 }] }]);
  const publish = prepared.publish as Record<string, unknown>;
  const item = publish.item as Record<string, unknown>;
  assert.deepEqual(item.logistic, [{ logistic_id: 8001, enabled: true }]);
  assert.equal(item.category_id, undefined, "create_publish_task removed category_id from its supported item schema");
  assert.equal(item.attribute_list, undefined, "global attribute IDs must not leak into the local publish item");
  assert.equal(item.item_sku, undefined, "undocumented local fields must not be sent");
  assert.equal(body.category_id, GLOBAL_CATEGORY_ID);
  assert.equal(prepared.sellerpilotProviderLocalCategoryId, LOCAL_CATEGORY_ID);
  assert.equal(prepared.sellerpilotProviderImageSurface, "gallery");
  assert.deepEqual(
    prepared.sellerpilotProviderDetailImageIds,
    Array.from({ length: 8 }, (_, index) => `image-${index + 2}`),
  );
});

test("Shopee SG falls back to buyer-visible extended description without dropping any approved detail image", async () => {
  const events: string[] = [];
  const prepared = await prepareShopeeGlobalListing(input(), dependencies({ events, galleryMax: 8 }));
  assert.equal(events.filter((event) => event === "upload:normal").length, 1);
  assert.equal(events.filter((event) => event === "upload:desc").length, 8);
  assert.equal(prepared.sellerpilotProviderImageSurface, "detail_content");

  const body = prepared.body as Record<string, unknown>;
  assert.equal((body.image as { image_id_list: string[] }).image_id_list.length, 8);
  assert.equal(body.description_type, "extended");
  const fields = ((body.description_info as {
    extended_description: { field_list: Array<Record<string, unknown>> };
  }).extended_description.field_list);
  assert.equal(fields.filter((field) => field.field_type === "image").length, 8);
  assert.deepEqual(
    fields.filter((field) => field.field_type === "image")
      .map((field) => (field.image_info as { image_id: string }).image_id),
    Array.from({ length: 8 }, (_, index) => `image-${index + 2}`),
  );
});

test("Shopee SG provider-preflight failure occurs before any image mutation", async () => {
  for (const { options, error } of [
    { options: { activeLogistics: false }, error: /SHOPEE_LOGISTICS_MISSING/ },
    { options: { globalHasChildren: true }, error: /SHOPEE_GLOBAL_CATEGORY_INVALID/ },
    { options: { localCategoryAvailable: false }, error: /SHOPEE_LOCAL_CATEGORY_RECOMMENDATION_INVALID/ },
    { options: { localGalleryMax: 8, localDescriptionMax: 7 }, error: /SHOPEE_EXTENDED_DESCRIPTION_IMAGES_UNAVAILABLE/ },
  ]) {
    const events: string[] = [];
    await assert.rejects(
      prepareShopeeGlobalListing(input(), dependencies({ events, ...options })),
      error,
    );
    assert.equal(events.some((event) => event.startsWith("upload:")), false);
  }

  const invalidAttributeInput = input();
  const invalidBody = invalidAttributeInput.arguments.body as Record<string, unknown>;
  invalidBody.attribute_list = [{ attribute_id: 501, attribute_value_list: [{ value_id: 999 }] }];
  const attributeEvents: string[] = [];
  await assert.rejects(
    prepareShopeeGlobalListing(
      invalidAttributeInput,
      dependencies({ events: attributeEvents, globalAttributeAvailable: false }),
    ),
    /SHOPEE_GLOBAL_REQUIRED_ATTRIBUTES_MISSING/,
  );
  assert.equal(attributeEvents.some((event) => event.startsWith("upload:")), false);
});
