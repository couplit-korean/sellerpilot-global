import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  buildCoupangMarketplaceContents,
  buildListingPublicationAssetBinding,
  collectBoundedMarketplaceImage,
  downloadMarketplaceImage,
  isPrivateMarketplaceAddress,
  normalizeMarketplaceImageBytes,
  persistMarketplaceNormalizedAssets,
  prepareMarketplaceImages,
  resolveMarketplaceImageAddresses,
  renderMarketplaceDetailImages,
  renderQoo10DetailDescription,
  upsertMarketplaceDetailImages,
} from "../lib/channels/marketplace-images";
import {
  listingPublicationProviderAssetEvidence,
  parseListingPublicationAssetBinding,
  verifyListingPublicationContent,
} from "../lib/channels/listing-publication-content";

test("server-derived publication binding preserves approved detail lineage and Shopee's buyer-visible eight-image contract", () => {
  const roles = [
    "detail-overview", "detail-context", "detail-package", "detail-feature",
    "detail-contents", "detail-use", "detail-care", "detail-routine",
  ];
  const detailUrls = roles.map((_, index) => {
    const digest = String(index + 1).padStart(64, "0");
    return `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`;
  });
  const galleryDigest = "f".repeat(64);
  const galleryUrl = `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/ff/${galleryDigest}.jpg`;
  const approvedPaths = roles.map((role) =>
    `results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/${role}.png`);
  const approvedSourceSha256s = roles.map((_, index) => (index + 17).toString(16).padStart(64, "0"));
  const detailBinding = buildListingPublicationAssetBinding({
    approvedDetailPageVersion: 3,
    approvedManifestDigest: "a".repeat(64),
    approvedDetailRoles: roles,
    approvedDetailImagePaths: approvedPaths,
    approvedDetailImageSha256s: approvedSourceSha256s,
    approvedDetailImageUrls: detailUrls,
    providerImageSurface: "detail_content",
    providerTransportRoles: roles,
    providerTransportUrls: detailUrls,
  });
  assert.equal(detailBinding?.approvedDetailImages.length, 8);
  assert.deepEqual(detailBinding?.approvedDetailImages.map((image) => image.approvedObjectPath), approvedPaths);
  assert.deepEqual(detailBinding?.providerTransportImages.map((image) => image.publicUrl), detailUrls);

  const shopeeBinding = buildListingPublicationAssetBinding({
    approvedDetailPageVersion: 3,
    approvedManifestDigest: "a".repeat(64),
    approvedDetailRoles: roles,
    approvedDetailImagePaths: approvedPaths,
    approvedDetailImageSha256s: approvedSourceSha256s,
    approvedDetailImageUrls: detailUrls,
    providerImageSurface: "gallery",
    providerTransportRoles: ["gallery-representative", ...roles.slice(0, 7)],
    providerTransportUrls: [galleryUrl, ...detailUrls.slice(0, 7)],
  });
  assert.equal(shopeeBinding?.providerImageSurface, "gallery");
  assert.deepEqual(shopeeBinding?.providerTransportImages.map((image) => image.role), [
    "gallery-representative", ...roles.slice(0, 7),
  ]);
  assert.equal(shopeeBinding?.approvedDetailImages.length, 8);
  assert.equal(shopeeBinding?.providerTransportImages.length, 8);

  const smartstoreBinding = buildListingPublicationAssetBinding({
    approvedDetailPageVersion: 3,
    approvedManifestDigest: "a".repeat(64),
    approvedDetailRoles: roles,
    approvedDetailImagePaths: approvedPaths,
    approvedDetailImageSha256s: approvedSourceSha256s,
    approvedDetailImageUrls: detailUrls,
    providerImageSurface: "gallery",
    providerTransportRoles: ["gallery-representative", ...roles],
    providerTransportUrls: [galleryUrl, ...detailUrls],
  });
  assert.equal(smartstoreBinding?.providerImageSurface, "gallery");
  assert.equal(smartstoreBinding?.providerTransportImages.length, 9);
  assert.deepEqual(
    smartstoreBinding?.providerTransportImages.slice(1).map((image) => image.publicUrl),
    detailUrls,
  );
  assert.equal(
    parseListingPublicationAssetBinding(smartstoreBinding)?.providerTransportImages.length,
    9,
  );

  const shopeeBuyerVisibleBinding = buildListingPublicationAssetBinding({
    approvedDetailPageVersion: 3,
    approvedManifestDigest: "a".repeat(64),
    approvedDetailRoles: roles,
    approvedDetailImagePaths: approvedPaths,
    approvedDetailImageSha256s: approvedSourceSha256s,
    approvedDetailImageUrls: detailUrls,
    providerImageSurface: "buyer_visible",
    providerTransportRoles: roles,
    providerTransportUrls: detailUrls,
  });
  assert.equal(shopeeBuyerVisibleBinding?.providerImageSurface, "buyer_visible");
  assert.deepEqual(
    shopeeBuyerVisibleBinding?.providerTransportImages.map((image) => image.publicUrl),
    detailUrls,
  );
  const providerDetailIds = roles.map((_, index) => `provider-detail-${index + 1}`);
  const sourceArguments = {
    sellerpilotPublicationAssetBinding: shopeeBuyerVisibleBinding,
    imageUrls: [galleryUrl, ...detailUrls],
    publish: {
      item: {
        item_name: "Reusable cable organizer clips",
        description: "Keep charging cables tidy and easy to reach on a desk.",
        image: { image_id_list: [] },
      },
    },
  };
  const providerEvidence = listingPublicationProviderAssetEvidence({
    channel: "shopee",
    remoteId: "9001",
    sourceArguments,
    providerArguments: {
      sellerpilotProviderImageSurface: "gallery",
      sellerpilotProviderDetailImageIds: providerDetailIds,
      publish: {
        item: {
          item_name: "Reusable cable organizer clips",
          description: "Keep charging cables tidy and easy to reach on a desk.",
          image: { image_id_list: ["provider-representative", ...providerDetailIds] },
        },
      },
    },
  });
  assert.equal(providerEvidence?.providerImageSurface, "gallery");
  assert.deepEqual(providerEvidence?.providerDetailImageIdentities, providerDetailIds);
  assert.match(providerEvidence?.sourceAssetBindingDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(providerEvidence?.providerRepresentativeImageIdentity, "provider-representative");
  assert.match(providerEvidence?.sourceRepresentativeImageDigest ?? "", /^[a-f0-9]{64}$/u);

  const remotePayload = (representative: string) => ({
    response: {
      item_list: [{
        item_id: 9001,
        item_name: "Reusable cable organizer clips",
        description: "Keep charging cables tidy and easy to reach on a desk.",
        image: { image_id_list: [representative, ...providerDetailIds] },
      }],
    },
  });
  const verificationInput = {
    channel: "shopee" as const,
    expectedLocale: "en-SG",
    expectedImageCount: 8,
    remoteId: "9001",
    sourceArguments,
    sourceResponsePayload: {
      remoteState: {
        evidence: { publicationAssetBinding: providerEvidence },
        resources: { localItemId: "9001" },
      },
    },
    sourceRemotePayload: remotePayload("provider-representative"),
    remoteResources: { localItemId: "9001" },
  };
  assert.equal(verifyListingPublicationContent({
    ...verificationInput,
    remotePayload: remotePayload("provider-representative"),
  }).verified, true);
  const representativeTamper = verifyListingPublicationContent({
    ...verificationInput,
    remotePayload: remotePayload("provider-representative-attacker"),
  });
  assert.equal(representativeTamper.verified, false);
  assert.equal(representativeTamper.representativeImageVerified, false);
  assert.ok(representativeTamper.mismatchFields.includes("representativeImage"));
});

test("marketplace DNS resolution stops at the caller deadline", async () => {
  const controller = new AbortController();
  const pending = resolveMarketplaceImageAddresses(
    "images.example.com",
    controller.signal,
    () => new Promise(() => undefined),
  );
  controller.abort(new Error("deadline"));
  await assert.rejects(pending, /deadline/);
});

test("marketplace image download retries the next vetted public address after a transport timeout", async () => {
  const requestedAddresses: string[] = [];
  const result = await downloadMarketplaceImage(
    "https://images.example.com/product.png",
    undefined,
    async () => [
      { address: "203.0.113.10", family: 4 },
      { address: "198.51.100.20", family: 4 },
    ],
    async (target, _signal, timeoutMs) => {
      requestedAddresses.push(target.address);
      assert.equal(timeoutMs, 10_000);
      if (target.address === "203.0.113.10") {
        throw new DOMException("edge timed out", "TimeoutError");
      }
      return { bytes: Buffer.from("verified-image"), contentType: "image/png" };
    },
  );
  assert.deepEqual(requestedAddresses, ["203.0.113.10", "198.51.100.20"]);
  assert.equal(result.bytes.toString("utf8"), "verified-image");
  assert.equal(result.contentType, "image/png");
});

test("marketplace image download does not retry an oversized response on another address", async () => {
  const requestedAddresses: string[] = [];
  await assert.rejects(
    downloadMarketplaceImage(
      "https://images.example.com/product.png",
      undefined,
      async () => [
        { address: "203.0.113.10", family: 4 },
        { address: "198.51.100.20", family: 4 },
      ],
      async (target) => {
        requestedAddresses.push(target.address);
        throw new Error("MARKETPLACE_IMAGE_SIZE_INVALID");
      },
    ),
    /MARKETPLACE_IMAGE_SIZE_INVALID/,
  );
  assert.deepEqual(requestedAddresses, ["203.0.113.10"]);
});

test("normalized marketplace assets are reserved before upload and marked only after readback", async () => {
  const events: string[] = [];
  const bytes = [Buffer.from("image-0"), Buffer.from("image-1")];
  const digests = bytes.map((value) => createHash("sha256").update(value).digest("hex"));
  const paths = digests.map((digest) => `normalized/${digest.slice(0, 2)}/${digest}.jpg`);
  const serviceClient = {
    rpc: async (name: string, argumentsValue: Record<string, unknown>) => {
      events.push(`rpc:${name}`);
      if (name === "sellerpilot_service_register_marketplace_normalized_asset_refs") {
        assert.deepEqual(argumentsValue.p_paths, paths);
      }
      if (name === "sellerpilot_service_bind_marketplace_normalized_asset_urls") {
        assert.deepEqual(argumentsValue.p_assets, paths.map((objectPath) => ({
          objectPath,
          contentSha256: objectPath.match(/([0-9a-f]{64})\.jpg$/u)?.[1],
          publicUrl: `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
        })));
      }
      return { data: true, error: null };
    },
    storage: {
      getBucket: async () => ({
        data: { public: true, file_size_limit: 3 * 1024 * 1024 },
        error: null,
      }),
      from: () => ({
        upload: async (path: string, _bytes: unknown, options: { upsert?: boolean }) => {
          assert.equal(options.upsert, false);
          events.push(`upload:${path}`);
          return { data: { path }, error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    events.push(`readback:${String(input)}`);
    const digest = String(input).match(/([0-9a-f]{64})\.jpg$/u)?.[1];
    const index = digests.indexOf(digest ?? "");
    return new Response(bytes[index] ?? Buffer.from("wrong"), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };
  try {
    await persistMarketplaceNormalizedAssets(serviceClient, "qoo10", {
      attemptId: "11111111-1111-4111-8111-111111111111",
      productId: "22222222-2222-4222-8222-222222222222",
      market: "JP",
      targetId: "shop-1",
    }, paths.map((objectPath, index) => ({
      objectPath,
      bytes: bytes[index],
      publicUrl: `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
    })));
  } finally {
    globalThis.fetch = originalFetch;
  }

  const registerIndex = events.indexOf("rpc:sellerpilot_service_register_marketplace_normalized_asset_refs");
  const firstUploadIndex = events.findIndex((event) => event.startsWith("upload:"));
  const markIndex = events.indexOf("rpc:sellerpilot_service_mark_marketplace_normalized_assets_uploaded");
  const bindIndex = events.indexOf("rpc:sellerpilot_service_bind_marketplace_normalized_asset_urls");
  const lastReadbackIndex = events.reduce((latest, event, index) => event.startsWith("readback:") ? index : latest, -1);
  assert.ok(registerIndex >= 0 && registerIndex < firstUploadIndex);
  assert.ok(lastReadbackIndex >= firstUploadIndex && lastReadbackIndex < markIndex);
  assert.ok(markIndex >= 0 && markIndex < bindIndex);
});

test("normalized Storage readback must hash to the content-addressed object path", async () => {
  const bytes = Buffer.from("expected-normalized-jpeg");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const objectPath = `normalized/${digest.slice(0, 2)}/${digest}.jpg`;
  const rpcCalls: string[] = [];
  const serviceClient = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return { data: true, error: null };
    },
    storage: {
      getBucket: async () => ({
        data: { public: true, file_size_limit: 3 * 1024 * 1024 },
        error: null,
      }),
      from: () => ({
        upload: async () => ({ data: { path: objectPath }, error: null }),
      }),
    },
  } as unknown as SupabaseClient;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from("wrong-storage-bytes"), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
  try {
    await assert.rejects(
      persistMarketplaceNormalizedAssets(serviceClient, "qoo10", {
        attemptId: "11111111-1111-4111-8111-111111111111",
        productId: "22222222-2222-4222-8222-222222222222",
        market: "JP",
        targetId: "shop-1",
      }, [{
        objectPath,
        bytes,
        publicUrl: `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
      }]),
      /MARKETPLACE_IMAGE_READBACK_DIGEST_MISMATCH/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(rpcCalls, [
    "sellerpilot_service_register_marketplace_normalized_asset_refs",
  ]);
});

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

test("marketplace detail image upsert replaces its generated section instead of duplicating it", () => {
  const urls = ["https://cdn.example.com/detail-1.jpg", "https://cdn.example.com/detail-2.jpg"];
  const once = upsertMarketplaceDetailImages("<p>Merchant detail</p>", urls, ["One", "Two"], []);
  const twice = upsertMarketplaceDetailImages(once, urls, ["One", "Two"], []);
  assert.equal(twice, once);
  assert.equal((twice.match(/data-sellerpilot-detail-images="true"/g) ?? []).length, 1);
  assert.equal((twice.match(/<img /g) ?? []).length, 2);
});

test("11st title-only update does not require or mutate marketplace image assets", async () => {
  const product = {
    prdNm: "수정 상품",
    prdImage01: "https://cdn.example.com/existing.jpg",
    htmlDetail: '<p>Existing detail</p><section data-sellerpilot-detail-images="true"><img src="https://cdn.example.com/existing-detail.jpg" /></section>',
  };
  const prepared = await prepareMarketplaceImages({} as SupabaseClient, "elevenst", {
    sellerpilotAssets: { intentionallyInvalidForMediaWrite: true },
    product: structuredClone(product),
    productPatch: { prdNm: "수정 상품" },
    productNo: "123456789",
    sellerpilotSnapshotMutableFingerprint: "a".repeat(64),
  });
  assert.deepEqual(prepared, {
    product,
    productPatch: { prdNm: "수정 상품" },
    productNo: "123456789",
    sellerpilotSnapshotMutableFingerprint: "a".repeat(64),
  });
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
