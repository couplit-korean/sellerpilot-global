import { z } from "zod";
import {
  lazadaSupplementalSourcePathSchema,
  lazadaSupplementalStoredEventSchema,
  lazadaSupplementalSurfaceSchema,
} from "./supplemental-contract";

const uuid = z.string().uuid();
const countries = z.enum(["SG", "MY", "TH", "VN", "ID", "PH"]);
const permissionState = z.enum(["authorized", "permission_pending"]);

export const lazadaSupplementalUiScopeSchema = z.object({
  country: countries,
  surface: lazadaSupplementalSurfaceSchema,
  sourcePath: lazadaSupplementalSourcePathSchema,
  permissionState,
  resourceRequired: z.boolean(),
  resourceLabel: z.string().min(1).max(120),
  message: z.string().min(1).max(500),
}).strict();

export const lazadaSupplementalUiScopesSchema = z.object({
  contractVersion: z.literal("sellerpilot-lazada-supplemental-ui-scopes/1"),
  checkedAt: z.string().datetime({ offset: true }),
  accounts: z.array(z.object({
    credentialId: uuid,
    label: z.string().min(1).max(160),
    scopes: z.array(lazadaSupplementalUiScopeSchema).max(24),
  }).strict()).max(100),
  automaticReadEnabled: z.literal(false),
  replyEnabled: z.literal(false),
  mutationAllowed: z.literal(false),
}).strict();

const progressSchema = z.object({
  continuationId: uuid,
  revision: z.number().int().nonnegative(),
  pageNumber: z.number().int().positive(),
  runNumber: z.number().int().positive(),
  complete: z.boolean(),
  startRequestId: uuid.nullable(),
  parentContinuationId: uuid.nullable(),
  parentRevision: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  const initial = value.runNumber === 1;
  if (initial !== (value.startRequestId === null)
      || initial !== (value.parentContinuationId === null)
      || initial !== (value.parentRevision === null)) {
    context.addIssue({ code: "custom", message: "invalid supplemental round lineage" });
  }
});

export const lazadaSupplementalUiScopeStateSchema = z.object({
  contractVersion: z.literal("sellerpilot-lazada-supplemental-ui-scope/1"),
  checkedAt: z.string().datetime({ offset: true }),
  credentialId: uuid,
  accountLabel: z.string().min(1).max(160),
  country: countries,
  surface: lazadaSupplementalSurfaceSchema,
  sourcePath: lazadaSupplementalSourcePathSchema,
  resourceId: z.string().max(32),
  permissionState,
  progress: progressSchema.nullable(),
  events: z.array(lazadaSupplementalStoredEventSchema).max(50),
  automaticReadEnabled: z.literal(false),
  replyEnabled: z.literal(false),
  mutationAllowed: z.literal(false),
}).strict();

export const lazadaSupplementalUiSelectionSchema = z.object({
  credentialId: uuid,
  country: countries,
  surface: lazadaSupplementalSurfaceSchema,
  sourcePath: lazadaSupplementalSourcePathSchema,
  resourceId: z.string().trim().regex(/^(?:|[1-9][0-9]{0,31})$/u),
  pageSize: z.number().int().min(1).max(50).default(20),
}).strict().superRefine((value, context) => {
  const expectedSurface = value.sourcePath === "/review/seller/list"
    ? "product_review"
    : "reverse_order_after_sales";
  if (value.surface !== expectedSurface
      || value.sourcePath !== "/reverse/getreverseordersforseller" && !value.resourceId) {
    context.addIssue({ code: "custom", message: "invalid supplemental UI selection" });
  }
});

const syncBaselineSchema = z.object({
  continuationId: uuid,
  revision: z.number().int().nonnegative(),
  pageNumber: z.number().int().positive(),
  runNumber: z.number().int().positive(),
  complete: z.boolean(),
}).strict();

const pendingActionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("sync"),
    requestId: uuid,
    baseline: syncBaselineSchema.nullable(),
  }).strict(),
  z.object({
    mode: z.literal("resync"),
    requestId: uuid,
    startRequestId: uuid,
    completedContinuationId: uuid,
    expectedCompletedRevision: z.number().int().positive(),
  }).strict().refine((value) => value.requestId === value.startRequestId, {
    message: "resync request owner mismatch",
  }),
]);

const pageReceiptSchema = z.object({
  contractVersion: z.literal("sellerpilot-lazada-supplemental-page-ingest/1"),
  continuationId: uuid,
  revision: z.number().int().positive(),
  complete: z.boolean(),
}).passthrough();

const resyncReceiptSchema = z.object({
  contractVersion: z.literal("sellerpilot-lazada-supplemental-resync/1"),
  startRequestId: uuid,
  continuationId: uuid,
  runNumber: z.number().int().min(2),
  providerRead: z.boolean(),
  complete: z.boolean(),
}).passthrough();

export type LazadaSupplementalUiScopes = z.infer<typeof lazadaSupplementalUiScopesSchema>;
export type LazadaSupplementalUiScope = z.infer<typeof lazadaSupplementalUiScopeSchema>;
export type LazadaSupplementalUiScopeState = z.infer<typeof lazadaSupplementalUiScopeStateSchema>;
export type LazadaSupplementalUiSelection = z.infer<typeof lazadaSupplementalUiSelectionSchema>;
type PendingAction = z.infer<typeof pendingActionSchema>;
type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type LazadaSupplementalPendingStore = {
  read(scopeKey: string): PendingAction | null;
  write(scopeKey: string, action: PendingAction): void;
  clearIfOwned(scopeKey: string, requestId: string): boolean;
};

export function lazadaSupplementalUiScopeKey(rawSelection: LazadaSupplementalUiSelection) {
  const selection = lazadaSupplementalUiSelectionSchema.parse(rawSelection);
  return [selection.credentialId, selection.country, selection.surface,
    selection.sourcePath, selection.resourceId, selection.pageSize].join("\u001f");
}

export function createLazadaSupplementalSessionStore(storage: Storage): LazadaSupplementalPendingStore {
  const key = (scopeKey: string) => `sellerpilot:lazada:supplemental:${scopeKey}`;
  const read = (scopeKey: string) => {
    try {
      const value = storage.getItem(key(scopeKey));
      return value ? pendingActionSchema.parse(JSON.parse(value)) : null;
    } catch {
      storage.removeItem(key(scopeKey));
      return null;
    }
  };
  return {
    read,
    write(scopeKey, action) {
      storage.setItem(key(scopeKey), JSON.stringify(pendingActionSchema.parse(action)));
    },
    clearIfOwned(scopeKey, requestId) {
      const current = read(scopeKey);
      if (!current || current.requestId !== requestId) return false;
      storage.removeItem(key(scopeKey));
      return true;
    },
  };
}

export function createLazadaSupplementalMemoryStore(): LazadaSupplementalPendingStore {
  const values = new Map<string, PendingAction>();
  return {
    read(scopeKey) {
      return values.get(scopeKey) ?? null;
    },
    write(scopeKey, action) {
      values.set(scopeKey, pendingActionSchema.parse(action));
    },
    clearIfOwned(scopeKey, requestId) {
      if (values.get(scopeKey)?.requestId !== requestId) return false;
      values.delete(scopeKey);
      return true;
    },
  };
}

function selectionQuery(selection: LazadaSupplementalUiSelection) {
  return new URLSearchParams({
    view: "scope",
    credentialId: selection.credentialId,
    country: selection.country,
    sourcePath: selection.sourcePath,
    resourceId: selection.resourceId,
    limit: "50",
  });
}

export async function fetchLazadaSupplementalUiScopes(authenticatedFetch: AuthenticatedFetch) {
  const response = await authenticatedFetch(
    "/api/admin/cs/channels/lazada/supplemental/ui?view=scopes",
    { method: "GET", cache: "no-store" },
  );
  if (!response.ok) throw new Error(`LAZADA_SUPPLEMENTAL_UI_SCOPES_HTTP_${response.status}`);
  return lazadaSupplementalUiScopesSchema.parse(await response.json());
}

export async function fetchLazadaSupplementalUiScope(
  authenticatedFetch: AuthenticatedFetch,
  rawSelection: LazadaSupplementalUiSelection,
) {
  const selection = lazadaSupplementalUiSelectionSchema.parse(rawSelection);
  const response = await authenticatedFetch(
    `/api/admin/cs/channels/lazada/supplemental/ui?${selectionQuery(selection)}`,
    { method: "GET", cache: "no-store" },
  );
  if (!response.ok) throw new Error(`LAZADA_SUPPLEMENTAL_UI_SCOPE_HTTP_${response.status}`);
  const state = lazadaSupplementalUiScopeStateSchema.parse(await response.json());
  if (state.credentialId !== selection.credentialId || state.country !== selection.country
      || state.surface !== selection.surface || state.sourcePath !== selection.sourcePath
      || state.resourceId !== selection.resourceId) {
    throw new Error("LAZADA_SUPPLEMENTAL_UI_SCOPE_MISMATCH");
  }
  return state;
}

function postBody(selection: LazadaSupplementalUiSelection, pending: PendingAction) {
  const common = {
    credentialId: selection.credentialId,
    country: selection.country,
    sourcePath: selection.sourcePath,
    ...(selection.resourceId ? { resourceId: selection.resourceId } : {}),
    pageSize: selection.pageSize,
  };
  return pending.mode === "sync" ? common : {
    ...common,
    startRequestId: pending.startRequestId,
    completedContinuationId: pending.completedContinuationId,
    expectedCompletedRevision: pending.expectedCompletedRevision,
  };
}

function syncBaseline(progress: LazadaSupplementalUiScopeState["progress"]) {
  return progress ? syncBaselineSchema.parse({
    continuationId: progress.continuationId,
    revision: progress.revision,
    pageNumber: progress.pageNumber,
    runNumber: progress.runNumber,
    complete: progress.complete,
  }) : null;
}

function syncAdvancement(
  baseline: z.infer<typeof syncBaselineSchema> | null,
  progress: LazadaSupplementalUiScopeState["progress"],
) {
  if (!baseline) return progress ? "advanced" as const : "unchanged" as const;
  if (!progress) return "conflict" as const;
  if (progress.continuationId !== baseline.continuationId) {
    return progress.runNumber > baseline.runNumber ? "advanced" as const : "conflict" as const;
  }
  if (progress.runNumber !== baseline.runNumber || progress.revision < baseline.revision
      || progress.pageNumber < baseline.pageNumber || baseline.complete && !progress.complete) {
    return "conflict" as const;
  }
  return progress.revision > baseline.revision || progress.pageNumber > baseline.pageNumber
      || !baseline.complete && progress.complete
    ? "advanced" as const
    : "unchanged" as const;
}

export function createLazadaSupplementalUiWorkflow(
  authenticatedFetch: AuthenticatedFetch,
  pendingStore: LazadaSupplementalPendingStore,
  randomUuid: () => string = () => crypto.randomUUID(),
) {
  let generation = 0;
  let activeScopeKey = "";
  const inflight = new Map<string, Promise<unknown>>();

  const activate = (selection: LazadaSupplementalUiSelection | null) => {
    activeScopeKey = selection ? lazadaSupplementalUiScopeKey(selection) : "";
    generation += 1;
  };

  const refresh = async (rawSelection: LazadaSupplementalUiSelection) => {
    const selection = lazadaSupplementalUiSelectionSchema.parse(rawSelection);
    const scopeKey = lazadaSupplementalUiScopeKey(selection);
    const run = generation;
    const state = await fetchLazadaSupplementalUiScope(authenticatedFetch, selection);
    if (run !== generation || scopeKey !== activeScopeKey) return { status: "stale" as const };
    return { status: "applied" as const, state };
  };

  const executeInner = async (selection: LazadaSupplementalUiSelection, scopeKey: string) => {
    const run = generation;
    let state = await fetchLazadaSupplementalUiScope(authenticatedFetch, selection);
    if (state.permissionState !== "authorized") {
      throw new Error("LAZADA_SUPPLEMENTAL_UI_PERMISSION_REQUIRED");
    }
    if (run !== generation || scopeKey !== activeScopeKey) {
      return { status: "stale" as const };
    }
    let pending = pendingStore.read(scopeKey);
    if (pending?.mode === "sync") {
      const advancement = syncAdvancement(pending.baseline, state.progress);
      if (advancement === "conflict") throw new Error("LAZADA_SUPPLEMENTAL_UI_PROGRESS_CONFLICT");
      if (advancement === "advanced") {
        if (run !== generation || scopeKey !== activeScopeKey
            || !pendingStore.clearIfOwned(scopeKey, pending.requestId)) {
          return { status: "stale" as const };
        }
        return { status: "applied" as const, state, replayRecovered: true as const };
      }
    }
    if (!pending) {
      if (!state.progress || state.progress.runNumber === 1 && !state.progress.complete) {
        pending = {
          mode: "sync",
          requestId: uuid.parse(randomUuid()),
          baseline: syncBaseline(state.progress),
        };
      } else if (!state.progress.complete && state.progress.startRequestId
          && state.progress.parentContinuationId && state.progress.parentRevision) {
        pending = {
          mode: "resync",
          requestId: state.progress.startRequestId,
          startRequestId: state.progress.startRequestId,
          completedContinuationId: state.progress.parentContinuationId,
          expectedCompletedRevision: state.progress.parentRevision,
        };
      } else if (state.progress.complete) {
        const startRequestId = uuid.parse(randomUuid());
        pending = {
          mode: "resync",
          requestId: startRequestId,
          startRequestId,
          completedContinuationId: state.progress.continuationId,
          expectedCompletedRevision: state.progress.revision,
        };
      } else {
        throw new Error("LAZADA_SUPPLEMENTAL_UI_PROGRESS_INVALID");
      }
      pendingStore.write(scopeKey, pending);
    }
    const endpoint = pending.mode === "sync"
      ? "/api/admin/cs/channels/lazada/supplemental/sync"
      : "/api/admin/cs/channels/lazada/supplemental/resync";
    const response = await authenticatedFetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(postBody(selection, pending)),
    });
    const rawReceipt: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`LAZADA_SUPPLEMENTAL_UI_ACTION_HTTP_${response.status}`);
    let receiptContinuationId: string;
    let receiptRevision: number | null = null;
    let receiptRunNumber: number | null = null;
    if (pending.mode === "sync") {
      const receipt = pageReceiptSchema.parse(rawReceipt);
      receiptContinuationId = receipt.continuationId;
      receiptRevision = receipt.revision;
    } else {
      const receipt = resyncReceiptSchema.parse(rawReceipt);
      if (receipt.startRequestId !== pending.startRequestId) {
        throw new Error("LAZADA_SUPPLEMENTAL_UI_RESYNC_REQUEST_MISMATCH");
      }
      receiptContinuationId = receipt.continuationId;
      receiptRunNumber = receipt.runNumber;
    }
    if (run !== generation || scopeKey !== activeScopeKey) return { status: "stale" as const };
    state = await fetchLazadaSupplementalUiScope(authenticatedFetch, selection);
    if (run !== generation || scopeKey !== activeScopeKey) return { status: "stale" as const };
    if (pending.mode === "sync") {
      if (syncAdvancement(pending.baseline, state.progress) !== "advanced"
          || state.progress?.continuationId !== receiptContinuationId
          || receiptRevision === null || state.progress.revision < receiptRevision) {
        throw new Error("LAZADA_SUPPLEMENTAL_UI_SYNC_NOT_ADVANCED");
      }
    } else if (state.progress?.continuationId !== receiptContinuationId
        || state.progress.startRequestId !== pending.startRequestId
        || state.progress.runNumber !== receiptRunNumber) {
      throw new Error("LAZADA_SUPPLEMENTAL_UI_RESYNC_NOT_ADVANCED");
    }
    if (!pendingStore.clearIfOwned(scopeKey, pending.requestId)) {
      return { status: "stale" as const };
    }
    return { status: "applied" as const, state, replayRecovered: false as const };
  };

  return {
    activate,
    refresh,
    execute(rawSelection: LazadaSupplementalUiSelection) {
      const selection = lazadaSupplementalUiSelectionSchema.parse(rawSelection);
      const scopeKey = lazadaSupplementalUiScopeKey(selection);
      const current = inflight.get(scopeKey);
      if (current) return current as ReturnType<typeof executeInner>;
      const operation = executeInner(selection, scopeKey).finally(() => {
        if (inflight.get(scopeKey) === operation) inflight.delete(scopeKey);
      });
      inflight.set(scopeKey, operation);
      return operation;
    },
  };
}
