import assert from "node:assert/strict";
import test from "node:test";
import { channelCatalog } from "../lib/channels/catalog";
import {
  channelCapabilityReleasePresentation,
  channelOperationAvailable,
} from "../lib/channels/operation-availability";
import { shipmentVerificationSummary, shipmentWriteAvailability } from "../lib/channels/shipment-release";

test("11번가 검증된 상품 등록·전체 원본 기반 수정과 미검증 발송 작업을 분리한다", () => {
  assert.equal(channelOperationAvailable("elevenst", "listing.create"), true);
  assert.equal(channelOperationAvailable("elevenst", "listing.stop"), true);
  assert.equal(channelOperationAvailable("elevenst", "orders.list"), true);
  assert.equal(channelOperationAvailable("elevenst", "listing.update"), true);
  assert.equal(channelOperationAvailable("elevenst", "price.update"), false);
  assert.equal(channelOperationAvailable("elevenst", "inventory.update"), false);
  assert.equal(channelOperationAvailable("elevenst", "orders.get"), false);
  assert.equal(channelOperationAvailable("elevenst", "shipment.confirm"), false);
  assert.equal(channelOperationAvailable("elevenst", "inquiries.list"), false);
  assert.equal(channelCatalog.elevenst.capabilities.inquiries.mode, "vendor_docs_required");
  assert.match(channelCatalog.elevenst.capabilities.inquiries.note, /공식.*상품 Q&A.*상세 계약/);
});

test("문의·배송 UI가 구현되지 않은 외부 쓰기를 실행 가능으로 노출하지 않는다", () => {
  assert.equal(channelOperationAvailable("shopee", "inquiries.list"), false);
  assert.equal(channelOperationAvailable("ebay", "shipment.acknowledge"), false);
  assert.equal(channelOperationAvailable("temu", "shipment.acknowledge"), false);
  assert.equal(channelOperationAvailable("temu", "shipment.confirm"), true);
  assert.equal(shipmentWriteAvailability("elevenst").available, false);
  assert.match(shipmentWriteAvailability("elevenst").reason, /권한|엔드포인트/);
  assert.equal(shipmentWriteAvailability("lazada").available, true);
});

test("상품 전체 수정은 원격 식별값과 readback 경로가 검증된 채널만 연다", () => {
  for (const channel of ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore"] as const) {
    assert.equal(channelOperationAvailable(channel, "listing.update"), true, channel);
  }
  assert.equal(channelOperationAvailable("temu", "listing.update"), false);
  assert.equal(channelOperationAvailable("ebay", "listing.update"), false);
});

test("게시 상태 재검증은 출시 대상 7개 채널에만 연다", () => {
  for (const channel of [
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay",
  ] as const) {
    assert.equal(
      channelOperationAvailable(channel, "listing.publication.verify"),
      true,
      channel,
    );
  }
  assert.equal(
    channelOperationAvailable("temu", "listing.publication.verify"),
    false,
  );
});

test("실발송 후보가 0건이면 검증 완료가 아니라 대상 부재로 표시한다", () => {
  assert.deepEqual(shipmentVerificationSummary(0), {
    title: "실발송 검증 대상 0건",
    detail: "자동 발송이 검증된 채널에서 처리할 결제완료·출고대기 실주문이 없어, 현재 화면에서 외부 발송 쓰기를 실행·검증할 대상이 없습니다.",
  });
  assert.match(shipmentVerificationSummary(2).title, /후보 2건/);
  assert.match(shipmentVerificationSummary(2).detail, /판매채널 응답과 내부 원장 기록/);
});

test("채널 지원 표는 문서상 API와 실제 출시 가능 상태를 혼동하지 않는다", () => {
  const shopeeChat = channelCapabilityReleasePresentation("shopee", "inquiries");
  assert.equal(shopeeChat.releaseState, "blocked");
  assert.equal(shopeeChat.label, "출시 차단");
  assert.match(shopeeChat.note, /Chat API 권한.*차단/);

  for (const [channel, capability] of [
    ["temu", "listingUpdate"],
    ["ebay", "listingUpdate"],
    ["ebay", "listingStop"],
  ] as const) {
    const presentation = channelCapabilityReleasePresentation(channel, capability);
    assert.equal(presentation.releaseState, "blocked", `${channel}:${capability}`);
    assert.equal(presentation.label, "출시 차단", `${channel}:${capability}`);
    assert.match(presentation.note, /차단/, `${channel}:${capability}`);
  }

  const temuAfterSales = channelCapabilityReleasePresentation("temu", "inquiries");
  assert.equal(temuAfterSales.releaseState, "partial");
  assert.equal(temuAfterSales.label, "조회만");
  assert.match(temuAfterSales.note, /답변.*출시 차단/);
});
