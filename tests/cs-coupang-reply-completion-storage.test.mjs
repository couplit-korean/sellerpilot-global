import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL(
  "../app/api/channel-gateway/worker/complete/route.ts",
  import.meta.url,
), "utf8");
const workerCompletionSource = await readFile(new URL(
  "../lib/cs/operations/worker-completion.ts",
  import.meta.url,
), "utf8");
const serverlessGatewaySource = await readFile(new URL(
  "../lib/channels/serverless-gateway.ts",
  import.meta.url,
), "utf8");
const serverlessCompletionSource = await readFile(new URL(
  "../lib/cs/operations/complete.ts",
  import.meta.url,
), "utf8");
const serverlessTests = await readFile(new URL(
  "./serverless-cs-gateway.test.ts",
  import.meta.url,
), "utf8");
const replyVerificationSource = await readFile(new URL(
  "../lib/channels/reply-verification.ts",
  import.meta.url,
), "utf8");

test("worker completion stores an inquiry reply result without list sanitization", () => {
  assert.match(routeSource, /completeCsWorker\(\{ serviceClient, tokenHash, job, completion:/u);
  assert.doesNotMatch(routeSource, /let storedResponse/u);

  const assignment = workerCompletionSource.indexOf("storedResponse = qoo10ReadbackCompletion");
  const completion = workerCompletionSource.indexOf(
    'serviceClient.rpc("sellerpilot_service_complete_gateway_transaction"',
    assignment,
  );
  assert.ok(assignment > 0);
  assert.ok(completion > assignment);
  const replyStoragePath = workerCompletionSource.slice(assignment, completion);
  assert.match(
    replyStoragePath,
    /storedResponse = qoo10ReadbackCompletion[\s\S]*?: parsed\.data\.result;/u,
  );
  assert.doesNotMatch(
    replyStoragePath,
    /job\.operation === "inquiries\.reply"[\s\S]{0,200}storedResponse\s*=/u,
  );
  assert.match(
    workerCompletionSource.slice(completion, completion + 800),
    /p_response_payload: storedResponse/u,
  );
});

test("serverless completion sanitizes list results only and preserves reply acceptance", () => {
  assert.match(serverlessGatewaySource, /return completeCsClaim\(dependencies, gatewayTokenHash, job,/u);
  assert.doesNotMatch(serverlessGatewaySource, /function sanitizedInquiryListResult/u);

  const assignment = serverlessCompletionSource.indexOf("storedResponse = parsed.data.result;");
  const completion = serverlessCompletionSource.indexOf(
    "p_response_payload: storedResponse",
    assignment,
  );
  assert.ok(assignment > 0);
  assert.ok(completion > assignment);
  const storagePath = serverlessCompletionSource.slice(assignment, completion);
  assert.match(storagePath, /job\.operation === "inquiries\.list"/u);
  assert.match(storagePath, /storedResponse = sanitizedInquiryListResult/u);
  assert.doesNotMatch(storagePath, /job\.operation === "orders\.list"/u);
  assert.doesNotMatch(storagePath, /job\.operation === "inquiries\.reply"/u);

  assert.match(
    serverlessTests,
    /for \(const channel of \["ebay", "coupang", "elevenst", "smartstore", "qoo10"\][\s\S]*?assert\.deepEqual\(complete\?\.arguments_\.p_response_payload, inquiryReplyResult\(channel\)\);/u,
  );
  assert.match(
    serverlessTests,
    /sellerpilotReplyAcceptance: replyAcceptanceMarker\(/u,
  );
  assert.match(
    replyVerificationSource,
    /replyAcceptanceContract = "sellerpilot-reply-acceptance\/1"/u,
  );
});
