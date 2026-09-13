import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const center=await readFile(new URL('../app/api-credential-center.tsx',import.meta.url),'utf8');
const actor='11111111-1111-4111-8111-111111111111', credential='22222222-2222-4222-8222-222222222222',session='33333333-3333-4333-8333-333333333333';
const state='sellerpilot-lazada-im-cb-'+'a'.repeat(32);
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const start=source.indexOf('    const startLazadaImExact = async');
const end=source.indexOf('    const listener =',start);
assert.ok(start>0&&end>start);
const startJs=compile(source.slice(start,end)+'\nreturn startLazadaImExact;');
for(const scenario of ['prepare','ready','no-worker','wrong-actor','bad-origin','bad-app','bad-country','bad-redirect','bad-state']){
 test('Lazada IM start '+scenario,async()=>{
  const calls=[],redirects=[],stored=[],messages=[];
  const url=new URL('https://auth.lazada.com/oauth/authorize');
  url.search=new URLSearchParams({state,client_id:'137571',country:'cb',redirect_uri:'https://sellerpilot-global.vercel.app/'}).toString();
  if(scenario==='bad-origin')url.hostname='wrong.invalid';
  if(scenario==='bad-app')url.searchParams.set('client_id','137451');
  if(scenario==='bad-country')url.searchParams.set('country','my');
  if(scenario==='bad-redirect')url.searchParams.set('redirect_uri','https://wrong.invalid/');
  if(scenario==='bad-state')url.searchParams.set('state','sellerpilot-lazada-my-'+'a'.repeat(32));
  const deps={userId:actor,lazadaImExactStarting:{current:false},createSupabaseClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:scenario==='wrong-actor'?'different':actor},access_token:'synthetic-session-token'}}})}}),
   readLazadaImExactBrowserSession:()=>scenario==='prepare'?null:{credentialId:credential,sessionId:session,actorId:actor,expiresAt:Date.now()+60000},
   fetch:async(path,init)=>{const body=JSON.parse(init.body);calls.push({path,body});return{ok:true,json:async()=>body.action==='prepare'?{status:'executor_required',sessionId:session}:scenario==='no-worker'?{status:'executor_required'}:{status:'ready',authorizationUrl:url.toString()}};},
   window:{location:{origin:'https://sellerpilot-global.vercel.app',assign:u=>redirects.push(u)},sessionStorage:{setItem:(key,value)=>stored.push({key,value})}},
   lazadaImExactBrowserKey:'sellerpilot.lazada-im-exact-session.v1',setOAuthToastMessage:v=>messages.push(v),URL};
  await new Function(...Object.keys(deps),startJs)(...Object.values(deps))({detail:{credentialId:credential}});
  assert.equal(redirects.length,scenario==='ready'?1:0);
  assert.ok(calls.every(c=>c.path==='/api/admin/channel-credentials/lazada/im-exact'));
  if(scenario==='prepare')assert.deepEqual(calls.map(c=>c.body.action),['prepare']);
  if(scenario==='wrong-actor')assert.equal(calls.length,0);
  assert.ok(stored.every(v=>!v.value.includes('synthetic-session-token')));
 });
}
const cbStart=source.indexOf('    const completeChannelOAuth = async');
const cbEnd=source.indexOf('    void completeChannelOAuth();',cbStart);
const callback=compile(source.slice(cbStart,cbEnd)+'\nreturn completeChannelOAuth;');
for(const scenario of ['bound','state-mismatch','missing-session','bind-rejected']){
 test('Lazada IM callback '+scenario,async()=>{
  const calls=[],removed=[],messages=[];
  const deps={pendingChannelOAuth:{channel:'lazada',code:'synthetic-once-code',state},userId:actor,
   createSupabaseClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:actor},access_token:'synthetic-session-token'}}})}}),
   readLazadaImExactBrowserSession:()=>scenario==='missing-session'?null:{sessionId:session,credentialId:credential,state:scenario==='state-mismatch'?'wrong':state},
   fetch:async(path,init)=>{calls.push({path,body:JSON.parse(init.body)});return{ok:scenario!=='bind-rejected',json:async()=>({status:scenario==='bind-rejected'?'blocked':'bound'})};},
   window:{sessionStorage:{removeItem:key=>removed.push(key)}},lazadaImExactBrowserKey:'im',setOAuthToastMessage:v=>messages.push(v),setPendingChannelOAuth(){}};
  await new Function(...Object.keys(deps),callback)(...Object.values(deps))();
  assert.equal(calls.length,['state-mismatch','missing-session'].includes(scenario)?0:1);
  assert.ok(calls.every(c=>c.path==='/api/admin/channel-credentials/lazada/im-exact'&&c.body.action==='bind'));
  if(scenario==='bound'){assert.ok(removed.includes('im'));assert.match(messages[0],/연결 완료 전/);}
 });
}
const readStart=source.indexOf('function readLazadaImExactBrowserSession(');
const readEnd=source.indexOf('const lazadaExactBrowserKey',readStart);
const readJs=compile(source.slice(readStart,readEnd)+'\nreturn readLazadaImExactBrowserSession;');
test('IM browser session excludes commerce state, stale actor and expired sessions',()=>{
 const good={sessionId:session,credentialId:credential,actorId:actor,state,expiresAt:Date.now()+60000};
 for(const value of [good,{...good,state:'sellerpilot-lazada-my-'+'a'.repeat(32)},{...good,actorId:'wrong'},{...good,expiresAt:0}]){
  const read=new Function('window','lazadaImExactBrowserKey',readJs)({sessionStorage:{getItem:()=>JSON.stringify(value)}},'im');
  assert.equal(Boolean(read(actor)),value===good);
 }
});
test('credential button dispatches IM-only event without starting commerce OAuth',()=>{
 const ast=ts.createSourceFile('center.tsx',center,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration;
 const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='startLazadaImOAuth')declaration=n;ts.forEachChild(n,visit);};visit(ast);assert.ok(declaration);
 const events=[];const run=new Function('setPendingOAuth','setError','window','CustomEvent',compile('const '+declaration.getText(ast)+';return startLazadaImOAuth;'))(()=>{},()=>{},{dispatchEvent:e=>events.push(e)},class{constructor(type,init){this.type=type;this.detail=init.detail;}});
 run({id:credential,channel:'lazada'});
 assert.equal(events.length,1);assert.equal(events[0].type,'sellerpilot:lazada-im-exact-start');assert.equal(events[0].detail.credentialId,credential);
 assert.match(center,/5개국 CS 권한 연결/);
});
