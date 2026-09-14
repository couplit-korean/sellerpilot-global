import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CategoryAttributeField } from "../app/category-attribute-field";
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

test("Lazada selection type spellings retain official options and serialize their names", () => {
  const metadata = normalizeCategoryMetadata("lazada", [{ data: [
    { name: "storage_type", label: "Jenis Simpanan", input_type: "singleSelect", is_mandatory: 1, options: [{ id: 1, name: "Room Temperature" }] },
    { name: "brand", label: "Jenama", input_type: "singleSelect", is_mandatory: 1, options: [{ id: 42, name: "Example Brand" }] },
    { name: "hazmat", label: "Bahan Berbahaya", input_type: "multiSelect", is_mandatory: 0, options: [{ id: 2, name: "None" }, { id: 3, name: "Liquid" }] },
  ] }]);
  const [storage, hazmat] = ["storage_type", "hazmat"].map(id => metadata.descriptors.find(row => row.id === id)!);
  assert.equal(storage.inputKind, "single_select");
  assert.equal(hazmat.inputKind, "multi_select");
  assert.equal(categoryAttributeValueValid(storage, "unlisted"), false);
  assert.equal(categoryAttributeValueValid(hazmat, ["2", "unlisted"]), false);
  assert.deepEqual(serializeCategoryAttributeValues("lazada", metadata.descriptors, { storage_type: "1", hazmat: ["2", "3"] }), { storage_type: "Room Temperature", hazmat: ["None", "Liquid"] });
  assert.deepEqual(serializeCategoryAttributeValues("lazada", metadata.descriptors, { brand: "42" }), { brand: "42" });
  assert.match(renderToStaticMarkup(createElement(CategoryAttributeField, { attribute: storage, value: "1", onChange() {} })), /<select/);
});

test("SmartStore cider metadata uses official classifications and joins separate value IDs", () => {
  // Official 50002253 response: gateway job b80e630f, 2026-09-13. No inferred choices.
  const attributes = [
    { attributeSeq: 10013910, attributeName: "용기타입", attributeType: "PRIMARY", attributeClassificationType: "SINGLE_SELECT", unitUsable: false },
    { attributeSeq: 10013911, attributeName: "용량", attributeType: "PRIMARY", attributeClassificationType: "RANGE", unitUsable: true, representativeUnitCode: "A02112" },
    { attributeSeq: 10035708, attributeName: "특징", attributeType: "PRIMARY", attributeClassificationType: "MULTI_SELECT", unitUsable: false, attributeValueMaxMatchingCount: 0 },
    { attributeSeq: 10018618, attributeName: "개당열량", attributeType: "PRIMARY", attributeClassificationType: "RANGE", unitUsable: true, representativeUnitCode: "A02211" },
    { attributeSeq: 10014420, attributeName: "보관방법", attributeType: "PRIMARY", attributeClassificationType: "SINGLE_SELECT", unitUsable: false },
  ];
  const values = [
    { attributeSeq: 10013910, attributeValueSeq: 10760068, minAttributeValue: "페트병" },
    { attributeSeq: 10013911, attributeValueSeq: 10760072, minAttributeValue: "350", maxAttributeValue: "500", minAttributeValueUnitCode: "A02112", maxAttributeValueUnitCode: "A02112" },
    { attributeSeq: 10035708, attributeValueSeq: 10824637, minAttributeValue: "무설탕" },
    { attributeSeq: 10035708, attributeValueSeq: 11369031, minAttributeValue: "제로칼로리" },
    { attributeSeq: 10018618, attributeValueSeq: 10811008, maxAttributeValue: "50", maxAttributeValueUnitCode: "A02211" },
    { attributeSeq: 10014420, attributeValueSeq: 10771836, minAttributeValue: "실온보관" },
  ];
  const metadata = normalizeCategoryMetadata("smartstore", [{ steps: [
    { name: "attributes", ok: true, data: { items: attributes } },
    { name: "attribute-values", ok: true, data: { items: values } },
  ] }]);
  assert.equal(metadata.descriptors.length, 5);
  assert.deepEqual(metadata.unsupportedAttributeIds, []);
  const byId = new Map(metadata.descriptors.map(attribute => [attribute.id, attribute]));
  assert.equal(byId.get("10013910")?.inputKind, "single_select");
  assert.deepEqual(byId.get("10013910")?.values, [{ id: "10760068", name: "페트병" }]);
  assert.equal(byId.get("10013911")?.inputKind, "smartstore_range");
  assert.equal(byId.get("10035708")?.inputKind, "multi_select");
  const volume = { attributeValueSeq: 10760072, attributeRealValue: "500", attributeRealValueUnitCode: "A02112" };
  const calories = { attributeValueSeq: 10811008, attributeRealValue: "0", attributeRealValueUnitCode: "A02211" };
  const selected = { "10013910": "10760068", "10013911": JSON.stringify(volume), "10035708": ["10824637", "11369031"], "10018618": JSON.stringify(calories), "10014420": "10771836" };
  assert.deepEqual(missingCategoryInputIssues(metadata.descriptors, selected), []);
  assert.deepEqual(serializeCategoryAttributeValues("smartstore", metadata.descriptors, selected), { ...selected, "10013911": volume, "10018618": calories });
  for (const patch of [{ attributeRealValue: "501" }, { attributeRealValue: "-1" }, { attributeRealValueUnitCode: "kg" }, { attributeValueSeq: 10811008 }]) {
    assert.equal(categoryAttributeValueValid(byId.get("10013911")!, JSON.stringify({ ...volume, ...patch })), false);
  }
  assert.equal(categoryAttributeValueValid(byId.get("10035708")!, ["10824637", "10824637"]), false);
  assert.equal(categoryAttributeValueValid({ ...byId.get("10035708")!, maxValueCount: 1 }, selected["10035708"]), false);
  const restored = normalizeStoredCategoryAttribute(byId.get("10013911"))!;
  assert.equal(categoryAttributeValueValid(restored, selected["10013911"]), true);
  const markup = renderToStaticMarkup(createElement(CategoryAttributeField, { attribute: restored, value: selected["10013911"], onChange: () => {} }));
  assert.match(markup, /용량 공식 범위/);
  assert.match(markup, /value="500"/);
  assert.match(markup, /A02112/);
  assert.doesNotMatch(markup, /안전하게 편집할 수 없습니다/);
  const storedState = categoryStatesFromAssignments([{
    channel: "smartstore", environment: "production", market: "KR", category_id: "50002253",
    category_path: ["식품", "음료", "청량/탄산음료", "사이다"], is_leaf: true, confidence: 1, status: "confirmed",
    required_attributes: assignmentCategoryAttributeDescriptors(metadata.descriptors, selected),
    provided_attributes: serializeCategoryAttributeValues("smartstore", metadata.descriptors, selected),
  }]);
  const restoredState = Object.values(storedState)[0];
  assert.equal(restoredState?.values["10013911"], JSON.stringify(volume));
  assert.equal(normalizeCategoryMetadata("smartstore", [{ items: attributes }]).descriptors.every(attribute => attribute.inputKind === "unsupported"), true);
  assert.equal(normalizeCategoryMetadata("smartstore", [{ attributeSeq: 9, attributeName: "Unknown", attributeType: "PRIMARY" }]).descriptors[0]?.inputKind, "unsupported");
});

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
