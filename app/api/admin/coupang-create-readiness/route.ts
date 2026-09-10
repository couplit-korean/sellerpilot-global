import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { bindCoupangCreateSourceIdentity } from "../../../../lib/channels/coupang-create-source-identity";
import {
  coupangRequest,
  runWithChannelRequestSignal,
  runWithProviderReadOnlyTransport,
} from "../../../../lib/channels/protocols";
import {
  buildCoupangCreateReadinessSource,
  coupangCreatePublishContextWithApprovedManifest,
} from "../../../../lib/product-registration/coupang/create-readiness-source";
import { productRegistrationSourceFingerprint } from "../../../../lib/product-registration/source-fingerprint";
import { externalDetailImportTarget } from "../../../../lib/server-external-detail-import-api";
import { readApprovedExternalDetailPublishContext } from "../../../../lib/server-external-detail-publish-context";
import {
  approvedProductDetailManifestFromPublishContext,
  marketplaceArgumentsForApprovedDetailFingerprint,
} from "../../../../lib/server-product-detail-manifest";

export const runtime = "nodejs";
export const maxDuration = 60;

const argumentSchema = z.record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 128_000, "payload too large");

const requestSchema = z.object({
  productId: z.string().uuid(),
  credentialId: z.string().uuid(),
  credentialVersion: z.number().int().positive().optional(),
  categoryId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
  sourceFingerprint: z.string().min(1).max(50_000),
  market: z.literal("KR").optional().default("KR"),
  targetId: z.string().trim().max(160).optional().default(""),
  arguments: argumentSchema.optional(),
  draft: argumentSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!value.arguments && !value.draft) {
    context.addIssue({ code: "custom", message: "arguments or draft is required" });
  }
  if (value.arguments && value.draft
    && JSON.stringify(value.arguments) !== JSON.stringify(value.draft)) {
    context.addIssue({ code: "custom", message: "arguments and draft differ" });
  }
});

type Row = Record<string, unknown>;
type ChoicePatch = {
  path: string[];
  value: string | number;
  source: "provider.outbound_shipping_places" | "provider.return_centers";
};

const noStoreHeaders = { "cache-control": "private, no-store, max-age=0" };
const writeEvidence = {
  providerWritePerformed: false,
  dbWritePerformed: false,
  jobCreated: false,
} as const;

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is Row => Boolean(row(candidate)))
    : [];
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function nestedRows(value: unknown): Row[] {
  let current: unknown = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (Array.isArray(current)) return rows(current);
    const currentRow = row(current);
    if (!currentRow) return [];
    if (Array.isArray(currentRow.content)) return rows(currentRow.content);
    if (!Object.hasOwn(currentRow, "data")) return [];
    current = currentRow.data;
  }
  return [];
}

function usable(value: unknown) {
  return value === true || value === 1
    || ["TRUE", "Y", "YES", "1"].includes(text(value).toUpperCase());
}

function preferredKoreanAddress(value: unknown): Row | null {
  const korean = rows(value).filter((candidate) =>
    text(candidate.countryCode).toUpperCase() === "KR");
  return korean.find((candidate) =>
    text(candidate.addressType).toUpperCase().includes("ROADNAME"))
    ?? korean.find((candidate) =>
      text(candidate.addressType).toUpperCase() === "JIBUN")
    ?? korean[0]
    ?? null;
}

function returnFee(center: Row): number | null {
  const amounts = new Set<number>();
  for (const key of [
    "returnFee02kg", "returnFee05kg", "returnFee10kg", "returnFee20kg",
    "vendorCreditFee02kg", "vendorCreditFee05kg",
    "vendorCashFee02kg", "vendorCashFee05kg",
  ]) {
    const value = Number(center[key]);
    if (Number.isFinite(value) && value > 0 && value <= 250_000) amounts.add(value);
  }
  return amounts.size === 1 ? [...amounts][0]! : null;
}

function sanitizedOutboundChoices(value: unknown) {
  return nestedRows(value).flatMap((candidate) => {
    const address = preferredKoreanAddress(candidate.placeAddresses);
    const code = text(candidate.outboundShippingPlaceCode);
    if (!usable(candidate.usable) || !address || !code) return [];
    return [{
      outboundShippingPlaceCode: code,
      shippingPlaceName: text(candidate.shippingPlaceName),
      address: text(address.returnAddress || address.address),
    }];
  });
}

function sanitizedReturnCenterChoices(value: unknown) {
  return nestedRows(value).flatMap((candidate) => {
    const address = preferredKoreanAddress(candidate.placeAddresses);
    const code = text(candidate.returnCenterCode);
    const deliveryCompanyCode = text(candidate.deliverCode).toUpperCase();
    const fee = returnFee(candidate);
    if (!usable(candidate.usable) || !address || !code
      || !deliveryCompanyCode || fee === null) return [];
    return [{
      returnCenterCode: code,
      shippingPlaceName: text(candidate.shippingPlaceName),
      deliveryCompanyCode,
      returnCharge: fee,
      returnChargeName: text(candidate.shippingPlaceName),
      companyContactNumber: text(address.companyContactNumber),
      returnZipCode: text(address.returnZipCode),
      returnAddress: text(address.returnAddress),
      returnAddressDetail: text(address.returnAddressDetail),
    }];
  });
}

function uniqueChoicePatches(
  outboundChoices: ReturnType<typeof sanitizedOutboundChoices>,
  returnCenterChoices: ReturnType<typeof sanitizedReturnCenterChoices>,
  body: Row,
): ChoicePatch[] {
  const patches: ChoicePatch[] = [];
  if (outboundChoices.length === 1 && !text(body.outboundShippingPlaceCode)) {
    patches.push({
      path: ["body", "outboundShippingPlaceCode"],
      value: outboundChoices[0]!.outboundShippingPlaceCode,
      source: "provider.outbound_shipping_places",
    });
  }
  if (returnCenterChoices.length !== 1) return patches;
  const selected = returnCenterChoices[0]!;
  const fields = [
    "returnCenterCode", "deliveryCompanyCode", "returnCharge",
    "returnChargeName", "companyContactNumber", "returnZipCode",
    "returnAddress", "returnAddressDetail",
  ] as const;
  for (const key of fields) {
    const existingComplete = key === "returnCharge"
      ? Number.isFinite(Number(body[key])) && Number(body[key]) > 0
      : Boolean(text(body[key]));
    if (existingComplete || !text(selected[key])) continue;
    patches.push({
      path: ["body", key],
      value: selected[key],
      source: "provider.return_centers",
    });
  }
  if (body.deliveryChargeOnReturn === null
    || body.deliveryChargeOnReturn === undefined) {
    patches.push({
      path: ["body", "deliveryChargeOnReturn"],
      value: text(body.deliveryChargeType).toUpperCase() === "FREE"
        ? selected.returnCharge : 0,
      source: "provider.return_centers",
    });
  }
  return patches;
}

function safeProviderFailure(error: unknown) {
  const source = error instanceof Error ? error.message.split(":")[0] : "";
  return /^COUPANG_[A-Z0-9_]+$/u.test(source)
    ? source
    : "COUPANG_CREATE_READINESS_PROVIDER_READ_FAILED";
}

function responseBody(input: {
  result: Awaited<ReturnType<typeof buildCoupangCreateReadinessSource>>;
  observedAt: string;
  observedTuple: Row;
  outboundRead: unknown;
  returnRead: unknown;
  body: Row;
  credentialRevision: Row;
}) {
  const outboundChoices = sanitizedOutboundChoices(input.outboundRead);
  const returnCenterChoices = sanitizedReturnCenterChoices(input.returnRead);
  return {
    contract: "sellerpilot_coupang_create_readiness_route_v1",
    observedAt: input.observedAt,
    observedTuple: input.observedTuple,
    status: input.result.status,
    ...(input.result.status === "not_ready"
      ? { reason: input.result.reason, stage: input.result.stage }
      : {}),
    completeness: input.result.completeness,
    autoFillPatches: uniqueChoicePatches(outboundChoices, returnCenterChoices, input.body),
    choices: { outboundShippingPlaces: outboundChoices, returnCenters: returnCenterChoices },
    credentialRevision: input.credentialRevision,
    attemptedReads: input.result.attemptedReads,
    ...writeEvidence,
  };
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      message: "쿠팡 신규상품 준비 조회 형식이 올바르지 않습니다.",
      ...writeEvidence,
    }, { status: 400, headers: noStoreHeaders });
  }
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;

  const sourceArguments = structuredClone(parsed.data.arguments ?? parsed.data.draft!);
  let publishContext: Row;
  try {
    if (parsed.data.productId === externalDetailImportTarget) {
      publishContext = await readApprovedExternalDetailPublishContext(
        admin, parsed.data.productId,
      );
    } else {
      const { data, error } = await admin.userClient.rpc(
        "sellerpilot_get_product_publish_context",
        { p_product_id: parsed.data.productId },
      );
      if (error || !row(data)) throw new Error("COUPANG_CREATE_READINESS_CONTEXT_UNAVAILABLE");
      publishContext = data as Row;
    }
  } catch {
    return NextResponse.json({
      message: "현재 상품의 승인된 게시 source를 확인하지 못했습니다.",
      ...writeEvidence,
    }, { status: 409, headers: noStoreHeaders });
  }

  if (row(publishContext.product)?.id !== parsed.data.productId
    || productRegistrationSourceFingerprint(publishContext) !== parsed.data.sourceFingerprint) {
    return NextResponse.json({
      message: "현재 상품 source가 화면에서 확인한 revision과 달라졌습니다.",
      code: "COUPANG_CREATE_READINESS_SOURCE_CHANGED",
      ...writeEvidence,
    }, { status: 409, headers: noStoreHeaders });
  }

  const approved = approvedProductDetailManifestFromPublishContext(publishContext);
  if (!approved.ok) {
    return NextResponse.json({
      message: "현재 승인 상세 이미지 8장의 manifest를 확인하지 못했습니다.",
      code: approved.code,
      ...writeEvidence,
    }, { status: 409, headers: noStoreHeaders });
  }
  const completenessPublishContext = coupangCreatePublishContextWithApprovedManifest(
    publishContext,
    approved.value,
  );

  let effectiveArguments: Row;
  try {
    effectiveArguments = bindCoupangCreateSourceIdentity(
      marketplaceArgumentsForApprovedDetailFingerprint(sourceArguments, approved.value),
      publishContext,
    );
  } catch {
    return NextResponse.json({
      message: "쿠팡 신규상품 SKU와 승인 이미지 source가 현재 상품과 일치하지 않습니다.",
      code: "COUPANG_CREATE_READINESS_SOURCE_INVALID",
      ...writeEvidence,
    }, { status: 409, headers: noStoreHeaders });
  }

  const body = row(effectiveArguments.body) ?? {};
  if (text(body.displayCategoryCode) !== parsed.data.categoryId) {
    return NextResponse.json({
      message: "화면에서 확인한 쿠팡 카테고리와 현재 draft가 일치하지 않습니다.",
      code: "COUPANG_CREATE_READINESS_CATEGORY_CHANGED",
      ...writeEvidence,
    }, { status: 409, headers: noStoreHeaders });
  }

  const { data: credentials, error: credentialsError } =
    await admin.userClient.rpc("sellerpilot_list_credentials");
  const activeCredentials = Array.isArray(credentials)
    ? credentials.filter((candidate) => {
      const value = row(candidate);
      return value?.id === parsed.data.credentialId
        && value.channel === "coupang"
        && value.environment === "production"
        && value.status === "active";
    })
    : [];
  const credentialMetadata = activeCredentials.length === 1
    ? activeCredentials[0] as Row
    : null;
  const credentialVersion = Number(credentialMetadata?.version);
  const credentialFingerprint = text(credentialMetadata?.fingerprint);
  const credentialExpiresAt = text(credentialMetadata?.expires_at);
  const credentialExpiry = credentialExpiresAt
    ? new Date(credentialExpiresAt).getTime()
    : Number.POSITIVE_INFINITY;
  if (credentialsError || !credentialMetadata
    || !Number.isSafeInteger(credentialVersion) || credentialVersion < 1
    || !credentialFingerprint
    || (credentialExpiresAt
      && (!Number.isFinite(credentialExpiry) || credentialExpiry <= Date.now()))
    || (parsed.data.credentialVersion !== undefined
      && parsed.data.credentialVersion !== credentialVersion)) {
    return NextResponse.json({
      message: "선택한 쿠팡 키가 현재 활성 운영 credential revision과 일치하지 않습니다.",
      code: "COUPANG_CREATE_READINESS_CREDENTIAL_CHANGED",
      ...writeEvidence,
    }, { status: 409, headers: noStoreHeaders });
  }

  const { data: credentialSecret, error: credentialSecretError } =
    await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
      p_credential_id: parsed.data.credentialId,
    });
  const secret = row(credentialSecret);
  if (credentialSecretError || !secret
    || !text(secret.access_key) || !text(secret.secret_key)
    || !text(secret.vendor_id) || !text(secret.requested_by)) {
    return NextResponse.json({
      message: "현재 쿠팡 credential의 API 키와 판매자 식별정보를 확인하지 못했습니다.",
      code: "COUPANG_CREATE_READINESS_CREDENTIAL_INVALID",
      ...writeEvidence,
    }, { status: 409, headers: noStoreHeaders });
  }

  const credentialRevision = {
    credentialId: parsed.data.credentialId,
    credentialVersion,
    credentialFingerprint,
    environment: "production",
    expiresAt: credentialExpiresAt || null,
    sellerIdentityReady: true,
  };
  const categoryCode = Number(parsed.data.categoryId);
  const observedAt = new Date().toISOString();
  const observedTuple = {
    productId: parsed.data.productId,
    credentialId: parsed.data.credentialId,
    credentialVersion,
    credentialFingerprint: credentialRevision.credentialFingerprint,
    environment: "production",
    market: parsed.data.market,
    targetId: parsed.data.targetId,
    categoryId: parsed.data.categoryId,
    sourceFingerprint: parsed.data.sourceFingerprint,
    requestSha256: createHash("sha256")
      .update(JSON.stringify({
        productId: parsed.data.productId,
        credentialId: parsed.data.credentialId,
        credentialVersion,
        categoryId: parsed.data.categoryId,
        sourceFingerprint: parsed.data.sourceFingerprint,
        market: parsed.data.market,
        targetId: parsed.data.targetId,
        arguments: effectiveArguments,
      }), "utf8")
      .digest("hex"),
  };

  let categoryMetadataRead: unknown;
  let categoryStatusRead: unknown;
  let outboundShippingPlacesRead: unknown;
  let returnCentersRead: unknown;
  try {
    const result = await runWithChannelRequestSignal(request.signal, () =>
      runWithProviderReadOnlyTransport(() =>
        buildCoupangCreateReadinessSource({
          source: effectiveArguments,
          body,
          publishContext: completenessPublishContext,
          environment: "production",
        }, {
          readCategoryMetadata: async () => {
            categoryMetadataRead = await coupangRequest({
              payload: secret,
              method: "GET",
              path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/${categoryCode}`,
            });
            return categoryMetadataRead;
          },
          readCategoryStatus: async () => {
            categoryStatusRead = await coupangRequest({
              payload: secret,
              method: "GET",
              path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/${categoryCode}/status`,
            });
            return categoryStatusRead;
          },
          readOutboundShippingPlaces: async () => {
            outboundShippingPlacesRead = await coupangRequest({
              payload: secret,
              method: "GET",
              path: "/v2/providers/marketplace_openapi/apis/api/v2/vendor/shipping-place/outbound",
              query: new URLSearchParams({
                placeCodes: text(body.outboundShippingPlaceCode),
              }),
            });
            return outboundShippingPlacesRead;
          },
          readReturnCenters: async () => {
            returnCentersRead = await coupangRequest({
              payload: secret,
              method: "GET",
              path: "/v2/providers/openapi/apis/api/v3/return/shipping-places/center-code",
              query: new URLSearchParams({
                returnCenterCodes: text(body.returnCenterCode),
              }),
            });
            return returnCentersRead;
          },
          readActiveCredentialRevision: async () => credentialRevision,
        })),
    );
    if (result.completeness.fields.length !== 19) {
      throw new Error("COUPANG_CREATE_READINESS_FIELD_COUNT_INVALID");
    }
    const status = result.status === "not_ready" && result.reason === "provider_read_failed"
      ? 503 : 200;
    return NextResponse.json(responseBody({
      result,
      observedAt,
      observedTuple,
      outboundRead: outboundShippingPlacesRead,
      returnRead: returnCentersRead,
      body,
      credentialRevision,
    }), { status, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({
      contract: "sellerpilot_coupang_create_readiness_route_v1",
      observedAt,
      observedTuple,
      message: "쿠팡 신규상품 준비에 필요한 현재 공식값을 조회하지 못했습니다.",
      code: safeProviderFailure(error),
      credentialRevision,
      choices: { outboundShippingPlaces: [], returnCenters: [] },
      autoFillPatches: [],
      ...writeEvidence,
    }, { status: 503, headers: noStoreHeaders });
  }
}
