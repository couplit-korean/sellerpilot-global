import { createServer } from "node:http";

const DEFAULT_GATEWAY_HEALTH_PORT = 8080;
const DEFAULT_GATEWAY_READINESS_STALE_MS = 3 * 60_000;

function finiteIntegerInRange(value, fallback, name, minimum, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function resolveGatewayHealthPort({ once = false, environment = process.env } = {}) {
  const configured = environment.SELLERPILOT_GATEWAY_HEALTH_PORT ?? environment.PORT;
  if (once && (configured === undefined || configured === "")) return null;
  return finiteIntegerInRange(
    configured,
    DEFAULT_GATEWAY_HEALTH_PORT,
    "SELLERPILOT_GATEWAY_HEALTH_PORT",
    0,
    65_535,
  );
}

export function resolveGatewayReadinessStaleMs(environment = process.env) {
  return finiteIntegerInRange(
    environment.SELLERPILOT_GATEWAY_READINESS_STALE_MS,
    DEFAULT_GATEWAY_READINESS_STALE_MS,
    "SELLERPILOT_GATEWAY_READINESS_STALE_MS",
    60_000,
    60 * 60_000,
  );
}

export function resolveGatewayPolling(environment = process.env) {
  const pollMs = finiteIntegerInRange(
    environment.SELLERPILOT_GATEWAY_WORKER_POLL_MS
      ?? environment.SELLERPILOT_AI_WORKER_POLL_MS,
    5_000,
    "SELLERPILOT_GATEWAY_WORKER_POLL_MS",
    2_000,
    60_000,
  );
  const maxIdlePollMs = finiteIntegerInRange(
    environment.SELLERPILOT_GATEWAY_WORKER_MAX_IDLE_POLL_MS
      ?? environment.SELLERPILOT_AI_WORKER_MAX_IDLE_POLL_MS,
    30_000,
    "SELLERPILOT_GATEWAY_WORKER_MAX_IDLE_POLL_MS",
    2_000,
    5 * 60_000,
  );
  if (maxIdlePollMs < pollMs) {
    throw new Error("SELLERPILOT_GATEWAY_WORKER_MAX_IDLE_POLL_MS must be greater than or equal to the poll interval.");
  }
  return { pollMs, maxIdlePollMs };
}

export function createGatewayWorkerHealth({
  version,
  gatewayConfigured,
  schedulerConfigured,
  staleAfterMs = DEFAULT_GATEWAY_READINESS_STALE_MS,
  now = Date.now,
} = {}) {
  const startedAt = now();
  let stopping = false;
  let lastLoopAt = 0;
  let lastGatewayContactAt = 0;
  let lastGatewayStatus = null;
  let lastGatewayErrorAt = 0;
  let activeGatewayJobs = 0;

  const snapshot = () => {
    const currentTime = now();
    const gatewayContactFresh = lastGatewayContactAt > 0
      && currentTime - lastGatewayContactAt <= staleAfterMs;
    const gatewayAccepted = typeof lastGatewayStatus === "number"
      && lastGatewayStatus >= 200
      && lastGatewayStatus < 300;
    const ready = !stopping && gatewayConfigured && gatewayContactFresh && gatewayAccepted;
    const contacted = lastGatewayContactAt > 0 || lastGatewayErrorAt > 0;
    return {
      status: stopping ? "stopping" : ready ? "ready" : contacted ? "degraded" : "starting",
      mode: "gateway-only",
      version,
      uptimeSeconds: Math.max(0, Math.floor((currentTime - startedAt) / 1_000)),
      ready,
      configuredScopes: {
        gateway: Boolean(gatewayConfigured),
        scheduler: Boolean(schedulerConfigured),
      },
      capabilities: {
        gatewayQueue: Boolean(gatewayConfigured),
        periodicChannelSync: Boolean(gatewayConfigured && schedulerConfigured),
      },
      activeGatewayJobs,
      lastLoopAt: lastLoopAt > 0 ? new Date(lastLoopAt).toISOString() : null,
      lastGatewayContactAt: lastGatewayContactAt > 0
        ? new Date(lastGatewayContactAt).toISOString()
        : null,
      lastGatewayStatus,
      lastGatewayErrorAt: lastGatewayErrorAt > 0
        ? new Date(lastGatewayErrorAt).toISOString()
        : null,
    };
  };

  return {
    markLoop() {
      lastLoopAt = now();
    },
    markGatewayResponse(status) {
      lastGatewayContactAt = now();
      lastGatewayStatus = Number.isInteger(status) ? status : 0;
      if (lastGatewayStatus >= 400 || lastGatewayStatus === 0) {
        lastGatewayErrorAt = lastGatewayContactAt;
      }
    },
    markGatewayError() {
      lastGatewayStatus = 0;
      lastGatewayErrorAt = now();
    },
    setActiveGatewayJobs(count) {
      activeGatewayJobs = Math.max(0, Number.isFinite(count) ? Math.trunc(count) : 0);
    },
    markStopping() {
      stopping = true;
    },
    snapshot,
  };
}

function writeJson(response, status, body, headOnly) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(headOnly ? undefined : payload);
}

export async function startGatewayWorkerHealthServer({
  health,
  port,
  host = "0.0.0.0",
} = {}) {
  if (port === null || port === undefined) return null;
  if (!health || typeof health.snapshot !== "function") {
    throw new Error("A gateway worker health state is required.");
  }

  const server = createServer((request, response) => {
    const method = request.method ?? "GET";
    const headOnly = method === "HEAD";
    if (method !== "GET" && !headOnly) {
      writeJson(response, 405, { error: "method_not_allowed" }, false);
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://worker.local").pathname;
    const current = health.snapshot();
    if (pathname === "/healthz") {
      writeJson(response, 200, { ...current, healthy: true }, headOnly);
      return;
    }
    if (pathname === "/readyz") {
      writeJson(response, current.ready ? 200 : 503, current, headOnly);
      return;
    }
    writeJson(response, 404, { error: "not_found" }, headOnly);
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  return {
    server,
    address: server.address(),
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
