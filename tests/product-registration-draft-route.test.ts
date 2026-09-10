import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as draftContract from "../lib/product-registration-draft";

const source = await readFile(
  new URL("../app/api/admin/product-registration-drafts/route.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const DRAFT_ID = "20000000-0000-4000-8000-000000000001";
const SECRET = "PRIVATE_DATABASE_MESSAGE_MUST_NOT_ESCAPE";

type RpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

type RouteExports = {
  GET(request: Request): Promise<Response>;
  PUT(request: Request): Promise<Response>;
};

function storedDraft(version = 1) {
  return {
    draftId: DRAFT_ID,
    kind: "intake",
    productId: null,
    version,
    data: { common: {}, images: [] },
    updatedAt: "2026-09-07T02:30:00+00:00",
  };
}

async function run(input: {
  method: "GET" | "PUT";
  url?: string;
  body?: unknown;
  result?: RpcResult;
  reject?: boolean;
}) {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const serviceClient = {
    async rpc(name: string, parameters: Record<string, unknown>) {
      calls.push({ name, parameters });
      if (input.reject) throw new Error(SECRET);
      return input.result ?? { data: storedDraft(), error: null };
    },
  };
  const sandbox = vm.createContext({
    exports: {},
    Request,
    Response,
    URL,
    TextEncoder,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) {
        return {
          authenticateAdminRequest: async () => ({
            user: { id: OWNER_ID },
            serviceClient,
          }),
          isAdminApiError: () => false,
        };
      }
      if (name.endsWith("/product-registration-draft")) return draftContract;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  vm.runInContext(compiled, sandbox);
  const routes = sandbox.exports as RouteExports;
  const url = input.url
    ?? `https://example.invalid/api/admin/product-registration-drafts?draftId=${DRAFT_ID}&kind=intake`;
  const request = new Request(url, input.method === "PUT" ? {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
  } : undefined);
  const response = await routes[input.method](request);
  return {
    response,
    body: await response.json() as Record<string, unknown>,
    calls,
  };
}

test("GET fixes the authenticated owner in the RPC and returns a no-store draft", async () => {
  const result = await run({ method: "GET" });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(result.body.draft, storedDraft());
  assert.deepEqual(JSON.parse(JSON.stringify(result.calls)), [{
    name: draftContract.PRODUCT_REGISTRATION_DRAFT_GET_RPC,
    parameters: {
      p_owner_id: OWNER_ID,
      p_draft_id: DRAFT_ID,
      p_kind: "intake",
    },
  }]);
});

test("PUT passes exact CAS data and represents an unattached product as null", async () => {
  const result = await run({
    method: "PUT",
    body: {
      draftId: DRAFT_ID,
      kind: "intake",
      expectedVersion: 0,
      data: { common: {}, images: [] },
    },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(result.calls)), [{
    name: draftContract.PRODUCT_REGISTRATION_DRAFT_PUT_RPC,
    parameters: {
      p_owner_id: OWNER_ID,
      p_draft_id: DRAFT_ID,
      p_kind: "intake",
      p_product_id: null,
      p_expected_version: 0,
      p_data: { common: {}, images: [] },
    },
  }]);
});

test("route maps migration absence and CAS conflict to stable client codes", async () => {
  const unavailable = await run({
    method: "GET",
    result: { data: null, error: { code: "PGRST202", message: SECRET } },
  });
  assert.equal(unavailable.response.status, 503);
  assert.equal(unavailable.body.code, "PRODUCT_REGISTRATION_DRAFT_STORAGE_UNAVAILABLE");
  assert.equal(JSON.stringify(unavailable.body).includes(SECRET), false);

  const conflict = await run({
    method: "PUT",
    body: {
      draftId: DRAFT_ID,
      kind: "intake",
      expectedVersion: 1,
      data: {},
    },
    result: {
      data: null,
      error: { code: "40001", message: `PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT ${SECRET}` },
    },
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, "PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT");
  assert.equal(JSON.stringify(conflict.body).includes(SECRET), false);
});

test("route sanitizes rejected RPCs and never reports the write as saved", async () => {
  const result = await run({
    method: "PUT",
    body: {
      draftId: DRAFT_ID,
      kind: "intake",
      expectedVersion: 0,
      data: {},
    },
    reject: true,
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, "PRODUCT_REGISTRATION_DRAFT_WRITE_FAILED");
  assert.equal(JSON.stringify(result.body).includes(SECRET), false);
});
