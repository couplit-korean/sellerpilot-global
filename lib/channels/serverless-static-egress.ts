export const SERVERLESS_STATIC_EGRESS_CHANNELS = [
  "coupang",
  "smartstore",
  "elevenst",
  "temu",
  "shopee",
] as const;

export type ServerlessStaticEgressChannel = (typeof SERVERLESS_STATIC_EGRESS_CHANNELS)[number];

export const SERVERLESS_STATIC_EGRESS_ENV = "SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS";
export const SERVERLESS_STATIC_EGRESS_HEADER = "x-sellerpilot-static-egress-channels";
export const SERVERLESS_STATIC_EGRESS_REQUIRED = "STATIC_EGRESS_REQUIRED";

const allowedChannels = new Set<string>(SERVERLESS_STATIC_EGRESS_CHANNELS);

export function parseServerlessStaticEgressChannels(value: unknown): ServerlessStaticEgressChannel[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const entries = value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (!entries.length || entries.some((entry) => !allowedChannels.has(entry))) return [];
  return SERVERLESS_STATIC_EGRESS_CHANNELS.filter((channel) => entries.includes(channel));
}

export function configuredServerlessStaticEgressChannels() {
  return parseServerlessStaticEgressChannels(process.env[SERVERLESS_STATIC_EGRESS_ENV]);
}

export function hasServerlessStaticEgressFor(
  configured: readonly ServerlessStaticEgressChannel[],
  required: readonly ServerlessStaticEgressChannel[],
) {
  const enabled = new Set(configured);
  return required.every((channel) => enabled.has(channel));
}

export function serverlessStaticEgressHeaderValue(
  configured: readonly ServerlessStaticEgressChannel[],
) {
  return SERVERLESS_STATIC_EGRESS_CHANNELS.filter((channel) => configured.includes(channel)).join(",");
}
