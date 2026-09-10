import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import {
  persistVerifiedShopeeBuyerChatPush,
  readShopeeBuyerChatPushAddress,
  ShopeeBuyerChatPushError,
  shopeeBuyerChatPushTransportSchema,
  verifyAndNormalizeShopeeBuyerChatPush,
} from "../lib/channels/cs/shopee/buyer-chat-push.ts";
import { ShopeeBuyerChatIngestError, ingestAuthorizedShopeeBuyerChatPage } from
  "../lib/channels/cs/shopee/buyer-chat-ingest.ts";
import { shopeeBuyerChatReadSchema } from
  "../lib/cs/channels/shopee/buyer-chat-contract.ts";

const [canonicalSql, entitlementSql, pushSql, mediaSql, routeSource] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260909165247_cs_shopee_buyer_chat_read_ledger.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260909185400_cs_shopee_buyer_chat_ingest_entitlement.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260909221500_cs_shopee_buyer_chat_push_transport.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260910062000_cs_shopee_buyer_chat_push_media.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../app/api/webhooks/shopee-buyer-chat/route.ts", import.meta.url), "utf8"),
]);
const transpiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiledRoute.diagnostics?.filter(item =>
  item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);

const owner = "00000000-0000-4000-8000-000000099001";
const admin = "00000000-0000-4000-8000-000000099002";
const credentialId = "00000000-0000-4000-8000-000000099003";
const entitlementId = "00000000-0000-4000-8000-000000099004";
const vaultSecretId = "00000000-0000-4000-8000-000000099005";
const shopId = "947042923";
const sellerAccountKey = "a".repeat(64);
const capabilityEvidence = "c".repeat(64);
const verifiedAt = "2026-09-09T00:03:00.000Z";
const callbackUrl = "https://sellerpilot.example/api/webhooks/shopee-buyer-chat";
const partnerKey = "fixture-partner-key-never-production";
const sha = value => createHash("sha256").update(value).digest("hex");
const shopBinding = sha([
  "sellerpilot-shopee-buyer-chat-shop-binding/1", credentialId,
  sellerAccountKey, "production", shopId,
].join("\n"));

function rawPush(requestId = "request-1") {
  return JSON.stringify({
    data: { type: "message", region: "ID", content: {
      message_id: "2302748948493123953", request_id: requestId,
      from_id: 165105353, to_id: 947151379,
      message_type: "text", content: { text: "Where is my order?" },
      conversation_id: "709122092476686867", created_timestamp: 1726044721,
      region: "ID", source_content: { order_sn: "ORDER_20260909" }, business_type: 0,
      to_shop_id: Number(shopId), from_shop_id: 0,
    } },
    shop_id: Number(shopId), code: 10, timestamp: 1726044722,
  });
}

function signedRequest(rawBody, authorization = createHmac("sha256", partnerKey)
  .update(`${callbackUrl}|${rawBody}`).digest("hex")) {
  return new Request(callbackUrl, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: rawBody,
  });
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
    create schema vault;
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable
      security definer set search_path='' as $$select exists(
        select 1 from sellerpilot_private.admin_users where user_id=auth.uid()
      )$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid,channel text,environment text,status text,
      expires_at timestamptz,seller_account_key text,
      seller_account_key_source text not null,seller_account_verified_at timestamptz,
      vault_secret_id uuid
    );
    insert into auth.users values('${owner}'),('${admin}');
    insert into sellerpilot_private.admin_users values('${admin}');
    insert into vault.decrypted_secrets values(
      '${vaultSecretId}',
      '{"partner_id":"123456","partner_key":"${partnerKey}","shop_id":"${shopId}"}'
    );
    insert into sellerpilot_private.channel_credentials values(
      '${credentialId}','${owner}','shopee','production','active',null,
      '${sellerAccountKey}','provider_certified_v1','${verifiedAt}','${vaultSecretId}'
    );
  `);
  await db.exec(canonicalSql);
  await db.exec(entitlementSql);
  await db.exec(pushSql);
  await db.exec(mediaSql);
  await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_capabilities(
    owner_id,credential_id,shop_id,state,contract_revision,contract_source_url,
    contract_verified_at,app_approved_at,webhook_verified_at,evidence_sha256,
    credential_environment,credential_seller_account_key,
    credential_seller_account_verified_at,shop_binding_sha256
  ) values($1,$2,$3,'approved','revision_1',
    'https://open.shopee.com/developer-guide/18','2026-09-09T00:00:00Z',
    '2026-09-09T00:01:00Z','2026-09-09T00:02:00Z',$4,'production',$5,$6,$7)`,
  [owner, credentialId, shopId, capabilityEvidence, sellerAccountKey, verifiedAt, shopBinding]);
  await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements(
    entitlement_id,owner_id,credential_id,shop_id,state,entitlement_revision,
    contract_revision,contract_source_url,contract_verified_at,app_type,app_approved_at,
    webhook_event,webhook_verified_at,capability_evidence_sha256,credential_environment,
    credential_seller_account_key,credential_seller_account_verified_at,shop_binding_sha256,
    issued_at,expires_at
  ) values($1,$2,$3,$4,'approved','entitlement_1','revision_1',
    'https://open.shopee.com/developer-guide/18','2026-09-09T00:00:00Z',
    'seller_in_house_system','2026-09-09T00:01:00Z','webchat_push',
    '2026-09-09T00:02:00Z',$5,'production',$6,$7,$8,now()-interval '1 day',
    now()+interval '30 days')`,
  [entitlementId, owner, credentialId, shopId, capabilityEvidence,
    sellerAccountKey, verifiedAt, shopBinding]);

  const rpcCalls = [];
  const serviceClient = {
    async rpc(name, arguments_) {
      rpcCalls.push({ name, arguments_ });
      try {
        if (name === "sellerpilot_service_resolve_shopee_buyer_chat_push_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_resolve_shopee_buyer_chat_push_v1($1)
            result`, [arguments_.p_shop_id]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_service_read_shopee_chat_entitlement_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_read_shopee_chat_entitlement_v1(
              $1,$2,$3
            ) result`, [arguments_.p_credential_id, arguments_.p_shop_id,
            arguments_.p_entitlement_id]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1(
              $1,$2,$3,$4::jsonb
            ) result`, [arguments_.p_credential_id, arguments_.p_shop_id,
            arguments_.p_entitlement_id, JSON.stringify(arguments_.p_page)]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_service_ingest_shopee_buyer_chat_push_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_ingest_shopee_buyer_chat_push_v1(
              $1,$2,$3,$4::jsonb,$5::jsonb
            ) result`, [arguments_.p_credential_id, arguments_.p_shop_id,
            arguments_.p_entitlement_id, JSON.stringify(arguments_.p_evidence),
            JSON.stringify(arguments_.p_page)]);
          return { data: result.rows[0].result, error: null };
        }
        if (name === "sellerpilot_service_ingest_shopee_buyer_chat_media_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_ingest_shopee_buyer_chat_media_v1(
              $1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb
            ) result`, [arguments_.p_credential_id, arguments_.p_shop_id,
            arguments_.p_entitlement_id, JSON.stringify(arguments_.p_evidence),
            JSON.stringify(arguments_.p_page), JSON.stringify(arguments_.p_media)]);
          return { data: result.rows[0].result, error: null };
        }
        throw new Error(`unexpected RPC ${name}`);
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
  };

  const exportsObject = {};
  const sandbox = vm.createContext({
    exports: exportsObject, Request, Response, URL, Headers, Buffer,
    console: { error() {}, warn() {}, info() {}, log() {} },
    require(name) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@supabase/supabase-js") return { createClient: () => serviceClient };
      if (name.endsWith("/buyer-chat-push")) return {
        persistVerifiedShopeeBuyerChatPush,
        readShopeeBuyerChatPushAddress,
        ShopeeBuyerChatPushError,
        shopeeBuyerChatPushTransportSchema,
        verifyAndNormalizeShopeeBuyerChatPush,
      };
      if (name.endsWith("/buyer-chat-ingest")) return { ShopeeBuyerChatIngestError };
      if (name.endsWith("/supabase/config")) {
        return { supabaseUrl: "https://fixture.supabase.co" };
      }
      if (name.endsWith("/worker-rpc")) return { createBoundedSupabaseFetch: () => fetch };
      throw new Error(`unexpected import ${name}`);
    },
    process: { env: {
      SUPABASE_SECRET_KEY: "fixture-service-secret",
      SHOPEE_BUYER_CHAT_PUSH_CALLBACK_URL: callbackUrl,
    } },
  });
  vm.runInContext(transpiledRoute.outputText, sandbox);
  return { db, rpcCalls, serviceClient, POST: exportsObject.POST };
}

test("actual signed route persists canonical message and exact replay only once", async () => {
  const { db, POST } = await fixture();
  try {
    const rawBody = rawPush();
    const first = await POST(signedRequest(rawBody));
    assert.equal(first.status, 204);
    assert.equal(await first.text(), "");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    const read = (await db.query(`select public.sellerpilot_read_cs_shopee_buyer_chat_v1(
      $1,$2,'709122092476686867',null,100
    ) result`, [credentialId, shopId])).rows[0].result;
    const ledger = shopeeBuyerChatReadSchema.parse(read);
    assert.equal(ledger.shops[0].messages[0].body, "Where is my order?");
    assert.equal(ledger.shops[0].messages[0].orderSn, "ORDER_20260909");
    assert.equal(ledger.reply, false);

    const replay = await POST(signedRequest(rawBody));
    assert.equal(replay.status, 204);
    assert.equal((await db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_buyer_chat_messages`)).rows[0].n, 1);
    assert.equal((await db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_buyer_chat_push_receipts`)).rows[0].n, 1);

    const drift = rawPush("request-2");
    assert.equal((await POST(signedRequest(drift))).status, 503);
    assert.equal((await POST(signedRequest(rawBody, "0".repeat(64)))).status, 401);
    assert.equal((await db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_buyer_chat_messages`)).rows[0].n, 1);
    assert.equal((await db.query(`select count(*)::int n
      from sellerpilot_private.cs_shopee_buyer_chat_push_receipts`)).rows[0].n, 1);

    await db.query(`update sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements
      set state='revoked',revoked_at=now() where entitlement_id=$1`, [entitlementId]);
    assert.equal((await POST(signedRequest(rawBody))).status, 403);
  } finally { await db.close(); }
});

test("push transport resolver and receipt recorder stay service-role only", async () => {
  const { db } = await fixture();
  try {
    const signatures = [
      "public.sellerpilot_service_read_shopee_chat_entitlement_v1(uuid,text,uuid)",
      "public.sellerpilot_service_resolve_shopee_buyer_chat_push_v1(text)",
      "public.sellerpilot_service_ingest_shopee_buyer_chat_push_v1(uuid,text,uuid,jsonb,jsonb)",
    ];
    for (const signature of signatures) {
      for (const role of ["anon", "authenticated"]) {
        assert.equal((await db.query(`select has_function_privilege($1,$2,'execute') allowed`,
          [role, signature])).rows[0].allowed, false);
      }
      assert.equal((await db.query(`select has_function_privilege('service_role',$1,'execute')
        allowed`, [signature])).rows[0].allowed, true);
    }
  } finally { await db.close(); }
});

test("central push must coexist with unfinished history cursor", async()=>{
 const {db,serviceClient,POST}=await fixture();
 try {
 const raw=rawPush();
 const authorization=createHmac("sha256",partnerKey).update(`${callbackUrl}|${raw}`).digest("hex");
 const normalized=verifyAndNormalizeShopeeBuyerChatPush({callbackUrl,rawBody:raw,partnerKey,authorization,expectedShopId:shopId});
 const page={...normalized.page,nextCursor:"history-page-2"};
 const result=await ingestAuthorizedShopeeBuyerChatPage({credentialId,shopId,entitlementId,page},serviceClient);
 assert.equal(result.committedCursor,"history-page-2");
 const next=JSON.parse(raw);next.data.content.message_id="2302748948493123954";next.data.content.request_id="next-push";
 next.data.content.message_type="image";
 next.data.content.content={
   url:"https://cf.shopee.vn/file/09591ecdc9f1dc7bd507817797d826fe_dynamic",
   thumb_url:"b9591ecdc9f1dc7bd507817797d826fe_dynamic_tn",
   thumb_height:711,thumb_width:400,file_server_id:0,
 };
 next.data.content.source_content={};
 const response=await POST(signedRequest(JSON.stringify(next)));
 const rows=(await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_buyer_chat_messages")).rows[0].n;
 const cursor=(await db.query("select committed_cursor from sellerpilot_private.cs_shopee_buyer_chat_ingest_progress")).rows[0].committed_cursor;
 assert.equal(cursor,"history-page-2");
 assert.ok(response.status===204 && rows===2,`status=${response.status}, canonical rows=${rows}, historyCursor=${cursor}`);
 assert.equal((await db.query(`select count(*)::int n
   from sellerpilot_private.cs_shopee_buyer_chat_message_media`)).rows[0].n,1);

 const nextHistoryPage={...normalized.page,inputCursor:"history-page-2",nextCursor:null,
  messages:[{...normalized.page.messages[0],messageId:"history-message-3",body:"History next"}]};
 const historyNext=await ingestAuthorizedShopeeBuyerChatPage({
  credentialId,shopId,entitlementId,page:nextHistoryPage,
 },serviceClient);
 assert.equal(historyNext.status,"ingested");
 assert.equal(historyNext.committedCursor,null);
 const historyReplay=await ingestAuthorizedShopeeBuyerChatPage({
  credentialId,shopId,entitlementId,page:nextHistoryPage,
 },serviceClient);
 assert.equal(historyReplay.status,"replayed");
 const progress=(await db.query(`select committed_cursor,last_input_cursor,last_next_cursor
  from sellerpilot_private.cs_shopee_buyer_chat_ingest_progress`)).rows[0];
 assert.deepEqual(progress,{committed_cursor:null,last_input_cursor:"history-page-2",
  last_next_cursor:null});
 assert.equal((await db.query(`select count(*)::int n
  from sellerpilot_private.cs_shopee_buyer_chat_messages`)).rows[0].n,3);
 }finally{await db.close();}
});
