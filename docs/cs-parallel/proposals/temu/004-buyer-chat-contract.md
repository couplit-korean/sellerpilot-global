# 공통 변경 요청 temu-004

- 목적: after-sales와 별개의 Buyer Chat을 공식 계약과 권한이 확보되기 전에는 disabled로 유지하고, 확보 후에만 capability/gateway/UI에 연결한다.
- 요청 채널: temu
- S0 ID / 현재 인터페이스 버전: `S0-20260908-decaba426812a3ba` / capability inventory current
- 수정할 공통 파일과 함수: `lib/cs/capability-inventory.ts`의 Temu capability, 공통 credential permission inventory, gateway operation/capability dispatch, common history/UI/답변 delivery
- 현재 파일 SHA-256: `lib/cs/capability-inventory.ts` `a0e72d200e7d7cc6ab22c47c74be31875b3c2a161672467cc53beca0b86f763e`; `app/cs/capability-inventory.tsx` `51bb943d42c3ca389a9e5965f186618e991005dcbc025812db661f554033cc97`
- DB 객체(해당 시 이름과 signature): 계약 확보 뒤 conversation/session/message/reply delivery 원장을 새 migration으로 제안한다. 현재는 DB 변경 없음.
- 기존 동작: Seller Center에는 별도 `구매자 메시지` UI가 있으나 Partner 공식 GLOBAL API catalog에서 Buyer Chat list/message/webhook/history/reply 계약을 확인하지 못했다. 현재 capability는 `permission_pending`, receive/reply/history 모두 false다.
- 문제를 재현하는 최소 입력: after-sales `parentAfterSalesSn`을 Buyer Chat ticket이나 reply target으로 전달하는 입력.
- 원하는 동작: 공식 API 이름, permission package, cursor/time unit, retention, webhook event, recipient/order/session/message IDs, reply request/readback schema가 모두 증명될 때만 `buyer_chat`을 별도 capability로 활성화한다. 하나라도 없으면 `TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED` 또는 `TEMU_BUYER_CHAT_PERMISSION_MISSING`으로 provider 호출 전 차단한다.
- 전용 모듈 경로와 export: `lib/channels/cs/temu/runtime-readiness.ts`의 `temuCsReadiness("buyer_chat", state)`
- 기존/새 입력·출력 계약: after-sales `{kind:"after_sales", parentAfterSalesSn}`는 유지. Buyer Chat은 추후 공식 계약 그대로 `{kind:"buyer_chat", sessionId, messageId, recipientId, orderReference?}` 형태를 정하며 이 문서가 endpoint나 필드명을 선제 확정하지 않는다.
- 최소 변경안: 현재 capability 상태를 유지하고 runtime fail-closed 시험만 통합한다. Temu가 제공한 공식 문서/지원 답변과 test seller grant가 확보된 뒤 전용 adapter/receiver/history/reply/readback을 별도 리뷰로 추가한다.
- 다른 채널 영향: 없음.
- 상품/주문/배송 mutation 영향: 없음. after-sales refund/reject/appeal API와 Buyer Chat 답변을 서로 대체하지 않는다.
- 재현·회귀 시험 명령: `node --import tsx --test tests/cs-temu-history-runtime-event.test.ts tests/temu-after-sales-detail.test.ts`
- migration 선행/preimage/ACL 요구: 계약 확보 전 migration 없음. 확보 후 customer text는 encrypted/private schema와 최소 권한을 따르고 phone/address는 기본 제외한다.
- 우선순위: 추가기능
- 통합 담당 처리 상태: 외부조건 대기
- 반영된 통합 소스 hash와 검증: 미반영

## 외부 선행조건

1. Partner GLOBAL SellerPilot app이 Active이고 compliance/security가 모두 Approved여야 한다.
2. 정확한 seller/store authorization과 Buyer Chat permission package 이름/승인이 필요하다.
3. Temu 공식 문서 또는 지원 채널에서 list/session, message history, webhook, reply, reply readback의 실제 API/event 계약을 받아야 한다.
4. retention, cursor/page limits, timestamp unit, rate limit, region endpoint, signing, recipient/order binding 규칙이 필요하다.
5. 승인된 test conversation과 발송 문구로 한 건을 수신→답변→원격 readback할 수 있어야 한다.
