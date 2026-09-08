import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGraph,
  pathsToForbidden,
} from "./audit-cs-commerce-boundaries.mjs";
export const channelModuleKeys = [
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "smartstore",
  "ebay",
  "temu",
];
export function channelModuleOwner(file) {
  return (
    file.match(
      /^lib\/(?:product-registration\/channels|shipping\/channels|cs\/channels|channels\/cs)\/(qoo10|shopee|lazada|coupang|elevenst|smartstore|ebay|temu)(?:\/|\.ts$)/,
    )?.[1] ?? null
  );
}
export function auditChannelModules(graph = buildGraph()) {
  const modules = channelModuleKeys.flatMap((channel) => [
    {
      domain: "product",
      channel,
      path: `lib/product-registration/channels/${channel}.ts`,
    },
    { domain: "cs", channel, path: `lib/cs/channels/${channel}/adapter.ts` },
    {
      domain: "shipping",
      channel,
      path: `lib/shipping/channels/${channel}.ts`,
    },
  ]);
  return {
    modules,
    missing: modules.filter((module) => !graph.has(module.path)),
    crossChannelDependencies: modules.flatMap((module) =>
      pathsToForbidden(graph, [module.path], (file) =>
        Boolean(
          channelModuleOwner(file) &&
            channelModuleOwner(file) !== module.channel,
        ),
      ),
    ),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = auditChannelModules();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode =
    result.missing.length || result.crossChannelDependencies.length ? 1 : 0;
}
