import { runServerlessCsGatewayDrain } from "../../../../lib/channels/serverless-cs-gateway";
import { configuredServerlessCsGatewayDependencies } from "../../../../lib/channels/serverless-cs-gateway-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runServerlessCsGatewayDrain(
    request,
    configuredServerlessCsGatewayDependencies(),
  );
}
