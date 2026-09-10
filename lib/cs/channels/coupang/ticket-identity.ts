import { createHash } from "node:crypto";

const SELLER_ACCOUNT_KEY = /^[a-f0-9]{64}$/u;
const REPLYABLE_PROVIDER_TICKET = /^(product|call-center):([1-9]\d{0,19})$/u;

export type CoupangProviderTicketIdentity = {
  kind: "product" | "call-center";
  inquiryId: string;
  providerExternalTicketId: string;
};

export function parseCoupangProviderTicketIdentity(value: string): CoupangProviderTicketIdentity {
  const match = REPLYABLE_PROVIDER_TICKET.exec(value.trim());
  if (!match) throw new Error("COUPANG_TICKET_PROVIDER_IDENTITY_INVALID");
  const kind = match[1] as CoupangProviderTicketIdentity["kind"];
  const inquiryId = match[2];
  return { kind, inquiryId, providerExternalTicketId: `${kind}:${inquiryId}` };
}

export function coupangScopedTicketExternalId(sellerAccountKey: string, providerExternalTicketId: string) {
  if (!SELLER_ACCOUNT_KEY.test(sellerAccountKey)) {
    throw new Error("COUPANG_TICKET_SELLER_ACCOUNT_KEY_INVALID");
  }
  const provider = parseCoupangProviderTicketIdentity(providerExternalTicketId);
  const digest = createHash("sha256")
    .update(["coupang-ticket-v1", sellerAccountKey, provider.providerExternalTicketId].join("\u001f"))
    .digest("hex");
  return `coupang:account:${digest}`;
}

export function coupangScopedInboundKey(sellerAccountKey: string, providerInboundKey: string) {
  if (!SELLER_ACCOUNT_KEY.test(sellerAccountKey) || !providerInboundKey.trim()) {
    throw new Error("COUPANG_TICKET_INBOUND_IDENTITY_INVALID");
  }
  return `coupang:${createHash("sha256")
    .update(["coupang-inbound-v1", sellerAccountKey, providerInboundKey.trim()].join("\u001f"))
    .digest("hex")}`;
}
