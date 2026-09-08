import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensions = [".ts", ".tsx", ".mjs", ".js", ".jsx"];
function walk(dir) {
  return fs.readdirSync(path.join(repositoryRoot, dir), { withFileTypes: true }).flatMap(entry => {
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : extensions.includes(path.extname(file)) ? [file] : [];
  });
}
export function buildGraph() {
  const files = new Set([...(walk("app")), ...walk("lib"), ...walk("scripts")]);
  const graph = new Map();
  for (const file of files) {
    const sf = ts.createSourceFile(file, fs.readFileSync(path.join(repositoryRoot, file), "utf8"), ts.ScriptTarget.Latest, true);
    const targets = new Set();
    const resolve = specifier => {
      const stem = specifier.startsWith("@/") ? specifier.slice(2)
        : specifier.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)) : null;
      if (!stem) return;
      const target = [stem, ...extensions.map(ext => stem + ext), ...extensions.map(ext => `${stem}/index${ext}`)].find(candidate => files.has(candidate));
      if (target) targets.add(target);
    };
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) resolve(node.moduleSpecifier.text);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) resolve(node.argument.literal.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) resolve(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    graph.set(file, [...targets]);
  }
  return graph;
}
export function pathsToForbidden(graph, roots, forbidden) {
  const result = [];
  for (const root of roots) {
    const queue = [[root]], visited = new Set([root]);
    for (let i = 0; i < queue.length; i++) {
      const chain = queue[i];
      for (const next of graph.get(chain.at(-1)) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        const nextChain = [...chain, next];
        if (forbidden(next)) result.push(nextChain);
        else queue.push(nextChain);
      }
    }
  }
  return result;
}
export function isCs(file) {
  return /^app\/(?:cs-[^/]+|api\/ai\/support-reply\/)/u.test(file)
    || /^(?:scripts\/cs-(?:draft-worker|gateway-job)\.mjs$|app\/api\/cs\/|app\/cs\/|app\/api\/admin\/cs\/|lib\/cs\/|lib\/channels\/cs\/)/u.test(file)
    || /^lib\/channels\/(?:cs-|inquiry|reply|.*-inquiries|.*-messages|.*-inquiry-history|lazada-im)/u.test(file);
}
export function isCommerce(file) {
  return (/^app\/api\/ai\//u.test(file) && !/^app\/api\/ai\/support-reply\//u.test(file))
    || /^(?:scripts\/(?:product-ai-worker|commerce-gateway-job)\.mjs$|app\/_publishing\/|app\/api\/admin\/(?:listing|listings|products?)\/|lib\/(?:product|publish|server-product|channel-listing-handoff))/u.test(file)
    || /^(?:app\/use-operations-snapshot|app\/api\/operations\/(?:snapshot|product-readiness)\/|app\/api\/admin\/channel-operations\/)/u.test(file)
    || /^lib\/ai-cli-contract\.ts$/.test(file)
    || /^app\/(?:product-|ai-product-studio)/u.test(file)
    || /^lib\/channels\/(?:commerce-operations|commerce-provider|commerce-completion|commerce-worker-completion|.*listing|order-sync|shipment)/u.test(file);
}
export function audit(graph = buildGraph()) {
  return {
    csToCommerce: pathsToForbidden(graph, [...graph.keys()].filter(isCs), isCommerce),
    commerceToCs: pathsToForbidden(graph, [...graph.keys()].filter(isCommerce), isCs),
  };
}
export function remainingCompositionRoots(graph = buildGraph()) {
  const roots = [
    "app/page.tsx", "app/api/operations/snapshot/route.ts", "app/api/operations/sync/route.ts",
    "app/api/channel-gateway/worker/complete/route.ts", "lib/channels/operations.ts",
    "lib/channels/gateway.ts", "lib/channels/serverless-gateway.ts", "lib/channels/serverless-gateway-provider.ts",
    "scripts/channel-gateway-worker.mjs", "scripts/ai-cli-worker.mjs",
  ];
  return roots.filter(root => pathsToForbidden(graph, [root], isCs).length > 0
    && pathsToForbidden(graph, [root], isCommerce).length > 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const graph = buildGraph();
  const result = audit(graph);
  const remaining = remainingCompositionRoots(graph);
  const moduleDependenciesPass = Object.values(result).every(paths => paths.length === 0);
  console.log(JSON.stringify({
    ...result,
    counts: Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.length])),
    moduleDependenciesPass,
    scope: "Business module dependency isolation; DB, lifecycle, and UI evidence are verified separately",
    compositionRoots: remaining,
  }, null, 2));
  process.exitCode = moduleDependenciesPass ? 0 : 1;
}
