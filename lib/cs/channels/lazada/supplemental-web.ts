import { z } from "zod";
import { lazadaSupplementalCsSurfaces } from "./scope-inventory";
import {
  lazadaSupplementalReadResponseSchema,
  lazadaSupplementalStoredEventSchema,
} from "./supplemental-contract";

const rpcSchema = z.object({
  events: z.array(lazadaSupplementalStoredEventSchema).max(100),
  nextCursor: z.object({
    occurredAt: z.string().datetime({ offset: true }),
    eventKey: z.string().regex(/^[a-f0-9]{64}$/u),
    credentialId: z.string().uuid(),
    country: z.string().regex(/^[A-Z]{2}$/u),
  }).strict().nullable(),
}).strict();

export function projectLazadaSupplementalReadRpc(value: unknown) {
  const rpc = rpcSchema.parse(value);
  const capabilities = lazadaSupplementalCsSurfaces.map((surface) => ({
    surface: surface.key,
    state: surface.state,
    adapterReady: true as const,
    livePermissionObserved: false as const,
    automaticReadEnabled: false as const,
    replyEnabled: false as const,
    mutationsEnabled: false as const,
    message: surface.key === "product_review"
      ? "공식 리뷰 조회·답글 계약은 확인했지만 현재 앱 권한은 확인되지 않았습니다. 저장 이력만 읽으며 자동 조회와 답글은 비활성입니다."
      : "공식 reverse-order 목록·상세·이력 읽기 어댑터만 준비됐습니다. 취소·반품·환불·거절 변경 작업은 포함하지 않습니다.",
  }));
  return lazadaSupplementalReadResponseSchema.parse({
    contractVersion: "sellerpilot-lazada-supplemental-read-ui/1",
    readOnly: true,
    liveProviderRead: false,
    capabilities,
    events: rpc.events,
    nextCursor: rpc.nextCursor,
  });
}
