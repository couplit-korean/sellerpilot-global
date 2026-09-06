// Copy-only regression. Reads actual TSX/SQL; no browser, DB, provider or action call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const runtime=await read('../app/ai-cli-runtime-card.tsx');
const detail=await read('../app/product-detail-asset-import.tsx');
const parse=text=>ts.createSourceFile('copy.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const rt=parse(runtime),dt=parse(detail);
function nodes(root,predicate){const found=[];const walk=n=>{if(predicate(n))found.push(n);ts.forEachChild(n,walk);};walk(root);return found;}
const initializer=(root,name)=>nodes(root,n=>ts.isVariableDeclaration(n)&&n.name.getText(root)===name)[0].initializer;
const compact=text=>text.replace(/\s+/g,'');

test('healthy active runtime with older publication attestation requests SHA binding, not runtime restart',async()=>{
 const sql=await read('../supabase/migrations/20260831050000_channel_scoped_qoo10_publication_gate.sql');
 assert.match(sql,/'runtimeReleaseMatches',\s*coalesce\(\s*sellerpilot_private\.active_serverless_runtime_release_sha\(\)\s*=\s*sellerpilot_private\.attested_listing_publication_release_sha\(\)/);
 const expression=initializer(rt,'exactRuntimeReleaseReady').getText(rt);
 assert.equal(compact(expression),'Boolean(listingRelease.currentRelease&&listingGate?.runtimeReleaseMatches&&listingGate.activeRuntimeRelease===listingRelease.currentRelease,)');
 const ready=new Function('listingRelease','listingGate','return '+expression);
 const labels=nodes(rt,n=>ts.isConditionalExpression(n)&&n.condition.getText(rt)==='exactRuntimeReleaseReady'&&ts.isStringLiteral(n.whenTrue)&&n.whenTrue.text==='현재 SHA 일치');
 assert.equal(labels.length,1);
 const label=(release,gate)=>ready(release,gate)?labels[0].whenTrue.text:labels[0].whenFalse.text;
 const release={currentRelease:'synthetic-current-sha'};
 const active={activeRuntimeRelease:release.currentRelease,runtimeReleaseMatches:false};
 assert.equal(ready(release,active),false);
 assert.equal(label(release,active),'게시 기준·런타임 SHA 결속 확인 필요');
 assert.doesNotMatch(label(release,active),/재검증|재시작|런타임 오류/);
 assert.equal(label(release,{...active,runtimeReleaseMatches:true}),'현재 SHA 일치');
 assert.equal(ready(release,{...active,activeRuntimeRelease:'different',runtimeReleaseMatches:true}),false);
 assert.equal(ready(release,undefined),false);
});

test('external review copy names reviewer evidence and actual files without asserting human or physical inspection',()=>{
 assert.match(detail,/검수 주체와 근거를 명시한 검수·별도 승인이 필요합니다\./);
 assert.match(detail,/패키지 형식 확인\. 아래 실제 파일·문안 검수는 아직 필요합니다\./);
 assert.doesNotMatch(detail,/사람이\s*검수|실물\s*이미지/);
 assert.match(detail,/채널 게시 승인은 아닙니다\./);
});

test('all six checks and the separate verified-revision approval remain mandatory',()=>{
 const localeNode=initializer(dt,'locales');
 const locales=(ts.isAsExpression(localeNode)?localeNode.expression:localeNode).elements.map(n=>n.text);
 assert.deepEqual(locales,['ko','ja','en']);
 const checkExpression=initializer(dt,'allChecked').getText(dt);
 assert.equal(compact(checkExpression),'["facts","rights","limits",...locales].every((key)=>checks[key])');
 const allChecked=new Function('checks','locales','return '+checkExpression);
 const checks=Object.fromEntries(['facts','rights','limits',...locales].map(k=>[k,true]));
 assert.equal(Object.keys(checks).length,6);assert.equal(allChecked(checks,locales),true);
 for(const key of Object.keys(checks))assert.equal(allChecked({...checks,[key]:false},locales),false,key);
 const approval=initializer(dt,'approve');
 const condition=nodes(approval,ts.isIfStatement)[0].expression.getText(dt);
 assert.equal(compact(condition),'!request||!context||receipt?.status!=="verified"||!approved||!ready');
 const rejected=new Function('request','context','receipt','approved','ready','return '+condition);
 assert.equal(rejected({}, {}, {status:'verified'},true,true),false);
 assert.equal(rejected({}, {}, {status:'verified'},false,true),true);
 assert.equal(rejected({}, {}, {status:'reserved'},true,true),true);
 assert.equal(rejected({}, {}, {status:'verified'},true,false),true);
 assert.match(approval.getText(dt),/requestSha256: receipt\.request_sha256, reviewConfirmed: true/);
});
