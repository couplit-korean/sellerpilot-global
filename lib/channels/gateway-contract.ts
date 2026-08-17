import { z } from "zod";
import { channelOperationNames } from "./operations";

const credentialPayloadSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 64_000,
  "credential payload too large",
);

export const gatewayClaimSchema = z.object({
  id: z.string().uuid(),
  credential_id: z.string().uuid(),
  channel: z.enum(["shopee", "lazada"]),
  operation: z.union([z.literal("oauth.exchange"), z.literal("shops.get"), z.enum(channelOperationNames)]),
  environment: z.enum(["sandbox", "production"]),
  request: z.record(z.string(), z.unknown()),
  credential: credentialPayloadSchema,
  attempt_count: z.number().int().min(1).max(6),
});

const operationResultSchema = z.object({
  ok: z.boolean(),
  channel: z.enum(["shopee", "lazada"]),
  operation: z.enum(channelOperationNames),
  steps: z.array(z.object({
    name: z.string().min(1).max(160),
    ok: z.boolean(),
    status: z.number().int().min(0).max(999),
    requestId: z.string().max(160).optional(),
    data: z.record(z.string(), z.unknown()),
  })).min(1).max(12),
  remoteId: z.string().max(240).optional(),
  safeMessage: z.string().min(1).max(1_000),
});

const credentialRefreshSchema = z.object({
  payload: credentialPayloadSchema,
  expiresAt: z.string().datetime().nullable(),
});

export const gatewayWorkerCompletionSchema = z.discriminatedUnion("status", [
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("succeeded"),
    result: z.union([
      operationResultSchema,
      z.object({
        ok: z.literal(true),
        channel: z.enum(["shopee", "lazada"]),
        operation: z.literal("oauth.exchange"),
        credentialPayload: credentialPayloadSchema,
        expiresAt: z.string().datetime().nullable(),
        safeMessage: z.string().min(1).max(1_000),
      }),
      z.object({
        ok: z.boolean(),
        channel: z.enum(["shopee", "lazada"]),
        operation: z.literal("shops.get"),
        steps: z.array(z.object({
          name: z.string().min(1).max(160),
          ok: z.boolean(),
          status: z.number().int().min(0).max(999),
          data: z.record(z.string(), z.unknown()),
        })).length(1),
        safeMessage: z.string().min(1).max(1_000),
      }),
    ]),
    credentialRefresh: credentialRefreshSchema.optional(),
  }),
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("failed"),
    error: z.string().min(1).max(500),
  }),
]);

export type GatewayClaim = z.infer<typeof gatewayClaimSchema>;
export type GatewayWorkerCompletion = z.infer<typeof gatewayWorkerCompletionSchema>;
