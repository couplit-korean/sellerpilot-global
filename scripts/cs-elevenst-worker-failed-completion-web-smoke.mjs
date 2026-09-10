import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  buildGatewayWorkerFailedCompletionPayload,
} from "../lib/channels/cs/elevenst/worker-completion.ts";

if (process.env.NODE_ENV !== "test") {
  throw new Error("ELEVENST_WORKER_COMPLETION_SMOKE_TEST_RUNTIME_REQUIRED");
}

const host = "127.0.0.1";
const portArgument = process.argv.find((value) => value.startsWith("--port="))?.slice(7) ?? "3214";
if (!/^\d{1,5}$/u.test(portArgument)) throw new Error("ELEVENST_WORKER_COMPLETION_PORT_INVALID");
const webPort = Number(portArgument);
if (!Number.isSafeInteger(webPort) || webPort < 1 || webPort > 65_535) {
  throw new Error("ELEVENST_WORKER_COMPLETION_PORT_INVALID");
}

const businessJob = {
  id: "10000000-0000-4000-8000-000000000011",
  channel: "elevenst",
  operation: "inquiries.list",
};
const transportJob = { ...businessJob, id: "10000000-0000-4000-8000-000000000012" };
const claimToken = "20000000-0000-4000-8000-000000000011";
const credentialId = "30000000-0000-4000-8000-000000000011";
const workerToken = `spw_${randomBytes(24).toString("base64url")}`;

function business500() {
  return {
    ok: false,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: false,
      status: 200,
      data: {
        accepted: false,
        resultCode: "500",
        productQnas: [],
        sellerpilotInquiryKind: "product_qna",
        message: "raw provider message",
        memID: "must-not-cross-worker-boundary",
      },
    }],
    safeMessage: "provider body must not cross the worker boundary",
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function body(request) {
  let value = "";
  for await (const chunk of request) value += chunk;
  return JSON.parse(value || "{}");
}

const calls = [];
let supabaseServer;
let webProcess;

try {
  supabaseServer = createServer(async (request, response) => {
    const match = request.url?.match(/^\/rest\/v1\/rpc\/([^?]+)$/u);
    if (!match) return json(response, 404, { code: "not_found" });
    const name = match[1];
    const arguments_ = await body(request);
    calls.push({ name, arguments_ });
    if (name === "sellerpilot_service_gateway_completion_context") {
      assert.ok([businessJob.id, transportJob.id].includes(arguments_.p_job_id));
      assert.equal(arguments_.p_claim_token, claimToken);
      return json(response, 200, {
        status: "running",
        channel: "elevenst",
        operation: "inquiries.list",
        credential_id: credentialId,
        normalization_timestamp: "2026-09-08T08:00:00.000Z",
        publication_verification_boundary: null,
        request: {
          arguments: {
            kind: "product_qna",
            startDate: "20260902",
            endDate: "20260908",
            answerStatus: "00",
          },
        },
      });
    }
    if (name === "sellerpilot_service_complete_gateway_transaction") {
      return json(response, 200, { status: "completed" });
    }
    if (name === "sellerpilot_service_record_elevenst_cs_read_v1") {
      return json(response, 200, { contract: "sellerpilot-elevenst-cs-read-record/1" });
    }
    return json(response, 400, { code: "unexpected_rpc", name });
  });
  const supabaseAddress = await listen(supabaseServer, 0);
  assert.ok(supabaseAddress && typeof supabaseAddress === "object");

  let stdout = "";
  let stderr = "";
  webProcess = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", "dev", "--webpack", "--port", String(webPort), "--hostname", host,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: `http://${host}:${supabaseAddress.port}`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: randomBytes(24).toString("base64url"),
      SUPABASE_SECRET_KEY: randomBytes(24).toString("base64url"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  webProcess.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
  webProcess.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
  const endpoint = `http://${host}:${webPort}/api/channel-gateway/worker/complete`;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (webProcess.exitCode !== null) break;
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (response.status === 401) {
        ready = true;
        break;
      }
    } catch {
      // The isolated Next runtime is still compiling the completion route.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`ELEVENST_WORKER_COMPLETION_START_FAILED:${stderr.slice(-1_000)}:${stdout.slice(-1_000)}`);

  const businessPayload = buildGatewayWorkerFailedCompletionPayload({
    job: businessJob,
    claimToken,
    error: "11st Product Q&A business error.",
    result: business500(),
  });
  assert.equal("result" in businessPayload, true);
  assert.doesNotMatch(JSON.stringify(businessPayload), /raw provider|memID|must-not-cross/u);
  const businessResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${workerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(businessPayload),
  });
  assert.equal(businessResponse.status, 200, await businessResponse.text());

  const transportPayload = buildGatewayWorkerFailedCompletionPayload({
    job: transportJob,
    claimToken,
    error: "fetch failed",
  });
  assert.equal("result" in transportPayload, false);
  const transportResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${workerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(transportPayload),
  });
  assert.equal(transportResponse.status, 200, await transportResponse.text());

  const completions = calls.filter(({ name }) => name === "sellerpilot_service_complete_gateway_transaction");
  assert.equal(completions.length, 2);
  assert.deepEqual(completions[0].arguments_.p_response_payload, {
    ok: false,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries-normalized",
      ok: false,
      status: 200,
      data: {
        sellerpilotMarker: "normalized_inquiries_v1",
        normalizedInquiryCount: 0,
        providerStepCount: 1,
      },
    }],
    safeMessage: "문의 동기화 결과를 정규화해 저장했습니다.",
  });
  assert.equal(completions[0].arguments_.p_status, "failed");
  assert.equal(completions[1].arguments_.p_response_payload, null);
  assert.equal(completions[1].arguments_.p_status, "failed");

  const observations = calls.filter(({ name }) => name === "sellerpilot_service_record_elevenst_cs_read_v1");
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0].arguments_.p_inquiries, []);
  assert.equal(observations[0].arguments_.p_observation.accepted, false);
  assert.equal(observations[0].arguments_.p_observation.resultCode, "500");
  assert.doesNotMatch(JSON.stringify(calls), /raw provider|memID|must-not-cross|provider body/u);

  process.stdout.write(`${JSON.stringify({
    contractVersion: "sellerpilot-elevenst-worker-failed-completion/1",
    webRuntime: "next-dev",
    webPort,
    businessCompletionStatus: businessResponse.status,
    businessResultForwarded: true,
    businessStoredMarker: completions[0].arguments_.p_response_payload.steps[0].data.sellerpilotMarker,
    businessObservationRecorded: true,
    transportCompletionStatus: transportResponse.status,
    transportResultForwarded: false,
    transportStoredResponse: null,
    transportObservationRecorded: false,
    providerWrites: 0,
    productionDatabaseWrites: 0,
    customerReplies: 0,
  })}\n`);
} finally {
  await stopProcess(webProcess);
  if (supabaseServer?.listening) await close(supabaseServer);
}
