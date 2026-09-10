import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const proposal = await readFile(new URL(
  "../supabase/migrations/20260909135332_cs_coupang_product_reply_readback.sql",
  import.meta.url,
), "utf8");
const owner="00000000-0000-4000-8000-000000000301";
const credential="00000000-0000-4000-8000-000000000302";
const ticket="00000000-0000-4000-8000-000000000303";
const source="00000000-0000-4000-8000-000000000304";
const delivery="00000000-0000-4000-8000-000000000305";
const token="00000000-0000-4000-8000-000000000306";
const claim="00000000-0000-4000-8000-000000000307";
const seller="c".repeat(64), inbound=`coupang:${"a".repeat(64)}`, fingerprint="b".repeat(64);

async function fixture() {
  const db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;create schema extensions;create schema sellerpilot_private;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable
      as $$select sha256(convert_to(value,'UTF8'))$$;
    create table auth.users(id uuid primary key);
    create table sellerpilot_private.ai_cli_worker_tokens(id uuid primary key,token_hash text,scope text,status text,expires_at timestamptz);
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid,channel text,environment text,status text,seller_account_key text,
      seller_account_key_source text,seller_account_verified_at timestamptz,expires_at timestamptz);
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),credential_id uuid,attempt_id uuid,channel text,operation text,
      environment text,request_payload jsonb,response_payload jsonb,status text default 'queued',seller_account_key text,
      created_by uuid,error_message text,worker_token_id uuid,claim_token uuid,lease_expires_at timestamptz,
      provider_mutation_started_at timestamptz,rate_not_before timestamptz,started_at timestamptz,completed_at timestamptz,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table sellerpilot_private.support_tickets(
      id uuid primary key,owner_id uuid,channel_key text,source_credential_id uuid,external_ticket_id text,
      seller_account_key text,latest_inbound_key text,demo boolean default false,provider_status text default 'waiting',
      status text default 'open',updated_at timestamptz default now());
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,inbound_key text,
      sender_role text,received_at timestamptz);
    create table sellerpilot_private.support_reply_deliveries(
      id uuid primary key,ticket_id uuid,owner_id uuid,gateway_job_id uuid,channel_key text,status text,
      verification_status text,reply_fingerprint text,reconciliation_reason text,updated_at timestamptz default now());
    create table sellerpilot_private.coupang_reply_readback_links(source_job_id uuid primary key);
    create function sellerpilot_private.enqueue_coupang_reply_readback_after_acceptance()
      returns trigger language plpgsql set search_path='' as $$begin return new;end$$;
    create function public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)
      returns jsonb language sql set search_path='' as $$select '{}'::jsonb$$;
    insert into auth.users values('${owner}');
    insert into sellerpilot_private.ai_cli_worker_tokens values('${token}','token-hash','gateway','active',clock_timestamp()+interval '1 day');
    insert into sellerpilot_private.channel_credentials values('${credential}','${owner}','coupang','production','active',
      '${seller}','provider_certified_v1',clock_timestamp(),clock_timestamp()+interval '1 day');
    insert into sellerpilot_private.support_tickets values('${ticket}','${owner}','coupang','${credential}','product:3101',
      '${seller}','${inbound}',false,'waiting','open',clock_timestamp());
    insert into sellerpilot_private.support_inbound_messages(ticket_id,owner_id,channel_key,inbound_key,sender_role,received_at)
      values('${ticket}','${owner}','coupang','${inbound}','customer','2025-01-15T08:00:00+09:00');
    insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,response_payload,status,seller_account_key,created_by,completed_at
    ) values('${source}','${credential}','coupang','inquiries.reply','production',
      jsonb_build_object('arguments',jsonb_build_object('kind','product','inquiryId','3101','reply','secret reply'),
        'sellerpilotTicketId','${ticket}','sellerpilotInboundKey','${inbound}','sellerpilotReplyFingerprint','${fingerprint}'),
      jsonb_build_object('ok',true,'steps',jsonb_build_array(jsonb_build_object('data',jsonb_build_object(
        'sellerpilotReplyAcceptance',jsonb_build_object('contract','sellerpilot-reply-acceptance/1','level','provider_accepted',
          'channel','coupang','kind','product','bindingDigest',repeat('d',64)))))),
      'succeeded','${seller}','${owner}',clock_timestamp());
  `);
  await db.exec(proposal);
  await db.query(`insert into sellerpilot_private.support_reply_deliveries
    values($1,$2,$3,$4,'coupang','succeeded','provider_accepted',$5,null,clock_timestamp())`,
    [delivery,ticket,owner,source,fingerprint]);
  return db;
}

test("accepted product reply creates one old-window read-only child without reply body", async()=>{
  const db=await fixture();
  try{
    const child=(await db.query("select * from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'")).rows[0];
    assert.ok(child);
    assert.equal(child.request_payload.arguments.kind,"product-reply-readback");
    assert.deepEqual(child.request_payload.arguments.query,{answeredType:"ALL",inquiryStartAt:"2025-01-12",inquiryEndAt:"2025-01-18",pageNum:1,pageSize:50});
    assert.equal(child.request_payload.arguments.expectedInboundKey,inbound);
    assert.equal(child.request_payload.arguments.expectedReplyFingerprint,fingerprint);
    assert.equal(JSON.stringify(child.request_payload).includes("secret reply"),false);
    await db.query("update sellerpilot_private.support_reply_deliveries set status='succeeded' where id=$1",[delivery]);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.coupang_product_reply_readback_links")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs where operation='inquiries.reply'")).rows[0].n,1);
  }finally{await db.close();}
});

test("retry RPC is exact, bounded, replay-idempotent, and stale inbound fails closed",async()=>{
  const db=await fixture();
  try{
    const child=(await db.query("select id,request_payload from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'")).rows[0];
    const retryArgs={...child.request_payload.arguments,sellerpilotCoupangReadbackAttempt:1,
      query:{...child.request_payload.arguments.query,pageNum:1}};
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$2,
      claim_token=$3,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1`,[child.id,token,claim]);
    const values=["token-hash",child.id,claim,JSON.stringify(retryArgs),1,15,1,0,503];
    const sql=`select public.sellerpilot_service_requeue_coupang_product_reply_readback_v1(
      $1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) result`;
    const first=(await db.query(sql,values)).rows[0].result;
    const replay=(await db.query(sql,values)).rows[0].result;
    assert.equal(first.replayed,false);assert.equal(replay.replayed,true);
    assert.equal(first.retryAfterSeconds,15);
    assert.equal((await db.query("select status from sellerpilot_private.channel_gateway_jobs where id=$1",[child.id])).rows[0].status,"queued");

    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$2,
      claim_token=$3,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1`,[child.id,token,claim]);
    await db.query("update sellerpilot_private.support_tickets set latest_inbound_key=$2 where id=$1",[ticket,`coupang:${"f".repeat(64)}`]);
    await assert.rejects(db.query(sql,["token-hash",child.id,claim,JSON.stringify({...retryArgs,sellerpilotCoupangReadbackAttempt:2}),2,60,1,0,503]),
      /COUPANG_PRODUCT_READBACK_RETRY_STALE/u);
  }finally{await db.close();}
});

test("terminal child marks only the accepted delivery for reconciliation",async()=>{
  const db=await fixture();
  try{
    const child=(await db.query("select id from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'")).rows[0];
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='reconciliation_required',error_message='EXHAUSTED' where id=$1",[child.id]);
    const row=(await db.query("select status,verification_status,reconciliation_reason from sellerpilot_private.support_reply_deliveries where id=$1",[delivery])).rows[0];
    assert.deepEqual(row,{status:"reconciliation_required",verification_status:"reconciliation_required",reconciliation_reason:"EXHAUSTED"});
  }finally{await db.close();}
});

test("product parentAnswerId preserves provider acceptance but reconciles without a child",async()=>{
  const db=await fixture();
  try{
    await db.query("delete from sellerpilot_private.coupang_product_reply_readback_links");
    await db.query("delete from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'");
    await db.query("delete from sellerpilot_private.support_reply_deliveries where id=$1",[delivery]);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(
      request_payload,'{arguments,parentAnswerId}','"44"'::jsonb,true) where id=$1`,[source]);
    await db.query(`insert into sellerpilot_private.support_reply_deliveries
      values($1,$2,$3,$4,'coupang','succeeded','provider_accepted',$5,null,clock_timestamp())`,
      [delivery,ticket,owner,source,fingerprint]);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'")).rows[0].n,0);
    assert.deepEqual((await db.query(`select status,verification_status,reconciliation_reason
      from sellerpilot_private.support_reply_deliveries where id=$1`,[delivery])).rows[0],{
      status:"reconciliation_required",verification_status:"reconciliation_required",
      reconciliation_reason:"COUPANG_PRODUCT_READBACK_PARENT_ANSWER_ID_FORBIDDEN",
    });
  }finally{await db.close();}
});

test("retry RPC accepts only live gateway and serverless_cs worker scopes",async(t)=>{
  for(const scope of ["gateway","serverless_cs"]){
    await t.test(`accepts ${scope}`,async()=>{
      const db=await fixture();
      try{
        await db.query("update sellerpilot_private.ai_cli_worker_tokens set scope=$2 where id=$1",[token,scope]);
        const child=(await db.query("select id,request_payload from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'")).rows[0];
        const retryArgs={...child.request_payload.arguments,sellerpilotCoupangReadbackAttempt:1};
        await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$2,
          claim_token=$3,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1`,[child.id,token,claim]);
        const receipt=(await db.query(`select public.sellerpilot_service_requeue_coupang_product_reply_readback_v1(
          'token-hash',$1,$2,$3::jsonb,1,15,1,0,503) result`,[child.id,claim,JSON.stringify(retryArgs)])).rows[0].result;
        assert.equal(receipt.status,"deferred");
        assert.equal(receipt.replayed,false);
      }finally{await db.close();}
    });
  }
  for(const variant of [
    {name:"scheduler",scope:"scheduler",expires:"1 day"},
    {name:"legacy_combined",scope:"legacy_combined",expires:"1 day"},
    {name:"expired gateway",scope:"gateway",expires:"-1 second"},
  ]){
    await t.test(`rejects ${variant.name}`,async()=>{
      const db=await fixture();
      try{
        await db.query(`update sellerpilot_private.ai_cli_worker_tokens set scope=$2,
          expires_at=clock_timestamp()+$3::interval where id=$1`,[token,variant.scope,variant.expires]);
        const child=(await db.query("select id,request_payload from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'")).rows[0];
        const retryArgs={...child.request_payload.arguments,sellerpilotCoupangReadbackAttempt:1};
        await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$2,
          claim_token=$3,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1`,[child.id,token,claim]);
        await assert.rejects(db.query(`select public.sellerpilot_service_requeue_coupang_product_reply_readback_v1(
          'token-hash',$1,$2,$3::jsonb,1,15,1,0,503)`,[child.id,claim,JSON.stringify(retryArgs)]),/invalid worker token/u);
      }finally{await db.close();}
    });
  }
});

test("retry RPC binds the exact token, job, claim, and seller account",async(t)=>{
  const retrySql=`select public.sellerpilot_service_requeue_coupang_product_reply_readback_v1(
    $1,$2,$3,$4::jsonb,1,15,1,0,503)`;
  for(const variant of ["token","job","claim","account"]){
    await t.test(`rejects ${variant} mismatch`,async()=>{
      const db=await fixture();
      try{
        const child=(await db.query("select id,request_payload from sellerpilot_private.channel_gateway_jobs where operation='inquiries.list'")).rows[0];
        const retryArgs={...child.request_payload.arguments,sellerpilotCoupangReadbackAttempt:1};
        await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$2,
          claim_token=$3,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1`,[child.id,token,claim]);
        if(variant==="account")await db.query("update sellerpilot_private.channel_gateway_jobs set seller_account_key=$2 where id=$1",[child.id,"1".repeat(64)]);
        const values=[
          variant==="token"?"wrong-token-hash":"token-hash",
          variant==="job"?"00000000-0000-4000-8000-000000000399":child.id,
          variant==="claim"?"00000000-0000-4000-8000-000000000398":claim,
          JSON.stringify(retryArgs),
        ];
        await assert.rejects(db.query(retrySql,values),variant==="token"
          ?/invalid worker token/u
          :variant==="account"?/COUPANG_PRODUCT_READBACK_RETRY_STALE/u
          :/COUPANG_PRODUCT_READBACK_RETRY_REPLAY_CONFLICT/u);
      }finally{await db.close();}
    });
  }
});

test("readback ledgers stay private and only service_role may execute retry",async()=>{
  const db=await fixture();
  try{
    for(const role of ["anon","authenticated","service_role"]){
      assert.equal((await db.query("select has_table_privilege($1,'sellerpilot_private.coupang_product_reply_readback_links','SELECT') allowed",[role])).rows[0].allowed,false);
      assert.equal((await db.query("select has_table_privilege($1,'sellerpilot_private.coupang_product_reply_readback_retries','SELECT') allowed",[role])).rows[0].allowed,false);
    }
    const signature="public.sellerpilot_service_requeue_coupang_product_reply_readback_v1(text,uuid,uuid,jsonb,integer,integer,integer,integer,integer)";
    assert.equal((await db.query("select has_function_privilege('anon',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,true);
  }finally{await db.close();}
});
