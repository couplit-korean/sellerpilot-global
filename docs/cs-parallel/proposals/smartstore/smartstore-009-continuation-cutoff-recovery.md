# SmartStore continuation and deferred-cutoff recovery 009

- S0: `S0-20260908-decaba426812a3ba`
- frozen base: supplement 006 SHA-256 `7738d8fee9bfec27a9e802c3b8e8852dd39fd3ebb351f4ce930edd7b5e61e60e`
- frozen 006 files, 공용 source, 운영 DB, provider 수정: 0

## frozen 006에서 재현한 두 재개 결함

### 정상 continuation을 기존 scope 불일치로 거절

v6은 기존 run을 다시 열 때 `sellerpilotHistoryRunId`가 같은 모든 job 수를 정확히 2개로 요구하고, 모든 job의 `periodicKey`를 root 형식으로 검사한다. 실제 page2 이상 job은 run/item 태그를 상속하지만 `periodicKey=continuation:<parent>:<depth>`를 사용한다. 따라서 정상 page2가 한 개만 생겨도 v6 재사용·실패 재개는 `SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH`가 된다.

### 완료되지 않은 당일 cutoff가 과거 창 진행을 가로막음

v3은 당일을 full-day 완료로 승격하지 않는 점은 맞지만, reconciled cutoff가 있어도 항상 같은 최신 창을 `nextWindow`로 반환한다. v6는 같은 날 cutoff request key를 재사용하므로 route를 반복 실행해도 이전 30일 창으로 이동하지 못한다.

## v7 continuation 계약

`smartstore_history_run_lineage_valid_v1`은 job 총수와 초기 root 수를 분리한다.

- 초기 root는 정확히 product 1개, customer 1개여야 한다.
- root는 run/item/periodic key, seller owner, credential, environment, operation, coverage mode/bounds/observedAt, provider query page 1과 size를 검증한다.
- continuation은 root부터 recursive하게 추적한다.
- child는 정확한 parent, 증가하는 depth와 page, 동일 size/kind/item/coverage/query 기간, `continuation:<parent>:<depth>`를 요구한다.
- tagged job 전체가 이 lineage에 정확히 포함되어야 한다.
- duplicate root, duplicate child, 고립되거나 위조된 tagged child는 거절한다.

v7은 새 request key를 만들지 않고 호환되는 v6 request key를 채택한다. 따라서 v6로 이미 접수된 정상 run을 중복 생성하지 않는다. 실패 run에서는 exact lineage의 `failed` job만 queued로 되돌리고 succeeded root와 다른 seller/run은 수정하지 않는다.

## v4 checkpoint 계약

`smartstore_history_run_reconciled_v1`은 run summary만 믿지 않고 다음을 함께 요구한다.

- exact succeeded run과 v7 lineage
- tagged job 수와 run `total_jobs` 일치
- 모든 tagged job의 실제 status가 succeeded
- 모든 root/continuation job에 공용 `cs_history_scan_pages` 기록 존재
- page의 `continuation_expected`와 실제 child 존재 여부 일치
- product/customer root scan의 exact scope, KST bounds, request digest, completed/reconciled/zero-unprocessed

v4 선택 순서는 다음과 같다.

1. 최신 창에 아직 cutoff 증거가 없거나 실패/미관측이면 최신 창을 반환한다.
2. 최신 current-day cutoff가 두 종류 모두 reconciled되면 완료 수에는 넣지 않고 보류한다.
3. 그 사이 이전의 incomplete full-day 창을 `nextWindow`로 반환한다.
4. 과거 창이 모두 끝나면 보류한 당일 창을 다시 반환하되 `complete=false`를 유지한다.
5. 날짜가 넘어간 뒤 동일한 선택 종료일을 조회하면 그 창은 past가 되고, v7은 mode가 다른 full-day run을 새로 생성한다.

30일 partition은 사용자가 선택한 `throughDate`를 기준으로 고정된다. 익일 full-day 전환 시험도 최초 cutoff 날짜를 동일한 선택 종료일로 유지했다. UI가 새로운 오늘 날짜로 종료일을 바꾸면 다른 recovery scope이므로 기존 scope 완료와 섞지 않는다.

## route 계약

`smartstore-009-route-v4-v7.patch`는 통합 담당이 보강한 현재 route를 기준으로 다음 다섯 필드를 함께 바꾼다.

- checkpoint contract `/3` → `/4`
- checkpoint RPC v3 → v4
- `nextWindow.key` prefix v3 → v4
- advance rule → deferred cutoff 규칙
- enqueue RPC v6 → v7

현재 통합 route 파일에 patch를 실제 적용하고 TypeScript diagnostics 0뿐 아니라 POST를 실행했다. v4가 반환한 이전 30일 key가 route의 구조 검사를 통과하고, 그 정확한 날짜가 v7 인자로 전달되어 HTTP 202가 반환됐다.

## 적용 순서

1. 중앙의 frozen-006 NULL mode/kind 보완을 포함한 explicit coverage migration
2. frozen-006 v6 migration
3. `smartstore-009-continuation-safe-window-v7.sql`
4. `smartstore-009-checkpoint-deferred-cutoff-v4.sql`
5. 현재 통합 route에 `smartstore-009-route-v4-v7.patch` 상당 변경

v7은 v6 실행권한을 회수하고 v4는 v3 실행권한을 회수한다. private lineage/reconciliation helper는 PUBLIC, anon, authenticated, service_role 직접 실행권한이 없다.
