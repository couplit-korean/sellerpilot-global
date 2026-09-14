import { hasServerlessStaticEgressFor, type ServerlessStaticEgressChannel } from "./serverless-static-egress";

export function isCoupangCategoryRead(channel: string, operation: string) {
  return channel === "coupang"
    && ["categories.suggest", "categories.attributes", "categories.validate"].includes(operation);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// This admits only already-configured cloud category reads to the existing
// queue. The claimant still checks its observed egress header and all job gates.
export function coupangCategoryCloudReadReady(input: {
  channel: string;
  operation: string;
  configuredChannels: readonly ServerlessStaticEgressChannel[];
  releaseSha: string | null;
  staticEgress: { data: unknown; error: unknown };
  runtime: { data: unknown; error: unknown };
}) {
  if (!isCoupangCategoryRead(input.channel, input.operation)
      || !hasServerlessStaticEgressFor(input.configuredChannels, ["coupang"])
      || !input.releaseSha || !/^[a-f0-9]{40}$/.test(input.releaseSha)
      || input.staticEgress.error || input.runtime.error) return false;
  const policy = record(input.staticEgress.data);
  const runtime = record(input.runtime.data);
  return policy.coupang === true && runtime.configured === true && runtime.active === true
    && runtime.activeRelease === input.releaseSha;
}
