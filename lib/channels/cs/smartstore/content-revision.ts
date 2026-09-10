import { createHash } from "node:crypto";

const SMARTSTORE_BUYER_MESSAGE_LIMIT = 20000;

/**
 * Returns a deterministic revision for the exact buyer text returned by
 * SmartStore. The native inquiry ID remains the ticket identity; this digest
 * changes only the immutable inbound-message generation used by stale-reply
 * fences when the provider edits that inquiry in place.
 */
export function smartstoreBuyerContentRevision(message: unknown): string {
  if (typeof message !== "string"
      || !message.trim()
      || message.length > SMARTSTORE_BUYER_MESSAGE_LIMIT) {
    throw new Error("SMARTSTORE_BUYER_CONTENT_REVISION_INVALID");
  }
  return createHash("sha256")
    .update(["v1", "smartstore", "buyer", message].join("\u001f"))
    .digest("hex");
}
