# 공통 변경 요청 coupang-004

- 목적: 쿠팡 과거 복구를 고정 7일 이하 창의 8개 scope 단위로 실행하고, 중단·실패 시 같은 종료일을 재수집하며, 완전 성공 뒤에만 다음 과거 종료일로 이동한다.
- 요청 채널: coupang
- S0 ID / 현재 인터페이스 버전: `S0-20260908-decaba426812a3ba`
- 채널 전용 구현: `lib/channels/cs/coupang/history-recovery.ts`의 `coupangHistoryRecoveryBatch`, `coupangHistoryRecoveryCheckpoint`
- 채널 전용 현재 SHA-256: `1e0332782546b9f75d0052640c592a970ad41fb175f3647df5954269f64f93f3`
- 수정할 공통 파일과 현재 SHA-256: `lib/channels/sync-arguments.ts` `17a7670bc5ed8ca6237c412aa80a30b36af337585d3a34f22cb540735424a7a2`; `app/api/operations/sync/route.ts` `71ef296055feff2c6d7dfb9b5e51b24337766f16cc13e874f2086c2e9c2f9f91`; history backfill RPC를 갱신할 통합 담당 배정 SQL.
- 고정 scope: 각 창마다 상품 `ALL`, 콜센터 `NONE/ANSWER/NO_ANSWER/TRANSFER`, 반품, 취소, 교환의 8개다. 30일은 5창·초기 40 jobs, 7일은 1창·8 jobs다.
- 경계: KST 달력일 inclusive 범위이며 각 provider 요청은 최대 7일이다. exchange continuation은 기존 `nextToken`을 마지막 페이지까지 잇고, 다른 scope와 job 분모를 합치지 않는다.
- 실행 가능한 SQL 초안: `docs/cs-parallel/proposals/coupang/patches/004-coupang-history-checkpoint.sql`
- 격리 DB 시험: `tests/cs-coupang-history-checkpoint-db.test.mjs`

## 최소 통합 변경

1. `sellerpilot_start_inquiry_history_backfill_v4`의 쿠팡 분기에서 전용 모듈과 같은 window/scope 계약을 생성하고, run에 `from_date`, `to_date`, `history_days`, `expected_initial_jobs`를 불변값으로 저장한다.
2. 동일 credential incarnation + channel + from/to + scope + page/cursor의 unique key를 사용한다. 중간 실패 재호출은 성공 page를 중복 삽입하지 않고 실패/미완료 page만 같은 run 또는 명시적 retry lineage로 재등록한다.
3. `app/api/operations/sync/route.ts`는 쿠팡 단일 채널 요청에서 DB 반환의 from/to/historyDays/expectedInitialJobs를 `coupangHistoryRecoveryBatch`와 대조한다. 상태 조회 결과는 `coupangHistoryRecoveryCheckpoint`로 해석해 `canAdvance`, `replayEndDate`, `nextEndDate`를 반환한다.
4. `status=succeeded`, queued/running/failed 0, succeeded=total, completedAt 존재를 모두 만족할 때만 `nextEndDate = fromDate - 1 day`를 노출한다. 그 외에는 `nextEndDate=null`, `replayEndDate=기존 toDate`다.
5. 추가 continuation jobs 때문에 `totalJobs`가 초기치보다 늘 수 있으므로 `totalJobs >= expectedInitialJobs`를 허용하되 모든 job이 성공해야 전진한다. 반복 cursor 감지는 현재 page를 실패로 보존하고 run을 성공 처리하지 않는다.
6. provider가 제공 가능한 최초일은 상수로 추정하지 않는다. 8개 scope별 공식 retention 또는 원격 readback으로 확인된 chronological floor를 기록한 뒤 중단한다. 단순 연속 0건만으로 최초일을 확정하지 않는다.

## 반례와 시험

- 윤년 `2024-02-29` 종료 30일은 `2024-01-31~2024-02-29`, 5창, 40 jobs여야 한다.
- queued 1 또는 failed 1이면 같은 `2024-02-29`를 replay하고 next는 null이다.
- continuation으로 42 jobs가 되었더라도 42/42 성공한 경우에만 `2024-01-30`으로 전진한다.
- 합계 불일치, 잘못된 날짜, 7~30일 밖의 요청, 빠진 창/scope는 거부한다.
- 최소 회귀: `node --import tsx --test tests/cs-coupang-history-recovery.test.ts tests/coupang-after-sales.test.ts tests/cs-history-channel-db.test.mjs`
- 상품/주문/배송/환불 mutation 영향: 없음. `inquiries.list` 읽기와 복구 ledger만 다룬다.
- 통합 담당 처리 상태: 미반영

## 격리 검증 결과

- 39 success + 1 failed와 39 success + 1 running은 모두 `replayEndDate=2024-02-29`, `nextEndDate=null`이다.
- initial 40 + continuation 2가 42/42 success일 때만 `nextEndDate=2024-01-30`을 반환한다.
- 잘못된 expected count/channel/range는 checkpoint scope invalid로 닫힌다.
- RPC는 authenticated 관리자만 실행할 수 있고 anon/service role에는 권한이 없다.

