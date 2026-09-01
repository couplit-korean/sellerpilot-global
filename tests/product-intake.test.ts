import assert from "node:assert/strict";
import test from "node:test";
import { isResolvedProductFact } from "../lib/product-facts";

test("unresolved product facts never pass the seller confirmation gate", () => {
  for (const value of [
    "공급처 확인 필요",
    "원산지 미확인",
    "알 수 없음",
    "unknown",
    "TBD",
    "not provided",
    "N/A",
    "  ",
  ]) {
    assert.equal(isResolvedProductFact(value), false, value);
  }
});

test("explicit seller facts remain valid", () => {
  assert.equal(isResolvedProductFact("No Brand"), true);
  assert.equal(isResolvedProductFact("대한민국"), true);
  assert.equal(isResolvedProductFact("ABS 플라스틱"), true);
});
