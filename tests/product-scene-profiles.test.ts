import assert from "node:assert/strict";
import test from "node:test";
import {productSceneProfiles, resolveProductSceneProfile, sceneCategoryChannels} from "../lib/product-scene-profiles";
import {buildProfileSettingShotPlan} from "../lib/profile-setting-shots";
import {assertDistinctSettingShotPlan, buildSettingShotRetryVariant, buildSettingShotRetryGuidance} from "../lib/product-setting-shots";
import {buildAssetImagePrompt, resolveProductSettingShot} from "../lib/ai-image-planning";
import {aiGeneratedAssetSpecs} from "../lib/ai-generated-assets";
import {buildBackgroundSemanticAuditPrompt, resolveIdentityBackgroundContract} from "../lib/ai-background-audit";
import {isStudioSceneSource, planStudioSourceAssignments} from "../lib/studio-source-planning";
import type {ProductStudioResult} from "../app/product-studio-types";
import {buildServerStudioBackgroundPrompt} from "../lib/server-product-studio";

test("at least sixty distinct product profiles are selectable by their primary identity",()=>{
  assert.ok(productSceneProfiles.length>=60);
  assert.equal(new Set(productSceneProfiles.map(p=>p.id)).size,productSceneProfiles.length);
  for(const profile of productSceneProfiles){
    const selection=resolveProductSceneProfile({name:profile.aliases[0],category:"일반 상품"});
    assert.equal(selection.profile.id,profile.id,profile.aliases[0]);
    assertDistinctSettingShotPlan(buildProfileSettingShotPlan(selection,profile.aliases[0]));
  }
});
test("jelly is not routed to tea or cooking by an ingredient or broad food label",()=>{
  const selection=resolveProductSceneProfile({name:"BEYOND ORIGIN 애사비 젤리스틱",category:"식품 > 기타가공품",features:["보이차추출분말", "사과초모식초 5%"],isHealthFunctionalFood:false});
  assert.equal(selection.profile.id,"food-jelly-stick");
  const plan=buildProfileSettingShotPlan(selection,"애사비 젤리스틱");
  assert.equal(plan.portrait.sceneProfile?.mode,"product-editorial");
  assert.equal(plan["detail-use"].sceneProfile?.mode,"contextual");
  for(const s of Object.values(plan))assert.doesNotMatch(s.location,/주방|팬트리|조리|냄비/);
});
test("cup ramen receives opened prepared-food shots while catalog and evidence roles stay source protected",()=>{
  const selection=resolveProductSceneProfile({name:"농심 신라면컵 65g",category:"식품 > 컵라면",features:["끓는 물 조리", "약 3분"],isHealthFunctionalFood:false});
  assert.equal(selection.profile.id,"food-cup-noodles");
  const cupResult={...result,product:{...result.product,name:"농심 신라면컵 65g",category:"식품 > 컵라면",features:["끓는 물 조리", "약 3분"]}};
  const use=resolveProductSettingShot(cupResult,"detail-use")!;
  const context=resolveProductSettingShot(cupResult,"detail-context")!;
  assert.equal(use.foodPresentation?.state,"prepared-hero");
  assert.equal(context.foodPresentation?.state,"active-serving");
  assert.equal(resolveProductSettingShot(cupResult,"portrait")?.foodPresentation,undefined);
  const useAsset=aiGeneratedAssetSpecs.find(asset=>asset.id==="detail-use")!;
  const prompt=buildAssetImagePrompt(cupResult,"/tmp/cup-prepared.png",useAsset,["main","front"],"","prepared-food",use);
  assert.match(prompt,/prepared-food-reference/);
  assert.match(prompt,/익은 면과 따뜻한 국물/);
  assert.match(prompt,/Steam may appear only/);
  assert.match(prompt,/no empty-background result/i);
  assert.match(prompt,/계란·파·고기/);
});
test("the eight channels accept semantic category text, never numeric category IDs",()=>{
  for(const channel of sceneCategoryChannels){
    assert.equal(resolveProductSceneProfile({name:"제품 A",channelCategories:[{channel,path:["Beauty","Skin Care","Serum"]}]}).profile.id,"beauty-serum");
    assert.equal(resolveProductSceneProfile({name:"제품 A",channelCategories:[{channel,name:"50000123"}]}).confidence,"fallback");
  }
  assert.equal(resolveProductSceneProfile({name:"製品A",channelCategories:[{channel:"qoo10",market:"JP",path:["食品","ゼリースティック"]}]}).profile.id,"food-jelly-stick");
  assert.equal(resolveProductSceneProfile({name:"Product A",channelCategories:[{channel:"ebay",path:["Cameras & Photo","Tripods"]}]}).profile.id,"digital-camera");
  assert.equal(resolveProductSceneProfile({name:"Product A",channelCategories:[{channel:"shopee",path:["Beauty","Serums & Essences"]}]}).profile.id,"beauty-serum");
});
test("a specific product name outranks conflicting marketplace text and records the conflict",()=>{
  const selection=resolveProductSceneProfile({name:"USB 충전기",category:"가전",channelCategories:[{channel:"ebay",name:"Skin Care Serum"}]});
  assert.equal(selection.profile.id,"digital-power");assert.ok(selection.conflicts.includes("beauty-serum"));
  const conflict=resolveProductSceneProfile({name:"제품 A",channelCategories:[{channel:"ebay",name:"Skin Care Serum"},{channel:"coupang",name:"충전기"}]});
  assert.equal(conflict.confidence,"fallback");
});
test("unknown categories and incidental use text stay neutral",()=>{
  for(const category of ["Food", "식품", "Beauty", "기타", "가정용품"]){
    assert.equal(resolveProductSceneProfile({name:"제품 A",category,features:["커피 마시는 공간에서도 사용"]}).profile.id,"unclassified");
  }
  assert.equal(resolveProductSceneProfile({name:"프린터 토너",category:"프린터 소모품"}).profile.id,"unclassified");
  assert.equal(resolveProductSceneProfile({name:"Notebook computer",category:"Electronics"}).profile.id,"unclassified");
});
test("pet food cannot become a human snack scene",()=>{
  const selection=resolveProductSceneProfile({name:"강아지간식 쿠키",category:"식품"});
  assert.equal(selection.profile.id,"pet-treat");assert.match(selection.profile.forbiddenContexts,/사람 식탁/);
});
test("manufacturing side stays evidence and front stays the scene subject",()=>{
  const obs={role:"front" as const,confidence:1,sameProduct:"yes" as const,wholeProduct:true,readableText:"애사비 젤리스틱 15g",facts:[],warnings:[]};
  const front={path:"front",name:"front",role:"main",mediaType:"image/png",bytes:new Uint8Array(),observation:obs};
  const side={...front,path:"side",role:"extra",observation:{...obs,role:"left" as const,readableText:"제조원 케이지랩 소비자상담실 반품 및 교환처"}};
  assert.equal(isStudioSceneSource(side),false);
  const plan=planStudioSourceAssignments([front,side]);
  for(const spec of aiGeneratedAssetSpecs.filter(a=>a.identityPolicy.mode==="source-composite"))assert.equal(plan.get(spec.id)?.path,"front");
  assert.equal(plan.get("detail-package")?.path,"side");
});
const result={mode:"cli",product:{name:"애사비 젤리스틱",category:"일반식품",features:["보이차 추출분말"],cautions:[],classification:{isHealthFunctionalFood:false},oneLine:"젤리스틱"},design:{palette:{surface:"#eeeeff",accent:"#ffffaa"},creativeStrategy:{},sections:[]},localizedListings:[]} as unknown as ProductStudioResult;
test("runtime prompt and retry both retain the selected product profile",()=>{
  const asset=aiGeneratedAssetSpecs.find(a=>a.id==="portrait")!;
  const setting=resolveProductSettingShot(result,"portrait")!;
  assert.equal(setting.sceneProfile?.id,"food-jelly-stick");
  const prompt=buildAssetImagePrompt(result,"/tmp/portrait.png",asset,["main"],"","identity-background");
  assert.match(prompt,/product-editorial/);assert.match(prompt,/no product, package/i);assert.doesNotMatch(prompt,/OUTER-BAND ARCHITECTURE GATE|eight mandatory real-world/);
  const retry=buildSettingShotRetryVariant(setting,"portrait",2);
  assert.equal(retry.sceneProfile?.id,setting.sceneProfile?.id);
  const guidance=buildSettingShotRetryGuidance("portrait",[],2,retry);
  assert.doesNotMatch(guidance,/assigned functional room|L-shaped built-in/);assert.match(guidance,/horizontal support boundary/);
});
test("semantic audit accepts photographed editorial depth without forcing architecture",()=>{
  const setting=resolveProductSettingShot(result,"portrait")!;
  const contract=resolveIdentityBackgroundContract(setting,"portrait");
  assert.match(contract.location.description,/PRODUCT-PROFILE CONTRACT/);assert.doesNotMatch(contract.location.description,/at least two unmistakable fixed/);
  const prompt=buildBackgroundSemanticAuditPrompt({assetId:"portrait",expectedEnvironment:contract.location.description,reservedZone:{left:.1,top:.1,width:.6,height:.7},contactMode:"surface-supported",expectedPropKey:contract.prop.key,expectedPropDescription:contract.prop.description,expectedEnvironmentKeys:Object.fromEntries(["location","moment","surface","camera","palette","spatialDepth"].map(k=>[k,contract[k as keyof typeof contract].key])) as {location:string;moment:string;surface:string;camera:string;palette:string;spatialDepth:string}});
  assert.match(prompt,/PRODUCT-PROFILE OVERRIDE/);assert.match(prompt,/does not need a room/);
});
test("server generation receives the same product profile as the CLI image prompt",()=>{
  const asset=aiGeneratedAssetSpecs.find(a=>a.id==="portrait")!;
  const prompt=buildServerStudioBackgroundPrompt(result,asset,1,[],0);
  assert.match(prompt,/food-jelly-stick/);
  assert.match(prompt,/Scene mode=product-editorial/);
  assert.doesNotMatch(prompt,/scene=[^;\n]*(주방|팬트리)/);
  assert.match(prompt,/No product, package/);
});
