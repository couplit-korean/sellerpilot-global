import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const mutationSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
});

function providerMutationStateUncertainResponse() {
  return NextResponse.json({
    code: "GATEWAY_PROVIDER_MUTATION_STATE_UNCERTAIN",
    message: "채널 외부 호출 시작 여부를 수동으로 확인해야 합니다.",
  }, { status: 409 });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("channel gateway mutation fence server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }

  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "채널 외부 호출 경계 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data, error } = await serviceClient.rpc(
    "sellerpilot_service_begin_gateway_provider_mutation",
    {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
    },
  );
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("channel gateway mutation fence RPC failed", {
      code: error.code ?? "unknown",
      status,
    });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (data !== true) {
    const { data: ownership, error: ownershipError } = await serviceClient.rpc(
      "sellerpilot_touch_channel_gateway_job",
      {
        p_token_hash: tokenHash,
        p_job_id: parsed.data.jobId,
        p_claim_token: parsed.data.claimToken,
        p_worker_version: "sellerpilot-cli-worker/provider-fence-recheck",
      },
    );
    if (ownershipError) {
      const status = workerRpcErrorStatus(ownershipError);
      console.error("channel gateway mutation fence ownership recheck failed", {
        code: ownershipError.code ?? "unknown",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
    if (ownership !== "running") {
      return NextResponse.json({ message: "채널 작업 실행 권한 또는 lease가 만료됐습니다." }, { status: 409 });
    }
    const { data: contextData, error: contextError } = await serviceClient.rpc(
      "sellerpilot_service_gateway_completion_context",
      {
        p_token_hash: tokenHash,
        p_job_id: parsed.data.jobId,
        p_claim_token: parsed.data.claimToken,
      },
    );
    if (contextError) {
      const status = workerRpcErrorStatus(contextError);
      console.error("channel gateway mutation fence context recheck failed", {
        code: contextError.code ?? "unknown",
        status,
      });
      return status === 401
        ? NextResponse.json({ message: workerRpcErrorMessage(status) }, { status })
        : providerMutationStateUncertainResponse();
    }
    const context = contextData && typeof contextData === "object" && !Array.isArray(contextData)
      ? contextData as Record<string, unknown>
      : null;
    if (!context || context.status !== "running") {
      return NextResponse.json({ message: "채널 작업 실행 권한 또는 lease가 만료됐습니다." }, { status: 409 });
    }
    if (["listing.create", "listing.update", "listing.stop"].includes(String(context.operation))
        && context.publication_verification_boundary != null) {
      return providerMutationStateUncertainResponse();
    }
    return NextResponse.json({
      code: "GATEWAY_PROVIDER_MUTATION_NOT_STARTED",
      message: "채널 외부 호출 게이트가 닫혀 작업을 시작하지 않았습니다.",
    }, { status: 412 });
  }
  return NextResponse.json({ status: "recorded" }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
