import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
  "utf8",
);

test("the admin route strips client-owned create evidence before fingerprinting or enqueue", () => {
  const fingerprint = route.indexOf("const baseRequestFingerprint");
  const enqueue = route.indexOf("const gatewayExecution = await executeViaChannelGateway({");
  const strips = [
    "delete effectiveArguments[qoo10ListingCreateApprovalBindingArgument]",
    "delete effectiveArguments[shopeeSgCreatePrewriteEvidenceArgument]",
    "delete effectiveArguments.sellerpilotTemuReviewAndCreatePrewrite",
    "delete effectiveArguments.sellerpilotEbayCreateApproval",
  ];

  assert.ok(fingerprint > 0 && enqueue > fingerprint);
  for (const source of strips) {
    const strip = route.indexOf(source);
    assert.ok(strip > 0, `${source} must be present`);
    assert.ok(strip < fingerprint, `${source} must run before request fingerprinting`);
    assert.ok(strip < enqueue, `${source} must run before gateway enqueue`);
  }
});

test("Qoo10 and Temu remain fail closed until their server source builders bind replacement evidence", () => {
  const stripStart = route.indexOf(
    "delete effectiveArguments[qoo10ListingCreateApprovalBindingArgument]",
  );
  const enqueue = route.indexOf(
    "const gatewayExecution = await executeViaChannelGateway({",
    stripStart,
  );
  const beforeEnqueue = route.slice(stripStart, enqueue);

  assert.doesNotMatch(
    beforeEnqueue,
    /sellerpilotQoo10CreateApprovalBinding\s*:/u,
  );
  assert.doesNotMatch(
    beforeEnqueue,
    /sellerpilotTemuReviewAndCreatePrewrite\s*:/u,
  );
});
