import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getVercelOidcToken } from "@vercel/oidc";
import type { AdminApiContext } from "./admin-api";
import {
  runOneServerProductStudio,
  type ServerProductStudioDependencies,
} from "./server-product-studio";
import { supabaseUrl } from "./supabase/config";
import type { StudioWorkerReadiness, StudioWorkerReadinessReason } from "./studio-worker-readiness";
import { createBoundedSupabaseFetch } from "./worker-rpc";
import { deriveSupabaseInternalScheduleBearer } from "./internal-scheduler-auth";
import { readServerAiGatewayVerification } from "./server-ai-gateway-verification";

const WORKER_TOKEN_PATTERN = /^spw_[A-Za-z0-9_-]{43}$/;
const MAX_STORAGE_OBJECT_BYTES = 24 * 1024 * 1024;
const PRODUCT_RECOVERY_WAKE_URL = "https://sellerpilot-global.vercel.app/api/internal/product-studio-wake";

function configuredToken() {
  const token = process.env.SELLERPILOT_AI_WORKER_TOKEN?.trim() ?? "";
  return WORKER_TOKEN_PATTERN.test(token) ? token : "";
}

function runtimeConfiguration() {
  const token = configuredToken();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  return {
    token,
    tokenHash: token ? createHash("sha256").update(token).digest("hex") : "",
    secretKey,
    configured: Boolean(supabaseUrl && secretKey && token),
  };
}

async function aiGatewayAuthenticationAvailable() {
  // AI Gateway gives a configured API key priority. On Vercel Functions,
  // OIDC is delivered through the request context's x-vercel-oidc-token
  // header, not a runtime environment variable. The SDK resolves that same
  // request-scoped token again when the model call runs inside after().
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return true;
  try {
    return Boolean(await getVercelOidcToken());
  } catch {
    return false;
  }
}

function checkedStorageBytes(value: ArrayBuffer) {
  if (value.byteLength < 1 || value.byteLength > MAX_STORAGE_OBJECT_BYTES) {
    throw new Error("storage_object_size_invalid");
  }
  return new Uint8Array(value);
}

function configuredNextProductWake() {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret) return undefined;
  const authorization = `Bearer ${deriveSupabaseInternalScheduleBearer(cronSecret)}`;
  return async () => {
    const response = await fetch(PRODUCT_RECOVERY_WAKE_URL, {
      method: "POST",
      headers: {
        authorization,
        "user-agent": "SellerPilot-Vercel-Studio-Drain/1",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 202) throw new Error("server_studio_next_wake_rejected");
  };
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
    wakeNext: configuredNextProductWake(),
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

function unavailable(
  reason: Exclude<StudioWorkerReadinessReason, "ready">,
  message: string,
  details: Pick<StudioWorkerReadiness, "configurationReady" | "gatewayVerification"> = {
    configurationReady: false,
    gatewayVerification: {
      status: "unverified",
      code: null,
      checkedAt: null,
      expiresAt: null,
    },
  },
): StudioWorkerReadiness {
  return { available: false, reason, message, checkedAt: new Date().toISOString(), ...details };
}

function gatewayVerificationFailureMessage(code: string | null) {
  if (code === "customer_verification_required") {
    return "Vercel AI Gateway 고객 확인·결제수단 확인이 필요합니다. 확인을 마친 뒤 운영 설정에서 실제 호출을 다시 점검해 주세요.";
  }
  if (code === "billing_required") {
    return "Vercel AI Gateway 사용 한도 또는 결제 상태 확인이 필요합니다. 확인을 마친 뒤 운영 설정에서 실제 호출을 다시 점검해 주세요.";
  }
  if (code === "authentication_error") {
    return "Vercel AI Gateway 인증 연결을 확인하지 못했습니다. 배포 OIDC·Gateway 설정을 확인한 뒤 실제 호출을 다시 점검해 주세요.";
  }
  return "Vercel AI Gateway 실제 생성 호출 점검에 실패했습니다. 운영 설정에서 Gateway 상태를 확인한 뒤 다시 점검해 주세요.";
}

export async function readServerProductStudioReadiness(
  admin: AdminApiContext,
  request: Request,
): Promise<StudioWorkerReadiness> {
  const configuration = runtimeConfiguration();
  const gatewayAuthenticated = await aiGatewayAuthenticationAvailable();
  if (!configuration.configured || !gatewayAuthenticated) {
    return unavailable(
      "configuration_missing",
      "서버 AI 제작 환경(OIDC·Supabase 큐·AI 작업자 토큰)이 아직 모두 연결되지 않았습니다.",
    );
  }
  const { data, error } = await admin.userClient.rpc("sellerpilot_ai_runtime_status");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return unavailable("status_unavailable", "서버 AI 제작 토큰 상태를 확인하지 못했습니다.");
  }
  const worker = (data as Record<string, unknown>).worker;
  if (!worker || typeof worker !== "object" || Array.isArray(worker)) {
    return unavailable("token_missing_or_expired", "Supabase에 활성 AI 범위 작업자 토큰이 없습니다.");
  }
  const snapshot = worker as Record<string, unknown>;
  const expectedFingerprint = configuration.tokenHash.slice(0, 12).toUpperCase();
  if (snapshot.scope !== "ai" || snapshot.fingerprint !== expectedFingerprint) {
    return unavailable("token_mismatch", "Vercel 서버 토큰과 Supabase 활성 AI 토큰이 일치하지 않습니다.");
  }
  const gatewayVerification = readServerAiGatewayVerification(request, admin.user.id);
  if (gatewayVerification.status === "failed") {
    return unavailable(
      "gateway_verification_failed",
      gatewayVerificationFailureMessage(gatewayVerification.code),
      { configurationReady: true, gatewayVerification },
    );
  }
  if (gatewayVerification.status !== "verified") {
    return unavailable(
      "gateway_unverified",
      "서버 AI 구성은 감지했지만 AI Gateway 실제 생성 호출은 아직 확인되지 않았습니다. 운영 설정에서 실제 호출 점검을 통과해야 새 상품 분석을 시작할 수 있습니다.",
      { configurationReady: true, gatewayVerification },
    );
  }
  return {
    available: true,
    reason: "ready",
    message: "Vercel AI Gateway 실제 생성 호출과 Supabase 상품 제작 큐 인증을 확인했습니다.",
    checkedAt: new Date().toISOString(),
    configurationReady: true,
    gatewayVerification,
  };
}
