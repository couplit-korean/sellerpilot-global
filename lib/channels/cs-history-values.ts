// Shared only by CS adapters. Original content and provider time are separate
// from identifiers and collection time; neither is synthesized for a reply.
export const originalMessageBody = (...values: unknown[]): string =>
  values.find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? "";

export function providerMessageTimestamp(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : value;
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) {
    const numeric = Number(raw);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
    const parsed = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const day = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== raw.slice(0, 10)) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
