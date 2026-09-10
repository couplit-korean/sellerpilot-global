import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const route = await readFile(
  new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
  "utf8",
);

test("admin route replaces client eBay approval after final marketplace image preparation", () => {
  const strip = route.indexOf("delete effectiveArguments.sellerpilotEbayCreateApproval");
  const prepare = route.indexOf("await prepareMarketplaceImages(serviceClient, channel, effectiveArguments");
  const build = route.indexOf("const approval = buildEbayCreateApproval(gatewayArguments)");
  const enqueue = route.indexOf("const gatewayExecution = await executeViaChannelGateway({");

  assert.ok(strip >= 0, "client approval must be removed");
  assert.ok(prepare > strip, "provider transport images must be prepared after stripping client input");
  assert.ok(build > prepare, "approval must bind the final prepared image and content payload");
  assert.ok(enqueue > build, "the server approval must exist before gateway enqueue");
  assert.match(
    route.slice(build, enqueue),
    /sellerpilotEbayCreateApproval:\s*approval/u,
  );
});

test("revision-backed eBay create fails before gateway enqueue when server approval cannot be built", () => {
  const guard = route.indexOf("if (channel === \"ebay\"", route.indexOf("await prepareMarketplaceImages"));
  const enqueue = route.indexOf("const gatewayExecution = await executeViaChannelGateway({");
  const guarded = route.slice(guard, enqueue);

  assert.match(guarded, /gatewayArguments\.sellerpilotExternalDetail !== undefined/u);
  assert.match(guarded, /if \(!approval\) throw new Error\("EBAY_CREATE_APPROVAL_REVISION_INVALID"\)/u);
});
