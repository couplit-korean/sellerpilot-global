import { createHash } from "node:crypto";

const digestPattern = /^[a-f0-9]{64}$/u;

export type ShopeeReturnRevisionIdentity = {
  shopId: string;
  returnSn: string;
  externalTicketId: string;
  remoteMessageId: string;
  inboundKey: string;
  detailRevision: string | null;
  ticketKind: "after_sales";
  replySupported: false;
};

export type ShopeeReturnRevisionCandidate = ShopeeReturnRevisionIdentity & {
  detailRevision: string;
  legacyRemoteMessageId: string | null;
};

export type ShopeeReturnRevisionDecision = {
  contract: "sellerpilot-shopee-return-revision-reconciliation/1";
  decision: "new_ticket" | "append_revision" | "duplicate" | "reconciliation_required";
  externalTicketId: string;
  incomingInboundKey: string;
  existingRevisionCount: number;
  appendOnly: true;
  replySupported: false;
  reason:
    | "no_existing_ledger"
    | "new_detail_revision"
    | "legacy_remote_revision_attested"
    | "already_recorded"
    | "legacy_revision_unattested";
};

export type ShopeeReturnLegacyRevisionState = {
  reason: string;
  textReason: string;
  status: string;
  negotiationStatus: string;
  updateTime?: unknown;
  dueDate?: unknown;
  returnSellerDueDate?: unknown;
  nativeMedia: {
    images: string[];
    buyer_videos: Array<Record<string, unknown>>;
  };
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function shopeeReturnInboundKey(externalTicketId: string, remoteMessageId: string) {
  return `shopee:${sha256(["v2", "shopee", externalTicketId, remoteMessageId].join("\u001f"))}`;
}

export function shopeeReturnLegacyRemoteMessageId(
  shopId: string,
  returnSn: string,
  state: ShopeeReturnLegacyRevisionState,
) {
  if (!/^[1-9]\d{0,31}$/u.test(shopId)
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(returnSn)
      || !state || typeof state !== "object"
      || ![state.reason, state.textReason, state.status, state.negotiationStatus]
        .every((value) => typeof value === "string")
      || !Array.isArray(state.nativeMedia?.images)
      || state.nativeMedia.images.length > 20
      || state.nativeMedia.images.some((value) => typeof value !== "string")
      || !Array.isArray(state.nativeMedia?.buyer_videos)
      || state.nativeMedia.buyer_videos.length > 20
      || state.nativeMedia.buyer_videos.some((value) =>
        !value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("SHOPEE_RETURN_LEGACY_REVISION_STATE_INVALID");
  }
  const encoded = JSON.stringify({
    contract: "shopee-return-refund-v1",
    reason: state.reason,
    textReason: state.textReason,
    status: state.status,
    negotiationStatus: state.negotiationStatus,
    updateTime: state.updateTime,
    dueDate: state.dueDate,
    returnSellerDueDate: state.returnSellerDueDate,
    nativeMedia: state.nativeMedia,
  });
  if (!encoded || Buffer.byteLength(encoded, "utf8") > 60_000) {
    throw new Error("SHOPEE_RETURN_LEGACY_REVISION_STATE_INVALID");
  }
  return `${shopId}:${returnSn}:${sha256(encoded)}`;
}

function validateIdentity(value: ShopeeReturnRevisionIdentity) {
  if (!/^[1-9]\d{0,31}$/u.test(value.shopId)
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value.returnSn)
      || value.externalTicketId !== `shopee:return:${value.shopId}:${value.returnSn}`
      || !value.remoteMessageId.startsWith(`${value.shopId}:${value.returnSn}:`)
      || !digestPattern.test(value.remoteMessageId.slice(`${value.shopId}:${value.returnSn}:`.length))
      || value.inboundKey !== shopeeReturnInboundKey(value.externalTicketId, value.remoteMessageId)
      || value.detailRevision !== null && !digestPattern.test(value.detailRevision)
      || value.ticketKind !== "after_sales"
      || value.replySupported !== false) {
    throw new Error("SHOPEE_RETURN_REVISION_IDENTITY_INVALID");
  }
}

export function reconcileShopeeReturnDetailRevision(
  existing: ShopeeReturnRevisionIdentity[],
  incoming: ShopeeReturnRevisionCandidate,
): ShopeeReturnRevisionDecision {
  if (!Array.isArray(existing) || existing.length > 10_000) {
    throw new Error("SHOPEE_RETURN_REVISION_LEDGER_INVALID");
  }
  validateIdentity(incoming);
  if (incoming.legacyRemoteMessageId !== null
      && (!incoming.legacyRemoteMessageId.startsWith(`${incoming.shopId}:${incoming.returnSn}:`)
        || !digestPattern.test(incoming.legacyRemoteMessageId.slice(`${incoming.shopId}:${incoming.returnSn}:`.length)))) {
    throw new Error("SHOPEE_RETURN_LEGACY_REVISION_INVALID");
  }
  const inboundKeys = new Set<string>();
  for (const item of existing) {
    validateIdentity(item);
    if (item.shopId !== incoming.shopId || item.returnSn !== incoming.returnSn
        || item.externalTicketId !== incoming.externalTicketId) {
      throw new Error("SHOPEE_RETURN_REVISION_LEDGER_IDENTITY_MISMATCH");
    }
    if (inboundKeys.has(item.inboundKey)) throw new Error("SHOPEE_RETURN_REVISION_LEDGER_DUPLICATE");
    inboundKeys.add(item.inboundKey);
  }
  const base = {
    contract: "sellerpilot-shopee-return-revision-reconciliation/1" as const,
    externalTicketId: incoming.externalTicketId,
    incomingInboundKey: incoming.inboundKey,
    existingRevisionCount: existing.length,
    appendOnly: true as const,
    replySupported: false as const,
  };
  if (!existing.length) return { ...base, decision: "new_ticket", reason: "no_existing_ledger" };
  if (existing.some((item) => item.inboundKey === incoming.inboundKey
      || item.remoteMessageId === incoming.remoteMessageId
      || item.detailRevision === incoming.detailRevision)) {
    return { ...base, decision: "duplicate", reason: "already_recorded" };
  }
  if (existing.some((item) => item.detailRevision !== null)) {
    return { ...base, decision: "append_revision", reason: "new_detail_revision" };
  }
  if (incoming.legacyRemoteMessageId
      && existing.some((item) => item.remoteMessageId === incoming.legacyRemoteMessageId)) {
    return { ...base, decision: "append_revision", reason: "legacy_remote_revision_attested" };
  }
  return { ...base, decision: "reconciliation_required", reason: "legacy_revision_unattested" };
}
