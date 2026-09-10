// Isolated trigger fixture only: not an end-to-end marketplace publication test.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const original="CREATE OR REPLACE FUNCTION sellerpilot_private.guard_external_detail_gateway_source()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare binding jsonb; r sellerpilot_private.external_detail_imports%rowtype; p sellerpilot_private.products%rowtype; image jsonb; n integer:=0;\nbegin\n binding:=new.request_payload#>'{arguments,sellerpilotExternalDetail}';\n if tg_op='UPDATE' and old.request_payload#>'{arguments,sellerpilotExternalDetail}' is not null and binding is distinct from old.request_payload#>'{arguments,sellerpilotExternalDetail}' then raise exception 'EXTERNAL_DETAIL_JOB_BINDING_IMMUTABLE';end if;\n if binding is null then return new;end if;\n if tg_op='UPDATE' and new.status not in ('queued','running') and new.provider_mutation_started_at is not distinct from old.provider_mutation_started_at then return new;end if;\n if new.operation not in ('listing.create','listing.update','listing.activate') then raise exception 'EXTERNAL_DETAIL_OPERATION_INVALID';end if;\n select * into p from sellerpilot_private.products where id=(binding->>'productId')::uuid for update;\n select * into r from sellerpilot_private.external_detail_imports where id=p.external_detail_import_id;\n if p.id is distinct from '1ed4acfc-7603-48ec-a638-241131e59358'::uuid or r.id is null or r.id::text is distinct from binding->>'importId' or r.owner_id is distinct from new.created_by or r.status<>'approved' or r.approved_product_updated_at is distinct from p.updated_at or r.approved_detail_version is distinct from p.detail_page_version or p.ai_job_id is distinct from (r.payload->>'expectedAiJobId')::uuid or r.request_sha256 is distinct from binding->>'requestSha256' or r.approved_detail_version::text is distinct from binding->>'version' or r.approved_product_updated_at is distinct from (binding->>'productUpdatedAt')::timestamptz or new.channel is distinct from binding->>'channel' then raise exception 'EXTERNAL_DETAIL_JOB_SOURCE_STALE';end if;\n if binding->>'language' not in ('ko','ja','en') or r.payload#>>array['reviewedCopy',binding->>'language','documentSha256'] is distinct from binding->>'documentSha256' or binding->>'locale' is distinct from new.request_payload#>>'{arguments,publicationExpectedLocale}' then raise exception 'EXTERNAL_DETAIL_JOB_LOCALE_INVALID';end if;\n for image in select value from jsonb_array_elements(r.payload->'assets') loop\n  if image->>'sourceSha256' is distinct from binding#>>array['imageSha256s',n::text] or r.receipts#>>array[n::text,'decodedRgbaSha256'] is distinct from binding#>>array['pixelSha256s',n::text] then raise exception 'EXTERNAL_DETAIL_JOB_IMAGE_MISMATCH';end if;n:=n+1;\n end loop;\n if n<>8 or jsonb_array_length(binding->'imageSha256s') is distinct from 8 or jsonb_array_length(binding->'pixelSha256s') is distinct from 8 then raise exception 'EXTERNAL_DETAIL_JOB_IMAGE_MISMATCH';end if;\n return new;\nend$function$\n";
const needle='r.owner_id is distinct from new.created_by';
const replacement=`(r.owner_id is distinct from p.owner_id or not exists (
   select 1 from sellerpilot_private.channel_operation_attempts a
   join sellerpilot_private.channel_credentials c on c.id=a.credential_id
   where a.id=new.attempt_id and a.owner_id=p.owner_id
     and a.credential_id=new.credential_id and a.channel=new.channel
     and a.operation=new.operation and c.created_by=new.created_by
 ))`;
if(original.split(needle).length!==2)throw Error('Expected one exact ownership predicate');
const patched=original.replace(needle,replacement);
const ids={product:'1ed4acfc-7603-48ec-a638-241131e59358',owner:'11111111-1111-4111-8111-111111111111',creator:'22222222-2222-4222-8222-222222222222',import:'33333333-3333-4333-8333-333333333333',ai:'44444444-4444-4444-8444-444444444444',credential:'55555555-5555-4555-8555-555555555555',attempt:'66666666-6666-4666-8666-666666666666',job:'77777777-7777-4777-8777-777777777777',other:'88888888-8888-4888-8888-888888888888'};
const stamp='2026-09-06T03:19:01.757195Z';
const hash=n=>n.toString(16).padStart(64,'0');
const binding={productId:ids.product,importId:ids.import,version:2,productUpdatedAt:stamp,requestSha256:hash(20),channel:'smartstore',language:'ko',locale:'ko-KR',documentSha256:hash(21),imageSha256s:Array.from({length:8},(_,i)=>hash(i+1)),pixelSha256s:Array.from({length:8},(_,i)=>hash(i+30))};
const results=[];
(async()=>{const db=new PGlite();await db.exec(`create schema sellerpilot_private;
create table sellerpilot_private.products(id uuid,owner_id uuid,external_detail_import_id uuid,updated_at timestamptz,detail_page_version int,ai_job_id uuid);
create table sellerpilot_private.external_detail_imports(id uuid,owner_id uuid,status text,approved_product_updated_at timestamptz,approved_detail_version int,payload jsonb,request_sha256 text,receipts jsonb);
create table sellerpilot_private.channel_credentials(id uuid,created_by uuid);
create table sellerpilot_private.channel_operation_attempts(id uuid,owner_id uuid,credential_id uuid,channel text,operation text);
create table sellerpilot_private.channel_gateway_jobs(id uuid,attempt_id uuid,credential_id uuid,channel text,operation text,created_by uuid,request_payload jsonb,status text,provider_mutation_started_at timestamptz);
${original};
create trigger source_guard before insert or update on sellerpilot_private.channel_gateway_jobs for each row execute function sellerpilot_private.guard_external_detail_gateway_source();`);
await db.query('insert into sellerpilot_private.products values ($1,$2,$3,$4,2,$5)',[ids.product,ids.owner,ids.import,stamp,ids.ai]);
await db.query('insert into sellerpilot_private.external_detail_imports values ($1,$2,\'approved\',$3,2,$4,$5,$6)',[ids.import,ids.owner,stamp,JSON.stringify({expectedAiJobId:ids.ai,reviewedCopy:Object.fromEntries(['ko','ja','en'].map(l=>[l,{documentSha256:hash(21)}])),assets:binding.imageSha256s.map(sourceSha256=>({sourceSha256}))}),hash(20),JSON.stringify(binding.pixelSha256s.map(decodedRgbaSha256=>({decodedRgbaSha256})))]);
await db.query('insert into sellerpilot_private.channel_credentials values ($1,$2)',[ids.credential,ids.creator]);
await db.query("insert into sellerpilot_private.channel_operation_attempts values ($1,$2,$3,'smartstore','listing.create')",[ids.attempt,ids.owner,ids.credential]);
async function test(name,expected,options={}){await db.exec('begin');let message=null;try{if(options.before)await db.exec(options.before);const b=structuredClone(binding);if(options.edit)options.edit(b);const row={attempt:ids.attempt,credential:ids.credential,channel:'smartstore',operation:'listing.create',creator:ids.creator,...options.row};const payload={arguments:{sellerpilotExternalDetail:b,publicationExpectedLocale:options.expectedLocale??'ko-KR'}};await db.query("insert into sellerpilot_private.channel_gateway_jobs values ($1,$2,$3,$4,$5,$6,$7,'queued',null)",[ids.job,row.attempt,row.credential,row.channel,row.operation,row.creator,JSON.stringify(payload)]);if(options.after)await db.exec(options.after);}catch(e){message=e.message;}finally{await db.exec('rollback');}const ok=expected===null?message===null:message?.includes(expected);results.push({name,passed:!!ok,error:message});if(!ok)throw Error(`${name}: expected ${expected}, got ${message}`);}
const stale='EXTERNAL_DETAIL_JOB_SOURCE_STALE';
await test('old trigger reproduces valid shared-credential rejection',stale);
await test('old same-owner flow accepted',null,{before:`update sellerpilot_private.channel_credentials set created_by='${ids.owner}'`,row:{creator:ids.owner}});
await db.exec(patched);
await test('valid product owner plus separate credential creator accepted',null);
await test('same-owner flow preserved',null,{before:`update sellerpilot_private.channel_credentials set created_by='${ids.owner}'`,row:{creator:ids.owner}});
for(const [language,locale] of [['ja','ja-JP'],['en','en-US']])await test(`approved ${language} source preserved`,null,{edit:b=>{b.language=language;b.locale=locale;},expectedLocale:locale});
await test('missing attempt rejected',stale,{before:'delete from sellerpilot_private.channel_operation_attempts'});
await test('wrong attempt owner rejected',stale,{before:`update sellerpilot_private.channel_operation_attempts set owner_id='${ids.other}'`});
await test('wrong import owner rejected',stale,{before:`update sellerpilot_private.external_detail_imports set owner_id='${ids.other}'`});
await test('wrong credential rejected',stale,{row:{credential:ids.other}});
await test('wrong channel rejected',stale,{before:"update sellerpilot_private.channel_operation_attempts set channel='coupang'"});
await test('wrong operation rejected',stale,{before:"update sellerpilot_private.channel_operation_attempts set operation='listing.update'"});
await test('wrong credential creator rejected',stale,{row:{creator:ids.owner}});
await test('null attempt rejected',stale,{row:{attempt:null}});
await test('unapproved import rejected',stale,{before:"update sellerpilot_private.external_detail_imports set status='pending'"});
await test('stale product timestamp rejected',stale,{before:"update sellerpilot_private.products set updated_at=updated_at+interval '1 second'"});
await test('stale detail version rejected',stale,{edit:b=>b.version=1});
await test('changed AI source rejected',stale,{before:`update sellerpilot_private.products set ai_job_id='${ids.other}'`});
await test('wrong request digest rejected',stale,{edit:b=>b.requestSha256=hash(99)});
await test('wrong source timestamp rejected',stale,{edit:b=>b.productUpdatedAt='2026-09-06T03:19:01.757Z'});
await test('wrong document digest rejected','EXTERNAL_DETAIL_JOB_LOCALE_INVALID',{edit:b=>b.documentSha256=hash(99)});
await test('wrong locale rejected','EXTERNAL_DETAIL_JOB_LOCALE_INVALID',{edit:b=>b.locale='ja-JP'});
await test('wrong image digest rejected','EXTERNAL_DETAIL_JOB_IMAGE_MISMATCH',{edit:b=>b.imageSha256s[0]=hash(99)});
await test('wrong pixel digest rejected','EXTERNAL_DETAIL_JOB_IMAGE_MISMATCH',{edit:b=>b.pixelSha256s[0]=hash(99)});
await test('image count mismatch rejected','EXTERNAL_DETAIL_JOB_IMAGE_MISMATCH',{edit:b=>b.imageSha256s.push(hash(99))});
await test('binding remains immutable','EXTERNAL_DETAIL_JOB_BINDING_IMMUTABLE',{after:"update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,sellerpilotExternalDetail,version}','3')"});
await test('terminal bookkeeping update preserved',null,{after:"update sellerpilot_private.channel_gateway_jobs set status='failed'"});
const migration=readFileSync(new URL('../supabase/migrations/20260906204000_bind_external_detail_attempt_owner.sql',import.meta.url),'utf8');
await db.exec(original);
await db.exec(migration);
results.push({name:'exact guarded migration applies and verifies source digest',passed:true});
await db.exec(migration);
results.push({name:'identical migration rerun is no-op',passed:true});
await db.exec(patched.replace('declare binding jsonb;','declare  binding jsonb;'));
let driftRejected=false;try{await db.exec(migration);}catch(e){driftRejected=e.message.includes('EXTERNAL_DETAIL_OWNER_GUARD_SOURCE_DRIFT');await db.exec('rollback');}
if(!driftRejected)throw Error('Migration failed to reject source drift');
results.push({name:'migration refuses unexpected source drift',passed:true});
console.log(JSON.stringify({passed:results.length,total:results.length,results},null,2));await db.close();})().catch(e=>{console.error(e.message);process.exitCode=1;});
