import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  makeProductDetailPersistable,
  parsePersistedProductDetailPage,
  resolveProductDetailAssets,
} from "../app/_publishing/product-detail-persistence";

const data = {
  root: {},
  content: [
    { type: "HeroBlock", props: { id: "hero", imageUrl: "https://signed.example/old-hero", title: "상품" } },
    { type: "StoryBlock", props: { id: "story", body: "설명" } },
    { type: "ImageStoryBlock", props: { id: "external", imageUrl: "https://merchant.example/manual.jpg" } },
  ],
};

test("Puck persistence stores stable asset identities instead of expiring signed URLs", () => {
  const persisted = makeProductDetailPersistable(data, { hero: "https://signed.example/old-hero" });
  assert.equal(persisted.content[0]?.props.imageUrl, "sellerpilot-asset://hero");
  assert.equal(persisted.content[2]?.props.imageUrl, "https://merchant.example/manual.jpg");
  assert.equal(data.content[0]?.props.imageUrl, "https://signed.example/old-hero", "input must stay immutable");

  const rendered = resolveProductDetailAssets(persisted, { hero: "https://signed.example/fresh-hero" });
  assert.equal(rendered.content[0]?.props.imageUrl, "https://signed.example/fresh-hero");
  assert.equal(rendered.content[2]?.props.imageUrl, "https://merchant.example/manual.jpg");
});

test("missing private assets render empty instead of retaining an expired private URL", () => {
  const rendered = resolveProductDetailAssets({
    root: {},
    content: [{ type: "HeroBlock", props: { id: "hero", imageUrl: "sellerpilot-asset://hero" } }],
  }, {});
  assert.equal(rendered.content[0]?.props.imageUrl, "");
});

test("persisted Puck envelopes require an optimistic version and valid root/content shape", () => {
  assert.equal(parsePersistedProductDetailPage({ data, version: 2, updatedAt: "2026-08-26T00:00:00Z" })?.version, 2);
  assert.equal(parsePersistedProductDetailPage({ data, version: 0 }), null);
  assert.equal(parsePersistedProductDetailPage({ data: { root: {}, content: "bad" }, version: 1 }), null);
});

test("studio, product detail, API and DB persistence stay connected by the same version fence", async () => {
  const [studio, savedPage, route] = await Promise.all([
    readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/saved-product-detail-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/products/[id]/publish-context/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(studio, /makeProductDetailPersistable/);
  assert.match(studio, /expectedVersion: detailPageVersion/);
  assert.match(savedPage, /DETAIL_PAGE_VERSION_CONFLICT/);
  assert.match(savedPage, /expectedVersion: detailPage\?\.version \?\? null/);
  assert.match(route, /maximumDetailPagePayloadBytes = 256 \* 1024/);
  assert.match(route, /sellerpilot_save_product_detail_page/);
  assert.match(route, /p_expected_version/);
});
