import assert from "node:assert/strict";
import test from "node:test";
import { CategoryTargetSelectionCoordinator } from "../app/category-target-selection-coordinator";

test("a late SG response cannot replace a newer non-SG market selection", async () => {
  const coordinator = new CategoryTargetSelectionCoordinator();
  const sgRequest = coordinator.begin();
  let resolveSg!: () => void;
  const delayedSg = new Promise<void>((resolve) => { resolveSg = resolve; });
  let selectedMarket = "PH";
  const applySg = delayedSg.then(() => {
    if (sgRequest.isCurrent()) selectedMarket = "SG";
    sgRequest.complete();
  });

  coordinator.supersede();
  selectedMarket = "MY";
  resolveSg();
  await applySg;

  assert.equal(sgRequest.signal.aborted, true);
  assert.equal(selectedMarket, "MY");
});

test("disposing the coordinator invalidates an in-flight selection", () => {
  const coordinator = new CategoryTargetSelectionCoordinator();
  const request = coordinator.begin();
  coordinator.dispose();
  assert.equal(request.signal.aborted, true);
  assert.equal(request.isCurrent(), false);
});
