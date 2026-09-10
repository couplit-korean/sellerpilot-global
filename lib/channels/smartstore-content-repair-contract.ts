import { z } from "zod";

export const smartstoreContentRepairArgument = "sellerpilotSmartstoreExistingContentRepair";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const remoteId = z.string().regex(/^[1-9][0-9]{5,19}$/);
export const smartstoreContentRepairBindingSchema = z.object({
  contract: z.literal("smartstore_existing_content_repair_job_v1"),
  ownerId: z.uuid(), baselineId: z.uuid(), productId: z.uuid(), listingId: z.uuid(),
  sourceJobId: z.uuid(), sourceAttemptId: z.uuid(), credentialId: z.uuid(),
  sellerAccountKey: sha, sellerSku: z.string().min(1).max(100).refine(value => value === value.trim()),
  originProductNo: remoteId, channelProductNo: remoteId,
  approvalRevision: z.number().int().positive(), contentSha256: sha, manifestDigest: sha,
  baselineBodySha256: sha, protectedBodySha256: sha,
}).strict();
export type SmartstoreContentRepairBinding = z.infer<typeof smartstoreContentRepairBindingSchema>;
export function smartstoreContentRepairBinding(argumentsValue: Record<string, unknown>) {
  if (!Object.hasOwn(argumentsValue, smartstoreContentRepairArgument)) return null;
  const parsed = smartstoreContentRepairBindingSchema.safeParse(argumentsValue[smartstoreContentRepairArgument]);
  if (!parsed.success) throw new Error("SMARTSTORE_CONTENT_REPAIR_MARKER_INVALID");
  return parsed.data;
}

export const smartstoreContentRepairTransmissionArgument = "sellerpilotSmartstoreContentRepairTransmissionImages";
export const smartstoreContentRepairTransmissionImagesSchema = z.array(z.object({
  index: z.number().int().min(0).max(7), url: z.url(), contentSha256: sha,
  decodedRgbaSha256: sha, width: z.number().int().min(600).max(1600), height: z.number().int().min(600).max(1600),
}).strict()).length(8).superRefine((images, context) => {
  if (images.some((image, index) => image.index !== index)
      || new Set(images.map(image => image.url)).size !== 8
      || new Set(images.map(image => image.contentSha256)).size !== 8
      || new Set(images.map(image => image.decodedRgbaSha256)).size !== 8) {
    context.addIssue({ code: "custom", message: "Ordered distinct transmission images required" });
  }
});
export type SmartstoreContentRepairTransmissionImages = z.infer<typeof smartstoreContentRepairTransmissionImagesSchema>;
