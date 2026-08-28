import { runServerProductResearchCron } from "../../../../lib/server-product-research";
import { configuredServerProductResearchDependencies } from "../../../../lib/server-product-research-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return runServerProductResearchCron(
    request,
    configuredServerProductResearchDependencies(),
  );
}
