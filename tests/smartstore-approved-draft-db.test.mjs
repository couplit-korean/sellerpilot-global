import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const fixtureUrl=new URL('./smartstore-create-category-attribute-source.test.mjs',import.meta.url);
const text=await readFile(fixtureUrl,'utf8');
const declarations=text.slice(0,text.indexOf('test("actual SQL snapshot'))
 .replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href))
 .replaceAll('"@electric-sql/pglite"',JSON.stringify(import.meta.resolve('@electric-sql/pglite')))
 .replaceAll('"@electric-sql/pglite/contrib/pgcrypto"',JSON.stringify(import.meta.resolve('@electric-sql/pglite/contrib/pgcrypto')))
 .replaceAll('"../lib/channels/smartstore-category-attribute-mapping.ts"',JSON.stringify(new URL('../lib/channels/smartstore-category-attribute-mapping.ts',import.meta.url).href));
const f=await import(`data:text/javascript;base64,${Buffer.from(declarations+'\nexport{createDatabase,appendSource,snapshot,bindJob,begin,storeCompleteSelections,completeOfficial,completeProviderAttributes,ids};').toString('base64')}`);
const baseline=JSON.parse(await readFile(new URL('./fixtures/smartstore-approved-draft-before.json',import.meta.url),'utf8'));
const migration=await readFile(new URL('../supabase/migrations/20260914145000_smartstore_approved_draft_create.sql',import.meta.url),'utf8');
const restored=await readFile(new URL('../supabase/migrations/20260913032500_restore_smartstore_create_source_and_completion_contracts.sql',import.meta.url),'utf8');
const transportSql='begin;\n'+restored.slice(restored.indexOf('-- Reviewed source: 20260910050500'));
async function setup(){const db=await f.createDatabase();await db.exec(`
 create table auth.users(id uuid primary key);insert into auth.users values('${f.ids.owner}');
 create schema if not exists extensions;
 create or replace function extensions.digest(value text,algorithm text)returns bytea language sql immutable as $$select public.digest(value,algorithm)$$;
 create function sellerpilot_private.worker_token_may_complete_gateway_job(text,uuid,uuid)returns boolean language sql stable as $$select true$$;
 alter table sellerpilot_private.products add column name text not null default '상품',add column on_hand integer not null default 1;
 alter table sellerpilot_private.products add constraint production_product_status check(status in('draft','active','low_stock','out_of_stock','archived')) not valid;
 alter table sellerpilot_private.channel_credentials add column vault_secret_id uuid default '10000000-0000-4000-8000-000000000099',add column last_rotated_at timestamptz default '2026-09-01T00:00:00Z';
 update sellerpilot_private.products set status='draft';
 update sellerpilot_private.ai_cli_jobs set request_payload=jsonb_build_object('manual_fields',jsonb_build_object('currency','KRW','sellingPrice','3000','stock','1','sellerSku','SMART-011','productName','상품'));
`);await db.exec(transportSql);for(const r of baseline)await db.exec(r.definition);return db;}
const ctx=async(db,owner=f.ids.owner)=>(await db.query('select public.sellerpilot_service_smartstore_create_category_collect_ctx($1,$2,$3) value',[owner,f.ids.product,f.ids.credential])).rows[0].value;
const ledger=async db=>(await db.query('select to_jsonb(s) value from sellerpilot_private.smartstore_create_category_attribute_sources s order by id')).rows;

test('all eight exact production predicates update, ACLs survive, approved draft collects and preserves source lineage',async()=>{const db=await setup();try{
 await assert.rejects(ctx(db),/PRODUCT_NOT_READY/);const before=(await db.query("select oid::regprocedure::text name,proacl::text acl from pg_proc where proname like '%smartstore%'")).rows;
 await db.exec(migration);const c=await ctx(db);assert.equal(c.productId,f.ids.product);assert.equal(c.approvedDetailRevision,3);
 assert.deepEqual((await db.query("select oid::regprocedure::text name,proacl::text acl from pg_proc where proname like '%smartstore%'")).rows,before);
 for(const r of baseline){const actual=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[r.signature])).rows[0].definition;assert.equal(actual,r.definition.replace(r.old,r.new),r.name);}
 await f.storeCompleteSelections(db);const a=await f.appendSource(db,{official:f.completeOfficial,providerAttributes:f.completeProviderAttributes});assert.ok(a);const saved=await ledger(db);assert.equal(saved.length,1);
 assert.equal((await f.appendSource(db,{official:f.completeOfficial,providerAttributes:f.completeProviderAttributes})).replayed,true);assert.deepEqual(await ledger(db),saved);
 const snapshot=await f.snapshot(db);assert.equal(snapshot.productId,f.ids.product);assert.ok(snapshot.categoryAttributeSource);
 await db.exec("update sellerpilot_private.products set status='active'");assert.ok(await ctx(db));assert.ok(await f.snapshot(db));
 assert.deepEqual(await ledger(db),saved);
}finally{await db.close();}});

test('archived/inactive/demo/unapproved/cross-owner and stale assignments remain blocked with no ledger append',async()=>{const db=await setup();try{await db.exec(migration);
 for(const status of ['archived','low_stock','out_of_stock']){await db.query('update sellerpilot_private.products set status=$1',[status]);await assert.rejects(ctx(db),/PRODUCT_NOT_READY/);await assert.rejects(f.appendSource(db),/PRODUCT_STALE/);assert.equal(await f.snapshot(db),null);}
 await db.exec("update sellerpilot_private.products set status='draft'");await assert.rejects(ctx(db,f.ids.otherOwner),/PRODUCT_NOT_READY/);
 await db.exec('update sellerpilot_private.products set demo=true');await assert.rejects(ctx(db),/PRODUCT_NOT_READY/);await db.exec('update sellerpilot_private.products set demo=false,detail_page_approved_version=2');await assert.rejects(ctx(db),/PRODUCT_NOT_READY/);
 await db.exec("update sellerpilot_private.products set detail_page_approved_version=3;update sellerpilot_private.channel_credentials set last_check_status='failed'");await assert.rejects(ctx(db),/CREDENTIAL_NOT_READY/);
 await db.exec("update sellerpilot_private.channel_credentials set last_check_status='passed';update sellerpilot_private.product_category_assignments set missing_required_attributes='[\"missing\"]'");await assert.rejects(ctx(db),/ASSIGNMENT_AMBIGUOUS/);assert.deepEqual(await ledger(db),[]);
}finally{await db.close();}});

test('a changed deployment preimage rolls the migration back and does not alter source data',async()=>{const db=await setup();try{const r=baseline[0];await db.exec(r.definition.replace('begin','begin\n -- deployment drift'));
 await assert.rejects(db.exec(migration),/PREIMAGE_DRIFT/);await db.exec('rollback');assert.deepEqual(await ledger(db),[]);await assert.rejects(ctx(db),/PRODUCT_NOT_READY/);
}finally{await db.close();}});

// Independently exercise the real final-transport/atomic-completion bodies.
// The preceding fixture already applied every one of the eight production MD5 guards.
const transportFixtureUrl=new URL('./smartstore-create-final-transport-r4.test.mjs',import.meta.url);
const transportText=await readFile(transportFixtureUrl,'utf8');
const transportDeclarations=transportText.slice(0,transportText.indexOf('test("reserved SmartStore'))+transportText.slice(transportText.indexOf('async function complete('),transportText.indexOf('test("atomic SmartStore'));
const transportModule=transportDeclarations
 .replace(/const migration = await readFile\([\s\S]*?"utf8"\);/u,()=>`const migration=${JSON.stringify(transportSql)};`)
 .replaceAll('"@electric-sql/pglite"',JSON.stringify(import.meta.resolve('@electric-sql/pglite')))
 .replaceAll('"@electric-sql/pglite/contrib/pgcrypto"',JSON.stringify(import.meta.resolve('@electric-sql/pglite/contrib/pgcrypto')))
 .replaceAll('"../lib/channels/smartstore-create-transport.ts"',JSON.stringify(new URL('../lib/channels/smartstore-create-transport.ts',import.meta.url).href));
const tf=await import(`data:text/javascript;base64,${Buffer.from(transportModule+'\nexport{createDatabase,stage,complete,ids};').toString('base64')}`);
test('approved draft stages exact body and completes once; archived and cross-owner completion remain blocked',async()=>{const{db,body}=await tf.createDatabase();try{
 for(const name of ['public.sellerpilot_service_stage_smartstore_create_transport','public.sellerpilot_complete_smartstore_listing_create','public.sellerpilot_service_smartstore_create_source_snapshot'])await db.exec(baseline.find(r=>r.name===name).definition);
 await db.exec("update sellerpilot_private.products set status='draft';alter table sellerpilot_private.products add constraint production_product_status check(status in('draft','active','low_stock','out_of_stock','archived'));alter table sellerpilot_private.channel_gateway_jobs add constraint production_status check(status in('queued','running','succeeded','failed','cancelled','reconciliation_required'));");
 await assert.rejects(tf.stage(db,body),/TRANSPORT_SOURCE_DRIFT/);
 // This focused transport fixture has three of the eight functions; retain their exact guards.
 await db.exec(migration.replace('v_oid:=to_regprocedure(r.signature);','v_oid:=to_regprocedure(r.signature); if v_oid is null then continue;end if;'));
 await db.exec("update sellerpilot_private.products set status='archived'");await assert.rejects(tf.stage(db,body),/TRANSPORT_SOURCE_DRIFT/);
 await db.exec("update sellerpilot_private.products set status='draft'");await tf.stage(db,body);
 await db.query('update sellerpilot_private.product_listings set owner_id=$1 where id=$2',[tf.ids.product,tf.ids.listing]);await assert.rejects(tf.complete(db,body),/COMPLETION_SOURCE_MISMATCH/);await db.query('update sellerpilot_private.product_listings set owner_id=$1 where id=$2',[tf.ids.owner,tf.ids.listing]);
 await db.exec("update sellerpilot_private.products set status='archived'");await assert.rejects(tf.complete(db,body),/COMPLETION_SOURCE_MISMATCH/);await db.exec("update sellerpilot_private.products set status='draft'");
 assert.equal((await tf.complete(db,body)).rows[0].completed.status,'completed');assert.equal((await tf.complete(db,body)).rows[0].completed.reused,true);
 assert.equal((await db.query('select status from sellerpilot_private.products where id=$1',[tf.ids.product])).rows[0].status,'draft');
}finally{await db.close();}});
