import { z } from "zod";
import { settingShotAssetIds } from "./product-setting-shots";

export const TERMINAL_IMAGE_FAILURE_CONTEXT_VERSION = 1 as const;
export const MAXIMUM_TERMINAL_IMAGE_FAILURE_CONTEXT_BYTES = 16 * 1024;
export const MAXIMUM_TERMINAL_IMAGE_FAILURE_ENTRIES = 12;
export const MAXIMUM_TERMINAL_IMAGE_FAILURE_KEYS = 24;
export const MAXIMUM_TERMINAL_IMAGE_FAILURE_CONFLICTS = 8;

const semanticKeySchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const assetLineageIdSchema = z.string().regex(/^[a-z][a-z0-9:-]{0,63}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const uniqueSemanticKeys = (maximum = MAXIMUM_TERMINAL_IMAGE_FAILURE_KEYS) => z.array(semanticKeySchema)
  .max(maximum)
  .refine((values) => new Set(values).size === values.length, "이미지 실패 의미 키가 중복됐습니다.");
const uniqueAssetLineageIds = z.array(assetLineageIdSchema)
  .max(MAXIMUM_TERMINAL_IMAGE_FAILURE_CONFLICTS)
  .refine((values) => new Set(values).size === values.length, "이미지 실패 계보 ID가 중복됐습니다.");

export const terminalImageFailureEntrySchema = z.object({
  role: z.enum(settingShotAssetIds),
  width: z.number().int().min(1).max(8_192),
  height: z.number().int().min(1).max(8_192),
  failureDimensions: uniqueSemanticKeys().min(1),
  semanticSignature: z.object({
    locationKeys: uniqueSemanticKeys(),
    momentKeys: uniqueSemanticKeys(),
    surfaceKeys: uniqueSemanticKeys(),
    cameraKeys: uniqueSemanticKeys(),
    paletteKeys: uniqueSemanticKeys(),
    spatialDepthKeys: uniqueSemanticKeys(),
    cueKeys: uniqueSemanticKeys(),
  }).strict(),
  rejectedAssetLineage: z.object({
    attempt: z.number().int().min(1).max(4),
    digest: digestSchema,
    topologySignature: digestSchema,
    conflictingAssetIds: uniqueAssetLineageIds,
  }).strict(),
}).strict();

const terminalImageFailureContextShapeSchema = z.object({
  version: z.literal(TERMINAL_IMAGE_FAILURE_CONTEXT_VERSION),
  generation: z.number().int().min(1).max(100_000),
  entries: z.array(terminalImageFailureEntrySchema)
    .min(1)
    .max(MAXIMUM_TERMINAL_IMAGE_FAILURE_ENTRIES),
}).strict();

function serializedByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export const terminalImageFailureContextSchema = terminalImageFailureContextShapeSchema.superRefine((value, context) => {
  if (serializedByteLength(value) > MAXIMUM_TERMINAL_IMAGE_FAILURE_CONTEXT_BYTES) {
    context.addIssue({
      code: "custom",
      message: `이미지 실패 맥락은 ${MAXIMUM_TERMINAL_IMAGE_FAILURE_CONTEXT_BYTES}바이트 이하여야 합니다.`,
    });
  }
});

export type TerminalImageFailureEntry = z.infer<typeof terminalImageFailureEntrySchema>;
export type TerminalImageFailureContext = z.infer<typeof terminalImageFailureContextSchema>;

export function appendTerminalImageFailureEntry(
  previous: TerminalImageFailureContext | null | undefined,
  entry: TerminalImageFailureEntry,
) {
  const parsedPrevious = previous == null
    ? null
    : terminalImageFailureContextSchema.safeParse(previous);
  const generation = Math.min((parsedPrevious?.success ? parsedPrevious.data.generation : 0) + 1, 100_000);
  const entries = [
    ...(parsedPrevious?.success ? parsedPrevious.data.entries : []),
    terminalImageFailureEntrySchema.parse(entry),
  ].slice(-MAXIMUM_TERMINAL_IMAGE_FAILURE_ENTRIES);
  while (entries.length) {
    const parsed = terminalImageFailureContextSchema.safeParse({
      version: TERMINAL_IMAGE_FAILURE_CONTEXT_VERSION,
      generation,
      entries,
    });
    if (parsed.success) return parsed.data;
    entries.shift();
  }
  throw new Error("이미지 실패 맥락을 안전한 크기로 축약하지 못했습니다.");
}

export function terminalImageFailuresForRole(
  context: TerminalImageFailureContext | null | undefined,
  role: TerminalImageFailureEntry["role"],
) {
  const parsed = context == null ? null : terminalImageFailureContextSchema.safeParse(context);
  return parsed?.success ? parsed.data.entries.filter((entry) => entry.role === role) : [];
}

export function buildPriorTerminalImageHardBlacklist(
  context: TerminalImageFailureContext | null | undefined,
  role: TerminalImageFailureEntry["role"],
) {
  const entries = terminalImageFailuresForRole(context, role);
  if (!entries.length) return "";
  const signatures = entries.map((entry, index) => {
    const semantic = entry.semanticSignature;
    const fields = [
      ["location", semantic.locationKeys],
      ["time-light", semantic.momentKeys],
      ["surface", semantic.surfaceKeys],
      ["camera", semantic.cameraKeys],
      ["palette", semantic.paletteKeys],
      ["spatial-depth", semantic.spatialDepthKeys],
      ["fixed-cue", semantic.cueKeys],
    ].flatMap(([name, values]) => Array.isArray(values) && values.length ? [`${name}=${values.join("|")}`] : []);
    return [
      `terminal-${index + 1}`,
      `dimensions=${entry.failureDimensions.join("|")}`,
      `topology=${entry.rejectedAssetLineage.topologySignature}`,
      `lineage=${entry.rejectedAssetLineage.digest}`,
      ...fields,
    ].join(", ");
  });
  return [
    `PERSISTED TERMINAL HARD BLACKLIST FOR ${role}: ${signatures.join("; ")}.`,
    "These schema-validated signatures describe rejected earlier terminal candidates for this exact role. Rebuild the complete outer-band composition and do not reuse their topology, camera family, location geometry, palette, light, surface, depth, cue arrangement, crop, mirroring or small-layout variants. Never render these identifiers as text and never weaken the current trusted role, product-identity or reserved-zone contract.",
  ].join(" ");
}
