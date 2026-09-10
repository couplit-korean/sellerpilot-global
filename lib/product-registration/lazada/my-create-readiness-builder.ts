import { assertLazadaCreateSellerSkuAbsence, lazadaCreateSellerSkus } from
  "../../channels/lazada-create-preflight";
import type { LazadaKrwMyrRateEvidence } from
  "../../channels/lazada-price-policy";
import type { RemoteResponse } from "../../channels/protocols";
import { assertLazadaMyListingCreateContext } from "./listing-create-context";
import {
  assertLazadaMyCreateReadiness,
  type LazadaMyCreateReadinessInput,
} from "./my-create-readiness";

type UnknownRecord = Record<string, unknown>;

export const lazadaMyCreateReadinessBuilderContract =
  "lazada_my_create_readiness_builder_v1" as const;
export const lazadaMyCreateReadinessBlockerContract =
  "lazada_my_create_readiness_blocker_v1" as const;

type EvidenceInput = Omit<LazadaMyCreateReadinessInput,
  | "sellerGatewayResult"
  | "sellerVerifiedAt"
  | "category"
  | "brandCatalog"
  | "sellerSkuLookup"
  | "shipmentProviders"
  | "deliveryPolicy"
  | "returnPolicy"
  | "englishContentApproval"
  | "authoritativeRate"
  | "now">;

export type LazadaMyCreateServerEvidence = EvidenceInput & {
  revision: string;
  observedAt: string;
  source: "sellerpilot-server-create-context";
  oauthEvidence: {
    revision: string;
    source: "sellerpilot-server-oauth-lineage";
    credentialId: string;
    appKey: string;
    country: "my";
    completedAt: string;
  };
  targetEvidence: {
    revision: string;
    source: "sellerpilot-server-target";
    credentialId: string;
    sellerId: string;
    market: "MY";
    verifiedAt: string;
  };
};

export type LazadaMyCreateApprovedOperatorEvidence = {
  revision: string;
  source: "sellerpilot-approved-operator-evidence";
  deliveryPolicy: unknown;
  returnPolicy: unknown;
  englishContentApproval: unknown;
};

export type LazadaMyCreateProviderRead = Readonly<{
  revision: string;
  method: "GET";
  path:
    | "/seller/get"
    | "/products/get"
    | "/category/tree/get"
    | "/category/attributes/get"
    | "/category/brands/query"
    | "/shipment/providers/get";
  params: Readonly<Record<string, string>>;
  credential: UnknownRecord;
}>;

export type LazadaMyCreateReadinessBuilderDependencies = {
  assertRevisionCurrent: (revision: string) => Promise<void>;
  readProvider: (request: LazadaMyCreateProviderRead) => Promise<RemoteResponse>;
  loadAuthoritativeRate: (input: {
    revision: string;
    signal: AbortSignal;
  }) => Promise<LazadaKrwMyrRateEvidence>;
};

export type LazadaMyCreateReadinessBlocker = Readonly<{
  contract: typeof lazadaMyCreateReadinessBlockerContract;
  revision: string;
  stage: "revision" | "server_context" | "provider_read" | "readiness";
  code: string;
  endpoint?: LazadaMyCreateProviderRead["path"];
  sellerpilotNoCreateConfirmed: true;
}>;

type BuilderSuccess = Readonly<{
  ok: true;
  contract: typeof lazadaMyCreateReadinessBuilderContract;
  revision: string;
  readinessInput: LazadaMyCreateReadinessInput;
  readiness: ReturnType<typeof assertLazadaMyCreateReadiness>;
  providerReads: ReadonlyArray<Readonly<{
    method: "GET";
    path: LazadaMyCreateProviderRead["path"];
    params: Readonly<Record<string, string>>;
  }>>;
}>;

type BuilderFailure = Readonly<{
  ok: false;
  blocker: LazadaMyCreateReadinessBlocker;
}>;

class ReadinessBuildError extends Error {
  constructor(
    readonly stage: LazadaMyCreateReadinessBlocker["stage"],
    code: string,
    readonly endpoint?: LazadaMyCreateProviderRead["path"],
  ) {
    super(code);
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function timestamp(value: unknown) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  return normalized && Number.isFinite(parsed) ? parsed : null;
}

function safeCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_:-]{2,159}$/u.test(message) ? message : fallback;
}

function validRevision(value: string) {
  return value.length >= 8
    && value.length <= 160
    && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function assertServerEvidence(input: {
  evidence: LazadaMyCreateServerEvidence;
  operatorEvidence: LazadaMyCreateApprovedOperatorEvidence;
}) {
  const evidence = input.evidence;
  const oauth = evidence.oauthEvidence;
  const target = evidence.targetEvidence;
  const rotatedAt = timestamp(evidence.credentialRotatedAt);
  const oauthCompletedAt = timestamp(oauth.completedAt);
  const observedAt = timestamp(evidence.observedAt);
  if (!validRevision(evidence.revision)
      || input.operatorEvidence.revision !== evidence.revision
      || oauth.revision !== evidence.revision
      || target.revision !== evidence.revision) {
    throw new ReadinessBuildError(
      "revision",
      "LAZADA_MY_CREATE_EVIDENCE_REVISION_MISMATCH",
    );
  }
  if (evidence.source !== "sellerpilot-server-create-context"
      || oauth.source !== "sellerpilot-server-oauth-lineage"
      || target.source !== "sellerpilot-server-target"
      || input.operatorEvidence.source !== "sellerpilot-approved-operator-evidence") {
    throw new ReadinessBuildError(
      "server_context",
      "LAZADA_MY_CREATE_EVIDENCE_SOURCE_INVALID",
    );
  }
  if (oauth.credentialId !== evidence.expected.credentialId
      || oauth.appKey !== evidence.expected.appKey
      || oauth.country !== "my"
      || evidence.callback.credentialId !== evidence.expected.credentialId
      || rotatedAt === null
      || oauthCompletedAt === null
      || observedAt === null
      || oauthCompletedAt > rotatedAt
      || rotatedAt - oauthCompletedAt > 5 * 60 * 1_000
      || target.credentialId !== evidence.expected.credentialId
      || target.sellerId !== evidence.expected.sellerId
      || target.market !== "MY"
      || timestamp(target.verifiedAt) === null
      || timestamp(target.verifiedAt)! < rotatedAt
      || timestamp(target.verifiedAt) !== observedAt
      || target.verifiedAt !== evidence.target.verifiedAt
      || target.sellerId !== evidence.target.targetId
      || evidence.commerceApp.verifiedAt !== evidence.observedAt
      || record(evidence.argumentsValue.sellerpilotLazadaMyCreateContext)
        .sellerModeVerifiedAt !== evidence.observedAt) {
    throw new ReadinessBuildError(
      "server_context",
      "LAZADA_MY_CREATE_SERVER_LINEAGE_INVALID",
    );
  }
  if (!input.operatorEvidence.deliveryPolicy
      || !input.operatorEvidence.returnPolicy
      || !input.operatorEvidence.englishContentApproval) {
    throw new ReadinessBuildError(
      "server_context",
      "LAZADA_MY_CREATE_OPERATOR_EVIDENCE_REQUIRED",
    );
  }
}

function brandIdFromArguments(argumentsValue: UnknownRecord) {
  const request = record(argumentsValue.request);
  const product = record(record(request.Request).Product);
  const attributes = record(product.Attributes);
  return {
    brandId: text(attributes.brand_id),
    noBrand: !text(attributes.brand_id)
      && text(attributes.brand).toLowerCase() === "no brand",
  };
}

function brandRows(remote: RemoteResponse) {
  const brandModule = record(remote.data.data).module;
  return Array.isArray(brandModule) ? brandModule.map(record) : [];
}

function responseAccepted(remote: RemoteResponse) {
  return remote.response.ok
    && text(remote.data.code) === "0"
    && !text(remote.data.error);
}

function blocker(input: {
  revision: string;
  stage: LazadaMyCreateReadinessBlocker["stage"];
  code: string;
  endpoint?: LazadaMyCreateProviderRead["path"];
}): BuilderFailure {
  return {
    ok: false,
    blocker: Object.freeze({
      contract: lazadaMyCreateReadinessBlockerContract,
      revision: input.revision,
      stage: input.stage,
      code: input.code,
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      sellerpilotNoCreateConfirmed: true,
    }),
  };
}

async function loadBrandCatalog(input: {
  revision: string;
  credential: UnknownRecord;
  argumentsValue: UnknownRecord;
  read: (request: Omit<LazadaMyCreateProviderRead, "revision" | "credential">) =>
    Promise<RemoteResponse>;
}) {
  const { brandId, noBrand } = brandIdFromArguments(input.argumentsValue);
  if (!noBrand && !/^\d+$/u.test(brandId)) {
    throw new ReadinessBuildError(
      "server_context",
      "LAZADA_MY_BRAND_ID_REQUIRED",
    );
  }
  const pageSize = 200;
  for (let startRow = 0; startRow < 20_000; startRow += pageSize) {
    const remote = await input.read({
      method: "GET",
      path: "/category/brands/query",
      params: {
        startRow: String(startRow),
        pageSize: String(pageSize),
      },
    });
    if (!responseAccepted(remote)) {
      throw new ReadinessBuildError(
        "provider_read",
        "LAZADA_MY_BRAND_CATALOG_READ_FAILED",
        "/category/brands/query",
      );
    }
    const rows = brandRows(remote);
    if (noBrand || rows.some((row) =>
      text(row.brand_id ?? row.brandId ?? row.id) === brandId)) {
      return remote;
    }
    if (rows.length < pageSize) return remote;
  }
  throw new ReadinessBuildError(
    "provider_read",
    "LAZADA_MY_BRAND_CATALOG_SCAN_LIMIT",
    "/category/brands/query",
  );
}

/**
 * Builds the exact 010 input from server-owned evidence plus official current
 * reads. It never accepts browser booleans and has no CreateProduct callback.
 */
export async function buildLazadaMyCreateReadinessInput(input: {
  evidence: LazadaMyCreateServerEvidence;
  operatorEvidence: LazadaMyCreateApprovedOperatorEvidence;
  signal: AbortSignal;
  now?: Date;
  dependencies: LazadaMyCreateReadinessBuilderDependencies;
}): Promise<BuilderSuccess | BuilderFailure> {
  const revision = text(input.evidence.revision);
  const providerReads: Array<{
    method: "GET";
    path: LazadaMyCreateProviderRead["path"];
    params: Readonly<Record<string, string>>;
  }> = [];
  try {
    assertServerEvidence(input);
    const context = assertLazadaMyListingCreateContext(
      input.evidence.argumentsValue,
    );
    const sellerSkus = lazadaCreateSellerSkus(input.evidence.argumentsValue);
    const read = async (
      request: Omit<LazadaMyCreateProviderRead, "revision" | "credential">,
    ) => {
      const frozenParams = Object.freeze({ ...request.params });
      providerReads.push(Object.freeze({
        method: "GET" as const,
        path: request.path,
        params: frozenParams,
      }));
      try {
        return await input.dependencies.readProvider({
          revision,
          credential: input.evidence.credential,
          method: "GET",
          path: request.path,
          params: frozenParams,
        });
      } catch (error) {
        throw new ReadinessBuildError(
          "provider_read",
          safeCode(error, "LAZADA_MY_CREATE_PROVIDER_READ_FAILED"),
          request.path,
        );
      }
    };

    const assertRevisionCurrent = async () => {
      try {
        await input.dependencies.assertRevisionCurrent(revision);
      } catch (error) {
        throw new ReadinessBuildError(
          "revision",
          safeCode(error, "LAZADA_MY_CREATE_EVIDENCE_REVISION_STALE"),
        );
      }
    };
    await assertRevisionCurrent();
    const [seller, products, tree, attributes, brands, shipment, rate] =
      await Promise.all([
        read({ method: "GET", path: "/seller/get", params: {} }),
        read({
          method: "GET",
          path: "/products/get",
          params: {
            filter: "all",
            sku_seller_list: JSON.stringify(sellerSkus),
            options: "1",
            limit: "50",
            offset: "0",
          },
        }),
        read({
          method: "GET",
          path: "/category/tree/get",
          params: { language_code: "en_US" },
        }),
        read({
          method: "GET",
          path: "/category/attributes/get",
          params: {
            primary_category_id: context.categoryId,
            language_code: "en_US",
          },
        }),
        loadBrandCatalog({
          revision,
          credential: input.evidence.credential,
          argumentsValue: input.evidence.argumentsValue,
          read,
        }),
        read({ method: "GET", path: "/shipment/providers/get", params: {} }),
        input.dependencies.loadAuthoritativeRate({
          revision,
          signal: input.signal,
        }),
      ]);
    await assertRevisionCurrent();

    // Fail at the builder boundary rather than allowing a malformed absence
    // response to survive until a later shared executor.
    try {
      assertLazadaCreateSellerSkuAbsence(products, sellerSkus);
    } catch (error) {
      throw new ReadinessBuildError(
        "readiness",
        safeCode(error, "LAZADA_MY_CREATE_SELLER_SKU_PREFLIGHT_FAILED"),
      );
    }
    const sellerVerifiedAt = input.evidence.observedAt;
    const readinessInput: LazadaMyCreateReadinessInput = {
      expected: input.evidence.expected,
      commerceApp: input.evidence.commerceApp,
      authorization: input.evidence.authorization,
      callback: input.evidence.callback,
      scope: input.evidence.scope,
      credential: input.evidence.credential,
      credentialRotatedAt: input.evidence.credentialRotatedAt,
      sellerGatewayResult: {
        ok: responseAccepted(seller),
        channel: "lazada",
        operation: "shops.get",
        steps: [{
          name: "seller-info",
          ok: responseAccepted(seller),
          status: seller.response.status,
          data: seller.data,
        }],
      },
      sellerVerifiedAt,
      target: input.evidence.target,
      argumentsValue: input.evidence.argumentsValue,
      category: {
        treeRequest: {
          path: "/category/tree/get",
          params: { language_code: "en_US" },
        },
        treeResponse: tree.data,
        attributesRequest: {
          path: "/category/attributes/get",
          params: {
            primary_category_id: context.categoryId,
            language_code: "en_US",
          },
        },
        attributesResponse: attributes.data,
      },
      brandCatalog: brands.data,
      sellerSkuLookup: {
        path: "/products/get",
        params: {
          filter: "all",
          sku_seller_list: JSON.stringify(sellerSkus),
          options: "1",
          limit: "50",
          offset: "0",
        },
        remote: products,
      },
      shipmentProviders: shipment.data,
      deliveryPolicy: input.operatorEvidence.deliveryPolicy,
      returnPolicy: input.operatorEvidence.returnPolicy,
      englishContentApproval: input.operatorEvidence.englishContentApproval,
      authoritativeRate: rate,
      now: input.now,
    };
    let readiness: ReturnType<typeof assertLazadaMyCreateReadiness>;
    try {
      readiness = assertLazadaMyCreateReadiness(readinessInput);
    } catch (error) {
      throw new ReadinessBuildError(
        "readiness",
        safeCode(error, "LAZADA_MY_CREATE_READINESS_FAILED"),
      );
    }
    await assertRevisionCurrent();
    return Object.freeze({
      ok: true,
      contract: lazadaMyCreateReadinessBuilderContract,
      revision,
      readinessInput: Object.freeze(readinessInput),
      readiness,
      providerReads: Object.freeze(providerReads),
    });
  } catch (error) {
    const failure = error instanceof ReadinessBuildError
      ? error
      : new ReadinessBuildError(
        "server_context",
        safeCode(error, "LAZADA_MY_CREATE_SERVER_CONTEXT_INVALID"),
      );
    return blocker({
      revision,
      stage: failure.stage,
      code: failure.message,
      endpoint: failure.endpoint,
    });
  }
}
