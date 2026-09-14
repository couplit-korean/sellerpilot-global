import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl=new URL('./elevenst-new-product-source-approval-migration.test.mjs',import.meta.url);
const fixtureSource=await readFile(fixtureUrl,'utf8');
const source=fixtureSource.slice(0,fixtureSource.indexOf('test("11st approval RPC'))
 .replaceAll('"import.meta.url"','"__FIXTURE_META_URL__"').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href))
 .replaceAll('__FIXTURE_META_URL__','import.meta.url')
 .replaceAll('import.meta.resolve("@electric-sql/pglite")',JSON.stringify(import.meta.resolve('@electric-sql/pglite')))
 .replace('  await db.exec(sourceMigration);','').replace('  await db.exec(approvalMigration);','');
const fixture=await import(`data:text/javascript;base64,${Buffer.from(source+'\nexport { database, context, approve, approvalPayload, fixture, PRODUCT_ID, AI_JOB_ID, CLAIM_ID };').toString('base64')}`);
const restored=(await readFile(new URL('../supabase/migrations/20260913024900_restore_elevenst_approval_and_create_recovery_contracts.sql',import.meta.url),'utf8')).replace(/do \$recovery_guard\$[\s\S]*?end \$recovery_guard\$;/u,'');
const migration=await readFile(new URL('../supabase/migrations/20260914143000_elevenst_cider_source_category.sql',import.meta.url),'utf8');
const baseline=JSON.parse(await readFile(new URL('./fixtures/elevenst-cider-before.json',import.meta.url),'utf8'));
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const codes=['176400445','176398001','42154823','23757260','23757095','176312674','23756754','23757245','42155152','23757000'];
const roles=['detail-overview','detail-feature','detail-dimensions','detail-contents','detail-use','detail-routine','detail-care','detail-package'];
async function setup(){const v=await fixture.database();await v.db.exec(restored);for(const f of baseline.functions)await v.db.exec(f.definition);
 // Seed completed-producer and corrupted-ledger reader cases directly; approval/source guards remain active.
 await v.db.exec('alter table sellerpilot_private.ai_cli_jobs disable trigger user; alter table sellerpilot_private.products disable trigger user;');return v;}
async function setCategory(db,id,category,target="11st"){
 await db.query('update sellerpilot_private.product_category_assignments set category_id=$1',[category]);
 const r=(await db.query('select data from sellerpilot_private.product_registration_drafts')).rows[0];
 const key=JSON.stringify(['elevenst','KR',target,id]);r.data.channels[key].categoryId=category;
 await db.query('update sellerpilot_private.product_registration_drafts set data=$1',[r.data]);
}
async function generatedFixture(db){
 const paths={},digests={};const all=['hero','square','wide','portrait',...roles,'detail-material','detail-storage','detail-scale','detail-context'];
 for(const [i,role]of all.entries()){paths[role]=`results/${fixture.AI_JOB_ID}/claims/${fixture.CLAIM_ID}/${role}.png`;digests[role]=createHash('sha256').update(role).digest('hex');}
 const images=roles.map(role=>({role,path:paths[role],sourceSha256:digests[role]}));
 const manifest={contract:'sellerpilot_detail_image_manifest_v2',algorithm:'sha256',digest:createHash('sha256').update(images.map(i=>`${i.role}\t${i.path}\t${i.sourceSha256}`).join('\n')).digest('hex'),images};
 const inputs=Array.from({length:6},(_,i)=>`${fixture.fixture.ADMIN_ID}/source-${i+1}.jpg`);
 await db.query("update sellerpilot_private.ai_cli_jobs set result_payload=jsonb_build_object('asset_storage_paths',$1::jsonb,'asset_storage_sha256s',$2::jsonb),request_payload=jsonb_build_object('image_paths',$3::jsonb),claim_token=null where id=$4",[paths,digests,inputs,fixture.AI_JOB_ID]);
 await db.query('update sellerpilot_private.products set detail_page_image_manifest=$1 where id=$2',[manifest,fixture.PRODUCT_ID]);
 await db.exec("create schema if not exists storage;create table if not exists storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);");
 for(const path of Object.values(paths))await db.query("insert into storage.objects(bucket_id,name) values('sellerpilot-ai',$1)",[path]);
 return {paths,digests,images,manifest,inputs};
}
function payload(current,id,category='1009792'){
 const p=fixture.approvalPayload(current,id);p.categoryId=category;p.providerProduct.dispCtgrNo=category;
 if(category==='1009792')p.notices=codes.map(code=>({code,value:`사실 ${code}`}));
 const receipts=[...current.productImagePaths,...current.detailImagePaths].map((path,index)=>({bucket:'sellerpilot-ai',path,bytesSha256:[...(current.productImageSha256s??Array(4).fill('a'.repeat(64))),...(current.detailImageSha256s??Array(8).fill('a'.repeat(64)))][index],contentLength:1234,contentType:'image/jpeg'}));
 p.providerProductSha256=digest(p.providerProduct);
 p.policySource.content={...p.policySource.content,htmlDetail:'<section>test</section>',htmlDetailSha256:'b'.repeat(64),imageUrlsSha256:'c'.repeat(64),productImageBucket:'sellerpilot-ai',detailImageBucket:'sellerpilot-ai',productImagePaths:current.productImagePaths,detailImagePaths:current.detailImagePaths,objectReceipts:receipts,objectReceiptsSha256:digest(receipts)};
 return p;
}

test('production preimages/CHECKs apply and keep function ACLs; generated four approved images preserve six inputs',async()=>{const{db,credentialId}=await setup();try{
 const before=(await db.query("select p.oid::regprocedure::text name,p.proacl::text acl from pg_proc p where p.proname like '%elevenst%' or p.proname like '%11st%'")).rows;
 const g=await generatedFixture(db);await setCategory(db,credentialId,'1009792');assert.equal(await fixture.context(db,credentialId),null);
 await db.exec(migration);const c=await fixture.context(db,credentialId);assert.ok(c);assert.equal(c.categoryId,'1009792');assert.deepEqual(c.productImagePaths,g.images.slice(0,4).map(i=>i.path));assert.equal(c.detailImagePaths.length,8);
 assert.deepEqual((await db.query('select request_payload from sellerpilot_private.ai_cli_jobs where id=$1',[fixture.AI_JOB_ID])).rows[0].request_payload.image_paths,g.inputs);
 assert.deepEqual((await db.query("select p.oid::regprocedure::text name,p.proacl::text acl from pg_proc p where p.proname like '%elevenst%' or p.proname like '%11st%'")).rows,before);
 const p=payload(c,credentialId);const approved=await fixture.approve(db,credentialId,p);assert.equal(approved.status,'approved');
 const s=(await db.query('select category_id,provider_product,notices from sellerpilot_private.elevenst_new_product_server_sources where id=$1',[approved.sourceId])).rows[0];assert.equal(s.category_id,'1009792');assert.equal(s.provider_product.dispCtgrNo,'1009792');assert.deepEqual(s.notices.map(n=>n.code),codes);
 assert.equal((await fixture.approve(db,credentialId,p)).status,'existing');
 const read=(await db.query("select public.sellerpilot_service_elevenst_new_product_source_readback($1,$2,$3,'KR','11st') value",[fixture.fixture.ADMIN_ID,fixture.PRODUCT_ID,credentialId])).rows[0].value;assert.equal(read.sourceId,approved.sourceId);assert.match(read.sixKindDigest,/^[a-f0-9]{64}$/);
 for(const kind of ['product','credential','notices','seller','availability','policy']){const r=(await db.query('select public.sellerpilot_service_elevenst_new_product_source($1,$2,$3,$4,$5,1) value',[kind,fixture.fixture.ADMIN_ID,fixture.PRODUCT_ID,'1346631',credentialId])).rows[0].value;assert.equal(r,null);}
}finally{await db.close();}});

test('category/provider/notices mismatches and source category rewrites cannot reuse an approval',async()=>{const{db,credentialId}=await setup();try{await generatedFixture(db);await setCategory(db,credentialId,'1009792');await db.exec(migration);const c=await fixture.context(db,credentialId);assert.ok(c);
 for(const mutate of [p=>p.categoryId='1346631',p=>p.providerProduct.dispCtgrNo='1346631',p=>p.notices.pop(),p=>p.notices.reverse()]){const p=payload(c,credentialId);mutate(p);p.providerProductSha256=digest(p.providerProduct);await assert.rejects(fixture.approve(db,credentialId,p),/PAYLOAD_INVALID/);}
 const p=payload(c,credentialId);const approved=await fixture.approve(db,credentialId,p);
 await assert.rejects(db.query("update sellerpilot_private.elevenst_new_product_server_sources set category_id='1346631' where id=$1",[approved.sourceId]),/IMMUTABLE|check constraint/);
 await setCategory(db,credentialId,'1346631');const read=(await db.query("select public.sellerpilot_service_elevenst_new_product_source_readback($1,$2,$3,'KR','11st') value",[fixture.fixture.ADMIN_ID,fixture.PRODUCT_ID,credentialId])).rows[0].value;assert.equal(read,null);
 await setCategory(db,credentialId,'9999999');assert.equal(await fixture.context(db,credentialId),null);
}finally{await db.close();}});

test('processed selection rejects raw, wrong hash, mixed claim, missing object and unapproved revision',async()=>{const{db,credentialId}=await setup();try{const g=await generatedFixture(db);await setCategory(db,credentialId,'1009792');await db.exec(migration);
 for(const query of ["update sellerpilot_private.ai_cli_jobs set status='queued'", "update sellerpilot_private.products set detail_page_approved_version=0,detail_page_image_manifest=null", "update sellerpilot_private.ai_cli_jobs set result_payload=jsonb_set(result_payload,'{asset_storage_sha256s,detail-overview}',to_jsonb(repeat('0',64)))", "delete from storage.objects where name like '%detail-overview.png'", "update sellerpilot_private.products set detail_page_image_manifest=jsonb_set(detail_page_image_manifest,'{images,0,path}','\"raw/photo.jpg\"')", "update sellerpilot_private.products set detail_page_image_manifest=jsonb_set(detail_page_image_manifest,'{digest}',to_jsonb(repeat('0',64)))"]){await db.exec('begin');await db.exec(query);assert.equal(await fixture.context(db,credentialId),null,query);await db.exec('rollback');}
 // Even a manifest with a recomputed hash cannot mix completion claims.
 const mixed=structuredClone(g.manifest);mixed.images[0].path=mixed.images[0].path.replace(fixture.CLAIM_ID,'10000000-0000-4000-8000-000000000099');mixed.digest=createHash('sha256').update(mixed.images.map(i=>`${i.role}\t${i.path}\t${i.sourceSha256}`).join('\n')).digest('hex');
 await db.query('update sellerpilot_private.products set detail_page_image_manifest=$1',[mixed]);await db.query("update sellerpilot_private.ai_cli_jobs set result_payload=jsonb_set(result_payload,'{asset_storage_paths,detail-overview}',$1::jsonb)",[JSON.stringify(mixed.images[0].path)]);await db.query("insert into storage.objects(bucket_id,name)values('sellerpilot-ai',$1)",[mixed.images[0].path]);assert.equal(await fixture.context(db,credentialId),null);
}finally{await db.close();}});

test('existing biscuit approval ledger/hash survives while new biscuit approval uses processed images',async()=>{const{db,credentialId}=await setup();try{
 const old=await fixture.context(db,credentialId);assert.ok(old);const p=payload(old,credentialId,'1346631');const approved=await fixture.approve(db,credentialId,p);
 const before=(await db.query('select to_jsonb(s) value from sellerpilot_private.elevenst_new_product_server_sources s')).rows;
 await db.exec(migration);const c=await fixture.context(db,credentialId);assert.deepEqual(c.productImagePaths,old.productImagePaths);assert.equal(c.categoryId,'1346631');assert.equal((await fixture.approve(db,credentialId,p)).status,'existing');
 assert.deepEqual((await db.query('select to_jsonb(s) value from sellerpilot_private.elevenst_new_product_server_sources s')).rows,before);
 const read=(await db.query("select public.sellerpilot_service_elevenst_new_product_source_readback($1,$2,$3,'KR','11st') value",[fixture.fixture.ADMIN_ID,fixture.PRODUCT_ID,credentialId])).rows[0].value;assert.equal(read.sourceId,approved.sourceId);
}finally{await db.close();}
 const next=await setup();try{const g=await generatedFixture(next.db);await next.db.exec(migration);const c=await fixture.context(next.db,next.credentialId);assert.equal(c.categoryId,'1346631');assert.deepEqual(c.productImagePaths,g.images.slice(0,4).map(i=>i.path));assert.equal((await fixture.approve(next.db,next.credentialId,payload(c,next.credentialId,'1346631'))).status,'approved');}finally{await next.db.close();}});

test('blank domestic target binds its exact saved draft and immutable category permit',async()=>{const{db,credentialId}=await setup();try{
 await generatedFixture(db);await setCategory(db,credentialId,'1009792');await db.exec(migration);
 const row=(await db.query('select data from sellerpilot_private.product_registration_drafts')).rows[0];const oldKey=JSON.stringify(['elevenst','KR','11st',credentialId]);row.data.channels[JSON.stringify(['elevenst','KR','',credentialId])]=row.data.channels[oldKey];delete row.data.channels[oldKey];await db.query('update sellerpilot_private.product_registration_drafts set data=$1',[row.data]);
 const args=[fixture.fixture.ADMIN_ID,fixture.PRODUCT_ID,credentialId];
 const c=(await db.query("select public.sellerpilot_service_elevenst_new_product_approval_context($1,$2,$3,'KR','') value",args)).rows[0].value;assert.equal(c.categoryId,'1009792');assert.equal(await fixture.context(db,credentialId),null);
 await assert.rejects(db.query("select public.sellerpilot_service_elevenst_new_product_approval_context($1,$2,$3,'KR',null)",args),/ACCESS_DENIED/);
 await assert.rejects(db.query("select public.sellerpilot_service_elevenst_new_product_approval_context($1,$2,$3,'US','')",args),/ACCESS_DENIED/);
 const p=payload(c,credentialId);p.availabilityReceipt.observedAt=new Date().toISOString();
 const requestId='10000000-0000-4000-8000-000000000088';p.approvalRequestId=requestId;
 const a=(await db.query("select public.sellerpilot_service_approve_elevenst_new_product_source($1,$2,$3,$4,'KR','',$5) value",[args[0],requestId,args[1],args[2],p])).rows[0].value;
 const r=(await db.query("select public.sellerpilot_service_elevenst_new_product_source_readback($1,$2,$3,'KR','') value",args)).rows[0].value;
 const bindArgs=[...args,a.sourceId,r.approvalPayloadSha256,r.sixKindDigest,'d'.repeat(64)];
 const sql="select public.sellerpilot_service_bind_elevenst_new_product_execution($1,$2,$3,'KR','',$4,$5,$6,$7) value";
 const bound=(await db.query(sql,bindArgs)).rows[0].value;assert.equal(bound.sourceId,a.sourceId);assert.deepEqual((await db.query(sql,bindArgs)).rows[0].value,bound);
 const permit=(await db.query('select target_id,assignment_id from sellerpilot_private.elevenst_new_product_execution_permits')).rows[0];assert.equal(permit.target_id,'');
 await setCategory(db,credentialId,'1346631','');await assert.rejects(db.query(sql,bindArgs),/CONTEXT_STALE/);
}finally{await db.close();}});

test('download receipt SHA and RPC ownership remain enforced; changed SQL preimage aborts migration',async()=>{const{db,credentialId}=await setup();try{await generatedFixture(db);await setCategory(db,credentialId,'1009792');await db.exec(migration);const c=await fixture.context(db,credentialId);
 assert.deepEqual(c.productImageSha256s,c.detailImageSha256s.slice(0,4));
 const p=payload(c,credentialId);p.policySource.content.objectReceipts[0].bytesSha256='0'.repeat(64);p.policySource.content.objectReceiptsSha256=digest(p.policySource.content.objectReceipts);
 await assert.rejects(fixture.approve(db,credentialId,p),/OBJECT_EVIDENCE_INVALID/);
 await assert.rejects(db.query("select public.sellerpilot_service_elevenst_new_product_approval_context($1,$2,$3,'KR','11st')",['10000000-0000-4000-8000-000000000099',fixture.PRODUCT_ID,credentialId]),/ACCESS_DENIED/);
 await fixture.fixture.setClaims(db,'authenticated');await assert.rejects(fixture.context(db,credentialId),/ACCESS_DENIED/);
}finally{await db.close();}
 const v=await setup();try{const f=baseline.functions.find(f=>f.name==='sellerpilot_private.elevenst_current_six_kind_digest');await v.db.exec(f.definition.replace('begin','begin\n -- simulated deployment drift'));
 await assert.rejects(v.db.exec(migration),/ELEVENST_CIDER_PREIMAGE_DRIFT/);await v.db.exec('rollback');
 const check=(await v.db.query("select pg_get_constraintdef(oid) definition from pg_constraint where conname='elevenst_new_product_server_sources_category_id_check'")).rows[0];assert.equal(check.definition,baseline.checks.find(c=>c.name==='elevenst_new_product_server_sources_category_id_check').definition);
}finally{await v.db.close();}});
