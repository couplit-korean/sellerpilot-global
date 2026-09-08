import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type ShopeeReturnVideo = {
  thumbnailUrl: string;
  videoUrl: string;
};

export type ShopeeReturnDetailProjection = {
  contract: "sellerpilot-shopee-return-detail/1";
  returnSn: string;
  orderSn: string | null;
  originalReason: string;
  textReason: string;
  reassessedReason: string;
  status: string;
  refundAmount: number | null;
  currency: string;
  disputeReasons: string[];
  disputeTextReasons: string[];
  createTime: number | null;
  updateTime: number | null;
  dueDate: number | null;
  returnSellerDueDate: number | null;
  returnShipDueDate: number | null;
  negotiation: {
    status: string;
    latestSolution: string;
    latestOfferAmount: number | null;
    latestOfferCreator: string;
    counterLimit: number | null;
    offerDueDate: number | null;
  };
  sellerProof: {
    status: string;
    evidenceDeadline: number | null;
  };
  sellerCompensation: {
    status: string;
    dueDate: number | null;
    amount: number | null;
  };
  logistics: {
    legacyStatus: string;
    reverseStatus: string;
    returnRefundType: string;
    returnSolution: number | null;
    requestType: number | null;
    validationType: string;
    arrivedAtWarehouse: number | null;
    sellerArrange: boolean | null;
    shippingProofMandatory: boolean | null;
    shippingProofUploaded: boolean | null;
    reverseChannelIntegrated: boolean | null;
    reverseChannelName: string;
    partialQuantityReturn: boolean | null;
    refundAmountAdjusted: boolean | null;
  };
  followUpActions: Array<{
    itemId: string;
    modelId: string;
    quantity: number | null;
    currentStatus: number | null;
    relatedOrderSns: string[];
    resellFailedNextStep: string;
  }>;
  media: {
    images: string[];
    buyerVideos: ShopeeReturnVideo[];
    sourceExpiryKnown: false;
  };
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, maxLength = 8_000) {
  const result = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (result.length > maxLength) throw new Error("SHOPEE_RETURN_DETAIL_TEXT_LIMIT");
  return result;
}

function numeric(value: unknown, integer = false) {
  if (value === undefined || value === null || value === "") return null;
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result) || result < 0 || (integer && !Number.isSafeInteger(result))) {
    throw new Error("SHOPEE_RETURN_DETAIL_NUMBER_INVALID");
  }
  return result;
}

function timestamp(value: unknown) {
  const result = numeric(value, true);
  return result === null || result >= 1 ? result : null;
}

function boolean(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("SHOPEE_RETURN_DETAIL_BOOLEAN_INVALID");
}

function list(value: unknown, maxItems = 100) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length > maxItems) throw new Error("SHOPEE_RETURN_DETAIL_LIST_LIMIT");
  return values.map((item) => text(item, 1_000)).filter(Boolean);
}

function mediaUrl(value: unknown) {
  const url = text(value);
  if (!url || url.length > 8_000 || !/^https:\/\//i.test(url)) {
    throw new Error("SHOPEE_RETURN_MEDIA_INVALID");
  }
  return url;
}

function media(response: JsonRecord) {
  const images = response.image === undefined ? [] : response.image;
  const videos = response.buyer_videos === undefined ? [] : response.buyer_videos;
  if (!Array.isArray(images) || images.length > 20 || !Array.isArray(videos) || videos.length > 20) {
    throw new Error("SHOPEE_RETURN_MEDIA_INVALID");
  }
  return {
    images: images.map(mediaUrl),
    buyerVideos: videos.map((value) => {
      const video = record(value);
      return { thumbnailUrl: mediaUrl(video.thumbnail_url), videoUrl: mediaUrl(video.video_url) };
    }),
    // Shopee returns signed/CDN URLs but does not publish a lifetime contract
    // for these fields. The retention worker must fetch and digest them while
    // treating source expiry as unknown, never as permanent availability.
    sourceExpiryKnown: false as const,
  };
}

function followUpActions(value: unknown): ShopeeReturnDetailProjection["followUpActions"] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("SHOPEE_RETURN_FOLLOW_UP_INVALID");
  return value.map((entry) => {
    const action = record(entry);
    const itemId = text(action.item_id, 32);
    const modelId = text(action.model_id, 32);
    if ((itemId && !/^[1-9]\d{0,31}$/.test(itemId)) || (modelId && !/^[1-9]\d{0,31}$/.test(modelId))) {
      throw new Error("SHOPEE_RETURN_FOLLOW_UP_INVALID");
    }
    return {
      itemId,
      modelId,
      quantity: numeric(action.qty, true),
      currentStatus: numeric(action.current_status, true),
      relatedOrderSns: list(action.related_order_sn_list, 100),
      resellFailedNextStep: text(action.resell_failed_next_step, 200),
    };
  });
}

export function projectShopeeReturnDetail(value: unknown, expectedReturnSn = ""): ShopeeReturnDetailProjection {
  const root = record(value);
  const response = Object.keys(record(root.response)).length ? record(root.response) : root;
  const returnSn = text(response.return_sn, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(returnSn)
      || (expectedReturnSn && returnSn !== expectedReturnSn)) {
    throw new Error("SHOPEE_RETURN_DETAIL_IDENTITY_INVALID");
  }
  const originalReason = text(response.reason, 200);
  const textReason = text(response.text_reason, 20_000);
  if (!originalReason && !textReason) throw new Error("SHOPEE_RETURN_DETAIL_REASON_MISSING");
  const negotiation = record(response.negotiation);
  const sellerProof = record(response.seller_proof);
  const sellerCompensation = record(response.seller_compensation);
  const projection: ShopeeReturnDetailProjection = {
    contract: "sellerpilot-shopee-return-detail/1",
    returnSn,
    orderSn: text(response.order_sn, 64) || null,
    originalReason,
    textReason,
    reassessedReason: text(response.reassessed_request_reason, 200),
    status: text(response.status, 200).toUpperCase(),
    refundAmount: numeric(response.refund_amount),
    currency: text(response.currency, 16).toUpperCase(),
    disputeReasons: list(response.dispute_reason),
    disputeTextReasons: list(response.dispute_text_reason),
    createTime: timestamp(response.create_time),
    updateTime: timestamp(response.update_time),
    dueDate: timestamp(response.due_date),
    returnSellerDueDate: timestamp(response.return_seller_due_date),
    returnShipDueDate: timestamp(response.return_ship_due_date),
    negotiation: {
      status: text(negotiation.negotiation_status, 200).toUpperCase(),
      latestSolution: text(negotiation.latest_solution, 200),
      latestOfferAmount: numeric(negotiation.latest_offer_amount),
      latestOfferCreator: text(negotiation.latest_offer_creator, 200),
      counterLimit: numeric(negotiation.counter_limit, true),
      offerDueDate: timestamp(negotiation.offer_due_date),
    },
    sellerProof: {
      status: text(sellerProof.seller_proof_status, 200).toUpperCase(),
      evidenceDeadline: timestamp(sellerProof.seller_evidence_deadline),
    },
    sellerCompensation: {
      status: text(sellerCompensation.seller_compensation_status, 200).toUpperCase(),
      dueDate: timestamp(sellerCompensation.seller_compensation_due_date),
      amount: numeric(sellerCompensation.compensation_amount),
    },
    logistics: {
      legacyStatus: text(response.logistics_status, 200),
      reverseStatus: text(response.reverse_logistics_status ?? response.reverse_logistic_status, 200),
      returnRefundType: text(response.return_refund_type, 100),
      returnSolution: numeric(response.return_solution, true),
      requestType: numeric(response.return_refund_request_type, true),
      validationType: text(response.validation_type, 100),
      arrivedAtWarehouse: numeric(response.is_arrived_at_warehouse, true),
      sellerArrange: boolean(response.is_seller_arrange),
      shippingProofMandatory: boolean(response.is_shipping_proof_mandatory),
      shippingProofUploaded: boolean(response.has_uploaded_shipping_proof),
      reverseChannelIntegrated: boolean(response.is_reverse_logistics_channel_integrated),
      reverseChannelName: text(response.reverse_logistics_channel_name, 500),
      partialQuantityReturn: boolean(response.is_partial_quantity_return),
      refundAmountAdjusted: boolean(response.is_refund_amount_adjusted),
    },
    followUpActions: followUpActions(response.follow_up_action_list),
    media: media(response),
  };
  if (Buffer.byteLength(JSON.stringify(projection), "utf8") > 60_000) {
    throw new Error("SHOPEE_RETURN_DETAIL_LIMIT");
  }
  return projection;
}

export function shopeeReturnDetailRevision(projection: ShopeeReturnDetailProjection) {
  return createHash("sha256").update(JSON.stringify(projection), "utf8").digest("hex");
}
