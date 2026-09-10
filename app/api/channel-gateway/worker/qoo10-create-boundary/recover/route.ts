import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUrl } from "../../../../../../lib/supabase/config";
import {
  qoo10CreateGetRecoveryContract,
  recordQoo10CreateOfficialGetRecovery,
} from "../../../../../../lib/server-qoo10-listing-create-fulfillment-source";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
} from "../../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const requestSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
  sourceId: z.string().uuid(),
  requestSha256: digest,
  responseSha256: digest,
  observation: z.object({
    contract: z.literal("sellerpilot_qoo10_local_create_seller_code_lookup_v1"),
    lookupStatus: z.literal("observed"),
    matchStatus: z.enum(["unique", "absent", "ambiguous"]),
    sellerCode: z.string().trim().min(1).max(200),
    httpStatus: z.number().int(),
    resultCode: z.string().nullable(),
    resultMessage: z.string().nullable(),
    exactRemoteIds: z.array(z.string()),
    uniqueRemoteId: z.string().nullable(),
    observedAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

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
    return NextResponse.json({ message: "Qoo10 CREATE GET 복구 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  try {
    const receipt = await recordQoo10CreateOfficialGetRecovery({
      rpc: (name, parameters) => serviceClient.rpc(name, parameters),
      gatewayTokenHash: tokenHash,
      jobId: parsed.data.jobId,
      claimToken: parsed.data.claimToken,
      sourceId: parsed.data.sourceId,
      observation: parsed.data.observation,
      requestSha256: parsed.data.requestSha256,
      responseSha256: parsed.data.responseSha256,
    });
    return NextResponse.json({
      contract: qoo10CreateGetRecoveryContract,
      status: receipt.status,
      receiptKind: receipt.receiptKind,
      matchStatus: receipt.matchStatus,
      listingPublished: false,
      synthesizedPostReceipt: false,
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "QOO10_CREATE_GET_RECOVERY_EXISTING_ITEM_REJECTED") {
      return NextResponse.json({
        code,
        message: "기존상품 GET 복구는 신규 등록 성공으로 쓰지 않습니다.",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    return NextResponse.json({
      code: "QOO10_CREATE_GET_RECOVERY_UNCERTAIN",
      message: "Qoo10 CREATE 공식 GET 복구를 확정할 수 없습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
