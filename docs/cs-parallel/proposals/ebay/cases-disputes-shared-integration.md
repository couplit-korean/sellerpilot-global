# eBay 케이스·결제분쟁 공통 통합 요청

요청 ID: `EBAY-SHARED-002`. 통합 담당 처리 상태: 미반영.

## 정본 계약과 현재 관측

- S0: `S0-20260908-decaba426812a3ba`
- 결제분쟁은 Sell Fulfillment API의 `GET /sell/fulfillment/v1/payment_dispute_summary`, known-ID detail, activity로 읽는다.
- production grant에는 `sell.fulfillment`가 기록돼 있지만 summary 실조회는 HTTP 404였다. 이는 0건 증거가 아니라 계정/앱 가용성 또는 resource 상태 미확인이다.
- eBay Money Back Guarantee resolution case는 Post-Order API의 `GET /post-order/v2/casemanagement/search`와 known-ID `GET /post-order/v2/casemanagement/{caseId}`로 읽는다. search 시작일은 공식 계약상 현재에서 최대 18개월 전이며 Sandbox search/known-case read는 지원되지 않는다.
- Post-Order 호출은 일반 Sell API와 달리 `Authorization: IAF <access-token>`을 요구한다. 같은 production credential에서 Bearer probe는 HTTP 401, IAF 교정 후 search는 HTTP 200이었다.
- 결제분쟁 accept/contest/evidence, case refund/close/appeal은 CS 메시지 답변이 아닌 금전·분쟁 업무 mutation이다.
- 현재 확인한 공식 case/payment-dispute 문서에는 수집 API의 보존기간이 명시돼 있지 않다. 삭제/보존 기간을 임의로 정하지 않고 provider 응답과 내부 history 보존을 분리한다.

전용 GET-only 계약은 `lib/channels/cs/ebay/cases-disputes.ts`에 구현돼 있다. 401/403, 404, 429, provider 오류, missing total, empty+next, hostile/repeated cursor를 빈 결과와 구분한다. 실제 search는 최대 18개월을 30일 창 19개로 나눠 모두 HTTP 200·고유 case ID 0을 관측했다. payment-dispute summary는 HTTP 404라 total/ID 집합을 `null`로 유지했다.

## 공통 입력·출력 요청

입력:

- verified credential ID와 seller account key
- kind: `payment_dispute_summary | payment_dispute | payment_dispute_activity | resolution_case_search | resolution_case`
- summary/search는 `offset/limit`; resolution search는 추가로 31일 이하 `startTime/endTime`; known resource는 provider ID
- history run ID, 고정 범위/수집 시각, credential version

출력:

- provider namespace와 native ID를 분리한 support history event
- availability: `readable | authorization_required | not_available_or_not_found | rate_limited | provider_unverified | sandbox_unsupported`
- `total`은 provider가 누락하면 `null`
- `supportReplySupported=false`, `businessMutationOnly=true`
- 404에서는 entries/total을 0으로 확정하지 않는다.

## 최소 공통 변경안

1. eBay credential capability health에 payment-dispute summary 실제 HTTP 상태를 별도 저장한다.
2. case/dispute 전용 history kind와 native identity namespace를 추가하되 ASQ/Inbox/Commerce ticket과 합치지 않는다.
3. admin read route/UI는 권한·seller account key를 재검증한 뒤 전용 GET-only 함수를 호출한다.
4. case discovery는 공식 search의 native `caseId`만 staging한다. seller 결속이 verified identifier와 일치하거나 provider가 마스킹한 경우만 허용하며, 수량 차이로 ID를 만들지 않는다.
5. 업무 mutation은 별도 승인·금액·사유·readback·reconciliation 계약이 생기기 전까지 UI와 gateway에서 차단한다.

회귀 시험: Bearer/IAF 구분, 404를 0으로 오인하지 않음, 다른 seller ID, Sandbox case, 18개월/31일 범위, case empty+more·missing total·반복 cursor, payment dispute empty+next·missing total, detail/activity ID mismatch, buyer 원문 비노출, customer reply와 accept/refund 혼선 방지, 삭제/보존 기간 표시.

다음 한 행동: 통합 담당이 보완 제안서의 GET-only route/UI 최소 patch와 별도 history namespace를 반영하고, developer keyset/account에서 payment dispute summary 404의 가용 조건을 공식 지원 또는 developer portal로 확인한 뒤 동일 credential으로 GET을 재시도한다.
