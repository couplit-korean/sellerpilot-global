import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  makeProductDetailPersistable,
  makeValidatedProductDetailPersistable,
  parsePersistedProductDetailPage,
  resolveProductDetailAssets,
} from "../app/_publishing/product-detail-persistence";

const data = {
  root: {},
  content: [
    { type: "HeroBlock", props: { id: "hero", imageUrl: "https://signed.example/old-hero", title: "상품" } },
    { type: "VerificationRibbonBlock", props: { id: "verification", classification: "일반상품", evidence: "판매자 제공 라벨" } },
    { type: "StoryBlock", props: { id: "story", body: "설명" } },
    { type: "ImageStoryBlock", props: { id: "external", imageUrl: "https://merchant.example/manual.jpg" } },
  ],
};

test("Puck persistence stores stable asset identities instead of expiring signed URLs", () => {
  const persisted = makeProductDetailPersistable(data, { hero: "https://signed.example/old-hero" });
  assert.equal(persisted.content[0]?.props.imageUrl, "sellerpilot-asset://hero");
  assert.equal(persisted.content[3]?.props.imageUrl, "https://merchant.example/manual.jpg");
  assert.equal(data.content[0]?.props.imageUrl, "https://signed.example/old-hero", "input must stay immutable");

  const rendered = resolveProductDetailAssets(persisted, { hero: "https://signed.example/fresh-hero" });
  assert.equal(rendered.content[0]?.props.imageUrl, "https://signed.example/fresh-hero");
  assert.equal(rendered.content[3]?.props.imageUrl, "https://merchant.example/manual.jpg");
});

test("missing private assets render empty instead of retaining an expired private URL", () => {
  const rendered = resolveProductDetailAssets({
    root: {},
    content: [{ type: "HeroBlock", props: { id: "hero", imageUrl: "sellerpilot-asset://hero" } }],
  }, {});
  assert.equal(rendered.content[0]?.props.imageUrl, "");
});

test("pre-save persistence refuses external, duplicate, missing and non-eight detail assets", () => {
  const roles = [
    "detail-overview", "detail-feature", "detail-use", "detail-package",
    "detail-routine", "detail-dimensions", "detail-contents", "detail-care",
  ];
  const assetUrls = Object.fromEntries(roles.map((role) => [role, `https://signed.example/${role}`]));
  const exactEight = {
    root: {},
    content: roles.map((role, index) => ({
      type: "ImageStoryBlock",
      props: { id: `image-${index}`, imageUrl: assetUrls[role], imageRole: role, imageAlt: `상세 이미지 ${index + 1}` },
    })),
  };
  const persisted = makeValidatedProductDetailPersistable(exactEight, assetUrls);
  assert.equal(persisted.content.length, 8);
  assert.equal(persisted.content[0]?.props.imageUrl, "sellerpilot-asset://detail-overview");

  const external = structuredClone(exactEight);
  external.content[0]!.props.imageUrl = "https://merchant.example/external.jpg";
  assert.throws(() => makeValidatedProductDetailPersistable(external, assetUrls), /운영 자산 역할/);
  assert.throws(() => makeValidatedProductDetailPersistable({ ...exactEight, content: exactEight.content.slice(0, 7) }, assetUrls), /정확히 8장/);
  const alreadyPersisted = makeProductDetailPersistable(exactEight, assetUrls);
  assert.throws(
    () => makeValidatedProductDetailPersistable(alreadyPersisted, { ...assetUrls, "detail-care": "" }),
    /현재 운영 접근 경로/,
  );
});

test("persisted Puck envelopes require an optimistic version and valid root/content shape", () => {
  assert.equal(parsePersistedProductDetailPage({ data, version: 2, updatedAt: "2026-08-26T00:00:00Z" })?.version, 2);
  assert.equal(parsePersistedProductDetailPage({ data, version: 0 }), null);
  assert.equal(parsePersistedProductDetailPage({ data: { root: {}, content: "bad" }, version: 1 }), null);
});

const signedRoles = ["detail-overview", "detail-feature", "detail-use", "detail-package", "detail-routine", "detail-dimensions", "detail-contents", "detail-care"];
const signedBase = "https://project.supabase.co/storage/v1/object/sign/sellerpilot-ai/results/10000000-0000-4000-8000-000000000001/claims/20000000-0000-4000-8000-000000000001/";
const freshSignedAssets = Object.fromEntries(signedRoles.map((role) => [role, `${signedBase}${role}.png?token=fresh`]));
function editedSignedDocument() {
  return {
    root: { props: { title: "판매자가 수정한 제목" } },
    content: signedRoles.map((role, index) => ({ type: "ImageStoryBlock", props: {
      id: `edited-${index}`, imageUrl: `${signedBase}${role}.png?token=previous`, imageRole: role,
      imageAlt: `확인한 상세 ${index + 1}`, body: `직접 편집한 본문 ${index + 1}`, evidence: "실물 확인 내용",
    } })),
  };
}

test("Puck edits survive signed-token rotation only for the same approved claim object", () => {
  const edited = editedSignedDocument();
  const original = structuredClone(edited);
  const saved = makeValidatedProductDetailPersistable(edited, freshSignedAssets);
  assert.deepEqual(edited, original);
  assert.deepEqual(saved.root, original.root);
  for (const [index, block] of saved.content.entries()) {
    assert.deepEqual(block.props, { ...original.content[index]!.props, imageUrl: `sellerpilot-asset://${signedRoles[index]}` });
  }
  const hydrated = resolveProductDetailAssets(saved, freshSignedAssets);
  assert.equal(hydrated.content[5]!.props.imageUrl, freshSignedAssets["detail-dimensions"]);
  assert.equal(hydrated.content[5]!.props.body, original.content[5]!.props.body);
});

test("a declared image role cannot authorize a different origin, job, claim or file", () => {
  const mutations = [
    (url: string) => url.replace("project.supabase.co", "foreign.supabase.co"),
    (url: string) => url.replace("10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"),
    (url: string) => url.replace("20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"),
    (url: string) => url.replace("detail-overview.png", "external.png"),
    (url: string) => url.replace("https:", "http:"),
  ];
  for (const mutate of mutations) {
    const edited = editedSignedDocument();
    edited.content[0]!.props.imageUrl = mutate(edited.content[0]!.props.imageUrl);
    assert.throws(() => makeValidatedProductDetailPersistable(edited, freshSignedAssets), /운영 자산 역할/);
  }
  const conflicting = editedSignedDocument();
  conflicting.content[0]!.props.imageRole = "detail-care";
  assert.throws(() => makeValidatedProductDetailPersistable(conflicting, freshSignedAssets), /역할과 운영 자산 참조/);
});

test("studio, product detail, API and DB persistence stay connected by the same version fence", async () => {
  const [studio, savedPage, route] = await Promise.all([
    readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/saved-product-detail-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/products/[id]/publish-context/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(studio, /makeValidatedProductDetailPersistable/);
  assert.match(studio, /expectedVersion: detailPageVersion/);
  assert.match(savedPage, /DETAIL_PAGE_VERSION_CONFLICT/);
  assert.match(savedPage, /expectedVersion: detailPage\?\.version \?\? null/);
  assert.match(route, /maximumDetailPagePayloadBytes = 256 \* 1024/);
  assert.match(route, /VerificationRibbonBlock/);
  assert.match(route, /sellerpilot_save_product_detail_page/);
  assert.match(route, /p_expected_version/);
});
