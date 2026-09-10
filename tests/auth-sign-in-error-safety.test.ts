import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthApiError,
  AuthInvalidCredentialsError,
  AuthRetryableFetchError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import { getSafeSignInError } from "../lib/auth-sign-in-error-safety.ts";

const messages = {
  credentials: "아이디 또는 비밀번호를 확인해 주세요.",
  rateLimit: "로그인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  service: "로그인 서버가 일시적으로 응답하지 못하고 있습니다. 잠시 후 다시 시도해 주세요.",
  network: "로그인 서버에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.",
  cancelled: "로그인 요청이 중단되었습니다. 로그인 화면에서 다시 진행해 주세요.",
  unknown: "로그인을 완료하지 못했습니다. 문제가 계속되면 관리자에게 문의해 주세요.",
};
const upstream = "test-only-secret-sentinel: key/token/private upstream diagnostic";

test("real SDK invalid_credentials is the only credential-error signal", () => {
  assert.equal(getSafeSignInError(new AuthApiError(upstream, 400, "invalid_credentials")), messages.credentials);
  assert.equal(getSafeSignInError({ code: "invalid_credentials" }), messages.credentials);
  for (const error of [
    new AuthApiError("Invalid login credentials", 400, undefined),
    new AuthApiError(upstream, 401, "bad_jwt"),
    new AuthInvalidCredentialsError("You must provide an email and password"),
    { name: "AuthInvalidCredentialsError", status: 400 },
    { code: "INVALID_CREDENTIALS" },
    { code: " invalid_credentials " },
    { error_code: "invalid_credentials" },
    "invalid_credentials",
  ]) assert.equal(getSafeSignInError(error), messages.unknown);
});

test("real SDK 429 and typed rate-limit codes receive a safe rate-limit message", () => {
  assert.equal(getSafeSignInError(new AuthApiError(upstream, 429, undefined)), messages.rateLimit);
  for (const code of ["over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit"]) {
    assert.equal(getSafeSignInError(new AuthApiError(upstream, 400, code)), messages.rateLimit);
  }
});

test("all HTTP 5xx and unexpected_failure are server failures, never bad passwords", () => {
  for (let status = 500; status <= 599; status += 1) {
    assert.equal(getSafeSignInError(new AuthApiError(upstream, status, undefined)), messages.service);
    assert.equal(getSafeSignInError(new AuthRetryableFetchError(upstream, status)), messages.service);
  }
  assert.equal(getSafeSignInError(new AuthApiError(upstream, 400, "unexpected_failure")), messages.service);
  assert.equal(getSafeSignInError({ code: "unexpected_failure" }), messages.service);
});

test("SDK retryable transport errors distinguish no-response from 503/504", () => {
  assert.equal(getSafeSignInError(new AuthRetryableFetchError(upstream, 0)), messages.network);
  assert.equal(getSafeSignInError(new AuthRetryableFetchError(upstream, 503)), messages.service);
  assert.equal(getSafeSignInError(new AuthRetryableFetchError(upstream, 504)), messages.service);
  assert.equal(getSafeSignInError({ name: "RetryableFetchError", message: upstream }), messages.network);
});

test("exact browser and Node transport signals are classified without echoing text", () => {
  for (const text of ["Failed to fetch", "fetch failed", "Network request failed", "Load failed", "NetworkError when attempting to fetch resource."]) {
    assert.equal(getSafeSignInError(new TypeError(text)), messages.network);
  }
  for (const code of ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "request_timeout"]) {
    assert.equal(getSafeSignInError({ code, message: upstream }), messages.network);
  }
  assert.equal(getSafeSignInError(new DOMException(upstream, "NetworkError")), messages.network);
  assert.equal(getSafeSignInError(new DOMException(upstream, "TimeoutError")), messages.network);
});

test("an aborted login is not a credential error and causes no automatic retry", () => {
  assert.equal(getSafeSignInError(new DOMException(upstream, "AbortError")), messages.cancelled);
});

test("conflicting infrastructure evidence takes precedence over credential code", () => {
  for (const status of [500, 503, 504, 544]) {
    assert.equal(getSafeSignInError({ code: "invalid_credentials", status }), messages.service);
  }
  assert.equal(getSafeSignInError({ code: "invalid_credentials", status: 429 }), messages.rateLimit);
  assert.equal(getSafeSignInError({ code: "invalid_credentials", name: "AuthRetryableFetchError", status: 0 }), messages.network);
});

test("unknown 4xx, account conditions and legacy message-only failures stay generic", () => {
  for (const code of ["email_not_confirmed", "user_banned", "user_not_found", "validation_failed", "captcha_failed", "future_sdk_code"]) {
    assert.equal(getSafeSignInError(new AuthApiError(upstream, 400, code)), messages.unknown);
  }
  for (const status of [200, 400, 401, 403, 404, 408, 422, 499]) {
    assert.equal(getSafeSignInError({ status, message: "invalid_credentials" }), messages.unknown);
  }
  assert.equal(getSafeSignInError(new TypeError("Cannot read properties of undefined")), messages.unknown);
  assert.equal(getSafeSignInError(new TypeError("Failed to fetch " + upstream)), messages.unknown);
  assert.equal(getSafeSignInError(new AuthUnknownError(upstream, new Error(upstream))), messages.unknown);
});

test("unknown input does not coerce status/code, serialize, or leak any raw values", () => {
  const inputs: unknown[] = [undefined, null, false, 0, 429, upstream, Symbol(upstream), [],
    { status: "429" }, { status: NaN }, { status: Infinity }, { status: 600 },
    { code: { toString() { throw new Error("must not coerce"); } } },
    { message: upstream, stack: upstream, cause: upstream, token: upstream },
    { toString() { throw new Error("must not stringify"); } },
  ];
  for (const input of inputs) assert.equal(getSafeSignInError(input), messages.unknown);
});

test("throwing accessors and proxies cannot break the login error handler", () => {
  const unsafe = new Proxy({}, { get() { throw new Error(upstream); } });
  assert.equal(getSafeSignInError(unsafe), messages.unknown);
  assert.equal(getSafeSignInError({ name: "TypeError", get message() { throw new Error(upstream); } }), messages.unknown);
});

test("structured errors never read upstream message getters", () => {
  for (const input of [
    { code: "invalid_credentials" }, { status: 429 }, { status: 503 },
    { name: "AuthRetryableFetchError", status: 0 }, { name: "AbortError" },
  ]) {
    let reads = 0;
    const error = Object.defineProperty(input, "message", { get() { reads += 1; throw new Error(upstream); } });
    const result = getSafeSignInError(error);
    assert.equal(reads, 0);
    assert.ok(Object.values(messages).includes(result));
    assert.ok(!result.includes(upstream));
  }
});

test("classifier neither mutates errors nor executes retry/reset callbacks", () => {
  let calls = 0;
  const error = Object.freeze({ code: "unexpected_failure", message: upstream,
    retry() { calls += 1; }, resetPassword() { calls += 1; },
  });
  assert.equal(getSafeSignInError(error), messages.service);
  assert.equal(getSafeSignInError(error), messages.service);
  assert.equal(calls, 0);
  assert.equal(error.message, upstream);
});
