import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeChannelKeys } from "../lib/channels/catalog";
import { channelOperationRelease } from "../lib/channels/operation-availability";
import { channelPriceUpdateRelease } from "../lib/channels/price-update-release";
import { serverlessGatewayOperationAllowed } from "../lib/channels/serverless-gateway-provider";

test("가격 출시는 쓰기·식별값·동일상품 통화가격 readback·불일치 차단을 모두 요구한다", () => {
  for (const channel of activeChannelKeys) {
    const release = channelPriceUpdateRelease(channel);
    const requirements = [
      release.evidence.writeImplemented,
      release.evidence.exactRemoteIdentity,
      release.evidence.sameProductPriceCurrencyReadback,
      release.evidence.failClosedOnMismatch,
    ];
    assert.equal(release.available, requirements.every(Boolean), channel);
    assert.equal(release.available, false, channel);
    assert.equal(release.mode, "release_verification_required", channel);
    assert.ok(release.reason.length > 20, channel);
  }
});

test("현재 구현된 가격 쓰기와 미구현 채널을 구분하되 readback 없는 쓰기는 열지 않는다", () => {
  for (const channel of ["qoo10", "shopee", "lazada", "coupang", "smartstore", "ebay"] as const) {
    assert.equal(channelPriceUpdateRelease(channel).evidence.writeImplemented, true, channel);
  }
  for (const channel of ["elevenst", "temu"] as const) {
    assert.equal(channelPriceUpdateRelease(channel).evidence.writeImplemented, false, channel);
  }
  assert.match(channelPriceUpdateRelease("qoo10").reason, /ItemCode.*통화·가격/);
  assert.match(channelPriceUpdateRelease("coupang").reason, /vendorItemId.*readback/);
  assert.match(channelPriceUpdateRelease("ebay").reason, /offer ID·SKU.*통화·가격/);
});

test("관리자 출시 판정과 serverless 실행 허용 목록은 동일한 가격 펜스를 사용한다", () => {
  for (const channel of activeChannelKeys) {
    const evidenceRelease = channelPriceUpdateRelease(channel);
    const adminRelease = channelOperationRelease(channel, "price.update");
    assert.equal(adminRelease.available, evidenceRelease.available, channel);
    assert.equal(serverlessGatewayOperationAllowed(channel, "price.update"), evidenceRelease.available, channel);
    if (adminRelease.mode !== "vendor_docs_required") {
      assert.equal(adminRelease.mode, evidenceRelease.mode, channel);
      assert.equal(adminRelease.reason, evidenceRelease.reason, channel);
    }
  }
});

test("Vercel claim·serverless drain·로컬 gateway worker가 차단된 가격 작업을 공급자 호출 전에 종료한다", async () => {
  const [claimRoute, serverlessDrain, worker] = await Promise.all([
    readFile(new URL("../app/api/channel-gateway/worker/claim/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/serverless-cs-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(claimRoute, /if \(parsed\.data\.operation === "price\.update"\)/);
  assert.match(claimRoute, /channelPriceUpdateRelease\(parsed\.data\.channel\)/);
  assert.match(claimRoute, /sellerpilot_service_complete_gateway_transaction/);
  assert.match(claimRoute, /p_status: "failed"/);
  assert.match(claimRoute, /PRICE_UPDATE_RELEASE_BLOCKED/);
  const serverlessFence = serverlessDrain.indexOf('if (job.operation === "price.update")');
  const serverlessEligibility = serverlessDrain.indexOf("if (!isEligibleClaim(job", serverlessFence);
  assert.ok(
    serverlessFence >= 0 && serverlessEligibility > serverlessFence,
    "serverless price release fence must run before general eligibility/provider execution",
  );
  assert.match(
    serverlessDrain.slice(serverlessFence, serverlessEligibility),
    /channelPriceUpdateRelease\(job\.channel\)[\s\S]*finishClaim\([\s\S]*status: "failed"[\s\S]*PRICE_UPDATE_RELEASE_BLOCKED/,
  );
  assert.match(worker, /import \{ channelPriceUpdateRelease \} from "\.\.\/lib\/channels\/price-update-release\.ts"/);
  const localFence = worker.indexOf('if (job.operation === "price.update")');
  const localExecution = worker.indexOf("result = await executeChannelOperation", localFence);
  assert.ok(localFence >= 0 && localExecution > localFence, "local price release fence must run before provider execution");
  assert.match(worker.slice(localFence, localExecution), /if \(!priceRelease\.available\)[\s\S]*PRICE_UPDATE_RELEASE_BLOCKED/);
});
