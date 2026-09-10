import assert from "node:assert/strict";
import test from "node:test";

import { prepareShopeeSgProviderImagesOnly } from "../lib/product-registration/shopee/provider-images";
import { shopeeSgCreatePrewriteContract, shopeeSgCreatePrewriteEvidenceArgument } from "../lib/product-registration/shopee/create-prewrite-adapter";
import type { ShopeeSgRequirementRemote } from "../lib/product-registration/shopee/provider-requirements";

function remote(response: Record<string, unknown>): ShopeeSgRequirementRemote {
  return { response: { ok: true }, data: { error: "", response } };
}

function source() {
  return {
    imageUrls: Array.from({ length: 9 }, (_value, index) => {
      const digest = (index + 1).toString(16).padStart(64, "0");
      return `https://example.test/normalized/${digest.slice(0, 2)}/${digest}.jpg`;
    }),
    [shopeeSgCreatePrewriteEvidenceArgument]: {
      contract: shopeeSgCreatePrewriteContract,
      provider: { globalCategoryId: "100787", localCategoryId: "200787" },
    },
    body: { description: "Global description" },
    publish: { item: { description: "Local description" } },
  };
}

function dependencies(input: { galleryMax: number; descriptionMax?: number; events: string[] }) {
  let uploadIndex = 0;
  return {
    assertLeaseHealthy: async () => undefined,
    merchantGet: async (path: string, query: URLSearchParams) => {
      input.events.push(`merchant:${path}?${query.toString()}`);
      return remote({
        global_item_image_count_limit: { min_limit: 1, max_limit: input.galleryMax },
        extended_description_limit: { description_image_num_min: 0, description_image_num_max: input.descriptionMax ?? 8 },
      });
    },
    shopGet: async (path: string, query: URLSearchParams) => {
      input.events.push(`shop:${path}?${query.toString()}`);
      return remote({
        item_image_count_limit: { min_limit: 1, max_limit: input.galleryMax },
        extended_description_limit: { description_image_num_min: 0, description_image_num_max: input.descriptionMax ?? 8 },
      });
    },
    uploadImage: async (_url: string, scene: "normal" | "desc") => {
      input.events.push(`upload:${scene}`);
      uploadIndex += 1;
      return `image-${uploadIndex}`;
    },
  };
}

test("image-only preparation reads each category limit once and binds representative plus eight details", async () => {
  const events: string[] = [];
  const prepared = await prepareShopeeSgProviderImagesOnly({
    argumentsValue: source(),
    dependencies: dependencies({ galleryMax: 9, events }),
  });
  assert.equal(events.filter((event) => event.startsWith("merchant:")).length, 1);
  assert.equal(events.filter((event) => event.startsWith("shop:")).length, 1);
  assert.equal(events.filter((event) => event === "upload:normal").length, 9);
  assert.deepEqual(prepared.sellerpilotProviderDetailImageIds, [
    "image-2", "image-3", "image-4", "image-5",
    "image-6", "image-7", "image-8", "image-9",
  ]);
  assert.deepEqual((prepared.body.image as { image_id_list: string[] }).image_id_list,
    Array.from({ length: 9 }, (_value, index) => `image-${index + 1}`));
});

test("image-only preparation uses extended detail content without dropping approved images", async () => {
  const events: string[] = [];
  const prepared = await prepareShopeeSgProviderImagesOnly({
    argumentsValue: source(),
    dependencies: dependencies({ galleryMax: 8, events }),
  });
  assert.equal(events.filter((event) => event === "upload:normal").length, 1);
  assert.equal(events.filter((event) => event === "upload:desc").length, 8);
  assert.equal(prepared.sellerpilotProviderImageSurface, "detail_content");
  const body = prepared.body as Record<string, unknown>;
  const descriptionInfo = body.description_info as { extended_description: { field_list: Array<Record<string, unknown>> } };
  assert.equal(descriptionInfo.extended_description.field_list.filter((field) => field.field_type === "image").length, 8);
});

test("invalid category limits fail before the first provider image mutation", async () => {
  const events: string[] = [];
  await assert.rejects(prepareShopeeSgProviderImagesOnly({
    argumentsValue: source(),
    dependencies: dependencies({ galleryMax: 8, descriptionMax: 7, events }),
  }), /SHOPEE_SG_PROVIDER_DETAIL_IMAGES_UNAVAILABLE/u);
  assert.equal(events.some((event) => event.startsWith("upload:")), false);
});
