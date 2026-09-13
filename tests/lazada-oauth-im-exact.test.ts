import assert from "node:assert/strict";
import test from "node:test";
import {
  executeLazadaImExactOAuth,
  lazadaImExactAdminInput,
  lazadaImExactCountries,
  lazadaImExactSellerIds,
  lazadaImExactWorkerInput,
  parseLazadaImExactClaim,
  runLazadaImExactJob,
} from "../lib/channels/lazada-oauth-im-exact";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import type { CredentialRefreshSnapshot, RemoteResponse, SecretPayload } from "../lib/channels/protocols";

const sessionId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const claimToken = "33333333-3333-4333-8333-333333333333";
const credentialId = "44444444-4444-4444-8444-444444444444";

const commerceRows = lazadaImExactCountries.map((country, index) => ({
  country,
  seller_id: lazadaImExactSellerIds[country],
  user_id: String(900_001 + index),
}));
const source: SecretPayload = withLazadaProviderAccountIdentity({
  app_key: "137451",
  app_secret: "commerce-secret-must-remain",
  access_token: "commerce-access-must-remain",
  refresh_token: "commerce-refresh-must-remain",
  access_token_expires_at: "2098-01-01T00:00:00.000Z",
  refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
  country: "my",
  im_app_key: "137571",
  im_app_secret: "im-secret-must-remain",
  im_access_token: "old-im-access",
  im_refresh_token: "old-im-refresh",
}, { account_platform: "seller_center", country_user_info: commerceRows }).payload;

function claim(credential = source, code = "0_137571_fixture-single-use-code") {
  return {
    id: jobId,
    claim_token: claimToken,
    credential_id: credentialId,
    channel: "lazada",
    operation: "oauth.exchange",
    environment: "production",
    attempt_count: 1,
    request: {
      code,
      country: "cb",
      lazadaImExactSession: sessionId,
      oauthPurpose: "im_cross_border",
      codeDelivery: "single",
    },
    credential,
  };
}

const tokenData = {
  code: "0",
  access_token: "new-im-access-secret",
  refresh_token: "new-im-refresh-secret",
  expires_in: 3_600,
  refresh_expires_in: 7_200,
  account_platform: "seller_center",
  country_user_info: commerceRows,
};

function remote(data: Record<string, unknown>, ok = true): RemoteResponse {
  return {
    response: new Response(JSON.stringify(data), { status: ok ? 200 : 400 }),
    data,
    text: JSON.stringify(data),
  };
}

function hooks() {
  const events: string[] = [];
  const stages: CredentialRefreshSnapshot[] = [];
  return {
    events,
    stages,
    value: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginCredentialMutation: async () => { events.push("begin"); },
      beginOAuthProviderCall: async () => { events.push("provider"); },
      stageCredentialRefresh: async (snapshot: CredentialRefreshSnapshot) => {
        events.push(snapshot.recoveryOnly ? "recovery" : "active");
        stages.push(snapshot);
      },
    },
  };
}

test("route and worker schemas expose the exact integration ABI", () => {
  assert.equal(lazadaImExactAdminInput.parse({ action: "prepare", credentialId }).action, "prepare");
  assert.equal(lazadaImExactAdminInput.parse({
    action: "bind", sessionId, credentialId, state: "s".repeat(32), code: "fixture-code",
  }).action, "bind");
  assert.equal(lazadaImExactWorkerInput.parse({ action: "stage", sessionId }).action, "stage");
  assert.throws(() => lazadaImExactWorkerInput.parse({ action: "recover", sessionId }));
  assert.equal(parseLazadaImExactClaim(claim(), sessionId).request.country, "cb");
});

test("successful exchange fences once, stages recovery first, preserves commerce, then proves five countries", async () => {
  const h = hooks();
  let exchanges = 0;
  const readCountries: string[] = [];
  const result = await executeLazadaImExactOAuth(parseLazadaImExactClaim(claim(), sessionId), h.value, {
    now: () => new Date("2026-09-13T12:00:00.000Z"),
    exchangeToken: async (input) => {
      exchanges++;
      assert.deepEqual(input, {
        appKey: "137571",
        appSecret: "im-secret-must-remain",
        code: "0_137571_fixture-single-use-code",
      });
      return remote(tokenData);
    },
    readIm: async (input) => {
      const country = String(input.payload.country);
      readCountries.push(country);
      assert.equal(input.payload.im_access_token, "new-im-access-secret");
      assert.equal(input.path, "/im/session/list");
      return remote({ code: "0", request_id: `request-${country}`, data: { session_list: [] } });
    },
  });

  assert.equal(exchanges, 1);
  assert.deepEqual(readCountries, lazadaImExactCountries);
  assert.deepEqual(h.events.filter((event) => event === "begin" || event === "provider" || event === "recovery" || event === "active"),
    ["begin", "provider", "recovery", "begin", "active"]);
  assert.equal(h.stages.length, 2);
  assert.equal(h.stages[0]?.recoveryOnly, true);
  assert.equal(h.stages[0]?.payload.country, "my");
  assert.equal(h.stages[0]?.payload.provider_account_subject, source.provider_account_subject);
  assert.equal(h.stages[0]?.payload.identity_version, source.identity_version);
  assert.equal(h.stages[1]?.recoveryOnly, false);
  const active = h.stages[1]!.payload;
  const commerceKeys = Object.keys(source).filter((key) => !key.startsWith("im_"));
  for (const key of commerceKeys) {
    assert.deepEqual(h.stages[0]!.payload[key], source[key], `recovery ${key}`);
    assert.deepEqual(active[key], source[key], `active ${key}`);
  }
  assert.equal(active.im_app_secret, source.im_app_secret);
  assert.equal(active.im_access_token, "new-im-access-secret");
  assert.equal(active.im_refresh_token, "new-im-refresh-secret");
  assert.deepEqual(result.readbacks, [
    { country: "my", sellerId: "300872000183", httpStatus: 200, providerCode: "0", remoteRequestId: "request-my" },
    { country: "ph", sellerId: "501846640243", httpStatus: 200, providerCode: "0", remoteRequestId: "request-ph" },
    { country: "sg", sellerId: "1754224042", httpStatus: 200, providerCode: "0", remoteRequestId: "request-sg" },
    { country: "th", sellerId: "101407248667", httpStatus: 200, providerCode: "0", remoteRequestId: "request-th" },
    { country: "vn", sellerId: "201095728264", httpStatus: 200, providerCode: "0", remoteRequestId: "request-vn" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /new-im-access-secret|new-im-refresh-secret|commerce-secret-must-remain/u);
});

for (const scenario of ["missing-country", "extra-country", "seller-mismatch", "conflicting-variant", "invalid-expiry"] as const) {
  test(`${scenario} remains recovery-only and never performs a country read`, async () => {
    const h = hooks();
    let data: Record<string, unknown> = { ...tokenData };
    if (scenario === "missing-country") data = { ...data, country_user_info: commerceRows.slice(0, 4) };
    if (scenario === "extra-country") data = { ...data, country_user_info: [...commerceRows,
      { country: "id", seller_id: "123456", user_id: "999999" }] };
    if (scenario === "seller-mismatch") data = { ...data, country_user_info: commerceRows.map((row) =>
      row.country === "sg" ? { ...row, seller_id: "999999" } : row) };
    if (scenario === "conflicting-variant") data = { ...data,
      country_user_info_list: commerceRows.map((row) => row.country === "ph" ? { ...row, seller_id: "999999" } : row) };
    if (scenario === "invalid-expiry") data = { ...data, expires_in: 0 };
    let reads = 0;
    await assert.rejects(executeLazadaImExactOAuth(parseLazadaImExactClaim(claim(), sessionId), h.value, {
      exchangeToken: async () => remote(data),
      readIm: async () => { reads++; return remote({ code: "0", data: { session_list: [] } }); },
    }));
    assert.equal(h.stages.length, 1);
    assert.equal(h.stages[0]?.recoveryOnly, true);
    assert.equal(reads, 0);
  });
}

test("claim rejects the commerce app code and an incomplete certified commerce account", () => {
  const wrongCountry = claim();
  wrongCountry.request.country = "my";
  assert.throws(() => parseLazadaImExactClaim(wrongCountry, sessionId), /LAZADA_IM_EXACT_CLAIM_INVALID/u);
  assert.throws(() => parseLazadaImExactClaim(claim(source, "0_137451_wrong-app"), sessionId),
    /LAZADA_IM_EXACT_CLAIM_INVALID/u);
  const incomplete = withLazadaProviderAccountIdentity({ ...source }, {
    account_platform: "seller_center", country_user_info: commerceRows.slice(0, 1),
  }).payload;
  assert.throws(() => parseLazadaImExactClaim(claim(incomplete), sessionId), /LAZADA_IM_EXACT_CLAIM_INVALID/u);
});

test("worker call envelope fixes both stage variants and the final five-readback result", async () => {
  const calls: Record<string, unknown>[] = [];
  const call = async (body: Record<string, unknown>) => {
    calls.push(body);
    const action = String(body.action);
    if (action === "heartbeat") return { status: "running" };
    if (action === "begin") return { status: "in_flight" };
    if (action === "provider") return { status: "provider_started" };
    if (action === "stage") {
      const refresh = (body.payload as { refresh: CredentialRefreshSnapshot }).refresh;
      return { status: refresh.recoveryOnly ? "recovery_preserved" : "prepared" };
    }
    if (action === "complete") return { status: "completed" };
    return { status: "review" };
  };
  await runLazadaImExactJob(claim(), sessionId, call, {
    exchangeToken: async () => remote(tokenData),
    readIm: async (input) => remote({
      code: "0",
      request_id: `request-${String(input.payload.country)}`,
      data: { session_list: [] },
    }),
  });
  const stages = calls.filter((item) => item.action === "stage");
  assert.equal(stages.length, 2);
  assert.deepEqual(Object.keys((stages[0]!.payload as Record<string, unknown>)).sort(), ["refresh"]);
  assert.equal(((stages[0]!.payload as { refresh: CredentialRefreshSnapshot }).refresh).recoveryOnly, true);
  assert.equal(((stages[1]!.payload as { refresh: CredentialRefreshSnapshot }).refresh).recoveryOnly, false);
  const complete = calls.find((item) => item.action === "complete")!;
  const result = (complete.payload as { result: Record<string, unknown> }).result;
  assert.deepEqual(Object.keys(result).sort(), ["channel", "ok", "operation", "readbacks"]);
  assert.equal((result.readbacks as unknown[]).length, 5);
  assert.doesNotMatch(JSON.stringify(result), /new-im-access-secret|new-im-refresh-secret|im-secret-must-remain/u);
});

test("an uncertain readback marks review and exposes no provider or credential detail", async () => {
  let exchanges = 0;
  let reads = 0;
  const actions: string[] = [];
  const call = async (body: Record<string, unknown>) => {
    const action = String(body.action);
    actions.push(action);
    if (action === "heartbeat") return { status: "running" };
    if (action === "begin") return { status: "in_flight" };
    if (action === "provider") return { status: "provider_started" };
    if (action === "stage") {
      const refresh = (body.payload as { refresh: CredentialRefreshSnapshot }).refresh;
      return { status: refresh.recoveryOnly ? "recovery_preserved" : "prepared" };
    }
    if (action === "review") return { status: "review" };
    return { status: "completed" };
  };
  let captured = "";
  try {
    await runLazadaImExactJob(claim(), sessionId, call, {
      exchangeToken: async () => { exchanges++; return remote(tokenData); },
      readIm: async () => {
        reads++;
        return reads === 2
          ? remote({ code: "IllegalAccessToken", detail: "new-im-access-secret" })
          : remote({ code: "0", request_id: `request-${reads}`, data: { session_list: [] } });
      },
    });
  } catch (error) {
    captured = String(error);
  }
  assert.equal(exchanges, 1);
  assert.equal(reads, 2);
  assert.equal(actions.at(-1), "review");
  assert.match(captured, /LAZADA_IM_EXACT_REVIEW_REQUIRED_NO_REPLAY/u);
  assert.doesNotMatch(captured, /IllegalAccessToken|new-im-access-secret|im-secret-must-remain/u);
});
