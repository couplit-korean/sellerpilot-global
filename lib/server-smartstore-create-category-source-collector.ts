import "server-only";

import type { ChannelOperationResult } from "./channels/commerce-operations";
import {
  buildSmartstoreCategoryProductAttributes,
  smartstoreCategoryAttributeAssignmentContract,
  smartstoreCategoryAttributeAssignmentDigest,
  smartstoreCategoryAttributeOfficialReadbackContract,
  smartstoreCategoryAttributeOfficialReadbackDigest,
  type SmartstoreCategoryAttributeAssignment,
  type SmartstoreCategoryAttributeOfficialReadback,
  type SmartstoreCategoryAttributeSelection,
} from "./channels/smartstore-category-attribute-mapping";

type UnknownRecord = Record<string, unknown>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^[a-f0-9]{64}$/u;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const row = record(value);
  if (!row) return value;
  return Object.fromEntries(Object.entries(row)
    .sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
    .map(([key, child]) => [key, canonical(child)]));
}

function sameCanonical(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function positiveInteger(value: unknown) {
  const normalized = typeof value === "number" ? value : Number(text(value));
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

export type SmartstoreCreateCategorySourceCollectionContext = {
  contract: "smartstore_create_category_source_collection_context_v1";
  ownerId: string;
  productId: string;
  productUpdatedAt: string;
  credentialId: string;
  credentialVersion: number;
  sellerAccountKey: string;
  approvedDetailRevision: number;
  approvedDetailDigest: string;
  assignmentId: string;
  assignmentUpdatedAt: string;
  categoryId: string;
  providedAttributes: UnknownRecord;
};

export function parseSmartstoreCreateCategorySourceCollectionContext(
  value: unknown,
): SmartstoreCreateCategorySourceCollectionContext {
  const row = record(value);
  const ownerId = text(row?.ownerId).toLowerCase();
  const productId = text(row?.productId).toLowerCase();
  const productUpdatedAt = text(row?.productUpdatedAt);
  const credentialId = text(row?.credentialId).toLowerCase();
  const credentialVersion = positiveInteger(row?.credentialVersion);
  const sellerAccountKey = text(row?.sellerAccountKey).toLowerCase();
  const approvedDetailRevision = positiveInteger(row?.approvedDetailRevision);
  const approvedDetailDigest = text(row?.approvedDetailDigest).toLowerCase();
  const assignmentId = text(row?.assignmentId).toLowerCase();
  const assignmentUpdatedAt = text(row?.assignmentUpdatedAt);
  const categoryId = text(row?.categoryId);
  const providedAttributes = record(row?.providedAttributes);
  if (row?.contract !== "smartstore_create_category_source_collection_context_v1"
      || !uuidPattern.test(ownerId)
      || !uuidPattern.test(productId)
      || !uuidPattern.test(credentialId)
      || !uuidPattern.test(assignmentId)
      || !Number.isSafeInteger(Date.parse(productUpdatedAt))
      || !Number.isSafeInteger(Date.parse(assignmentUpdatedAt))
      || !credentialVersion
      || !approvedDetailRevision
      || !digestPattern.test(sellerAccountKey)
      || !digestPattern.test(approvedDetailDigest)
      || !categoryId
      || categoryId.length > 120
      || !providedAttributes) {
    throw new Error("SMARTSTORE_CATEGORY_SOURCE_COLLECTION_CONTEXT_INVALID");
  }
  return {
    contract: row.contract,
    ownerId,
    productId,
    productUpdatedAt,
    credentialId,
    credentialVersion,
    sellerAccountKey,
    approvedDetailRevision,
    approvedDetailDigest,
    assignmentId,
    assignmentUpdatedAt,
    categoryId,
    providedAttributes,
  };
}

function successfulStep(result: ChannelOperationResult, name: string) {
  const matches = result.steps.filter((step) => step.name === name);
  if (matches.length !== 1 || !matches[0].ok) {
    throw new Error(`SMARTSTORE_CATEGORY_SOURCE_OFFICIAL_${name.toUpperCase().replaceAll("-", "_")}_FAILED`);
  }
  return matches[0].data;
}

function exactCollection(value: unknown, field: string): UnknownRecord[] {
  const wrapper = record(value);
  const items = Array.isArray(value)
    ? value
    : wrapper && Array.isArray(wrapper.items)
      ? wrapper.items
      : wrapper && Array.isArray(wrapper.contents)
        ? wrapper.contents
        : wrapper && Array.isArray(wrapper.data)
          ? wrapper.data
          : null;
  if (!items || items.some((item) => !record(item))) {
    throw new Error(`SMARTSTORE_CATEGORY_SOURCE_OFFICIAL_${field}_INVALID`);
  }
  return items.map((item) => structuredClone(record(item)!));
}

function exactStringCollection(value: unknown, field: string) {
  if (!Array.isArray(value)
      || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`SMARTSTORE_CATEGORY_SOURCE_OFFICIAL_${field}_INVALID`);
  }
  return value.map((item) => item.trim());
}

function exactCertificationInfos(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error(
      "SMARTSTORE_CATEGORY_SOURCE_OFFICIAL_CERTIFICATION_INFOS_INVALID",
    );
  }
  return value.map((item) => {
    const row = record(item);
    const id = positiveInteger(row?.id);
    const name = text(row?.name);
    if (!row
        || !id
        || !name) {
      throw new Error(
        "SMARTSTORE_CATEGORY_SOURCE_OFFICIAL_CERTIFICATION_INFOS_INVALID",
      );
    }
    return {
      id,
      name,
      kindTypes: exactStringCollection(
        row.kindTypes,
        "CERTIFICATION_KIND_TYPES",
      ),
    };
  });
}

function exactCategory(value: unknown, expectedCategoryId: string) {
  const row = record(value);
  if (!row
      || text(row.id) !== expectedCategoryId
      || row.last !== true
      || (Object.hasOwn(row, "name") && !text(row.name))
      || (Object.hasOwn(row, "wholeCategoryName")
        && !text(row.wholeCategoryName))) {
    throw new Error("SMARTSTORE_CATEGORY_SOURCE_OFFICIAL_CATEGORY_DRIFT");
  }
  // The Naver category response contains policy metadata that is unrelated to
  // the attribute mapping but is still part of the documented official
  // evidence. Project only the documented fields so transport/debug additions
  // can never poison the durable source or leak through its snapshot.
  return {
    id: expectedCategoryId,
    ...(Object.hasOwn(row, "name") ? { name: text(row.name) } : {}),
    ...(Object.hasOwn(row, "wholeCategoryName")
      ? { wholeCategoryName: text(row.wholeCategoryName) }
      : {}),
    last: true,
    ...(Object.hasOwn(row, "exceptionalCategories")
      ? {
          exceptionalCategories: exactStringCollection(
            row.exceptionalCategories,
            "EXCEPTIONAL_CATEGORIES",
          ),
        }
      : {}),
    ...(Object.hasOwn(row, "certificationInfos")
      ? { certificationInfos: exactCertificationInfos(row.certificationInfos) }
      : {}),
  };
}

export type SmartstoreCreateCategoryOfficialReceipt = {
  category: UnknownRecord;
  attributes: UnknownRecord[];
  attributeValues: UnknownRecord[];
  attributeValueUnits: UnknownRecord[];
};

export function smartstoreCreateCategoryOfficialReceipt(
  result: ChannelOperationResult,
  expectedCategoryId: string,
): SmartstoreCreateCategoryOfficialReceipt {
  if (result.channel !== "smartstore"
      || result.operation !== "categories.attributes"
      || result.ok !== true
      || result.steps.length !== 4
      || ![
        "category",
        "attributes",
        "attribute-values",
        "attribute-value-units",
      ].every((name) => result.steps.some((step) => step.name === name))) {
    throw new Error("SMARTSTORE_CATEGORY_SOURCE_OFFICIAL_RESULT_INVALID");
  }
  const category = exactCategory(
    successfulStep(result, "category"),
    expectedCategoryId,
  );
  return {
    category,
    attributes: exactCollection(
      successfulStep(result, "attributes"),
      "ATTRIBUTES",
    ),
    attributeValues: exactCollection(
      successfulStep(result, "attribute-values"),
      "ATTRIBUTE_VALUES",
    ),
    attributeValueUnits: exactCollection(
      successfulStep(result, "attribute-value-units"),
      "ATTRIBUTE_VALUE_UNITS",
    ),
  };
}

function storedSelections(
  providedAttributes: UnknownRecord,
  official: SmartstoreCreateCategoryOfficialReceipt,
): SmartstoreCategoryAttributeSelection[] {
  const attributes = new Map(official.attributes.map((item) => [
    positiveInteger(item.attributeSeq),
    text(item.attributeClassificationType).toUpperCase(),
  ]));
  const selections: SmartstoreCategoryAttributeSelection[] = [];
  for (const [attributeKey, stored] of Object.entries(providedAttributes)) {
    const attributeSeq = positiveInteger(attributeKey);
    const classification = attributeSeq ? attributes.get(attributeSeq) : null;
    if (!attributeSeq || !classification) {
      throw new Error("SMARTSTORE_CATEGORY_SOURCE_STORED_ATTRIBUTE_UNKNOWN");
    }
    if (classification === "SINGLE_SELECT" || classification === "MULTI_SELECT") {
      const values = Array.isArray(stored) ? stored : [stored];
      if (!values.length) {
        throw new Error("SMARTSTORE_CATEGORY_SOURCE_STORED_SELECTION_INVALID");
      }
      for (const value of values) {
        const attributeValueSeq = positiveInteger(value);
        if (!attributeValueSeq) {
          throw new Error("SMARTSTORE_CATEGORY_SOURCE_STORED_SELECTION_INVALID");
        }
        selections.push({ attributeSeq, attributeValueSeq });
      }
      continue;
    }
    if (classification === "RANGE") {
      const range = record(stored);
      const attributeValueSeq = positiveInteger(range?.attributeValueSeq);
      const attributeRealValue = text(range?.attributeRealValue);
      const attributeRealValueUnitCode = text(
        range?.attributeRealValueUnitCode,
      );
      if (!range
          || Object.keys(range).some((key) => ![
            "attributeValueSeq",
            "attributeRealValue",
            "attributeRealValueUnitCode",
          ].includes(key))
          || !attributeValueSeq
          || !attributeRealValue) {
        throw new Error("SMARTSTORE_CATEGORY_SOURCE_STORED_RANGE_INVALID");
      }
      selections.push({
        attributeSeq,
        attributeValueSeq,
        attributeRealValue,
        ...(attributeRealValueUnitCode ? { attributeRealValueUnitCode } : {}),
      });
      continue;
    }
    throw new Error("SMARTSTORE_CATEGORY_SOURCE_STORED_CLASSIFICATION_UNSUPPORTED");
  }
  return selections;
}

export function smartstoreCreateProviderAttributes(input: {
  context: SmartstoreCreateCategorySourceCollectionContext;
  official: SmartstoreCreateCategoryOfficialReceipt;
}) {
  const assignmentSource = {
    contract: smartstoreCategoryAttributeAssignmentContract,
    channel: "smartstore" as const,
    operation: "listing.create" as const,
    environment: "production" as const,
    market: "KR" as const,
    status: "confirmed" as const,
    categoryId: input.context.categoryId,
    revision: 1,
    providedAttributes: storedSelections(
      input.context.providedAttributes,
      input.official,
    ),
  };
  const assignment = {
    ...assignmentSource,
    digest: smartstoreCategoryAttributeAssignmentDigest(assignmentSource),
  };
  const officialSource: Omit<SmartstoreCategoryAttributeOfficialReadback, "digest"> = {
    contract: smartstoreCategoryAttributeOfficialReadbackContract,
    categoryId: input.context.categoryId,
    assignmentRevision: assignment.revision,
    assignmentDigest: assignment.digest,
    ...input.official,
  };
  const officialReadback = {
    ...officialSource,
    digest: smartstoreCategoryAttributeOfficialReadbackDigest(officialSource),
  };
  const mapping = buildSmartstoreCategoryProductAttributes({
    assignment,
    officialReadback,
  });
  if (!mapping.ok) throw new Error(mapping.blocker.code);
  return mapping.productAttributes;
}

export function assertSmartstoreCreateCategorySourceFreshSnapshot(input: {
  context: SmartstoreCreateCategorySourceCollectionContext;
  freshContext: unknown;
  sourceSnapshot: unknown;
  official: SmartstoreCreateCategoryOfficialReceipt;
  providerAttributes: unknown;
}) {
  const freshContext = parseSmartstoreCreateCategorySourceCollectionContext(
    input.freshContext,
  );
  if (!sameCanonical(freshContext, input.context)) {
    throw new Error("SMARTSTORE_CATEGORY_SOURCE_FRESH_CONTEXT_DRIFT");
  }
  const snapshot = record(input.sourceSnapshot);
  const categorySource = record(snapshot?.categoryAttributeSource);
  const assignment = record(categorySource?.assignment);
  const officialReadback = record(categorySource?.officialReadback);
  const collectedAt = text(categorySource?.collectedAt);
  const expiresAt = text(categorySource?.expiresAt);
  if (snapshot?.contract !== "smartstore_listing_create_source_snapshot_v1"
      || text(snapshot.productId).toLowerCase() !== input.context.productId
      || text(snapshot.ownerId).toLowerCase() !== input.context.ownerId
      || text(snapshot.productUpdatedAt) !== input.context.productUpdatedAt
      || Number(snapshot.detailPageVersion) !== input.context.approvedDetailRevision
      || Number(snapshot.approvedDetailPageVersion) !== input.context.approvedDetailRevision
      || text(snapshot.approvedManifestDigest).toLowerCase()
        !== input.context.approvedDetailDigest
      || text(snapshot.credentialId).toLowerCase() !== input.context.credentialId
      || Number(snapshot.credentialVersion) !== input.context.credentialVersion
      || categorySource?.contract !== "smartstore_listing_create_category_source_v1"
      || !Number.isSafeInteger(Date.parse(collectedAt))
      || !Number.isSafeInteger(Date.parse(expiresAt))
      || Date.parse(expiresAt) <= Date.parse(collectedAt)
      || !assignment
      || !officialReadback) {
    throw new Error("SMARTSTORE_CATEGORY_SOURCE_FRESH_SNAPSHOT_INVALID");
  }
  const mapping = buildSmartstoreCategoryProductAttributes({
    assignment: assignment as SmartstoreCategoryAttributeAssignment,
    officialReadback:
      officialReadback as SmartstoreCategoryAttributeOfficialReadback,
  });
  if (!mapping.ok
      || mapping.categoryId !== input.context.categoryId
      || !sameCanonical(mapping.productAttributes, input.providerAttributes)) {
    throw new Error("SMARTSTORE_CATEGORY_SOURCE_FRESH_MAPPING_MISMATCH");
  }
  const expectedOfficial = {
    contract: smartstoreCategoryAttributeOfficialReadbackContract,
    categoryId: input.context.categoryId,
    assignmentRevision: mapping.assignmentRevision,
    assignmentDigest: mapping.assignmentDigest,
    ...input.official,
  };
  if (smartstoreCategoryAttributeOfficialReadbackDigest(expectedOfficial)
      !== mapping.officialReadbackDigest) {
    throw new Error("SMARTSTORE_CATEGORY_SOURCE_FRESH_OFFICIAL_MISMATCH");
  }
  return mapping;
}
