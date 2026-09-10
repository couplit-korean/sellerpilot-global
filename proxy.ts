import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Internal scheduler and worker routes authenticate their own bearer tokens.
  // Do not make those durable calls depend on the end-user Supabase session
  // refresh that is required for interactive browser routes.
  if (request.nextUrl.pathname.startsWith("/api/internal/")) {
    return NextResponse.next();
  }
  // Provider OAuth callbacks must reach the app page. The page binds the
  // Lazada exact-OAuth session from sessionStorage and completes the Shopee and
  // eBay authorizations there, so redirecting the root callback to a server
  // route strands every one of those flows.
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
