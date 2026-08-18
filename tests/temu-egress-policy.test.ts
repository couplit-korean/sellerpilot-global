import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTemuEgressIp, parseTemuEgressAllowlist, temuEgressErrorCodes } from "../lib/channels/temu-egress-policy";

test("Temu egress allowlist accepts IPv4 and IPv6 values and removes duplicates", () => {
  assert.deepEqual(parseTemuEgressAllowlist("203.0.113.8, 203.0.113.8\n2001:db8::1 invalid"), ["203.0.113.8", "2001:db8::1"]);
});

test("Temu egress policy pauses jobs when the worker has no configured IP", () => {
  const decision = evaluateTemuEgressIp([], "203.0.113.8");
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.code, temuEgressErrorCodes.notConfigured);
});

test("Temu egress policy pauses jobs when the public IP changes", () => {
  const decision = evaluateTemuEgressIp(["203.0.113.8"], "203.0.113.9");
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.code, temuEgressErrorCodes.changed);
  assert.doesNotMatch(decision.message, /203\.0\.113\./);
});

test("Temu egress policy allows calls only from an explicitly allowlisted worker", () => {
  assert.deepEqual(evaluateTemuEgressIp(["203.0.113.8"], "203.0.113.8"), { ok: true, currentIp: "203.0.113.8" });
});
