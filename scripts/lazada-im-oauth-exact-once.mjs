// Explicit one-shot invocation only. The route/RPC is supplied by the integrated
// release. Authorization codes are never retried and output is status-only.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runLazadaImExactJob } from "../lib/channels/lazada-oauth-im-exact.ts";

function exactAttestation(releaseSha, egressIpSha256, workerVersion) {
  if (typeof releaseSha !== "string"
    || !/^[a-f0-9]{40}$/u.test(releaseSha)
    || typeof egressIpSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(egressIpSha256)
    || workerVersion !== `sellerpilot-cli-worker/1.61+${releaseSha}.${egressIpSha256.slice(0, 11)}`) {
    throw new Error("LAZADA_IM_EXACT_ATTESTATION_REQUIRED");
  }
  return { releaseSha, egressIpSha256, workerVersion };
}

export async function runLazadaImExactSession({
  sessionId,
  releaseSha,
  egressIpSha256,
  workerVersion,
  call,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  runJob = runLazadaImExactJob,
}) {
  const pulsePayload = exactAttestation(releaseSha, egressIpSha256, workerVersion);
  const deadline = now() + 9 * 60_000;
  let claim;
  while (now() < deadline) {
    const pulse = await call({ action: "pulse", sessionId, payload: pulsePayload });
    if (pulse.status !== "armed") throw new Error("LAZADA_IM_EXACT_PULSE_NOT_ARMED");
    const response = await call({ action: "claim", sessionId });
    if (response.status === "claimed") {
      claim = response.job;
      break;
    }
    if (response.status !== "waiting") throw new Error("LAZADA_IM_EXACT_UNEXPECTED_STATE");
    await sleep(5_000);
  }
  if (!claim) throw new Error("LAZADA_IM_EXACT_WAIT_EXPIRED");
  const result = await runJob(claim, sessionId, call);
  if (result.status !== "completed") throw new Error("LAZADA_IM_EXACT_NOT_COMPLETE");
  return { status: "completed", countries: 5 };
}

async function main() {
  const origin = process.env.SELLERPILOT_URL;
  const sessionId = process.env.SELLERPILOT_LAZADA_IM_EXACT_SESSION;
  const releaseSha = process.env.SELLERPILOT_LAZADA_IM_EXACT_RELEASE_SHA;
  const egressIpSha256 = process.env.SELLERPILOT_LAZADA_IM_EXACT_EGRESS_IP_SHA256;
  const workerVersion = process.env.SELLERPILOT_LAZADA_IM_EXACT_WORKER_VERSION;
  if (origin !== "https://sellerpilot-global.vercel.app"
    || !sessionId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(sessionId)) {
    throw new Error("LAZADA_IM_EXACT_CONFIG_REQUIRED");
  }
  const attestation = exactAttestation(releaseSha, egressIpSha256, workerVersion);
  const token = process.env.SELLERPILOT_GATEWAY_WORKER_TOKEN || execFileSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", "SellerPilot Gateway Worker", "-a", origin, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  const directFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => directFetch(input, {
    ...init,
    redirect: "error",
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  });
  const call = async (body) => {
    const response = await fetch(`${origin}/api/channel-gateway/worker/lazada-im-oauth-exact`, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("LAZADA_IM_EXACT_HTTP_FAILED");
    return response.json();
  };
  console.log(JSON.stringify(await runLazadaImExactSession({ sessionId, call, ...attestation })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("LAZADA_IM_EXACT_REVIEW_REQUIRED_NO_RETRY");
    process.exitCode = 2;
  });
}
