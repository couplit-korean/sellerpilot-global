/**
 * Portable external-detail UI regression suite.
 * Run: node --test tests/external-detail-import-ui.test.mjs
 * Requires the repository's existing Node/tsx/PGlite dependencies; no live browser,
 * credentials, environment-file loading, remote HTTP, or operating DB is used.
 * 18 UI behaviors + 4 canonical/route/SQL behaviors + Qt baseline + 19 existing
 * adjacent regressions, imported rather than duplicated, preserve the full 42.
 * React's dispatcher harness exercises real component handlers and actual Puck
 * onPublish; it is not a substitute for browser geometry or production E2E.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {register} from 'tsx/esm/api';
import {PGlite} from '@electric-sql/pglite';
import React from 'react';

const unregisterTsx=register({tsconfig:fileURLToPath(new URL('../tsconfig.json',import.meta.url))});
const originalFetch=globalThis.fetch;
const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
const memoryStorage=new Map();
Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>memoryStorage.get(key)??null,setItem:(key,value)=>memoryStorage.set(key,String(value)),removeItem:key=>memoryStorage.delete(key),clear:()=>memoryStorage.clear()}});
globalThis.fetch=async()=>{throw Error('External-detail regression forbids real network access');};
const readOnlyHooks=registerHooks({load(url,context,next){
 if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true};
 // Exact module substitution isolates auth/storage/RPC, not route validation.
 if(url===new URL('../lib/admin-api.ts',import.meta.url).href)return {format:'module',shortCircuit:true,source:'export async function authenticateAdminRequest(){return globalThis.__detailCanonicalAdminFixture;} export function isAdminApiError(){return false;}'};
 return next(url,context);
}});
test.after(async()=>{globalThis.fetch=originalFetch;if(previousStorage)Object.defineProperty(globalThis,'sessionStorage',previousStorage);else delete globalThis.sessionStorage;readOnlyHooks.deregister();await unregisterTsx();delete globalThis.__detailCanonicalAdminFixture;});

const {bindExternalDetailCopy,externalDetailDigest}=await import('../lib/external-detail-copy.ts');
const {externalDetailCanonical}=await import('../lib/external-detail-canonical.ts');
const {ProductDetailEditor}=await import('../app/product-detail-puck.tsx');
const {SavedProductDetailPage}=await import('../app/saved-product-detail-page.tsx');
const {makeValidatedProductDetailPersistable}=await import('../app/_publishing/product-detail-persistence.ts');
const {defaultProductDetailImageRoles}=await import('../lib/product-detail-image-manifest.ts');
const {ProductDetailAssetImport,makeExternalImportDocumentCanonical,parseExternalImportPackage,prepareExternalImportRequest,assertExternalImportReceipt,externalImportCanonical,externalImportDigest,bindExternalImportRow,bindExternalImportSignedView,externalImportDraftBlock,savedDetailSource}=await import('../app/product-detail-asset-import.tsx');
const {POST}=await import('../app/api/admin/products/[id]/detail-assets/import/route.ts');

// Existing sources remain frozen; run their 19 nearby invariants with this suite.
await import('./product-detail-persistence.test.ts');
await import('./product-detail-locale.test.ts');
await import('./studio-result-quality.test.ts');
await import('./product-detail-eight-browser-source.test.mjs');

test.beforeEach(()=>{try { sessionStorage.clear(); } catch { /* Node without Web Storage */ }});
const roles=['detail-overview','detail-feature','detail-use','detail-package','detail-routine','detail-dimensions','detail-contents','detail-care'];
const context={productId:'00000000-0000-4000-8000-000000000007',ownerId:'owner-fixture',productUpdatedAt:'2026-09-05T01:02:03.123456+00:00',detailVersion:7,aiJobId:null};
const doc=()=>({root:{},content:roles.map((role,i)=>({type:'ImageStoryBlock',props:{id:'img'+i,imageUrl:'sellerpilot-asset://'+role,imageRole:role,imageAlt:role,caption:'Staged scene.',body:'Staged scene.'}}))});
const pkg=()=>({source:{kind:'external_generated',tool:'External tool',referenceSha256s:['a'.repeat(64)]},assets:roles.map(role=>({role,alt:role,caption:'Staged scene.'})),reviewedCopy:Object.fromEntries(['ko','ja','en'].map(locale=>[locale,{document:doc(),reviewNote:'Human fixture review '+locale}])),audit:{rightsBasis:'Fixture evidence only',limitations:'Staged, props excluded.',sourceReferences:[{label:'Source',sha256:'a'.repeat(64)}]}});
const files=()=>Object.fromEntries(roles.map((r,i)=>[r,new File([new Uint8Array([137,80,78,71,13,10,26,10,i])],r+'.png',{type:'image/png'})]));
test('three locale copy and eight ordered roles are mandatory, no owner/product override',()=>{
 assert.equal(parseExternalImportPackage(JSON.stringify(pkg())).assets.length,8);
 for(const mutate of [p=>delete p.reviewedCopy.ja,p=>p.assets.pop(),p=>p.assets[1].role=p.assets[0].role,p=>p.ownerId='injected',p=>p.source.kind='studio_generated',p=>p.reviewedCopy.en.document.content[0].props.body='No disclosure']){const p=pkg();mutate(p);assert.throws(()=>parseExternalImportPackage(JSON.stringify(p)));}
});
test('request preserves exact server time/version, hashes original bytes and rejects duplicates',async()=>{
 const f=files();const request=await prepareExternalImportRequest(context,pkg(),f);
 assert.equal(request.expectedProductUpdatedAt,context.productUpdatedAt);assert.equal(request.expectedDetailVersion,7);assert.equal(request.productId,context.productId);assert.equal(request.expectedAiJobId,null);assert.equal(request.source.kind,'external_generated');assert.equal(new Set(request.assets.map(a=>a.sourceSha256)).size,8);assert.equal('ownerId' in request,false);
 f[roles[1]]=f[roles[0]];await assert.rejects(()=>prepareExternalImportRequest(context,pkg(),f));
});
test('receipt requires exact identity, fingerprint and accepted state',()=>{
 const row={id:'import',product_id:context.productId,owner_id:context.ownerId,status:'verified',request_sha256:'a'.repeat(64)};
 assert.equal(assertExternalImportReceipt(row,context,'import','verified').status,'verified');
 for(const patch of [{id:'wrong'},{product_id:'wrong'},{owner_id:'wrong'},{status:'approved'},{request_sha256:'bad'}])assert.throws(()=>assertExternalImportReceipt({...row,...patch},context,'import','verified'));
 assert.throws(()=>assertExternalImportReceipt(row,context,'import','verified','b'.repeat(64)));
});
function mount(fetcher,Component=ProductDetailAssetImport,extra={}){
 const states=[];const effects=[];let index=0;const memo=(fn,deps)=>{const i=index++;const old=states[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j])))states[i]={deps,value:fn()};return states[i].value;};const internals=React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
 const dispatcher={useState(initial){const i=index++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){const i=index++;return states[i]??=( {current:initial});},useMemo: memo,useCallback(fn,deps){return memo(()=>fn,deps);},useEffect(fn,deps){const i=index++;const old=states[i];if(!old||deps.some((d,j)=>!Object.is(d,old[j]))){states[i]=deps;effects.push(fn);}}};
 const render=()=>{index=0;const prior=internals.H;internals.H=dispatcher;try{return Component({productId:context.productId,currentVersion:7,authenticatedFetch:fetcher,onImported:async()=>{refreshes++;},...extra});}finally{internals.H=prior;}};
 let refreshes=0;
 function nodes(v,result=[]){if(Array.isArray(v))v.forEach(x=>nodes(x,result));else if(v&&typeof v==='object'){result.push(v);nodes(v.props?.children,result);}return result;}
 const text=v=>Array.isArray(v)?v.map(text).join(''):v&&typeof v==='object'?text(v.props?.children):String(v??'');
 const find=predicate=>nodes(render()).find(predicate);
 const button=name=>find(n=>n.type==='button'&&text(n).includes(name));
 return {button,find,render,text,async flushEffects(){render();for(const effect of effects.splice(0))effect();await new Promise(resolve=>setImmediate(resolve));},get refreshes(){return refreshes;}};
}
test('actual component runs reserve, exactly 8 uploads, verify, then separately explicit approve with mock fetch only',async()=>{
 const calls=[];let row;const f=files();
 const ui=mount(async(url,init)=>{
  calls.push({url,init});if(url.endsWith('/publish-context'))return Response.json(publication(row));if(url.includes('?importId=')&&!init)return Response.json({import:row});if(!init)return Response.json(row?.status==='approved'?approvedContext():context);
  if(init.method==='PUT')return Response.json({ok:true});
  const body=JSON.parse(init.body);
  if(body.action==='reserve'){row=await makeRow(body);assert.equal(body.request.expectedProductUpdatedAt,context.productUpdatedAt);return Response.json({import:row});}
  if(body.action==='verify')return Response.json({import:{...row,status:'verified'}});
  if(body.action==='approve'){assert.equal(body.reviewConfirmed,true);assert.equal(body.requestSha256,row.request_sha256);row={...row,status:'approved',current:true,approved_detail_version:8,approved_product_updated_at:approvedContext().productUpdatedAt};return Response.json({import:row});}
  throw Error('Unexpected request');
 });
 assert.equal(calls.length,0);assert.equal(ui.button('현재 상품').props.disabled,false);
 await ui.button('현재 상품').props.onClick();
 ui.find(n=>n.type==='textarea').props.onChange({target:{value:JSON.stringify(pkg())}});
 ui.button('패키지 검수').props.onClick();
 assert.equal(ui.button('원본 8장').props.disabled,true);
 for(const role of roles){ui.find(n=>n.type==='input'&&n.props['aria-label']===role+' PNG 원본').props.onChange({target:{files:[f[role]]}});ui.find(n=>n.type==='img'&&n.props.alt===role).props.onLoad();}
 for(let i=0;i<6;i++){const boxes=[];function collect(v){if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object'){if(v.type==='input'&&v.props.type==='checkbox')boxes.push(v);collect(v.props?.children);}}collect(ui.render());boxes[i].props.onChange({target:{checked:true}});}
 assert.equal(ui.button('원본 8장').props.disabled,false);
 await ui.button('원본 8장').props.onClick();
 assert.equal(calls.filter(c=>c.init?.method==='PUT').length,8);
 assert.equal(calls.some(c=>c.init?.method==='POST'&&JSON.parse(c.init.body).action==='approve'),false);
 assert.equal(ui.button('검증된 외부 가져오기 명시적 승인').props.disabled,true);
 const boxes=[];function collect(v){if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object'){if(v.type==='input'&&v.props.type==='checkbox')boxes.push(v);collect(v.props?.children);}}collect(ui.render());boxes.at(-1).props.onChange({target:{checked:true}});
 await ui.button('검증된 외부 가져오기 명시적 승인').props.onClick();
 assert.equal(ui.refreshes,1);assert.match(ui.text(ui.render()),/서버 승인본 재결속 확인/);assert.match(ui.text(ui.render()),/AI Studio 품질·게시 guard는 별도 보존/);assert.ok(calls.some(c=>c.url.includes('?importId=')&&!c.init));assert.ok(calls.some(c=>c.url.endsWith('/publish-context')));
});

test('mock 409 and 503 never claim import success or issue uploads',async()=>{
 for(const status of [409,503]){let count=0;const ui=mount(async()=>{count++;return Response.json({code:status===409?'EXTERNAL_DETAIL_VERSION_CONFLICT':'EXTERNAL_DETAIL_BACKEND_UNAVAILABLE'},{status});});await ui.button('현재 상품').props.onClick();assert.equal(count,1);assert.match(ui.text(ui.render()),new RegExp(String(status)));assert.doesNotMatch(ui.text(ui.render()),/가져오기 승인 확인/);assert.equal(ui.button('검증된 외부 가져오기 명시적 승인'),undefined);}
});

function approvedContext(){return {...context,detailVersion:8,productUpdatedAt:'2026-09-05T01:03:04.123456+00:00'};}
async function makeRow(body,status='reserved'){
 const payload={contract:'sellerpilot_external_detail_import_v1',actorId:context.ownerId,ownerId:context.ownerId,...body.request,assets:body.request.assets.map(a=>({...a,storagePath:'external-detail/'+context.ownerId+'/'+context.productId+'/'+body.request.importId+'/'+a.assetId+'/'+a.sourceSha256+'.png'})),reviewedCopy:{},audit:body.audit,originalEvidence:[{path:'fixture',sha256:'a'.repeat(64)}]};
 for(const locale of ['ko','ja','en'])payload.reviewedCopy[locale]={...body.reviewedCopy[locale],documentSha256:await externalImportDigest(body.reviewedCopy[locale].document)};
 const sha=await externalImportDigest(payload);
 return {id:body.request.importId,product_id:context.productId,owner_id:context.ownerId,status,request_sha256:sha,payload:{...payload,requestSha256:sha},expires_at:new Date(Date.now()+3600000).toISOString(),current:status==='approved',approved_detail_version:status==='approved'?8:null,approved_product_updated_at:status==='approved'?approvedContext().productUpdatedAt:null};
}
function publication(row,token='one') {return {externalDetailImportStatus:'available',detailPage:{version:8,data:row.payload.reviewedCopy.ko.document},externalDetailImport:{...row,manifest:{contract:'sellerpilot_external_detail_manifest_v1',source:'external_generated',importId:row.id,requestSha256:row.request_sha256,version:8,reviewedCopy:row.payload.reviewedCopy},signedImages:row.payload.assets.map(a=>({...a,path:a.storagePath,url:'https://signed.invalid/'+a.role+'?token='+token}))}};}
async function fixture(status='approved'){const request=await prepareExternalImportRequest(context,pkg(),files());return makeRow({request,reviewedCopy:pkg().reviewedCopy,audit:pkg().audit},status);}
test('reload binds real docs and accepts rotated signed URLs without changing identity',async()=>{
 const row=await fixture();const bound=await bindExternalImportRow(row,approvedContext(),row.id);
 const first=await bindExternalImportSignedView(bound,approvedContext(),publication(row));const rotated=await bindExternalImportSignedView(bound,approvedContext(),publication(row,'two'));
 assert.equal(first.identity,rotated.identity);assert.notEqual(first.urls[roles[0]],rotated.urls[roles[0]]);
 for(const mutate of [p=>p.detailPage.version++,p=>p.externalDetailImport.id='wrong',p=>p.externalDetailImport.current=false,p=>p.externalDetailImport.signedImages[0].sourceSha256='b'.repeat(64),p=>p.externalDetailImport.signedImages[0].path='wrong',p=>p.externalDetailImport.manifest.reviewedCopy.ja.document.content[0].props.body='Changed']){const p=structuredClone(publication(row));mutate(p);await assert.rejects(()=>bindExternalImportSignedView(bound,approvedContext(),p));}
 const tampered=structuredClone(row);tampered.payload.reviewedCopy.en.document.content[0].props.body='tampered';await assert.rejects(()=>bindExternalImportRow(tampered,approvedContext(),row.id));
});
test('partial resume preserves import and assets; expiration and every version fence fail closed',async()=>{
 const row=await fixture('reserved');const bound=await bindExternalImportRow(row,context,row.id);assert.equal(bound.request.importId,row.id);assert.deepEqual(bound.request.assets.map(a=>a.assetId),row.payload.assets.map(a=>a.assetId));assert.equal(externalImportDraftBlock(bound,context),null);
 assert.match(externalImportDraftBlock({...bound,row:{...row,expires_at:new Date(0).toISOString()}},context),/만료/);
 for(const patch of [{detailVersion:8},{productUpdatedAt:'different-microseconds'},{aiJobId:'different-job'}])assert.match(externalImportDraftBlock(bound,{...context,...patch}),/변경/);
});
test('same target Studio stays valid during pending import; stale external doc never becomes Studio',()=>{
 for(const status of ['reserved','verified'])assert.equal(savedDetailSource({externalDetailImportStatus:'available',externalDetailImport:{status},detailPage:{version:7}}),'studio');
 assert.equal(savedDetailSource({externalDetailImportStatus:'available',externalDetailImport:null,detailPage:{version:7}}),'studio');
 assert.equal(savedDetailSource({externalDetailImportStatus:'available',externalDetailImport:{status:'approved',current:false,approved_detail_version:8},detailPage:{version:8}}),'external');
 assert.equal(savedDetailSource({externalDetailImportStatus:'available',externalDetailImport:{status:'approved',current:false,approved_detail_version:8},detailPage:{version:9}}),'studio');
 assert.equal(savedDetailSource({externalDetailImportStatus:'unavailable'}),'unknown');
});

function selectOriginalsAndReview(ui,chosen=files()){
 const f=chosen;for(const role of roles){ui.find(n=>n.type==='input'&&n.props['aria-label']===role+' PNG 원본').props.onChange({target:{files:[f[role]]}});ui.find(n=>n.type==='img'&&n.props.alt===role).props.onLoad();}
 for(let i=0;i<6;i++){const boxes=[];function collect(v){if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object'){if(v.type==='input'&&v.props.type==='checkbox')boxes.push(v);collect(v.props?.children);}}collect(ui.render());boxes[i].props.onChange({target:{checked:true}});}
}
test('fresh component reloads approved server docs and signed images without files or approval POST',async()=>{
 const row=await fixture();const calls=[];let token='first';
 const ui=mount(async(url,init)=>{calls.push({url,init});if(url.endsWith('/publish-context'))return Response.json(publication(row,token));if(url.includes('?importId='))return Response.json({import:row});return Response.json({...approvedContext(),externalDetailImport:row});});
 await ui.button('현재 상품').props.onClick();assert.match(ui.text(ui.render()),/서버 승인본 재결속 확인/);const identity=ui.find(n=>n.props?.['data-external-identity']).props['data-external-identity'];assert.equal(ui.find(n=>n.type==='img').props.src,publication(row,token).externalDetailImport.signedImages[0].url);
 token='rotated';await ui.button('현재 상품').props.onClick();assert.equal(ui.find(n=>n.props?.['data-external-identity']).props['data-external-identity'],identity);assert.match(ui.find(n=>n.type==='img').props.src,/rotated/);assert.equal(calls.some(c=>['POST','PUT'].includes(c.init?.method)),false);
});
test('actual partial upload interruption resumes same immutable IDs after fresh GET and original reselection',async()=>{
 let row=await fixture('reserved');let puts=0;let interrupt=true;const ids=[];
 const ui=mount(async(url,init)=>{if(!init){if(url.includes('?importId='))return Response.json({import:row});return Response.json(context);}if(init.method==='PUT'){puts++;if(interrupt&&puts===4)return Response.json({code:'EXTERNAL_DETAIL_UPLOAD_UNAVAILABLE'},{status:503});return Response.json({ok:true});}const body=JSON.parse(init.body);ids.push(body.importId??body.request?.importId);if(body.action==='reserve')return Response.json({import:row});if(body.action==='verify'){row={...row,status:'verified'};return Response.json({import:row});}throw Error('Unexpected POST');});
 ui.find(n=>n.type==='input'&&n.props.value==='').props.onChange({target:{value:row.id}});await ui.button('현재 상품').props.onClick();selectOriginalsAndReview(ui);await ui.button('원본 8장').props.onClick();assert.equal(puts,4);assert.match(ui.text(ui.render()),/503/);
 interrupt=false;await ui.button('현재 상품').props.onClick();selectOriginalsAndReview(ui);await ui.button('원본 8장').props.onClick();assert.equal(puts,12);assert.ok(ids.every(id=>id===row.id));assert.match(ui.text(ui.render()),/서버 바이트 검증 완료/);assert.equal(ui.button('검증된 외부 가져오기 명시적 승인').props.disabled,true);
});
test('expired and competing version reservations disable actual UI upload and approval',async()=>{
 for(const kind of ['expired','version']){const row=await fixture('verified');if(kind==='expired')row.expires_at=new Date(0).toISOString();let mutations=0;
 const ui=mount(async(url,init)=>{if(init)mutations++;return Response.json(url.includes('?importId=')?{import:row}:kind==='version'?{...context,detailVersion:9}:context);});
 ui.find(n=>n.type==='input'&&n.props.value==='').props.onChange({target:{value:row.id}});await ui.button('현재 상품').props.onClick();assert.match(ui.text(ui.render()),kind==='expired'?/만료됐습니다/:/변경됐습니다/);assert.equal(ui.button('원본 8장').props.disabled,true);assert.equal(ui.button('검증된 외부 가져오기 명시적 승인').props.disabled,true);assert.equal(mutations,0);}
});

test('whole Saved page restores valid same-product Studio path and explicitly separates external source, retaining fallback guard',async()=>{
 const base={source:{studioQuality:{blockedForPublication:false},product:{},design:{}},initialDetailPage:{data:doc(),version:7,updatedAt:null,approvedVersion:null,imageManifest:null},assetUrls:Object.fromEntries(roles.map(r=>[r,'https://studio.invalid/'+r])),notify:()=>{}};
 for(const external of [null,{status:'reserved'},{status:'verified'}]){
  const ui=mount(async()=>Response.json({detailPage:base.initialDetailPage,externalDetailImportStatus:'available',externalDetailImport:external}),SavedProductDetailPage,base);await ui.flushEffects();assert.equal(ui.button('상세페이지 다시 편집').props.disabled,false);assert.equal(ui.find(n=>n.props?.result===base.source&&n.props?.data)?.props.data.content.length,8);
 }
 const row=await fixture();const externalUi=mount(async()=>Response.json({...publication(row),detailPage:{...base.initialDetailPage,version:8,data:row.payload.reviewedCopy.ko.document}}),SavedProductDetailPage,base);await externalUi.flushEffects();const studioPreview=externalUi.find(n=>n.props?.result===base.source&&'data' in n.props);assert.equal(studioPreview.props.data,null);assert.match(studioPreview.props.assetUrls[roles[0]],/studio\.invalid/);externalUi.button('external_generated 외부 검수').props.onClick();assert.equal(externalUi.button('상세페이지 다시 편집').props.disabled,true);assert.equal(externalUi.find(n=>n.props?.result===base.source&&'data' in n.props),undefined);
 const notices=[];const degraded={...base,source:{...base.source,studioQuality:{blockedForPublication:true,message:'Fallback blocked'}},notify:m=>notices.push(m)};let writes=0;
 const fallback=mount(async(url,init)=>{if(init?.method==='PUT')writes++;return Response.json({detailPage:base.initialDetailPage,externalDetailImportStatus:'available',externalDetailImport:null});},SavedProductDetailPage,degraded);await fallback.flushEffects();fallback.button('상세페이지 다시 편집').props.onClick();const editor=fallback.find(n=>typeof n.props?.onSave==='function');await editor.props.onSave(doc());assert.equal(writes,0);assert.deepEqual(notices,['Fallback blocked']);
});

test('approve POST alone cannot claim success when follow-up GET loses the version race',async()=>{
 let row=await fixture('verified');let posted=false;let readsAfterApprove=0;
 const ui=mount(async(url,init)=>{if(!init){if(posted)readsAfterApprove++;return Response.json(url.includes('?importId=')?{import:row}:posted?{...approvedContext(),detailVersion:9}:context);}const body=JSON.parse(init.body);assert.equal(body.action,'approve');posted=true;row={...row,status:'approved',current:false,approved_detail_version:8,approved_product_updated_at:approvedContext().productUpdatedAt};return Response.json({import:row});});
 ui.find(n=>n.type==='input'&&n.props.value==='').props.onChange({target:{value:row.id}});await ui.button('현재 상품').props.onClick();selectOriginalsAndReview(ui);
 const boxes=[];function collect(v){if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object'){if(v.type==='input'&&v.props.type==='checkbox')boxes.push(v);collect(v.props?.children);}}collect(ui.render());boxes.at(-1).props.onChange({target:{checked:true}});await ui.button('검증된 외부 가져오기 명시적 승인').props.onClick();assert.equal(posted,true);assert.equal(readsAfterApprove,2);assert.equal(ui.refreshes,0);assert.equal(ui.find(n=>n.props?.['data-external-identity']),undefined);assert.doesNotMatch(ui.text(ui.render()),/서버 승인본 재결속 확인/);assert.match(ui.text(ui.render()),/현재 승인본을 확인하지 못했습니다/);
});

test('verified resume refuses approval if the locally reviewed original was replaced',async()=>{
 const row=await fixture('verified');let posts=0;const ui=mount(async(url,init)=>{if(init)posts++;return Response.json(url.includes('?importId=')?{import:row}:context);});
 ui.find(n=>n.type==='input'&&n.props.value==='').props.onChange({target:{value:row.id}});await ui.button('현재 상품').props.onClick();const replaced=files();replaced[roles[0]]=new File(['different original'],'changed.png',{type:'image/png'});selectOriginalsAndReview(ui,replaced);
 const boxes=[];function collect(v){if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object'){if(v.type==='input'&&v.props.type==='checkbox')boxes.push(v);collect(v.props?.children);}}collect(ui.render());boxes.at(-1).props.onChange({target:{checked:true}});await ui.button('검증된 외부 가져오기 명시적 승인').props.onClick();assert.equal(posts,0);assert.match(ui.text(ui.render()),/미리보기 파일이 검증된 원본과 다릅니다/);assert.equal(ui.refreshes,0);
});

test('P1 regression: actual Puck onPublish -> external onSave -> canonical serializer -> real server copy validation for ko/ja/en',async()=>{
 let requests=0;const ui=mount(async()=>{requests++;return Response.json(context);});await ui.button('현재 상품').props.onClick();ui.find(n=>n.type==='textarea').props.onChange({target:{value:JSON.stringify(pkg())}});ui.button('패키지 검수').props.onClick();selectOriginalsAndReview(ui);
 for(const locale of ['ko','ja','en']){
  ui.button(locale+' Puck 문안 수정').props.onClick();const ownerEditor=ui.find(n=>typeof n.props?.onSave==='function');assert.ok(ownerEditor);
  const actualEditor=mount(async()=>{throw Error('No editor network');},ProductDetailEditor,ownerEditor.props);const puck=actualEditor.find(n=>typeof n.props?.onPublish==='function');assert.ok(puck);assert.ok(puck.props.data.content.every(b=>b.props.imageUrl.startsWith('blob:')));
  const edited=structuredClone(puck.props.data);edited.content[0].props.body+=' Reviewed '+locale;await puck.props.onPublish(edited);
  assert.equal(ui.find(n=>typeof n.props?.onSave==='function'),undefined,'Puck editor must close after a real successful local save');
  const saved=JSON.parse(ui.find(n=>n.type==='textarea').props.value);assert.equal(saved.reviewedCopy[locale].document.root.props.locale,locale);assert.match(saved.reviewedCopy[locale].document.content[0].props.body,new RegExp('Reviewed '+locale));assert.ok(saved.reviewedCopy[locale].document.content.every((b,i)=>b.props.imageUrl==='sellerpilot-asset://'+roles[i]));
  const server=bindExternalDetailCopy(saved.reviewedCopy,roles);for(const lang of ['ko','ja','en'])assert.equal(server[lang].documentSha256,await externalImportDigest(saved.reviewedCopy[lang].document));
 }
 assert.equal(requests,1,'editing/canonicalization must not invoke an operational API');
 const editedPackage=JSON.parse(ui.find(n=>n.type==='textarea').props.value);const request=await prepareExternalImportRequest(context,editedPackage,files());const row=await makeRow({request,reviewedCopy:editedPackage.reviewedCopy,audit:editedPackage.audit},'approved');
 const reloaded=mount(async(url)=>Response.json(url.endsWith('/publish-context')?publication(row):url.includes('?importId=')?{import:row}:{...approvedContext(),externalDetailImport:row}));await reloaded.button('현재 상품').props.onClick();
 for(const locale of ['ko','ja','en']){const preview=reloaded.find(n=>n.props?.locale===locale&&n.props?.result===null);assert.deepEqual(preview.props.data,editedPackage.reviewedCopy[locale].document);}
 assert.match(reloaded.text(reloaded.render()),/서버 승인본 재결속 확인/);
});

test('Qt exact eight-blob fixture succeeds only through external serializer; legacy HTTPS guard remains unchanged',()=>{
 const urls=Object.fromEntries(roles.map((role,i)=>[role,`blob:https://ui.invalid/local-${i}`]));
 const document={root:{},content:roles.map((role,i)=>({type:'ImageStoryBlock',props:{id:`image-${i}`,imageRole:role,imageUrl:urls[role],imageAlt:'Local fixture',caption:'Staged props are excluded.',body:'Staged props are excluded.'}}))};
 assert.throws(()=>makeValidatedProductDetailPersistable(document,urls),/현재 운영 접근 경로/);
 const before=structuredClone(document);const canonical=makeExternalImportDocumentCanonical(document,pkg().assets,urls);assert.deepEqual(document,before);
 assert.equal(Object.keys(bindExternalDetailCopy(Object.fromEntries(['ko','ja','en'].map(locale=>[locale,{document:canonical,reviewNote:'Local test only'}])),roles)).length,3);
 assert.ok(canonical.content.every((block,i)=>block.props.imageUrl==='sellerpilot-asset://'+roles[i]));
});
test('external canonical documents and copy hashes stay identical across exact signed URL map refresh',async()=>{
 const map=token=>Object.fromEntries(roles.map(role=>[role,`https://signed.invalid/${role}?token=${token}`]));
 const document=urls=>({...doc(),content:doc().content.map((block,i)=>({...block,props:{...block.props,imageUrl:urls[roles[i]]}}))});
 const first=makeExternalImportDocumentCanonical(document(map('old')),pkg().assets,map('old'));const renewed=makeExternalImportDocumentCanonical(document(map('new')),pkg().assets,map('new'));
 assert.deepEqual(first,renewed);assert.equal(await externalImportDigest(first),await externalImportDigest(renewed));assert.throws(()=>makeExternalImportDocumentCanonical(document(map('old')),pkg().assets,map('new')),/현재 역할에 결속되지/);
 assert.deepEqual(makeExternalImportDocumentCanonical(first,pkg().assets,map('new')),first);
});
test('external serializer rejects arbitrary, cross-role, stale blob and non-bound image references',()=>{
 const urls=Object.fromEntries(roles.map((role,i)=>[role,'blob:https://ui.invalid/current-'+i]));
 const base={...doc(),content:doc().content.map((block,i)=>({...block,props:{...block.props,imageUrl:urls[roles[i]]}}))};
 for(const wrong of ['blob:https://ui.invalid/arbitrary','https://elsewhere.invalid/any.png','data:image/png;base64,AA==',urls[roles[1]],'sellerpilot-asset://'+roles[1]]){const d=structuredClone(base);d.content[0].props.imageUrl=wrong;assert.throws(()=>makeExternalImportDocumentCanonical(d,pkg().assets,urls),/현재 역할에 결속되지/);}
 assert.throws(()=>makeExternalImportDocumentCanonical(base,pkg().assets,{...urls,[roles[0]]:''}));assert.throws(()=>makeExternalImportDocumentCanonical(base,pkg().assets,{...urls,[roles[1]]:urls[roles[0]]}));
 const extra=structuredClone(base);extra.content.push({type:'StoryBlock',props:{id:'unexpected-image',imageUrl:urls[roles[0]]}});assert.throws(()=>makeExternalImportDocumentCanonical(extra,pkg().assets,urls),/블록 밖/);
 const swapped=structuredClone(base);[swapped.content[0],swapped.content[1]]=[swapped.content[1],swapped.content[0]];assert.throws(()=>makeExternalImportDocumentCanonical(swapped,pkg().assets,urls),/역할·순서/);
});

// Original Qt baseline intentionally retains the legacy HTTPS-only rejection.
test('P1 reproduction: external local editor rejects valid blob-backed eight-image document',()=>{
 const roles=defaultProductDetailImageRoles;
 const urls=Object.fromEntries(roles.map((role,i)=>[role,`blob:https://ui.invalid/local-${i}`]));
 const document={root:{},content:roles.map((role,i)=>({type:'ImageStoryBlock',props:{id:`image-${i}`,imageRole:role,imageUrl:urls[role],imageAlt:'Local fixture',caption:'Staged props are excluded.',body:'Staged props are excluded.'}}))};
 assert.throws(()=>makeValidatedProductDetailPersistable(document,urls),/현재 운영 접근 경로/);
 const canonical={...document,content:document.content.map((block,i)=>({...block,props:{...block.props,imageUrl:`sellerpilot-asset://${roles[i]}`}}))};
 assert.equal(Object.keys(bindExternalDetailCopy(Object.fromEntries(['ko','ja','en'].map(locale=>[locale,{document:canonical,reviewNote:'Local test only'}])),roles)).length,3);
});

// Real route plus in-memory SQL hash conformance; fixtures have their own scope.
{
const owner='11111111-1111-4111-8111-111111111111';
// Follow the route's static allow-list constant, never look up any operating row.
const {externalDetailImportTarget:productId}=await import('../lib/server-external-detail-import-api.ts');
const context={productId,ownerId:owner,productUpdatedAt:'2026-09-05T01:02:03.123456+00:00',detailVersion:7,aiJobId:null,sourceImagePaths:[owner+'/fixture-original.png']};
const roles=['detail-overview','detail-feature','detail-use','detail-package','detail-routine','detail-dimensions','detail-contents','detail-care'];
const original=new Uint8Array([137,80,78,71,13,10,26,10,9]);
const originalSha=createHash('sha256').update(original).digest('hex');
async function sqlFixture(){
 const db=new PGlite();
 const migration=await readFile(new URL('../supabase/migrations/20260906053000_external_detail_publication_lifecycle.sql',import.meta.url),'utf8');
 const start=migration.indexOf('create function sellerpilot_private.external_detail_canonical(');
 const end=migration.indexOf('create function sellerpilot_private.external_detail_import_is_current(',start);
 assert.ok(start>=0&&end>start);
 await db.exec('create schema sellerpilot_private;');
 await db.exec(migration.slice(start,end));
 await db.exec('create table local_route_receipts(id text primary key,payload jsonb not null)');
 return db;
}
async function sqlHash(db,value){const result=await db.query('select sellerpilot_private.external_detail_hash($1::jsonb) as hash,sellerpilot_private.external_detail_canonical($1::jsonb) as canonical',[JSON.stringify(value)]);return result.rows[0];}
function document(locale){const caption={ko:'연출 소품은 구성에 포함되지 않습니다.',ja:'演出用の小物は商品に含まれません。',en:'Staged props are not included.'}[locale];return {root:{props:{locale,a:1,A:2,'10':'숫자 키 열','2':'숫자 키 둘','한글':'각 가 가',numeric:[0,-0,1.25,0.000001,1e20],nested:{z:false,Z:null,'가':'검수'}}},content:roles.map((role,i)=>({type:'ImageStoryBlock',props:{id:'image-'+i,imageRole:role,imageUrl:'blob:https://ui.invalid/current-'+i,imageAlt:'검수 fixture '+i,caption,body:caption+' '+locale}}))};}
function packageFixture(){const urls=Object.fromEntries(roles.map((r,i)=>[r,'blob:https://ui.invalid/current-'+i]));const assets=roles.map(role=>({role,alt:'정식 검수 fixture',caption:'연출 이미지 fixture'}));return {source:{kind:'external_generated',tool:'Mock external fixture',referenceSha256s:[originalSha]},assets,reviewedCopy:Object.fromEntries(['ko','ja','en'].map(locale=>[locale,{document:makeExternalImportDocumentCanonical(document(locale),assets,urls),reviewNote:'정식 검수 JSON fixture '+locale}])),audit:{rightsBasis:'Test fixture, no operational rights claim',limitations:'연출 fixture only',sourceReferences:[{label:'원본 fixture',sha256:originalSha}]}};}
async function routeFixture(db,draft){
 let captured=null;let storageReads=0;let reserves=0;
 globalThis.__detailCanonicalAdminFixture={user:{id:owner},serviceClient:{
  storage:{from(bucket){assert.equal(bucket,'sellerpilot-ai');return {async download(path){storageReads++;assert.equal(path,context.sourceImagePaths[0]);return {data:new Blob([original]),error:null};}};}},
  async rpc(name,args){assert.equal(name,'sellerpilot_service_external_detail_import');assert.equal(args.p_actor,owner);assert.equal(args.p_product,productId);
   if(args.p_action==='context')return {data:context,error:null};
   if(args.p_action==='get')return {data:null,error:{message:'EXTERNAL_DETAIL_NOT_FOUND'}};
   assert.equal(args.p_action,'reserve');reserves++;captured=args.p_payload;
   await db.query('insert into local_route_receipts values($1,$2::jsonb)',[args.p_import,JSON.stringify(captured)]);
   return {data:{id:args.p_import,product_id:productId,owner_id:owner,status:'reserved',request_sha256:captured.requestSha256,payload:captured},error:null};
  }
 }};
 const files=Object.fromEntries(roles.map((role,i)=>[role,new File([new Uint8Array([137,80,78,71,13,10,26,10,i])],role+'.png',{type:'image/png'})]));
 const request=await prepareExternalImportRequest(context,draft,files);
 const wire=JSON.stringify({action:'reserve',request,reviewedCopy:draft.reviewedCopy,audit:draft.audit});
 try {const response=await POST(new Request('https://local-test.invalid/api/admin/products/'+productId+'/detail-assets/import',{method:'POST',headers:{'Content-Type':'application/json'},body:wire}),{params:Promise.resolve({id:productId})});return {response,captured,storageReads,reserves,wire};}
 finally {delete globalThis.__detailCanonicalAdminFixture;}
}
test('UI imports the identical shared canonical function, not a locale-dependent copy',()=>{assert.equal(externalImportCanonical,externalDetailCanonical);assert.equal(externalImportCanonical({a:2,A:1}),'\u007b"A":1,"a":2}');});
test('UTF-8 key order, Korean text, arrays and ordinary numeric boundaries match UI/server/actual SQL',async()=>{
 const db=await sqlFixture();try{
  const vectors=[{a:2,A:1},{'2':'둘','10':'열','가':'한글','각':'日本語','가':'NFD',Z:'A',z:'z'}, {[String.fromCodePoint(0x1f600)]:'astral','\uE000':'private-use'},[0,-0,1,-1,1.25,-1.25,1e-6,-1e-6,1e20,-1e20],{a:[],b:{},c:true,d:null,e:'quote " slash \\ newline\n한글'}];
  for(const value of vectors){const sql=await sqlHash(db,value);assert.equal(sql.canonical,externalImportCanonical(value));assert.equal(sql.hash,await externalImportDigest(value));assert.equal(sql.hash,externalDetailDigest(value));}
  const forward={a:1,A:2,'가':3};const reverse=Object.fromEntries(Object.entries(forward).reverse());assert.equal(await externalImportDigest(forward),await externalImportDigest(reverse));
 }finally{await db.close();}
});
test('same reviewed ko/ja/en JSON passes actual route and produces identical UI/route/SQL document and reservation hashes',async()=>{
 const db=await sqlFixture();try{
  const draft=packageFixture();const {response,captured,reserves,wire}=await routeFixture(db,draft);assert.equal(response.status,200,await response.text());assert.equal(reserves,1);assert.ok(captured);
  const input=JSON.parse(wire);
  for(const locale of ['ko','ja','en']){
   const copy=input.reviewedCopy[locale].document;const ui=await externalImportDigest(copy);assert.equal(captured.reviewedCopy[locale].documentSha256,ui);
   const sql=await db.query('select sellerpilot_private.external_detail_hash(payload #> $1::text[]) as hash from local_route_receipts',[[ 'reviewedCopy',locale,'document' ]]);assert.equal(sql.rows[0].hash,ui);assert.deepEqual(captured.reviewedCopy[locale].document,copy);
  }
  const {requestSha256,...raw}=captured;const ui=await externalImportDigest(raw);const sql=await db.query("select sellerpilot_private.external_detail_hash(payload-'requestSha256') as hash from local_route_receipts");assert.equal(ui,requestSha256);assert.equal(sql.rows[0].hash,requestSha256);
 }finally{await db.close();}
});
test('exponent-ambiguous numeric values fail UI/server and actual route before reservation SQL',async()=>{
 for(const value of [1e-7,-1e-7,1e21,-1e21]){assert.throws(()=>externalImportCanonical({n:value}),/NUMBER_RANGE/);assert.throws(()=>externalDetailDigest({n:value}),/NUMBER_RANGE/);await assert.rejects(()=>externalImportDigest({n:value}),/NUMBER_RANGE/);}
 const db=await sqlFixture();try{const draft=packageFixture();draft.reviewedCopy.ko.document.root.props.numeric=[1e-7];const {response,reserves,captured}=await routeFixture(db,draft);assert.equal(response.status,409);assert.equal(reserves,0);assert.equal(captured,null);assert.equal((await db.query('select count(*)::int as n from local_route_receipts')).rows[0].n,0);}finally{await db.close();}
});

}
