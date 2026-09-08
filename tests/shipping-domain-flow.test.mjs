import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return {
        shortCircuit: true,
        url: "data:text/javascript,export default {}",
      };
    return next(specifier, context);
  },
});
const contracts = await import("../lib/shipping/contracts.ts");
const catalog = await import("../lib/channels/catalog.ts");
const availability = await import("../lib/shipping/availability.ts");
const resource = await import("../lib/shipping/write-resource.ts");
const gateway = await import("../lib/shipping/gateway.ts");
const runtime = await import("../lib/channels/gateway-job-runtime.ts");
const { executeShippingProviderJob } = await import(
  "../lib/shipping/provider.ts"
);
const { completeShippingClaim } = await import("../lib/shipping/complete.ts");
const { processShippingGatewayJob } = await import(
  "../scripts/shipping-gateway-job.mjs"
);
const { auditDomains, isProduct, isShipping } = await import(
  "../scripts/audit-business-domain-boundaries.mjs"
);
const { buildGraph, pathsToForbidden, isCs } = await import(
  "../scripts/audit-cs-commerce-boundaries.mjs"
);
const id = "71000000-0000-4000-8000-000000000001",
  credentialId = "72000000-0000-4000-8000-000000000001",
  orderId = "73000000-0000-4000-8000-000000000001",
  claimToken = "74000000-0000-4000-8000-000000000001";
const result = {
  ok: true,
  channel: "qoo10",
  operation: "shipment.confirm",
  steps: [
    { name: "SetSendingInfo", ok: true, status: 200, data: { ResultCode: 0 } },
  ],
  safeMessage: "fixture",
};
function loadApi(options = {}) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    switch (name) {
      case "sellerpilot_list_credentials":
        return {
          data: [
            {
              id: credentialId,
              channel: "qoo10",
              status: "active",
              environment: "production",
            },
          ],
          error: null,
        };
      case "sellerpilot_claim_channel_operation":
        return {
          data: {
            attempt_id: id,
            duplicate: options.duplicate ?? false,
            status: "succeeded",
          },
          error: null,
        };
      case "sellerpilot_service_enqueue_resource_gateway_job":
        return {
          data: {
            job_id: id,
            attempt_id: id,
            status: options.pending ? "in_progress" : "queued",
          },
          error: null,
        };
      case "sellerpilot_enqueue_channel_gateway_job":
        return { data: id, error: null };
      case "sellerpilot_get_channel_gateway_job":
        return { data: { status: "succeeded", response: result }, error: null };
      case "sellerpilot_get_shipping_attempt_result":
        return { data: { status: "succeeded", response: result }, error: null };
      default:
        throw new Error(`Unexpected RPC: ${name}`);
    }
  };
  const exports = {};
  const compiled = ts.transpileModule(
    readFileSync(
      new URL("../app/api/admin/shipping/operations/route.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(compiled, {
    exports,
    Request,
    Response,
    URL,
    process,
    require(name) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return { z };
      if (name === "node:crypto") return { createHash };
      if (name.endsWith("/admin-api"))
        return {
          authenticateAdminRequest: async () => ({
            userClient: { rpc },
            serviceClient: { rpc },
          }),
          isAdminApiError: () => false,
        };
      for (const [suffix, value] of Object.entries({
        "/channels/catalog": catalog,
        "/shipping/contracts": contracts,
        "/shipping/availability": availability,
        "/shipping/write-resource": resource,
        "/shipping/gateway": gateway,
        "/channels/gateway-job-runtime": runtime,
      }))
        if (name.endsWith(suffix)) return value;
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { api: exports, calls };
}
function request(overrides = {}) {
  return new Request("https://fixture.invalid/api/admin/shipping/operations", {
    method: "POST",
    body: JSON.stringify({
      credentialId,
      channel: "qoo10",
      operation: "shipment.confirm",
      idempotencyKey: "shipment-fixture",
      confirmWrite: true,
      orderId,
      shipmentCarrier: "CJ",
      shipmentTracking: "TRACK1",
      arguments: { params: { OrderNo: "REMOTE1" } },
      ...overrides,
    }),
  });
}
test("actual shipping API and gateway use the order resource transaction, with no product binding", async () => {
  const { api, calls } = loadApi();
  const response = await api.POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  const write = calls.find(
    (x) => x.name === "sellerpilot_service_enqueue_resource_gateway_job",
  ).args;
  assert.equal(write.p_resource_kind, "order_shipment");
  assert.equal(write.p_order_id, orderId);
  assert.equal(write.p_listing_id, null);
  assert.equal(write.p_inventory_item_id, null);
  assert.equal(write.p_shipment_tracking, "TRACK1");
  assert.equal(
    write.p_resource_key,
    createHash("sha256")
      .update(`qoo10\0order_shipment\0${orderId}`)
      .digest("hex"),
  );
  assert.deepEqual(
    calls.map((x) => x.name),
    [
      "sellerpilot_list_credentials",
      "sellerpilot_claim_channel_operation",
      "sellerpilot_service_enqueue_resource_gateway_job",
      "sellerpilot_get_channel_gateway_job",
    ],
  );
});
test("shipping API rejects product/CS requests and unconfirmed shipping before enqueue", async () => {
  for (const operation of ["listing.create", "inquiries.reply"]) {
    const { api, calls } = loadApi();
    assert.equal((await api.POST(request({ operation }))).status, 400);
    assert.equal(calls.length, 0);
  }
  const { api, calls } = loadApi();
  assert.equal((await api.POST(request({ confirmWrite: false }))).status, 428);
  assert.equal(calls.length, 0);
});
test("pending and duplicate shipping receipts never create a second provider job", async () => {
  const pending = loadApi({ pending: true });
  const response = await pending.api.POST(request());
  assert.equal(response.status, 202);
  assert.equal((await response.json()).inProgress, true);
  const replay = loadApi({ duplicate: true });
  const receipt = await replay.api.POST(request());
  assert.equal(receipt.status, 200);
  assert.deepEqual((await receipt.json()).steps, result.steps);
  assert.equal(replay.calls.filter((c) => /enqueue/.test(c.name)).length, 0);
});
test("shipping provider rejects both other domains before lease or transport", async () => {
  for (const operation of ["listing.create", "inquiries.list"])
    await assert.rejects(
      executeShippingProviderJob(
        {
          job: { channel: "qoo10", operation },
          signal: new AbortController().signal,
          hooks: {},
        },
        async () => {
          throw new Error("executor must not run");
        },
      ),
      /SHIPPING_OPERATION_NOT_ALLOWED/,
    );
});
test("shipping completion preserves the stable normalization boundary and strips raw order content", async () => {
  const calls = [];
  const job = {
    id,
    claim_token: claimToken,
    credential_id: credentialId,
    channel: "qoo10",
    operation: "orders.list",
    request: {},
    credential: {},
    environment: "production",
    attempt_count: 1,
  };
  const status = await completeShippingClaim(
    {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return {
          data: name.endsWith("completion_context")
            ? {
                status: "running",
                channel: "qoo10",
                operation: "orders.list",
                normalization_timestamp: "2026-09-08T00:00:00Z",
              }
            : { status: "completed" },
          error: null,
        };
      },
    },
    "fixture",
    job,
    {
      status: "succeeded",
      result: {
        ok: true,
        channel: "qoo10",
        operation: "orders.list",
        steps: [
          {
            name: "GetShippingInfo_v3",
            ok: true,
            status: 200,
            data: { ResultCode: 0, ResultObject: [] },
          },
        ],
        safeMessage: "fixture",
      },
    },
  );
  assert.equal(status, "completed");
  const args = calls.at(-1).args;
  assert.deepEqual(args.p_normalized_orders, []);
  assert.equal(args.p_normalized_inquiries, null);
  assert.equal(args.p_diagnostic, null);
  assert.equal(
    args.p_response_payload.steps[0].data.sellerpilotMarker,
    "normalized_orders_v1",
  );
});
test("local shipping worker preserves uncertain mutation and lease ownership without retrying provider", async () => {
  const calls = [];
  let executions = 0;
  await processShippingGatewayJob(
    {
      id,
      claim_token: claimToken,
      channel: "qoo10",
      operation: "shipment.confirm",
    },
    {
      createGatewayHeartbeat: () => ({
        start: async () => {},
        assertHealthy: async () => {},
        stop: async () => {},
      }),
      persistWorkerCompletion: async (path, payload) => {
        calls.push({ path, payload });
      },
      executeProvider: async ({ hooks }) => {
        executions++;
        await hooks.beginProviderMutation();
        throw new Error("transport uncertainty");
      },
    },
  );
  assert.equal(executions, 1);
  assert.equal(calls.at(-1).payload.status, "reconciliation_required");
  assert.equal(calls[0].path, "/api/channel-gateway/worker/begin-mutation");
});
test("three business domains have zero transitive imports in every direction and independent page roots", () => {
  const graph = buildGraph();
  assert.ok(
    Object.values(auditDomains(graph)).every((paths) => paths.length === 0),
  );
  assert.deepEqual(
    pathsToForbidden(
      graph,
      ["app/shipping/page.tsx"],
      (file) => isCs(file) || isProduct(file) || file === "app/page.tsx",
    ),
    [],
  );
  assert.deepEqual(
    pathsToForbidden(
      graph,
      ["app/cs/page.tsx"],
      (file) => isShipping(file) || isProduct(file) || file === "app/page.tsx",
    ),
    [],
  );
});
