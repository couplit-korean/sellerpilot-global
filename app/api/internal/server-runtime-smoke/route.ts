import { handleServerRuntimeSmoke } from "../../../../lib/server-runtime-smoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleServerRuntimeSmoke(request);
}

export async function POST(request: Request) {
  return handleServerRuntimeSmoke(request);
}
