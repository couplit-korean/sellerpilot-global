import {readFile} from 'node:fs/promises';
import {createDecipheriv,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
export const catalog=JSON.parse(await readFile(new URL('./fixtures/external-detail-schema-catalog.json',import.meta.url),'utf8'));
import path from 'node:path';
export const affectedTables=['products','ai_cli_jobs','channel_credentials','channel_operation_attempts','channel_gateway_jobs','product_listings','listing_publication_reviews','marketplace_normalized_assets','marketplace_normalized_asset_refs','ai_cli_worker_tokens','inventory_product_bindings','inventory_items','inventory_ledger','inventory_reservations','inventory_sync_runs','commerce_orders','lazada_order_item_claims','external_detail_imports','external_detail_import_audit'];
export const hash=s=>createHash('sha256').update(s).digest('hex');
export async function realFixture({external=true}={}){
 const forwardFiles=['20260906010000_verify_channel_credential_owner.sql','20260905140000_preserve_unordered_lazada_messages.sql','20260905141000_products_authoritative_inventory_bridge.sql','20260905142000_lazada_durable_order_item_ownership.sql','20260906011000_route_lazada_im_webhook_credentials.sql'];
 const pendingFiles=['20260906030000_shopee_exact_oauth_executor.sql','20260906050000_bind_lazada_oauth_to_authoritative_seller.sql','20260906060000_lazada_exact_oauth_executor.sql'];
 const pendingSql=await Promise.all(pendingFiles.map(f=>readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8')));
 const currentFunctions=catalog.currentFunctions;
 const forwardSql=await Promise.all(forwardFiles.map(f=>readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8')));
 const base=process.env.SELLERPILOT_BASELINE_FOLDER;
 if(!base)throw Error('SELLERPILOT_BASELINE_FOLDER is required: directory containing private baseline.enc and baseline.key. This real-source test must fail, not skip, when unavailable.');
 const e=JSON.parse(await readFile(path.join(base,'baseline.enc'),'utf8'));const d=createDecipheriv('aes-256-gcm',await readFile(path.join(base,'baseline.key')),Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));const pack=JSON.parse(Buffer.concat([d.update(Buffer.from(e.body,'base64')),d.final()]).toString());
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema storage;create schema vault;create schema extensions;create schema sellerpilot_private;
 create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 create table vault.decrypted_secrets(id uuid, decrypted_secret text); create table vault.secrets(id uuid primary key);
 create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function extensions.digest(text,text)returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
 set check_function_bodies=off;`);
 const privateObject=o=>o.ddl.includes('sellerpilot_private.');
 for(const kind of ['enum','sequence','table'])for(const o of pack.objects.filter(o=>o.kind===kind&&privateObject(o)))await db.exec(o.ddl);
 const fn=pack.objects.filter(o=>o.kind==='function');const map=new Map(fn.map(o=>[o.ddl.match(/FUNCTION ([^(]+)\(/)[1],o]));const wanted=new Map(),visited=new Set();function add(n){const parts=n.split('.');n=parts[0]+'.'+parts[1].slice(0,63);if(visited.has(n))return;visited.add(n);for(const o of fn.filter(o=>o.ddl.startsWith('CREATE OR REPLACE FUNCTION '+n+'('))){wanted.set(o.ddl.split('\n')[0],o);for(const m of o.ddl.matchAll(/((?:public|sellerpilot_private)\.[a-zA-Z0-9_]+)\s*\(/g))add(m[1]);}}
 const roots=['public.sellerpilot_get_product_publish_context','public.sellerpilot_service_complete_gateway_transaction','public.sellerpilot_service_gateway_completion_context','public.sellerpilot_service_listing_publication_verification_source','public.sellerpilot_service_register_marketplace_normalized_asset_refs','public.sellerpilot_service_mark_marketplace_normalized_assets_uploaded','public.sellerpilot_service_bind_marketplace_normalized_asset_urls','sellerpilot_private.listing_publication_review_is_current','sellerpilot_private.listing_publication_asset_binding_is_current'];
 const triggers=pack.objects.filter(o=>o.kind==='trigger'&&/ON sellerpilot_private\.(products|channel_gateway_jobs|inventory_sync_runs|channel_market_targets) /.test(o.ddl));
 for(const o of triggers){const m=o.ddl.match(/EXECUTE FUNCTION ([^(]+)\(/);if(m)add(m[1]);}
 for(const sql of [...forwardSql,...pendingSql])for(const m of sql.matchAll(/((?:public|sellerpilot_private)\.[a-zA-Z0-9_]+)\s*\(/g))add(m[1]);
 for(const f of currentFunctions)add(f.schema+'.'+f.name);
 for(const n of roots)add(n);
 for(const o of pack.objects.filter(o=>['default','constraint','index'].includes(o.kind)&&privateObject(o)&&!o.ddl.includes(' TRIGGER ')))for(const m of o.ddl.matchAll(/((?:public|sellerpilot_private)\.[a-zA-Z0-9_]+)\s*\(/g))add(m[1]);
 for(const o of wanted.values())await db.exec(o.ddl);
 for(const o of pack.objects.filter(o=>['default','constraint','index'].includes(o.kind)&&privateObject(o)&&!o.ddl.includes(' TRIGGER ')))await db.exec(o.ddl);
 for(const o of triggers)await db.exec(o.ddl);
 // Restore original function owner/ACL, not default PUBLIC execute.
 for(const o of pack.objects.filter(o=>['owner','grant','revoke'].includes(o.kind))){const m=o.ddl.match(/FUNCTION ([^(]+)\(/);if(m&&[...wanted.values()].some(f=>f.ddl.startsWith('CREATE OR REPLACE FUNCTION '+m[1]+'(')))await db.exec(o.ddl);}
 const affected=o=>[...affectedTables,'channel_market_targets'].some(t=>new RegExp('sellerpilot_private\\.'+t+'(?:[\\s;(]|$)').test(o.ddl));
 for(const o of pack.objects.filter(o=>o.kind==='foreign-key'&&[...affectedTables,'channel_market_targets'].includes(o.ddl.match(/^ALTER TABLE sellerpilot_private\.([a-z_]+)/)?.[1])))await db.exec(o.ddl);
 for(const o of pack.objects.filter(o=>['rls','policy','owner','grant','revoke'].includes(o.kind)&&!o.ddl.includes('FUNCTION')&&affected(o)))await db.exec(o.ddl);
 for(const sql of forwardSql)await db.exec(sql);
 const sourceVerification=[];
 for(const f of currentFunctions){
  const verified=(await db.query("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2 and md5(p.prosrc)=$3 and pg_get_userbyid(p.proowner)=$4 and md5(pg_get_functiondef(p.oid))=$6 and p.prosecdef=$7 and p.proconfig is not distinct from $8::text[] and p.provolatile=$9 and p.proparallel=$10 and p.proleakproof=$11 and array(select a::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner)))a order by a::text)=array(select a::text from unnest(coalesce($5::aclitem[],acldefault('f',p.proowner)))a order by a::text)",[f.schema,f.name,f.prosrcMd5,f.owner,f.rawAcl,f.definitionMd5,f.securityDefiner,f.configuration,f.volatility,f.parallel,f.leakproof])).rows;
  if(verified.length!==1)throw Error('CURRENT_DDL_BODY_OR_ACL_MISMATCH '+f.schema+'.'+f.name);
  sourceVerification.push({name:f.schema+'.'+f.name,md5:f.prosrcMd5});
 }
 const capture=async()=> (await db.query(`select c.relname as table_name,t.tgname as name,pg_get_triggerdef(t.oid) as definition,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') as body_sha256,t.tgenabled as enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal and n.nspname='sellerpilot_private' and c.relname in('products','channel_gateway_jobs','channel_market_targets','shopee_exact_oauth_sessions','lazada_exact_oauth_sessions','lazada_exact_claims','lazada_exact_completions') order by c.relname,t.tgname`)).rows;
 const timeline=[{stage:'current',triggers:await capture()}];
 for(const [i,sql]of pendingSql.entries()){await db.exec(sql);timeline.push({stage:pendingFiles[i],sha256:hash(sql),triggers:await capture()});}
 if(external)for(const file of ['20260906040000_external_detail_import.sql','20260906043000_external_detail_channel_fence.sql','20260906053000_external_detail_publication_lifecycle.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 return {db,functions:wanted.size,timeline,sourceVerification};
 }catch(e){await db.close();throw e;}
}
