export type ShopeeConnectionStatus = "provider_verified" | "oauth_reconnect_required" | "status_unavailable";

export function resolveShopeeConnectionStatus(input: {
  rpcFailed: boolean;
  current?: Exclude<ShopeeConnectionStatus, "status_unavailable">;
  previous?: ShopeeConnectionStatus;
}): ShopeeConnectionStatus {
  if (!input.rpcFailed) return input.current ?? "status_unavailable";
  return input.previous === "oauth_reconnect_required" || input.previous === "status_unavailable"
    ? input.previous
    : "status_unavailable";
}
