import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("asset regeneration persists and claims the trusted source manual fields", async () => {
  const [migration, claimRoute] = await Promise.all([
    readFile(new URL(
      "../supabase/migrations/20260826091400_preserve_asset_regeneration_manual_fields.sql",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /update sellerpilot_private\.ai_cli_jobs regeneration[\s\S]*'\{manual_fields\}'[\s\S]*source\.request_payload->'manual_fields'/);
  assert.match(migration, /source\.id::text = regeneration\.request_payload->>'source_job_id'/);
  assert.match(migration, /source\.created_by = regeneration\.created_by/);
  assert.match(migration, /source\.id = p_source_job_id[\s\S]*source\.created_by = v_actor_id/);
  assert.match(migration, /jsonb_typeof\(v_source\.request_payload->'manual_fields'\) is distinct from 'object'/);
  assert.match(migration, /'manual_fields', v_source\.request_payload->'manual_fields'/);

  const regenerationStart = claimRoute.indexOf('if (job.kind === "product_asset_regeneration")');
  const regenerationEnd = claimRoute.indexOf("const assetPaths =", regenerationStart);
  assert.ok(regenerationStart >= 0 && regenerationEnd > regenerationStart);
  const regenerationClaim = claimRoute.slice(regenerationStart, regenerationEnd);
  assert.match(regenerationClaim, /manualFields: jobRequest\.manual_fields/);
  assert.match(regenerationClaim, /typeof jobRequest\.manual_fields === "object" && !Array\.isArray\(jobRequest\.manual_fields\)/);
});
