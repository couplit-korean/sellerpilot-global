import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { z } from "zod";
import { temuBuyerChatRuntimeReadSchema } from "../lib/channels/cs/temu/runtime-readiness.ts";
import { temuHistoryAccountsSchema } from "../lib/cs/channels/temu/history-resume.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { adaptTemuBuyerChatSource, temuBuyerChatSourceStatus } = await import(
  "../lib/channels/cs/temu/buyer-chat-source-adapter.ts"
);

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/temu/buyer-chat-source-status/route.ts",
  import.meta.url,
), "utf8");
const transpiled = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const credentialId = "00000000-0000-4000-8000-00000000d601";
const sellerAccountKey = "6".repeat(64);

async function count(db, table) {
  return (await db.query(`select count(*)::integer count from ${table}`)).rows[0].count;
}

test("PGlite canonical inquiry tables remain empty after source-status and forged raw attempts", async () => {
  const db = new PGlite();
  let providerFetchCount = 0;
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table source_accounts(
        credential_id uuid primary key,
        seller_account_key text not null,
        environment text not null,
        active boolean not null
      );
      create table source_readiness(
        credential_id uuid primary key references source_accounts(credential_id),
        evidence jsonb
      );
      create table sellerpilot_private.support_tickets(
        id uuid primary key,
        channel_key text not null,
        external_ticket_id text not null,
        body text not null
      );
      create table sellerpilot_private.support_inbound_messages(
        id uuid primary key,
        ticket_id uuid not null references sellerpilot_private.support_tickets(id),
        channel_key text not null,
        inbound_key text not null,
        body text not null
      );
    `);
    await db.query(`insert into source_accounts values($1,$2,'production',true)`,
      [credentialId, sellerAccountKey]);
    await db.query("insert into source_readiness values($1,null)", [credentialId]);

    const rpcCalls = [];
    const exportsObject = {};
    const context = vm.createContext({
      exports: exportsObject,
      Request,
      Response,
      URL,
      Object,
      z,
      fetch: async () => {
        providerFetchCount += 1;
        throw new Error("provider fetch forbidden");
      },
      require(name) {
        if (name === "next/server") return { NextResponse: Response };
        if (name === "zod") return { z };
        if (name.endsWith("/admin-api")) return {
          authenticateAdminRequest: async () => ({
            userClient: {
              rpc: async (rpcName, args = {}) => {
                rpcCalls.push(rpcName);
                if (rpcName === "sellerpilot_list_temu_cs_accounts_v1") {
                  const rows = (await db.query(`select * from source_accounts where active=true`)).rows;
                  return { data: {
                    contract: "sellerpilot-temu-cs-accounts/1",
                    checkedAt: new Date().toISOString(),
                    accounts: rows.map(row => ({
                      credentialId: row.credential_id,
                      label: "Temu source fixture",
                      environment: row.environment,
                      credentialFingerprint: "source060001",
                      sellerAccountKeyHash: row.seller_account_key,
                    })),
                  }, error: null };
                }
                if (rpcName === "sellerpilot_read_temu_buyer_chat_readiness_v1") {
                  const row = (await db.query(`select account.*,readiness.evidence
                    from source_accounts account join source_readiness readiness
                      on readiness.credential_id=account.credential_id
                    where account.credential_id=$1`, [args.p_credential_id])).rows[0];
                  return { data: {
                    contract: "sellerpilot-temu-buyer-chat-runtime-read/1",
                    checkedAt: new Date().toISOString(),
                    credentialId: row.credential_id,
                    sellerAccountKey: row.seller_account_key,
                    environment: row.environment,
                    evidence: row.evidence,
                  }, error: null };
                }
                throw new Error(`unexpected RPC ${rpcName}`);
              },
            },
          }),
          isAdminApiError: value => value instanceof Response,
        };
        if (name.endsWith("/channels/cs/temu/runtime-readiness")) {
          return { temuBuyerChatRuntimeReadSchema };
        }
        if (name.endsWith("/channels/cs/temu/buyer-chat-source-adapter")) {
          return { temuBuyerChatSourceStatus };
        }
        if (name.endsWith("/cs/channels/temu/history-resume")) {
          return { temuHistoryAccountsSchema };
        }
        throw new Error(`unexpected route import ${name}`);
      },
    });
    vm.runInContext(transpiled, context);

    const before = {
      tickets: await count(db, "sellerpilot_private.support_tickets"),
      messages: await count(db, "sellerpilot_private.support_inbound_messages"),
    };
    const raw = JSON.stringify({ sessionId: "invented", message: "must not persist" });
    const adapted = adaptTemuBuyerChatSource({
      rawBody: raw,
      verifiedReceipt: {
        contract: "sellerpilot-temu-buyer-chat-source-receipt/1",
        source: "sellerpilot_private.temu_buyer_chat_readiness_evidence",
        receiptId: "00000000-0000-4000-8000-00000000d602",
        credentialId,
        sellerAccountKey,
        environment: "production",
        region: "GLOBAL",
        rawSha256: "f".repeat(64),
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        evidence: { claimedTrusted: true, contractKey: "INVENTED.BUYER.CHAT" },
      },
      expected: {
        credentialId,
        sellerAccountKey,
        environment: "production",
        expectedRegion: "GLOBAL",
        now: new Date().toISOString(),
      },
    });
    assert.equal(adapted.status.rawAccepted, false);
    assert.equal(adapted.status.canonicalPromotionPerformed, false);
    assert.equal(adapted.status.canonicalInquiry, null);
    const response = await exportsObject.GET(new Request(
      `https://sellerpilot.invalid/api/admin/cs/channels/temu/buyer-chat-source-status?credentialId=${credentialId}`,
    ));
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.sourceAdapterImplemented, true);
    assert.equal(status.canonicalPromotionPerformed, false);
    assert.equal(status.canonicalInquiry, null);
    assert.deepEqual(rpcCalls, [
      "sellerpilot_list_temu_cs_accounts_v1",
      "sellerpilot_read_temu_buyer_chat_readiness_v1",
    ]);

    const after = {
      tickets: await count(db, "sellerpilot_private.support_tickets"),
      messages: await count(db, "sellerpilot_private.support_inbound_messages"),
    };
    assert.deepEqual(after, before);
    assert.deepEqual(after, { tickets: 0, messages: 0 });
    assert.equal(providerFetchCount, 0);
  } finally {
    await db.close();
  }
});
