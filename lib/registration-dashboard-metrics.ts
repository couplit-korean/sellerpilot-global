type RegistrationDashboardActivity = {
  id?: unknown;
  productId?: unknown;
  status?: unknown;
  channels?: unknown;
};

type RegistrationDashboardChannel = {
  channel?: unknown;
  market?: unknown;
  status?: unknown;
};

const productStudioJobActivityIdPattern = /^job:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function retryableRegistrationIdentifiers(activities: readonly unknown[]) {
  const aiJobs = new Set<string>();
  const channelListings = new Set<string>();

  for (const value of activities) {
    if (!isRecord(value)) continue;
    const activity = value as RegistrationDashboardActivity;
    const id = typeof activity.id === "string" ? activity.id : "";
    if (activity.status === "failed" && activity.productId == null && productStudioJobActivityIdPattern.test(id)) {
      aiJobs.add(id.toLowerCase());
    }

    if (!Array.isArray(activity.channels)) continue;
    for (const channelValue of activity.channels) {
      if (!isRecord(channelValue)) continue;
      const channel = channelValue as RegistrationDashboardChannel;
      if (channel.status !== "failed") continue;
      const channelKey = typeof channel.channel === "string" ? channel.channel : "";
      const market = typeof channel.market === "string" ? channel.market : "";
      if (!id || !channelKey) continue;
      channelListings.add(`${id}:${channelKey}:${market}`);
    }
  }

  return { aiJobs, channelListings };
}

/**
 * Counts retryable channel targets plus recoverable orphan product-studio
 * jobs, not failed activity cards. The two DB counters describe the same
 * channel population, so the larger value is used once rather than adding
 * them together. Asset-regeneration and product-revision cards remain visible
 * in the full failed history but do not contribute to this retryable KPI.
 */
export function reconcileRegistrationDashboardMetrics(
  payload: Record<string, unknown>,
  activities: readonly unknown[],
) {
  if (!isRecord(payload.pipeline) || !isRecord(payload.summary)) return payload;

  const identifiers = retryableRegistrationIdentifiers(activities);
  const channelRetryableCount = Math.max(
    nonNegativeCount(payload.pipeline.listingFailed),
    nonNegativeCount(payload.summary.registrationErrorCount),
    identifiers.channelListings.size,
  );
  const retryableCount = channelRetryableCount + identifiers.aiJobs.size;

  return {
    ...payload,
    pipeline: {
      ...payload.pipeline,
      channelListingFailed: channelRetryableCount,
      aiRetryableFailed: identifiers.aiJobs.size,
      listingFailed: retryableCount,
    },
    summary: {
      ...payload.summary,
      registrationErrorCount: retryableCount,
    },
  };
}
