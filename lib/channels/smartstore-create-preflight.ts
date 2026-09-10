import type { RemoteResponse } from "./protocols";

/** A failed, partial, or nonempty seller-code search never permits CREATE.
 * Existing products must use the identity-bound listing.update workflow. */
export function assertSmartstoreCreateAbsence(remote: RemoteResponse) {
  const data = remote.data;
  if (remote.response.status !== 200 || data.code || !Array.isArray(data.contents)
      || data.page !== 1 || data.size !== 50 || data.first !== true || data.last !== true
      || !Number.isSafeInteger(data.totalElements) || data.totalElements !== data.contents.length
      || data.totalPages !== (data.contents.length === 0 ? 0 : 1)) {
    throw new Error("NAVER_DUPLICATE_PREFLIGHT_FAILED");
  }
  if (data.contents.length !== 0) throw new Error("NAVER_EXISTING_PRODUCT_REQUIRES_UPDATE");
}
