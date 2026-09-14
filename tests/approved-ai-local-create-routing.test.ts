import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { isElevenstProcessedFoodCategory } from "../lib/channels/elevenst-listing";

const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("route.ts", route, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function declaration(name: string) {
  let result: ts.VariableDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result?.initializer, `${name} must remain a real route guard`);
  return result.initializer.getText(ast);
}
function allowed(overrides: Record<string, unknown> = {}, assignmentOverrides: Record<string, unknown> = {}) {
  const values = {
    channel: "elevenst", operation: "listing.create", environment: "production",
    verifiedProductContentMode: "ai_generated", elevenstCreateUsesApprovedServerSource: true,
    verifiedPublishContext: { assignments: [{ channel: "elevenst", environment: "production",
      market: "KR", status: "confirmed", categoryId: "1009792", ...assignmentOverrides }] },
    parsed: { data: { market: "KR", arguments: { product: { dispCtgrNo: "1009792" } } } },
    isRecord: (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value),
    isElevenstProcessedFoodCategory, ...overrides,
  };
  const implementation = ts.transpile(`return (${declaration("elevenstApprovedAiLocalCreate")});`, {
    target: ts.ScriptTarget.ES2022,
  });
  return new Function(...Object.keys(values), implementation)(...Object.values(values));
}

test("AI cider CREATE with the same confirmed production assignment uses the existing Mac route", () => {
  assert.equal(allowed(), true);
  assert.equal(allowed({ parsed: { data: { market: "KR", arguments: { product: { dispCtgrNo: "1346631" } } } } },
    { categoryId: "1346631" }), true);
  for (const overrides of [
    { channel: "temu" }, { channel: "coupang" }, { operation: "listing.update" },
    { environment: "sandbox" }, { verifiedProductContentMode: "manual_mvp" },
    { verifiedProductContentMode: "external_generated" }, { verifiedProductContentMode: null },
    { elevenstCreateUsesApprovedServerSource: false }, { verifiedPublishContext: null },
    { verifiedPublishContext: { assignments: [] } },
  ]) assert.equal(allowed(overrides), false, JSON.stringify(overrides));
  for (const assignment of [
    { channel: "temu" }, { environment: "sandbox" }, { market: "US" },
    { status: "suggested" }, { categoryId: "1346631" }, { categoryId: "9999999" },
  ]) assert.equal(allowed({}, assignment), false, JSON.stringify(assignment));
});

test("legacy blank Elevenst market resolves only to the official KR assignment at readiness and source selection", () => {
  for (const market of ["", "KR", "US"]) {
    const parsed = { data: { market, arguments: { product: { dispCtgrNo: "1009792" } } } };
    assert.equal(allowed({ parsed }), market !== "US");
    assert.equal(allowed({ parsed }, { market: "US" }), false);
    const assignment = { channel: "elevenst", environment: "production", market: "KR",
      categoryId: "1009792", status: "confirmed" };
    const select = new Function("elevenstCreateAssignments", "parsed", "isElevenstProcessedFoodCategory",
      `return (${declaration("elevenstProcessedFoodAssignment")});`);
    assert.deepEqual(select([assignment], parsed, isElevenstProcessedFoodCategory), market !== "US" ? assignment : undefined);
    assert.equal(select([{ ...assignment, market: "US" }], parsed, isElevenstProcessedFoodCategory), undefined);
    assert.equal(parsed.data.market, market, "comparison must leave the original request unchanged");
  }
});

test("the narrow AI route skips only incompatible pre-enqueue gates and retains server preparation before claim", () => {
  const conditions: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isIfStatement(node)) conditions.push(node.expression.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(conditions.some(value => value.startsWith("localExecutorAccess &&")
    && value.includes("!elevenstApprovedAiLocalCreate")));
  assert.ok(conditions.some(value => value.startsWith("providerMutationStaticEgressChannel &&")
    && value.includes("!localChannelExecutorReady") && value.includes("!elevenstApprovedAiLocalCreate")));
  const preparation = route.indexOf("prepared = await prepareElevenstNewProductCreateBeforeClaimFromRpc(");
  const claim = route.indexOf('"sellerpilot_claim_channel_operation"', preparation);
  assert.ok(preparation > 0 && claim > preparation);
  const preparationBlock = route.slice(preparation, claim);
  assert.match(preparationBlock, /if \(!prepared.ok\)/);
  assert.match(preparationBlock, /effectiveArguments = prepared.arguments/);
  assert.match(route, /elevenstCreateProduct\?\.dispCtgrNo !== elevenstProcessedFoodAssignment.categoryId/);
  assert.match(route, /ELEVENST_NEW_PRODUCT_SERVER_SOURCE_IDENTITY_INVALID/);
});

test("Temu only routes approved production AI CREATE locally, retaining app/source before claim", () => {
  const names = ["channel", "operation", "environment", "verifiedProductContentMode"];
  const check = new Function(...names, `return (${declaration("temuApprovedAiLocalCreate")});`);
  assert.equal(check("temu", "listing.create", "production", "ai_generated"), true);
  for (const [index,value] of [[0,"elevenst"],[1,"listing.update"],[1,"listing.activate"],
    [1,"listing.publication.verify"],[2,"sandbox"],[3,"manual_mvp"],[3,"external_generated"],[3,null]]) {
    const args = ["temu", "listing.create", "production", "ai_generated"];args[index as number]=value as string;
    assert.equal(check(...args), false);
  }
  assert.match(route, /if \(staticEgressChannel && !localChannelExecutorReady && !temuApprovedAiLocalCreate\)/);
  const source = route.indexOf("const produced = await produceTemuCreateAuthoritativeSourceBeforeClaim(");
  const claim = route.indexOf('"sellerpilot_claim_channel_operation"', source);
  assert.ok(source > 0 && claim > source);
  assert.match(route.slice(source, claim), /sellerpilotTemuAuthoritativeSource: produced.sourceBinding/);
  assert.match(route.slice(source, claim), /providerWritePerformed: false/);
  assert.match(route.slice(source, claim), /jobCreated: false/);
});
