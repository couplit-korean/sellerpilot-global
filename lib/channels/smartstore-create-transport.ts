import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export const smartstoreCreateTransportArgument =
  "sellerpilotSmartstoreCreateTransport" as const;
export const smartstoreCreateTransportContract =
  "smartstore_create_transport_v1" as const;
export const smartstoreCreateTransportStageContract =
  "smartstore_create_transport_stage_v1" as const;
export const smartstoreCreateTransportStageArgument =
  "sellerpilotSmartstoreCreateTransportStage" as const;

export type SmartstoreCreateTransport = {
  contract: typeof smartstoreCreateTransportContract;
  bodyText: string;
  bodySha256: string;
  bodyByteLength: number;
};

export type SmartstoreCreateTransportStage = {
  contract: typeof smartstoreCreateTransportStageContract;
  jobId: string;
  bodySha256: string;
  bodyByteLength: number;
  staged: true;
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

function optionalFields(value: UnknownRecord, keys: readonly string[]) {
  return Object.fromEntries(keys.flatMap((key) =>
    Object.hasOwn(value, key) ? [[key, structuredClone(value[key])]] : []));
}

function boundProductNotice(value: unknown) {
  const notice = structuredClone(record(value) ?? {});
  for (const child of Object.values(notice)) {
    const details = record(child);
    if (details) delete details.customerServicePhoneNumber;
  }
  return notice;
}

export function smartstoreCreateBodyBindingProjection(bodyValue: unknown) {
  const body = record(bodyValue) ?? {};
  const origin = record(body.originProduct) ?? {};
  const detail = record(origin.detailAttribute) ?? {};
  const channel = record(body.smartstoreChannelProduct) ?? {};
  return {
    originProduct: {
      ...optionalFields(origin, [
        "saleType",
        "leafCategoryId",
        "name",
        "salePrice",
        "stockQuantity",
        "deliveryInfo",
      ]),
      detailAttribute: {
        ...optionalFields(detail, [
        "sellerCodeInfo",
        "unitCapacity",
        "certificationTargetExcludeContent",
        "productCertificationInfos",
        "productAttributes",
        "optionInfo",
        "naverShoppingSearchInfo",
        "originAreaInfo",
        ]),
        ...(Object.hasOwn(detail, "productInfoProvidedNotice")
          ? { productInfoProvidedNotice: boundProductNotice(detail.productInfoProvidedNotice) }
          : {}),
      },
    },
    smartstoreChannelProduct: optionalFields(channel, [
      "naverShoppingRegistration",
      "channelProductName",
    ]),
  };
}

export function smartstoreCreateBodyBindingSha256(bodyValue: unknown) {
  return sha256(JSON.stringify(canonical(
    smartstoreCreateBodyBindingProjection(bodyValue),
  )));
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Serialize the final SmartStore body once. The exact string returned here is
 * both the durable boundary input and the HTTP request body.
 */
export function buildSmartstoreCreateTransport(
  body: Record<string, unknown>,
): SmartstoreCreateTransport {
  const bodyText = JSON.stringify(body);
  if (!bodyText || bodyText === "{}") {
    throw new Error("SMARTSTORE_CREATE_TRANSPORT_BODY_INVALID");
  }
  return {
    contract: smartstoreCreateTransportContract,
    bodyText,
    bodySha256: sha256(bodyText),
    bodyByteLength: byteLength(bodyText),
  };
}

export function assertSmartstoreCreateTransport(input: {
  body: Record<string, unknown>;
  transport: unknown;
  stage?: unknown;
  expectedJobId?: string;
}) {
  const transport = record(input.transport);
  const bodyText = text(transport?.bodyText);
  const bodySha256 = text(transport?.bodySha256).toLowerCase();
  const bodyByteLength = Number(transport?.bodyByteLength);
  const serializedBody = JSON.stringify(input.body);
  if (transport?.contract !== smartstoreCreateTransportContract
      || !bodyText
      || bodyText !== serializedBody
      || !/^[a-f0-9]{64}$/u.test(bodySha256)
      || bodySha256 !== sha256(bodyText)
      || !Number.isSafeInteger(bodyByteLength)
      || bodyByteLength !== byteLength(bodyText)) {
    throw new Error("SMARTSTORE_CREATE_TRANSPORT_MISMATCH");
  }

  if (input.stage !== undefined || input.expectedJobId !== undefined) {
    const stage = record(input.stage);
    const jobId = text(stage?.jobId).toLowerCase();
    if (stage?.contract !== smartstoreCreateTransportStageContract
        || stage.staged !== true
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(jobId)
        || (input.expectedJobId !== undefined
          && jobId !== input.expectedJobId.toLowerCase())
        || text(stage.bodySha256).toLowerCase() !== bodySha256
        || Number(stage.bodyByteLength) !== bodyByteLength) {
      throw new Error("SMARTSTORE_CREATE_TRANSPORT_STAGE_MISMATCH");
    }
  }

  return {
    contract: smartstoreCreateTransportContract,
    bodyText,
    bodySha256,
    bodyByteLength,
  } satisfies SmartstoreCreateTransport;
}
