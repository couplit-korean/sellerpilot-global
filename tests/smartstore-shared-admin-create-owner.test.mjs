import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const fixtureUrl=new URL('./smartstore-approved-draft-db.test.mjs',import.meta.url);
const code=await readFile(fixtureUrl,'utf8');
const prefix=code.slice(0,code.indexOf("test('all eight"));
const tpart=code.slice(code.indexOf('const transportFixtureUrl='),code.indexOf("test('approved draft stages"));
const moduleText=(prefix+tpart+'\nexport{setup,f,tf};').replaceAll("'import.meta.url'", "'__INNER_META_URL__'").replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href)).replaceAll('__INNER_META_URL__','import.meta.url')
 .replaceAll("import.meta.resolve('@electric-sql/pglite')",JSON.stringify(import.meta.resolve('@electric-sql/pglite')))
 .replaceAll("import.meta.resolve('@electric-sql/pglite/contrib/pgcrypto')",JSON.stringify(import.meta.resolve('@electric-sql/pglite/contrib/pgcrypto')));
const {setup,f,tf}=await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString('base64')}`);
const before=JSON.parse(await readFile(new URL('./fixtures/smartstore-shared-admin-before.json',import.meta.url),'utf8'));
const migration=await readFile(new URL('../supabase/migrations/20260914171000_smartstore_shared_admin_create_owner.sql',import.meta.url),'utf8');
const other='20000000-0000-4000-8000-000000000099';
async function installBefore(db){
 await db.exec('alter table sellerpilot_private.channel_credentials add column created_by uuid');
 for(const row of before)await db.exec(row.definition);
}
async function shared(db){await db.query('update sellerpilot_private.channel_gateway_jobs set created_by=$1',[other]);await db.query('update sellerpilot_private.channel_credentials set created_by=$1',[other]);}
const allowed=async db=>(await db.query('select sellerpilot_private.smartstore_create_source_is_current($1,$2) allowed',[f.ids.job,f.ids.claim])).rows[0].allowed;
async function sourceDb(){const db=await setup();await installBefore(db);
 // The existing fixture starts from the reviewed pre-approved-draft predicates.
 // Load only its other six source collection predicates; the four under review are the live definitions above.
 const old=JSON.parse(await readFile(new URL('./fixtures/smartstore-approved-draft-before.json',import.meta.url),'utf8'));
 for(const r of old)if(!before.some(b=>b.signature.replace(/^public\./,'')===r.signature.replace(/^public\./,'')))await db.exec(r.definition.replace(r.old,r.new));
 await f.storeCompleteSelections(db);await f.appendSource(db,{official:f.completeOfficial,providerAttributes:f.completeProviderAttributes});await f.bindJob(db);return db;}

test('live preimages preserve ACLs and rollback; shared admin source passes without loosening claim/owner/TTL/revision',async()=>{const db=await sourceDb();try{
 assert.equal(await allowed(db),true);await shared(db);assert.equal(await allowed(db),false);
 const pre=await db.query("select oid::regprocedure::text signature,prosrc,proacl::text acl from pg_proc where oid=any($1::regprocedure[]) order by 1",[before.map(r=>r.signature)]);
 await db.exec(migration.replace(/commit;\s*$/,'rollback;'));
 assert.deepEqual(await db.query("select oid::regprocedure::text signature,prosrc,proacl::text acl from pg_proc where oid=any($1::regprocedure[]) order by 1",[before.map(r=>r.signature)]),pre);
 await db.exec(migration);assert.equal(await allowed(db),true);
 for(const r of before){let expected=r.definition;for(const [old,next] of r.edits)expected=expected.replaceAll(old,next);assert.equal((await db.query('select pg_get_functiondef($1::regprocedure) definition',[r.signature])).rows[0].definition,expected);}
 for(const sql of [
 'delete from sellerpilot_private.admin_users',
 `update sellerpilot_private.channel_credentials set created_by='${f.ids.product}'`,
 `update sellerpilot_private.channel_operation_attempts set owner_id='${other}'`,
 `update sellerpilot_private.product_listings set owner_id='${other}'`,
 `update sellerpilot_private.products set owner_id='${other}'`,
 `update sellerpilot_private.channel_gateway_jobs set claim_token='${other}'`,
 "update sellerpilot_private.products set updated_at=updated_at+interval '1 microsecond'",
 "update sellerpilot_private.channel_credentials set fingerprint='FFFFFFFFFFFF'",
 ]){await db.exec('begin');await db.exec(sql);assert.equal(await allowed(db),false,sql);await db.exec('rollback');}
 }finally{await db.close();}});

test('staging and completion retain exact shared owner, bytes, credential, claim and duplicate guards',async()=>{const{db,body}=await tf.createDatabase();try{
 // This fixture exercises real stage/complete bodies; the category row type is required to install all four exact guarded definitions.
 await db.exec(`create table sellerpilot_private.smartstore_create_category_attribute_sources(id uuid); insert into auth.users values ('${other}');`);await installBefore(db);await db.exec("update sellerpilot_private.products set status='draft'");await shared(db);
 await assert.rejects(tf.stage(db,body),/SOURCE_DRIFT/);await db.exec(migration);
 for(const sql of ['delete from sellerpilot_private.admin_users',`update sellerpilot_private.channel_credentials set created_by='${tf.ids.product}'`,`update sellerpilot_private.product_listings set owner_id='${other}'`,`update sellerpilot_private.channel_gateway_jobs set claim_token='${other}'`]){await db.exec('begin');await db.exec(sql);await assert.rejects(tf.stage(db,body),/SOURCE_DRIFT|JOB_NOT_CURRENT/);await db.exec('rollback');}
 await tf.stage(db,body);
 const saved=(await db.query('select owner_id from sellerpilot_private.smartstore_create_final_transports')).rows;assert.equal(saved[0].owner_id,tf.ids.owner);
 for(const sql of ['delete from sellerpilot_private.admin_users',`update sellerpilot_private.smartstore_create_final_transports set owner_id='${other}'`,`update sellerpilot_private.product_listings set owner_id='${other}'`,`update sellerpilot_private.channel_credentials set created_by='${tf.ids.product}'`]){await db.exec('begin');await db.exec(sql);await assert.rejects(tf.complete(db,body),/SOURCE_MISMATCH/);await db.exec('rollback');}
 assert.equal((await tf.complete(db,body)).rows[0].completed.status,'completed');assert.equal((await tf.complete(db,body)).rows[0].completed.reused,true);
 }finally{await db.close();}});

test('unexpected function preimage aborts all replacements',async()=>{const db=await sourceDb();try{
 const row=before[2];await db.exec(row.definition.replace('begin','begin\n -- unexpected drift'));
 await assert.rejects(db.exec(migration),/PREIMAGE_DRIFT/);await db.exec('rollback');
 for(const r of before.filter(r=>r!==row)){const actual=(await db.query('select md5(prosrc) md5 from pg_proc where oid=$1::regprocedure',[r.signature])).rows[0].md5;assert.equal(actual,r.md5);}
 }finally{await db.close();}});
