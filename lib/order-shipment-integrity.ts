export type ShipmentFulfillmentResult = {
  id: string;
  channel: string;
  ok: boolean;
  status: "succeeded" | "failed" | "in_progress" | "reconciliation_required";
  remoteSucceeded: boolean;
  ledgerRecorded: boolean;
  reconciliationRequired: boolean;
  message: string;
};

export function shipmentLedgerWriteSucceeded(data: unknown, error: unknown) {
  return error == null && data === true;
}

export function remoteShipmentSuccessResult(input: {
  id: string;
  channel: string;
  ledgerData: unknown;
  ledgerError: unknown;
}): ShipmentFulfillmentResult {
  const ledgerRecorded = shipmentLedgerWriteSucceeded(input.ledgerData, input.ledgerError);
  return ledgerRecorded
    ? {
        id: input.id,
        channel: input.channel,
        ok: true,
        status: "succeeded",
        remoteSucceeded: true,
        ledgerRecorded: true,
        reconciliationRequired: false,
        message: "판매채널 발송 처리와 원장 갱신이 완료됐습니다.",
      }
    : {
        id: input.id,
        channel: input.channel,
        ok: false,
        status: "reconciliation_required",
        remoteSucceeded: true,
        ledgerRecorded: false,
        reconciliationRequired: true,
        message: "판매채널 발송 처리는 성공했지만 내부 주문 원장 반영을 확인하지 못했습니다. 같은 발송 요청을 다시 보내지 말고 원장 조정이 필요합니다.",
      };
}

export function shipmentResultSummary(results: ShipmentFulfillmentResult[]) {
  const succeeded = results.filter((result) => result.status === "succeeded").length;
  const inProgress = results.filter((result) => result.status === "in_progress").length;
  const reconciliationRequired = results.filter((result) => result.status === "reconciliation_required").length;
  return {
    succeeded,
    inProgress,
    reconciliationRequired,
    failed: results.length - succeeded - inProgress - reconciliationRequired,
  };
}
