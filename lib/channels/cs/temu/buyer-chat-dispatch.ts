import type { CsExecuteInput, CsOperationResult } from "../../../cs/operations/contracts";
import { temuCsReadiness } from "./runtime-readiness";

export function isTemuBuyerChatInput(input: Pick<CsExecuteInput, "channel" | "operation" | "arguments">) {
  return input.channel === "temu"
    && input.operation === "inquiries.list"
    && input.arguments.kind === "buyer_chat";
}

export function temuBuyerChatDispatchGuard(input: CsExecuteInput): CsOperationResult | null {
  if (!isTemuBuyerChatInput(input)) return null;
  if ([
    "includeDetails", "updateAtStart", "updateAtEnd", "pageNo", "pageSize",
    "detailQueue", "nextPageNo", "afterSalesStatusGroup",
  ].some(key => Object.hasOwn(input.arguments, key))) {
    // Preserve the existing after-sales kind boundary for mixed payloads.
    throw new Error("TEMU_AFTER_SALES_KIND_INVALID");
  }
  const runtime = input.runtimeContext?.temuBuyerChat;
  const readiness = temuCsReadiness("buyer_chat", runtime?.evidence, runtime?.expected);
  const blockers = readiness.ready
    ? ["TEMU_BUYER_CHAT_ADAPTER_NOT_IMPLEMENTED"]
    : readiness.blockers;
  return {
    ok: false,
    channel: "temu",
    operation: "inquiries.list",
    steps: [{
      name: "buyer-chat-readiness",
      ok: false,
      status: 403,
      data: {
        code: blockers[0] ?? "TEMU_BUYER_CHAT_RUNTIME_CONTEXT_UNVERIFIED",
        blockers,
        state: "permission_pending",
        providerFetchPerformed: false,
      },
    }],
    safeMessage: "Temu Buyer Chat은 공식 계약·현재 앱 권한·계정 결속을 확인하지 못해 원격 호출 전에 차단됐습니다.",
  };
}
