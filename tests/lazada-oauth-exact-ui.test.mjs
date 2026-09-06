import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');const center=await readFile(new URL('../app/api-credential-center.tsx',import.meta.url),'utf8');
const actor='11111111-1111-4111-8111-111111111111',credential='22222222-2222-4222-8222-222222222222',session='33333333-3333-4333-8333-333333333333';
const start=source.indexOf('    const startExact = async',source.indexOf('sellerpilot:shopee-exact-start", listener);\n  }, [accessState, userId]);'));
assert.ok(start>0);const end=source.indexOf('    const listener =',start);const js=ts.transpileModule(source.slice(start,end)+'\nreturn startExact;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const scenario of ['prepare','no-worker','auth-mismatch','bad-origin','prepare-failure','ready'])test('actual Lazada UI start '+scenario,async()=>{
 const sent=[],redirects=[],toasts=[],stored=[];
 const prepared=scenario==='prepare'||scenario==='prepare-failure'?null:{credentialId:credential,sessionId:session,actorId:actor,expiresAt:Date.now()+60000};
 const deps={userId:actor,lazadaExactStarting:{current:false},createSupabaseClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:scenario==='auth-mismatch'?'other':actor},access_token:'fixture-token'}}})}}),readLazadaExactBrowserSession:()=>prepared,
 window:{sessionStorage:{setItem:(...a)=>stored.push(a)},location:{assign:u=>redirects.push(u)}},lazadaExactBrowserKey:'sellerpilot.lazada-exact-session.v1',setOAuthToastMessage:s=>toasts.push(s),
 fetch:async(url,init)=>{sent.push({url,body:JSON.parse(init.body)});if(scenario==='prepare-failure')return Response.json({status:'blocked'},{status:409});return Response.json(scenario==='prepare'?{status:'executor_required',sessionId:session}:scenario==='no-worker'?{status:'executor_required'}:{status:'ready',authorizationUrl:(scenario==='bad-origin'?'https://evil.invalid':'https://auth.lazada.com')+'/oauth/authorize?state=sellerpilot-lazada-my-fixture'});}};
 const handler=new Function(...Object.keys(deps),js)(...Object.values(deps));await handler({detail:{credentialId:credential}});
 assert.equal(deps.lazadaExactStarting.current,false);assert.ok(sent.every(r=>r.url==='/api/admin/channel-credentials/lazada/exact'));
 assert.equal(redirects.length,scenario==='ready'?1:0);assert.equal(stored.length,scenario==='prepare'?1:0);assert.equal(sent.length,scenario==='auth-mismatch'?0:1);
});
const bindStart=source.indexOf('        if (pendingChannelOAuth.channel === "lazada") {');const bindEnd=source.indexOf('        const response = await fetch(`/api/admin/channel-credentials/${pendingChannelOAuth.channel}/authorize`',bindStart);
const bindJs=ts.transpileModule('return async function(){'+source.slice(bindStart,bindEnd)+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const scenario of ['missing-session','wrong-state','bind-failure','bound'])test('actual Lazada callback '+scenario,async()=>{
 const calls=[],removed=[],toasts=[];const deps={pendingChannelOAuth:{channel:'lazada',state:scenario==='wrong-state'?'legacy':'sellerpilot-lazada-my-fixture',code:'fixture-code'},userId:actor,
 readLazadaExactBrowserSession:()=>scenario==='missing-session'?null:{sessionId:session,credentialId:credential},sessionData:{session:{access_token:'fixture-token'}},
 fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json({status:scenario==='bind-failure'?'blocked':'bound'},{status:scenario==='bind-failure'?409:200});},
 setOAuthToastMessage:s=>toasts.push(s),window:{sessionStorage:{removeItem:k=>removed.push(k)}},lazadaExactBrowserKey:'sellerpilot.lazada-exact-session.v1'};
 const run=new Function(...Object.keys(deps),bindJs)(...Object.values(deps));if(scenario==='bound')await run();else await assert.rejects(run());
 assert.equal(calls.length,['bind-failure','bound'].includes(scenario)?1:0);assert.ok(calls.every(c=>c.url==='/api/admin/channel-credentials/lazada/exact'));
 assert.equal(removed.length,scenario==='bound'?1:0);if(scenario==='bound')assert.match(toasts[0],/연결 완료 전/);
});
test('credential center routes Lazada to independent exact event before legacy authorize',()=>{const a=center.indexOf('if (credential.channel === "lazada") {',center.indexOf('const startOAuth'));assert.ok(a>0);assert.match(center.slice(a,a+260),/sellerpilot:lazada-exact-start[\s\S]*return;/);assert.ok(source.includes('const shopeeExactBrowserKey = "sellerpilot.shopee-exact-session.v1"'));assert.ok(source.includes('const lazadaExactBrowserKey = "sellerpilot.lazada-exact-session.v1"'));});
