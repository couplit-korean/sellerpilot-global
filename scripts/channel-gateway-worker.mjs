import { processShippingGatewayJob } from "./shipping-gateway-job.mjs";
import { AI_HEARTBEAT_INTERVAL_MS, AI_HEARTBEAT_TRANSIENT_GRACE_MS, requestWithTransientRetry, WORKER_COMPLETION_TRANSIENT_GRACE_MS, WorkerRequestTerminalError } from "./worker-lifecycle-retry.mjs";
import { processCsGatewayJob } from "./cs-gateway-job.mjs";
import { processCommerceGatewayJob, processElevenstCreateRecoveryDrain } from "./commerce-gateway-job.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jitterWorkerPollMs, nextWorkerIdlePollMs } from "../lib/worker-polling.ts";
import { canRunGatewayClaim, canRunPeriodicChannelSync, isWorkerTokenConfigured, workerClaimBackoffMs, workerFailureBackoffMs } from "./worker-claim-backoff.mjs";
import { createGatewayWorkerHealth, resolveGatewayHealthPort, resolveGatewayPolling, resolveGatewayReadinessStaleMs, startGatewayWorkerHealthServer } from "./persistent-worker-health.mjs";
import { attachEbayCreateClaimIncarnation } from "../lib/channels/ebay-create-claim.ts";
import { isLocalGatewayRecoveryAllowedTuple, LOCAL_GATEWAY_RECOVERY_CLAIM_MODE } from "../lib/channels/local-gateway-recovery-lane.ts";
import { recordObservedLocalEgressSha256 } from "../lib/channels/local-channel-executor.ts";
import { EBAY_PUBLICATION_RECONCILIATION_CLAIM_MODE } from "../lib/channels/ebay-publication-reconciliation-contract.ts";
import { runWithProviderTransportContext } from "../lib/channels/protocols.ts";
const localRecoveryOnly = process.argv.includes("--local-recovery-only");
const noScheduler = process.argv.includes("--no-scheduler");
;
if (!process.env.SELLERPILOT_URL?.trim()) {
    throw new Error("SELLERPILOT_URL must explicitly identify the deployed control plane in gateway-only mode.");
}
const sellerpilotUrl = (process.env.SELLERPILOT_URL ?? "https://sellerpilot-global.vercel.app").replace(/\/$/, "");
function loadWorkerToken(environmentName, keychainService) {
    const environmentToken = process.env[environmentName]?.trim();
    if (environmentToken)
        return environmentToken;
    if (process.platform !== "darwin")
        return "";
    try {
        return execFileSync("/usr/bin/security", [
            "find-generic-password",
            "-s", keychainService,
            "-a", sellerpilotUrl,
            "-w",
        ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    }
    catch {
        return "";
    }
}
const aiWorkerToken = "";
const gatewayWorkerToken = loadWorkerToken("SELLERPILOT_GATEWAY_WORKER_TOKEN", "SellerPilot Gateway Worker");
// Opt out before reading either the environment token or Keychain. Gateway claims stay enabled.
const schedulerWorkerToken = (localRecoveryOnly || noScheduler) ? "" : loadWorkerToken("SELLERPILOT_SCHEDULER_WORKER_TOKEN", "SellerPilot Scheduler Worker");
const aiWorkerConfigured = isWorkerTokenConfigured(aiWorkerToken);
const gatewayWorkerConfigured = isWorkerTokenConfigured(gatewayWorkerToken);
const schedulerWorkerConfigured = isWorkerTokenConfigured(schedulerWorkerToken);
const gatewayPolling = resolveGatewayPolling();
const pollMs = gatewayPolling?.pollMs
    ?? Math.max(2000, Number(process.env.SELLERPILOT_AI_WORKER_POLL_MS ?? 5000));
const maxIdlePollMs = gatewayPolling?.maxIdlePollMs
    ?? Math.max(pollMs, Number(process.env.SELLERPILOT_AI_WORKER_MAX_IDLE_POLL_MS ?? 30000));
const once = process.argv.includes("--once");
let stopping = false;
const workerRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localChannelExecutorClaimMode = "local_channel_executor";
const localReleaseGitTimeoutMs = 2_000;
function readTrackedRuntimeRelease() {
    try {
        const releaseSha = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
            cwd: workerRepositoryRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: localReleaseGitTimeoutMs,
            killSignal: "SIGKILL",
        }).trim().toLowerCase();
        if (!/^[a-f0-9]{40}$/u.test(releaseSha))
            return null;
        execFileSync("/usr/bin/git", [
            "diff", "--quiet", "HEAD", "--",
            "app", "lib", "scripts", "package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json",
        ], {
            cwd: workerRepositoryRoot,
            stdio: "ignore",
            timeout: localReleaseGitTimeoutMs,
            killSignal: "SIGKILL",
        });
        const untrackedRuntime = execFileSync("/usr/bin/git", [
            "ls-files", "--others", "--exclude-standard", "--",
            "app", "lib", "scripts", "package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json",
        ], {
            cwd: workerRepositoryRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: localReleaseGitTimeoutMs,
            killSignal: "SIGKILL",
        }).trim();
        return untrackedRuntime ? null : releaseSha;
    }
    catch {
        return null;
    }
}
async function captureLocalChannelExecutorAttestation() {
    const releaseSha = readTrackedRuntimeRelease();
    if (!releaseSha)
        return null;
    try {
        const response = await fetch("https://api.ipify.org", {
            redirect: "error",
            signal: AbortSignal.timeout(8000),
            headers: { accept: "text/plain" },
        });
        if (!response.ok)
            return null;
        const egressIp = (await response.text()).trim().toLowerCase();
        if (!egressIp
            || egressIp.length > 64
            || /[\s,]/u.test(egressIp)
            || (!/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(egressIp)
                && !/^[a-f0-9:]+$/u.test(egressIp)))
            return null;
        const egressIpSha256 = createHash("sha256").update(egressIp, "utf8").digest("hex");
        return { releaseSha, egressIpSha256 };
    }
    catch {
        return null;
    }
}
const localChannelExecutorAttestation = gatewayWorkerConfigured && !localRecoveryOnly
    ? await captureLocalChannelExecutorAttestation()
    : null;
// The measured value is the only honest source for attributing a provider
// allowlist rejection to the egress this process actually used.
if (localChannelExecutorAttestation)
    recordObservedLocalEgressSha256(localChannelExecutorAttestation.egressIpSha256);
const workerVersion = localChannelExecutorAttestation
    ? `sellerpilot-cli-worker/1.61+${localChannelExecutorAttestation.releaseSha}.${localChannelExecutorAttestation.egressIpSha256.slice(0, 11)}`
    : "sellerpilot-cli-worker/1.61";
const periodicSyncMs = Math.max(60000, Number(process.env.SELLERPILOT_CHANNEL_SYNC_MS ?? 5 * 60000));
let nextPeriodicSyncAt = 0;
let periodicCompetitorRequest = null;
let idlePollMs = pollMs;
let gatewayClaimBackoffUntil = 0;
let gatewayClaimBackoffStatus = 0;
let gatewayQueueIdle = false;
const authBackoffUntil = { ai: 0, gateway: 0, scheduler: 0 };
if (!gatewayWorkerConfigured) {
    throw new Error("SELLERPILOT_GATEWAY_WORKER_TOKEN must contain an active gateway-scoped worker token.");
}
let gatewayWorkerHealth = null;
process.once("SIGINT", () => {
    stopping = true;
    gatewayWorkerHealth?.markStopping();
});
process.once("SIGTERM", () => {
    stopping = true;
    gatewayWorkerHealth?.markStopping();
});
function delay(ms) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
function markWorkerBusy() {
    idlePollMs = pollMs;
}
async function waitForIdleWork() {
    const waitMs = jitterWorkerPollMs(idlePollMs);
    idlePollMs = nextWorkerIdlePollMs(idlePollMs, pollMs, maxIdlePollMs);
    await delay(waitMs);
}
function workerScopeForPath(path) {
    if (path.startsWith("/api/channel-gateway/"))
        return "gateway";
    if (path.startsWith("/api/internal/"))
        return "scheduler";
    return "ai";
}
function workerTokenForScope(scope) {
    if (scope === "gateway")
        return gatewayWorkerToken;
    if (scope === "scheduler")
        return schedulerWorkerToken;
    return aiWorkerToken;
}
function deferWorkerScope(scope, status = 401) {
    authBackoffUntil[scope] = Math.max(authBackoffUntil[scope], Date.now() + workerClaimBackoffMs(status));
}
async function api(path, init = {}, timeoutMs = 30000) {
    const scope = workerScopeForPath(path);
    const scopedToken = workerTokenForScope(scope);
    return fetch(`${sellerpilotUrl}${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${scopedToken}`,
            "content-type": "application/json",
            ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
    });
}
function startPeriodicCompetitorRefresh() {
    if (periodicCompetitorRequest)
        return;
    periodicCompetitorRequest = api("/api/internal/competitor-prices", { method: "POST" }, 58000).then((response) => {
        if (!response.ok && response.status !== 207) {
            if (response.status === 401) {
                deferWorkerScope("scheduler");
            }
            console.error(`경쟁가 자동 조회 실패 · HTTP ${response.status}`);
        }
    }).catch((error) => {
        console.error(error instanceof Error ? error.message : "경쟁가 자동 조회 실패");
    }).finally(() => {
        periodicCompetitorRequest = null;
    });
}
async function processGatewayJob(job, reserveProviderRequest) {
    const dependencies = { createGatewayHeartbeat, persistWorkerCompletion, reserveProviderRequest };
    return job.operation === "inquiries.list" || job.operation === "inquiries.reply"
        ? processCsGatewayJob(job, dependencies)
        : /^(orders|shipment)\./.test(job.operation) ? processShippingGatewayJob(job, dependencies)
        : processCommerceGatewayJob(job, dependencies);
}

function withLocalProviderRequestBudget(job, execute) {
    let initialReservationAvailable = true;
    const deadline = Date.now() + 180000;
    const reserve = async () => {
        if (initialReservationAvailable) {
            initialReservationAvailable = false;
            return;
        }
        for (;;) {
            if (Date.now() >= deadline)
                throw new Error("PROVIDER_REQUEST_RATE_BUDGET_TIMEOUT");
            const response = await api("/api/channel-gateway/worker/rate-budget", {
                method: "POST",
                body: JSON.stringify({ jobId: job.id, claimToken: job.claim_token }),
            });
            if (!response.ok)
                throw new Error(`PROVIDER_REQUEST_RATE_BUDGET_HTTP_${response.status}`);
            const receipt = await response.json();
            if (receipt?.contract !== "sellerpilot-provider-request-rate-budget/1"
                || !["reserved", "waiting"].includes(receipt.status))
                throw new Error("PROVIDER_REQUEST_RATE_BUDGET_INVALID");
            if (receipt.status === "reserved")
                return;
            const waitMs = Number(receipt.retryAfterMs);
            if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 60000)
                throw new Error("PROVIDER_REQUEST_RATE_BUDGET_INVALID_WAIT");
            await delay(waitMs);
        }
    };
    return runWithProviderTransportContext({ reserve }, () => execute(reserve));
}
const workerMode = (localRecoveryOnly ? "gateway-only-local-recovery" : "gateway-only");
console.log(`SellerPilot channel gateway worker 시작 · ${sellerpilotUrl} · version=${workerVersion} · mode=${workerMode} · poll=${pollMs}ms`);
console.log(`Worker scopes · ai=${aiWorkerConfigured ? "configured" : "disabled"} · gateway=${gatewayWorkerConfigured ? "configured" : "disabled"} · scheduler=${schedulerWorkerConfigured ? "configured" : "disabled"}`);
const configuredGatewayConcurrency = Number(process.env.SELLERPILOT_CHANNEL_WORKER_CONCURRENCY ?? 2);
const maxGatewayConcurrency = Math.min(4, Math.max(1, Number.isFinite(configuredGatewayConcurrency) ? Math.trunc(configuredGatewayConcurrency) : 2));
const activeGatewayJobs = new Set();
let gatewayHealthServer = null;
{
    gatewayWorkerHealth = createGatewayWorkerHealth({
        version: workerVersion,
        runtimeAttestation: localChannelExecutorAttestation,
        gatewayConfigured: gatewayWorkerConfigured,
        schedulerConfigured: schedulerWorkerConfigured,
        staleAfterMs: resolveGatewayReadinessStaleMs(),
    });
    const healthPort = resolveGatewayHealthPort({ once });
    gatewayHealthServer = await startGatewayWorkerHealthServer({
        health: gatewayWorkerHealth,
        port: healthPort,
        host: process.env.SELLERPILOT_GATEWAY_HEALTH_HOST?.trim() || "0.0.0.0",
    });
    if (gatewayHealthServer?.address) {
        const address = gatewayHealthServer.address;
        const listeningPort = typeof address === "object" && address ? address.port : healthPort;
        console.log(`Gateway health server · port=${listeningPort} · liveness=/healthz · readiness=/readyz`);
    }
}
do {
    try {
        gatewayWorkerHealth?.markLoop();
        if (canRunPeriodicChannelSync({
            once,
            gatewayConfigured: gatewayWorkerConfigured,
            schedulerConfigured: schedulerWorkerConfigured,
            queueIdle: gatewayQueueIdle,
            activeGatewayJobs: activeGatewayJobs.size,
            now: Date.now(),
            nextPeriodicSyncAt,
            schedulerBackoffUntil: authBackoffUntil.scheduler,
        })) {
            nextPeriodicSyncAt = Date.now() + periodicSyncMs;
            gatewayQueueIdle = false;
            try {
                const syncResponse = await api("/api/internal/channel-sync", {
                    method: "POST",
                    body: JSON.stringify({ version: workerVersion }),
                });
                if (!syncResponse.ok) {
                    nextPeriodicSyncAt = Date.now() + 60000;
                    if (syncResponse.status === 401) {
                        deferWorkerScope("scheduler", syncResponse.status);
                    }
                    throw new Error(`주문·문의 자동 동기화 예약 실패 · HTTP ${syncResponse.status}`);
                }
                const syncResult = await syncResponse.json();
                const scheduledCount = Number(syncResult.queued ?? 0);
                const pendingCount = Number(syncResult.pending ?? 0);
                gatewayQueueIdle = scheduledCount === 0 && pendingCount === 0;
                if (scheduledCount > 0) {
                    markWorkerBusy();
                    console.log(`[자동 동기화] ${scheduledCount}개 채널 조회 작업 예약`);
                }
                // Do not wait here: the competitor route can enqueue an 11st read that
                // this same process must claim. Single-flight background execution lets
                // the gateway loop receive that job without creating a circular wait.
                startPeriodicCompetitorRefresh();
                const kakaoResponse = await api("/api/internal/kakao-notifications", { method: "POST" });
                if (!kakaoResponse.ok && kakaoResponse.status !== 207) {
                    console.error(`카카오 알림 자동 발송 실패 · HTTP ${kakaoResponse.status}`);
                }
            }
            catch (syncError) {
                console.error(syncError instanceof Error ? syncError.message : "주문·문의 자동 동기화 예약 실패");
            }
        }
        if (canRunGatewayClaim({
            configured: gatewayWorkerConfigured,
            activeGatewayJobs: activeGatewayJobs.size,
            maxGatewayConcurrency,
            now: Date.now(),
            claimBackoffUntil: gatewayClaimBackoffUntil,
            authBackoffUntil: authBackoffUntil.gateway,
        })) {
            try {
                let skipRegularClaim = false;
                if (!localRecoveryOnly) {
                    const recoveryDrain = await processElevenstCreateRecoveryDrain({
                        request: (path, body) => api(path, { method: "POST", body: JSON.stringify(body) }),
                    });
                    if (recoveryDrain.kind === "finished") {
                        markWorkerBusy();
                        gatewayQueueIdle = false;
                        gatewayClaimBackoffStatus = 0;
                        skipRegularClaim = true;
                    } else if (recoveryDrain.kind !== "idle") {
                        gatewayQueueIdle = false;
                        gatewayClaimBackoffUntil = Date.now() + workerFailureBackoffMs(503);
                        skipRegularClaim = true;
                        if (once) {
                            throw new Error("11번가 공식 GET-only 복구를 확인하지 못했습니다.");
                        }
                    }
                }
                if (skipRegularClaim) {
                    // Recovery owned this tick. Do not also POST a fresh CREATE job.
                } else {
                let ebayRecoveryClaimAttempted = !localRecoveryOnly
                    && !localChannelExecutorAttestation;
                let gatewayResponse = await api("/api/channel-gateway/worker/claim", {
                    method: "POST",
                    body: JSON.stringify({
                        version: workerVersion,
                        ...(localRecoveryOnly
                            ? { mode: LOCAL_GATEWAY_RECOVERY_CLAIM_MODE }
                            : localChannelExecutorAttestation
                                ? {
                                    mode: localChannelExecutorClaimMode,
                                    releaseSha: localChannelExecutorAttestation.releaseSha,
                                    egressIpSha256: localChannelExecutorAttestation.egressIpSha256,
                                }
                                : { mode: EBAY_PUBLICATION_RECONCILIATION_CLAIM_MODE }),
                    }),
                });
                if (!localRecoveryOnly
                    && localChannelExecutorAttestation
                    && gatewayResponse.status === 204) {
                    ebayRecoveryClaimAttempted = true;
                    gatewayResponse = await api("/api/channel-gateway/worker/claim", {
                        method: "POST",
                        body: JSON.stringify({
                            version: workerVersion,
                            mode: EBAY_PUBLICATION_RECONCILIATION_CLAIM_MODE,
                        }),
                    });
                }
                const ebayRecoveryContractUnavailable = ebayRecoveryClaimAttempted
                    && [400, 404, 501, 503].includes(gatewayResponse.status);
                // The local executor lane only covers routes that carry a per
                // channel and operation approval (coupang, smartstore). A
                // rejection there says nothing about the ordinary lane, so a
                // rejected local claim must not stop the jobs that are supposed
                // to run from this machine, such as fixed-IP channel read checks.
                const localLaneRejected = Boolean(localChannelExecutorAttestation)
                    && [401, 403, 409].includes(gatewayResponse.status);
                if (!localRecoveryOnly
                    && (gatewayResponse.status === 204
                        || localLaneRejected
                        || ebayRecoveryContractUnavailable)) {
                    gatewayResponse = await api("/api/channel-gateway/worker/claim", {
                        method: "POST",
                        body: JSON.stringify({ version: workerVersion }),
                    });
                }
                gatewayWorkerHealth?.markGatewayResponse(gatewayResponse.status);
                if (localRecoveryOnly && gatewayResponse.status === 409) {
                    console.error("로컬 복구 전용 claim 경계를 서버가 확인하지 않아 실행을 중단합니다. running 행을 유지합니다.");
                    stopping = true;
                    process.exitCode = 1;
                    break;
                }
                if (gatewayResponse.ok && gatewayResponse.status !== 204) {
                    const gatewayJob = attachEbayCreateClaimIncarnation(await gatewayResponse.json());
                    if (localRecoveryOnly) {
                        const claimedChannel = typeof gatewayJob?.channel === "string" ? gatewayJob.channel : "";
                        const claimedOperation = typeof gatewayJob?.operation === "string" ? gatewayJob.operation : "";
                        if (!isLocalGatewayRecoveryAllowedTuple(claimedChannel, claimedOperation)) {
                            console.error(`로컬 복구 전용 claim 경계를 서버가 확인하지 않아 실행을 중단합니다. ${claimedChannel} · ${claimedOperation} · running 행을 유지합니다.`);
                            stopping = true;
                            process.exitCode = 1;
                            break;
                        }
                    }
                    markWorkerBusy();
                    gatewayQueueIdle = false;
                    if (once) {
                        await withLocalProviderRequestBudget(gatewayJob, (reserve) => processGatewayJob(gatewayJob, reserve));
                        continue;
                    }
                    else {
                        const activeGatewayJob = withLocalProviderRequestBudget(gatewayJob, (reserve) => processGatewayJob(gatewayJob, reserve)).finally(() => {
                            activeGatewayJobs.delete(activeGatewayJob);
                            gatewayWorkerHealth?.setActiveGatewayJobs(activeGatewayJobs.size);
                        });
                        activeGatewayJobs.add(activeGatewayJob);
                        gatewayWorkerHealth?.setActiveGatewayJobs(activeGatewayJobs.size);
                    }
                    gatewayClaimBackoffStatus = 0;
                }
                if (gatewayResponse.status === 204 && activeGatewayJobs.size === 0)
                    gatewayQueueIdle = true;
                if (!gatewayResponse.ok) {
                    gatewayQueueIdle = false;
                    const backoffMs = workerFailureBackoffMs(gatewayResponse.status);
                    gatewayClaimBackoffUntil = Date.now() + backoffMs;
                    if (gatewayResponse.status === 401)
                        deferWorkerScope("gateway", gatewayResponse.status);
                    if (gatewayClaimBackoffStatus !== gatewayResponse.status) {
                        console.error(gatewayResponse.status === 401
                            ? "채널 작업자 인증이 거절됐습니다. 관리자 화면에서 토큰 상태를 확인해 주세요."
                            : gatewayResponse.status === 503
                                ? "운영 데이터베이스가 지연되어 채널 작업 수신을 1분 뒤 재시도합니다."
                                : `채널 작업 요청 실패 · HTTP ${gatewayResponse.status} · 1분 뒤 재시도합니다.`);
                        gatewayClaimBackoffStatus = gatewayResponse.status;
                    }
                    if (once && gatewayResponse.status !== 404) {
                        throw new Error(`채널 작업 요청 실패 · HTTP ${gatewayResponse.status}`);
                    }
                }
                else if (gatewayResponse.status === 204) {
                    gatewayClaimBackoffStatus = 0;
                }
                }
            }
            catch (gatewayClaimError) {
                gatewayWorkerHealth?.markGatewayError();
                gatewayQueueIdle = false;
                gatewayClaimBackoffUntil = Math.max(gatewayClaimBackoffUntil, Date.now() + workerFailureBackoffMs(0));
                if (once)
                    throw gatewayClaimError;
                if (gatewayClaimBackoffStatus !== -1) {
                    console.error(gatewayClaimError instanceof Error
                        ? `채널 작업 수신 오류 · ${gatewayClaimError.message} · 1분 뒤 재시도합니다.`
                        : "채널 작업 수신 오류 · 1분 뒤 재시도합니다.");
                    gatewayClaimBackoffStatus = -1;
                }
            }
        }
        if (once && activeGatewayJobs.size >= maxGatewayConcurrency) {
            await Promise.allSettled([...activeGatewayJobs]);
            continue;
        }
        if (once)
            break;
        await waitForIdleWork();
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : "CLI worker 오류");
        if (once)
            process.exitCode = 1;
        if (!once)
            await delay(Math.max(pollMs, 10000));
    }
} while (!once && !stopping);
if (activeGatewayJobs.size)
    await Promise.allSettled([...activeGatewayJobs]);
if (periodicCompetitorRequest)
    await Promise.allSettled([periodicCompetitorRequest]);
gatewayWorkerHealth?.markStopping();
await gatewayHealthServer?.close();
console.log(`SellerPilot ${"channel gateway"} worker 종료`);

async function touchGatewayJob(jobId, claimToken) {
  let response;
  try {
    response = await requestWithTransientRetry({
      request: () => api("/api/channel-gateway/worker/heartbeat", {
        method: "POST",
        body: JSON.stringify({ jobId, claimToken, version: workerVersion }),
      }),
      delay,
      graceMs: AI_HEARTBEAT_TRANSIENT_GRACE_MS,
      terminalStatuses: [401, 404, 409],
      label: "채널 작업자 신호 실패",
      onTransient: ({ attempt, status, waitMs }) => {
        if (attempt === 1) console.error(`채널 작업자 신호가 일시 지연됐습니다 · HTTP ${status} · ${waitMs}ms 뒤 재시도`);
      },
    });
  } catch (error) {
    if (error instanceof WorkerRequestTerminalError && error.status === 401) {
      deferWorkerScope("gateway");
    }
    if (error instanceof WorkerRequestTerminalError) deferTransientClaims("gateway", error.status);
    throw error;
  }
  const payload = await response.json();
  if (payload.status !== "running") {
    throw new WorkerRequestTerminalError("채널 작업 실행 권한 또는 lease가 만료됐습니다.", {
      status: 409,
      reconciliation: true,
    });
  }
}

function createGatewayHeartbeat(jobId, claimToken) {
  let heartbeatError = null;
  let heartbeatPromise = null;
  let heartbeatTimer = null;

  const scheduleTouch = () => {
    if (heartbeatPromise || heartbeatError) return;
    heartbeatPromise = touchGatewayJob(jobId, claimToken)
      .catch((error) => {
        heartbeatError = error;
      })
      .finally(() => {
        heartbeatPromise = null;
      });
  };

  return {
    async start() {
      await touchGatewayJob(jobId, claimToken);
      heartbeatTimer = setInterval(scheduleTouch, AI_HEARTBEAT_INTERVAL_MS);
    },
    async assertHealthy() {
      if (heartbeatPromise) await heartbeatPromise;
      if (heartbeatError) throw heartbeatError;
    },
    async stop() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (heartbeatPromise) await heartbeatPromise;
      if (heartbeatError) throw heartbeatError;
    },
  };
}

async function persistWorkerCompletion(path, payload, label, graceMs = WORKER_COMPLETION_TRANSIENT_GRACE_MS) {
  const requestBody = JSON.stringify(payload);
  try {
    return await requestWithTransientRetry({
      request: () => api(path, { method: "POST", body: requestBody }),
      delay,
      graceMs,
      terminalStatuses: [401, 409],
      label,
      onTransient: ({ attempt, status, waitMs }) => {
        if (attempt === 1) console.error(`${label} 응답이 일시 지연됐습니다 · HTTP ${status} · ${waitMs}ms 뒤 동일 결과 재시도`);
      },
    });
  } catch (error) {
    if (error instanceof WorkerRequestTerminalError && error.status === 401) {
      deferWorkerScope(workerScopeForPath(path));
    }
    if (error instanceof WorkerRequestTerminalError) {
      deferTransientClaims(workerScopeForPath(path), error.status);
    }
    throw error;
  }
}

function deferTransientClaims(scope, status) {
  if (scope === "gateway" && status === 503) gatewayClaimBackoffUntil = Math.max(gatewayClaimBackoffUntil, Date.now() + workerClaimBackoffMs(status));
}
