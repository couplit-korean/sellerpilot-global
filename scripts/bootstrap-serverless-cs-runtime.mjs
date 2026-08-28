import { createHash, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_SUPABASE_HOST = "sqaoqucxakebqkiygdxb.supabase.co";
const PRODUCTION_ORIGIN = "https://sellerpilot-global.vercel.app";
const WAKE_LABEL = "sellerpilot:channel-gateway-drain:wake:v1";
const GATEWAY_LABEL = "sellerpilot:channel-gateway-drain:gateway:v1";
const SCHEDULER_LABEL = "sellerpilot:channel-gateway-drain:scheduler:v1";
const DRAIN_MODE_HEADER = "x-sellerpilot-drain-mode";
const CANARY_MODE = "canary-v1";

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

const requested = new Set(process.argv.slice(2));
const allowed = new Set(["--bootstrap", "--canary", "--activate", "--status"]);
if (!requested.size || [...requested].some((argument) => !allowed.has(argument))) {
  fail("usage: node scripts/bootstrap-serverless-cs-runtime.mjs --bootstrap [--canary --activate] [--status]");
} else {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    parsedUrl = null;
  }
  if (parsedUrl?.protocol !== "https:" || parsedUrl.hostname !== EXPECTED_SUPABASE_HOST) {
    fail("exact SellerPilot Supabase project is not configured");
  } else if (!serviceKey || cronSecret.length < 16) {
    fail("SellerPilot server runtime secrets are not available");
  } else {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
    });
    const wakeBearer = createHmac("sha256", cronSecret).update(WAKE_LABEL, "utf8").digest("base64url");
    const gateway = tokenMetadata(derivedToken(cronSecret, GATEWAY_LABEL));
    const scheduler = tokenMetadata(derivedToken(cronSecret, SCHEDULER_LABEL));
    const report = {};
    let canaryPassed = false;

    if (requested.has("--bootstrap")) {
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
      const response = await fetch(`${PRODUCTION_ORIGIN}/api/internal/channel-gateway-drain`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${wakeBearer}`,
          "content-type": "application/json",
          [DRAIN_MODE_HEADER]: CANARY_MODE,
        },
        body: "{}",
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json().catch(() => null);
      canaryPassed = response.ok
        && Boolean(payload)
        && typeof payload === "object"
        && payload.status === "canary"
        && payload.claimed === 0
        && payload.processed === 0;
      if (!canaryPassed) throw new Error(`serverless CS production canary failed (${response.status})`);
      report.canary = {
        status: response.status,
        outcome: typeof payload.status === "string" ? payload.status : "accepted",
      };
    }

    if (requested.has("--activate")) {
      if (!requested.has("--canary") || !canaryPassed) {
        throw new Error("scheduler activation requires a successful canary in the same process");
      }
      const { data, error } = await supabase.rpc("sellerpilot_service_set_serverless_cs_wakeup_active", {
        p_active: true,
      });
      if (error || !data || data.active !== true) throw new Error("serverless CS scheduler activation failed");
      report.scheduler = { configured: true, active: true };
    }

    if (requested.has("--status") || requested.has("--activate")) {
      const { data, error } = await supabase.rpc("sellerpilot_service_serverless_cs_wakeup_status");
      if (error || !data || typeof data !== "object") throw new Error("serverless CS scheduler status unavailable");
      report.status = {
        configured: data.configured === true,
        active: data.active === true,
        lastWakeOutcome: data.lastWake && typeof data.lastWake === "object"
          ? data.lastWake.outcome ?? null
          : null,
      };
    }

    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
}
