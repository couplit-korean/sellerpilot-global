import { z } from "zod";

const uuid = z.string().uuid();
const countrySchema = z.enum(["SG", "MY", "TH", "VN", "ID", "PH"]);
const deliveryStatusSchema = z.enum([
  "prepared", "queued", "running", "readback_required", "verified", "failed",
]);

export const lazadaProductReviewReplyUiSelectionSchema = z.object({
  credentialId: uuid,
  country: countrySchema,
  reviewId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
  generation: z.number().int().min(1),
  eventKey: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export const lazadaProductReviewReplyCapabilityProjectionSchema = z.object({
  contract: z.literal("sellerpilot-lazada-product-review-reply-capability/1"),
  credentialId: uuid,
  country: countrySchema,
  permissionState: z.enum(["authorized", "permission_pending"]),
  replyPath: z.literal("/review/seller/reply/add"),
  readbackPath: z.literal("/review/seller/list/v2"),
  automaticReplyEnabled: z.literal(false),
}).strict();

export const lazadaProductReviewReplyCapabilitySchema =
  lazadaProductReviewReplyCapabilityProjectionSchema.extend({ viewerId: uuid }).strict();

const preparedSchema = z.object({
  contract: z.literal("sellerpilot-lazada-product-review-reply-prepare/1"),
  deliveryId: uuid,
  credentialId: uuid,
  country: countrySchema,
  sellerAccountKey: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
  generation: z.number().int().min(1),
  identityFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  status: deliveryStatusSchema,
  replayed: z.boolean(),
  providerMutationPerformed: z.literal(false),
}).strict();

const enqueueSchema = z.object({
  contract: z.literal("sellerpilot-lazada-product-review-reply-enqueue/1"),
  deliveryId: uuid,
  jobId: uuid.nullable(),
  status: z.enum(["queued", "running", "readback_required", "verified", "failed"]),
  replayed: z.boolean(),
  providerMutationPerformed: z.literal(false),
  automaticResendAllowed: z.literal(false),
}).strict();

const submissionSchema = z.object({
  submission: z.object({
    contract: z.literal("sellerpilot-lazada-product-review-reply-submit/1"),
    prepared: preparedSchema,
    enqueue: enqueueSchema.nullable(),
    providerMutationPerformed: z.literal(false),
    automaticResendAllowed: z.literal(false),
  }).strict(),
}).strict();

export const lazadaProductReviewReplyStatusSchema = z.object({
  contract: z.literal("sellerpilot-lazada-product-review-reply-status/1"),
  deliveryId: uuid,
  credentialId: uuid,
  country: countrySchema,
  reviewId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
  generation: z.number().int().min(1),
  status: deliveryStatusSchema,
  gatewayJobId: uuid.nullable(),
  readbackJobId: uuid.nullable(),
  revision: z.number().int().nonnegative(),
  providerReadbackVerified: z.boolean(),
  automaticResendAllowed: z.literal(false),
}).strict();

const pendingSchema = z.object({
  ownerId: z.string().min(1).max(200),
  selection: lazadaProductReviewReplyUiSelectionSchema,
  reply: z.string().trim().min(1).max(500),
  deliveryId: uuid.nullable(),
  status: deliveryStatusSchema.nullable(),
  revision: z.number().int().nonnegative().nullable(),
  outcomeUnknown: z.boolean(),
}).strict();

export type LazadaProductReviewReplyUiSelection = z.infer<typeof lazadaProductReviewReplyUiSelectionSchema>;
export type LazadaProductReviewReplyCapability = z.infer<typeof lazadaProductReviewReplyCapabilitySchema>;
export type LazadaProductReviewReplyStatus = z.infer<typeof lazadaProductReviewReplyStatusSchema>;
export type LazadaProductReviewReplyPending = z.infer<typeof pendingSchema>;
type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type LazadaProductReviewReplyPendingStore = {
  read(key: string): LazadaProductReviewReplyPending | null;
  claim(key: string, expectedOwnerId: string | null, pending: LazadaProductReviewReplyPending): boolean;
  writeIfOwner(key: string, ownerId: string, pending: LazadaProductReviewReplyPending): boolean;
  clearIfOwner(key: string, ownerId: string): boolean;
};

export function lazadaProductReviewReplyUiKey(raw: LazadaProductReviewReplyUiSelection) {
  const selection = lazadaProductReviewReplyUiSelectionSchema.parse(raw);
  return [selection.credentialId, selection.country, selection.reviewId,
    selection.generation, selection.eventKey].join("\u001f");
}

export function createLazadaProductReviewReplyMemoryStore(): LazadaProductReviewReplyPendingStore {
  const values = new Map<string, LazadaProductReviewReplyPending>();
  return {
    read: (key) => values.get(key) ?? null,
    claim(key, expectedOwnerId, pending) {
      if ((values.get(key)?.ownerId ?? null) !== expectedOwnerId) return false;
      values.set(key, pendingSchema.parse(pending));
      return true;
    },
    writeIfOwner(key, ownerId, pending) {
      if (values.get(key)?.ownerId !== ownerId) return false;
      values.set(key, pendingSchema.parse(pending));
      return true;
    },
    clearIfOwner(key, ownerId) {
      if (values.get(key)?.ownerId !== ownerId) return false;
      return values.delete(key);
    },
  };
}

export function createLazadaProductReviewReplySessionStore(
  storage: Storage,
  rawViewerId: string,
): LazadaProductReviewReplyPendingStore {
  const viewerId = uuid.parse(rawViewerId);
  const storageKey = (key: string) => `sellerpilot:lazada:product-review-reply:${viewerId}:${key}`;
  return {
    read(key) {
      try {
        const value = storage.getItem(storageKey(key));
        return value ? pendingSchema.parse(JSON.parse(value)) : null;
      } catch {
        storage.removeItem(storageKey(key));
        return null;
      }
    },
    claim(key, expectedOwnerId, pending) {
      if ((this.read(key)?.ownerId ?? null) !== expectedOwnerId) return false;
      storage.setItem(storageKey(key), JSON.stringify(pendingSchema.parse(pending)));
      return true;
    },
    writeIfOwner(key, ownerId, pending) {
      if (this.read(key)?.ownerId !== ownerId) return false;
      storage.setItem(storageKey(key), JSON.stringify(pendingSchema.parse(pending)));
      return true;
    },
    clearIfOwner(key, ownerId) {
      if (this.read(key)?.ownerId !== ownerId) return false;
      storage.removeItem(storageKey(key));
      return true;
    },
  };
}

function responseError(operation: "STATUS" | "SUBMIT" | "READBACK", status: number) {
  if (status === 403) return new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_PERMISSION_REQUIRED");
  if (status === 409) return new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_CONFLICT");
  return new Error(`LAZADA_PRODUCT_REVIEW_REPLY_UI_${operation}_HTTP_${status}`);
}

function definitiveError(error: unknown) {
  return error instanceof Error && /PERMISSION_REQUIRED|_CONFLICT$/u.test(error.message);
}

function assertBinding(status: LazadaProductReviewReplyStatus, selection: LazadaProductReviewReplyUiSelection) {
  if (status.credentialId !== selection.credentialId || status.country !== selection.country
      || status.reviewId !== selection.reviewId || status.generation !== selection.generation) {
    throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_STATUS_BINDING_MISMATCH");
  }
}

async function readStatus(authenticatedFetch: AuthenticatedFetch, deliveryId: string) {
  const response = await authenticatedFetch(
    `/api/admin/cs/channels/lazada/product-review/reply?deliveryId=${encodeURIComponent(deliveryId)}`,
    { method: "GET", cache: "no-store" },
  );
  if (!response.ok) throw responseError("STATUS", response.status);
  const body = await response.json();
  return lazadaProductReviewReplyStatusSchema.parse(body?.delivery);
}

export async function fetchLazadaProductReviewReplyCapability(
  authenticatedFetch: AuthenticatedFetch,
  rawSelection: Pick<LazadaProductReviewReplyUiSelection, "credentialId" | "country">,
) {
  const selection = z.object({ credentialId: uuid, country: countrySchema }).strict().parse({
    credentialId: rawSelection.credentialId,
    country: rawSelection.country,
  });
  const query = new URLSearchParams({ credentialId: selection.credentialId, country: selection.country });
  const response = await authenticatedFetch(
    `/api/admin/cs/channels/lazada/product-review/reply?${query}`,
    { method: "GET", cache: "no-store" },
  );
  if (!response.ok) throw new Error(`LAZADA_PRODUCT_REVIEW_REPLY_UI_CAPABILITY_HTTP_${response.status}`);
  const capability = lazadaProductReviewReplyCapabilitySchema.parse((await response.json())?.capability);
  if (capability.credentialId !== selection.credentialId || capability.country !== selection.country) {
    throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_CAPABILITY_BINDING_MISMATCH");
  }
  return capability;
}

export function createLazadaProductReviewReplyUiWorkflow(
  authenticatedFetch: AuthenticatedFetch,
  store: LazadaProductReviewReplyPendingStore,
) {
  let generation = 0;
  let activeKey = "";
  let ownerSequence = 0;
  const workflowOwner = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
  const inflight = new Map<string, { reply: string; operation: Promise<unknown> }>();

  const nextOwnerId = () => `${workflowOwner}:${++ownerSequence}`;

  const claim = (
    key: string,
    existing: LazadaProductReviewReplyPending | null,
    pending: Omit<LazadaProductReviewReplyPending, "ownerId">,
  ) => {
    const owned = pendingSchema.parse({ ...pending, ownerId: nextOwnerId() });
    if (!store.claim(key, existing?.ownerId ?? null, owned)) {
      throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_PENDING_OWNER_CHANGED");
    }
    return owned;
  };

  const markUnknownIfOwned = (key: string, pending: LazadaProductReviewReplyPending) => {
    store.writeIfOwner(key, pending.ownerId, { ...pending, outcomeUnknown: true });
  };

  const clearIfOwned = (key: string, pending: LazadaProductReviewReplyPending) => {
    store.clearIfOwner(key, pending.ownerId);
  };

  const activate = (raw: LazadaProductReviewReplyUiSelection | null) => {
    activeKey = raw ? lazadaProductReviewReplyUiKey(raw) : "";
    generation += 1;
  };

  const applyStatus = (
    key: string,
    selection: LazadaProductReviewReplyUiSelection,
    pending: LazadaProductReviewReplyPending,
    status: LazadaProductReviewReplyStatus,
  ) => {
    assertBinding(status, selection);
    const updated = pendingSchema.parse({
      ...pending,
      deliveryId: status.deliveryId,
      status: status.status,
      revision: status.revision,
      outcomeUnknown: false,
    });
    return store.writeIfOwner(key, pending.ownerId, updated) ? updated : null;
  };

  const submitInner = async (selection: LazadaProductReviewReplyUiSelection, reply: string, key: string) => {
    const run = generation;
    const existing = store.read(key);
    if (existing && existing.reply !== reply) {
      throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_PENDING_BODY_CONFLICT");
    }
    let pending = claim(key, existing, {
      selection,
      reply,
      deliveryId: existing?.deliveryId ?? null,
      status: existing?.status ?? null,
      revision: existing?.revision ?? null,
      outcomeUnknown: existing?.outcomeUnknown ?? false,
    });
    if (pending?.deliveryId) {
      try {
        const status = await readStatus(authenticatedFetch, pending.deliveryId);
        if (run !== generation || key !== activeKey) return { status: "stale" as const };
        const updated = applyStatus(key, selection, pending, status);
        if (!updated) return { status: "stale" as const };
        return { status: "applied" as const, pending: updated, recovered: true as const };
      } catch (error) {
        if (definitiveError(error)) clearIfOwned(key, pending);
        else markUnknownIfOwned(key, pending);
        throw error;
      }
    }
    try {
      const response = await authenticatedFetch("/api/admin/cs/channels/lazada/product-review/reply", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...selection, eventKey: undefined, reply }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw responseError("SUBMIT", response.status);
      }
      const submission = submissionSchema.parse(body).submission;
      if (submission.prepared.credentialId !== selection.credentialId
          || submission.prepared.country !== selection.country
          || submission.prepared.reviewId !== selection.reviewId
          || submission.prepared.generation !== selection.generation) {
        throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_SUBMIT_BINDING_MISMATCH");
      }
      pending = pendingSchema.parse({
        ...pending,
        deliveryId: submission.prepared.deliveryId,
        status: submission.enqueue?.status ?? submission.prepared.status,
      });
      if (!store.writeIfOwner(key, pending.ownerId, pending)) return { status: "stale" as const };
      if (run !== generation || key !== activeKey) return { status: "stale" as const };
      const status = await readStatus(authenticatedFetch, submission.prepared.deliveryId);
      if (run !== generation || key !== activeKey) return { status: "stale" as const };
      const updated = applyStatus(key, selection, pending, status);
      if (!updated) return { status: "stale" as const };
      return { status: "applied" as const, pending: updated, recovered: submission.prepared.replayed };
    } catch (error) {
      if (definitiveError(error)) clearIfOwned(key, pending);
      else markUnknownIfOwned(key, pending);
      throw error;
    }
  };

  return {
    activate,
    pending(raw: LazadaProductReviewReplyUiSelection) {
      return store.read(lazadaProductReviewReplyUiKey(raw));
    },
    submit(raw: LazadaProductReviewReplyUiSelection, rawReply: string) {
      const selection = lazadaProductReviewReplyUiSelectionSchema.parse(raw);
      const reply = z.string().trim().min(1).max(500).parse(rawReply);
      const key = lazadaProductReviewReplyUiKey(selection);
      const current = inflight.get(key);
      if (current) {
        if (current.reply !== reply) {
          return Promise.reject(new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_PENDING_BODY_CONFLICT"));
        }
        return current.operation as ReturnType<typeof submitInner>;
      }
      const operation = submitInner(selection, reply, key).finally(() => {
        if (inflight.get(key)?.operation === operation) inflight.delete(key);
      });
      inflight.set(key, { reply, operation });
      return operation;
    },
    async refresh(raw: LazadaProductReviewReplyUiSelection) {
      const selection = lazadaProductReviewReplyUiSelectionSchema.parse(raw);
      const key = lazadaProductReviewReplyUiKey(selection);
      const existing = store.read(key);
      if (!existing?.deliveryId) throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_DELIVERY_UNKNOWN");
      const deliveryId = existing.deliveryId;
      const pending = claim(key, existing, {
        selection, reply: existing.reply, deliveryId: existing.deliveryId, status: existing.status,
        revision: existing.revision, outcomeUnknown: existing.outcomeUnknown,
      });
      const run = generation;
      try {
        const status = await readStatus(authenticatedFetch, deliveryId);
        if (run !== generation || key !== activeKey) return { status: "stale" as const };
        const updated = applyStatus(key, selection, pending, status);
        return updated ? { status: "applied" as const, pending: updated } : { status: "stale" as const };
      } catch (error) {
        if (definitiveError(error)) clearIfOwned(key, pending);
        else markUnknownIfOwned(key, pending);
        throw error;
      }
    },
    async requestReadback(raw: LazadaProductReviewReplyUiSelection) {
      const selection = lazadaProductReviewReplyUiSelectionSchema.parse(raw);
      const key = lazadaProductReviewReplyUiKey(selection);
      const existing = store.read(key);
      if (!existing?.deliveryId || existing.status !== "readback_required") {
        throw new Error("LAZADA_PRODUCT_REVIEW_REPLY_UI_READBACK_NOT_REQUIRED");
      }
      const pending = claim(key, existing, {
        selection, reply: existing.reply, deliveryId: existing.deliveryId, status: existing.status,
        revision: existing.revision, outcomeUnknown: existing.outcomeUnknown,
      });
      const run = generation;
      try {
        const response = await authenticatedFetch("/api/admin/cs/channels/lazada/product-review/reply", {
          method: "PUT", cache: "no-store", headers: { "content-type": "application/json" },
          body: JSON.stringify({ deliveryId: pending.deliveryId }),
        });
        if (!response.ok) throw responseError("READBACK", response.status);
        if (run !== generation || key !== activeKey) return { status: "stale" as const };
        const updated = pendingSchema.parse({ ...pending, outcomeUnknown: false });
        return store.writeIfOwner(key, pending.ownerId, updated)
          ? { status: "applied" as const, pending: updated }
          : { status: "stale" as const };
      } catch (error) {
        if (definitiveError(error)) clearIfOwned(key, pending);
        else markUnknownIfOwned(key, pending);
        throw error;
      }
    },
  };
}
