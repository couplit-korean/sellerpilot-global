import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/_publishing/shopee/requirement-candidate-fields.tsx", import.meta.url), "utf8");
const workbench = readFileSync(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/product-publish-workbench.css", import.meta.url), "utf8");

test("Shopee SG proposal resets explicit selections at TTL and identity boundaries", () => {
  assert.match(component, /requestTuple = `\$\{credentialId\}.*\$\{shopId\}.*\$\{categoryId\}.*\$\{sourceFingerprint\}`/su);
  assert.match(component, /providerTuple[\s\S]*sourceMerchantId/u);
  assert.match(component, /previousSnapshotFresh\.current && !snapshotFresh/u);
  assert.match(component, /requirementSelectionsReset\(onChangeRef\.current, currentDraftRef\.current\)/u);
  assert.match(component, /maxAgeMs = 10 \* 60_000/u);
});

test("Shopee SG proposal preserves incomplete drafts but synchronously gates only Shopee execution", () => {
  assert.doesNotMatch(workbench, /registrationTargetLoading \|\| shopeeRequirementBlocked \|\| registrationSaveStatus/u);
  assert.doesNotMatch(workbench, /registrationTargetLoading, shopeeRequirementBlocked, registrationData/u);
  assert.match(workbench, /currentShopeeRequirementValidation\(\)/u);
  assert.match(workbench, /shopeeSgChannelExecutionAllowed\(channel, operation, shopeeValidation\)/u);
  assert.match(workbench, /channel === "shopee" && shopeeRequirementBlocked/u);
  assert.match(workbench, /Shopee 공식 필수조건 선택 후 등록/u);
  assert.match(workbench, /serializeShopeeSgChannelPatches\(base, current\)/u);
  assert.match(workbench, /shopeeRequirementRefreshRevision/u);
  assert.match(workbench, /onRefresh=\{refreshShopeeRequirements\}/u);
  assert.match(styles, /\.shopee-requirement-fields/u);
});
