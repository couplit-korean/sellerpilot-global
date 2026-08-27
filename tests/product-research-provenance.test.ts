import assert from "node:assert/strict";
import test from "node:test";
import {
  clearUnchangedResearchAppliedValues,
  collectResearchAppliedValues,
} from "../app/_publishing/product-research-provenance";

type Draft = {
  productName: string;
  brandName: string;
  description: string;
  stock: number;
};

const empty: Draft = { productName: "", brandName: "", description: "", stock: 0 };

test("identity changes clear only unchanged values supplied by the previous research result", () => {
  const before = { ...empty, stock: 3 };
  const researched = { ...before, productName: "Product A", brandName: "Brand A", description: "A description" };
  const applied = collectResearchAppliedValues(before, researched, ["productName", "brandName", "description"], {});
  assert.deepEqual(applied, { productName: "Product A", brandName: "Brand A", description: "A description" });

  const userEdited = { ...researched, productName: "Product B", description: "Seller verified description" };
  const cleared = clearUnchangedResearchAppliedValues(userEdited, empty, applied);
  assert.deepEqual(cleared, {
    productName: "Product B",
    brandName: "",
    description: "Seller verified description",
    stock: 3,
  });
});

test("a repeated same-product research keeps provenance for unchanged generated fields", () => {
  const before = { ...empty };
  const first = { ...before, productName: "Product A", brandName: "Brand A" };
  const firstApplied = collectResearchAppliedValues(before, first, ["productName", "brandName"], {});
  const secondApplied = collectResearchAppliedValues(first, first, ["productName", "brandName"], firstApplied);
  assert.deepEqual(secondApplied, firstApplied);
});
