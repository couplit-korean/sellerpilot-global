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
  "../tests/fixtures/cs/coupang/db-web-fixture.sql",
  import.meta.url,
), "utf8");
const baseRpcSql = await readFile(new URL(
  "../supabase/migrations/20260908141314_cs_coupang_authenticated_web_verification.sql",
  import.meta.url,
), "utf8");
const migrationProposal = await readFile(new URL(
  "../supabase/migrations/20260909105117_cs_coupang_verification_legacy_namespaces.sql",
  import.meta.url,
), "utf8");

const owner = "00000000-0000-4000-8000-000000003001";
const credential = "00000000-0000-4000-8000-000000003011";

async function routeCall(db: PGlite, kind: string) {
  const sandbox = vm.createContext({
    exports: {}, Request, Response, URL,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/cs/channels/coupang/verification")) return contract;
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({
          userClient: {
            rpc: async (rpcName: string, args: Record<string, unknown>) => {
              assert.equal(rpcName, "sellerpilot_read_coupang_cs_verification_v1");
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
        }),
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      throw new Error(`unexpected module ${name}`);
    },
  });
  vm.runInContext(compiledRoute, sandbox);
  const request = new Request(
    `https://example.test/api/admin/cs/channels/coupang/verification?credentialId=${credential}&from=2024-02-01&to=2024-02-29&kind=${kind}`,
  );
  return (sandbox.exports as { GET(request: Request): Promise<Response> }).GET(request);
}

test("new migration and D001 contract return legacy after-sales IDs through the authenticated route", async () => {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql);
    await db.exec(baseRpcSql);
    await db.exec(`insert into sellerpilot_private.support_tickets values
      ('00000000-0000-4000-8000-000000003041','${owner}','${credential}','coupang',
       'coupang:return:7101','9101','after_sales','waiting','waiting','2024-02-12T00:00:00Z','{}',false),
      ('00000000-0000-4000-8000-000000003042','${owner}','${credential}','coupang',
       'return_request:7102','9102','after_sales','waiting','waiting','2024-02-13T00:00:00Z','{}',false),
      ('00000000-0000-4000-8000-000000003043','${owner}','${credential}','coupang',
       'coupang:cancel:7201','9201','after_sales','waiting','waiting','2024-02-14T00:00:00Z','{}',false),
      ('00000000-0000-4000-8000-000000003044','${owner}','${credential}','coupang',
       'coupang:exchange:7301','9301','after_sales','waiting','waiting','2024-02-15T00:00:00Z','{}',false),
      ('00000000-0000-4000-8000-000000003045','00000000-0000-4000-8000-000000003002',
       '00000000-0000-4000-8000-000000003012','coupang','coupang:return:7999','9999',
       'after_sales','waiting','waiting','2024-02-12T00:00:00Z','{}',false)`);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    const before = await db.query(
      "select public.sellerpilot_read_coupang_cs_verification_v1($1,'2024-02-01','2024-02-29','return_request',100) result",
      [credential],
    );
    assert.equal((before.rows[0]?.result as { totalTickets: number }).totalTickets, 1,
      "the old RPC sees only the public namespace and drops the stored legacy row");

    await db.exec("reset role");
    await db.exec(migrationProposal);
    await db.exec("set role authenticated");
    const expected = new Map([
      ["return_request", ["coupang:return:7101", "return_request:7102"]],
      ["cancel_request", ["coupang:cancel:7201"]],
      ["exchange_request", ["coupang:exchange:7301"]],
    ]);
    for (const [kind, expectedIds] of expected) {
      const response = await routeCall(db, kind);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.kind, kind);
      assert.equal(body.totalTickets, expectedIds.length);
      assert.deepEqual(
        body.tickets.map((ticket: { externalTicketId: string }) => ticket.externalTicketId).sort(),
        [...expectedIds].sort(),
      );
    }
  } finally {
    await db.close();
  }
});

test("new migration rejects wrong-kind namespace widening and keeps the RPC ACL", async () => {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql);
    await db.exec(baseRpcSql);
    await db.exec(migrationProposal);
    await db.exec(`insert into sellerpilot_private.support_tickets values
      ('00000000-0000-4000-8000-000000003051','${owner}','${credential}','coupang',
       'coupang:returning:8101','9101','after_sales','waiting','waiting','2024-02-12T00:00:00Z','{}',false),
      ('00000000-0000-4000-8000-000000003052','${owner}','${credential}','coupang',
       'coupang:cancel:8201','9201','after_sales','waiting','waiting','2024-02-13T00:00:00Z','{}',false)`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");

    const response = await routeCall(db, "return_request");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.totalTickets, 0);
    assert.deepEqual(body.tickets, []);
    assert.equal((await db.query(`select
      has_function_privilege('authenticated',
        'public.sellerpilot_read_coupang_cs_verification_v1(uuid,date,date,text,integer)','EXECUTE') allowed`)).rows[0].allowed, true);
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(`select has_function_privilege($1,
        'public.sellerpilot_read_coupang_cs_verification_v1(uuid,date,date,text,integer)','EXECUTE') allowed`,
      [role])).rows[0].allowed, false);
    }
  } finally {
    await db.close();
  }
});
