export function qoo10CatalogCode(value: unknown) {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d{1,10}$/.test(normalized) ? normalized : "";
}

const qoo10CountryCodes = new Map([
  ["대한민국", "KR"],
  ["한국", "KR"],
  ["republic of korea", "KR"],
  ["korea, republic of", "KR"],
  ["south korea", "KR"],
  ["kr", "KR"],
  ["중국", "CN"],
  ["china", "CN"],
  ["cn", "CN"],
  ["일본", "JP"],
  ["japan", "JP"],
  ["jp", "JP"],
  ["미국", "US"],
  ["united states", "US"],
  ["us", "US"],
  ["베트남", "VN"],
  ["vietnam", "VN"],
  ["vn", "VN"],
  ["태국", "TH"],
  ["thailand", "TH"],
  ["th", "TH"],
  ["대만", "TW"],
  ["taiwan", "TW"],
  ["tw", "TW"],
]);

export function qoo10ProductionPlace(value: unknown) {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return qoo10CountryCodes.get(normalized.toLocaleLowerCase()) ?? normalized;
}

export function qoo10ProductionPlaceFields(value: unknown) {
  const productionPlace = qoo10ProductionPlace(value);
  if (productionPlace === "JP") {
    // QAPI type 1 requires a concrete Japanese prefecture (for example,
    // TOKYO). A country-only source cannot safely invent one, so preserve the
    // known country as an explicit type-3 free description instead.
    return { ProductionPlaceType: "3", ProductionPlace: "JAPAN" } as const;
  }
  return /^[A-Z]{2}$/u.test(productionPlace)
    ? { ProductionPlaceType: "2", ProductionPlace: productionPlace } as const
    : { ProductionPlaceType: "3", ProductionPlace: productionPlace } as const;
}

export function qoo10ExpiryDate(now = new Date()) {
  const expiry = new Date(now);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry.toISOString().slice(0, 10);
}

export function qoo10SellerCode(sku: string, pausedRemoteId?: string) {
  const base = sku.trim() || "SELLERPILOT";
  if (!pausedRemoteId) return base.slice(0, 100);
  const remoteTail = pausedRemoteId.replace(/\D/g, "").slice(-5) || "RETRY";
  const suffix = `R${remoteTail}`;
  return `${base.slice(0, Math.max(1, 99 - suffix.length))}-${suffix}`.slice(0, 100);
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
