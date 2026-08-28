import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { AdminApiContext } from "./admin-api";
import {
  runOneServerProductStudio,
  type ServerProductStudioDependencies,
} from "./server-product-studio";
import { supabaseUrl } from "./supabase/config";
import type { StudioWorkerReadiness } from "./studio-worker-readiness";
import { createBoundedSupabaseFetch } from "./worker-rpc";

const WORKER_TOKEN_PATTERN = /^spw_[A-Za-z0-9_-]{43}$/;
const MAX_STORAGE_OBJECT_BYTES = 24 * 1024 * 1024;

function configuredToken() {
  const token = process.env.SELLERPILOT_AI_WORKER_TOKEN?.trim() ?? "";
  return WORKER_TOKEN_PATTERN.test(token) ? token : "";
}

function runtimeConfiguration() {
  const token = configuredToken();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const oidc = process.env.VERCEL_OIDC_TOKEN?.trim() ?? "";
  return {
    token,
    tokenHash: token ? createHash("sha256").update(token).digest("hex") : "",
    secretKey,
    oidcAvailable: Boolean(oidc),
    configured: Boolean(supabaseUrl && secretKey && token && oidc),
  };
}

function checkedStorageBytes(value: ArrayBuffer) {
  if (value.byteLength < 1 || value.byteLength > MAX_STORAGE_OBJECT_BYTES) {
    throw new Error("storage_object_size_invalid");
  }
  return new Uint8Array(value);
}

export function configuredServerProductStudioDependencies(): ServerProductStudioDependencies {
  const configuration = runtimeConfiguration();
  const serviceClient = configuration.configured
    ? createClient(supabaseUrl, configuration.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: createBoundedSupabaseFetch(30_000) },
    })
    : null;

  return {
    tokenHash: configuration.tokenHash,
    rpc: serviceClient
      ? async (name, arguments_ = {}) => {
        const { data, error } = await serviceClient.rpc(name, arguments_);
        return { data, error };
      }
      : undefined,
    download: serviceClient
      ? async (path, signal) => {
        if (signal.aborted) throw signal.reason;
        const { data, error } = await serviceClient.storage.from("sellerpilot-ai").download(path);
        if (error || !data) throw new Error("storage_download_failed");
        if (signal.aborted) throw signal.reason;
        return checkedStorageBytes(await data.arrayBuffer());
      }
      : undefined,
    upload: serviceClient
      ? async (path, bytes, signal) => {
        if (signal.aborted) throw signal.reason;
        const { error } = await serviceClient.storage.from("sellerpilot-ai").upload(path, bytes, {
          contentType: "image/png",
          cacheControl: "31536000",
          upsert: false,
        });
        if (!error) return "uploaded" as const;

        // A committed upload can lose only its HTTP response. Never overwrite;
        // prove the existing object is byte-identical before treating it as the
        // same idempotent operation.
        const { data: existing, error: readError } = await serviceClient.storage
          .from("sellerpilot-ai")
          .download(path);
        if (readError || !existing) throw new Error("storage_upload_failed");
        const existingBytes = checkedStorageBytes(await existing.arrayBuffer());
        const expectedDigest = createHash("sha256").update(bytes).digest("hex");
        const existingDigest = createHash("sha256").update(existingBytes).digest("hex");
        if (expectedDigest !== existingDigest) throw new Error("storage_upload_conflict");
        return "identical" as const;
      }
      : undefined,
    remove: serviceClient
      ? async (paths) => {
        if (!paths.length) return;
        const { error } = await serviceClient.storage.from("sellerpilot-ai").remove(paths);
        if (error) throw new Error("storage_remove_failed");
      }
      : undefined,
  };
}

export async function wakeServerProductStudioAfterResponse() {
  try {
    const response = await runOneServerProductStudio(configuredServerProductStudioDependencies());
    if (response.status >= 500) {
      console.error("server product studio after wakeup failed", { status: response.status });
    }
  } catch {
    console.error("server product studio after wakeup threw", { status: 503 });
  }
}

function unavailable(reason: "worker_missing" | "status_unavailable", message: string): StudioWorkerReadiness {
  return { available: false, reason, message, checkedAt: new Date().toISOString() };
}

export async function readServerProductStudioReadiness(
  admin: AdminApiContext,
): Promise<StudioWorkerReadiness> {
  const configuration = runtimeConfiguration();
  if (!configuration.configured) {
    return unavailable(
      "worker_missing",
      "서버 AI 제작 환경(OIDC·Supabase 큐·AI 작업자 토큰)이 아직 모두 연결되지 않았습니다.",
    );
  }
  const { data, error } = await admin.userClient.rpc("sellerpilot_ai_runtime_status");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return unavailable("status_unavailable", "서버 AI 제작 토큰 상태를 확인하지 못했습니다.");
  }
  const worker = (data as Record<string, unknown>).worker;
  if (!worker || typeof worker !== "object" || Array.isArray(worker)) {
    return unavailable("worker_missing", "Supabase에 활성 AI 범위 작업자 토큰이 없습니다.");
  }
  const snapshot = worker as Record<string, unknown>;
  const expectedFingerprint = configuration.tokenHash.slice(0, 12).toUpperCase();
  if (snapshot.scope !== "ai" || snapshot.fingerprint !== expectedFingerprint) {
    return unavailable("worker_missing", "Vercel 서버 토큰과 Supabase 활성 AI 토큰이 일치하지 않습니다.");
  }
  return {
    available: true,
    reason: "ready",
    message: "Vercel OIDC 서버 AI와 Supabase 상품 제작 큐가 연결되었습니다.",
    checkedAt: new Date().toISOString(),
  };
}
