# SmartStore CS 상태 보완 007

supplement 006은 SHA-256 `7738d8fee9bfec27a9e802c3b8e8852dd39fd3ebb351f4ce930edd7b5e61e60e`로 동결했다. 이번 보완은 새 파일만 추가한다.

## 결과

- frozen v6가 정상 continuation을 job 수·periodic key 불일치로 거절하는 문제를 실제 재현했다.
- v7은 initial root 2개와 page2 이상 recursive lineage를 구분하고, 실패한 exact child만 재개한다.
- root/child의 page, depth, size, kind, item, coverage, provider query를 결속해 duplicate root와 forged child를 fail-closed한다.
- checkpoint v4는 모든 succeeded root/child에 실제 공용 scan-page 기록이 있는지 확인한다.
- reconciled current-day cutoff는 완료로 세지 않지만 이전 full-day 창의 진행을 막지 않는다.
- 다음 날 동일한 선택 종료일은 별도 full-day run으로 닫힌다.
- 현재 통합 route의 v3 key 검사를 보존하면서 contract/RPC/key/advance rule/enqueue를 v4/v7로 함께 전환하는 patch와 실제 POST 시험을 제공했다.

## 검증

- v7/v4/현재 통합 route: 7/7
- frozen 006 인접 연쇄 포함: 11/11
- common proposal 및 v5 exact-window: 7/7
- clone 없는 순차 관련 검증: 18/18
- 신규 ESLint, 전체 TypeScript, diff check: 모두 종료코드 0

## 상태 구분

- 상품문의·고객문의 핵심 2종: 실제 읽기 및 46/46 분모 증거는 유지된다. continuation과 cutoff history resume의 운영 후보 결함을 격리 DB에서 보완했지만 운영 migration/route 반영 및 운영 재수집 완료는 아니다.
- 톡톡·리뷰 포함 전체: 공식 계약·앱 권한·전용 수신/이력/답변 경로가 남아 미완료다.
- 실고객 답변: 승인된 티켓·문구가 없어 전송하지 않았다.
- mutation: 운영 DB 0, provider 0, credential 0, 고객답변 0, commerce 0.
- commit·push·deploy: 수행하지 않았다.

## 통합 요청

중앙의 frozen-006 NULL mode/kind 차단과 current route key v3 검사를 보존한다. 그 위에 v7 → v4 순서로 canonical migration version을 배정하고 route 다섯 필드를 v4/v7로 원자적으로 전환해야 한다. `202 Accepted`, cutoff 관측, run summary succeeded를 각각 완료로 오인하지 않고, 모든 continuation page ledger와 두 종류 exact full-day scan이 일치할 때만 checkpoint를 완료한다.
