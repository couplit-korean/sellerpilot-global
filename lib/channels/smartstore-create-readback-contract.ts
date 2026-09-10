import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export const smartstoreCreateExactReadbackContract =
  "smartstore_create_exact_readback_v1" as const;

export const smartstoreCreateExactReadbackGroups = [
  "productInput",
  "categoryAndAttributes",
  "brandAndNotice",
  "shippingAndReturns",
  "approvedImagesAndDetail",
  "channelProduct",
] as const;

export type SmartstoreCreateExactReadbackGroup =
  (typeof smartstoreCreateExactReadbackGroups)[number];

export type SmartstoreCreateExactReadbackReceipt = {
  contract: typeof smartstoreCreateExactReadbackContract;
  originProductNo: string;
  channelProductNo: string;
  expectedProjectionSha256: string;
  officialProjectionSha256: string;
  verifiedGroups: SmartstoreCreateExactReadbackGroup[];
  mismatchGroups: SmartstoreCreateExactReadbackGroup[];
  verified: boolean;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as UnknownRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex");
}

const missing = Object.freeze({ sellerpilotMissingReadbackValue: true });

function officialShape(expected: unknown, actual: unknown): unknown {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return missing;
    }
    return expected.map((item, index) => officialShape(item, actual[index]));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      return missing;
    }
    const actualRecord = actual as UnknownRecord;
    return Object.fromEntries(Object.entries(expected as UnknownRecord).map(
      ([key, child]) => [
        key,
        Object.hasOwn(actualRecord, key)
          ? officialShape(child, actualRecord[key])
          : missing,
      ],
    ));
  }
  return actual;
}

function optionalFields(value: UnknownRecord, keys: readonly string[]) {
  return Object.fromEntries(keys.flatMap((key) =>
    Object.hasOwn(value, key) ? [[key, structuredClone(value[key])]] : []));
}

function sortedProviderRecords(value: unknown) {
  if (!Array.isArray(value)) return value;
  return structuredClone(value).sort((left, right) =>
    JSON.stringify(canonical(left)).localeCompare(JSON.stringify(canonical(right))));
}

function createProjection(bodyValue: unknown) {
  const body = record(bodyValue);
  const origin = record(body.originProduct);
  const detail = record(origin.detailAttribute);
  const channel = record(body.smartstoreChannelProduct);
  return {
    productInput: {
      ...optionalFields(origin, [
        "saleType",
        "name",
        "salePrice",
        "stockQuantity",
      ]),
      sellerCodeInfo: optionalFields(record(detail.sellerCodeInfo), [
        "sellerManagementCode",
      ]),
    },
    categoryAndAttributes: {
      ...optionalFields(origin, ["leafCategoryId"]),
      ...optionalFields(detail, [
        "unitCapacity",
        "certificationTargetExcludeContent",
        "optionInfo",
      ]),
      ...(Object.hasOwn(detail, "productCertificationInfos")
        ? {
            productCertificationInfos: sortedProviderRecords(
              detail.productCertificationInfos,
            ),
          }
        : {}),
      ...(Object.hasOwn(detail, "productAttributes")
        ? { productAttributes: sortedProviderRecords(detail.productAttributes) }
        : {}),
    },
    brandAndNotice: {
      ...optionalFields(detail, [
        "naverShoppingSearchInfo",
        "productInfoProvidedNotice",
        "originAreaInfo",
        "afterServiceInfo",
      ]),
    },
    shippingAndReturns: {
      ...optionalFields(origin, ["deliveryInfo"]),
    },
    approvedImagesAndDetail: {
      ...optionalFields(origin, ["images", "detailContent"]),
    },
    channelProduct: {
      ...optionalFields(channel, [
        "naverShoppingRegistration",
        "channelProductName",
      ]),
    },
  } satisfies Record<SmartstoreCreateExactReadbackGroup, unknown>;
}

/**
 * Bind the accepted SmartStore CREATE body to the two exact official GET
 * responses. Provider-added response fields are ignored, but every value that
 * SellerPilot actually sent in the six completion-critical groups must read
 * back unchanged. This function is GET-only and never repairs or retransmits.
 */
export function verifySmartstoreCreateExactReadback(input: {
  expectedBody: unknown;
  originReadback: unknown;
  channelReadback: unknown;
  originProductNo: string;
  channelProductNo: string;
}): SmartstoreCreateExactReadbackReceipt {
  const originWrapper = record(input.originReadback);
  const channelWrapper = record(input.channelReadback);
  const expected = createProjection(input.expectedBody);
  const officialBody = {
    originProduct: originWrapper.originProduct,
    smartstoreChannelProduct: channelWrapper.smartstoreChannelProduct,
  };
  const officialFull = createProjection(officialBody);
  const official = Object.fromEntries(
    smartstoreCreateExactReadbackGroups.map((group) => [
      group,
      officialShape(expected[group], officialFull[group]),
    ]),
  ) as Record<SmartstoreCreateExactReadbackGroup, unknown>;
  const mismatchGroups = smartstoreCreateExactReadbackGroups.filter(
    (group) => digest(expected[group]) !== digest(official[group]),
  );
  const verifiedGroups = smartstoreCreateExactReadbackGroups.filter(
    (group) => !mismatchGroups.includes(group),
  );
  return {
    contract: smartstoreCreateExactReadbackContract,
    originProductNo: input.originProductNo,
    channelProductNo: input.channelProductNo,
    expectedProjectionSha256: digest(expected),
    officialProjectionSha256: digest(official),
    verifiedGroups,
    mismatchGroups,
    verified: mismatchGroups.length === 0,
  };
}
