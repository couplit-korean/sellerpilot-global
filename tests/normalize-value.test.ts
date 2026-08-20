import assert from "node:assert/strict";
import test from "node:test";
import { firstFiniteNonNegative } from "../lib/channels/normalize-value";

test("numeric normalization skips null and blank fields before a real channel price", () => {
  assert.equal(firstFiniteNonNegative([null, "", 13_500]), 13_500);
  assert.equal(firstFiniteNonNegative([undefined, "27000"]), 27_000);
});
