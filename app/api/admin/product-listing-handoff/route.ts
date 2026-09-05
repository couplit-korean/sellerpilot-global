import { NextResponse } from "next/server";
import {
  LISTING_HANDOFF_GET_RPC,
  LISTING_HANDOFF_PUT_RPC,
  listingHandoffQuerySchema,
  listingHandoffRpcResult,
  listingHandoffSaveSchema,
} from "../../../../lib/channel-listing-handoff";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function rpcFailureStatus(code: string | undefined) {
  if (code === "42501") return 403;
  if (code === "22023" || code === "23514") return 400;
  return 503;
}

function rpcUnavailable(code: string | undefined) {
  return code === "PGRST202" || code === "42883" || code === "PGRST002";
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const url = new URL(request.url);
  const parsed = listingHandoffQuerySchema.safeParse({
    productId: url.searchParams.get("productId"),
    channel: url.searchParams.get("channel"),
    environment: url.searchParams.get("environment"),
    market: url.searchParams.get("market"),
  });
  if (!parsed.success) {
    return json({ message: "판매 정책 조회 형식이 올바르지 않습니다.", handoff: null }, 400);
  }

  const { data, error } = await admin.serviceClient.rpc(LISTING_HANDOFF_GET_RPC, {
    p_product_id: parsed.data.productId,
    p_channel: parsed.data.channel,
    p_environment: parsed.data.environment,
    p_market: parsed.data.market,
  });
  if (error) {
    if (rpcUnavailable(error.code)) {
      return json({ message: "판매 정책 저장소를 사용할 수 없습니다.", handoff: null }, 503);
    }
    return json(
      { message: "저장된 판매 정책을 불러오지 못했습니다.", handoff: null },
      rpcFailureStatus(error.code),
    );
  }

  try {
    const handoff = listingHandoffRpcResult(data);
    if (handoff && (
      handoff.productId !== parsed.data.productId
      || handoff.channel !== parsed.data.channel
      || handoff.environment !== parsed.data.environment
      || handoff.market !== parsed.data.market
    )) {
      return json({ message: "저장된 판매 정책의 상품·마켓이 일치하지 않습니다.", handoff: null }, 409);
    }
    return json({ handoff });
  } catch {
    return json({ message: "저장된 판매 정책 형식이 올바르지 않습니다.", handoff: null }, 503);
  }
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = listingHandoffSaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({
      message: parsed.error.issues[0]?.message ?? "판매 정책 저장 형식을 확인해 주세요.",
    }, 400);
  }

  const { data, error } = await admin.serviceClient.rpc(LISTING_HANDOFF_PUT_RPC, {
    p_product_id: parsed.data.productId,
    p_channel: parsed.data.channel,
    p_environment: parsed.data.environment,
    p_market: parsed.data.market,
    p_handoff: {
      marketplaceId: parsed.data.marketplaceId,
      fulfillmentPolicyId: parsed.data.fulfillmentPolicyId,
      paymentPolicyId: parsed.data.paymentPolicyId,
      returnPolicyId: parsed.data.returnPolicyId,
      merchantLocationKey: parsed.data.merchantLocationKey,
    },
  });
  if (error) {
    if (rpcUnavailable(error.code)) {
      return json({ message: "판매 정책 저장소를 사용할 수 없습니다." }, 503);
    }
    return json(
      { message: "판매 정책을 저장하지 못했습니다." },
      rpcFailureStatus(error.code),
    );
  }

  try {
    const handoff = listingHandoffRpcResult(data);
    if (!handoff) {
      return json({ message: "판매 정책을 저장할 상품을 확인하지 못했습니다." }, 409);
    }
    if (
      handoff.productId !== parsed.data.productId
      || handoff.channel !== parsed.data.channel
      || handoff.environment !== parsed.data.environment
      || handoff.market !== parsed.data.market
    ) {
      return json({ message: "저장된 판매 정책의 상품·마켓이 일치하지 않습니다." }, 409);
    }
    return json({ handoff });
  } catch {
    return json({ message: "저장된 판매 정책 형식이 올바르지 않습니다." }, 503);
  }
}
