import assert from "node:assert/strict";
import test from "node:test";
import {
  lazadaSupplementalCsSurfaces,
  lazadaSupplementalScopeContract,
  lazadaSupplementalScopeInventory,
} from "../lib/cs/channels/lazada/scope-inventory";

test("Lazada review and after-sales remain visible outside the IM completion denominator", () => {
  const inventory = lazadaSupplementalScopeInventory();
  assert.equal(inventory.contract, lazadaSupplementalScopeContract);
  assert.equal(inventory.surfaces.length, 2);
  assert.deepEqual(inventory.surfaces.map((surface) => surface.key), [
    "product_review",
    "reverse_order_after_sales",
  ]);
  assert.equal(lazadaSupplementalCsSurfaces.every((surface) => surface.implementation === "not_implemented"), true);
});

test("review reply is approval-bound and reverse-order mutations stay out of CS reads", () => {
  const review = lazadaSupplementalCsSurfaces.find((surface) => surface.key === "product_review")!;
  assert.deepEqual(review.officialReadPaths, ["/review/seller/list"]);
  assert.deepEqual(review.officialReplyPaths, ["/review/seller/reply/add"]);
  assert.equal(review.state, "permission_pending");
  assert.match(review.mutationBoundary, /approved_review/);

  const afterSales = lazadaSupplementalCsSurfaces.find((surface) => surface.key === "reverse_order_after_sales")!;
  assert.equal(afterSales.officialReadPaths.length, 4);
  assert.deepEqual(afterSales.officialReplyPaths, []);
  assert.equal(afterSales.state, "conditional");
  assert.match(afterSales.mutationBoundary, /mutations_excluded/);
});
