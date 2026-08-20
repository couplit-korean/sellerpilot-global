import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareMarketplaceImages, renderMarketplaceDetailImages, renderQoo10DetailDescription } from "../lib/channels/marketplace-images";

test("marketplace detail markup renders every verified panel with safe public URLs", () => {
  const urls = [
    "https://cdn.example.com/detail-1.jpg?a=1&b=2",
    "https://cdn.example.com/detail-2.jpg",
    "https://cdn.example.com/detail-3.jpg",
    "https://cdn.example.com/detail-4.jpg",
  ];
  const html = renderMarketplaceDetailImages(urls, ["Overview & package", "Feature", "Use", "Package"]);

  assert.equal((html.match(/<img /g) ?? []).length, 4);
  assert.match(html, /data-sellerpilot-detail-images="true"/);
  assert.match(html, /a=1&amp;b=2/);
  assert.match(html, /alt="Overview &amp; package"/);
});

test("Qoo10 detail markup uses conservative div and image tags", () => {
  const html = renderQoo10DetailDescription("<section><dl><dt>Material</dt><dd>Paper</dd></dl></section>", [
    "https://cdn.example.com/detail-1.jpg",
    "https://cdn.example.com/detail-2.jpg",
    "https://cdn.example.com/detail-3.jpg",
    "https://cdn.example.com/detail-4.jpg",
  ]);
  assert.equal((html.match(/<img /g) ?? []).length, 4);
  assert.doesNotMatch(html, /<\/?section|<\/?dl|<\/?dt|<\/?dd/i);
  assert.match(html, /<div align="center"/);
});

test("Qoo10 detail markup inserts localized images at learned section positions", () => {
  const html = renderQoo10DetailDescription(
    "<section><h2>Overview</h2>{{SELLERPILOT_IMAGE:detail-overview}}<h2>Use</h2>{{SELLERPILOT_IMAGE:detail-use}}</section>",
    ["https://cdn.example.com/overview.jpg", "https://cdn.example.com/use.jpg"],
    ["Product overview", "Product use context"],
    ["detail-overview", "detail-use"],
  );
  assert.match(html, /Overview<\/h2><img src="https:\/\/cdn\.example\.com\/overview\.jpg" alt="Product overview"/);
  assert.match(html, /Use<\/h2><img src="https:\/\/cdn\.example\.com\/use\.jpg" alt="Product use context"/);
  assert.doesNotMatch(html, /SELLERPILOT_IMAGE/);
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
