import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

const routeSource = await readFile(new URL(
  "../app/api/admin/channel-credentials/rotate/route.ts",
  import.meta.url,
), "utf8");
const credentialId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reservedKeys = [
  "temu_account_identity_contract",
  "temu_account_identity_endpoint_host",
  "temu_account_identity_mall_id",
  "temu_account_identity_region_id",
  "temu_account_identity_mall_type",
  "temu_account_identity_semi_unique_id",
];

function load(source, modules) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const context = vm.createContext({
    exports: {},
    Request,
    Response,
    process: { env: { SUPABASE_SECRET_KEY: "fixture-service" } },
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return modules[name];
    },
  });
  vm.runInContext(js, context, { timeout: 1_000 });
  return context.exports;
}

function fixture({ attestFailure = null } = {}) {
  const rotateCalls = [];
  const attestCalls = [];
  const oldSecret = {
    app_key: "fixture-app",
    app_secret: "fixture-secret",
    access_token: "old-token",
    temu_account_identity_contract: "temu_access_token_identity_v1",
    temu_account_identity_endpoint_host: "openapi-b-global.temu.com",
    temu_account_identity_mall_id: "old-mall",
    temu_account_identity_region_id: "old-region",
    temu_account_identity_mall_type: "100",
  };
  const hasIdentity = (payload) => Object.keys(payload)
    .some((key) => reservedKeys.includes(key));
  const withoutIdentity = (payload) => Object.fromEntries(
    Object.entries(payload).filter(([key]) => !reservedKeys.includes(key)),
  );
  const attest = async ({ payload }) => {
    attestCalls.push(structuredClone(payload));
    if (attestFailure) throw new Error(attestFailure);
    assert.equal(hasIdentity(payload), false);
    return {
      payload: {
        ...payload,
        temu_account_identity_contract: "temu_access_token_identity_v1",
        temu_account_identity_endpoint_host: "openapi-b-global.temu.com",
        temu_account_identity_mall_id: "official-new-mall",
        temu_account_identity_region_id: "211",
        temu_account_identity_mall_type: "100",
      },
    };
  };
  const sdk = {
    createClient(_url, key) {
      if (key === "fixture-public") return {
        auth: {
          getUser: async () => ({
            data: { user: { id: ownerId } },
            error: null,
          }),
        },
        rpc: async (name, args) => {
          if (name === "sellerpilot_is_admin") {
            return { data: true, error: null };
          }
          if (name === "sellerpilot_list_credentials") {
            return {
              data: [{
                id: credentialId,
                channel: "temu",
                status: "active",
              }],
              error: null,
            };
          }
          assert.equal(name, "sellerpilot_rotate_credential");
          rotateCalls.push(structuredClone(args));
          return { data: credentialId, error: null };
        },
      };
      assert.equal(key, "fixture-service");
      return {
        rpc: async (name) => {
          assert.equal(name, "sellerpilot_decrypt_credential");
          return { data: structuredClone(oldSecret), error: null };
        },
      };
    },
  };
  const { POST } = load(routeSource, {
    "@supabase/supabase-js": sdk,
    "next/server": {
      NextResponse: {
        json: (body, init) => Response.json(body, init),
      },
    },
    zod: { z },
    "../../../../../lib/channels/catalog": {
      requiredCredentialKeys: () => [
        "app_key",
        "app_secret",
        "access_token",
      ],
    },
    "../../../../../lib/product-registration/temu/account-identity": {
      attestTemuCredentialIdentityForSave: attest,
      hasTemuAccountIdentityFields: hasIdentity,
      withoutTemuAccountIdentityFields: withoutIdentity,
    },
    "../../../../../lib/supabase/config": {
      supabasePublishableKey: "fixture-public",
      supabaseUrl: "https://fixture.invalid",
    },
  });
  return { POST, rotateCalls, attestCalls };
}

async function rotate(POST, secretPayload) {
  const response = await POST(new Request(
    "https://fixture.invalid/api/admin/channel-credentials/rotate",
    {
      method: "POST",
      headers: {
        authorization: "Bearer fixture-admin",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        credentialId,
        channel: "temu",
        environment: "production",
        secretPayload,
        expiresAt: null,
        rotationDays: 90,
        warningDays: 30,
        graceDays: 0,
      }),
    },
  ));
  return { response, body: await response.json() };
}

test("Temu rotate rejects frontend identity fields before attestation or Vault rotation", async () => {
  const f = fixture();
  const result = await rotate(f.POST, {
    access_token: "new-token",
    temu_account_identity_mall_id: "frontend-mall",
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.code, "TEMU_ACCOUNT_IDENTITY_FIELDS_SERVER_ONLY");
  assert.equal(f.attestCalls.length, 0);
  assert.equal(f.rotateCalls.length, 0);
});

test("Temu rotate removes old-token binding and persists only fresh server attestation", async () => {
  const f = fixture();
  const result = await rotate(f.POST, { access_token: "new-token" });
  assert.equal(result.response.status, 200);
  assert.equal(f.attestCalls.length, 1);
  assert.equal(f.attestCalls[0].access_token, "new-token");
  assert.equal(reservedKeys.some((key) => key in f.attestCalls[0]), false);
  assert.equal(f.rotateCalls.length, 1);
  const saved = f.rotateCalls[0].p_secret_payload;
  assert.equal(saved.access_token, "new-token");
  assert.equal(saved.temu_account_identity_mall_id, "official-new-mall");
  assert.equal(saved.temu_account_identity_region_id, "211");
  assert.equal(JSON.stringify(saved).includes("old-mall"), false);
  assert.equal(JSON.stringify(saved).includes("old-region"), false);
});

test("Temu rotate never calls Vault rotation when fresh signed identity fails", async () => {
  const f = fixture({
    attestFailure: "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING",
  });
  const result = await rotate(f.POST, { access_token: "new-token" });
  assert.equal(result.response.status, 422);
  assert.equal(result.body.code, "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING");
  assert.equal(f.attestCalls.length, 1);
  assert.equal(f.rotateCalls.length, 0);
});
