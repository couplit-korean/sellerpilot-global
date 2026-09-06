import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as contract from "../lib/cs/archive";
const source=await readFile(new URL('../app/api/admin/cs/archive/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function call(url='https://example.test/api/admin/cs/archive',options:{denied?:boolean;data?:unknown;error?:unknown}={}){
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const sandbox=vm.createContext({exports:{},Request,Response,URL,require(name:string){
  if(name==='next/server')return {NextResponse:Response};
  if(name.endsWith('/cs/archive'))return contract;
  if(name.endsWith('/admin-api'))return {authenticateAdminRequest:async()=>options.denied?Response.json({message:'denied'},{status:401}):{
   userClient:{rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:options.data??{tickets:[],nextCursor:null,asOf:'2026-09-01T00:00:00Z'},error:options.error??null};}},
   serviceClient:{rpc:()=>{throw new Error('must not use service client');}},
  },isAdminApiError:(value:unknown)=>value instanceof Response};
  throw new Error(`unexpected module ${name}`);
 }});
 vm.runInContext(compiled,sandbox);return {response:await sandbox.exports.GET(new Request(url)),calls};
}
test('archive route requires authentication before parsing or calling the DB',async()=>{
 const {response,calls}=await call(undefined,{denied:true});assert.equal(response.status,401);assert.equal(calls.length,0);
});
test('archive route validates impossible dates, channels and cursor fields',async()=>{
 for(const query of ['from=2026-02-30','from=2026-09-02&to=2026-09-01','channel=invalid','status=sent','cursor=%7B%7D']){
  const {response,calls}=await call(`https://example.test/api/admin/cs/archive?${query}`);
  assert.equal(response.status,400);assert.equal(calls.length,0);assert.match(response.headers.get('cache-control')??'',/no-store/);
 }
});
test('archive route uses owner-authenticated RPC with exact filters and no cached response',async()=>{
 const {response,calls}=await call('https://example.test/api/admin/cs/archive?query=old%25&channel=smartstore&status=resolved&from=2026-09-01&to=2026-09-02');
 assert.equal(response.status,200);assert.equal(calls[0].name,'sellerpilot_search_cs_archive');
 assert.equal(calls[0].args.p_query,'old%');assert.equal(calls[0].args.p_from_date,'2026-09-01');assert.equal(calls[0].args.p_limit,25);
 assert.match(response.headers.get('cache-control')??'',/private, no-store/);
});
test('archive route hides database errors and rejects malformed pages',async()=>{
 const failed=await call(undefined,{error:{message:'SECRET_DATABASE_DETAIL'}});assert.equal(failed.response.status,503);
 assert.equal((await failed.response.text()).includes('SECRET'),false);
 const malformed=await call(undefined,{data:{tickets:[{id:'bad'}]}});assert.equal(malformed.response.status,502);
});
