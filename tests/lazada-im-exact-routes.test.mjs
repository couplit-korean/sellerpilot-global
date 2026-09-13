import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import ts from 'typescript';
import {z} from 'zod';
const moduleSource=await readFile(new URL('../lib/channels/lazada-oauth-im-exact.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('runtime.ts',moduleSource,ts.ScriptTarget.Latest,true);
const schemaSource=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['lazadaImExactAdminInput','lazadaImExactWorkerInput'].includes(d.name.getText(ast)))).map(n=>n.getText(ast).replace(/^export /,'')).join('\n');
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const {lazadaImExactAdminInput,lazadaImExactWorkerInput}=new Function('z',transpile(schemaSource+';return {lazadaImExactAdminInput,lazadaImExactWorkerInput};'))(z);
const actor='11111111-1111-4111-8111-111111111111',credential='22222222-2222-4222-8222-222222222222',session='33333333-3333-4333-8333-333333333333';
const state='sellerpilot-lazada-im-cb-'+'a'.repeat(32);
const cookie=`${state}.${session}.${credential}`;
const load=async(path,deps)=>{
 const source=await readFile(new URL(path,import.meta.url),'utf8');const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 const text=tree.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(tree).replace(/^export /,'')).join('\n');
 return new Function(...Object.keys(deps),transpile(text+';return POST;'))(...Object.values(deps));
};
function request(body,{auth='Bearer synthetic-admin-session',cookieValue=cookie}={}){
 return {json:async()=>body,headers:new Headers({authorization:auth}),cookies:{get:()=>cookieValue?{value:cookieValue}:undefined},nextUrl:new URL('https://sellerpilot-global.vercel.app/api/admin/channel-credentials/lazada/im-exact')};
}
const responseShim={json:(body,options={})=>({body,status:options.status??200,headers:options.headers??{},setCookies:[],cookies:{set(...value){this.values=value;}}})};
function dependencies(options={}){
 const calls=[];
 const createClient=(_url,key)=>key==='public-key'?{
  auth:{getUser:async()=>({data:{user:options.authFailure?null:{id:actor}},error:null})},rpc:async()=>({data:options.admin!==false,error:null}),
 }:{rpc:async(name,args)=>{calls.push({name,args});return options.rpcError?{data:null,error:{code:'test'}}:{data:options.data??{status:'executor_required',sessionId:session},error:null};}};
 return {calls,deps:{createHash,randomBytes,randomUUID,timingSafeEqual,Buffer,createClient,NextResponse:responseShim,lazadaImExactAdminInput,lazadaImExactWorkerInput,lazadaImExactFetch:fetch,supabaseUrl:'https://fixture.supabase.invalid',supabasePublishableKey:'public-key',process:{env:{SUPABASE_SECRET_KEY:'synthetic-server-key'}},URL,URLSearchParams,parseLazadaImExactClaim:()=>{if(options.invalidClaim)throw Error('invalid');}}};
}
for(const scenario of ['prepare','start','bind','bad-state','no-cookie','non-admin','auth-failure','rpc-error']){
 test('Lazada IM admin route '+scenario,async()=>{
  const options={admin:scenario!=='non-admin',authFailure:scenario==='auth-failure',rpcError:scenario==='rpc-error',data:{status:scenario==='start'?'ready':scenario==='bind'?'bound':'executor_required',sessionId:session}};
  const h=dependencies(options),post=await load('../app/api/admin/channel-credentials/lazada/im-exact/route.ts',h.deps);
  const action=scenario==='start'?'start':['bind','bad-state'].includes(scenario)?'bind':'prepare';
  const body=action==='prepare'?{action,credentialId:credential}:{action,credentialId:credential,sessionId:session,...(action==='bind'?{state:scenario==='bad-state'?state.slice(0,-1)+'b':state,code:'synthetic-once-code'}:{})};
  if(scenario==='no-cookie'){body.action='start';body.sessionId=session;}
  const res=await post(request(body,{cookieValue:scenario==='no-cookie'?null:cookie}));
  const forbidden=['bad-state','no-cookie','non-admin','auth-failure'].includes(scenario);
  assert.equal(res.status,forbidden?403:scenario==='rpc-error'?409:200);
  if(forbidden)assert.equal(h.calls.length,0);
  if(scenario==='start'){
   const url=new URL(res.body.authorizationUrl);assert.equal(url.origin,'https://auth.lazada.com');assert.equal(url.searchParams.get('client_id'),'137571');assert.equal(url.searchParams.get('country'),'cb');assert.equal(url.searchParams.get('state'),state);
  }
  if(scenario==='prepare'){assert.equal(res.cookies.values[0],'sellerpilot_lazada_im_exact_oauth');assert.equal(res.cookies.values[2].httpOnly,true);assert.equal(res.cookies.values[2].secure,true);assert.equal(res.cookies.values[2].sameSite,'lax');}
  if(scenario==='bind'){assert.equal(h.calls[0].name,'sellerpilot_lazada_im_exact_oauth_admin');assert.equal(h.calls[0].args.p_actor,actor);assert.equal(h.calls[0].args.p_request.country,'cb');assert.equal(h.calls[0].args.p_state_hash,createHash('sha256').update(state).digest('hex'));}
  assert.ok(h.calls.every(c=>c.name==='sellerpilot_lazada_im_exact_oauth_admin'));
 });
}
for(const scenario of ['no-auth','bad-shape','blocked','claimed','bad-claim']){
 test('Lazada IM worker route '+scenario,async()=>{
  const h=dependencies({rpcError:scenario==='blocked',invalidClaim:scenario==='bad-claim',data:{status:'claimed',job:{fixture:true}}});
  const post=await load('../app/api/channel-gateway/worker/lazada-im-oauth-exact/route.ts',h.deps);
  const res=await post(request(scenario==='bad-shape'?{action:'arbitrary',sessionId:session}:{action:'claim',sessionId:session},{auth:scenario==='no-auth'?'':'Bearer spw_'+'x'.repeat(32)}));
  assert.equal(res.status,scenario==='no-auth'?401:scenario==='bad-shape'?400:['blocked','bad-claim'].includes(scenario)?409:200);
  assert.ok(h.calls.every(c=>c.name==='sellerpilot_lazada_im_exact_oauth_worker'));
  if(h.calls.length){assert.match(h.calls[0].args.p_token_hash,/^[a-f0-9]{64}$/);assert.equal(h.calls[0].args.p_session,session);}
 });
}
