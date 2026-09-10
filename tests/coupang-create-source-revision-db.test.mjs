import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../supabase/migrations/20260910021500_fence_coupang_create_source_revision.sql", import.meta.url), "utf8");
const ids = { owner:"10000000-0000-4000-8000-000000000001", product:"20000000-0000-4000-8000-000000000001", listing:"30000000-0000-4000-8000-000000000001", attempt:"40000000-0000-4000-8000-000000000001", credential:"50000000-0000-4000-8000-000000000001", job:"60000000-0000-4000-8000-000000000001" };
const officialReadEvidence = {
  contract:"sellerpilot_coupang_create_official_read_evidence_v1",
  displayCategoryCode:59631, environment:"production", observedAt:new Date().toISOString(),
  categoryMetadataSha256:"1".repeat(64), categoryStatusSha256:"2".repeat(64),
  outboundShippingPlacesSha256:"3".repeat(64), returnCentersSha256:"4".repeat(64),
  evidenceSha256:"5".repeat(64),
};
const binding = {
  contract:"sellerpilot_coupang_create_source_revision_v1", productId:ids.product,
  productSourceSha256:"a".repeat(64), productSource:{sku:"NEW-SKU",name:"신규 상품",onHand:9,costKrw:8000},
  detailPageVersion:3, approvedManifestDigest:"b".repeat(64), officialReadEvidence,
  sourceRevisionSha256:"c".repeat(64),
  credentialId:ids.credential, credentialVersion:7, credentialFingerprint:"ABCDEF123456",
  credentialEnvironment:"production", credentialSellerIdentitySha256:"d".repeat(64), market:"KR",targetId:"A00123456",
};
async function fixture(){
  const db=new PGlite();
  await db.exec(`create schema sellerpilot_private; create role anon; create role authenticated; create role service_role;
    create table sellerpilot_private.channel_credentials(id uuid primary key,channel text,environment text,status text,expires_at timestamptz,version int,fingerprint text);
    create table sellerpilot_private.products(id uuid primary key,owner_id uuid,demo boolean,status text,sku text,name text,on_hand int,cost_krw numeric,detail_page_version int,detail_page_approved_version int,detail_page_image_manifest jsonb);
    create table sellerpilot_private.product_listings(id uuid primary key,product_id uuid,owner_id uuid,channel_key text,operation_attempt_id uuid,market text,target_id text);
    create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,credential_id uuid,listing_id uuid,attempt_id uuid,created_by uuid,channel text,operation text,environment text,provider_mutation_started_at timestamptz,request_payload jsonb,request_fingerprint text);
    insert into sellerpilot_private.channel_credentials values('${ids.credential}','coupang','production','active',now()+interval '1 year',7,'ABCDEF123456');
    insert into sellerpilot_private.products values('${ids.product}','${ids.owner}',false,'draft','NEW-SKU','신규 상품',9,8000,3,3,jsonb_build_object('digest',repeat('b',64)));
    insert into sellerpilot_private.product_listings values('${ids.listing}','${ids.product}','${ids.owner}','coupang','${ids.attempt}','KR','A00123456');`);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs values(
    $1,$2,$3,$4,$5,'coupang','listing.create','production',null,$6::jsonb,$7
  )`, [ids.job,ids.credential,ids.listing,ids.attempt,ids.owner,
    JSON.stringify({arguments:{body:{displayCategoryCode:59631},sellerpilotCoupangCreateSourceRevision:binding,publicationExpectedFingerprint:"e".repeat(64)}}),"e".repeat(64)]);
  await db.exec(migration); return db;
}
test("Coupang provider boundary accepts only the exact current input and credential revision",async()=>{
 const db=await fixture();try{
  await db.query("update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=now() where id=$1",[ids.job]);
  assert.equal((await db.query("select provider_mutation_started_at is not null ok from sellerpilot_private.channel_gateway_jobs where id=$1",[ids.job])).rows[0].ok,true);
 }finally{await db.close()}
});
test("credential, product, manifest, owner and request fingerprint drift fail before provider mutation",async()=>{
 const mutations=[
  "update sellerpilot_private.channel_credentials set version=8",
  "update sellerpilot_private.products set on_hand=8",
  "update sellerpilot_private.products set detail_page_approved_version=2",
  "update sellerpilot_private.product_listings set owner_id=gen_random_uuid()",
  "update sellerpilot_private.channel_gateway_jobs set request_fingerprint=repeat('f',64)",
 ];
 for(const mutation of mutations){const db=await fixture();try{await db.exec(mutation);await assert.rejects(db.query("update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=now() where id=$1",[ids.job]),/COUPANG_CREATE_SOURCE_REVISION_MISMATCH/)}finally{await db.close()}}
});
test("missing, stale, category-mismatched, or malformed official GET evidence fails at the DB boundary",async()=>{
 const mutations=[
  "update sellerpilot_private.channel_gateway_jobs set request_payload=request_payload #- '{arguments,sellerpilotCoupangCreateSourceRevision,officialReadEvidence}'",
  "update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,sellerpilotCoupangCreateSourceRevision,officialReadEvidence,observedAt}','\"2020-01-01T00:00:00.000Z\"')",
  "update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,sellerpilotCoupangCreateSourceRevision,officialReadEvidence,displayCategoryCode}','59632')",
  "update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,sellerpilotCoupangCreateSourceRevision,officialReadEvidence,evidenceSha256}','\"bad\"')",
 ];
 for(const mutation of mutations){const db=await fixture();try{await db.exec(mutation);await assert.rejects(db.query("update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=now() where id=$1",[ids.job]),/COUPANG_CREATE_SOURCE_REVISION_MISMATCH/)}finally{await db.close()}}
});
