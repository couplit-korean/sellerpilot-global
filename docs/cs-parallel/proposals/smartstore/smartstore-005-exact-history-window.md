# 공통 변경 요청 smartstore-005

- 목적: 기존 v4의 7일 최소 제약 때문에 남는 1~6일 조각까지 포함해 SmartStore의 임의 1~30일 달력 구간을 정확히 상품문의·고객문의 2개 읽기 작업으로 접수한다.
- S0 / 선행 delta: `S0-20260908-decaba426812a3ba` / `delta-supplement-002.json` SHA-256 `478ebba8d24e960b2ee5e63efcbfac419c6126ea71e69c70cc12018706b15b42`
- 실제 SQL draft: `smartstore-005-exact-history-window-v5.sql`
- 공용 route patch: `smartstore-005-common-integration.patch`
- 전용 실행 시험: `tests/cs-smartstore-exact-history-window-v5.test.mjs`

## 입력·출력 계약

입력은 `{fromDate, throughDate, credentialId, environment:"production"}`다. from/to는 KST 달력 구간이며 포함 일수 1~30일만 허용한다. 미래 KST 날짜, 역전 범위, 30일 초과, sandbox는 거부한다.

출력 contract는 `sellerpilot-smartstore-exact-history-window/5`다. `acceptedNotCompleted=true`는 로컬 gateway 읽기 작업 접수만 뜻하며 provider GET, 원장 반영, 웹 표시 또는 전체 이력 완료를 뜻하지 않는다.

## 계정·권한 경계

- 호출 actor는 관리자여야 하지만 run owner는 actor가 아니라 exact active credential의 `created_by`다.
- credential은 SmartStore/production/active, 비만료, seller account key source와 verified timestamp가 있어야 한다.
- 같은 environment에 다른 active SmartStore credential이 하나라도 있으면 판매자 scope가 모호하므로 fail-closed한다.
- static egress policy가 enabled가 아니면 enqueue하지 않는다.
- 생성된 두 job은 run owner, credential ID, channel, environment, operation을 post-write로 다시 확인하며 하나라도 다르면 transaction 전체를 rollback한다.
- 함수는 `SECURITY DEFINER SET search_path=''`, `PUBLIC/anon/service_role` revoke, `authenticated` execute다. underlying table direct grant는 추가하지 않는다.

## 정확한 기간·재시작

- SmartStore 단일 채널 run에만 `history_days=1..30`을 허용하고 다른 채널은 기존 7..30 constraint를 유지한다.
- product item은 `product:<from>:<through>`, customer item은 `customer:<from>:<through>`이며 실제 periodic key는 기존 helper가 `inquiries:history:<run UUID>:smartstore:<item>`으로 고정한다.
- 과거 product `fromDate/toDate`는 `+09:00` 경계를 사용하고 customer는 동일 KST 달력 날짜를 사용한다. 당일 throughDate만 미래 시각을 보내지 않도록 현재 UTC instant를 사용한다.
- request key는 seller owner, exact credential, seller account key, environment, from/to, 일수를 포함한다.
- 같은 범위 재요청은 기존 run을 재사용한다. failed job 중 attempt 4 미만, credential refresh가 진행 중이 아니며 recovery Vault가 없는 읽기 job만 재접수한다. succeeded/cancelled/reconciliation_required/exhausted는 자동 재생하지 않는다.

## checkpoint 결합

002의 `sellerpilot_next_smartstore_history_window_v1()`이 돌려준 `nextWindow.fromDate/throughDate`를 v5에 그대로 전달한다. checkpoint는 같은 credential seller의 실제 run UUID scope에서 product/customer가 모두 completed/reconciled이고 `unprocessed_count=0`일 때만 다음 창으로 이동한다. `HTTP 202`나 gateway `queued`만으로는 이동하지 않는다.

## 검증·통합 상태

- PGlite 5/5: 1·6·7·30일, 윤일을 건넌 임의 범위, UTC/KST session, 중복, 부분 실패 재시작, attempt 4, revoked credential, 다른 seller active scope, non-admin, 1일 두 종류 checkpoint를 통과했다.
- `git apply --check`는 002 공용 patch와 005 route patch를 함께 대상으로 통과한다.
- 공용 원본, 운영 DB, credential, provider, 고객답변, commit/push는 변경하지 않았다.
- 통합 담당 처리 상태: SQL/patch 제출, 운영 migration·route·UI 미반영.
