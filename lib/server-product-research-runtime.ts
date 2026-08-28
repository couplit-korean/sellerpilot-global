import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  analyzeServerProductResearch,
  runOneServerProductResearch,
  type ServerProductResearchDependencies,
} from "./server-product-research";
import { supabaseUrl } from "./supabase/config";
import { createBoundedSupabaseFetch } from "./worker-rpc";

export function configuredServerProductResearchDependencies(): ServerProductResearchDependencies {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const serviceClient = supabaseUrl && secretKey
    ? createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: createBoundedSupabaseFetch(10_000) },
    })
    : null;

  return {
    cronSecret: process.env.CRON_SECRET,
    releaseId: process.env.SELLERPILOT_RELEASE_SHA,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA,
    requireActiveRuntime: true,
    rpc: serviceClient
      ? async (name, arguments_ = {}) => {
        const { data, error } = await serviceClient.rpc(name, arguments_);
        return { data, error };
      }
      : undefined,
    analyze: analyzeServerProductResearch,
  };
}

export async function wakeServerProductResearchAfterResponse() {
  try {
    const response = await runOneServerProductResearch(
      configuredServerProductResearchDependencies(),
    );
    if (response.status >= 500) {
      console.error("server product research after wakeup failed", {
        status: response.status,
      });
    }
  } catch {
    console.error("server product research after wakeup threw", { status: 503 });
  }
}
