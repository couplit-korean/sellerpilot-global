import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory writes use retry-stable keys and expire stale pending work", async () => {
  const [route, page] = await Promise.all([
    readFile(new URL("../app/api/admin/products/[id]/inventory/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /Math\.floor\(\(input\.now \?\? Date\.now\(\)\) \/ 300_000\)/);
  assert.match(route, /sellerpilot_service_expire_inventory_sync/);
  assert.match(route, /sellerpilot_service_fail_inventory_sync_item_prewrite/);
  assert.match(route, /sellerpilot_get_inventory_sync_run/);
  assert.match(route, /p_run_id: runId/);
  assert.equal(route.match(/sellerpilot_get_inventory_sync"/g)?.length, 1);
  assert.doesNotMatch(route, /randomUUID/);
  assert.match(route, /if \(task\.status && task\.status !== "pending"\) return/);
  assert.match(route, /const inventoryConcurrency = 3/);
  assert.match(route, /const inventoryTaskBatchSize = 6/);
  assert.match(route, /pendingTasks\.slice\(0, inventoryTaskBatchSize\)/);
  assert.match(route, /map\(processTaskSafely\)/);
  assert.match(route, /continuationRequired: remainingPendingCount > 0/);
  assert.match(route, /remainingPendingCount/);
  assert.match(page, /applyInventoryAcrossSafeBatches/);
  assert.match(page, /const applyInventoryAcrossSafeBatches = async \(onHand: number, stableIdempotencyKey\?: string\)/);
  assert.match(page, /const idempotencyKey = stableIdempotencyKey \?\? `inventory-ui-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(page, /`inventory-revision-\$\{jobId\}`/);
  assert.match(page, /if \(!payload\.continuationRequired\)/);
});
