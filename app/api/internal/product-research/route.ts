import { runServerProductRecoverySchedule } from "../../../../lib/server-product-research-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return runServerProductRecoverySchedule(request);
}
