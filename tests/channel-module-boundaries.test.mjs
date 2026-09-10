import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import {
  auditChannelModules,
  channelModuleKeys,
} from "../scripts/audit-channel-module-boundaries.mjs";
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
const { productChannelAdapters } = await import(
  "../lib/product-registration/channel-adapters.ts"
);
const { csChannelAdapters } = await import(
  "../lib/cs/operations/channel-adapters.ts"
);
const { shippingChannelAdapters } = await import(
  "../lib/shipping/channel-adapters.ts"
);
test("24 channel entry modules exist and cannot transitively import a different channel directory", () => {
  const result = auditChannelModules();
  assert.equal(result.modules.length, 24);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.crossChannelDependencies, []);
});
for (const [domain, registry] of Object.entries({
  PRODUCT: productChannelAdapters,
  CS: csChannelAdapters,
  SHIPPING: shippingChannelAdapters,
})) {
  test(`${domain} registry covers exactly the eight supported channels`, () =>
    assert.deepEqual(
      Object.keys(registry).sort(),
      [...channelModuleKeys].sort(),
    ));
  for (const channel of channelModuleKeys)
    test(`${domain}/${channel} rejects the wrong channel before credentials or transport`, async () => {
      await assert.rejects(
        registry[channel]({
          channel: channel === "qoo10" ? "ebay" : "qoo10",
          operation:
            domain === "PRODUCT"
              ? "listing.create"
              : domain === "CS"
                ? "inquiries.list"
                : "orders.list",
          payload: {},
          arguments: {},
          environment: "production",
        }),
        new RegExp(`${domain}_CHANNEL_MISMATCH:${channel}`),
      );
    });
}
