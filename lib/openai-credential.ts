import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./supabase/config";

type OpenAISecret = {
  api_key?: unknown;
  project_id?: unknown;
};

export type OpenAICredential = {
  apiKey: string;
  project?: string;
  source: "vault" | "environment";
};

function normalizeSecret(value: unknown): OpenAISecret | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as OpenAISecret;
}

export async function getOpenAICredential(): Promise<OpenAICredential | null> {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (supabaseUrl && secretKey) {
    const serviceClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
      p_channel: "openai",
      p_environment: "production",
    });
    if (!error && data && typeof data === "object") {
      const envelope = data as { secret_payload?: unknown };
      const payload = normalizeSecret(envelope.secret_payload);
      const apiKey = typeof payload?.api_key === "string" ? payload.api_key.trim() : "";
      const project = typeof payload?.project_id === "string" ? payload.project_id.trim() : "";
      if (apiKey) return { apiKey, project: project || undefined, source: "vault" };
    }
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const project = process.env.OPENAI_PROJECT_ID?.trim();
  return apiKey ? { apiKey, project: project || undefined, source: "environment" } : null;
}
