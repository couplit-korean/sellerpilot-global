import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseBrowserConfig } from "./config";

let browserClient: SupabaseClient | undefined;

export const ACCOUNT_SWITCH_LOGOUT_TIMEOUT_MS = 5_000;

function isSupabaseLogoutRequest(input: RequestInfo | URL) {
  const value = input instanceof Request ? input.url : String(input);
  return /\/auth\/v1\/logout(?:\?|$)/.test(value);
}

export function createBrowserSupabaseFetch(
  timeoutMs = ACCOUNT_SWITCH_LOGOUT_TIMEOUT_MS,
  fetcher: typeof fetch = globalThis.fetch,
) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isSupabaseLogoutRequest(input)) return fetcher(input, init);
    // auth-js clears its local session after a logout fetch error. Bound only this
    // request so a slow auth server cannot hold the account-switch gate forever.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return fetcher(input, { ...init, signal });
  };
}

export function createClient() {
  if (!browserClient) {
    const { supabaseUrl, supabasePublishableKey } = requireSupabaseBrowserConfig();
    browserClient = createBrowserClient(supabaseUrl, supabasePublishableKey, {
      global: { fetch: createBrowserSupabaseFetch() },
    });
  }
  return browserClient;
}
