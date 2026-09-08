import type { RemoteResponse } from "./protocols";

/** Transport 404 alone can be an HTML proxy or route error, not SKU absence. */
export function elevenstVerifiedSkuAbsence(remote: RemoteResponse) {
  const root = String(remote.data.lookupDocumentRoot ?? "").trim();
  const bytes = Number(remote.data.lookupBodyBytes);
  if (remote.data.productNo || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 4_096) return false;
  if ([200, 404].includes(remote.response.status)
      && /^(?:[A-Za-z_][\w.-]*:)?ClientMessage$/iu.test(root)
      && String(remote.data.resultCode ?? "").trim() === "404") return true;
  return remote.response.status === 200 && remote.data.accepted === true
    && /^(?:[A-Za-z_][\w.-]*:)?products$/iu.test(root)
    && Array.isArray(remote.data.products) && remote.data.products.length === 0;
}
