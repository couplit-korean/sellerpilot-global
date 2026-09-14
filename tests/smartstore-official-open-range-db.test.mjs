import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const baseline=JSON.parse(await readFile(new URL('./fixtures/smartstore-open-range-before.json',import.meta.url),'utf8'));
const receipt=JSON.parse(await readFile(new URL('./fixtures/smartstore-soda-official-range.json',import.meta.url),'utf8'));
const migration=await readFile(new URL('../supabase/migrations/20260914150000_smartstore_official_open_range.sql',import.meta.url),'utf8');
const signature=r=>r.name+'('+r.identity.split(',').map(a=>a.trim().split(' ').slice(1).join(' ')).join(',')+')';
async function setup(){const db=new PGlite();await db.exec('create schema sellerpilot_private;create role anon;create role authenticated;create role service_role;revoke all on schema sellerpilot_private from public;');for(const r of baseline){await db.exec(r.definition);if(r.acl!==null)await db.exec(`revoke all on function ${signature(r)} from public,anon,authenticated,service_role;`);}return db;}
const validate=async(db,official=receipt.official,attributes=receipt.providerAttributes,category='50002253')=>(await db.query('select sellerpilot_private.smartstore_category_source_payload_is_valid($1,$2::jsonb,$3::jsonb) value',[category,attributes,official])).rows[0].value;
const contains=async(db,value,bounds)=>(await db.query('select sellerpilot_private.smartstore_category_source_range_contains($1,$2::jsonb) value',[value,bounds])).rows[0].value;

test('actual HTTP200 soda receipt and all five selections validate without removing official annotations',async()=>{const db=await setup();try{
 assert.equal(await validate(db),false);const before=(await db.query("select oid::regprocedure::text name,proacl::text acl from pg_proc where pronamespace='sellerpilot_private'::regnamespace order by proname")).rows;
 await db.exec(migration);assert.equal(await validate(db),true);assert.equal(receipt.providerAttributes.length,5);
 // The appender compares its compiler output with sorted_records(provider), not
 // the raw TS array order. Preserve and exercise that exact canonical contract.
 const comparison=(await db.query(`select
   sellerpilot_private.smartstore_category_source_compile_stored_selection($1::jsonb,$2::jsonb) compiled,
   sellerpilot_private.smartstore_category_source_sorted_records($3::jsonb) expected`,
   [receipt.storedSelection,receipt.official,receipt.providerAttributes])).rows[0];
 assert.notDeepEqual(comparison.compiled,receipt.providerAttributes,'the real receipt has different raw-array ordering');
 assert.deepEqual(comparison.compiled,comparison.expected,'the appender canonical comparison must match all five records');
 assert.deepEqual((await db.query("select oid::regprocedure::text name,proacl::text acl from pg_proc where pronamespace='sellerpilot_private'::regnamespace order by proname")).rows,before);
 // The lower-open calorie value has no manufactured zero/minimum in the receipt.
 const upper=receipt.official.attributeValues.find(v=>v.attributeValueSeq===10811008);assert.equal(Object.hasOwn(upper,'minAttributeValue'),false);assert.equal(upper.maxAttributeValue,'50');
 const bad=structuredClone(receipt.providerAttributes);bad.find(v=>v.attributeSeq===10018618).attributeRealValue='51';assert.equal(await validate(db,receipt.official,bad),false);
 const lower=receipt.official.attributeValues.find(v=>v.attributeSeq===10013911&&v.minAttributeValue==='1000'&&v.maxAttributeValue==null);assert.ok(lower);
 const selected=structuredClone(receipt.providerAttributes);const v=selected.find(v=>v.attributeSeq===10013911);v.attributeValueSeq=lower.attributeValueSeq;v.attributeRealValue='1000';assert.equal(await validate(db,receipt.official,selected),true);v.attributeRealValue='999';assert.equal(await validate(db,receipt.official,selected),false);
}finally{await db.close();}});

test('finite closed/open bounds retain endpoint comparisons and reject empty or malformed intervals',async()=>{const db=await setup();try{await db.exec(migration);
 for(const [bounds,inside,outside] of [[{minAttributeValue:'350',maxAttributeValue:'500'},['350','500','350~500'],['349','501']],[{maxAttributeValue:'50'},['0','50','0~50'],['51','0~51']],[{minAttributeValue:'1000'},['1000','1001','1000x2000'],['999','999~1000']],[{minAttributeValue:null,maxAttributeValue:'50'},['0','50'],['51']]]){for(const value of inside)assert.equal(await contains(db,value,bounds),true);for(const value of outside)assert.equal(await contains(db,value,bounds),false);}
 for(const bounds of [{},{minAttributeValue:null,maxAttributeValue:null},{minAttributeValue:'',maxAttributeValue:'50'},{minAttributeValue:'NaN'},{maxAttributeValue:'Infinity'},{minAttributeValue:'10',maxAttributeValue:'9'}])assert.equal(await contains(db,'10',bounds),false);
 for(const value of ['NaN','Infinity','-1','1e10','x10','1~NaN'])assert.equal(await contains(db,value,{maxAttributeValue:'50'}),false);
}finally{await db.close();}});

test('unbounded-both, non-RANGE missing display, bad bounds/units and unknown metadata stay rejected',async()=>{const db=await setup();try{await db.exec(migration);
 const mutations=[
  o=>{const v=o.attributeValues.find(v=>v.attributeValueSeq===10811008);delete v.maxAttributeValue;},
  o=>{const v=o.attributeValues.find(v=>v.attributeValueSeq===10811008);v.maxAttributeValue='NaN';},
  o=>{const v=o.attributeValues.find(v=>v.attributeValueSeq===10811008);v.maxAttributeValue=50;},
  o=>{const v=o.attributeValues.find(v=>v.attributeValueSeq===10811008);delete v.maxAttributeValueUnitCode;},
  o=>{const v=o.attributeValues.find(v=>v.attributeValueSeq===10811008);v.maxAttributeValueUnitCode='A99999';},
  o=>{delete o.attributeValues.find(v=>v.attributeValueSeq===10760068).minAttributeValue;},
  o=>{o.attributes[0].attributeTypeCodeName=12;},o=>{o.attributes[0].attributeClassificationCodeName=null;},
  o=>{o.attributeValues[0].exposureOrder='1';},o=>{o.attributeValues[0].exposureOrder=1.5;},o=>{o.attributeValues[0].exposureOrder=-1;},
  o=>{o.attributes[0].unknownField='x';},o=>{o.attributeValues[0].unknownField='x';},
 ];for(const mutate of mutations){const o=structuredClone(receipt.official);mutate(o);assert.equal(await validate(db,o),false,mutate.toString());}
 const wrong=structuredClone(receipt.providerAttributes);wrong.find(v=>v.attributeSeq===10013911).attributeValueSeq=10811008;assert.equal(await validate(db,receipt.official,wrong),false);
 assert.equal(await validate(db,receipt.official,receipt.providerAttributes.slice(1)),false);assert.equal(await validate(db,receipt.official,receipt.providerAttributes,'another-category'),false);
 // Optional annotations can be absent, without changing the actual bounds.
 const o=structuredClone(receipt.official);for(const a of o.attributes){delete a.attributeTypeCodeName;delete a.attributeClassificationCodeName;}for(const v of o.attributeValues)delete v.exposureOrder;assert.equal(await validate(db,o),true);
}finally{await db.close();}});

test('unexpected deployed preimage aborts before replacing either existing validator',async()=>{const db=await setup();try{const r=baseline.find(r=>r.name.endsWith('.smartstore_category_source_range_contains'));await db.exec(r.definition.replace('begin','begin\n -- changed deployment'));await assert.rejects(db.exec(migration),/PREIMAGE_DRIFT/);await db.exec('rollback');assert.equal(await validate(db),false);
}finally{await db.close();}});
