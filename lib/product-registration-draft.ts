import { z } from "zod";

export const PRODUCT_REGISTRATION_DRAFT_GET_RPC =
  "sellerpilot_service_get_product_registration_draft";
export const PRODUCT_REGISTRATION_DRAFT_PUT_RPC =
  "sellerpilot_service_put_product_registration_draft";
export const PRODUCT_REGISTRATION_DRAFT_KINDS = ["intake", "publish"] as const;
export const PRODUCT_REGISTRATION_DRAFT_MAX_DATA_BYTES = 262_144;
export const PRODUCT_REGISTRATION_DRAFT_MAX_DEPTH = 16;
export const PRODUCT_REGISTRATION_DRAFT_MAX_NODES = 4_096;
export const PRODUCT_REGISTRATION_DRAFT_MAX_KEY_LENGTH = 128;

export type ProductRegistrationDraftKind =
  (typeof PRODUCT_REGISTRATION_DRAFT_KINDS)[number];
export type ProductRegistrationDraftJson =
  | null
  | boolean
  | number
  | string
  | ProductRegistrationDraftJson[]
  | { [key: string]: ProductRegistrationDraftJson };
export type ProductRegistrationDraftData = {
  [key: string]: ProductRegistrationDraftJson;
};

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const textEncoder = new TextEncoder();

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasControlCharacter(value: string) {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null
    || prototype === Object.prototype
    || (
      Object.getPrototypeOf(prototype) === null
      && Object.prototype.toString.call(value) === "[object Object]"
    );
}

export function productRegistrationDraftDataIssue(value: unknown): string | null {
  if (!plainObject(value)) return "data must be a plain JSON object";

  let nodes = 0;
  const ancestors = new WeakSet<object>();

  function visit(current: unknown, depth: number): string | null {
    nodes += 1;
    if (nodes > PRODUCT_REGISTRATION_DRAFT_MAX_NODES) {
      return `data may contain at most ${PRODUCT_REGISTRATION_DRAFT_MAX_NODES} values`;
    }
    if (depth > PRODUCT_REGISTRATION_DRAFT_MAX_DEPTH) {
      return `data may be nested at most ${PRODUCT_REGISTRATION_DRAFT_MAX_DEPTH} levels`;
    }
    if (current === null || typeof current === "boolean") return null;
    if (typeof current === "number") {
      return Number.isFinite(current) ? null : "data numbers must be finite";
    }
    if (typeof current === "string") {
      if (current.includes("\u0000") || hasUnpairedSurrogate(current)) {
        return "data strings must contain valid PostgreSQL JSON text";
      }
      return null;
    }
    if (typeof current !== "object") return "data contains a non-JSON value";
    if (ancestors.has(current)) return "data must not contain a circular reference";

    ancestors.add(current);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        if (!(index in current)) {
          ancestors.delete(current);
          return "data arrays must not be sparse";
        }
        const issue = visit(current[index], depth + 1);
        if (issue) {
          ancestors.delete(current);
          return issue;
        }
      }
      ancestors.delete(current);
      return null;
    }
    if (!plainObject(current)) {
      ancestors.delete(current);
      return "data contains a non-plain object";
    }

    for (const key of Object.keys(current)) {
      const keyLength = Array.from(key).length;
      if (
        keyLength < 1
        || keyLength > PRODUCT_REGISTRATION_DRAFT_MAX_KEY_LENGTH
        || forbiddenKeys.has(key)
        || hasControlCharacter(key)
        || hasUnpairedSurrogate(key)
      ) {
        ancestors.delete(current);
        return "data contains an unsafe object key";
      }
      const issue = visit(current[key], depth + 1);
      if (issue) {
        ancestors.delete(current);
        return issue;
      }
    }
    ancestors.delete(current);
    return null;
  }

  const issue = visit(value, 0);
  if (issue) return issue;

  try {
    const serialized = JSON.stringify(value);
    if (textEncoder.encode(serialized).byteLength > PRODUCT_REGISTRATION_DRAFT_MAX_DATA_BYTES) {
      return `data may be at most ${PRODUCT_REGISTRATION_DRAFT_MAX_DATA_BYTES} UTF-8 bytes`;
    }
  } catch {
    return "data must be JSON serializable";
  }
  return null;
}

const uuidSchema = z.string().uuid();
const kindSchema = z.enum(PRODUCT_REGISTRATION_DRAFT_KINDS);
const draftDataSchema = z.custom<ProductRegistrationDraftData>(
  (value) => productRegistrationDraftDataIssue(value) === null,
  { message: "data must be a safe plain JSON object" },
);

export const productRegistrationDraftQuerySchema = z.object({
  draftId: uuidSchema,
  kind: kindSchema,
}).strict();

export const productRegistrationDraftPutSchema = productRegistrationDraftQuerySchema.extend({
  productId: uuidSchema.nullish(),
  expectedVersion: z.number().int().min(0).max(2_147_483_647),
  data: draftDataSchema,
}).strict();

export const productRegistrationDraftSchema = productRegistrationDraftQuerySchema.extend({
  productId: uuidSchema.nullable(),
  version: z.number().int().min(1).max(2_147_483_647),
  data: draftDataSchema,
  updatedAt: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "updatedAt must be an ISO timestamp",
  ),
}).strict();

export const productRegistrationDraftResponseSchema = z.object({
  draft: productRegistrationDraftSchema.nullable(),
}).strict();

export type ProductRegistrationDraftQuery = z.infer<
  typeof productRegistrationDraftQuerySchema
>;
export type ProductRegistrationDraftPut = z.infer<
  typeof productRegistrationDraftPutSchema
>;
export type ProductRegistrationDraft = z.infer<
  typeof productRegistrationDraftSchema
>;
export type ProductRegistrationDraftResponse = z.infer<
  typeof productRegistrationDraftResponseSchema
>;

export function parseProductRegistrationDraftQuery(value: unknown) {
  return productRegistrationDraftQuerySchema.safeParse(value);
}

export function parseProductRegistrationDraftPut(value: unknown) {
  return productRegistrationDraftPutSchema.safeParse(value);
}

export function parseProductRegistrationDraft(value: unknown) {
  return productRegistrationDraftSchema.safeParse(value);
}

export function parseProductRegistrationDraftResponse(value: unknown) {
  return productRegistrationDraftResponseSchema.safeParse(value);
}

export function productRegistrationDraftRpcResult(value: unknown) {
  if (value == null) return null;
  const payload = typeof value === "string" ? JSON.parse(value) as unknown : value;
  const parsed = parseProductRegistrationDraft(payload);
  if (!parsed.success) throw new Error("PRODUCT_REGISTRATION_DRAFT_RPC_SHAPE");
  return parsed.data;
}
