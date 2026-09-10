import assert from "node:assert/strict";
import test from "node:test";
import {
  bindSmartstoreCategoryProductAttributes,
  buildSmartstoreCategoryProductAttributes,
  smartstoreCategoryAttributeAssignmentContract,
  smartstoreCategoryAttributeAssignmentDigest,
  smartstoreCategoryAttributeMappingContract,
  smartstoreCategoryAttributeOfficialReadbackContract,
  smartstoreCategoryAttributeOfficialReadbackDigest,
  verifySmartstoreCategoryAttributeCreateBinding,
  type SmartstoreCategoryAttributeAssignment,
  type SmartstoreCategoryAttributeOfficialReadback,
  type SmartstoreCategoryAttributeSelection,
} from "../lib/channels/smartstore-category-attribute-mapping";
import { executeChannelOperation } from "../lib/channels/commerce-operations";

const categoryId = "50022679";

const attributes = [
  {
    attributeSeq: 10014353,
    attributeName: "무게",
    attributeClassificationType: "RANGE",
    attributeType: "PRIMARY",
    unitUsable: true,
    representativeUnitCode: "A02002",
    attributeValueMaxMatchingCount: 0,
  },
  {
    attributeSeq: 10020580,
    attributeName: "품종",
    attributeClassificationType: "SINGLE_SELECT",
    attributeType: "PRIMARY",
    unitUsable: false,
    attributeValueMaxMatchingCount: 0,
  },
  {
    attributeSeq: 10014442,
    attributeName: "수확시기",
    attributeClassificationType: "MULTI_SELECT",
    attributeType: "OPTIONAL",
    unitUsable: false,
    attributeValueMaxMatchingCount: 2,
  },
];

const attributeValues = [
  {
    attributeSeq: 10014353,
    attributeValueSeq: 10177361,
    minAttributeValue: "3",
    minAttributeValueUnitCode: "A02002",
    maxAttributeValue: "5",
    maxAttributeValueUnitCode: "A02002",
  },
  { attributeSeq: 10020580, attributeValueSeq: 10832333, minAttributeValue: "설향" },
  { attributeSeq: 10014442, attributeValueSeq: 10972472, minAttributeValue: "가을" },
  { attributeSeq: 10014442, attributeValueSeq: 10972474, minAttributeValue: "겨울" },
  { attributeSeq: 10014442, attributeValueSeq: 10972476, minAttributeValue: "봄" },
];

const units = [
  { id: "A02001", unitCodeName: "ℓ" },
  { id: "A02002", unitCodeName: "kg" },
];

function confirmedAssignment(
  providedAttributes: SmartstoreCategoryAttributeSelection[] = [
    {
      attributeSeq: 10014353,
      attributeValueSeq: 10177361,
      attributeRealValue: "4.5",
      attributeRealValueUnitCode: "A02002",
    },
    { attributeSeq: 10020580, attributeValueSeq: 10832333 },
    { attributeSeq: 10014442, attributeValueSeq: 10972474 },
    { attributeSeq: 10014442, attributeValueSeq: 10972472 },
  ],
): SmartstoreCategoryAttributeAssignment {
  const source = {
    contract: smartstoreCategoryAttributeAssignmentContract,
    channel: "smartstore" as const,
    operation: "listing.create" as const,
    environment: "production" as const,
    market: "KR" as const,
    status: "confirmed" as const,
    categoryId,
    revision: 7,
    providedAttributes,
  };
  return { ...source, digest: smartstoreCategoryAttributeAssignmentDigest(source) };
}

function officialReadback(
  assignment: SmartstoreCategoryAttributeAssignment,
  overrides: Partial<Omit<SmartstoreCategoryAttributeOfficialReadback, "digest">> = {},
): SmartstoreCategoryAttributeOfficialReadback {
  const source = {
    contract: smartstoreCategoryAttributeOfficialReadbackContract,
    categoryId: assignment.categoryId,
    assignmentRevision: assignment.revision,
    assignmentDigest: assignment.digest,
    category: { id: assignment.categoryId, name: "과일", last: true },
    attributes,
    attributeValues,
    attributeValueUnits: units,
    ...overrides,
  };
  return {
    ...source,
    digest: smartstoreCategoryAttributeOfficialReadbackDigest(source),
  };
}

function assertBlocker(
  result: ReturnType<typeof buildSmartstoreCategoryProductAttributes>,
  code: string,
) {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.blocker.code, code);
  assert.equal(result.blocker.providerMutationAllowed, false);
  assert.deepEqual(result.blocker.providerMutationCounts, { create: 0, put: 0 });
}

test("exact confirmed assignment maps SELECT, MULTI_SELECT, and RANGE to provider-native productAttributes", () => {
  const assignment = confirmedAssignment();
  const readback = officialReadback(assignment);
  const result = buildSmartstoreCategoryProductAttributes({ assignment, officialReadback: readback });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.contract, smartstoreCategoryAttributeMappingContract);
  assert.equal(result.categoryId, categoryId);
  assert.equal(result.assignmentRevision, 7);
  assert.equal(result.assignmentDigest, assignment.digest);
  assert.equal(result.officialReadbackDigest, readback.digest);
  assert.deepEqual(result.productAttributes, [
    { attributeSeq: 10014353, attributeValueSeq: 10177361, attributeRealValue: "4.5", attributeRealValueUnitCode: "A02002" },
    { attributeSeq: 10014442, attributeValueSeq: 10972472 },
    { attributeSeq: 10014442, attributeValueSeq: 10972474 },
    { attributeSeq: 10020580, attributeValueSeq: 10832333 },
  ]);
  assert.match(result.productAttributesSha256, /^[a-f0-9]{64}$/u);

  const body = {
    originProduct: {
      leafCategoryId: categoryId,
      detailAttribute: { sellerCodeInfo: { sellerManagementCode: "SMARTSTORE-009" } },
    },
  };
  const before = structuredClone(body);
  const bound = bindSmartstoreCategoryProductAttributes({
    body,
    mapping: result,
    assignment,
    officialReadback: readback,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) return;
  assert.deepEqual(body, before, "binding must not mutate the caller's CREATE body");
  assert.deepEqual(
    ((bound.body.originProduct as Record<string, unknown>).detailAttribute as Record<string, unknown>)
      .productAttributes,
    result.productAttributes,
  );
});

test("final CREATE boundary accepts only the exact mapping receipt and bound body", () => {
  const assignment = confirmedAssignment();
  const mapping = buildSmartstoreCategoryProductAttributes({
    assignment,
    officialReadback: officialReadback(assignment),
  });
  assert.equal(mapping.ok, true);
  if (!mapping.ok) return;
  const body = {
    originProduct: {
      leafCategoryId: categoryId,
      detailAttribute: {
        productAttributes: structuredClone(mapping.productAttributes),
      },
    },
  };
  assert.deepEqual(verifySmartstoreCategoryAttributeCreateBinding({ body, mapping }), {
    ok: true,
    mapping,
  });

  for (const [variant, expectedCode, mutate] of [
    ["missing", "SMARTSTORE_CATEGORY_ATTRIBUTE_MAPPING_INVALID", (candidateBody: typeof body, candidateMapping: typeof mapping) => {
      void candidateBody;
      void candidateMapping;
    }],
    ["digest", "SMARTSTORE_CATEGORY_ATTRIBUTE_MAPPING_INVALID", (candidateBody: typeof body, candidate: typeof mapping) => {
      void candidateBody;
      candidate.productAttributesSha256 = "d".repeat(64);
    }],
    ["category", "SMARTSTORE_CATEGORY_ATTRIBUTE_BODY_MISMATCH", (candidateBody: typeof body, candidate: typeof mapping) => {
      void candidateBody;
      candidate.categoryId = "50000000";
    }],
    ["body", "SMARTSTORE_CATEGORY_ATTRIBUTE_BODY_MISMATCH", (candidateBody: typeof body, candidateMapping: typeof mapping) => {
      void candidateMapping;
      candidateBody.originProduct.detailAttribute.productAttributes[0]!.attributeValueSeq += 1;
    }],
  ] as const) {
    const candidateBody = structuredClone(body);
    const candidateMapping = structuredClone(mapping);
    mutate(candidateBody, candidateMapping);
    const result = verifySmartstoreCategoryAttributeCreateBinding({
      body: candidateBody,
      mapping: variant === "missing" ? undefined : candidateMapping,
    });
    assert.equal(result.ok, false, variant);
    if (result.ok) continue;
    assert.equal(result.blocker.code, expectedCode, variant);
    assert.equal(result.blocker.providerMutationAllowed, false, variant);
    assert.deepEqual(result.blocker.providerMutationCounts, { create: 0, put: 0 }, variant);
  }
});

test("stale assignment revision or digest returns a pre-provider structured blocker", () => {
  const assignment = confirmedAssignment();
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({
      assignment,
      officialReadback: officialReadback(assignment, { assignmentRevision: 6 }),
    }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_STALE",
  );
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({
      assignment,
      officialReadback: officialReadback(assignment, { assignmentDigest: "a".repeat(64) }),
    }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_STALE",
  );
});

test("cross-category readback, body, attribute, or value cannot be bound", () => {
  const assignment = confirmedAssignment();
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({
      assignment,
      officialReadback: officialReadback(assignment, {
        categoryId: "50000000",
        category: { id: "50000000", last: true },
      }),
    }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY",
  );

  const crossValueAssignment = confirmedAssignment([
    { attributeSeq: 10014353, attributeValueSeq: 99999999, attributeRealValue: "4.5", attributeRealValueUnitCode: "A02002" },
    { attributeSeq: 10020580, attributeValueSeq: 10832333 },
  ]);
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({
      assignment: crossValueAssignment,
      officialReadback: officialReadback(crossValueAssignment),
    }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY",
  );

  const mapping = buildSmartstoreCategoryProductAttributes({ assignment, officialReadback: officialReadback(assignment) });
  const bound = bindSmartstoreCategoryProductAttributes({
    body: { originProduct: { leafCategoryId: "50000000", detailAttribute: {} } },
    mapping,
    assignment,
    officialReadback: officialReadback(assignment),
  });
  assert.equal(bound.ok, false);
  if (!bound.ok) {
    assert.equal(bound.blocker.code, "SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY");
    assert.deepEqual(bound.blocker.providerMutationCounts, { create: 0, put: 0 });
  }
});

test("duplicate pair and missing PRIMARY attribute are fail-closed before CREATE or PUT", () => {
  const duplicate = confirmedAssignment([
    { attributeSeq: 10014353, attributeValueSeq: 10177361, attributeRealValue: "4.5", attributeRealValueUnitCode: "A02002" },
    { attributeSeq: 10020580, attributeValueSeq: 10832333 },
    { attributeSeq: 10020580, attributeValueSeq: 10832333 },
  ]);
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({ assignment: duplicate, officialReadback: officialReadback(duplicate) }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_DUPLICATE_PAIR",
  );

  const missing = confirmedAssignment([
    { attributeSeq: 10014353, attributeValueSeq: 10177361, attributeRealValue: "4.5", attributeRealValueUnitCode: "A02002" },
  ]);
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({ assignment: missing, officialReadback: officialReadback(missing) }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_REQUIRED_MISSING",
  );
});

test("unknown RANGE unit, out-of-range real value, and SELECT range fields are blocked", () => {
  const unknownUnit = confirmedAssignment([
    { attributeSeq: 10014353, attributeValueSeq: 10177361, attributeRealValue: "4.5", attributeRealValueUnitCode: "A09999" },
    { attributeSeq: 10020580, attributeValueSeq: 10832333 },
  ]);
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({ assignment: unknownUnit, officialReadback: officialReadback(unknownUnit) }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_UNKNOWN_UNIT",
  );

  const outOfRange = confirmedAssignment([
    { attributeSeq: 10014353, attributeValueSeq: 10177361, attributeRealValue: "6", attributeRealValueUnitCode: "A02002" },
    { attributeSeq: 10020580, attributeValueSeq: 10832333 },
  ]);
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({ assignment: outOfRange, officialReadback: officialReadback(outOfRange) }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_REAL_VALUE_INVALID",
  );

  const selectWithRange = confirmedAssignment([
    { attributeSeq: 10014353, attributeValueSeq: 10177361, attributeRealValue: "4.5", attributeRealValueUnitCode: "A02002" },
    { attributeSeq: 10020580, attributeValueSeq: 10832333, attributeRealValue: "1" },
  ]);
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({ assignment: selectWithRange, officialReadback: officialReadback(selectWithRange) }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_VALUE_INVALID",
  );
});

test("MULTI_SELECT respects the official maximum and tampered digests never reach mapping", () => {
  const tooMany = confirmedAssignment([
    { attributeSeq: 10014353, attributeValueSeq: 10177361, attributeRealValue: "4.5", attributeRealValueUnitCode: "A02002" },
    { attributeSeq: 10020580, attributeValueSeq: 10832333 },
    { attributeSeq: 10014442, attributeValueSeq: 10972472 },
    { attributeSeq: 10014442, attributeValueSeq: 10972474 },
    { attributeSeq: 10014442, attributeValueSeq: 10972476 },
  ]);
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({ assignment: tooMany, officialReadback: officialReadback(tooMany) }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_TOO_MANY_VALUES",
  );

  const assignment = confirmedAssignment();
  const tamperedAssignment = { ...assignment, digest: "b".repeat(64) };
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({ assignment: tamperedAssignment, officialReadback: officialReadback(tamperedAssignment) }),
    "SMARTSTORE_CATEGORY_ASSIGNMENT_DIGEST_MISMATCH",
  );
  const readback = officialReadback(assignment);
  const tamperedReadback = { ...readback, digest: "c".repeat(64) };
  assertBlocker(
    buildSmartstoreCategoryProductAttributes({ assignment, officialReadback: tamperedReadback }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_READBACK_DIGEST_MISMATCH",
  );
});

test("categories.attributes can opt into the official unit readback without CREATE or PUT", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (url.endsWith(`/v1/categories/${categoryId}`)) {
      return Response.json({ id: categoryId, last: true });
    }
    if (url.includes("/v1/product-attributes/attributes")) return Response.json(attributes);
    if (url.includes("/v1/product-attributes/attribute-values")) return Response.json(attributeValues);
    if (url.endsWith("/v1/product-attributes/attribute-value-units")) return Response.json(units);
    if (url.includes("/v1/options/standard-options")) return Response.json([]);
    throw new Error(`unexpected fixture URL: ${url}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "categories.attributes",
      payload: {
        access_token: "fixture-token",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
      },
      arguments: {
        categoryId,
        includeAttributeValueUnits: true,
        includeStandardOptions: false,
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps.map((item) => item.name), [
      "category",
      "attributes",
      "attribute-values",
      "attribute-value-units",
    ]);
    assert.equal(calls.length, 4);
    assert.equal(calls.every(({ method }) => method === "GET"), true);
    assert.equal(calls.some(({ url }) =>
      url.endsWith("/v1/product-attributes/attribute-value-units")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
