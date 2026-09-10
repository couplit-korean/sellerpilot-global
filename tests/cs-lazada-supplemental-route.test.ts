import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/lazada/supplemental/route.ts",
  import.meta.url,
), "utf8");

function loadRoute(options: { rpcError?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module: moduleRecord,
    exports: moduleRecord.exports,
    Request,
    Response,
    URL,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({ userClient: { rpc: async (rpcName: string, args: Record<string, unknown>) => {
          calls.push({ name: rpcName, args });
          return options.rpcError ? { data: null, error: { message: "failed" } } : {
            data: { events: [], nextCursor: null }, error: null,
          };
        } } }),
        isAdminApiError: () => false,
      };
      if (name.endsWith("/supplemental-contract")) return {
        lazadaSupplementalSurfaceSchema: { safeParse: (value: unknown) => ({
          success: value === "product_review" || value === "reverse_order_after_sales",
          data: value,
        }) },
      };
      if (name.endsWith("/supplemental-web")) return {
        projectLazadaSupplementalReadRpc: (value: unknown) => ({
          contractVersion: "sellerpilot-lazada-supplemental-read-ui/1",
          readOnly: true, liveProviderRead: false, capabilities: [], ...(value as object),
        }),
      };
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(compiled, context);
  return { route: moduleRecord.exports as { GET(request: Request): Promise<Response> }, calls };
}

test("GET reads only the bounded local ledger RPC", async () => {
  const { route, calls } = loadRoute();
  const response = await route.GET(new Request(
    "https://sellerpilot.test/api/admin/cs/channels/lazada/supplemental?surface=product_review&limit=25",
  ));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    name: "sellerpilot_read_lazada_supplemental_cs_v1",
    args: {
      p_surface: "product_review",
      p_before_at: null,
      p_before_event_key: null,
      p_before_credential_id: null,
      p_before_country: null,
      p_limit: 25,
    },
  }]);
  assert.equal((await response.json()).liveProviderRead, false);
  assert.doesNotMatch(routeSource, /lazadaRequest|fetch\(|reply\/add|return\/update|cancel\/create/u);
});

test("invalid composite cursor is rejected before storage and RPC failures remain unavailable", async () => {
  const first = loadRoute();
  const invalid = await first.route.GET(new Request(
    "https://sellerpilot.test/api/admin/cs/channels/lazada/supplemental?beforeAt=2026-09-09T00:00:00Z",
  ));
  assert.equal(invalid.status, 400);
  assert.equal(first.calls.length, 0);
  const partialAccount = loadRoute();
  const partialAccountResponse = await partialAccount.route.GET(new Request(
    "https://sellerpilot.test/api/admin/cs/channels/lazada/supplemental?beforeAt=2026-09-09T00:00:00Z&beforeKey="
      + "a".repeat(64) + "&beforeCredentialId=00000000-0000-4000-8000-000000001223",
  ));
  assert.equal(partialAccountResponse.status, 400);
  assert.equal(partialAccount.calls.length, 0);
  const failed = loadRoute({ rpcError: true });
  const unavailable = await failed.route.GET(new Request(
    "https://sellerpilot.test/api/admin/cs/channels/lazada/supplemental",
  ));
  assert.equal(unavailable.status, 503);
});

test("GET forwards the exact four-field account cursor and keeps each read bounded", async () => {
  const { route, calls } = loadRoute();
  const eventKey = "b".repeat(64);
  const credentialId = "00000000-0000-4000-8000-000000001223";
  const response = await route.GET(new Request(
    "https://sellerpilot.test/api/admin/cs/channels/lazada/supplemental?limit=50"
      + `&beforeAt=${encodeURIComponent("2026-09-09T00:00:00.000Z")}`
      + `&beforeKey=${eventKey}&beforeCredentialId=${credentialId}&beforeCountry=MY`,
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    name: "sellerpilot_read_lazada_supplemental_cs_v1",
    args: {
      p_surface: null,
      p_before_at: "2026-09-09T00:00:00.000Z",
      p_before_event_key: eventKey,
      p_before_credential_id: credentialId,
      p_before_country: "MY",
      p_limit: 50,
    },
  }]);
});
