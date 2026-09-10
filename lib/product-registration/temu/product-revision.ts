import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stable server-context fingerprint; excludes listings and signed URL expiry. */
export function temuProductRevisionFingerprint(
  context: Record<string, unknown>,
) {
  return createHash("sha256").update(canonical({
    contract: "temu_product_revision_v1",
    ownerId: context.ownerId,
    product: context.product,
    manualFields: context.manualFields,
    assignments: Array.isArray(context.assignments)
      ? context.assignments.filter((value) => value && typeof value === "object"
        && !Array.isArray(value)
        && (value as Record<string, unknown>).channel === "temu")
      : [],
    detailPage: context.detailPage,
    contentMode: context.contentMode,
  }), "utf8").digest("hex");
}
