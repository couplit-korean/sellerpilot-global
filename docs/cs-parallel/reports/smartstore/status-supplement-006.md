# SmartStore CS 상태 보완 006

supplement 002~005는 동결했고, 이번 기준은 supplement 005 SHA-256 `08b9b668545978c09d447f3bc1b01de37f87ceb1ac6d89efa5849bf526b02b76`이다. 이번 보완은 새 파일만 추가했다.

## 결과

- generic coverage의 SmartStore customer `date::timestamptz` session-TimeZone 의존을 재현 가능한 명시 경계로 차단했다.
- enqueue v6는 현재 KST 날짜를 `cutoff`, 지난 날짜를 `full_day`로 구분하고 시작/종료/관측 시각을 product/customer root job 모두에 봉인한다.
- 같은 날 cutoff 재호출은 idempotent하다. 다음 날 같은 날짜는 request mode가 바뀌어 별도 full-day run을 만들므로 정오 이후 누락이 영구 skip되지 않는다.
- insert trigger는 공용 recorder를 보존하면서 SmartStore v6에만 정확한 KST timestamp와 provider query 결속을 강제한다.
- checkpoint v3는 같은 succeeded run뿐 아니라 두 종류의 exact full KST day, immutable root request digest, 과거 날짜를 모두 요구한다.
- route proposal은 checkpoint v3와 enqueue v6를 함께 호출한다.

## 검증

- 실제 v6 enqueue → 실제 공용 recorder → trigger → v3 checkpoint: 4/4
- route patch 적용 및 TypeScript 구조: 1/1
- 관련 결합 회귀: 19/19
- 신규 test ESLint 및 workspace TypeScript: 종료코드 0

## 상태 구분

- 상품문의·고객문의 핵심 2종: 기존 실제 조회 및 46/46 기간 분모 증거는 유지된다. 본 006은 그 과거 수집의 시간범위 완료 판정을 보완한 proposal이며, 운영 적용·재수집 완료를 뜻하지 않는다.
- 톡톡·리뷰 포함 전체: 별도 공식 계약/권한 및 실제 연동이 남아 미완료다.
- 실답변: 승인된 티켓·문구가 없어 전송하지 않았다.
- mutation: 운영 DB 0, provider 0, credential 0, 고객답변 0, commerce 0.

## 통합 요청

통합 담당은 explicit coverage trigger/helper → enqueue v6 → checkpoint v3 순서로 canonical migration version을 배정하고, route의 contract/RPC/advance rule/enqueue RPC를 008 patch대로 함께 전환해야 한다. 운영 반영 뒤에도 `202 Accepted`는 완료가 아니며, 두 종류 scan의 exact full-day timestamp와 provider readback이 확인될 때만 checkpoint 완료로 표시한다.
