import assert from "node:assert/strict";
import test from "node:test";
import {
  lazadaImBootstrapCooldownMs,
  shouldBootstrapLazadaIm,
} from "../lib/channels/lazada-im-bootstrap";

const now = new Date("2026-08-25T01:00:00.000Z");

test("Lazada IM history bootstrap only runs when explicitly requested", () => {
  assert.equal(shouldBootstrapLazadaIm({ requested: false, now }), false);
  assert.equal(shouldBootstrapLazadaIm({ requested: true, now }), true);
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
    lastStartedAt: "2026-08-25T00:20:00.000Z",
  }), true);
});

test("failed or incomplete bootstrap retries are rate limited", () => {
  assert.equal(shouldBootstrapLazadaIm({
    requested: true,
    now,
    lastStartedAt: new Date(now.getTime() - lazadaImBootstrapCooldownMs + 1).toISOString(),
  }), false);
  assert.equal(shouldBootstrapLazadaIm({
    requested: true,
    now,
    lastStartedAt: new Date(now.getTime() - lazadaImBootstrapCooldownMs).toISOString(),
  }), true);
});
