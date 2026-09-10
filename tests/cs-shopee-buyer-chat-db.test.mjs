import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { normalizeAuthorizedShopeeBuyerChatPage } from "../lib/channels/cs/shopee/buyer-chat.ts";
import {
  SHOPEE_BUYER_CHAT_TRANSPORT,
  projectShopeeBuyerChatApi,
  shopeeBuyerChatApiSchema,
  shopeeBuyerChatReadSchema,
} from "../lib/cs/channels/shopee/buyer-chat-contract.ts";

const migration = await readFile(new URL(
  "../supabase/migrations/20260909165247_cs_shopee_buyer_chat_read_ledger.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000069001";
const otherOwner = "00000000-0000-4000-8000-000000069002";
const credential = "00000000-0000-4000-8000-000000069003";
const otherCredential = "00000000-0000-4000-8000-000000069004";
const rotatedCredential = "00000000-0000-4000-8000-000000069007";
const sharedAdmin = "00000000-0000-4000-8000-000000069005";
const outsider = "00000000-0000-4000-8000-000000069006";
const shopId = "1719148844";
const sellerAccountKey = "a".repeat(64);
const credentialVerifiedAt = "2026-09-09T00:03:00.000Z";
const sha = value => createHash("sha256").update(value).digest("hex");
const shopBinding = sha([
  "sellerpilot-shopee-buyer-chat-shop-binding/1", credential,
  sellerAccountKey, "production", shopId,
].join("\n"));
const approvalEvidence = {
  configuredKeys: true,
  contractDocument: { module: "sellerchat", revision: "revision_1",
    sourceUrl: "https://open.shopee.com/documents/v2/authorized",
    verifiedAt: "2026-09-09T00:00:00.000Z", conversationListApproved: true,
    messageHistoryApproved: true },
  appApproval: { state: "approved", appType: "seller_in_house_system",
    approvedAt: "2026-09-09T00:01:00.000Z" },
  webhookApproval: { state: "approved", event: "sellerchat_message",
    verifiedAt: "2026-09-09T00:02:00.000Z" },
};

function message(messageId, sentAt, body = `body ${messageId}`) {
  const conversationId = "conversation_1";
  const identityDigest = sha(`${shopId}\n${conversationId}\n${messageId}`);
  const bodyFingerprint = sha(body);
  const senderRole = "buyer";
  const attachmentCount = 0;
  const evidenceDigest = sha([identityDigest, bodyFingerprint, senderRole, sentAt, "", "",
    String(attachmentCount)].join("\n"));
  return { shopId, conversationId, messageId, identityDigest, senderRole, body,
    bodyFingerprint, sentAt, orderSn: null, itemId: null, attachmentCount, evidenceDigest };
}

function page(messages) {
  return { contract: "sellerpilot-shopee-buyer-chat-normalized-page/1", shopId,
    conversationId: "conversation_1", inputCursor: null, nextCursor: null,
    pageSize: Math.max(messages.length, 1), messages };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable
      security definer set search_path='' as $$select exists(
        select 1 from sellerpilot_private.admin_users where user_id=auth.uid()
      )$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid,channel text,environment text,status text,
      expires_at timestamptz,seller_account_key text,
      seller_account_key_source text not null default 'legacy_unattested',
      seller_account_verified_at timestamptz,
      check (
        (seller_account_key is null and seller_account_key_source='legacy_unattested'
          and seller_account_verified_at is null)
        or (seller_account_key ~ '^[a-f0-9]{64}$'
          and seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1')
          and seller_account_verified_at is not null)
      )
    );
    insert into auth.users values('${owner}'),('${otherOwner}'),('${sharedAdmin}'),('${outsider}');
    insert into sellerpilot_private.admin_users values('${sharedAdmin}');
    insert into sellerpilot_private.channel_credentials(
      id,created_by,channel,environment,status,expires_at,seller_account_key,
      seller_account_key_source,seller_account_verified_at
    ) values
      ('${credential}','${owner}','shopee','production','active',null,'${"a".repeat(64)}',
        'provider_certified_v1','${credentialVerifiedAt}'),
      ('${otherCredential}','${otherOwner}','shopee','production','active',null,'${"b".repeat(64)}',
        'provider_certified_v1','${credentialVerifiedAt}');
  `);
  await db.exec(migration);
  await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_capabilities(
    owner_id,credential_id,shop_id) values($1,$2,$3)`, [owner, credential, shopId]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sharedAdmin]);
  return db;
}

async function read(db, cursor = null, limit = 100, conversationId = "conversation_1") {
  return (await db.query(`select public.sellerpilot_read_cs_shopee_buyer_chat_v1(
    $1,$2,$3,$4,$5) result`, [credential, shopId, conversationId, cursor, limit])).rows[0].result;
}

async function approve(db) {
  await db.query(`update sellerpilot_private.cs_shopee_buyer_chat_capabilities set
    state='approved',contract_revision='revision_1',
    contract_source_url='https://open.shopee.com/documents/v2/authorized',
    contract_verified_at='2026-09-09T00:00:00Z',app_approved_at='2026-09-09T00:01:00Z',
    webhook_verified_at='2026-09-09T00:02:00Z',evidence_sha256=$1,
    credential_environment='production',credential_seller_account_key=$2,
    credential_seller_account_verified_at=$3,shop_binding_sha256=$4
    where owner_id=$5 and credential_id=$6 and shop_id=$7`,
  ["c".repeat(64), sellerAccountKey, credentialVerifiedAt, shopBinding, owner, credential, shopId]);
}

test("pending capability exposes no messages and blocks service ingest despite configured credential", async () => {
  const db = await fixture();
  try {
    const pending = await read(db);
    assert.equal(pending.state, "permission_pending");
    assert.equal(pending.receive, false); assert.equal(pending.history, false);
    assert.equal(pending.reply, false); assert.equal(pending.shops[0].messages.length, 0);
    await assert.rejects(db.query(`select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1(
      $1,$2,$3)`, [owner, credential, JSON.stringify(page([message("message_1", "2026-09-09T00:00:00.000Z")]))]),
    /SHOPEE_BUYER_CHAT_PERMISSION_PENDING/u);
    await assert.rejects(db.query(`update sellerpilot_private.cs_shopee_buyer_chat_capabilities
      set state='approved' where owner_id=$1 and credential_id=$2 and shop_id=$3`,
    [owner, credential, shopId]), /check constraint/u);
  } finally { await db.close(); }
});

test("approved exact normalized pages ingest idempotently and reject identity drift", async () => {
  const db = await fixture();
  try {
    await approve(db);
    const first = page([message("message_1", "2026-09-09T00:00:00.000Z")]);
    const ingest = async value => (await db.query(`select
      public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1($1,$2,$3) result`,
    [owner, credential, JSON.stringify(value)])).rows[0].result;
    assert.equal((await ingest(first)).reply, false);
    assert.equal((await ingest(first)).acceptedCount, 1);
    assert.equal((await db.query(`select count(*)::int n from
      sellerpilot_private.cs_shopee_buyer_chat_messages`)).rows[0].n, 1);
    const approvedLedger=shopeeBuyerChatReadSchema.parse(await read(db));
    const approvedStatus=shopeeBuyerChatApiSchema.parse(
      projectShopeeBuyerChatApi(approvedLedger,SHOPEE_BUYER_CHAT_TRANSPORT),
    );
    assert.equal(approvedStatus.ledgerPermissionState,"page_evidence_approved");
    assert.equal(approvedStatus.operationalReceive,false);
    assert.equal(approvedStatus.automaticHistoryCollection,false);
    assert.equal(approvedStatus.storedHistory,true);
    assert.equal("receive" in approvedStatus,false);
    await assert.rejects(ingest(page([message("message_1", "2026-09-09T00:00:00.000Z", "drift")])),
      /SHOPEE_BUYER_CHAT_IDENTITY_CONFLICT/u);
    await assert.rejects(db.query(`select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1(
      $1,$2,$3)`, [otherOwner, otherCredential, JSON.stringify(first)]),
    /SHOPEE_BUYER_CHAT_PERMISSION_PENDING/u);
  } finally { await db.close(); }
});

test("owner-scoped reader paginates at 100 or less with exact shop conversation and message identity", async () => {
  const db = await fixture();
  try {
    await approve(db);
    const normalized = normalizeAuthorizedShopeeBuyerChatPage({ evidence: approvalEvidence,
      expectedShopId: shopId, page: {
        contract: "sellerpilot-shopee-buyer-chat-authorized-page/1", shopId,
        conversationId: "conversation_1", inputCursor: null, nextCursor: null, pageSize: 3,
        messages: [1, 2, 3].map(index => ({ conversationId: "conversation_1",
          messageId: `message_${index}`, senderRole: "buyer", body: `body message_${index}`,
          sentAt: `2026-09-09T00:00:0${index}.000Z`, orderSn: null, itemId: null,
          attachmentCount: 0 })),
      } });
    await db.query(`select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1(
      $1,$2,$3)`, [owner, credential, JSON.stringify({
        contract: "sellerpilot-shopee-buyer-chat-normalized-page/1", shopId,
        conversationId: "conversation_1", inputCursor: null, nextCursor: null,
        pageSize: 3, messages: normalized.storageRows,
      })]);
    const first = shopeeBuyerChatReadSchema.parse(await read(db, null, 2));
    assert.equal(first.state, "read_only_ready"); assert.equal(first.reply, false);
    assert.deepEqual(first.shops[0].messages.map(row => row.messageId), ["message_3", "message_2"]);
    assert.ok(first.shops[0].nextCursor);
    const second = shopeeBuyerChatReadSchema.parse(await read(db, first.shops[0].nextCursor, 2));
    assert.deepEqual(second.shops[0].messages.map(row => row.messageId), ["message_1"]);
    assert.equal(second.shops[0].nextCursor, null);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider]);
    await assert.rejects(read(db), /administrator required/u);
    const functions = (await db.query(`select proname from pg_proc
      where proname like '%shopee_buyer_chat%' order by proname`)).rows.map(row => row.proname);
    assert.deepEqual(functions, ["sellerpilot_read_cs_shopee_buyer_chat_v1",
      "sellerpilot_service_ingest_cs_shopee_buyer_chat_v1"]);
    assert.equal(functions.some(name => name.includes("reply")), false);
    const privileges = (await db.query(`select
      has_function_privilege('authenticated','public.sellerpilot_read_cs_shopee_buyer_chat_v1(uuid,text,text,text,integer)','execute') authenticated_read,
      has_function_privilege('anon','public.sellerpilot_read_cs_shopee_buyer_chat_v1(uuid,text,text,text,integer)','execute') anon_read,
      has_function_privilege('service_role','public.sellerpilot_read_cs_shopee_buyer_chat_v1(uuid,text,text,text,integer)','execute') service_read`)).rows[0];
    assert.deepEqual(privileges, { authenticated_read: true, anon_read: false, service_read: false });
  } finally { await db.close(); }
});


test("null and wrong-type page contract, pageSize, cursors and messages reject atomically",async()=>{
 const db=await fixture();try{
  await approve(db);
  for(const [key,replacement] of [
   ["contract",null],["contract",7],["pageSize",null],["pageSize","1"],
   ["inputCursor",1],["nextCursor",false],["messages",null],
  ]){
   const value={...page([]),[key]:replacement};
   await assert.rejects(db.query("select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1($1,$2,$3)",[owner,credential,JSON.stringify(value)]),/SHOPEE_BUYER_CHAT_PAGE_INVALID/);
  }
  const valid=message("atomic_1","2026-09-09T00:00:01.000Z");
  const invalid={...message("atomic_2","2026-09-09T00:00:02.000Z"),identityDigest:"0".repeat(64)};
  await assert.rejects(db.query("select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1($1,$2,$3)",[
   owner,credential,JSON.stringify(page([valid,invalid])),
  ]),/SHOPEE_BUYER_CHAT_EVIDENCE_INVALID/u);
  assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_buyer_chat_messages")).rows[0].n,0);
  await assert.rejects(read(db,null,null),/SHOPEE_BUYER_CHAT_READ_INVALID/u);
 }finally{await db.close();}
});
test("central negative: same timestamp and message ID across conversations survives pagination",async()=>{
 const db=await fixture();try{
  await approve(db);
  for(const conversationId of ["conversation_1","conversation_2"]){
   const m={...message("same_id","2026-09-09T00:00:00.000Z"),conversationId};
   m.identityDigest=sha(`${shopId}\n${conversationId}\n${m.messageId}`);
   m.evidenceDigest=sha([m.identityDigest,m.bodyFingerprint,m.senderRole,m.sentAt,"","",String(m.attachmentCount)].join("\n"));
   await db.query("select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1($1,$2,$3)",[owner,credential,JSON.stringify({...page([m]),conversationId})]);
  }
  const get=async cursor=>read(db,cursor,1,null);
  const a=await get(null);assert.equal(a.shops[0].messages.length,1);assert.ok(a.shops[0].nextCursor);
  const b=await get(a.shops[0].nextCursor);assert.equal(b.shops[0].messages.length,1);
  assert.notEqual(a.shops[0].messages[0].conversationId,b.shops[0].messages[0].conversationId);
 }finally{await db.close();}
});

test("cursor binds credential, shop, conversation scope, account binding and full row identity",async()=>{
 const db=await fixture();try{
  await approve(db);
  for(const index of [1,2])await db.query(
   "select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1($1,$2,$3)",
   [owner,credential,JSON.stringify(page([message(`cursor_${index}`,`2026-09-09T00:00:0${index}.000Z`)]))],
  );
  const first=await read(db,null,1);
  assert.ok(first.shops[0].nextCursor);
  const cursor=first.shops[0].nextCursor;
  await assert.rejects(db.query(
   "select public.sellerpilot_read_cs_shopee_buyer_chat_v1($1,$2,$3,$4,1)",
   [otherCredential,shopId,"conversation_1",cursor],
  ),/SHOPEE_BUYER_CHAT_CURSOR_INVALID/u);
  await assert.rejects(db.query(
   "select public.sellerpilot_read_cs_shopee_buyer_chat_v1($1,$2,$3,$4,1)",
   [credential,"1719148845","conversation_1",cursor],
  ),/SHOPEE_BUYER_CHAT_CURSOR_INVALID/u);
  await assert.rejects(db.query(
   "select public.sellerpilot_read_cs_shopee_buyer_chat_v1($1,$2,$3,$4,1)",
   [credential,shopId,"conversation_2",cursor],
  ),/SHOPEE_BUYER_CHAT_CURSOR_INVALID/u);
  const decoded=JSON.parse(Buffer.from(cursor,"base64").toString("utf8"));
  const tampered=Buffer.from(JSON.stringify({...decoded,conversationId:null})).toString("base64");
  await assert.rejects(read(db,tampered,1),/SHOPEE_BUYER_CHAT_CURSOR_INVALID/u);
  await db.query("update sellerpilot_private.cs_shopee_buyer_chat_capabilities set shop_binding_sha256=$2 where credential_id=$1",[
   credential,"f".repeat(64),
  ]);
  await assert.rejects(read(db,cursor,1),/SHOPEE_BUYER_CHAT_CURSOR_SCOPE_CHANGED/u);
 }finally{await db.close();}
});

test("shared administrator reads creator-owned history while a non-admin is denied",async()=>{
 const db=await fixture();try{
  await approve(db);
  await db.query("select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1($1,$2,$3)",[
   owner,credential,JSON.stringify(page([message("shared_1","2026-09-09T00:00:00.000Z")])),
  ]);
  const shared=shopeeBuyerChatReadSchema.parse(await read(db));
  assert.equal(shared.shops[0].credentialId,credential);
  assert.equal(shared.shops[0].messages[0].messageId,"shared_1");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[outsider]);
  await assert.rejects(read(db),/administrator required/u);
 }finally{await db.close();}
});

test("revoked, expired or account-drifted credential disables runtime readiness but preserves stored history",async()=>{
 const db=await fixture();try{
  await approve(db);
  await db.query("select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1($1,$2,$3)",[
   owner,credential,JSON.stringify(page([message("stored_1","2026-09-09T00:00:00.000Z")])),
  ]);
  const assertHistoryOnly=async()=>{
   const result=shopeeBuyerChatReadSchema.parse(await read(db));
   assert.equal(result.state,"permission_pending");assert.equal(result.reason,"credential_unavailable");
   assert.equal(result.receive,false);assert.equal(result.history,false);
   assert.equal(result.storedHistory,true);assert.equal(result.shops[0].runtimeReady,false);
   assert.equal(result.shops[0].storedHistory,true);
   assert.deepEqual(result.shops[0].messages.map(row=>row.messageId),["stored_1"]);
   const status=projectShopeeBuyerChatApi(result,SHOPEE_BUYER_CHAT_TRANSPORT);
   assert.equal(status.ledgerPermissionState,"permission_pending");
   assert.equal(status.ledgerPermissionReason,"credential_unavailable");
   assert.equal(status.operationalReceive,false);
   assert.equal(status.automaticHistoryCollection,false);
   assert.equal(status.storedHistory,true);
   assert.equal(status.shops[0].ledgerPermissionState,"permission_pending");
  };
  await db.query("update sellerpilot_private.channel_credentials set status='revoked' where id=$1",[credential]);
  await assertHistoryOnly();
  await db.query("update sellerpilot_private.channel_credentials set status='active',expires_at=now()-interval '1 second' where id=$1",[credential]);
  await assertHistoryOnly();
  await db.query("update sellerpilot_private.channel_credentials set expires_at=null,seller_account_key=$2 where id=$1",[
   credential,"d".repeat(64),
  ]);
  await assertHistoryOnly();
  await db.query("update sellerpilot_private.channel_credentials set seller_account_key=$2 where id=$1",[
   credential,sellerAccountKey,
  ]);
  await db.query("update sellerpilot_private.channel_credentials set seller_account_key_source='credential_incarnation_v1' where id=$1",[credential]);
  await assertHistoryOnly();
  await db.query("update sellerpilot_private.channel_credentials set seller_account_key_source='provider_certified_v1',seller_account_verified_at=$2 where id=$1",[
   credential,"2026-09-09T00:04:00.000Z",
  ]);
  await assertHistoryOnly();
  await db.query("update sellerpilot_private.channel_credentials set seller_account_verified_at=$2 where id=$1",[
   credential,credentialVerifiedAt,
  ]);
  await db.query("update sellerpilot_private.cs_shopee_buyer_chat_capabilities set shop_binding_sha256=$2 where credential_id=$1",[
   credential,"e".repeat(64),
  ]);
  await assertHistoryOnly();
 }finally{await db.close();}
});

test("same-shop history replay after exact credential rotation remains credential-scoped and readable",async()=>{
 const db=await fixture();try{
  await approve(db);
  const historic=page([message("rotated_1","2026-09-09T00:00:00.000Z")]);
  await db.query("select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1($1,$2,$3)",[
   owner,credential,JSON.stringify(historic),
  ]);
  await db.query("update sellerpilot_private.channel_credentials set status='revoked' where id=$1",[credential]);
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,created_by,channel,environment,status,expires_at,seller_account_key,
    seller_account_key_source,seller_account_verified_at
  ) values($1,$2,'shopee','production','active',null,$3,'provider_certified_v1',$4)`,[
   rotatedCredential,owner,sellerAccountKey,"2026-09-09T01:03:00.000Z",
  ]);
  const rotatedBinding=sha(["sellerpilot-shopee-buyer-chat-shop-binding/1",rotatedCredential,
   sellerAccountKey,"production",shopId].join("\n"));
  await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_capabilities(
    owner_id,credential_id,shop_id,state,contract_revision,contract_source_url,
    contract_verified_at,app_approved_at,webhook_verified_at,evidence_sha256,
    credential_environment,credential_seller_account_key,credential_seller_account_verified_at,
    shop_binding_sha256
  ) values($1,$2,$3,'approved','revision_2','https://open.shopee.com/documents/v2/authorized',
    '2026-09-09T01:00:00Z','2026-09-09T01:01:00Z','2026-09-09T01:02:00Z',$4,
    'production',$5,$6,$7)`,[
   owner,rotatedCredential,shopId,"d".repeat(64),sellerAccountKey,
   "2026-09-09T01:03:00.000Z",rotatedBinding,
  ]);
  await db.query("select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1($1,$2,$3)",[
   owner,rotatedCredential,JSON.stringify(historic),
  ]);
  const oldHistory=shopeeBuyerChatReadSchema.parse((await db.query(
   "select public.sellerpilot_read_cs_shopee_buyer_chat_v1($1,$2,$3,null,100) result",
   [credential,shopId,"conversation_1"],
  )).rows[0].result);
  const rotatedHistory=shopeeBuyerChatReadSchema.parse((await db.query(
   "select public.sellerpilot_read_cs_shopee_buyer_chat_v1($1,$2,$3,null,100) result",
   [rotatedCredential,shopId,"conversation_1"],
  )).rows[0].result);
  assert.equal(oldHistory.shops[0].runtimeReady,false);
  assert.equal(oldHistory.shops[0].messages[0].messageId,"rotated_1");
  assert.equal(rotatedHistory.shops[0].runtimeReady,true);
  assert.equal(rotatedHistory.shops[0].messages[0].messageId,"rotated_1");
  assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_buyer_chat_messages")).rows[0].n,2);
 }finally{await db.close();}
});
