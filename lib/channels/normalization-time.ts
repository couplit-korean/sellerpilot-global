function parsedTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function canonicalNormalizationTimestamp(value: unknown) {
  const parsed = parsedTimestamp(value);
  if (!parsed) throw new TypeError("A valid normalization timestamp is required.");
  return parsed.toISOString();
}

export function createTimestampNormalizer(normalizationTimestamp: unknown) {
  const fallback = canonicalNormalizationTimestamp(normalizationTimestamp);
  return (...values: unknown[]) => {
    for (const value of values) {
      const parsed = parsedTimestamp(value);
      if (parsed) return parsed.toISOString();
    }
    return fallback;
  };
}
