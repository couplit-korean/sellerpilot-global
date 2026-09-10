import { z } from "zod";
import {
  ingestLazadaSupplementalProviderPage,
  lazadaSupplementalProviderSyncRequestSchema,
} from "./supplemental-provider-ingest";

export const lazadaSupplementalResyncRequestSchema = lazadaSupplementalProviderSyncRequestSchema.extend({
  completedContinuationId: z.string().uuid(),
  expectedCompletedRevision: z.number().int().min(1),
  startRequestId: z.string().uuid(),
}).strict();

const beginReceiptSchema = z.object({
  contractVersion: z.literal("sellerpilot-lazada-supplemental-resync-begin/1"),
  startRequestId: z.string().uuid(),
  continuationId: z.string().uuid(),
  completedContinuationId: z.string().uuid(),
  grantId: z.string().uuid(),
  credentialId: z.string().uuid(),
  sellerAccountKey: z.string().regex(/^[a-f0-9]{64}$/u),
  country: z.enum(["SG", "MY", "TH", "VN", "ID", "PH"]),
  surface: z.enum(["product_review", "reverse_order_after_sales"]),
  sourcePath: z.enum([
    "/review/seller/list",
    "/reverse/getreverseordersforseller",
    "/order/reverse/return/detail/list",
    "/order/reverse/return/history/list",
  ]),
  resourceId: z.string().max(32),
  pageSize: z.number().int().min(1).max(50),
  runNumber: z.number().int().min(2),
  revision: z.number().int().min(0),
  pageNumber: z.number().int().min(1),
  complete: z.boolean(),
  replayed: z.boolean(),
  readOnly: z.literal(true),
  mutationAllowed: z.literal(false),
}).strict();

const preparedResyncBindingSchema = z.object({
  continuationId: z.string().uuid(),
  revision: z.number().int().min(0),
  grantId: z.string().uuid(),
  credentialId: z.string().uuid(),
  sellerAccountKey: z.string().regex(/^[a-f0-9]{64}$/u),
  country: z.enum(["SG", "MY", "TH", "VN", "ID", "PH"]),
  surface: z.enum(["product_review", "reverse_order_after_sales"]),
  sourcePath: z.enum([
    "/review/seller/list",
    "/reverse/getreverseordersforseller",
    "/order/reverse/return/detail/list",
    "/order/reverse/return/history/list",
  ]),
  resourceId: z.string().max(32),
  pageSize: z.number().int().min(1).max(50),
  pageNumber: z.number().int().min(1),
});

type ResyncInput = z.infer<typeof lazadaSupplementalResyncRequestSchema>;
type RpcResult = { data: unknown; error: unknown };
type Dependencies = {
  begin(input: ResyncInput): Promise<RpcResult>;
  ingest: typeof ingestLazadaSupplementalProviderPage;
  ingestDependencies: Parameters<typeof ingestLazadaSupplementalProviderPage>[1];
};

function errorText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as Record<string, unknown>;
  return [row.code, row.message, row.details].filter((part) => typeof part === "string").join(" ");
}

function bindIngestToBegunRound(
  receipt: z.infer<typeof beginReceiptSchema>,
  dependencies: Dependencies["ingestDependencies"],
): Dependencies["ingestDependencies"] {
  return {
    ...dependencies,
    prepare: async (input) => {
      const preparedResult = await dependencies.prepare(input);
      if (preparedResult.error) {
        if (/READ_ALREADY_COMPLETE|SUPERSEDED_CONTINUATION|40001/u.test(errorText(preparedResult.error))) {
          throw new Error("LAZADA_SUPPLEMENTAL_RESYNC_BINDING_MISMATCH");
        }
        return preparedResult;
      }
      const prepared = preparedResyncBindingSchema.safeParse(preparedResult.data);
      if (!prepared.success
          || prepared.data.continuationId !== receipt.continuationId
          || prepared.data.revision !== receipt.revision
          || prepared.data.grantId !== receipt.grantId
          || prepared.data.credentialId !== receipt.credentialId
          || prepared.data.sellerAccountKey !== receipt.sellerAccountKey
          || prepared.data.country !== receipt.country
          || prepared.data.surface !== receipt.surface
          || prepared.data.sourcePath !== receipt.sourcePath
          || prepared.data.resourceId !== receipt.resourceId
          || prepared.data.pageSize !== receipt.pageSize
          || prepared.data.pageNumber !== receipt.pageNumber) {
        throw new Error("LAZADA_SUPPLEMENTAL_RESYNC_BINDING_MISMATCH");
      }
      return preparedResult;
    },
  };
}

export async function resyncLazadaSupplementalProviderPage(rawInput: unknown, dependencies: Dependencies) {
  const input = lazadaSupplementalResyncRequestSchema.parse(rawInput);
  const begun = await dependencies.begin(input);
  if (begun.error) {
    const reason = errorText(begun.error);
    if (/ALREADY_STARTED|REQUEST_CONFLICT|PARENT_MISMATCH|40001|23505/u.test(reason)) {
      throw new Error("LAZADA_SUPPLEMENTAL_RESYNC_CONFLICT");
    }
    if (/EXACT_PERMISSION_REQUIRED|CREDENTIAL_UNBOUND|42501/u.test(reason)) {
      throw new Error("LAZADA_SUPPLEMENTAL_RESYNC_PERMISSION_REQUIRED");
    }
    throw new Error("LAZADA_SUPPLEMENTAL_RESYNC_UNAVAILABLE");
  }
  const receipt = beginReceiptSchema.parse(begun.data);
  const resourceId = input.resourceId ?? "";
  if (receipt.startRequestId !== input.startRequestId
      || receipt.completedContinuationId !== input.completedContinuationId
      || receipt.credentialId !== input.credentialId
      || receipt.country !== input.country
      || receipt.sourcePath !== input.sourcePath
      || receipt.resourceId !== resourceId
      || receipt.pageSize !== (input.pageSize ?? 20)) {
    throw new Error("LAZADA_SUPPLEMENTAL_RESYNC_BINDING_MISMATCH");
  }
  if (receipt.complete) {
    return {
      contractVersion: "sellerpilot-lazada-supplemental-resync/1" as const,
      startRequestId: input.startRequestId,
      continuationId: receipt.continuationId,
      runNumber: receipt.runNumber,
      beginReplayed: true as const,
      providerRead: false as const,
      complete: true as const,
      pageReceipt: null,
      readOnly: true as const,
      mutationAllowed: false as const,
    };
  }
  const pageReceipt = await dependencies.ingest({
    credentialId: input.credentialId,
    country: input.country,
    sourcePath: input.sourcePath,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    ...(input.pageSize ? { pageSize: input.pageSize } : {}),
  }, bindIngestToBegunRound(receipt, dependencies.ingestDependencies));
  if (pageReceipt.continuationId !== receipt.continuationId) {
    throw new Error("LAZADA_SUPPLEMENTAL_RESYNC_BINDING_MISMATCH");
  }
  return {
    contractVersion: "sellerpilot-lazada-supplemental-resync/1" as const,
    startRequestId: input.startRequestId,
    continuationId: receipt.continuationId,
    runNumber: receipt.runNumber,
    beginReplayed: receipt.replayed,
    providerRead: true as const,
    complete: pageReceipt.complete,
    pageReceipt,
    readOnly: true as const,
    mutationAllowed: false as const,
  };
}
