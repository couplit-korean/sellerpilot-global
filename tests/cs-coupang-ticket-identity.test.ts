import assert from "node:assert/strict";
import test from "node:test";
import {
  coupangScopedInboundKey,
  coupangScopedTicketExternalId,
  parseCoupangProviderTicketIdentity,
} from "../lib/cs/channels/coupang/ticket-identity.ts";

const VENDOR_A = "a".repeat(64);
const VENDOR_B = "b".repeat(64);

test("Coupang provider identity preserves the native reply target", () => {
  assert.deepEqual(parseCoupangProviderTicketIdentity("call-center:7001"), {
    kind: "call-center",
    inquiryId: "7001",
    providerExternalTicketId: "call-center:7001",
  });
  assert.deepEqual(parseCoupangProviderTicketIdentity("product:7001"), {
    kind: "product",
    inquiryId: "7001",
    providerExternalTicketId: "product:7001",
  });
});

test("same native inquiry and message identities are isolated by certified vendor", () => {
  const nativeTicket = "product:7001";
  const nativeInbound = "coupang:native-message-key";
  assert.notEqual(
    coupangScopedTicketExternalId(VENDOR_A, nativeTicket),
    coupangScopedTicketExternalId(VENDOR_B, nativeTicket),
  );
  assert.notEqual(
    coupangScopedInboundKey(VENDOR_A, nativeInbound),
    coupangScopedInboundKey(VENDOR_B, nativeInbound),
  );
  assert.equal(
    coupangScopedTicketExternalId(VENDOR_A, nativeTicket),
    coupangScopedTicketExternalId(VENDOR_A, nativeTicket),
  );
});

test("malformed, unscoped, and unsupported identities fail closed", () => {
  for (const value of ["7001", "return:7001", "call-center:0", "product:7:1", "product:abc"]) {
    assert.throws(() => parseCoupangProviderTicketIdentity(value), /COUPANG_TICKET_PROVIDER_IDENTITY_INVALID/u);
  }
  assert.throws(
    () => coupangScopedTicketExternalId("vendor-raw", "product:7001"),
    /COUPANG_TICKET_SELLER_ACCOUNT_KEY_INVALID/u,
  );
  assert.throws(
    () => coupangScopedInboundKey(VENDOR_A, "  "),
    /COUPANG_TICKET_INBOUND_IDENTITY_INVALID/u,
  );
});
