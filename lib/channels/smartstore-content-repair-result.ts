import { createHash } from "node:crypto";
import { z } from "zod";
import { externalDetailCanonical } from "../external-detail-canonical";
import {
  smartstoreContentRepairResultSchema,
  smartstoreManualAdoptionReadbackSchema,
} from "./gateway-contract";
import {
  smartstoreContentRepairBindingSchema,
  smartstoreContentRepairTransmissionImagesSchema,
} from "./smartstore-content-repair-contract";
import { smartstoreContentRepairBodyHashes } from "./smartstore-content-repair";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const mutationEvidenceSchema = z.object({
  contract: z.literal("smartstore_existing_content_repair_mutation_v1"),
  originProductNo: z.string(),
  channelProductNo: z.string(),
  baselineBodySha256: digest,
  prewriteProtectedBodySha256: digest,
  prewriteOriginResponseSha256: digest,
  prewriteChannelResponseSha256: digest,
}).strict();

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Builds the only repair result accepted by the dedicated completion RPC.
 * The postwrite reader is read-only and its pixel hashes must match the exact
 * normalized JPEG bytes that were uploaded before the provider PUT. */
export function buildSmartstoreContentRepairResult(input: {
  binding: unknown;
  mutationEvidence: unknown;
  approvedTransmissionImages: unknown;
  postwriteReadback: unknown;
}) {
  const binding = smartstoreContentRepairBindingSchema.parse(input.binding);
  const mutation = mutationEvidenceSchema.parse(input.mutationEvidence);
  const approvedTransmissionImages = smartstoreContentRepairTransmissionImagesSchema.parse(
    input.approvedTransmissionImages,
  );
  const postwriteReadback = smartstoreManualAdoptionReadbackSchema.parse(input.postwriteReadback);
  const postwriteOriginProduct = record(postwriteReadback.originReadback.response.originProduct);
  const postwriteChannelProduct = record(
    postwriteReadback.channelReadback.response.smartstoreChannelProduct,
  );
  if (!postwriteOriginProduct || !postwriteChannelProduct
      || mutation.originProductNo !== binding.originProductNo
      || mutation.channelProductNo !== binding.channelProductNo
      || mutation.baselineBodySha256 !== binding.baselineBodySha256
      || mutation.prewriteProtectedBodySha256 !== binding.protectedBodySha256) {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_MUTATION_EVIDENCE_INVALID");
  }
  const postwriteHashes = smartstoreContentRepairBodyHashes({
    originProduct: postwriteOriginProduct,
    smartstoreChannelProduct: postwriteChannelProduct,
  });
  const responseSha256 = (value: unknown) => createHash("sha256")
    .update(externalDetailCanonical(value))
    .digest("hex");
  return smartstoreContentRepairResultSchema.parse({
    contract: "smartstore_existing_content_repair_result_v1",
    source: "smartstore_official_content_repair_v1",
    observedAt: postwriteReadback.observedAt,
    providerMutationPerformed: true,
    originProductNo: binding.originProductNo,
    channelProductNo: binding.channelProductNo,
    baselineBodySha256: mutation.baselineBodySha256,
    prewriteProtectedBodySha256: mutation.prewriteProtectedBodySha256,
    postwriteProtectedBodySha256: postwriteHashes.protectedBodySha256,
    prewriteOriginResponseSha256: mutation.prewriteOriginResponseSha256,
    prewriteChannelResponseSha256: mutation.prewriteChannelResponseSha256,
    postwriteOriginResponseSha256: responseSha256(postwriteReadback.originReadback.response),
    postwriteChannelResponseSha256: responseSha256(postwriteReadback.channelReadback.response),
    approvedTransmissionImages,
    postwriteReadback,
  });
}
