import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareMarketplaceImages, renderMarketplaceDetailImages } from "../lib/channels/marketplace-images";

test("marketplace detail markup renders every verified panel with safe public URLs", () => {
  const urls = [
    "https://cdn.example.com/detail-1.jpg?a=1&b=2",
    "https://cdn.example.com/detail-2.jpg",
    "https://cdn.example.com/detail-3.jpg",
    "https://cdn.example.com/detail-4.jpg",
  ];
  const html = renderMarketplaceDetailImages(urls);

  assert.equal((html.match(/<img /g) ?? []).length, 4);
  assert.match(html, /data-sellerpilot-detail-images="true"/);
  assert.match(html, /a=1&amp;b=2/);
});

test("legacy jobs without four dedicated detail images are blocked before a channel write", async () => {
  const argumentsValue = {
    sellerpilotAssets: {
      galleryImageUrls: ["https://cdn.example.com/thumbnail.jpg"],
      detailImageUrls: [
        "https://cdn.example.com/portrait.jpg",
        "https://cdn.example.com/wide.jpg",
        "https://cdn.example.com/hero.jpg",
      ],
      detailAssetMode: "legacy_fallback",
    },
    params: { StandardImage: "https://cdn.example.com/thumbnail.jpg" },
  };

  await assert.rejects(
    prepareMarketplaceImages({} as SupabaseClient, "qoo10", argumentsValue),
    /MARKETPLACE_DETAIL_IMAGE_REQUIRED/,
  );
});
