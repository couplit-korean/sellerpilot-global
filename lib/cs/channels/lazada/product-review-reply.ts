import { z } from "zod";

const country = z.enum(["SG", "MY", "TH", "VN", "ID", "PH"]);

export const lazadaProductReviewReplyRequestSchema = z.object({
  credentialId: z.string().uuid(),
  country,
  reviewId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
  generation: z.number().int().min(1),
  reply: z.string().trim().min(1).max(500),
}).strict();

const preparedSchema = z.object({
  contract: z.literal("sellerpilot-lazada-product-review-reply-prepare/1"),
  deliveryId: z.string().uuid(),
  credentialId: z.string().uuid(),
  country,
  sellerAccountKey: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
  generation: z.number().int().min(1),
  identityFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.enum(["prepared", "queued", "running", "readback_required", "verified", "failed"]),
  replayed: z.boolean(),
  providerMutationPerformed: z.literal(false),
}).strict();

const enqueueSchema = z.object({
  contract: z.literal("sellerpilot-lazada-product-review-reply-enqueue/1"),
  deliveryId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  status: z.enum(["queued", "running", "readback_required", "verified", "failed"]),
  replayed: z.boolean(),
  providerMutationPerformed: z.literal(false),
  automaticResendAllowed: z.literal(false),
}).strict();

type RpcResult = { data: unknown; error: unknown };
type Dependencies = {
  prepare(input: z.infer<typeof lazadaProductReviewReplyRequestSchema>): Promise<RpcResult>;
  enqueue(input: z.infer<typeof preparedSchema>): Promise<RpcResult>;
};

function rpcError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const error = value as Record<string, unknown>;
  return [error.code, error.message, error.details].filter((part) => typeof part === "string").join(" ");
}

export async function prepareAndEnqueueLazadaProductReviewReply(raw: unknown, dependencies: Dependencies) {
  const input = lazadaProductReviewReplyRequestSchema.parse(raw);
  const preparedResult = await dependencies.prepare(input);
  if (preparedResult.error) {
    const reason = rpcError(preparedResult.error);
    if (/PERMISSION_REQUIRED|PERMISSION_REVOKED|CREDENTIAL_UNBOUND|REVIEW_ACCOUNT_MISMATCH|42501/u.test(reason)) {
      throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_PERMISSION_REQUIRED");
    }
    if (/ALREADY_REPLIED|REPLY_CONFLICT|GENERATION_STALE|23505|40001/u.test(reason)) {
      throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_CONFLICT");
    }
    throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_PREPARE_UNAVAILABLE");
  }
  const prepared = preparedSchema.parse(preparedResult.data);
  if (prepared.credentialId !== input.credentialId
      || prepared.country !== input.country
      || prepared.reviewId !== input.reviewId
      || prepared.generation !== input.generation) {
    throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_PREPARE_BINDING_MISMATCH");
  }
  if (["verified", "readback_required", "running", "failed"].includes(prepared.status)) {
    return {
      contract: "sellerpilot-lazada-product-review-reply-submit/1" as const,
      prepared,
      enqueue: null,
      providerMutationPerformed: false as const,
      automaticResendAllowed: false as const,
    };
  }
  const enqueuedResult = await dependencies.enqueue(prepared);
  if (enqueuedResult.error) {
    const reason = rpcError(enqueuedResult.error);
    if (/PERMISSION_REQUIRED|PERMISSION_REVOKED|CREDENTIAL_UNBOUND|42501/u.test(reason)) {
      throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_PERMISSION_REQUIRED");
    }
    if (/REPLY_CONFLICT|GENERATION_STALE|IN_PROGRESS|23505|40001/u.test(reason)) {
      throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_CONFLICT");
    }
    throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_ENQUEUE_UNAVAILABLE");
  }
  const enqueued = enqueueSchema.parse(enqueuedResult.data);
  if (enqueued.deliveryId !== prepared.deliveryId) {
    throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_ENQUEUE_BINDING_MISMATCH");
  }
  return {
    contract: "sellerpilot-lazada-product-review-reply-submit/1" as const,
    prepared,
    enqueue: enqueued,
    providerMutationPerformed: false as const,
    automaticResendAllowed: false as const,
  };
}
