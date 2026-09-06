import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryMarketCode,
  categoryStatesFromAssignments,
} from "../app/category-classification-workbench";
import { normalizeCategoryMetadata } from "../app/category-attribute-model";

const typedAttribute = {
  id: "notification:176398001",
  name: "식품유형",
  required: true,
  requirement: "required",
  values: [],
  mode: "FREE_TEXT",
  inputKind: "text",
  units: [],
  groupId: null,
  repeatable: false,
  sourceKind: "notice",
  condition: null,
  unsupportedReason: null,
};

test("11st KR assignment hydrates the fixed-market state used by the workbench", () => {
  const states = categoryStatesFromAssignments([{
    channel: "elevenst",
    environment: "production",
    market: "KR",
    category_id: "1001342",
    category_path: ["식품", "과자", "비스킷"],
    is_leaf: true,
    confidence: 1,
    required_attributes: [typedAttribute],
    provided_attributes: { "notification:176398001": "과자" },
    status: "confirmed",
  }]);

  assert.equal(categoryMarketCode("elevenst"), "KR");
  assert.equal(states["elevenst:KR"]?.selected?.id, "1001342");
  assert.equal(states[`elevenst:${categoryMarketCode("elevenst")}`]?.phase, "confirmed");
});

test("fixed-market display labels normalize only through explicit channel aliases", () => {
  assert.equal(categoryMarketCode("elevenst", "Korea · OPEN API"), "KR");
  assert.equal(categoryMarketCode("qoo10", "Japan · QAPI"), "JP");
  assert.equal(categoryMarketCode("elevenst", "Korea wholesale"), "KOREA WHOLESALE");
  assert.equal(categoryMarketCode("ebay", "us"), "US");
});

test("official eBay enumerations are not truncated before a later country value", () => {
  const aspectValues = Array.from({ length: 300 }, (_, index) => ({
    localizedValue: index === 275 ? "Korea, South" : `Country ${String(index).padStart(3, "0")}`,
  }));
  const metadata = normalizeCategoryMetadata("ebay", [{ aspects: [{
    localizedAspectName: "Country/Region of Manufacture",
    aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" },
    aspectValues,
  }] }]);
  const country = metadata.descriptors.find((attribute) => attribute.id === "Country/Region of Manufacture");

  assert.equal(country?.values.length, 300);
  assert.ok(country?.values.some((option) => option.name === "Korea, South"));
});
