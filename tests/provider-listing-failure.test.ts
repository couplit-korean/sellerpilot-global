import assert from "node:assert/strict";
import test from "node:test";
import {
  annotateProviderListingFailureStep,
  normalizeProviderListingFailure,
  providerListingFailureStepData,
  type ProviderListingFailureChannel,
} from "../lib/channels/provider-listing-failure";
import { step, type ChannelOperationStep } from "../lib/channels/operation-step";
import { result } from "../lib/product-registration/execution-shared";
import type { RemoteResponse } from "../lib/channels/protocols";

// Synthetic provider responses only. No live Lazada/Naver call is made and no
// provider credential is read.
const SECRET_ACCESS_TOKEN = "SP-SYNTHETIC-ACCESS-TOKEN-9f1c";
const SECRET_APP_SECRET = "SP-SYNTHETIC-APP-SECRET-4d2a";

function remote(status: number, data: Record<string, unknown>): RemoteResponse {
  return {
    response: new Response(JSON.stringify(data), { status }),
    data,
    text: JSON.stringify(data),
  };
}

function failingStep(
  channel: ProviderListingFailureChannel,
  operation: "listing.create" | "listing.update",
  status: number,
  data: Record<string, unknown>,
) {
  return annotateProviderListingFailureStep(step("provider-write", remote(status, data)), {
    channel,
    operation,
  });
}

test("Lazada 401 with a provider auth code maps to the auth rejection code", () => {
  const failure = normalizeProviderListingFailure({
    channel: "lazada",
    operation: "listing.create",
    status: 401,
    data: {
      code: "IllegalAccessToken",
      type: "ISP",
      message: `Access token is invalid for token=${SECRET_ACCESS_TOKEN}`,
      request_id: "0ba1c2d3",
    },
  });

  assert.equal(failure.classification, "auth_rejected");
  assert.equal(failure.code, "LAZADA_LISTING_AUTH_REJECTED");
  assert.equal(failure.providerStatus, 401);
  assert.equal(failure.providerCode, "IllegalAccessToken");
  assert.match(failure.message, /HTTP 401/);
  assert.match(failure.message, /IllegalAccessToken/);
  assert.match(failure.message, /인증 거부/);
});

test("Smartstore 401 maps to its own auth rejection code", () => {
  const failure = normalizeProviderListingFailure({
    channel: "smartstore",
    operation: "listing.create",
    status: 401,
    data: { code: "GW.AUTHN", message: "Authentication failed." },
  });

  assert.equal(failure.classification, "auth_rejected");
  assert.equal(failure.code, "SMARTSTORE_LISTING_AUTH_REJECTED");
  assert.match(failure.message, /스마트스토어/);
  assert.match(failure.message, /HTTP 401/);
});

test("Smartstore auth code beats a 400 transport status", () => {
  const failure = normalizeProviderListingFailure({
    channel: "smartstore",
    operation: "listing.update",
    status: 400,
    data: { code: "GW.AUTHN", message: "Authentication token is not valid." },
  });

  assert.equal(failure.classification, "auth_rejected");
  assert.equal(failure.code, "SMARTSTORE_LISTING_AUTH_REJECTED");
});

test("403 maps to permission denied for both channels", () => {
  const lazada = normalizeProviderListingFailure({
    channel: "lazada",
    operation: "listing.create",
    status: 403,
    data: { code: "NoPermission", message: "Seller is not authorized for this category." },
  });
  const smartstore = normalizeProviderListingFailure({
    channel: "smartstore",
    operation: "listing.update",
    status: 403,
    data: {},
  });

  assert.equal(lazada.code, "LAZADA_LISTING_PERMISSION_DENIED");
  assert.equal(lazada.classification, "permission_denied");
  assert.equal(smartstore.code, "SMARTSTORE_LISTING_PERMISSION_DENIED");
  assert.match(smartstore.message, /HTTP 403/);
});

test("429 maps to a rate limit code even with an empty error body", () => {
  const lazada = normalizeProviderListingFailure({
    channel: "lazada",
    operation: "listing.create",
    status: 429,
    data: {},
  });
  const smartstore = normalizeProviderListingFailure({
    channel: "smartstore",
    operation: "listing.create",
    status: 429,
    data: {},
  });

  assert.equal(lazada.code, "LAZADA_LISTING_RATE_LIMITED");
  assert.equal(smartstore.code, "SMARTSTORE_LISTING_RATE_LIMITED");
  assert.match(lazada.message, /호출 한도/);
  assert.match(smartstore.message, /HTTP 429/);
});

test("rate limit hints in the provider body are classified without a 429 status", () => {
  const failure = normalizeProviderListingFailure({
    channel: "lazada",
    operation: "listing.create",
    status: 200,
    data: { code: "ApiCallLimit", message: "Api access frequency exceeds the limit." },
  });

  assert.equal(failure.classification, "rate_limited");
  assert.equal(failure.code, "LAZADA_LISTING_RATE_LIMITED");
});

test("400 and 422 map to a validation rejection", () => {
  for (const status of [400, 422]) {
    const failure = normalizeProviderListingFailure({
      channel: "smartstore",
      operation: "listing.create",
      status,
      data: { code: "GW.VALIDATION", message: "Invalid request." },
    });
    assert.equal(failure.code, "SMARTSTORE_LISTING_VALIDATION_REJECTED");
    assert.equal(failure.classification, "validation_rejected");
  }
});

test("409 maps to a conflict", () => {
  const failure = normalizeProviderListingFailure({
    channel: "lazada",
    operation: "listing.update",
    status: 409,
    data: { code: "E409", message: "Product already exists." },
  });

  assert.equal(failure.code, "LAZADA_LISTING_CONFLICT");
  assert.match(failure.message, /이미 존재합니다/);
});

test("5xx maps to provider unavailable", () => {
  for (const status of [500, 503]) {
    const failure = normalizeProviderListingFailure({
      channel: "smartstore",
      operation: "listing.update",
      status,
      data: {},
    });
    assert.equal(failure.code, "SMARTSTORE_LISTING_PROVIDER_UNAVAILABLE");
    assert.match(failure.message, new RegExp(`HTTP ${status}`));
  }
});

test("an unclassifiable failure falls back to a generic code carrying the provider status", () => {
  const failure = normalizeProviderListingFailure({
    channel: "lazada",
    operation: "listing.create",
    status: 418,
    data: { code: "E418" },
  });

  assert.equal(failure.classification, "unclassified");
  assert.equal(failure.code, "LAZADA_LISTING_PROVIDER_ERROR_HTTP_418");
  assert.match(failure.message, /HTTP 418/);
  assert.match(failure.message, /E418/);
});

test("a missing provider status falls back to HTTP_UNKNOWN instead of inventing a class", () => {
  const failure = normalizeProviderListingFailure({
    channel: "smartstore",
    operation: "listing.create",
    status: undefined,
    data: {},
  });

  assert.equal(failure.classification, "unclassified");
  assert.equal(failure.code, "SMARTSTORE_LISTING_PROVIDER_ERROR_HTTP_UNKNOWN");
  assert.equal(failure.providerStatus, 0);
});

test("the normalized reason never leaks secrets, raw payloads, or provider prose", () => {
  const failure = normalizeProviderListingFailure({
    channel: "smartstore",
    operation: "listing.create",
    status: 400,
    data: {
      code: "GW.VALIDATION",
      message: `Request rejected token=${SECRET_ACCESS_TOKEN}`,
      error_description: `app_secret=${SECRET_APP_SECRET} secret=abc`,
      access_token: SECRET_ACCESS_TOKEN,
      app_secret: SECRET_APP_SECRET,
      authorization: `Bearer ${SECRET_ACCESS_TOKEN}`,
      originProduct: { detailContent: "RAW-BODY-MARKER" },
      timestamp: "2026-09-12T00:00:00.000+09:00",
    },
  });

  const serialized = JSON.stringify(failure);
  assert.doesNotMatch(serialized, /SP-SYNTHETIC/u);
  assert.doesNotMatch(serialized, /RAW-BODY-MARKER/u);
  assert.doesNotMatch(serialized, /Bearer/u);
  assert.doesNotMatch(serialized, /Request rejected/u);
  assert.doesNotMatch(serialized, /app_secret/u);
  assert.doesNotMatch(serialized, /https?:\/\//u);
  assert.equal(failure.providerCode, "GW.VALIDATION");
});

test("a code-shaped value that is really a secret assignment is discarded", () => {
  const failure = normalizeProviderListingFailure({
    channel: "lazada",
    operation: "listing.create",
    status: 401,
    data: { code: `token=${SECRET_ACCESS_TOKEN}` },
  });

  assert.equal(failure.providerCode, "");
  assert.doesNotMatch(failure.message, /SP-SYNTHETIC/u);
});

test("the step annotation uses the existing sellerpilotVerification surface and keeps the payload out", () => {
  const annotated = failingStep("lazada", "listing.create", 401, {
    code: "IllegalAccessToken",
    message: `Access token is invalid token=${SECRET_ACCESS_TOKEN}`,
  });
  const annotation = providerListingFailureStepData(normalizeProviderListingFailure({
    channel: "lazada",
    operation: "listing.create",
    status: 401,
    data: {},
  }));

  assert.equal(annotated.ok, false);
  assert.equal(annotated.data.sellerpilotVerification, "LAZADA_LISTING_AUTH_REJECTED");
  assert.match(String(annotated.data.sellerpilotVerificationMessage), /HTTP 401/);
  assert.deepEqual(
    annotated.data.sellerpilotProviderFailure,
    {
      channel: "lazada",
      operation: "listing.create",
      classification: "auth_rejected",
      providerStatus: 401,
      providerCode: "IllegalAccessToken",
    },
  );
  assert.doesNotMatch(JSON.stringify(annotation), /SP-SYNTHETIC/u);
  // The original provider payload keys are preserved, not replaced.
  assert.equal(annotated.data.code, "IllegalAccessToken");
});

test("a successful provider step is returned unchanged", () => {
  const successful: ChannelOperationStep = step("product-create", remote(200, { code: "0" }));
  const annotated = annotateProviderListingFailureStep(successful, {
    channel: "smartstore",
    operation: "listing.create",
  });

  assert.equal(annotated, successful);
  assert.equal(annotated.data.sellerpilotVerification, undefined);
  assert.equal(annotated.data.sellerpilotVerificationMessage, undefined);
});

test("the normalized reason reaches the operation result safeMessage for reporting", () => {
  const cases = [
    {
      channel: "lazada" as const,
      operation: "listing.create" as const,
      status: 401,
      data: { code: "IllegalAccessToken", message: `Access token is invalid token=${SECRET_ACCESS_TOKEN}` },
      code: "LAZADA_LISTING_AUTH_REJECTED",
    },
    {
      channel: "smartstore" as const,
      operation: "listing.update" as const,
      status: 429,
      data: {},
      code: "SMARTSTORE_LISTING_RATE_LIMITED",
    },
  ];

  for (const item of cases) {
    const annotated = failingStep(item.channel, item.operation, item.status, item.data);
    const operationResult = result(
      {
        channel: item.channel,
        operation: item.operation,
        payload: {},
        arguments: {},
        environment: "production",
      },
      [annotated],
      item.channel === "lazada" ? "1234567890" : "9876543210",
    );

    assert.equal(operationResult.ok, false);
    assert.match(operationResult.safeMessage, new RegExp(item.code, "u"));
    assert.doesNotMatch(operationResult.safeMessage, /SP-SYNTHETIC/u);
  }
});
