import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as contract from "../lib/cs/import-staging";
import * as previewContract from "../lib/cs/import-preview";
import { activeChannelKeys } from "../lib/channels/catalog";

const source = await readFile(new URL("../app/api/admin/cs/import/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const batchId = "00000000-0000-4000-8000-000000001001";
const credentialId = "00000000-0000-4000-8000-000000001002";
const sourceDigest = "b".repeat(64);
const accountKey = "a".repeat(64);

type RpcResult = { data: unknown; error: unknown };

function routeModule(options: {
  denied?: boolean;
  rpc?: (name: string, args: Record<string, unknown>) => Promise<RpcResult> | RpcResult;
} = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const sandbox = vm.createContext({
    exports: {}, Request, Response, URL, TextEncoder,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return { z };
      if (name.endsWith("/cs/import-staging")) return contract;
      if (name.endsWith("/cs/import-preview")) return previewContract;
      if (name.endsWith("/cs/import-limits")) return { csImportMaxRows: 100_000 };
      if (name.endsWith("/channels/catalog")) return { activeChannelKeys };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => options.denied
          ? Response.json({ message: "denied" }, { status: 401 })
          : {
            userClient: {
              rpc: async (rpcName: string, args: Record<string, unknown>) => {
                calls.push({ name: rpcName, args });
                return options.rpc?.(rpcName, args) ?? { data: null, error: null };
              },
            },
            serviceClient: { rpc: () => { throw new Error("must not use service client"); } },
          },
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      throw new Error(`unexpected module ${name}`);
    },
  });
  vm.runInContext(compiled, sandbox);
  return { exports: sandbox.exports as Record<string, (request: Request) => Promise<Response>>, calls };
}

function beginBody() {
  return {
    action: "begin",
    credentialId,
    channel: "qoo10",
    sourceName: "history.json",
    sourceDigest,
    sourceAccountKey: accountKey,
    declaredRowCount: 3,
  };
}

function normalizedRecord(sourceRecordId = "message-1") {
  return {
    sourceRecordId,
    customerName: "synthetic",
    subject: "test",
    message: "test",
    status: "waiting",
    receivedAt: "2026-09-08T00:00:00Z",
  };
}

test("import requires authentication before reading or touching a batch", async () => {
  const route = routeModule({ denied: true });
  const response = await route.exports.POST(new Request("https://example.test/api/admin/cs/import", {
    method: "POST", body: "not json",
  }));
  assert.equal(response.status, 401);
  assert.equal(route.calls.length, 0);
});

for (const status of ["cancelled", "committed", "committing"] as const) {
  test(`begin preserves a ${status} durable batch without staging rows`, async () => {
    const route = routeModule({ rpc: (name) => ({
      data: name === "sellerpilot_begin_cs_import_v1" ? {
        batchId, status, stagedRowCount: 3, declaredRowCount: 3, nextRowNumber: null, reused: true,
      } : null,
      error: null,
    }) });
    const response = await route.exports.POST(new Request("https://example.test/api/admin/cs/import", {
      method: "POST", body: JSON.stringify(beginBody()),
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, status);
    assert.deepEqual(route.calls.map(call => call.name), ["sellerpilot_begin_cs_import_v1"]);
  });
}

test("begin returns the first missing durable row and rejects unknown database state", async () => {
  const valid = routeModule({ rpc: () => ({ data: {
    batchId, status: "staging", stagedRowCount: 1, declaredRowCount: 3, nextRowNumber: 2, reused: true,
  }, error: null }) });
  const response = await valid.exports.POST(new Request("https://example.test/api/admin/cs/import", {
    method: "POST", body: JSON.stringify(beginBody()),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).nextRowNumber, 2);

  const invalid = routeModule({ rpc: () => ({ data: {
    batchId, status: "unknown", stagedRowCount: 0, declaredRowCount: 3, nextRowNumber: 1, reused: false,
  }, error: null }) });
  const invalidResponse = await invalid.exports.POST(new Request("https://example.test/api/admin/cs/import", {
    method: "POST", body: JSON.stringify(beginBody()),
  }));
  assert.equal(invalidResponse.status, 502);
});

test("one upload chunk is server-normalized and bound to the exact batch source digest", async () => {
  const route = routeModule({ rpc: (name) => ({
    data: name === "sellerpilot_stage_cs_import_rows_v1" ? {
      batchId, status: "preview_ready", stagedRowCount: 3, declaredRowCount: 3, nextRowNumber: null,
    } : null,
    error: null,
  }) });
  const response = await route.exports.POST(new Request("https://example.test/api/admin/cs/import", {
    method: "POST",
    body: JSON.stringify({
      action: "stage", batchId, sourceDigest, startRowNumber: 2,
      records: [normalizedRecord("message-2"), normalizedRecord("message-3")],
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "preview_ready");
  const stage = route.calls.find(call => call.name === "sellerpilot_stage_cs_import_rows_v1");
  assert.ok(stage);
  assert.equal(stage.args.p_expected_source_digest, sourceDigest);
  assert.deepEqual((stage.args.p_rows as Array<{ rowNumber: number }>).map(row => row.rowNumber), [2, 3]);
  assert.ok((stage.args.p_rows as Array<{ rowDigest: string }>).every(row => /^[a-f0-9]{64}$/u.test(row.rowDigest)));
});

test("an inconsistent stage receipt cannot claim preview readiness", async () => {
  const route = routeModule({ rpc: () => ({ data: {
    batchId, status: "preview_ready", stagedRowCount: 2, declaredRowCount: 3, nextRowNumber: null,
  }, error: null }) });
  const response = await route.exports.POST(new Request("https://example.test/api/admin/cs/import", {
    method: "POST",
    body: JSON.stringify({ action: "stage", batchId, sourceDigest, startRowNumber: 3, records: [normalizedRecord("message-3")] }),
  }));
  assert.equal(response.status, 502);
});

test("oversized upload chunks are rejected before database access", async () => {
  const route = routeModule();
  const response = await route.exports.POST(new Request("https://example.test/api/admin/cs/import", {
    method: "POST",
    headers: { "content-length": "1250001" },
    body: JSON.stringify(beginBody()),
  }));
  assert.equal(response.status, 413);
  assert.equal(route.calls.length, 0);
  const streamed = routeModule();
  const streamedResponse = await streamed.exports.POST(new Request("https://example.test/api/admin/cs/import", {
    method: "POST",
    body: JSON.stringify({ ...beginBody(), unexpected: "x".repeat(1_250_000) }),
  }));
  assert.equal(streamedResponse.status, 413);
  assert.equal(streamed.calls.length, 0);
});

test("commit progress stays resumable and terminal receipts are validated", async () => {
  const route = routeModule({ rpc: () => ({ data: {
    contract: "sellerpilot-cs-import/1", batchId, status: "committing",
    importedRowCount: 500, duplicateRowCount: 0, remainingRowCount: 500, processedThisCall: 500,
  }, error: null }) });
  const response = await route.exports.PATCH(new Request("https://example.test/api/admin/cs/import", {
    method: "PATCH", body: JSON.stringify({ batchId, action: "commit" }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "committing");

  const inconsistent = routeModule({ rpc: () => ({ data: {
    contract: "sellerpilot-cs-import/1", batchId, status: "committed",
    importedRowCount: 500, duplicateRowCount: 0, remainingRowCount: 1,
  }, error: null }) });
  const invalid = await inconsistent.exports.PATCH(new Request("https://example.test/api/admin/cs/import", {
    method: "PATCH", body: JSON.stringify({ batchId, action: "commit" }),
  }));
  assert.equal(invalid.status, 502);
});

test("preview GET validates its query before calling the database", async () => {
  const route = routeModule();
  const response = await route.exports.GET(new Request("https://example.test/api/admin/cs/import?batchId=bad"));
  assert.equal(response.status, 400);
  assert.equal(route.calls.length, 0);
});

test("preview GET returns only a validated no-store database page", async () => {
  const data = {
    contract: "sellerpilot-cs-import-preview/1", batchId, status: "preview_ready",
    stagedRowCount: 1, declaredRowCount: 1,
    rows: [{
      rowNumber: 1, validation: "valid", outcome: "new_ticket", customerName: "buyer",
      subject: "question", messagePreview: "where", status: "waiting",
      receivedAt: "2026-09-08T00:00:00Z", externalOrderReference: null, providerRecordId: null,
    }],
    nextAfterRowNumber: null,
  };
  const route = routeModule({ rpc: () => ({ data, error: null }) });
  const response = await route.exports.GET(new Request(`https://example.test/api/admin/cs/import?batchId=${batchId}&afterRowNumber=0&limit=25`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(route.calls[0].name, "sellerpilot_get_cs_import_preview_v1");
  assert.equal(route.calls[0].args.p_limit, 25);
});
