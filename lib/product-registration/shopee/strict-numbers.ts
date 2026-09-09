const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

function strictDecimal(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || !decimalPattern.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function shopeePositiveInteger(value: unknown) {
  const parsed = strictDecimal(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function shopeeNonNegativeInteger(value: unknown) {
  const parsed = strictDecimal(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function shopeeFiniteNonNegative(value: unknown) {
  const parsed = strictDecimal(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

export function shopeePositiveMoney(value: unknown) {
  const parsed = strictDecimal(value);
  return parsed !== null && parsed > 0 && parsed <= 999_999_999 ? parsed : null;
}
