// Pure validation shared by the registration form and provider prewrite checks.
// No credentials, transport, mutable state or other business-domain dependency.
export function skuRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function skuRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? Array.from(value, skuRecord) : [];
}

export function skuText(value: unknown): boolean {
  return typeof value === "string" && Boolean(value.trim())
    && !/\p{Cc}/u.test(value)
    && !/^(?:server_managed|unknown|n\/a|미확인|확인 필요)$/iu.test(value.trim());
}

export function skuPositive(value: unknown): boolean {
  return (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/u.test(value)))
    && Number.isFinite(Number(value)) && Number(value) > 0;
}

export function skuQuantity(value: unknown): boolean {
  return (typeof value === "number" || (typeof value === "string" && /^\d+$/u.test(value)))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

export function everySku(rows: Record<string, unknown>[], predicate: (row: Record<string, unknown>) => boolean) {
  return rows.length > 0 && rows.every(predicate);
}

export function uniqueSkuIds(rows: Record<string, unknown>[], key: string) {
  return everySku(rows, row => skuText(row[key]))
    && new Set(rows.map(row => String(row[key]).trim())).size === rows.length;
}
