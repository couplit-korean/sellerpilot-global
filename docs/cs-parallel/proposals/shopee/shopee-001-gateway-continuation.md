# 공통 변경 요청 shopee-001

- 목적: Shopee 후기/Returns adapter가 만든 정상 continuation을 gateway completion schema가 거부하는 손실 차단
- 요청 채널: Shopee
- S0 ID / 현재 인터페이스 버전: `S0-20260908-decaba426812a3ba` / `sellerpilot-channel-result/1`
- 수정할 공통 파일과 함수: `lib/channels/gateway-contract.ts`, `gatewayWorkerCompletionSchema.superRefine`
- 현재 파일 SHA-256: `691471d01f84f79733cceb7b7e13d2ac70612b59188960bad5fba26fd5399b23`
- 기존 동작: Shopee continuation은 `orders.list`의 `arguments.query.cursor`만 유효하다. `inquiries.list`의 review top-level `cursor` 및 Returns `returnQueue/pageNo/nextPageNo`는 adapter/operations에서 생성돼도 `invalid provider pagination continuation`으로 거부된다.
- 문제를 재현하는 최소 입력: `channel=shopee`, `operation=inquiries.list`, `continuation.arguments={kind:'product_review',cursor:'cursor-4',pageSize:100,sellerpilotPaginationDepth:1,...}` 또는 `kind='return_refund'`과 1~100개 `returnQueue`.
- 원하는 동작: review와 Returns의 정확한 continuation shape만 수용하고 빈 cursor, 빈 queue+불일치 next page, 범위 밖 page size/depth/trail은 계속 거부한다.
- 전용 모듈 경로와 export: 기존 `executeShopeeInquiry`; 새 중복 구현 없음.
- 기존/새 입력·출력 계약: 결과 envelope은 변경하지 않고 Shopee `inquiries.list` continuation 검증 분기만 추가한다.
- 최소 변경안: `orders.list` 분기 다음에 `shopee/inquiries.list` 분기를 추가한다. `product_review`는 non-empty top-level cursor와 pageSize 1~100, `return_refund`는 정확한 15일 window, pageNo, pageSize 1~100, 선택 queue 1~100 unique return_sn 및 nextPageNo 일관성을 검증한다. 공통 depth/epoch/trail 검증은 유지한다.
- 다른 채널 영향: 없음. channel+operation 조합이 Shopee inquiries로 한정된다.
- 상품/주문/배송 mutation 영향: 없음. 읽기 continuation schema만 변경한다.
- 재현·회귀 시험 명령: 기존 6개 필수 시험에 gateway schema의 review/Returns positive/negative case를 추가한다.
- migration 선행/preimage/ACL 요구: 없음. DB completion function이 동일 shape 제한을 갖는지 함께 대조해야 한다.
- 우선순위: 첫 실제 읽기/웹 차단 및 과거누락
- 통합 담당 처리 상태: 통합 소스 반영; DB 최종 wrapper/replay 및 실제 경로 검증 대기
- 반영된 통합 소스 hash와 검증: `lib/channels/gateway-contract.ts` `9b16f3e8cd1b8c4163f45ebe8f248257cc180e35a975447ce6058b5661daa516`; 통합 담당 보고 gateway+pagination 41/41 및 수정 ESLint 통과. Shopee 전용 작업에서 해당 hash를 읽기 재확인함.
