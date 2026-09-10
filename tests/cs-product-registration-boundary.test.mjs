import assert from "node:assert/strict";
import test from "node:test";
import { audit, buildGraph, pathsToForbidden, isCs, isCommerce } from "../scripts/audit-cs-commerce-boundaries.mjs";

const graph = buildGraph();

test("CS and commerce modules cannot reach one another through imports, aliases, re-exports, or type imports", () => {
  assert.deepEqual(audit(graph), { csToCommerce: [], commerceToCs: [] });
});

test("CS executor cannot reach the legacy dispatcher, commerce executor, or mixed gateway", () => {
  assert.deepEqual(pathsToForbidden(graph, ["lib/cs/operations/execute.ts"], file => [
    "lib/channels/operations.ts", "lib/channels/commerce-operations.ts", "lib/channels/gateway.ts",
    "lib/channels/serverless-gateway.ts", "lib/channels/serverless-gateway-provider.ts",
  ].includes(file)), []);
});

test("CS workspace owns its state without importing the product shell or its snapshot hook", () => {
  assert.deepEqual(pathsToForbidden(graph, ["app/cs/workspace.tsx"], file => [
    "app/page.tsx", "app/use-operations-snapshot.ts", "app/ai-product-studio.tsx", "app/product-publish-workbench.tsx",
  ].includes(file)), []);
});

test("dependency traversal never stops at a shared execution boundary", () => {
  const fixture = new Map([
    ["cs", ["lib/channels/gateway.ts"]],
    ["lib/channels/gateway.ts", ["alias"]],
    ["alias", ["commerce"]],
  ]);
  assert.deepEqual(pathsToForbidden(fixture, ["cs"], file => file === "commerce"), [
    ["cs", "lib/channels/gateway.ts", "alias", "commerce"],
  ]);
});

test("Standalone CS page and its entire import graph cannot load product UI, product data or worker code", () => {
  assert.ok(graph.has("app/cs/page.tsx"));
  assert.deepEqual(pathsToForbidden(graph, ["app/cs/page.tsx"], file => /product|commerce|ai-cli-contract|use-operations-snapshot|app\/page/.test(file)), []);
});

// Legacy URLs remain owned by their domain even when they are compatibility routes.
test("legacy CS and product AI API entry points participate in the ownership audit", () => {
  assert.equal(isCs("app/api/ai/support-reply/route.ts"), true);
  assert.equal(isCommerce("app/api/ai/support-reply/route.ts"), false);
  assert.equal(isCs("app/cs-navigation.ts"), true);
  assert.equal(isCommerce("app/api/ai/worker/complete/route.ts"), true);
  const synthetic = new Map([
    ["app/api/ai/worker/complete/route.ts", ["shared"]],
    ["shared", ["lib/cs/draft-contract.ts"]],
    ["lib/cs/draft-contract.ts", []],
  ]);
  assert.equal(audit(synthetic).commerceToCs.length, 1);
});
