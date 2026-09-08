import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGraph,
  pathsToForbidden,
  isCs,
  isCommerce,
} from "./audit-cs-commerce-boundaries.mjs";
export function isShipping(file) {
  return (
    /^(?:app\/shipping\/|app\/api\/admin\/(?:shipping|orders)\/|lib\/shipping\/|scripts\/shipping-gateway-job\.mjs$)/.test(
      file,
    ) ||
    /^lib\/(?:order-|channels\/(?:order-sync|shipment-draft|shipment-release|ebay-shipment))/.test(
      file,
    )
  );
}
export function isProduct(file) {
  return isCommerce(file) && !isShipping(file);
}
export function auditDomains(graph = buildGraph()) {
  const domains = { product: isProduct, cs: isCs, shipping: isShipping };
  const paths = {};
  for (const [source, isSource] of Object.entries(domains))
    for (const [target, isTarget] of Object.entries(domains))
      if (source !== target)
        paths[`${source}To${target}`] = pathsToForbidden(
          graph,
          [...graph.keys()].filter(isSource),
          isTarget,
        );
  return paths;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const paths = auditDomains();
  const counts = Object.fromEntries(
    Object.entries(paths).map(([key, value]) => [key, value.length]),
  );
  console.log(JSON.stringify({ counts, paths }, null, 2));
  process.exitCode = Object.values(counts).some(Boolean) ? 1 : 0;
}
