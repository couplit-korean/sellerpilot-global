import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import * as contract from "../lib/cs/channels/coupang/verification.ts";

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/coupang/verification/route.ts",
  import.meta.url,
), "utf8");
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fixtureSql = await readFile(new URL(
  "./fixtures/cs/coupang/db-web-fixture.sql",
  import.meta.url,
), "utf8");
const rpcSql = await readFile(new URL(
  "../supabase/migrations/20260908141314_cs_coupang_authenticated_web_verification.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000003001";
const other = "00000000-0000-4000-8000-000000003002";
const credential = "00000000-0000-4000-8000-000000003011";

async function fixture() {
  const db = new PGlite();
  await db.exec(fixtureSql);
  await db.exec(rpcSql);
  return db;
}

test("verification RPC rejects null kind and null limit instead of widening the read", async () => {
  const db = await fixture();
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    for (const [kind, limit] of [[null, 100], ["call-center", null]]) {
      await assert.rejects(db.query(
        "select public.sellerpilot_read_coupang_cs_verification_v1($1,'2024-02-01','2024-02-29',$2,$3::integer)",
        [credential, kind, limit],
      ), /COUPANG_CS_VERIFICATION_ARGUMENT_INVALID/u);
    }
  } finally { await db.close(); }
});

async function routeCall(db: PGlite, url: string, options: { denied?: boolean; rpcData?: unknown } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const sandbox = vm.createContext({
    exports: {}, Request, Response, URL,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/cs/channels/coupang/verification")) return contract;
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => options.denied
          ? Response.json({ message: "denied" }, { status: 401 })
          : {
              userClient: {
                rpc: async (rpcName: string, args: Record<string, unknown>) => {
                  calls.push({ name: rpcName, args });
                  if (rpcName !== "sellerpilot_read_coupang_cs_verification_v1") {
                    throw new Error("unexpected RPC");
                  }
                  if ("rpcData" in options) {
                    return { data: options.rpcData, error: null };
                  }
                  try {
                    const result = await db.query(
                      "select public.sellerpilot_read_coupang_cs_verification_v1($1,$2::date,$3::date,$4,$5::integer) result",
                      [args.p_credential_id, args.p_from_date, args.p_to_date, args.p_kind, args.p_limit],
                    );
                    return { data: result.rows[0]?.result ?? null, error: null };
                  } catch (error) {
                    return { data: null, error };
                  }
                },
              },
              serviceClient: { rpc: () => { throw new Error("service client forbidden"); } },
            },
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      throw new Error(`unexpected module ${name}`);
    },
  });
  vm.runInContext(compiledRoute, sandbox);
  const response = await (sandbox.exports as { GET(request: Request): Promise<Response> }).GET(new Request(url));
  return { response, calls };
}

test("isolated DB flows through the authenticated Coupang route with exact IDs and conversation", async () => {
  const db = await fixture();
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    const { response, calls } = await routeCall(db,
      `https://example.test/api/admin/cs/channels/coupang/verification?credentialId=${credential}&from=2024-02-01&to=2024-02-29&kind=call-center`);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, "sellerpilot_read_coupang_cs_verification_v1");
    const body = await response.json();
    assert.equal(body.totalTickets, 1);
    assert.equal(body.displayedTickets, 1);
    assert.equal(body.tickets[0].externalTicketId, "call-center:3101");
    assert.equal(body.tickets[0].externalOrderReference, "9001");
    assert.deepEqual(body.tickets[0].messages.map((message: Record<string, unknown>) => ({
      remoteMessageId: message.remoteMessageId,
      senderRole: message.senderRole,
      parentAnswerId: message.parentAnswerId,
    })), [
      { remoteMessageId: "4103", senderRole: "customer", parentAnswerId: "4103" },
      { remoteMessageId: "4104", senderRole: "seller", parentAnswerId: "4103" },
    ]);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("다른 판매자"), false);
    assert.equal(serialized.includes("010-0000-0000"), false);
    assert.equal(serialized.includes("비공개 주소"), false);
    assert.match(response.headers.get("cache-control") ?? "", /private, no-store/u);
  } finally {
    await db.close();
  }
});

test("web route authenticates first and rejects invalid ranges without a DB read", async () => {
  const db = await fixture();
  try {
    let result = await routeCall(db,
      `https://example.test/api/admin/cs/channels/coupang/verification?credentialId=${credential}&from=2024-02-01&to=2024-02-29&kind=call-center`,
      { denied: true });
    assert.equal(result.response.status, 401);
    assert.equal(result.calls.length, 0);
    result = await routeCall(db,
      `https://example.test/api/admin/cs/channels/coupang/verification?credentialId=${credential}&from=2024-02-30&to=2024-02-29&kind=call-center`);
    assert.equal(result.response.status, 400);
    assert.equal(result.calls.length, 0);
  } finally {
    await db.close();
  }
});

test("verification RPC is authenticated-admin only and exact-credential scoped", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.sellerpilot_read_coupang_cs_verification_v1(uuid,date,date,text,integer)','EXECUTE') allowed",
        [role],
      )).rows[0].allowed, false);
    }
    assert.equal((await db.query(
      "select has_function_privilege('authenticated','public.sellerpilot_read_coupang_cs_verification_v1(uuid,date,date,text,integer)','EXECUTE') allowed",
    )).rows[0].allowed, true);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query(
      "select public.sellerpilot_read_coupang_cs_verification_v1($1,'2024-02-01','2024-02-29','call-center',100)",
      [credential],
    ), /administrator access required/u);
  } finally {
    await db.close();
  }
});

test("web route rejects mismatched RPC scope and internally inconsistent counts", async () => {
  const db = await fixture();
  const url = `https://example.test/api/admin/cs/channels/coupang/verification?credentialId=${credential}&from=2024-02-01&to=2024-02-29&kind=call-center&limit=1`;
  const valid = {
    contract: "sellerpilot-coupang-cs-verification/1",
    credentialId: credential,
    kind: "call-center",
    fromDate: "2024-02-01",
    toDate: "2024-02-29",
    totalTickets: 1,
    displayedTickets: 1,
    tickets: [{
      externalTicketId: "call-center:3101",
      externalOrderReference: "9001",
      ticketKind: "conversation",
      status: "waiting",
      providerStatus: "waiting",
      receivedAt: "2024-02-10T00:00:00.000Z",
      messages: [],
    }],
  };
  try {
    for (const rpcData of [
      { ...valid, credentialId: "00000000-0000-4000-8000-000000003099" },
      { ...valid, kind: "product" },
      { ...valid, fromDate: "2024-02-02" },
      { ...valid, toDate: "2024-02-28" },
      { ...valid, displayedTickets: 0 },
      { ...valid, totalTickets: 0 },
      { ...valid, tickets: [{ ...valid.tickets[0], externalTicketId: "product:3101" }] },
    ]) {
      const result = await routeCall(db, url, { rpcData });
      assert.equal(result.response.status, 502);
      assert.equal(result.calls.length, 1);
    }
  } finally {
    await db.close();
  }
});
