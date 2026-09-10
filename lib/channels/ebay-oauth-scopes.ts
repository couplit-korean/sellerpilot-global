export const ebayDefaultScopes = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
] as const;

export const ebayMessageScope = "https://api.ebay.com/oauth/api_scope/commerce.message";

export function hasRecordedEbayMessageScope(payload: Record<string, unknown>) {
  return typeof payload.scopes === "string" && payload.scopes.split(/\s+/).includes(ebayMessageScope);
}

// New access is requested explicitly at consent. Refresh can preserve an
// already recorded grant, but must never silently expand a legacy token.
export function ebayOAuthScopes(payload: Record<string, unknown>, includeMessages = false): readonly string[] {
  return includeMessages || hasRecordedEbayMessageScope(payload)
    ? [...ebayDefaultScopes, ebayMessageScope]
    : ebayDefaultScopes;
}

export function parseEbayOAuthCookie(value: string) {
  const parts = value.split(".");
  if ((parts.length !== 2 && parts.length !== 3)
    || !/^sellerpilot-ebay-[A-Za-z0-9_-]{32}$/.test(parts[0])
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[1])
    || (parts.length === 3 && parts[2] !== "messages")) return null;
  return { state: parts[0], credentialId: parts[1], includeMessages: parts[2] === "messages" };
}
