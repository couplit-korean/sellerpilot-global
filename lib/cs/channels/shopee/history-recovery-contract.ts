import { z } from "zod";

export const shopeeHistoryRecoveryRequestSchema = z.object({
  requestKey: z.string().uuid(),
  historyRunId: z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/u),
  scopeKey: z.string().min(1).max(200),
}).strict();

export const shopeeHistoryRecoveryResultSchema = z.object({
  contract: z.literal("sellerpilot-shopee-history-recovery/1"),
  status: z.enum(["queued", "reused"]),
  historyRunId: z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/u),
  scopeKey: z.string().min(1).max(200),
  recoveryJobId: z.string().uuid(),
  recoveryAttempt: z.number().int().min(1).max(3),
  inputCheckpointDigest: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
}).strict();

export type ShopeeHistoryRecoveryResult = z.infer<typeof shopeeHistoryRecoveryResultSchema>;
