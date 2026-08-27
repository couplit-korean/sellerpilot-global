import { requiredLocalizedMarkets } from "./ai-cli-contract";
import { aiDetailAssetIds } from "./ai-generated-assets";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const masterOutputFields = ["mode", "product", "design", "thumbnail", "warnings"] as const;
const maximumLocalizedChunkSize = 4;

type LocalizedMarketKey = keyof typeof requiredLocalizedMarkets;
type LocalizedChannel = LocalizedMarketKey extends `${infer Channel}:${string}` ? Channel : never;
type LocalizedMarket = LocalizedMarketKey extends `${string}:${infer Market}` ? Market : never;
type LocalizedLocale = (typeof requiredLocalizedMarkets)[LocalizedMarketKey];

export type StudioLocalizedTarget = Readonly<{
  channel: LocalizedChannel;
  market: LocalizedMarket;
  locale: LocalizedLocale;
}>;

export type StudioSegmentContractErrorCode =
  | "invalid-schema"
  | "invalid-plan"
  | "budget-exhausted"
  | "invalid-master"
  | "invalid-segment"
  | "unexpected-target"
  | "locale-mismatch"
  | "duplicate-target"
  | "missing-target";

export class StudioSegmentContractError extends Error {
  readonly code: StudioSegmentContractErrorCode;

  constructor(code: StudioSegmentContractErrorCode, message: string) {
    super(message);
    this.name = "StudioSegmentContractError";
    this.code = code;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Checks the master-only image-role invariant before localized generation.
 * The full studio schema repeats this fence after segment merge; this early
 * check prevents 27 localized listings from being generated from a master
 * whose 12 detail images are already ambiguous.
 */
export function studioMasterDetailImageRoleIssue(masterOutput: unknown): string {
  if (!isJsonObject(masterOutput) || !isJsonObject(masterOutput.design)
      || !Array.isArray(masterOutput.design.sections)) {
    return "design.sections에서 상세 이미지 역할을 확인할 수 없습니다.";
  }

  const requiredRoles = [...aiDetailAssetIds];
  const requiredRoleSet = new Set<string>(requiredRoles);
  const assignedRoles: string[] = [];
  const invalidRoles: string[] = [];

  masterOutput.design.sections.forEach((section, index) => {
    if (!isJsonObject(section) || typeof section.imageAsset !== "string") {
      invalidRoles.push(`sections.${index}`);
      return;
    }
    if (section.imageAsset === "none") return;
    if (!requiredRoleSet.has(section.imageAsset)) {
      invalidRoles.push(section.imageAsset);
      return;
    }
    assignedRoles.push(section.imageAsset);
  });

  const roleCounts = new Map(requiredRoles.map((role) => [role, 0] as const));
  assignedRoles.forEach((role) => roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1));
  const duplicateRoles = requiredRoles.filter((role) => (roleCounts.get(role) ?? 0) > 1);
  const missingRoles = requiredRoles.filter((role) => (roleCounts.get(role) ?? 0) === 0);

  if (assignedRoles.length === requiredRoles.length
      && duplicateRoles.length === 0
      && missingRoles.length === 0
      && invalidRoles.length === 0) {
    return "";
  }

  return [
    "design.sections의 12개 상세 이미지 역할은 각각 정확히 한 번만 배정해야 합니다.",
    `assigned=${assignedRoles.length}/${requiredRoles.length}`,
    `duplicates=${duplicateRoles.join(",") || "none"}`,
    `missing=${missingRoles.join(",") || "none"}`,
    `invalid=${invalidRoles.join(",") || "none"}`,
  ].join(" ");
}

/**
 * Splits one wall-clock master budget into at most two process attempts. The
 * reserve covers SIGTERM/SIGKILL cleanup for both attempts plus bounded process
 * scheduling overhead, so a hung first run cannot silently double the configured
 * master execution deadline. Time waiting in the shared FIFO gate is excluded.
 */
export function planStudioMasterAttemptTimeouts(
  totalTimeoutMs: number,
  terminationGraceMs = 5_000,
): readonly number[] {
  const minimumTotalTimeoutMs = 12 * 60_000;
  const minimumAttemptTimeoutMs = 8 * 60_000;
  const maximumPrimaryTimeoutMs = 20 * 60_000;
  const maximumTotalTimeoutMs = 35 * 60_000;
  if (!Number.isSafeInteger(totalTimeoutMs)
      || totalTimeoutMs < minimumTotalTimeoutMs
      || totalTimeoutMs > maximumTotalTimeoutMs
      || !Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
    throw new StudioSegmentContractError("invalid-plan", "Studio master timeout budget is invalid.");
  }

  const singleAttemptReserveMs = terminationGraceMs * 2;
  const singleAttemptTimeoutMs = totalTimeoutMs - singleAttemptReserveMs;
  if (singleAttemptTimeoutMs < minimumAttemptTimeoutMs) {
    throw new StudioSegmentContractError("invalid-plan", "Studio master timeout budget cannot cover termination.");
  }

  const terminationAndSchedulingReserveMs = terminationGraceMs * 3;
  const usableTimeoutMs = totalTimeoutMs - terminationAndSchedulingReserveMs;
  if (usableTimeoutMs < minimumAttemptTimeoutMs * 2) {
    return Object.freeze([singleAttemptTimeoutMs]);
  }

  let primaryTimeoutMs = Math.min(maximumPrimaryTimeoutMs, Math.floor(usableTimeoutMs * 0.6));
  let fallbackTimeoutMs = usableTimeoutMs - primaryTimeoutMs;
  if (fallbackTimeoutMs < minimumAttemptTimeoutMs) {
    fallbackTimeoutMs = minimumAttemptTimeoutMs;
    primaryTimeoutMs = usableTimeoutMs - fallbackTimeoutMs;
  }
  if (primaryTimeoutMs < minimumAttemptTimeoutMs) return Object.freeze([singleAttemptTimeoutMs]);
  return Object.freeze([primaryTimeoutMs, fallbackTimeoutMs]);
}

export type StudioMasterInvocationAllocation = Readonly<{
  launch: number;
  timeoutMs: number;
}>;

export type StudioMasterInvocationBudget = Readonly<{
  maximumLaunches: number;
  readonly remainingLaunches: number;
  take: () => StudioMasterInvocationAllocation;
  excludeQueueWait: (allocation: StudioMasterInvocationAllocation, waitMs: number) => void;
  settle: (allocation: StudioMasterInvocationAllocation) => void;
}>;

/**
 * Owns the measured process-execution budget for one complete master artifact.
 * Initial generation and every role/semantic repair share this instance. Fast
 * successful runs return their unused time to later repairs, while repeated
 * timeouts still cannot exceed the same bounded 35-minute execution window.
 */
export function createStudioMasterInvocationBudget(
  totalTimeoutMs: number,
  terminationGraceMs = 5_000,
  now = Date.now,
): StudioMasterInvocationBudget {
  const attemptTimeouts = planStudioMasterAttemptTimeouts(totalTimeoutMs, terminationGraceMs);
  if (typeof now !== "function") {
    throw new StudioSegmentContractError("invalid-plan", "Studio master budget clock is invalid.");
  }
  const maximumLaunches = 8;
  const minimumUsefulTimeoutMs = 60_000;
  const laterLaunchTimeoutCapMs = attemptTimeouts[1] ?? attemptTimeouts[0];
  let launchIndex = 0;
  let consumedExecutionMs = 0;
  const activeLaunches = new Map<number, number>();
  return Object.freeze({
    maximumLaunches,
    get remainingLaunches() {
      return maximumLaunches - launchIndex;
    },
    take() {
      if (activeLaunches.size > 0) {
        throw new StudioSegmentContractError(
          "invalid-plan",
          "Studio master execution already has an active allocation.",
        );
      }
      if (launchIndex >= maximumLaunches) {
        throw new StudioSegmentContractError(
          "budget-exhausted",
          "Studio master execution budget is exhausted.",
        );
      }
      const remainingExecutionMs = totalTimeoutMs
        - consumedExecutionMs
        - (terminationGraceMs * 2);
      const timeoutCapMs = launchIndex === 0 ? attemptTimeouts[0] : laterLaunchTimeoutCapMs;
      const timeoutMs = Math.min(timeoutCapMs, remainingExecutionMs);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < minimumUsefulTimeoutMs) {
        throw new StudioSegmentContractError(
          "budget-exhausted",
          "Studio master execution budget is exhausted.",
        );
      }
      const allocation = Object.freeze({
        launch: launchIndex + 1,
        timeoutMs,
      });
      launchIndex += 1;
      activeLaunches.set(allocation.launch, now());
      return allocation;
    },
    excludeQueueWait(allocation, waitMs) {
      const startedAt = activeLaunches.get(allocation.launch);
      if (startedAt === undefined || !Number.isSafeInteger(waitMs) || waitMs < 0) {
        throw new StudioSegmentContractError(
          "invalid-plan",
          "Studio master queue wait allocation is invalid.",
        );
      }
      activeLaunches.set(allocation.launch, startedAt + waitMs);
    },
    settle(allocation) {
      const startedAt = activeLaunches.get(allocation.launch);
      if (startedAt === undefined) {
        throw new StudioSegmentContractError(
          "invalid-plan",
          "Studio master execution allocation is not active.",
        );
      }
      const finishedAt = now();
      consumedExecutionMs += Math.max(0, finishedAt - startedAt);
      activeLaunches.delete(allocation.launch);
    },
  });
}

function schemaObject(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new StudioSegmentContractError("invalid-schema", `${path} must be a JSON Schema object.`);
  }
  return value;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function assertStrictStructuredOutputSchema(value: JsonValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertStrictStructuredOutputSchema(entry, `${path}[${index}]`));
    return;
  }
  if (!isJsonObject(value)) return;

  if (Object.hasOwn(value, "const") && typeof value.type !== "string") {
    throw new StudioSegmentContractError("invalid-schema", `${path} const must declare an explicit type.`);
  }

  if (value.type === "object" || Object.hasOwn(value, "properties")) {
    if (value.type !== "object" || value.additionalProperties !== false) {
      throw new StudioSegmentContractError("invalid-schema", `${path} must be a strict object schema.`);
    }
    const properties = schemaObject(value.properties, `${path}.properties`);
    const propertyNames = Object.keys(properties).sort();
    const required = Array.isArray(value.required)
      ? value.required.filter((entry): entry is string => typeof entry === "string").sort()
      : [];
    if (required.length !== propertyNames.length
      || required.some((entry, index) => entry !== propertyNames[index])) {
      throw new StudioSegmentContractError("invalid-schema", `${path} must require every declared property.`);
    }
  }

  Object.entries(value).forEach(([key, nested]) => {
    assertStrictStructuredOutputSchema(nested, `${path}.${key}`);
  });
}

function canonicalTargetKey(target: Pick<StudioLocalizedTarget, "channel" | "market">): string {
  return `${target.channel}:${target.market}`;
}

function parseCanonicalTarget(key: string, locale: string): StudioLocalizedTarget {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) {
    throw new StudioSegmentContractError("invalid-schema", `Invalid localized market key: ${key}`);
  }
  return Object.freeze({
    channel: key.slice(0, separator) as LocalizedChannel,
    market: key.slice(separator + 1) as LocalizedMarket,
    locale: locale as LocalizedLocale,
  });
}

export const canonicalStudioLocalizedTargets: readonly StudioLocalizedTarget[] = Object.freeze(
  Object.entries(requiredLocalizedMarkets).map(([key, locale]) => parseCanonicalTarget(key, locale)),
);

const canonicalTargetByKey = new Map(
  canonicalStudioLocalizedTargets.map((target) => [canonicalTargetKey(target), target] as const),
);

function validatePlannedTarget(target: StudioLocalizedTarget, seen: Set<string>): void {
  const key = canonicalTargetKey(target);
  const canonical = canonicalTargetByKey.get(key);
  if (!canonical) {
    throw new StudioSegmentContractError("invalid-plan", `Unsupported localized target in plan: ${key}.`);
  }
  if (target.locale !== canonical.locale) {
    throw new StudioSegmentContractError(
      "invalid-plan",
      `Localized target ${key} must use locale ${canonical.locale}.`,
    );
  }
  if (seen.has(key)) {
    throw new StudioSegmentContractError("invalid-plan", `Duplicate localized target in plan: ${key}.`);
  }
  seen.add(key);
}

/**
 * Returns the canonical 27 marketplace targets in deterministic chunks. A
 * segment is intentionally capped at four targets to bound structured output.
 */
export function planStudioLocalizedChunks(
  chunkSize = maximumLocalizedChunkSize,
): readonly (readonly StudioLocalizedTarget[])[] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > maximumLocalizedChunkSize) {
    throw new StudioSegmentContractError(
      "invalid-plan",
      `Localized chunk size must be an integer from 1 to ${maximumLocalizedChunkSize}.`,
    );
  }

  const chunks: Array<readonly StudioLocalizedTarget[]> = [];
  for (let offset = 0; offset < canonicalStudioLocalizedTargets.length; offset += chunkSize) {
    chunks.push(Object.freeze(canonicalStudioLocalizedTargets.slice(offset, offset + chunkSize)));
  }
  return Object.freeze(chunks);
}

/** Derives the smaller master structured-output schema without mutating the full schema. */
export function createStudioMasterOutputSchema(fullSchema: unknown): JsonObject {
  const root = schemaObject(fullSchema, "studio schema");
  const sourceProperties = schemaObject(root.properties, "studio schema.properties");
  const properties: JsonObject = {};

  for (const field of masterOutputFields) {
    const fieldSchema = sourceProperties[field];
    if (fieldSchema === undefined) {
      throw new StudioSegmentContractError("invalid-schema", `studio schema.properties.${field} is required.`);
    }
    properties[field] = JSON.parse(JSON.stringify(fieldSchema)) as JsonValue;
  }

  const schema: JsonObject = {
    ...(typeof root.$schema === "string" ? { $schema: root.$schema } : {}),
    type: "object",
    additionalProperties: false,
    required: [...masterOutputFields],
    properties,
  };
  assertStrictStructuredOutputSchema(schema, "master schema");
  return schema;
}

function createChunkListingSchema(
  baseListingSchema: JsonObject,
  targets: readonly StudioLocalizedTarget[],
): JsonObject {
  const listingSchema = cloneJsonObject(baseListingSchema);
  const properties = schemaObject(listingSchema.properties, "localized listing schema.properties");
  properties.channel = { type: "string", enum: [...new Set(targets.map((target) => target.channel))] };
  properties.market = { type: "string", enum: [...new Set(targets.map((target) => target.market))] };
  properties.locale = { type: "string", enum: [...new Set(targets.map((target) => target.locale))] };
  return listingSchema;
}

/**
 * Derives a strict `{ localizedListings }` schema for one canonical chunk.
 * A single bounded listing schema keeps the Structured Outputs property count
 * below its platform limit; the worker coverage fence and merge below enforce
 * the exact channel/market/locale triples, duplicates, and omissions.
 */
export function createStudioLocalizedChunkOutputSchema(
  fullSchema: unknown,
  targets: readonly StudioLocalizedTarget[],
): JsonObject {
  if (targets.length < 1 || targets.length > maximumLocalizedChunkSize) {
    throw new StudioSegmentContractError(
      "invalid-plan",
      `A localized schema chunk must contain 1 to ${maximumLocalizedChunkSize} targets.`,
    );
  }

  const seen = new Set<string>();
  targets.forEach((target) => validatePlannedTarget(target, seen));

  const root = schemaObject(fullSchema, "studio schema");
  const sourceProperties = schemaObject(root.properties, "studio schema.properties");
  const localizedListingsSchema = schemaObject(
    sourceProperties.localizedListings,
    "studio schema.properties.localizedListings",
  );
  const baseListingSchema = schemaObject(
    localizedListingsSchema.items,
    "studio schema.properties.localizedListings.items",
  );
  const itemSchema = createChunkListingSchema(baseListingSchema, targets);
  const schema: JsonObject = {
    ...(typeof root.$schema === "string" ? { $schema: root.$schema } : {}),
    type: "object",
    additionalProperties: false,
    required: ["localizedListings"],
    properties: {
      localizedListings: {
        type: "array",
        minItems: targets.length,
        maxItems: targets.length,
        items: itemSchema,
      },
    },
  };
  assertStrictStructuredOutputSchema(schema, "localized chunk schema");
  return schema;
}

function assertExactObjectFields(
  value: unknown,
  fields: readonly string[],
  code: "invalid-master" | "invalid-segment",
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StudioSegmentContractError(code, `${label} must be an object.`);
  }
  const received = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (received.length !== expected.length
    || received.some((field, index) => field !== expected[index])) {
    throw new StudioSegmentContractError(code, `${label} has missing or unexpected fields.`);
  }
}

function localizedTargetFromOutput(value: unknown, segmentIndex: number, listingIndex: number): StudioLocalizedTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StudioSegmentContractError(
      "invalid-segment",
      `Localized segment ${segmentIndex} listing ${listingIndex} must be an object.`,
    );
  }
  const listing = value as Record<string, unknown>;
  if (typeof listing.channel !== "string" || typeof listing.market !== "string" || typeof listing.locale !== "string") {
    throw new StudioSegmentContractError(
      "invalid-segment",
      `Localized segment ${segmentIndex} listing ${listingIndex} must include channel, market, and locale.`,
    );
  }
  return {
    channel: listing.channel as LocalizedChannel,
    market: listing.market as LocalizedMarket,
    locale: listing.locale as LocalizedLocale,
  };
}

/**
 * Combines structurally generated segments and enforces exact target coverage.
 * The caller must still pass the returned value through cliStudioResultSchema,
 * because this function deliberately does not duplicate the full semantic gate.
 */
export function mergeStudioSegmentOutputs(
  masterOutput: unknown,
  localizedSegmentOutputs: readonly unknown[],
): Record<string, unknown> & { localizedListings: unknown[] } {
  assertExactObjectFields(masterOutput, masterOutputFields, "invalid-master", "Studio master output");

  const listingsByKey = new Map<string, unknown>();
  localizedSegmentOutputs.forEach((segment, segmentIndex) => {
    assertExactObjectFields(segment, ["localizedListings"], "invalid-segment", `Localized segment ${segmentIndex}`);
    const listings = segment.localizedListings;
    if (!Array.isArray(listings) || listings.length < 1 || listings.length > maximumLocalizedChunkSize) {
      throw new StudioSegmentContractError(
        "invalid-segment",
        `Localized segment ${segmentIndex} must contain 1 to ${maximumLocalizedChunkSize} listings.`,
      );
    }

    listings.forEach((listing, listingIndex) => {
      const received = localizedTargetFromOutput(listing, segmentIndex, listingIndex);
      const key = canonicalTargetKey(received);
      const canonical = canonicalTargetByKey.get(key);
      if (!canonical) {
        throw new StudioSegmentContractError("unexpected-target", `Unexpected localized target: ${key}.`);
      }
      if (received.locale !== canonical.locale) {
        throw new StudioSegmentContractError(
          "locale-mismatch",
          `Localized target ${key} must use locale ${canonical.locale}, received ${received.locale}.`,
        );
      }
      if (listingsByKey.has(key)) {
        throw new StudioSegmentContractError("duplicate-target", `Duplicate localized target: ${key}.`);
      }
      listingsByKey.set(key, listing);
    });
  });

  const missing = canonicalStudioLocalizedTargets
    .map(canonicalTargetKey)
    .filter((key) => !listingsByKey.has(key));
  if (missing.length > 0) {
    throw new StudioSegmentContractError("missing-target", `Missing localized targets: ${missing.join(", ")}.`);
  }

  return {
    ...masterOutput,
    localizedListings: canonicalStudioLocalizedTargets.map((target) => listingsByKey.get(canonicalTargetKey(target))),
  };
}
