import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration=await readFile(new URL('../supabase/migrations/20260914163000_elevenst_exact_placeholder_successor.sql',import.meta.url),'utf8');
const source='b2dd0ff7-4420-495f-aead-a45857fb3bfe',owner='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c';
const routeIds=['a81a3f1d-b697-4372-b7d2-952565fe136c','805c4101-14fb-47ca-b7f3-6a1eec5183d7','3ced3218-2746-4932-a385-9d2875788b9f','bd18a58d-52cf-4d97-8bc7-6457e468d8f2','5dca216d-e5c3-4780-b6cf-a214565da64f','b6e62dd7-7573-40e3-bc90-1bec93fbdaa1','35e2888e-9798-4f03-968e-783aaaf798f5'];
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema sellerpilot_private;create schema vault;create schema extensions;
 create function extensions.digest(v text,a text) returns bytea language sql immutable as $$select sha256(convert_to(v,'UTF8'))$$;
 create function extensions.digest(v bytea,a text) returns bytea language sql immutable as $$select sha256(v)$$;
 create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
 create function vault.create_secret(p text,n text,d text) returns uuid language plpgsql as $$declare v uuid:=gen_random_uuid();begin insert into vault.decrypted_secrets values(v,p);return v;end$$;
 create table sellerpilot_private.channel_credentials(id uuid primary key,channel text,environment text,version integer,vault_secret_id uuid,fingerprint text,status text,created_by uuid,seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz,last_check_status text,last_checked_at timestamptz,last_rotated_at timestamptz,expires_at timestamptz,grace_ends_at timestamptz,rotation_interval_days int,warning_days int, unique(channel,environment,version));
 create table sellerpilot_private.elevenst_credential_identity_claims(credential_id uuid primary key,environment text,seller_id_digest text,seller_account_key text,lifecycle_state text,created_by uuid,identity_evidence text default 'admin_claim_v1',access_checked_at timestamptz,activated_at timestamptz);
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,credential_id uuid,status text,claim_token uuid,operation text,credential_refresh_in_flight boolean default false,credential_refresh_recovery_vault_id uuid,prepared_credential_id uuid,request_payload jsonb,response_payload jsonb);
 create table sellerpilot_private.elevenst_new_product_server_sources(id uuid,credential_id uuid);
 create table sellerpilot_private.elevenst_new_product_source_approvals(id uuid,credential_id uuid);
 create table sellerpilot_private.channel_catalog_items(id uuid,credential_id uuid,present boolean);
 create table sellerpilot_private.local_channel_executor_routes(id uuid primary key,credential_id uuid,channel text,operation text,enabled boolean,expires_at timestamptz,owner_id uuid,seller_account_key text,release_sha text,egress_ip_sha256 text,approved_by uuid,approved_at timestamptz);
 create table sellerpilot_private.cs_credential_capability_bindings(id uuid primary key,credential_id uuid,status text,updated_at timestamptz,verified_job_id uuid,token_fingerprint text);
 create table sellerpilot_private.credential_audit(id bigint generated always as identity,credential_id uuid,channel text,environment text,action text,actor_user_id uuid,safe_detail jsonb);
 create function sellerpilot_private.elevenst_seller_id_digest(v uuid) returns text language sql as $$select encode(sha256(convert_to('elevenst'||chr(31)||lower(trim(decrypted_secret::jsonb->>'seller_id')),'UTF8')),'hex') from vault.decrypted_secrets where id=v$$;
 -- Exercise the installed contracts: revoke affects the old claim/CS binding;
 -- the existing rotation marker inherits account lineage, never fresh API proof.
 create function sellerpilot_private.fixture_status() returns trigger language plpgsql as $$begin
 if new.status<>old.status then update sellerpilot_private.elevenst_credential_identity_claims set lifecycle_state=new.status where credential_id=new.id;update sellerpilot_private.cs_credential_capability_bindings set status='revoked',updated_at=clock_timestamp() where credential_id=new.id and status='active';end if;return new;end$$;
 create trigger sync_status after update of status on sellerpilot_private.channel_credentials for each row execute function sellerpilot_private.fixture_status();
 create function sellerpilot_private.fixture_lineage() returns trigger language plpgsql as $$declare c record;begin
 if nullif(current_setting('sellerpilot.elevenst_credential_rotation_source',true),'') is not null then
 select * into c from sellerpilot_private.channel_credentials where id=current_setting('sellerpilot.elevenst_credential_rotation_source')::uuid and status='revoked';
 new.seller_account_key:=c.seller_account_key;new.seller_account_key_source:=c.seller_account_key_source;new.seller_account_verified_at:=c.seller_account_verified_at;end if;return new;end$$;
 create trigger inherit_lineage before insert on sellerpilot_private.channel_credentials for each row execute function sellerpilot_private.fixture_lineage();
 insert into vault.decrypted_secrets values('${source}',jsonb_build_object('api_key',repeat('A',32),'seller_id','sample')::text);
 insert into sellerpilot_private.channel_credentials(id,channel,environment,version,vault_secret_id,fingerprint,status,created_by,seller_account_key,seller_account_key_source,seller_account_verified_at,last_check_status,last_checked_at,rotation_interval_days,warning_days) values('${source}','elevenst','production',2,'${source}','123456789ABC','active','${owner}',repeat('a',64),'credential_incarnation_v1',now(),'passed',now(),90,30);
 insert into sellerpilot_private.elevenst_credential_identity_claims values('${source}','production',sellerpilot_private.elevenst_seller_id_digest('${source}'),repeat('a',64),'active','${owner}','admin_claim_v1',now(),now());
 insert into sellerpilot_private.cs_credential_capability_bindings values('dd1970ca-ca6d-4b60-814e-7ce066aff4eb','${source}','active',now(),'00000000-0000-4000-8000-000000000009','old-proof');
 insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,status,operation,request_payload,response_payload) select gen_random_uuid(),'${source}',case when n=9 then 'reconciliation_required' else 'succeeded' end,'listing.create',jsonb_build_object('old',n),jsonb_build_object('preserved',n) from generate_series(1,9)n;
 `);
 for(let i=0;i<routeIds.length;i++)await db.query(`insert into sellerpilot_private.local_channel_executor_routes values($1,$2,'elevenst',$3,true,now()+interval '1 day',$4,repeat('a',64),repeat('b',40),repeat('c',64),$4,now())`,[routeIds[i],source,['categories.attributes','inquiries.list','diagnostic.test','listing.create','categories.validate','categories.suggest','orders.list'][i],owner]);
 await db.exec(migration);return db;
}
async function hashes(db){return (await db.query(`select
 (select encode(extensions.digest(to_jsonb(c)::text,'sha256'),'hex') from sellerpilot_private.channel_credentials c where id='${source}') c,
 (select encode(extensions.digest(decrypted_secret::jsonb::text,'sha256'),'hex') from vault.decrypted_secrets where id='${source}') p,
 (select encode(extensions.digest(to_jsonb(c)::text,'sha256'),'hex') from sellerpilot_private.elevenst_credential_identity_claims c where credential_id='${source}') i,
 (select encode(extensions.digest(jsonb_agg(to_jsonb(r) order by id)::text,'sha256'),'hex') from sellerpilot_private.local_channel_executor_routes r where credential_id='${source}') r`)).rows[0];}
async function call(db,h){h??=await hashes(db);return(await db.query(`select public.sellerpilot_service_prepare_elevenst_couplit_successor($1,$2,$3,$4,$5,clock_timestamp()-interval '1 minute') r`,[h.c,h.p,h.i,h.r,'d'.repeat(64)])).rows[0].r;}
async function snapshot(db){return(await db.query(`select (select jsonb_agg(to_jsonb(x) order by id) from sellerpilot_private.channel_credentials x)c,(select jsonb_agg(to_jsonb(x) order by id) from vault.decrypted_secrets x)v,(select jsonb_agg(to_jsonb(x) order by id) from sellerpilot_private.channel_gateway_jobs x)j,(select jsonb_agg(to_jsonb(x) order by id) from sellerpilot_private.local_channel_executor_routes x)r,(select jsonb_agg(to_jsonb(x) order by id) from sellerpilot_private.cs_credential_capability_bindings x)b`)).rows[0];}
test('v3 preserves old Vault/key/history/route grants; CS awaits fresh verification',async()=>{
 const db=await fixture();try{const before=await snapshot(db),expected=await hashes(db),result=await call(db,expected);const after=await snapshot(db);
 assert.equal(result.status,'pending');assert.equal(result.version,3);assert.notEqual(result.credentialId,source);
 assert.deepEqual(after.j,before.j);assert.equal(after.j.length,9);assert.equal(after.j.filter(j=>j.status==='reconciliation_required').length,1);
 const old=after.c.find(c=>c.id===source),next=after.c.find(c=>c.id===result.credentialId);assert.equal(old.status,'revoked');assert.equal(old.version,2);assert.equal(next.status,'pending');assert.equal(next.last_check_status,null);assert.equal(next.created_by,owner);assert.equal(next.seller_account_key,old.seller_account_key);
 assert.deepEqual(after.v.find(v=>v.id===source),before.v[0]);const payload=JSON.parse(after.v.find(v=>v.id===next.vault_secret_id).decrypted_secret);assert.equal(payload.api_key,'A'.repeat(32));assert.equal(payload.seller_id,'couplit');
 const digest=(await db.query("select upper(substr(encode(extensions.digest($1::jsonb::text,'sha256'),'hex'),1,12)) d",[JSON.stringify(payload)])).rows[0].d;assert.equal(next.fingerprint,digest);
 const newClaim=(await db.query('select * from sellerpilot_private.elevenst_credential_identity_claims where credential_id=$1',[next.id])).rows[0];assert.equal(newClaim.lifecycle_state,'pending');assert.equal(newClaim.access_checked_at,null);assert.equal(newClaim.activated_at,null);assert.equal(newClaim.identity_evidence,'admin_claim_v1');
 assert.deepEqual(after.r.map(r=>({...r,credential_id:source})),before.r);assert.equal(after.b.length,1);assert.equal(after.b[0].credential_id,source);assert.equal(after.b[0].status,'revoked');assert.equal(after.b[0].verified_job_id,before.b[0].verified_job_id);
 const audit=(await db.query('select safe_detail d from sellerpilot_private.credential_audit')).rows[0].d;assert.equal(audit.apiKeyUnchanged,true);assert.equal(audit.copiedCsBindings,0);assert.equal(JSON.stringify(audit).includes('A'.repeat(32)),false);
 await assert.rejects(call(db,expected),/ELEVENST_PLACEHOLDER_SOURCE_CHANGED/);
 }finally{await db.close();}
});
test('transaction rollback restores exact old credential, encrypted-payload fixture, jobs, routes and CS binding',async()=>{
 const db=await fixture();try{const before=await snapshot(db);await db.exec('begin');await call(db);await db.exec('rollback');assert.deepEqual(await snapshot(db),before);assert.equal((await db.query('select count(*)::int n from sellerpilot_private.credential_audit')).rows[0].n,0);}finally{await db.close();}
});
test('changed owner/key/source, in-flight work, approved source, and route drift are rejected',async()=>{
 const db=await fixture();try{const expected=await hashes(db),before=await snapshot(db);
 const changes=[`update sellerpilot_private.channel_credentials set created_by=gen_random_uuid() where id='${source}'`,`update vault.decrypted_secrets set decrypted_secret=jsonb_set(decrypted_secret::jsonb,'{api_key}',to_jsonb(repeat('B',32)))::text where id='${source}'`,`update sellerpilot_private.channel_gateway_jobs set status='running' where id=(select id from sellerpilot_private.channel_gateway_jobs limit 1)`,`insert into sellerpilot_private.elevenst_new_product_source_approvals values(gen_random_uuid(),'${source}')`,`update sellerpilot_private.local_channel_executor_routes set expires_at=now()-interval '1 minute' where id='${routeIds[0]}'`,`update sellerpilot_private.local_channel_executor_routes set release_sha=repeat('f',40) where id='${routeIds[0]}'`,`update sellerpilot_private.elevenst_credential_identity_claims set seller_id_digest=repeat('f',64) where credential_id='${source}'`];
 for(const change of changes){await db.exec('begin');await db.exec(change);await assert.rejects(call(db,expected),/ELEVENST_PLACEHOLDER_/);await db.exec('rollback');assert.deepEqual(await snapshot(db),before);}
 }finally{await db.close();}
});
test('exact correction RPC is not exposed to anonymous/authenticated clients',async()=>{
 const db=await fixture();try{for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.sellerpilot_service_prepare_elevenst_couplit_successor(text,text,text,text,text,timestamptz)','EXECUTE') p",[role])).rows[0].p,role==='service_role');}finally{await db.close();}
});
