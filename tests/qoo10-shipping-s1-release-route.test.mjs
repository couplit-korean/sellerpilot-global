import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL(
  "../app/api/admin/products/[id]/qoo10-shipping-s1-release/route.ts",
  import.meta.url,
);

test("Qoo10 shipping S1 release route authenticates before parsing any target", async () => {
  const route = await readFile(routeUrl, "utf8");

  for (const handler of ["GET", "POST"]) {
    const start = route.indexOf(`export async function ${handler}`);
    const end = route.indexOf("\nexport async function ", start + 1);
    const source = route.slice(start, end < 0 ? undefined : end);
    const authentication = source.indexOf("authenticateAdminRequest(request");
    assert.ok(authentication >= 0);
    assert.ok(authentication < source.indexOf("context.params"));
    assert.ok(authentication < source.indexOf("exactTarget("));
    if (handler === "POST") {
      assert.ok(authentication < source.indexOf("request.json()"));
    }
  }
});

test("Qoo10 shipping S1 release route preserves no-store on authentication errors", async () => {
  const route = await readFile(routeUrl, "utf8");

  assert.match(route, /function noStoreAdminError\(response: NextResponse\)/u);
  assert.match(
    route,
    /response\.headers\.set\("cache-control", "no-store, max-age=0"\)/u,
  );
  assert.equal(
    (route.match(/if \(isAdminApiError\(admin\)\) return noStoreAdminError\(admin\);/gu) ?? []).length,
    2,
  );
  assert.equal((route.match(/noStore\(400\)/gu) ?? []).length, 2);
  assert.match(route, /export const dynamic = "force-dynamic";/u);
});

test("Qoo10 shipping S1 release route exposes only the fenced shipping S1 service RPCs", async () => {
  const route = await readFile(routeUrl, "utf8");

  assert.match(route, /sellerpilot_service_get_qoo10_shipping_s1_release_status/u);
  assert.match(route, /sellerpilot_service_enqueue_qoo10_shipping_s1_verifier/u);
  assert.match(route, /sellerpilot_service_enqueue_qoo10_shipping_s1_activation/u);
  assert.match(route, /qoo10LotteShippingS1Target/u);
  assert.match(route, /resolveRuntimeReleaseIdentity\(\)/u);
  assert.doesNotMatch(route, /process\.env/u);
  assert.doesNotMatch(route, /error\.(?:message|details|hint)/u);
  assert.doesNotMatch(route, /listing\.activate/u);
  assert.doesNotMatch(route, /sellerpilot_service_get_exact_qoo10_localization_release_status/u);
  assert.doesNotMatch(route, /qoo10ExactLocalizationRecoveryIdentity/u);
});
