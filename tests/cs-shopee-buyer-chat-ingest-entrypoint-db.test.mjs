import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  ingestAuthorizedShopeeBuyerChatPage,
  ShopeeBuyerChatIngestError,
} from "../lib/channels/cs/shopee/buyer-chat-ingest.ts";
import { shopeeBuyerChatReadSchema } from "../lib/cs/channels/shopee/buyer-chat-contract.ts";

const [canonicalSql, entitlementSql] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260909165247_cs_shopee_buyer_chat_read_ledger.sql",
    import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260909185400_cs_shopee_buyer_chat_ingest_entitlement.sql",
    import.meta.url), "utf8"),
]);
const owner = "00000000-0000-4000-8000-000000079001";
const admin = "00000000-0000-4000-8000-000000079002";
const credentialId = "00000000-0000-4000-8000-000000079003";
const entitlementId = "00000000-0000-4000-8000-000000079004";
const shopId = "1719148844";
const sellerAccountKey = "a".repeat(64);
const verifiedAt = "2026-09-09T00:03:00.000Z";
const capabilityEvidence = "c".repeat(64);
const sha = value => createHash("sha256").update(value).digest("hex");
const shopBinding = sha([
  "sellerpilot-shopee-buyer-chat-shop-binding/1", credentialId,
  sellerAccountKey, "production", shopId,
].join("\n"));

function authorizedMessage(messageId, body) {
  return {
    conversationId: "conversation_1", messageId, senderRole: "buyer", body,
    sentAt: "2026-09-09T00:00:00.000Z", orderSn: null, itemId: null, attachmentCount: 0,
  };
}

function authorizedPage({ inputCursor = null, nextCursor = null, messageId = "message_1",
  body = "Where is my order?" } = {}) {
  return {
    contract: "sellerpilot-shopee-buyer-chat-authorized-page/1",
    shopId, conversationId: "conversation_1", inputCursor, nextCursor, pageSize: 1,
    messages: [authorizedMessage(messageId, body)],
  };
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
      seller_account_key_source text not null,seller_account_verified_at timestamptz
    );
    insert into auth.users values('${owner}'),('${admin}');
    insert into sellerpilot_private.admin_users values('${admin}');
    insert into sellerpilot_private.channel_credentials values(
      '${credentialId}','${owner}','shopee','production','active',null,
      '${sellerAccountKey}','provider_certified_v1','${verifiedAt}'
    );
  `);
  await db.exec(canonicalSql);
  await db.exec(entitlementSql);
  await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_capabilities(
    owner_id,credential_id,shop_id,state,contract_revision,contract_source_url,
    contract_verified_at,app_approved_at,webhook_verified_at,evidence_sha256,
    credential_environment,credential_seller_account_key,
    credential_seller_account_verified_at,shop_binding_sha256
  ) values($1,$2,$3,'approved','revision_1',
    'https://open.shopee.com/documents/v2/authorized','2026-09-09T00:00:00Z',
    '2026-09-09T00:01:00Z','2026-09-09T00:02:00Z',$4,'production',$5,$6,$7)`,
  [owner, credentialId, shopId, capabilityEvidence, sellerAccountKey, verifiedAt, shopBinding]);
  await db.query(`insert into sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements(
    entitlement_id,owner_id,credential_id,shop_id,state,entitlement_revision,
    contract_revision,contract_source_url,contract_verified_at,app_type,app_approved_at,
    webhook_event,webhook_verified_at,capability_evidence_sha256,credential_environment,
    credential_seller_account_key,credential_seller_account_verified_at,shop_binding_sha256,
    issued_at,expires_at
  ) values($1,$2,$3,$4,'approved','entitlement_1','revision_1',
    'https://open.shopee.com/documents/v2/authorized','2026-09-09T00:00:00Z',
    'seller_in_house_system','2026-09-09T00:01:00Z','sellerchat_message',
    '2026-09-09T00:02:00Z',$5,'production',$6,$7,$8,now()-interval '1 day',
    now()+interval '30 days')`,
  [entitlementId, owner, credentialId, shopId, capabilityEvidence,
    sellerAccountKey, verifiedAt, shopBinding]);
  const rpcCalls = [];
  const serviceClient = {
    async rpc(name, arguments_) {
      rpcCalls.push({ name, arguments_ });
      try {
        if (name === "sellerpilot_service_read_shopee_chat_entitlement_v1") {
          const result = await db.query(`select
            public.sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1(
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
        throw new Error(`unexpected RPC ${name}`);
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
  };
  return { db, serviceClient, rpcCalls };
}

async function ingest(serviceClient, page = authorizedPage(), overrides = {}) {
  return ingestAuthorizedShopeeBuyerChatPage({
    credentialId, shopId, entitlementId, page, ...overrides,
  }, serviceClient);
}

test("trusted entrypoint uses server entitlement, canonical writer and existing admin reader", async () => {
  const { db, serviceClient, rpcCalls } = await fixture();
  try {
    const receipt = await ingest(serviceClient, authorizedPage({ nextCursor: "cursor_2" }));
    assert.equal(receipt.status, "ingested");
    assert.equal(receipt.committedCursor, "cursor_2");
    assert.deepEqual(rpcCalls.map(call => call.name), [
      "sellerpilot_service_read_shopee_chat_entitlement_v1",
      "sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1",
    ]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    const read = (await db.query(`select public.sellerpilot_read_cs_shopee_buyer_chat_v1(
      $1,$2,'conversation_1',null,100
    ) result`, [credentialId, shopId])).rows[0].result;
    const ledger = shopeeBuyerChatReadSchema.parse(read);
    assert.equal(ledger.shops[0].messages[0].body, "Where is my order?");
    assert.equal(ledger.reply, false);
  } finally { await db.close(); }
});

test("caller approval objects cannot authorize and exact entitlement scope rejects cross-shop", async () => {
  const { db, serviceClient, rpcCalls } = await fixture();
  try {
    await assert.rejects(ingestAuthorizedShopeeBuyerChatPage({
      credentialId, shopId, entitlementId, page: authorizedPage(),
      permissionEvidence: { appApproval: { state: "approved" } },
    }, serviceClient), error => error instanceof ShopeeBuyerChatIngestError
      && error.code === "REQUEST_INVALID");
    assert.equal(rpcCalls.length, 0);
    await assert.rejects(ingestAuthorizedShopeeBuyerChatPage({
      credentialId,
      shopId,
      entitlementId: "00000000-0000-4000-8000-000000079999",
      page: {
        ...authorizedPage(),
        permissionEvidence: { appApproval: { state: "approved" } },
      },
    }, serviceClient), error => error instanceof ShopeeBuyerChatIngestError
      && error.code === "ENTITLEMENT_UNAVAILABLE");
    assert.equal(rpcCalls.at(-1).name,
      "sellerpilot_service_read_shopee_chat_entitlement_v1");
    await assert.rejects(ingest(serviceClient, { ...authorizedPage(), shopId: "1719148845" }, {
      shopId: "1719148845",
    }), error => error instanceof ShopeeBuyerChatIngestError
      && error.code === "ENTITLEMENT_UNAVAILABLE");
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_buyer_chat_messages")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("expired or revoked entitlement and stale credential fail before normalization or storage", async () => {
  const { db, serviceClient } = await fixture();
  try {
    await db.query(`update sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements
      set state='revoked',revoked_at=now() where entitlement_id=$1`, [entitlementId]);
    await assert.rejects(ingest(serviceClient), error => error instanceof ShopeeBuyerChatIngestError
      && error.code === "ENTITLEMENT_UNAVAILABLE");
    await db.query(`update sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements
      set state='approved',revoked_at=null,expires_at=now()-interval '1 second'
      where entitlement_id=$1`, [entitlementId]);
    await assert.rejects(ingest(serviceClient), error => error instanceof ShopeeBuyerChatIngestError
      && error.code === "ENTITLEMENT_UNAVAILABLE");
    await db.query(`update sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements
      set expires_at=now()+interval '30 days' where entitlement_id=$1`, [entitlementId]);
    await db.query("update sellerpilot_private.channel_credentials set status='revoked' where id=$1",
      [credentialId]);
    await assert.rejects(ingest(serviceClient), error => error instanceof ShopeeBuyerChatIngestError
      && error.code === "ENTITLEMENT_UNAVAILABLE");
  } finally { await db.close(); }
});

test("replay is idempotent and writer failure cannot advance continuation", async () => {
  const { db, serviceClient } = await fixture();
  try {
    const firstPage = authorizedPage({ nextCursor: "cursor_2" });
    assert.equal((await ingest(serviceClient, firstPage)).status, "ingested");
    assert.equal((await ingest(serviceClient, firstPage)).status, "replayed");
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_buyer_chat_messages")).rows[0].n, 1);

    const drift = authorizedPage({ inputCursor: "cursor_2", nextCursor: "cursor_3",
      body: "Changed body" });
    await assert.rejects(ingest(serviceClient, drift), error =>
      error instanceof ShopeeBuyerChatIngestError && error.code === "WRITER_FAILED");
    const failedProgress = (await db.query(`select committed_cursor,last_input_cursor,
      last_next_cursor from sellerpilot_private.cs_shopee_buyer_chat_ingest_progress`)).rows[0];
    assert.deepEqual(failedProgress, {
      committed_cursor: "cursor_2", last_input_cursor: null, last_next_cursor: "cursor_2",
    });

    const second = await ingest(serviceClient, authorizedPage({ inputCursor: "cursor_2",
      nextCursor: null, messageId: "message_2", body: "Second page" }));
    assert.equal(second.status, "ingested");
    assert.equal(second.committedCursor, null);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_buyer_chat_messages")).rows[0].n, 2);
  } finally { await db.close(); }
});

test("entitlement and progress objects remain service-only behind security-definer RPCs", async () => {
  const { db } = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query(`select has_function_privilege($1,
        'public.sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1(uuid,text,uuid,jsonb)',
        'execute') allowed`, [role])).rows[0].allowed, false);
    }
    assert.equal((await db.query(`select has_function_privilege('service_role',
      'public.sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1(uuid,text,uuid,jsonb)',
      'execute') allowed`)).rows[0].allowed, true);
  } finally { await db.close(); }
});
