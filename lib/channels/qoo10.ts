export function qoo10CatalogCode(value: unknown) {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d{1,10}$/.test(normalized) ? normalized : "";
}

export function qoo10ExpiryDate(now = new Date()) {
  const expiry = new Date(now);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry.toISOString().slice(0, 10);
}

export function qoo10ResultMessage(data: Record<string, unknown>) {
  const value = data.ResultMsg;
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\b(key|token|secret)=\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
