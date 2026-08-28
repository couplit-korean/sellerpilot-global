import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import {
  latestMarginScenarioLimit,
  recentMarginScenarioLimit,
  resolveMarginScenarioRows,
} from "../../../../../../lib/margin-scenario-data";

export const runtime = "nodejs";

const productIdSchema = z.string().uuid();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const productId = productIdSchema.safeParse((await context.params).id);
  if (!productId.success) {
    return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const [recentResult, latestResult] = await Promise.all([
    admin.userClient.rpc("sellerpilot_list_margin_scenarios", { p_limit: recentMarginScenarioLimit }),
    admin.userClient.rpc("sellerpilot_list_latest_margin_scenarios", {
      p_product_id: productId.data,
      p_limit: latestMarginScenarioLimit,
    }),
  ]);
  const resolved = resolveMarginScenarioRows({
    recentData: recentResult.data,
    recentError: recentResult.error,
    latestData: latestResult.data,
    latestError: latestResult.error,
  });
  const productScenarios = resolved.rows.filter((scenario) => scenario.productId === productId.data);

  return NextResponse.json({
    scenarios: productScenarios,
    state: resolved.state,
    coverage: resolved.coverage,
    message: resolved.message,
  }, {
    status: resolved.state === "unavailable" ? 503 : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
