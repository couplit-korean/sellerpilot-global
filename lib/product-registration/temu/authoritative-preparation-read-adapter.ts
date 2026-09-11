import { createHash } from "node:crypto";

import {
  runWithProviderReadOnlyTransport,
  temuRequest,
  type RemoteResponse,
  type SecretPayload,
} from "../../channels/protocols";
import { readTemuAccountIdentityBinding } from "./account-identity";
import {
  classifyTemuEgressAllowlistFailure,
  resolveTemuEgressFingerprint,
  temuEgressAllowlistMessage,
} from "./egress-allowlist-failure";
import type {
  TemuAuthoritativeClock,
  TemuAuthoritativeReadDependencies,
  TemuOfficialAppRow,
} from "./authoritative-source-collector";

export type TemuPreparationReadMethod =
  | "bg.local.goods.category.recommend"
  | "bg.local.goods.cats.get"
  | "bg.local.goods.property.get"
  | "bg.local.goods.size.element.get"
  | "bg.local.goods.template.get"
  | "bg.local.goods.compliance.rules.get"
  | "bg.local.goods.compliance.extra.template.get"
  | "bg.local.goods.compliance.property.check"
  | "bg.freight.template.list.query";

export type TemuAuthoritativePreparationErrorCode =
  | "TEMU_AUTHORITATIVE_PREPARATION_CONFIGURATION_INVALID"
  | "TEMU_AUTHORITATIVE_PREPARATION_CREDENTIAL_REQUIRED"
  | "TEMU_AUTHORITATIVE_PREPARATION_ACCOUNT_MISMATCH"
  | "TEMU_AUTHORITATIVE_PREPARATION_SCOPE_MISMATCH"
  | "TEMU_AUTHORITATIVE_PREPARATION_AUTHORIZATION_REJECTED"
  | "TEMU_AUTHORITATIVE_PREPARATION_TRANSPORT_FAILED"
  | "TEMU_AUTHORITATIVE_PREPARATION_RESPONSE_INVALID"
  | "TEMU_AUTHORITATIVE_APP_SOURCE_UNAVAILABLE"
  | "TEMU_AUTHORITATIVE_APP_SOURCE_INVALID"
  | "TEMU_AUTHORITATIVE_SHIPPING_SOURCE_UNAVAILABLE"
  | "TEMU_AUTHORITATIVE_SHIPPING_SOURCE_INVALID"
  // Shared with the other Temu read paths: the provider refused the caller
  // egress IP before any credential, scope or response evaluation.
  | "TEMU_EGRESS_IP_NOT_ALLOWLISTED";

export class TemuAuthoritativePreparationError extends Error {
  readonly code: TemuAuthoritativePreparationErrorCode;
  readonly providerErrorCode: string | null;
  readonly egressSha256: string | null;
  readonly egressSha256Prefix: string | null;

  constructor(
    code: TemuAuthoritativePreparationErrorCode,
    details: {
      providerErrorCode?: string | null;
      egress?: unknown;
    } = {},
  ) {
    super(code === "TEMU_EGRESS_IP_NOT_ALLOWLISTED"
      ? temuEgressAllowlistMessage(details.egress)
      : code);
    this.name = "TemuAuthoritativePreparationError";
    this.code = code;
    this.providerErrorCode = details.providerErrorCode ?? null;
    const egress = resolveTemuEgressFingerprint(details.egress);
    this.egressSha256 = egress.sha256;
    this.egressSha256Prefix = egress.prefix;
  }
}

export type TemuPartnerAppServiceSnapshot = {
  source: "temu_authenticated_partner_app_management_v1";
  accountSubject: string;
  observedAtEpochMs: number;
  rows: readonly TemuOfficialAppRow[];
};

export type TemuSellerShippingServiceSnapshot = {
  source: "temu_authenticated_seller_center_shipping_v1";
  accountSubject: string;
  observedAtEpochMs: number;
  mallId: string;
  defaultTemplateId: string | null;
  warehouseVerified: boolean;
  feeRuleVerified: boolean;
  returnPolicyVerified: boolean;
};

type TemuServiceSnapshotReader<T> = () => Promise<T | null>;

type TemuPreparationSignedRequest = (input: {
  payload: SecretPayload;
  type: TemuPreparationReadMethod;
  arguments?: Record<string, unknown>;
}) => Promise<RemoteResponse>;

export type TemuSelectedProperty = {
  pid: number;
  vid: number;
  refPid: number;
  value?: string;
};

export type TemuGoodsPropertyInput = {
  propName: string;
  values: readonly string[];
};

export type TemuCategoryPreparationPlan = {
  categoryId: string;
  parentCategoryId: string;
  language: "ko";
  goodsName: string;
  goodsDescription: string;
  goodsProperties: readonly TemuGoodsPropertyInput[];
  normalProperties: readonly TemuSelectedProperty[];
  selectedSpecIds: readonly number[];
  resolvedSizeElementIds: readonly number[];
};

export type TemuCategoryPreparationBinding = {
  source: "sellerpilot_exact_product_revision_category_plan_v1";
  productRevisionFingerprint: string;
  categoryPlanSha256: string;
};

export type TemuAuthoritativePreparationReadAdapter = Pick<
  TemuAuthoritativeReadDependencies,
  "readAppRows" | "readLeafCategoryCompliance" | "readStoreShipping"
>;

export type CreateTemuAuthoritativePreparationReadAdapterInput = {
  payload: SecretPayload;
  expectedAccountSubject: string;
  expectedMallId: string;
  expectedRegionId: string;
  productRevisionFingerprint: string;
  externalGoodsId: string;
  category: TemuCategoryPreparationPlan;
  categoryBinding: TemuCategoryPreparationBinding;
  readCurrentAppSnapshot: TemuServiceSnapshotReader<TemuPartnerAppServiceSnapshot>;
  readCurrentShippingSnapshot: TemuServiceSnapshotReader<TemuSellerShippingServiceSnapshot>;
  request?: TemuPreparationSignedRequest;
  clock: TemuAuthoritativeClock;
  // Optional egress fingerprint for the lane that performs the read. When it is
  // absent the local operator worker measurement is used, and when that is also
  // absent the failure reports an explicit null fingerprint.
  egress?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function temuCategoryPreparationPlanSha256(
  plan: TemuCategoryPreparationPlan,
) {
  return sha256(plan);
}

function records(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(record);
  return normalized.every((entry) => entry !== null)
    ? normalized as Record<string, unknown>[]
    : null;
}

function exactText(value: unknown, maxLength: number) {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maxLength
    && !/\p{Cc}/u.test(value);
}

function positiveIntegerText(value: unknown) {
  return typeof value === "string" && /^[1-9]\d*$/u.test(value);
}

function safePositiveInteger(value: unknown): number | null {
  const numberValue = typeof value === "string" && /^[1-9]\d*$/u.test(value)
    ? Number(value)
    : value;
  return typeof numberValue === "number"
    && Number.isSafeInteger(numberValue)
    && numberValue > 0
    ? numberValue
    : null;
}

function safeNonNegativeInteger(value: unknown): number | null {
  const numberValue = typeof value === "string" && /^\d+$/u.test(value)
    ? Number(value)
    : value;
  return typeof numberValue === "number"
    && Number.isSafeInteger(numberValue)
    && numberValue >= 0
    ? numberValue
    : null;
}

function validFingerprint(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validAccountSubject(value: unknown) {
  return typeof value === "string"
    && /^temu-account:sha256:[a-f0-9]{64}$/u.test(value);
}

function requiredCredentialFieldsPresent(payload: SecretPayload) {
  return ["app_key", "app_secret", "access_token"].every((key) =>
    exactText(payload[key], 4_096));
}

function normalizedProperty(input: TemuSelectedProperty) {
  if (!safePositiveInteger(input.pid)
    || !safePositiveInteger(input.vid)
    || !safePositiveInteger(input.refPid)
    || (input.value !== undefined && !exactText(input.value, 512))) {
    return null;
  }
  return {
    pid: input.pid,
    vid: input.vid,
    refPid: input.refPid,
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}

function validateCategoryPlan(plan: TemuCategoryPreparationPlan) {
  const categoryId = safePositiveInteger(plan.categoryId);
  const parentCategoryId = safePositiveInteger(plan.parentCategoryId);
  if (!categoryId
    || !parentCategoryId
    || plan.language !== "ko"
    || !exactText(plan.goodsName, 500)
    || !exactText(plan.goodsDescription, 10_000)
    || plan.goodsProperties.length < 1
    || plan.goodsProperties.length > 100
    || plan.goodsProperties.some((property) =>
      !exactText(property.propName, 128)
      || property.values.length < 1
      || property.values.length > 100
      || property.values.some((value) => !exactText(value, 512)))
    || plan.normalProperties.length < 1
    || plan.normalProperties.length > 500
    || plan.normalProperties.some((property) => !normalizedProperty(property))
    || plan.selectedSpecIds.some((id) => !safePositiveInteger(id))
    || new Set(plan.selectedSpecIds).size !== plan.selectedSpecIds.length
    || plan.resolvedSizeElementIds.some((id) => !safePositiveInteger(id))
    || new Set(plan.resolvedSizeElementIds).size
      !== plan.resolvedSizeElementIds.length) {
    throw new TemuAuthoritativePreparationError(
      "TEMU_AUTHORITATIVE_PREPARATION_CONFIGURATION_INVALID",
    );
  }
  return { categoryId, parentCategoryId };
}

function assertTransport(remote: RemoteResponse, egress?: unknown) {
  const egressAllowlist = classifyTemuEgressAllowlistFailure({
    status: remote.response.status,
    data: remote.data,
    egress,
  });
  if (egressAllowlist.notAllowlisted) {
    throw new TemuAuthoritativePreparationError(
      "TEMU_EGRESS_IP_NOT_ALLOWLISTED",
      {
        providerErrorCode: egressAllowlist.providerErrorCode,
        egress: egressAllowlist.egress,
      },
    );
  }
  if (remote.response.ok) return;
  if (remote.response.status === 401 || remote.response.status === 403) {
    throw new TemuAuthoritativePreparationError(
      "TEMU_AUTHORITATIVE_PREPARATION_AUTHORIZATION_REJECTED",
    );
  }
  throw new TemuAuthoritativePreparationError(
    "TEMU_AUTHORITATIVE_PREPARATION_TRANSPORT_FAILED",
  );
}

function boundedFailure(error: unknown): never {
  if (error instanceof TemuAuthoritativePreparationError) throw error;
  throw new TemuAuthoritativePreparationError(
    "TEMU_AUTHORITATIVE_PREPARATION_TRANSPORT_FAILED",
  );
}

function resultRecord(remote: RemoteResponse, egress?: unknown) {
  assertTransport(remote, egress);
  const result = record(remote.data.result);
  if (remote.data.success !== true || !result) {
    throw new TemuAuthoritativePreparationError(
      "TEMU_AUTHORITATIVE_PREPARATION_RESPONSE_INVALID",
    );
  }
  return result;
}

function requiredTemplatePropertiesResolved(input: {
  templateInfo: Record<string, unknown>;
  selectedRefPids: ReadonlySet<number>;
  selectedSpecIds: ReadonlySet<number>;
}) {
  const goodsProperties = records(input.templateInfo.goodsProperties);
  const specProperties = records(input.templateInfo.goodsSpecProperties);
  if (!safePositiveInteger(input.templateInfo.templateId)
    || !goodsProperties
    || !specProperties) return false;
  if (goodsProperties.some((property) =>
    typeof property.required !== "boolean"
    || !safePositiveInteger(property.refPid))) return false;
  if (specProperties.some((property) => {
    const values = records(property.values);
    return typeof property.required !== "boolean"
      || !values
      || values.some((value) => !safePositiveInteger(value.specId));
  })) return false;
  const ordinaryRequired = goodsProperties
    .filter((property) => property.required === true);
  if (ordinaryRequired.some((property) => {
    const refPid = safePositiveInteger(property.refPid);
    return !refPid || !input.selectedRefPids.has(refPid);
  })) return false;
  const requiredSpecs = specProperties.filter((property) =>
    property.required === true);
  return requiredSpecs.every((property) => {
    const values = records(property.values)!;
    if (values.length === 0) return false;
    const documentedSpecIds = values
      .map((value) => safePositiveInteger(value.specId))
      .filter((value): value is number => value !== null);
    return documentedSpecIds.length === values.length
      && documentedSpecIds.some((id) => input.selectedSpecIds.has(id));
  });
}

function requiredSizeElementsResolved(input: {
  rule: Record<string, unknown>;
  categoryId: number;
  resolvedSizeElementIds: ReadonlySet<number>;
}) {
  if (safePositiveInteger(input.rule.catId) !== input.categoryId) return false;
  const direct = records(input.rule.sizeSpecElementList);
  const groups = records(input.rule.setElementList);
  if (!direct || !groups) return false;
  const nestedGroups = groups.map((group) =>
    records(group.sizeSpecElementList));
  if (nestedGroups.some((group) => group === null)) return false;
  const nested = nestedGroups.flatMap((group) => group!);
  if ([...direct, ...nested].some((element) =>
    typeof element.necessary !== "boolean"
    || !safePositiveInteger(element.elementId))) return false;
  const required = [...direct, ...nested]
    .filter((element) => element.necessary === true);
  return required.every((element) => {
    const id = safePositiveInteger(element.elementId);
    return Boolean(id && input.resolvedSizeElementIds.has(id));
  });
}

function complianceDecision(input: {
  rules: Record<string, unknown>;
  extra: Record<string, unknown>;
}) {
  const certs = records(input.rules.goodsCertList);
  const checks = records(input.rules.checkInfoList);
  const photos = records(input.rules.actualPhotoRequirement);
  const extraInfo = records(input.extra.extraComplianceInfoList);
  const extraTemplates = records(input.extra.extraTemplateList);
  const guide = record(input.extra.guideFileRequirement);
  if (!certs || !checks || !photos || !extraInfo || !extraTemplates || !guide
    || typeof input.rules.mustHaveActualPhoto !== "boolean"
    || typeof guide.isRequired !== "boolean"
    || certs.some((item) => typeof item.isRequired !== "boolean"
      || !safePositiveInteger(item.certType))
    || extraInfo.some((item) => typeof item.isRequired !== "boolean")
    || extraTemplates.some((item) => typeof item.isRequired !== "boolean")) {
    return { complianceVerified: false, certificationDecisionVerified: false };
  }
  const certificationDecisionVerified = certs.every((item) =>
    item.isRequired === false);
  const noUnresolvedRequirements = certificationDecisionVerified
    && checks.length === 0
    && photos.length === 0
    && input.rules.mustHaveActualPhoto === false
    && guide.isRequired === false
    && extraInfo.every((item) => item.isRequired === false)
    && extraTemplates.every((item) => item.isRequired === false);
  return {
    complianceVerified: noUnresolvedRequirements,
    certificationDecisionVerified,
  };
}

export function createTemuAuthoritativePreparationReadAdapter(
  input: CreateTemuAuthoritativePreparationReadAdapterInput,
): TemuAuthoritativePreparationReadAdapter {
  if (!validAccountSubject(input.expectedAccountSubject)
    || !positiveIntegerText(input.expectedMallId)
    || !positiveIntegerText(input.expectedRegionId)
    || !validFingerprint(input.productRevisionFingerprint)
    || !exactText(input.externalGoodsId, 128)) {
    throw new TemuAuthoritativePreparationError(
      "TEMU_AUTHORITATIVE_PREPARATION_CONFIGURATION_INVALID",
    );
  }
  const category = structuredClone(input.category);
  const categoryIds = validateCategoryPlan(category);
  const categoryPlanSha256 = temuCategoryPreparationPlanSha256(category);
  if (input.categoryBinding.source
      !== "sellerpilot_exact_product_revision_category_plan_v1"
    || input.categoryBinding.productRevisionFingerprint
      !== input.productRevisionFingerprint
    || input.categoryBinding.categoryPlanSha256 !== categoryPlanSha256) {
    throw new TemuAuthoritativePreparationError(
      "TEMU_AUTHORITATIVE_PREPARATION_CONFIGURATION_INVALID",
    );
  }
  const request = input.request ?? temuRequest;
  const serverNowEpochMs = input.clock.nowEpochMs;

  function assertCredential() {
    if (!requiredCredentialFieldsPresent(input.payload)) {
      throw new TemuAuthoritativePreparationError(
        "TEMU_AUTHORITATIVE_PREPARATION_CREDENTIAL_REQUIRED",
      );
    }
    const identity = readTemuAccountIdentityBinding(input.payload);
    if (!identity
      || identity.mallId !== input.expectedMallId
      || identity.regionId !== input.expectedRegionId) {
      throw new TemuAuthoritativePreparationError(
        "TEMU_AUTHORITATIVE_PREPARATION_ACCOUNT_MISMATCH",
      );
    }
  }

  async function officialRead(
    type: TemuPreparationReadMethod,
    args?: Record<string, unknown>,
  ) {
    try {
      const remote = await runWithProviderReadOnlyTransport(() => request({
          payload: input.payload,
          type,
          ...(args ? { arguments: args } : {}),
        }));
      return resultRecord(remote, input.egress);
    } catch (error) {
      return boundedFailure(error);
    }
  }

  return {
    readAppRows: async ({ expectedAppId }) => {
      let snapshot: TemuPartnerAppServiceSnapshot | null;
      try {
        snapshot = await input.readCurrentAppSnapshot();
      } catch {
        throw new TemuAuthoritativePreparationError(
          "TEMU_AUTHORITATIVE_APP_SOURCE_UNAVAILABLE",
        );
      }
      if (!snapshot) {
        throw new TemuAuthoritativePreparationError(
          "TEMU_AUTHORITATIVE_APP_SOURCE_UNAVAILABLE",
        );
      }
      if (snapshot.source !== "temu_authenticated_partner_app_management_v1"
        || snapshot.accountSubject !== input.expectedAccountSubject
        || !Number.isFinite(snapshot.observedAtEpochMs)
        || !Array.isArray(snapshot.rows)
        || snapshot.rows.length > 100
        || snapshot.rows.some((row) =>
          !exactText(row.appId, 256)
          || !["active", "inactive", "unknown"].includes(row.state)
          || !["approved", "rejected", "reviewing", "unknown"]
            .includes(row.complianceState)
          || (row.rejectionReason !== null
            && !exactText(row.rejectionReason, 1_000)))) {
        throw new TemuAuthoritativePreparationError(
          "TEMU_AUTHORITATIVE_APP_SOURCE_INVALID",
        );
      }
      return {
        observedAtEpochMs: snapshot.observedAtEpochMs,
        accountSubject: snapshot.accountSubject,
        rows: snapshot.rows
          .filter((row) => row.appId === expectedAppId)
          .map((row) => ({
            appId: row.appId,
            state: row.state,
            complianceState: row.complianceState,
            rejectionReason: row.rejectionReason,
          })),
      };
    },
    readLeafCategoryCompliance: async (scope) => {
      if (scope.mallId !== input.expectedMallId
        || scope.productRevisionFingerprint
          !== input.productRevisionFingerprint
        || scope.externalGoodsId !== input.externalGoodsId) {
        throw new TemuAuthoritativePreparationError(
          "TEMU_AUTHORITATIVE_PREPARATION_SCOPE_MISMATCH",
        );
      }
      assertCredential();
      const normalPropertyList = category.normalProperties.map(
        (property) => normalizedProperty(property)!,
      );
      const [recommend, categories, properties, size, template, rules, extra,
        propertyCheck] = await Promise.all([
        officialRead("bg.local.goods.category.recommend", {
          goodsName: category.goodsName,
          description: category.goodsDescription,
        }),
        officialRead("bg.local.goods.cats.get", {
          parentCatId: categoryIds.parentCategoryId,
          language: category.language,
        }),
        officialRead("bg.local.goods.property.get", {
          language: category.language,
          goodsName: category.goodsName,
          goodsDesc: category.goodsDescription,
          catId: categoryIds.categoryId,
          goodsPropList: category.goodsProperties.map((property) => ({
            propName: property.propName,
            values: [...property.values],
          })),
        }),
        officialRead("bg.local.goods.size.element.get", {
          language: category.language,
          catId: categoryIds.categoryId,
        }),
        officialRead("bg.local.goods.template.get", {
          language: category.language,
          catId: categoryIds.categoryId,
        }),
        officialRead("bg.local.goods.compliance.rules.get", {
          language: category.language,
          catId: categoryIds.categoryId,
          normalPropertyList,
        }),
        officialRead("bg.local.goods.compliance.extra.template.get", {
          language: category.language,
          catId: categoryIds.categoryId,
          normalPropertyList,
        }),
        officialRead("bg.local.goods.compliance.property.check", {
          normalPropertyList,
        }),
      ]);
      const observedAtEpochMs = serverNowEpochMs();
      const recommendedCategoryId = safePositiveInteger(recommend.catId);
      const categoryRows = records(categories.goodsCatsList);
      const categoryRowsValid = Boolean(categoryRows
        && categoryRows.length > 0
        && categoryRows.every((row) =>
          Boolean(safePositiveInteger(row.catId))
          && Boolean(safeNonNegativeInteger(row.parentId) !== null)
          && typeof row.leaf === "boolean"
          && [0, 1].includes(safeNonNegativeInteger(row.availableStatus)
            ?? -1)));
      const exactLeaf = categoryRows?.find((row) =>
        safePositiveInteger(row.catId) === categoryIds.categoryId) ?? null;
      const propertyRows = records(properties.goodsPropertyList);
      const sizeRule = record(size.sizeSpecElementRule);
      const templateInfo = record(template.templateInfo);
      const selectedRefPids = new Set(category.normalProperties.map(
        (property) => property.refPid,
      ));
      const selectedPropertiesMatch = Boolean(propertyRows
        && propertyRows.length === normalPropertyList.length
        && normalPropertyList.every((selected) => propertyRows.some((row) =>
          safePositiveInteger(row.pid) === selected.pid
          && safePositiveInteger(row.vid) === selected.vid
          && safePositiveInteger(row.refPid) === selected.refPid
          && (selected.value === undefined || row.value === selected.value)))
        && propertyRows.every((row) => normalPropertyList.some((selected) =>
          safePositiveInteger(row.pid) === selected.pid
          && safePositiveInteger(row.vid) === selected.vid
          && safePositiveInteger(row.refPid) === selected.refPid
          && (selected.value === undefined || row.value === selected.value))));
      const categoryAttributesVerified = Boolean(
        propertyRows
        && propertyRows.length > 0
        && selectedPropertiesMatch
        && sizeRule
        && templateInfo
        && propertyCheck.isMatch === true
        && requiredTemplatePropertiesResolved({
          templateInfo,
          selectedRefPids,
          selectedSpecIds: new Set(category.selectedSpecIds),
        })
        && requiredSizeElementsResolved({
          rule: sizeRule,
          categoryId: categoryIds.categoryId,
          resolvedSizeElementIds: new Set(
            category.resolvedSizeElementIds,
          ),
        }),
      );
      const compliance = complianceDecision({ rules, extra });
      return {
        observedAtEpochMs,
        mallId: input.expectedMallId,
        productRevisionFingerprint: input.productRevisionFingerprint,
        categoryId: category.categoryId,
        categoryPlanSha256,
        requestEvidenceSha256: sha256({
          category,
          mallId: input.expectedMallId,
          externalGoodsId: input.externalGoodsId,
        }),
        responseEvidenceSha256: sha256({
          recommend,
          categories,
          properties,
          size,
          template,
          rules,
          extra,
          propertyCheck,
        }),
        leafCategoryVerified: Boolean(categoryRowsValid
          && exactLeaf
          && exactLeaf.leaf === true
          && safePositiveInteger(exactLeaf.parentId)
            === categoryIds.parentCategoryId
          && exactLeaf.availableStatus === 1),
        categoryRecommendationVerified:
          recommendedCategoryId === categoryIds.categoryId,
        categoryAttributesVerified,
        categoryComplianceVerified: compliance.complianceVerified,
        certificationDecisionVerified:
          compliance.certificationDecisionVerified,
      };
    },
    readStoreShipping: async ({ mallId }) => {
      if (mallId !== input.expectedMallId) {
        throw new TemuAuthoritativePreparationError(
          "TEMU_AUTHORITATIVE_PREPARATION_SCOPE_MISMATCH",
        );
      }
      assertCredential();
      let snapshot: TemuSellerShippingServiceSnapshot | null;
      try {
        snapshot = await input.readCurrentShippingSnapshot();
      } catch {
        throw new TemuAuthoritativePreparationError(
          "TEMU_AUTHORITATIVE_SHIPPING_SOURCE_UNAVAILABLE",
        );
      }
      if (!snapshot) {
        throw new TemuAuthoritativePreparationError(
          "TEMU_AUTHORITATIVE_SHIPPING_SOURCE_UNAVAILABLE",
        );
      }
      if (snapshot.source
          !== "temu_authenticated_seller_center_shipping_v1"
        || snapshot.accountSubject !== input.expectedAccountSubject
        || snapshot.mallId !== input.expectedMallId
        || !Number.isFinite(snapshot.observedAtEpochMs)
        || (snapshot.defaultTemplateId !== null
          && !exactText(snapshot.defaultTemplateId, 256))
        || typeof snapshot.warehouseVerified !== "boolean"
        || typeof snapshot.feeRuleVerified !== "boolean"
        || typeof snapshot.returnPolicyVerified !== "boolean") {
        throw new TemuAuthoritativePreparationError(
          "TEMU_AUTHORITATIVE_SHIPPING_SOURCE_INVALID",
        );
      }
      const shipping = await officialRead("bg.freight.template.list.query");
      const templates = records(shipping.templateList);
      if (!templates) {
        throw new TemuAuthoritativePreparationError(
          "TEMU_AUTHORITATIVE_PREPARATION_RESPONSE_INVALID",
        );
      }
      const templatesValid = templates.every((template) =>
        exactText(template.templateId, 256)
        && exactText(template.templateName, 256));
      const exactDefault = templatesValid
        && snapshot.defaultTemplateId !== null
        && templates.some((template) =>
          template.templateId === snapshot.defaultTemplateId
          && exactText(template.templateName, 256));
      return {
        observedAtEpochMs: snapshot.observedAtEpochMs,
        mallId: input.expectedMallId,
        storeDefaultShippingVerified: Boolean(
          exactDefault
          && snapshot.warehouseVerified
          && snapshot.feeRuleVerified
          && snapshot.returnPolicyVerified,
        ),
      };
    },
  };
}
