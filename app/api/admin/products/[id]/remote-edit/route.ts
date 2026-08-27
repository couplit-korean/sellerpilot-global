import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { activeChannelKeys, type ActiveChannelKey } from "../../../../../../lib/channels/catalog";
import {
  centralProductEditFieldSupport,
  channelProductEditFieldSupport,
  listingUpdateMutablePaths,
  listingUpdateRemoteIdentity,
  listingWriteOperation,
  prepareListingUpdateArguments,
  remoteProductEditIdempotencyKey,
} from "../../../../../../lib/channels/listing-update";
import { channelOperationRelease } from "../../../../../../lib/channels/operation-availability";

export const runtime = "nodejs";
export const maxDuration = 120;

const productIdSchema = z.string().uuid();
const remoteEditSchema = z.object({
  credentialId: z.string().uuid(),
  listingId: z.string().uuid(),
  mutationId: z.string().uuid(),
  // This endpoint is deliberately limited to the content mapper below.
  // Price, option, and sale-configuration writes require separate provider
  // identities and readback contracts and must not fall through as content.
  operation: z.literal("listing.update"),
  confirmWrite: z.literal(true),
  arguments: z.record(z.string(), z.unknown())
    .refine((value) => JSON.stringify(value).length <= 128_000, "payload too large"),
});

type ListingRecord = Record<string, unknown> & {
  id: string;
  channel: ActiveChannelKey;
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function listingRecords(value: unknown): ListingRecord[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const listing = recordValue(item);
      const id = typeof listing.id === "string" ? listing.id : "";
      const channel = typeof listing.channel === "string" && activeChannelKeys.includes(listing.channel as ActiveChannelKey)
        ? listing.channel as ActiveChannelKey
        : null;
      return id && channel ? [{ ...listing, id, channel }] : [];
    })
    : [];
}

function listingReference(listing: ListingRecord) {
  return {
    status: typeof listing.status === "string" ? listing.status : "",
    remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
    publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
  };
}

function listingExecutionBlock(listing: ListingRecord) {
  const status = typeof listing.status === "string" ? listing.status : "";
  const failureClass = typeof listing.failureClass === "string" ? listing.failureClass : "";
  if (status === "queued" || status === "publishing") {
    return {
      status: 202,
      mode: "listing_update_in_progress",
      message: "이 상품·채널의 기존 원격 작업이 진행 중이므로 새 쓰기를 실행하지 않았습니다.",
    };
  }
  if (failureClass === "external_action") {
    return {
      status: 409,
      mode: "external_reconciliation_required",
      message: "이전 원격 작업 결과를 판매자센터에서 확인하기 전에는 새 상품 수정을 실행할 수 없습니다.",
    };
  }
  if (status !== "published" && status !== "failed") {
    return {
      status: 409,
      mode: "published_listing_required",
      message: "현재 게시 중이거나 게시 후 재시도 가능한 상품만 원격 수정할 수 있습니다.",
    };
  }
  if (listingWriteOperation(listingReference(listing)) !== "listing.update") {
    return {
      status: 409,
      mode: "published_remote_identity_required",
      message: "게시 원장의 원격 상품 ID와 최초 게시 시각이 확인되지 않아 수정을 차단했습니다.",
    };
  }
  return null;
}

function listingAvailability(listing: ListingRecord) {
  const release = channelOperationRelease(listing.channel, "listing.update");
  const executionBlock = listingExecutionBlock(listing);
  return {
    listingId: listing.id,
    channel: listing.channel,
    market: typeof listing.market === "string" ? listing.market : "",
    targetId: typeof listing.targetId === "string" ? listing.targetId : "",
    status: typeof listing.status === "string" ? listing.status : "",
    remoteIdPresent: Boolean(listingReference(listing).remoteId?.trim()),
    runnable: release.available && executionBlock === null,
    mode: release.available ? executionBlock?.mode ?? release.mode : release.mode,
    reason: release.available ? executionBlock?.message ?? release.reason : release.reason,
    fields: channelProductEditFieldSupport(listing.channel),
  };
}

async function productContext(request: Request, productId: string) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return { response: admin } as const;
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_product_publish_context", {
    p_product_id: productId,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return {
      response: NextResponse.json({ message: "상품 게시 원장을 불러오지 못했습니다." }, { status: error ? 503 : 404 }),
    } as const;
  }
  return { admin, context: data as Record<string, unknown> } as const;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const productId = productIdSchema.safeParse((await context.params).id);
  if (!productId.success) return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400 });
  const loaded = await productContext(request, productId.data);
  if ("response" in loaded) return loaded.response;
  return NextResponse.json({
    productId: productId.data,
    centralFields: centralProductEditFieldSupport(),
    listings: listingRecords(loaded.context.listings).map(listingAvailability),
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const productId = productIdSchema.safeParse((await context.params).id);
  const body = remoteEditSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success || !body.success) {
    const message = !productId.success
      ? "상품 ID 형식이 올바르지 않습니다."
      : !body.success
        ? body.error.issues[0]?.message ?? "원격 상품 수정 요청값을 확인해 주세요."
        : "원격 상품 수정 요청값을 확인해 주세요.";
    return NextResponse.json({
      message,
    }, { status: 400 });
  }

  const loaded = await productContext(request, productId.data);
  if ("response" in loaded) return loaded.response;
  const listing = listingRecords(loaded.context.listings).find((item) => item.id === body.data.listingId);
  if (!listing) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "listing_identity_mismatch",
      message: "요청한 상품 게시 원장이 이 중앙 상품에 속하지 않아 수정을 차단했습니다.",
    }, { status: 409 });
  }

  const release = channelOperationRelease(listing.channel, body.data.operation);
  if (!release.available) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: release.mode,
      message: release.reason,
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const executionBlock = listingExecutionBlock(listing);
  if (executionBlock) {
    return NextResponse.json({
      ok: false,
      status: executionBlock.status === 202 ? "in_progress" : "blocked",
      inProgress: executionBlock.status === 202,
      mode: executionBlock.mode,
      message: executionBlock.message,
    }, { status: executionBlock.status, headers: { "cache-control": "no-store, max-age=0" } });
  }

  let argumentsValue: Record<string, unknown>;
  try {
    argumentsValue = prepareListingUpdateArguments(listing.channel, body.data.arguments, listingReference(listing));
    if (listingUpdateRemoteIdentity(listing.channel, argumentsValue) !== listingReference(listing).remoteId) {
      throw new Error("LISTING_UPDATE_IDENTITY_MISMATCH");
    }
  } catch {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "published_remote_identity_required",
      message: "게시 원장의 원격 상품 ID로 안전한 수정 요청을 만들지 못했습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const mutablePaths = listingUpdateMutablePaths(listing.channel, argumentsValue);
  if (!mutablePaths.length) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "mutable_content_required",
      message: "이 채널에서 수정 가능한 상품명·설명·필수정보·이미지 값이 요청에 없습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const currency = typeof listing.currency === "string" ? listing.currency.trim().toUpperCase() : "";
  const price = typeof listing.price === "number" || typeof listing.price === "string"
    ? Number(listing.price)
    : Number.NaN;
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(price) || price < 0) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "listing_commerce_values_required",
      message: "게시 원장에 저장된 통화·가격을 확인하지 못해 임의 값으로 상품 원장을 갱신하지 않았습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const idempotencyKey = remoteProductEditIdempotencyKey({
    productId: productId.data,
    listingId: listing.id,
    mutationId: body.data.mutationId,
  });
  const operationRequest = {
    credentialId: body.data.credentialId,
    channel: listing.channel,
    operation: "listing.update" as const,
    idempotencyKey,
    confirmWrite: true,
    productId: productId.data,
    resourceListingId: listing.id,
    currency,
    price,
    market: typeof listing.market === "string" ? listing.market : "",
    targetId: typeof listing.targetId === "string" ? listing.targetId : "",
    arguments: argumentsValue,
  };

  try {
    const response = await fetch(new URL("/api/admin/channel-operations", request.url), {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(operationRequest),
      cache: "no-store",
      signal: AbortSignal.timeout(58_000),
    });
    const responseText = await response.text();
    return new NextResponse(responseText, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json({
      ok: false,
      status: "in_progress",
      inProgress: true,
      retrySafe: true,
      idempotencyKey,
      message: "원격 수정 응답 대기시간을 넘겼습니다. 같은 mutationId로 다시 확인하면 동일 작업을 재사용하며 새 원격 쓰기를 만들지 않습니다.",
    }, { status: 202, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
