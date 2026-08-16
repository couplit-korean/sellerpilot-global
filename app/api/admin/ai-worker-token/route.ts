import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";

export const runtime = "nodejs";

const issueSchema = z.object({
  label: z.string().trim().min(1).max(80).default("SellerPilot Mac Worker"),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

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

  const token = `spw_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const fingerprint = tokenHash.slice(0, 12).toUpperCase();
  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString();
  const { error } = await admin.userClient.rpc("sellerpilot_issue_ai_worker_token", {
    p_label: parsed.data.label,
    p_token_hash: tokenHash,
    p_fingerprint: fingerprint,
    p_expires_at: expiresAt,
  });
  if (error) return NextResponse.json({ message: "CLI 작업자 토큰을 발급하지 못했습니다." }, { status: 500 });

  return NextResponse.json({
    token,
    fingerprint,
    expiresAt,
    message: "새 CLI 작업자 토큰이 발급됐습니다. 이 화면을 닫으면 다시 볼 수 없습니다.",
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
