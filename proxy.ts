import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

const providerOAuthStatePrefix = /^sellerpilot-(?:lazada|shopee|ebay)-/;

export async function proxy(request: NextRequest) {
  // Internal scheduler and worker routes authenticate their own bearer tokens.
  // Do not make those durable calls depend on the end-user Supabase session
  // refresh that is required for interactive browser routes.
  if (request.nextUrl.pathname.startsWith("/api/internal/")) {
    return NextResponse.next();
  }
  // Provider OAuth redirects land on the app root with a one-time code. Finish
  // the exchange on the server so a client bundle that fails to hydrate cannot
  // drop the authorization code.
  const oauthCode = request.nextUrl.searchParams.get("code");
  const oauthState = request.nextUrl.searchParams.get("state") ?? "";
  if (oauthCode && providerOAuthStatePrefix.test(oauthState)) {
    const callback = new URL("/api/oauth/callback", request.url);
    callback.searchParams.set("code", oauthCode);
    callback.searchParams.set("state", oauthState);
    return NextResponse.redirect(callback);
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
