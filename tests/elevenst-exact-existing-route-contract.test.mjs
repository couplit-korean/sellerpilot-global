import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../lib/channels/serverless-gateway-provider.ts", import.meta.url), "utf8");

test("11st exact duplicate create is rejected at both admin route and worker boundaries", () => {
  assert.match(route, /operation === "listing\.create"[\s\S]*elevenstExactExistingCreateForbidden/u);
  assert.match(route, /elevenst_exact_existing_duplicate_create_forbidden/u);
  assert.match(worker, /operation === "listing\.create"[\s\S]*elevenstExactExistingCreateForbidden/u);
});

test("11st exact update marker is client-stripped and server rebound only after trusted snapshot", () => {
  const strip = route.indexOf("delete effectiveArguments[elevenstExactExistingPublicationArgument]");
  const snapshot = route.indexOf("sellerpilot_service_get_elevenst_listing_snapshot");
  const bind = route.indexOf("bindElevenstExactExistingPublication(effectiveArguments)");
  assert.ok(strip > 0 && snapshot > strip && bind > snapshot);
  assert.match(worker, /elevenstExactExistingUpdateTarget\(rawArguments\)[\s\S]*assertElevenstExactExistingUpdate\(rawArguments\)/u);
});
