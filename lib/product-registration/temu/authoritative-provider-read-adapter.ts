import {
  runWithProviderReadOnlyTransport,
  temuRequest,
  type RemoteResponse,
  type SecretPayload,
} from "../../channels/protocols";
import {
  normalizeTemuAccessTokenIdentity,
  readTemuAccountIdentityBinding,
} from "./account-identity";
import {
  normalizeTemuIdentityRead,
  temuGeneralCreateIdentityQueries,
  type TemuIdentityQuery,
} from "./create-contract";
import type {
  TemuAuthoritativeClock,
  TemuAuthoritativeReadDependencies,
  TemuOfficialExactDuplicateRead,
} from "./authoritative-source-collector";

export type TemuAuthoritativeProviderReadErrorCode =
  | "TEMU_AUTHORITATIVE_ADAPTER_CONFIGURATION_INVALID"
  | "TEMU_AUTHORITATIVE_CREDENTIAL_REQUIRED"
  | "TEMU_AUTHORITATIVE_CREDENTIAL_BINDING_REQUIRED"
  | "TEMU_AUTHORITATIVE_READ_SCOPE_MISMATCH"
  | "TEMU_AUTHORITATIVE_READ_AUTHORIZATION_REJECTED"
  | "TEMU_AUTHORITATIVE_READ_TRANSPORT_FAILED"
  | "TEMU_AUTHORITATIVE_TOKEN_INFO_MALFORMED"
  | "TEMU_AUTHORITATIVE_TOKEN_ACCOUNT_MISMATCH";

export class TemuAuthoritativeProviderReadError extends Error {
  readonly code: TemuAuthoritativeProviderReadErrorCode;

  constructor(code: TemuAuthoritativeProviderReadErrorCode) {
    super(code);
    this.name = "TemuAuthoritativeProviderReadError";
    this.code = code;
  }
}

type TemuSignedReadRequest = (input: {
  payload: SecretPayload;
  type: string;
  arguments?: Record<string, unknown>;
}) => Promise<RemoteResponse>;

export type TemuAuthoritativeProviderReadAdapter = Pick<
  TemuAuthoritativeReadDependencies,
  "readTokenInfo" | "readExactGoods" | "readExactSku"
>;

export type CreateTemuAuthoritativeProviderReadAdapterInput = {
  payload: SecretPayload;
  expectedMallId: string;
  expectedRegionId: string;
  productRevisionFingerprint: string;
  externalGoodsId: string;
  externalSkuId: string;
  createBody: unknown;
  request?: TemuSignedReadRequest;
  clock: TemuAuthoritativeClock;
};

const tokenInfoMethod = "bg.open.accesstoken.info.get" as const;

function exactText(value: unknown, maxLength: number) {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maxLength
    && !/\p{Cc}/u.test(value);
}

function positiveIntegerText(value: unknown) {
  return typeof value === "string"
    && /^[1-9]\d*$/u.test(value);
}

function validFingerprint(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function requiredCredentialFieldsPresent(payload: SecretPayload) {
  return ["app_key", "app_secret", "access_token"].every((key) =>
    exactText(payload[key], 4_096));
}

function assertTransport(remote: RemoteResponse) {
  if (remote.response.ok) return;
  if (remote.response.status === 401 || remote.response.status === 403) {
    throw new TemuAuthoritativeProviderReadError(
      "TEMU_AUTHORITATIVE_READ_AUTHORIZATION_REJECTED",
    );
  }
  throw new TemuAuthoritativeProviderReadError(
    "TEMU_AUTHORITATIVE_READ_TRANSPORT_FAILED",
  );
}

function boundedFailure(error: unknown): never {
  if (error instanceof TemuAuthoritativeProviderReadError) throw error;
  throw new TemuAuthoritativeProviderReadError(
    "TEMU_AUTHORITATIVE_READ_TRANSPORT_FAILED",
  );
}

function findExactQueries(input: {
  createBody: unknown;
  externalGoodsId: string;
  externalSkuId: string;
}) {
  let generated: TemuIdentityQuery[];
  try {
    generated = temuGeneralCreateIdentityQueries(input.createBody);
  } catch {
    throw new TemuAuthoritativeProviderReadError(
      "TEMU_AUTHORITATIVE_ADAPTER_CONFIGURATION_INVALID",
    );
  }
  const goods = generated.find((query) =>
    query.arguments.outGoodsSnList?.length === 1
    && query.arguments.outGoodsSnList[0] === input.externalGoodsId
    && query.arguments.outSkuSnList === undefined);
  const skuBatch = generated.find((query) =>
    query.arguments.outGoodsSnList === undefined
    && query.arguments.outSkuSnList?.includes(input.externalSkuId));
  if (!goods || !skuBatch) {
    throw new TemuAuthoritativeProviderReadError(
      "TEMU_AUTHORITATIVE_ADAPTER_CONFIGURATION_INVALID",
    );
  }
  const sku: TemuIdentityQuery = {
    method: skuBatch.method,
    arguments: {
      outSkuSnList: [input.externalSkuId],
      pageSize: 25,
    },
  };
  return { goods, sku };
}

function duplicateDto(input: {
  query: TemuIdentityQuery;
  remote: RemoteResponse;
  observedAtEpochMs: number;
  mallId: string;
  productRevisionFingerprint: string;
  externalId: string;
}): TemuOfficialExactDuplicateRead {
  const normalized = normalizeTemuIdentityRead({
    query: input.query,
    response: input.remote.data,
  });
  const observedCount = Math.min(
    normalized.observedGoodsCount ?? 0,
    100,
  );
  return {
    observedAtEpochMs: input.observedAtEpochMs,
    mallId: input.mallId,
    productRevisionFingerprint: input.productRevisionFingerprint,
    externalId: input.externalId,
    items: Array.from(
      { length: observedCount },
      () => ({ collision: true as const }),
    ),
    total: normalized.total ?? null,
    continuationToken: normalized.complete ? null : "INCOMPLETE_PAGE",
  };
}

export function createTemuAuthoritativeProviderReadAdapter(
  input: CreateTemuAuthoritativeProviderReadAdapterInput,
): TemuAuthoritativeProviderReadAdapter {
  if (!positiveIntegerText(input.expectedMallId)
    || !positiveIntegerText(input.expectedRegionId)
    || !validFingerprint(input.productRevisionFingerprint)
    || !exactText(input.externalGoodsId, 128)
    || !exactText(input.externalSkuId, 128)) {
    throw new TemuAuthoritativeProviderReadError(
      "TEMU_AUTHORITATIVE_ADAPTER_CONFIGURATION_INVALID",
    );
  }
  const queries = findExactQueries(input);
  const request = input.request ?? temuRequest;
  const serverNowEpochMs = input.clock.nowEpochMs;

  function assertCredential() {
    if (!requiredCredentialFieldsPresent(input.payload)) {
      throw new TemuAuthoritativeProviderReadError(
        "TEMU_AUTHORITATIVE_CREDENTIAL_REQUIRED",
      );
    }
    const binding = readTemuAccountIdentityBinding(input.payload);
    if (!binding
      || binding.mallId !== input.expectedMallId
      || binding.regionId !== input.expectedRegionId) {
      throw new TemuAuthoritativeProviderReadError(
        "TEMU_AUTHORITATIVE_CREDENTIAL_BINDING_REQUIRED",
      );
    }
  }

  function assertScope(scope: {
    mallId: string;
    productRevisionFingerprint: string;
    externalId: string;
  }, expectedExternalId: string) {
    if (scope.mallId !== input.expectedMallId
      || scope.productRevisionFingerprint !== input.productRevisionFingerprint
      || scope.externalId !== expectedExternalId) {
      throw new TemuAuthoritativeProviderReadError(
        "TEMU_AUTHORITATIVE_READ_SCOPE_MISMATCH",
      );
    }
  }

  async function signedRead(query: TemuIdentityQuery) {
    try {
      const remote = await runWithProviderReadOnlyTransport(() => request({
        payload: input.payload,
        type: query.method,
        arguments: query.arguments,
      }));
      assertTransport(remote);
      return remote;
    } catch (error) {
      return boundedFailure(error);
    }
  }

  return {
    readTokenInfo: async () => {
      assertCredential();
      let remote: RemoteResponse;
      try {
        remote = await runWithProviderReadOnlyTransport(() => request({
          payload: input.payload,
          type: tokenInfoMethod,
        }));
        assertTransport(remote);
      } catch (error) {
        return boundedFailure(error);
      }
      const observedAtEpochMs = serverNowEpochMs();
      const identity = normalizeTemuAccessTokenIdentity({
        response: remote.data,
        responseText: remote.text,
      });
      if (!identity) {
        throw new TemuAuthoritativeProviderReadError(
          "TEMU_AUTHORITATIVE_TOKEN_INFO_MALFORMED",
        );
      }
      if (identity.mallId !== input.expectedMallId
        || identity.regionId !== input.expectedRegionId) {
        throw new TemuAuthoritativeProviderReadError(
          "TEMU_AUTHORITATIVE_TOKEN_ACCOUNT_MISMATCH",
        );
      }
      const active = Number.isFinite(observedAtEpochMs)
        && BigInt(identity.expiresAtSeconds)
          > BigInt(Math.floor(observedAtEpochMs / 1_000) + 300);
      return {
        observedAtEpochMs,
        active,
        mallId: identity.mallId,
        regionId: identity.regionId,
        subject: identity.subject,
        apiScopes: identity.apiScopes,
      };
    },
    readExactGoods: async (scope) => {
      assertScope({
        mallId: scope.mallId,
        productRevisionFingerprint: scope.productRevisionFingerprint,
        externalId: scope.externalGoodsId,
      }, input.externalGoodsId);
      assertCredential();
      const remote = await signedRead(queries.goods);
      return duplicateDto({
        query: queries.goods,
        remote,
        observedAtEpochMs: serverNowEpochMs(),
        mallId: input.expectedMallId,
        productRevisionFingerprint: input.productRevisionFingerprint,
        externalId: input.externalGoodsId,
      });
    },
    readExactSku: async (scope) => {
      assertScope({
        mallId: scope.mallId,
        productRevisionFingerprint: scope.productRevisionFingerprint,
        externalId: scope.externalSkuId,
      }, input.externalSkuId);
      assertCredential();
      const remote = await signedRead(queries.sku);
      return duplicateDto({
        query: queries.sku,
        remote,
        observedAtEpochMs: serverNowEpochMs(),
        mallId: input.expectedMallId,
        productRevisionFingerprint: input.productRevisionFingerprint,
        externalId: input.externalSkuId,
      });
    },
  };
}
