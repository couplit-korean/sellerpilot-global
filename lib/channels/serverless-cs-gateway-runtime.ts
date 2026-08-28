import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "../supabase/config";
import { createBoundedSupabaseFetch } from "../worker-rpc";
import type { ServerlessCsGatewayDependencies } from "./serverless-cs-gateway";
import {
  configuredServerlessStaticEgressChannels,
  SERVERLESS_STATIC_EGRESS_HEADER,
  serverlessStaticEgressHeaderValue,
} from "./serverless-static-egress";

export function configuredServerlessCsGatewayDependencies(): ServerlessCsGatewayDependencies {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const staticEgressChannels = configuredServerlessStaticEgressChannels();
  const staticEgressHeader = serverlessStaticEgressHeaderValue(staticEgressChannels);
  const serviceClient = supabaseUrl && secretKey
    ? createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: createBoundedSupabaseFetch(10_000),
        ...(staticEgressHeader
          ? { headers: { [SERVERLESS_STATIC_EGRESS_HEADER]: staticEgressHeader } }
          : {}),
      },
    })
    : null;

  return {
    cronSecret: process.env.CRON_SECRET,
    releaseId: process.env.SELLERPILOT_RELEASE_SHA,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA,
    requireActiveRuntime: true,
    staticEgressChannels,
    rpc: serviceClient
      ? async (name, arguments_ = {}) => {
        const { data, error } = await serviceClient.rpc(name, arguments_);
        return { data, error };
      }
      : undefined,
  };
}
