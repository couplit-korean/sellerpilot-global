import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { smartstoreContentRepairArgument, smartstoreContentRepairBodyHashes } from "../lib/channels/smartstore-content-repair";
const previousProject = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
after(() => { if (previousProject === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousProject; });
const fixtureImages = await Promise.all(Array.from({ length: 9 }, (_, index) => sharp({ create: { width: 600, height: 600, channels: 3, background: { r: index * 25, g: 200 - index * 20, b: 100 } } }).jpeg().toBuffer()));
const fixtureSources = fixtureImages.map(bytes => {
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `https://example.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${hash.slice(0, 2)}/${hash}.jpg`;
});
const imageModule = `const images = ${JSON.stringify(Object.fromEntries(fixtureSources.map((url,index)=>[url,fixtureImages[index].toString("base64")])))}; export async function downloadMarketplaceImage(url) { return {bytes:Buffer.from(images[url],"base64"),contentType:"image/jpeg"}; }`;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  if (specifier === "./marketplace-images" && context.parentURL?.includes("provider-listing-runtime")) return {
    shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(imageModule)}`,
  };
  return next(specifier, context);
} });
const { prepareMarketplaceListingArguments } = await import("../lib/channels/provider-listing-runtime");
const { prepareListingUpdateArguments } = await import("../lib/channels/listing-update");
const remoteId = "13688607602", channelId = "13749310594", sellerSku = "TEST-REPAIR-ONLY";
const sources = fixtureSources;
const natives = Array.from({length:9}, (_,i) => `https://shop-phinf.pstatic.net/20260907/test${i}.jpg`);
const currentOrigin = { name: "old", detailContent: "old", images: { representativeImage: {url:"old"} },
  leafCategoryId:"50001578", salePrice:3190, stockQuantity:1, statusType:"SALE",
  deliveryInfo:{deliveryFee:{deliveryFeeType:"PAID",baseFee:3000}},
  detailAttribute:{sellerCodeInfo:{sellerManagementCode:sellerSku},unitCapacity:{unitPriceYn:true,totalCapacityValue:315,unitCapacity:10,indicationUnit:"g"}} };
const currentChannel = {channelProductName:"old channel",channelProductDisplayStatusType:"ON",naverShoppingRegistration:true};
function fixture() {
  const uuid="10000000-0000-4000-8000-000000000001";
  const marker={contract:"smartstore_existing_content_repair_job_v1",ownerId:uuid,baselineId:uuid,productId:uuid,listingId:uuid,
    sourceJobId:uuid,sourceAttemptId:uuid,credentialId:uuid,sellerAccountKey:"c".repeat(64),sellerSku,
    originProductNo:remoteId,channelProductNo:channelId,approvalRevision:1,contentSha256:"a".repeat(64),manifestDigest:"b".repeat(64),
    ...smartstoreContentRepairBodyHashes({originProduct:currentOrigin,smartstoreChannelProduct:currentChannel})};
  const events:string[]=[];
  const input={channel:"smartstore" as const,operation:"listing.update" as const,environment:"production" as const,
    credential:{access_token:"test-only",access_token_expires_at:"2099-01-01T00:00:00.000Z"},signal:new AbortController().signal,
    arguments:{originProductNo:remoteId,publicationIntent:"live",imageUrls:sources,[smartstoreContentRepairArgument]:marker,
      body:{originProduct:{name:"approved",detailContent:sources.slice(1).map(url=>`<img src="${url}" />`).join(""),images:{representativeImage:{url:sources[0]}}},smartstoreChannelProduct:{channelProductName:"approved channel"}}},
    hooks:{assertLeaseHealthy:async()=>{},beginProviderMutation:async()=>{events.push("begin-media-mutation");}}};
  return {input,events};
}
for (const drift of [false,true]) test(`repair runtime ${drift ? "blocks remote drift" : "uploads 9 and preserves all protected values"}`,async()=>{
  const {input,events}=fixture(); const originalFetch=globalThis.fetch;
  globalThis.fetch=async (request,init)=>{
    const path=new URL(String(request)).pathname; events.push(path);
    if(path.endsWith("/products/search"))return Response.json({page:1,size:50,totalElements:1,totalPages:1,first:true,last:true,contents:[{originProductNo:remoteId,channelProducts:[{channelProductNo:channelId,sellerManagementCode:sellerSku}]}]});
    if(path.includes("/origin-products/")||path.includes("/channel-products/"))return Response.json({originProduct:{...currentOrigin,...(drift?{stockQuantity:2}:{})},smartstoreChannelProduct:currentChannel});
    if(path.endsWith("/categories/50001578"))return Response.json({id:"50001578",last:true,exceptionalCategories:["UNIT_PRICE"]});
    if(path.endsWith("/product-images/upload")){assert.equal(init?.method,"POST");assert.equal((init?.body as FormData).getAll("imageFiles").length,9);return Response.json({images:natives.map(url=>({url}))});}
    throw new Error("unexpected request");
  };
  try{
    if(drift){await assert.rejects(prepareMarketplaceListingArguments(input),/PREWRITE_DRIFT/);assert.equal(events.includes("begin-media-mutation"),false);return;}
    const result=await prepareMarketplaceListingArguments(input);
    const normalized = prepareListingUpdateArguments("smartstore", result.arguments, { status: "published", remoteId });
    assert.deepEqual(normalized.body, result.arguments.body);
    assert.deepEqual(normalized[smartstoreContentRepairArgument], input.arguments[smartstoreContentRepairArgument]);
    assert.deepEqual(normalized.sellerpilotSmartstoreContentRepairTransmissionImages, result.arguments.sellerpilotSmartstoreContentRepairTransmissionImages);
    const body=result.arguments.body as {originProduct:Record<string,unknown>;smartstoreChannelProduct:Record<string,unknown>};
    assert.equal(result.mediaMutationObserved,true);assert.equal(body.originProduct.salePrice,3190);assert.equal(body.originProduct.stockQuantity,1);
    assert.deepEqual(body.originProduct.detailAttribute,currentOrigin.detailAttribute);assert.deepEqual(body.originProduct.deliveryInfo,currentOrigin.deliveryInfo);
    assert.equal(smartstoreContentRepairBodyHashes(body).protectedBodySha256,input.arguments[smartstoreContentRepairArgument].protectedBodySha256);
    assert.deepEqual(result.arguments.imageUrls,natives);assert.equal(String(body.originProduct.detailContent).includes(sources[1]),false);
    assert.equal((result.arguments.sellerpilotSmartstoreContentRepairTransmissionImages as unknown[]).length,8);
    assert.equal(events.filter(x=>x==="begin-media-mutation").length,1);
    assert.ok(events.indexOf("begin-media-mutation")>events.findIndex(x=>x.includes("/categories/")));
  }finally{globalThis.fetch=originalFetch;}
});

test("transmission proof uses the same oriented sRGB pixels as final provider verification", async () => {
  const { inspectSmartstoreContentRepairTransmission } = await import("../lib/channels/smartstore-content-repair");
  const bytes = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#705030" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const url = `https://example.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${hash.slice(0,2)}/${hash}.jpg`;
  const evidence = await inspectSmartstoreContentRepairTransmission(url, bytes, 1);
  assert.equal(evidence?.index, 0); assert.equal(evidence?.width, 800); assert.equal(evidence?.height, 600);
  const decoded = await sharp(bytes).rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(evidence?.decodedRgbaSha256, createHash("sha256").update(Buffer.concat([Buffer.from("800x600:RGBA\n"), decoded.data])).digest("hex"));
  await assert.rejects(inspectSmartstoreContentRepairTransmission(url.replace("example.supabase.co", "other.supabase.co"), bytes, 1), /PROJECT_ORIGIN_MISMATCH/);
  await assert.rejects(inspectSmartstoreContentRepairTransmission(url, Buffer.concat([bytes, Buffer.from([0])]), 1), /TRANSMISSION_DIGEST_MISMATCH/);
});
