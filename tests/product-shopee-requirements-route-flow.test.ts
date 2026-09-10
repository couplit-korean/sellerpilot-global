import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as protocols from "../lib/channels/protocols";
import * as lineage from "../lib/channels/shopee-target-lineage";
import * as targets from "../lib/channels/target-records";
import * as candidates from "../lib/product-registration/shopee/provider-requirements";
import { shopeeSgRequirementSnapshotContract } from "../lib/product-registration/shopee/requirement-view-model";

const source = await readFile(new URL("../app/api/admin/shopee-requirements/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const credentialId = "10000000-0000-4000-8000-000000000001";
const shopId = "8001";
const merchantId = "2001";

async function run(options: {
  expired?: "shop" | "merchant";
  admin?: boolean;
  duplicateCredential?: boolean;
  shopId?: string;
  aborted?: boolean;
} = {}) {
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const secret = {
    partner_id: "1001", partner_key: "fixture-key",
    main_account_id: "3001", merchant_id: merchantId, shop_id: "9999",
    access_token: "fixture-wrong-root-token",
    provider_account_identity_version: "v1", provider_account_subject: "shopee:main:3001",
    authorization_expires_at: expiresAt,
    shopee_targets: (["shop", "merchant"] as const).map((type) => ({
      type, id: type === "shop" ? shopId : merchantId,
      access_token: `fixture-${type}-token`, refresh_token: `fixture-${type}-refresh`,
      access_token_expires_at: options.expired === type ? "2000-01-01T00:00:00Z" : expiresAt,
      refresh_token_expires_at: expiresAt,
    })),
  };
  const calls: Array<{ path: string; method: string; token: string; shop: string | null; merchant: string | null }> = [];
  const rpcs: string[] = [];
  let clients = 0;
  const sandbox = vm.createContext({
    exports: {}, Request, Response, URL, URLSearchParams, Date, AbortSignal,
    process: { env: { SUPABASE_SECRET_KEY: "fixture-service-secret" } },
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return { z };
      if (name.endsWith("/protocols")) return protocols;
      if (name.endsWith("/shopee-target-lineage")) return lineage;
      if (name.endsWith("/target-records")) return targets;
      if (name.endsWith("/provider-requirements")) return candidates;
      if (name.endsWith("/requirement-view-model")) return { shopeeSgRequirementSnapshotContract };
      if (name.endsWith("/supabase/config")) return { supabaseUrl: "https://example.invalid", supabasePublishableKey: "fixture-public" };
      if (name === "@supabase/supabase-js") return {
        createClient() {
          const service = ++clients === 2;
          return {
            auth: { getUser: async () => ({ data: { user: { id: "fixture-owner" } }, error: null }) },
            async rpc(rpc: string) {
              rpcs.push(rpc);
              if (service) {
                assert.equal(rpc, "sellerpilot_get_active_credential_secret");
                return { data: { credential_id: credentialId, secret_payload: secret }, error: null };
              }
              if (rpc === "sellerpilot_is_admin") return { data: options.admin !== false, error: null };
              if (rpc === "sellerpilot_list_credentials") return {
                data: Array.from({ length: options.duplicateCredential ? 2 : 1 }, () => ({ id: credentialId, channel: "shopee", environment: "production", status: "active" })), error: null,
              };
              if (rpc === "sellerpilot_list_channel_market_targets") return { data: [{
                target_id: shopId, market_code: "SG", locale: "en-SG", language: "English", currency: "SGD", display_name: "Fixture SG",
              }], error: null };
              throw new Error(`Unexpected RPC ${rpc}`);
            },
          };
        },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    calls.push({ path, method: init?.method ?? "GET", token: url.searchParams.get("access_token") ?? "", shop: url.searchParams.get("shop_id"), merchant: url.searchParams.get("merchant_id") });
    let response: Record<string, unknown>;
    if (path.endsWith("/get_category")) response = { category_list: [
      { category_id: 100, parent_category_id: 0, original_category_name: "Root", has_children: true },
      { category_id: 101, parent_category_id: 100, original_category_name: "Leaf", has_children: false },
    ] };
    else if (path.endsWith("/get_attribute_tree")) response = { list: [{ category_id: 101, attribute_tree: [] }] };
    else if (path.endsWith("/get_brand_list")) response = { brand_list: [{ brand_id: 11, display_brand_name: "Fixture" }], is_mandatory: true, input_type: "DROP_DOWN", has_next_page: false, next_offset: 0 };
    else if (path.endsWith("/get_channel_list")) response = { logistics_channel_list: [{ logistics_channel_id: 21, enabled: true }] };
    else if (path.endsWith("/get_merchant_warehouse_list")) response = { warehouse_list: [{ warehouse_id: 31, location_id: "PICKUP", warehouse_name: "Fixture" }], cursor: { next_id: null, page_size: 30 } };
    else if (path.endsWith("/get_warehouse_eligible_shop_list")) response = { shop_list: [{ shop_id: Number(shopId) }], cursor: { next_id: null, page_size: 30 } };
    else throw new Error("Unexpected provider write or refresh");
    return Response.json({ error: "", response });
  };
  try {
    vm.runInContext(compiled, sandbox);
    const controller = new AbortController();
    if (options.aborted) controller.abort();
    const result = await (sandbox.exports as { POST(request: Request): Promise<Response> }).POST(new Request("https://example.invalid/api/admin/shopee-requirements", {
      method: "POST", signal: controller.signal,
      headers: { authorization: "Bearer fixture-session", "content-type": "application/json" },
      body: JSON.stringify({ credentialId, shopId: options.shopId ?? shopId, categoryId: "101", sourceFingerprint: "fixture-source" }),
    }));
    return { status: result.status, body: await result.json(), calls, rpcs, cache: result.headers.get("cache-control") };
  } finally {
    globalThis.fetch = previous;
  }
}

test("actual Shopee requirements POST uses distinct authorized shop and merchant tokens for a single SG target", async () => {
  const result = await run();
  assert.equal(result.status, 200);
  assert.equal(result.cache, "no-store, max-age=0");
  assert.equal(result.calls.length, 6);
  assert.equal(result.body.tuple.shopId, shopId);
  for (const call of result.calls) {
    const isShop = call.path.endsWith("/get_channel_list");
    assert.equal(call.token, isShop ? "fixture-shop-token" : "fixture-merchant-token");
    assert.equal(isShop ? call.shop : call.merchant, isShop ? shopId : merchantId);
    if (call.method === "POST") assert.match(call.path, /get_(?:merchant_warehouse|warehouse_eligible_shop)_list$/u);
  }
  assert.doesNotMatch(JSON.stringify(result.body), /fixture-.*(?:token|refresh|secret|key)/u);
});

for (const expired of ["shop", "merchant"] as const) test(`expired ${expired} token blocks candidate reads without OAuth refresh`, async () => {
  const result = await run({ expired });
  assert.equal(result.status, 409);
  assert.equal(result.calls.length, 0);
  assert.match(result.body.resources.category.code, /AUTH_REFRESH_REQUIRED$/u);
});

test("requirements POST rejects unauthorized, ambiguous and wrong-shop requests before provider access", async () => {
  for (const options of [{ admin: false }, { duplicateCredential: true }, { shopId: "8002" }, { aborted: true }]) {
    const result = await run(options);
    assert.ok([403, 409].includes(result.status));
    assert.equal(result.calls.length, 0);
  }
});
