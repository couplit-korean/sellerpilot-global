import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/lazada/supplemental/sync/route.ts", import.meta.url,
), "utf8");
const credentialId = "00000000-0000-4000-8000-000000008201";

function loadRoute(options: { permissionDenied?: boolean } = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const serviceInputs: unknown[] = [];
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
    TextEncoder,
    JSON,
    Error,
    require: (name: string) => {
      if (name === "next/server") {
        return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      }
      if (name.endsWith("/admin-api")) {
        return {
          authenticateAdminRequest: async () => ({
            serviceClient: {
              rpc: async (rpcName: string, args: Record<string, unknown>) => {
                rpcCalls.push({ name: rpcName, args });
                return { data: { rpcName }, error: null };
              },
            },
          }),
          isAdminApiError: () => false,
        };
      }
      if (name.endsWith("/supplemental-provider-ingest")) {
        return {
          lazadaSupplementalProviderSyncRequestSchema: {
            safeParse: (value: unknown) => {
              const row = value && typeof value === "object" && !Array.isArray(value)
                ? value as Record<string, unknown> : {};
              const allowed = new Set(["credentialId", "country", "sourcePath", "resourceId", "pageSize"]);
              const valid = Object.keys(row).every((key) => allowed.has(key))
                && row.credentialId === credentialId && row.country === "MY"
                && row.sourcePath === "/review/seller/list" && row.resourceId === "1001";
              return valid ? { success: true, data: row } : { success: false };
            },
          },
          ingestLazadaSupplementalProviderPage: async (input: unknown, dependencies: {
            prepare(value: unknown): Promise<unknown>;
            readCredential(value: string): Promise<unknown>;
            ingestAndAcknowledge(value: unknown): Promise<unknown>;
          }) => {
            serviceInputs.push(input);
            if (options.permissionDenied) throw new Error("LAZADA_SUPPLEMENTAL_PERMISSION_REQUIRED");
            await dependencies.prepare(input);
            await dependencies.readCredential(credentialId);
            await dependencies.ingestAndAcknowledge({
              continuationId: "00000000-0000-4000-8000-000000008202",
              expectedRevision: 0,
              credentialId,
              country: "MY",
              surface: "product_review",
              sourcePath: "/review/seller/list",
              resourceId: "1001",
              pageNumber: 1,
              pageSize: 20,
              rows: [],
              pagination: { hasMore: false },
            });
            return { contractVersion: "sellerpilot-lazada-supplemental-page-ingest/1", complete: true };
          },
        };
      }
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(compiled, context);
  return {
    route: moduleRecord.exports as { POST(request: Request): Promise<Response> },
    rpcCalls,
    serviceInputs,
  };
}

function request(body: Record<string, unknown>) {
  const text = JSON.stringify(body);
  return new Request("https://sellerpilot.test/api/admin/cs/channels/lazada/supplemental/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(text.length) },
    body: text,
  });
}

test("admin POST wires prepare, vault read and atomic acknowledge without a grant-writing RPC", async () => {
  const loaded = loadRoute();
  const response = await loaded.route.POST(request({
    credentialId, country: "MY", sourcePath: "/review/seller/list", resourceId: "1001", pageSize: 20,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(loaded.rpcCalls.map((call) => call.name), [
    "sellerpilot_service_prepare_lazada_supplemental_read_v1",
    "sellerpilot_decrypt_credential",
    "sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1",
  ]);
  assert.equal(loaded.rpcCalls.some((call) => call.name.includes("record_lazada_supplemental_read_grant")), false);
  assert.equal(loaded.serviceInputs.length, 1);
});

test("admin POST rejects caller grant injection and maps server permission denial without RPC mutation", async () => {
  const injected = loadRoute();
  const rejected = await injected.route.POST(request({
    credentialId, country: "MY", sourcePath: "/review/seller/list", resourceId: "1001", granted: true,
  }));
  assert.equal(rejected.status, 400);
  assert.equal(injected.serviceInputs.length, 0);
  assert.equal(injected.rpcCalls.length, 0);

  const denied = loadRoute({ permissionDenied: true });
  const forbidden = await denied.route.POST(request({
    credentialId, country: "MY", sourcePath: "/review/seller/list", resourceId: "1001",
  }));
  assert.equal(forbidden.status, 403);
  assert.equal(denied.rpcCalls.length, 0);
});
