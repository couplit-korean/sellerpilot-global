import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  elevenstNewProductSourceDependenciesFromRpc,
  elevenstNewProductSourceRpc,
  prepareElevenstNewProductCreateBeforeClaimFromRpc,
} from "../lib/product-registration/elevenst/new-product-input-source-rpc";

const ownerId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000001";
const credentialId = "30000000-0000-4000-8000-000000000001";
const key = {
  ownerId,
  productId,
  categoryId: "1346631" as const,
  credentialId,
  credentialVersion: 7,
  environment: "production" as const,
};

test("11st RPC dependencies issue six exact service-source reads", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { kind: args.p_kind }, error: null };
    },
  };
  const dependencies = elevenstNewProductSourceDependenciesFromRpc(client);
  const results = await Promise.all([
    dependencies.readProductSource(key),
    dependencies.readCredentialSource(key),
    dependencies.readNoticeSource(key),
    dependencies.readSellerSource(key),
    dependencies.readAvailabilitySource(key),
    dependencies.readPolicySource(key),
  ]);

  assert.deepEqual(results.map((value) => (value as { kind: string }).kind), [
    "product",
    "credential",
    "notices",
    "seller",
    "availability",
    "policy",
  ]);
  assert.equal(calls.length, 6);
  for (const [index, kind] of [
    "product",
    "credential",
    "notices",
    "seller",
    "availability",
    "policy",
  ].entries()) {
    assert.equal(calls[index]?.name, elevenstNewProductSourceRpc);
    assert.deepEqual(calls[index]?.args, {
      p_kind: kind,
      p_owner_id: ownerId,
      p_product_id: productId,
      p_category_id: "1346631",
      p_credential_id: credentialId,
      p_credential_version: 7,
    });
  }
});

test("11st pre-claim preparation reads every source and blocks null operating values", async () => {
  const calls: string[] = [];
  const prepared = await prepareElevenstNewProductCreateBeforeClaimFromRpc({
    ...key,
    arguments: {
      product: {
        dispCtgrNo: "1346631",
        ProductNotification: [{ prdInfoTmpltCd: "browser-value" }],
      },
      sellerpilotElevenstNewProductInputReceipt: { contract: "browser-value" },
    },
  }, {
    async rpc(name, args) {
      assert.equal(name, elevenstNewProductSourceRpc);
      calls.push(String(args.p_kind));
      return { data: null, error: null };
    },
  });

  assert.equal(prepared.ok, false);
  assert.deepEqual(calls, [
    "product",
    "credential",
    "notices",
    "seller",
    "availability",
    "policy",
  ]);
  if (!prepared.ok) {
    const product = prepared.sanitizedArguments.product as Record<string, unknown>;
    assert.equal("ProductNotification" in product, false);
    assert.equal("sellerpilotElevenstNewProductInputReceipt" in prepared.sanitizedArguments, false);
    assert.ok(prepared.blockers.length >= 6);
  }
});

test("11st service source read errors fail closed", async () => {
  const dependencies = elevenstNewProductSourceDependenciesFromRpc({
    async rpc() {
      return { data: null, error: { message: "unavailable" } };
    },
  });
  await assert.rejects(
    dependencies.readProductSource(key),
    /ELEVENST_NEW_PRODUCT_SOURCE_RPC_FAILED:product/u,
  );
});

test("11st processed-food server-source gate is before fingerprint and claim", async () => {
  const route = await readFile(new URL(
    "../app/api/admin/channel-operations/route.ts",
    import.meta.url,
  ), "utf8");
  const prepareIndex = route.indexOf("await prepareElevenstNewProductCreateBeforeClaimFromRpc");
  const fingerprintIndex = route.indexOf("const baseRequestFingerprint = createHash");
  const claimIndex = route.indexOf('userClient.rpc("sellerpilot_claim_channel_operation"');
  assert.ok(prepareIndex > 0);
  assert.ok(prepareIndex < fingerprintIndex);
  assert.ok(fingerprintIndex < claimIndex);
  assert.match(route, /elevenstCreateProduct\?\.dispCtgrNo === "1346631"/u);
  assert.match(route, /assignment\.categoryId === "1346631"/u);
  assert.match(route, /assignment\.status === "confirmed"/u);
  assert.match(route, /ownerId: elevenstServerOwnerId/u);
  assert.match(route, /effectiveArguments = prepared\.arguments;/u);
  assert.match(route, /effectiveCurrency = "KRW";/u);
  assert.match(route, /effectivePrice = serverPrice;/u);
});
