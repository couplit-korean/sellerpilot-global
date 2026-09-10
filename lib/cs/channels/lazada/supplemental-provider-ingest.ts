import { createHash } from "node:crypto";
import { z } from "zod";
import {
  lazadaRequest,
  runWithProviderReadOnlyTransport,
  type SecretPayload,
} from "../../../channels/protocols";
import {
  normalizeLazadaProviderAccountIdentity,
  readProviderAccountIdentity,
} from "../../../channels/provider-account-identity";
import {
  lazadaSupplementalSourcePathSchema,
  lazadaSupplementalStoredEventSchema,
  type LazadaSupplementalSourcePath,
} from "./supplemental-contract";
import { lazadaSupplementalReadPlan, normalizeLazadaSupplementalRead } from "./supplemental-read";

const countries = z.enum(["SG", "MY", "TH", "VN", "ID", "PH"]);

export const lazadaSupplementalProviderSyncRequestSchema = z.object({
  credentialId: z.string().uuid(),
  country: countries,
  sourcePath: lazadaSupplementalSourcePathSchema,
  resourceId: z.string().trim().regex(/^[1-9][0-9]{0,31}$/u).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
}).strict();

const preparedReadSchema = z.object({
  contractVersion: z.literal("sellerpilot-lazada-supplemental-read-prepare/1"),
  continuationId: z.string().uuid(),
  revision: z.number().int().min(0),
  grantId: z.string().uuid(),
  credentialId: z.string().uuid(),
  sellerAccountKey: z.string().regex(/^[a-f0-9]{64}$/u),
  country: countries,
  surface: z.enum(["product_review", "reverse_order_after_sales"]),
  sourcePath: lazadaSupplementalSourcePathSchema,
  resourceId: z.string().max(240),
  pageSize: z.number().int().min(1).max(50),
  pageNumber: z.number().int().min(1),
  readOnly: z.literal(true),
  mutationAllowed: z.literal(false),
}).strict();

const paginationSchema = z.object({
  contractVersion: z.literal("sellerpilot-lazada-supplemental-provider-page/1"),
  kind: z.enum(["provider_page", "single_page"]),
  pageNumber: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(50),
  total: z.number().int().min(0),
  entryCount: z.number().int().min(0).max(100),
  hasMore: z.boolean(),
  nextPage: z.number().int().min(2).nullable(),
}).strict();

const acknowledgedReadSchema = z.object({
  contractVersion: z.literal("sellerpilot-lazada-supplemental-page-ingest/1"),
  continuationId: z.string().uuid(),
  revision: z.number().int().min(1),
  credentialId: z.string().uuid(),
  country: countries,
  surface: z.enum(["product_review", "reverse_order_after_sales"]),
  sourcePath: lazadaSupplementalSourcePathSchema,
  pageNumber: z.number().int().min(1),
  complete: z.boolean(),
  nextPage: z.number().int().min(2).nullable(),
  replayed: z.boolean(),
  readOnly: z.literal(true),
  mutationAllowed: z.literal(false),
  writerReceipt: z.record(z.string(), z.unknown()),
}).strict();

type SyncInput = z.infer<typeof lazadaSupplementalProviderSyncRequestSchema>;
type PreparedRead = z.infer<typeof preparedReadSchema>;
type ProviderPagination = z.infer<typeof paginationSchema>;

type RpcResult = { data: unknown; error: unknown };
type Dependencies = {
  prepare(input: SyncInput): Promise<RpcResult>;
  readCredential(credentialId: string): Promise<RpcResult>;
  ingestAndAcknowledge(input: {
    continuationId: string;
    expectedRevision: number;
    credentialId: string;
    country: string;
    surface: string;
    sourcePath: LazadaSupplementalSourcePath;
    resourceId: string;
    pageNumber: number;
    pageSize: number;
    rows: z.infer<typeof lazadaSupplementalStoredEventSchema>[];
    pagination: ProviderPagination;
  }): Promise<RpcResult>;
  request?: typeof lazadaRequest;
  now?: () => Date;
};

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function integer(value: unknown, code: string) {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") throw new Error(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code);
  return parsed;
}

function arrayLength(value: unknown, code: string, maximum = 50) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(code);
  return value.length;
}

function providerPagination(payload: unknown, plan: ReturnType<typeof lazadaSupplementalReadPlan>) {
  const root = object(payload, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
  if (plan.sourcePath === "/order/reverse/return/detail/list") {
    if (plan.pageNumber !== 1) throw new Error("LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
    const data = object(root.data, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
    const entryCount = arrayLength(data.reverseOrderLineDTOList, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID", 100);
    return paginationSchema.parse({
      contractVersion: "sellerpilot-lazada-supplemental-provider-page/1",
      kind: "single_page",
      pageNumber: 1,
      pageSize: plan.pageSize,
      total: entryCount,
      entryCount,
      hasMore: false,
      nextPage: null,
    });
  }

  let pageEnvelope: Record<string, unknown>;
  let pageValue: unknown;
  let pageSizeValue: unknown;
  let entries: unknown;
  if (plan.sourcePath === "/review/seller/list") {
    pageEnvelope = object(root.data, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
    pageValue = pageEnvelope.current;
    pageSizeValue = pageEnvelope.page_size;
    entries = pageEnvelope.data;
  } else if (plan.sourcePath === "/reverse/getreverseordersforseller") {
    pageEnvelope = object(root.result, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
    pageValue = pageEnvelope.page_no;
    pageSizeValue = pageEnvelope.page_size;
    entries = pageEnvelope.items;
  } else {
    const data = object(root.data, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
    pageEnvelope = object(data.page_info, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
    pageValue = pageEnvelope.current_page_number;
    pageSizeValue = pageEnvelope.page_size;
    entries = data.list;
  }
  const pageNumber = integer(pageValue, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
  const pageSize = integer(pageSizeValue, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
  const total = integer(pageEnvelope.total, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
  const entryCount = arrayLength(entries, "LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
  const expectedEntryCount = Math.min(pageSize, Math.max(0, total - (pageNumber - 1) * pageSize));
  if (pageNumber !== plan.pageNumber || pageSize !== plan.pageSize || pageNumber < 1 || pageSize < 1
      || entryCount !== expectedEntryCount) {
    throw new Error("LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
  }
  const hasMore = pageNumber * pageSize < total;
  if (hasMore && entryCount === 0) throw new Error("LAZADA_SUPPLEMENTAL_PAGINATION_INVALID");
  return paginationSchema.parse({
    contractVersion: "sellerpilot-lazada-supplemental-provider-page/1",
    kind: "provider_page",
    pageNumber,
    pageSize,
    total,
    entryCount,
    hasMore,
    nextPage: hasMore ? pageNumber + 1 : null,
  });
}

function assertPreparedBinding(input: SyncInput, prepared: PreparedRead) {
  const resourceId = input.resourceId ?? "";
  if (prepared.credentialId !== input.credentialId
      || prepared.country !== input.country
      || prepared.sourcePath !== input.sourcePath
      || prepared.resourceId !== resourceId
      || prepared.pageSize !== (input.pageSize ?? 20)) {
    throw new Error("LAZADA_SUPPLEMENTAL_PREPARE_BINDING_MISMATCH");
  }
}

function assertCredentialBinding(payload: SecretPayload, prepared: PreparedRead) {
  const declaredCountry = typeof payload.country === "string" ? payload.country.trim().toUpperCase() : "";
  if (declaredCountry && declaredCountry !== prepared.country) {
    throw new Error("LAZADA_SUPPLEMENTAL_CREDENTIAL_COUNTRY_MISMATCH");
  }
  const storedIdentity = readProviderAccountIdentity(payload, "lazada");
  const normalized = normalizeLazadaProviderAccountIdentity(payload);
  if (!storedIdentity || storedIdentity.subject !== normalized.identity.subject
      || !normalized.countryUserInfo.some((store) => store.country.toUpperCase() === prepared.country)) {
    throw new Error("LAZADA_SUPPLEMENTAL_CREDENTIAL_ACCOUNT_MISMATCH");
  }
  const accountKey = createHash("sha256")
    .update(["lazada", "production", storedIdentity.subject].join("\u001f"), "utf8")
    .digest("hex");
  if (accountKey !== prepared.sellerAccountKey) {
    throw new Error("LAZADA_SUPPLEMENTAL_CREDENTIAL_ACCOUNT_MISMATCH");
  }
}

function rpcErrorText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const error = value as Record<string, unknown>;
  return [error.code, error.message, error.details].filter((part) => typeof part === "string").join(" ");
}

/** Executes exactly one permission-gated read page and acknowledges continuation only through the atomic writer RPC. */
export async function ingestLazadaSupplementalProviderPage(rawInput: unknown, dependencies: Dependencies) {
  const input = lazadaSupplementalProviderSyncRequestSchema.parse(rawInput);
  const preparedResult = await dependencies.prepare(input);
  if (preparedResult.error) {
    const failure = rpcErrorText(preparedResult.error);
    if (/EXACT_PERMISSION_REQUIRED|CREDENTIAL_UNBOUND|42501/u.test(failure)) {
      throw new Error("LAZADA_SUPPLEMENTAL_PERMISSION_REQUIRED");
    }
    throw new Error("LAZADA_SUPPLEMENTAL_PREPARE_UNAVAILABLE");
  }
  const prepared = preparedReadSchema.parse(preparedResult.data);
  assertPreparedBinding(input, prepared);
  const plan = lazadaSupplementalReadPlan({
    sourcePath: prepared.sourcePath,
    country: prepared.country,
    pageSize: prepared.pageSize,
    pageNumber: prepared.pageNumber,
    ...(prepared.resourceId ? { resourceId: prepared.resourceId } : {}),
  });
  if (plan.surface !== prepared.surface) throw new Error("LAZADA_SUPPLEMENTAL_PREPARE_BINDING_MISMATCH");

  const credentialResult = await dependencies.readCredential(prepared.credentialId);
  if (credentialResult.error) throw new Error("LAZADA_SUPPLEMENTAL_CREDENTIAL_UNAVAILABLE");
  const payload = object(credentialResult.data, "LAZADA_SUPPLEMENTAL_CREDENTIAL_UNAVAILABLE");
  assertCredentialBinding(payload, prepared);

  const request = dependencies.request ?? lazadaRequest;
  const remote = await runWithProviderReadOnlyTransport(() => request({
    payload: { ...payload, country: prepared.country.toLowerCase() },
    path: plan.sourcePath,
    method: "GET",
    params: plan.parameters,
  }));
  if (!remote.response.ok) throw new Error("LAZADA_SUPPLEMENTAL_PROVIDER_HTTP_FAILURE");
  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const rows = z.array(lazadaSupplementalStoredEventSchema).max(100).parse(normalizeLazadaSupplementalRead({
    credentialId: prepared.credentialId,
    country: prepared.country,
    sourcePath: prepared.sourcePath,
    resourceId: prepared.resourceId || undefined,
    observedAt,
    payload: remote.data,
  }));
  const pagination = providerPagination(remote.data, plan);
  const acknowledged = await dependencies.ingestAndAcknowledge({
    continuationId: prepared.continuationId,
    expectedRevision: prepared.revision,
    credentialId: prepared.credentialId,
    country: prepared.country,
    surface: prepared.surface,
    sourcePath: prepared.sourcePath,
    resourceId: prepared.resourceId,
    pageNumber: prepared.pageNumber,
    pageSize: prepared.pageSize,
    rows,
    pagination,
  });
  if (acknowledged.error) throw new Error("LAZADA_SUPPLEMENTAL_INGEST_ACK_FAILED");
  const receipt = acknowledgedReadSchema.parse(acknowledged.data);
  if (receipt.continuationId !== prepared.continuationId
      || receipt.credentialId !== prepared.credentialId
      || receipt.country !== prepared.country
      || receipt.surface !== prepared.surface
      || receipt.sourcePath !== prepared.sourcePath
      || receipt.pageNumber !== prepared.pageNumber
      || receipt.complete === pagination.hasMore
      || receipt.nextPage !== pagination.nextPage) {
    throw new Error("LAZADA_SUPPLEMENTAL_INGEST_ACK_MISMATCH");
  }
  return receipt;
}
