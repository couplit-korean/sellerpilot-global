import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import {
  canonicalProductDetailImageManifestInput,
  defaultProductDetailImageRoles,
  inspectProductDetailImageDocument,
  localizedProductDetailImageRoles,
  productDetailAssetReferencePrefix,
  productDetailImageManifestContract,
  type ProductDetailImageManifestEntry,
} from "../lib/product-detail-image-manifest";
import {
  approvedProductDetailManifestFromPublishContext,
  bindMarketplaceArgumentsToApprovedDetailManifest,
  marketplaceArgumentsForApprovedDetailFingerprint,
} from "../lib/server-product-detail-manifest";

const jobId = "12345678-1234-4234-8234-1234567890ab";
const claimId = "abcdefab-cdef-4def-8def-abcdefabcdef";
const generatedImagePaths = Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [
  asset.id,
  `results/${jobId}/claims/${claimId}/${asset.file}`,
]));
const manifestImages: ProductDetailImageManifestEntry[] = defaultProductDetailImageRoles.map((role, index) => ({
  role,
  path: generatedImagePaths[role],
  sourceSha256: (index + 1).toString(16).padStart(64, "0"),
}));
const manifestDigest = createHash("sha256")
  .update(canonicalProductDetailImageManifestInput(manifestImages), "utf8")
  .digest("hex");

function exactEightDocument() {
  return {
    root: {},
    content: [
      { type: "HeroBlock", props: { id: "hero", imageUrl: `${productDetailAssetReferencePrefix}hero` } },
      ...defaultProductDetailImageRoles.map((role, index) => ({
        type: "ImageStoryBlock",
        props: {
          id: `detail-${index}`,
          imageUrl: `${productDetailAssetReferencePrefix}${role}`,
          imageRole: role,
          imageAlt: `상품 상세 이미지 ${index + 1}`,
        },
      })),
    ],
  };
}

function approvedContext() {
  return {
    generatedImagePaths: { ...generatedImagePaths },
    detailPage: {
      version: 4,
      approvedVersion: 4,
      data: exactEightDocument(),
      imageManifest: {
        contract: productDetailImageManifestContract,
        algorithm: "sha256",
        digest: manifestDigest,
        images: manifestImages.map((image) => ({ ...image })),
      },
    },
  };
}

test("detail-page document accepts exactly eight distinct detail-role references and excludes the hero", () => {
  const inspected = inspectProductDetailImageDocument(exactEightDocument());
  assert.equal(inspected.ok, true);
  if (!inspected.ok) return;
  assert.deepEqual(inspected.images.map((image) => image.role), defaultProductDetailImageRoles);
  assert.equal(inspected.images.length, 8);
});

test("approved Studio copy comes from the saved document and replaces forged client copy", () => {
  const context = approvedContext();
  Object.assign(context.detailPage.data.content[1]!.props, {
    title: "제조원과 원재료명",
    body: "제조원: 대경사과원예농협음료가공공장(F3). 원재료명: 정제수, 탄산가스.",
  });
  const approved = approvedProductDetailManifestFromPublishContext(context);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const input = { sellerpilotAssets: {
    approvedStudioDetailHtml: "FORGED_CLIENT_COPY",
    localizedDetailSections: defaultProductDetailImageRoles.map(imageAsset => ({ imageAsset })),
  } };
  const urls = defaultProductDetailImageRoles.map(role => `https://storage.example/${role}.png`);
  const bound = bindMarketplaceArgumentsToApprovedDetailManifest(input, approved.value, urls);
  const html = String((bound.sellerpilotAssets as Record<string, unknown>).approvedStudioDetailHtml);
  assert.match(html, /대경사과원예농협음료가공공장/);
  assert.doesNotMatch(html, /FORGED_CLIENT_COPY/);
  assert.equal((html.match(/\{\{SELLERPILOT_IMAGE:/g) ?? []).length, 8);
  const legacy = { version: approved.value.version, manifest: approved.value.manifest };
  const withoutApprovedCopy = bindMarketplaceArgumentsToApprovedDetailManifest(input, legacy, urls);
  assert.equal(Object.hasOwn(withoutApprovedCopy.sellerpilotAssets as object, "approvedStudioDetailHtml"), false);
  assert.equal(input.sellerpilotAssets.approvedStudioDetailHtml, "FORGED_CLIENT_COPY");
});

test("detail-page document rejects 7, 9, duplicate, external, hero and inaccessible-alt image blocks", () => {
  const valid = exactEightDocument();
  const seven = { ...valid, content: valid.content.slice(0, -1) };
  assert.equal(inspectProductDetailImageDocument(seven).ok, false);

  const nine = {
    ...valid,
    content: [...valid.content, {
      type: "ImageStoryBlock",
      props: { id: "ninth", imageUrl: `${productDetailAssetReferencePrefix}detail-scale`, imageAlt: "아홉 번째" },
    }],
  };
  assert.equal(inspectProductDetailImageDocument(nine).ok, false);

  for (const patch of [
    { imageUrl: `${productDetailAssetReferencePrefix}${defaultProductDetailImageRoles[0]}` },
    { imageUrl: "https://merchant.example/detail.jpg" },
    { imageUrl: `${productDetailAssetReferencePrefix}hero` },
    { imageAlt: " " },
    { imageAlt: "a".repeat(181) },
  ]) {
    const mutated = structuredClone(valid);
    Object.assign(mutated.content[2]!.props, patch);
    assert.equal(inspectProductDetailImageDocument(mutated).ok, false, JSON.stringify(patch));
  }
});

test("localized selection chooses only the preferred Korean listing's eight roles from the master twelve", async () => {
  const selected = [
    "detail-overview", "detail-feature", "detail-use", "detail-package",
    "detail-routine", "detail-scale", "detail-storage", "detail-context",
  ] as const;
  const roles = localizedProductDetailImageRoles([
    { channel: "ebay", market: "US", detailSections: defaultProductDetailImageRoles.map((imageAsset) => ({ imageAsset })) },
    { channel: "coupang", market: "KR", detailSections: selected.map((imageAsset) => ({ imageAsset })) },
  ]);
  assert.deepEqual(roles, selected);
  assert.equal(roles.length, 8);
  assert.equal(new Set(roles).size, 8);

  const puckSource = await readFile(new URL("../app/product-detail-puck.tsx", import.meta.url), "utf8");
  const createDetailData = puckSource.slice(puckSource.indexOf("export function createDetailData"), puckSource.indexOf("export function ProductDetailRender"));
  assert.match(createDetailData, /localizedProductDetailImageRoles\(result\.localizedListings\)/);
  assert.match(createDetailData, /selectedDetailRoles\.has\(sectionAsset\)/);
});

test("approved publish manifest is cryptographically bound to the current complete generated-path ledger", () => {
  const approved = approvedProductDetailManifestFromPublishContext(approvedContext());
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.value.version, 4);
  assert.equal(approved.value.manifest.digest, manifestDigest);

  const stale = approvedContext();
  stale.generatedImagePaths[defaultProductDetailImageRoles[0]] = `results/${jobId}/claims/${claimId}/detail-overview-stale.png`;
  assert.equal(approvedProductDetailManifestFromPublishContext(stale).ok, false);

  const unapproved = approvedContext();
  unapproved.detailPage.approvedVersion = 3;
  assert.equal(approvedProductDetailManifestFromPublishContext(unapproved).ok, false);

  const badDigest = approvedContext();
  badDigest.detailPage.imageManifest.digest = "0".repeat(64);
  assert.equal(approvedProductDetailManifestFromPublishContext(badDigest).ok, false);

  const seven = approvedContext();
  seven.detailPage.imageManifest.images.pop();
  assert.equal(approvedProductDetailManifestFromPublishContext(seven).ok, false);

  const nine = approvedContext();
  nine.detailPage.imageManifest.images.push({ ...nine.detailPage.imageManifest.images[0] });
  assert.equal(approvedProductDetailManifestFromPublishContext(nine).ok, false);

  const duplicate = approvedContext();
  duplicate.detailPage.imageManifest.images[1] = { ...duplicate.detailPage.imageManifest.images[0] };
  assert.equal(approvedProductDetailManifestFromPublishContext(duplicate).ok, false);
});

test("channel arguments replace client detail URLs with approved signed manifest URLs", () => {
  const approved = approvedProductDetailManifestFromPublishContext(approvedContext());
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const signedUrls = defaultProductDetailImageRoles.map((role) => `https://storage.example/${role}.png?token=server`);
  const localizedDetailSections = defaultProductDetailImageRoles.map((imageAsset, index) => ({
    type: ["overview", "feature", "howto", "spec", "routine", "contents", "care", "proof"][index],
    heading: `현지화 제목 ${index}`,
    body: "현지화 본문을 충분한 길이로 작성하여 판매채널의 상세 정보 검증 조건을 충족합니다.",
    buyerQuestion: "구매 전에 어떤 점을 확인해야 하나요?",
    evidence: "판매자가 확인한 상품 라벨과 원본 사진에 근거한 내용입니다.",
    imageAsset,
    imageAltText: `현지화 대체텍스트 ${index}`,
  }));
  const bound = bindMarketplaceArgumentsToApprovedDetailManifest({
    sellerpilotAssets: {
      contentMode: "ai_generated",
      galleryImageUrls: ["https://client.example/gallery.jpg"],
      detailImageUrls: defaultProductDetailImageRoles.map((role) => `https://client.example/${role}.jpg`),
      detailImageRoles: [...defaultProductDetailImageRoles].reverse(),
      localizedDetailSections,
    },
    description: "현지화 설명 {{SELLERPILOT_IMAGE:detail-overview}}",
  }, approved.value, signedUrls);
  const assets = bound.sellerpilotAssets as Record<string, unknown>;
  assert.deepEqual(assets.detailImageUrls, signedUrls);
  assert.deepEqual(assets.galleryImageUrls, signedUrls, "AI gallery must discard old raw-source URLs");
  assert.deepEqual(assets.approvedGalleryImagePaths, manifestImages.map(image => image.path));
  assert.deepEqual(assets.approvedGalleryImageSha256s, manifestImages.map(image => image.sourceSha256));
  assert.deepEqual(assets.detailImageRoles, defaultProductDetailImageRoles);
  assert.equal(assets.detailImageManifestDigest, manifestDigest);
  assert.equal(assets.approvedDetailPageVersion, 4);
  assert.doesNotMatch(String(bound.description), /SELLERPILOT_IMAGE/);

  const alternateSigned = bindMarketplaceArgumentsToApprovedDetailManifest({
    ...bound,
    sellerpilotAssets: { ...assets },
  }, approved.value, signedUrls.map((url) => `${url}&retry=1`));
  assert.deepEqual(
    marketplaceArgumentsForApprovedDetailFingerprint(bound, approved.value),
    marketplaceArgumentsForApprovedDetailFingerprint(alternateSigned, approved.value),
    "ephemeral signed URLs must not change the idempotency fingerprint input",
  );
});

test("AI gallery approval overrides forged gallery lineage but preserves explicit manual source galleries", () => {
  const approved = approvedProductDetailManifestFromPublishContext(approvedContext());
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const signed = manifestImages.map(image => `https://storage.example/${image.role}.png`);
  const rawGallery = ["https://storage.example/raw-source-1.jpg", "https://storage.example/raw-source-2.jpg"];
  const input = { sellerpilotAssets: {
    contentMode: "ai_generated", galleryImageUrls: rawGallery,
    approvedGalleryImagePaths: ["forged/source.png"], approvedGalleryImageSha256s: ["a".repeat(64)],
    localizedDetailSections: defaultProductDetailImageRoles.map(imageAsset => ({ imageAsset })),
  } };
  const bound = bindMarketplaceArgumentsToApprovedDetailManifest(input, approved.value, signed);
  const assets = bound.sellerpilotAssets as Record<string, unknown>;
  assert.deepEqual(assets.galleryImageUrls, signed);
  assert.deepEqual(assets.approvedGalleryImagePaths, manifestImages.map(image => image.path));
  assert.doesNotMatch(JSON.stringify(assets), /raw-source|forged/);
  const manualInput = { sellerpilotAssets: { contentMode: "manual_mvp", galleryImageUrls: rawGallery, localizedDetailSections: input.sellerpilotAssets.localizedDetailSections } };
  const manual = bindMarketplaceArgumentsToApprovedDetailManifest(manualInput, approved.value, signed).sellerpilotAssets as Record<string, unknown>;
  assert.deepEqual(manual.galleryImageUrls, rawGallery);
  assert.equal(manual.contentMode, "manual_mvp");
  assert.throws(() => bindMarketplaceArgumentsToApprovedDetailManifest(input, approved.value, signed.slice(0, 7)), /MANIFEST_SIGNING_FAILED/);
  assert.deepEqual(input.sellerpilotAssets.galleryImageUrls, rawGallery, "analysis sources remain unchanged");
});


test("byte-approved historical fallback is not an eligible publication manifest", () => {
  const context = {
    ...approvedContext(),
    studioResult: {
      warnings: ["나머지 10장은 AI 생성 이미지가 아니라 원본 사진 기반 중립 카탈로그 이미지입니다."],
    },
  };
  assert.deepEqual(approvedProductDetailManifestFromPublishContext(context), {
    ok: false,
    code: "STUDIO_DEGRADED_RESULT_REGENERATION_REQUIRED",
  });
});


test("approved manifest preserves roles and localized alt text for all 256 mixed matched and unmatched section combinations", () => {
  const approved = approvedProductDetailManifestFromPublishContext(approvedContext());
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const roles = defaultProductDetailImageRoles;
  const signedUrls = roles.map((role) => `https://storage.example/${role}.png`);
  for (let mask = 0; mask < 256; mask += 1) {
    const localizedDetailSections = roles.map((imageAsset, index) => ({
      // detail-context is a valid generated role outside this approved manifest.
      imageAsset: mask & (1 << index) ? "detail-context" : imageAsset,
      imageAltText: `Verified English image description ${index}`,
      body: `Seller-verified product content ${index}`,
    }));
    const input = { sellerpilotAssets: { localizedDetailSections } };
    const original = structuredClone(input);
    const bound = bindMarketplaceArgumentsToApprovedDetailManifest(input, approved.value, signedUrls);
    const assets = bound.sellerpilotAssets as Record<string, unknown>;
    const sections = assets.localizedDetailSections as Record<string, unknown>[];
    assert.deepEqual(sections.map((section) => section.imageAsset), roles, `role assignment mask ${mask}`);
    assert.deepEqual(
      assets.detailImageAltTexts,
      roles.map((_role, index) => `Verified English image description ${index}`),
      `localized alt preservation mask ${mask}`,
    );
    assert.deepEqual(sections.map((section) => section.body), localizedDetailSections.map((section) => section.body));
    assert.deepEqual(assets.detailImageUrls, signedUrls);
    assert.deepEqual(input, original, `input immutability mask ${mask}`);
  }
});
