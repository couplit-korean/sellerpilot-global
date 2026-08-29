import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { handleServerRuntimeSmoke } from "../../../../lib/server-runtime-smoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// This value is not an authentication secret. The outer admin session is the
// authorization boundary; the in-process bearer only reuses the existing
// synthetic smoke handler without exposing its operational secret.
const ADMIN_SMOKE_BRIDGE = "sellerpilot-admin-ai-gateway-smoke-v1";

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const syntheticRequest = new Request(request.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ADMIN_SMOKE_BRIDGE}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "ai_gateway_smoke" }),
  });
  return handleServerRuntimeSmoke(syntheticRequest, {
    runtimeSmokeSecret: ADMIN_SMOKE_BRIDGE,
  });
}
