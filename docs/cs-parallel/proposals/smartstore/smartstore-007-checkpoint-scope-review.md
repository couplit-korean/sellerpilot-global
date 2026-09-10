# SmartStore checkpoint run-scope 최종 리뷰 007

- S0: `S0-20260908-decaba426812a3ba`
- 동결 기준: supplement 004 SHA-256 `fb72c1b60abcdee0a680c1fb735b14db35ff3d1e59bf025dcdfe9681fe2f84c6`
- 공용 소스·운영 DB·동결 proposal/manifest 수정: 0

## 판정

### 003 order-binding-health-v2

`sellerpilot_read_smartstore_cs_order_binding_health_v2`는 history completion을 만들지 않는다. active production credential에서 `created_by`, `seller_account_key`, source, verified timestamp의 NULL을 제외하고 active scope가 정확히 하나가 아닐 때 실패한다. 상품/고객 주문 참조의 malformed 값도 `contract_mismatch` 또는 명시적 비연결 상태로만 집계한다. 이번 완료 승격 문제에 대한 수정 대상은 아니다.

### 004 next-history-window-v1

결함이 있다. v1은 `cs_history_scans`의 product/customer `exists`를 각각 독립적으로 확인하지만, 다음을 확인하지 않는다.

- scope UUID에 대응하는 `inquiry_history_backfill_runs` 행의 존재
- product/customer scan이 같은 run에 속하는지
- 그 run이 `succeeded`이고 미완료 job이 0인지
- run의 owner, exact range, SmartStore-only channels, credential mapping

따라서 PGlite에서 다음 false completion을 실제 재현했다.

1. 최초 history run이 전혀 없지만 같은 형식의 orphan product/customer scan 두 행만 있는 경우 v1 `complete=true`.
2. `queued` run인데 두 scan 행만 completed/reconciled인 경우 v1 `complete=true`.
3. credential mapping이 `{}`인 run도 scan만 맞으면 v1 `complete=true`.
4. 서로 다른 succeeded run에서 product와 customer 한 행씩 가져와 합친 경우 v1 `complete=true`.

한 종류만 reconciled, `status <> completed`, `reconciled_at is null`, `unprocessed_count is null/0 아님`, scope_key NULL/불일치는 기존 v1에서도 완료되지 않는다. 문제는 개별 scan 조건이 아니라 두 scan과 실제 run scope의 결속 부재다.

### 005 exact-history-window-v5

enqueue 함수 자체는 NULL 날짜, 역전/31일 범위, 비운영 environment, 무효 credential, ambiguous active scope를 실패시키며, exact request key와 run의 owner/range/channels/credential mapping 불일치를 거부한다. 반환값도 항상 `acceptedNotCompleted=true`이고 completion을 만들지 않으므로 이번 false completion의 직접 원인은 아니다.

다만 frozen `smartstore-005-common-integration.patch`는 hunk 헤더 `+1,70` 때문에 실제 적용 결과에서 마지막 POST 함수 `}`가 누락된다. 과거 test는 route 변환 시 `reportDiagnostics`를 확인하지 않아 TypeScript 복구 출력으로 실행되어 이 구문 오류를 놓쳤다. 통합 담당이 실제 root source에서는 이미 `}`를 복구했다.

## 수정 proposal

`smartstore-007-checkpoint-run-scope-v2.sql`은 window별로 실제 run부터 시작해 판정한다. 완료되려면 하나의 동일 run이 모두 만족해야 한다.

- exact seller owner, range, historyDays, `channels=['smartstore']`
- `credential_ids.smartstore`가 요청 credential과 일치
- run `status='succeeded'`, `completed_at` 존재
- 최초 job 2개 이상, `succeeded_jobs=total_jobs`, queued/running/failed 모두 0
- 같은 run UUID가 들어간 exact product/customer scope key
- 두 scan 모두 completed, scan/reconciliation timestamp 존재, `unprocessed_count=0`
- 두 scan 모두 range timestamp 존재

credential 자체도 005와 같은 seller key source/verified timestamp를 요구하고, 다른 active production SmartStore credential이 있으면 fail-closed한다. 함수는 `SECURITY DEFINER`, 빈 search path, 내부 admin 검사, PUBLIC/anon/service_role execute revoke, authenticated만 grant를 유지한다.

`smartstore-007-common-integration.patch`는 이미 구문이 정상인 route에서 checkpoint schema/RPC/advance rule을 v2로 전환한다. root처럼 005의 마지막 `}`를 이미 복구한 통합 소스에는 이 패치만 반영한다.

frozen 005부터 새로 적용하는 경우에는 다음 순서를 사용한다.

```sh
git apply docs/cs-parallel/proposals/smartstore/smartstore-005-common-integration.patch
git apply docs/cs-parallel/proposals/smartstore/smartstore-007-frozen-005-syntax-repair.patch
git apply docs/cs-parallel/proposals/smartstore/smartstore-007-common-integration.patch
```

통합 담당이 이미 정리한 사용자 선택 시작일 UI는 그대로 보존한다. 007은 UI 기간 입력이나 eBay import/render를 수정하지 않는다.

## 적용 후 확인 계약

1. v2 SQL을 migration으로 검토·적용한다.
2. route는 v2 contract/RPC/advance rule 세 필드를 함께 전환한다.
3. 최초 run 없음, orphan scan, queued run, missing credential mapping, cross-run 두 kind, 한 kind만 reconciled를 운영과 분리된 시험 DB에서 재실행한다.
4. route 전체 파일을 직접 읽어 TypeScript diagnostics 0을 확인한다. 변환된 JS 실행 성공만으로 판정하지 않는다.
5. 운영에서는 GET checkpoint와 POST enqueue를 분리하고, `202`를 완료로 표시하지 않는다.

이 proposal은 운영 migration·배포·provider 호출·고객답변·credential 변경을 실행하지 않는다.
