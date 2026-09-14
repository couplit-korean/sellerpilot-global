import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20260914174000_temu_approved_ai_local_claim.sql', import.meta.url), 'utf8');
const definitions = JSON.parse(await readFile(new URL('./fixtures/temu-approved-ai-local-claim-before.json', import.meta.url), 'utf8'));
const id = Object.fromEntries(['owner','product','credential','job','attempt','listing','worker','ai','source','attestation','challenge','vault'].map((key,index) => [key, `10000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`]));
const release='8'.repeat(40), egress='a'.repeat(64), seller='b'.repeat(64), request='c'.repeat(64);
const workerVersion=`sellerpilot-cli-worker/1.61+${release}.${egress.slice(0,11)}`;
async function fixture() {
 const db = new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema sellerpilot_private;create schema vault;
 set request.jwt.claim.role='service_role';
 create table sellerpilot_private.serverless_static_egress_policy(channel text primary key,enabled boolean);
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,credential_id uuid,listing_id uuid,attempt_id uuid,channel text,operation text,environment text,status text,attempt_count int,started_at timestamptz,completed_at timestamptz,worker_token_id uuid,claim_token uuid,lease_expires_at timestamptz,provider_mutation_started_at timestamptz,response_payload jsonb,credential_refresh_in_flight boolean,credential_refresh_recovery_vault_id uuid,prepared_credential_id uuid,oauth_exchange_completed boolean,request_payload jsonb,seller_account_key text,request_fingerprint text,created_by uuid);
 create table sellerpilot_private.channel_operation_attempts(id uuid primary key,status text,remote_id text,credential_id uuid,channel text,operation text,seller_account_key text,request_fingerprint text,owner_id uuid);
 create table sellerpilot_private.product_listings(id uuid primary key,product_id uuid,owner_id uuid,operation_attempt_id uuid,channel_key text,status text,remote_id text,published_at timestamptz,seller_account_key text);
 create table sellerpilot_private.products(id uuid primary key,owner_id uuid,external_detail_import_id uuid,status text,demo boolean,ai_job_id uuid,detail_page_image_manifest jsonb,updated_at timestamptz,detail_page_version int,detail_page_approved_version int);
 create table sellerpilot_private.ai_cli_jobs(id uuid primary key,kind text,status text);
 create table sellerpilot_private.channel_credentials(id uuid primary key,channel text,environment text,created_by uuid,seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz,status text,expires_at timestamptz,last_check_status text,version int,fingerprint text,vault_secret_id uuid);
 create table sellerpilot_private.admin_users(user_id uuid primary key);
 create table sellerpilot_private.ai_cli_worker_tokens(id uuid primary key,created_by uuid,scope text,status text,expires_at timestamptz,last_seen_at timestamptz,last_version text);
 create table sellerpilot_private.local_channel_executor_routes(owner_id uuid,channel text,operation text,credential_id uuid,worker_token_id uuid,release_sha text,egress_ip_sha256 text,seller_account_key text,enabled boolean,approved_at timestamptz,expires_at timestamptz,approved_by uuid);
 create table sellerpilot_private.coupang_exact_post_price_verify_runs(verifier_job_id uuid);
 create table sellerpilot_private.temu_create_authoritative_sources(id uuid primary key,owner_id uuid,product_id uuid,credential_id uuid,source_revision bigint,evidence_sha256 text,request_fingerprint text,product_revision_fingerprint text,expires_at timestamptz,product_updated_at timestamptz,credential_version int,credential_fingerprint text,collector_attestation_id uuid,partner_account_subject text,token_identity_subject text,mall_id text,region_id text,category_plan_sha256 text,category_request_sha256 text,category_response_sha256 text,evidence jsonb);
 create table sellerpilot_private.temu_create_authoritative_current(owner_id uuid,product_id uuid,credential_id uuid,source_id uuid,retired_at timestamptz,consumed_job_id uuid);
 create table sellerpilot_private.temu_verified_collector_attestations(id uuid primary key,owner_id uuid,product_id uuid,credential_id uuid,challenge_id uuid,observed_at timestamptz,ingest_sequence bigint,envelope jsonb,key_id text);
 create table sellerpilot_private.temu_collector_attestation_outcomes(attestation_id uuid);
 create table sellerpilot_private.temu_collector_challenges(id uuid,credential_version int,credential_fingerprint text,credential_vault_secret_id uuid,expected_app_id text);
 create table sellerpilot_private.temu_create_app_gate_observations(id uuid,owner_id uuid,product_id uuid,credential_id uuid,collector_attestation_id uuid,source text,observed_at timestamptz,app_state text,compliance_state text,app_id text,partner_account_subject text,rejection_reason text,evidence_sha256 text);
 create table vault.decrypted_secrets(id uuid,decrypted_secret text);
 create function sellerpilot_private.coupang_exact_post_price_local_claim_allowed(uuid,uuid,uuid,text,text,text)returns boolean language sql as $$select false$$;
 create function sellerpilot_private.shopee_sg_local_discovery_allowed(uuid,uuid,uuid,text,text,text)returns boolean language sql as $$select false$$;
 create function sellerpilot_private.local_channel_executor_read_bootstrap_allowed(uuid,uuid,uuid,text,text,text)returns boolean language sql as $$select false$$;
 create function sellerpilot_private.smartstore_approved_ai_local_claim_allowed(uuid,uuid,uuid,text,text,text)returns boolean language sql as $$select false$$;
 create function sellerpilot_private.local_channel_executor_job_allowed_before_coupang_post_price(uuid,uuid,uuid,text,text,text)returns boolean language sql as $$select coalesce(current_setting('test.legacy',true),'false')='true'$$;
 create function sellerpilot_private.local_channel_executor_access(text,text)returns text language sql as $$select case when $1='temu' and $2='listing.create' then 'write' end$$;
 create function sellerpilot_private.active_serverless_runtime_release_sha()returns text language sql as $$select '${release}'$$;
 create function sellerpilot_private.listing_mutation_release_gate_is_effective(text)returns boolean language sql as $$select coalesce(current_setting('test.gate',true),'true')='true'$$;
 -- Cryptographic collector ingestion is exercised in temu-verified-final-cas-db;
 -- this preclaim fixture starts with an ingested signature/shape and runs the
 -- actual current-attestation scope, age, version, vault and key checks.
 create function sellerpilot_private.temu_attestation_shape_valid(jsonb)returns boolean language sql as $$select coalesce(current_setting('test.shape',true),'true')='true'$$;
 create function sellerpilot_private.temu_key_policy_active(text)returns boolean language sql as $$select coalesce(current_setting('test.key',true),'true')='true'$$;
 create function sellerpilot_private.temu_create_source_provider_allowed_r23(uuid,uuid)returns boolean language sql as $$select false$$;
 insert into sellerpilot_private.admin_users values('${id.owner}');
 insert into sellerpilot_private.serverless_static_egress_policy values('temu',false);
 insert into sellerpilot_private.channel_credentials values('${id.credential}','temu','production','${id.owner}','${seller}','provider_certified_v1',now(),'active',now()+interval '1 day','passed',2,'fixture-fingerprint','${id.vault}');
 insert into vault.decrypted_secrets values('${id.vault}','{"app_key":"fixture-app"}');
 insert into sellerpilot_private.ai_cli_worker_tokens values('${id.worker}','${id.owner}','gateway','active',now()+interval '1 day',now(),'${workerVersion}');
 insert into sellerpilot_private.local_channel_executor_routes values('${id.owner}','temu','listing.create','${id.credential}','${id.worker}','${release}','${egress}','${seller}',true,now()-interval '1 day',now()+interval '1 day','${id.owner}');
 insert into sellerpilot_private.ai_cli_jobs values('${id.ai}','product_studio','succeeded');
 insert into sellerpilot_private.products values('${id.product}','${id.owner}',null,'draft',false,'${id.ai}','{}',now(),1,1);
 insert into sellerpilot_private.product_listings values('${id.listing}','${id.product}','${id.owner}','${id.attempt}','temu','queued',null,null,null);
 insert into sellerpilot_private.channel_operation_attempts values('${id.attempt}','running',null,'${id.credential}','temu','listing.create','${seller}','${request}','${id.owner}');
 insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,listing_id,attempt_id,channel,operation,environment,status,attempt_count,credential_refresh_in_flight,oauth_exchange_completed,seller_account_key,request_fingerprint,created_by) values('${id.job}','${id.credential}','${id.listing}','${id.attempt}','temu','listing.create','production','queued',0,false,false,'${seller}','${request}','${id.owner}');
 insert into sellerpilot_private.temu_collector_challenges values('${id.challenge}',2,'fixture-fingerprint','${id.vault}','fixture-app');
 insert into sellerpilot_private.temu_collector_attestation_outcomes values('${id.attestation}');
 insert into sellerpilot_private.temu_verified_collector_attestations values('${id.attestation}','${id.owner}','${id.product}','${id.credential}','${id.challenge}',now(),1,'{}','fixture-signing');
 insert into sellerpilot_private.temu_create_app_gate_observations values('${id.attestation}','${id.owner}','${id.product}','${id.credential}','${id.attestation}','service_verified_signed_local_collector_v1',now(),'active','approved','fixture-app','fixture-account',null,repeat('e',64));
 `);
 for (const [name,definition] of Object.entries(definitions)) {
  if (name !== 'temu_create_source_provider_allowed_r23') await db.exec(definition);
 }
 const images=Array.from({length:8},(_,i)=>({role:`detail-${i}`,path:`results/approved/${i}.png`,sourceSha256:String(i).repeat(64)}));
 const manifest={contract:'sellerpilot_detail_image_manifest_v2',digest:'d'.repeat(64),images};
 const source={contract:'temu_create_authoritative_source_binding_v1',sourceId:id.source,sourceRevision:1,evidenceSha256:'e'.repeat(64),requestFingerprint:request,productRevisionFingerprint:'f'.repeat(64)};
 const evidence={contract:'temu_create_authoritative_source_v1',requestFingerprint:request,product:{productId:id.product,revisionFingerprint:source.productRevisionFingerprint},credential:{credentialId:id.credential,version:2,active:true},account:{partnerAccountSubject:'fixture-account',tokenIdentitySubject:'fixture-token',mallId:'11',regionId:'22'},app:{appId:'fixture-app',state:'active',complianceState:'approved'},category:{categoryPlanSha256:'1'.repeat(64),requestEvidenceSha256:'2'.repeat(64),responseEvidenceSha256:'3'.repeat(64),leafCategoryVerified:true,categoryRecommendationVerified:true,categoryAttributesVerified:true,categoryComplianceVerified:true,certificationDecisionVerified:true},shipping:{defaultTemplateId:'existing-template',storeDefaultShippingVerified:true,warehouseVerified:true,feeRuleVerified:true,returnPolicyVerified:true},egress:{endpointHost:'openapi-b-global.temu.com',state:'static_ip_verified'},assets:{productId:id.product,productRevisionFingerprint:source.productRevisionFingerprint,representativeImages:['https://fixture.invalid/processed.png'],detailImages:images.map(i=>`https://fixture.invalid/${i.path}`)},duplicateRead:{goodsReadComplete:true,skuReadComplete:true,goodsEmpty:true,skuEmpty:true,continuationPresent:false,existingGoodsRecoveryUsed:false}};
 const args={publicationIntent:'live',publicationStateContract:'verified_remote_state_v1',publicationExpectedImageCount:8,sellerpilotTemuAuthoritativeSource:source,sellerpilotPublicationAssetBinding:{contract:'sellerpilot_publication_asset_binding_v1',approvedManifestDigest:manifest.digest,approvedDetailPageVersion:1,approvedDetailImages:images.map(i=>({role:i.role,approvedObjectPath:i.path,approvedSourceSha256:i.sourceSha256}))}};
 await db.query('update sellerpilot_private.products set detail_page_image_manifest=$1',[manifest]);
 await db.query('update sellerpilot_private.channel_gateway_jobs set request_payload=$1',[{arguments:args}]);
 await db.query(`insert into sellerpilot_private.temu_create_authoritative_sources select '${id.source}','${id.owner}','${id.product}','${id.credential}',1,$1,$2,$3,now()+interval '4 minutes',updated_at,2,'fixture-fingerprint','${id.attestation}','fixture-account','fixture-token','11','22',$4,$5,$6,$7 from sellerpilot_private.products`,[source.evidenceSha256,request,source.productRevisionFingerprint,'1'.repeat(64),'2'.repeat(64),'3'.repeat(64),evidence]);
 await db.exec(`insert into sellerpilot_private.temu_create_authoritative_current values('${id.owner}','${id.product}','${id.credential}','${id.source}',null,null);`);
 await db.query(`update sellerpilot_private.temu_verified_collector_attestations set envelope=$1`,[{credentialVersion:2,credentialFingerprint:'fixture-fingerprint',credentialVaultSecretId:id.vault,appId:'fixture-app',receiptKeyId:'fixture-receipt',shipping:{warehouseVerified:true,feeRuleVerified:true,returnPolicyVerified:true},egress:{state:'static_ip_verified'}}]);
 return db;
}
async function allowed(db, overrides=[]) {
 const args=[id.job,id.credential,id.worker,workerVersion,release,egress];for(const[i,v]of overrides)args[i]=v;
 return (await db.query('select sellerpilot_private.local_channel_executor_job_allowed($1,$2,$3,$4,$5,$6) allowed',args)).rows[0].allowed;
}
test('AI Temu CREATE becomes claimable with current source/collector/route; rows and final write fence remain untouched',async()=>{
 const db=await fixture();try {
 const before=(await db.query(`select to_jsonb(j) job from sellerpilot_private.channel_gateway_jobs j`)).rows;
 const fence=(await db.query(`select prosrc,proacl,proconfig from pg_proc where proname='temu_create_source_provider_allowed'`)).rows;
 assert.equal(await allowed(db),false);await db.exec(migration);
 assert.equal(await allowed(db),true);
 assert.deepEqual((await db.query(`select to_jsonb(j) job from sellerpilot_private.channel_gateway_jobs j`)).rows,before);
 assert.deepEqual((await db.query(`select prosrc,proacl,proconfig from pg_proc where proname='temu_create_source_provider_allowed'`)).rows,fence);
 assert.equal((await db.query(`select sellerpilot_private.temu_create_source_provider_allowed('${id.job}',null) allowed`)).rows[0].allowed,false);
 assert.equal((await db.query(`select has_function_privilege('service_role','sellerpilot_private.temu_approved_ai_local_claim_allowed(uuid,uuid,uuid,text,text,text)','execute') allowed`)).rows[0].allowed,false);
 }finally{await db.close();}
});
test('source consumption, identity, approved images, active route and fresh attestation cannot be bypassed',async()=>{
 const db=await fixture();try{await db.exec(migration);
 for(const patch of [
  `update sellerpilot_private.temu_create_authoritative_current set consumed_job_id='${id.job}'`,
  `update sellerpilot_private.temu_create_authoritative_current set retired_at=now()`,
  `update sellerpilot_private.temu_create_authoritative_sources set expires_at=now()-interval '1 second'`,
  `update sellerpilot_private.temu_create_authoritative_sources set product_updated_at=now()+interval '1 second'`,
  `update sellerpilot_private.temu_create_authoritative_sources set evidence=jsonb_set(evidence,'{duplicateRead,goodsEmpty}','false')`,
  `update sellerpilot_private.temu_create_authoritative_sources set collector_attestation_id='${id.challenge}'`,
  `update sellerpilot_private.temu_create_app_gate_observations set compliance_state='reviewing'`,
  `update sellerpilot_private.temu_verified_collector_attestations set observed_at=now()-interval '6 minutes'`,
  `update sellerpilot_private.channel_credentials set version=3`,
  `update sellerpilot_private.channel_credentials set created_by='${id.worker}'`,
  `update sellerpilot_private.channel_credentials set seller_account_key=repeat('0',64)`,
  `update sellerpilot_private.products set status='archived'`,
  `update sellerpilot_private.products set detail_page_approved_version=0`,
  `update sellerpilot_private.products set detail_page_image_manifest=jsonb_set(detail_page_image_manifest,'{images,0,path}','"unapproved.png"')`,
  `update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,sellerpilotTemuAuthoritativeSource,evidenceSha256}','"changed"')`,
  `update sellerpilot_private.channel_gateway_jobs set attempt_count=1`,
  `update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=now()`,
  `update sellerpilot_private.product_listings set remote_id='existing-remote'`,
  `update sellerpilot_private.local_channel_executor_routes set enabled=false`,
  `update sellerpilot_private.local_channel_executor_routes set expires_at=now()-interval '1 second'`,
  `update sellerpilot_private.ai_cli_worker_tokens set last_seen_at=now()-interval '4 minutes'`,
  `update sellerpilot_private.serverless_static_egress_policy set enabled=true`,
  `set test.key='false'`, `set test.shape='false'`, `set test.gate='false'`,
 ]){await db.exec('begin');await db.exec(patch);assert.equal(await allowed(db),false,patch);await db.exec('rollback');}
 assert.equal(await allowed(db,[[4,'0'.repeat(40)]]),false);
 assert.equal(await allowed(db,[[5,'0'.repeat(64)]]),false);
 }finally{await db.close();}
});
test('migration rejects baseline drift and leaves the prior non-AI dispatcher path intact',async()=>{
 const db=await fixture();try{
 await db.exec(definitions.temu_create_evidence_valid.replace("select jsonb_typeof(p_evidence)='object'", "select false and jsonb_typeof(p_evidence)='object'"));
 await assert.rejects(db.exec(migration),/TEMU_AI_LOCAL_PREIMAGE_DRIFT/);await db.exec('rollback');
 await db.exec(definitions.temu_create_evidence_valid);await db.exec(migration);
 await db.exec(`set test.legacy='true';update sellerpilot_private.channel_gateway_jobs set channel='qoo10'`);
 assert.equal(await allowed(db),true);
 }finally{await db.close();}
});
