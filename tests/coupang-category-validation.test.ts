import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { executeChannelOperation } = await import("../lib/channels/operations");

const payload = {
  vendor_id: "A00098765",
  access_key: "access",
  secret_key: "secret",
};

async function validateCategory(data: boolean) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: "SUCCESS", data });
  try {
    return await executeChannelOperation({
      channel: "coupang",
      operation: "categories.validate",
      payload,
      arguments: { categoryId: "59631" },
      environment: "production",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Coupang category validation accepts only provider-confirmed active leaf status", async () => {
  const active = await validateCategory(true);
  assert.equal(active.ok, true);
  assert.equal(
    active.steps[0]?.data.sellerpilotVerification,
    "COUPANG_ACTIVE_LEAF_CATEGORY_VERIFIED",
  );

  const inactive = await validateCategory(false);
  assert.equal(inactive.ok, false);
  assert.equal(inactive.steps[0]?.ok, false);
  assert.equal(
    inactive.steps[0]?.data.sellerpilotVerification,
    "COUPANG_ACTIVE_LEAF_CATEGORY_UNVERIFIED",
  );
});
