import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  buildCoupangMarketplaceContents,
  collectBoundedMarketplaceImage,
  downloadMarketplaceImage,
  isPrivateMarketplaceAddress,
  normalizeMarketplaceImageBytes,
  prepareMarketplaceImages,
  renderMarketplaceDetailImages,
  renderQoo10DetailDescription,
} from "../lib/channels/marketplace-images";

test("marketplace image guard rejects private targets and stops oversized streams", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "192.168.0.1",
    "::1",
    "fc00::1",
    "ff02::1",
    "::ffff:7f00:1",
    "::ffff:a00:1",
    "::ffff:a9fe:a9fe",
    "::ffff:c0a8:1",
    "64:ff9b::a9fe:a9fe",
  ]) {
    assert.equal(isPrivateMarketplaceAddress(address), true, address);
  }
  assert.equal(isPrivateMarketplaceAddress("1.1.1.1"), false);
  assert.equal(isPrivateMarketplaceAddress("::ffff:101:101"), false);
  await assert.rejects(
    downloadMarketplaceImage("https://[::ffff:7f00:1]/private.png"),
    /MARKETPLACE_IMAGE_URL_PRIVATE/,
  );
  async function* oversized() {
    yield new Uint8Array(6);
    yield new Uint8Array(6);
  }
  await assert.rejects(collectBoundedMarketplaceImage(oversized(), 10), /MARKETPLACE_IMAGE_SIZE_INVALID/);
});

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

test("legacy jobs without eight dedicated detail images are blocked before a channel write", async () => {
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

test("eight images without classification and eight localized evidence sections are blocked before a channel write", async () => {
  const argumentsValue = {
    sellerpilotAssets: {
      galleryImageUrls: ["https://cdn.example.com/thumbnail.jpg"],
      detailImageUrls: Array.from({ length: 8 }, (_, index) => `https://cdn.example.com/detail-${index}.jpg`),
      detailAssetMode: "dedicated",
      localizedDetailSections: [],
    },
    params: { StandardImage: "https://cdn.example.com/thumbnail.jpg" },
  };
  await assert.rejects(
    prepareMarketplaceImages({} as SupabaseClient, "qoo10", argumentsValue),
    /MARKETPLACE_DETAIL_IMAGE_REQUIRED/,
  );
});

test("listing writes require server-validated classification, allowed section contracts and aligned SEO metadata", async () => {
  const imageRoles = [
    "detail-overview",
    "detail-feature",
    "detail-use",
    "detail-package",
    "detail-routine",
    "detail-contents",
    "detail-care",
    "detail-material",
  ];
  const sectionTypes = ["overview", "feature", "howto", "spec", "routine", "contents", "care", "proof"];
  const localizedDetailSections = imageRoles.map((imageAsset, index) => ({
    imageAsset,
    type: sectionTypes[index],
    heading: `Verified heading ${index}`,
    body: `Verified localized body ${index} contains enough factual product information for the marketplace detail contract.`,
    buyerQuestion: `Buyer question ${index}?`,
    evidence: `Seller-provided evidence ${index}`,
    imageAltText: `Verified product evidence image ${index}`,
  }));
  const completeAssets = {
    galleryImageUrls: ["https://cdn.example.com/thumbnail.jpg"],
    detailImageUrls: imageRoles.map((_, index) => `https://cdn.example.com/detail-${index}.jpg`),
    detailImageRoles: imageRoles,
    detailImageAltTexts: localizedDetailSections.map((section) => section.imageAltText),
    detailAssetMode: "dedicated",
    classification: {
      displayName: "Verified general product",
      verificationStatus: "verified",
      evidence: "Seller-provided package label",
      isHealthFunctionalFood: false,
    },
    localizedDetailSections,
  };

  await assert.rejects(
    prepareMarketplaceImages({} as SupabaseClient, "qoo10", { params: { StandardImage: "not-a-url" } }),
    /MARKETPLACE_DETAIL_IMAGE_REQUIRED/,
  );
  await assert.rejects(
    prepareMarketplaceImages({} as SupabaseClient, "qoo10", {
      sellerpilotAssets: {
        ...completeAssets,
        detailImageRoles: imageRoles.map((_, index) => `invented-role-${index}`),
        localizedDetailSections: localizedDetailSections.map((section, index) => ({
          ...section,
          imageAsset: `invented-role-${index}`,
          type: `invented-type-${index}`,
          heading: "",
          body: "",
          buyerQuestion: "",
          evidence: "",
          imageAltText: "",
        })),
      },
      params: { StandardImage: "not-a-url" },
    }),
    /MARKETPLACE_DETAIL_IMAGE_REQUIRED/,
  );
  await assert.rejects(
    prepareMarketplaceImages({} as SupabaseClient, "qoo10", {
      sellerpilotAssets: {
        ...completeAssets,
        detailImageAltTexts: [...completeAssets.detailImageAltTexts].reverse(),
      },
      params: { StandardImage: "not-a-url" },
    }),
    /MARKETPLACE_DETAIL_IMAGE_REQUIRED/,
  );

  const reorderedRoles = [...imageRoles].reverse();
  const sectionByRole = new Map(localizedDetailSections.map((section) => [section.imageAsset, section]));
  await assert.rejects(
    prepareMarketplaceImages({} as SupabaseClient, "qoo10", {
      sellerpilotAssets: {
        ...completeAssets,
        galleryImageUrls: ["not-a-url"],
        detailImageUrls: reorderedRoles.map((_, index) => `not-a-url-${index}`),
        detailImageRoles: reorderedRoles,
        detailImageAltTexts: reorderedRoles.map((role) => sectionByRole.get(role)?.imageAltText),
      },
      params: { StandardImage: "not-a-url" },
    }),
    /MARKETPLACE_IMAGE_URL_INVALID/,
  );
});

test("Coupang content preserves manual text and carries classification, questions, evidence, and all images", () => {
  const roles = Array.from({ length: 8 }, (_, index) => `detail-role-${index}`);
  const sections = roles.map((imageAsset, index) => ({
    imageAsset,
    type: `type-${index}`,
    heading: `Heading ${index}`,
    body: `Body ${index}`,
    buyerQuestion: `Question ${index}`,
    evidence: `Evidence ${index}`,
  }));
  const images = roles.map((_, index) => `https://cdn.example.com/detail-${index}.jpg`);
  const contents = buildCoupangMarketplaceContents(
    [{ contentsType: "TEXT", contentDetails: [{ content: "Merchant-authored introduction", detailType: "TEXT" }] }],
    sections,
    { displayName: "Verified general food", verificationStatus: "verified", evidence: "Seller label" },
    images,
    roles,
  );
  const serialized = JSON.stringify(contents);
  assert.match(serialized, /Merchant-authored introduction/);
  assert.match(serialized, /Verified general food/);
  assert.match(serialized, /Question 0/);
  assert.match(serialized, /Evidence 7/);
  assert.equal(images.filter((url) => serialized.includes(url)).length, 8);
});

test("gallery normalization is square while detail normalization preserves the source ratio", async () => {
  const source = await sharp({
    create: {
      width: 900,
      height: 1500,
      channels: 3,
      background: { r: 232, g: 218, b: 198 },
    },
  }).jpeg().toBuffer();

  const gallery = await normalizeMarketplaceImageBytes(source, "gallery-square");
  const detail = await normalizeMarketplaceImageBytes(source, "detail-ratio");
  const galleryMetadata = await sharp(gallery).metadata();
  const detailMetadata = await sharp(detail).metadata();

  assert.deepEqual([galleryMetadata.width, galleryMetadata.height], [1200, 1200]);
  assert.deepEqual([detailMetadata.width, detailMetadata.height], [900, 1500]);
});
