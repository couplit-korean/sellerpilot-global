import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertOfficialRecoveryObservation,
  ELEVENST_CREATE_RECOVERY_CLAIM_RPC,
  ELEVENST_CREATE_RECOVERY_FINISH_RPC,
  parseElevenstCreateRecoveryClaim,
} from "../../../../../../lib/channels/elevenst-create-recovery-drain";
import { supabaseUrl } from "../../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../../lib/worker-rpc";

export const runtime = "nodejs";
export const maxDuration = 60;

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };
const uuidSchema = z.string().uuid();
const finishSchema = z.object({
  action: z.literal("finish"),
  jobId: uuidSchema,
  recoveryToken: uuidSchema,
  observation: z.record(z.string(), z.unknown()),
});

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return json({ message: "채널 작업자 인증이 필요합니다." }, 401);
  }
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) {
    return json({ message: workerRpcErrorMessage(503) }, 503);
  }

  const body = await request.json().catch(() => null);
  const action = body && typeof body === "object" && !Array.isArray(body)
    ? String((body as { action?: unknown }).action ?? "")
    : "";
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken, "utf8").digest("hex");

  if (action === "claim") {
    const { data, error } = await serviceClient.rpc(ELEVENST_CREATE_RECOVERY_CLAIM_RPC, {
      p_token_hash: tokenHash,
    });
    if (error) {
      const status = workerRpcErrorStatus(error);
      return json({ message: workerRpcErrorMessage(status) }, status);
    }
    if (data == null) {
      return json({ status: "idle", claimed: 0 });
    }
    if (!parseElevenstCreateRecoveryClaim(data)) {
      return json({ message: "11번가 복구 작업 계약을 확인하지 못했습니다." }, 503);
    }
    return json({ status: "claimed", claim: data as Record<string, unknown> });
  }

  const parsedFinish = finishSchema.safeParse(body);
  if (!parsedFinish.success) {
    return json({ message: "11번가 복구 완료 요청이 올바르지 않습니다." }, 400);
  }

  let observation;
  try {
    observation = assertOfficialRecoveryObservation(
      parsedFinish.data.observation as Parameters<typeof assertOfficialRecoveryObservation>[0],
    );
  } catch {
    return json({ message: "11번가 공식 GET-only 복구를 확인하지 못했습니다." }, 503);
  }

  const { data, error } = await serviceClient.rpc(ELEVENST_CREATE_RECOVERY_FINISH_RPC, {
    p_token_hash: tokenHash,
    p_job_id: parsedFinish.data.jobId,
    p_recovery_token: parsedFinish.data.recoveryToken,
    p_observation: observation,
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    return json({ message: workerRpcErrorMessage(status) }, status);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ message: workerRpcErrorMessage(503) }, 503);
  }
  return json(data as Record<string, unknown>);
}
