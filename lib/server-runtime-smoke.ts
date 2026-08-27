import { timingSafeEqual } from "node:crypto";

export const AI_GATEWAY_SMOKE_MODEL = "openai/gpt-5.4-mini";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
const MAX_REQUEST_BODY_BYTES = 512;
const SANDBOX_CREATE_TIMEOUT_MS = 20_000;
const SANDBOX_LIFETIME_MS = 30_000;
const SANDBOX_COMMAND_TIMEOUT_MS = 5_000;
const SANDBOX_STOP_TIMEOUT_MS = 10_000;

const runtimeSmokeActions = ["readiness", "ai_gateway_smoke", "sandbox_smoke"] as const;
type RuntimeSmokeAction = (typeof runtimeSmokeActions)[number];

type AiGatewaySmokeOutput = {
  status: "ok";
  runtime: "vercel-function-oidc";
};

export type AiGatewaySmokeDependencies = {
  getOidcToken: () => Promise<string>;
  request: (input: { oidcToken: string; model: string }) => Promise<AiGatewaySmokeOutput>;
  now?: () => number;
};

type SandboxCreateOptions = {
  image: "vercel/sandbox/universal:latest";
  timeout: number;
  persistent: false;
  resources: { vcpus: 1 };
  networkPolicy: "deny-all";
  tags: { purpose: "synthetic-smoke" };
  signal: AbortSignal;
};

type SandboxCommandOptions = {
  cmd: "node";
  args: ["-e", string];
  timeoutMs: number;
  signal: AbortSignal;
};

type SandboxCommandResult = {
  exitCode: number;
  stdout: (options?: { signal?: AbortSignal }) => Promise<string>;
  stderr: (options?: { signal?: AbortSignal }) => Promise<string>;
};

type SyntheticSandbox = {
  runCommand: (options: SandboxCommandOptions) => Promise<SandboxCommandResult>;
  stop: (options?: { signal?: AbortSignal }) => Promise<unknown>;
};

export type SandboxSmokeDependencies = {
  create: (options: SandboxCreateOptions) => Promise<SyntheticSandbox>;
  now?: () => number;
};

type RuntimeSmokeRunners = {
  aiGateway: () => Promise<Record<string, unknown>>;
  sandbox: () => Promise<Record<string, unknown>>;
};

type RuntimeSmokeHandlerOptions = {
  cronSecret?: string;
  runners?: RuntimeSmokeRunners;
};

type SmokeErrorCode =
  | "oidc_unavailable"
  | "gateway_request_failed"
  | "gateway_response_invalid"
  | "sandbox_unavailable"
  | "sandbox_command_failed"
  | "sandbox_response_invalid"
  | "sandbox_cleanup_failed";

class SmokeExecutionError extends Error {
  readonly code: SmokeErrorCode;

  constructor(code: SmokeErrorCode) {
    super(code);
    this.name = "SmokeExecutionError";
    this.code = code;
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE_HEADERS });
}

function bearerMatches(request: Request, cronSecret: string) {
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function oidcHintPresent(request: Request) {
  return Boolean(
    request.headers.get("x-vercel-oidc-token")
      || process.env.VERCEL_OIDC_TOKEN?.trim(),
  );
}

function readiness(request: Request) {
  return {
    ok: true,
    mode: "readiness",
    executionRequested: false,
    vercelDeployment: process.env.VERCEL === "1",
    oidcHintPresent: oidcHintPresent(request),
    capabilities: {
      aiGateway: {
        installed: true,
        auth: "vercel_oidc_only",
        model: AI_GATEWAY_SMOKE_MODEL,
        execution: "explicit_post_only",
      },
      sandbox: {
        installed: true,
        image: "vercel/sandbox/universal:latest",
        network: "deny_all",
        lifecycle: "ephemeral_stop_after_command",
        execution: "explicit_post_only",
      },
    },
    boundaries: {
      syntheticInputOnly: true,
      productClaims: false,
      customerData: false,
      marketplaceWrites: false,
      databaseAccess: false,
    },
    actions: runtimeSmokeActions,
  };
}

async function withTimeoutSignal<T>(timeoutMs: number, action: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await action(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function defaultOidcToken() {
  const { getVercelOidcToken } = await import("@vercel/oidc");
  return getVercelOidcToken({ expirationBufferMs: 30_000 });
}

async function defaultAiGatewayRequest(input: { oidcToken: string; model: string }): Promise<AiGatewaySmokeOutput> {
  const [{ createGateway, generateText, Output }, { z }] = await Promise.all([
    import("ai"),
    import("zod"),
  ]);
  const oidcGateway = createGateway({
    apiKey: input.oidcToken,
    headers: { "ai-gateway-auth-method": "oidc" },
  });
  const result = await generateText({
    model: oidcGateway(input.model),
    output: Output.object({
      schema: z.object({
        status: z.literal("ok"),
        runtime: z.literal("vercel-function-oidc"),
      }).strict(),
    }),
    prompt: "Return the requested synthetic readiness object. Do not use tools, web data, customer data, or product data.",
    maxOutputTokens: 64,
    maxRetries: 0,
    timeout: 15_000,
    providerOptions: {
      gateway: {
        user: "sellerpilot-server-runtime-smoke",
        tags: ["feature:server-runtime-smoke", "data:synthetic"],
        zeroDataRetention: true,
        disallowPromptTraining: true,
      },
    },
  });
  return result.output;
}

export async function runSyntheticAiGatewaySmoke(
  dependencies: AiGatewaySmokeDependencies = {
    getOidcToken: defaultOidcToken,
    request: defaultAiGatewayRequest,
  },
) {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let oidcToken: string;
  try {
    oidcToken = await dependencies.getOidcToken();
  } catch {
    throw new SmokeExecutionError("oidc_unavailable");
  }
  if (!oidcToken || oidcToken.length > 16_384) {
    throw new SmokeExecutionError("oidc_unavailable");
  }

  let output: AiGatewaySmokeOutput;
  try {
    output = await dependencies.request({ oidcToken, model: AI_GATEWAY_SMOKE_MODEL });
  } catch {
    throw new SmokeExecutionError("gateway_request_failed");
  }
  if (output.status !== "ok" || output.runtime !== "vercel-function-oidc") {
    throw new SmokeExecutionError("gateway_response_invalid");
  }
  return {
    ok: true,
    action: "ai_gateway_smoke",
    auth: "vercel_oidc",
    model: AI_GATEWAY_SMOKE_MODEL,
    response: output,
    durationMs: Math.max(0, now() - startedAt),
  };
}

async function defaultCreateSandbox(options: SandboxCreateOptions): Promise<SyntheticSandbox> {
  const { Sandbox } = await import("@vercel/sandbox");
  return Sandbox.create(options);
}

function parseSandboxOutput(stdout: string, stderr: string) {
  if (stdout.length > 512 || stderr.trim()) throw new SmokeExecutionError("sandbox_response_invalid");
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new SmokeExecutionError("sandbox_response_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SmokeExecutionError("sandbox_response_invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== "arch,nodeVersion,platform"
      || candidate.platform !== "linux"
      || typeof candidate.arch !== "string"
      || !/^[a-z0-9_-]{1,24}$/i.test(candidate.arch)
      || typeof candidate.nodeVersion !== "string"
      || !/^\d+\.\d+\.\d+$/.test(candidate.nodeVersion)) {
    throw new SmokeExecutionError("sandbox_response_invalid");
  }
  return {
    platform: "linux" as const,
    arch: candidate.arch,
    nodeVersion: candidate.nodeVersion,
  };
}

export async function runSyntheticSandboxSmoke(
  dependencies: SandboxSmokeDependencies = { create: defaultCreateSandbox },
) {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let sandbox: SyntheticSandbox;
  try {
    sandbox = await withTimeoutSignal(SANDBOX_CREATE_TIMEOUT_MS, (signal) => dependencies.create({
      image: "vercel/sandbox/universal:latest",
      timeout: SANDBOX_LIFETIME_MS,
      persistent: false,
      resources: { vcpus: 1 },
      networkPolicy: "deny-all",
      tags: { purpose: "synthetic-smoke" },
      signal,
    }));
  } catch {
    throw new SmokeExecutionError("sandbox_unavailable");
  }

  let output: ReturnType<typeof parseSandboxOutput> | null = null;
  let executionError: SmokeExecutionError | null = null;
  try {
    const command = await withTimeoutSignal(SANDBOX_COMMAND_TIMEOUT_MS + 1_000, (signal) => sandbox.runCommand({
      cmd: "node",
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({platform:process.platform,arch:process.arch,nodeVersion:process.versions.node}))",
      ],
      timeoutMs: SANDBOX_COMMAND_TIMEOUT_MS,
      signal,
    }));
    if (command.exitCode !== 0) throw new SmokeExecutionError("sandbox_command_failed");
    const [stdout, stderr] = await withTimeoutSignal(2_000, (signal) => Promise.all([
      command.stdout({ signal }),
      command.stderr({ signal }),
    ]));
    output = parseSandboxOutput(stdout, stderr);
  } catch (error) {
    executionError = error instanceof SmokeExecutionError
      ? error
      : new SmokeExecutionError("sandbox_command_failed");
  }

  try {
    await withTimeoutSignal(SANDBOX_STOP_TIMEOUT_MS, (signal) => sandbox.stop({ signal }));
  } catch {
    throw new SmokeExecutionError("sandbox_cleanup_failed");
  }
  if (executionError) throw executionError;
  if (!output) throw new SmokeExecutionError("sandbox_response_invalid");

  return {
    ok: true,
    action: "sandbox_smoke",
    isolation: "ephemeral_linux_microvm",
    network: "deny_all",
    stopped: true,
    response: output,
    durationMs: Math.max(0, now() - startedAt),
  };
}

const defaultRunners: RuntimeSmokeRunners = {
  aiGateway: runSyntheticAiGatewaySmoke,
  sandbox: runSyntheticSandboxSmoke,
};

async function parseAction(request: Request): Promise<RuntimeSmokeAction | null> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) return null;
  const body = await request.text();
  if (body.length > MAX_REQUEST_BODY_BYTES) return null;
  if (!body.trim()) return "readiness";
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => key !== "action")) return null;
  const action = candidate.action ?? "readiness";
  return typeof action === "string" && runtimeSmokeActions.includes(action as RuntimeSmokeAction)
    ? action as RuntimeSmokeAction
    : null;
}

function executionFailure(action: Exclude<RuntimeSmokeAction, "readiness">, error: unknown) {
  const code: SmokeErrorCode = error instanceof SmokeExecutionError
    ? error.code
    : action === "ai_gateway_smoke"
      ? "gateway_request_failed"
      : "sandbox_command_failed";
  const status = code === "oidc_unavailable" || code === "sandbox_unavailable" ? 503 : 502;
  const message = action === "ai_gateway_smoke"
    ? "Vercel OIDC 기반 AI Gateway 합성 점검을 완료하지 못했습니다."
    : "격리된 Linux Sandbox 합성 점검을 완료하지 못했습니다.";
  return json({ ok: false, action, executionRequested: true, code, message }, status);
}

export async function handleServerRuntimeSmoke(
  request: Request,
  options: RuntimeSmokeHandlerOptions = {},
) {
  const cronSecret = options.cronSecret ?? process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret) {
    return json({ ok: false, message: "서버 진단 인증값이 설정되지 않았습니다." }, 503);
  }
  if (!bearerMatches(request, cronSecret)) {
    return json({ ok: false, message: "서버 진단 인증이 필요합니다." }, 401);
  }
  if (request.method === "GET") return json(readiness(request));
  if (request.method !== "POST") return json({ ok: false, message: "지원하지 않는 요청 방식입니다." }, 405);

  const action = await parseAction(request);
  if (!action) return json({ ok: false, message: "허용된 합성 진단 작업을 지정해야 합니다." }, 400);
  if (action === "readiness") return json(readiness(request));

  const runners = options.runners ?? defaultRunners;
  try {
    const result = action === "ai_gateway_smoke"
      ? await runners.aiGateway()
      : await runners.sandbox();
    return json({ ...result, executionRequested: true });
  } catch (error) {
    return executionFailure(action, error);
  }
}
