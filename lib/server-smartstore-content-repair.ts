import { z } from "zod";

const uuidSchema = z.string().uuid();

export const smartstoreContentRepairRequestSchema = z.object({
  confirmApprovedContentRepair: z.literal(true),
}).strict();

const stateBase = z.object({
  contract: z.literal("smartstore_existing_content_repair_enqueue_v1"),
  productId: uuidSchema,
  reused: z.boolean(),
  contentVerified: z.boolean(),
  providerMutationPerformed: z.boolean(),
  normalUpdateEligible: z.boolean(),
}).strict();

const inactiveVerification = {
  verificationJobId: z.null(),
} as const;

const pendingRepair = stateBase.extend({
  jobId: uuidSchema,
  baselineId: uuidSchema,
  listingId: uuidSchema,
  contentVerified: z.literal(false),
  normalUpdateEligible: z.literal(false),
  ...inactiveVerification,
});

const pendingStrictVerification = stateBase.extend({
  jobId: uuidSchema,
  baselineId: uuidSchema,
  listingId: uuidSchema,
  verificationJobId: uuidSchema,
  reused: z.literal(true),
  contentVerified: z.literal(false),
  providerMutationPerformed: z.literal(true),
  normalUpdateEligible: z.literal(false),
});

/**
 * Service-only state for an existing SmartStore content repair. The database
 * derives every identifier and payload binding; the browser supplies only an
 * explicit confirmation to start the approved repair.
 */
export const smartstoreContentRepairStateSchema = z.union([
  stateBase.extend({
    status: z.literal("repair_required"),
    reason: z.literal("APPROVED_CONTENT_REPAIR_REQUIRED"),
    jobId: z.null(),
    baselineId: uuidSchema,
    listingId: uuidSchema,
    verificationJobId: z.null(),
    reused: z.literal(true),
    contentVerified: z.literal(false),
    providerMutationPerformed: z.literal(false),
    normalUpdateEligible: z.literal(false),
  }),
  pendingRepair.extend({
    status: z.literal("queued"),
    reason: z.literal("CONTENT_REPAIR_QUEUED"),
    providerMutationPerformed: z.literal(false),
  }),
  pendingRepair.extend({
    status: z.literal("running"),
    reason: z.literal("CONTENT_REPAIR_RUNNING"),
    providerMutationPerformed: z.boolean(),
    reused: z.literal(true),
  }),
  pendingRepair.extend({
    status: z.literal("reconciliation_required"),
    reason: z.literal("CONTENT_REPAIR_RECONCILIATION_REQUIRED"),
    providerMutationPerformed: z.literal(true),
    reused: z.literal(true),
  }),
  pendingStrictVerification.extend({
    status: z.literal("verification_queued"),
    reason: z.literal("STRICT_READBACK_QUEUED"),
  }),
  pendingStrictVerification.extend({
    status: z.literal("verification_running"),
    reason: z.literal("STRICT_READBACK_RUNNING"),
  }),
  pendingStrictVerification.extend({
    status: z.literal("verification_reconciliation_required"),
    reason: z.literal("STRICT_READBACK_RECONCILIATION_REQUIRED"),
  }),
  stateBase.extend({
    status: z.literal("verified"),
    reason: z.literal("ADOPTION_ALREADY_VERIFIED"),
    jobId: uuidSchema.nullable(),
    baselineId: uuidSchema,
    listingId: uuidSchema,
    verificationJobId: uuidSchema,
    reused: z.literal(true),
    contentVerified: z.literal(true),
    providerMutationPerformed: z.literal(true),
    normalUpdateEligible: z.literal(true),
  }),
  stateBase.extend({
    status: z.literal("blocked"),
    reason: z.enum([
      "REPAIR_BASELINE_REQUIRED",
      "REPAIR_BASELINE_STALE",
      "REPAIR_JOB_FAILED",
      "PREPARE_BLOCKED",
    ]),
    jobId: uuidSchema.nullable(),
    baselineId: uuidSchema.nullable(),
    listingId: uuidSchema.nullable(),
    verificationJobId: z.null(),
    contentVerified: z.literal(false),
    providerMutationPerformed: z.literal(false),
    normalUpdateEligible: z.literal(false),
  }),
  stateBase.extend({
    status: z.literal("blocked"),
    reason: z.literal("STRICT_READBACK_FAILED"),
    jobId: uuidSchema,
    baselineId: uuidSchema,
    listingId: uuidSchema,
    verificationJobId: uuidSchema,
    reused: z.literal(true),
    contentVerified: z.literal(false),
    providerMutationPerformed: z.literal(true),
    normalUpdateEligible: z.literal(false),
  }),
]);

export type SmartstoreContentRepairState = z.infer<
  typeof smartstoreContentRepairStateSchema
>;

export const smartstoreContentRepairCompletionSchema = z.discriminatedUnion("status", [
  z.object({
    contract: z.literal("smartstore_existing_content_repair_completion_v1"),
    status: z.literal("verification_queued"),
    reason: z.literal("STRICT_READBACK_QUEUED"),
    jobId: uuidSchema,
    baselineId: uuidSchema,
    verificationJobId: uuidSchema,
    readbackSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    reused: z.boolean(),
  }).strict(),
  z.object({
    contract: z.literal("smartstore_existing_content_repair_completion_v1"),
    status: z.enum(["failed", "reconciliation_required"]),
    reason: z.enum(["CONTENT_REPAIR_FAILED", "CONTENT_REPAIR_RECONCILIATION_REQUIRED"]),
    jobId: uuidSchema,
    baselineId: uuidSchema,
    verificationJobId: z.null(),
    readbackSha256: z.null(),
    reused: z.boolean(),
  }).strict().superRefine((value, context) => {
    const expected = value.status === "failed"
      ? "CONTENT_REPAIR_FAILED"
      : "CONTENT_REPAIR_RECONCILIATION_REQUIRED";
    if (value.reason !== expected) {
      context.addIssue({ code: "custom", path: ["reason"], message: "repair status and reason differ" });
    }
  }),
  z.object({
    contract: z.literal("smartstore_existing_content_repair_completion_v1"),
    status: z.literal("lease_lost"),
    reason: z.literal("CLAIM_LEASE_LOST"),
    jobId: uuidSchema,
    baselineId: uuidSchema.nullable(),
    verificationJobId: z.null(),
    readbackSha256: z.null(),
    reused: z.boolean(),
  }).strict(),
]);

export type SmartstoreContentRepairCompletion = z.infer<
  typeof smartstoreContentRepairCompletionSchema
>;
