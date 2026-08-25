import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";

const issueSchema = z.object({
  label: z.string().trim().min(1).max(80).default("SellerPilot Mac Worker"),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

const workerScopes = ["ai", "gateway", "scheduler"] as const;
const workerTokenSchema = z.string().regex(/^spw_[A-Za-z0-9_-]{43}$/);
const tokenSetTokensSchema = z.object({
  ai: workerTokenSchema,
  gateway: workerTokenSchema,
  scheduler: workerTokenSchema,
}).strict();
const tokenSetProofSchema = z.object({
  tokenSetId: z.string().uuid(),
  tokens: tokenSetTokensSchema,
}).strict();
const tokenSetAbortSchema = z.object({
  tokenSetId: z.string().uuid(),
  tokens: tokenSetTokensSchema,
}).strict();
const pendingSetResultSchema = z.object({
  status: z.literal("pending"),
  tokenSetId: z.string().uuid(),
  activationExpiresAt: z.string(),
});
const tokenSetMutationResultSchema = z.object({
  status: z.enum(["activated", "active", "aborted", "expired", "invalid"]),
  tokenSetId: z.string().uuid().optional(),
  replayed: z.boolean().optional(),
});

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function serviceClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) return null;
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const { data, error } = await admin.userClient.rpc("sellerpilot_ai_runtime_status");
  if (error) return NextResponse.json({ message: "CLI 작업자 상태를 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json(data ?? { worker: null, queued: 0, running: 0, succeeded_today: 0, failed_today: 0 }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = issueSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "CLI 작업자 토큰 설정을 확인해 주세요." }, { status: 400 });

  const tokens = Object.fromEntries(workerScopes.map((scope) => {
    const token = `spw_${randomBytes(32).toString("base64url")}`;
    const hash = tokenHash(token);
    return [scope, { token, tokenHash: hash, fingerprint: hash.slice(0, 12).toUpperCase() }];
  })) as Record<(typeof workerScopes)[number], { token: string; tokenHash: string; fingerprint: string }>;
  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString();
  const { data, error } = await admin.userClient.rpc("sellerpilot_issue_pending_worker_token_set", {
    p_label: parsed.data.label,
    p_token_metadata: Object.fromEntries(workerScopes.map((scope) => [scope, {
      tokenHash: tokens[scope].tokenHash,
      fingerprint: tokens[scope].fingerprint,
    }])),
    p_expires_at: expiresAt,
  });
  const pendingSet = pendingSetResultSchema.safeParse(data);
  if (error || !pendingSet.success) {
    return NextResponse.json({ message: "CLI 작업자 토큰 세트를 발급하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    tokenSetId: pendingSet.data.tokenSetId,
    activationExpiresAt: pendingSet.data.activationExpiresAt,
    expiresAt,
    tokens: Object.fromEntries(workerScopes.map((scope) => [scope, {
      token: tokens[scope].token,
      fingerprint: tokens[scope].fingerprint,
    }])),
    message: "새 CLI 작업자 토큰 세트가 대기 상태로 발급됐습니다. 설치가 확인되기 전까지 기존 작업자는 계속 동작합니다.",
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}

async function mutatePendingTokenSet(request: Request, action: "activate" | "abort") {
  const body = await request.json().catch(() => null);
  const parsed = action === "activate"
    ? tokenSetProofSchema.safeParse(body)
    : tokenSetAbortSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "작업자 토큰 세트 증명을 확인할 수 없습니다." }, { status: 400 });
  }
  const client = serviceClient();
  if (!client) {
    return NextResponse.json({ message: "작업자 토큰 세트 서버 연결이 완료되지 않았습니다." }, { status: 503 });
  }
  const hashes = parsed.data.tokens
    ? Object.fromEntries(workerScopes.map((scope) => [scope, tokenHash(parsed.data.tokens![scope])]))
    : null;
  const rpc = action === "activate"
    ? "sellerpilot_service_activate_worker_token_set"
    : "sellerpilot_service_abort_worker_token_set";
  const { data, error } = await client.rpc(rpc, {
    p_rotation_set_id: parsed.data.tokenSetId,
    p_token_hashes: hashes,
  });
  const result = tokenSetMutationResultSchema.safeParse(data);
  if (error || !result.success || result.data.status === "invalid") {
    return NextResponse.json({ message: "작업자 토큰 세트가 요청과 일치하지 않습니다." }, { status: 409 });
  }
  if (action === "activate") {
    if (result.data.status !== "activated") {
      return NextResponse.json({
        status: result.data.status,
        message: result.data.status === "aborted"
          ? "이 작업자 토큰 세트는 이미 폐기됐습니다."
          : "작업자 토큰 세트 활성화 시간이 만료됐습니다.",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    return NextResponse.json({
      status: "activated",
      tokenSetId: result.data.tokenSetId,
      replayed: result.data.replayed === true,
      message: "새 작업자 토큰 세트를 활성화하고 이전 토큰을 원자적으로 폐기했습니다.",
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (result.data.status === "active") {
    return NextResponse.json({
      status: "active",
      tokenSetId: result.data.tokenSetId,
      message: "작업자 토큰 세트가 이미 활성화되어 폐기하지 않았습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  return NextResponse.json({
    status: "aborted",
    tokenSetId: result.data.tokenSetId,
    replayed: result.data.replayed === true,
    message: "대기 중인 작업자 토큰 세트를 폐기했으며 기존 활성 토큰은 유지됩니다.",
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function PATCH(request: Request) {
  return mutatePendingTokenSet(request, "activate");
}

export async function DELETE(request: Request) {
  return mutatePendingTokenSet(request, "abort");
}
