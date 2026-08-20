import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";

const adminEmail = "admin@couplit-official.test";
const supportedCurrentEmails = new Set(["sample@couplit-official.test", adminEmail]);

export async function POST(request: Request) {
  const context = await authenticateAdminRequest(request);
  if (isAdminApiError(context)) return context;

  const currentEmail = context.user.email?.trim().toLowerCase() ?? "";
  if (!supportedCurrentEmails.has(currentEmail)) {
    return NextResponse.json(
      { message: "현재 접속한 sample 관리자 계정만 변경할 수 있습니다." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const meetsPasswordPolicy = password.length >= 10
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
  if (!meetsPasswordPolicy) {
    return NextResponse.json(
      { message: "비밀번호는 10자 이상이며 영문 대·소문자, 숫자, 특수문자를 모두 포함해야 합니다." },
      { status: 422 },
    );
  }

  const { data, error } = await context.serviceClient.auth.admin.updateUserById(context.user.id, {
    email: adminEmail,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    return NextResponse.json(
      {
        message: error?.code === "weak_password" || /password|weak|length/i.test(error?.message ?? "")
          ? "입력한 비밀번호가 운영 인증 서버의 보안 정책을 충족하지 않습니다."
          : "관리자 로그인 정보를 변경하지 못했습니다.",
      },
      { status: error?.code === "weak_password" ? 422 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    loginId: "admin",
    message: "관리자 아이디가 admin으로 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.",
  });
}
