import { productResearchPendingStorageKey } from "./product-research-lifecycle";

const resetMarker = "sellerpilot:registration-history-reset";
/** A server reset invalidates saved input only once in each browser tab. */
export function applyRegistrationHistoryReset(storage: Storage, clearedAt: unknown) {
  if (typeof clearedAt !== "string" || !Number.isFinite(Date.parse(clearedAt))
      || storage.getItem(resetMarker) === clearedAt) return false;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key?.startsWith("sellerpilot:publishing-draft:") || key === productResearchPendingStorageKey
        || key === "sellerpilot:product-studio:active-job:v1" || key?.startsWith("sellerpilot.pending-manual-product.v1:")) storage.removeItem(key);
  }
  storage.setItem(resetMarker, clearedAt);
  return true;
}
