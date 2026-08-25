import assert from "node:assert/strict";
import test from "node:test";
import {
  lazadaImBootstrapWindowMs,
  shouldBootstrapLazadaIm,
} from "../lib/channels/lazada-im-bootstrap";

const now = new Date("2026-08-25T01:00:00.000Z");

test("Lazada IM history bootstrap only runs when explicitly requested", () => {
  const credentialChangedAt = "2026-08-25T00:00:00.000Z";
  assert.equal(shouldBootstrapLazadaIm({ requested: false, now, credentialChangedAt }), false);
  assert.equal(shouldBootstrapLazadaIm({ requested: true, now, credentialChangedAt }), true);
  assert.equal(shouldBootstrapLazadaIm({ requested: true, now }), false);
});

test("a successful IM bootstrap is not polled again for the same credential", () => {
  assert.equal(shouldBootstrapLazadaIm({
    requested: true,
    now,
    credentialChangedAt: "2026-08-25T00:00:00.000Z",
    lastSucceededAt: "2026-08-25T00:20:00.000Z",
  }), false);
});

test("a newly rotated credential can bootstrap once more", () => {
  assert.equal(shouldBootstrapLazadaIm({
    requested: true,
    now,
    credentialChangedAt: "2026-08-25T00:40:00.000Z",
    lastSucceededAt: "2026-08-25T00:20:00.000Z",
    lastAttemptedAt: "2026-08-25T00:20:00.000Z",
  }), true);
});

test("a failed or incomplete bootstrap attempt is consumed without retries", () => {
  assert.equal(shouldBootstrapLazadaIm({
    requested: true,
    now,
    credentialChangedAt: "2026-08-25T00:00:00.000Z",
    lastAttemptedAt: "2026-08-25T00:10:00.000Z",
  }), false);
  assert.equal(shouldBootstrapLazadaIm({
    requested: true,
    now: new Date("2026-08-26T00:10:00.000Z"),
    credentialChangedAt: "2026-08-25T00:00:00.000Z",
    lastAttemptedAt: "2026-08-25T00:10:00.000Z",
  }), false);
});

test("bootstrap eligibility expires after the credential window", () => {
  const credentialChangedAt = "2026-08-25T00:00:00.000Z";
  assert.equal(shouldBootstrapLazadaIm({
    requested: true,
    now: new Date(Date.parse(credentialChangedAt) + lazadaImBootstrapWindowMs),
    credentialChangedAt,
  }), true);
  assert.equal(shouldBootstrapLazadaIm({
    requested: true,
    now: new Date(Date.parse(credentialChangedAt) + lazadaImBootstrapWindowMs + 1),
    credentialChangedAt,
  }), false);
});
