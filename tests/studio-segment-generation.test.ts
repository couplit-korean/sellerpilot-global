import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalStudioLocalizedTargets,
  createStudioLocalizedChunkOutputSchema,
  createStudioMasterInvocationBudget,
  createStudioMasterOutputSchema,
  mergeStudioSegmentOutputs,
  planStudioMasterAttemptTimeouts,
  planStudioLocalizedChunks,
  studioMasterDetailImageRoleIssue,
  StudioSegmentContractError,
  type StudioLocalizedTarget,
} from "../lib/studio-segment-generation";

function fullStudioSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(
    new URL("../scripts/ai-studio-output.schema.json", import.meta.url),
    "utf8",
  )) as Record<string, unknown>;
}

function assertStrictObjects(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertStrictObjects(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  const node = value as Record<string, unknown>;
  if (Object.hasOwn(node, "const")) {
    assert.equal(typeof node.type, "string", `${path} const must declare type`);
  }
  if (node.type === "object" || Object.hasOwn(node, "properties")) {
    assert.equal(node.type, "object", `${path} must declare object type`);
    assert.equal(node.additionalProperties, false, `${path} must reject extra fields`);
    assert.ok(node.properties && typeof node.properties === "object" && !Array.isArray(node.properties));
    const propertyNames = Object.keys(node.properties as Record<string, unknown>).sort();
    const requiredNames = Array.isArray(node.required) ? node.required.map(String).sort() : [];
    assert.deepEqual(requiredNames, propertyNames, `${path} must require every property`);
  }
  Object.entries(node).forEach(([key, nested]) => assertStrictObjects(nested, `${path}.${key}`));
}

function structuredOutputPropertyCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + structuredOutputPropertyCount(entry), 0);
  }
  if (!value || typeof value !== "object") return 0;
  const node = value as Record<string, unknown>;
  const ownProperties = node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)
    ? Object.keys(node.properties as Record<string, unknown>).length
    : 0;
  return ownProperties + Object.values(node).reduce(
    (total, entry) => total + structuredOutputPropertyCount(entry),
    0,
  );
}

function targetKey(target: Pick<StudioLocalizedTarget, "channel" | "market">): string {
  return `${target.channel}:${target.market}`;
}

function masterOutput(): Record<string, unknown> {
  return {
    mode: "cli",
    product: { name: "master" },
    design: { themeName: "master" },
    thumbnail: { headline: "master" },
    warnings: [],
  };
}

function listing(target: StudioLocalizedTarget): Record<string, unknown> {
  return { ...target, title: targetKey(target) };
}

function segmentsFromTargets(targets: readonly StudioLocalizedTarget[]): Array<{ localizedListings: unknown[] }> {
  const chunks: Array<{ localizedListings: unknown[] }> = [];
  for (let offset = 0; offset < targets.length; offset += 4) {
    chunks.push({ localizedListings: targets.slice(offset, offset + 4).map(listing) });
  }
  return chunks;
}

function expectContractError(code: StudioSegmentContractError["code"], callback: () => unknown): void {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof StudioSegmentContractError);
    assert.equal(error.code, code);
    return true;
  });
}

test("studio segment plan reads all 27 canonical targets in chunks of at most four", () => {
  const chunks = planStudioLocalizedChunks();
  assert.deepEqual(chunks.map((chunk) => chunk.length), [4, 4, 4, 4, 4, 4, 3]);
  assert.deepEqual(chunks.flat(), canonicalStudioLocalizedTargets);
  assert.equal(new Set(chunks.flat().map(targetKey)).size, 27);
  assert.equal(Object.isFrozen(chunks), true);
  chunks.forEach((chunk) => assert.equal(Object.isFrozen(chunk), true));

  expectContractError("invalid-plan", () => planStudioLocalizedChunks(0));
  expectContractError("invalid-plan", () => planStudioLocalizedChunks(5));
  expectContractError("invalid-plan", () => planStudioLocalizedChunks(1.5));
});

test("master schema is derived from the full schema without localized listings or mutation", () => {
  const fullSchema = fullStudioSchema();
  const before = JSON.stringify(fullSchema);
  const masterSchema = createStudioMasterOutputSchema(fullSchema);
  const properties = masterSchema.properties as Record<string, unknown>;

  assert.deepEqual(Object.keys(properties), ["mode", "product", "design", "thumbnail", "warnings"]);
  assert.deepEqual(masterSchema.required, ["mode", "product", "design", "thumbnail", "warnings"]);
  assert.equal(Object.hasOwn(properties, "localizedListings"), false);
  assert.equal(JSON.stringify(fullSchema), before);
  assertStrictObjects(masterSchema);
});

test("master image roles are fenced before localization with exact-once diagnostics", () => {
  const exactMaster = {
    design: {
      sections: [
        "detail-overview",
        "detail-feature",
        "detail-use",
        "detail-package",
        "detail-routine",
        "detail-scale",
        "detail-storage",
        "detail-context",
        "detail-material",
        "detail-dimensions",
        "detail-contents",
        "detail-care",
        "none",
        "none",
        "none",
        "none",
      ].map((imageAsset) => ({ imageAsset })),
    },
  };
  assert.equal(studioMasterDetailImageRoleIssue(exactMaster), "");

  const duplicatePackage = structuredClone(exactMaster);
  duplicatePackage.design.sections[12].imageAsset = "detail-package";
  const issue = studioMasterDetailImageRoleIssue(duplicatePackage);
  assert.match(issue, /assigned=13\/12/);
  assert.match(issue, /duplicates=detail-package/);
  assert.match(issue, /missing=none/);

  const duplicateAndMissing = structuredClone(exactMaster);
  duplicateAndMissing.design.sections[1].imageAsset = "detail-package";
  const replacementIssue = studioMasterDetailImageRoleIssue(duplicateAndMissing);
  assert.match(replacementIssue, /assigned=12\/12/);
  assert.match(replacementIssue, /duplicates=detail-package/);
  assert.match(replacementIssue, /missing=detail-feature/);

  const invalid = structuredClone(exactMaster);
  invalid.design.sections[0].imageAsset = "invented-detail-role";
  assert.match(studioMasterDetailImageRoleIssue(invalid), /invalid=invented-detail-role/);
  assert.match(studioMasterDetailImageRoleIssue({ design: {} }), /확인할 수 없습니다/);
});

test("master timeout planning stays within one wall-clock budget and at most two attempts", () => {
  const totalTimeoutMs = 35 * 60_000;
  const graceMs = 5_000;
  const attempts = planStudioMasterAttemptTimeouts(totalTimeoutMs, graceMs);

  assert.deepEqual(attempts, [20 * 60_000, (14 * 60_000) + 45_000]);
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every((timeout) => timeout >= 8 * 60_000));
  assert.ok(attempts.reduce((total, timeout) => total + timeout, graceMs * 3) <= totalTimeoutMs);
  assert.equal(Object.isFrozen(attempts), true);

  const singleAttemptPlan = planStudioMasterAttemptTimeouts(12 * 60_000, graceMs);
  assert.deepEqual(singleAttemptPlan, [(11 * 60_000) + 50_000]);
  assert.ok(singleAttemptPlan[0] + (graceMs * 2) <= 12 * 60_000);
  assert.throws(() => planStudioMasterAttemptTimeouts((12 * 60_000) - 1, graceMs), /timeout budget/);
  assert.throws(() => planStudioMasterAttemptTimeouts((35 * 60_000) + 1, graceMs), /timeout budget/);
});

test("one master invocation budget is shared by initial generation and every repair", () => {
  let nowMs = 0;
  const budget = createStudioMasterInvocationBudget(35 * 60_000, 5_000, () => nowMs);

  assert.equal(budget.maximumLaunches, 8);
  assert.equal(budget.remainingLaunches, 8);
  const initial = budget.take();
  assert.deepEqual(initial, { launch: 1, timeoutMs: 20 * 60_000 });
  assert.equal(budget.remainingLaunches, 7);
  assert.throws(() => budget.take(), /active allocation/);
  nowMs += 2 * 60_000;
  budget.excludeQueueWait(initial, 2 * 60_000);
  nowMs += 3 * 60_000;
  budget.settle(initial);

  const semanticRepair = budget.take();
  assert.deepEqual(semanticRepair, { launch: 2, timeoutMs: (14 * 60_000) + 45_000 });
  nowMs += 3 * 60_000;
  budget.settle(semanticRepair);
  const residualRepair = budget.take();
  assert.deepEqual(residualRepair, { launch: 3, timeoutMs: (14 * 60_000) + 45_000 });
  nowMs += 2 * 60_000;
  budget.settle(residualRepair);
  assert.equal(budget.remainingLaunches, 5);
});

test("master invocation budget fails closed after full timeout allocations", () => {
  let nowMs = 0;
  const budget = createStudioMasterInvocationBudget(35 * 60_000, 5_000, () => nowMs);
  const primary = budget.take();
  nowMs += primary.timeoutMs + 5_000;
  budget.settle(primary);
  const fallback = budget.take();
  assert.equal(fallback.timeoutMs, (14 * 60_000) + 45_000);
  nowMs += fallback.timeoutMs;
  budget.settle(fallback);
  assert.throws(
    () => budget.take(),
    (error) => error instanceof StudioSegmentContractError && error.code === "budget-exhausted",
  );
});

test("localized chunk schema stays within the Structured Outputs property limit", () => {
  const fullSchema = fullStudioSchema();
  const targets = canonicalStudioLocalizedTargets.slice(8, 12);
  const chunkSchema = createStudioLocalizedChunkOutputSchema(fullSchema, targets);
  const properties = chunkSchema.properties as Record<string, Record<string, unknown>>;
  const localized = properties.localizedListings;
  const itemSchema = localized.items as Record<string, unknown>;
  const itemProperties = itemSchema.properties as Record<string, Record<string, unknown>>;

  assert.equal(localized.minItems, 4);
  assert.equal(localized.maxItems, 4);
  assert.deepEqual(itemProperties.channel.enum, [...new Set(targets.map((target) => target.channel))]);
  assert.deepEqual(itemProperties.market.enum, [...new Set(targets.map((target) => target.market))]);
  assert.deepEqual(itemProperties.locale.enum, [...new Set(targets.map((target) => target.locale))]);
  assert.ok(structuredOutputPropertyCount(chunkSchema) <= 100);
  assertStrictObjects(chunkSchema);

  const single = createStudioLocalizedChunkOutputSchema(fullSchema, targets.slice(0, 1));
  const singleProperties = single.properties as Record<string, Record<string, unknown>>;
  const singleItem = (singleProperties.localizedListings.items as Record<string, unknown>);
  assert.equal(singleItem.type, "object");
  const singleItemProperties = singleItem.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(singleItemProperties.channel.enum, [targets[0].channel]);
  assert.deepEqual(singleItemProperties.market.enum, [targets[0].market]);
  assert.deepEqual(singleItemProperties.locale.enum, [targets[0].locale]);
});

test("localized chunk schema rejects invalid size, duplicate targets, and wrong locales", () => {
  const schema = fullStudioSchema();
  const target = canonicalStudioLocalizedTargets[0];
  expectContractError("invalid-plan", () => createStudioLocalizedChunkOutputSchema(schema, []));
  expectContractError("invalid-plan", () => createStudioLocalizedChunkOutputSchema(
    schema,
    canonicalStudioLocalizedTargets.slice(0, 5),
  ));
  expectContractError("invalid-plan", () => createStudioLocalizedChunkOutputSchema(schema, [target, target]));
  expectContractError("invalid-plan", () => createStudioLocalizedChunkOutputSchema(schema, [{
    ...target,
    locale: "en-US",
  } as StudioLocalizedTarget]));
});

test("segment merge restores canonical order without mutating segment outputs", () => {
  const reversedTargets = [...canonicalStudioLocalizedTargets].reverse();
  const segments = segmentsFromTargets(reversedTargets);
  const before = JSON.stringify(segments);
  const merged = mergeStudioSegmentOutputs(masterOutput(), segments);

  assert.equal(JSON.stringify(segments), before);
  assert.deepEqual(
    merged.localizedListings.map((entry) => targetKey(entry as StudioLocalizedTarget)),
    canonicalStudioLocalizedTargets.map(targetKey),
  );
  assert.equal(merged.mode, "cli");
});

test("segment merge fails closed on unexpected, mismatched, duplicate, or missing targets", () => {
  const canonicalSegments = () => segmentsFromTargets(canonicalStudioLocalizedTargets);

  const unexpected = canonicalSegments();
  unexpected[0].localizedListings[0] = { channel: "shopee", market: "ZZ", locale: "en-ZZ" };
  expectContractError("unexpected-target", () => mergeStudioSegmentOutputs(masterOutput(), unexpected));

  const wrongLocale = canonicalSegments();
  wrongLocale[0].localizedListings[0] = {
    ...listing(canonicalStudioLocalizedTargets[0]),
    locale: "en-US",
  };
  expectContractError("locale-mismatch", () => mergeStudioSegmentOutputs(masterOutput(), wrongLocale));

  const duplicate = canonicalSegments();
  duplicate[0].localizedListings[1] = listing(canonicalStudioLocalizedTargets[0]);
  expectContractError("duplicate-target", () => mergeStudioSegmentOutputs(masterOutput(), duplicate));

  const missing = canonicalSegments();
  missing.at(-1)?.localizedListings.pop();
  expectContractError("missing-target", () => mergeStudioSegmentOutputs(masterOutput(), missing));
});

test("segment merge rejects extra root fields and oversized chunk output", () => {
  const segments = segmentsFromTargets(canonicalStudioLocalizedTargets);
  expectContractError("invalid-master", () => mergeStudioSegmentOutputs({
    ...masterOutput(),
    localizedListings: [],
  }, segments));
  expectContractError("invalid-segment", () => mergeStudioSegmentOutputs(masterOutput(), [{
    localizedListings: canonicalStudioLocalizedTargets.slice(0, 4).map(listing),
    product: {},
  }]));
  expectContractError("invalid-segment", () => mergeStudioSegmentOutputs(masterOutput(), [{
    localizedListings: canonicalStudioLocalizedTargets.slice(0, 5).map(listing),
  }]));
});
