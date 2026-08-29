import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the admin runtime smoke can execute only the synthetic AI Gateway probe", async () => {
  const route = await readFile(
    new URL("../app/api/admin/server-runtime-smoke/route.ts", import.meta.url),
    "utf8",
  );
  const authenticate = route.indexOf("authenticateAdminRequest(request)");
  const execute = route.indexOf("handleServerRuntimeSmoke(syntheticRequest");

  assert.ok(authenticate > 0 && execute > authenticate);
  assert.match(route, /export const maxDuration = 60/);
  assert.match(route, /JSON\.stringify\(\{ action: "ai_gateway_smoke" \}\)/);
  assert.match(route, /response\.headers\.append\("set-cookie", cookie\)/);
  assert.doesNotMatch(route, /response\.headers\.set\("set-cookie"/);
  assert.doesNotMatch(route, /sandbox_smoke|product_studio|product_research/);
  assert.doesNotMatch(route, /channel|listing|publish|customer/i);
  assert.doesNotMatch(route, /process\.env|SERVER_RUNTIME_SMOKE_SECRET/);
});
