import assert from "node:assert/strict";
import test from "node:test";
import { shopeeShopTargetIds } from "../lib/channels/target-records";
import {
  bindShopeeMultiShopContinuation,
  canonicalShopeeShopIds,
  resolveShopeeMultiShopTarget,
  shopeeMultiShopContinuationContract,
} from "../lib/channels/cs/shopee/multi-shop-continuation";

const credential = (topLevelShopId: string) => ({
  shop_id: topLevelShopId,
  shopee_targets: ["1001", "1002", "1003"].map((id) => ({ type: "shop", id })),
});
const shopIdsBeforeRefresh = shopeeShopTargetIds(credential("1001"));
const shopIdsAfterTopLevelRefresh = shopeeShopTargetIds(credential("1002"));

test("canonical target plan is stable when a refreshed top-level shop_id changes enumeration order", () => {
  assert.deepEqual(shopIdsBeforeRefresh, ["1001", "1002", "1003"]);
  assert.deepEqual(shopIdsAfterTopLevelRefresh, ["1002", "1001", "1003"]);
  assert.deepEqual(canonicalShopeeShopIds(shopIdsBeforeRefresh), ["1001", "1002", "1003"]);
  assert.deepEqual(canonicalShopeeShopIds(shopIdsAfterTopLevelRefresh), ["1001", "1002", "1003"]);

  const first = resolveShopeeMultiShopTarget(shopIdsBeforeRefresh, {});
  assert.equal(first.shopId, "1001");
  const secondArguments = bindShopeeMultiShopContinuation({}, first, first.nextShopId!);
  const second = resolveShopeeMultiShopTarget(shopIdsAfterTopLevelRefresh, secondArguments);

  assert.equal(second.shopId, "1002");
  assert.equal(second.targetIndex, 1);
  assert.equal(second.targetCount, 3);
  assert.equal(second.planDigest, first.planDigest);
});

test("provider page continuation remains bound to the current immutable shop ID", () => {
  const target = resolveShopeeMultiShopTarget(shopIdsBeforeRefresh, {});
  const pagedArguments = bindShopeeMultiShopContinuation({ cursor: "next-page" }, target);
  const resumed = resolveShopeeMultiShopTarget(shopIdsAfterTopLevelRefresh, pagedArguments);

  assert.equal(resumed.shopId, "1001");
  assert.equal(pagedArguments.cursor, "next-page");
  assert.equal(pagedArguments.sellerpilotShopeeTargetContract, shopeeMultiShopContinuationContract);
  assert.equal(pagedArguments.shopId, undefined);
});

test("completed shop advances to the next deterministic shop and strips the legacy index", () => {
  const first = resolveShopeeMultiShopTarget(["1003", "1001", "1002"], {});
  const continuation = bindShopeeMultiShopContinuation({
    sellerpilotShopeeTargetIndex: 7,
    shop_id: "untrusted",
  }, first, first.nextShopId!);

  assert.equal(continuation.sellerpilotShopeeTargetShopId, "1002");
  assert.equal(continuation.sellerpilotShopeeTargetIndex, undefined);
  assert.equal(continuation.shop_id, undefined);
});

test("target membership changes fail closed instead of silently selecting a different shop", () => {
  const target = resolveShopeeMultiShopTarget(shopIdsBeforeRefresh, {});
  const continuation = bindShopeeMultiShopContinuation({}, target, target.nextShopId!);

  assert.throws(
    () => resolveShopeeMultiShopTarget(["1001", "1002", "1003", "1004"], continuation),
    /SHOPEE_INQUIRY_TARGET_PLAN_CHANGED/u,
  );
  assert.throws(
    () => resolveShopeeMultiShopTarget(["1001", "1002"], continuation),
    /SHOPEE_INQUIRY_TARGET_PLAN_CHANGED/u,
  );
});

test("partial, forged, invalid, and legacy index-only bindings are rejected", () => {
  const target = resolveShopeeMultiShopTarget(shopIdsBeforeRefresh, {});
  const valid = bindShopeeMultiShopContinuation({}, target);

  assert.throws(
    () => resolveShopeeMultiShopTarget(shopIdsBeforeRefresh, {
      sellerpilotShopeeTargetContract: shopeeMultiShopContinuationContract,
    }),
    /SHOPEE_INQUIRY_TARGET_BINDING_INVALID/u,
  );
  assert.throws(
    () => resolveShopeeMultiShopTarget(shopIdsBeforeRefresh, {
      sellerpilotShopeeTargetPlanDigest: "",
    }),
    /SHOPEE_INQUIRY_TARGET_BINDING_INVALID/u,
  );
  assert.throws(
    () => resolveShopeeMultiShopTarget(shopIdsBeforeRefresh, {
      ...valid,
      sellerpilotShopeeTargetShopId: "9999",
    }),
    /SHOPEE_INQUIRY_TARGET_SHOP_MISSING/u,
  );
  assert.throws(
    () => resolveShopeeMultiShopTarget(shopIdsBeforeRefresh, {
      sellerpilotShopeeTargetIndex: 1,
    }),
    /SHOPEE_INQUIRY_LEGACY_TARGET_INDEX_UNBOUND/u,
  );
  assert.throws(
    () => resolveShopeeMultiShopTarget(["1001", "not-a-shop"], {}),
    /SHOPEE_INQUIRY_SHOP_ID_INVALID/u,
  );
});
