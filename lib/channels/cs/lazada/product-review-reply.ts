import { createHash } from "node:crypto";
import { z } from "zod";
import { lazadaRequest, type SecretPayload } from "../../protocols";
import { replyAcceptanceMarker } from "../../reply-verification";
import {
  normalizeLazadaProviderAccountIdentity,
  readProviderAccountIdentity,
} from "../../provider-account-identity";
import type { ChannelOperationStep } from "../../operation-step";

const countrySchema = z.enum(["SG", "MY", "TH", "VN", "ID", "PH"]);
const reviewIdSchema = z.string().regex(/^[1-9][0-9]{0,31}$/u);
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const lazadaProductReviewReplyArgumentsSchema = z.object({
  kind: z.enum(["product_review", "product_review_readback"]),
  deliveryId: z.string().uuid(),
  country: countrySchema,
  sellerAccountKey: fingerprintSchema,
  reviewId: reviewIdSchema,
  generation: z.number().int().min(1),
  identityFingerprint: fingerprintSchema,
  reply: z.string().trim().min(1).max(500),
}).strict();

export type LazadaProductReviewReplyArguments = z.infer<typeof lazadaProductReviewReplyArgumentsSchema>;

type Request = typeof lazadaRequest;

type ReviewReadback = {
  state: "verified" | "not_observed" | "conflict" | "outdated";
  observedReply: string | null;
};

function errorData(error: unknown) {
  const message = error instanceof Error ? error.message : "LAZADA_PRODUCT_REVIEW_TRANSPORT_UNKNOWN";
  return { code: message.slice(0, 160) };
}

function responseOk(remote: Awaited<ReturnType<Request>>) {
  const success = remote.data.success;
  const data = remote.data.data;
  return remote.response.ok
    && String(remote.data.code ?? "0") === "0"
    && (success === true || success === "true")
    && (data === true || data === "true");
}

function readback(remote: Awaited<ReturnType<Request>>, expected: LazadaProductReviewReplyArguments): ReviewReadback {
  if (!remote.response.ok || String(remote.data.code ?? "0") !== "0"
      || ![true, "true"].includes(remote.data.success as true | "true")) {
    throw new Error("LAZADA_PRODUCT_REVIEW_READBACK_PROVIDER_FAILURE");
  }
  const data = remote.data.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("LAZADA_PRODUCT_REVIEW_READBACK_INVALID");
  }
  const envelope = data as Record<string, unknown>;
  if (!Array.isArray(envelope.review_list) || envelope.review_list.length > 10
      || !Array.isArray(envelope.outdated_reviews) || envelope.outdated_reviews.length > 10) {
    throw new Error("LAZADA_PRODUCT_REVIEW_READBACK_INVALID");
  }
  if (envelope.outdated_reviews.some((value) => String(value) === expected.reviewId)) {
    return { state: "outdated", observedReply: null };
  }
  const matches = envelope.review_list.filter((value) => value && typeof value === "object"
    && !Array.isArray(value) && String((value as Record<string, unknown>).id ?? "") === expected.reviewId);
  if (matches.length > 1) throw new Error("LAZADA_PRODUCT_REVIEW_READBACK_AMBIGUOUS");
  if (!matches.length) return { state: "not_observed", observedReply: null };
  const row = matches[0] as Record<string, unknown>;
  if (row.review_type !== "PRODUCT_REVIEW") throw new Error("LAZADA_PRODUCT_REVIEW_TYPE_INVALID");
  const observed = typeof row.seller_reply === "string" ? row.seller_reply : "";
  if (!observed) return { state: "not_observed", observedReply: null };
  return observed === expected.reply
    ? { state: "verified", observedReply: observed }
    : { state: "conflict", observedReply: observed };
}

function assertCredentialBinding(payload: SecretPayload, expected: LazadaProductReviewReplyArguments) {
  const declaredCountry = typeof payload.country === "string" ? payload.country.trim().toUpperCase() : "";
  if (declaredCountry && declaredCountry !== expected.country) {
    throw new Error("LAZADA_PRODUCT_REVIEW_CREDENTIAL_COUNTRY_MISMATCH");
  }
  const storedIdentity = readProviderAccountIdentity(payload, "lazada");
  const normalized = normalizeLazadaProviderAccountIdentity(payload);
  if (!storedIdentity || storedIdentity.subject !== normalized.identity.subject
      || !normalized.countryUserInfo.some((store) => store.country.toUpperCase() === expected.country)) {
    throw new Error("LAZADA_PRODUCT_REVIEW_CREDENTIAL_ACCOUNT_MISMATCH");
  }
  const accountKey = createHash("sha256")
    .update(["lazada", "production", storedIdentity.subject].join("\u001f"), "utf8")
    .digest("hex");
  if (accountKey !== expected.sellerAccountKey) {
    throw new Error("LAZADA_PRODUCT_REVIEW_CREDENTIAL_ACCOUNT_MISMATCH");
  }
}

/**
 * Executes one official review reply and immediately verifies the exact text with
 * GetReviewListByIdList. A lost reply response transitions to the GET readback;
 * this function never retries SubmitSellerReply.
 */
export async function executeLazadaProductReviewReply(
  payload: SecretPayload,
  rawArguments: unknown,
  request: Request = lazadaRequest,
): Promise<{ steps: ChannelOperationStep[]; remoteId: string }> {
  const expected = lazadaProductReviewReplyArgumentsSchema.parse(rawArguments);
  assertCredentialBinding(payload, expected);

  let sendAccepted = expected.kind === "product_review_readback";
  let sendError: unknown = null;
  if (expected.kind === "product_review") {
    try {
      const sent = await request({
        payload: { ...payload, country: expected.country.toLowerCase() },
        path: "/review/seller/reply/add",
        method: "GET",
        params: { id: expected.reviewId, content: expected.reply },
      });
      sendAccepted = responseOk(sent);
      if (!sendAccepted) sendError = new Error(String(sent.data.error_msg ?? sent.data.error_code ?? "LAZADA_PRODUCT_REVIEW_REPLY_REJECTED"));
    } catch (error) {
      sendError = error;
    }
  }

  let observed: ReviewReadback;
  try {
    const remote = await request({
      payload: { ...payload, country: expected.country.toLowerCase() },
      path: "/review/seller/list/v2",
      method: "GET",
      params: { id_list: JSON.stringify([expected.reviewId]) },
    });
    observed = readback(remote, expected);
  } catch (error) {
    return {
      steps: [{
        name: "product-review-reply-readback",
        ok: false,
        status: 503,
        data: {
          ...errorData(error),
          sendAccepted,
          responseLost: Boolean(sendError),
          automaticResendAllowed: false,
          deliveryId: expected.deliveryId,
          generation: expected.generation,
          identityFingerprint: expected.identityFingerprint,
        },
      }],
      remoteId: expected.reviewId,
    };
  }

  const verified = observed.state === "verified";
  return {
    steps: [{
      name: "product-review-reply-readback",
      ok: verified,
      status: verified ? 200 : 409,
      data: {
        ...(verified ? {
          sellerpilotReplyAcceptance: replyAcceptanceMarker("lazada", "product_review", {
            deliveryId: expected.deliveryId,
            country: expected.country,
            reviewId: expected.reviewId,
            generation: expected.generation,
            identityFingerprint: expected.identityFingerprint,
          }),
        } : {}),
        sellerpilotLazadaProductReviewReadback: {
          contract: "sellerpilot-lazada-product-review-reply-readback/1",
          deliveryId: expected.deliveryId,
          country: expected.country,
          reviewId: expected.reviewId,
          generation: expected.generation,
          identityFingerprint: expected.identityFingerprint,
          state: observed.state,
          exactReplyObserved: verified,
          automaticResendAllowed: false,
        },
        sendAttempted: expected.kind === "product_review",
        sendAccepted,
        responseLost: Boolean(sendError),
        ...(sendError ? { sendFailure: errorData(sendError).code } : {}),
      },
    }],
    remoteId: expected.reviewId,
  };
}
