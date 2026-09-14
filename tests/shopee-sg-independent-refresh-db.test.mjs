import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const migration=await readFile(new URL('../supabase/migrations/20260914134000_shopee_sg_independent_refresh_claim.sql',import.meta.url),'utf8');
const before=JSON.parse(await readFile(new URL('./fixtures/shopee-sg-refresh-before.json',import.meta.url),'utf8'));
const routeBefore=JSON.parse(await readFile(new URL('./fixtures/local-category-read-before.json',import.meta.url),'utf8'));
const owner='5286e97b-40aa-406f-9690-5697cf28cbb0',operator='5286e97b-40aa-406f-9690-5697cf28cbb0',admin='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c';
const source='550d04ed-1e86-44a3-85a0-12ba17ce2374',job='4a45f463-bc16-41fe-847b-ce5dde2a0172';
const u=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token='a'.repeat(64),claim=u(2),worker=u(1),product='c0bdb493-6447-41bf-af0a-46a3da7a75a8';
const digestSql="encode(extensions.digest(decrypted_secret::jsonb::text,'sha256'),'hex')";
function payload(){return{provider_account_subject:'shopee:main:4940266',provider_account_identity_version:'v1',partner_id:'12345',partner_key:'fixture-partner-key-long-enough',main_account_id:'4940266',shop_id:'1719148844',merchant_id:'5511564',access_token:'old-sg-access',refresh_token:'old-sg-refresh',authorization_expires_at:'2027-08-17T06:01:23.077Z',shopee_targets:[['shop','1719148844','2026-09-13T22:20:51.319Z'],['merchant','5511564','2026-09-04T13:39:52.351Z'],...Array.from({length:7},(_,i)=>['shop',String(1758392135+i),'2026-09-03T20:06:51.883Z'])].map(([type,id,expiry])=>({type,id,access_token:`old-${id}-access`,refresh_token:`old-${id}-refresh`,access_token_expires_at:expiry,refresh_token_expires_at:'2027-10-13T18:20:51.319Z'}))};}
function candidate(p,type='shop',id='1719148844',recovery=false){const result=structuredClone(p);const t=result.shopee_targets.find(t=>t.type===type&&t.id===id);Object.assign(t,{access_token:`new-${id}-access`,refresh_token:`new-${id}-refresh`,access_token_expires_at:new Date(Date.now()+14400000).toISOString(),refresh_token_expires_at:new Date(Date.now()+2592000000).toISOString()});Object.assign(result,{[type==='shop'?'shop_id':'merchant_id']:id,access_token:t.access_token,refresh_token:t.refresh_token,access_token_expires_at:t.access_token_expires_at,refresh_token_expires_at:t.refresh_token_expires_at});if(recovery){delete result.provider_account_subject;delete result.provider_account_identity_version;}return result;}
async function setup(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema sellerpilot_private;create schema vault;create schema extensions;
 create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
 create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
 create table sellerpilot_private.admin_users(user_id uuid primary key);
 create table sellerpilot_private.channel_credentials(id uuid primary key,version int,status text,channel text,environment text,created_by uuid,vault_secret_id uuid,expires_at timestamptz,seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz);
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,credential_id uuid,channel text,environment text,operation text,status text,created_by uuid,seller_account_key text,request_payload jsonb default '{}',response_payload jsonb,listing_id uuid,attempt_id uuid,attempt_count int default 0,worker_token_id uuid,claim_token uuid,lease_expires_at timestamptz,created_at timestamptz default now(),started_at timestamptz,updated_at timestamptz default now(),completed_at timestamptz,error_message text,credential_refresh_in_flight boolean default false,credential_refresh_started_at timestamptz,credential_refresh_recovery_vault_id uuid,prepared_credential_id uuid,oauth_exchange_completed boolean default false,provider_mutation_started_at timestamptz);
 create table sellerpilot_private.product_listings(id uuid primary key,product_id uuid);
 create table sellerpilot_private.ai_cli_worker_tokens(id uuid primary key,token_hash text,scope text,status text,expires_at timestamptz,last_version text);
 create table sellerpilot_private.local_channel_executor_routes(id uuid primary key,channel text,operation text,credential_id uuid,worker_token_id uuid,release_sha text,egress_ip_sha256 text,enabled boolean,approved_by uuid,approved_at timestamptz,expires_at timestamptz,seller_account_key text,constraint local_channel_executor_routes_operation_check ${routeBefore.constraint.definition});
 create table sellerpilot_private.cs_shopee_target_refresh_claims(credential_id uuid primary key,job_id uuid,claim_token uuid,target_type text,target_id text,base_credential_version int,status text,candidate_digest text,preparation jsonb,lease_expires_at timestamptz,created_at timestamptz,updated_at timestamptz);
 create table sellerpilot_private.ebay_fresh_oauth_sessions(job_id uuid,source_subject_sha256 text,include_messages boolean);
 create function sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean) returns boolean language sql as $$select exists(select 1 from sellerpilot_private.channel_gateway_jobs j join sellerpilot_private.ai_cli_worker_tokens t on t.id=j.worker_token_id where j.id=$2 and j.claim_token=$3 and j.status='running' and j.lease_expires_at>now() and t.token_hash=$1 and t.scope='serverless_cs' and t.status='active' and t.expires_at>now())$$;
 create function sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text) returns boolean language sql as $$select exists(select 1 from sellerpilot_private.local_channel_executor_routes r where r.credential_id=$2 and r.worker_token_id=$3 and r.enabled and r.approved_by is not null and r.approved_at<=now() and r.expires_at>now() and r.release_sha=$5 and r.egress_ip_sha256=$6 and $4='fixture+'||r.release_sha||'.'||r.egress_ip_sha256)$$;
 create function sellerpilot_private.shopee_sg_create_job_v1(uuid,uuid) returns boolean language sql as $$select exists(select 1 from sellerpilot_private.channel_gateway_jobs where id=$1 and operation='listing.create')$$;
 create function sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(uuid,uuid) returns boolean language sql as $$select current_setting('fixture.listing_lineage',true) is distinct from 'invalid'$$;
 create function public.sellerpilot_service_begin_gateway_credential_refresh(text,uuid,uuid) returns boolean language plpgsql as $$declare n int;begin update sellerpilot_private.channel_gateway_jobs j set credential_refresh_in_flight=true,credential_refresh_started_at=coalesce(credential_refresh_started_at,now()) from sellerpilot_private.ai_cli_worker_tokens t where j.id=$2 and j.worker_token_id=t.id and t.token_hash=$1 and t.status='active' and t.expires_at>now() and j.claim_token=$3 and j.status='running' and j.lease_expires_at>now();get diagnostics n=row_count;return n=1;end$$;
 -- Only Vault encryption and certified identity are adapters. The original
 -- production prepare/recovery/refresh store functions are installed below.
 alter table sellerpilot_private.channel_credentials add column fingerprint text,add column grace_ends_at timestamptz,
 add column rotation_interval_days int default 30,add column warning_days int default 3,
 add column last_rotated_at timestamptz,add column last_checked_at timestamptz,add column last_check_status text,add column last_check_message text;
 alter table sellerpilot_private.channel_credentials alter column seller_account_key_source set default 'legacy_unattested';
 alter table sellerpilot_private.channel_gateway_jobs add column credential_refresh_fingerprint text,
 add column credential_refresh_recovery_fingerprint text,add column credential_refresh_recovery_staged_at timestamptz,
 add column credential_refresh_prepared_at timestamptz;
 create table sellerpilot_private.credential_audit(credential_id uuid,channel text,environment text,action text,actor_user_id uuid,safe_detail jsonb);
 create table vault.secrets(id uuid primary key);
 create function public.sellerpilot_service_refresh_lazada(uuid,jsonb,timestamptz) returns uuid language plpgsql as $$begin raise exception 'Unexpected Lazada branch';end$$;
 create function public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz) returns uuid language plpgsql as $$begin raise exception 'Unexpected eBay branch';end$$;
 create function vault.create_secret(text,text,text) returns uuid language plpgsql as $$declare n uuid:=gen_random_uuid();begin
 if current_setting('fixture.store_failure',true)='true' then raise exception 'fixture durable store unavailable';end if;
 insert into vault.secrets values(n);insert into vault.decrypted_secrets values(n,$1);return n;end$$;
 create function vault.fixture_delete() returns trigger language plpgsql as $$begin delete from vault.decrypted_secrets where id=old.id;return old;end$$;
 create trigger fixture_delete after delete on vault.secrets for each row execute function vault.fixture_delete();
 create function sellerpilot_private.credential_seller_account_lineage(text,text,uuid) returns table(seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz) language sql as $$
 select repeat('b',64),'provider_certified_v1',now() from vault.decrypted_secrets d where d.id=$3
 and d.decrypted_secret::jsonb->>'provider_account_subject'='shopee:main:4940266'
 and current_setting('sellerpilot.provider_account_credential_attestation',true) like 'live:%'$$;

 `);
 for(const [name,f] of Object.entries(before)){if(name==='shared'||!f.definition)continue;await db.exec(f.definition);}
 await db.exec(before.shared.definition);
 for(const name of ['sellerpilot_service_begin_cs_shopee_target_refresh_v1','sellerpilot_service_prepare_cs_shopee_target_refresh_v1','sellerpilot_service_prepare_gateway_credential_refresh']){const sig=(await db.query('select oid::regprocedure::text s from pg_proc where proname=$1',[name])).rows[0].s;await db.exec(`revoke all on function ${sig} from public,anon,authenticated;grant execute on function ${sig} to service_role;`);}
 for(const id of new Set([owner,operator,admin]))await db.query('insert into sellerpilot_private.admin_users values($1)',[id]);
 await db.exec(`alter table sellerpilot_private.channel_gateway_jobs
 add column ebay_publication_recovery_claim_count int default 0,add column rate_limit_count int default 0,
 add column oauth_request_vault_id uuid,add column oauth_request_fingerprint text,add column oauth_source_credential_id uuid,
 add column write_resource_kind text,add column write_resource_key text,add column request_fingerprint text,
 add column inventory_item_id uuid,add column order_id uuid,add column shipment_carrier text,add column shipment_tracking text`);
 for(const check of before._gatewayChecks)await db.exec(`alter table sellerpilot_private.channel_gateway_jobs add constraint ${check.conname} ${check.definition}`);
 const p=payload();await db.query('insert into vault.decrypted_secrets values($1,$2)',[source,JSON.stringify(p)]);
 await db.query("insert into sellerpilot_private.channel_credentials(id,version,status,channel,environment,created_by,vault_secret_id,expires_at,seller_account_key,seller_account_key_source,seller_account_verified_at) values($1,90,'active','shopee','production',$2,$1,'2027-08-17T06:01:23.077Z','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','provider_certified_v1',now())",[source,owner]);
 for(let n=1;n<=148;n++)await db.query("insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status,created_by,seller_account_key,credential_refresh_in_flight,credential_refresh_started_at) values($1,$2,'shopee','production','inquiries.list','reconciliation_required',$3,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',true,now())",[u(n+100),source,owner]);
 await db.query("insert into sellerpilot_private.cs_shopee_target_refresh_claims values($1,$2,$3,'shop','1758392135',90,'active',null,null,now()-interval '5 minutes',now(),now())",[source,u(101),u(999)]);
 await db.query("insert into sellerpilot_private.ai_cli_worker_tokens values($1,$2,'serverless_cs','active',now()+interval '1 day','fixture')",[worker,token]);
 await db.query("insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status,created_by,seller_account_key,request_payload,worker_token_id,claim_token,lease_expires_at) values($1,$2,'shopee','production','shops.get','queued',$3,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{\"shopId\":\"1719148844\"}',$4,$5,now()+interval '15 minutes')",[job,source,operator,worker,claim]);
 let sql=migration;
 for(const [name,f]of Object.entries(before)){if(!f.md5)continue;const h=(await db.query('select md5(prosrc) h from pg_proc where proname=$1',[name])).rows[0].h;sql=sql.replaceAll(f.md5,h);}
 // Incident data are synthetic; replace only its aggregate preimage. Count148
 // and every executable migration predicate remain unchanged.
 const hash=(await db.query(`select encode(extensions.digest(string_agg(id::text||':'||h,',' order by id),'sha256'),'hex') h from(select j.id,encode(extensions.digest(to_jsonb(j)::text||d.decrypted_secret||coalesce((select to_jsonb(t)::text from sellerpilot_private.cs_shopee_target_refresh_claims t where t.job_id=j.id),''),'sha256'),'hex') h from sellerpilot_private.channel_gateway_jobs j join sellerpilot_private.channel_credentials c on c.id=j.credential_id join vault.decrypted_secrets d on d.id=c.vault_secret_id where j.status='reconciliation_required')b`)).rows[0].h;
 sql=sql.replace(/is distinct from '[a-f0-9]{64}'\n then raise exception 'SHOPEE_SG_PRIOR_EVIDENCE_DRIFT'/,`is distinct from '${hash}'\n then raise exception 'SHOPEE_SG_PRIOR_EVIDENCE_DRIFT'`);
 return{db,p,sql};
}
const begin=async(db,type='shop',id='1719148844',ct=claim)=>(await db.query('select public.sellerpilot_service_begin_cs_shopee_target_refresh_v1($1,$2,$3,$4,$5) r',[token,job,ct,type,id])).rows[0].r;
const prepare=async(db,p,recovery,type='shop',id='1719148844')=>(await db.query('select public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1($1,$2,$3,$4,$5,$6,$7,$8,false) r',[token,job,claim,type,id,p,'2027-08-17T06:01:23.077Z',recovery])).rows[0].r;
const scope=async db=>(await db.query('select sellerpilot_private.shopee_sg_registration_refresh_job($1) ok',[job])).rows[0].ok;
const markRunning=db=>db.query("update sellerpilot_private.channel_gateway_jobs set status='running' where id=$1",[job]);

test('exact preimages apply, original claim predicates and public ACLs survive; historical ledgers unchanged',async()=>{const {db,sql}=await setup();try{
 const old=(await db.query("select to_jsonb(j) r from sellerpilot_private.channel_gateway_jobs j where status='reconciliation_required' order by id")).rows;
 const oldClaims=(await db.query('select * from sellerpilot_private.cs_shopee_target_refresh_claims')).rows;
 const acl=(await db.query("select proname,proacl::text acl from pg_proc where proname in('sellerpilot_service_begin_cs_shopee_target_refresh_v1','sellerpilot_service_prepare_cs_shopee_target_refresh_v1','sellerpilot_service_prepare_gateway_credential_refresh') order by proname")).rows;
 await db.exec(sql);assert.equal(await scope(db),true);assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid='sellerpilot_private.channel_gateway_jobs'::regclass and contype='c'")).rows[0].n,17);
 assert.deepEqual((await db.query("select to_jsonb(j) r from sellerpilot_private.channel_gateway_jobs j where status='reconciliation_required' order by id")).rows,old);assert.deepEqual((await db.query('select * from sellerpilot_private.cs_shopee_target_refresh_claims')).rows,oldClaims);
 assert.deepEqual((await db.query("select proname,proacl::text acl from pg_proc where proname in('sellerpilot_service_begin_cs_shopee_target_refresh_v1','sellerpilot_service_prepare_cs_shopee_target_refresh_v1','sellerpilot_service_prepare_gateway_credential_refresh') order by proname")).rows,acl);
 for(const name of ['sellerpilot_183000_claim_serverless_gateway_unsafe','sellerpilot_11820_claim_gateway_unsafe']){const def=(await db.query('select pg_get_functiondef(oid) d from pg_proc where proname=$1',[name])).rows[0].d;assert.equal((def.match(/shopee_sg_registration_unblocked_job_ids/g)||[]).length,1);const restored=def.replace(/ and not \((?:job|j)\.id = any \(\(select sellerpilot_private\.shopee_sg_registration_unblocked_job_ids\(\)\)::uuid\[\]\) and unresolved\.id in \(select job_id from sellerpilot_private\.shopee_sg_registration_prior_fences\)\)/,'');assert.equal(restored.split('\n').map(l=>l.trim()).join('\n').trim(),before[name].definition.trim());}
 const plan=(await db.query(`explain(analyze,format json) select j.id from sellerpilot_private.channel_gateway_jobs j
 where j.id=$1 and not exists(select 1 from sellerpilot_private.channel_gateway_jobs prior
 where prior.status='reconciliation_required' and prior.credential_refresh_in_flight
 and not(j.id=any((select sellerpilot_private.shopee_sg_registration_unblocked_job_ids())::uuid[])
 and prior.id in(select job_id from sellerpilot_private.shopee_sg_registration_prior_fences)))`,[job])).rows[0]['QUERY PLAN'];
 const nodes=[];const visit=n=>{if(n&&typeof n==='object'){if(n['Subplan Name'])nodes.push(n);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}};visit(plan);
 assert.ok(nodes.some(n=>String(n['Subplan Name']).startsWith('InitPlan')&&n['Actual Loops']===1),'historical evidence is evaluated once in an InitPlan');
 await db.exec('set role authenticated');await assert.rejects(db.query('select public.sellerpilot_service_begin_cs_shopee_target_refresh_v1($1,$2,$3,$4,$5)',[token,job,claim,'shop','1719148844']),e=>e.code==='42501');await db.exec('reset role');
 }finally{await db.close();}});

test('SG plus merchant sequential durable refresh preserves other targets, old claim and current owner differences',async()=>{const {db,p,sql}=await setup();try{await db.exec(sql);await markRunning(db);const old=(await db.query('select * from sellerpilot_private.cs_shopee_target_refresh_claims')).rows;
 assert.equal((await begin(db)).status,'acquired');assert.equal((await prepare(db,candidate(p,'shop','1719148844',true),true)).status,'recovery_preserved');
 assert.equal((await begin(db)).status,'reused');const firstCandidate=candidate(p);const first=await prepare(db,firstCandidate,false);assert.equal(first.status,'prepared');assert.equal((await prepare(db,firstCandidate,false)).reused,true);assert.equal(await scope(db),true);
 const p1=JSON.parse((await db.query('select d.decrypted_secret from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id where c.id=$1',[first.credential_id])).rows[0].decrypted_secret);
 assert.deepEqual(p1.shopee_targets.filter(t=>t.id!=='1719148844'),p.shopee_targets.filter(t=>t.id!=='1719148844'));
 assert.equal((await begin(db,'merchant','5511564')).status,'acquired');assert.equal((await prepare(db,candidate(p1,'merchant','5511564',true),true,'merchant','5511564')).status,'recovery_preserved');assert.equal((await begin(db,'merchant','5511564')).status,'reused');const second=await prepare(db,candidate(p1,'merchant','5511564'),false,'merchant','5511564');assert.equal(second.status,'prepared');assert.equal(await scope(db),true);
 assert.deepEqual((await db.query('select * from sellerpilot_private.cs_shopee_target_refresh_claims')).rows,old);
 assert.equal((await db.query('select count(*)::int n from sellerpilot_private.shopee_sg_registration_credential_lineage')).rows[0].n,3);
 const c=(await db.query('select * from sellerpilot_private.channel_credentials where id=$1',[second.credential_id])).rows[0];assert.equal(c.created_by,owner);
 const p2=JSON.parse((await db.query('select d.decrypted_secret from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id where c.id=$1',[second.credential_id])).rows[0].decrypted_secret);
 const sg=p2.shopee_targets.find(t=>t.type==='shop'&&t.id==='1719148844');const metadata={...p2,shop_id:sg.id,access_token:sg.access_token,refresh_token:sg.refresh_token,access_token_expires_at:sg.access_token_expires_at,refresh_token_expires_at:sg.refresh_token_expires_at,shopee_shop_identities:{'1719148844':{market_code:'SG',display_name:'Official fixture shop'}}};delete metadata.merchant_id;
 await db.query('select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3)',[token,job,claim]);
 const savedMetadata=(await db.query('select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4,$5,false,false) r',[token,job,claim,metadata,'2027-08-17T06:01:23.077Z'])).rows[0].r;assert.equal(savedMetadata.status,'prepared');assert.equal(await scope(db),true);

 for(const actor of[operator,admin]){await db.query('update sellerpilot_private.channel_gateway_jobs set created_by=$1 where id=$2',[actor,job]);assert.equal(await scope(db),true);}
 await db.query("update sellerpilot_private.channel_gateway_jobs set operation='categories.suggest',request_payload='{\"arguments\":{\"shopId\":\"1719148844\",\"globalProduct\":true}}' where id=$1",[job]);assert.equal(await scope(db),true);
 await db.query('insert into sellerpilot_private.product_listings values($1,$2)',[u(800),product]);await db.query("update sellerpilot_private.channel_gateway_jobs set operation='listing.create',listing_id=$2 where id=$1",[job,u(800)]);assert.equal(await scope(db),true);
 }finally{await db.close();}});

test('wrong target, changed token, nonadmin, new uncertainty and expired claims remain blocked',async()=>{const {db,sql}=await setup();try{await db.exec(sql);await markRunning(db);
 assert.equal((await begin(db,'shop','1758392135')).status,'ownership_lost');assert.equal((await begin(db,'shop','1719148844',u(3))).status,'ownership_lost');
 for(const change of["update sellerpilot_private.channel_gateway_jobs set request_payload='{\"shopId\":\"1758392135\"}' where id='"+job+"'","update sellerpilot_private.channel_gateway_jobs set created_by='"+u(900)+"' where id='"+job+"'","update vault.decrypted_secrets set decrypted_secret=jsonb_set(decrypted_secret::jsonb,'{refresh_token}','\"changed\"')::text where id='"+source+"'"]){await db.exec('begin');await db.exec(change);assert.equal(await scope(db),false);await db.exec('rollback');}
 await db.exec('begin');await db.query("insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status,created_by,seller_account_key,credential_refresh_in_flight,credential_refresh_started_at) values($1,$2,'shopee','production','shops.get','reconciliation_required',$3,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',true,now())",[u(901),source,owner]);assert.equal((await begin(db)).status,'conflict');await db.exec('rollback');
 await db.exec('begin');await db.query("update sellerpilot_private.channel_gateway_jobs set error_message='new evidence' where id=$1",[u(102)]);assert.equal((await begin(db)).status,'conflict');await db.exec('rollback');
 assert.equal((await begin(db)).status,'acquired');await db.exec("update sellerpilot_private.shopee_sg_registration_refresh_claims set lease_expires_at=now()-interval '1 second'");assert.equal((await begin(db)).status,'conflict');
 }finally{await db.close();}});

test('identity/other-target mutation and persistence failure do not create a successor or erase recovery',async()=>{const {db,p,sql}=await setup();try{await db.exec(sql);await markRunning(db);await begin(db);
 const wrong=candidate(p);wrong.shopee_targets[2].access_token='unauthorized';await assert.rejects(prepare(db,wrong,false));
 await db.exec('begin');await db.exec("select set_config('fixture.store_failure','true',true)");await assert.rejects(prepare(db,candidate(p,'shop','1719148844',true),true));await db.exec('rollback');
 assert.equal((await db.query('select count(*)::int n from sellerpilot_private.shopee_sg_registration_credential_lineage')).rows[0].n,1);
 assert.equal((await prepare(db,candidate(p,'shop','1719148844',true),true)).status,'recovery_preserved');
 const r=(await db.query('select credential_refresh_recovery_vault_id id from sellerpilot_private.channel_gateway_jobs where id=$1',[job])).rows[0].id;assert.ok(r);
 await begin(db);const mismatched=candidate(p);mismatched.provider_account_subject='shopee:main:999';assert.equal((await prepare(db,mismatched,false)).status,'identity_mismatch');assert.equal((await db.query('select credential_refresh_recovery_vault_id id from sellerpilot_private.channel_gateway_jobs where id=$1',[job])).rows[0].id,r);
 }finally{await db.close();}});

test('real production core CHECK rejects merchant before change and still rejects missing/unclaimed/other merchants',async()=>{
 const {db,p,sql}=await setup();try{
 await markRunning(db);await db.query('select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3)',[token,job,claim]);
 const call=async value=>(await db.query('select public.sellerpilot_11820_prepare_refresh_unsafe($1,$2,$3,$4,$5,false,false) r',[token,job,claim,value,'2027-08-17T06:01:23.077Z'])).rows[0].r;
 const m=candidate(p,'merchant','5511564');delete m.shop_id;assert.equal((await call(m)).status,'invalid');
 await db.exec(sql);
 assert.equal((await call(m)).status,'invalid');
 assert.equal((await call({...m,merchant_id:'5511565'})).status,'invalid');
 const missing={...m};delete missing.merchant_id;assert.equal((await call(missing)).status,'invalid');
 }finally{await db.close();}
});

test('identity metadata only permits SG identity and known projection; partner/main credentials stay immutable',async()=>{
 const {db,p,sql}=await setup();try{await db.exec(sql);await markRunning(db);
 const t=p.shopee_targets[0];const metadata={...p,shop_id:t.id,access_token:t.access_token,refresh_token:t.refresh_token,access_token_expires_at:t.access_token_expires_at,refresh_token_expires_at:t.refresh_token_expires_at,shopee_shop_identities:{'1719148844':{market_code:'SG',display_name:'Official fixture'}}};delete metadata.merchant_id;
 await db.query('select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3)',[token,job,claim]);
 const call=value=>db.query('select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4,$5,false,false) r',[token,job,claim,value,'2027-08-17T06:01:23.077Z']);
 for(const patch of[{partner_id:'999'},{partner_key:'forged-key'},{main_account_id:'999'},{main_account_access_token:'forged-main-access'},{main_account_refresh_token:'forged-main-refresh'},{authorization_expires_at:'2099-01-01'},{shopee_shop_identities:{'1758392135':{market_code:'SG'}}}])await assert.rejects(call({...metadata,...patch}),/SHOPEE_SG_IDENTITY_METADATA_WIDENED/);
 for(const patch of[{shop_id:'1758392135'},{merchant_id:'5511564'},{access_token_expires_at:'2099-01-01'}])await assert.rejects(call({...metadata,...patch}),/SHOPEE_SG_TARGET_PROJECTION_MISMATCH/);
 await assert.rejects(db.query('select public.sellerpilot_service_prepare_gateway_credential_refresh($1,$2,$3,$4,$5,false,false) r',[token,job,claim,metadata,'2099-01-01']),/SHOPEE_SG_AUTHORIZATION_EXPIRY_CHANGED/);
 assert.equal((await call(metadata)).rows[0].r.status,'prepared');
 }finally{await db.close();}
});
