import { createHash, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_SUPABASE_HOST = "sqaoqucxakebqkiygdxb.supabase.co";
const PRODUCTION_ORIGIN = "https://sellerpilot-global.vercel.app";
const WAKE_LABEL = "sellerpilot:channel-gateway-drain:wake:v1";
const GATEWAY_LABEL = "sellerpilot:channel-gateway-drain:gateway:v1";
const SCHEDULER_LABEL = "sellerpilot:channel-gateway-drain:scheduler:v1";
const DRAIN_MODE_HEADER = "x-sellerpilot-drain-mode";
const CANARY_MODE = "canary-v1";
const INTERNAL_SCHEDULE_MODE_HEADER = "x-sellerpilot-schedule-mode";
const RELEASE_PATTERN = /^[0-9a-f]{40}$/i;
const INTERNAL_SCHEDULE_CANARY_PATHS = [
  "/api/internal/product-research",
  "/api/internal/channel-sync",
  "/api/internal/competitor-prices",
  "/api/internal/kakao-notifications",
  "/api/internal/maintenance",
];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function derivedToken(secret, label) {
  return `spw_${createHmac("sha256", secret).update(label, "utf8").digest("base64url")}`;
}

function tokenMetadata(rawToken) {
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  return { tokenHash, fingerprint: tokenHash.slice(0, 12).toUpperCase() };
}

function selectedRuntimeOrigin() {
  const candidate = process.env.SELLERPILOT_RUNTIME_ORIGIN?.trim() || PRODUCTION_ORIGIN;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  const isAllowedHost = parsed.hostname === new URL(PRODUCTION_ORIGIN).hostname
    || /^sellerpilot-global-[a-z0-9]+-project-e59d\.vercel\.app$/.test(parsed.hostname);
  if (parsed.protocol !== "https:"
      || !isAllowedHost
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash) {
    return null;
  }
  return parsed.origin;
}

function expectedRelease() {
  const release = process.env.SELLERPILOT_EXPECTED_RELEASE?.trim() ?? "";
  return RELEASE_PATTERN.test(release) ? release.toLowerCase() : null;
}

async function runNoWorkCanaries({ origin, release, wakeBearer }) {
  const gatewayResponse = await fetch(`${origin}/api/internal/channel-gateway-drain`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${wakeBearer}`,
      "content-type": "application/json",
      [DRAIN_MODE_HEADER]: CANARY_MODE,
    },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  });
  const gatewayPayload = await gatewayResponse.json().catch(() => null);
  const gatewayPassed = gatewayResponse.ok
    && Boolean(gatewayPayload)
    && typeof gatewayPayload === "object"
    && gatewayPayload.status === "canary"
    && gatewayPayload.claimed === 0
    && gatewayPayload.processed === 0
    && gatewayPayload.release === release;
  if (!gatewayPassed) {
    throw new Error(`serverless gateway canary failed (${gatewayResponse.status})`);
  }

  const scheduleCanaries = [];
  for (const path of INTERNAL_SCHEDULE_CANARY_PATHS) {
    const response = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${wakeBearer}`,
        [INTERNAL_SCHEDULE_MODE_HEADER]: CANARY_MODE,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => null);
    const passed = response.ok
      && Boolean(payload)
      && typeof payload === "object"
      && payload.status === "canary"
      && payload.executed === false
      && payload.release === release;
    if (!passed) {
      throw new Error(`internal schedule canary failed (${path}, ${response.status})`);
    }
    scheduleCanaries.push({ path, status: response.status, outcome: "accepted" });
  }
  return {
    release,
    origin,
    gateway: { status: gatewayResponse.status, outcome: "accepted" },
    schedules: scheduleCanaries,
  };
}

const requested = new Set(process.argv.slice(2));
const allowed = new Set([
  "--candidate-canary",
  "--deactivate",
  "--bootstrap",
  "--canary",
  "--activate",
  "--status",
]);
const candidateOnly = requested.size === 1 && requested.has("--candidate-canary");
if (!requested.size || [...requested].some((argument) => !allowed.has(argument))) {
  fail("usage: node scripts/bootstrap-serverless-cs-runtime.mjs [--candidate-canary] [--deactivate] [--bootstrap] [--canary --activate] [--status]");
} else if (requested.has("--candidate-canary") && !candidateOnly) {
  fail("candidate canary must be a separate no-database release step");
} else if (requested.has("--deactivate") && requested.has("--activate")) {
  fail("deactivation and activation must be separate release steps");
} else {
  const requiresCronSecret = candidateOnly
    || requested.has("--bootstrap")
    || requested.has("--canary");
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const origin = selectedRuntimeOrigin();
  const release = requested.has("--candidate-canary") || requested.has("--canary")
    ? expectedRelease()
    : null;
  if (!origin) {
    fail("SellerPilot runtime origin must be the production host or an exact Vercel deployment host");
  } else if (requiresCronSecret && cronSecret.length < 16) {
    fail("SellerPilot server runtime secrets are not available");
  } else if ((requested.has("--candidate-canary") || requested.has("--canary")) && !release) {
    fail("SELLERPILOT_EXPECTED_RELEASE must be the exact 40-character Git commit SHA");
  } else if (requested.has("--canary") && origin !== PRODUCTION_ORIGIN) {
    fail("receipt-backed production canary must use the production origin");
  } else {
    const wakeBearer = requiresCronSecret
      ? createHmac("sha256", cronSecret).update(WAKE_LABEL, "utf8").digest("base64url")
      : "";
    if (candidateOnly) {
      const candidateCanary = await runNoWorkCanaries({ origin, release, wakeBearer });
      process.stdout.write(`${JSON.stringify({ candidateCanary })}\n`);
    } else {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
      const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
      let parsedUrl;
      try {
        parsedUrl = new URL(supabaseUrl);
      } catch {
        parsedUrl = null;
      }
      if (parsedUrl?.protocol !== "https:" || parsedUrl.hostname !== EXPECTED_SUPABASE_HOST) {
        fail("exact SellerPilot Supabase project is not configured");
      } else if (!serviceKey) {
        fail("SellerPilot Supabase service credential is not available");
      } else {
        const supabase = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
        });
        const report = {};
        let canaryPassed = false;
        let canaryReceiptId = null;

        const readStatus = async () => {
          const { data, error } = await supabase.rpc("sellerpilot_service_serverless_cs_wakeup_status");
          if (error || !data || typeof data !== "object") {
            throw new Error("serverless CS scheduler status unavailable");
          }
          return data;
        };

        if (requested.has("--deactivate")) {
          const { data, error } = await supabase.rpc("sellerpilot_service_set_serverless_cs_wakeup_active", {
            p_active: false,
          });
          if (error || !data || data.active !== false) {
            throw new Error("serverless runtime scheduler deactivation failed");
          }
          report.deactivation = { configured: data.configured === true, active: false };
        }

        if (requested.has("--bootstrap")) {
          const gateway = tokenMetadata(derivedToken(cronSecret, GATEWAY_LABEL));
          const scheduler = tokenMetadata(derivedToken(cronSecret, SCHEDULER_LABEL));
          const { data, error } = await supabase.rpc("sellerpilot_service_bootstrap_ebay_asq_serverless_runtime", {
            p_gateway_token_hash: gateway.tokenHash,
            p_gateway_fingerprint: gateway.fingerprint,
            p_scheduler_token_hash: scheduler.tokenHash,
            p_scheduler_fingerprint: scheduler.fingerprint,
            p_wake_secret: wakeBearer,
          });
          if (error || !data || data.configured !== true) {
            const safeCode = typeof error?.code === "string" && /^[A-Z0-9_.-]{1,32}$/i.test(error.code)
              ? error.code
              : "unknown";
            throw new Error(`serverless CS bootstrap failed (${safeCode})`);
          }
          report.bootstrap = { configured: true, version: data.version ?? "unknown" };
        }

        if (requested.has("--canary")) {
          const { data: receiptData, error: receiptError } = await supabase.rpc(
            "sellerpilot_service_begin_serverless_runtime_canary",
            { p_release_id: release },
          );
          if (receiptError || typeof receiptData !== "string") {
            throw new Error("serverless runtime canary receipt unavailable; schedules must be inactive");
          }
          canaryReceiptId = receiptData;
          const canary = await runNoWorkCanaries({ origin, release, wakeBearer });
          const { data: receiptCompleted, error: receiptCompletionError } = await supabase.rpc(
            "sellerpilot_service_complete_serverless_runtime_canary",
            { p_receipt_id: canaryReceiptId, p_release_id: release },
          );
          if (receiptCompletionError || receiptCompleted !== true) {
            throw new Error("serverless runtime canary receipt completion failed");
          }
          canaryPassed = true;
          report.canary = canary;
        }

        if (requested.has("--activate")) {
          if (!requested.has("--canary") || !canaryPassed) {
            throw new Error("scheduler activation requires all production canaries in the same process");
          }
          const preactivationStatus = await readStatus();
          if (preactivationStatus.active === true
              || preactivationStatus.unsafePendingMutations !== 0) {
            throw new Error("scheduler activation blocked by active schedules or pending marketplace mutations");
          }
          const { data, error } = await supabase.rpc("sellerpilot_service_activate_serverless_runtime", {
            p_canary_receipt_id: canaryReceiptId,
            p_release_id: release,
          });
          let activation = data;
          if (error || !activation || activation.active !== true || activation.canaryReceiptConsumed !== true) {
            const reconciled = await readStatus().catch(() => null);
            if (reconciled?.active === true && reconciled?.activeRelease === release) {
              activation = {
                active: true,
                canaryReceiptConsumed: true,
                scheduleCount: reconciled.scheduleCount ?? null,
              };
            } else {
              throw new Error("scheduler activation outcome is not confirmed; inspect status and deactivate before retry");
            }
          }
          report.scheduler = {
            configured: true,
            active: true,
            release,
            scheduleCount: activation.scheduleCount ?? null,
          };
        }

        if (requested.has("--status") || requested.has("--activate")) {
          const data = await readStatus();
          report.status = {
            configured: data.configured === true,
            active: data.active === true,
            activeRelease: typeof data.activeRelease === "string" ? data.activeRelease : null,
            unsafePendingMutations: Number.isInteger(data.unsafePendingMutations)
              ? data.unsafePendingMutations
              : null,
            reconciliationRequired: Number.isInteger(data.reconciliationRequired)
              ? data.reconciliationRequired
              : null,
            reconciliationRequiredMutations: Number.isInteger(data.reconciliationRequiredMutations)
              ? data.reconciliationRequiredMutations
              : null,
            lastWakeOutcome: data.lastWake && typeof data.lastWake === "object"
              ? data.lastWake.outcome ?? null
              : null,
            internalSchedules: data.internalSchedules && typeof data.internalSchedules === "object"
              ? data.internalSchedules
              : {},
          };
        }

        process.stdout.write(`${JSON.stringify(report)}\n`);
      }
    }
  }
}
