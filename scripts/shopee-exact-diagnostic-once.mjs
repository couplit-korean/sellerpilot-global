import { execFileSync } from "node:child_process";
import {
  SHOPEE_EXACT_DIAGNOSTIC_JOB_ID,
  SHOPEE_EXACT_DIAGNOSTIC_SHOP_ID,
} from "../lib/channels/shopee-exact-diagnostic-identity.ts";
import { assertShopeeShopProfileTarget } from "../lib/channels/provider-account-identity.ts";
import { shopeeRequest, textValue } from "../lib/channels/protocols.ts";

// Claims only through sellerpilot_claim_exact_shopee_diagnostic_job.
const sellerpilotUrl = (process.env.SELLERPILOT_URL ?? "https://sellerpilot-global.vercel.app").replace(/\/$/, "");
const jobId = SHOPEE_EXACT_DIAGNOSTIC_JOB_ID;
const shopId = SHOPEE_EXACT_DIAGNOSTIC_SHOP_ID;

function loadGatewayWorkerToken() {
  const environmentToken = process.env.SELLERPILOT_GATEWAY_WORKER_TOKEN?.trim();
  if (environmentToken) return environmentToken;
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync("/usr/bin/security", [
      "find-generic-password",
      "-s", "SellerPilot Gateway Worker",
      "-a", sellerpilotUrl,
      "-w",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function projectShopPayload(payload) {
  const targets = Array.isArray(payload?.shopee_targets) ? payload.shopee_targets : [];
  const target = targets.find((candidate) => candidate?.type === "shop"
    && String(candidate?.id ?? "") === shopId);
  const projected = target
    ? {
      ...payload,
      shop_id: String(target.id),
      access_token: target.access_token,
      refresh_token: target.refresh_token,
      access_token_expires_at: target.access_token_expires_at,
      refresh_token_expires_at: target.refresh_token_expires_at,
    }
    : payload;
  if (String(projected?.shop_id ?? "") !== shopId) {
    throw new Error("SHOPEE_EXACT_DIAGNOSTIC_SHOP_MISMATCH");
  }
  const accessToken = typeof projected?.access_token === "string" ? projected.access_token.trim() : "";
  const expiresAt = Date.parse(String(projected?.access_token_expires_at ?? ""));
  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
    throw new Error("SHOPEE_ACCESS_TOKEN_REFRESH_REFUSED");
  }
  return projected;
}

async function workerFetch(path, init = {}, timeoutMs = 45_000) {
  const token = loadGatewayWorkerToken();
  if (!token.startsWith("spw_") || token.length < 24) {
    throw new Error("SELLERPILOT_GATEWAY_WORKER_TOKEN_MISSING");
  }
  return fetch(`${sellerpilotUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function completeJob(claimToken, body) {
  const response = await workerFetch("/api/channel-gateway/worker/complete", {
    method: "POST",
    body: JSON.stringify({
      jobId,
      claimToken,
      ...body,
    }),
  });
  if (!response.ok) {
    throw new Error(`exact Shopee diagnostic complete failed · HTTP ${response.status}`);
  }
}

const claimResponse = await workerFetch(
  "/api/channel-gateway/worker/shopee-exact-diagnostic/claim",
  {
    method: "POST",
    body: JSON.stringify({
      version: "sellerpilot-shopee-exact-diagnostic/1",
      jobId,
    }),
  },
);

if (claimResponse.status === 404) {
  throw new Error(
    "EXACT_SHOPEE_DIAGNOSTIC_CLAIM_ROUTE_MISSING: production does not expose the fail-closed Shopee diagnostic claimant.",
  );
}
if (claimResponse.status === 204) {
  console.log(`exact Shopee diagnostic ${jobId} was not claimable`);
  process.exit(0);
}
if (!claimResponse.ok) {
  throw new Error(`exact Shopee diagnostic claim failed · HTTP ${claimResponse.status}`);
}

const claimed = await claimResponse.json();
if (claimed?.id !== jobId || claimed?.channel !== "shopee" || claimed?.operation !== "diagnostic.test") {
  throw new Error("EXACT_SHOPEE_DIAGNOSTIC_CLAIM_MISMATCH");
}

const claimToken = claimed.claim_token;
try {
  const payload = projectShopPayload(claimed.credential);
  const remote = await shopeeRequest({
    payload,
    environment: claimed.environment === "sandbox" ? "sandbox" : "production",
    method: "GET",
    path: "/api/v2/shop/get_shop_info",
  });
  const errorCode = textValue(remote.data, "error");
  const ok = remote.response.ok && !errorCode;
  if (!ok) {
    throw new Error(`Shopee get_shop_info failed${errorCode ? ` · ${errorCode}` : ` · HTTP ${remote.response.status}`}`);
  }
  assertShopeeShopProfileTarget(remote.data, shopId, { acceptSignedRequestBinding: true });
  const diagnostic = {
    status: "passed",
    message: "Shopee 판매점 정보 읽기 API가 정상 응답했습니다.",
    ...(textValue(remote.data, "request_id")
      ? { remoteRequestId: textValue(remote.data, "request_id").slice(0, 160) }
      : {}),
  };
  await completeJob(claimToken, {
    status: "succeeded",
    result: {
      ok: true,
      channel: "shopee",
      operation: "diagnostic.test",
      diagnostic,
      safeMessage: diagnostic.message,
    },
  });
  console.log(JSON.stringify({
    ok: true,
    jobId,
    shopId,
    diagnostic: diagnostic.message,
  }));
} catch (error) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "exact Shopee diagnostic failed";
  await completeJob(claimToken, {
    status: "failed",
    error: message,
  }).catch(() => {});
  throw error;
}
