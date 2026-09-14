export function qoo10CatalogCode(value: unknown) {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d{1,10}$/.test(normalized) ? normalized : "";
}

const qoo10CountryNames = new Map([
  ["대한민국", "South Korea"],
  ["한국", "South Korea"],
  ["republic of korea", "South Korea"],
  ["korea, republic of", "South Korea"],
  ["south korea", "South Korea"],
  ["중국", "China"],
  ["일본", "Japan"],
  ["미국", "United States"],
  ["베트남", "Vietnam"],
  ["태국", "Thailand"],
  ["대만", "Taiwan"],
]);

export function qoo10ProductionPlace(value: unknown) {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return qoo10CountryNames.get(normalized.toLocaleLowerCase()) ?? normalized;
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
