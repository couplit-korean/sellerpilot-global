import {
  bindSmartstoreCategoryProductAttributes,
  buildSmartstoreCategoryProductAttributes,
  smartstoreProductAttributesDigest,
  type SmartstoreCategoryAttributeAssignment,
  type SmartstoreCategoryAttributeBlocker,
  type SmartstoreCategoryAttributeOfficialReadback,
} from "./channels/smartstore-category-attribute-mapping";

type UnknownRecord = Record<string, unknown>;

export const smartstoreCreateCategorySourceContract =
  "smartstore_listing_create_category_source_v1" as const;
export const smartstoreCategoryAttributeMappingArgument =
  "sellerpilotSmartstoreCategoryAttributeMapping" as const;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function mappingAliasMatches(
  candidateValue: unknown,
  expected: {
    categoryId: string;
    assignmentRevision: number;
    assignmentDigest: string;
    officialReadbackDigest: string;
    productAttributesSha256: string;
  },
) {
  const candidate = record(candidateValue);
  return candidate.categoryId === expected.categoryId
    && candidate.assignmentRevision === expected.assignmentRevision
    && candidate.assignmentDigest === expected.assignmentDigest
    && candidate.officialReadbackDigest === expected.officialReadbackDigest
    && candidate.productAttributesSha256 === expected.productAttributesSha256;
}

function aliasConflictBlocker(
  assignment: SmartstoreCategoryAttributeAssignment,
  official: SmartstoreCategoryAttributeOfficialReadback,
  fieldPath: string,
): SmartstoreCategoryAttributeBlocker {
  return {
    contract: "smartstore_category_attribute_blocker_v1",
    code: "SMARTSTORE_CATEGORY_ATTRIBUTE_BODY_MISMATCH",
    fieldPath,
    message: "브라우저 CREATE 입력과 현재 서버 category attribute source가 충돌합니다.",
    assignmentBinding: {
      categoryId: assignment.categoryId,
      revision: assignment.revision,
      digest: assignment.digest,
    },
    officialBinding: {
      categoryId: official.categoryId,
      assignmentRevision: official.assignmentRevision,
      assignmentDigest: official.assignmentDigest,
      digest: official.digest,
    },
    providerMutationAllowed: false,
    providerMutationCounts: { create: 0, put: 0 },
  };
}

export class SmartstoreCreateCategorySourceError extends Error {
  readonly blocker: SmartstoreCategoryAttributeBlocker;

  constructor(blocker: SmartstoreCategoryAttributeBlocker) {
    super(blocker.code);
    this.name = "SmartstoreCreateCategorySourceError";
    this.blocker = blocker;
  }
}

/**
 * Rebuilds the category mapping only from the current service-role snapshot.
 * Call this before request fingerprinting and operation claim. Browser aliases
 * may be absent or identical, but can never replace a server-owned value.
 */
export function bindSmartstoreCreateCategoryAttributesFromServerSource(input: {
  argumentsValue: Record<string, unknown>;
  sourceSnapshot: unknown;
}) {
  const sourceSnapshot = record(input.sourceSnapshot);
  const categorySource = record(sourceSnapshot.categoryAttributeSource);
  const assignment = categorySource.assignment as SmartstoreCategoryAttributeAssignment;
  const officialReadback = categorySource.officialReadback as SmartstoreCategoryAttributeOfficialReadback;
  if (categorySource.contract !== smartstoreCreateCategorySourceContract) {
    const result = buildSmartstoreCategoryProductAttributes({
      assignment,
      officialReadback,
    });
    if (!result.ok) throw new SmartstoreCreateCategorySourceError(result.blocker);
    throw new SmartstoreCreateCategorySourceError(
      aliasConflictBlocker(assignment, officialReadback, "sourceSnapshot.categoryAttributeSource.contract"),
    );
  }
  const mapping = buildSmartstoreCategoryProductAttributes({
    assignment,
    officialReadback,
  });
  if (!mapping.ok) throw new SmartstoreCreateCategorySourceError(mapping.blocker);

  const argumentsValue = structuredClone(input.argumentsValue);
  const body = record(argumentsValue.body);
  const originProduct = record(body.originProduct);
  const detailAttribute = record(originProduct.detailAttribute);
  if (String(originProduct.leafCategoryId ?? "").trim() !== mapping.categoryId) {
    throw new SmartstoreCreateCategorySourceError(
      aliasConflictBlocker(assignment, officialReadback, "arguments.body.originProduct.leafCategoryId"),
    );
  }
  if (Object.hasOwn(detailAttribute, "productAttributes")
      && smartstoreProductAttributesDigest(detailAttribute.productAttributes)
        !== mapping.productAttributesSha256) {
    throw new SmartstoreCreateCategorySourceError(
      aliasConflictBlocker(assignment, officialReadback, "arguments.body.originProduct.detailAttribute.productAttributes"),
    );
  }
  if (Object.hasOwn(argumentsValue, smartstoreCategoryAttributeMappingArgument)
      && !mappingAliasMatches(
        argumentsValue[smartstoreCategoryAttributeMappingArgument],
        mapping,
      )) {
    throw new SmartstoreCreateCategorySourceError(
      aliasConflictBlocker(assignment, officialReadback, `arguments.${smartstoreCategoryAttributeMappingArgument}`),
    );
  }
  delete argumentsValue[smartstoreCategoryAttributeMappingArgument];
  const bound = bindSmartstoreCategoryProductAttributes({
    body,
    mapping,
    assignment,
    officialReadback,
  });
  if (!bound.ok) throw new SmartstoreCreateCategorySourceError(bound.blocker);
  return {
    ...argumentsValue,
    body: bound.body,
    [smartstoreCategoryAttributeMappingArgument]: mapping,
  };
}
