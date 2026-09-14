import assert from "node:assert/strict";
import test from "node:test";

import { ebayCategoryAspects } from "../lib/channels/ebay-material-aspect";

test("eBay Soft Drinks omits optional Material while retaining every other confirmed aspect", () => {
  assert.deepEqual(ebayCategoryAspects("179188", {
    Brand: "Dong-A Otsuka",
    Product: "Soft Drink",
    Material: "정제수, 탄산가스, 난소화성말토덱스트린, 정제소금, 레몬농축과즙, 구연산, 사과산, 염화칼륨",
  }, "fallback ingredients"), {
    Brand: "Dong-A Otsuka",
    Product: "Soft Drink",
  });
});

test("other eBay categories keep their confirmed Material mapping", () => {
  assert.deepEqual(ebayCategoryAspects("1234", { Color: "Blue", Material: "도자기" }, "fallback"), {
    Color: "Blue",
    Material: "Ceramic",
  });
});
