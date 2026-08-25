import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKER_RPC_TIMEOUT_MS,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../lib/worker-rpc";

test("worker RPC failures distinguish invalid credentials from transient infrastructure errors", () => {
  assert.equal(workerRpcErrorStatus({ code: "42501" }), 401);
  assert.equal(workerRpcErrorStatus({ code: "57014" }), 503);
  assert.equal(workerRpcErrorStatus({ code: null }), 503);
  assert.equal(workerRpcErrorStatus(null), 503);
  assert.match(workerRpcErrorMessage(401), /토큰/);
  assert.match(workerRpcErrorMessage(503), /데이터베이스/);
  assert.equal(WORKER_RPC_TIMEOUT_MS, 8_000);
});
