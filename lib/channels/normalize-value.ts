export function firstFiniteNonNegative(values: unknown[]) {
  const raw = values.find((value) => (typeof value === "number" || typeof value === "string")
    && String(value).trim() !== ""
    && Number.isFinite(Number(value)));
  return raw === undefined ? 0 : Math.max(0, Number(raw));
}
