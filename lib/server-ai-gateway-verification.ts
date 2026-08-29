import "server-only";
import { createHash } from "node:crypto";
import {
  aiGatewayRuntimeVerificationCookieName,
  readAiGatewayRuntimeVerification,
  sealAiGatewayRuntimeVerification,
  type AiGatewayRuntimeVerification,
} from "./ai-gateway-runtime-verification";

const WORKER_TOKEN_PATTERN = /^spw_[A-Za-z0-9_-]{43}$/;

function verificationSecret() {
  const token = process.env.SELLERPILOT_AI_WORKER_TOKEN?.trim() ?? "";
  return WORKER_TOKEN_PATTERN.test(token) ? token : "";
}

function deploymentIdentity() {
  return process.env.VERCEL_DEPLOYMENT_ID?.trim()
    || process.env.VERCEL_GIT_COMMIT_SHA?.trim()
    || process.env.VERCEL_URL?.trim()
    || "local-development";
}

function gatewayAuthenticationIdentity() {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim() ?? "";
  return apiKey
    ? `api-key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`
    : "vercel-oidc";
}

function verificationContext(adminUserId: string) {
  const workerTokenFingerprint = createHash("sha256")
    .update(verificationSecret())
    .digest("hex")
    .slice(0, 16);
  return [
    "sellerpilot-product-studio-gateway-v1",
    adminUserId,
    deploymentIdentity(),
    gatewayAuthenticationIdentity(),
    workerTokenFingerprint,
  ].join("|");
}

export function readServerAiGatewayVerification(
  request: Request,
  adminUserId: string,
): AiGatewayRuntimeVerification {
  return readAiGatewayRuntimeVerification(request.headers.get("cookie"), {
    secret: verificationSecret(),
    context: verificationContext(adminUserId),
  });
}

function clearVerificationCookie() {
  const attributes = [
    `${aiGatewayRuntimeVerificationCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

export function createServerAiGatewayVerificationCookie(
  result: { ok: boolean; code?: unknown },
  adminUserId: string,
) {
  const sealed = sealAiGatewayRuntimeVerification(result, {
    secret: verificationSecret(),
    context: verificationContext(adminUserId),
  });
  if (!sealed) return clearVerificationCookie();
  const attributes = [
    `${aiGatewayRuntimeVerificationCookieName}=${sealed.value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${sealed.maxAgeSeconds}`,
    `Expires=${new Date(sealed.expiresAt).toUTCString()}`,
  ];
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}
