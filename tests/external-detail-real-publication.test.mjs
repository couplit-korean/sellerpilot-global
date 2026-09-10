import test from 'node:test';import assert from 'node:assert/strict';import{realFixture}from'./external-detail-real-publication.fixture.mjs';
import{catalog,affectedTables}from'./external-detail-real-publication.fixture.mjs';
test('captured trigger hashes + affected RLS/ACL/FK with 100/140/141/142/110 then 300/500/600/400/430/530',async()=>{
 const{db,functions,timeline,sourceVerification}=await realFixture();try{
  assert.ok(functions>100);
  const key=t=>t.table_name+'.'+t.name;
  const expectedAdded=[['channel_gateway_jobs.guard_shopee_exact_oauth_terminal_lease'],[],['lazada_exact_claims.lazada_exact_claim_immutable','lazada_exact_completions.lazada_exact_completion_immutable','lazada_exact_oauth_sessions.lazada_exact_session_identity']];
  const expectedChanged=[[],['channel_market_targets.supersede_exact_lazada_three_blockers_after_readback'],[]];
  const pendingPins=['fc43861c980c74aa3ec135ab657669609fadfcfe097393253dfcd523395683a5','32a9bd6c4d6f475c2a47d4d60a8cea45b94d78f508f1ad0826253d46e72b4b12','ff2099afdd470f642d3ad1c94803047f0ca18e1c86aee270679b4ca5e1e05205'];
  const deltas=[];
  assert.equal(timeline[0].triggers.filter(t=>['products','channel_gateway_jobs'].includes(t.table_name)).length,47);
  for(let i=1;i<timeline.length;i++){
    const previous=timeline[i-1].triggers,current=timeline[i].triggers;
    const old=new Map(previous.map(t=>[key(t),t])),now=new Map(current.map(t=>[key(t),t]));
    const added=current.filter(t=>!old.has(key(t))),removed=previous.filter(t=>!now.has(key(t))),changed=current.filter(t=>old.has(key(t))&&JSON.stringify(t)!==JSON.stringify(old.get(key(t))));
    assert.equal(timeline[i].sha256,pendingPins[i-1],'reviewed pending source freeze');
    assert.deepEqual(added.map(key),expectedAdded[i-1]);assert.deepEqual(removed,[]);assert.deepEqual(changed.map(key),expectedChanged[i-1]);
    for(const t of changed){assert.equal(t.definition,old.get(key(t)).definition);assert.equal(t.enabled,old.get(key(t)).enabled);assert.notEqual(t.body_sha256,old.get(key(t)).body_sha256);}
    assert.equal(current.filter(t=>['products','channel_gateway_jobs'].includes(t.table_name)).length,48);
    assert.ok(added.every(t=>t.enabled==='O'));
    deltas.push({stage:timeline[i].stage,sha256:timeline[i].sha256,added,removed,changed});
  }
  assert.equal(sourceVerification.length,254,'captured current source and exact owner/ACL checked');
  const finalTriggerCount=(await db.query("select count(*)::integer as n from pg_trigger where not tgisinternal and tgrelid in('sellerpilot_private.products'::regclass,'sellerpilot_private.channel_gateway_jobs'::regclass)")).rows[0].n;
  assert.equal(finalTriggerCount,51,'48 pre400 plus three external triggers');
  const dedicated=['shopee_exact_oauth_sessions','lazada_same_account_oauth_boundary','lazada_exact_oauth_sessions','lazada_exact_claims','lazada_exact_completions'];
  const dedicatedSecurity=(await db.query("select c.relname,c.relrowsecurity,pg_get_userbyid(c.relowner) owner,not exists(select 1 from pg_policies where schemaname=n.nspname and tablename=c.relname) as no_policies,not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') and not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as private_acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='sellerpilot_private' and c.relname=any($1::text[])",[dedicated])).rows;
  assert.equal(dedicatedSecurity.length,5);assert.ok(dedicatedSecurity.every(t=>t.relrowsecurity&&t.owner==='postgres'&&t.no_policies&&t.private_acl));


  const live=catalog;
  for(const t of live.triggers){const rows=(await db.query("select pg_get_triggerdef(t.oid) definition,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') hash,t.tgenabled enabled from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgname=$1 and t.tgrelid=$2::regclass",[t.name,t.table])).rows;assert.equal(rows.length,1);assert.equal(rows[0].hash,t.functionBodySha256,t.name);assert.equal(rows[0].definition,t.definition,t.name);assert.equal(rows[0].enabled,t.enabled,t.name);}
  for(const receipt of catalog.forwardReceipts){
    for(const f of receipt.functions){const [schema,name]=f.name.split('.');const found=(await db.query('select md5(p.prosrc) md5,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[schema,name])).rows;assert.ok(found.some(x=>x.md5===f.md5&&x.acl===f.acl),f.name);}
  }
  const tables=(await db.query("select c.relname name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,pg_get_userbyid(c.relowner) owner,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='sellerpilot_private' and c.relname=any($1::text[]) order by c.relname",[affectedTables])).rows;
  const foreignKeys=(await db.query("select c.relname table_name,k.conname name,pg_get_constraintdef(k.oid) definition,k.convalidated validated from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='sellerpilot_private' and c.relname=any($1::text[]) and k.contype='f' order by c.relname,k.conname",[affectedTables])).rows;
  assert.ok(foreignKeys.length>30);assert.equal(tables.length,affectedTables.length);
  const capturedSecurity=catalog.affectedSecurity;
  const currentNames=new Set(capturedSecurity.tables.map(t=>t.name));
  const tableProjection=t=>({name:t.name,owner:t.owner,acl:t.acl,rls:t.rls,forceRls:t.forceRls??t.force_rls});
  assert.deepEqual(tables.filter(t=>currentNames.has(t.name)).map(tableProjection),capturedSecurity.tables.map(tableProjection),'17 current-table RLS/ACL/owner exact match');
  assert.deepEqual(tables.filter(t=>!currentNames.has(t.name)).map(t=>t.name).sort(),['external_detail_import_audit','external_detail_imports']);
  const projectedFks=foreignKeys.filter(f=>currentNames.has(f.table_name)&&f.name!=='products_external_detail_import_id_fkey').map(f=>({table:f.table_name,name:f.name,definition:f.definition,validated:f.validated}));
  assert.deepEqual(projectedFks,capturedSecurity.foreignKeys,'47 current foreign keys exactly match before four external FK additions');
  const policies=(await db.query("select tablename as table,policyname as name,cmd,roles,qual,with_check as \"withCheck\" from pg_policies where schemaname='sellerpilot_private' and tablename=any($1::text[]) order by tablename,policyname",[[...currentNames]])).rows;
  assert.deepEqual(policies,capturedSecurity.policies,'current affected policy set exact match');

  for(const table of ['inventory_product_bindings','lazada_order_item_claims']){
    assert.equal(tables.find(t=>t.name===table).rls,true);
    for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar(db,"select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE')",[role,'sellerpilot_private.'+table]),false);
  }
  assert.equal(await scalar(db,"select count(*)::int from pg_policies where schemaname='sellerpilot_private' and tablename in('inventory_product_bindings','lazada_order_item_claims')"),0);
  console.log({functions,triggersMatched:live.triggers.length,affectedTables:tables.length,foreignKeys:foreignKeys.length});
 }finally{await db.close();}
});

import{createHash}from'node:crypto';
import{externalDetailDigest}from'../lib/external-detail-copy.ts';
const owner='11111111-1111-4111-8111-111111111111',product='1ed4acfc-7603-48ec-a638-241131e59358',id='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',source='44444444-4444-4444-8444-444444444444',attempt='55555555-5555-4555-8555-555555555555',verifier='66666666-6666-4666-8666-666666666666',listing='77777777-7777-4777-8777-777777777777',claim='88888888-8888-4888-8888-888888888888',hash='a'.repeat(64),time='2026-09-05T12:00:00.123456+00:00';
async function scalar(db,sql,params=[]){return Object.values((await db.query(sql,params)).rows[0])[0];}
async function seed(db){const roles=['detail-overview','detail-feature','detail-use','detail-package','detail-routine','detail-dimensions','detail-contents','detail-care'];const assets=roles.map((role,i)=>({assetId:`00000000-0000-4000-8000-${String(i+10).padStart(12,'0')}`,role,sourceSha256:String(i).repeat(64),byteLength:100}));assets.forEach(a=>a.storagePath=`external-detail/${owner}/${product}/${id}/${a.assetId}/${a.sourceSha256}.png`);const copies=Object.fromEntries(['ko','ja','en'].map(l=>{const document={root:{},content:[{type:'StoryBlock',props:{body:`한글 日本語 English ${l}`}}]};return[l,{document,documentSha256:externalDetailDigest(document),reviewNote:'Synthetic reviewer'}];}));
const raw={importId:id,productId:product,ownerId:owner,actorId:owner,expectedProductUpdatedAt:time,expectedDetailVersion:1,expectedAiJobId:job,source:{kind:'external_generated'},assets,originalEvidence:[{path:`${owner}/original.png`,sha256:hash}],reviewedCopy:copies};const payload={...raw,requestSha256:externalDetailDigest(raw)};const receipts=assets.map(a=>({...a,decodedRgbaSha256:a.sourceSha256,verification:'bytes_only_not_approved'}));const call=(action,p)=>scalar(db,'select public.sellerpilot_service_external_detail_import($1,$2,$3,$4,$5::jsonb)',[action,owner,product,id,JSON.stringify(p)]);await call('reserve',payload);await call('verify',{requestSha256:payload.requestSha256,receipts});const approved=await call('approve',{requestSha256:payload.requestSha256,receipts,reviewConfirmed:true});return{assets,payload,approved};}

test('actual-table approval → eight normalized assets → readback → native completion/live, plus ownership boundaries',async()=>{
 const {db}=await realFixture();try{
  await db.query('insert into auth.users(id)values($1)',[owner]);
  await db.query("insert into sellerpilot_private.admin_users(user_id,display_name)values($1,'Synthetic')",[owner]);
  await db.query("insert into sellerpilot_private.ai_cli_jobs(id,kind,status,created_by,request_payload,result_payload)values($1,'product_studio','failed',$2,$3::jsonb,'{}')",[job,owner,JSON.stringify({image_paths:[owner+'/original.png']})]);
  await db.query("insert into sellerpilot_private.products(id,owner_id,external_code,sku,name,ai_job_id,updated_at,detail_page_version,detail_page_data,detail_page_updated_at)values($1,$2,'SYNTHETIC','SYNTHETIC','Synthetic',$3,$4,1,'{}',$4)",[product,owner,job,time]);
  const inventorySource=await scalar(db,'select public.sellerpilot_service_inventory_bootstrap_source($1,$2,$3)',[product,owner,'SYNTHETIC']);
  await scalar(db,'select public.sellerpilot_service_bootstrap_product_inventory($1,$2,$3,$4,$5,$6)',[product,owner,'SYNTHETIC',inventorySource.sourceFingerprint,inventorySource.onHand,inventorySource.reserved]);
  const inventoryBefore=(await db.query('select to_jsonb(i) row from sellerpilot_private.inventory_items i where product_id=$1',[product])).rows;
  const {assets,payload,approved}=await seed(db);
  assert.deepEqual((await db.query('select to_jsonb(i) row from sellerpilot_private.inventory_items i where product_id=$1',[product])).rows,inventoryBefore,'141 bound mirror preserves stock through external approval');
  const credential='99999999-9999-4999-8999-999999999999';
  const account='c'.repeat(64),token='99999999-9999-4999-8999-999999999998',tokenHash='9'.repeat(64);
  await db.query("insert into sellerpilot_private.channel_credentials(id,channel,environment,version,vault_secret_id,fingerprint,status,created_by,seller_account_key,seller_account_key_source,seller_account_verified_at)values($1,'qoo10','production',1,$1,$2,'active',$3,$4,'provider_certified_v1',now())",[credential,hash,owner,account]);
  await db.query("insert into sellerpilot_private.channels(key,name,market,code,color,status,sort_order)values('qoo10','Synthetic','JP','Q','#112233','active',1)");
  await db.query("insert into sellerpilot_private.channel_operation_attempts(id,owner_id,credential_id,channel,operation,idempotency_key,request_fingerprint,status)values($1,$2,$3,'qoo10','listing.update',$4,$4,'running')",[attempt,owner,credential,hash]);
  await db.query("insert into sellerpilot_private.product_listings(id,owner_id,product_id,channel_key,market,target_id,currency,price)values($1,$2,$3,'qoo10','JP','Japan','JPY',100)",[listing,owner,product]);

  const normalized=assets.map((a,i)=>{const sha=(i+1).toString(16).repeat(64),path='normalized/'+sha.slice(0,2)+'/'+sha+'.jpg';return {role:a.role,approvedObjectPath:a.storagePath,approvedSourceSha256:a.sourceSha256,objectPath:path,contentSha256:sha,publicUrl:'https://test.supabase.co/storage/v1/object/public/sellerpilot-marketplace/'+path};});
  assert.equal(await scalar(db,'select public.sellerpilot_service_register_marketplace_normalized_asset_refs($1,$2,$3,$4,$5,$6::text[])',[attempt,product,'qoo10','JP','Japan',normalized.map(n=>n.objectPath)]),true);
  await scalar(db,'select public.sellerpilot_service_mark_marketplace_normalized_assets_uploaded($1,$2::text[])',[attempt,normalized.map(n=>n.objectPath)]);
  assert.equal(await scalar(db,'select public.sellerpilot_service_bind_marketplace_normalized_asset_urls($1,$2::jsonb)',[attempt,JSON.stringify(normalized.map(n=>({...n,sourceObjectPath:n.approvedObjectPath,sourceSha256:n.approvedSourceSha256})))]),true);
  const digest=createHash('sha256').update(assets.map(a=>a.role+'\t'+a.storagePath+'\t'+a.sourceSha256).join('\n')).digest('hex');
  const binding={contract:'sellerpilot_publication_asset_binding_v1',approvedManifestDigest:digest,approvedDetailPageVersion:2,approvedDetailImages:normalized,providerTransportImages:normalized,providerImageSurface:'detail_content'};
  const b={productId:product,ownerId:owner,importId:id,version:2,productUpdatedAt:approved.approved_product_updated_at,requestSha256:payload.requestSha256,channel:'qoo10',market:'JP',targetId:'Japan',language:'ja',locale:'ja-JP',documentSha256:payload.reviewedCopy.ja.documentSha256,allLocaleDocumentSha256:Object.fromEntries(Object.entries(payload.reviewedCopy).map(([l,c])=>[l,c.documentSha256])),imageSha256s:assets.map(a=>a.sourceSha256),pixelSha256s:assets.map(a=>a.sourceSha256),title:'Reviewed',html:'<p>Reviewed</p>',plain:'Reviewed',sections:[]};b.exportSha256=externalDetailDigest({title:b.title,html:b.html,plain:b.plain,sections:b.sections});
  const args={sellerpilotExternalDetail:b,sellerpilotPublicationAssetBinding:binding,publicationStateContract:'verified_remote_state_v1',publicationIntent:'live',publicationExpectedLocale:'ja-JP',publicationExpectedFingerprint:hash,publicationExpectedImageCount:8};
  const remote={visibility:'pending_review',verified:true,locale:'ja-JP',fingerprint:hash,imageCount:8,evidence:{publicationAssetBinding:{contract:'sellerpilot_provider_asset_binding_v1',approvedManifestDigest:digest,approvedDetailPageVersion:2,providerDetailImageIdentities:assets.map((_,i)=>'provider-'+i)}}};
  const response={ok:true,publicationStateContract:'verified_remote_state_v1',publicationIntent:'live',remoteId:'synthetic-remote',publicationFulfilled:false,remoteState:remote};
  await db.query("insert into sellerpilot_private.ai_cli_worker_tokens(id,label,token_hash,fingerprint,scope,expires_at,created_by)values($1,'Synthetic',$2,left($2,12),'serverless_cs',now()+interval '1 day',$3)",[token,tokenHash,owner]);
  await db.query("update sellerpilot_private.channel_operation_attempts set status='succeeded',completed_at=now(),remote_id='synthetic-remote',seller_account_key=$2 where id=$1",[attempt,account]);
  await db.query("update sellerpilot_private.product_listings set operation_attempt_id=$2,remote_id='synthetic-remote',seller_account_key=$3,status='paused',requested_publication_intent='live',remote_visibility='pending_review',remote_resources=$4::jsonb where id=$1",[listing,attempt,account,JSON.stringify({verification:{locale:'ja-JP',fingerprint:hash,imageCount:8}})]);
  await db.query("insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,attempt_id,listing_id,channel,operation,environment,status,created_by,request_payload,request_fingerprint,seller_account_key,response_payload,completed_at,write_resource_kind,write_resource_key)values($1,$2,$3,$4,'qoo10','listing.update','production','succeeded',$5,$6::jsonb,$7,$8,$9::jsonb,now(),'listing_mutation',$7)",[source,credential,attempt,listing,owner,JSON.stringify({arguments:args}),hash,account,JSON.stringify(response)]);
  const verifierArgs={...args,publicationReviewId:listing,publicationReviewSourceJobId:source,publicationReviewCheck:1,sellerpilotReadOnly:true,remoteId:'synthetic-remote',market:'JP',targetId:'Japan'};
  delete verifierArgs.sellerpilotExternalDetail;delete verifierArgs.sellerpilotPublicationAssetBinding;
  await db.query("insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,listing_id,channel,operation,environment,status,created_by,request_payload,request_fingerprint,seller_account_key,worker_token_id,claim_token,lease_expires_at,started_at)values($1,$2,$3,'qoo10','listing.publication.verify','production','running',$4,$5::jsonb,$6,$7,$8,$9,now()+interval '1 hour',now())",[verifier,credential,listing,owner,JSON.stringify({arguments:verifierArgs}),hash,account,token,claim]);
  await db.query("insert into sellerpilot_private.listing_publication_reviews(listing_id,owner_id,product_id,source_job_id,source_attempt_id,credential_id,seller_account_key,channel,environment,market,target_id,expected_remote_id,expected_locale,expected_fingerprint,expected_image_count,status,deadline_at,check_count,last_job_id,next_check_at)values($1,$2,$3,$4,$5,$6,$7,'qoo10','production','JP','Japan','synthetic-remote','ja-JP',$8,8,'verifying',now()+interval '1 day',1,$9,null)",[listing,owner,product,source,attempt,credential,account,hash,verifier]);
  await db.query('update sellerpilot_private.listing_publication_reviews set remote_state=$2::jsonb where listing_id=$1',[listing,JSON.stringify(remote)]);
  assert.equal(await scalar(db,'select sellerpilot_private.listing_publication_review_is_current($1)',[listing]),true);
  const read=()=>scalar(db,'select public.sellerpilot_service_listing_publication_verification_source($1,$2,$3)',[tokenHash,verifier,claim]);
  assert.equal((await read()).sourceJobId,source);
  console.log('Actual readback passed with exact review-current and serverless ownership');
  await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope='gateway' where id=$1",[token]);
  await assert.rejects(read(),/ownership/);
  await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope='serverless_cs' where id=$1",[token]);
  // Observe, do not weaken or invent owner checks: source RPC delegates token
  // binding to the captured serverless helper (which does not compare created_by).
  const otherActor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await db.query('insert into auth.users(id)values($1)',[otherActor]);
  await db.query('update sellerpilot_private.channel_gateway_jobs set created_by=$2 where id=$1',[verifier,otherActor]);
  console.log('Actor mutation boundary', {readbackReturned:!!await read(),completionContext:!!await scalar(db,'select public.sellerpilot_service_gateway_completion_context($1,$2,$3)',[tokenHash,verifier,claim])});
  await db.query('update sellerpilot_private.channel_gateway_jobs set created_by=$2 where id=$1',[verifier,owner]);
  await db.query('update sellerpilot_private.ai_cli_worker_tokens set created_by=$2 where id=$1',[token,otherActor]);
  console.log('Issuer mutation boundary',{readbackReturned:!!await read(),completionContext:!!await scalar(db,'select public.sellerpilot_service_gateway_completion_context($1,$2,$3)',[tokenHash,verifier,claim])});
  await db.query('update sellerpilot_private.ai_cli_worker_tokens set created_by=$2 where id=$1',[token,owner]);
  const otherToken='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',otherHash='8'.repeat(64);
  await db.query("update sellerpilot_private.ai_cli_worker_tokens set status='revoked' where id=$1",[token]);
  await db.query("insert into sellerpilot_private.ai_cli_worker_tokens(id,label,token_hash,fingerprint,scope,expires_at,created_by)values($1,'Other synthetic',$2,left($2,12),'serverless_cs',now()+interval '1 day',$3)",[otherToken,otherHash,otherActor]);
  await assert.rejects(scalar(db,'select public.sellerpilot_service_listing_publication_verification_source($1,$2,$3)',[otherHash,verifier,claim]),/ownership/);
  await db.query("update sellerpilot_private.ai_cli_worker_tokens set status='revoked' where id=$1",[otherToken]);
  await db.query("update sellerpilot_private.ai_cli_worker_tokens set status='active' where id=$1",[token]);
  await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[verifier]);await assert.rejects(read(),/ownership/);
  await db.query("update sellerpilot_private.channel_gateway_jobs set lease_expires_at=now()+interval '1 hour' where id=$1",[verifier]);
  await db.query("update sellerpilot_private.ai_cli_worker_tokens set expires_at=now()-interval '1 second' where id=$1",[token]);await assert.rejects(read(),/ownership/);
  await db.query("update sellerpilot_private.ai_cli_worker_tokens set expires_at=now()+interval '1 day' where id=$1",[token]);
  await db.query('update sellerpilot_private.listing_publication_reviews set expected_fingerprint=$2 where listing_id=$1',[listing,'f'.repeat(64)]);await assert.rejects(read(),/SOURCE_UNAVAILABLE/);
  await db.query('update sellerpilot_private.listing_publication_reviews set expected_fingerprint=$2 where listing_id=$1',[listing,hash]);
  await db.query('update sellerpilot_private.listing_publication_reviews set owner_id=$2 where listing_id=$1',[listing,otherActor]);
  await assert.rejects(read(),/SOURCE_UNAVAILABLE/);
  await db.query('update sellerpilot_private.listing_publication_reviews set owner_id=$2 where listing_id=$1',[listing,owner]);
  await assert.rejects(scalar(db,'select public.sellerpilot_service_listing_publication_verification_source($1,$2,$3)',[tokenHash,verifier,otherActor]),/ownership/);
  await db.query("update sellerpilot_private.channel_gateway_jobs set response_payload=response_payload#-'{remoteState,evidence,publicationAssetBinding}' where id=$1",[source]);
  await assert.rejects(read(),/SOURCE_UNAVAILABLE/);
  await db.query('update sellerpilot_private.channel_gateway_jobs set response_payload=$2::jsonb where id=$1',[source,JSON.stringify(response)]);
  assert.ok(await scalar(db,'select public.sellerpilot_service_gateway_completion_context($1,$2,$3)',[tokenHash,verifier,claim]));
  const verifiedAt=new Date().toISOString();
  const final={...response,channel:'qoo10',operation:'listing.publication.verify',publicationFulfilled:true,remoteState:{...remote,visibility:'live',verifiedAt,publicUrl:'https://www.qoo10.jp/item/123456789'}};
  // Synthetic provider readback fixture, not an operating provider receipt.
  Object.assign(final.remoteState,{providerStatus:'on_sale',resources:{itemId:'synthetic-remote'}});
  Object.assign(final.remoteState.evidence,Object.fromEntries(['identityVerified','statusVerified','localeVerified','fingerprintVerified','imageCountVerified','contentVerified','sourceContentVerified','languageContentVerified','titleLanguageVerified','descriptionLanguageVerified','detailImageCountVerified','approvedManifestDigestVerified','sourceIdentityVerified','contentDigestVerified'].map(k=>[k,true])),{sourceJobId:source,sourceOperation:'listing.update',sourceContentDigest:b.exportSha256,remoteContentDigest:b.exportSha256,remoteProjectionDigest:b.exportSha256,sourceImageDigest:digest,remoteImageDigest:digest,providerImageSurface:'detail_content'});
  const finish=await scalar(db,'select public.sellerpilot_service_complete_gateway_transaction($1,$2,$3,$4,$5::jsonb,null,null,null,null,null)',[tokenHash,verifier,claim,'succeeded',JSON.stringify(final)]);
  console.log('Actual completion receipt',finish);
  assert.equal(finish.status,'completed');
  assert.equal(await scalar(db,'select status from sellerpilot_private.channel_gateway_jobs where id=$1',[verifier]),'succeeded');
  console.log('Review final', (await db.query('select status,last_error,remote_state from sellerpilot_private.listing_publication_reviews where listing_id=$1',[listing])).rows);
  assert.equal(await scalar(db,'select status from sellerpilot_private.listing_publication_reviews where listing_id=$1',[listing]),'live');
  assert.deepEqual((await db.query('select to_jsonb(i) row from sellerpilot_private.inventory_items i where product_id=$1',[product])).rows,inventoryBefore);
  assert.equal(await scalar(db,'select revision from sellerpilot_private.inventory_product_bindings where product_id=$1',[product]),0);


 }finally{await db.close();}
});
