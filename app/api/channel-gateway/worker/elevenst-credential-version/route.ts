import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  parseElevenstGatewayCredentialVersionReceipt,
  elevenstGatewayCredentialVersionRpc,
} from "../../../../../lib/product-registration/elevenst/credential-version";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const requestSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
});

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "11번가 자격증명 확인 요청이 올바르지 않습니다." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data, error } = await serviceClient.rpc(
    elevenstGatewayCredentialVersionRpc,
    {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
    },
  );
  if (error) {
    const status = workerRpcErrorStatus(error);
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  try {
    const receipt = parseElevenstGatewayCredentialVersionReceipt(data);
    if (receipt.jobId !== parsed.data.jobId) {
      throw new Error("ELEVENST_GATEWAY_CREDENTIAL_VERSION_RECEIPT_INVALID");
    }
    return NextResponse.json(receipt, {
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
}
