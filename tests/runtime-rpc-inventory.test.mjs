import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectRuntimeRpcInventory,missingRuntimeRpcSql } from '../scripts/diagnostics/build-runtime-rpc-inventory.mjs';

test('RPC inventory resolves imported constants and branches, distinguishes shadowed dynamic names, and ignores comments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sellerpilot-rpc-inventory-test-'));
 try{
  await mkdir(join(root,'lib'));await mkdir(join(root,'app'));
  await writeFile(join(root,'lib','names.ts'),"export const RPC='sellerpilot_a' as const;");
  await writeFile(join(root,'app','route.ts'),`import {RPC as imported} from '../lib/names';
   declare const db:{rpc(name:string):unknown};declare const enabled:boolean;
   db.rpc(imported);db.rpc(enabled?'sellerpilot_b':'sellerpilot_c');
   const RPC='sellerpilot_d';db.rpc(RPC);
   function dynamic(RPC:string){return db.rpc(RPC);}
   // db.rpc('sellerpilot_not_a_call');
   const documentation="db.rpc('sellerpilot_not_a_call_either')";
  `);
  const result=await collectRuntimeRpcInventory(root);
  assert.deepEqual(result.functions.map(x=>x.name),['sellerpilot_a','sellerpilot_b','sellerpilot_c','sellerpilot_d']);
  assert.equal(result.callCount,4);assert.equal(result.unresolved.length,1);assert.equal(result.unresolved[0].argument,'RPC');
  const sql=missingRuntimeRpcSql(result);
  assert.match(sql,/begin read only;/);assert.match(sql,/pg_proc/);
  assert.doesNotMatch(sql,/select public\.sellerpilot_|\b(?:update|insert|delete|create|alter|drop)\s/i);
  assert.throws(()=>missingRuntimeRpcSql({functions:[{name:"x'); drop table example; --"}]}),/Invalid RPC/);
 }finally{await rm(root,{recursive:true,force:true});}
});
