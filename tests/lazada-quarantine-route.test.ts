import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as contract from "../lib/cs/lazada-quarantine";
const source=await readFile(new URL('../app/api/admin/cs/lazada-quarantine/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function call(url='https://example.test/api/admin/cs/lazada-quarantine',options:{denied?:boolean;data?:unknown;error?:unknown}={}){
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const sandbox=vm.createContext({exports:{},Request,Response,URL,require(name:string){
  if(name==='next/server')return {NextResponse:Response};
  if(name.endsWith('/cs/lazada-quarantine'))return contract;
  if(name.endsWith('/admin-api'))return {authenticateAdminRequest:async()=>options.denied?Response.json({message:'denied'},{status:401}):{
   userClient:{rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:options.data??{contract:'lazada_quarantine_read_v1',messages:[],nextCursor:null,asOf:'2026-09-01T00:00:00Z'},error:options.error??null};}},
   serviceClient:{rpc:()=>{throw new Error('must not use service client');}},
  },isAdminApiError:(value:unknown)=>value instanceof Response};
  throw new Error(`unexpected module ${name}`);
 }});
 vm.runInContext(compiled,sandbox);return {response:await sandbox.exports.GET(new Request(url)),calls};
}
test('quarantine API authenticates before RPC and never uses the service client',async()=>{
 const denied=await call(undefined,{denied:true});assert.equal(denied.response.status,401);assert.equal(denied.calls.length,0);
 const ok=await call();assert.equal(ok.response.status,200);assert.equal(ok.calls[0].name,'sellerpilot_read_lazada_quarantine');
 assert.match(ok.response.headers.get('cache-control')??'',/private, no-store/);
});
test('quarantine API rejects invalid cursors before RPC and retains exact timestamp precision',async()=>{
 for(const cursor of ['{}','null','bad',JSON.stringify({beforeTime:'2026-09-01T00:00:00Z',beforeKey:'not-a-key',asOf:'2026-09-02T00:00:00Z'})]){
  const result=await call(`https://example.test/api/admin/cs/lazada-quarantine?${new URLSearchParams({cursor})}`);
  assert.equal(result.response.status,400);assert.equal(result.calls.length,0);
 }
 const cursor={beforeTime:'2026-09-01T00:00:00.123456+00:00',beforeKey:'a'.repeat(64),asOf:'2026-09-02T00:00:00.987654+00:00'};
 const result=await call(`https://example.test/api/admin/cs/lazada-quarantine?${new URLSearchParams({cursor:JSON.stringify(cursor)})}`);
 assert.equal(result.calls[0].args.p_before_time,cursor.beforeTime);assert.equal(result.calls[0].args.p_as_of,cursor.asOf);
});
test('quarantine API hides raw DB errors and rejects malformed or incomplete pages',async()=>{
 const failed=await call(undefined,{error:{message:'PRIVATE_DATABASE_DETAIL'}});assert.equal(failed.response.status,503);assert.doesNotMatch(await failed.response.text(),/PRIVATE/);
 const malformed=await call(undefined,{data:{messages:[]}});assert.equal(malformed.response.status,502);
});
test('quarantine schema preserves originals and rejects duplicates, invented roles and mismatched cursor',()=>{
 const message={key:'a'.repeat(64),sessionId:'session',messageId:'message',body:'  original\n<script>literal</script>',senderRole:'customer',observedAt:'2026-09-01T00:00:00Z',expiresAt:'2026-09-08T00:00:00Z',reason:'unverified'};
 const page={contract:'lazada_quarantine_read_v1',messages:[message],asOf:'2026-09-02T00:00:00Z',nextCursor:null};
 assert.equal(contract.quarantinePageSchema.parse(page).messages[0].body,message.body);
 for(const invalid of [{...page,messages:[message,message]},{...page,messages:[{...message,senderRole:'unknown'}]},
  {...page,messages:[{...message,expiresAt:message.observedAt}]},
  {...page,nextCursor:{beforeTime:message.observedAt,beforeKey:message.key,asOf:page.asOf}}])assert.equal(contract.quarantinePageSchema.safeParse(invalid).success,false);
});
