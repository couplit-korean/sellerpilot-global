import test from 'node:test';import assert from 'node:assert/strict';import{readFile,mkdtemp,rm}from'node:fs/promises';import{createHash}from'node:crypto';import{realFixture}from'./external-detail-real-publication.fixture.mjs';
import{tmpdir}from'node:os';import path from 'node:path';
import{prepareExternalReviewed}from'./external-detail-reviewed-wrappers.fixture.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
test('reviewed 279→280→281→282 wrappers: exact source, preimage denial, late row-digest rollback and postread',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'sellerpilot-external-wrappers-'));
 let db;try{
 await prepareExternalReviewed(output);
 ({db}=await realFixture({external:false}));
 const tmp=output+path.sep;const results=[];
 const required=['20260905140000','20260905141000','20260905142000','20260906010000','20260906011000','20260906030000','20260906050000','20260906060000'];
 await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);");
 for(const version of required)await db.query("insert into supabase_migrations.schema_migrations values($1,'LOCAL_SYNTHETIC_HISTORY',array['fixture only'])",[version]);
 await db.exec("insert into supabase_migrations.schema_migrations select 'fixture-'||i,'LOCAL_SYNTHETIC_HISTORY',array['not all-history replay'] from generate_series(1,271)i;");
 await db.exec("insert into auth.users values('11111111-1111-4111-8111-111111111111');insert into sellerpilot_private.admin_users(user_id,display_name)values('11111111-1111-4111-8111-111111111111','Synthetic');insert into sellerpilot_private.products(id,owner_id,external_code,sku,name,description)values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WRAPPER','WRAPPER','Synthetic wrapper product','original');");
 for(const [i,step]of ['400','430','530'].entries()){
  const prefix=tmp+'external'+step+'-reviewed',manifest=JSON.parse(await readFile(prefix+'-manifest.json','utf8')),sql=await readFile(prefix+'-apply.sql','utf8'),post=await readFile(prefix+'-postread.sql','utf8'),source=await readFile(new URL('../supabase/migrations/'+manifest.sourceFile,import.meta.url));
  assert.equal(sha(source),manifest.sourceSha256);assert.equal(sha(sql),manifest.sqlSha256);assert.equal(sha(post),manifest.postreadSha256);
  const copies=sql.split('$reviewed_external_'+step+'_source$');assert.equal(copies.length,7);for(const j of [1,3,5])assert.ok(Buffer.from(copies[j]).equals(source));
  const rejected=async(candidate,pattern)=>{await assert.rejects(db.exec(candidate),pattern);await db.exec('rollback;');assert.equal((await db.query('select count(*)::integer n from supabase_migrations.schema_migrations')).rows[0].n,279+i);assert.equal((await db.query("select description from sellerpilot_private.products where sku='WRAPPER'")).rows[0].description,'original');};
  await rejected(sql.replace(`)=${279+i} and not exists`,')=999999 and not exists'),/EXTERNAL_HISTORY_PREIMAGE/);
  const native='sellerpilot_private.listing_publication_review_is_current(uuid)';await db.exec('grant execute on function '+native+' to authenticated;');await rejected(sql,/EXTERNAL_DEPENDENCY_BODY_ACL_ABI_CHANGED/);await db.exec('revoke execute on function '+native+' from authenticated;');
  // Fault injection is OUTSIDE each exact embedded/source body, after source DDL.
  await rejected(sql.replace('do $external_post$ begin',"update sellerpilot_private.products set description='fault injected' where sku='WRAPPER';\ndo $external_post$ begin"),/EXTERNAL_EXISTING_BUSINESS_ROWS_CHANGED/);
  for(const signature of Object.keys(manifest.functions)){if(manifest.dependencies[signature])continue;assert.equal((await db.query('select to_regprocedure($1)::text value',[signature])).rows[0].value,null,'rolled back new function '+signature);}
  await db.exec(sql);assert.equal((await db.query('select count(*)::integer n from supabase_migrations.schema_migrations')).rows[0].n,280+i);
  const postResults=await db.exec(post);assert.ok(postResults.some(r=>r.rows?.[0]?.external_postcondition?.sourceExact===true));
  results.push({step,history:280+i,success:true,historyMismatchRollback:true,predecessorAclMismatchRollback:true,postDdlBusinessMismatchRollback:true,postread:true,embeddedCopiesByteExact:true});
 }
 assert.equal(results.length,3);
 }finally{if(db)await db.close();await rm(output,{recursive:true,force:true});}
});
