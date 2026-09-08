# SmartStore history timestamp coverage binding 008

- S0: `S0-20260908-decaba426812a3ba`
- frozen base: supplement 005 SHA-256 `08b9b668545978c09d447f3bc1b01de37f87ceb1ac6d89efa5849bf526b02b76`
- 공용 소스·운영 DB·동결 파일 수정: 0

## 결함

공용 `sellerpilot_service_record_cs_history_page_v1`은 SmartStore 고객문의 `startSearchDate`와 `endSearchDate`를 `date::timestamptz`로 바꾼다. 이 변환은 DB session `TimeZone`에 의존한다. 상품문의도 `throughDate`가 현재 KST 날짜이면 `toDate`가 실행 시각이므로, 날짜 scope가 같아도 실제 coverage는 full calendar day가 아닐 수 있다.

기존 checkpoint v2는 동일 succeeded run과 product/customer scan을 결속하지만 `range_start_at/range_end_at`의 정확한 KST 경계, root request가 요청한 실제 시간 범위, 당일 cutoff와 full-day를 구분하지 않는다. 따라서 당일 정오까지만 수집한 run이 미래 재개를 막지 않는다는 독립 증거가 부족하다.

## 최소 계약

### enqueue v6 입력

- `p_from_date`, `p_through_date`: 1~30일, 미래 불가, production SmartStore 단일 verified credential
- 함수 시작 때 `v_now`를 millisecond 단위로 한 번 고정
- `p_through_date = v_now`의 KST 날짜이면 `coverageMode=cutoff`
- 이미 지난 날짜이면 `coverageMode=full_day`

### 두 root job의 고정 인자

- `sellerpilotHistoryCoverageMode`
- `sellerpilotHistoryCoverageFromAt`
- `sellerpilotHistoryCoverageThroughAt`
- `sellerpilotHistoryCoverageObservedAt`

`fromAt`은 KST 시작일 00:00:00.000이다. `full_day`의 `throughAt`은 KST 종료일 23:59:59.999이고, `cutoff`의 `throughAt`은 고정된 `observedAt`과 같다. product의 `query.fromDate/toDate`와 customer의 `query.startSearchDate/endSearchDate`도 이 경계 및 날짜와 일치해야 한다.

request key에는 `coverageMode`를 포함한다. 같은 날 같은 cutoff 호출은 같은 run을 재사용하지만, 다음 날 같은 날짜 범위는 `full_day`가 되어 새 run을 만든다. cutoff의 정확한 시각은 request key에 넣지 않아 같은 날 반복 클릭으로 부분 run이 증식하지 않는다.

### 공용 coverage 출력 보정

`smartstore-008-explicit-coverage-bounds-v1.sql`은 공용 recorder가 `cs_history_scans`를 insert할 때만 동작하는 SmartStore 전용 trigger이다. v6 필드가 모두 없으면 legacy/non-SmartStore 동작을 보존한다. 하나라도 있으면 다음을 fail-closed 검증한다.

- offset 또는 `Z`가 포함된 parse 가능한 세 timestamp
- KST 시작일 자정과 cutoff/full-day 종료 규칙
- 고정 observed 시각에 대한 mode 일관성
- root job의 seller owner, credential, channel, environment, operation
- run/item/periodic key와 product/customer 종류
- 실제 provider query의 날짜/시간 경계

검증 뒤 공용 recorder가 session `TimeZone`으로 계산한 값을 `Asia/Seoul` 및 명시적 `range_start_at/range_end_at`으로 덮어쓴다. helper와 trigger에는 직접 execute grant가 없다.

### checkpoint v3 출력

v2의 same succeeded exact-run 조건에 다음을 추가한다.

- `window_end < 현재 KST 날짜`
- 두 scan 모두 정확한 KST 00:00:00.000~23:59:59.999
- 두 root job 모두 `coverageMode=full_day`
- root explicit bounds와 observed date가 window와 일치
- scan의 `scope_digest`가 checkpoint 시점 root request digest와 일치

따라서 scope key가 같아도 실제 scan timestamp가 좁거나 root query가 나중에 바뀌면 완료되지 않는다. current-day cutoff는 reconciliation이 끝났어도 checkpoint를 전진시키지 않는다.

## 제안 파일과 적용 순서

1. `smartstore-008-explicit-coverage-bounds-v1.sql`
2. `smartstore-008-exact-history-window-v6.sql`
3. `smartstore-008-checkpoint-full-day-v3.sql`
4. `smartstore-008-route-full-day-v3-v6.patch`

통합 migration에서는 위 SQL 순서를 지킨다. v6는 v5 authenticated 실행을, v3는 기존 v1/v2 checkpoint 실행을 회수한다. route는 checkpoint contract/RPC/advance rule과 enqueue RPC를 한 번에 v3/v6로 전환한다. frozen 005부터 재구성할 때는 005 patch → 007 syntax repair → 007 checkpoint patch → 008 route patch 순서다.

## 검증 경계

PGlite에서 실제 v6 enqueue → 공용 coverage recorder → trigger → v3 checkpoint를 연결했다. product 기록 session은 `Asia/Seoul`, customer 기록 session은 `UTC`로 달리해도 양쪽 경계가 동일했다. 운영 DB, provider, credential, 고객 답변, commerce mutation은 수행하지 않았다.
