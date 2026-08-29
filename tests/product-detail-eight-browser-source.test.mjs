import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const savedPageUrl = new URL("../app/saved-product-detail-page.tsx", import.meta.url);
const puckUrl = new URL("../app/product-detail-puck.tsx", import.meta.url);
const publishContextRouteUrl = new URL("../app/api/admin/products/[id]/publish-context/route.ts", import.meta.url);
const channelRouteUrl = new URL("../app/api/admin/channel-operations/route.ts", import.meta.url);
const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);

test("saved detail preview exposes an exact 8/8 load gate and any image error keeps it not ready", async () => {
  const [savedPage, puck] = await Promise.all([
    readFile(savedPageUrl, "utf8"),
    readFile(puckUrl, "utf8"),
  ]);

  assert.match(savedPage, /data-detail-images-ready=\{detailImagesReady \? "true" : "false"\}/);
  assert.match(savedPage, /상세 이미지 \{loadedImageCount\} \/ \{productDetailImageCount\}장/);
  assert.match(savedPage, /loadedImageCount === productDetailImageCount/);
  assert.match(savedPage, /failedImageCount === 0/);
  assert.match(savedPage, /불러오기 오류 \$\{failedImageCount\}장 · 오류가 해소될 때까지 게시 준비 아님/);
  assert.match(savedPage, /key=\{`detail-image-load-\$\{detailImageLoadCycle\}`\}/);
  assert.match(savedPage, /onDetailImageLoadState=\{reportImageLoadState\}/);
  assert.match(puck, /onLoad=\{\(\) => loadContext\.report\(role, "loaded"\)\}/);
  assert.match(puck, /onError=\{\(\) => loadContext\.report\(role, "error"\)\}/);
  assert.match(puck, /data-sellerpilot-detail-image-role=\{role \|\| undefined\}/);
});

test("detail creation renders only a localized eight-role selection while retaining the master sections", async () => {
  const puck = await readFile(puckUrl, "utf8");
  const createStart = puck.indexOf("export function createDetailData");
  const createEnd = puck.indexOf("export function ProductDetailRender", createStart);
  const createDetailData = puck.slice(createStart, createEnd);

  assert.ok(createStart >= 0 && createEnd > createStart);
  assert.match(createDetailData, /localizedProductDetailImageRoles\(result\.localizedListings\)/);
  assert.match(createDetailData, /\.\.\.design\.sections\.map\(\(section, index\) =>/);
  assert.match(createDetailData, /!selectedDetailRoles\.has\(sectionAsset\) \? "" : assetUrls\[sectionAsset\]/);
  assert.match(createDetailData, /sectionImage \? \{[\s\S]*?type: "ImageStoryBlock"[\s\S]*?: sectionLayout === "cards"/);
});

test("PUT and channel publication validate the approved manifest before DB save, claim, or provider execution", async () => {
  const [publishContextRoute, channelRoute] = await Promise.all([
    readFile(publishContextRouteUrl, "utf8"),
    readFile(channelRouteUrl, "utf8"),
  ]);

  const putStart = publishContextRoute.indexOf("export async function PUT");
  const putInspection = publishContextRoute.indexOf("inspectProductDetailImageDocument(body.data.data)", putStart);
  const putResolution = publishContextRoute.indexOf("resolveProductDetailDocumentAssetPaths(body.data.data", putStart);
  const putExistence = publishContextRoute.indexOf("detailBucket.exists(asset.path)", putStart);
  const putRpc = publishContextRoute.indexOf('"sellerpilot_save_product_detail_page"', putStart);
  assert.ok(putStart >= 0 && putInspection > putStart);
  assert.ok(putResolution > putInspection);
  assert.ok(putExistence > putResolution);
  assert.ok(putRpc > putExistence);
  assert.match(publishContextRoute, /DETAIL_PAGE_ASSETS_UNRESOLVED/);

  const approval = channelRoute.indexOf("approvedProductDetailManifestFromPublishContext(publishContext)");
  const existence = channelRoute.indexOf("detailBucket.exists(path)");
  const signing = channelRoute.indexOf("detailBucket.createSignedUrls(detailPaths");
  const binding = channelRoute.indexOf("bindMarketplaceArgumentsToApprovedDetailManifest(");
  const stableFingerprintBinding = channelRoute.indexOf("marketplaceArgumentsForApprovedDetailFingerprint(effectiveArguments");
  const fingerprint = channelRoute.indexOf('createHash("sha256")', binding);
  const claim = channelRoute.indexOf('"sellerpilot_claim_channel_operation"');
  const provider = channelRoute.indexOf("executeViaChannelGateway({");
  assert.ok(approval >= 0);
  assert.ok(existence > approval);
  assert.ok(signing > existence);
  assert.ok(binding > signing);
  assert.ok(stableFingerprintBinding > binding);
  assert.ok(fingerprint > stableFingerprintBinding);
  assert.ok(claim > fingerprint);
  assert.ok(provider > claim);
  assert.match(channelRoute, /arguments: fingerprintArguments/);
  assert.match(channelRoute, /mode: "approved_detail_image_manifest_required"/);
  assert.match(channelRoute, /mode: "approved_detail_image_assets_unavailable"/);
  assert.match(channelRoute, /mode: "approved_detail_image_binding_invalid"/);
  assert.match(channelRoute, /status: 409/);
});

test("publish workbench requires an approved version and exact role/path matches, including for manual MVP products", async () => {
  const workbench = await readFile(workbenchUrl, "utf8");

  assert.match(workbench, /context\.detailPage\?\.version === context\.detailPage\?\.approvedVersion/);
  assert.match(workbench, /image\.id === entry\.role && image\.path === entry\.path && Boolean\(image\.url\)/);
  assert.match(workbench, /&& !manualMvp/);
  assert.match(workbench, /승인된 상세페이지 이미지 8장이 없는 직접등록 상품은 판매채널 자동 전송을 시작하지 않습니다/);
  assert.match(workbench, /마스터 \$\{marketplaceGeneratedAssetCount\}종 이미지 원장은 보존/);
});
