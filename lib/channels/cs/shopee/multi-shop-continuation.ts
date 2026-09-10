import { createHash } from "node:crypto";

export const shopeeMultiShopContinuationContract = "sellerpilot_shopee_shop_id_plan_v1" as const;

const CONTRACT_KEY = "sellerpilotShopeeTargetContract";
const PLAN_DIGEST_KEY = "sellerpilotShopeeTargetPlanDigest";
const SHOP_ID_KEY = "sellerpilotShopeeTargetShopId";
const LEGACY_INDEX_KEY = "sellerpilotShopeeTargetIndex";

export type ShopeeMultiShopTarget = {
  contract: typeof shopeeMultiShopContinuationContract;
  planDigest: string;
  shopId: string;
  targetIndex: number;
  targetCount: number;
  nextShopId: string | null;
};

function shopIdText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function compareNumericText(left: string, right: string) {
  return left.length - right.length || left.localeCompare(right, "en");
}

export function canonicalShopeeShopIds(values: readonly unknown[]) {
  const shopIds = [...new Set(values.map(shopIdText).filter(Boolean))];
  if (!shopIds.length) throw new Error("SHOPEE_INQUIRY_SHOP_IDS_MISSING");
  if (shopIds.some((shopId) => !/^[1-9]\d*$/u.test(shopId))) {
    throw new Error("SHOPEE_INQUIRY_SHOP_ID_INVALID");
  }
  return shopIds.sort(compareNumericText);
}

export function shopeeTargetPlanDigest(shopIds: readonly string[]) {
  return createHash("sha256")
    .update(`${shopeeMultiShopContinuationContract}\u001f${shopIds.join("\u001f")}`, "utf8")
    .digest("hex");
}

export function resolveShopeeMultiShopTarget(
  values: readonly unknown[],
  arguments_: Readonly<Record<string, unknown>>,
): ShopeeMultiShopTarget {
  const shopIds = canonicalShopeeShopIds(values);
  const planDigest = shopeeTargetPlanDigest(shopIds);
  const suppliedContract = shopIdText(arguments_[CONTRACT_KEY]);
  const suppliedPlanDigest = shopIdText(arguments_[PLAN_DIGEST_KEY]);
  const suppliedShopId = shopIdText(arguments_[SHOP_ID_KEY]);
  const hasBoundField = [CONTRACT_KEY, PLAN_DIGEST_KEY, SHOP_ID_KEY]
    .some((key) => Object.prototype.hasOwnProperty.call(arguments_, key));

  if (!hasBoundField && arguments_[LEGACY_INDEX_KEY] !== undefined) {
    throw new Error("SHOPEE_INQUIRY_LEGACY_TARGET_INDEX_UNBOUND");
  }
  if (hasBoundField) {
    if (suppliedContract !== shopeeMultiShopContinuationContract
        || !/^[a-f0-9]{64}$/u.test(suppliedPlanDigest)
        || !suppliedShopId) {
      throw new Error("SHOPEE_INQUIRY_TARGET_BINDING_INVALID");
    }
    if (suppliedPlanDigest !== planDigest) {
      throw new Error("SHOPEE_INQUIRY_TARGET_PLAN_CHANGED");
    }
  }

  const shopId = hasBoundField ? suppliedShopId : shopIds[0];
  const targetIndex = shopIds.indexOf(shopId);
  if (targetIndex < 0) throw new Error("SHOPEE_INQUIRY_TARGET_SHOP_MISSING");
  return {
    contract: shopeeMultiShopContinuationContract,
    planDigest,
    shopId,
    targetIndex,
    targetCount: shopIds.length,
    nextShopId: shopIds[targetIndex + 1] ?? null,
  };
}

export function bindShopeeMultiShopContinuation(
  arguments_: Readonly<Record<string, unknown>>,
  target: ShopeeMultiShopTarget,
  shopId: string = target.shopId,
) {
  if (shopId !== target.shopId && shopId !== target.nextShopId) {
    throw new Error("SHOPEE_INQUIRY_TARGET_ADVANCE_INVALID");
  }
  const bound: Record<string, unknown> = {
    ...arguments_,
    [CONTRACT_KEY]: target.contract,
    [PLAN_DIGEST_KEY]: target.planDigest,
    [SHOP_ID_KEY]: shopId,
  };
  delete bound[LEGACY_INDEX_KEY];
  delete bound.shopId;
  delete bound.shop_id;
  return bound;
}
