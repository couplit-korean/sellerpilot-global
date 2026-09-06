import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{inspectPackage,seal,unseal,renderDDL}from'../scripts/db-baseline-export.mjs';
import{assertIsolatedTarget,compareDDL,prerequisites}from'../scripts/db-baseline-restore.mjs';
const fixture=()=>({serverVersion:'17.6',objects:[{kind:'table',identity:'public.t',ddl:'CREATE TABLE public.t(id integer);'}],roles:[],extensions:[],unsupported:[],externalDependencies:[],history:[]});
test('exact DDL survives authenticated encrypted round trip',()=>{const p=fixture(),key=Buffer.alloc(32,7);const e=seal(p,key);assert.deepEqual(unseal(e,key),p);assert.ok(!e.includes('CREATE TABLE'));assert.throws(()=>unseal(e,Buffer.alloc(32,8)));});
test('tampered encrypted payload is rejected',()=>{const key=Buffer.alloc(32,7),e=JSON.parse(seal(fixture(),key));const b=Buffer.from(e.body,'base64');b[0]^=1;e.body=b.toString('base64');assert.throws(()=>unseal(JSON.stringify(e),key));});
test('unsupported or external dependency blocks runnable SQL',()=>{for(const field of ['unsupported','externalDependencies']){const p=fixture();p[field]=[{identity:'missing'}];assert.throws(()=>renderDDL(p),/blocked/);}});
test('metadata never claims historical replay or native verification',()=>{const s=inspectPackage(fixture());assert.equal(s.nativeRestoreVerified,false);assert.equal(s.historicalReplayProven,false);assert.equal(s.dataRowsExported,0);assert.equal(s.dependencyClosureVerified,false);});
test('literal detection reports count not sensitive content',()=>{const p=fixture();p.objects[0].ddl="SELECT 'Bearer abcdefghijklmnopqrstuvwxyz';";const s=inspectPackage(p);assert.equal(s.literalRiskMatches,1);assert.ok(!JSON.stringify(s).includes('abcdefghijklmnopqrstuvwxyz'));});
test('remote and ambiguous target refused before psql',()=>{for(const env of [{},{PGHOST:'db.supabase.co',PGDATABASE:'sellerpilot_baseline_test',PGUSER:'postgres'},{PGHOST:'localhost',PGDATABASE:'postgres',PGUSER:'postgres'},{PGHOST:'localhost',PGDATABASE:'sellerpilot_baseline_test',PGUSER:'postgres',PGSERVICE:'prod'}])assert.throws(()=>assertIsolatedTarget(env));assert.doesNotThrow(()=>assertIsolatedTarget({PGHOST:'127.0.0.1',PGDATABASE:'sellerpilot_baseline_test',PGUSER:'postgres'}));});
test('DDL changes fail comparison; ordering alone is immaterial',()=>{const p=fixture();assert.equal(compareDDL(p,structuredClone(p)).matches,true);const q=structuredClone(p);q.objects[0].ddl+=' -- changed';assert.equal(compareDDL(p,q).matches,false);});
test('render does not fabricate migration history',()=>{assert.ok(!renderDDL(fixture()).includes('schema_migrations'));assert.match(renderDDL(fixture()),/^BEGIN;/);});
test('prerequisites never create login passwords',()=>{const p=fixture();p.roles=[{name:'service_role',inherit:false,bypassRls:true}];assert.match(prerequisites(p),/NOLOGIN/);assert.ok(!prerequisites(p).includes('PASSWORD'));});
test('catalog source excludes customer and Vault data',async()=>{const sql=await readFile(new URL('../scripts/db-baseline-catalog.sql',import.meta.url),'utf8');assert.doesNotMatch(sql,/from\s+(?:vault\.|auth\.users|sellerpilot_private\.)/i);assert.match(sql,/pg_get_functiondef/);assert.match(sql,/pg_policy/);assert.match(sql,/pg_default_acl/);});
test('role drift also fails round trip, privilege fields are never ignored',()=>{const a=fixture(),b=fixture();a.roles=[{name:'worker',bypassRls:false}];b.roles=[{name:'worker',bypassRls:true}];assert.equal(compareDDL(a,b).matches,false);assert.match(prerequisites({...fixture(),roles:[{name:'worker',superuser:false}]}),/existing role security attribute mismatch/);});
test('catalog supports all four previously omitted security contracts',async()=>{const s=await readFile(new URL('../scripts/db-baseline-catalog.sql',import.meta.url),'utf8');for(const marker of ['pg_auth_members','m.inherit_option','m.set_option','GRANTED BY','enum-owner',"SELECT 'TYPE'",'collation-owner','a.attcollation','co.colllocale','SEQUENCE NAME','seq.seqcache','seq.seqcycle'])assert.ok(s.includes(marker),marker);});
test('real PostgreSQL WASM catalog extracts and replays role, enum, collation and identity metadata without extension stubs',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const a=new PGlite(),b=new PGlite();
 try{
  const setup="CREATE SCHEMA sellerpilot_private; CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions; CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text,name text);";
  await a.exec(setup);
  await a.exec(`CREATE ROLE baseline_owner NOLOGIN; CREATE ROLE baseline_member NOLOGIN; GRANT baseline_owner TO baseline_member WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
CREATE TYPE sellerpilot_private.status AS ENUM ('new','done'); ALTER TYPE sellerpilot_private.status OWNER TO baseline_owner; REVOKE ALL ON TYPE sellerpilot_private.status FROM PUBLIC; GRANT USAGE ON TYPE sellerpilot_private.status TO baseline_member WITH GRANT OPTION;
CREATE COLLATION sellerpilot_private.custom_c FROM pg_catalog."C"; ALTER COLLATION sellerpilot_private.custom_c OWNER TO baseline_owner;
CREATE TABLE sellerpilot_private.fixture(id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME sellerpilot_private.special_id START WITH 7 INCREMENT BY 3 MINVALUE 7 MAXVALUE 999 CACHE 4 CYCLE), label text COLLATE sellerpilot_private.custom_c, status sellerpilot_private.status);`);
  const source=await readFile(new URL('../scripts/db-baseline-catalog.sql',import.meta.url),'utf8');
  await a.exec('SET search_path=pg_catalog');const p=(await a.query(source)).rows[0].package;
  assert.deepEqual(p.unsupported,[]);assert.deepEqual(p.externalDependencies,[]);
  assert.match(p.objects.find(o=>o.kind==='table'&&o.identity.endsWith('.fixture')).ddl,/SEQUENCE NAME sellerpilot_private.special_id START WITH 7 INCREMENT BY 3 MINVALUE 7 MAXVALUE 999 CACHE 4 CYCLE/);
  await b.exec(prerequisites(p));await b.exec(renderDDL(p));
  await b.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text,name text); SET search_path=pg_catalog');
  const q=(await b.query(source)).rows[0].package;
  const secure=p=>p.objects.filter(o=>['enum','enum-owner','collation','collation-owner','role-membership','table','sequence','owner','grant','revoke'].includes(o.kind));
  const diff=compareDDL({...p,objects:secure(p)},{...q,objects:secure(q)});assert.equal(diff.matches,true,JSON.stringify(diff));
 }finally{await a.close();await b.close();}
});
