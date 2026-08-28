import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "../supabase/config";
import { createBoundedSupabaseFetch } from "../worker-rpc";
import type { ServerlessCsGatewayDependencies } from "./serverless-cs-gateway";

export function configuredServerlessCsGatewayDependencies(): ServerlessCsGatewayDependencies {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const serviceClient = supabaseUrl && secretKey
    ? createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: createBoundedSupabaseFetch(10_000) },
    })
    : null;

  return {
    cronSecret: process.env.CRON_SECRET,
    rpc: serviceClient
      ? async (name, arguments_ = {}) => {
        const { data, error } = await serviceClient.rpc(name, arguments_);
        return { data, error };
      }
      : undefined,
  };
}
