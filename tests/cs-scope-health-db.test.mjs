import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import test from'node:test';import{PGlite}from'@electric-sql/pglite';
const migration=await readFile(new URL('../supabase/migrations/20260907235000_add_cs_scope_health.sql',import.meta.url),'utf8');
const owner='00000000-0000-4000-8000-000000000801',credential='00000000-0000-4000-8000-000000000802';
async function fixture(){const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.sellerpilot_is_admin() returns boolean language sql stable security definer as $$select auth.uid()='${owner}'::uuid$$;
 create schema sellerpilot_private;
 create table sellerpilot_private.channel_credentials(id uuid primary key,channel text,status text,expires_at timestamptz,last_checked_at timestamptz,last_check_status text,environment text);
 create table sellerpilot_private.support_tickets(id uuid primary key,source_credential_id uuid,channel_key text,ticket_kind text,demo boolean,reply_context jsonb,provider_context jsonb);
 create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,credential_id uuid,channel text,operation text,created_at timestamptz,completed_at timestamptz,status text,request_payload jsonb,response_payload jsonb);
 create table sellerpilot_private.support_inbound_messages(id uuid primary key,ticket_id uuid,received_at timestamptz);
 create table sellerpilot_private.support_reply_deliveries(id uuid primary key,ticket_id uuid,queued_at timestamptz,status text);
 create table sellerpilot_private.cs_history_scan_gaps(job_id uuid primary key,credential_id uuid,channel text,resolved_at timestamptz);
 create table sellerpilot_private.provider_rate_budgets(scope_key text primary key,credential_id uuid,channel text,operation_lane text,next_allowed_at timestamptz);
 insert into sellerpilot_private.channel_credentials values('${credential}','shopee','active',now()+interval '1 day',now(),'passed','production');
 insert into sellerpilot_private.support_tickets values
 ('00000000-0000-4000-8000-000000000803','${credential}','shopee','conversation',false,'{"shopId":"1001"}','{}'),
 ('00000000-0000-4000-8000-000000000804','${credential}','shopee','conversation',false,'{"shopId":"1002"}','{}'),
 ('00000000-0000-4000-8000-000000000807','${credential}','shopee','after_sales',false,'{}','{"shopId":"1001"}');
 insert into sellerpilot_private.support_inbound_messages values('00000000-0000-4000-8000-000000000805','00000000-0000-4000-8000-000000000803',now()-interval '1 hour');
 insert into sellerpilot_private.channel_gateway_jobs values
 ('00000000-0000-4000-8000-000000000806','${credential}','shopee','inquiries.list',now()-interval '2 hours',now()-interval '119 minutes','succeeded','{"arguments":{"kind":"product_review","shopId":"1001"}}','{}'),
 ('00000000-0000-4000-8000-000000000808','${credential}','shopee','inquiries.list',now()-interval '1 hour',now()-interval '59 minutes','succeeded','{"arguments":{"kind":"return_refund","shopId":"1002"}}','{}');
 `);await db.exec(migration);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);return db;}
test('scope health keeps shops and inquiry kinds separate without treating a zero row as complete',async()=>{const db=await fixture();try{await db.exec('set role authenticated');const result=(await db.query('select public.sellerpilot_read_cs_scope_health_v1() result')).rows[0].result;const shops=result.scopes.filter(row=>row.shopId);assert.deepEqual(shops.map(row=>`${row.shopId}:${row.ticketKind}`),['1001:after_sales','1001:conversation','1002:after_sales','1002:conversation']);const byScope=Object.fromEntries(shops.map(row=>[`${row.shopId}:${row.ticketKind}`,row]));assert.equal(byScope['1001:conversation'].state,'observed');assert.equal(byScope['1001:after_sales'].lastSuccessAt,null);assert.equal(byScope['1001:after_sales'].state,'unverified');assert.notEqual(byScope['1002:after_sales'].lastSuccessAt,null);assert.equal(byScope['1002:after_sales'].state,'zero_unverified');assert.equal(byScope['1002:conversation'].lastSuccessAt,null);assert.equal(byScope['1002:conversation'].state,'unverified');assert.equal(byScope['1002:after_sales'].zeroResultIsComplete,false);}finally{await db.close();}});
test('health RPC is admin-only and service role cannot read it',async()=>{const db=await fixture();try{for(const role of['anon','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.sellerpilot_read_cs_scope_health_v1()','EXECUTE') ok",[role])).rows[0].ok,false);}finally{await db.close();}});
