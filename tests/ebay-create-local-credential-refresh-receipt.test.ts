import assert from "node:assert/strict";
import test from "node:test";

import { ebayCreateCredentialRefreshIncarnationFromResponse } from "../lib/channels/ebay-credential-refresh-receipt";

test("local eBay worker accepts an exact refreshed credential incarnation receipt", async () => {
  const incarnation = await ebayCreateCredentialRefreshIncarnationFromResponse(
    Response.json({
      status: "prepared",
      credentialIncarnation: {
        id: "00000000-0000-4000-8000-000000000123",
        version: 8,
        fingerprint: "2".repeat(64),
      },
    }),
    true,
  );
  assert.deepEqual(incarnation, {
    id: "00000000-0000-4000-8000-000000000123",
    version: 8,
    fingerprint: "2".repeat(64),
  });
});

test("local eBay worker rejects a non-ok refresh receipt", async () => {
  await assert.rejects(
    () => ebayCreateCredentialRefreshIncarnationFromResponse(
      Response.json({ message: "conflict" }, { status: 409 }),
      true,
    ),
    /RECEIPT_REJECTED/u,
  );
});

test("local eBay worker rejects a malformed refreshed incarnation", async () => {
  await assert.rejects(
    () => ebayCreateCredentialRefreshIncarnationFromResponse(
      Response.json({ status: "prepared", credentialIncarnation: { id: "wrong" } }),
      true,
    ),
    /INCARNATION_REFRESH_REQUIRED/u,
  );
});
