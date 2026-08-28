import { z } from "zod";

export const platformUsageCacheSeconds = 600;
export const platformUsageProviderTimeoutMs = 8_000;

export type PlatformProviderState = "connected" | "partial" | "not_configured" | "unavailable";
export type VercelPlan = "hobby" | "pro" | "enterprise";
export type SupabasePlan = "free" | "pro" | "team" | "enterprise" | "platform";

export type VercelServiceUsage = {
  serviceName: string;
  consumedQuantity: number | null;
  consumedUnit: string | null;
  billedCostUsd: number;
  effectiveCostUsd: number;
};

export type VercelUsageSummary = {
  state: PlatformProviderState;
  message: string;
  targetId: string | null;
  fetchedAt: string | null;
  plan: VercelPlan | null;
  period: { from: string; to: string } | null;
  totals: { billedCostUsd: number; effectiveCostUsd: number } | null;
  services: VercelServiceUsage[];
};

export type SupabaseApiUsage = {
  interval: "1day";
  authRequests: number;
  realtimeRequests: number;
  restRequests: number;
  storageRequests: number;
  totalRequests: number;
};

export type SupabaseDiskUsage = {
  measuredAt: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
};

export type SupabaseAddon = {
  type: string;
  variantId: string;
  name: string;
  price: {
    amount: number;
    interval: "monthly" | "hourly";
    type: "fixed" | "usage";
    description: string;
  };
};

export type SupabaseUsageSummary = {
  state: PlatformProviderState;
  message: string;
  targetId: string | null;
  fetchedAt: string | null;
  plan: SupabasePlan | null;
  apiUsage: SupabaseApiUsage | null;
  disk: SupabaseDiskUsage | null;
  selectedAddons: SupabaseAddon[];
  unsupportedBillingMetrics: string[];
};

export type PlatformUsagePayload = {
  generatedAt: string;
  cacheSeconds: number;
  vercel: VercelUsageSummary;
  supabase: SupabaseUsageSummary;
};

const finiteNumberSchema = z.union([z.number(), z.string()]).transform((value, context) => {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    context.addIssue({ code: "custom", message: "finite number required" });
    return z.NEVER;
  }
  return numberValue;
});

const nullableFiniteNumberSchema = z.union([finiteNumberSchema, z.null(), z.undefined()]);

const vercelTeamSchema = z.object({
  billing: z.object({ plan: z.enum(["hobby", "pro", "enterprise"]) }).nullable().optional(),
});

const vercelChargeSchema = z.object({
  ServiceName: z.string().trim().min(1).max(160),
  ConsumedQuantity: nullableFiniteNumberSchema,
  ConsumedUnit: z.string().trim().max(80).nullable().optional(),
  BilledCost: finiteNumberSchema,
  EffectiveCost: finiteNumberSchema,
});

const supabaseOrganizationSchema = z.object({
  plan: z.enum(["free", "pro", "team", "enterprise", "platform"]).nullable().optional(),
});

const supabaseApiCountsSchema = z.object({
  result: z.array(z.object({
    total_auth_requests: finiteNumberSchema,
    total_realtime_requests: finiteNumberSchema,
    total_rest_requests: finiteNumberSchema,
    total_storage_requests: finiteNumberSchema,
  })).max(1_000).default([]),
});

const supabaseDiskSchema = z.object({
  timestamp: z.string().trim().min(1).max(80),
  metrics: z.object({
    fs_size_bytes: finiteNumberSchema,
    fs_used_bytes: finiteNumberSchema,
    fs_avail_bytes: finiteNumberSchema,
  }),
});

const supabaseAddonsSchema = z.object({
  selected_addons: z.array(z.object({
    type: z.string().trim().min(1).max(80),
    variant: z.object({
      id: z.string().trim().min(1).max(120),
      name: z.string().trim().min(1).max(160),
      price: z.object({
        amount: finiteNumberSchema,
        interval: z.enum(["monthly", "hourly"]),
        type: z.enum(["fixed", "usage"]),
        description: z.string().trim().max(300),
      }),
    }),
  })).max(64).default([]),
});

export function parseVercelPlan(input: unknown): VercelPlan | null {
  return vercelTeamSchema.parse(input).billing?.plan ?? null;
}

export function summarizeVercelCharges(input: string) {
  const aggregated = new Map<string, VercelServiceUsage>();
  let billedCostUsd = 0;
  let effectiveCostUsd = 0;
  let acceptedRows = 0;

  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsedJson = JSON.parse(line) as unknown;
    const parsed = vercelChargeSchema.parse(parsedJson);
    const consumedQuantity = parsed.ConsumedQuantity ?? null;
    const consumedUnit = parsed.ConsumedUnit || null;
    const key = `${parsed.ServiceName}\u0000${consumedUnit ?? ""}`;
    const existing = aggregated.get(key) ?? {
      serviceName: parsed.ServiceName,
      consumedQuantity: consumedQuantity === null ? null : 0,
      consumedUnit,
      billedCostUsd: 0,
      effectiveCostUsd: 0,
    };
    if (consumedQuantity !== null) {
      existing.consumedQuantity = (existing.consumedQuantity ?? 0) + consumedQuantity;
    }
    existing.billedCostUsd += parsed.BilledCost;
    existing.effectiveCostUsd += parsed.EffectiveCost;
    aggregated.set(key, existing);
    billedCostUsd += parsed.BilledCost;
    effectiveCostUsd += parsed.EffectiveCost;
    acceptedRows += 1;
  }

  return {
    acceptedRows,
    totals: { billedCostUsd, effectiveCostUsd },
    services: [...aggregated.values()]
      .sort((left, right) => right.effectiveCostUsd - left.effectiveCostUsd || left.serviceName.localeCompare(right.serviceName))
      .slice(0, 80),
  };
}

export function parseSupabasePlan(input: unknown): SupabasePlan | null {
  return supabaseOrganizationSchema.parse(input).plan ?? null;
}

export function parseSupabaseApiUsage(input: unknown): SupabaseApiUsage {
  const parsed = supabaseApiCountsSchema.parse(input);
  const totals = parsed.result.reduce((sum, row) => ({
    authRequests: sum.authRequests + row.total_auth_requests,
    realtimeRequests: sum.realtimeRequests + row.total_realtime_requests,
    restRequests: sum.restRequests + row.total_rest_requests,
    storageRequests: sum.storageRequests + row.total_storage_requests,
  }), { authRequests: 0, realtimeRequests: 0, restRequests: 0, storageRequests: 0 });
  return {
    interval: "1day",
    ...totals,
    totalRequests: totals.authRequests + totals.realtimeRequests + totals.restRequests + totals.storageRequests,
  };
}

export function parseSupabaseDiskUsage(input: unknown): SupabaseDiskUsage {
  const parsed = supabaseDiskSchema.parse(input);
  return {
    measuredAt: parsed.timestamp,
    sizeBytes: Math.max(0, parsed.metrics.fs_size_bytes),
    usedBytes: Math.max(0, parsed.metrics.fs_used_bytes),
    availableBytes: Math.max(0, parsed.metrics.fs_avail_bytes),
  };
}

export function parseSupabaseAddons(input: unknown): SupabaseAddon[] {
  return supabaseAddonsSchema.parse(input).selected_addons.map((addon) => ({
    type: addon.type,
    variantId: addon.variant.id,
    name: addon.variant.name,
    price: {
      amount: addon.variant.price.amount,
      interval: addon.variant.price.interval,
      type: addon.variant.price.type,
      description: addon.variant.price.description,
    },
  }));
}

export const unsupportedSupabaseBillingMetrics = [
  "조직 전체 MAU와 잔여 MAU 한도",
  "조직 전체 Egress와 잔여 전송량",
  "Storage 과금 사용량과 잔여 한도",
  "Edge Function·Realtime 과금 사용량",
  "현재 결제 주기의 정확한 잔여 quota",
];
