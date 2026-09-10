import { createHash } from "node:crypto";
import type { SecretPayload } from "../../channels/protocols";
import {
  assertCoupangCreateOfficialReadEvidence,
  type CoupangCreateOfficialReadEvidence,
} from "./create-official-read-evidence";

export const coupangCreateSourceRevisionArgument =
  "sellerpilotCoupangCreateSourceRevision";
export const coupangCreateSourceRevisionContract =
  "sellerpilot_coupang_create_source_revision_v1" as const;
export const coupangCreateOfficialReadSnapshotIdArgument =
  "sellerpilotCoupangOfficialReadSnapshotId" as const;
export const coupangCreateOfficialReadSnapshotDigestArgument =
  "sellerpilotCoupangOfficialReadSnapshotDigestSha256" as const;
export const coupangCreateTransmissionArgument =
  "sellerpilotCoupangCreateTransmission" as const;
export const coupangCreateTransmissionContract =
  "sellerpilot_coupang_create_transmission_v1" as const;

type Row = Record<string, unknown>;
type Environment = "sandbox" | "production";

export type CoupangCreateSourceRevisionBinding = {
  contract: typeof coupangCreateSourceRevisionContract;
  productId: string;
  productSourceSha256: string;
  productSource: {
    sku: string;
    name: string;
    onHand: number;
    costKrw: number;
  };
  detailPageVersion: number;
  approvedManifestDigest: string;
  officialReadEvidence: CoupangCreateOfficialReadEvidence;
  officialReadSnapshotId: string;
  officialReadSnapshotDigestSha256: string;
  sourceRevisionSha256: string;
  credentialId: string;
  credentialVersion: number;
  credentialFingerprint: string;
  credentialEnvironment: Environment;
  credentialSellerIdentitySha256: string;
  market: string;
  targetId: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256 = /^[a-f0-9]{64}$/u;

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row : null;
}
function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim() : "";
}
function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(number) && number > 0;
}
function positiveMoney(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Row)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function stableArguments(argumentsValue: Row) {
  const next = structuredClone(argumentsValue);
  delete next[coupangCreateSourceRevisionArgument];
  delete next[coupangCreateOfficialReadSnapshotIdArgument];
  delete next[coupangCreateOfficialReadSnapshotDigestArgument];
  delete next[coupangCreateTransmissionArgument];
  delete next.publicationExpectedFingerprint;
  const assets = record(next.sellerpilotAssets);
  if (assets) {
    const stableAssets = { ...assets };
    delete stableAssets.detailImageUrls;
    delete stableAssets.galleryImageUrls;
    next.sellerpilotAssets = stableAssets;
  }
  return next;
}
function requiredRows(value: unknown, code: string) {
  if (!Array.isArray(value) || !value.length || value.some((item) => !record(item))) {
    throw new Error(code);
  }
  return value as Row[];
}
function assertCompleteCoupangCreateInput(argumentsValue: Row) {
  const body = record(argumentsValue.body);
  const assets = record(argumentsValue.sellerpilotAssets);
  if (!body || !positiveInteger(body.displayCategoryCode)) {
    throw new Error("COUPANG_CREATE_REVISION_CATEGORY_REQUIRED");
  }
  if (!text(body.sellerProductName) || !text(body.displayProductName ?? body.sellerProductName)) {
    throw new Error("COUPANG_CREATE_REVISION_PRODUCT_NAME_REQUIRED");
  }
  if (!positiveInteger(Number(body.outboundShippingPlaceCode))
    || !text(body.returnCenterCode)
    || !text(body.deliveryCompanyCode)
    || !text(body.deliveryChargeType)
    || typeof body.deliveryCharge !== "number"
    || body.deliveryCharge < 0
    || typeof body.returnCharge !== "number"
    || body.returnCharge <= 0) {
    throw new Error("COUPANG_CREATE_REVISION_SHIPPING_REQUIRED");
  }
  const items = requiredRows(body.items, "COUPANG_CREATE_REVISION_ITEMS_REQUIRED");
  const skus = items.map((item) => text(item.externalVendorSku));
  if (skus.some((sku) => !sku) || new Set(skus).size !== skus.length) {
    throw new Error("COUPANG_CREATE_REVISION_SKU_INVALID");
  }
  for (const item of items) {
    if (!text(item.itemName) || !positiveMoney(item.salePrice)
      || !positiveInteger(item.maximumBuyCount) || !positiveInteger(item.unitCount)) {
      throw new Error("COUPANG_CREATE_REVISION_COMMERCE_VALUES_REQUIRED");
    }
    requiredRows(item.attributes, "COUPANG_CREATE_REVISION_ATTRIBUTES_REQUIRED");
    requiredRows(item.notices, "COUPANG_CREATE_REVISION_NOTICES_REQUIRED");
  }
  const paths = Array.isArray(assets?.approvedDetailImagePaths)
    ? assets.approvedDetailImagePaths.map(text) : [];
  const hashes = Array.isArray(assets?.approvedDetailImageSha256s)
    ? assets.approvedDetailImageSha256s.map(text) : [];
  const roles = Array.isArray(assets?.detailImageRoles)
    ? assets.detailImageRoles.map(text) : [];
  if (!assets || paths.length !== 8 || hashes.length !== 8 || roles.length !== 8
    || paths.some((value) => !value) || hashes.some((value) => !sha256.test(value))
    || roles.some((value) => !value)
    || new Set(paths).size !== 8 || new Set(hashes).size !== 8
    || !positiveInteger(assets.approvedDetailPageVersion)
    || !sha256.test(text(assets.detailImageManifestDigest))) {
    throw new Error("COUPANG_CREATE_REVISION_APPROVED_IMAGES_REQUIRED");
  }
  return stableArguments(argumentsValue);
}
function sellerIdentitySha256(credential: SecretPayload) {
  const vendorId = text(credential.vendor_id);
  const requestedBy = text(credential.requested_by);
  if (!vendorId || !requestedBy) {
    throw new Error("COUPANG_CREATE_REVISION_SELLER_IDENTITY_REQUIRED");
  }
  return digest({ vendorId, requestedBy });
}

export function bindCoupangCreateSourceRevision(input: {
  argumentsValue: Row;
  publishContext: unknown;
  productId: string;
  credentialId: string;
  credentialVersion: number;
  credentialFingerprint: string;
  credentialEnvironment: Environment;
  credentialExpiresAt?: string | null;
  credential: SecretPayload;
  officialReadEvidence: unknown;
  officialReadSnapshotId: string;
  officialReadSnapshotDigestSha256: string;
  market: string;
  targetId: string;
}): Row {
  if ([
    coupangCreateSourceRevisionArgument,
    coupangCreateOfficialReadSnapshotIdArgument,
    coupangCreateOfficialReadSnapshotDigestArgument,
  ].some((key) => Object.hasOwn(input.argumentsValue, key))) {
    throw new Error("COUPANG_CREATE_REVISION_SERVER_OWNED");
  }
  const context = record(input.publishContext);
  const product = record(context?.product);
  const detailPage = record(context?.detailPage);
  const stable = assertCompleteCoupangCreateInput(input.argumentsValue);
  const body = record(stable.body)!;
  const officialReadEvidence = assertCoupangCreateOfficialReadEvidence({
    value: input.officialReadEvidence,
    displayCategoryCode: Number(body.displayCategoryCode),
    environment: input.credentialEnvironment,
  });
  const assets = record(stable.sellerpilotAssets)!;
  const detailPageVersion = Number(detailPage?.version);
  if (!uuid.test(input.productId) || product?.id !== input.productId
    || !text(product.sku) || !text(product.name)
    || !Number.isSafeInteger(Number(product.onHand)) || Number(product.onHand) < 0
    || !Number.isFinite(Number(product.costKrw)) || Number(product.costKrw) < 0
    || !uuid.test(input.credentialId)
    || !uuid.test(input.officialReadSnapshotId)
    || !sha256.test(input.officialReadSnapshotDigestSha256)
    || !Number.isSafeInteger(input.credentialVersion) || input.credentialVersion < 1
    || !text(input.credentialFingerprint)
    || (input.credentialExpiresAt && new Date(input.credentialExpiresAt).getTime() <= Date.now())
    || !Number.isSafeInteger(detailPageVersion) || detailPageVersion < 1
    || detailPage?.approvedVersion !== detailPageVersion
    || Number(assets.approvedDetailPageVersion) !== detailPageVersion
    || text(assets.detailImageManifestDigest) !== text(record(detailPage?.imageManifest)?.digest)) {
    throw new Error("COUPANG_CREATE_REVISION_SOURCE_INVALID");
  }
  const binding: CoupangCreateSourceRevisionBinding = {
    contract: coupangCreateSourceRevisionContract,
    productId: input.productId,
    productSourceSha256: digest({ product, manualFields: context?.manualFields, assignments: context?.assignments }),
    productSource: {
      sku: text(product.sku),
      name: text(product.name),
      onHand: Number(product.onHand),
      costKrw: Number(product.costKrw),
    },
    detailPageVersion,
    approvedManifestDigest: text(assets.detailImageManifestDigest),
    officialReadEvidence,
    officialReadSnapshotId: input.officialReadSnapshotId,
    officialReadSnapshotDigestSha256: input.officialReadSnapshotDigestSha256,
    sourceRevisionSha256: digest({
      argumentsValue: stable,
      officialReadEvidence,
      officialReadSnapshotId: input.officialReadSnapshotId,
      officialReadSnapshotDigestSha256: input.officialReadSnapshotDigestSha256,
    }),
    credentialId: input.credentialId,
    credentialVersion: input.credentialVersion,
    credentialFingerprint: text(input.credentialFingerprint),
    credentialEnvironment: input.credentialEnvironment,
    credentialSellerIdentitySha256: sellerIdentitySha256(input.credential),
    market: input.market.trim().toUpperCase(),
    targetId: input.targetId.trim(),
  };
  return { ...input.argumentsValue, [coupangCreateSourceRevisionArgument]: binding };
}

export function assertCoupangCreateSourceRevision(input: {
  argumentsValue: Row;
  credentialId?: string;
  environment: Environment;
  credential: SecretPayload;
}) {
  const binding = record(input.argumentsValue[coupangCreateSourceRevisionArgument]);
  const stable = assertCompleteCoupangCreateInput(input.argumentsValue);
  const body = record(stable.body)!;
  const transmission = record(input.argumentsValue[coupangCreateTransmissionArgument]);
  let officialReadEvidence: CoupangCreateOfficialReadEvidence;
  try {
    officialReadEvidence = assertCoupangCreateOfficialReadEvidence({
      value: binding?.officialReadEvidence,
      displayCategoryCode: Number(body.displayCategoryCode),
      environment: input.environment,
    });
  } catch {
    throw new Error("COUPANG_CREATE_REVISION_MISMATCH");
  }
  if (!binding || binding.contract !== coupangCreateSourceRevisionContract
    || !uuid.test(text(binding.productId))
    || !sha256.test(text(binding.productSourceSha256))
    || !record(binding.productSource)
    || !positiveInteger(binding.detailPageVersion)
    || !sha256.test(text(binding.approvedManifestDigest))
    || !sha256.test(text(binding.sourceRevisionSha256))
    || !uuid.test(text(binding.officialReadSnapshotId))
    || !sha256.test(text(binding.officialReadSnapshotDigestSha256))
    || !uuid.test(text(binding.credentialId))
    || !positiveInteger(binding.credentialVersion)
    || !text(binding.credentialFingerprint)
    || binding.credentialEnvironment !== input.environment
    || !sha256.test(text(binding.credentialSellerIdentitySha256))
    || text(binding.credentialId) !== input.credentialId
    || (transmission
      ? transmission.contract !== coupangCreateTransmissionContract
        || !uuid.test(text(transmission.transmissionId))
        || !uuid.test(text(transmission.attemptId))
        || text(transmission.sourceSnapshotId) !== text(binding.officialReadSnapshotId)
        || text(transmission.sourceSnapshotDigestSha256)
          !== text(binding.officialReadSnapshotDigestSha256)
        || !sha256.test(text(transmission.transmissionBodySha256))
        || text(transmission.transmissionBodySha256) !== digest(body)
        || !sha256.test(text(transmission.transmissionDigestSha256))
      : text(binding.sourceRevisionSha256) !== digest({
        argumentsValue: stable,
        officialReadEvidence,
        officialReadSnapshotId: text(binding.officialReadSnapshotId),
        officialReadSnapshotDigestSha256: text(binding.officialReadSnapshotDigestSha256),
      }))
    || text(binding.credentialSellerIdentitySha256) !== sellerIdentitySha256(input.credential)) {
    throw new Error("COUPANG_CREATE_REVISION_MISMATCH");
  }
  return binding as unknown as CoupangCreateSourceRevisionBinding;
}
