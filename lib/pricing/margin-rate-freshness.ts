export type MarginRateEvidence = {
  fetchedAt: string;
  asOf: string;
  frequency: "minute-market" | "daily-reference-fallback";
};

export const marginRateMaxAgeMs = 5 * 60_000;
export const marginDailyRateMaxAgeMs = 4 * 86_400_000;

export function marginRateIsFresh(evidence: MarginRateEvidence | null | undefined, now = Date.now()) {
  if (!evidence || !Number.isFinite(now)) return false;
  const fetched = Date.parse(evidence.fetchedAt);
  const asOf = Date.parse(evidence.asOf);
  const maxAge = evidence.frequency === "minute-market" ? marginRateMaxAgeMs
    : evidence.frequency === "daily-reference-fallback" ? marginDailyRateMaxAgeMs : 0;
  return maxAge > 0 && Number.isFinite(fetched) && Number.isFinite(asOf)
    && fetched <= now + 60_000 && asOf <= now + 60_000
    && now - fetched < marginRateMaxAgeMs && now - asOf < maxAge;
}
