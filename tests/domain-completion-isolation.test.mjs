import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";
registerHooks({resolve(s,c,next){return s === "server-only" ? {shortCircuit:true,url:"data:text/javascript,export default {}"} : next(s,c);}});
const { completeCsClaim } = await import("../lib/cs/operations/complete.ts");
const { completeCommerceClaim } = await import("../lib/channels/commerce-completion.ts");
const { completeShippingClaim } = await import("../lib/shipping/complete.ts");
const domains = { cs: { complete: completeCsClaim, operation: "inquiries.list" }, product: { complete: completeCommerceClaim, operation: "categories.list" }, shipping: { complete: completeShippingClaim, operation: "orders.list" } };
const base = {id:"81000000-0000-4000-8000-000000000001",claim_token:"81000000-0000-4000-8000-000000000002",credential_id:"81000000-0000-4000-8000-000000000003",channel:"qoo10",request:{arguments:{}},credential:{},attempt_count:1};
for (const [owner, own] of Object.entries(domains)) for (const [other, foreign] of Object.entries(domains)) {
 if (owner === other) continue;
 test(`${owner} completion rejects ${other} job before any database access`, async () => {
  let calls=0;
  const result=await own.complete({rpc:async()=>{calls++;throw new Error("cross-domain database access");}},"fixture",{...base,operation:foreign.operation},{status:"failed",error:"fixture"});
  assert.equal(result,"ownership_lost");assert.equal(calls,0);
 });
 test(`${owner} completion cannot persist ${other} result under its own claim`, async () => {
  const calls=[];
  const job={...base,operation:own.operation};
  const result=await own.complete({rpc:async(name)=>{calls.push(name);return {data:{status:"running",channel:job.channel,operation:job.operation},error:null};}},"fixture",job,{jobId:job.id,claimToken:job.claim_token,status:"succeeded",result:{ok:true,channel:"qoo10",operation:foreign.operation,steps:[{name:"fixture",ok:true,status:200,data:{}}],safeMessage:"fixture"}});
  assert.equal(result,"ownership_lost");assert.deepEqual(calls,["sellerpilot_service_serverless_cs_completion_context"]);
 });
}
test("marketplace console cannot offer CS requests to the product endpoint",()=>{
 const source=readFileSync(new URL("../app/api-credential-center.tsx",import.meta.url),"utf8");
 const ast=ts.createSourceFile("console.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let initializer;
 for(const statement of ast.statements) if(ts.isVariableStatement(statement)) for(const declaration of statement.declarationList.declarations) if(declaration.name.getText(ast)==="channelOperationOptions") initializer=declaration.initializer;
 assert.ok(initializer&&ts.isArrayLiteralExpression(initializer));
 const operations=initializer.elements.map(element=>element.properties.find(property=>property.name?.getText(ast)==="value").initializer.text);
 assert.deepEqual(operations,["categories.list","categories.suggest","categories.attributes","categories.validate","orders.list","orders.get"]);
 const consoleFunction=ast.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==="ApiOperationConsole");
 assert.ok(consoleFunction);
 assert.match(consoleFunction.getText(ast),/href="\/cs">CS 전용 화면/);
 assert.doesNotMatch(operations.join(","),/inquiries\./);
});
