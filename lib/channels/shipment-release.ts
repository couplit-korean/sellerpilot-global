import { channelCatalog, type ActiveChannelKey } from "./catalog";
import { channelOperationAvailable } from "./operation-availability";

export type ShipmentWriteAvailability = {
  available: boolean;
  label: string;
  reason: string;
};

export function shipmentWriteAvailability(channel: ActiveChannelKey): ShipmentWriteAvailability {
  const capability = channelCatalog[channel].capabilities.shipment;
  const available = channelOperationAvailable(channel, "shipment.confirm");
  return available
    ? { available: true, label: "자동 발송 지원", reason: capability.note }
    : { available: false, label: "자동 발송 미검증", reason: capability.note };
}

export function shipmentVerificationSummary(eligibleOrderCount: number) {
  if (eligibleOrderCount <= 0) {
    return {
      title: "실발송 검증 대상 0건",
      detail: "자동 발송이 검증된 채널에서 처리할 결제완료·출고대기 실주문이 없어, 현재 화면에서 외부 발송 쓰기를 실행·검증할 대상이 없습니다.",
    };
  }
  return {
    title: `실발송 검증 후보 ${eligibleOrderCount.toLocaleString("ko-KR")}건`,
    detail: "자동 발송 지원 채널의 주문만 선택할 수 있습니다. 실행 성공은 판매채널 응답과 내부 원장 기록이 모두 확인된 건만 집계합니다.",
  };
}
