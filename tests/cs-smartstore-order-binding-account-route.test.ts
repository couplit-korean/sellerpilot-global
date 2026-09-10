import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const routePath = new URL(
  "../app/api/admin/cs/order-bindings/route.ts",
  import.meta.url,
);

test("SmartStore order-binding route aggregates two credential-scoped v3 reads", async () => {
  const source = await readFile(routePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "app/api/admin/cs/order-bindings/route.ts",
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);

  const credentialA = "00000000-0000-4000-8000-000000000801";
  const credentialB = "00000000-0000-4000-8000-000000000802";
  const calls: Array<{ name: string; args?: unknown }> = [];
  const exportsObject: Record<string, unknown> = {};
  const admin = {
    userClient: {
      rpc: async (name: string, args?: unknown) => {
        calls.push({ name, args });
        if (name === "sellerpilot_list_credentials") {
          return {
            data: [
              { id: credentialA, channel: "smartstore", environment: "production", status: "active" },
              { id: credentialB, channel: "smartstore", environment: "production", status: "active" },
            ],
            error: null,
          };
        }
        if (name === "sellerpilot_read_cs_order_binding_health_v1") {
          return {
            data: {
              contract: "sellerpilot-cs-order-binding-health/1",
              checkedAt: "2026-09-09T01:00:00.000Z",
              matchingRule: "same_owner_channel_exact_external_order_and_credential",
              csCommerceMutationAllowed: false,
              groups: [{ channel: "qoo10", status: "exact", count: 1 }],
            },
            error: null,
          };
        }
        if (name === "sellerpilot_read_smartstore_cs_order_binding_health_v3") {
          const credentialId = (args as { p_credential_id: string }).p_credential_id;
          return {
            data: {
              contract: "sellerpilot-cs-smartstore-order-binding-health/3",
              checkedAt: credentialId === credentialA
                ? "2026-09-09T01:01:00.000Z"
                : "2026-09-09T01:02:00.000Z",
              credentialId,
              accountScope: credentialId === credentialA ? "a".repeat(64) : "b".repeat(64),
              projectionContract: "smartstore-cs-order-binding-projection/1",
              matchingRule: "same_owner_account_source_credential_exact_product_order",
              automaticOrderLinkState: "exact",
              csCommerceMutationAllowed: false,
              groups: credentialId === credentialA
                ? [{ channel: "smartstore", status: "exact", count: 1 }]
                : [{ channel: "smartstore", status: "unmatched", count: 2 }],
            },
            error: null,
          };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    },
  };
  const sandbox = vm.createContext({
    exports: exportsObject,
    Request,
    Response,
    Map,
    Promise,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return { z };
      if (name.endsWith("/admin-api")) {
        return {
          authenticateAdminRequest: async () => admin,
          isAdminApiError: () => false,
        };
      }
      if (name.endsWith("/cs/order-binding-health")) {
        return {
          csOrderBindingHealthV1Schema: z.object({
            contract: z.literal("sellerpilot-cs-order-binding-health/1"),
            checkedAt: z.string(),
            groups: z.array(z.object({
              channel: z.string(), status: z.string(), count: z.number(),
            }).passthrough()),
          }).passthrough(),
          smartstoreOrderBindingHealthV3Schema: z.object({
            contract: z.literal("sellerpilot-cs-smartstore-order-binding-health/3"),
            checkedAt: z.string(),
            credentialId: z.string(),
            groups: z.array(z.object({
              channel: z.literal("smartstore"), status: z.string(), count: z.number(),
            }).passthrough()),
          }).passthrough(),
          csOrderBindingHealthSchema: z.object({
            contract: z.literal("sellerpilot-cs-order-binding-health/2"),
            checkedAt: z.string(),
            groups: z.array(z.object({
              channel: z.string(), status: z.string(), count: z.number(),
            }).passthrough()),
          }).passthrough(),
        };
      }
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(compiled.outputText, sandbox);
  const response = await (exportsObject.GET as (request: Request) => Promise<Response>)(
    new Request("https://sellerpilot.test/api/admin/cs/order-bindings"),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.groups, [
    { channel: "qoo10", status: "exact", count: 1 },
    { channel: "smartstore", status: "exact", count: 1 },
    { channel: "smartstore", status: "unmatched", count: 2 },
  ]);
  assert.equal(body.checkedAt, "2026-09-09T01:02:00.000Z");
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls
      .filter((call) => call.name === "sellerpilot_read_smartstore_cs_order_binding_health_v3")
      .map((call) => call.args))),
    [{ p_credential_id: credentialA }, { p_credential_id: credentialB }],
  );
  assert.equal(calls.some((call) =>
    call.name === "sellerpilot_read_smartstore_cs_order_binding_health_v2"), false);
});

async function callOrderBindingRoute({
  credentialIds,
  mismatchedCredentialId,
  trackConcurrency = false,
}: {
  credentialIds: string[];
  mismatchedCredentialId?: string;
  trackConcurrency?: boolean;
}) {
  const source = await readFile(routePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let active = 0;
  let maximumActive = 0;
  const exportsObject: Record<string, unknown> = {};
  const admin = { userClient: { rpc: async (name: string, args?: unknown) => {
    if (name === "sellerpilot_list_credentials") return {
      data: credentialIds.map(id => ({ id, channel: "smartstore", environment: "production", status: "active" })),
      error: null,
    };
    if (name === "sellerpilot_read_cs_order_binding_health_v1") return { data: {
      contract: "sellerpilot-cs-order-binding-health/1",
      checkedAt: "2026-09-09T01:00:00.000Z",
      matchingRule: "same_owner_channel_exact_external_order_and_credential",
      csCommerceMutationAllowed: false,
      groups: [
        { channel: "qoo10", status: "exact", count: 2 },
        { channel: "smartstore", status: "legacy", count: 99 },
      ],
    }, error: null };
    if (name === "sellerpilot_read_smartstore_cs_order_binding_health_v3") {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (trackConcurrency) await new Promise(resolve => setImmediate(resolve));
      active -= 1;
      const requested = (args as { p_credential_id: string }).p_credential_id;
      return { data: {
        contract: "sellerpilot-cs-smartstore-order-binding-health/3",
        checkedAt: "2026-09-09T01:01:00.000Z",
        credentialId: mismatchedCredentialId ?? requested,
        groups: [{ channel: "smartstore", status: "exact", count: 1 }],
      }, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  } } };
  const schemaModule = {
    csOrderBindingHealthV1Schema: z.object({
      contract: z.literal("sellerpilot-cs-order-binding-health/1"), checkedAt: z.string(),
      groups: z.array(z.object({ channel: z.string(), status: z.string(), count: z.number() }).passthrough()),
    }).passthrough(),
    smartstoreOrderBindingHealthV3Schema: z.object({
      contract: z.literal("sellerpilot-cs-smartstore-order-binding-health/3"), checkedAt: z.string(),
      credentialId: z.string(),
      groups: z.array(z.object({ channel: z.literal("smartstore"), status: z.string(), count: z.number() }).passthrough()),
    }).passthrough(),
    csOrderBindingHealthSchema: z.object({
      contract: z.literal("sellerpilot-cs-order-binding-health/2"), checkedAt: z.string(),
      groups: z.array(z.object({ channel: z.string(), status: z.string(), count: z.number() }).passthrough()),
    }).passthrough(),
  };
  const sandbox = vm.createContext({
    exports: exportsObject, Request, Response, Map, Promise, Array, setImmediate,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => admin, isAdminApiError: () => false,
      };
      if (name.endsWith("/cs/order-binding-health")) return schemaModule;
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(compiled, sandbox);
  const response = await (exportsObject.GET as (request: Request) => Promise<Response>)(
    new Request("https://sellerpilot.test/api/admin/cs/order-bindings"),
  );
  return { response, maximumActive };
}

test("zero SmartStore credentials preserves every non-SmartStore legacy group", async () => {
  const { response } = await callOrderBindingRoute({ credentialIds: [] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).groups, [
    { channel: "qoo10", status: "exact", count: 2 },
  ]);
});

test("scoped result must echo the requested credential and fanout stays bounded", async () => {
  const credentialIds = Array.from({ length: 9 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const bounded = await callOrderBindingRoute({ credentialIds, trackConcurrency: true });
  assert.equal(bounded.response.status, 200);
  assert.equal(bounded.maximumActive, 4);

  const mismatch = await callOrderBindingRoute({
    credentialIds: credentialIds.slice(0, 2),
    mismatchedCredentialId: "00000000-0000-4000-8000-999999999999",
  });
  assert.equal(mismatch.response.status, 502);
});
