import { createHash } from "node:crypto";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ChannelGatewayInProgressError,
  ChannelGatewayReconciliationRequiredError,
  exchangeOAuthViaChannelGateway,
} from "../../../../lib/channels/gateway";
import { lazadaCountryFromOAuthState, lazadaTargetCountry } from "../../../../lib/channels/lazada-my-contract";
import { supabaseUrl } from "../../../../lib/supabase/config";
import { createClient as createSessionClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const oauthCookieName = "sellerpilot_lazada_oauth";

function stateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function backToConnections(request: NextRequest, oauth: string) {
  const target = new URL(`/?view=connections&oauth=${encodeURIComponent(oauth)}`, request.url);
  const response = NextResponse.redirect(target);
  response.cookies.set(oauthCookieName, "", { path: "/", maxAge: 0 });
  return response;
}

/**
 * Completes the Lazada seller authorization on the server.
 *
 * The browser callback is handled here instead of in the client bundle so a
 * page that fails to hydrate can still finish the authorization-code exchange
 * before Lazada's one-time code expires.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  const country = lazadaCountryFromOAuthState(state);
  if (!code || country !== lazadaTargetCountry) {
    return backToConnections(request, "unsupported");
  }

  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) return backToConnections(request, "not-configured");

  const sessionClient = await createSessionClient();
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }] = await Promise.all([
    sessionClient.auth.getUser(),
    sessionClient.rpc("sellerpilot_is_admin"),
  ]);
  if (userError || !userData.user) return backToConnections(request, "login-required");
  if (adminError || isAdmin !== true) return backToConnections(request, "forbidden");

  const cookieValue = request.cookies.get(oauthCookieName)?.value ?? "";
  const separator = cookieValue.lastIndexOf(".");
  const cookieState = separator > 0 ? cookieValue.slice(0, separator) : "";
  const cookieCredentialId = separator > 0 ? cookieValue.slice(separator + 1) : "";
  if (!cookieState || cookieState !== state) return backToConnections(request, "state-mismatch");

  const serviceClient = createServiceClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claimedCredentialId, error: stateError } = await serviceClient.rpc(
    "sellerpilot_service_claim_channel_oauth_state",
    {
      p_owner_id: userData.user.id,
      p_channel: "lazada",
      p_state_hash: stateHash(state),
    },
  );
  const persistedCredentialId = !stateError && z.string().uuid().safeParse(claimedCredentialId).success
    ? String(claimedCredentialId)
    : "";
  const credentialId = persistedCredentialId
    || (z.string().uuid().safeParse(cookieCredentialId).success ? cookieCredentialId : "");
  if (!credentialId) return backToConnections(request, "state-mismatch");

  try {
    await exchangeOAuthViaChannelGateway({
      serviceClient,
      credentialId,
      channel: "lazada",
      request: { code, country },
    });
  } catch (error) {
    if (error instanceof ChannelGatewayInProgressError) return backToConnections(request, "in-progress");
    if (error instanceof ChannelGatewayReconciliationRequiredError) {
      return backToConnections(request, "reconciliation-required");
    }
    return backToConnections(request, "exchange-failed");
  }
  return backToConnections(request, "connected");
}
