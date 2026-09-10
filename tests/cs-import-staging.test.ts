import assert from "node:assert/strict";
import test from "node:test";
import { prepareCsImport, providerExportAdapterInventory } from "../lib/cs/import-staging";
const account="a".repeat(64);
const base={contract:"sellerpilot-normalized-cs-export/1",channel:"qoo10",sourceAccountKey:account,records:[{sourceRecordId:"M-1",externalTicketId:"T-1",remoteMessageId:"M-1",customerName:"buyer",subject:"question",message:"where",status:"waiting",receivedAt:"2026-09-01T00:00:00.000Z"}]};
test("the same normalized source is idempotent regardless of object key order",()=>{
 const one=prepareCsImport(base,"qoo10");
 const two=prepareCsImport({sourceAccountKey:account,records:base.records,channel:"qoo10",contract:"sellerpilot-normalized-cs-export/1"},"qoo10");
 assert.equal(one.sourceDigest,two.sourceDigest);assert.equal(one.rows[0].rowDigest,two.rows[0].rowDigest);
});
test("ID-less similar rows never share an automatic merge identity",()=>{
 const payload={...base,records:[{sourceRecordId:null,externalTicketId:null,remoteMessageId:null,customerName:"buyer",subject:"same",message:"same",status:"waiting",receivedAt:"2026-09-01T00:00:00.000Z"},{sourceRecordId:null,externalTicketId:null,remoteMessageId:null,customerName:"buyer",subject:"same",message:"same",status:"waiting",receivedAt:"2026-09-01T00:00:00.000Z"}]};
 const rows=prepareCsImport(payload,"qoo10").rows;assert.notEqual(rows[0].rowDigest,rows[1].rowDigest);
});
test("provider-specific exports remain visibly blocked until an exact sample is verified",()=>{
 assert.equal(providerExportAdapterInventory.length,8);assert.ok(providerExportAdapterInventory.every(item=>item.state==="sample_required"));
});

test("UTF-8 provider context and complete normalized row obey database byte limits",()=>{
 assert.throws(()=>prepareCsImport({...base,records:[{...base.records[0],providerContext:{text:"한".repeat(21000)}}]},"qoo10"));
 assert.throws(()=>prepareCsImport({...base,records:[{...base.records[0],message:"한".repeat(20000),providerContext:{text:"한".repeat(2000)}}]},"qoo10"),/ROW_TOO_LARGE/);
});
test("large Korean rows split below PostgreSQL batch bytes without losing row order",async()=>{
 const {chunkCsImportRows}=await import('../lib/cs/import-staging');
 const prepared=prepareCsImport({...base,records:Array.from({length:501},(_,i)=>({...base.records[0],sourceRecordId:`M-${i}`,message:"한".repeat(19000)}))},"qoo10");
 const chunks=chunkCsImportRows(prepared.rows);
 assert.ok(chunks.length>2);
 assert.deepEqual(chunks.flat(),prepared.rows);
 for(const chunk of chunks){assert.ok(chunk.length<=500);assert.ok(Buffer.byteLength(JSON.stringify(chunk),'utf8')<1_000_000);}
});
