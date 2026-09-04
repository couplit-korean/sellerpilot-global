import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    return NextResponse.json({ message: "작업 ID 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await serviceClient.rpc("sellerpilot_get_channel_gateway_job", { p_job_id: jobId });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({
      ok: false,
      inProgress: true,
      jobId,
      message: "작업 상태를 확인하지 못했습니다.",
    }, { status: 202, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const job = data as { status?: string; response?: unknown; error?: unknown };
  if (job.status === "succeeded" && job.response && typeof job.response === "object" && !Array.isArray(job.response)) {
    return NextResponse.json(job.response, { headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (job.status === "failed" || job.status === "cancelled") {
    return NextResponse.json({
      ok: false,
      message: typeof job.error === "string" && job.error.trim() ? job.error : "채널 작업이 실패했습니다.",
    }, { status: 502, headers: { "cache-control": "no-store, max-age=0" } });
  }
  return NextResponse.json({
    ok: false,
    inProgress: true,
    jobId,
    message: "판매채널 작업이 계속 진행 중입니다.",
  }, { status: 202, headers: { "cache-control": "no-store, max-age=0" } });
}
