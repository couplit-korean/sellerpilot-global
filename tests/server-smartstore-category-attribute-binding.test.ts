import assert from "node:assert/strict";
import test from "node:test";
import {
  smartstoreCategoryAttributeAssignmentContract,
  smartstoreCategoryAttributeAssignmentDigest,
  smartstoreCategoryAttributeOfficialReadbackContract,
  smartstoreCategoryAttributeOfficialReadbackDigest,
} from "../lib/channels/smartstore-category-attribute-mapping";
import {
  bindSmartstoreCreateCategoryAttributesFromServerSource,
  smartstoreCategoryAttributeMappingArgument,
  smartstoreCreateCategorySourceContract,
  SmartstoreCreateCategorySourceError,
} from "../lib/server-smartstore-category-attribute-binding";

const categoryId = "50022679";

function sourceSnapshot(input: {
  categoryId?: string;
  officialCategoryId?: string;
  officialRevision?: number;
} = {}) {
  const selectedCategoryId = input.categoryId ?? categoryId;
  const assignmentSource = {
    contract: smartstoreCategoryAttributeAssignmentContract,
    channel: "smartstore" as const,
    operation: "listing.create" as const,
    environment: "production" as const,
    market: "KR" as const,
    status: "confirmed" as const,
    categoryId: selectedCategoryId,
    revision: 7,
    providedAttributes: [],
  };
  const assignment = {
    ...assignmentSource,
    digest: smartstoreCategoryAttributeAssignmentDigest(assignmentSource),
  };
  const officialCategoryId = input.officialCategoryId ?? selectedCategoryId;
  const officialSource = {
    contract: smartstoreCategoryAttributeOfficialReadbackContract,
    categoryId: officialCategoryId,
    assignmentRevision: input.officialRevision ?? assignment.revision,
    assignmentDigest: assignment.digest,
    category: { id: officialCategoryId, name: "생활용품", last: true },
    attributes: [],
    attributeValues: [],
    attributeValueUnits: [],
  };
  const officialReadback = {
    ...officialSource,
    digest: smartstoreCategoryAttributeOfficialReadbackDigest(officialSource),
  };
  return {
    contract: "smartstore_listing_create_source_snapshot_v1",
    categoryAttributeSource: {
      contract: smartstoreCreateCategorySourceContract,
      assignment,
      officialReadback,
    },
  };
}

function argumentsValue(category = categoryId) {
  return {
    body: {
      originProduct: {
        leafCategoryId: category,
        detailAttribute: {
          sellerCodeInfo: { sellerManagementCode: "SMARTSTORE-010" },
        },
      },
    },
  };
}

function assertBlocked(action: () => unknown, code: string, fieldPath?: string) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof SmartstoreCreateCategorySourceError);
    assert.equal(error.blocker.code, code);
    if (fieldPath) assert.equal(error.blocker.fieldPath, fieldPath);
    assert.equal(error.blocker.providerMutationAllowed, false);
    assert.deepEqual(error.blocker.providerMutationCounts, { create: 0, put: 0 });
    return true;
  });
}

test("server source regenerates and binds an immutable exact category mapping", () => {
  const source = sourceSnapshot();
  const input = argumentsValue();
  const sourceBefore = structuredClone(source);
  const inputBefore = structuredClone(input);
  const bound = bindSmartstoreCreateCategoryAttributesFromServerSource({
    argumentsValue: input,
    sourceSnapshot: source,
  });
  assert.deepEqual(source, sourceBefore);
  assert.deepEqual(input, inputBefore);
  assert.deepEqual(
    ((bound.body as typeof input.body).originProduct.detailAttribute).productAttributes,
    [],
  );
  const mapping = bound[smartstoreCategoryAttributeMappingArgument];
  assert.equal(mapping.ok, true);
  assert.equal(mapping.categoryId, categoryId);
  assert.equal(mapping.assignmentRevision, 7);
  assert.equal(
    mapping.assignmentDigest,
    source.categoryAttributeSource.assignment.digest,
  );
  assert.equal(
    mapping.officialReadbackDigest,
    source.categoryAttributeSource.officialReadback.digest,
  );

  const clientAlias = { ...structuredClone(mapping), clientOnly: "discard-me" };
  const rebound = bindSmartstoreCreateCategoryAttributesFromServerSource({
    argumentsValue: {
      ...argumentsValue(),
      [smartstoreCategoryAttributeMappingArgument]: clientAlias,
    },
    sourceSnapshot: source,
  });
  assert.deepEqual(rebound[smartstoreCategoryAttributeMappingArgument], mapping);
  assert.equal(
    Object.hasOwn(rebound[smartstoreCategoryAttributeMappingArgument], "clientOnly"),
    false,
  );
});

test("missing, stale, and cross-category server sources fail closed", () => {
  assertBlocked(
    () => bindSmartstoreCreateCategoryAttributesFromServerSource({
      argumentsValue: argumentsValue(),
      sourceSnapshot: {},
    }),
    "SMARTSTORE_CATEGORY_ASSIGNMENT_INVALID",
  );
  assertBlocked(
    () => bindSmartstoreCreateCategoryAttributesFromServerSource({
      argumentsValue: argumentsValue(),
      sourceSnapshot: sourceSnapshot({ officialRevision: 6 }),
    }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_STALE",
  );
  assertBlocked(
    () => bindSmartstoreCreateCategoryAttributesFromServerSource({
      argumentsValue: argumentsValue(),
      sourceSnapshot: sourceSnapshot({ officialCategoryId: "50000000" }),
    }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY",
  );
});

test("browser body and mapping aliases cannot override the current server source", () => {
  assertBlocked(
    () => bindSmartstoreCreateCategoryAttributesFromServerSource({
      argumentsValue: argumentsValue("50000000"),
      sourceSnapshot: sourceSnapshot(),
    }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_BODY_MISMATCH",
    "arguments.body.originProduct.leafCategoryId",
  );

  const productAttributesConflict = argumentsValue();
  productAttributesConflict.body.originProduct.detailAttribute = {
    ...productAttributesConflict.body.originProduct.detailAttribute,
    productAttributes: [{ attributeSeq: 1, attributeValueSeq: 2 }],
  };
  assertBlocked(
    () => bindSmartstoreCreateCategoryAttributesFromServerSource({
      argumentsValue: productAttributesConflict,
      sourceSnapshot: sourceSnapshot(),
    }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_BODY_MISMATCH",
    "arguments.body.originProduct.detailAttribute.productAttributes",
  );

  const aliasConflict = {
    ...argumentsValue(),
    [smartstoreCategoryAttributeMappingArgument]: {
      categoryId,
      assignmentRevision: 999,
      assignmentDigest: "a".repeat(64),
      officialReadbackDigest: "b".repeat(64),
      productAttributesSha256: "c".repeat(64),
    },
  };
  assertBlocked(
    () => bindSmartstoreCreateCategoryAttributesFromServerSource({
      argumentsValue: aliasConflict,
      sourceSnapshot: sourceSnapshot(),
    }),
    "SMARTSTORE_CATEGORY_ATTRIBUTE_BODY_MISMATCH",
    `arguments.${smartstoreCategoryAttributeMappingArgument}`,
  );
});
