export function qoo10CatalogCode(value: unknown) {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d{1,10}$/.test(normalized) ? normalized : "";
}

export function qoo10ExpiryDate(now = new Date()) {
  const expiry = new Date(now);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry.toISOString().slice(0, 10);
}

export function qoo10SellerCode(sku: string, pausedRemoteId?: string) {
  const base = sku.trim() || "SELLERPILOT";
  if (!pausedRemoteId) return base.slice(0, 20);
  const remoteTail = pausedRemoteId.replace(/\D/g, "").slice(-5) || "RETRY";
  const suffix = `R${remoteTail}`;
  return `${base.slice(0, Math.max(1, 19 - suffix.length))}-${suffix}`.slice(0, 20);
}

export function qoo10PauseParams(remoteId: string) {
  const itemCode = remoteId.trim();
  if (!/^\d{9,10}$/.test(itemCode)) throw new Error("QOO10_ITEM_CODE_INVALID");
  return { ItemCode: itemCode, Status: "1" } as const;
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
