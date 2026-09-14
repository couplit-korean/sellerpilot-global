import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseBrowserConfig } from "./config";

let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (!browserClient) {
    const { supabaseUrl, supabasePublishableKey } = requireSupabaseBrowserConfig();
    browserClient = createBrowserClient(supabaseUrl, supabasePublishableKey);
  }
  return browserClient;
}

