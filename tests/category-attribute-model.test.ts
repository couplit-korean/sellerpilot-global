import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  categoryConfirmationTargets,
  categoryStatesFromAssignments,
} from "../app/category-classification-workbench";
import {
  assignmentCategoryAttributeDescriptors,
  categoryAttributeValueValid,
  compatibleCategoryValues,
  missingCategoryInputIssues,
  normalizeCategoryMetadata,
  normalizeStoredCategoryAttribute,
  serializeCategoryAttributeValues,
  suggestedCategoryAttributeValues,
} from "../app/category-attribute-model";

test("Coupang metadata preserves optional, grouped, numeric-unit, notice and certification contracts", () => {
  const metadata = normalizeCategoryMetadata("coupang", [{
    ok: true,
    steps: [{
      name: "category-metadata",
      ok: true,
      status: 200,
      data: { data: {
        attributes: [
          { attributeTypeName: "개당 중량", required: "MANDATORY", groupNumber: "NONE", exposed: "EXPOSED", dataType: "NUMBER", basicUnit: "g", usableUnits: ["g", "kg"] },
          { attributeTypeName: "개당 용량", required: "MANDATORY", groupNumber: "1", exposed: "EXPOSED", dataType: "NUMBER", usableUnits: ["ml", "L"] },
          { attributeTypeName: "개당 수량", required: "MANDATORY", groupNumber: "1", exposed: "EXPOSED", dataType: "NUMBER", usableUnits: ["개"] },
          { attributeTypeName: "색상", required: "OPTIONAL", groupNumber: "NONE", exposed: "EXPOSED", dataType: "STRING" },
          { attributeTypeName: "내부코드", required: "OPTIONAL", groupNumber: "NONE", exposed: "HIDDEN", dataType: "STRING" },
        ],
        noticeCategories: [
          {
            noticeCategoryName: "식품",
            noticeCategoryDetailNames: [
              { noticeCategoryDetailName: "제품명", required: "MANDATORY" },
              { noticeCategoryDetailName: "소비자상담 전화번호", required: "OPTIONAL" },
            ],
          },
          {
            noticeCategoryName: "전기용품",
            noticeCategoryDetailNames: [{ noticeCategoryDetailName: "정격전압", required: "MANDATORY" }],
          },
        ],
        certifications: [
          { certificationType: "어린이제품 KC인증", required: "MANDATORY", dataType: "CODE" },
          { certificationType: "안전기준 준수", required: "OPTIONAL", dataType: "DOCUMENT" },
        ],
      } },
    }],
  }]);

  const weight = metadata.descriptors.find((item) => item.id === "개당 중량");
  assert.equal(weight?.inputKind, "number_with_unit");
  assert.deepEqual(weight?.units, ["g", "kg"]);
  assert.equal(weight?.required, true);
  assert.equal(metadata.descriptors.find((item) => item.id === "개당 용량")?.requirement, "one_of_group");
  assert.equal(metadata.descriptors.find((item) => item.id === "색상")?.requirement, "optional");
  assert.equal(metadata.descriptors.find((item) => item.id === "내부코드")?.inputKind, "unsupported");
  assert.equal(metadata.descriptors.find((item) => item.id === "notice:category")?.values[0]?.id, "식품");
  assert.deepEqual(metadata.descriptors.find((item) => item.id === "notice:식품:제품명")?.condition, {
    attributeId: "notice:category",
    equals: "식품",
  });
  assert.equal(metadata.descriptors.find((item) => item.id === "certification:어린이제품 KC인증")?.inputKind, "text");
  assert.equal(metadata.descriptors.find((item) => item.id === "certification:안전기준 준수")?.inputKind, "unsupported");
  assert.equal(metadata.nativeCategoryMetadata.attributes.length, 5);
  assert.equal(metadata.nativeCategoryMetadata.noticeCategories.length, 2);
  assert.equal(metadata.nativeCategoryMetadata.certifications.length, 2);
  const persisted = assignmentCategoryAttributeDescriptors(metadata.descriptors, {
    "notice:category": "식품",
    "notice:식품:제품명": "롯데샌드",
    "개당 중량": "315g",
    "개당 용량": "315ml",
    "certification:어린이제품 KC인증": "CB1234",
  });
  assert.equal(persisted.find((item) => item.id === "notice:식품:제품명")?.required, true);
  assert.equal(persisted.find((item) => item.id === "notice:전기용품:정격전압")?.required, false, "an inactive conditional notice must not become a flat DB requirement");
  assert.equal(persisted.find((item) => item.id === "개당 용량")?.required, true, "the chosen member lets the flat DB contract protect the one-of value");
  assert.equal(persisted.find((item) => item.id === "개당 수량")?.required, false);
});

test("required and one-of group validation follows explicit provider metadata without inventing required flags", () => {
  const attributes = normalizeCategoryMetadata("coupang", [{ data: {
    attributes: [
      { attributeTypeName: "중량", required: "MANDATORY", groupNumber: "NONE", exposed: "EXPOSED", dataType: "NUMBER", usableUnits: ["g"] },
      { attributeTypeName: "길이", required: "MANDATORY", groupNumber: "2", exposed: "EXPOSED", dataType: "NUMBER", usableUnits: ["cm"] },
      { attributeTypeName: "폭", required: "MANDATORY", groupNumber: "2", exposed: "EXPOSED", dataType: "NUMBER", usableUnits: ["cm"] },
      { attributeTypeName: "선택 설명", required: "OPTIONAL", groupNumber: "NONE", exposed: "EXPOSED", dataType: "STRING" },
    ],
  } }]).descriptors;

  assert.deepEqual(missingCategoryInputIssues(attributes, {} as Record<string, string>).map((issue) => issue.reason), ["missing", "group_missing"]);
  assert.deepEqual(missingCategoryInputIssues(attributes, { 중량: "315g", 길이: "10cm" }), []);
  assert.equal(categoryAttributeValueValid(attributes[0]!, "315lb"), false);
  const persisted = assignmentCategoryAttributeDescriptors(attributes, { 중량: "315g", 길이: "10cm" });
  assert.equal(persisted.find((attribute) => attribute.id === "중량")?.required, true);
  assert.equal(persisted.find((attribute) => attribute.id === "길이")?.required, true);
  assert.equal(persisted.find((attribute) => attribute.id === "폭")?.required, false);
});

test("eBay cardinality and explicit modes choose multi-select, repeatable text and unsupported controls", () => {
  const metadata = normalizeCategoryMetadata("ebay", [{ data: { aspects: [
    { localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" }, aspectValues: [{ localizedValue: "LOTTE" }] },
    { localizedAspectName: "Features", aspectConstraint: { aspectRequired: false, aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "MULTI" }, aspectValues: [{ localizedValue: "Wrapped" }, { localizedValue: "Snack" }] },
    { localizedAspectName: "Ingredients", aspectConstraint: { aspectRequired: false, aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI" } },
    { localizedAspectName: "Future field", aspectConstraint: { aspectRequired: false, aspectMode: "BINARY_BLOB" } },
  ] } }]);

  assert.equal(metadata.descriptors.find((item) => item.id === "Brand")?.inputKind, "text");
  assert.equal(metadata.descriptors.find((item) => item.id === "Features")?.inputKind, "multi_select");
  assert.equal(metadata.descriptors.find((item) => item.id === "Ingredients")?.inputKind, "repeatable_text");
  assert.equal(metadata.descriptors.find((item) => item.id === "Future field")?.inputKind, "unsupported");
});

test("Shopee only treats provider-documented custom-value input types as free text", () => {
  const metadata = normalizeCategoryMetadata("shopee", [{ response: { list: [{ attribute_tree: [
    { attribute_id: 1, display_attribute_name: "Flavour", is_mandatory: true, attribute_info: { input_type: 1 }, attribute_value_list: [{ value_id: 11, display_value_name: "Milk" }] },
    { attribute_id: 2, display_attribute_name: "Model", is_mandatory: false, attribute_info: { input_type: 3 }, attribute_value_list: [] },
    { attribute_id: 3, display_attribute_name: "Opaque", is_mandatory: false, attribute_info: { input_type: 9 }, attribute_value_list: [] },
  ] }] } }]);
  assert.equal(metadata.descriptors.find((item) => item.id === "1")?.inputKind, "single_select");
  assert.equal(metadata.descriptors.find((item) => item.id === "2")?.inputKind, "text");
  assert.equal(metadata.descriptors.find((item) => item.id === "3")?.inputKind, "unsupported");
});

test("serialization keeps repeated values as JSON arrays and maps Lazada option ids to provider names", () => {
  const attributes = normalizeCategoryMetadata("lazada", [{ data: [{
    attribute_id: "flavor",
    label: "Flavor",
    mandatory: true,
    inputType: "MULTI_SELECT",
    options: [{ id: "1", name: "Milk" }, { id: "2", name: "Chocolate" }],
  }] }]).descriptors;
  const serialized = serializeCategoryAttributeValues("lazada", attributes, { flavor: ["1", "2"] });
  assert.deepEqual(serialized, { flavor: ["Milk", "Chocolate"] });
  assert.equal(Array.isArray(serialized.flavor), true);
});

test("AI-backed initial values use only named product facts and preserve select contracts", () => {
  const attributes = normalizeCategoryMetadata("ebay", [{ aspects: [
    { localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" } },
    { localizedAspectName: "Country/Region of Manufacture", aspectConstraint: { aspectRequired: false, aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Korea, South" }] },
  ] }]).descriptors;
  assert.deepEqual(suggestedCategoryAttributeValues(attributes, {
    brandName: "LOTTE",
    countryOfOrigin: "Korea, South",
    weightKg: 0.315,
  }), {
    Brand: "LOTTE",
    "Country/Region of Manufacture": "Korea, South",
  });
});

test("Coupang food notices never reuse ingredients as producer location or nutrition facts", () => {
  const attributes = normalizeCategoryMetadata("coupang", [{ data: {
    noticeCategories: [{
      noticeCategoryName: "가공식품",
      noticeCategoryDetailNames: [
        { noticeCategoryDetailName: "생산자 및 소재지", required: "MANDATORY" },
        { noticeCategoryDetailName: "제조사 및 소재지", required: "OPTIONAL" },
        { noticeCategoryDetailName: "원재료명", required: "MANDATORY" },
        { noticeCategoryDetailName: "영양성분", required: "MANDATORY" },
      ],
    }],
  } }]).descriptors;
  const material = "파스퇴르 우유 0.1%, 탈지분유 0.05%, 밀, 대두, 우유, 달걀 함유";

  assert.deepEqual(suggestedCategoryAttributeValues(attributes, {
    manufacturer: "롯데웰푸드(주)",
    material,
  }), {
    "notice:category": "가공식품",
    "notice:가공식품:원재료명": material,
  });

  assert.deepEqual(suggestedCategoryAttributeValues(attributes, {
    manufacturer: "롯데웰푸드(주)",
    manufacturerAddress: "서울특별시 영등포구 양평로21길 10",
    material,
    nutritionFacts: "100g당 열량 510kcal, 나트륨 420mg",
  }), {
    "notice:category": "가공식품",
    "notice:가공식품:생산자 및 소재지": "롯데웰푸드(주), 서울특별시 영등포구 양평로21길 10",
    "notice:가공식품:제조사 및 소재지": "롯데웰푸드(주), 서울특별시 영등포구 양평로21길 10",
    "notice:가공식품:원재료명": material,
    "notice:가공식품:영양성분": "100g당 열량 510kcal, 나트륨 420mg",
  });
});

test("category changes retain only values with the same typed contract and isolate the rest", () => {
  const previous = [
    normalizeStoredCategoryAttribute({ id: "brand", name: "Brand", required: true, mode: "FREE_TEXT", inputKind: "text" })!,
    normalizeStoredCategoryAttribute({ id: "color", name: "Color", required: false, values: [{ id: "red", name: "Red" }], inputKind: "single_select" })!,
  ];
  const next = [
    normalizeStoredCategoryAttribute({ id: "brand", name: "Brand", required: true, mode: "FREE_TEXT", inputKind: "text" })!,
    normalizeStoredCategoryAttribute({ id: "color", name: "Color", required: false, values: [{ id: "blue", name: "Blue" }], inputKind: "single_select" })!,
  ];
  assert.deepEqual(compatibleCategoryValues(previous, next, { brand: "LOTTE", color: "red", obsolete: "old" }), {
    accepted: { brand: "LOTTE" },
    isolated: { color: "red", obsolete: "old" },
  });
});

test("category assignment RPC accepts a JSON object whose property values include arrays", async () => {
  const source = await readFile(new URL("../supabase/migrations/20260824154500_enable_elevenst_listing_workflow.sql", import.meta.url), "utf8");
  assert.match(source, /jsonb_typeof\(p_provided_attributes\) <> 'object'/);
  assert.match(source, /p_provided_attributes \? coalesce\(a->>'id', a->>'name'\)/);
  assert.doesNotMatch(source, /jsonb_typeof\(p_provided_attributes->/);
  const provided = serializeCategoryAttributeValues("ebay", [{
    id: "Features",
    name: "Features",
    required: false,
    requirement: "optional",
    values: [{ id: "Wrapped", name: "Wrapped" }, { id: "Snack", name: "Snack" }],
    mode: "MULTI_SELECT",
    inputKind: "multi_select",
    units: [],
    groupId: null,
    repeatable: true,
    sourceKind: "attribute",
    condition: null,
    unsupportedReason: null,
  }], { Features: ["Wrapped", "Snack"] });
  assert.equal(typeof provided, "object");
  assert.deepEqual(provided.Features, ["Wrapped", "Snack"]);
});

test("saved category assignments restore their selected category and all scalar or repeated values", () => {
  const states = categoryStatesFromAssignments([{
    channel: "ebay",
    environment: "production",
    market: "US",
    category_id: "20473",
    category_path: ["Food & Beverages", "Cookies & Biscuits"],
    is_leaf: true,
    confidence: "0.98",
    required_attributes: [
      { id: "Brand", name: "Brand", required: true, requirement: "required", mode: "FREE_TEXT", inputKind: "text" },
      { id: "Features", name: "Features", required: false, requirement: "optional", inputKind: "multi_select", repeatable: true, values: [{ id: "wrapped", name: "Wrapped" }, { id: "snack", name: "Snack" }] },
    ],
    provided_attributes: { Brand: "LOTTE", Features: ["Wrapped", "Snack"] },
    status: "confirmed",
  }]);
  assert.equal(states["ebay:US"]?.selected?.id, "20473");
  assert.equal(states["ebay:US"]?.phase, "confirmed");
  assert.deepEqual(states["ebay:US"]?.values, { Brand: "LOTTE", Features: ["wrapped", "snack"] });
  assert.equal(states["ebay:US"]?.loadedFromAssignment, true);
});

test("legacy required-only assignments retain their values but require current official metadata", () => {
  const states = categoryStatesFromAssignments([{
    channel: "coupang",
    environment: "production",
    market: "KR",
    category_id: "63955",
    category_path: ["식품", "과자"],
    is_leaf: true,
    confidence: 1,
    required_attributes: [{ id: "수량", name: "수량", required: true, mode: "FREE_TEXT" }],
    provided_attributes: { 수량: "1개" },
    status: "confirmed",
  }, {
    channel: "qoo10",
    environment: "production",
    market: "JP",
    category_id: "300002252",
    category_path: ["Fashion", "T-Shirts"],
    is_leaf: true,
    confidence: 1,
    required_attributes: [],
    provided_attributes: {},
    status: "confirmed",
  }]);
  assert.equal(states["coupang:KR"]?.phase, "ready");
  assert.deepEqual(states["coupang:KR"]?.values, { 수량: "1개" });
  assert.equal(states["coupang:KR"]?.loadedFromAssignment, true);
  assert.equal(states["coupang:KR"]?.officialMetadata, null);
  assert.equal(states["qoo10:JP"]?.phase, "ready", "an empty legacy descriptor array must not count as current typed metadata");
});

test("Shopee category confirmation keeps one independently reviewed market target", () => {
  const sg = { targetId: "10001", displayName: "Singapore", marketCode: "SG", locale: "en-SG", language: "English", currency: "SGD" };
  assert.deepEqual(categoryConfirmationTargets(sg), [sg]);
  assert.equal(categoryConfirmationTargets(undefined).length, 1);
});
